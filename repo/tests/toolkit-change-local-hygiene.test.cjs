'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const LAW = "**Change-local hygiene (all Toolkit-managed software repositories).** In each authorised implementation, refactor or correction, inspect affected direct, indirect, dynamic, generated, test, documentation and external consumers. Remove superseded code, routes, exports, settings, dependencies, fallbacks and references in the same change, rather than leaving dead compatibility layers. Retain a compatibility or migration path only with a verified current consumer, safety/recovery reason, named owner, removal trigger and focused regression; never discard active or UNKNOWN recovery effects. Record concise changed-path removal/retention evidence with normal tests and CI. This is part of existing implementation and review, not another gate, reviewer, unrelated whole-tree audit or retrospective mutation authority.";

const managedSurfaces = [
  'repo/contracts/agent-rules/ai-coding-agent-execution.md',
  'repo/contracts/agent-rules/AGENTS.template.md',
  'repo/contracts/agent-rules/CLAUDE.template.md',
  'repo/contracts/agent-rules/GEMINI.template.md',
  'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
  'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md',
  'AGENTS.md'
];

function assertChangeLocalLaw(contents) {
  assert.ok(contents.includes(LAW), 'change-local hygiene law must be present and unmodified');
}

test('generic change-local hygiene law is identical on all owned instruction surfaces', () => {
  for (const rel of managedSurfaces) assertChangeLocalLaw(read(rel));
  assert.match(read('repo/CONTROLLER.md'), /Change-local hygiene law \(generic and prospective\)/);
  assert.match(read('repo/docs/TOOLKIT-V3.md'), /Owner-approved Core hygiene amendment/);
  assert.throws(() => assertChangeLocalLaw(read(managedSurfaces[0]).replace(LAW, '')),
    'missing hygiene rule must fail');
});

test('current Claude hook cannot steer an agent to the retired direct launcher', () => {
  const hook = read('repo/scripts/toolkit-claude-agent-hook.cjs');
  assert.doesNotMatch(hook, /Use repo\/scripts\/toolkit-agent-control\.cjs launch/);
  assert.match(hook, /registry-pinned launcher through an authorised controller/);
  const stale = hook.replace('registry-pinned launcher through an authorised controller',
    'Use repo/scripts/toolkit-agent-control.cjs launch');
  assert.match(stale, /Use repo\/scripts\/toolkit-agent-control\.cjs launch/,
    'mutation demonstrates that the forbidden old steering would be detected');
});

// These removed helpers had exactly one local identifier occurrence (their own declarations)
// and no exported/current call site at the checked candidate. Keep their dead branches out.
const RETIRED_HELPERS = {
  "repo/scripts/setup-toolkit-core.cjs": [
    "inspectClaudeNativePluginState",
    "formatBool",
    "formatTargetState",
    "currentHelperOutcome",
    "helperRecommendationReason"
  ],
  "repo/scripts/toolkit-local-bridge.cjs": [
    "updateReportIsMeaningful",
    "copyDirectoryAtomically"
  ],
  "repo/scripts/sync-agent-instruction-shims.cjs": [
    "slash",
    "resolveRel"
  ],
  "repo/scripts/source-watch-advisory-targets.cjs": [
    "optionalString"
  ],
  "repo/scripts/toolkit-assurance-web-finality.cjs": [
    "sameReceiptCandidate"
  ],
  "repo/scripts/toolkit-evidence-plan-compiler.cjs": [
    "isLowerHex"
  ],
  "repo/scripts/toolkit-github-program-receipt.cjs": [
    "digestWithoutKeys"
  ],
  "repo/scripts/toolkit-github-program-state-v5.cjs": [
    "keysFrom",
    "authorityDigest",
    "h2Array",
    "h2PrProse",
    "h2ReadChildUnbound"
  ],
  "repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs": [
    "isSafeText",
    "isSha"
  ],
  "repo/scripts/toolkit-v3-helper-guard.cjs": [
    "defaultQualification"
  ]
};
test('removed unreferenced helpers do not return in current runtime modules', () => {
  for (const [rel, names] of Object.entries(RETIRED_HELPERS)) {
    const source = read(rel);
    for (const name of names) {
      const pattern = new RegExp('^\\s*(?:async )?function\\s+' + name + '\\s*\\(', 'm');
      assert.doesNotMatch(source, pattern, rel + ': dead helper ' + name);
    }
  }
  assert.doesNotMatch(read('repo/docs/TOOLKIT-V3.md'), /PR #513.*is the current V3 proposal continuation/);
});
