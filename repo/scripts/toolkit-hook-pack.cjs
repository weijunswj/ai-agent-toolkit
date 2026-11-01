#!/usr/bin/env node
'use strict';

// The hook test pack: one list of tool calls every hook change must keep deciding the same way, run
// the way the installed hosts start the hooks. Rows live in repo/tests/hook-pack/corpus/<family>.json
// (format: repo/tests/hook-pack/README.md). For each row the runner:
//   - builds the row's fixture (a plain folder, or a repository that is governed, undecided or has no
//     GitHub remote, with commits, extra working trees, staged files and a transcript) in its own temp
//     folder, with its own home, so no row reads the real user's state or another row's;
//   - reads the hooks.json of each host the row names from a temporary copy of the plugin, matches
//     the payload against the real matchers, expands ${CLAUDE_PLUGIN_ROOT} or ${PLUGIN_ROOT} to that
//     copy and starts every matching command as its own process through a shell, with the payload on
//     stdin. On Windows the Codex commands are the installed ones setup writes (the PowerShell
//     launcher with `; exit $LASTEXITCODE`), run as Codex runs them;
//   - reads the decision the host would act on (exit code, stdout JSON, and for Claude Code the
//     hook's onFailure setting) and checks it, and that no fixture file changed, against the row.
// A row with status `known-bad` records a bug its lane has not fixed yet: the runner expects it to
// still fail and reports it when it starts passing, so its lane flips it to `pass` in the fix.
//
// Usage:
//   node repo/scripts/toolkit-hook-pack.cjs run [--suite <kind>] [--family <name>] [--rows <id,...>]
//        [--host claude|codex] [--against <commit>] [--budget-seconds <n>] [--concurrency <n>]
//   node repo/scripts/toolkit-hook-pack.cjs check-expectations [--base <ref>] [--body-file <file>]
//   node repo/scripts/toolkit-hook-pack.cjs validate
// `--against <commit>` is the revert proof: it runs rows against the plugin as it was at that commit
// (by default the rows that commit's corpus does not have) and passes only when every one fails there.
// `check-expectations` compares the corpus with the base (DIFF_BASE in CI): a row removed, an
// `expect` changed or a row lowered from `pass` to `known-bad` needs a line naming the row under the
// pull request body's "Pack changes" heading (PR_BODY in CI).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CORPUS_REL = 'repo/tests/hook-pack/corpus';
const SCHEMA = 'toolkit-hook-pack/v1';
const HOSTS = Object.freeze(['claude', 'codex']);
const KINDS = Object.freeze(['benign', 'hostile', 'fault', 'update', 'state', 'parity']);
const EVENTS = Object.freeze(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart']);
const STATUSES = Object.freeze(['pass', 'known-bad']);
const FAULTS = Object.freeze(['deleted-plugin-root', 'remove-file', 'throw-module', 'stall-module', 'bad-json', 'empty-input']);
const GOVERNANCE = Object.freeze(['enabled', 'undecided', 'none']);
// App-local task answers in each fixture home; the stale variant ages only its governance binding.
const TASK_AUTO_MERGE = Object.freeze(['after-gates', 'after-gates-stale', 'off', 'codex-only', 'claude-code-only', 'unreadable']);
const ROW_KEYS = new Set(['id', 'source', 'kind', 'hosts', 'event', 'payload', 'fixture', 'fault', 'expect', 'expect_by_host', 'status', 'known_bad_on', 'lane', 'added', 'note', 'steps']);
const ID = /^[A-Z][A-Za-z0-9._-]*$/;
// The plugin content the hooks can reach: both host manifests, the scripts and contracts, and the
// skill scripts the hook modules load.
const PLUGIN_PATHS = Object.freeze(['.claude-plugin', '.codex-plugin', 'repo/scripts', 'repo/contracts', 'skills', 'package.json']);
const HOOKS_JSON = Object.freeze({ claude: '.claude-plugin/hooks/hooks.json', codex: '.codex-plugin/hooks/hooks.json' });
const ROOT_VARIABLE = Object.freeze({ claude: '${CLAUDE_PLUGIN_ROOT}', codex: '${PLUGIN_ROOT}' });
// Each hook keeps its own timeout (60 s when it names none), as the hosts do. A stall-module row
// waits at most 10 s, the shortest timeout a Toolkit hook names, so every hook that does not load
// the stalled module still finishes in its own time, and the host would stop the stalled one at its
// own timeout and decide the same.
const DEFAULT_TIMEOUT_SECONDS = 60;
const STALL_TIMEOUT_MS = 10000;
// The pack runs in its own CI job; a few rows at a time keeps each hook near its real speed.
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(6, Math.floor(os.availableParallelism() / 2)));
// Built from pieces at run time, so no credential-shaped text sits in the repository.
const fakeCredential = () => ['gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0'].join('');

class UsageError extends Error {}

// ---- Corpus ----

function corpusDir(root = ROOT) { return path.join(root, ...CORPUS_REL.split('/')); }

function parseCorpusFile(text, name) {
  let data;
  try { data = JSON.parse(text); } catch (error) { return { errors: [`${name}: not JSON (${error.message})`], rows: [] }; }
  const errors = [];
  if (!data || data.schema !== SCHEMA) errors.push(`${name}: schema must be ${SCHEMA}`);
  const family = path.basename(name, '.json');
  if (data?.family !== family) errors.push(`${name}: family must be "${family}" (the file name)`);
  if (!Array.isArray(data?.rows)) return { errors: [...errors, `${name}: rows must be a list`], rows: [] };
  data.rows.forEach((row, index) => errors.push(...rowErrors(row).map(error => `${name} row ${row?.id || index}: ${error}`)));
  return { errors, rows: data.rows.map(row => ({ ...row, family })) };
}

function rowErrors(row) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['must be an object'];
  for (const key of Object.keys(row)) if (!ROW_KEYS.has(key)) errors.push(`unknown key ${key}`);
  if (typeof row.id !== 'string' || !ID.test(row.id)) errors.push('id must start with a capital letter and use letters, digits, dot, dash or underscore');
  if (typeof row.source !== 'string' || !row.source.trim()) errors.push('source must say where the row came from');
  if (!KINDS.includes(row.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  if (!Array.isArray(row.hosts) || !row.hosts.length || row.hosts.some(host => !HOSTS.includes(host)) || new Set(row.hosts).size !== row.hosts.length) errors.push('hosts must list claude, codex or both');
  if (row.event !== undefined && !EVENTS.includes(row.event)) errors.push(`event must be one of ${EVENTS.join(', ')}`);
  if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) errors.push('payload must be the tool call object the host sends');
  errors.push(...expectErrors(row.expect, 'expect'));
  if (row.expect_by_host !== undefined) {
    if (!row.expect_by_host || typeof row.expect_by_host !== 'object') errors.push('expect_by_host must be an object');
    else for (const [host, expect] of Object.entries(row.expect_by_host)) {
      if (!row.hosts?.includes(host)) errors.push(`expect_by_host names ${host}, which the row does not run on`);
      errors.push(...expectErrors(expect, `expect_by_host.${host}`));
    }
    if (typeof row.note !== 'string' || !row.note.trim()) errors.push('a row whose hosts decide differently needs a note saying why');
  }
  if (!STATUSES.includes(row.status)) errors.push(`status must be ${STATUSES.join(' or ')}`);
  if (row.status === 'known-bad') {
    if (typeof row.lane !== 'string' || !row.lane.trim()) errors.push('a known-bad row names the lane that fixes it');
    if (typeof row.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.added)) errors.push('a known-bad row gives the date it was added (YYYY-MM-DD)');
    if (row.known_bad_on !== undefined && (!Array.isArray(row.known_bad_on) || !row.known_bad_on.length || row.known_bad_on.some(host => !row.hosts?.includes(host)))) errors.push('known_bad_on lists some of the row\'s hosts');
  } else if (row.known_bad_on !== undefined || row.lane !== undefined || row.added !== undefined) errors.push('only a known-bad row has known_bad_on, lane or added');
  if (row.fault !== undefined) {
    if (!FAULTS.includes(row.fault?.type)) errors.push(`fault.type must be one of ${FAULTS.join(', ')}`);
    else if (['remove-file', 'throw-module', 'stall-module'].includes(row.fault.type) && (typeof row.fault.file !== 'string' || !/^repo\/scripts\/[A-Za-z0-9._-]+$/.test(row.fault.file))) errors.push('this fault names a file under repo/scripts');
  }
  errors.push(...fixtureErrors(row.fixture));
  if (row.steps !== undefined) {
    if (!Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 24) errors.push('steps must list 1 to 24 preceding hook events');
    else row.steps.forEach((step, index) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) { errors.push(`step ${index + 1} must be an object`); return; }
      for (const key of Object.keys(step)) if (!['event', 'payload', 'expect', 'expect_by_host', 'note', 'add_github_origin'].includes(key)) errors.push(`step ${index + 1} has unknown key ${key}`);
      if (step.add_github_origin !== undefined && (step.add_github_origin !== true || row.fixture?.repo?.governance !== 'none')) errors.push(`step ${index + 1} add_github_origin requires true and a local-only fixture repository`);
      const candidate = { id: row.id, source: row.source, hosts: row.hosts, kind: row.kind, status: 'pass',
        event: step.event, payload: step.payload, expect: step.expect, expect_by_host: step.expect_by_host, note: step.note };
      errors.push(...rowErrors(candidate).map(error => `step ${index + 1}: ${error}`));
    });
  }
  return errors;
}

function expectErrors(expect, label) {
  if (!expect || typeof expect !== 'object') return [`${label} must be an object`];
  const errors = [];
  if (!['allow', 'deny'].includes(expect.decision)) errors.push(`${label}.decision must be allow or deny`);
  if (expect.reason !== undefined && (typeof expect.reason !== 'string' || !/^[a-z0-9.-]+(?::failure)?$/.test(expect.reason))) errors.push(`${label}.reason is a hook name (the script file name without .cjs), with :failure when the host blocked because the hook itself failed`);
  for (const key of Object.keys(expect)) if (!['decision', 'reason'].includes(key)) errors.push(`${label} has unknown key ${key}`);
  return errors;
}

function fixtureErrors(fixture) {
  if (fixture === undefined) return [];
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) return ['fixture must be an object'];
  const errors = [];
  for (const key of Object.keys(fixture)) if (!['repo', 'transcript', 'files', 'owner_session'].includes(key)) errors.push(`fixture has unknown key ${key}`);
  if (fixture.owner_session !== undefined && fixture.owner_session !== true) errors.push('fixture.owner_session is true or left out');
  const repo = fixture.repo;
  if (repo !== undefined) {
    if (!repo || typeof repo !== 'object') errors.push('fixture.repo must be an object');
    else {
      for (const key of Object.keys(repo)) if (!['governance', 'name', 'commits', 'worktrees', 'staged', 'branch', 'task_auto_merge'].includes(key)) errors.push(`fixture.repo has unknown key ${key}`);
      if (repo.task_auto_merge !== undefined && (repo.governance !== 'enabled' || !TASK_AUTO_MERGE.includes(repo.task_auto_merge))) errors.push(`fixture.repo.task_auto_merge needs governance enabled and is one of ${TASK_AUTO_MERGE.join(', ')}`);
      if (!GOVERNANCE.includes(repo.governance)) errors.push(`fixture.repo.governance must be one of ${GOVERNANCE.join(', ')}`);
      if (repo.name !== undefined && !/^[A-Za-z0-9._-]+$/.test(repo.name)) errors.push('fixture.repo.name must be a plain repository name');
      if (repo.commits !== undefined && (!Array.isArray(repo.commits) || repo.commits.some(commit => !commit || typeof commit.files !== 'object'))) errors.push('fixture.repo.commits lists { files, message } objects');
      if (repo.worktrees !== undefined && (!Array.isArray(repo.worktrees) || repo.worktrees.some(name => !/^[a-z0-9-]+$/.test(name)))) errors.push('fixture.repo.worktrees lists branch names');
    }
  }
  if (fixture.transcript !== undefined && !Array.isArray(fixture.transcript)) errors.push('fixture.transcript lists transcript entries');
  if (fixture.files !== undefined && (typeof fixture.files !== 'object' || Array.isArray(fixture.files))) errors.push('fixture.files maps paths in the working folder to their text');
  return errors;
}

// Every corpus file of a root (or of a commit), with the problems found and the rows.
function loadCorpus({ root = ROOT, readFiles } = {}) {
  const files = readFiles ? readFiles() : fs.readdirSync(corpusDir(root)).filter(name => name.endsWith('.json')).sort()
    .map(name => ({ name, text: fs.readFileSync(path.join(corpusDir(root), name), 'utf8') }));
  const errors = [], rows = [];
  for (const file of files) {
    const parsed = parseCorpusFile(file.text, file.name);
    errors.push(...parsed.errors); rows.push(...parsed.rows);
  }
  const seen = new Set();
  for (const row of rows) { if (seen.has(row.id)) errors.push(`row id ${row.id} is used twice`); seen.add(row.id); }
  return { errors, rows };
}

// The corpus as it was at a commit (no rows when the commit has no pack yet).
function corpusAt(commit, root = ROOT) {
  const list = spawnSync('git', ['-C', root, 'ls-tree', '--name-only', `${commit}:${CORPUS_REL}`], { encoding: 'utf8', windowsHide: true });
  if (list.status !== 0) {
    const exists = spawnSync('git', ['-C', root, 'cat-file', '-e', `${commit}^{commit}`], { windowsHide: true });
    if (exists.status !== 0) throw new UsageError(`${commit} is not a commit in this repository.`);
    return { errors: [], rows: [] };
  }
  const names = list.stdout.split('\n').filter(name => name.endsWith('.json'));
  return loadCorpus({ readFiles: () => names.map(name => ({ name, text: git(root, ['show', `${commit}:${CORPUS_REL}/${name}`]) })) });
}

// ---- Hook selection ----

// Claude Code and Codex read a matcher the same way: none, empty or "*" matches every call; a plain
// list of names (letters, digits, underscore and |) matches those names exactly; anything else is a
// regular expression tested against the tool name.
function matches(matcher, value) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) return matcher.split('|').includes(value);
  return new RegExp(matcher).test(value);
}

// The hooks a host starts for one call: [{ command, timeout, onFailure }] in file order.
function selectHooks(hooksFile, event, toolName) {
  const groups = hooksFile?.hooks?.[event] || [];
  const target = ['PreToolUse', 'PostToolUse', 'SessionStart'].includes(event) ? toolName : undefined;
  return groups.filter(group => target === undefined || matches(group.matcher, target))
    .flatMap(group => (group.hooks || []).filter(hook => hook.type === 'command'));
}

// The command text the host runs for a hook, with the plugin root written in.
function hostCommand(host, hook, pluginRoot, platform = process.platform) {
  const text = host === 'codex' && platform === 'win32' && hook.commandWindows ? hook.commandWindows : hook.command;
  const rootText = platform === 'win32' ? pluginRoot.replace(/\\/g, '/') : pluginRoot;
  return text.split(ROOT_VARIABLE[host]).join(rootText);
}

// The hooks.json a host reads from a plugin copy. Codex on Windows reads the installed copy setup
// writes, with the PowerShell launcher as each Toolkit hook's commandWindows.
function hostHooks(host, pluginRoot, platform = process.platform) {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, ...HOOKS_JSON[host].split('/')), 'utf8').replace(/^\uFEFF/, ''));
  if (host !== 'codex' || platform !== 'win32') return hooks;
  const setup = require(path.join(pluginRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'));
  return setup.renderInstalledWindowsHooks(hooks, setup.defaultWindowsPowerShellPath());
}

// How a host starts a hook command: Codex on Windows through PowerShell -Command (its session shell),
// Claude Code on Windows through Git Bash, both through sh elsewhere.
function shellFor(host, platform = process.platform) {
  if (platform !== 'win32') return { file: '/bin/sh', args: command => ['-c', command] };
  if (host === 'codex') {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
    return { file: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: command => ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
  return { file: gitBash(), args: command => ['-c', command] };
}

let gitBashPath;
function gitBash() {
  if (gitBashPath) return gitBashPath;
  const found = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
  // <Git>/mingw64/libexec/git-core -> <Git>/bin/bash.exe
  const candidate = found.status === 0 ? path.resolve(found.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe') : '';
  if (!candidate || !fs.existsSync(candidate)) throw new Error('The hook pack needs Git Bash on Windows to start Claude Code hooks the way Claude Code does.');
  gitBashPath = candidate;
  return candidate;
}

// The decision a host acts on from one hook process: { decision, reason } where reason names the
// hook (and `:failure` when the host blocked because the hook itself failed).
function hookDecision(host, hook, result) {
  const name = scriptName(hook.command);
  let output = null;
  if (result.status === 0 && result.stdout.trim()) { try { output = JSON.parse(result.stdout); } catch { output = null; } }
  const denied = output && (output.hookSpecificOutput?.permissionDecision === 'deny' || output.decision === 'block' || output.continue === false);
  if (result.status === 2 || denied) return { decision: 'deny', reason: name, text: (output?.hookSpecificOutput?.permissionDecisionReason || output?.reason || result.stderr || '').trim() };
  if (result.status === 0) return { decision: 'allow' };
  // Any other exit, or a stop at the timeout: Claude Code blocks only where the hook says
  // onFailure: block; Codex blocks only on exit 2.
  if (host === 'claude' && hook.onFailure === 'block') return { decision: 'deny', reason: `${name}:failure` };
  return { decision: 'allow', failed: `${name} (${result.status === null ? 'stopped at its timeout' : `exit ${result.status}`})`, text: result.stderr.trim() };
}

function scriptName(command) {
  const match = /([A-Za-z0-9._-]+)\.(?:cjs|ps1)"/.exec(command || '');
  return match ? match[1] : 'hook';
}

// ---- Plugin copies ----

class PluginRoots {
  #base; #dir; #faulted = new Map();
  constructor(dir, { against } = {}) {
    this.#dir = dir;
    this.#base = path.join(dir, 'plugin');
    if (against) checkoutAt(against, this.#base); else copyCurrent(this.#base);
    // Setup records the Node it found for the Windows PowerShell launchers; the installed copy has it.
    fs.writeFileSync(path.join(this.#base, '.codex-plugin', 'session-start-runtime.json'), `${JSON.stringify({ schema: 1, node_path: process.execPath }, null, 2)}\n`);
  }
  get base() { return this.#base; }
  // A plugin copy with one fault applied, built once per fault and shared by its rows.
  forFault(fault) {
    if (!fault) return this.#base;
    if (fault.type === 'deleted-plugin-root') return path.join(this.#dir, 'deleted-version');
    if (!['remove-file', 'throw-module', 'stall-module'].includes(fault.type)) return this.#base;
    const key = `${fault.type}:${fault.file}`;
    if (this.#faulted.has(key)) return this.#faulted.get(key);
    const copy = path.join(this.#dir, `fault-${this.#faulted.size + 1}`);
    fs.cpSync(this.#base, copy, { recursive: true });
    const file = path.join(copy, ...fault.file.split('/'));
    if (fault.type === 'remove-file') fs.rmSync(file, { force: true });
    else if (fault.type === 'throw-module') fs.writeFileSync(file, "'use strict';\nthrow new Error('hook pack fault: this module throws when loaded');\n");
    else fs.writeFileSync(file, "'use strict';\nfor (;;) { /* hook pack fault: this module never finishes loading */ }\n");
    this.#faulted.set(key, copy);
    return copy;
  }
}

function copyCurrent(dest) {
  for (const rel of PLUGIN_PATHS) {
    const from = path.join(ROOT, ...rel.split('/'));
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, ...rel.split('/')), { recursive: true, filter: source => path.basename(source) !== 'node_modules' });
  }
}

// The plugin files as they were at a commit, through a temporary index so the checkout's own index
// and working tree are never touched.
function checkoutAt(commit, dest) {
  const index = path.join(path.dirname(dest), 'against.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const read = spawnSync('git', ['-C', ROOT, 'read-tree', commit], { env, encoding: 'utf8', windowsHide: true });
  if (read.status !== 0) throw new UsageError(`Could not read ${commit}: ${read.stderr.trim()}`);
  const files = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--', ...PLUGIN_PATHS], { env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout;
  const prefix = dest.replace(/\\/g, '/') + '/';
  const out = spawnSync('git', ['-C', ROOT, 'checkout-index', `--prefix=${prefix}`, '-z', '--stdin'], { env, input: files, encoding: 'utf8', windowsHide: true });
  if (out.status !== 0) throw new Error(`Could not write the plugin files of ${commit}: ${out.stderr.trim()}`);
}

// ---- Fixtures ----

function git(cwd, args, options = {}) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}

class Fixture {
  constructor(dir, spec = {}) {
    this.dir = dir;
    this.home = path.join(dir, 'home');
    this.work = path.join(dir, 'work');
    this.trees = path.join(dir, 'trees');
    this.transcript = path.join(this.home, '.claude', 'projects', 'hook-pack', '11111111-1111-4111-8111-111111111111.jsonl');
    for (const folder of [this.home, this.work, path.dirname(this.transcript)]) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(this.home, '.gitconfig'), '[user]\n\tname = Fixture Author\n\temail = fixture@example.test\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\tfsmonitor = false\n');
    this.env = hookEnvironment(this.home);
    if (spec.repo) this.#repo(spec.repo);
    if (spec.owner_session) this.#ownerSession();
    this.#files(this.work, spec.files || {});
    if (spec.transcript) fs.writeFileSync(this.transcript, spec.transcript.map(entry => JSON.stringify(this.expand(entry))).join('\n') + '\n');
  }

  #git(cwd, args) { return git(cwd, args, { env: this.env }); }

  // The one bounded fixture transition needed to test a local repository gaining a GitHub remote.
  // It always targets this disposable work folder and a reserved fixture identity, never a URL
  // supplied by a row or a live service. Hooks still may not mutate any fixture file themselves.
  addGitHubOrigin() { this.#git(this.work, ['remote', 'add', 'origin', 'https://github.com/toolkit-test-fixture/remote-added.git']); }
  resetOrigin() { this.#git(this.work, ['remote', 'remove', 'origin']); }

  #files(folder, files) {
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(folder, ...name.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, this.expand(text));
    }
  }

  #repo(spec) {
    const name = spec.name || 'fixture';
    if (spec.governance === 'enabled') {
      const support = require(path.join(ROOT, 'repo', 'tests', 'toolkit-governed-fixture-support.cjs'));
      support.makeGoverned(this.work, `hook-pack-${name}`, { home: this.home });
      if (spec.task_auto_merge) this.#taskAutoMerge(`toolkit-test-fixture/hook-pack-${name}`, spec.task_auto_merge, support);
    } else {
      this.#git(this.work, ['init', '--quiet']);
      if (spec.governance === 'undecided') this.#git(this.work, ['remote', 'add', 'origin', `https://github.com/toolkit-test-fixture/${name}.git`]);
    }
    this.#git(this.work, ['checkout', '--quiet', '-B', spec.branch || 'main']);
    const commits = spec.commits || [{ files: { 'README.md': 'fixture\n' }, message: 'base' }];
    for (const commit of commits) {
      this.#files(this.work, commit.files);
      this.#git(this.work, ['add', '-A']);
      this.#git(this.work, ['commit', '--quiet', '--allow-empty', '-m', commit.message || 'fixture commit']);
      // Under task auto-merge, the first commit is this folder's copy of the remote's default
      // branch, so the merge hold's scope check reads the later commits as the pull request.
      if (spec.task_auto_merge && commit === commits[0]) this.#git(this.work, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    }
    this.head = this.#git(this.work, ['rev-parse', 'HEAD']).trim();
    for (const branch of spec.worktrees || []) this.#git(this.work, ['worktree', 'add', '--quiet', '-b', branch, path.join(this.trees, branch)]);
    if (spec.staged) { this.#files(this.work, spec.staged); this.#git(this.work, ['add', '-A']); }
  }

  // A fresh enabled binding plus separate app-local answers in this fixture's home.
  #taskAutoMerge(slug, answer, support) {
    const text = `${JSON.stringify({
      schema: 'toolkit.programme-binding.v2', repository: slug, governance: 'enabled',
      parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
      store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
      required_checks: ['validate'],
    }, null, 2)}
`;
    fs.writeFileSync(path.join(this.work, '.github', 'toolkit-programme.json'), text);
    const { TaskAutoMergePreferences } = require('./toolkit-task-auto-merge-preferences.cjs');
    for (const host of ['codex', 'claude-code']) {
      if (answer.endsWith('-only') && answer !== `${host}-only`) continue;
      if (answer === 'unreadable') {
        fs.writeFileSync(path.join(this.home, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${host}.v1.json`), 'malformed');
        continue;
      }
      const owner = new TaskAutoMergePreferences({ home: this.home, host });
      owner.apply(answer === 'off' ? 'off' : 'after-gates', owner.inspect());
    }
    // A stale read is one over a day old, as when this computer has not reached GitHub since.
    support.recordMerged(this.work, { home: this.home, text, ...(answer === 'after-gates-stale' ? { now: new Date(Date.now() - 25 * 60 * 60 * 1000) } : {}) });
  }

  // The session-start mark of a session the user opened (not resumed, not launched by another).
  #ownerSession() {
    const registryPath = path.join(this.home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
    require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-gate.cjs')).startSession({ session_id: 'hook-pack', source: 'startup', cwd: this.work }, { registryOptions: { registryPath, testOnly: true } });
  }

  // Writes the fixture's paths into a payload or transcript value.
  expand(value) {
    if (typeof value === 'string') {
      return value.replaceAll('{work}', this.work).replaceAll('{home}', this.home).replaceAll('{dir}', this.dir)
        .replaceAll('{trees}', this.trees).replaceAll('{transcript}', this.transcript).replaceAll('{credential}', fakeCredential())
        .replaceAll('{head}', this.head || '').replaceAll('{now}', new Date().toISOString());
    }
    if (Array.isArray(value)) return value.map(item => this.expand(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.expand(item)]));
    return value;
  }

  // Every file and folder the hooks could change, with its hash. The index and lock files git
  // rewrites when it only reads are left out.
  snapshot() {
    const result = {};
    for (const top of [this.work, this.trees]) {
      if (!fs.existsSync(top)) continue;
      const walk = folder => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const file = path.join(folder, entry.name), name = path.relative(this.dir, file).replace(/\\/g, '/');
          if (/(^|\/)\.git\/(?:index|.*\.lock)$/.test(name) || /\/\.git\/worktrees\/[^/]+\/index$/.test(name)) continue;
          if (entry.isDirectory()) { result[name] = 'directory'; walk(file); } else result[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        }
      };
      walk(top);
    }
    return result;
  }
}

// The hook processes' environment: this process's, without host, Toolkit, git or CI settings that
// would change what a hook decides, with the fixture's home and git identity.
function hookEnvironment(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:TOOLKIT_|CLAUDE|CODEX|ANTHROPIC|OPENAI|GIT_|GH_|GITHUB_|CI$|RUNNER_|NODE_OPTIONS$)/i.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_TERMINAL_PROMPT: '0',
  };
}

// ---- Running ----

function startProcess({ file, args, input, env, cwd, timeout }) {
  return new Promise(resolve => {
    let child;
    // Elsewhere than Windows the shell gets its own process group, so stopping it stops the hook too.
    try { child = spawn(file, args, { env, cwd, windowsHide: true, detached: process.platform !== 'win32' }); } catch (error) { resolve({ status: -1, stdout: '', stderr: String(error.message) }); return; }
    let stdout = '', stderr = '', stopped = false;
    const timer = setTimeout(() => { stopped = true; stopTree(child); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { stderr += String(error && error.message); });
    child.on('close', code => { clearTimeout(timer); resolve({ status: stopped ? null : code, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// A shell's children outlive it when only the shell is stopped, so stop the whole tree.
function stopTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

// One row on each of its hosts, one fixture between them: [{ host, observed }], where observed is
// { decision, reason, problems[] }. The fixture's home is put back as it was built before each host,
// so what one host's hooks record there never reaches the other's.
async function runRow(row, hosts, { roots, scratch }) {
  const fixture = new Fixture(fs.mkdtempSync(path.join(scratch, `${row.id}-`)), row.fixture);
  const pristine = path.join(fixture.dir, 'home-as-built');
  fs.cpSync(fixture.home, pristine, { recursive: true });
  const results = [];
  try {
    for (const [index, host] of hosts.entries()) {
      if (index) {
        fs.rmSync(fixture.home, { recursive: true, force: true }); fs.cpSync(pristine, fixture.home, { recursive: true });
        if (row.steps?.some(step => step.add_github_origin)) fixture.resetOrigin();
      }
      let observed;
      try { observed = await runOnHost(row, host, fixture, roots); } catch (error) { observed = { decision: 'error', problems: [`the runner failed: ${error.message}`], failed: [] }; }
      results.push({ host, observed });
    }
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
  return results;
}

async function runOnHost(row, host, fixture, roots) {
  // Every event uses the real host matcher and process, sharing only this row's isolated home.
  // A mismatch in an earlier step fails the row, even if the final merge happens to be refused.
  for (const [index, step] of (row.steps || []).entries()) {
    if (step.add_github_origin) fixture.addGitHubOrigin();
    const observed = await runOnHost({ ...row, steps: undefined, expect_by_host: undefined, ...step }, host, fixture, roots);
    if (!meets(step, host, observed)) return { ...observed, problems: [...observed.problems, `sequence step ${index + 1} did not meet its expectation`] };
  }
  const pluginRoot = roots.forFault(row.fault);
  const event = row.event || 'PreToolUse';
  const payload = { session_id: 'hook-pack', transcript_path: fixture.transcript, cwd: fixture.work, hook_event_name: event, ...fixture.expand(row.payload) };
  const input = row.fault?.type === 'bad-json' ? '{broken' : row.fault?.type === 'empty-input' ? '{}' : JSON.stringify(payload);
  const hooks = selectHooks(hostHooks(host, roots.base), event, event === 'SessionStart' ? payload.source : payload.tool_name);
  const shell = shellFor(host);
  const env = { ...fixture.env, ...(host === 'claude' ? { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: fixture.work } : { PLUGIN_ROOT: pluginRoot }) };
  const before = fixture.snapshot();
  const decisions = [];
  for (const hook of hooks) {
    const own = (hook.timeout || DEFAULT_TIMEOUT_SECONDS) * 1000;
    const timeout = row.fault?.type === 'stall-module' ? Math.min(own, STALL_TIMEOUT_MS) : own;
    const result = await startProcess({ file: shell.file, args: shell.args(hostCommand(host, hook, pluginRoot)), input, env, cwd: fixture.work, timeout });
    decisions.push(hookDecision(host, hook, result));
  }
  const problems = [];
  if (JSON.stringify(fixture.snapshot()) !== JSON.stringify(before)) problems.push('a fixture file changed');
  if (!hooks.length) problems.push(`no ${host} hook matches this call`);
  const deny = decisions.find(entry => entry.decision === 'deny');
  return { decision: deny ? 'deny' : 'allow', reason: deny?.reason, text: deny ? deny.text : decisions.find(entry => entry.failed)?.text, failed: decisions.filter(entry => entry.failed).map(entry => entry.failed), problems };
}

// The hosts a row is known to fail on (none for a passing row).
function knownBadHosts(row) {
  return row.status === 'known-bad' ? (row.known_bad_on || row.hosts) : [];
}

// Whether an observed result meets a row's expectation on a host.
function meets(row, host, observed) {
  const expect = row.expect_by_host?.[host] || row.expect;
  if (observed.problems.length) return false;
  if (observed.decision !== expect.decision) return false;
  // A refusal only because a hook itself failed (onFailure: block) proves nothing about what the
  // hooks decide, so it meets a row only when the row names it.
  if (expect.reason === undefined) return !observed.reason?.endsWith(':failure');
  return expect.reason === observed.reason;
}

function failureKind(row, host, observed) {
  const expect = row.expect_by_host?.[host] || row.expect;
  if (observed.problems.length) return observed.problems.join('; ');
  if (expect.decision === 'allow' && observed.decision === 'deny') return `false block (refused by ${observed.reason})`;
  if (expect.decision === 'deny' && observed.decision === 'allow') return `leak (allowed${observed.failed.length ? `; ${observed.failed.join(', ')} failed and the host ran the call` : ''})`;
  if (expect.reason === undefined) return `refused only because ${observed.reason.replace(/:failure$/, '')} itself failed; a row that expects that names the reason`;
  return `refused by ${observed.reason}, expected ${expect.reason}`;
}

async function pool(items, concurrency, work) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await work(items[index]); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function selectRows(rows, options) {
  let selected = rows;
  if (options.rows) {
    const wanted = new Set(options.rows);
    for (const id of wanted) if (!rows.some(row => row.id === id)) throw new UsageError(`No row ${id} in the pack.`);
    selected = selected.filter(row => wanted.has(row.id));
  }
  if (options.suite) selected = selected.filter(row => row.kind === options.suite);
  if (options.family) selected = selected.filter(row => row.family === options.family);
  return selected;
}

async function run(options, out = process.stdout) {
  const started = Date.now();
  const corpus = loadCorpus();
  if (corpus.errors.length) { out.write(`Hook pack corpus problems:\n${corpus.errors.map(error => `  ${error}`).join('\n')}\n`); return 1; }
  let rows = selectRows(corpus.rows, options);
  if (options.against && !options.rows) {
    const old = new Set(corpusAt(options.against).rows.map(row => row.id));
    rows = rows.filter(row => !old.has(row.id));
  }
  if (!rows.length) { out.write('No hook pack rows were selected, so nothing was proved.\n'); return 1; }
  const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-pack-')));
  try {
    const roots = new PluginRoots(scratch, { against: options.against });
    // Past its budget the run names the rows still running, so a stalled row shows in the log.
    const running = new Set();
    const watchdog = options.budgetSeconds ? setTimeout(() => out.write(`Still running after ${options.budgetSeconds} s: ${[...running].join(', ')}\n`), options.budgetSeconds * 1000) : null;
    watchdog?.unref();
    const perRow = await pool(rows, options.concurrency || DEFAULT_CONCURRENCY, async row => {
      const hosts = row.hosts.filter(host => !options.host || host === options.host);
      let outcomes;
      running.add(row.id);
      try { outcomes = await runRow(row, hosts, { roots, scratch }); } catch (error) { outcomes = hosts.map(host => ({ host, observed: { decision: 'error', problems: [`the runner failed: ${error.message}`], failed: [] } })); }
      running.delete(row.id);
      return outcomes.map(({ host, observed }) => ({ row, host, observed, met: meets(row, host, observed) }));
    });
    if (watchdog) clearTimeout(watchdog);
    const results = perRow.flat();
    const seconds = (Date.now() - started) / 1000;
    return options.against ? revertReport(results, options.against, seconds, out) : scoreboard(results, seconds, options, out);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function scoreboard(results, seconds, { budgetSeconds, verbose }, out) {
  const families = new Map();
  const lines = [];
  let bad = 0;
  for (const { row, host, observed, met } of results) {
    const entry = families.get(row.family) || { cases: 0, pass: 0, knownBad: 0, falseBlocks: 0, leaks: 0, other: 0 };
    families.set(row.family, entry);
    entry.cases += 1;
    const knownBad = knownBadHosts(row).includes(host);
    if (!knownBad && met) entry.pass += 1;
    else if (knownBad && !met) entry.knownBad += 1;
    else if (knownBad) { bad += 1; entry.other += 1; lines.push(`NOW PASSES ${row.id} on ${host}: mark it passing there (lane: ${row.lane})`); }
    else {
      bad += 1;
      const kind = failureKind(row, host, observed);
      if (kind.startsWith('false block')) entry.falseBlocks += 1; else if (kind.startsWith('leak')) entry.leaks += 1; else entry.other += 1;
      lines.push(`FAIL ${row.id} on ${host}: ${kind}`);
      if (verbose && observed.text) lines.push(`  refusal: ${observed.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  out.write('family          cases  pass  known-bad  false-blocks  leaks  other\n');
  for (const [name, entry] of [...families].sort()) {
    out.write(`${name.padEnd(15)} ${String(entry.cases).padStart(5)} ${String(entry.pass).padStart(5)} ${String(entry.knownBad).padStart(10)} ${String(entry.falseBlocks).padStart(13)} ${String(entry.leaks).padStart(6)} ${String(entry.other).padStart(6)}\n`);
  }
  for (const line of lines) out.write(`${line}\n`);
  out.write(`${results.length} case(s) in ${seconds.toFixed(1)} s on ${process.platform}.\n`);
  if (budgetSeconds && seconds > budgetSeconds) { out.write(`The pack took longer than its ${budgetSeconds} s budget.\n`); bad += 1; }
  return bad ? 1 : 0;
}

function revertReport(results, against, seconds, out) {
  let bad = 0;
  for (const { row, host, observed, met } of results) {
    if (met) { bad += 1; out.write(`NOT PROVED ${row.id} on ${host}: it already passes at ${against}, so it does not show the fix\n`); }
    else out.write(`proved ${row.id} on ${host}: fails at ${against} (${failureKind(row, host, observed)})\n`);
  }
  out.write(`${results.length} case(s) against ${against} in ${seconds.toFixed(1)} s.\n`);
  return bad ? 1 : 0;
}

// ---- Expectation changes ----

// Rows whose meaning changed from base to head: removed, expect changed, or lowered to known-bad.
function expectationChanges(baseRows, headRows) {
  const head = new Map(headRows.map(row => [row.id, row]));
  const changes = [];
  for (const before of baseRows) {
    const after = head.get(before.id);
    if (!after) changes.push({ id: before.id, change: 'removed' });
    else if (knownBadHosts(after).some(host => !knownBadHosts(before).includes(host))) changes.push({ id: before.id, change: 'lowered to known-bad on a host where it passed' });
    else {
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !BOOKKEEPING.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
      if (changed.length) changes.push({ id: before.id, change: `${changed.join(', ')} changed` });
    }
  }
  return changes;
}

// The fields a row may change without a reason: its known-bad bookkeeping, which only moves toward
// passing once the lowering check above has run. Any other change (hosts, event, payload, fixture,
// fault, expectation, kind, source or note) can change what the row proves.
const BOOKKEEPING = new Set(['status', 'known_bad_on', 'lane', 'added']);

// The rows a pull request body explains: each line under a "Pack changes" heading that names a row
// id followed by a reason.
function explainedRows(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => /^#{1,6}\s*Pack changes\s*$/i.test(line.trim()));
  if (start === -1) return new Map();
  const explained = new Map();
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const match = /^\s*[-*]?\s*`?([A-Z][A-Za-z0-9._-]*)`?\s*[:\u2013-]\s*(\S.*)$/.exec(line);
    if (match) explained.set(match[1], match[2]);
  }
  return explained;
}

function checkExpectations(options, out = process.stdout) {
  const head = loadCorpus();
  if (head.errors.length) { out.write(`Hook pack corpus problems:\n${head.errors.map(error => `  ${error}`).join('\n')}\n`); return 1; }
  const base = options.base || process.env.DIFF_BASE || git(ROOT, ['merge-base', 'HEAD', 'origin/main']).trim();
  if (/^0+$/.test(base)) { out.write('No base commit to compare the hook pack with (a new branch); nothing to check.\n'); return 0; }
  const changes = expectationChanges(corpusAt(base).rows, head.rows);
  if (!changes.length) { out.write(`Hook pack: no row was removed, lowered or changed since ${base.slice(0, 7)}.\n`); return 0; }
  const enforce = options.bodyFile !== undefined || process.env.GITHUB_EVENT_NAME === 'pull_request';
  const body = options.bodyFile !== undefined ? fs.readFileSync(options.bodyFile, 'utf8') : process.env.PR_BODY || '';
  const explained = explainedRows(body);
  const missing = changes.filter(change => !explained.has(change.id));
  for (const change of changes) out.write(`${explained.has(change.id) ? 'explained' : 'UNEXPLAINED'} ${change.id}: ${change.change}\n`);
  if (!missing.length) return 0;
  if (!enforce) { out.write('Outside a pull request these are only listed; a pull request must explain each under a "Pack changes" heading.\n'); return 0; }
  out.write('Add a line for each row above under a "## Pack changes" heading in the pull request body: `<row id>: <why it changed>`.\n');
  return 1;
}

// ---- Command line ----

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['run', 'check-expectations', 'validate'].includes(command)) throw new UsageError('Usage: toolkit-hook-pack.cjs run|check-expectations|validate [options]');
  const options = { command };
  const verboseAt = rest.indexOf('--verbose');
  if (verboseAt !== -1) { options.verbose = true; rest.splice(verboseAt, 1); }
  const valued = { '--suite': 'suite', '--family': 'family', '--rows': 'rows', '--host': 'host', '--against': 'against', '--budget-seconds': 'budgetSeconds', '--concurrency': 'concurrency', '--base': 'base', '--body-file': 'bodyFile' };
  for (let index = 0; index < rest.length; index += 1) {
    const key = valued[rest[index]];
    if (!key || index + 1 >= rest.length) throw new UsageError(`Unknown or incomplete option ${rest[index]}.`);
    options[key] = rest[++index];
  }
  if (options.rows) options.rows = options.rows.split(',').filter(Boolean);
  if (options.suite && !KINDS.includes(options.suite)) throw new UsageError(`--suite is one of ${KINDS.join(', ')}.`);
  if (options.host && !HOSTS.includes(options.host)) throw new UsageError('--host is claude or codex.');
  for (const key of ['budgetSeconds', 'concurrency']) if (options[key] !== undefined) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 1) throw new UsageError(`--${key === 'budgetSeconds' ? 'budget-seconds' : 'concurrency'} is a whole number above 0.`);
  }
  for (const key of ['against', 'base']) {
    if (options[key] !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9._\/~^-]*$/.test(options[key])) throw new UsageError(`--${key} names a commit (a name or SHA that does not start with "-").`);
  }
  return options;
}

async function main(argv = process.argv.slice(2), out = process.stdout) {
  let options;
  try { options = parseArgs(argv); } catch (error) { out.write(`${error.message}\n`); return 2; }
  try {
    if (options.command === 'validate') {
      const corpus = loadCorpus();
      out.write(corpus.errors.length ? `${corpus.errors.join('\n')}\n` : `Hook pack corpus: ${corpus.rows.length} row(s), no problems.\n`);
      return corpus.errors.length ? 1 : 0;
    }
    if (options.command === 'check-expectations') return checkExpectations(options, out);
    return await run(options, out);
  } catch (error) {
    out.write(`${error instanceof UsageError ? '' : 'The hook pack could not run: '}${error.message}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = Object.freeze({
  CORPUS_REL, FAULTS, HOSTS, KINDS, SCHEMA,
  expectationChanges, explainedRows, hookDecision, hostCommand, loadCorpus, main, matches, meets, parseArgs, parseCorpusFile, rowErrors, selectHooks,
});
