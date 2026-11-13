'use strict';

// One `setup toolkit` in Codex asked its whole question bank again because the Codex plugin install,
// which runs after the owner answers, writes its own tables into config.toml. The helper-limit
// proposal the owner approved was bound to the file before that write, so it went stale and setup
// stopped. The approval now carries over when the file changed only by the Toolkit plugin's tables
// and the edit is the same; any other change still asks again.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../scripts/codex-delegation-config.cjs');
const { defineCodexSetup } = require('../scripts/setup-core-codex.cjs');

const V1 = 'MultiAgentV1';
const PLUGIN_TABLES = [
  '',
  '[marketplaces.ai-agent-toolkit-local]',
  'source_type = "local"',
  'source = "C:/Users/example/.ai-agent-toolkit/source/ai-agent-toolkit"',
  '',
  '[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]',
  'enabled = true',
  '',
  '[hooks.state."ai-agent-toolkit@ai-agent-toolkit-local:session-start"]',
  'trusted_hash = "abc"',
  '',
].join('\n');

const folders = [];
test.after(() => { for (const dir of folders) fs.rmSync(dir, { recursive: true, force: true }); });
function configFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-helper-approval-'));
  folders.push(dir);
  const file = path.join(dir, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (text !== null) fs.writeFileSync(file, text);
  return file;
}
const preview = (file, helperCount = 1) => config.previewCodexDelegation(file, { runtime: V1, helperCount, allowUserOwnedReplacement: true });
const codexSetup = () => defineCodexSetup({ RUNTIMES: config.RUNTIMES });

test('the approval holds when only the Toolkit plugin tables were added after it', () => {
  const file = configFile('model = "example"\n');
  const approved = preview(file);
  assert.equal(approved.status, 'preview');
  fs.appendFileSync(file, PLUGIN_TABLES);
  const fresh = preview(file);
  assert.notEqual(fresh.approval_binding.snapshot.sha256, approved.approval_binding.snapshot.sha256);
  assert.equal(config.sameApprovedProposal(approved, fresh), true);
  // Setup takes the fresh proposal, bound to the file as it is now.
  const chosen = codexSetup().currentApprovedProposal('one-helper', file, { runtime: { runtime: V1 } }, 1, approved);
  assert.equal(chosen.approval_binding.snapshot.sha256, fresh.approval_binding.snapshot.sha256);
  assert.equal(chosen.approval_binding.proposal_digest, approved.approval_binding.proposal_digest);
});

test('a config.toml the plugin install created counts as empty before it', () => {
  const file = configFile(null);
  const approved = preview(file);
  assert.equal(approved.status, 'preview');
  fs.writeFileSync(file, PLUGIN_TABLES);
  assert.equal(config.sameApprovedProposal(approved, preview(file)), true);
});

test('any other change after the approval still needs a fresh answer', () => {
  const file = configFile('approval_policy = "on-request"\n');
  const approved = preview(file);
  fs.writeFileSync(file, `approval_policy = "never"\n${PLUGIN_TABLES}`);
  const fresh = preview(file);
  assert.equal(config.sameApprovedProposal(approved, fresh), false, 'an owner setting changed too');
  const chosen = codexSetup().currentApprovedProposal('one-helper', file, { runtime: { runtime: V1 } }, 1, approved);
  assert.equal(chosen, approved, 'the stale approval is kept, so the write refuses and asks again');
  // A different edit is never carried over, even on an unchanged file.
  const other = configFile('model = "example"\n');
  const one = preview(other);
  fs.appendFileSync(other, PLUGIN_TABLES);
  assert.equal(config.sameApprovedProposal(one, preview(other, 2)), false);
});

test('only the install\'s own three tables are ignored, never another table that names ai-agent-toolkit', () => {
  for (const extra of [
    "\n[projects.'C:\\Users\\example\\GitHub\\ai-agent-toolkit']\ntrust_level = \"trusted\"\n",
    '\n[mcp_servers.ai-agent-toolkit-notes]\ncommand = "notes.exe"\n',
    '\n[plugins."ai-agent-toolkit@another-marketplace"]\nenabled = true\n',
    '\n[marketplaces.ai-agent-toolkit-local-copy]\nsource = "x"\n',
  ]) {
    const file = configFile('model = "example"\n');
    const approved = preview(file);
    fs.appendFileSync(file, `${PLUGIN_TABLES}${extra}`);
    assert.equal(config.sameApprovedProposal(approved, preview(file)), false, extra);
  }
});

test('an unchanged file keeps the approved proposal as it is', () => {
  const file = configFile('model = "example"\n');
  const approved = preview(file);
  assert.equal(codexSetup().currentApprovedProposal('one-helper', file, { runtime: { runtime: V1 } }, 1, approved), approved);
});
