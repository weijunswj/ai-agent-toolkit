'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const controller = fs.readFileSync(path.join(repoRoot, 'repo', 'CONTROLLER.md'), 'utf8');

test('controller full-read policy is bootstrap/change-bound rather than packet-bound', () => {
  assert.match(controller, /## Controller bootstrap and refresh/);
  assert.match(controller, /new Web Controller bootstrap, takeover, explicit handover, restart after lost controller state, or new chat/);
  assert.match(controller, /Do not re-read the full Controller merely because a worker\/Loop packet returns/);
  assert.match(controller, /perform a lightweight canonical Controller revision check/);
  assert.match(controller, /If the canonical Controller identity is unchanged, continue from the bound revision without a full re-read/);
  assert.match(controller, /in-flight run remains governed by the exact Controller\/Lock revision it was admitted under/);
});

test('every new terminal Toolkit issue or PR requires a durable closing receipt', () => {
  assert.match(controller, /## Terminal GitHub object receipts/);
  assert.match(controller, /Every Toolkit-managed GitHub issue or pull request that enters a terminal state/);
  assert.match(controller, /issue closure and PR merge or close-without-merge/);
  assert.match(controller, /A terminal transition is not governance-complete until the receipt is durably read back/);
  assert.match(controller, /TERMINAL_RECEIPT_INCOMPLETE/);
  assert.match(controller, /Exact receipt wording\/layout is renderer\/automation policy, not Controller formatting law/);
});

test('terminal receipt law does not require replaying historical terminal operations', () => {
  assert.match(controller, /Historical terminal objects are not bulk-replayed solely for receipt backfill/);
  assert.match(controller, /do not reopen or replay the terminal operation merely to add the receipt/);
});
