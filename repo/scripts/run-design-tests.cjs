#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testArgs = [
  '-m',
  'unittest',
  'discover',
  '-s',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/tests'
];

function candidateCommands() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push({ command: process.env.PYTHON, args: [] });
  candidates.push({ command: 'python', args: [] });
  candidates.push({ command: 'python3', args: [] });
  candidates.push({ command: 'py', args: ['-3'] });

  const home = os.homedir();
  if (home) {
    candidates.push({
      command: path.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
      args: []
    });
  }
  return candidates;
}

function isUsable(command, args) {
  if (path.isAbsolute(command) && !fs.existsSync(command)) return false;
  const result = spawnSync(command, [...args, '--version'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

function main() {
  const candidate = candidateCommands().find((item) => isUsable(item.command, item.args));
  if (!candidate) {
    console.error('FAIL: Could not find a Python executable. Set PYTHON or install python/python3/py.');
    process.exit(1);
  }

  const result = spawnSync(candidate.command, [...candidate.args, ...testArgs], {
    stdio: 'inherit',
    windowsHide: true
  });
  process.exit(result.status ?? 1);
}

if (require.main === module) main();
