'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeHelperAgentRenderer, AgentDirectoryInstaller, MARKER } = require('../scripts/toolkit-claude-helper-agents.cjs');
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v3.json'), 'utf8'));

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-helper-agents-')); return d; }

test('helper definitions take model and effort only from the selected registry stack', () => {
  const renderer = ClaudeHelperAgentRenderer.fromRepository('owner-claude');
  for (const [role, registryRole] of [['G0', 'DISCOVERY_HELPER'], ['G1', 'BUILDER_HELPER']]) {
    const { text } = renderer.render(role);
    const route = registry.profiles['owner-claude'].routes[registryRole];
    assert.match(text, new RegExp(`^model: claude-${route.model.replace('.', '-')}$`, 'm'));
    assert.match(text, new RegExp(`^effort: ${route.reasoning}$`, 'm'));
    assert.match(text, /disallowedTools: Agent, Task/);
    assert.ok(text.includes(MARKER));
    assert.doesNotMatch(text, /replacement21|commands 73-79|owner-mixed-claude-gpt/);
  }
  assert.match(renderer.render('G0').text, /^tools: Read, Glob, Grep$/m);
  assert.throws(() => ClaudeHelperAgentRenderer.fromRepository(''), e => e.code === 'HELPER_AGENTS_STACK_SELECTION_REQUIRED');
  // A GPT stack has no Claude-native helper route and is refused rather than substituted.
  assert.throws(() => ClaudeHelperAgentRenderer.fromRepository('owner-gpt').render('G1'), e => e.code === 'CLAUDE_NATIVE_ROUTE_UNSUPPORTED');
});

test('install creates, updates only managed files, retires known legacy files with a backup, and refuses unmanaged targets', () => {
  const dir = tmp(), backups = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'toolkit-v3-g1-bounded.md'), 'legacy');
    fs.writeFileSync(path.join(dir, 'unrelated.md'), 'keep me');
    const files = ['G0', 'G1'].map(role => ClaudeHelperAgentRenderer.fromRepository('owner-claude').render(role));
    const first = new AgentDirectoryInstaller(dir, files).apply(backups);
    assert.deepEqual(first.actions.map(a => a.action).sort(), ['create', 'create', 'retire-legacy']);
    assert.equal(fs.readFileSync(path.join(first.backup_dir, 'toolkit-v3-g1-bounded.md'), 'utf8'), 'legacy');
    assert.equal(fs.existsSync(path.join(dir, 'toolkit-v3-g1-bounded.md')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'unrelated.md'), 'utf8'), 'keep me');
    assert.deepEqual(new AgentDirectoryInstaller(dir, files).plan().map(a => a.action), ['unchanged', 'unchanged']);
    fs.writeFileSync(path.join(dir, 'toolkit-g1-helper.md'), 'hand-written, no marker');
    assert.throws(() => new AgentDirectoryInstaller(dir, files).apply(backups), e => e.code === 'HELPER_AGENTS_UNMANAGED_TARGET');
    assert.equal(fs.readFileSync(path.join(dir, 'toolkit-g1-helper.md'), 'utf8'), 'hand-written, no marker');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(backups, { recursive: true, force: true }); }
});
