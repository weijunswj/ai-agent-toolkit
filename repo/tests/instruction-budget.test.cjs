'use strict';

// Byte budgets for always-loaded instruction text. Codex reads instruction files only up to
// project_doc_max_bytes (32 KiB by default) and its docs do not say whether the global file counts,
// so the global block plus this repository's root AGENTS.md must fit together, measured with CRLF
// line endings (a Windows checkout) to keep headroom.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderBlock } = require('../scripts/toolkit-managed-block.cjs');
const { globalRulesBlock } = require('../scripts/toolkit-global-rules.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CODEX_LIMIT = 32 * 1024;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const crlfBytes = text => Buffer.byteLength(text.replace(/\n/g, '\r\n'));

const GLOBAL = renderBlock(globalRulesBlock(ROOT));
const ROOT_AGENTS = read('AGENTS.md');
const GOVERNED = read('repo/contracts/agent-rules/toolkit-governed-rules.md');

test('the global block and root AGENTS.md fit the Codex limit together, with CRLF', () => {
  const combined = `${GLOBAL}\n\n${ROOT_AGENTS}`;
  assert.ok(crlfBytes(combined) < CODEX_LIMIT, `combined ${crlfBytes(combined)} bytes`);
  // The last line of root AGENTS.md must fall inside the first 32 KiB a host would read.
  const lastLine = ROOT_AGENTS.trimEnd().split('\n').pop();
  assert.ok(Buffer.from(combined.replace(/\n/g, '\r\n')).subarray(0, CODEX_LIMIT).toString('utf8').includes(lastLine));
});

test('each block stays inside its own budget', () => {
  assert.ok(crlfBytes(GLOBAL) <= 17000, `global block ${crlfBytes(GLOBAL)} bytes`);
  assert.ok(crlfBytes(GOVERNED) <= 9500, `governed rules ${crlfBytes(GOVERNED)} bytes`);
  assert.ok(crlfBytes(ROOT_AGENTS) <= 15000, `root AGENTS.md ${crlfBytes(ROOT_AGENTS)} bytes`);
  assert.ok(crlfBytes(read('repo/CONTROLLER.md')) <= 18000, 'CONTROLLER.md');
});

test('guidance moved out of root AGENTS.md is still reachable from a loaded layer', () => {
  const moved = [
    ['COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE', GLOBAL],
    ['**Finish authorised work before stopping.**', GLOBAL],
    ['Change-local hygiene', GLOBAL],
    ['## Safety Gates', GLOBAL],
    ['## Human-readable Work', GLOBAL],
    ['n8n-safety-router', GLOBAL],
    ['G0 Discovery -> G1 Builder, including UAT -> G2 Review', ROOT_AGENTS],
    ['Route proof', ROOT_AGENTS],
    ['Decision traces', ROOT_AGENTS],
    ['global-rules.md', ROOT_AGENTS],
    ['repo/contracts/source-of-truth-contract.md', ROOT_AGENTS],
    ['repo/docs/agent-playbooks/INDEX.md', ROOT_AGENTS],
  ];
  for (const [text, layer] of moved) assert.ok(layer.includes(text), text);
  assert.doesNotMatch(ROOT_AGENTS, /GLOBAL-AGENTS\.MD-TEMPLATE|N8N-AGENT-RULES-ADAPTER|one pending owner question/);
});
