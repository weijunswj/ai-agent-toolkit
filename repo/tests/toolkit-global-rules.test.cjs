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
