'use strict';

// `toolkit permissions --review`: the one list of every permission line in the Claude Code settings
// files Toolkit's command covers, and what the owner's one command would change. Read-only: it never
// writes, creates or edits a settings file. The owner's `--apply` (toolkit-permissions-apply.cjs)
// reads the same list again and changes only Toolkit's own lines and the lines the owner picked.
//
//   node repo/scripts/toolkit-permissions.cjs --review [--repo-root <checkout>] [--all] [--drop <ids>] [--json]
//
// Files in scope (Claude Code only): the computer file (CLAUDE_CONFIG_DIR or ~/.claude/settings.json);
// in a governed repository, the main checkout's .claude/settings.local.json, the same file in every
// worktree folder (registered or left under .claude/worktrees or .tmp/worktrees), and the shared
// .claude/settings.json, which is listed and never written (it changes through a pull request).
// Claude Code reads user, shared and local settings and merges their permission lists
// (https://code.claude.com/docs/en/settings, read 26 Nov 2026).
//
// Not loaded by any hook: toolkit-permissions-cli.cjs and toolkit-permissions-apply.cjs load it.
//
// Line classes, in this order (allow and ask lines only; deny, autoMode, env and every other key are
// never listed and never written):
//   toolkit  the exact line is in Toolkit's block for that file: kept, not listed.
//   missing  in the block, not in a main file: Toolkit's Enter adds it (never to worktree copies).
//   old      a node line for a script Toolkit has ever shipped in a block, not in today's block, in a
//            main file: Toolkit's Enter removes it.
//   dead     names an absolute path that does not exist (read by readPaths, default-deny).
//   risky    matches a named rule below.
//   own      everything else.
// Dead, risky and own lines stay unless the owner names their id. Ids are R1.., D1.., Y1.. per class,
// one per distinct line across every file, in a fixed order (class, first file, line text).
//
// Masking: a NAME=value whose NAME holds KEY, TOKEN, SECRET, PASSWORD or AUTH, and any run of 32 or
// more letters and digits, prints as <hidden>, so a token in a once-approved command never reaches
// the chat transcript. The id still names the real line.

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const path = require('node:path');
const { RETIRED_SCRIPTS, nodeScript, shippedScripts, oldToolkitLine } = require('./toolkit-permissions.cjs');

const CLASS_ORDER = Object.freeze(['risky', 'dead', 'own']);
const LETTER = Object.freeze({ risky: 'R', dead: 'D', own: 'Y' });
const MAX_DROP = 500;
const FOLD_AT = 5;

class ReviewStop extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); Object.assign(this, { stopped, next, exitCode }); }
}

// ---- line readers (pure) --------------------------------------------------------------------------

const SHELL = /^(Bash|PowerShell)\(([\s\S]*)\)$/;
const FILE_TOOLS = /^(Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep)\(([\s\S]*)\)$/;

// The absolute paths a line names, read default-deny: only paths made of letters, digits, space and
// _ . - / \ : in the forms below are returned; anything else is not checked, so a line is never called
// dead on a guess. A path ending in a wildcard gives the folder before it; a wildcard inside gives
// nothing. Returns [{ shown, real }] where real is the path to look up on this computer.
function readPaths(line, { platform = process.platform, home = '' } = {}) {
  const text = String(line);
  // A line with a control, line-break, invisible or direction character is never read: the app may
  // see it differently from this reader.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}   -   　]/u.test(text)) return [];
  const shell = SHELL.exec(text);
  const file = shell ? null : FILE_TOOLS.exec(text);
  if (!shell && !file) return [];
  const tokens = shell ? [...shell[2].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]) : [file[2].trim()];
  const found = [];
  for (const token of tokens) {
    const real = absolutePath(token, { platform, home, fileTool: Boolean(file) });
    if (real) found.push({ shown: token, real });
  }
  return found;
}

function absolutePath(token, { platform, home, fileTool }) {
  let value = String(token);
  if (!/^[\p{L}\p{N} _.\-/\\:*~]+$/u.test(value) || /~/.test(value.slice(1))) return null;
  value = value.replace(/(?:[\\/]\*\*?|\*\*?)$/, '');
  if (!value || value.includes('*')) return null;
  const win = platform === 'win32';
  const drive = /^([A-Za-z]):[\\/]/.exec(value);
  let real = null;
  if (/^~[\\/]/.test(value)) real = home ? path.join(home, value.slice(2)) : null;
  else if (/^\/\/[^/]/.test(value)) {
    // Claude Code's absolute form in a file rule: //c/Users/... on Windows, //home/... elsewhere.
    const rest = value.slice(1);
    const letter = /^\/([A-Za-z])(?:\/|$)(.*)$/.exec(rest);
    real = win ? (letter ? `${letter[1].toUpperCase()}:/${letter[2]}` : null) : rest;
  } else if (fileTool) return null; // /path and path are relative in a file rule: not checked.
  else if (drive) real = win ? value : null;
  else if (value.startsWith('/')) {
    const letter = /^\/([A-Za-z])(?:\/|$)(.*)$/.exec(value);
    real = win ? (letter ? `${letter[1].toUpperCase()}:/${letter[2]}` : null) : value;
  }
  if (!real || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(real)) return null;
  return real;
}

// Risky rules, each with the plain words the owner reads. The merge, close, delete, rewrite, secret,
// settings, bare, interpreter and wildcard-first rules are the blocks' own NEVER patterns.
function riskyRules(NEVER) {
  const never = label => {
    const hit = NEVER.find(([name]) => name === label);
    if (!hit) throw new Error(`NEVER has no ${label} rule`);
    return hit[1];
  };
  return Object.freeze([
    ['Any command at all', never('a bare or blanket tool rule')],
    ['Any file edit', /^(?:Edit|Write|MultiEdit|NotebookEdit)(?:\(\s*(?:\*\*?|\/\/\*\*?|~\/\*\*?|\/\*\*?)?\s*\))?$/],
    ['Any web address', /^WebFetch(?:\(\s*\*?\s*\))?$/],
    ['Can merge pull requests', never('a merge')],
    ['Can close issues or pull requests', never('a close')],
    ['Can delete files or branches', never('a delete')],
    ['Can delete files or branches', /^(?:Bash|PowerShell)\(\s*git\s+push\b[^)]*(?:--delete|\s:\S)/i],
    ['Can rewrite Git history', never('a history rewrite')],
    ['Can push to any branch, force included', /^(?:Bash|PowerShell)\(\s*git\s+push\b/i],
    ['Can read or change secrets and keys', never('a secret or key command')],
    ['Can change settings or rules files', { test: line => !/^(?:Read|Glob|Grep)\(/.test(line) && never('a settings or rules file').test(line) }],
    ['Any GitHub call, merges and deletes included', /^(?:Bash|PowerShell)\(\s*gh(?:\s+[A-Za-z-]+)?\s*(?::?\*)\s*\)$/],
    ['Runs any code', never('an interpreter with no script')],
    ['Runs any code', /^(?:Bash|PowerShell)\(\s*(?:(?:python[0-9.]*|py|node|bash|sh|zsh|pwsh|powershell)\s+-\s*(?:\)|$)|(?:python[0-9.]*|py)\s+(?:-\w+\s+)*-c\b|(?:bash|sh|zsh)\s+-c\b|(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-(?:Command|c|EncodedCommand)\b|node\s+(?:-e|--eval|-p|--print)\b|cmd(?:\.exe)?\s+\/c\b)/i],
    ['Runs any command as administrator', /^(?:Bash|PowerShell)\(\s*(?:sudo|doas|runas)\b/i],
    ['Runs code from a download or a pipe', /^(?:Bash|PowerShell)\([^)]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|pwsh|powershell|iex|Invoke-Expression|python[0-9.]*|node)\b/i],
    ['Can delete files or branches', /^(?:Bash|PowerShell)\(\s*(?:gh\s+[a-z-]+\s+delete\b|git\s+clean\b|find\b[^)]*\s-delete\b)/i],
    ['Can delete files or branches', /^mcp__\S*?delete/i],
    ['Can read secrets and keys', /(?:[\\/]\.ssh(?:[\\/]|\b)|\bid_(?:rsa|ed25519|ecdsa)\b|[\\/]\.aws[\\/]credentials|(?:^|[\s\\/(])\.env\b|security\s+find-(?:generic|internet)-password)/i],
    ['Any command that ends this way', never('a wildcard before the command')],
  ]);
}

function riskyReason(line, rules) {
  const hit = rules.find(([, pattern]) => pattern.test(line));
  return hit ? hit[0] : null;
}

// ---- masking and short forms (pure) ---------------------------------------------------------------

// A value in a command: quoted, or a run up to a space, quote, comma or bracket.
const VALUE = String.raw`("[^"]*"|'[^']*'|[^\s"',)]+)`;
const HIDE = Object.freeze([
  // A header that carries a key: x-api-key: <value>, Authorization: Bearer <value>, Cookie: <value>.
  [new RegExp(String.raw`\b((?:x-)?api[-_]?key|authorization|proxy-authorization|x-auth-token|private-token|cookie)(\s*[:=]\s*)(?:(bearer|basic|token|digest)\s+)?${VALUE}`, 'gi'),
    (all, name, sep, scheme) => `${name}${sep}${scheme ? `${scheme} ` : ''}<hidden>`],
  // NAME=value where the name says it is a key, token, secret or password.
  [new RegExp(String.raw`\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|AUTH|CREDENTIAL)[A-Za-z0-9_]*)=${VALUE}`, 'gi'), '$1=<hidden>'],
  // A flag that carries one: --password x, --token=x, --api-key x, --client-secret x.
  [new RegExp(String.raw`((?:^|\s)--?(?:password|passwd|pass|token|api-?key|secret|client-secret|auth(?:-token)?)(?:=|\s+))${VALUE}`, 'gi'), '$1<hidden>'],
  // -u user:password and --user user:password; -p<password> written onto the flag (mysql style).
  [new RegExp(String.raw`((?:^|\s)(?:-u|--user)\s+[^\s:"']+:)${VALUE}`, 'g'), '$1<hidden>'],
  [/(\b(?:mysql|mysqldump|mysqladmin|mariadb|mariadb-dump)\b[^\n]*?\s-p)([^\s"',)]+)/g, '$1<hidden>'],
  // Known key shapes: sk-..., GitHub, Slack, AWS keys and JSON web tokens.
  [/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2})/g, '<hidden>'],
  // Any other long run that looks random: 24 or more base64url characters with an upper-case letter,
  // a lower-case letter and a digit, or 32 or more letters and digits. Plain names stay readable.
  [/[A-Za-z0-9_+-]{24,}={0,2}/g, run => ((/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)) || /^[A-Za-z0-9]{32,}$/.test(run) ? '<hidden>' : run)],
]);

// What the owner may see of a line: secrets hidden, and line breaks shown as one line, so a saved
// multi-line rule never splits across the screens or looks like other rows.
function mask(text) {
  let shown = String(text).replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, ' [line break] ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '?');
  for (const [pattern, to] of HIDE) shown = shown.replace(pattern, to);
  return shown;
}

const base = value => String(value).replace(/[\\/]+$/, '').split(/[\\/]/).pop();

// The raw line in short: the command inside Bash(...) or PowerShell(...), paths cut to .../name.
function shortRaw(line) {
  const text = mask(line);
  const shell = SHELL.exec(text);
  const inner = shell ? shell[2] : text;
  return inner.replace(/"([^"]*[\\/][^"]*)"|((?:[A-Za-z]:|~|\/)?[\\/][^\s"')]*[\\/][^\s"')]+)/g, (all, quotedPath, barePath) => `.../${base(quotedPath || barePath)}`);
}

// What a line lets an agent do, in a few plain words, with no code marks.
function plainWords(line) {
  const text = mask(line);
  const shell = SHELL.exec(text);
  if (shell) {
    const inner = shortRaw(text).replace(/\s*:?\*\s*$/, '');
    const any = /\s*:?\*\s*$/.test(shell[2]);
    return `${inner}${any ? ', any arguments' : ''}${shell[1] === 'PowerShell' ? ' (PowerShell)' : ''}`;
  }
  const file = FILE_TOOLS.exec(text);
  if (file) {
    const verb = { Read: 'Read', Glob: 'Find', Grep: 'Search' }[file[1]] || 'Edit';
    return `${verb} files in ${base(file[2].replace(/[\\/]?\*\*?$/, '')) || 'any folder'}`;
  }
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)(?:__(.+))?$/.exec(text);
  if (mcp) return mcp[2] ? `${mcp[1]} tool ${mcp[2]}` : `Every ${mcp[1]} tool`;
  if (text === 'WebSearch') return 'Web search';
  const fetch = /^WebFetch\(domain:([^)]+)\)$/.exec(text);
  if (fetch) return `Web pages on ${fetch[1]}`;
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// A short Toolkit line for the add list: script name and subcommand (or the command), its wildcards
// and ask patterns left out, so a row's allow and ask lines and its tools show as one entry.
function toolkitWords(line) {
  const shell = SHELL.exec(line);
  if (!shell) return { key: line, words: plainWords(line), tool: '' };
  const script = nodeScript(line);
  const command = script ? `${base(script)} ${shell[2].replace(/^\s*node\s+(?:"[^"]+"|\S+)\s*/, '')}` : shell[2];
  const words = command.replace(/\s+\*\S*\*$/, '').replace(/\s+\*$/, '').trim();
  return { key: words, words, tool: shell[1] };
}

// Chat words carry no path marks: .../name becomes name.
const chatWords = text => String(text).replace(/\.\.\.\//g, '');

// ---- the owner object ----------------------------------------------------------------------------

class PermissionReview {
  #fs; #home; #platform; #environment; #run; #blocks; #rows; #never; #cwd; #safePath;

  // blocks: a PermissionBlocks; rows, never and safePath: its ROWS and NEVER tables and path reader.
  constructor({ blocks, rows, never, safePath, fs = nodeFs, home, platform = process.platform, environment = process.env, run, cwd = process.cwd() }) {
    this.#blocks = blocks; this.#rows = rows; this.#never = never; this.#safePath = safePath;
    this.#fs = fs; this.#home = home; this.#platform = platform; this.#environment = environment; this.#run = run; this.#cwd = cwd;
  }

  // The main checkout of the folder, for a repository Toolkit does not govern; null outside Git.
  #mainCheckout(start) {
    const common = (this.#git(start, ['rev-parse', '--path-format=absolute', '--git-common-dir']) || '').trim();
    if (!common) return null;
    if (path.basename(common) === '.git') return path.dirname(common);
    return (this.#git(start, ['rev-parse', '--show-toplevel']) || '').trim() || null;
  }

  #git(cwd, args) {
    const result = this.#run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return result && result.status === 0 ? String(result.stdout || '') : null;
  }

  #readSettings(file) {
    let text;
    try { text = this.#fs.readFileSync(file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { exists: false, text: null, settings: null };
      throw new ReviewStop(`${file} could not be read (${error && error.code ? error.code : 'error'}).`, 'fix the file, then ask for the list again. Nothing was written.');
    }
    let settings = null;
    try { settings = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { settings = null; }
    const permissions = settings && settings.permissions;
    const listOk = key => permissions === undefined || permissions[key] === undefined || (Array.isArray(permissions[key]) && permissions[key].every(item => typeof item === 'string'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)))
      || !listOk('allow') || !listOk('ask')) {
      throw new ReviewStop(`${file} is not a settings file Toolkit can merge into safely (it must be a JSON object whose permission lists hold only text).`, 'fix that file, then ask for the list again. Nothing was written.');
    }
    return { exists: true, text, settings };
  }

  // The worktree folders of the repository: registered ones and any left under .claude/worktrees or
  // .tmp/worktrees, main checkout excluded, each once.
  #worktrees(root) {
    const seen = new Map();
    const add = dir => { const key = path.resolve(dir).toLowerCase(); if (key !== path.resolve(root).toLowerCase() && !seen.has(key)) seen.set(key, path.resolve(dir)); };
    for (const line of (this.#git(root, ['worktree', 'list', '--porcelain']) || '').split(/\r?\n/)) if (line.startsWith('worktree ')) add(line.slice(9));
    for (const parent of [path.join(root, '.claude', 'worktrees'), path.join(root, '.tmp', 'worktrees')]) {
      let entries = [];
      try { entries = this.#fs.readdirSync(parent, { withFileTypes: true }); } catch { entries = []; }
      for (const entry of entries) if (entry.isDirectory()) add(path.join(parent, entry.name));
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  // Every file in scope with its block, in a fixed order: computer, repository main, shared (in Git),
  // worktree copies.
  // A repository Toolkit does not govern is reviewed too (every settings file, INT-TK421-1368): Toolkit
  // adds nothing there, so its block is empty and any Toolkit line there is an old one.
  files({ repoRoot = null } = {}) {
    const built = this.#blocks.build({ host: 'claude', scope: 'all', repoRoot });
    const computer = built.blocks.find(block => block.scope === 'computer');
    let repo = built.blocks.find(block => block.scope === 'repo');
    let note = null;
    let repoRootSafe = repo ? repo.root : null;
    if (!repo) {
      // Resolved the way that computer reads a path, as PermissionBlocks does.
      const root = this.#mainCheckout((this.#platform === 'win32' ? path.win32 : path.posix).resolve(repoRoot || this.#cwd));
      if (!root && repoRoot) throw new ReviewStop('that folder is not inside a Git repository.', 'name the repository\'s folder with --repo-root. Nothing was written.');
      if (root) {
        repo = { scope: 'repo', target: path.join(root, '.claude', 'settings.local.json'), allow: [], ask: [], autoMode: [], governed: false };
        repoRootSafe = this.#safePath ? this.#safePath(root, this.#platform) : null;
        note = `${path.basename(root)} is not governed by Toolkit, so Toolkit adds no lines there; its lines are listed for you to keep or pick`;
      }
    }
    const files = [{ kind: 'computer', place: 'computer', label: 'Computer settings', target: computer.target, block: computer, writable: true, main: true }];
    let repoName = null;
    if (repo) {
      const root = path.dirname(path.dirname(repo.target));
      repoName = path.basename(root);
      files.push({ kind: 'repo', place: repoName, label: `${repoName} settings`, target: repo.target, block: repo, writable: true, main: true });
      const shared = path.join(root, '.claude', 'settings.json');
      if (this.#fs.existsSync(shared)) {
        const tracked = this.#git(root, ['ls-files', '--error-unmatch', '.claude/settings.json']) !== null;
        files.push({ kind: 'shared', place: `${repoName} ${tracked ? 'in Git' : 'shared settings'}`, label: `${repoName} shared settings${tracked ? ' (in Git)' : ''}`, target: shared, block: null, writable: false, main: false });
      }
      for (const folder of this.#worktrees(root)) {
        const copy = path.join(folder, '.claude', 'settings.local.json');
        if (this.#fs.existsSync(copy)) files.push({ kind: 'copy', place: repoName, label: `${repoName} worktree copy ${path.basename(folder)}`, target: copy, block: repo, writable: true, main: false });
      }
    } else note = built.stops.length ? built.stops[0].stopped.replace(/^no repo block: /, '') : null;
    return { built, files, repoName, note, repoRoot: repoRootSafe };
  }

  // The whole list. Returns a model the renderers and --apply read.
  collect({ repoRoot = null } = {}) {
    const { built, files, repoName, note, repoRoot: commandRoot } = this.files({ repoRoot });
    const shipped = shippedScripts(this.#rows);
    const rules = riskyRules(this.#never);
    const exists = file => { try { return this.#fs.existsSync(file); } catch { return true; } };
    const items = new Map();
    const toolkit = [];
    for (const [index, file] of files.entries()) {
      // A main file Toolkit writes must read cleanly; a worktree copy or the shared file that does not
      // is listed as not read and never written, so a broken leftover never stops Toolkit's own update.
      let read;
      try { read = this.#readSettings(file.target); } catch (error) {
        if (file.main || !(error instanceof ReviewStop)) throw error;
        read = { exists: true, text: this.#rawText(file.target), settings: null };
        file.unreadable = true;
        file.writable = false;
      }
      Object.assign(file, { index, before: read.text, exists: read.exists, sha: read.text === null ? 'none' : crypto.createHash('sha256').update(read.text).digest('hex') });
      const permissions = (read.settings && read.settings.permissions) || {};
      const have = key => (Array.isArray(permissions[key]) ? permissions[key] : []);
      file.missing = { allow: [], ask: [] };
      file.old = { allow: [], ask: [] };
      // Toolkit's auto mode rule lives in the computer file only: missing, or an old Toolkit rule.
      const autoRules = Array.isArray(read.settings?.autoMode?.allow) ? read.settings.autoMode.allow.filter(rule => typeof rule === 'string') : [];
      const autoMode = file.kind === 'computer' ? (file.block.autoMode || []) : [];
      file.auto = { add: autoMode.filter(rule => !autoRules.includes(rule)), remove: file.kind === 'computer' && file.block.autoMark ? autoRules.filter(rule => rule.startsWith(file.block.autoMark) && !autoMode.includes(rule)) : [] };
      if (file.main) for (const key of ['allow', 'ask']) file.missing[key] = file.block[key].filter(line => !have(key).includes(line));
      for (const key of ['allow', 'ask']) {
        for (const line of new Set(have(key))) {
          if (file.block && file.block[key].includes(line)) continue;
          if (file.main && oldToolkitLine(line, shipped)) { file.old[key].push(line); continue; }
          const gone = readPaths(line, { platform: this.#platform, home: this.#home }).find(found => !exists(found.real));
          const reason = gone ? null : riskyReason(line, rules);
          const cls = gone ? 'dead' : reason ? 'risky' : 'own';
          const keyText = `${key}\u0000${line}\u0000${file.writable ? 'w' : 'git'}`;
          if (!items.has(keyText)) items.set(keyText, { list: key, line, cls, reason, gone: gone ? base(gone.shown) : null, writable: file.writable, files: [] });
          items.get(keyText).files.push(index);
        }
      }
      if (file.main && (file.missing.allow.length + file.missing.ask.length + file.old.allow.length + file.old.ask.length + file.auto.add.length + file.auto.remove.length)) toolkit.push(index);
    }
    // Ids: class, then first file, then line text.
    const listed = [...items.values()].sort((a, b) => CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) || a.files[0] - b.files[0] || (a.line < b.line ? -1 : a.line > b.line ? 1 : a.list.localeCompare(b.list)));
    const counters = { risky: 0, dead: 0, own: 0 };
    for (const item of listed) { counters[item.cls] += 1; item.id = `${LETTER[item.cls]}${counters[item.cls]}`; }
    const missing = files.reduce((sum, file) => sum + file.missing.allow.length + file.missing.ask.length + file.auto.add.length, 0);
    const old = files.reduce((sum, file) => sum + file.old.allow.length + file.old.ask.length + file.auto.remove.length, 0);
    const governed = files.some(file => file.kind === 'repo' && file.block.governed !== false);
    return { managed: built.managed, home: this.#home, built, files, repoName, note, governed, repoRoot: commandRoot, items: listed, missing, old, counts: { ...counters, other: listed.length },
      unreadable: files.filter(file => file.unreadable).map(file => file.label) };
  }

  // The bytes of a file that is not valid settings, for the preview code only; null when unreadable.
  #rawText(file) {
    try { return this.#fs.readFileSync(file, 'utf8'); } catch { return null; }
  }
}

// ---- the --drop reader (default-deny) ---------------------------------------------------------------

// Reads the owner's picks: ids R1, D2, Y3 and ranges D1-D20 or D1-20, separated by commas or spaces,
// at most MAX_DROP ids. Anything else returns { ok: false, reason }. Plain ASCII only.
function readDrop(text, model = null) {
  const value = String(text == null ? '' : text);
  if (!value || value.length > 4000 || !/^[RDY0-9, -]+$/.test(value)) return { ok: false, reason: 'the picks hold something other than ids such as D1, R2 or D1-D20.' };
  const parts = value.split(/[, ]+/).filter(Boolean);
  if (!parts.length) return { ok: false, reason: 'no ids were named.' };
  const ids = [];
  for (const part of parts) {
    const match = /^([RDY])([1-9][0-9]{0,3})(?:-([RDY])?([1-9][0-9]{0,3}))?$/.exec(part);
    if (!match) return { ok: false, reason: `${part} is not an id or a range such as D1-D20.` };
    const [, letter, from, endLetter, to] = match;
    if (endLetter && endLetter !== letter) return { ok: false, reason: `${part} mixes two kinds of line.` };
    const first = Number(from);
    const last = to === undefined ? first : Number(to);
    if (last < first) return { ok: false, reason: `${part} runs backwards.` };
    if (ids.length + (last - first + 1) > MAX_DROP) return { ok: false, reason: `more than ${MAX_DROP} ids were named.` };
    for (let number = first; number <= last; number += 1) ids.push(`${letter}${number}`);
  }
  const unique = [...new Set(ids)];
  if (model) {
    const known = new Map(model.items.map(item => [item.id, item]));
    const unknown = unique.filter(id => !known.has(id));
    if (unknown.length) return { ok: false, reason: `${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ' and more' : ''} ${unknown.length === 1 ? 'is' : 'are'} not in the list.` };
    const fixed = unique.filter(id => !known.get(id).writable);
    if (fixed.length) return { ok: false, reason: `${fixed.join(', ')} ${fixed.length === 1 ? 'is' : 'are'} in the repository's shared settings file in Git, which changes only through a pull request.` };
  }
  return { ok: true, ids: unique };
}

// ---- preview code ---------------------------------------------------------------------------------

// 8 hex of a sha256 over the picked ids with their lines, every file in scope with its current bytes,
// and Toolkit's own changes. A file, a line or a pick that changed gives another code.
function previewCode(model, ids) {
  const picked = ids.map(id => model.items.find(item => item.id === id)).filter(Boolean)
    .map(item => [item.id, item.list, item.line]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const files = model.files.map(file => [file.target, file.sha]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const toolkit = model.files.map(file => [file.target, file.missing, file.old, file.auto]);
  return crypto.createHash('sha256').update(JSON.stringify({ picked, files, toolkit })).digest('hex').slice(0, 8);
}

// ---- renderers ------------------------------------------------------------------------------------

const DOTS = Object.freeze({ toolkit: '🔵', risky: '🔴', dead: '🟡', own: '🟢' });
const GROUP = Object.freeze({ risky: 'Risky', dead: 'Dead', own: 'Yours' });

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function whereOf(model, item) {
  const places = [...new Set(item.files.map(index => model.files[index].place))];
  return places.join(', ');
}

// The kind of program a command line starts, in plain words for the chat list.
const PROGRAMS = Object.freeze([
  [/^(?:python[0-9.]*|pythonw|py)$/i, 'Runs a Python script'],
  [/^(?:node|nodejs|bun|deno)$/i, 'Runs a JavaScript script'],
  [/^(?:npm|npx|pnpm|yarn)$/i, 'Runs an npm command'],
  [/^(?:bash|sh|zsh)$/i, 'Runs a shell script'],
  [/^(?:pwsh|powershell)$/i, 'Runs a PowerShell script'],
  [/^(?:cat|type|less|more|head|tail|get-content|gc)$/i, 'Reads a file'],
  [/^(?:ls|dir|get-childitem|gci)$/i, 'Lists files'],
  [/^(?:grep|rg|select-string|sls)$/i, 'Searches files'],
  [/^git$/i, 'Runs a Git command'],
  [/^gh$/i, 'Runs a GitHub command'],
  [/^(?:curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)$/i, 'Calls a web address'],
  [/^docker$/i, 'Runs a Docker command'],
]);

// A Bash or PowerShell line in plain words for the chat list: the kind of program it runs, never the
// command's own arguments, script names or paths (the raw line shows only on show all). A line that
// joins commands (&&, ||, ; or |, outside quotes) runs several, and a quoted program path, spaces
// included, is read whole, so its words are its base name and never a fragment of the path.
function shellWords(line) {
  const shell = SHELL.exec(mask(line));
  const body = shell[2].trim();
  const any = /\s*:?\*\s*$/.test(shell[2]);
  const suffix = shell[1] === 'PowerShell' ? ' (PowerShell)' : '';
  if (/&&|\|\||;|\|/.test(body.replace(/"[^"]*"|'[^']*'/g, ''))) return `Runs several commands${suffix}`;
  const rest = body.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '');
  const quoted = /^(["'])([^"']*)\1/.exec(rest);
  const program = base(quoted ? quoted[2] : rest.split(/\s+/)[0] || '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '');
  const named = PROGRAMS.find(([pattern]) => pattern.test(program));
  const text = !program || program === '*' ? 'Any command' : named ? named[1] : /^[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(program) ? `Runs the ${program} command` : 'Runs a command';
  return `${text}${any && program !== '*' ? ', any arguments' : ''}${suffix}`;
}

// One chat list item in plain words: no code marks and no command text (show all adds the raw line).
function itemWords(item) {
  const words = SHELL.test(item.line) ? shellWords(item.line) : chatWords(plainWords(item.line));
  // The Dead group's heading already says the line points at something gone.
  if (item.cls === 'dead') return words.replace(/, any arguments$/, '');
  const text = item.cls === 'risky' ? item.reason : words;
  return `${item.list === 'ask' ? 'Asks first: ' : ''}${text}`;
}

// Toolkit's own changes, in short: each added row once (its tools and ask lines together), and the
// old lines.
function toolkitSummary(model) {
  const adds = new Map();
  let old = 0;
  for (const file of model.files) {
    for (const line of [...file.missing.allow, ...file.missing.ask]) {
      const { key, words, tool } = toolkitWords(line);
      const id = `${key}\u0000${file.place}`;
      if (!adds.has(id)) adds.set(id, { words, tools: new Set(), place: file.place, ask: false });
      if (tool) adds.get(id).tools.add(tool);
      if (file.missing.ask.includes(line)) adds.get(id).ask = true;
    }
    if (file.auto && file.auto.add.length) adds.set(`\u0000auto\u0000${file.place}`, { words: AUTO_WORDS, tools: new Set(), place: file.place, ask: false });
    old += file.old.allow.length + file.old.ask.length + (file.auto ? file.auto.remove.length : 0);
  }
  return { adds: [...adds.values()], old };
}

// Toolkit's auto mode rule, in a few plain words for both screens.
const AUTO_WORDS = 'auto mode rule for merges Toolkit\'s merge hold lets through';

function toolkitStatus(model) {
  if (!model.missing && !model.old) return 'up to date';
  return [model.missing ? `${model.missing} missing` : '', model.old ? `${model.old} old` : ''].filter(Boolean).join(', ');
}

function applyCommand(model, extra = '') {
  const root = model.repoRoot || null;
  return `node "${model.managed}/repo/scripts/toolkit-permissions.cjs" --apply --host claude${root ? ` --repo-root "${root}"` : ''}${extra}`;
}

const fence = command => ['```powershell', command, '```'];

// The chat list (house format): one heading line with both counts, Toolkit's changes, then the
// Risky, Dead and Yours groups with one short plain line each, folded past FOLD_AT unless `all`; only
// the owner's command sits in a code block.
function chatList(model, { all = false } = {}) {
  const lines = [`**Toolkit permissions (Claude Code):** Toolkit lines ${toolkitStatus(model)} · Other lines ${model.counts.other ? `${model.counts.other} to review` : 'none'}`];
  if (model.note) lines.push('', model.repoName ? `${model.note.replace(/\.$/, '')}.` : `Only this computer's settings were read: ${model.note.replace(/\.$/, '')}.`);
  const summary = toolkitSummary(model);
  if (summary.adds.length || summary.old) {
    // The heading counts the bullets below it, with the lines they stand for in brackets.
    lines.push('', `${DOTS.toolkit} **Toolkit: ${[summary.adds.length ? `${summary.adds.length} to add (${plural(model.missing, 'line')})` : '', summary.old ? `1 to remove (${plural(summary.old, 'old line')})` : ''].filter(Boolean).join(', ')}**`);
    // A first install adds many: fold past FOLD_AT like the other groups.
    const adds = all || summary.adds.length <= FOLD_AT + 1 ? summary.adds : summary.adds.slice(0, FOLD_AT);
    for (const add of adds) lines.push(`- ${add.words}${add.tools.size > 1 ? ` (${[...add.tools].join(' and ')})` : ''}${add.ask ? ', with its ask line' : ''} · ${add.place}`);
    if (adds.length < summary.adds.length) {
      const rest = summary.adds.slice(adds.length);
      const places = [...new Set(rest.map(add => add.place))];
      lines.push(`- ${rest.length} more to add, ${places.join(', ')}. Say show all to list them.`);
    }
    if (summary.old) lines.push(`- ${plural(summary.old, 'old Toolkit line')} for a retired command or another Toolkit folder · ${[...new Set(model.files.filter(file => file.old.allow.length + file.old.ask.length + (file.auto ? file.auto.remove.length : 0)).map(file => file.place))].join(', ')}`);
  }
  for (const cls of CLASS_ORDER) {
    const group = model.items.filter(item => item.cls === cls);
    if (!group.length) continue;
    lines.push('', `${DOTS[cls]} **${GROUP[cls]} (${group.length})**`);
    const shown = all || group.length <= FOLD_AT + 1 ? group : group.slice(0, FOLD_AT);
    for (const item of shown) lines.push(`- **${item.id}** ${itemWords(item)} · ${whereOf(model, item)}${all ? `. Line: \`${mask(item.line)}\`` : ''}`);
    if (shown.length < group.length) {
      const rest = group.slice(shown.length);
      const places = [...new Set(rest.map(item => whereOf(model, item)))];
      lines.push(`- **${rest[0].id} to ${rest[rest.length - 1].id}:** ${rest.length} more${places.length === 1 ? `, all ${places[0]}` : ''}. Say show all to list them.`);
    }
  }
  if (model.items.some(item => !item.writable)) lines.push('', `Lines marked in Git sit in the repository's shared settings file; they change only through a pull request.`);
  if (model.unreadable && model.unreadable.length) lines.push('', `Not read, and never changed here (not valid settings files): ${model.unreadable.join(', ')}.`);
  if (model.counts.other) {
    const dead = model.items.filter(item => item.cls === 'dead' && item.writable);
    const example = dead.length > 1 ? `${dead[0].id}-${dead[dead.length - 1].id}` : (dead[0] || model.items.find(item => item.writable) || model.items[0]).id;
    lines.push('', `**Reply** keep all, or name what goes, such as remove ${example}. Nothing changes until you press Enter in your own terminal.`);
  }
  if (model.missing || model.old) lines.push('', `**To bring Toolkit's lines up to date and keep everything else**, run this in your own PowerShell. It shows the changes and waits for your Enter:`, '', ...fence(applyCommand(model)));
  else if (!model.counts.other) lines.push('', 'Nothing to change.');
  return lines.join('\n');
}

// Which files a set of picks touches, with how many picked lines each.
function picksByFile(model, items) {
  const counts = new Map();
  for (const item of items) for (const index of item.files) counts.set(index, (counts.get(index) || 0) + 1);
  return counts;
}

function placeSummary(model, counts) {
  const parts = [];
  const copies = [];
  for (const [index, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    const file = model.files[index];
    if (file.kind === 'copy') copies.push(count);
    else parts.push(`${file.place} (${count})`);
  }
  if (copies.length) parts.push(`${plural(copies.length, 'worktree copy', 'worktree copies')}${copies.every(count => count === copies[0]) ? ` (${copies[0]} each)` : ''}`);
  return parts.join(', ');
}

function idList(items) {
  const runs = [];
  for (const item of items) {
    const letter = item.id[0];
    const number = Number(item.id.slice(1));
    const last = runs[runs.length - 1];
    if (last && last.letter === letter && last.to === number - 1) last.to = number;
    else runs.push({ letter, from: number, to: number });
  }
  return runs.map(run => (run.from === run.to ? `${run.letter}${run.from}` : `${run.letter}${run.from} to ${run.letter}${run.to}`));
}

const joinWords = parts => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// The chat answer to the owner's picks: what goes, from where, what stays, and the one command
// carrying the picks and their preview code.
function picksText(model, ids) {
  const items = model.items.filter(item => ids.includes(item.id));
  const code = previewCode(model, ids);
  const drop = idList(items).map(part => part.replace(/ to /, '-').replace(/-([RDY])/, '-$1')).join(',');
  const kept = model.counts.other - items.length;
  const lines = ['**Toolkit permissions (Claude Code): your picks**', '',
    `- **Remove:** ${plural(items.length, 'line')}: ${joinWords(idList(items))}`,
    `- **From:** ${placeSummary(model, picksByFile(model, items))}`,
    `- **Keep:** ${kept ? `${plural(kept, 'other line')}, and every other setting` : 'every other setting'}`];
  if (model.missing) lines.push(`- **Add:** ${plural(model.missing, 'Toolkit line')}`);
  if (model.old) lines.push(`- **Old Toolkit lines:** ${model.old} removed`);
  lines.push('- **Backup:** one folder, made before anything changes', '',
    'Run this in your own PowerShell. It shows the same changes and waits for your Enter:', '',
    ...fence(applyCommand(model, ` --drop ${drop} --preview ${code}`)));
  return lines.join('\n');
}

// The owner's terminal screen: plain short lines, no Markdown. `plans` are the apply's per-file
// changes ({ file, add: { allow, ask }, remove: [{ id|null, list, line }] }).
// Toolkit lines for the owner's screen, one row per command with its tools together; a script with
// more than two commands shows as one row with its count, so a first install stays a few lines.
function toolkitRows(lines, verb, prefix = '') {
  const rows = new Map();
  for (const line of lines) {
    const { key, words, tool } = toolkitWords(line);
    if (!rows.has(key)) rows.set(key, { words, tools: [], script: nodeScript(line) ? base(nodeScript(line)) : null });
    if (tool && !rows.get(key).tools.includes(tool)) rows.get(key).tools.push(tool);
  }
  const perScript = new Map();
  for (const row of rows.values()) if (row.script) perScript.set(row.script, (perScript.get(row.script) || 0) + 1);
  const out = [];
  const done = new Set();
  for (const row of rows.values()) {
    if (row.script && perScript.get(row.script) > 2) {
      if (!done.has(row.script)) out.push(`  ${verb} ${prefix}${row.script} (${perScript.get(row.script)} commands)`);
      done.add(row.script);
    } else out.push(`  ${verb} ${prefix}${row.words}${row.tools.length > 1 ? ` (${row.tools.join(', ')})` : ''}`);
  }
  return out;
}

function terminalScreen(model, plans, { picked = [], codex = [], notes = [] } = {}) {
  const adds = plans.some(plan => plan.add.allow.length + plan.add.ask.length + (plan.add.autoMode || []).length);
  const title = !picked.length ? 'bring Toolkit\'s lines up to date' : adds ? 'add Toolkit\'s lines and remove the lines you picked' : 'remove the lines you picked';
  const lines = [`Toolkit permissions: ${title}`, ...notes, ''];
  const describeRemovals = removals => {
    const out = toolkitRows(removals.filter(entry => !entry.id && entry.list !== 'autoMode').map(entry => entry.line), 'remove ', 'old Toolkit line ');
    if (removals.some(entry => entry.list === 'autoMode')) out.push('  remove  old Toolkit auto mode rule');
    const pickedHere = removals.filter(entry => entry.id).map(entry => entry.item);
    const runs = [];
    for (const item of pickedHere) {
      const last = runs[runs.length - 1];
      if (last && last[0].cls === item.cls && Number(last[last.length - 1].id.slice(1)) === Number(item.id.slice(1)) - 1) last.push(item);
      else runs.push([item]);
    }
    for (const run of runs) {
      if (run.length >= 3) out.push(`  remove  ${run[0].id} to ${run[run.length - 1].id} (${run.length} ${GROUP[run[0].cls].toLowerCase()} lines)`.replace(/yours lines/, 'of your lines'));
      else for (const item of run) out.push(`  remove  ${item.id} ${shortRaw(item.line)}`);
    }
    return out;
  };
  const addLines = add => [...toolkitRows([...add.allow, ...add.ask], 'add    '), ...((add.autoMode || []).length ? [`  add     ${AUTO_WORDS}`] : [])];
  const order = entry => (entry.id ? CLASS_ORDER.indexOf(entry.item.cls) * 10000 + Number(entry.id.slice(1)) : -1);
  for (const plan of plans) plan.remove = [...plan.remove].sort((a, b) => order(a) - order(b));
  const changeKey = plan => JSON.stringify(plan.remove.map(entry => `${entry.list}\u0000${entry.line}`));
  const copies = plans.filter(plan => plan.file.kind === 'copy');
  const mainPlans = plans.filter(plan => plan.file.kind !== 'copy');
  for (const plan of mainPlans) {
    lines.push(`${plan.file.label}  ${shortPath(plan.file, model)}`, ...addLines(plan.add), ...describeRemovals(plan.remove));
  }
  const repoPlan = mainPlans.find(plan => plan.file.kind === 'repo');
  const groups = new Map();
  for (const plan of copies) {
    const key = changeKey(plan);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plan);
  }
  for (const group of groups.values()) {
    const same = repoPlan && changeKey(group[0]) === changeKey(repoPlan);
    lines.push(`${plural(group.length, 'worktree copy', 'worktree copies')} of ${model.repoName} settings`);
    if (same) lines.push(`  remove  the same ${plural(group[0].remove.length, 'line')} from ${group.length === 1 ? 'it' : 'each'}`);
    else lines.push(...describeRemovals(group[0].remove));
  }
  for (const entry of codex) lines.push(...entry.lines);
  const kept = model.counts.other - picked.length;
  const fileCount = plans.length + codex.filter(entry => entry.writes).length;
  lines.push('', `Keeping ${kept ? `${plural(kept, 'other line')} and ` : ''}every other setting.`, `Backup first: one folder for ${backupWords(fileCount)}.`);
  return { text: lines.join('\n'), effect: `back up and write ${plural(fileCount, 'file')}` };
}

const backupWords = count => (count === 1 ? 'the file' : count === 2 ? 'both files' : `all ${count} files`);

// A file path for the owner's screen: ~ for the home folder, the repository's own name for its files.
function shortPath(file, model) {
  const target = String(file.target).replace(/\\/g, '/');
  const home = String(model.home || '').replace(/\\/g, '/').replace(/\/$/, '');
  if (file.kind !== 'computer') return '.claude/settings.local.json';
  return home && target.toLowerCase().startsWith(`${home.toLowerCase()}/`) ? `~${target.slice(home.length)}` : target;
}

module.exports = Object.freeze({ PermissionReview, ReviewStop, RETIRED_SCRIPTS, MAX_DROP, shippedScripts, oldToolkitLine, nodeScript, readPaths, riskyRules, riskyReason, mask, shortRaw, plainWords, shellWords, readDrop, previewCode, chatList, picksText, terminalScreen, toolkitRows, backupWords, applyCommand, toolkitStatus, AUTO_WORDS });
