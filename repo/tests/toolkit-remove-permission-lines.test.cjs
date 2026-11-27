'use strict';

// remove toolkit lists Toolkit's permission lines with the owner's one --remove command, writes none
// itself, says what stays, and keeps the Toolkit folder (where that command runs from) until no
// Toolkit line is left.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const parts = require('../scripts/toolkit-remove-parts.cjs');
const permissions = require('../scripts/toolkit-permissions.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

function computer(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-remove-lines-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: ROOT }));
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const settings = path.join(home, '.claude', 'settings.json');
  const block = new permissions.PermissionBlocks({ home, environment, cwd: home }).build({ host: 'claude', scope: 'computer' }).blocks[0];
  return { home, environment, settings, block };
}

test('the plan lists each file\'s Toolkit lines with the owner\'s command and what stays; it writes nothing', t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, JSON.stringify({ permissions: { allow: [...pc.block.allow, 'Bash(npm test)', 'WebSearch'], ask: pc.block.ask } }));
  const before = fs.readFileSync(pc.settings, 'utf8');
  const part = new parts.PermissionLinesPart({ home: pc.home, environment: pc.environment });
  const items = part.plan();
  assert.equal(items.length, 1);
  assert.equal(items[0].what, `~/.claude/settings.json: ${pc.block.allow.length + pc.block.ask.length} Toolkit lines`);
  assert.equal(items[0].action, 'keep', 'remove toolkit never writes a permission line');
  assert.equal(items[0].app, 'claude-code');
  assert.equal(items[0].detail, 'removed by your own command below the plan, not by this list; it takes out only Toolkit\'s and keeps your 2 other lines');
  assert.match(items[0].command, /^node "[^"]+\/repo\/scripts\/toolkit-permissions\.cjs" --remove --host claude$/);
  assert.deepEqual(part.apply(items), []);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), before);
});

test('the Toolkit folder stays while Toolkit lines are left, and goes once they are gone', t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, JSON.stringify({ permissions: { allow: [...pc.block.allow, 'Bash(npm test)'], ask: pc.block.ask } }));
  const lines = new parts.PermissionLinesPart({ home: pc.home, environment: pc.environment });
  const folder = new parts.ToolkitFolderPart({ home: pc.home, environment: pc.environment, plugins: () => ({}), linesLeft: () => lines.left() });
  const held = folder.apply(folder.plan());
  assert.deepEqual(held, [{ what: '~/.ai-agent-toolkit', result: 'kept', reason: 'Toolkit\'s permission lines are still in your settings; run the toolkit permissions --remove command given below the plan first, then say remove toolkit again' }]);
  assert.ok(fs.existsSync(path.join(pc.home, '.ai-agent-toolkit', 'current', 'state.json')));
  // The closing lines name the waiting folder with this reason, not a plugin.
  const { ToolkitRemoval, describeResult } = require('../scripts/toolkit-remove.cjs');
  const make = () => new ToolkitRemoval({ home: pc.home, parts: [lines, new parts.ToolkitFolderPart({ home: pc.home, environment: pc.environment, plugins: () => ({}), linesLeft: () => lines.left() })], plugins: () => ({}) });
  const closing = describeResult(make().apply(make().plan().code)).join('\n');
  assert.match(closing, /- \*\*Toolkit folder:\*\* ~\/\.ai-agent-toolkit: Toolkit's permission lines are still in your settings/);
  assert.match(closing, /- \*\*Still to do:\*\* the Toolkit folder stays for the reason under Kept\./);
  assert.doesNotMatch(closing, /Nothing of Toolkit's was left|plugin is still installed/);
  fs.writeFileSync(pc.settings, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
  assert.deepEqual(lines.plan(), [], 'nothing to list once the owner ran the command');
  const gone = folder.apply(folder.plan());
  assert.ok(gone.some(item => item.result === 'removed'), JSON.stringify(gone));
  assert.equal(fs.existsSync(path.join(pc.home, '.ai-agent-toolkit', 'current')), false);
});

test('a settings file that cannot be read holds the folder and says so', t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, '{ broken');
  const lines = new parts.PermissionLinesPart({ home: pc.home, environment: pc.environment });
  assert.equal(lines.plan()[0].action, 'held');
  const folder = new parts.ToolkitFolderPart({ home: pc.home, environment: pc.environment, plugins: () => ({}), linesLeft: () => lines.left() });
  assert.match(folder.apply(folder.plan())[0].reason, /permission settings could not be read/);
});

test('the default parts list the permission lines before anything else is removed', () => {
  const keys = parts.defaultParts({ environment: { CLAUDE_CONFIG_DIR: '/x/.claude', CODEX_HOME: '/x/.codex' }, home: '/x' }).map(part => part.key);
  assert.equal(keys.indexOf('permission_lines'), 1);
  // The Toolkit folder is the last part that removes anything; only the MCP report runs after it.
  assert.deepEqual(keys.slice(-2), ['toolkit_folder', 'mcp_key_helpers']);
});
