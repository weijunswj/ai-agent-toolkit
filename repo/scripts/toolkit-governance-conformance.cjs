'use strict';

// `toolkit governance check`: a read-only conformance report for one repository. It never
// writes anything. Exit codes: 0 conformant, 1 drift, incomplete materials or a decision still
// pending, 2 the state could not be read.
//
// It reports the governance state, the governed block (missing, legacy, edited by hand or older
// than this Toolkit's source), the programme binding, the no-force-push branch ruleset an ENABLED
// GitHub repository must carry (asked of GitHub through `gh`; `--offline` skips it and an
// unreachable GitHub reports it unverified, which never counts as present or as drift), the
// default-branch protection the binding's required checks need (toolkit-governance-protection.cjs:
// required checks match and are pinned, one job produces each and cannot be masked, merge commits
// only), the dependency and security settings (toolkit-governance-security.cjs: Dependabot alerts,
// security and version updates, secret scanning, push protection, CodeQL, private vulnerability
// reporting, and auto-merge only where the binding allows it and the default branch is protected),
// whether the repository carries a current plain-text check, and whether prompt-hold enforcement is
// active on each host. Enforcement never counts as active unless a host really runs the hook:
// hosts without plugin hooks (cloud sessions, Claude Projects threads) and OpenCode are
// `unsupported`.

const fs = require('node:fs');
const path = require('node:path');

const managedBlock = require('./toolkit-managed-block.cjs');
const governance = require('./toolkit-governance-state.cjs');
const catalogue = require('./toolkit-governance-catalogue.cjs');
const ruleset = require('./toolkit-governance-ruleset.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const GOVERNED_SOURCE_REL = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const VERSION_REL = 'repo/contracts/toolkit-local-bridge/version.json';
const PROMPT_HOLD_HOOK = 'toolkit-governance-hook';
// Each host's hook file and the script its UserPromptSubmit entry must run. Codex's prompt hold runs
// the helper hook script, so it shares that hook's installed Windows launcher.
const HOST_HOOK_FILES = Object.freeze({
  claude_code: Object.freeze({ parts: ['.claude-plugin', 'hooks', 'hooks.json'], script: `${PROMPT_HOLD_HOOK}.cjs`, reason: 'installed-state-not-checked' }),
  codex: Object.freeze({ parts: ['.codex-plugin', 'hooks', 'hooks.json'], script: 'toolkit-codex-helper-hook.cjs', reason: 'runs-once-you-trust-the-plugin-hooks' }),
});

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
  for (const [host, spec] of Object.entries(HOST_HOOK_FILES)) {
    let shipped = false;
    try {
      const config = JSON.parse(fs.readFileSync(path.join(root, ...spec.parts), 'utf8'));
      const entries = config && config.hooks && Array.isArray(config.hooks.UserPromptSubmit) ? config.hooks.UserPromptSubmit : [];
      shipped = JSON.stringify(entries).includes(spec.script);
    } catch { shipped = false; }
    hosts[host] = shipped
      ? { status: 'shipped', reason: spec.reason }
      : { status: 'inactive', reason: 'prompt-hold-hook-not-shipped' };
  }
  hosts.opencode = { status: 'unsupported', reason: 'no-prompt-blocking-mechanism' };
  hosts.cloud_and_projects = { status: 'unsupported', reason: 'not-enforced-in-cloud-sessions' };
  return hosts;
}

function finding(id, severity, message) { return Object.freeze({ id, severity, message }); }

// Reads only. Options pass through to the state reader (registry location in tests) and may set
// `toolkitRoot` for the source comparison, `offline: true` to skip the GitHub reads, and
// `rulesetReader`, `protectionReader` and `securityReader` (tests).
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
    findings.push(finding('STATE_ERROR', 'error', `The governance state could not be read (${state.error_code}); prompts in this repository are held until it can. ${governance.repairHint(state, options)}`.trim()));
    return report(2, state, findings, toolkitRoot);
  }
  if (state.rule === 'R1') {
    findings.push(finding('NOT_A_REPOSITORY', 'info', 'Not inside a git repository: GitHub governance is DISABLED automatically, and the global rules and coding gates apply.'));
    return report(0, state, findings, toolkitRoot);
  }
  if (state.rule === 'R8' || state.rule === 'R9') {
    findings.push(state.rule === 'R9'
      ? finding('NOT_GITHUB_PENDING', 'drift', 'This repository is not on github.com, so GitHub governance cannot run here. Reply ok to Toolkit in chat, or run `' + governance.governanceCommand('disable') + '` in your own terminal, to record it as DISABLED.')
      : finding('NOT_GITHUB', 'info', 'This repository is not on github.com, so GitHub governance is DISABLED: the global rules and coding gates apply.'));
    if (state.materials.governed_block) findings.push(finding('GOVERNED_BLOCK_IGNORED', 'info', 'GitHub governance works only on github.com, so the governed block in AGENTS.md is not followed.'));
    return report(state.rule === 'R9' ? 1 : 0, state, findings, toolkitRoot);
  }
  if (state.state === 'UNDECIDED') {
    findings.push(finding('DECISION_PENDING', 'drift', state.rule === 'R6'
      ? `The repository carries the governed block but no programme binding, and you have not decided yet. Answer Toolkit's question in chat (yes, no or later), or run \`${governance.governanceCommand('enable')}\` or \`${governance.governanceCommand('disable')}\` in your own terminal.`
      : `You have not decided whether Toolkit's GitHub governance runs in this repository. Answer Toolkit's question in chat (yes, no or later), or run \`${governance.governanceCommand('enable')}\` or \`${governance.governanceCommand('disable')}\` in your own terminal.`));
  }
  if (state.state === 'DISABLED') {
    if (state.materials.governed_block) findings.push(finding('GOVERNED_BLOCK_IGNORED', 'info', 'You disabled Toolkit governance here, so the governed block in AGENTS.md is not followed.'));
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
  if (state.state === 'ENABLED') findings.push(...plainTextFindings(state.root, toolkitRoot));
  let rulesetResult = null;
  if (state.state === 'ENABLED') {
    rulesetResult = options.offline === true
      ? Object.freeze({ status: 'not-checked', reason: 'offline', bypass: null })
      : ruleset.noForcePushRuleset(state.root, options.rulesetReader ? { reader: options.rulesetReader } : {});
    findings.push(...rulesetFindings(rulesetResult));
  }
  let protectionResult = null;
  const requiredChecks = state.state === 'ENABLED' && state.materials.binding ? governance.bindingRequiredChecks(state.root) : null;
  if (requiredChecks) {
    protectionResult = protection.defaultBranchProtection(state.root, {
      requiredChecks,
      offline: options.offline === true,
      ...(options.protectionReader ? { reader: options.protectionReader } : {}),
    });
    findings.push(...protectionFindings(protectionResult));
  }
  let securityResult = null;
  if (state.state === 'ENABLED' && state.materials.binding) {
    securityResult = security.dependencySecurity(state.root, {
      offline: options.offline === true,
      protectionResult,
      toolkitRoot,
      ...(options.securityReader ? { reader: options.securityReader } : {}),
    });
    findings.push(...securityFindings(securityResult));
  }
  const drift = findings.some(entry => entry.severity === 'drift');
  return report(drift ? 1 : 0, state, findings, toolkitRoot, rulesetResult, protectionResult, securityResult);
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

// Every governed repository carries the plain-text check (secure-ci-cd), installed with the governed
// materials through a pull request. The Toolkit source checkout runs it from source instead. A
// repository may switch it off only with a recorded reason (`off_reason` in its settings).
function plainTextFindings(repoRoot, toolkitRoot) {
  if (fs.existsSync(path.join(repoRoot, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs'))
    && fs.existsSync(path.join(repoRoot, 'repo', 'contracts', 'plain-references', 'config.json'))) return [];
  let installer;
  try { installer = require(path.join(toolkitRoot, 'skills', 'secure-ci-cd', 'scripts', 'install-plain-text-check.cjs')); }
  catch { return [finding('PLAIN_TEXT_CHECK_NOT_CHECKED', 'info', 'This Toolkit copy has no plain-text check to compare with.')]; }
  let settings = null;
  try { settings = JSON.parse(fs.readFileSync(path.join(repoRoot, installer.CONFIG_PATH), 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error && error.code === 'ENOENT') return [finding('PLAIN_TEXT_CHECK_MISSING', 'drift', 'This governed repository has no plain-text check (.github/plain-text.json). A rules refresh installs it through a pull request.')];
    return [finding('PLAIN_TEXT_CHECK_DRIFT', 'drift', 'The plain-text check settings (.github/plain-text.json) could not be read; fix the file through a pull request.')];
  }
  if (settings && typeof settings.off_reason === 'string' && settings.off_reason.trim()) {
    return [finding('PLAIN_TEXT_CHECK_OFF', 'info', `The plain-text check is switched off here, with a recorded reason: ${settings.off_reason.trim()}`)];
  }
  const problems = installer.drift(repoRoot);
  return problems.length
    ? [finding('PLAIN_TEXT_CHECK_DRIFT', 'drift', `The plain-text check is out of date (${problems.join('; ')}); a rules refresh updates it through a pull request.`)]
    : [];
}

const PROTECTION_FINDINGS = Object.freeze({
  P1: ['PROTECTION_CHECKS_MISMATCH', 'The default branch must require exactly the checks in the programme binding'],
  P2: ['PROTECTION_CHECK_UNPINNED', 'Each required check must be pinned to an app, or any job or status of that name can satisfy it'],
  P3: ['PROTECTION_PRODUCER', 'Exactly one workflow job must produce each required check'],
  P4: ['PROTECTION_MASKING', 'A required check must run on every pull request and must not pass while a job it waits for failed'],
  P5: ['PROTECTION_MERGE_METHODS', 'The default branch must allow merge commits only'],
});

function protectionFindings(result) {
  if (result.status === 'not-applicable') return [];
  if (result.status === 'not-enforceable') return [finding('PROTECTION_NOT_ENFORCEABLE', 'info', 'GitHub cannot protect the default branch here (a private repository on GitHub Free has no rulesets or branch protection).')];
  if (result.reason === 'binding-has-no-required-checks') return [finding('PROTECTION_UNVERIFIED', 'unverified', 'The programme binding names no required checks, so default-branch protection was not checked.')];
  if (result.reason === 'identity-unreadable') return [finding('PROTECTION_UNVERIFIED', 'unverified', 'Default-branch protection could not be checked (the repository identity is unreadable).')];
  const out = [];
  for (const [id, [code, rule]] of Object.entries(PROTECTION_FINDINGS)) {
    const check = result.checks[id];
    if (!check || check.status === 'ok') continue;
    if (check.status === 'drift') {
      const fix = ['P1', 'P2', 'P5'].includes(id) ? ' The one-time migration offers a Toolkit ruleset for this, with your approval; a rule in another ruleset is changed by hand.' : ' Fix the workflow through a pull request.';
      out.push(finding(code, 'drift', `${rule}: ${check.details.join('; ')}.${fix}`));
    } else if (check.status === 'not-checked') {
      out.push(finding(`${code}_NOT_CHECKED`, 'unverified', `${rule}: not checked (offline).`));
    } else if (check.status === 'unverified') {
      out.push(finding(`${code}_UNVERIFIED`, 'unverified', `${rule}: could not be confirmed (${check.details.join('; ')}).${['P1', 'P2', 'P5'].includes(id) ? ' Sign in with `gh auth login` as a repository admin and run the check again.' : ''}`));
    }
  }
  return out;
}

const SECURITY_FINDINGS = Object.freeze({
  S1: ['SECURITY_DEPENDABOT_ALERTS', 'Dependabot alerts must be on'],
  S2: ['SECURITY_DEPENDABOT_UPDATES', 'Dependabot security updates must be on'],
  S3: ['SECURITY_VERSION_UPDATES', 'Dependabot version updates must cover every package ecosystem in the repository'],
  S4: ['SECURITY_SECRET_SCANNING', 'Secret scanning and push protection must be on'],
  S5: ['SECURITY_CODE_SCANNING', 'CodeQL code scanning must be set up'],
  S6: ['SECURITY_PRIVATE_REPORTING', 'Private vulnerability reporting must be on'],
  S8: ['SECURITY_PAID_DECISION', 'A private repository\'s binding must record the owner\'s answer on GitHub\'s paid security features'],
  S7: ['SECURITY_AUTO_MERGE', 'Dependabot auto-merge needs the workflow, the repository setting and a protected default branch'],
});

function securityFindings(result) {
  if (result.status === 'not-applicable') return [];
  if (result.reason === 'identity-unreadable') return [finding('SECURITY_UNVERIFIED', 'unverified', 'Dependency and security settings could not be checked (the repository identity is unreadable).')];
  const out = [];
  for (const [id, [code, rule]] of Object.entries(SECURITY_FINDINGS)) {
    const check = result.checks[id];
    if (!check || check.status === 'ok' || check.status === 'not-applicable') continue;
    if (check.status === 'drift') {
      const fix = id === 'S3' && result.files && !result.files.dependabot ? ' Add the missing entries to the existing file through a pull request.'
        : id === 'S7' ? ' `toolkit governance security` fixes the settings and the workflow; a binding change goes through a pull request.'
          : id === 'S8' ? ' Ask the owner (default off) and add the answer to the binding through a pull request.'
            : ' On by default under governance: `toolkit governance security` turns on what the GitHub plan allows.';
      out.push(finding(code, 'drift', `${rule}: ${check.details.join('; ')}.${fix}`));
    } else if (check.status === 'not-on-plan') {
      out.push(finding(`${code}_NOT_ON_PLAN`, 'info', `${rule}: ${check.details.join('; ')}, so it is not required here.`));
    } else if (check.status === 'not-checked') {
      out.push(finding(`${code}_NOT_CHECKED`, 'unverified', `${rule}: not checked (offline).`));
    } else {
      out.push(finding(`${code}_UNVERIFIED`, 'unverified', `${rule}: could not be confirmed (${check.details.join('; ')}). Sign in with \`gh auth login\` as a repository admin and run the check again.`));
    }
  }
  return out;
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

function report(exitCode, state, findings, toolkitRoot, rulesetResult = null, protectionResult = null, securityResult = null) {
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
    default_branch_protection: protectionResult,
    dependency_security: securityResult,
    enforcement: enforcementStatus(toolkitRoot),
  });
}

module.exports = Object.freeze({ checkConformance, enforcementStatus, expectedGovernedBlock, PROMPT_HOLD_HOOK });
