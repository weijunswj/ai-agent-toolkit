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
  EnvEditSession, EnvManifest, EnvPaths, ToolkitEnv, ToolkitEnvCli, dumpsEnvironment, parseDotEnv,
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

function harness(t, { values = {}, answers = [], hidden = [], feeders = [], corruptReadBack = [], opener } = {}) {
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const store = new FakeEnvStore({ values, corruptReadBack });
  const asked = [];
  const env = new ToolkitEnv({
    store,
    manifest: new EnvManifest({ file: paths.manifest }),
    editSession: new EnvEditSession({ directory: paths.editDir, opener: opener || (async () => true), privateDirectory: noPrivateDirectory }),
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
  return { home, paths, store, env, run, asked };
}

function editFile(paths) {
  return path.join(paths.editDir, fs.readdirSync(paths.editDir).find((name) => name.endsWith('.txt')));
}

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

test('edit then apply: unchanged lines stay, changed and added keys are saved, blank is never a delete', async (t) => {
  const kept = sentinel();
  const old = sentinel();
  const fresh = sentinel();
  const added = sentinel();
  const { run, paths, store } = harness(t, { values: { X1_TEST_KEPT_KEY: kept, X1_TEST_CHANGED_KEY: old, X1_TEST_BLANK_KEY: sentinel() } });
  const opened = await run('edit');
  assert.equal(opened.code, 0);
  assert.match(opened.stdout, /Opened ~\/\.ai-agent-toolkit\/env\/edit\/env-edit-.*\.txt with your 3 keys/);
  const file = editFile(paths);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^X1_TEST_KEPT_KEY=<unchanged>$/m);
  assert.doesNotMatch(text, new RegExp(`${kept}|${old}`));
  fs.writeFileSync(file, text
    .replace('X1_TEST_CHANGED_KEY=<unchanged>', `X1_TEST_CHANGED_KEY=${fresh}`)
    .replace('X1_TEST_BLANK_KEY=<unchanged>', 'X1_TEST_BLANK_KEY=')
    .concat(`X1_TEST_ADDED_KEY = ${added}\r\n`));
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /^changed: X1_TEST_CHANGED_KEY$/m);
  assert.match(applied.stdout, /^added: X1_TEST_ADDED_KEY$/m);
  assert.match(applied.stdout, /1 blank value was ignored/);
  assert.equal(store.peek('X1_TEST_CHANGED_KEY'), fresh);
  assert.equal(store.peek('X1_TEST_ADDED_KEY'), added);
  assert.equal(store.peek('X1_TEST_KEPT_KEY'), kept);
  assert.ok(store.peek('X1_TEST_BLANK_KEY'));
  assert.equal(fs.existsSync(file), false, 'the edit file is deleted after apply');
  for (const secret of [kept, old, fresh, added]) assert.doesNotMatch(applied.stdout + applied.stderr, new RegExp(secret));
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
  fs.appendFileSync(file, `X1_TEST_GOOD_KEY=${value}\nbad_name_here=${value}\nnot a line\nX1_TEST_NEON_URL postgres://user:${spaced}@db.example/db?sslmode=require\n${based}QUJD==\n`);
  const result = await run('apply');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Nothing was saved/);
  assert.match(result.stderr, /line \d+: the text before = is not a valid key name \(key names look like/);
  assert.match(result.stderr, /line \d+ is not NAME=value/);
  for (const secret of [value, spaced, based, 'bad_name_here', 'postgres']) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.equal(store.peek('X1_TEST_GOOD_KEY'), undefined);
  assert.ok(fs.existsSync(file), 'the file is kept so it can be fixed');
});

test('a second edit reopens the open file; an edit file untouched for 30 minutes is deleted', async (t) => {
  const { run, paths } = harness(t, { values: { X1_TEST_KEPT_KEY: sentinel() } });
  await run('edit');
  const reopened = await run('edit');
  assert.match(reopened.stdout, /Reopened/);
  const file = editFile(paths);
  const old = new Date(Date.now() - 31 * 60 * 1000);
  fs.utimesSync(file, old, old);
  const status = await run('status');
  assert.match(status.stdout, /Deleted 1 unfinished edit file older than 30 minutes/);
  assert.equal(fs.existsSync(file), false);
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
    'COOLIFY_SWOOSHZ_MCP_TOKEN=<unchanged>',
    '',
    '# --- Databases (Swooshz team) ---',
    'NEONDB_SWOOSHZ_API_KEY=<unchanged>',
    'CLOUDFLARE_ACCOUNT_ID=<unchanged>',
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
  const body = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => !line.startsWith('# Toolkit env') && !/^# (To |Leaving|Save|Your own)/.test(line));
  assert.deepEqual(body.filter(Boolean), ['# --- Hosting ---', 'COOLIFY_SWOOSHZ_MCP_TOKEN=<unchanged>', '# --- Databases (Swooshz team) ---', 'NEONDB_SWOOSHZ_API_KEY=<unchanged>', 'CLOUDFLARE_ACCOUNT_ID=<unchanged>', 'GITHUB_SWOOSHZ_PAT=<unchanged>']);
  await run('apply');
});

test('a comment that looks like a key or token stops apply and is reported by line number only', async (t) => {
  const value = sentinel();
  const { run, paths } = harness(t, { values: { COOLIFY_SWOOSHZ_MCP_TOKEN: value } });
  await run('edit');
  const file = editFile(paths);
  for (const comment of [`# OLD_TOKEN=${value}`, '# ghp_0123456789abcdefABCDEF0123456789']) {
    fs.writeFileSync(file, [comment, 'COOLIFY_SWOOSHZ_MCP_TOKEN=<unchanged>', ''].join('\n'));
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
    ['spaced assignment', '# Notes (export OLD_TOKEN = dummy-spaced-secret)'],
    ['quoted assignment', '# OLD_TOKEN="dummy quoted value"'],
    ['alphabetic token', '# ghp_abcdefghijklmnopqrstuvwxyzABCDEF'],
    ['short prefixed token', '# sk-abcdefgHIJKLMN'],
    ['base64 without digits', `# ${Buffer.from('a'.repeat(30)).toString('base64')}`],
    ['long base64', `# ${Buffer.from('synthetic only '.repeat(30)).toString('base64')}`],
    ['numeric token', `# ${'1234567890'.repeat(4)}`],
    ['unicode assignment', '# Notes: \u5bc6\u94a5=dummy-unicode-secret'],
    ['unicode token', `# ${'\u5bc6\u94a5'.repeat(16)}`],
    ['fullwidth assignment', '# Notes: TOKEN\uff1ddummy-wide-secret'],
    ['invisible token separator', '# abcdefghijklmnop\u200bqrstuvwxyzABCDEF'],
    ['unicode line separator', '# Heading\u2028dummy-hidden-secret'],
    ['bare carriage return', '# Heading\rdummy-carriage-secret'],
    ['NUL in comment', '# Heading\u0000dummy-control-secret'],
  ];
}

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
  fs.writeFileSync(editFile(paths), `\uFEFF\r\n# --- Hosting ---\r\n\r\n\r\n# \u65e5\u672c / caf\u00e9\r\nX1_TEST_KEPT_KEY=<unchanged>\r\n\r\nX1_TEST_NEW_KEY=${value}\r\n\r\n`);
  const applied = await run('apply');
  assert.equal(applied.code, 0, applied.stderr);
  const expected = ['# --- Hosting ---', '', '# \u65e5\u672c / caf\u00e9', 'X1_TEST_KEPT_KEY', '', 'X1_TEST_NEW_KEY'];
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest, 'utf8')).layout, expected);
  assert.ok(!fs.readFileSync(paths.manifest, 'utf8').includes(value));
  await run('edit');
  const reopened = fs.readFileSync(editFile(paths), 'utf8');
  assert.ok(reopened.endsWith(`${expected.map((line) => line.startsWith('X1_') ? `${line}=<unchanged>` : line).join(os.EOL)}${os.EOL}`));
  assert.ok(!reopened.includes(value));
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
    assert.ok(!reopened.includes(value));
    for (const comment of comments) assert.ok(!reopened.includes(comment));
  });
});

test('manifest layout rejects unsafe existing entries and updates before propagating them', (t) => {
  const { paths } = harness(t);
  const manifest = new EnvManifest({ file: paths.manifest });
  manifest.update((record) => { record.layout = ['# Safe section', 'X1_TEST_KEPT_KEY']; });
  const before = fs.readFileSync(paths.manifest, 'utf8');
  for (const [, comment] of unsafeLayoutComments()) {
    assert.throws(() => manifest.update((record) => { record.layout = [comment]; }), /layout.*line 1/i);
    assert.equal(fs.readFileSync(paths.manifest, 'utf8'), before);
    fs.writeFileSync(paths.manifest, JSON.stringify({ schema: 'ai-agent-toolkit.env-manifest.v1', names: {}, bindings: [], layout: [comment] }));
    assert.throws(() => manifest.read(), (error) => /layout.*line 1/i.test(error.message) && !error.message.includes(comment));
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
  assert.deepEqual(editorCommand('C:\\x\\f.txt', 'win32', { SystemRoot: 'C:\\Windows' }), ['C:\\Windows\\System32\\notepad.exe', ['C:\\x\\f.txt']]);
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
