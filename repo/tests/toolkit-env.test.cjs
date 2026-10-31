'use strict';

// toolkit env with a stand-in store (no real credentials): names, edit/apply, set, remove, header,
// run, import and retire of ~/.codex/.env, the Claude Code and Codex connectors, and a no-leak
// check that a sentinel value never reaches output, stderr, the record or backups.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { FakeEnvStore } = require('./support/fake-env-store.cjs');
const {
  AGENT_MARKERS, EnvEditSession, EnvManifest, EnvPaths, ToolkitEnv, ToolkitEnvCli, copyToClipboard, dumpsEnvironment, parseDotEnv,
} = require('../scripts/toolkit-env.cjs');
const { nameProblem } = require('../scripts/toolkit-env-store.cjs');
const { ClaudeCodeFeeder, CodexFeeder, helperCommand } = require('../scripts/toolkit-env-feeders.cjs');
const { parseTomlDocument } = require('../scripts/codex-delegation-common.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'toolkit-env.cjs');
const TOML_AVAILABLE = parseTomlDocument(Buffer.from('a = 1\n')).ok === true;

function sentinel() { return `dummy-${crypto.randomBytes(9).toString('hex')}`; }

function tempHome(t) {
  // The real path: CI temp folders can be short 8.3 names (Windows) or sit behind a link, and the
  // Codex config backup refuses a config reached through either.
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-test-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// Collects what a command prints.
class Capture {
  constructor() { this.text = ''; }
  write(chunk) { this.text += String(chunk); return true; }
}

function noPrivateDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }

// environment holds the agent markers a test sets (none by default, whatever runs the tests);
// tty, typed and clipboard stand in for the terminal and the clipboard used by show.
function harness(t, { values = {}, answers = [], hidden = [], typed = [], feeders = [], corruptReadBack = [], opener, environment = {}, tty = { stdin: true, stdout: true }, clipboard, scriptPath, clock, helpers = [], startHelper } = {}) {
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const store = new FakeEnvStore({ values, corruptReadBack });
  const asked = [];
  const now = clock ? () => new Date(clock.ms) : () => new Date();
  const env = new ToolkitEnv({
    environment,
    now,
    tty: () => tty,
    askTerminal: async (question) => { asked.push(question); return typed.shift() ?? ''; },
    clipboard: clipboard || (() => { throw new Error('the clipboard is not used in this test'); }),
    ...(scriptPath ? { scriptPath } : {}),
    store,
    manifest: new EnvManifest({ file: paths.manifest, now }),
    editSession: new EnvEditSession({
      directory: paths.editDir, opener: opener || (async () => true), privateDirectory: noPrivateDirectory, now,
      startHelper: startHelper || ((file) => { helpers.push(file); return true; }),
    }),
    feeders,
    paths,
    ask: async (question) => { asked.push(question); return answers.shift() ?? ''; },
    askHidden: async (question) => { asked.push(question); return hidden.shift() ?? ''; },
    commandFor,
  });
  const run = async (...argv) => {
    const stdout = new Capture();
    const stderr = new Capture();
    const code = await new ToolkitEnvCli({ env, stdout, stderr }).main(argv);
    return { code, stdout: stdout.text, stderr: stderr.text };
  };
  return { home, paths, store, env, run, asked, helpers };
}

function editFile(paths) {
  return path.join(paths.editDir, fs.readdirSync(paths.editDir).find((name) => name.endsWith('.env')));
}

function editFiles(paths) {
  try { return fs.readdirSync(paths.editDir).filter((name) => name.endsWith('.env')); } catch { return []; }
}

// The lines of an edit file below its header.
function bodyOf(text) { return text.split(/\r?\n/).filter((line) => line && !/^# (Toolkit env|Close any|Change a value|Each save|A line showing|Your own|When you are|Status:)/.test(line)); }

test('key names follow PROVIDER_SOLUTION_PURPOSE and never start with CODEX_', () => {
  for (const name of ['COOLIFY_SWOOSHZ_MCP_TOKEN', 'NEONDB_SWOOSHZ_PLATFORM_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'A1_B2_C3']) assert.equal(nameProblem(name), '', name);
  for (const name of ['', 'lower_case_name', 'TWO_PARTS', 'CODEX_HOME_THING', 'BAD-NAME_X_Y', '_LEADING_X_Y', 'TRAILING_X_', 'DOUBLE__UNDERSCORE_X', `${'A_'.repeat(70)}B`]) {
    assert.notEqual(nameProblem(name), '', name);
  }
});

test('status lists names and where they are used, never values', async (t) => {
  const value = sentinel();
  const { run } = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value, X1_TEST_OTHER_KEY: sentinel() } });
  const result = await run('status');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Toolkit env store: Test store/);
  assert.match(result.stdout, /X1_TEST_COOLIFY_TOKEN: present/);
  assert.match(result.stdout, /OpenCode: not supported yet\./);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
  assert.doesNotMatch(result.stdout, /length|characters|prefix/i);
});

test('edit shows real values; a save changes, adds and removes keys, and done reports names only', async (t) => {
  const kept = sentinel();
  const old = sentinel();
  const fresh = sentinel();
  const added = sentinel();
  const gone = sentinel();
  const { run, paths, store, helpers } = harness(t, { values: { X1_TEST_KEPT_KEY: kept, X1_TEST_CHANGED_KEY: old, X1_TEST_GONE_KEY: gone } });
  const opened = await run('edit');
  assert.equal(opened.code, 0);
  assert.match(opened.stdout, /Opened ~\/\.ai-agent-toolkit\/env\/edit\/env-edit-[0-9a-f]{16}\.env with your 3 keys/);
  const file = editFile(paths);
  assert.deepEqual(helpers, [file], 'the helper gets the file path only');
  const text = fs.readFileSync(file, 'utf8');
  assert.deepEqual(bodyOf(text), [`X1_TEST_CHANGED_KEY=${old}`, `X1_TEST_GONE_KEY=${gone}`, `X1_TEST_KEPT_KEY=${kept}`]);
  fs.writeFileSync(file, text
    .replace(`X1_TEST_CHANGED_KEY=${old}`, `X1_TEST_CHANGED_KEY=${fresh}`)
    .replace(`X1_TEST_GONE_KEY=${gone}`, '')
    .concat(`X1_TEST_ADDED_KEY = ${added}\r\n`));
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /^changed: X1_TEST_CHANGED_KEY$/m);
  assert.match(applied.stdout, /^added: X1_TEST_ADDED_KEY$/m);
  assert.match(applied.stdout, /^removed: X1_TEST_GONE_KEY$/m);
  assert.equal(store.peek('X1_TEST_CHANGED_KEY'), fresh);
  assert.equal(store.peek('X1_TEST_ADDED_KEY'), added);
  assert.equal(store.peek('X1_TEST_KEPT_KEY'), kept);
  assert.equal(store.peek('X1_TEST_GONE_KEY'), undefined);
  assert.deepEqual(fs.readdirSync(paths.editDir), [], 'the edit folder is empty after done');
  for (const secret of [kept, old, fresh, added, gone]) assert.ok(!(applied.stdout + applied.stderr).includes(secret));
  const again = await run('apply');
  assert.match(again.stdout, /There is no open edit/);
});

test('apply saves nothing when a line is wrong, and names the line without its value', async (t) => {
  const value = sentinel();
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const file = editFile(paths);
  // A space typed instead of =, and a base64 value ending in = on its own line: the text before
  // the = is part of a value and must not be repeated.
  const spaced = sentinel();
  const based = sentinel();
  fs.appendFileSync(file, `X1_TEST_GOOD_KEY=${value}\nbad_name_here=${value}\nnot a line\nX1_TEST_NEON_URL postgres://user:${spaced}@db.example/db?sslmode=require\n${based}QUJD==\nX1_TEST_BLANK_KEY=\n`);
  const result = await run('apply');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Nothing was saved/);
  assert.match(result.stderr, /line \d+: the text before = is not a valid key name \(key names look like/);
  assert.match(result.stderr, /line \d+ is not NAME=value/);
  assert.match(result.stderr, /line \d+ has no value; to remove a key, delete its whole line/);
  for (const secret of [value, spaced, based, 'bad_name_here', 'postgres']) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.equal(store.peek('X1_TEST_GOOD_KEY'), undefined);
  assert.ok(fs.existsSync(file), 'the file is kept so it can be fixed');
  assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED \(\d\d:\d\d UTC\)\. Fix: line \d+/m, 'the file says why at the top');
  // Without its header, the status line is added at the top and says how line numbers count.
  save(file, 'not a line\n');
  assert.equal((await run('apply')).code, 1);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED .*Fix: line 1 is not NAME=value \(line numbers count from the line below this one\)\r?\nnot a line\n$/);
  assert.ok(!fs.readFileSync(file, 'utf8').split(/\r?\n/).find((line) => line.startsWith('# Status:')).includes(value));
});

test('a second edit builds a fresh file from the store and wipes the old one, which is never reused', async (t) => {
  const kept = sentinel();
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: kept, X1_TEST_GONE_KEY: sentinel() }, answers: ['yes'] });
  await run('edit');
  const first = editFile(paths);
  // Changed and removed outside the edit: the next edit shows exactly the store.
  const changed = sentinel();
  store.writeAll(new Map([['X1_TEST_KEPT_KEY', changed]]));
  await run('remove', 'X1_TEST_GONE_KEY');
  const reopened = await run('edit');
  assert.match(reopened.stdout, /^Opened /m);
  assert.doesNotMatch(reopened.stdout, /Reopened/);
  const second = editFile(paths);
  assert.notEqual(second, first);
  assert.equal(fs.existsSync(first), false, 'the old file is gone');
  assert.deepEqual(editFiles(paths), [path.basename(second)]);
  assert.deepEqual(bodyOf(fs.readFileSync(second, 'utf8')), [`X1_TEST_KEPT_KEY=${changed}`]);
  assert.ok(!fs.readFileSync(second, 'utf8').includes(kept));
});

test('set reads the value from the hidden prompt and reads it back', async (t) => {
  const value = sentinel();
  const { run, store, asked } = harness(t, { hidden: [value] });
  const result = await run('set', 'X1_TEST_SET_KEY');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^added: X1_TEST_SET_KEY$/m);
  assert.match(asked[0], /it is not shown/);
  assert.equal(store.peek('X1_TEST_SET_KEY'), value);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
  const bad = await run('set', 'not_a_rule_name');
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /key names look like .*\(ENV-[0-9A-F]{8}\)/);
});

test('remove asks a yes/no that names the key and keeps it on anything but yes', async (t) => {
  const { run, store, asked } = harness(t, { values: { X1_TEST_GONE_KEY: sentinel() }, answers: ['no', 'yes'] });
  const kept = await run('remove', 'X1_TEST_GONE_KEY');
  assert.match(kept.stdout, /Kept X1_TEST_GONE_KEY\./);
  assert.ok(store.peek('X1_TEST_GONE_KEY'));
  const removed = await run('remove', 'X1_TEST_GONE_KEY');
  assert.match(removed.stdout, /^removed: X1_TEST_GONE_KEY$/m);
  assert.equal(store.peek('X1_TEST_GONE_KEY'), undefined);
  assert.ok(asked.every((question) => question.includes('X1_TEST_GONE_KEY')));
  const missing = await run('remove', 'X1_TEST_GONE_KEY');
  assert.match(missing.stdout, /not in the store; nothing to remove/);
});

test('header prints one JSON object with the Bearer scheme; a missing key fails without output', async (t) => {
  const value = sentinel();
  const { run } = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value } });
  const bearer = await run('header', 'X1_TEST_COOLIFY_TOKEN');
  assert.equal(bearer.code, 0);
  assert.deepEqual(JSON.parse(bearer.stdout), { Authorization: `Bearer ${value}` });
  const raw = await run('header', 'X1_TEST_COOLIFY_TOKEN', '--header', 'X-Api-Key', '--scheme', 'none');
  assert.deepEqual(JSON.parse(raw.stdout), { 'X-Api-Key': value });
  const missing = await run('header', 'X1_TEST_MISSING_KEY');
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /not in the Toolkit env store/);
  const reserved = await run('header', 'X1_TEST_COOLIFY_TOKEN', '--header', 'Host');
  assert.equal(reserved.code, 1);
  assert.equal(reserved.stdout, '');
});

test('run passes only the named keys and refuses unknown keys and environment dumps', async (t) => {
  const named = sentinel();
  const other = sentinel();
  const { env } = harness(t, { values: { X1_TEST_NAMED_KEY: named, X1_TEST_OTHER_KEY: other } });
  const out = path.join(os.tmpdir(), `toolkit-env-run-${crypto.randomBytes(4).toString('hex')}.json`);
  t.after(() => fs.rmSync(out, { force: true }));
  const code = await env.run(['X1_TEST_NAMED_KEY'], process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ named: process.env.X1_TEST_NAMED_KEY, other: process.env.X1_TEST_OTHER_KEY || null })); process.exit(7)`], { stdio: 'ignore' });
  assert.equal(code, 7);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { named, other: null });
  await assert.rejects(env.run(['X1_TEST_UNKNOWN_KEY'], process.execPath, ['-v']), /Not in the Toolkit env store: X1_TEST_UNKNOWN_KEY/);
  for (const [command, args] of [['env', []], ['printenv', []], ['/usr/bin/env', []], ['cmd.exe', ['/c', 'set']], ['powershell', ['-Command', 'Get-ChildItem env:']], ['pwsh', ['-c', 'dir Env:']], ['bash', ['-c', 'export -p']], ['sh', ['-c', 'echo hi; env']]]) {
    assert.equal(dumpsEnvironment(command, args), true, `${command} ${args.join(' ')}`);
    await assert.rejects(env.run(['X1_TEST_NAMED_KEY'], command, args), /would print the environment/);
  }
  for (const [command, args] of [['node', ['server.js']], ['npx', ['-y', 'some-mcp']], ['bash', ['-c', 'wrangler whoami']], ['cmd', ['/c', 'settings.cmd']]]) {
    assert.equal(dumpsEnvironment(command, args), false, `${command} ${args.join(' ')}`);
  }
});

test('the record holds names, times and connections only, and is replaced in one step', async (t) => {
  const value = sentinel();
  const { run, paths } = harness(t, { hidden: [value] });
  await run('set', 'X1_TEST_SET_KEY');
  const record = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  assert.equal(record.schema, 'ai-agent-toolkit.env-manifest.v1');
  assert.deepEqual(Object.keys(record.names), ['X1_TEST_SET_KEY']);
  assert.deepEqual(Object.keys(record.names.X1_TEST_SET_KEY).sort(), ['added_at', 'updated_at']);
  assert.doesNotMatch(fs.readFileSync(paths.manifest, 'utf8'), new RegExp(value));
  assert.deepEqual(fs.readdirSync(paths.envDir).filter((name) => name.endsWith('.tmp')), []);
  fs.writeFileSync(paths.manifest, '{"schema":"something-else"}');
  const broken = await run('status');
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /unknown format/);
});

test('the .env parser reads quoted values, comments and export, and reports other lines by number only', () => {
  const text = [
    '# comment',
    '',
    'X1_TEST_PLAIN_KEY=plain-value',
    'export X1_TEST_EXPORT_KEY=exported',
    'X1_TEST_DOUBLE_KEY="has # hash and \\"quote\\""',
    "X1_TEST_SINGLE_KEY='single # value'",
    'X1_TEST_COMMENT_KEY=value # trailing comment',
    'this line has no equals',
    'X1_TEST_OPEN_KEY="never closed',
    '',
  ].join('\r\n');
  const { entries, skipped } = parseDotEnv(text);
  assert.deepEqual(Object.fromEntries(entries.map((entry) => [entry.name, entry.value])), {
    X1_TEST_PLAIN_KEY: 'plain-value',
    X1_TEST_EXPORT_KEY: 'exported',
    X1_TEST_DOUBLE_KEY: 'has # hash and "quote"',
    X1_TEST_SINGLE_KEY: 'single # value',
    X1_TEST_COMMENT_KEY: 'value',
  });
  assert.deepEqual(skipped, [8, 9]);
});

function writeCodexEnv(paths, text) {
  fs.mkdirSync(path.dirname(paths.codexEnvFile), { recursive: true });
  fs.writeFileSync(paths.codexEnvFile, text);
}

test('import copies ~/.codex/.env into the store, reads each back, and leaves the file as it was', async (t) => {
  const one = sentinel();
  const two = sentinel();
  const differs = sentinel();
  const { run, paths, store } = harness(t, { values: { X1_TEST_DIFFERS_KEY: 'stored-already' } });
  const text = `X1_TEST_ONE_KEY=${one}\nX1_TEST_TWO_KEY="${two}"\nX1_TEST_DIFFERS_KEY=${differs}\nlowercase_name=${sentinel()}\nnot a line\nX1_TEST_EMPTY_KEY=\n`;
  writeCodexEnv(paths, text);
  const result = await run('import-codex-env');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^imported: 2 names \(X1_TEST_ONE_KEY, X1_TEST_TWO_KEY\)$/m);
  assert.match(result.stdout, /kept the store's value \(it differs from the file\): X1_TEST_DIFFERS_KEY/);
  assert.match(result.stdout, /^not imported, line 4: the text before = is not a valid key name/m);
  assert.doesNotMatch(result.stdout, /lowercase_name/);
  assert.match(result.stdout, /empty value: X1_TEST_EMPTY_KEY/);
  assert.match(result.stdout, /^skipped lines: 5 \(not NAME=value/m);
  assert.equal(fs.readFileSync(paths.codexEnvFile, 'utf8'), text);
  assert.equal(store.peek('X1_TEST_ONE_KEY'), one);
  assert.equal(store.peek('X1_TEST_DIFFERS_KEY'), 'stored-already');
  for (const secret of [one, two, differs]) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  const again = await run('import-codex-env');
  assert.match(again.stdout, /^imported: 0 names$/m);
  assert.match(again.stdout, /already in the store with the same value: X1_TEST_ONE_KEY, X1_TEST_TWO_KEY/);
});

test('a failed read-back stops the import and records nothing', async (t) => {
  const { run, paths } = harness(t, { corruptReadBack: ['X1_TEST_ONE_KEY'] });
  writeCodexEnv(paths, `X1_TEST_ONE_KEY=${sentinel()}\n`);
  const result = await run('import-codex-env');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Read-back failed for X1_TEST_ONE_KEY/);
  assert.equal(fs.existsSync(paths.manifest), false);
  assert.ok(fs.existsSync(paths.codexEnvFile));
});

test('retire moves ~/.codex/.env to a private backup only when every key is stored and the owner says yes', async (t) => {
  const value = sentinel();
  const { run, paths, store } = harness(t, { answers: ['no', 'yes'] });
  writeCodexEnv(paths, `X1_TEST_ONE_KEY=${value}\n`);
  const blocked = await run('retire-codex-env');
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /not in the store with the same value: X1_TEST_ONE_KEY/);
  store.writeAll(new Map([['X1_TEST_ONE_KEY', value]]));
  const declined = await run('retire-codex-env');
  assert.match(declined.stdout, /Nothing was changed/);
  assert.ok(fs.existsSync(paths.codexEnvFile));
  const moved = await run('retire-codex-env');
  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(fs.existsSync(paths.codexEnvFile), false);
  const folder = fs.readdirSync(paths.backupsDir).find((name) => name.startsWith('env-retire-'));
  const backup = path.join(paths.backupsDir, folder, 'codex.env');
  assert.ok(fs.existsSync(backup));
  if (process.platform === 'win32') {
    const identity = spawnSync(path.join(process.env.SystemRoot, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    assert.equal(identity.status, 0, identity.stderr);
    const sid = identity.stdout.match(/S-1-[0-9-]+/i)?.[0];
    assert.ok(sid, 'the executing Windows identity must have a SID');
    // The folder and the moved file each hold one entry: the current user.
    for (const target of [path.dirname(backup), backup]) {
      const acl = spawnSync(path.join(process.env.SystemRoot, 'System32', 'icacls.exe'), [target], { encoding: 'utf8' }).stdout;
      assert.doesNotMatch(acl, /\(I\)|NT AUTHORITY|BUILTIN|Everyone/, acl);
      assert.equal(acl.split(/\r?\n/).filter((line) => /:\(/.test(line)).length, 1, acl);
      // .NET directly, so no PowerShell module has to load (a runner's PSModulePath can point at PowerShell 7).
      const aclScript = '$ErrorActionPreference = "Stop"; $p = [Console]::In.ReadToEnd(); $acl = if ([System.IO.Directory]::Exists($p)) { [System.IO.Directory]::GetAccessControl($p) } else { [System.IO.File]::GetAccessControl($p) }; $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }';
      const access = spawnSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(aclScript, 'utf16le').toString('base64'),
      ], { input: target, encoding: 'utf8', windowsHide: true, timeout: 10000, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath')) });
      assert.equal(access.status, 0, access.stderr);
      assert.equal(access.stdout.trim(), sid, 'the sole ACL entry must be the executing identity, not USERNAME');
    }
  } else {
    assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  }
  assert.match(moved.stdout, /delete that backup yourself/);
  assert.doesNotMatch(moved.stdout + moved.stderr, new RegExp(value));
});

test('the edit file keeps your comment and section lines in place, and never stores a value', async (t) => {
  const value = sentinel();
  const { run, paths, store } = harness(t, { values: { COOLIFY_SWOOSHZ_MCP_TOKEN: value, NEONDB_SWOOSHZ_API_KEY: value, CLOUDFLARE_ACCOUNT_ID: value } });
  await run('edit');
  let file = editFile(paths);
  fs.writeFileSync(file, [
    ...fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.startsWith('#')),
    '# --- Hosting ---',
    `COOLIFY_SWOOSHZ_MCP_TOKEN=${value}`,
    '',
    '# --- Databases (Swooshz team) ---',
    `NEONDB_SWOOSHZ_API_KEY=${value}`,
    `CLOUDFLARE_ACCOUNT_ID=${value}`,
    '',
  ].join('\n'));
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  const record = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  assert.deepEqual(record.layout, ['# --- Hosting ---', 'COOLIFY_SWOOSHZ_MCP_TOKEN', '', '# --- Databases (Swooshz team) ---', 'NEONDB_SWOOSHZ_API_KEY', 'CLOUDFLARE_ACCOUNT_ID']);
  assert.doesNotMatch(fs.readFileSync(paths.manifest, 'utf8'), new RegExp(value));
  // The next edit shows the same layout; a key added since then comes after it.
  store.writeAll(new Map([['GITHUB_SWOOSHZ_PAT', value]]));
  await run('edit');
  file = editFile(paths);
  assert.deepEqual(bodyOf(fs.readFileSync(file, 'utf8')), ['# --- Hosting ---', `COOLIFY_SWOOSHZ_MCP_TOKEN=${value}`, '# --- Databases (Swooshz team) ---', `NEONDB_SWOOSHZ_API_KEY=${value}`, `CLOUDFLARE_ACCOUNT_ID=${value}`, `GITHUB_SWOOSHZ_PAT=${value}`]);
  await run('apply');
});

test('a comment that looks like a key or token stops apply and is reported by line number only', async (t) => {
  const value = sentinel();
  const { run, paths } = harness(t, { values: { COOLIFY_SWOOSHZ_MCP_TOKEN: value } });
  await run('edit');
  const file = editFile(paths);
  for (const comment of [`# OLD_TOKEN=${value}`, '# ghp_0123456789abcdefABCDEF0123456789']) {
    fs.writeFileSync(file, [comment, `COOLIFY_SWOOSHZ_MCP_TOKEN=${value}`, ''].join('\n'));
    const refused = await run('apply');
    assert.equal(refused.code, 1, comment);
    assert.match(refused.stderr, /line 1: this comment looks like it may hold a key or token/);
    assert.doesNotMatch(refused.stdout + refused.stderr, new RegExp(value));
    assert.doesNotMatch(refused.stdout + refused.stderr, /ghp_/);
  }
  assert.equal(fs.existsSync(paths.manifest) && /ghp_|OLD_TOKEN/.test(fs.readFileSync(paths.manifest, 'utf8')), false);
});

function unsafeLayoutComments() {
  return [
    ['inline assignment', '# Previous credential: OLD_TOKEN=dummy-inline-secret'],
    ['short assignment', '# OLD_TOKEN=abc123'],
    ['spaced assignment', '# Notes (export OLD_TOKEN = dummy-spaced-secret)'],
    ['quoted assignment', '# OLD_TOKEN="dummy quoted value"'],
    ['alphabetic token', '# ghp_abcdefghijklmnopqrstuvwxyzABCDEF'],
    ['short prefixed token', '# sk-abcdefgHIJKLMN'],
    ['padded base64 as empty assignment', `# ${Buffer.from('a'.repeat(32)).toString('base64')}`],
    ['base64 word with empty value', `# ${'AbCdEf'.repeat(7)}AB=`],
    ['github token with empty value', `#ghp_${'a'.repeat(36)}=`],
    ['github token with unchanged value', `# ghp_${'a'.repeat(36)}=<unchanged>`],
    ['github PAT with unchanged value', `#github_pat_${'a'.repeat(36)}=<unchanged>`],
    ['short sk token with empty value', '# sk-abcdefgHIJKLMN='],
    ['hex word with empty value', `# ${'abcdef0123456789'.repeat(3)}=`],
    ['token after ordinary empty assignment', '# NAME= sk-abcdefgHIJKLMN'],
    ['token after unchanged assignment', '# NAME=<unchanged> ghp_abcdefgHIJKLMN'],
    ['base64 without digits', `# ${Buffer.from('a'.repeat(30)).toString('base64')}`],
    ['long base64', `# ${Buffer.from('synthetic only '.repeat(30)).toString('base64')}`],
    ['numeric token', `# ${'1234567890'.repeat(4)}`],
    ['hex token', `# ${'abcdef0123456789'.repeat(3)}`],
    ['unicode assignment', '# Notes: \u5bc6\u94a5=dummy-unicode-secret'],
    ['unicode token', `# ${'\u5bc6\u94a5'.repeat(16)}`],
    ['fullwidth assignment', '# Notes: TOKEN\uff1ddummy-wide-secret'],
    ['invisible token separator', '# abcdefghijklmnop\u200bqrstuvwxyzABCDEF'],
    ['ZWJ outside emoji', '# Heading\u200dtext'],
    ['ZWJ after emoji only', '# \u{1f469}\u200dtext'],
    ['bidi override', '# Heading\u202edummy-hidden-secret'],
    ['C1 control', '# Heading\u0085dummy-hidden-secret'],
    ['unicode line separator', '# Heading\u2028dummy-hidden-secret'],
    ['bare carriage return', '# Heading\rdummy-carriage-secret'],
    ['NUL in comment', '# Heading\u0000dummy-control-secret'],
  ];
}

test('a 100 KB commented line is refused promptly before screening its contents', async (t) => {
  const { run, paths, store } = harness(t);
  await run('edit');
  fs.writeFileSync(editFile(paths), `# ${'a'.repeat(100 * 1024)}\n`);
  const started = performance.now();
  const refused = await run('apply');
  assert.ok(performance.now() - started < 1000, 'oversized comments must return promptly');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /line 1: this comment looks like it may hold a key or token/);
  assert.equal(store.writes, 0);
  assert.equal(fs.existsSync(paths.manifest), false);
});

test('decorations, URLs, paths, empty or unchanged commented keys and emoji headings are kept', async (t) => {
  const comments = [
    '# ==== Hosting ====',
    '# ---- Hosting ----',
    '# #### Hosting ####',
    '# Get it at https://dash.cloudflare.com/profile/api-tokens',
    '# Used by repo/scripts/toolkit-env.cjs',
    '# Used by C:\\repo\\scripts\\toolkit-env.cjs',
    '#NAME=<unchanged>',
    '# NAME=',
    '# NAME =',
    '# LONG_PROVIDER_SOLUTION_PURPOSE_KEY=<unchanged>',
    '# \u{1f469}\u200d\u{1f4bb} Hosting',
    '# \u{1f469}\u{1f3fd}\u200d\u{1f4bb} Hosting',
    '# \u{1f3f3}\ufe0f\u200d\u{1f308} Hosting',
  ];
  for (const operation of ['apply', 'import-codex-env', 'retire-codex-env']) await t.test(operation, async (t) => {
    const value = sentinel();
    const { run, paths } = harness(t, { values: { X1_TEST_KEPT_KEY: value }, answers: ['yes'] });
    if (operation === 'apply') {
      await run('edit');
      fs.writeFileSync(editFile(paths), `${comments.join('\n')}\nX1_TEST_KEPT_KEY=${value}\n`);
    } else writeCodexEnv(paths, `${comments.join('\n')}\nX1_TEST_KEPT_KEY=${value}\n`);
    const result = await run(operation);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest, 'utf8')).layout, [...comments, 'X1_TEST_KEPT_KEY']);
    await run('edit');
    const reopened = fs.readFileSync(editFile(paths), 'utf8');
    for (const comment of comments) assert.ok(reopened.includes(comment), comment);
  });
});

test('layout refusals are atomic and disclose only line numbers across adversarial comment formats', async (t) => {
  for (const [label, comment] of unsafeLayoutComments()) await t.test(label, async (t) => {
    const value = sentinel();
    const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: value } });
    await run('edit');
    const file = editFile(paths);
    fs.writeFileSync(file, `# Safe section\r\n\r\n${comment}\r\nX1_TEST_NEW_KEY=${value}\r\n`);
    const refused = await run('apply');
    assert.equal(refused.code, 1, label);
    assert.match(refused.stderr, /line 3: this comment looks like it may hold a key or token/);
    assert.ok(!(refused.stdout + refused.stderr).includes(comment), 'a refusal must not repeat comment content');
    assert.ok(!(refused.stdout + refused.stderr).includes(value), 'a refusal must not repeat a value');
    assert.equal(store.writes, 0, 'a refused layout must not save even valid assignments');
    assert.equal(fs.existsSync(paths.manifest), false, 'a refused layout must not create a record');
    assert.deepEqual(fs.readdirSync(paths.envDir), ['edit'], 'no other layout file may be written');
    assert.equal(fs.existsSync(file), true, 'the private edit remains available for correction');
  });
});

test('CRLF, BOM, unicode headings, sections and blank lines round-trip without assignment values', async (t) => {
  const value = sentinel();
  const { run, paths } = harness(t, { values: { X1_TEST_KEPT_KEY: value } });
  await run('edit');
  fs.writeFileSync(editFile(paths), `\uFEFF\r\n# --- Hosting ---\r\n\r\n\r\n# \u65e5\u672c / caf\u00e9\r\nX1_TEST_KEPT_KEY=${value}\r\n\r\nX1_TEST_NEW_KEY=${value}\r\n\r\n`);
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  const expected = ['# --- Hosting ---', '', '# \u65e5\u672c / caf\u00e9', 'X1_TEST_KEPT_KEY', '', 'X1_TEST_NEW_KEY'];
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest, 'utf8')).layout, expected);
  assert.ok(!fs.readFileSync(paths.manifest, 'utf8').includes(value));
  await run('edit');
  const reopened = fs.readFileSync(editFile(paths), 'utf8');
  assert.ok(reopened.endsWith(`${expected.map((line) => line.startsWith('X1_') ? `${line}=${value}` : line).join(os.EOL)}${os.EOL}`));
});

test('import and retire never adopt adversarial comments into the layout or repeat their contents', async (t) => {
  for (const operation of ['import-codex-env', 'retire-codex-env']) await t.test(operation, async (t) => {
    const value = sentinel();
    const { run, paths } = harness(t, { values: { X1_TEST_KEPT_KEY: value }, answers: ['yes'] });
    const comments = unsafeLayoutComments().map(([, comment]) => comment);
    const lines = ['# Safe section', `X1_TEST_KEPT_KEY=${value}`, '', ...comments, ''];
    writeCodexEnv(paths, lines.join('\r\n'));
    const result = await run(operation);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`not kept as layout, comment lines ${comments.map((_, index) => index + 4).join(', ')}`));
    const manifest = fs.readFileSync(paths.manifest, 'utf8');
    assert.deepEqual(JSON.parse(manifest).layout, ['# Safe section', 'X1_TEST_KEPT_KEY']);
    for (const text of [result.stdout, result.stderr, manifest]) {
      assert.ok(!text.includes(value), 'the assignment value must stay out of layout and diagnostics');
      for (const comment of comments) assert.ok(!text.includes(comment), 'unsafe comment content must stay out of layout and diagnostics');
    }
    assert.deepEqual(fs.readdirSync(paths.envDir), ['manifest.json'], 'the manifest is the only layout store');
    await run('edit');
    const reopened = fs.readFileSync(editFile(paths), 'utf8');
    assert.deepEqual(bodyOf(reopened), ['# Safe section', `X1_TEST_KEPT_KEY=${value}`]);
    for (const comment of comments) assert.ok(!reopened.includes(comment));
  });
});

test('manifest layout rejects unsafe existing entries and updates before propagating them', (t) => {
  const { paths } = harness(t);
  const manifest = new EnvManifest({ file: paths.manifest });
  manifest.update((record) => { record.layout = ['# Safe section', 'X1_TEST_KEPT_KEY']; });
  const before = fs.readFileSync(paths.manifest, 'utf8');
  for (const [, comment] of unsafeLayoutComments()) {
    assert.throws(() => manifest.update((record) => { record.layout = [comment]; }), /layout entry 1 \(counting from 1\) in the "layout" list of ~\/\.ai-agent-toolkit\/env\/manifest\.json/);
    assert.equal(fs.readFileSync(paths.manifest, 'utf8'), before);
    fs.writeFileSync(paths.manifest, JSON.stringify({ schema: 'ai-agent-toolkit.env-manifest.v1', names: {}, bindings: [], layout: [comment] }));
    assert.throws(() => manifest.read(), (error) => /layout entry 1 \(counting from 1\)/.test(error.message) && !error.message.includes(comment));
    fs.writeFileSync(paths.manifest, before);
  }
  assert.deepEqual(fs.readdirSync(paths.envDir), ['manifest.json']);
});

test('manifest layout rejects malformed shapes and embedded line breaks without content in errors', (t) => {
  const { paths } = harness(t);
  const manifest = new EnvManifest({ file: paths.manifest });
  for (const layout of [null, {}, [null], [42], ['X1_TEST_KEY\n'], ['# Safe\n# second line'], ['invalid layout value'], Array(501).fill('# Safe')]) {
    fs.mkdirSync(paths.envDir, { recursive: true });
    fs.writeFileSync(paths.manifest, JSON.stringify({ schema: 'ai-agent-toolkit.env-manifest.v1', layout }));
    assert.throws(() => manifest.read(), /Toolkit env layout/);
  }
  fs.writeFileSync(paths.manifest, JSON.stringify({ schema: 'ai-agent-toolkit.env-manifest.v1' }));
  assert.deepEqual(manifest.read().layout, [], 'records from before layout support remain readable');
});

test('duplicate keys and oversized values are refused without repeating any line content', async (t) => {
  const { run, paths, store } = harness(t);
  const value = sentinel();
  await run('edit');
  fs.writeFileSync(editFile(paths), `X1_TEST_DUPLICATE_KEY=${value}\r\nX1_TEST_DUPLICATE_KEY=${value}\r\nX1_TEST_OVERSIZED_KEY=${'x'.repeat(2561)}\r\n`);
  const refused = await run('apply');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /line 2: the key name appears more than once/);
  assert.match(refused.stderr, /line 3: value too long/);
  for (const text of [value, 'X1_TEST_DUPLICATE_KEY', 'X1_TEST_OVERSIZED_KEY']) assert.ok(!refused.stderr.includes(text));
  assert.equal(store.writes, 0);
  assert.equal(fs.existsSync(paths.manifest), false);
});

test('ordinary prose comments remain verbatim, so screening cannot certify absence of passphrases', async (t) => {
  const { run, paths } = harness(t);
  const phrase = 'violet paper canoe'; // Synthetic prose: indistinguishable from a heading or password.
  await run('edit');
  fs.writeFileSync(editFile(paths), `# ${phrase}\r\n`);
  assert.equal((await run('apply')).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest, 'utf8')).layout, [`# ${phrase}`]);
});

test('remove drops the name from the layout; import and retire keep the .env comments before the file can be deleted', async (t) => {
  const value = sentinel();
  const { run, paths, store } = harness(t, { answers: ['yes', 'yes'] });
  writeCodexEnv(paths, ['# Hosting', `COOLIFY_SWOOSHZ_MCP_TOKEN=${value}`, '', '# Databases', `NEONDB_SWOOSHZ_API_KEY=${value}`, '# key_0123456789abcdefABCDEF012345', ''].join('\n'));
  const imported = await run('import-codex-env');
  assert.equal(imported.code, 0, imported.stderr);
  assert.match(imported.stdout, /kept 2 comment lines and the key order for toolkit env edit/);
  assert.match(imported.stdout, /not kept as layout, comment line 6/);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest, 'utf8')).layout, ['# Hosting', 'COOLIFY_SWOOSHZ_MCP_TOKEN', '', '# Databases', 'NEONDB_SWOOSHZ_API_KEY']);
  const retired = await run('retire-codex-env');
  assert.equal(retired.code, 0, retired.stderr);
  assert.match(retired.stdout, /Kept your existing toolkit env edit layout/);
  assert.match(retired.stdout, /last plain copy of these values, and the only copy of 1 comment line\./);
  assert.ok(store.list().includes('NEONDB_SWOOSHZ_API_KEY'));
  const removed = await run('remove', 'NEONDB_SWOOSHZ_API_KEY');
  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest, 'utf8')).layout, ['# Hosting', 'COOLIFY_SWOOSHZ_MCP_TOKEN', '', '# Databases']);
  assert.doesNotMatch(imported.stdout + retired.stdout + fs.readFileSync(paths.manifest, 'utf8'), new RegExp(value));
});

// A stand-in for Codex's config/batchWrite on simple tables: removes or sets `key = value` lines.
function fakeCodexEditor(calls = []) {
  return async (bytes, { edits }) => {
    calls.push(edits);
    let lines = bytes.toString('utf8').split('\n');
    for (const edit of edits) {
      const parts = edit.keyPath.split('.');
      const key = parts.pop();
      const table = `[${parts.join('.')}]`;
      let start = lines.indexOf(table);
      if (start === -1) {
        if (edit.value === null) continue;
        lines.push('', table);
        start = lines.length - 1;
      }
      let end = lines.findIndex((line, index) => index > start && line.startsWith('['));
      if (end === -1) end = lines.length;
      const at = lines.findIndex((line, index) => index > start && index < end && line.startsWith(`${key} =`));
      if (at !== -1) lines.splice(at, 1);
      if (edit.value !== null) lines.splice(start + 1, 0, `${key} = ${JSON.stringify(edit.value)}`);
    }
    return { bytes: Buffer.from(lines.join('\n')) };
  };
}

const CODEX_CONFIG = [
  'model = "test-model"',
  '',
  '[mcp_servers.coolify]',
  'enabled = true',
  'url = "https://coolify.example.test/mcp"',
  'bearer_token_env_var = "X1_TEST_COOLIFY_TOKEN"',
  '',
  '[mcp_servers.other]',
  'command = "npx"',
  'args = ["-y", "other-server"]',
  '',
].join('\n');

function commandFor(binding) {
  return helperCommand({ nodePath: 'C:/Program Files/nodejs/node.exe', scriptPath: 'C:/Users/Test User/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs', name: binding.name, header: binding.header, scheme: binding.scheme });
}

function codexSetup(t, paths, { config = CODEX_CONFIG, editor } = {}) {
  fs.mkdirSync(paths.codexHome, { recursive: true });
  fs.writeFileSync(path.join(paths.codexHome, 'config.toml'), config);
  return new CodexFeeder({ codexHome: paths.codexHome, editor: editor || fakeCodexEditor(), commandFor });
}

test('Codex: connect adds the helper, removes bearer_token_env_var, leaves other entries alone; revoke restores it', { skip: !TOML_AVAILABLE && 'needs Python 3.11+ tomllib' }, async (t) => {
  const value = sentinel();
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const feeder = codexSetup(t, paths);
  const { run, store } = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value }, answers: ['yes', 'yes'], feeders: [feeder] });
  const connected = await run('connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN', '--harness', 'codex');
  assert.equal(connected.code, 0, connected.stderr);
  assert.match(connected.stdout, /remove bearer_token_env_var \(X1_TEST_COOLIFY_TOKEN\)/);
  assert.match(connected.stdout, /Restart Codex once/);
  const after = fs.readFileSync(path.join(paths.codexHome, 'config.toml'), 'utf8');
  assert.match(after, /^http_headers_helper = "\\"C:\/Program Files\/nodejs\/node.exe\\" \\"C:\/Users\/Test User\/.*toolkit-env.cjs\\" header X1_TEST_COOLIFY_TOKEN"$/m);
  assert.doesNotMatch(after, /bearer_token_env_var/);
  assert.match(after, /\[mcp_servers\.other\]\ncommand = "npx"\nargs = \["-y", "other-server"\]/);
  assert.doesNotMatch(after, new RegExp(value));
  assert.equal(feeder.status([{ harness: 'codex', server: 'coolify', name: 'X1_TEST_COOLIFY_TOKEN', header: 'Authorization', scheme: 'Bearer' }])[0].state, 'current');
  const status = await run('status');
  assert.match(status.stdout, /X1_TEST_COOLIFY_TOKEN: present, used by Codex \(coolify\)/);
  assert.match(status.stdout, /Codex: current \(coolify\)\./);
  assert.deepEqual(feeder.environmentReferences(), []);
  const revoked = await run('revoke', '--feeders');
  assert.equal(revoked.code, 0, revoked.stderr);
  const restored = fs.readFileSync(path.join(paths.codexHome, 'config.toml'), 'utf8');
  assert.match(restored, /bearer_token_env_var = "X1_TEST_COOLIFY_TOKEN"/);
  assert.doesNotMatch(restored, /http_headers_helper/);
  assert.ok(store.peek('X1_TEST_COOLIFY_TOKEN'));
});

test('Codex: an editor that changes more than the planned keys is refused and the config is untouched', { skip: !TOML_AVAILABLE && 'needs Python 3.11+ tomllib' }, async (t) => {
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const sloppy = async (bytes, options) => {
    const edited = await fakeCodexEditor()(bytes, options);
    return { bytes: Buffer.from(edited.bytes.toString('utf8').replace('model = "test-model"', 'model = "other"')) };
  };
  const feeder = codexSetup(t, paths, { editor: sloppy });
  const { run } = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: sentinel() }, answers: ['yes'], feeders: [feeder] });
  const result = await run('connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN', '--harness', 'codex');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /changed more than the planned keys/);
  assert.equal(fs.readFileSync(path.join(paths.codexHome, 'config.toml'), 'utf8'), CODEX_CONFIG);
});

test('Codex: entries with a fixed token or no URL are not connected', { skip: !TOML_AVAILABLE && 'needs Python 3.11+ tomllib' }, (t) => {
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const feeder = codexSetup(t, paths, { config: `${CODEX_CONFIG}\n[mcp_servers.fixed]\nurl = "https://x.example.test"\nbearer_token = "inline"\n` });
  const binding = (server) => ({ harness: 'codex', server, name: 'X1_TEST_COOLIFY_TOKEN', header: 'Authorization', scheme: 'Bearer' });
  assert.match(feeder.plan(binding('fixed')).hold, /fixed bearer token/);
  assert.match(feeder.plan(binding('other')).hold, /not an HTTP entry/);
  assert.match(feeder.plan(binding('absent')).hold, /no MCP entry with that name/);
});

// A stand-in `claude` CLI for `mcp remove` and `mcp add-json` against a test settings file.
function fakeClaude(t, home, claudeJson) {
  const script = path.join(home, 'fake-claude.cjs');
  const log = path.join(home, 'fake-claude.log');
  fs.writeFileSync(script, [
    "'use strict';",
    "const fs = require('node:fs');",
    `const file = ${JSON.stringify(claudeJson)};`,
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "const data = JSON.parse(fs.readFileSync(file, 'utf8'));",
    "const [group, action, name, json] = process.argv.slice(2);",
    "if (group !== 'mcp') process.exit(2);",
    "if (action === 'remove') { if (!data.mcpServers[name]) process.exit(1); delete data.mcpServers[name]; }",
    "else if (action === 'add-json') data.mcpServers[name] = JSON.parse(json);",
    "else process.exit(2);",
    "fs.writeFileSync(file, JSON.stringify(data, null, 2));",
    '',
  ].join('\n'));
  return { script, log };
}

test('Claude Code: connect sets headersHelper through the claude CLI; revoke restores the old entry', async (t) => {
  const value = sentinel();
  const home = tempHome(t);
  const claudeJson = path.join(home, '.claude.json');
  const interim = 'node "C:/Users/Test/.claude/mcp-helpers/codex-env-bearer.cjs" X1_TEST_COOLIFY_TOKEN';
  fs.writeFileSync(claudeJson, JSON.stringify({ numStartups: 3, mcpServers: { coolify: { type: 'http', url: 'https://coolify.example.test/mcp', headersHelper: interim }, local: { type: 'stdio', command: 'node' } } }));
  const { script, log } = fakeClaude(t, home, claudeJson);
  const feeder = new ClaudeCodeFeeder({ claudeJson, claudeCommand: script, commandFor });
  assert.deepEqual(feeder.interimHelperEntries(), ['coolify']);
  const { run } = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value }, answers: ['yes', 'yes'], feeders: [feeder] });
  const connected = await run('connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN');
  assert.equal(connected.code, 0, connected.stderr);
  assert.match(connected.stdout, /Claude Code coolify: headersHelper reads X1_TEST_COOLIFY_TOKEN .*replaces its current helper/);
  const entry = JSON.parse(fs.readFileSync(claudeJson, 'utf8')).mcpServers.coolify;
  assert.equal(entry.headersHelper, commandFor({ name: 'X1_TEST_COOLIFY_TOKEN', header: 'Authorization', scheme: 'Bearer' }));
  assert.equal(entry.url, 'https://coolify.example.test/mcp');
  assert.deepEqual(feeder.interimHelperEntries(), []);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((call) => call.slice(0, 2).concat(call.slice(-2))), [['mcp', 'remove', '--scope', 'user'], ['mcp', 'add-json', '--scope', 'user']]);
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), new RegExp(value));
  const plan = await run('connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN');
  assert.match(plan.stdout, /was already connected/);
  const revoked = await run('revoke', '--feeders');
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.equal(JSON.parse(fs.readFileSync(claudeJson, 'utf8')).mcpServers.coolify.headersHelper, interim);
});

test('Claude Code: entries with fixed headers or no HTTP URL are not connected', (t) => {
  const home = tempHome(t);
  const claudeJson = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { fixed: { type: 'http', url: 'https://x.example.test', headers: { Authorization: 'inline' } }, local: { type: 'stdio', command: 'node' } } }));
  const feeder = new ClaudeCodeFeeder({ claudeJson, claudeCommand: 'claude', commandFor });
  const binding = (server) => ({ harness: 'claude-code', server, name: 'X1_TEST_COOLIFY_TOKEN', header: 'Authorization', scheme: 'Bearer' });
  assert.match(feeder.plan(binding('fixed')).hold, /fixed headers/);
  assert.match(feeder.plan(binding('local')).hold, /not an HTTP entry/);
  assert.match(feeder.plan(binding('absent')).hold, /no user MCP entry with that name/);
});

test('the helper command keeps its meaning under cmd.exe /Q /D /C with spaces in both paths', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const home = tempHome(t);
  const folder = path.join(home, 'Program Files', 'Tool kit');
  fs.mkdirSync(folder, { recursive: true });
  const stub = path.join(folder, 'echo args.cjs');
  fs.writeFileSync(stub, 'process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }));');
  const command = helperCommand({ nodePath: process.execPath, scriptPath: stub, name: 'X1_TEST_COOLIFY_TOKEN', header: 'X-Api-Key', scheme: 'none' });
  // The way Codex runs the helper: %COMSPEC% /Q /D /C "<command>", raw.
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/Q', '/D', '/C', `"${command}"`], { windowsVerbatimArguments: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['header', 'X1_TEST_COOLIFY_TOKEN', '--header', 'X-Api-Key', '--scheme', 'none'] });
});

test('no-leak: a sentinel value never reaches output, errors, the record, backups or the Claude CLI arguments', { skip: !TOML_AVAILABLE && 'needs Python 3.11+ tomllib' }, async (t) => {
  const value = sentinel();
  const second = sentinel();
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const codex = codexSetup(t, paths);
  const claudeJson = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { coolify: { type: 'http', url: 'https://coolify.example.test/mcp' } } }));
  const { script, log } = fakeClaude(t, home, claudeJson);
  const claude = new ClaudeCodeFeeder({ claudeJson, claudeCommand: script, commandFor });
  const h = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value }, hidden: [second], answers: ['yes', 'no', 'yes', 'yes'], feeders: [claude, codex] });
  writeCodexEnv(h.paths, `X1_TEST_COOLIFY_TOKEN=${value}\nbroken line\n`);
  const outputs = [];
  for (const argv of [
    ['status'], ['edit', '--no-open'], ['apply'], ['set', 'X1_TEST_SECOND_KEY'], ['import-codex-env'],
    ['connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN'], ['status'], ['remove', 'X1_TEST_SECOND_KEY'],
    ['remove', 'X1_TEST_SECOND_KEY'], ['header', 'X1_TEST_MISSING_KEY'], ['run', '--names', 'X1_TEST_COOLIFY_TOKEN', '--', 'env'],
    ['revoke', '--feeders'], ['retire-codex-env'], ['unknown-command'],
  ]) outputs.push(await h.run(...argv));
  // show under an agent marker and through a pipe, even with the name retyped correctly.
  for (const options of [{ environment: { CLAUDECODE: '1' } }, { tty: { stdin: false, stdout: false } }]) {
    const refused = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value }, typed: ['X1_TEST_COOLIFY_TOKEN'], ...options });
    outputs.push(await refused.run('show', 'X1_TEST_COOLIFY_TOKEN'), await refused.run('show', 'X1_TEST_COOLIFY_TOKEN', '--copy'));
    assert.equal(refused.store.reads, 0);
  }
  const header = await h.run('header', 'X1_TEST_COOLIFY_TOKEN');
  assert.match(header.stdout, new RegExp(value), 'header is the one command that prints the value');
  const everything = [
    ...outputs.flatMap((result) => [result.stdout, result.stderr]),
    header.stderr,
    fs.readFileSync(h.paths.manifest, 'utf8'),
    fs.readFileSync(log, 'utf8'),
    fs.readFileSync(claudeJson, 'utf8'),
    fs.readFileSync(path.join(paths.codexHome, 'config.toml'), 'utf8'),
  ];
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  for (const file of walk(h.paths.backupsDir).filter((name) => !name.endsWith('codex.env'))) everything.push(fs.readFileSync(file, 'utf8'));
  for (const text of everything) {
    assert.doesNotMatch(text, new RegExp(value));
    assert.doesNotMatch(text, new RegExp(second));
  }
});

test('the real command prints help and fails cleanly without printing anything private', () => {
  const help = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /toolkit env keeps your API keys and tokens/);
  const bad = spawnSync(process.execPath, [SCRIPT, 'set', 'lowercase'], { encoding: 'utf8', input: '' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /key names look like .*\(ENV-[0-9A-F]{8}\)/);
});

test('install check: silent until used, then reports missing keys, drift and the old helper by name only', async (t) => {
  const { ToolkitInstallHealthCheck, STATUS } = require('../scripts/toolkit-install-health.cjs');
  const value = sentinel();
  const home = tempHome(t);
  const claudeJson = path.join(home, '.claude.json');
  const interim = 'node "C:/Users/Test/.claude/mcp-helpers/codex-env-bearer.cjs" X1_TEST_COOLIFY_TOKEN';
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { coolify: { type: 'http', url: 'https://coolify.example.test/mcp', headersHelper: interim } } }));
  const { script } = fakeClaude(t, home, claudeJson);
  const claude = new ClaudeCodeFeeder({ claudeJson, claudeCommand: script, commandFor });
  const quiet = harness(t, {});
  assert.equal(quiet.env.health().state, 'not-set-up');
  const h = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: value }, answers: ['yes', 'yes'], feeders: [claude] });
  const old = h.env.health();
  assert.equal(old.state, 'action');
  assert.match(old.actions.join(' '), /coolify entry still uses the old helper that reads ~\/\.codex\/\.env/);
  await h.run('connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN');
  const connected = h.env.health();
  assert.equal(connected.state, 'action', 'the test helper paths do not exist, so the entry must be reconnected');
  assert.match(connected.actions.join(' '), /points at a Node\.js or Toolkit copy that moved/);
  await h.run('remove', 'X1_TEST_COOLIFY_TOKEN');
  const missing = h.env.health();
  assert.match(missing.actions.join(' '), /need keys that are not in the store: X1_TEST_COOLIFY_TOKEN/);
  const check = new ToolkitInstallHealthCheck({
    toolkitRoot: home, expectedVersion: '0.0.0', hubPath: path.join(home, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'current' }), check: () => ({ status: 'current', project_overrides: [] }) },
    globalRules: { refresh: () => ({ status: 'current', files: [], covered: [], backup_dir: null, detail: '' }) },
    depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) },
    envHealth: h.env,
  }).run({});
  const entry = check.checks.find((item) => item.id === 'env');
  assert.equal(entry.status, STATUS.ACTION);
  assert.equal(check.status, STATUS.ACTION);
  assert.doesNotMatch(JSON.stringify(check), new RegExp(value));
  const none = new ToolkitInstallHealthCheck({
    toolkitRoot: home, expectedVersion: '0.0.0', hubPath: path.join(home, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'current' }), check: () => ({ status: 'current', project_overrides: [] }) },
    globalRules: { refresh: () => ({ status: 'current', files: [], covered: [], backup_dir: null, detail: '' }) },
    depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) },
    envHealth: quiet.env,
  }).run({});
  assert.equal(none.checks.some((item) => item.id === 'env'), false);
});

test('programs start without a shell: npm shims run what they wrap, other command scripts are refused', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const { directSpawnParts } = require('../scripts/claude-process-launch.cjs');
  const home = tempHome(t);
  const bin = path.join(home, 'npm bin');
  const tool = path.join(bin, 'node_modules', 'some-tool', 'cli.js');
  const native = path.join(bin, 'node_modules', '@scope', 'native', 'bin', 'native.exe');
  fs.mkdirSync(path.dirname(tool), { recursive: true });
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(tool, '');
  fs.writeFileSync(native, '');
  fs.writeFileSync(path.join(bin, 'some-tool.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\some-tool\\cli.js" %*\r\n');
  fs.writeFileSync(path.join(bin, 'native.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@scope\\native\\bin\\native.exe"   %*\r\n');
  fs.writeFileSync(path.join(bin, 'other.cmd'), '@echo off\r\nset\r\n');
  const env = { PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.deepEqual(directSpawnParts('some-tool', ['--flag', 'a b'], { env }), { command: process.execPath, args: [tool, '--flag', 'a b'] });
  assert.deepEqual(directSpawnParts('native', ['x'], { env }), { command: native, args: ['x'] });
  assert.throws(() => directSpawnParts('other', [], { env }), /not a standard npm shim, so it cannot be started without cmd\.exe/);
});

test('no-leak: a value typed where a name, command, program or option belongs is never repeated', async (t) => {
  const value = sentinel();
  const { run } = harness(t, { values: { X1_TEST_COOLIFY_TOKEN: sentinel() }, hidden: [sentinel()] });
  const results = [];
  for (const argv of [
    ['set', 'X1_TEST_SET_KEY', value],
    ['set', value],
    ['remove', `${value}_X_Y`],
    [value],
    ['header', value],
    ['header', 'X1_TEST_COOLIFY_TOKEN', '--header', `${value}/+=`],
    ['run', '--names', 'X1_TEST_COOLIFY_TOKEN', '--', value],
    ['run', '--names', value, '--', process.execPath],
    ['connect', 'coolify', '--name', 'X1_TEST_COOLIFY_TOKEN', '--harness', value],
    ['connect', value, '--name', 'X1_TEST_COOLIFY_TOKEN'],
    ['status', value],
  ]) results.push(await run(...argv));
  for (const result of results) {
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /\(ENV-[0-9A-F]{8}\)/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value.slice(6)));
  }
});

test('the editor starts by its full path, so a program in the working folder is never picked up', () => {
  const { editorCommand } = require('../scripts/toolkit-env.cjs');
  assert.deepEqual(editorCommand('C:\\x\\f.env', 'win32', { SystemRoot: 'C:\\Windows' }), ['C:\\Windows\\System32\\notepad.exe', ['C:\\x\\f.env']]);
  assert.throws(() => editorCommand('/x/f.txt', 'linux', {}), /supports Windows only; this computer runs linux/);
});

test('the global rules keep every clause and point keys and tokens at toolkit-env', () => {
  const text = fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'agent-rules', 'global-rules.md'), 'utf8');
  assert.match(text, /Work execution-first: inspect, make the smallest safe change, validate, report honestly\./);
  assert.match(text, /make a repository-specific plan before editing\./);
  assert.match(text, /Carry every dependency-ready safe step of authorised work to the actual deliverable/);
  assert.match(text, /Never ask for or repeat a key or token in chat; use `toolkit-env`\./);
});

test('the real wiring takes the home folder from the environment it is given', (t) => {
  const home = tempHome(t);
  const environment = { USERPROFILE: home, HOME: home, SystemRoot: process.env.SystemRoot || 'C:\\Windows' };
  assert.equal(ToolkitEnv.forUser({ environment, toolkitRoot: ROOT, platform: 'linux' }).health().state, 'skipped', 'no key store on a computer Toolkit does not support');
  const env = ToolkitEnv.forUser({ environment, toolkitRoot: ROOT, platform: 'win32' });
  assert.equal(env.health().state, 'not-set-up');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { coolify: { type: 'http', url: 'https://x.example.test', headersHelper: 'node "C:/h/codex-env-bearer.cjs" X1_TEST_COOLIFY_TOKEN' } } }));
  assert.equal(ToolkitEnv.forUser({ environment, toolkitRoot: ROOT, platform: 'win32' }).health().state, 'action');
});

test('no-leak: import and retire report a value on its own .env line by line number only', async (t) => {
  // A value pasted under NAME=, and the last line of a multi-line PEM key: base64 with = padding
  // and no + or /, so the text before = looks like a (non-rule) name.
  const kept = sentinel();
  const tail = `Ab${crypto.randomBytes(12).toString('hex')}Cd`;
  const pem = `Zm${crypto.randomBytes(12).toString('hex')}Q`;
  const { run, paths, store } = harness(t, { answers: ['no'] });
  writeCodexEnv(paths, `X1_TEST_API_KEY=\n${tail}==\nX1_TEST_PEM_KEY="-----BEGIN KEY-----\n${pem}=\n-----END KEY-----"\nX1_TEST_KEPT_KEY=${kept}\n`);
  const imported = await run('import-codex-env');
  assert.equal(imported.code, 0, imported.stderr);
  assert.match(imported.stdout, /^not imported, lines 2, 4: the text before = is not a valid key name/m);
  store.writeAll(new Map([['X1_TEST_KEPT_KEY', kept]]));
  const retire = await run('retire-codex-env');
  assert.match(retire.stdout + retire.stderr, /X1_TEST_API_KEY/);
  for (const result of [imported, retire]) {
    for (const secret of [tail, pem, kept]) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  }
});

test('private folders and files work on Windows paths with non-ASCII characters', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const { ensurePrivateDirectory } = require('../scripts/toolkit-env.cjs');
  const home = tempHome(t);
  const folder = path.join(home, 'Zoë-ü 日本', 'private');
  ensurePrivateDirectory(folder);
  const file = path.join(folder, 'codex.env');
  fs.writeFileSync(file, 'X1_TEST_KEPT_KEY=dummy\n');
  const acl = spawnSync(path.join(process.env.SystemRoot, 'System32', 'icacls.exe'), [folder], { encoding: 'utf8' }).stdout;
  assert.doesNotMatch(acl, /\(I\)|NT AUTHORITY|BUILTIN|Everyone/, acl);
  assert.equal(acl.split(/\r?\n/).filter((line) => /:\(/.test(line)).length, 1, acl);
});

// show: an agent must never be able to read a value through Toolkit.

test('show refuses under every agent marker before the store is read', async (t) => {
  for (const marker of AGENT_MARKERS) {
    const value = sentinel();
    const h = harness(t, { values: { X1_TEST_SHOW_KEY: value }, typed: ['X1_TEST_SHOW_KEY'], environment: { [marker]: '1' } });
    const result = await h.run('show', 'X1_TEST_SHOW_KEY');
    assert.equal(result.code, 1, marker);
    assert.match(result.stderr, /only runs in a PowerShell window you opened yourself/, marker);
    assert.match(result.stderr, /Open PowerShell and run: node ".*toolkit-env\.cjs" show X1_TEST_SHOW_KEY/, marker);
    assert.equal(h.store.reads, 0, marker);
    assert.equal(h.asked.length, 0, marker);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value), marker);
  }
  const empty = harness(t, { values: { X1_TEST_SHOW_KEY: sentinel() }, environment: { CLAUDECODE: '' }, typed: ['X1_TEST_NOPE_KEY'] });
  assert.match((await empty.run('show', 'X1_TEST_SHOW_KEY')).stdout, /^Not shown\.$/m, 'an empty marker is not a marker');
});

test('show needs a terminal on both ends and reads nothing from a pipe', async (t) => {
  for (const tty of [{ stdin: false, stdout: true }, { stdin: true, stdout: false }, { stdin: false, stdout: false }]) {
    const value = sentinel();
    const h = harness(t, { values: { X1_TEST_SHOW_KEY: value }, typed: ['X1_TEST_SHOW_KEY'], tty });
    const result = await h.run('show', 'X1_TEST_SHOW_KEY', '--copy');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /show needs a terminal you type into/);
    assert.equal(h.store.reads, 0);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
  }
});

test('the real show command refuses a pipe, and an agent shell, without touching the store', (t) => {
  const home = tempHome(t);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !AGENT_MARKERS.includes(name)));
  Object.assign(environment, { USERPROFILE: home, HOME: home });
  const piped = spawnSync(process.execPath, [SCRIPT, 'show', 'X1_TEST_SHOW_KEY'], { encoding: 'utf8', input: 'X1_TEST_SHOW_KEY\n', env: environment });
  assert.equal(piped.status, 1, piped.stderr);
  assert.match(piped.stderr, /show needs a terminal you type into/);
  assert.equal(piped.stdout, '');
  const agent = spawnSync(process.execPath, [SCRIPT, 'show', 'X1_TEST_SHOW_KEY'], { encoding: 'utf8', input: 'X1_TEST_SHOW_KEY\n', env: { ...environment, CLAUDECODE: '1' } });
  assert.equal(agent.status, 1, agent.stderr);
  assert.match(agent.stderr, /only runs in a PowerShell window you opened yourself/);
  assert.equal(agent.stdout, '');
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit')), false, 'nothing is written');
});

test('show needs the exact name retyped, and a wrong retype reads nothing', async (t) => {
  for (const answer of ['x1_test_show_key', 'X1_TEST_SHOW_KEY ', ' X1_TEST_SHOW_KEY', '', 'X1_TEST_OTHER_KEY']) {
    const value = sentinel();
    const h = harness(t, { values: { X1_TEST_SHOW_KEY: value }, typed: [answer] });
    const result = await h.run('show', 'X1_TEST_SHOW_KEY');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'Not shown.\n');
    assert.equal(h.store.reads, 0, JSON.stringify(answer));
    assert.deepEqual(h.asked, ['Type X1_TEST_SHOW_KEY again to show its value: ']);
  }
  const missing = harness(t, { values: {}, typed: ['X1_TEST_SHOW_KEY'] });
  const result = await missing.run('show', 'X1_TEST_SHOW_KEY');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /X1_TEST_SHOW_KEY is not in the Toolkit env store/);
  assert.equal(missing.asked.length, 0);
});

test('show prints only the value on stdout and records nothing', async (t) => {
  const value = sentinel();
  const h = harness(t, { hidden: [value], typed: ['X1_TEST_SHOW_KEY'] });
  await h.run('set', 'X1_TEST_SHOW_KEY');
  const before = fs.readFileSync(h.paths.manifest);
  const result = await h.run('show', 'X1_TEST_SHOW_KEY');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${value}\n`);
  assert.equal(result.stderr, 'Shown once. Clear the window when done (Clear-Host) and don\'t paste it into a chat.\n');
  assert.ok(before.equals(fs.readFileSync(h.paths.manifest)), 'the record is unchanged');
});

test('show --copy puts the value on the clipboard and prints nothing to stdout', async (t) => {
  const value = sentinel();
  const copied = [];
  const h = harness(t, { values: { X1_TEST_SHOW_KEY: value }, typed: ['X1_TEST_SHOW_KEY'], clipboard: (text) => { copied.push(text); return true; } });
  const result = await h.run('show', 'X1_TEST_SHOW_KEY', '--copy');
  assert.equal(result.code, 0);
  assert.deepEqual(copied, [value]);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Copied X1_TEST_SHOW_KEY to the clipboard\. Windows clipboard history \(Win\+V\) and clipboard sync/);
  assert.doesNotMatch(result.stderr, new RegExp(value));
  const failing = harness(t, { values: { X1_TEST_SHOW_KEY: value }, typed: ['X1_TEST_SHOW_KEY'], clipboard: () => false });
  const failed = await failing.run('show', 'X1_TEST_SHOW_KEY', '--copy');
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /could not be put on the clipboard/);
  assert.equal(failed.stdout, '');
  assert.doesNotMatch(failed.stderr, new RegExp(value));
});

test('the clipboard writer passes the value on stdin, never in its arguments', () => {
  const value = sentinel();
  const calls = [];
  const fake = (command, args, options) => { calls.push({ command, args, options }); return { status: 0, stdout: 'ok' }; };
  assert.equal(copyToClipboard(value, { platform: 'win32', environment: { SystemRoot: 'C:\\Windows' }, spawn: fake }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.doesNotMatch(calls[0].args.join(' '), new RegExp(value));
  assert.doesNotMatch(calls[0].args.join(' '), new RegExp(Buffer.from(value, 'utf8').toString('base64')));
  assert.equal(calls[0].options.input, Buffer.from(value, 'utf8').toString('base64'));
  const script = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /ExcludeClipboardContentFromMonitorProcessing/);
  assert.equal(copyToClipboard(value, { platform: 'win32', environment: {}, spawn: () => ({ status: 3, stdout: '' }) }), false);
  assert.equal(copyToClipboard(value, { platform: 'linux', environment: {}, spawn: fake }), false);
  assert.equal(calls.length, 1, 'nothing runs on a computer Toolkit does not support');
});

test('show takes exactly one name: no show-all, no extra names', async (t) => {
  for (const argv of [['show'], ['show', 'X1_TEST_SHOW_KEY', 'X1_TEST_OTHER_KEY'], ['show', '--all'], ['show', '--copy']]) {
    const value = sentinel();
    const h = harness(t, { values: { X1_TEST_SHOW_KEY: value, X1_TEST_OTHER_KEY: sentinel() }, typed: ['X1_TEST_SHOW_KEY'] });
    const result = await h.run(...argv);
    assert.equal(result.code, 1, argv.join(' '));
    assert.equal(h.store.reads, 0, argv.join(' '));
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, new RegExp(value));
  }
});

test('the toolkit-env skill tells agents never to run show', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills', 'toolkit-env', 'SKILL.md'), 'utf8');
  const rules = text.slice(text.indexOf('## Rules'), text.indexOf('## After a change'));
  assert.match(rules, /Never run `show`/);
  assert.match(rules, /never ask the user to paste what it printed/);
  assert.match(text, /\| see a key's value .*`show NAME`/);
});

// Commands named in messages: short names for agents, full PowerShell lines for people.

test('commandLine names the command for an agent or as a PowerShell line for a person', (t) => {
  const inHome = harness(t, {});
  const managed = path.join(inHome.home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'toolkit-env.cjs');
  const person = harness(t, { scriptPath: managed });
  const managedHome = path.relative(person.home, managed);
  assert.ok(managedHome.startsWith('..'), 'each harness has its own home');
  const local = new ToolkitEnv({ environment: {}, scriptPath: path.join(inHome.home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'toolkit-env.cjs'), paths: inHome.paths });
  assert.equal(local.commandLine('apply'), `node "$env:USERPROFILE\\${['.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'toolkit-env.cjs'].join('\\')}" apply`);
  assert.equal(person.env.commandLine('apply'), `node "${managed}" apply`, 'outside the home folder: the absolute path, quoted');
  assert.equal(inHome.env.commandLine('status'), `node "${SCRIPT}" status`);
  for (const marker of AGENT_MARKERS) {
    const agent = new ToolkitEnv({ environment: { [marker]: '1' }, scriptPath: managed, paths: inHome.paths });
    assert.equal(agent.commandLine('apply'), 'toolkit env apply', marker);
  }
  for (const line of [local.commandLine('apply'), person.env.commandLine('remove NAME')]) assert.doesNotMatch(line, /%USERPROFILE%/);
});

test('edit tells a person the PowerShell line to apply, and an agent to say done', async (t) => {
  const person = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  const opened = await person.run('edit');
  assert.match(opened.stdout, /When finished, close the tab and run: node ".*toolkit-env\.cjs" apply$/m);
  assert.doesNotMatch(opened.stdout, /say "done"|toolkit env apply/);
  assert.match(opened.stdout, /each save is applied within a few seconds/);
  const header = fs.readFileSync(editFile(person.paths), 'utf8');
  assert.match(header, /^# When you are finished, save, close this tab, then tell your agent "done", or in PowerShell run: node ".*toolkit-env\.cjs" apply\r?$/m);
  assert.match(header, /^# Toolkit env: your keys, with their real values \(edit [0-9a-f]{16}\)\./m);
  assert.match(header, /^# Close any older Toolkit env tab/m);
  assert.doesNotMatch(header, /toolkit env (apply|remove)/);
  const agent = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() }, environment: { CLAUDECODE: '1' } });
  const asked = await agent.run('edit');
  assert.match(asked.stdout, /When finished, close the tab and say "done" \(or run toolkit env apply\)\./);
  assert.match(fs.readFileSync(editFile(agent.paths), 'utf8'), /in PowerShell run: node ".*toolkit-env\.cjs" apply/, 'the file is read by the person either way');
  const unwatched = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() }, startHelper: () => false });
  assert.match((await unwatched.run('edit')).stdout, /your saves are applied when you finish/);
  const none = harness(t, {});
  assert.match((await none.run('apply')).stdout, /There is no open edit\. Ask your agent to show your keys, or run node ".*toolkit-env\.cjs" edit first\./);
  const unknown = await none.run('nope');
  assert.match(unknown.stderr, /That is not a toolkit env command\. Run node ".*toolkit-env\.cjs" help for help\./);
});

test('apply never adopts the header of this or an earlier version as a comment', async (t) => {
  const oldHeader = [
    '# Toolkit env: your keys. Values are never shown here.',
    '# To change a key, replace <unchanged> with the new value (no quotes).',
    '# To add a key, add a line NAME=value. Names look like PROVIDER_SOLUTION_PURPOSE.',
    '# Leaving <unchanged>, a blank value or a deleted line changes nothing.',
    '# To remove a key, use: toolkit env remove NAME',
    '# Your own # comment and section lines are kept (never put a key or token in one).',
    '# Save and close this file, then tell your agent "done" (or run: toolkit env apply).',
  ];
  const fresh = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await fresh.run('edit');
  const file = editFile(fresh.paths);
  fs.appendFileSync(file, '# my own note\n');
  assert.equal((await fresh.run('apply')).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(fresh.paths.manifest, 'utf8')).layout, ['X1_TEST_KEPT_KEY', '# my own note']);
  const old = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await old.run('edit');
  fs.writeFileSync(editFile(old.paths), `${[...oldHeader, '# my own note', `X1_TEST_KEPT_KEY=${old.store.peek('X1_TEST_KEPT_KEY')}`].join('\r\n')}\r\n`);
  const applied = await old.run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(old.paths.manifest, 'utf8')).layout, ['# my own note', 'X1_TEST_KEPT_KEY']);
});

// apply: the cases a person can type in Notepad.

test('apply saves values containing = exactly', async (t) => {
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const based = `${crypto.randomBytes(10).toString('base64')}==`;
  const url = `https://api.example.test/v1?a=${sentinel()}&c=d`;
  const leading = `=${sentinel()}`;
  fs.appendFileSync(editFile(paths), `X1_TEST_BASE_KEY=${based}\nX1_TEST_URL_KEY=${url}\nX1_TEST_LEAD_KEY=${leading}\n`);
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(store.peek('X1_TEST_BASE_KEY'), based);
  assert.equal(store.peek('X1_TEST_URL_KEY'), url);
  assert.equal(store.peek('X1_TEST_LEAD_KEY'), leading);
});

test('apply refuses a value typed in quotes, by line number only', async (t) => {
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const double = sentinel();
  const single = sentinel();
  const inner = `a"${sentinel()}"b`;
  fs.appendFileSync(editFile(paths), `X1_TEST_DOUBLE_KEY="${double}"\nX1_TEST_SINGLE_KEY='${single}'\nX1_TEST_INNER_KEY=${inner}\n`);
  const result = await run('apply');
  assert.equal(result.code, 1);
  assert.equal((result.stderr.match(/remove the quotes around the value/g) || []).length, 2);
  for (const secret of [double, single, inner]) assert.ok(!(result.stdout + result.stderr).includes(secret));
  assert.equal(store.peek('X1_TEST_DOUBLE_KEY'), undefined);
  assert.equal(store.peek('X1_TEST_INNER_KEY'), undefined, 'nothing is saved when any line is wrong');
});

test('apply saves the value right after a byte order mark, and trims spaces around values', async (t) => {
  const { run, paths, store } = harness(t, { values: {} });
  await run('edit');
  const value = sentinel();
  const spaced = sentinel();
  fs.writeFileSync(editFile(paths), `\uFEFFX1_TEST_BOM_KEY=${value}\r\nX1_TEST_SPACE_KEY =   ${spaced}   \r\n`);
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.deepEqual(store.list(), ['X1_TEST_BOM_KEY', 'X1_TEST_SPACE_KEY']);
  assert.equal(store.peek('X1_TEST_BOM_KEY'), value);
  assert.equal(store.peek('X1_TEST_SPACE_KEY'), spaced);
  await run('edit');
  assert.match(fs.readFileSync(editFile(paths), 'utf8'), /No quotes; spaces at either end are dropped/);
});

test('apply overwrites the edit file with zeros before deleting it', async (t) => {
  const { run, paths } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const file = editFile(paths);
  fs.appendFileSync(file, `X1_TEST_ADDED_KEY=${sentinel()}\n`);
  const size = fs.statSync(file).size;
  const writes = [];
  const original = fs.writeFileSync;
  fs.writeFileSync = function spy(target, data, ...rest) {
    if (target === file) writes.push(Buffer.from(data));
    return original.call(this, target, data, ...rest);
  };
  try { assert.equal((await run('apply')).code, 0); }
  finally { fs.writeFileSync = original; }
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, size);
  assert.ok(writes[0].every((byte) => byte === 0));
  assert.equal(fs.existsSync(file), false);
});

test('an edit file of an earlier version is wiped, never applied', async (t) => {
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const value = sentinel();
  fs.appendFileSync(editFile(paths), `X1_TEST_ADDED_KEY=${value}\n`);
  const earlier = path.join(paths.editDir, 'env-edit-2026-10-30T10-00-00-000Z-abc123.txt');
  fs.writeFileSync(earlier, `X1_TEST_KEPT_KEY=<unchanged>\nX1_TEST_OTHER_KEY=${sentinel()}\n`);
  const result = await run('apply');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Deleted 1 edit file from an earlier Toolkit version; nothing in it was saved\./);
  assert.equal(fs.existsSync(earlier), false);
  assert.equal(store.peek('X1_TEST_ADDED_KEY'), value);
  assert.equal(store.peek('X1_TEST_OTHER_KEY'), undefined);
  assert.notEqual(store.peek('X1_TEST_KEPT_KEY'), '<unchanged>');
});

test('a .txt edit file with a current-style id is from an earlier version: wiped, never applied', async (t) => {
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const earlier = path.join(paths.editDir, 'env-edit-0123456789abcdef.txt');
  fs.writeFileSync(earlier, `X1_TEST_OTHER_KEY=${sentinel()}\n`);
  const result = await run('apply');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Deleted 1 edit file from an earlier Toolkit version; nothing in it was saved\./);
  assert.doesNotMatch(result.stdout, /older Notepad tab/);
  assert.equal(fs.existsSync(earlier), false);
  assert.equal(store.peek('X1_TEST_OTHER_KEY'), undefined);
});

test('an update in the middle of an edit: done reports the saves already applied and stores nothing from the .txt file', async (t) => {
  const { run, env, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  // What the earlier version leaves: its session, its .txt edit file, the names its helper saved and its helper's lock.
  const { id } = editState(paths);
  const earlier = path.join(paths.editDir, `env-edit-${id}.txt`);
  fs.renameSync(editFile(paths), earlier);
  fs.appendFileSync(earlier, `X1_TEST_UNSAVED_KEY=${sentinel()}\n`);
  fs.writeFileSync(path.join(paths.editDir, 'last-result.json'), JSON.stringify({ changed: [], added: ['X1_TEST_SAVED_KEY'], removed: [], notes: [] }));
  fs.writeFileSync(path.join(paths.editDir, 'watch.lock'), JSON.stringify({ id, pid: 999999 }));
  const before = store.writes;
  const result = await run('apply');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Deleted 1 edit file from an earlier Toolkit version; saves already applied from it are listed with your other saves, and nothing else in it was saved\./);
  assert.doesNotMatch(result.stdout, /nothing in it was saved/);
  assert.match(result.stdout, /^Saved, added: X1_TEST_SAVED_KEY$/m);
  assert.equal(fs.existsSync(earlier), false);
  assert.equal(fs.existsSync(path.join(paths.editDir, 'session.json')), false);
  assert.equal(store.peek('X1_TEST_UNSAVED_KEY'), undefined);
  assert.equal(store.writes, before, 'nothing from the .txt file is stored');
  // The next edit gets its own helper although the earlier helper's lock is still there.
  await run('edit');
  assert.equal(env.editWatcher(editFile(paths), { pid: 801, alive: () => true }).start(), true);
});

test('apply says plainly when the edit file was saved as UTF-16', async (t) => {
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const file = editFile(paths);
  const value = sentinel();
  for (const bom of [Buffer.from([0xff, 0xfe]), Buffer.from([0xfe, 0xff])]) {
    const body = Buffer.from(`X1_TEST_ADDED_KEY=${value}\r\n`, 'utf16le');
    fs.writeFileSync(file, Buffer.concat([bom, bom[0] === 0xfe ? body.swap16() : body]));
    const result = await run('apply');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /the file is saved as UTF-16; in Notepad use File > Save as with Encoding UTF-8/);
    assert.doesNotMatch(result.stderr, /is not NAME=value/);
    assert.equal(store.peek('X1_TEST_ADDED_KEY'), undefined);
    assert.ok(fs.existsSync(file));
  }
});

// Every save is applied: the helper, done, conflicts, older tabs and Notepad's tab-restore copy.

function clockAt(iso = '2026-10-31T09:00:00.000Z') { return { ms: Date.parse(iso) }; }

// What a save in Notepad does to the file: new bytes, a new modified time.
function save(file, text) {
  fs.writeFileSync(file, text);
  const later = new Date(fs.statSync(file).mtimeMs + 1000);
  fs.utimesSync(file, later, later);
}

function storeImage(h) { return JSON.stringify(h.store.list().map((name) => [name, h.store.peek(name)])); }

function editState(paths) { return JSON.parse(fs.readFileSync(path.join(paths.editDir, 'session.json'), 'utf8')); }

test('the helper applies each save once the file has been still for 1.5 seconds, once per save', async (t) => {
  const clock = clockAt();
  const old = sentinel();
  const fresh = sentinel();
  const h = harness(t, { clock, values: { X1_TEST_KEPT_KEY: old, X1_TEST_GONE_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const watcher = h.env.editWatcher(file, { pid: 101, alive: () => true });
  assert.equal(watcher.start(), true);
  assert.equal(watcher.tick(), true);
  save(file, fs.readFileSync(file, 'utf8').replace(old, fresh).replace(/^X1_TEST_GONE_KEY=.*$/m, ''));
  assert.equal(watcher.tick(), true, 'a new save starts the wait');
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), old, 'not applied before the file is still');
  clock.ms += 1000;
  watcher.tick();
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), old);
  clock.ms += 600;
  watcher.tick();
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), fresh);
  assert.equal(h.store.peek('X1_TEST_GONE_KEY'), undefined);
  const writes = h.store.writes;
  clock.ms += 5000;
  watcher.tick();
  watcher.tick();
  assert.equal(h.store.writes, writes, 'the same save is never applied twice');
  // done reports what the helper saved, and applies nothing again.
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^changed: X1_TEST_KEPT_KEY$/m);
  assert.match(done.stdout, /^removed: X1_TEST_GONE_KEY$/m);
  assert.equal(h.store.writes, writes);
  assert.equal(watcher.tick(), false, 'the helper ends once its file has gone');
  assert.deepEqual(fs.readdirSync(h.paths.editDir), []);
  assert.ok(!(done.stdout + done.stderr).includes(fresh));
});

test('done applies a save the helper has not applied yet', async (t) => {
  const value = sentinel();
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  save(file, `${fs.readFileSync(file, 'utf8')}X1_TEST_ADDED_KEY=${value}\n`);
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^added: X1_TEST_ADDED_KEY$/m);
  assert.equal(h.store.peek('X1_TEST_ADDED_KEY'), value);
});

test('one helper per edit: a second helper for the same file stops, and an older helper stops when a new edit starts', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const first = h.env.editWatcher(file, { pid: 201, alive: () => true });
  assert.equal(first.start(), true);
  const twin = h.env.editWatcher(file, { pid: 202, alive: () => true });
  assert.equal(twin.start(), false, 'a live helper already watches this file');
  const afterDeath = h.env.editWatcher(file, { pid: 203, alive: () => false });
  assert.equal(afterDeath.start(), true, 'a helper that died is replaced');
  assert.equal(first.tick(), false, 'the replaced helper stops');
  await h.run('edit');
  assert.equal(afterDeath.tick(), false, 'a new edit ends the old helper');
  assert.equal(h.env.editWatcher(file, { pid: 204, alive: () => true }).start(), false, 'no helper for a file that is not the open edit');
});

test('the helper only follows an edit file in the edit folder', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const { id } = editState(h.paths);
  for (const file of [path.join(h.home, `env-edit-${id}.env`), path.join(h.paths.editDir, `env-edit-${id}.txt`), path.join(h.paths.editDir, 'session.json'), path.join(h.paths.editDir, 'other.txt'), '']) {
    assert.throws(() => h.env.editWatcher(file), /watch only follows a Toolkit env edit file in its own folder/);
  }
  assert.equal(h.env.editWatcher(path.join(h.paths.editDir, `env-edit-${id}.env`), { pid: 701, alive: () => true }).start(), true);
});

test('the real helper starts as `watch <file>` with no other arguments, no window and no output', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const starter = /function defaultHelperStarter\(file\) \{[\s\S]*?\n\}/.exec(source)[0];
  assert.match(starter, /spawn\(process\.execPath, \[__filename, 'watch', file\], \{ detached: true, stdio: 'ignore', windowsHide: true \}\)/);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-watch-'));
  try {
    const result = spawnSync(process.execPath, [SCRIPT, 'watch', path.join(home, 'not-an-edit-file.txt')], { encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home } });
    assert.equal(result.stdout, '');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('an edit ends 30 minutes after its last save: the file is wiped and done says so', async (t) => {
  const clock = clockAt();
  const h = harness(t, { clock, values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const watcher = h.env.editWatcher(file, { pid: 301, alive: () => true });
  watcher.start();
  clock.ms += 29 * 60 * 1000;
  assert.equal(watcher.tick(), true);
  clock.ms += 61 * 1000;
  assert.equal(watcher.tick(), false);
  assert.equal(fs.existsSync(file), false);
  const done = await h.run('apply');
  assert.match(done.stdout, /Closed your env edit 30 minutes after its last save\./);
  // With no helper at all, the next command does the same.
  await h.run('edit');
  const second = editFile(h.paths);
  clock.ms += 31 * 60 * 1000;
  const status = await h.run('status');
  assert.match(status.stdout, /Closed your env edit 30 minutes after its last save\./);
  assert.equal(fs.existsSync(second), false);
});

test('a save that would remove every key is not applied, and the store stays exactly as it was', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel(), X1_TEST_OTHER_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const before = storeImage(h);
  const manifest = fs.existsSync(h.paths.manifest) ? fs.readFileSync(h.paths.manifest) : null;
  save(file, fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.startsWith('#')).join('\r\n'));
  const done = await h.run('apply');
  assert.equal(done.code, 1);
  assert.match(done.stderr, /Nothing was saved: this save would remove every key/);
  assert.equal(storeImage(h), before);
  assert.deepEqual(fs.existsSync(h.paths.manifest) ? fs.readFileSync(h.paths.manifest) : null, manifest);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED \(\d\d:\d\d UTC\)\. This save would remove every key\.\r?$/m);
  // An empty file is the same.
  save(file, '');
  assert.match((await h.run('apply')).stderr, /would remove every key/);
  assert.equal(storeImage(h), before);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED \(\d\d:\d\d UTC\)\. This save would remove every key\.\r?\n$/, 'a deleted status line comes back at the top');
});

test('keys changed elsewhere while the tab is open stop the whole save, by name only', async (t) => {
  for (const [label, elsewhere, edit] of [
    ['set elsewhere, line untouched', (h) => h.store.writeAll(new Map([['X1_TEST_KEPT_KEY', sentinel()]])), (text) => text],
    ['set elsewhere, line changed too', (h) => h.store.writeAll(new Map([['X1_TEST_KEPT_KEY', sentinel()]])), (text) => text.replace(/^X1_TEST_KEPT_KEY=.*$/m, `X1_TEST_KEPT_KEY=${sentinel()}`)],
    ['removed elsewhere, still listed', (h) => h.store.remove('X1_TEST_KEPT_KEY'), (text) => text],
    ['added elsewhere and typed here differently', (h) => h.store.writeAll(new Map([['X1_TEST_NEW_KEY', sentinel()]])), (text) => `${text}X1_TEST_NEW_KEY=${sentinel()}\n`],
    ['set elsewhere, line deleted here', (h) => h.store.writeAll(new Map([['X1_TEST_KEPT_KEY', sentinel()]])), (text) => text.replace(/^X1_TEST_KEPT_KEY=.*$/m, '')],
  ]) await t.test(label, async (t) => {
    const clock = clockAt();
    const h = harness(t, { clock, values: { X1_TEST_KEPT_KEY: sentinel(), X1_TEST_OTHER_KEY: sentinel() } });
    await h.run('edit');
    const file = editFile(h.paths);
    clock.ms += 1000;
    elsewhere(h);
    // Elsewhere means another toolkit env command, which records the change.
    const touched = h.store.list().includes('X1_TEST_NEW_KEY') ? 'X1_TEST_NEW_KEY' : 'X1_TEST_KEPT_KEY';
    new EnvManifest({ file: h.paths.manifest, now: () => new Date(clock.ms) }).update((record, at) => {
      if (h.store.list().includes(touched)) record.names[touched] = { added_at: at, updated_at: at };
      else delete record.names[touched];
    });
    const before = storeImage(h);
    const manifest = fs.readFileSync(h.paths.manifest);
    clock.ms += 1000;
    save(file, `${edit(fs.readFileSync(file, 'utf8'))}X1_TEST_EXTRA_KEY=${sentinel()}\n`);
    const done = await h.run('apply');
    assert.equal(done.code, 1, label);
    assert.match(done.stderr, new RegExp(`Your keys changed while this tab was open, so nothing was saved: ${touched}\\. Ask for your keys again for a fresh tab`));
    assert.equal(storeImage(h), before);
    assert.deepEqual(fs.readFileSync(h.paths.manifest), manifest);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`^# Status: NOT SAVED .*These keys changed while this tab was open: ${touched}\\.`, 'm'));
  });
});

test('a key added elsewhere while the tab is open is never removed by it', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const added = sentinel();
  h.store.writeAll(new Map([['X1_TEST_NEW_KEY', added]]));
  save(file, `${fs.readFileSync(file, 'utf8')}X1_TEST_EXTRA_KEY=${sentinel()}\n`);
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.equal(h.store.peek('X1_TEST_NEW_KEY'), added);
  assert.match(done.stdout, /^added: X1_TEST_EXTRA_KEY$/m);
});

test('a value one line cannot hold exactly shows the kept marker and stays as it is', async (t) => {
  const values = {
    X1_TEST_LINES_KEY: `${sentinel()}\n${sentinel()}`,
    X1_TEST_SPACES_KEY: ` ${sentinel()} `,
    X1_TEST_QUOTED_KEY: `"${sentinel()}"`,
    X1_TEST_PLAIN_KEY: sentinel(),
  };
  const h = harness(t, { values });
  await h.run('edit');
  const file = editFile(h.paths);
  const text = fs.readFileSync(file, 'utf8');
  assert.deepEqual(bodyOf(text), [
    'X1_TEST_LINES_KEY=<kept: change it with toolkit env set X1_TEST_LINES_KEY>',
    `X1_TEST_PLAIN_KEY=${values.X1_TEST_PLAIN_KEY}`,
    'X1_TEST_QUOTED_KEY=<kept: change it with toolkit env set X1_TEST_QUOTED_KEY>',
    'X1_TEST_SPACES_KEY=<kept: change it with toolkit env set X1_TEST_SPACES_KEY>',
  ]);
  save(file, `${text}X1_TEST_ADDED_KEY=${sentinel()}\n`);
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^added: X1_TEST_ADDED_KEY$/m);
  assert.doesNotMatch(done.stdout, /changed:/);
  for (const [name, value] of Object.entries(values)) assert.equal(h.store.peek(name), value);
  // The marker only stands for its own key.
  await h.run('edit');
  const next = editFile(h.paths);
  save(next, fs.readFileSync(next, 'utf8').replace('X1_TEST_LINES_KEY=<kept', 'X1_TEST_MOVED_KEY=<kept'));
  const moved = await h.run('apply');
  assert.equal(moved.code, 1);
  assert.match(moved.stderr, /line \d+: a <kept: \.\.\.> line works only for the key it was written for/);
  assert.equal(h.store.peek('X1_TEST_LINES_KEY'), values.X1_TEST_LINES_KEY);
});

test('a save from an older tab after a new edit is ignored and wiped; the new file always equals the store', async (t) => {
  const kept = sentinel();
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: kept, X1_TEST_GONE_KEY: sentinel() }, answers: ['yes'] });
  await h.run('edit');
  const older = editFile(h.paths);
  const olderText = fs.readFileSync(older, 'utf8');
  await h.run('remove', 'X1_TEST_GONE_KEY');
  await h.run('edit');
  const newer = editFile(h.paths);
  assert.equal(fs.existsSync(older), false);
  // Notepad saves the older tab back to its own path, with a changed value and the removed key.
  const before = storeImage(h);
  fs.writeFileSync(older, olderText.replace(kept, sentinel()));
  const watcher = h.env.editWatcher(newer, { pid: 401, alive: () => true });
  watcher.start();
  assert.equal(watcher.tick(), true);
  assert.equal(fs.existsSync(older), false, 'the helper wipes the older tab at once');
  assert.equal(storeImage(h), before);
  const done = await h.run('apply');
  assert.match(done.stdout, /An older Notepad tab was saved and ignored\. Use the newest tab; close the older one\. Its lines for X1_TEST_GONE_KEY, X1_TEST_KEPT_KEY differ from what is stored/);
  assert.equal(storeImage(h), before);
  // Without a helper, the next command wipes it the same way.
  await h.run('edit');
  const third = editFile(h.paths);
  fs.writeFileSync(newer, 'X1_TEST_KEPT_KEY=whatever\n');
  const status = await h.run('status');
  assert.match(status.stdout, /An older Notepad tab was saved and ignored/);
  assert.deepEqual(editFiles(h.paths), [path.basename(third)]);
  assert.deepEqual(bodyOf(fs.readFileSync(third, 'utf8')), [`X1_TEST_KEPT_KEY=${kept}`]);
});

test('a new edit after a refused save says the last save was not applied, and shows the store', async (t) => {
  const kept = sentinel();
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: kept } });
  await h.run('edit');
  const file = editFile(h.paths);
  save(file, `${fs.readFileSync(file, 'utf8')}not a line\n`);
  assert.equal((await h.run('apply')).code, 1);
  const again = await h.run('edit');
  assert.match(again.stdout, /Your last save in the earlier tab was not applied; the new file shows what is stored now\./);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(bodyOf(fs.readFileSync(editFile(h.paths), 'utf8')), [`X1_TEST_KEPT_KEY=${kept}`]);
});

test('every end of an edit says to close the Notepad tab, since Notepad can keep its own copy', async (t) => {
  const note = /Close the Toolkit env tab in Notepad without saving: Notepad can keep its own copy of an open tab and bring it back\. To stop that for good, set Notepad > Settings > When Notepad starts to "Start new session"\./;
  const clock = clockAt();
  const h = harness(t, { clock, values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  assert.match((await h.run('apply')).stdout, note, 'done');
  await h.run('edit');
  clock.ms += 31 * 60 * 1000;
  assert.match((await h.run('status')).stdout, note, 'the 30-minute end');
  assert.doesNotMatch((await h.run('apply')).stdout, note, 'no open edit, no note');
});

// The closure matrix of the edit (states E0 to E3 against each event), as one table.
test('edit closure matrix: every state and event ends as the plan says', async (t) => {
  const E = {
    E0: async () => {},
    E1: async (h) => { await h.run('edit'); },
    E2: async (h, clock) => { await h.run('edit'); clock.ms += 31 * 60 * 1000; },
    E3: async (h) => { await h.run('edit'); const older = editFile(h.paths); await h.run('edit'); fs.writeFileSync(older, `X1_TEST_KEPT_KEY=${sentinel()}\n`); },
  };
  const rows = [
    ['E0', 'edit', { files: 1, out: /^Opened /m }],
    ['E1', 'edit', { files: 1, out: /^Opened /m }],
    ['E2', 'edit', { files: 1, out: /Closed your env edit 30 minutes after its last save/ }],
    ['E3', 'edit', { files: 1, out: /An older Notepad tab was saved and ignored/ }],
    ['E1', 'save', { files: 1, applied: true }],
    ['E3', 'save', { files: 1, applied: true }],
    ['E1', 'bad save', { files: 1, applied: false, code: 1 }],
    ['E0', 'done', { files: 0, out: /There is no open edit/ }],
    ['E1', 'done', { files: 0, out: /No changes\./ }],
    ['E2', 'done', { files: 0, out: /Closed your env edit 30 minutes after its last save/ }],
    ['E3', 'done', { files: 0, out: /An older Notepad tab was saved and ignored/ }],
    ['E1', 'set elsewhere then save', { files: 1, applied: false, code: 1 }],
  ];
  for (const [state, event, expect] of rows) await t.test(`${state} ${event}`, async (t) => {
    const clock = clockAt();
    const kept = sentinel();
    const h = harness(t, { clock, values: { X1_TEST_KEPT_KEY: kept }, hidden: [sentinel()] });
    await E[state](h, clock);
    let result = { code: 0, stdout: '', stderr: '' };
    const added = sentinel();
    if (event === 'edit') result = await h.run('edit');
    else if (event === 'done') result = await h.run('apply');
    else {
      if (event === 'set elsewhere then save') { clock.ms += 1000; await h.run('set', 'X1_TEST_KEPT_KEY'); clock.ms += 1000; }
      const file = path.join(h.paths.editDir, `env-edit-${editState(h.paths).id}.env`);
      const watcher = h.env.editWatcher(file, { pid: 501, alive: () => true });
      watcher.start();
      save(file, `${fs.readFileSync(file, 'utf8')}${event === 'bad save' ? 'not a line' : `X1_TEST_ADDED_KEY=${added}`}\n`);
      watcher.tick();
      clock.ms += 2000;
      watcher.tick();
      result = await h.run('status');
      if (expect.code) result = { ...result, code: (await h.run('apply')).code };
    }
    assert.equal(result.code, expect.code || 0, result.stderr);
    if (expect.out) assert.match(result.stdout, expect.out);
    assert.equal(editFiles(h.paths).length, expect.files);
    if ('applied' in expect) assert.equal(h.store.peek('X1_TEST_ADDED_KEY') === added, expect.applied);
    for (const text of [result.stdout, result.stderr]) { assert.ok(!text.includes(kept)); assert.ok(!text.includes(added)); }
    for (const name of fs.existsSync(h.paths.editDir) ? fs.readdirSync(h.paths.editDir).filter((entry) => entry.endsWith('.json')) : []) {
      const text = fs.readFileSync(path.join(h.paths.editDir, name), 'utf8');
      assert.ok(!text.includes(kept) && !text.includes(added), `${name} holds names only`);
    }
  });
});

test('the toolkit-env skill opens Notepad from context, keeps names-only questions on status, and never touches the edit file', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'toolkit-env', 'SKILL.md'), 'utf8');
  assert.match(skill, /^description: .*see, check, change, add or remove/m);
  assert.match(skill, /Never open, read, write, search or list the edit file/);
  assert.match(skill, /names-only question/);
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'tests', 'fixtures', 'toolkit-env-edit-routing.json'), 'utf8'));
  assert.ok(cases.open.length >= 10);
  assert.ok(cases.not_open.length >= 5);
});

test('a key changed outside Toolkit while the tab is open (no record) is still a conflict', async (t) => {
  const kept = sentinel();
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: kept, X1_TEST_OTHER_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  // Straight into the store, as Credential Manager or another tool would: no manifest change.
  h.store.writeAll(new Map([['X1_TEST_KEPT_KEY', sentinel()]]));
  const before = storeImage(h);
  save(file, `${fs.readFileSync(file, 'utf8')}X1_TEST_EXTRA_KEY=${sentinel()}\n`);
  const done = await h.run('apply');
  assert.equal(done.code, 1);
  assert.match(done.stderr, /Your keys changed while this tab was open, so nothing was saved: X1_TEST_KEPT_KEY\./);
  assert.equal(storeImage(h), before);
  assert.ok(!fs.readFileSync(path.join(h.paths.editDir, 'session.json'), 'utf8').includes(kept), 'the state holds hashes, never values');
});

test('after an applied save, the tab can be saved again without a false conflict', async (t) => {
  const clock = clockAt();
  const h = harness(t, { clock, values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const watcher = h.env.editWatcher(file, { pid: 601, alive: () => true });
  watcher.start();
  const first = sentinel();
  const second = sentinel();
  save(file, fs.readFileSync(file, 'utf8').replace(/^X1_TEST_KEPT_KEY=.*$/m, `X1_TEST_KEPT_KEY=${first}`));
  watcher.tick(); clock.ms += 2000; watcher.tick();
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), first);
  clock.ms += 1000;
  save(file, fs.readFileSync(file, 'utf8').replace(first, second));
  watcher.tick(); clock.ms += 2000; watcher.tick();
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), second);
});

test('a refused save writes its status line only if the file still holds the bytes it checked', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  const session = new EnvEditSession({ directory: h.paths.editDir, privateDirectory: noPrivateDirectory });
  const checked = fs.readFileSync(file);
  const newer = `${checked.toString('utf8')}X1_TEST_NEWER_KEY=${sentinel()}\n`;
  fs.writeFileSync(file, newer);
  assert.equal(session.writeStatus(file, () => 'NOT SAVED', checked), null);
  assert.equal(fs.readFileSync(file, 'utf8'), newer, 'the newer save is untouched');
  const now = fs.readFileSync(file);
  assert.ok(session.writeStatus(file, () => 'NOT SAVED', now));
  assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED\r?$/m);
});

test('emptying the tab is refused even when a key was added elsewhere meanwhile', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel(), X1_TEST_OTHER_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  h.store.writeAll(new Map([['X1_TEST_NEW_KEY', sentinel()]]));
  const before = storeImage(h);
  save(file, '');
  const done = await h.run('apply');
  assert.equal(done.code, 1);
  assert.match(done.stderr, /this save would remove every key/);
  assert.equal(storeImage(h), before);
});

test('deleting some listed lines is still applied', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel(), X1_TEST_GONE_KEY: sentinel() } });
  await h.run('edit');
  const file = editFile(h.paths);
  save(file, fs.readFileSync(file, 'utf8').replace(/^X1_TEST_GONE_KEY=.*$/m, ''));
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^removed: X1_TEST_GONE_KEY$/m);
});

test('the save lock is taken over only when its holder has ended, or after two minutes', async (t) => {
  const h = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await h.run('edit');
  const lock = path.join(h.paths.editDir, 'apply.lock');
  const session = (alive) => new EnvEditSession({ directory: h.paths.editDir, privateDirectory: noPrivateDirectory, alive, lockWaitMs: 300 });
  // A live holder, however old its lock under two minutes: wait, then say busy.
  fs.writeFileSync(lock, JSON.stringify({ pid: 4242, started_at: new Date().toISOString() }));
  const twentySeconds = new Date(Date.now() - 20 * 1000);
  fs.utimesSync(lock, twentySeconds, twentySeconds);
  assert.throws(() => session(() => true).withLock(() => 'ran'), (error) => error.busy === true && /saving your keys right now/.test(error.message));
  assert.ok(fs.existsSync(lock), 'a live holder keeps its lock');
  // The holder has ended: taken over at once.
  assert.equal(session(() => false).withLock(() => 'ran'), 'ran');
  assert.equal(fs.existsSync(lock), false, 'released after the work');
  // A live holder past the two-minute ceiling: taken over as a last resort.
  fs.writeFileSync(lock, JSON.stringify({ pid: 4242, started_at: new Date().toISOString() }));
  const old = new Date(Date.now() - 121 * 1000);
  fs.utimesSync(lock, old, old);
  assert.equal(session(() => true).withLock(() => 'ran'), 'ran');
  // While held, the lock names this process.
  session(() => true).withLock(() => {
    const holder = JSON.parse(fs.readFileSync(lock, 'utf8'));
    assert.equal(holder.pid, process.pid);
    assert.ok(!Number.isNaN(Date.parse(holder.started_at)));
  });
});
