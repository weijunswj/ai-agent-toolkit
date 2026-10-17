'use strict';

// Historical programme-state v5 keeps fixed historical identities (repository, PR #380
// review IDs) for read compatibility until the owner-approved post-Core cleanup. These
// tests show that no V3 live write can use that path: v5 and its consumers cannot perform
// effects, the V3 live writers never load them, and the one V3 issue-projection writer
// refuses a legacy v5 or human-v2 surface before any read or write.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { IssueProjectionPublisher, sha256 } = require('../scripts/toolkit-programme-publication.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const LEGACY = ['repo/scripts/toolkit-github-program-state-v5.cjs', 'repo/scripts/toolkit-programme-surface-v1.cjs',
  'repo/scripts/toolkit-github-governance-review-reconciler.cjs'];
// Modules that write V3 live state: issue projections and canonical state, CURRENT and
// authority packets, gate sessions, stack selection and custody cleanup effects.
const V3_LIVE_WRITERS = ['repo/scripts/toolkit-programme-publication.cjs', 'repo/scripts/toolkit-github-program-receipt.cjs',
  'repo/scripts/toolkit-gate-session-launcher.cjs', 'repo/scripts/toolkit-v3-lifecycle.cjs', 'repo/scripts/toolkit-stack-selection.cjs',
  'repo/scripts/toolkit-custody-retention-v3.cjs', 'repo/scripts/toolkit-filesystem-cleanup-adapter.cjs',
  'repo/scripts/toolkit-git-current-tree-expiry-adapter.cjs', 'repo/scripts/toolkit-agent-control.cjs'];

test('historical programme-state v5 and its consumers contain no effect-capable code', () => {
  for (const rel of LEGACY) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(source, /require\(\s*['"](?:node:)?(?:child_process|fs|fs\/promises|https?|net|dgram|worker_threads)['"]\s*\)/, rel);
    assert.doesNotMatch(source, /\b(?:spawnSync|execFileSync|execSync|writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync)\s*\(/, rel);
    assert.doesNotMatch(source, /\bfetch\s*\(/, rel);
  }
});

test('V3 live writers never load programme-state v5, its surface or the governance reconciler', () => {
  const legacyName = /toolkit-github-program-state-v5|toolkit-programme-surface-v1|toolkit-github-governance-review-reconciler/;
  for (const rel of V3_LIVE_WRITERS) {
    const requires = [...fs.readFileSync(path.join(ROOT, rel), 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    assert.equal(requires.some(name => legacyName.test(name)), false, `${rel} requires a legacy v5 module`);
  }
  const script = 'for (const f of JSON.parse(process.argv[1])) require(f); console.log(JSON.stringify(Object.keys(require.cache)));';
  const run = spawnSync(process.execPath, ['-e', script, JSON.stringify(V3_LIVE_WRITERS.map(rel => path.join(ROOT, rel)))],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const loaded = JSON.parse(run.stdout);
  assert.ok(loaded.some(file => file.endsWith('toolkit-programme-publication.cjs')), 'positive control: the writers were loaded');
  assert.equal(loaded.some(file => legacyName.test(file)), false, 'a V3 live writer loaded a legacy v5 module');
});

class CountingTransport {
  constructor(body) { this.body = body; this.reads = 0; this.writes = 0; }
  readIssue() { this.reads++; return { body: this.body, edits: this.writes ? [{ id: 'ours' }, { id: 'before' }] : [{ id: 'before' }] }; }
  writeIssueBody(_r, _n, body) { this.writes++; this.body = body; return { state: 'APPLIED' }; }
}

test('the V3 issue-projection writer refuses a legacy v5 or human-v2 surface before any read or write', () => {
  const base = 'Programme body\n';
  for (const block of [
    '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v5 -->\nstate\n<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->',
    '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v5 -->',
    '<!-- MANAGED-PROGRAM-PARENT:BEGIN human-v2 -->',
    '<!-- MANAGED-PROGRAM-CHILD-CARRIER human-v2 {"schema":"x"} -->',
    'carrier {"schema":"toolkit.github-program.state.v5"}',
    'surface {"schema":"toolkit.github-program.surface.v5"}'
  ]) {
    const transport = new CountingTransport(base);
    assert.throws(() => new IssueProjectionPublisher({ transport }).publish({ repository: 'owner/repo', issue: 7, marker: 'CURRENT',
      block, base_digest: sha256(base) }), e => e.code === 'PUBLICATION_LEGACY_V5_SURFACE_REFUSED', block);
    assert.deepEqual({ reads: transport.reads, writes: transport.writes }, { reads: 0, writes: 0 });
  }
  const transport = new CountingTransport(base);
  const applied = new IssueProjectionPublisher({ transport }).publish({ repository: 'owner/repo', issue: 7, marker: 'CURRENT',
    block: 'V3 CURRENT at canonical revision checkpoint-12 (mentions programme-state v5 by name only)', base_digest: sha256(base) });
  assert.equal(applied.state, 'APPLIED', 'positive control: an ordinary V3 projection still publishes');
});
