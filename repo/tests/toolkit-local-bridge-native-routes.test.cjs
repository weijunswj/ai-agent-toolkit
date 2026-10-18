'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { adapterPayloads, parseArgs, run } = require('../scripts/toolkit-local-bridge.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-native-routes-'));
}

function captureLogs(callback) {
  const previous = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try {
    return { result: callback(), output: lines.join('\n') };
  } finally {
    console.log = previous;
  }
}

test('bridge OpenCode project-plugin preview and write stay on the explicit project path', (t) => {
  const project = tempRoot();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const plugin = path.join(project, '.opencode', 'plugins', 'ai-agent-toolkit.js');

  const preview = captureLogs(() => run([
    '--install-opencode-project-plugin', '--opencode-project-root', project
  ]));
  assert.equal(preview.result.status, 0);
  assert.equal(preview.result.result.status, 'dry-run');
  assert.equal(fs.existsSync(plugin), false);

  assert.throws(() => run([
    '--install-opencode-project-plugin', '--opencode-project-root', project, '--audit'
  ]), /Project setup command cannot be combined/);
  assert.equal(fs.existsSync(plugin), false);

  const installed = captureLogs(() => run([
    '--install-opencode-project-plugin', '--opencode-project-root', project, '--write'
  ]));
  assert.equal(installed.result.result.status, 'installed');
  assert.equal(fs.existsSync(plugin), true);
  assert.deepEqual(fs.readdirSync(path.join(project, '.opencode', 'plugins')), ['ai-agent-toolkit.js']);
});

test('AG2 native plugin sync is unselectable while legacy disable remains accepted', () => {
  assert.throws(() => parseArgs(['--enable-target', 'ag2']), /AG2 native\/plugin target is unsupported/);
  assert.deepEqual(parseArgs(['--disable-target', 'ag2']).disableTargets, ['ag2']);
  assert.throws(() => parseArgs(['--set-ag2-python-command', 'python']), /Unknown argument/);
});

test('Antigravity bridge payload contains portable skill files and no plugin metadata', (t) => {
  const source = tempRoot();
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  fs.mkdirSync(path.join(source, 'skills', 'portable-example'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills', 'portable-example', 'SKILL.md'), '---\nname: portable-example\n---\n');
  const payloads = adapterPayloads({}, source);
  assert.deepEqual(Object.keys(payloads.ag2), ['skills/portable-example/SKILL.md']);
  assert.equal(Object.keys(payloads.ag2).some((name) => /plugin\.json|installed_version|ai-agent-toolkit/.test(name)), false);
  assert.equal(Object.keys(payloads.opencode).some((name) => name.endsWith('/ai-agent-toolkit/SKILL.md')), true);
});
