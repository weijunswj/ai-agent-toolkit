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
  assert.ok(crlfBytes(GLOBAL) <= 18500, `global block ${crlfBytes(GLOBAL)} bytes`);
  assert.ok(crlfBytes(GOVERNED) <= 4250, `governed rules ${crlfBytes(GOVERNED)} bytes`);
  assert.ok(crlfBytes(ROOT_AGENTS) <= 15000, `root AGENTS.md ${crlfBytes(ROOT_AGENTS)} bytes`);
  // CONTROLLER.md loads only for controllers, not every session; the rules audit cut it below 18000.
  assert.ok(crlfBytes(read('repo/CONTROLLER.md')) <= 18000, 'CONTROLLER.md');
  // The gate rules load on demand for gate sessions only, but stay compact. The cap rose from
  // 10,500 to hold the review-round rules (self-check, finding severities, narrow rechecks), then to
  // 11,750 for the hook-change merge rule (the hook test pack, revert proof and real-host smoke).
  assert.ok(crlfBytes(read('repo/contracts/agent-rules/gate-rules.md')) <= 11750, 'gate rules');
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
