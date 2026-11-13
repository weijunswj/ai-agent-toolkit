'use strict';

// Setup ends with one line that names each app whose open sessions still use the old Toolkit
// skill files or rules, and prints nothing when this run changed none.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/setup-toolkit-core.cjs');

const { NewSessionNotice } = core;

test('nothing changed: no new-session line', () => {
  const notice = new NewSessionNotice('codex');
  notice.addNativePlugin({ updated_this_run: false, restart_required: false });
  notice.addGlobalRules({ status: 'current' });
  notice.addCopies({ copied: [], current: [{ target: '/h/.codex/skills', skill: 'a' }], handCopies: [], pruned: [] });
  assert.deepEqual(notice.apps(), []);
  assert.deepEqual(notice.lines(), []);
});

test('a Codex plugin refresh or a rules update names Codex', () => {
  assert.deepEqual(new NewSessionNotice('codex').addNativePlugin({ updated_this_run: true, restart_required: true }).apps(), ['Codex']);
  assert.deepEqual(new NewSessionNotice('codex').addGlobalRules({ status: 'updated' }).apps(), ['Codex']);
  assert.deepEqual(new NewSessionNotice('codex').addGlobalRules({ status: 'held' }).apps(), []);
});

test('a Claude Code install check that refreshed rules or helpers names Claude Code', () => {
  const notice = (checks) => new NewSessionNotice('claude-code').addInstallCheck({ status: 'passed', checks }).apps();
  assert.deepEqual(notice([{ id: 'global-rules', status: 'passed', updated: true }]), ['Claude Code']);
  assert.deepEqual(notice([{ id: 'global-rules', status: 'passed' }]), []);
  assert.deepEqual(new NewSessionNotice('claude-code').addInstallCheck(null).apps(), []);
});

test('a Claude Code plugin install names Claude Code', () => {
  assert.deepEqual(new NewSessionNotice('claude-code').addNativePlugin({ restart_required: true }).apps(), ['Claude Code']);
  assert.deepEqual(new NewSessionNotice('claude-code').addNativePlugin({ restart_required: false, status: 'already fresh' }).apps(), []);
});

test('skill copies count only when a copy, prune or removal happened, and Antigravity copies name Antigravity', () => {
  const antigravity = '/h/.gemini/config/skills';
  const notice = new NewSessionNotice('codex', { antigravityTarget: antigravity });
  notice.addCopies({ copied: [{ target: antigravity, skill: 'x' }], current: [], handCopies: [], pruned: [] });
  assert.deepEqual(notice.apps(), ['Antigravity']);
  notice.addCopies({ copied: [], current: [], handCopies: [], pruned: [{ target: '/h/.agents/skills', skill: 'y' }] });
  assert.deepEqual(notice.apps(), ['Codex', 'Antigravity']);
  assert.deepEqual(new NewSessionNotice('claude-code', { antigravityTarget: antigravity })
    .addCopies({ copied: [], current: [], handCopies: [], pruned: [], antigravityRemoved: [{ target: antigravity, skill: 'z' }] }).apps(), ['Antigravity']);
  assert.deepEqual(new NewSessionNotice('codex').addAntigravity(3).apps(), ['Antigravity']);
  assert.deepEqual(new NewSessionNotice('codex').addAntigravity(0).apps(), []);
});

test('the closing line names every affected app once, in a fixed order', () => {
  const notice = new NewSessionNotice('codex').addAntigravity(1).addGlobalRules({ status: 'updated' }).addNativePlugin({ updated_this_run: true });
  const lines = notice.lines();
  assert.equal(lines[0], '## Start a new session');
  assert.equal(lines[1], 'Start a new session in Codex and Antigravity, and close sessions opened before this run: this run changed Toolkit skill files or rules, and open sessions keep using the old ones.');
  assert.equal(lines.length, 2);
});

test('setup applies the Antigravity and n8n answers into the notice', () => {
  const notice = new NewSessionNotice('claude-code', { antigravityTarget: '/h/.gemini/config/skills' });
  const owner = { install: () => ({ copied: [{ target: '/h/.claude/skills', skill: 'n8n-x' }], current: [], handCopies: [], pruned: [] }) };
  core.installOfficialN8nSkills({ host: 'claude-code' }, owner, () => false, notice);
  assert.deepEqual(notice.apps(), ['Claude Code']);
  const antigravity = { install: () => ({ copied: [{ target: '/h/.gemini/config/skills', skill: 'a' }], current: [], handCopies: [], pruned: [] }) };
  const after = new NewSessionNotice('codex');
  core.applyAntigravitySkills({ setupChoices: { antigravitySkills: 'copy' } }, antigravity, null, after);
  assert.deepEqual(after.apps(), ['Antigravity']);
  const kept = new NewSessionNotice('codex');
  core.applyAntigravitySkills({ setupChoices: { antigravitySkills: 'keep' } }, antigravity, null, kept);
  assert.deepEqual(kept.apps(), []);
});
