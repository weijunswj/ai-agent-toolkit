'use strict';

// Byte budgets for always-loaded instruction text. Codex reads the whole user-level AGENTS.md
// (the owner's own sections plus the Toolkit global block) and the repository's AGENTS.md up to
// project_doc_max_bytes (32 KiB by default). Open-source Codex counts only the repository files, but
// Codex desktop 26.1016 cut the repository rules off where both files together reached 32 KiB (UAT,
// 22 October 2026). With the owner's yes, setup raises the limit to 65536, so the budget is checked
// against the raised limit with a realistic hand-written user section, with CRLF for headroom.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderBlock } = require('../scripts/toolkit-managed-block.cjs');
const { globalRulesBlock } = require('../scripts/toolkit-global-rules.cjs');
const { controllerFiles } = require('./support/controller-text.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const RAISED_LIMIT = 64 * 1024;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const crlfBytes = text => Buffer.byteLength(text.replace(/\n/g, '\r\n'));

const GLOBAL = renderBlock(globalRulesBlock(ROOT));
const ROOT_AGENTS = read('AGENTS.md');
const GOVERNED = read('repo/contracts/agent-rules/toolkit-governed-rules.md');
// A hand-written user section about the size of the owner's own ~/.codex/AGENTS.md (4,924 bytes).
const USER_SECTION = `# My rules\n${'- A hand-written preference line of a typical length here.\n'.repeat(85)}`;

test('a realistic user file, the global block and root AGENTS.md fit the raised Codex limit, with CRLF', () => {
  assert.ok(crlfBytes(USER_SECTION) >= 4900, 'the user section is realistic');
  const combined = `${USER_SECTION}\n${GLOBAL}\n\n${ROOT_AGENTS}`;
  assert.ok(crlfBytes(combined) < RAISED_LIMIT, `combined ${crlfBytes(combined)} bytes`);
  // The last line of root AGENTS.md must fall inside the bytes Codex reads.
  const lastLine = ROOT_AGENTS.trimEnd().split('\n').pop();
  assert.ok(Buffer.from(combined.replace(/\n/g, '\r\n')).subarray(0, RAISED_LIMIT).toString('utf8').includes(lastLine));
  // After the rules audit moved the gate mechanics out, the three files sit just over the 32 KiB
  // default, so setup keeps offering the raise rather than relying on the default.
  assert.match(fs.readFileSync(path.join(ROOT, 'repo/scripts/toolkit-global-rules.cjs'), 'utf8'), /const DOC_LIMIT_TARGET = 65536;/);
});

test('each block stays inside its own budget', () => {
  // The rules audit moved the gate mechanics into the on-demand gate rules and cut the global block
  // from 22,700 to the cap below, leaving headroom only for lanes already in flight. The governed
  // block took the issue rules from the global layer, so its cap rose a little. The combined Codex
  // limit above stays the hard cap.
  // Owner record 335 (5 November) confirms 19,400 and 44,900, overriding the 4 November
  // cap decision, preserving wording and allowing Windows CRLF. The combined limit still applies.
  // The global cap rose to 20,900 for the Development Principles section: the owner asked on
  // 14 November for principles that steer all development in every repository, so they load every session.
  assert.ok(crlfBytes(GLOBAL) <= 20900, `global block ${crlfBytes(GLOBAL)} bytes`);
  assert.ok(crlfBytes(GOVERNED) <= 4250, `governed rules ${crlfBytes(GOVERNED)} bytes`);
  assert.ok(crlfBytes(ROOT_AGENTS) <= 15000, `root AGENTS.md ${crlfBytes(ROOT_AGENTS)} bytes`);
  // CONTROLLER.md loads only for controllers, not every session. It was one file capped at 18,500
  // bytes until its step-by-step sections moved, word for word, into the pages under
  // repo/controller/. The core is what a controller always loads, so its cap dropped to 9,500; a
  // page loads at its step and holds at most 5,000. A new rule goes on the page for its step.
  assert.ok(crlfBytes(read('repo/CONTROLLER.md')) <= 9500, `CONTROLLER.md ${crlfBytes(read('repo/CONTROLLER.md'))} bytes`);
  const pages = controllerFiles().slice(1);
  assert.equal(pages.length, 4);
  for (const rel of pages) assert.ok(crlfBytes(read(rel)) <= 5000, `${rel} ${crlfBytes(read(rel))} bytes`);
  // The gate rules load on demand for gate sessions only, but stay compact. The cap rose from
  // 10,500 to hold the review-round rules (self-check, finding severities, narrow rechecks), then to
  // 11,750 for the hook-change merge rule (the hook test pack, revert proof and real-host smoke), then
  // to 11,900 for the gate workspace rule (a writing gate opens in the folder it writes), then to
  // 13,450 for the task auto-merge rule (the owner's answer, when the controller merges, the
  // always-manual list and the owner's label for it), then to 13,600 for the release-plan CI
  // check-up clause in the G0 bullet (it had moved to TOOLKIT-DELIVERY.md while this file was full),
  // then to 13,760 for the controller's own eligibility run before a task auto-merge (the CI check
  // passes while auto-merge is off, and that green can outlive the off period), then to 14,000 for
  // Claude Projects as the third app (its switch is a project line, and its one merge thread merges),
  // then to 14,400 for merging before the owner's test and one real-host round per release batch.
  assert.ok(crlfBytes(read('repo/contracts/agent-rules/gate-rules.md')) <= 14400, 'gate rules');
});

test('the Projects controller skill fits a claude.ai skill card, with room for lanes in flight', () => {
  // The coordinator reads SKILL.md every turn, and the owner saves it to claude.ai with a skill card,
  // which refuses a body over 48 KB. The exact cut is not published, so the hard ceiling uses the
  // stricter 48,000-byte reading of the body (the text after the frontmatter) and is never raised.
  // The budget keeps the raw file about 4 KB under it, for lanes already in flight: detail goes into
  // the reference files beside it. Raise the budget only with a reason recorded here, and never above 47,000.
  // Owner record 335 (5 November) confirms the 44,900 cap, overriding the 4 November
  // decision. Count CRLF on every checkout; the skill-card body ceiling stays unchanged.
  const skill = read('repo/contracts/claude-projects/web-controller-projects/SKILL.md');
  assert.ok(crlfBytes(skill) <= 44900, `Projects skill ${crlfBytes(skill)} bytes (CRLF)`);
  const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.ok(crlfBytes(body) < 48000, `Projects skill body ${crlfBytes(body)} bytes (CRLF)`);
});

test('guidance moved out of root AGENTS.md is still reachable from a loaded layer', () => {
  const moved = [
    ['COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE', GLOBAL],
    ['**Finish authorised work before stopping.**', GLOBAL],
    ['Change-local hygiene', GLOBAL],
    ['## Safety Gates', GLOBAL],
    ['## Human-readable Work', GLOBAL],
    ['n8n-safety-router', GLOBAL],
    ['load the `n8n-safety-router` skill before any n8n work; if it is unavailable, stop and report that', GOVERNED],
    ['G0 Discovery -> G1 Builder, including UAT -> G2 Review', GLOBAL],
    ['gate-rules.md', GLOBAL],
    ['Route proof', read('repo/contracts/agent-rules/gate-rules.md')],
    ['Decision traces', ROOT_AGENTS],
    ['global-rules.md', ROOT_AGENTS],
    ['repo/contracts/source-of-truth-contract.md', ROOT_AGENTS],
    ['repo/docs/agent-playbooks/INDEX.md', ROOT_AGENTS],
    ['Check long runs early against their usual time', GLOBAL],
    ['## Long Runs', read('skills/repository-agent-rules/repo-local/docs/agent-playbooks/fast-tests-and-sharding.md')],
  ];
  for (const [text, layer] of moved) assert.ok(layer.includes(text), text);
  assert.doesNotMatch(ROOT_AGENTS, /GLOBAL-AGENTS\.MD-TEMPLATE|N8N-AGENT-RULES-ADAPTER|one pending owner question/);
});
