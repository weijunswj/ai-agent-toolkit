'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const LAW = '**Change-local hygiene:** in each change, check affected direct, indirect, dynamic, generated, test, documentation and external consumers. Remove superseded code, routes, exports, settings, dependencies, fallbacks and references in the same change. Keep a compatibility path only with a verified current consumer, a safety or recovery reason, an owner, a removal trigger and a focused test; never discard active or unknown recovery effects. Record brief removal and retention evidence with the normal tests. This is part of the change, not an extra gate or a whole-repository audit.';

function assertChangeLocalLaw(contents) {
  assert.ok(contents.includes(LAW), 'change-local hygiene law must be present and unmodified');
}

test('generic change-local hygiene law is in the global rules and the controller law', () => {
  assertChangeLocalLaw(read('repo/contracts/agent-rules/global-rules.md'));
  assert.match(read('repo/CONTROLLER.md'), /Change-local hygiene law \(generic and prospective\)/);
  assert.match(read('repo/docs/TOOLKIT-V3.md'), /Owner-approved Core hygiene amendment/);
  assert.throws(() => assertChangeLocalLaw(read('repo/contracts/agent-rules/global-rules.md').replace(LAW, '')),
    'missing hygiene rule must fail');
});

test('current Claude hook cannot steer an agent to the retired direct launcher', () => {
  // The hook delegates its refusals to the named-helper policy; neither may steer to the retired launcher.
  const hook = read('repo/scripts/toolkit-claude-agent-hook.cjs') + read('repo/scripts/toolkit-claude-helper-policy.cjs');
  assert.doesNotMatch(hook, /Use repo\/scripts\/toolkit-agent-control\.cjs launch/);
  assert.match(hook, /allows only the toolkit-g0-helper and toolkit-g1-helper agents/);
  const stale = hook.replace('allows only the toolkit-g0-helper and toolkit-g1-helper agents',
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
  "repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs": [
    "isSafeText",
    "isSha"
  ],
  "repo/scripts/toolkit-v3-helper-guard.cjs": [
    "defaultQualification"
  ],
  "repo/scripts/toolkit-control-plane/control-plane-kernel.cjs": [
    "contextRootMatches"
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

// The Toolkit direct (`toolkit-direct`) launcher is retired (Web decision 28), and the run093
// history module that kept its reservation machinery for the reclosure proof is removed (R3).
const scriptFiles = () => fs.readdirSync(path.join(root, 'repo', 'scripts'))
  .filter((name) => /\.c?js$/.test(name)).map((name) => `repo/scripts/${name}`);
const RETIRED_SCRIPT_IDENTIFIERS = [
  'toolkit-direct', 'claude-agent-capacity', 'claude-agent-maximum', 'claudeAgentCapacity', 'claudeManualMaximum',
  'MODEL_CONTRACT', 'claudeInvocation', 'runValidatedClaude', 'launchWithResourceEnvelope', 'admissionDecisionWithResourceEnvelope',
  'probeClaudeAgentCapability', 'AI_AGENT_TOOLKIT_CAPABILITY_PROBE', 'AI_AGENT_TOOLKIT_CHECKER', 'launchR093WithAuthenticatedController',
  'launchR093WithResourceEnvelope', 'resourceOperation', 'mode0', 'MODE0', 'checkerResultStatus', 'checkerLaunchSpec', 'fable-5', 'opus-4.8',
];
const RETIRED_DOC_PHRASES = [
  /toolkit-agent-control\.cjs (?:launch|checker|checker-result|status)\b/, /checker-result --review-id/,
  /Direct Toolkit-managed subagents only/, /Fable 5 worker/, /Opus 4\.8 checker/, /AI_AGENT_TOOLKIT_CAPABILITY_PROBE/,
];
function retiredScriptHits(rel, source) {
  return RETIRED_SCRIPT_IDENTIFIERS.filter((name) => source.includes(name));
}

test('retired direct-launcher routes, settings and setup choices do not return to current scripts', () => {
  for (const rel of scriptFiles()) assert.deepEqual(retiredScriptHits(rel, read(rel)), [], rel);
  assert.equal(fs.existsSync(path.join(root, 'repo', 'scripts', 'toolkit-agent-control-run093-history.cjs')), false);
  for (const rel of scriptFiles()) {
    const source = read(rel);
    assert.doesNotMatch(source, /toolkit-agent-control-run093-history/, `${rel} must not load the retired launcher history`);
    assert.doesNotMatch(source, /TOPOLOGIES\.CLAUDE_DIRECT/, `${rel} must not select the retired direct topology`);
  }
  const controlSource = read('repo/scripts/toolkit-agent-control.cjs');
  for (const command of ['launch', 'checker', 'checker-result', 'status']) {
    assert.doesNotMatch(controlSource, new RegExp(`args\\.command === '${command}'`), `retired CLI command ${command}`);
  }
  // Mutation: a reintroduced identifier is detected.
  assert.deepEqual(retiredScriptHits('repo/scripts/setup-toolkit-core.cjs', "choice === 'toolkit-direct'"), ['toolkit-direct']);
  assert.deepEqual(retiredScriptHits('repo/scripts/toolkit-agent-control.cjs', 'const MODEL_CONTRACT = {};'), ['MODEL_CONTRACT']);
});

test('current documentation and skills no longer teach the retired direct launcher', () => {
  const docs = ['README.md', 'repo/docs/HOW-TO-USE.md', 'repo/docs/FOR_AI_AGENTS.md', 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md', 'repo/docs/TOOLKIT-V3.md',
    'repo/ARCHITECTURE.md', 'repo/CONTROLLER.md', 'skills/toolkit-setup/SKILL.md'];
  for (const rel of docs) for (const phrase of RETIRED_DOC_PHRASES) assert.doesNotMatch(read(rel), phrase, `${rel}: ${phrase}`);
  assert.match(read('skills/toolkit-setup/SKILL.md'), /`toolkit-direct`\) worker and checker topology is retired/);
  assert.match(read('repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), /### Retired Toolkit Direct Launcher/);
});
