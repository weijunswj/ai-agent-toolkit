'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-project-skill-card-hook.cjs');
const { decide, normalise, frontmatterDescription, RAW_URL, API_URL } = require('../scripts/toolkit-claude-project-skill-card-hook.cjs');

const SKILL = 'web-controller-projects';
// main's SKILL.md as the hook would download it: the file in this checkout stands in for main, without the CR a
// Windows checkout may add.
const MAIN = fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'claude-projects', SKILL, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const DESCRIPTION = frontmatterDescription(MAIN);
// The card tool's real input shape, as the coordinator read it from its tool list: one to three proposals.
const proposal = fields => ({ name: SKILL, kind: 'improvement', target: SKILL, description: DESCRIPTION, skillMd: MAIN, ...fields });
const card = (...proposals) => ({ tool_name: 'propose_skills', tool_input: { proposals } });
// Downloads that count their calls: each source returns { text } or { error }.
function downloads(raw, api = raw) {
  const calls = [];
  return {
    calls,
    download: {
      raw: () => { calls.push('raw'); return raw; },
      api: () => { calls.push('api'); return api; },
    },
  };
}
const ok = (fields = {}, from = downloads({ text: MAIN })) => decide(card(proposal(fields)), { download: from.download });

test('an exact card passes after one download, with CR and the final newline as the only allowed differences', () => {
  const from = downloads({ text: MAIN });
  assert.equal(ok({}, from), '');
  assert.deepEqual(from.calls, ['raw']);
  assert.equal(ok({ skillMd: MAIN.replace(/\n/g, '\r\n') }), '');
  assert.equal(ok({ skillMd: MAIN.replace(/\n$/, '') }), '', 'claude.ai drops the final newline when it saves');
  assert.equal(normalise('a\r\nb\n\n\n'), 'a\nb\n');
  assert.match(DESCRIPTION, /^Use when running as a Claude Projects coordinator/);
  assert.match(RAW_URL, /^https:\/\/raw\.githubusercontent\.com\/weijunswj\/ai-agent-toolkit\/main\/repo\/contracts\/claude-projects\/web-controller-projects\/SKILL\.md$/);
  assert.match(API_URL, /^https:\/\/api\.github\.com\/repos\/weijunswj\/ai-agent-toolkit\/contents\/repo\/contracts\/claude-projects\/web-controller-projects\/SKILL\.md\?ref=main$/);
});

test('a card with one changed character, cut short or HTML-escaped is refused with sizes, hashes, offset and cause', () => {
  const at = MAIN.indexOf('Version:');
  const changed = ok({ skillMd: `${MAIN.slice(0, at)}version:${MAIN.slice(at + 8)}` });
  assert.match(changed, /^Toolkit Projects rule: exact skill card\./);
  assert.match(changed, new RegExp(`Main's SKILL\\.md is ${Buffer.byteLength(MAIN)} bytes, sha256 [0-9a-f]{64}; the card's skillMd is ${Buffer.byteLength(MAIN)} bytes, sha256 [0-9a-f]{64}`));
  assert.match(changed, new RegExp(`They first differ at character ${at}: main "[^"]*Version:`));
  assert.match(changed, /Likely cause: changed text\./);
  assert.match(changed, /pass its text unchanged as skillMd, never through a helper, subagent or retyping; follow main's reference\/skill-card\.md\./);
  const cut = ok({ skillMd: MAIN.slice(0, 20000) });
  assert.match(cut, /Likely cause: cut short\./);
  assert.match(cut, /They first differ at character 20000:/);
  const escaped = ok({ skillMd: MAIN.replace(/</g, '&lt;') });
  assert.match(escaped, /Likely cause: HTML-escaped/);
  assert.match(ok({ skillMd: MAIN.replace('&nbsp;', '&amp;nbsp;') }), /Likely cause: HTML-escaped/);
});

test('the other card fields must match the method', () => {
  assert.match(ok({ description: `${DESCRIPTION} ` }), /description must equal main's frontmatter description exactly/);
  assert.match(ok({ kind: 'new', target: undefined }), /kind must be "improvement" \(got "new"\) name and target must both be "web-controller-projects" \(got name "web-controller-projects", target null\)/);
  assert.match(ok({ name: 'other-skill' }), /name and target must both be "web-controller-projects"/);
  assert.match(ok({ skillMd: undefined }), /skillMd is missing/);
});

test('a mismatch reads main once more through the contents API, and passes when that copy matches', () => {
  const newer = `${MAIN}\nAdded line.\n`;
  const lagging = downloads({ text: MAIN }, { text: newer });
  assert.equal(decide(card(proposal({ skillMd: newer })), { download: lagging.download }), '');
  assert.deepEqual(lagging.calls, ['raw', 'api']);
  // Both copies disagree with the card: the refusal reports the raw copy, and an API failure changes nothing.
  for (const api of [{ text: MAIN }, { error: 'timed out' }]) {
    const from = downloads({ text: MAIN }, api);
    assert.match(decide(card(proposal({ skillMd: newer })), { download: from.download }), /Likely cause: changed text\./);
  }
});

test('when main cannot be read the card holds, and the contents API stands in for a failed raw read', () => {
  const none = downloads({ error: 'curl is not installed' }, { error: 'HTTP 503' });
  assert.match(ok({}, none), /could not be checked against main, so it holds: the raw file failed \(curl is not installed\) and the GitHub contents API failed \(HTTP 503\)/);
  const apiOnly = downloads({ error: 'timed out' }, { text: MAIN });
  assert.equal(ok({}, apiOnly), '');
  assert.deepEqual(apiOnly.calls, ['raw', 'api']);
});

test('every controller proposal in one call is checked, and other skills pass without a download', () => {
  const from = downloads({ text: MAIN });
  assert.equal(decide(card({ name: 'notes-skill', kind: 'new', description: 'x', skillMd: 'anything' }), { download: from.download }), '');
  assert.deepEqual(from.calls, []);
  const mixed = card({ name: 'notes-skill', kind: 'new', description: 'x', skillMd: 'anything' }, proposal({ skillMd: MAIN.slice(0, 100) }));
  assert.match(decide(mixed, { download: downloads({ text: MAIN }).download }), /Likely cause: cut short\./);
  // A card that only targets the controller skill under another name is still checked.
  assert.match(decide(card(proposal({ name: 'controller-copy' })), { download: downloads({ text: MAIN }).download }), /name and target must both be/);
  for (const input of [{ tool_name: 'Bash', tool_input: { command: 'x' } }, { tool_name: 'propose_skills' }, { tool_name: 'propose_skills', tool_input: { proposals: 'x' } },
    { tool_name: 'mcp__other__propose_skills', tool_input: { proposals: [proposal({ skillMd: 'x' })] } }]) {
    assert.equal(decide(input, { download: downloads({ error: 'never called' }).download }), '', JSON.stringify(input));
  }
});

test('the hook process passes other tools and input it cannot read without downloading', () => {
  const run = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  for (const input of ['not json', '', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' } }),
    JSON.stringify(card({ name: 'notes-skill', kind: 'new', description: 'x', skillMd: 'anything' }))]) {
    const result = run(input);
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, '', input);
  }
});

test('only the Claude Code plugin registers the hook, on propose_skills alone and without onFailure block', () => {
  for (const rel of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const entries = hooks.hooks.PreToolUse.filter(entry => entry.hooks.some(hook => /toolkit-claude-project-skill-card-hook/.test(hook.command)));
    assert.deepEqual(entries, [{ matcher: '^propose_skills$', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-project-skill-card-hook.cjs"', timeout: 10 }] }], rel);
  }
  for (const other of ['.codex-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, other), 'utf8'), /skill-card-hook/, other);
  }
});
