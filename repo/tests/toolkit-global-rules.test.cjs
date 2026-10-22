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

test('the Codex session-start hook writes nothing before setup or with auto-sync off', () => {
  const { maybeRefreshCodexGlobalRules } = require('../scripts/toolkit-local-bridge.cjs');
  const hook = { hook: true, syncSource: 'codex-plugin' };
  for (const state of [null, {}, { hub_version: 1, auto_sync_enabled: false, repo_path: ROOT }]) {
    const h = home();
    assert.equal(maybeRefreshCodexGlobalRules(hook, state, h.env), null);
    assert.equal(fs.existsSync(harnessFile('codex', h.env)), false, JSON.stringify(state));
  }
  const h = home();
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { assert.equal(maybeRefreshCodexGlobalRules(hook, { hub_version: 1, auto_sync_enabled: true, repo_path: ROOT }, h.env).status, 'updated'); }
  finally { console.log = log; }
  assert.deepEqual(lines, [], 'a routine refresh is silent');
  assert.equal(fs.existsSync(harnessFile('codex', h.env)), true);
  assert.match(read(path.join(path.dirname(harnessFile('codex', h.env)), 'config.toml')), /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\nproject_doc_max_bytes = 65536\n/,
    'the Codex hook raises the instruction limit with the block');
  const setupRun = rules(h, { harnesses: ['codex'], manageCodexDocLimit: false }).refresh();
  assert.equal(setupRun.doc_limit.action, 'reported', 'setup only reports the limit');
  assert.equal(maybeRefreshCodexGlobalRules({ hook: true, syncSource: 'claude-plugin' }, { hub_version: 1, auto_sync_enabled: true }, h.env), null);
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

test('setup raises Codex project_doc_max_bytes inside markers and removal puts the previous value back', () => {
  const h = home();
  const codexDir = path.dirname(harnessFile('codex', h.env));
  const config = path.join(codexDir, 'config.toml');
  fs.mkdirSync(codexDir, { recursive: true });
  const original = 'model = "x"\r\nproject_doc_max_bytes = 20000\r\n\r\n[desktop]\r\nproject_doc_max_bytes = 1 # inside a table: not top-level\r\n';
  fs.writeFileSync(config, original);
  const repoAgents = path.join(h.root, 'repo-AGENTS.md');
  fs.writeFileSync(repoAgents, 'x'.repeat(14000));
  const raised = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).refresh();
  assert.equal(raised.doc_limit.action, 'raised');
  assert.equal(raised.doc_limit.previous, '20000');
  const text = read(config);
  assert.equal(text, 'model = "x"\r\n# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=20000\r\nproject_doc_max_bytes = 65536\r\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\r\n\r\n[desktop]\r\nproject_doc_max_bytes = 1 # inside a table: not top-level\r\n');
  assert.ok(fs.readFileSync(path.join(raised.backup_dir, 'codex-config.toml')).equals(Buffer.from(original)));
  assert.equal(raised.codex_budget.limit, 65536);
  assert.equal(raised.codex_budget.over, false);
  assert.ok(describeResult(raised).some(line => line === 'Codex project_doc_max_bytes (~/.codex/config.toml): raised to 65536 (was 20000)'));
  assert.equal(rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).refresh().doc_limit.action, 'unchanged');

  const removed = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).remove();
  assert.equal(removed.doc_limit.action, 'restored-previous');
  assert.equal(read(config), 'model = "x"\r\nproject_doc_max_bytes = 20000\r\n\r\n[desktop]\r\nproject_doc_max_bytes = 1 # inside a table: not top-level\r\n');

  // A value already at or above the target is left alone; no key at all is restored to no key.
  fs.writeFileSync(config, 'project_doc_max_bytes = 131072\n');
  assert.equal(rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).refresh().doc_limit.action, 'unchanged');
  fs.writeFileSync(config, '[a]\nb = 1\n');
  rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).refresh();
  assert.match(read(config), /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\n/);
  rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).remove();
  assert.equal(read(config), '[a]\nb = 1\n');
});

test('the Codex budget counts the whole user file plus the repository rules and warns when over', () => {
  const h = home();
  const codex = harnessFile('codex', h.env);
  const config = path.join(path.dirname(codex), 'config.toml');
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, `# My own rules\n${'- a hand-written rule line.\n'.repeat(180)}`);
  fs.writeFileSync(config, '# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\nbroken\n');
  const repoAgents = path.join(h.root, 'repo-AGENTS.md');
  fs.writeFileSync(repoAgents, 'x'.repeat(14000));
  const held = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents }).refresh();
  assert.equal(held.status, 'held', 'broken markers in config.toml are never guessed at');
  assert.equal(held.doc_limit.state, 'broken');
  fs.writeFileSync(config, 'model = "x"\n');
  const check = rules(h, { harnesses: ['codex'], repoAgentsFile: repoAgents, respectRemoval: true }).check();
  assert.equal(check.codex_budget.limit, 32768);
  assert.equal(check.codex_budget.over, true, `${check.codex_budget.total} B with a realistic user section passes the default limit`);
  assert.ok(describeResult(check).some(line => /^Codex instructions: ~\/\.codex\/AGENTS\.md \d+ B \+ ~\/repo-AGENTS\.md 14000 B = \d+ B of 32768 B; over the limit/.test(line)));
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
