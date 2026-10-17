'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const script = path.resolve(__dirname, '../scripts/toolkit-opencode-project-plugin.cjs');
const destinationRelative = path.join('.opencode', 'plugins', 'ai-agent-toolkit.js');
const canonicalRules = fs.readFileSync(path.resolve(__dirname, '../contracts/agent-rules/ai-coding-agent-execution.md'), 'utf8');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-opencode-project-plugin-'));
}

function run(projectRoot, extra = []) {
  return spawnSync(process.execPath, [script, '--project-root', projectRoot, ...extra], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 10000
  });
}

test('dry-run previews one project plugin file and creates nothing', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "dry-run"/);
  assert.match(result.stdout, /\.opencode\/plugins\/ai-agent-toolkit\.js/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('--write creates one project plugin with canonical instructions and pinned runtime entry; second run is idempotent', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const installed = run(root, ['--write']);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /"status": "installed"/);
  const plugin = path.join(root, destinationRelative);
  const contents = fs.readFileSync(plugin, 'utf8');
  const identity = JSON.parse(installed.stdout);
  assert.equal(identity.payloadSha256, crypto.createHash('sha256').update(contents).digest('hex'));
  const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
  assert.ok(contents.startsWith(`// AI-AGENT-TOOLKIT package ${version};`), 'installed native payload binds the canonical package version');
  assert.match(contents, /experimental\.chat\.system\.transform/);
  assert.match(contents, /OPENCODE SYSTEM ENTRY v1/);
  assert.ok(contents.includes(JSON.stringify(canonicalRules)), 'plugin embeds the exact canonical execution-rule source');
  assert.match(contents, /toolkit-opencode-helper-adapter\.cjs/);
  assert.match(contents, /tool\.execute\.before/);
  assert.doesNotMatch(contents, /fetch\s*\(|\$`/);
  assert.deepEqual(fs.readdirSync(root), ['.opencode']);
  assert.deepEqual(fs.readdirSync(path.dirname(plugin)), ['ai-agent-toolkit.js']);

  const { AIAgentToolkitPlugin, default: nativeFactory } = await import(pathToFileURL(plugin).href);
  assert.equal(nativeFactory,AIAgentToolkitPlugin,'installed V1 export enumerator registers one deduplicated owner');
  const hooks = await AIAgentToolkitPlugin({client:{session:{get:async()=>({data:{id:'root'}})},app:{agents:async()=>({data:[]})}}});
  const output = { system: ['OpenCode default system prompt'] };
  await hooks['experimental.chat.system.transform']({ model: { id: 'unqualified-example' } }, output);
  assert.equal(output.system.length, 2);
  assert.ok(output.system[1].includes(canonicalRules.trimEnd()));
  await hooks['experimental.chat.system.transform']({ model: { id: 'another-unqualified-example' } }, output);
  assert.equal(output.system.length, 2, 'hook is idempotent for repeated system transforms');

  const repeated = run(root, ['--write']);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /"status": "already-installed"/);
  assert.equal(fs.readFileSync(plugin, 'utf8'), contents);
});

test('refuses to overwrite an unknown existing plugin file', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugin = path.join(root, destinationRelative);
  fs.mkdirSync(path.dirname(plugin), { recursive: true });
  fs.writeFileSync(plugin, 'user-owned plugin\n', 'utf8');

  const result = run(root, ['--write']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to overwrite/);
  assert.equal(fs.readFileSync(plugin, 'utf8'), 'user-owned plugin\n');
});

test('rejects a symlinked OpenCode plugin directory', (t) => {
  const root = tempRoot();
  const external = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(root, '.opencode'), 'junction');

  const result = run(root, ['--write']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link or junction/);
  assert.deepEqual(fs.readdirSync(external), []);
});

test('requires an existing absolute project directory', (t) => {
  const relative = run('.', ['--write']);
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /absolute path/);

  const missing = run(path.join(os.tmpdir(), 'toolkit-opencode-project-plugin-missing-root'));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /does not exist/);
});
