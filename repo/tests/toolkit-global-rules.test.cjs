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
  assert.equal(maybeRefreshCodexGlobalRules({ hook: true, syncSource: 'claude-plugin' }, { hub_version: 1, auto_sync_enabled: true }, h.env), null);
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
