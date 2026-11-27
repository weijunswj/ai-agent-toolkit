'use strict';

// Red on the parent (the 27 Nov owner test): the remove toolkit plan put the owner's permissions
// --remove command inside its Kept list line, where the app shows it as text to copy out of a sentence.
// The command now comes once, after the lists, in its own PowerShell block.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const parts = require('../scripts/toolkit-remove-parts.cjs');
const permissions = require('../scripts/toolkit-permissions.cjs');
const { ToolkitRemoval, describePlan, AGENT_LINE } = require('../scripts/toolkit-remove.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

// A computer whose Claude Code settings hold Toolkit's lines and two of the owner's own.
function computer(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-remove-commands-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: ROOT }));
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const settings = path.join(home, '.claude', 'settings.json');
  const block = new permissions.PermissionBlocks({ home, environment, cwd: home }).build({ host: 'claude', scope: 'computer' }).blocks[0];
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: [...block.allow, 'Bash(npm test)', 'WebSearch'], ask: block.ask } }));
  return { home, environment };
}

test('the remove plan carries no command in a list line and gives the permissions command once, after the lists, in a powershell block', t => {
  const pc = computer(t);
  const lines = new parts.PermissionLinesPart({ home: pc.home, environment: pc.environment });
  const removal = new ToolkitRemoval({ home: pc.home, parts: [lines], plugins: () => ({}) });
  const screen = describePlan(removal.plan());
  const listLines = screen.filter(line => /^\s*- /.test(line));
  assert.ok(listLines.some(line => /Toolkit's permission lines/.test(line) && /removed by your own command below the plan/.test(line)), screen.join('\n'));
  assert.deepEqual(listLines.filter(line => line.includes('node "')), [], 'no list line carries a command');
  const command = screen.filter(line => /^node "[^"]+\/repo\/scripts\/toolkit-permissions\.cjs" --remove --host claude$/.test(line));
  assert.equal(command.length, 1, 'the command appears once');
  const at = screen.indexOf(command[0]);
  assert.equal(screen[at - 1], '```powershell');
  assert.equal(screen[at + 1], '```');
  assert.ok(at > screen.indexOf('**Never touched**') && screen.indexOf('**Never touched**') > screen.indexOf('**Kept**'), 'after the plan lists');
  assert.ok(at < screen.indexOf(AGENT_LINE), 'before the agent\'s own steps');
  assert.match(screen[at - 3], /^\*\*Your command first:\*\* run it in your own PowerShell, outside any agent\./);
});

test('a plan with no permission lines left gives no command block', t => {
  const pc = computer(t);
  fs.writeFileSync(path.join(pc.home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
  const removal = new ToolkitRemoval({ home: pc.home, parts: [new parts.PermissionLinesPart({ home: pc.home, environment: pc.environment })], plugins: () => ({}) });
  const screen = describePlan(removal.plan());
  assert.equal(screen.includes('```powershell'), false);
  assert.equal(screen.some(line => line.includes('--remove --host')), false);
});
