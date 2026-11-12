#!/usr/bin/env node
'use strict';

// `toolkit permissions`: prints the paste-once permission blocks. It only reads and prints. It
// never writes, creates or edits a settings or rules file: the owner pastes a block, no agent does.
// `--apply` (first argument only) hands over to toolkit-permissions-apply.cjs, the owner's own
// one-command merge, typed in their own terminal; agents never run it, and every block asks for it.
//
//   node repo/scripts/toolkit-permissions.cjs [--host claude|codex] [--scope computer|repo|all]
//                                             [--repo-root <checkout>] [--format text|allowed-tools] [--json]
//   node repo/scripts/toolkit-permissions.cjs --check <settings file> [--scope computer|repo]
//   node repo/scripts/toolkit-permissions.cjs --apply [--host claude|codex]    (the owner only)
//
// Two blocks:
//   computer  pasted once per computer into the app's user settings. Toolkit's own reversible
//             commands, each pinned to the managed checkout's full path and one subcommand, and the
//             evidence store command, which checks the store itself. It names no repository.
//   repo      pasted once per governed repository into that repository's local settings, for its
//             GitHub comments. Merges are never in a block.
//
// A line ends in ` *` only where the script behind it checks its own arguments. Where a flag
// would change what the command does, the line is exact (no wildcard) or an ask line names the
// flag. Codex prefix rules allow anything after the prefix and cannot ask for a flag, so every
// row that needs an exact form or an ask line is left out of the Codex block and prompts there.
//
// Every printed line comes from one row of ROWS below, and every row names the guard that still
// checks the command after the host stops asking. A line the table does not hold is never printed.
// --check reads the file you name and reports missing and stale lines; it changes nothing.
//
// Exit codes: 0 printed, 1 stopped (nothing or only part could be printed safely), 2 usage.

const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

class PermissionsError extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); this.exitCode = exitCode; }
}

// ---- the table ---------------------------------------------------------------------------------

const PROGRAMME = 'skills/github-program-reconciler/scripts/programme.cjs';
const WINDOWS_TASKS = 'repo/scripts/toolkit-windows-tasks.cjs';
const CLEANUP = 'repo/scripts/toolkit-cleanup.cjs';
const STORE = 'repo/scripts/toolkit-store.cjs';

const GUARDS = Object.freeze({
  programme: "The script's own controller-holder check, programme lock and merged binding read. A parent lifecycle write needs the merged binding's permission and the closure guard. refresh --scheduled and --budget-ms set only how long one refresh pass may run, 10 to 50 minutes, under the same checks and request cap.",
  tasks: "The script's marker and ownership checks: only Toolkit's own recorded tasks are created, changed or started, and a hand-edited task needs the owner's answer.",
  taskUpdate: 'Its saved approval and question flow: a new task kind or a hand-edited task returns a question for the owner.',
  readOnly: 'Read-only: it lists or prints and changes nothing.',
  listOnly: 'Exact lines for the listing forms only. Recording or forgetting a task is not in a line, so it asks.',
  updateOnly: 'Exact lines for the plan and apply forms only; a run that carries an answers file is not in a line, so it asks. Its saved approval and question flow return a new task kind or a hand-edited task to the owner.',
  cleanup: 'The script checks every path itself: inside a scratch root after links are resolved, a clean and fully pushed worktree, and the evidence store read back first. Anything else is reported, never deleted.',
  comment: 'The owner approved comment lines. Nothing checks the target or the words: the footer hook and the footer sweep check only the footer, so the repository rules on what to post still bind the agent.',
  store: 'The store command checks every step itself: the merged binding\'s store, a checkout whose fetch and push addresses are that store and whose own config holds no push, rewrite or program setting, a private writable store on its default branch, a secret scan of exactly what it commits, a plain push of the bound branch only, no file deletions, and a branch delete only when the branch is already merged.',
});

// Every subcommand of the two multi-command scripts is classified here. A test compares these
// lists with the scripts' own command lists, so a new subcommand fails until someone decides.
const PROGRAMME_ALLOW = Object.freeze(['reconcile', 'refresh', 'show', 'inventory', 'attention', 'update', 'update-parent', 'bind', 'checkpoint',
  'assign', 'return', 'reopen', 'interrupt', 'ack', 'dispose', 'closing-comment']);
const PROGRAMME_ASK = Object.freeze({
  claim: 'Taking or taking over the controller role is an authority change.',
  'init-parent': 'Creating a programme parent is a one-time owner decision.',
  'migrate-state': 'Moving the state documents asks for the owner in that run.',
});
const TASKS_ALLOW = Object.freeze(['plan', 'apply', 'list', 'start']);
const TASKS_ASK = Object.freeze({
  remove: 'Removing registered tasks is a delete.',
  adopt: 'Recording a hand-made task as known is the owner\'s choice.',
});

// Why a row is left out of the Codex block. A Codex prefix rule allows any arguments after its
// prefix, so it cannot hold an exact line or ask for a flag that appears later in the command.
const CODEX_OPEN = 'Codex would allow any flag after this command, including the ones that must ask.';

// forms: what follows the command in an allow line. ' *' is any arguments; '' and ' --json' are
// exact lines. Default: [' *'].
const scriptRow = (id, script, sub, guard, extra = {}) => Object.freeze({ id, scope: 'computer', kind: 'script', script, sub, guard, windowsOnly: false, ...extra });

const ROWS = Object.freeze([
  ...PROGRAMME_ALLOW.map(sub => scriptRow(`programme-${sub}`, PROGRAMME, sub, GUARDS.programme)),
  ...TASKS_ALLOW.map(sub => scriptRow(`tasks-${sub}`, WINDOWS_TASKS, sub, sub === 'list' ? GUARDS.readOnly : GUARDS.tasks, { windowsOnly: true, ...(sub === 'apply' ? { codex: false } : {}) })),
  scriptRow('tasks-list-all', 'repo/scripts/toolkit-tasks.cjs', null, GUARDS.listOnly, { forms: ['', ' --json'], codex: false }),
  scriptRow('task-update', 'repo/scripts/toolkit-update-scheduled-task.cjs', null, GUARDS.updateOnly, { windowsOnly: true, forms: ['', ' --json', ' --apply', ' --apply --json'], codex: false }),
  scriptRow('permissions-print', 'repo/scripts/toolkit-permissions.cjs', null, GUARDS.readOnly),
  scriptRow('cleanup-plan', CLEANUP, 'plan', GUARDS.readOnly),
  scriptRow('cleanup-apply', CLEANUP, 'apply', GUARDS.cleanup),
  scriptRow('store', STORE, null, GUARDS.store),
  Object.freeze({ id: 'gh-pr-comment', scope: 'repo', kind: 'command', command: 'gh pr comment', guard: GUARDS.comment, codex: false }),
  Object.freeze({ id: 'gh-issue-comment', scope: 'repo', kind: 'command', command: 'gh issue comment', guard: GUARDS.comment, codex: false }),
]);

// `--apply` writes the owner's own app settings: only the owner runs it, so every block asks for it.
const APPLY_WHY = 'Writing the app\'s permission settings is the owner\'s own step, typed in their own terminal; agents never run it.';

// Ask lines: the host asks even when an allow line above matches, because ask beats allow.
// `after` is appended to the row's command; each entry names why it still asks.
const ASK_NETS = Object.freeze({
  'tasks-apply': [
    { after: '*--repair-owned*', why: 'A same-job repair needs approval naming the affected tasks.' },
    { after: '*--folder*', why: 'A folder override needs the owner\'s approval.' },
    { after: '*--no-first-run*', why: 'Skipping the first run needs the owner\'s approval.' },
    { after: '*--task-choice*', why: 'A keep-or-replace answer is the owner\'s; a flag cannot prove who answered.' },
  ],
  'permissions-print': [{ after: '*--apply*', why: APPLY_WHY }],
  'gh-pr-comment': [{ after: '*--delete-last*', why: 'Deleting a comment is a delete.' }],
  'gh-issue-comment': [{ after: '*--delete-last*', why: 'Deleting a comment is a delete.' }],
});

// What no block may ever hold. Each entry is checked against every printed line (tests and print).
const START = String.raw`^(?:Bash|PowerShell)\(\s*`;
const NEVER = Object.freeze([
  ['a bare or blanket tool rule', /^(?:Bash|PowerShell)(?:\(\s*\*?\s*\))?$/],
  ['an interpreter with no script', new RegExp(`${START}(?:node|python[0-9.]*|pwsh|powershell|bash|sh|cmd|npx|npm|pnpm|yarn)\\s*\\*`, 'i')],
  ['a wildcard before the command', new RegExp(`${START}\\*`)],
  ['a merge', new RegExp(`${START}gh\\s+pr\\s+merge\\b|mcp__\\w*merge`, 'i')],
  ['a close', new RegExp(`${START}gh (?:pr|issue) close\\b`, 'i')],
  ['a delete', new RegExp(`${START}(?:rm|rmdir|del|erase|rd|Remove-Item|git worktree remove|git branch -[dD]|gh repo delete|Unregister-ScheduledTask)\\b`, 'i')],
  ['a history rewrite', new RegExp(`${START}git (?:reset|rebase|filter-branch|commit --amend)\\b`, 'i')],
  ['a settings or rules file', /(?:settings(?:\.local)?\.json|\.codex[\\/]rules)/i],
  ['a secret or key command', new RegExp(`${START}(?:gh auth|gh secret|cmdkey)\\b|toolkit-env`, 'i')],
  ['an MCP tool', /^mcp__/i],
]);

// ---- paths: a default-deny reader ----------------------------------------------------------------

// A path may go into a permission line only when every character is a letter, a digit or one of
// space _ . - / : and it is absolute with no `..` part and no network share. Anything else is
// refused: a quote, a wildcard or a shell character would change what the line matches.
function safePath(input, platform) {
  if (typeof input !== 'string' || !input || input.length > 400) return null;
  const text = platform === 'win32' ? input.replace(/\\/g, '/') : input;
  if (!/^[\p{L}\p{N} _.\-/:]+$/u.test(text)) return null;
  if (text.startsWith('//') || text.split('/').some(part => part === '..' || part === '.')) return null;
  if (platform === 'win32' ? !/^[A-Za-z]:\/[^:]*$/.test(text) : !(text.startsWith('/') && !text.includes(':'))) return null;
  if (/\/$/.test(text) || /\/\//.test(text) || /(?:^|\/) | (?:\/|$)/.test(text)) return null;
  return text;
}
// Toolkit's own convention for a path in a command: forward slashes inside double quotes.
const quoted = text => `"${text}"`;

// owner/name from a github.com remote URL, lower case; null for anything else.
function githubSlug(remote) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(remote || '').trim());
  return match ? match[1].toLowerCase() : null;
}

// ---- the owner object ----------------------------------------------------------------------------

class PermissionBlocks {
  // #path follows the platform the lines are for, so a path is read the way that computer reads it.
  #fs; #home; #platform; #environment; #run; #cwd; #path;

  constructor({ fs = nodeFs, home = os.homedir(), platform = process.platform, environment = process.env, run = spawnSync, cwd = process.cwd() } = {}) {
    this.#fs = fs; this.#home = home; this.#platform = platform; this.#environment = environment; this.#run = run; this.#cwd = cwd;
    this.#path = platform === 'win32' ? path.win32 : path.posix;
  }

  #readJson(file) {
    try { return JSON.parse(this.#fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
  }

  // The managed checkout Toolkit runs from on this computer, as a safe forward-slash path.
  managedCheckout() {
    const state = this.#readJson(path.join(this.#home, '.ai-agent-toolkit', 'current', 'state.json'));
    const recorded = state && typeof state.repo_path === 'string' ? state.repo_path : '';
    if (!recorded) throw new PermissionsError('this computer has no recorded Toolkit folder, so no line can be pinned to it.', 'run setup toolkit, then toolkit permissions again.');
    const safe = safePath(recorded, this.#platform);
    if (!safe) throw new PermissionsError('the Toolkit folder path holds a character a permission line cannot carry safely (only letters, digits, space, _ . - are printed).', 'move the Toolkit folder to a plain path with setup toolkit, then run toolkit permissions again.');
    if (!this.#fs.existsSync(this.#path.join(recorded, ...PROGRAMME.split('/')))) throw new PermissionsError('the recorded Toolkit folder does not hold the Toolkit scripts.', 'run setup toolkit to repair it, then toolkit permissions again.');
    return { recorded, safe };
  }

  #git(cwd, args) {
    const result = this.#run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return result && result.status === 0 ? String(result.stdout || '').trim() : null;
  }

  // The repository the repo block is for: the main checkout of --repo-root or the current folder,
  // with a readable binding that says governance is enabled. Null with a reason otherwise.
  repository(repoRoot) {
    const start = this.#path.resolve(repoRoot || this.#cwd);
    const common = this.#git(start, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common) return { ok: false, reason: 'this folder is not inside a Git repository.' };
    const root = this.#path.basename(common) === '.git' ? this.#path.dirname(common) : this.#git(start, ['rev-parse', '--show-toplevel']);
    if (!root) return { ok: false, reason: 'the repository\'s main folder could not be found.' };
    const binding = this.#readJson(this.#path.join(root, '.github', 'toolkit-programme.json'));
    if (!binding || binding.governance !== 'enabled') return { ok: false, reason: 'this repository has no Toolkit programme file with governance enabled.' };
    return { ok: true, root, binding };
  }

  // Builds the blocks. Returns { blocks: [...], stops: [...], coverage: [...] }.
  build({ host = 'claude', scope = 'all', repoRoot = null } = {}) {
    const managed = this.managedCheckout();
    const windows = this.#platform === 'win32';
    const tools = host === 'claude' ? (windows ? ['Bash', 'PowerShell'] : ['Bash']) : ['codex'];
    const stops = [];
    const blocks = [];
    const coverage = [];
    const commandOf = row => (row.kind === 'script' ? `node ${quoted(`${managed.safe}/${row.script}`)}${row.sub ? ` ${row.sub}` : ''}` : row.command);
    const emit = rows => {
      const allow = [], ask = [], entries = [], prompts = [];
      for (const row of rows) {
        if (row.windowsOnly && !windows) continue;
        const command = commandOf(row);
        const forms = row.forms || [' *'];
        const tokens = row.kind === 'script' ? ['node', `${managed.safe}/${row.script}`, ...(row.sub ? [row.sub] : [])] : command.split(' ');
        if (host === 'codex' && row.codex === false) { prompts.push({ command, tokens, why: CODEX_OPEN }); continue; }
        entries.push({ id: row.id, command, tokens, guard: row.guard });
        for (const form of forms) coverage.push({ line: `${command}${form}`, guard: row.guard });
        for (const tool of tools) {
          if (tool === 'codex') continue;
          for (const form of forms) allow.push(`${tool}(${command}${form})`);
          for (const net of ASK_NETS[row.id] || []) ask.push(`${tool}(${command} ${net.after})`);
        }
      }
      return { allow, ask, entries, prompts };
    };

    if (scope === 'computer' || scope === 'all') {
      const made = emit(ROWS.filter(row => row.scope === 'computer'));
      const excluded = [
        ...Object.keys(PROGRAMME_ASK).map(sub => ({ command: `node ${quoted(`${managed.safe}/${PROGRAMME}`)} ${sub}`, tokens: ['node', `${managed.safe}/${PROGRAMME}`, sub], why: PROGRAMME_ASK[sub] })),
        // Codex rules match from the start of the command, so --apply must be the first argument.
        { command: `node ${quoted(`${managed.safe}/repo/scripts/toolkit-permissions.cjs`)} --apply`, tokens: ['node', `${managed.safe}/repo/scripts/toolkit-permissions.cjs`, '--apply'], why: APPLY_WHY },
        ...(windows ? Object.keys(TASKS_ASK).map(sub => ({ command: `node ${quoted(`${managed.safe}/${WINDOWS_TASKS}`)} ${sub}`, tokens: ['node', `${managed.safe}/${WINDOWS_TASKS}`, sub], why: TASKS_ASK[sub] })) : []),
      ];
      blocks.push(this.#block({ host, scope: 'computer', made, excluded: [...excluded, ...made.prompts],
        target: host === 'claude' ? path.join(this.#environment.CLAUDE_CONFIG_DIR || path.join(this.#home, '.claude'), 'settings.json') : path.join(this.#environment.CODEX_HOME || path.join(this.#home, '.codex'), 'rules', 'toolkit.rules') }));
    }

    if (scope === 'repo' || scope === 'all') {
      const repo = this.repository(repoRoot);
      if (!repo.ok) stops.push({ scope: 'repo', stopped: `no repo block: ${repo.reason}`, next: 'run toolkit permissions inside a repository with Toolkit governance on.' });
      else {
        const made = emit(ROWS.filter(row => row.scope === 'repo'));
        blocks.push(this.#block({ host, scope: 'repo', made, excluded: made.prompts,
          target: host === 'claude' ? this.#path.join(repo.root, '.claude', 'settings.local.json') : this.#path.join(repo.root, '.codex', 'rules', 'toolkit.rules') }));
      }
    }

    for (const block of blocks) for (const line of block.allow) {
      const hit = NEVER.find(([, pattern]) => pattern.test(line));
      if (hit) throw new PermissionsError(`a line would hold ${hit[0]}, which no block may carry.`, 'report this as a Toolkit bug; nothing was printed.');
    }
    return { managed: managed.safe, blocks, stops, coverage };
  }

  #block({ host, scope, made, excluded, target }) {
    if (host === 'claude') {
      const ask = [...made.ask];
      const settings = { permissions: { allow: made.allow, ...(ask.length ? { ask } : {}) } };
      return { host, scope, target, allow: made.allow, ask, excluded, text: JSON.stringify(settings, null, 2) };
    }
    const rule = (tokens, decision, why) => `prefix_rule(\n    pattern = ${JSON.stringify(tokens)},\n    decision = "${decision}",\n    justification = ${JSON.stringify(why)},\n    match = [${JSON.stringify(tokens)}],\n)`;
    const rules = [
      ...made.entries.map(entry => rule(entry.tokens, 'allow', entry.guard)),
      ...excluded.map(entry => rule(entry.tokens, 'prompt', entry.why)),
    ];
    const text = `# Toolkit permission block (${scope}). Printed by toolkit permissions; pasted by the owner.\n${rules.join('\n')}\n`;
    return { host, scope, target, allow: made.entries.map(entry => entry.command), ask: excluded.map(entry => entry.command), excluded, text };
  }

  // Read-only: which of the block's lines the named Claude Code settings file holds.
  check(file, built) {
    const settings = this.#readJson(path.resolve(file));
    if (!settings) throw new PermissionsError('that file could not be read as JSON.', 'name a Claude Code settings file.');
    const list = key => (Array.isArray(settings.permissions?.[key]) ? settings.permissions[key].filter(item => typeof item === 'string') : []);
    return built.blocks.map(block => {
      const stalePrefix = block.scope === 'computer' ? /^(?:Bash|PowerShell)\(node "?[^)]*\/(?:skills\/github-program-reconciler\/scripts|repo\/scripts)\/[a-z-]+\.cjs/ : null;
      return {
        scope: block.scope,
        missing: [...block.allow.filter(line => !list('allow').includes(line)), ...block.ask.filter(line => !list('ask').includes(line))],
        stale: stalePrefix ? list('allow').filter(line => stalePrefix.test(line) && !block.allow.includes(line)) : [],
      };
    });
  }
}

// ---- command line --------------------------------------------------------------------------------

const USAGE = 'Usage: node repo/scripts/toolkit-permissions.cjs [--host claude|codex] [--scope computer|repo|all] [--repo-root <checkout>] [--format text|allowed-tools] [--json]\n'
  + '       node repo/scripts/toolkit-permissions.cjs --check <settings file> [--scope computer|repo]\n'
  + '       node repo/scripts/toolkit-permissions.cjs --apply [--host claude|codex]   (the owner, in their own terminal)\n';

function parseArgs(argv) {
  const options = { host: 'claude', scope: 'all', format: 'text', json: false, repoRoot: null, check: null };
  const values = { '--host': ['host', ['claude', 'codex']], '--scope': ['scope', ['computer', 'repo', 'all']], '--format': ['format', ['text', 'allowed-tools']], '--repo-root': ['repoRoot'], '--check': ['check'] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') throw new PermissionsError('--apply goes first, on its own or with --host only.', 'see the usage line.', 2);
    if (arg === '--json') { options.json = true; continue; }
    const spec = values[arg];
    const value = spec ? argv[index += 1] : undefined;
    if (!spec || value === undefined || value.startsWith('--') || (spec[1] && !spec[1].includes(value))) throw new PermissionsError(`unknown or incomplete argument ${JSON.stringify(arg)}.`, 'see the usage line.', 2);
    options[spec[0]] = value;
  }
  if (options.check && options.host !== 'claude') throw new PermissionsError('--check reads a Claude Code settings file only.', 'drop --host codex.', 2);
  return options;
}

function describe(built, options) {
  const lines = ['Toolkit permission blocks. Toolkit only prints these: you paste them once, and no agent writes the file.', ''];
  for (const block of built.blocks) {
    const app = block.host === 'claude' ? 'Claude Code' : 'Codex';
    lines.push(`== ${block.scope === 'computer' ? 'Computer block' : 'Repo block'} for ${app} ==`);
    lines.push(`Paste into: ${block.target}`);
    lines.push(block.host === 'claude'
      ? 'Add these lines to the "permissions" lists already in that file; keep every line that is there. Paste nothing else.'
      : 'Add these rules to that file; keep every rule that is there. Check each with: codex execpolicy check --rules <that file> <the command>. These Codex rules are not yet proven on a real Windows install. A Codex rule allows anything after its prefix, so the commands that need an exact form or must ask for a flag are prompt rules here.');
    lines.push('', block.text.trimEnd(), '');
    if (block.excluded.length) lines.push('Left out on purpose, so they keep asking:', ...block.excluded.map(entry => `- ${entry.command}: ${entry.why}`), '');
  }
  for (const stop of built.stops) lines.push(`Stopped: ${stop.stopped} Next: ${stop.next}`);
  if (built.stops.length) lines.push('');
  lines.push('What still checks each line:', ...built.coverage.map(row => `- ${row.line}: ${row.guard}`), '');
  lines.push('Never in a block: merges, closes, deletes outside the cleanup and store commands, raw git pushes, history rewrites, settings edits, secrets and real keys. Those keep asking. Evidence store work goes through the store command, which pushes only the bound store branch and never forces.');
  lines.push(`Agents: write each command exactly as its line shows (node, then the full path in forward slashes inside double quotes), one command per call, so the line matches. A line with no * matches only that exact command.`);
  if (options.host === 'claude') lines.push('To remove a block, delete its lines from the file. Run toolkit permissions again after the Toolkit folder moves.');
  lines.push(`Owner shortcut: type node ${quoted(`${built.managed}/repo/scripts/toolkit-permissions.cjs`)} --apply in your own PowerShell or terminal. It shows the changes, waits for you to type apply, backs up each file and merges the computer blocks. Agents never run it.`);
  return lines;
}

function main(argv = process.argv.slice(2), deps = {}) {
  if (argv[0] === '--apply') return require('./toolkit-permissions-apply.cjs').main(argv.slice(1), deps);
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  let options;
  try { options = parseArgs(argv); }
  catch (error) { err(`${error.message}\n${USAGE}`); return 2; }
  try {
    const owner = new PermissionBlocks(deps);
    const built = owner.build(options);
    if (options.check) {
      const report = owner.check(options.check, built);
      const wanted = report.filter(item => options.scope === 'all' || item.scope === options.scope);
      if (options.json) out(`${JSON.stringify({ check: wanted }, null, 2)}\n`);
      else for (const item of wanted) out(`${item.scope} block: ${item.missing.length} missing, ${item.stale.length} stale.\n${[...item.missing.map(line => `- missing: ${line}`), ...item.stale.map(line => `- stale (points at another Toolkit folder or a retired line): ${line}`)].join('\n')}${item.missing.length + item.stale.length ? '\n' : ''}`);
      return wanted.some(item => item.missing.length || item.stale.length) ? 1 : 0;
    }
    if (options.json) out(`${JSON.stringify(built, null, 2)}\n`);
    else if (options.format === 'allowed-tools') out(`${built.blocks.flatMap(block => block.allow).join('\n')}\n`);
    else out(`${describe(built, options).join('\n')}\n`);
    return built.stops.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof PermissionsError)) throw error;
    err(`${error.message}\n`);
    return error.exitCode;
  }
}

if (require.main === module) Promise.resolve(main()).then((code) => { process.exitCode = code; });

module.exports = Object.freeze({ PermissionBlocks, PermissionsError, ROWS, ASK_NETS, NEVER, GUARDS, githubSlug, PROGRAMME_ALLOW, PROGRAMME_ASK, TASKS_ALLOW, TASKS_ASK, safePath, parseArgs, main });
