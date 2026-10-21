'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const setup = require('../scripts/setup-toolkit-core.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-opencode-project-'));
}

async function captureLogs(callback) {
  const previous = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try {
    const result = await callback();
    return { result, output: lines.join('\n') };
  } finally {
    console.log = previous;
  }
}

test('setup CLI project plugin defaults to preview and writes only with --execute', async (t) => {
  const project = tempRoot();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const destination = path.join(project, '.opencode', 'plugins', 'ai-agent-toolkit.js');

  const preview = await captureLogs(() => setup.main(['--opencode-project-root', project]));
  assert.equal(preview.result, 0);
  assert.match(preview.output, /"status": "dry-run"/);
  assert.equal(fs.existsSync(destination), false);

  const written = await captureLogs(() => setup.main(['--execute', '--opencode-project-root', project]));
  assert.equal(written.result, 0);
  assert.match(written.output, /"status": "installed"/);
  assert.equal(fs.existsSync(destination), true);
});

test('setup CLI project plugin action rejects mixed setup flags and AG2 target selection', async (t) => {
  const project = tempRoot();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  await assert.rejects(
    setup.main(['--opencode-project-root', project, '--enable-target', 'opencode']),
    /cannot be combined with/);
  assert.throws(() => setup.parseArgs(['--enable-target', 'ag2']), /Unsupported target: ag2/);
});
