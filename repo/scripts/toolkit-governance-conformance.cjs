'use strict';

// `toolkit governance check`: a read-only conformance report for one repository (#542). It never
// writes anything. Exit codes: 0 conformant, 1 drift, incomplete materials or a decision still
// pending, 2 the state could not be read.
//
// It reports the governance state, the governed block (missing, legacy, edited by hand or older
// than this Toolkit's source), the programme binding, the no-force-push branch ruleset an ENABLED
// GitHub repository must carry (asked of GitHub through `gh`; `--offline` skips it and an
// unreachable GitHub reports it unverified, which never counts as present or as drift), and
// whether prompt-hold enforcement is
// active on each host. Enforcement never counts as active unless a host really runs the hook:
// hosts without plugin hooks (cloud sessions, Claude Projects threads) and OpenCode are
// `unsupported`.

const fs = require('node:fs');
const path = require('node:path');

const managedBlock = require('./toolkit-managed-block.cjs');
const governance = require('./toolkit-governance-state.cjs');
const catalogue = require('./toolkit-governance-catalogue.cjs');
const ruleset = require('./toolkit-governance-ruleset.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const GOVERNED_SOURCE_REL = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const VERSION_REL = 'repo/contracts/toolkit-local-bridge/version.json';
const PROMPT_HOLD_HOOK = 'toolkit-governance-hook';
const HOST_HOOK_FILES = Object.freeze({ claude_code: ['.claude-plugin', 'hooks', 'hooks.json'], codex: ['.codex-plugin', 'hooks', 'hooks.json'] });

// The governed block this Toolkit copy would install now.
function expectedGovernedBlock(root = ROOT) {
  const version = JSON.parse(fs.readFileSync(path.join(root, ...VERSION_REL.split('/')), 'utf8')).version;
  const body = fs.readFileSync(path.join(root, ...GOVERNED_SOURCE_REL.split('/')), 'utf8');
  return { source: GOVERNED_SOURCE_REL, name: governance.GOVERNED_BLOCK, version, body };
}

// Whether this Toolkit copy ships a prompt-submit hold hook for a host. A host whose hook files
// carry no hold hook reports `inactive`; a shipped hook is not yet proof that it is installed
// and trusted on this computer.
function enforcementStatus(root = ROOT) {
  const hosts = {};
  for (const [host, parts] of Object.entries(HOST_HOOK_FILES)) {
    let shipped = false;
    try {
      const config = JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
      const entries = config && config.hooks && Array.isArray(config.hooks.UserPromptSubmit) ? config.hooks.UserPromptSubmit : [];
      shipped = JSON.stringify(entries).includes(PROMPT_HOLD_HOOK);
    } catch { shipped = false; }
    hosts[host] = shipped
      ? { status: 'shipped', reason: 'installed-and-trusted-state-not-checked' }
      : { status: 'inactive', reason: 'prompt-hold-hook-not-shipped' };
  }
  hosts.opencode = { status: 'unsupported', reason: 'no-prompt-blocking-mechanism' };
  hosts.cloud_and_projects = { status: 'unsupported', reason: 'no-plugin-hooks' };
  return hosts;
}

function finding(id, severity, message) { return Object.freeze({ id, severity, message }); }

// Reads only. Options pass through to the state reader (registry location in tests) and may set
// `toolkitRoot` for the source comparison, `offline: true` to skip the GitHub ruleset read, and
// `rulesetReader` (tests).
function checkConformance(cwd, options = {}) {
  const toolkitRoot = options.toolkitRoot || ROOT;
  let state;
  try {
    state = governance.governanceState(cwd, options);
  } catch (error) {
    return report(2, null, [finding('STATE_ERROR', 'error', `The governance state could not be read (${error && error.code ? error.code : 'unexpected error'}).`)], toolkitRoot);
  }
  const findings = [];
  if (state.rule === 'ERROR') {
    findings.push(finding('STATE_ERROR', 'error', `The governance state could not be read (${state.error_code}); prompts in this repository are held until it can.`));
    return report(2, state, findings, toolkitRoot);
  }
  if (state.state === 'PORTABLE') {
    findings.push(finding('PORTABLE', 'info', state.reason === 'no-git-root'
      ? 'Not inside a git repository: only the global rules apply.'
      : 'This repository has no usable origin remote, so no decision can be stored for it: only the global rules apply.'));
    return report(0, state, findings, toolkitRoot);
  }
  if (state.state === 'UNKNOWN') {
    findings.push(finding('DECISION_PENDING', 'drift', state.rule === 'R6'
      ? 'The repository carries the governed block but no programme binding, and you have not decided yet. Run `toolkit governance enable` or `toolkit governance decline`.'
      : 'You have not decided whether Toolkit governs this repository. Run `toolkit governance enable` or `toolkit governance decline`.'));
  }
  if (state.state === 'DECLINED') {
    if (state.materials.governed_block) findings.push(finding('GOVERNED_BLOCK_IGNORED', 'info', 'You declined Toolkit governance here, so the governed block in AGENTS.md is not followed.'));
    return report(0, state, findings, toolkitRoot);
  }
  if (state.state === 'ENABLED' && !state.materials_complete) {
    if (!state.materials.governed_block) findings.push(finding('GOVERNED_BLOCK_MISSING', 'drift', 'Governance is enabled but AGENTS.md has no governed block; add it through a pull request.'));
    if (!state.materials.binding) findings.push(finding('BINDING_MISSING', 'drift', 'Governance is enabled but the programme binding .github/toolkit-programme.json is missing or invalid; only the owner adds it, through a pull request.'));
  }
  if (state.materials.binding_present && !state.materials.binding) {
    findings.push(finding('BINDING_INVALID', 'drift', `The programme binding is invalid: ${state.materials.binding_problems.join(', ')}.`));
  }
  if (state.materials.governed_block) findings.push(...governedBlockFindings(state.root, toolkitRoot));
  let rulesetResult = null;
  if (state.state === 'ENABLED') {
    rulesetResult = options.offline === true
      ? Object.freeze({ status: 'not-checked', reason: 'offline', bypass: null })
      : ruleset.noForcePushRuleset(state.root, options.rulesetReader ? { reader: options.rulesetReader } : {});
    findings.push(...rulesetFindings(rulesetResult));
  }
  const drift = findings.some(entry => entry.severity === 'drift');
  return report(drift ? 1 : 0, state, findings, toolkitRoot, rulesetResult);
}

function rulesetFindings(result) {
  if (result.status === 'missing') return [finding('RULESET_NO_FORCE_PUSH_MISSING', 'drift', 'This governed repository has no active branch ruleset blocking force pushes on all branches (non_fast_forward on ~ALL). The one-time migration offers to add it, with your approval.')];
  if (result.status === 'present' && result.bypass === 'allowed') return [finding('RULESET_BYPASS_ALLOWED', 'info', 'The no-force-push ruleset is present but lists bypass actors, who can still force-push.')];
  if (result.status === 'present' && result.bypass === 'not-visible') return [finding('RULESET_BYPASS_NOT_VISIBLE', 'info', 'The no-force-push ruleset is present; its bypass list is visible only with write access.')];
  if (result.status === 'not-enforceable') return [finding('RULESET_NOT_ENFORCEABLE', 'info', 'GitHub cannot enforce a no-force-push ruleset here (a private repository on GitHub Free has no rulesets or branch protection), so nothing server-side blocks force pushes. Toolkit\'s local force-push guard is the fallback.')];
  if (result.status === 'unverified') return [finding('RULESET_UNVERIFIED', 'unverified', `The no-force-push ruleset could not be checked (${result.reason}); sign in with \`gh auth login\` and run the check again.`)];
  if (result.status === 'not-applicable') return [finding('RULESET_NOT_APPLICABLE', 'info', 'The no-force-push ruleset applies to GitHub repositories only; this one is hosted elsewhere.')];
  if (result.status === 'not-checked') return [finding('RULESET_NOT_CHECKED', 'unverified', 'The no-force-push ruleset was not checked (offline).')];
  return [];
}

function governedBlockFindings(repoRoot, toolkitRoot) {
  const materials = governance.readGovernedBlock(repoRoot);
  if (!materials.present) return [];
  if (materials.marker_errors > 0 && !materials.block) return [finding('MARKERS_BROKEN', 'drift', 'The Toolkit markers in AGENTS.md are broken; a rules refresh cannot replace the block until they are fixed.')];
  const out = [];
  if (materials.marker_errors > 0) out.push(finding('MARKERS_BROKEN', 'drift', 'AGENTS.md has a broken Toolkit marker besides the governed block.'));
  if (materials.legacy) {
    out.push(finding('GOVERNED_BLOCK_LEGACY', 'drift', 'AGENTS.md carries the old GLOBAL-AGENTS.MD-TEMPLATE block; refresh it to the TOOLKIT-GOVERNED-RULES block through a pull request.'));
    return out;
  }
  let expected;
  try { expected = expectedGovernedBlock(toolkitRoot); } catch { return [...out, finding('SOURCE_UNAVAILABLE', 'info', 'This Toolkit copy has no governed-rules source to compare with.')]; }
  const blockState = managedBlock.blockState(materials.block, expected);
  if (blockState === 'tampered') out.push(finding('GOVERNED_BLOCK_EDITED', 'drift', 'The governed block in AGENTS.md was edited by hand (its body no longer matches its digest).'));
  else if (blockState === 'stale') out.push(finding('GOVERNED_BLOCK_STALE', 'drift', 'The governed block in AGENTS.md is older than, or different from, this Toolkit copy\'s governed rules; a refresh asks first and lands through a pull request.'));
  return out;
}

function report(exitCode, state, findings, toolkitRoot, rulesetResult = null) {
  let catalogueProblems = [];
  try { catalogueProblems = catalogue.catalogueProblems(toolkitRoot); } catch { catalogueProblems = ['the skill catalogue could not be checked']; }
  const all = [...findings, ...catalogueProblems.map(message => finding('CATALOGUE_DRIFT', 'drift', message))];
  const code = exitCode === 2 ? 2 : (all.some(entry => entry.severity === 'drift') ? 1 : exitCode);
  return Object.freeze({
    schema: 'toolkit.governance-conformance.v1',
    exit_code: code,
    status: code === 0 ? 'conformant' : code === 1 ? 'drift' : 'error',
    state,
    findings: Object.freeze(all),
    no_force_push_ruleset: rulesetResult,
    enforcement: enforcementStatus(toolkitRoot),
  });
}

module.exports = Object.freeze({ checkConformance, enforcementStatus, expectedGovernedBlock, PROMPT_HOLD_HOOK });
