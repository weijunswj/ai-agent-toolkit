'use strict';

require('./toolkit-test-temp-guard.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const block = require('../scripts/toolkit-managed-block.cjs');
const { GlobalRules, globalRulesBlock, harnessFile, describeResult, BLOCK_NAME } = require('../scripts/toolkit-global-rules.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const EXPECTED = globalRulesBlock(ROOT);

function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-global-rules-'));
  return { root, env: { HOME: root, USERPROFILE: root } };
}
function rules(h, options = {}) {
  return new GlobalRules({ environment: h.env, toolkitRoot: ROOT, ...options });
}
const read = file => fs.readFileSync(file, 'utf8');

test('the marker format carries the version and a body digest, and detects hand edits', () => {
  const expected = { source: 'src.md', name: 'DEMO', version: '9.9.9', body: 'line one\nline two' };
  const rendered = block.renderBlock(expected);
  assert.match(rendered.split('\n')[0], /^<!-- AI-AGENT-TOOLKIT:src\.md:BEGIN DEMO v2 toolkit=9\.9\.9 sha256=[0-9a-f]{12} -->$/);
  const [found] = block.findBlocks(`before\r\n${rendered.replace(/\n/g, '\r\n')}\r\nafter\r\n`).blocks;
  assert.equal(block.blockState(found, expected), 'current');
  assert.equal(block.blockState({ ...found, body: 'line one\nedited' }, expected), 'tampered');
  assert.equal(block.blockState({ ...found, version: '9.9.8' }, expected), 'stale');
  assert.equal(block.blockState({ ...found, format: 1, version: null, digest: null }, expected), 'stale');
  assert.deepEqual(block.findBlocks('<!-- AI-AGENT-TOOLKIT:a:BEGIN X v2 toolkit=1.0.0 sha256=000000000000 -->\nno end\n').errors, ['BEGIN X without END']);
  assert.equal(block.findBlocks('<!-- AI-AGENT-TOOLKIT:a:END X -->\n').errors.length, 1);
});

test('upsert and remove keep every byte outside the markers, CRLF included', () => {
  const expected = { source: 's', name: 'B', version: '1.0.0', body: 'body' };
  const owner = '# Mine\r\n\r\nkeep this\r\n';
  const added = block.upsertBlock(owner, expected, { position: 'bottom' });
  assert.ok(added.startsWith('# Mine\r\n\r\nkeep this\r\n\r\n<!-- AI-AGENT-TOOLKIT:s:BEGIN B v2'));
  assert.ok(!/[^\r]\n/.test(added), 'the file keeps CRLF line endings');
  const replaced = block.upsertBlock(added, { ...expected, body: 'new body' }, { position: 'bottom' });
  assert.ok(replaced.startsWith('# Mine\r\n\r\nkeep this\r\n\r\n'));
  assert.ok(replaced.includes('new body'));
  assert.equal(block.removeBlock(replaced, 'B'), owner);
  assert.equal(block.removeBlock(block.upsertBlock('', expected), 'B'), '');
  // Install then remove gives back the exact bytes, whatever the file's trailing newlines.
  for (const original of ['# Mine', '# Mine\n', '# Mine\n\n\n', '# Mine\r\n\r\n', '\n']) {
    const installed = block.upsertBlock(original, expected, { position: 'bottom' });
    assert.ok(installed.startsWith(original), JSON.stringify(original));
    assert.equal(block.removeBlock(installed, 'B'), original, JSON.stringify(original));
    assert.equal(block.removeBlock(block.upsertBlock(original, expected), 'B'), original, `top ${JSON.stringify(original)}`);
  }
});

test('setup creates the Claude Code and Codex files, keeps the owner text, and is a no-op when current', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  const owner = '# Response Style\r\n* Mine.\r\n\r\n# Toolkit Controller Bootstrap\r\n* Old.\r\n';
  fs.writeFileSync(codex, owner);
  const first = rules(h).refresh();
  assert.equal(first.status, 'updated');
  assert.deepEqual(first.files.map(file => [file.harness, file.action]), [['claude-code', 'created'], ['codex', 'added']]);
  const claude = harnessFile('claude-code', h.env);
  assert.equal(path.dirname(claude), path.join(h.root, '.claude'));
  assert.ok(read(codex).startsWith(owner), 'owner bytes are kept exactly');
  assert.equal(block.blockState(block.findBlocks(read(claude)).blocks[0], EXPECTED), 'current');
  assert.deepEqual(first.covered, [{ file: codex, display: '~/.codex/AGENTS.md', title: 'Toolkit Controller Bootstrap' }]);
  const lines = describeResult(first);
  assert.ok(lines.some(line => line.includes('"Toolkit Controller Bootstrap" section in ~/.codex/AGENTS.md') && line.includes('does not edit it')));
  assert.ok(lines.includes('Codex (~/.codex/AGENTS.md): added'));
  assert.ok(lines.every(line => !line.includes(h.root)), 'output shows home-relative paths only');
  assert.ok(fs.existsSync(path.join(first.backup_dir, 'codex-AGENTS.md')), 'the owner file was backed up first');
  const second = rules(h).refresh();
  assert.equal(second.status, 'current');
  assert.ok(second.files.every(file => file.action === 'unchanged'));
});

test('a hand-edited block is restored with a backup; broken markers hold instead of guessing', () => {
  const h = home();
  rules(h, { harnesses: ['codex'] }).refresh();
  const codex = harnessFile('codex', h.env);
  fs.writeFileSync(codex, read(codex).replace('## Precedence And Safety Floor', '## Precedence (edited)'));
  assert.equal(rules(h, { harnesses: ['codex'] }).check().files[0].state, 'tampered');
  const restored = rules(h, { harnesses: ['codex'] }).refresh();
  assert.equal(restored.files[0].action, 'restored');
  assert.ok(read(codex).includes('## Precedence And Safety Floor'));
  const broken = read(codex).replace(/<!-- AI-AGENT-TOOLKIT:[^\n]*:END GLOBAL-RULES -->/, '');
  fs.writeFileSync(codex, broken);
  const held = rules(h, { harnesses: ['codex'] }).refresh();
  assert.equal(held.status, 'held');
  assert.equal(read(codex), broken, 'nothing is written on broken markers');
});

test('a file that is not UTF-8 is held and never rewritten; UTF-8 with a BOM round-trips and backs up byte-exact', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Mine \u00e9\r\n', 'utf16le')]);
  fs.writeFileSync(codex, utf16);
  const held = rules(h, { harnesses: ['codex'] }).refresh();
  assert.equal(held.status, 'held');
  assert.equal(held.files[0].state, 'not-utf8');
  assert.match(describeResult(held)[0], /held, the file is not UTF-8 text .* Save it as UTF-8/);
  assert.ok(fs.readFileSync(codex).equals(utf16), 'the file keeps its exact bytes');
  assert.equal(rules(h, { harnesses: ['codex'] }).remove().files[0].action, 'held');

  const bom = Buffer.from('\ufeff# Mine \u00e9\r\nkeep\r\n', 'utf8');
  fs.writeFileSync(codex, bom);
  const added = rules(h, { harnesses: ['codex'] }).refresh();
  assert.equal(added.files[0].action, 'added');
  assert.ok(fs.readFileSync(codex).subarray(0, bom.length).equals(bom), 'the owner bytes, BOM included, stay the prefix');
  assert.ok(fs.readFileSync(path.join(added.backup_dir, 'codex-AGENTS.md')).equals(bom), 'the backup holds the exact original bytes');
});

test('a hand-edited block is reported when restored, in the install check and the Codex session-start hook', () => {
  const h = home();
  rules(h, { harnesses: ['codex'] }).refresh();
  const codex = harnessFile('codex', h.env);
  fs.writeFileSync(codex, read(codex).replace('## Precedence And Safety Floor', '## Precedence (edited)'));
  const { maybeRefreshCodexGlobalRules } = require('../scripts/toolkit-local-bridge.cjs');
  const state = { hub_version: 1, auto_sync_enabled: true, repo_path: ROOT };
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { maybeRefreshCodexGlobalRules({ hook: true, syncSource: 'codex-plugin' }, state, h.env); }
  finally { console.log = log; }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Toolkit global rules: Codex \(~\/\.codex\/AGENTS\.md\): restored; an edit inside the Toolkit block was replaced.*Backup: ~\/\.ai-agent-toolkit\/backups\/global-rules\//);
  assert.ok(read(codex).includes('## Precedence And Safety Floor'));
});

test('a removal holds through Claude Code and Codex session starts until setup installs again', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, '# Mine\n');
  rules(h).refresh();
  assert.deepEqual(rules(h).remove().files.map(file => file.action), ['deleted-file', 'removed']);
  const ledger = JSON.parse(read(path.join(h.root, '.ai-agent-toolkit', 'global-rules.json')));
  assert.deepEqual(Object.keys(ledger.removed).sort(), [harnessFile('claude-code', h.env), codex].map(file => path.resolve(file)).sort(),
    'the removal is recorded in Toolkit state, not in the rules files');

  // Claude Code session start (the install check) and the Codex session-start hook leave both alone.
  const { ToolkitInstallHealthCheck } = require('../scripts/toolkit-install-health.cjs');
  const check = ToolkitInstallHealthCheck.forSessionStart({ environment: h.env, toolkitRoot: ROOT, hubPath: path.join(h.root, 'hub') }).run();
  const global = check.checks.find(entry => entry.id === 'global-rules');
  assert.equal(global.status, 'passed');
  assert.equal(global.updated, undefined, 'nothing written, nothing to report');
  assert.match(global.summary, /Claude Code \(~\/\.claude\/CLAUDE\.md\): removed by you; run setup toolkit to reinstall/);
  const { maybeRefreshCodexGlobalRules } = require('../scripts/toolkit-local-bridge.cjs');
  const codexRun = maybeRefreshCodexGlobalRules({ hook: true, syncSource: 'codex-plugin' }, { hub_version: 1, auto_sync_enabled: true, repo_path: ROOT }, h.env);
  assert.equal(codexRun.files[0].action, 'opted-out');
  assert.equal(fs.existsSync(harnessFile('claude-code', h.env)), false, 'the Claude Code file stays deleted');
  assert.equal(read(codex), '# Mine\n', 'the Codex block stays removed');

  // Setup (or --write) installs again and clears the removal; later session starts refresh as usual.
  assert.deepEqual(rules(h).refresh().files.map(file => file.action), ['created', 'added']);
  assert.deepEqual(JSON.parse(read(path.join(h.root, '.ai-agent-toolkit', 'global-rules.json'))).removed, {});
  fs.writeFileSync(codex, read(codex).replace('## Precedence And Safety Floor', '## Precedence (edited)'));
  assert.equal(rules(h, { harnesses: ['codex'], respectRemoval: true }).refresh().files[0].action, 'restored');
});

test('the Codex session-start hook writes nothing before setup or with auto-sync off, and raises the limit only with consent', () => {
  const { maybeRefreshCodexGlobalRules } = require('../scripts/toolkit-local-bridge.cjs');
  const hook = { hook: true, syncSource: 'codex-plugin' };
  for (const state of [null, {}, { hub_version: 1, auto_sync_enabled: false, repo_path: ROOT }]) {
    const h = home();
    assert.equal(maybeRefreshCodexGlobalRules(hook, state, h.env), null);
    assert.equal(fs.existsSync(harnessFile('codex', h.env)), false, JSON.stringify(state));
  }
  const h = home();
  const config = path.join(path.dirname(harnessFile('codex', h.env)), 'config.toml');
  const capture = (run) => {
    const lines = [];
    const log = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try { return { result: run(), lines }; } finally { console.log = log; }
  };
  const noConsent = capture(() => maybeRefreshCodexGlobalRules(hook, { hub_version: 1, auto_sync_enabled: true, repo_path: ROOT }, h.env));
  assert.equal(noConsent.result.status, 'updated');
  assert.deepEqual(noConsent.lines, [], 'a routine refresh is silent');
  assert.equal(fs.existsSync(harnessFile('codex', h.env)), true);
  assert.equal(fs.existsSync(config), false, 'without the setup answer the hook never touches config.toml');
  assert.equal(noConsent.result.doc_limit, null, 'without a yes the session start does not even read config.toml');

  const consent = { hub_version: 1, auto_sync_enabled: true, repo_path: ROOT, codex_doc_limit_enabled: true };
  const raised = capture(() => maybeRefreshCodexGlobalRules(hook, consent, h.env));
  assert.equal(raised.result.doc_limit.action, 'raised');
  assert.equal(raised.lines.length, 1, 'every raise prints one session line');
  assert.match(raised.lines[0], /Codex project_doc_max_bytes \(~\/\.codex\/config\.toml\): raised to 65536 \(was the default 32768\); --remove puts it back/);
  assert.match(read(config), /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none created=yes\nproject_doc_max_bytes = 65536\n/);
  const { codexGlobalRulesReportEntry } = require('../scripts/toolkit-local-bridge.cjs');
  const entry = codexGlobalRulesReportEntry(raised.result);
  assert.equal(entry.checks[0].updated, true, 'every raise is an update-report entry');
  assert.match(entry.checks[0].summary, /raised to 65536/);
  assert.equal(codexGlobalRulesReportEntry(capture(() => maybeRefreshCodexGlobalRules(hook, consent, h.env)).result), null, 'nothing new, no entry');
  assert.equal(maybeRefreshCodexGlobalRules({ hook: true, syncSource: 'claude-plugin' }, consent, h.env), null);
});

// The G2 recheck's config.toml corpus (b227d0d): every shape is either raised with every other
// value intact and an exact restore, or left byte-for-byte alone.
const CONFIG_SHAPES = {
  'absent-file': [null, 'raised'],
  'empty-file': ['', 'raised'],
  'no-tables-lf': ['model = "x"\n', 'raised'],
  'no-trailing-newline': ['model = "x"', 'raised'],
  'key-20000-lf': ['model = "x"\nproject_doc_max_bytes = 20000\n\n[tui]\nx = 1\n', 'raised'],
  'key-20000-crlf': ['model = "x"\r\nproject_doc_max_bytes = 20000\r\n\r\n[tui]\r\nx = 1\r\n', 'raised'],
  'key-inline-comment': ['project_doc_max_bytes = 20000 # mine\n[tui]\nx = 1\n', 'raised'],
  'key-no-spaces': ['project_doc_max_bytes=20000\n', 'raised'],
  'key-leading-space': ['  project_doc_max_bytes = 20000\n', 'raised'],
  'key-last-line-no-newline': ['model = "x"\nproject_doc_max_bytes = 20000', 'raised'],
  'key-underscore-low': ['model = "x"\nproject_doc_max_bytes = 20_000\n[tui]\nx = 1\n', 'skipped'],
  'key-underscore-high': ['project_doc_max_bytes = 100_000\n', 'unchanged'],
  'key-hex': ['project_doc_max_bytes = 0x4000\n', 'skipped'],
  'key-plus-sign': ['project_doc_max_bytes = +20000\n', 'skipped'],
  'key-double-quoted': ['"project_doc_max_bytes" = 20000\n', 'skipped'],
  'key-single-quoted': ["'project_doc_max_bytes' = 20000\n", 'skipped'],
  'key-zero': ['project_doc_max_bytes = 0\n', 'unchanged'],
  'key-target': ['project_doc_max_bytes = 65536\n', 'unchanged'],
  'key-high': ['project_doc_max_bytes = 131072\n', 'unchanged'],
  'key-only-in-table': ['[profiles.work]\nproject_doc_max_bytes = 1000\n', 'skipped'],
  'key-in-table-and-top-absent': ['model = "x"\n[profiles.work]\nproject_doc_max_bytes = 100000\n', 'skipped'],
  'bom-key': ['﻿project_doc_max_bytes = 20000\n', 'held'],
  'bom-no-key': ['﻿model = "x"\n[tui]\nx = 1\n', 'held'],
  'multiline-string-bracket-line': ['developer_instructions = """\nRead this first:\n[the guide](https://example.invalid)\n"""\nmodel = "x"\n[tui]\nx = 1\n', 'raised'],
  'multiline-literal-key-text': ["developer_instructions = '''\nproject_doc_max_bytes = 1\n'''\n[tui]\nx = 1\n", 'raised'],
  'multiline-string-and-key': ["developer_instructions = '''\nproject_doc_max_bytes = 20000\n'''\nproject_doc_max_bytes = 20000\n", 'skipped'],
  'multiline-array-nested-line': ['notify = [\n  ["a", "b"],\n]\nmodel = "x"\n[tui]\nx = 1\n', 'raised'],
  'comment-with-bracket': ['# [tui] settings live below\nmodel = "x"\n[tui]\nx = 1\n', 'raised'],
  'indented-table': ['model = "x"\n  [tui]\n  x = 1\n', 'raised'],
  'array-of-tables-first': ['[[skills.config]]\nname = "a"\n', 'raised'],
  'mixed-eol': ['model = "x"\r\nproject_doc_max_bytes = 20000\n[tui]\r\nx = 1\n', 'raised'],
  'duplicate-key-invalid-input': ['project_doc_max_bytes = 1000\nproject_doc_max_bytes = 2000\n', 'held'],
  'comment-block-above-table': ['model = "x"\n\n# --- MCP servers ---\n[mcp_servers.a]\ncommand = "x"\n', 'raised'],
  'commented-out-key': ['# project_doc_max_bytes = 100000\nmodel = "x"\n', 'raised'],
  'key-then-comment-crlf-spaces': ['project_doc_max_bytes = 20000   # set by me   \r\nmodel = "x"\r\n', 'raised'],
};

test('config.toml is judged by a TOML parser: each shape is raised exactly, or left alone byte for byte', () => {
  const { parseTomlDocument } = require('../scripts/codex-delegation-common.cjs');
  const withoutKey = doc => { const { project_doc_max_bytes: _key, ...rest } = doc.v; return JSON.stringify(rest); };
  for (const [name, [original, expected]] of Object.entries(CONFIG_SHAPES)) {
    const h = home();
    const config = path.join(path.dirname(harnessFile('codex', h.env)), 'config.toml');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    if (original !== null) fs.writeFileSync(config, original);
    const before = original === null ? null : parseTomlDocument(Buffer.from(original));
    const raise = () => rules(h, { harnesses: ['codex'], codexDocLimit: 'raise' });
    const run = raise().refresh();
    assert.equal(run.doc_limit.action, expected, name);
    if (expected === 'raised') {
      const after = parseTomlDocument(fs.readFileSync(config));
      assert.equal(after.ok, true, `${name}: still valid TOML`);
      assert.deepEqual(after.doc.v.project_doc_max_bytes, { t: 'int', v: '65536' }, `${name}: the key Codex reads`);
      assert.equal(withoutKey(after.doc), before ? withoutKey(before.doc) : '{}', `${name}: every other value unchanged`);
      assert.equal(raise().refresh().doc_limit.action, 'unchanged', `${name}: a second run changes nothing`);
      assert.equal(raise().check().status, 'current', `${name}: --check passes`);
    } else {
      assert.equal(original === null ? fs.existsSync(config) : read(config), original === null ? false : original, `${name}: untouched`);
      assert.equal(run.status === 'held', expected === 'held', name);
    }
    rules(h, { harnesses: ['codex'] }).remove();
    assert.equal(fs.existsSync(config) ? read(config) : null, original, `${name}: --remove restores the exact bytes`);
  }
});

test('the Codex limit is raised inside markers that keep the exact original line, and removal puts it back', () => {
  const h = home();
  const codexDir = path.dirname(harnessFile('codex', h.env));
  const config = path.join(codexDir, 'config.toml');
  fs.mkdirSync(codexDir, { recursive: true });
  const original = 'model = "x"\r\nproject_doc_max_bytes = 20000 # mine\r\n\r\n[desktop]\r\nx = 1\r\n';
  fs.writeFileSync(config, original);
  const repoAgents = path.join(h.root, 'repo-AGENTS.md');
  fs.writeFileSync(repoAgents, 'x'.repeat(14000));
  const raised = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents, codexDocLimit: 'raise' }).refresh();
  assert.equal(raised.doc_limit.action, 'raised');
  assert.equal(raised.doc_limit.previous, '20000');
  const line = Buffer.from('project_doc_max_bytes = 20000 # mine\r\n').toString('base64');
  assert.equal(read(config), `model = "x"\r\n# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=20000 line=${line}\r\nproject_doc_max_bytes = 65536\r\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\r\n\r\n[desktop]\r\nx = 1\r\n`);
  assert.ok(fs.readFileSync(path.join(raised.backup_dir, 'codex-config.toml')).equals(Buffer.from(original)));
  assert.equal(raised.codex_budget.limit, 65536);
  assert.equal(raised.codex_budget.over, false);
  assert.ok(describeResult(raised).some(entry => entry === 'Codex project_doc_max_bytes (~/.codex/config.toml): raised to 65536 (was 20000); --remove puts it back'));

  const removed = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).remove();
  assert.equal(removed.doc_limit.action, 'restored-previous');
  assert.equal(read(config), original, 'the inline comment, spacing and line ending come back exactly');

  // The owner's no in setup puts a raised value back; a report-only run changes nothing.
  rules(h, { harnesses: ['codex'], codexDocLimit: 'raise' }).refresh();
  assert.equal(rules(h, { harnesses: ['codex'] }).refresh().doc_limit.action, 'reported');
  assert.equal(rules(h, { harnesses: ['codex'], codexDocLimit: 'restore' }).refresh().doc_limit.action, 'restored-previous');
  assert.equal(read(config), original);
});

test('an explicit 0 is never overridden and is reported as project docs off', () => {
  const h = home();
  const config = path.join(path.dirname(harnessFile('codex', h.env)), 'config.toml');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, 'project_doc_max_bytes = 0\n');
  const run = rules(h, { harnesses: ['codex'], codexDocLimit: 'raise' }).refresh();
  assert.equal(run.doc_limit.state, 'off');
  assert.equal(read(config), 'project_doc_max_bytes = 0\n');
  const lines = describeResult(run);
  assert.ok(lines.some(entry => /: 0, so Codex reads no repository AGENTS\.md; Toolkit leaves your choice alone/.test(entry)));
  assert.ok(!lines.some(entry => /^Codex instructions:/.test(entry)), 'no size line against a limit of 0');
});

test('--check fails on an unparseable or ineffective config.toml, and broken markers are never guessed at', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  const config = path.join(path.dirname(codex), 'config.toml');
  rules(h, { harnesses: ['codex'], codexDocLimit: 'raise' }).refresh();
  const valid = read(config);
  fs.writeFileSync(config, `${valid}project_doc_max_bytes = 1\n`);
  const invalid = rules(h, { harnesses: ['codex'] }).check();
  assert.equal(invalid.status, 'held', 'a duplicate key Codex cannot load fails --check');
  assert.equal(invalid.doc_limit.state, 'invalid');
  fs.writeFileSync(config, `${valid}[profiles.work]\nproject_doc_max_bytes = 1000\n`);
  const ineffective = rules(h, { harnesses: ['codex'] }).check();
  assert.equal(ineffective.status, 'held');
  assert.equal(ineffective.doc_limit.state, 'ineffective');
  assert.match(describeResult(ineffective).join('\n'), /not in effect \(project_doc_max_bytes is also set under profiles\.work\)/);
  fs.writeFileSync(config, '# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\nbroken\n');
  const held = rules(h, { harnesses: ['codex'], codexDocLimit: 'raise' }).refresh();
  assert.equal(held.status, 'held');
  assert.equal(held.doc_limit.state, 'broken');
  assert.equal(read(config), '# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\nbroken\n');
  assert.equal(rules(h, { harnesses: ['codex'] }).remove().doc_limit.action, 'held');
});

test('the Codex budget counts the whole user file plus the repository rules and warns when over', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  const config = path.join(path.dirname(codex), 'config.toml');
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, `# My own rules\n${'- a hand-written rule line.\n'.repeat(180)}`);
  fs.writeFileSync(config, 'model = "x"\n');
  const repoAgents = path.join(h.root, 'repo-AGENTS.md');
  fs.writeFileSync(repoAgents, 'x'.repeat(14000));
  rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).refresh();
  assert.equal(read(config), 'model = "x"\n', 'without the setup answer the limit is only reported');
  const check = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents, respectRemoval: true }).check();
  assert.equal(check.codex_budget.limit, 32768);
  assert.equal(check.codex_budget.over, true, `${check.codex_budget.total} B with a realistic user section passes the default limit`);
  assert.ok(describeResult(check).some(line => /^Codex instructions: ~\/\.codex\/AGENTS\.md \d+ B \+ ~\/repo-AGENTS\.md 14000 B = \d+ B of 32768 B; over the limit, so Codex may cut off .*Answer yes to "Raise Codex's instruction limit" in setup toolkit/.test(line)));
});

test('removal deletes only files Toolkit created and keeps owner files without the block', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, '# Mine\n');
  rules(h).refresh();
  const removed = rules(h).remove();
  assert.deepEqual(removed.files.map(file => file.action), ['deleted-file', 'removed']);
  assert.equal(fs.existsSync(harnessFile('claude-code', h.env)), false);
  assert.equal(read(codex), '# Mine\n');
  assert.ok(rules(h).remove().files.every(file => file.action === 'absent'));
});

test('config-dir overrides and Antigravity opt-in pick the files', () => {
  const h = home();
  const env = { ...h.env, CLAUDE_CONFIG_DIR: path.join(h.root, 'claude-config'), CODEX_HOME: path.join(h.root, 'codex-home') };
  assert.equal(harnessFile('claude-code', env), path.join(h.root, 'claude-config', 'CLAUDE.md'));
  assert.equal(harnessFile('codex', env), path.join(h.root, 'codex-home', 'AGENTS.md'));
  assert.deepEqual(GlobalRules.setupHarnesses({ environment: env }), ['claude-code', 'codex']);
  assert.deepEqual(GlobalRules.setupHarnesses({ environment: env, antigravity: true }), ['claude-code', 'codex', 'antigravity']);
  new GlobalRules({ environment: env, toolkitRoot: ROOT, harnesses: ['antigravity'] }).refresh();
  assert.deepEqual(GlobalRules.setupHarnesses({ environment: env }), ['claude-code', 'codex', 'antigravity'], 'a file carrying the block stays managed');
  assert.throws(() => harnessFile('cursor', env), /Unknown harness/);
});

test('the global block is the global rules source plus the n8n adapter, at the package version', () => {
  const version = JSON.parse(read(path.join(ROOT, 'repo/contracts/toolkit-local-bridge/version.json'))).version;
  assert.equal(EXPECTED.version, version);
  assert.equal(EXPECTED.name, BLOCK_NAME);
  assert.ok(EXPECTED.body.startsWith('# Toolkit Global Rules'));
  assert.ok(EXPECTED.body.endsWith(read(path.join(ROOT, 'repo/contracts/agent-rules/n8n-safety-router-adapter.md')).replace(/\r\n/g, '\n').trimEnd()));
});

test('the config.toml check never imports Python modules from the opened folder or PYTHONPATH', () => {
  const { spawnSync } = require('node:child_process');
  const opened = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-opened-folder-'));
  const marker = path.join(opened, 'planted-ran.txt');
  const plant = `open(${JSON.stringify(marker)}, 'a').write('ran\\n')\n`;
  fs.writeFileSync(path.join(opened, 'json.py'), plant);
  fs.writeFileSync(path.join(opened, 'tomllib.py'), plant);
  const common = path.join(ROOT, 'repo', 'scripts', 'codex-delegation-common.cjs');
  const probe = `const c = require(${JSON.stringify(common)}); process.stdout.write(JSON.stringify(c.parseTomlDocument(Buffer.from('a = 1\\n'))));`;
  const run = spawnSync(process.execPath, ['-e', probe], { cwd: opened, encoding: 'utf8', env: { ...process.env, PYTHONPATH: opened } });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  const { parseTomlDocument } = require('../scripts/codex-delegation-common.cjs');
  if (parseTomlDocument(Buffer.from('b = 2\n')).kind === 'parser-unavailable') return;
  assert.equal(parsed.ok, true, `the real tomllib parses: ${JSON.stringify(parsed)}`);
  assert.deepEqual(parsed.doc.v.a, { t: 'int', v: '1' });
  assert.equal(fs.existsSync(marker), false, 'neither planted module ran');
});

test('a Toolkit marker that replaced a value without recording the line is held, never guessed', () => {
  const h = home();
  const config = path.join(path.dirname(harnessFile('codex', h.env)), 'config.toml');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const text = '# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=20000\nproject_doc_max_bytes = 65536\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\n';
  fs.writeFileSync(config, text);
  assert.equal(rules(h, { harnesses: ['codex'] }).check().doc_limit.state, 'broken');
  assert.equal(rules(h, { harnesses: ['codex'] }).remove().doc_limit.action, 'held');
  assert.equal(read(config), text);
});
