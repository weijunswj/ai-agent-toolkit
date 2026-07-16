'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const launch = require('../scripts/claude-process-launch.cjs');

function run(parts, options = {}) {
  return spawnSync(parts.command, parts.args, {
    ...options,
    shell: parts.shell,
    windowsVerbatimArguments: parts.windowsVerbatimArguments,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('JavaScript Claude CLI paths remain shell-free and preserve argument boundaries', () => {
  const parts = launch.claudeSpawnParts(path.join(os.tmpdir(), 'Claude CLI', 'fake.cjs'), ['a b', 'x&y']);
  assert.equal(parts.command, process.execPath);
  assert.equal(parts.shell, false);
  assert.deepEqual(parts.args.slice(-2), ['a b', 'x&y']);
});

test('explicit Windows exe path in a directory with spaces executes directly', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Claude CLI exe '));
  const executable = path.join(root, 'node.exe');
  fs.copyFileSync(process.execPath, executable);
  const parts = launch.claudeSpawnParts(executable, ['--version']);
  const result = run(parts);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^v\d+/);
  assert.equal(parts.command, executable);
  assert.equal(parts.shell, false);
});

for (const extension of ['cmd', 'bat']) {
  test(`explicit Windows ${extension} path preserves metacharacter arguments without injection`, { skip: process.platform !== 'win32' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `Claude CLI ${extension} `));
    const capture = path.join(root, 'capture.cjs');
    const output = path.join(root, 'args.json');
    const marker = path.join(root, 'injected.txt');
    const wrapper = path.join(root, `claude.${extension}`);
    fs.writeFileSync(capture, `require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n`);
    fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
    const args = [output, 'space value', 'quote"value', 'amp&ersand', 'pipe|value', '(paren)', '100%literal%', 'caret^value', `blocked&echo injected>"${marker}"`];
    const result = run(launch.claudeSpawnParts(wrapper, args));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), args.slice(1));
    assert.equal(fs.existsSync(marker), false);
  });
}

test('unsafe or ambiguous executable strings are rejected before process creation', () => {
  for (const command of ['', ' claude', 'claude ', 'claude\ncalc', 'claude&calc', '"claude"']) {
    assert.throws(() => launch.claudeSpawnParts(command, []), /empty|ambiguous|unsafe|Bare Claude/i);
  }
});
