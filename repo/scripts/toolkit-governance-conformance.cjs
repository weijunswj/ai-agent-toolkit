'use strict';

// The governance check (`toolkit-governance.cjs check`): a read-only conformance report for one repository. It never
// writes anything. Exit codes: 0 conformant, 1 drift, incomplete materials or a decision still
// pending, 2 the state could not be read, 3 unverified (no drift, but an online GitHub read could not
// confirm a setting; the report names the repository admin's step).
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
// whether the repository carries a current plain-text check, and whether the governance question hook is
// active on each host. Enforcement never counts as active unless a host really runs the hook:
// hosts without plugin hooks (cloud sessions, Claude Projects threads) and OpenCode are
// `unsupported`.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const managedBlock = require('./toolkit-managed-block.cjs');
const governance = require('./toolkit-governance-state.cjs');
const ruleset = require('./toolkit-governance-ruleset.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');
const governanceApp = require('./toolkit-governance-app.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const GOVERNED_SOURCE_REL = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const VERSION_REL = 'repo/contracts/toolkit-local-bridge/version.json';
const QUESTION_HOOK = 'toolkit-governance-hook';
// Each host's hook file and the script its UserPromptSubmit entry must run. Codex's question hook runs
// the helper hook script, so it shares that hook's installed Windows launcher.
const HOST_HOOK_FILES = Object.freeze({
  claude_code: Object.freeze({ parts: ['.claude-plugin', 'hooks', 'hooks.json'], script: `${QUESTION_HOOK}.cjs`, reason: 'installed-state-not-checked' }),
  codex: Object.freeze({ parts: ['.codex-plugin', 'hooks', 'hooks.json'], script: 'toolkit-codex-helper-hook.cjs', reason: 'runs-once-you-trust-the-plugin-hooks' }),
});

// The governed block this Toolkit copy would install now.
function expectedGovernedBlock(root = ROOT) {
  const version = JSON.parse(fs.readFileSync(path.join(root, ...VERSION_REL.split('/')), 'utf8')).version;
  const body = fs.readFileSync(path.join(root, ...GOVERNED_SOURCE_REL.split('/')), 'utf8');
  return { source: GOVERNED_SOURCE_REL, name: governance.GOVERNED_BLOCK, version, body };
}

// Whether this Toolkit copy ships the prompt-submit question hook for a host. A host whose hook files
// carry no question hook reports `inactive`; a shipped hook is not yet proof that it is installed
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
      : { status: 'inactive', reason: 'question-hook-not-shipped' };
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
  if (state.state === 'UNAVAILABLE') {
    findings.push(finding('GOVERNANCE_UNAVAILABLE', 'unverified', "Couldn't check governance. Ordinary work continues with global rules; no governance effects or standing task auto-merge until it can be checked."));
    return report(2, state, findings, toolkitRoot);
  }
  if (state.rule === 'ERROR') {
    findings.push(finding('STATE_ERROR', 'error', `The governance state could not be read (${state.error_code}); ordinary work continues without governance effects.`));
    return report(2, state, findings, toolkitRoot);
  }
  if (state.rule === 'R1') {
    findings.push(finding('NOT_A_REPOSITORY', 'info', 'Not inside a git repository: GitHub governance is DISABLED automatically, and the global rules and coding gates apply.'));
    return report(0, state, findings, toolkitRoot);
  }
  if (state.rule === 'R8') {
    findings.push(finding('NOT_GITHUB', 'info', 'This repository is not on github.com, so GitHub governance is DISABLED automatically: the global rules and coding gates apply.'));
    return report(0, state, findings, toolkitRoot);
  }
  if (state.state === 'ERROR') {
    findings.push(finding('MERGED_BINDING_INVALID', 'error', `The programme binding merged on the default branch cannot be used (${state.merged.problems.join(', ') || 'unreadable'}). Ordinary work continues; governed records, gate admission and finality hold until a pull request fixes it.`));
    return report(2, state, findings, toolkitRoot);
  }
  if (state.state === 'UNDECIDED') {
    const pending = new (require('./toolkit-governance-proposal.cjs').GovernanceProposals)({ registryOptions: options }).pending(cwd);
    if (['read-only', 'unavailable'].includes(pending?.kind)) return report(pending.kind === 'read-only' ? 0 : 2, state,
      [finding(pending.kind === 'read-only' ? 'READ_ONLY_ACCOUNT' : 'GOVERNANCE_UNAVAILABLE', pending.kind === 'read-only' ? 'info' : 'unverified', pending.text)], toolkitRoot);
    findings.push(finding('DECISION_PENDING', 'drift', pending?.text || 'No governance decision is merged on the default branch. Say toolkit governance and answer its question bank in chat; the pull request it prepares decides once you merge it.'));
  }
  if (state.state === 'DISABLED') {
    if (state.rule === 'M2') findings.push(finding('REPOSITORY_DISABLED', 'info', 'The binding merged on the default branch sets governance to disabled; only an owner-merged pull request turns it back on.'));
    if (state.rule === 'M2') findings.push(...appFindings(state, options));
    if (state.rule === 'M2') findings.push(...cloudWorkflowLeftovers(state));
    if (state.rule === 'S1') findings.push(finding('EVIDENCE_STORE', 'info', 'This repository is an evidence store a programme binding names: agent-managed, never governed, and never asked about.'));
    if (state.rule === 'R1s') findings.push(finding('SCRATCH_CLONE', 'info', "This repository is a scratch clone in another repository's ignored .tmp folder: never governed, and never asked about."));
    if (state.materials.governed_block) findings.push(finding('GOVERNED_BLOCK_IGNORED', 'info', state.rule === 'M2' ? 'Governance is disabled for this repository, so the governed block in AGENTS.md is not followed.' : ['S1', 'R1s'].includes(state.rule) ? 'This repository is not governed, so the governed block in AGENTS.md is not followed.' : 'You disabled Toolkit governance here, so the governed block in AGENTS.md is not followed.'));
    return report(0, state, findings, toolkitRoot);
  }
  if (state.materials.binding_present && state.materials.binding_problems.length) {
    findings.push(finding('BINDING_INVALID', 'drift', `The working tree's programme binding is invalid: ${state.materials.binding_problems.join(', ')}.`));
  }
  if (state.notes.includes('binding-belongs-to-other-repository')) findings.push(finding('BINDING_FOREIGN', 'drift', `The default branch's programme binding belongs to ${state.merged.foreign_repository}, so it does not apply here.`));
  if (state.notes.includes('merged-binding-stale')) findings.push(finding('MERGED_BINDING_STALE', 'drift', `The last read of the merged binding is over 24 hours old, so governed records, gate admission and finality hold; run \`${governance.governanceCommand('status')}\` online.`));
  if (state.notes.includes('binding-v2-migration-offered')) findings.push(finding('BINDING_V1', 'info', 'The merged binding is version 1; the next setup pull request moves it to version 2.'));
  // An ENABLED repository needs no governed block: the installed Toolkit gives its sessions the governed
  // rules. One still there is a leftover copy, not something to refresh.
  if (state.materials.governed_block) findings.push(...(state.state === 'ENABLED' ? leftoverBlockFindings(state.root, toolkitRoot) : governedBlockFindings(state.root, toolkitRoot)));
  if (state.state === 'ENABLED') findings.push(...plainTextFindings(state.root, toolkitRoot));
  let rulesetResult = null;
  if (state.state === 'ENABLED') {
    rulesetResult = options.offline === true
      ? Object.freeze({ status: 'not-checked', reason: 'offline', bypass: null })
      : ruleset.noForcePushRuleset(state.root, options.rulesetReader ? { reader: options.rulesetReader } : {});
    findings.push(...rulesetFindings(rulesetResult));
  }
  let protectionResult = null;
  const requiredChecks = state.state === 'ENABLED' && state.materials.binding ? governance.bindingRequiredChecks(state.root, options) : null;
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
  if (state.state === 'ENABLED' && state.materials.binding && state.merged && state.merged.status === 'enabled') findings.push(taskMergeSettingFinding(state.root, options));
  if (state.state === 'ENABLED' && state.materials.binding) findings.push(...appFindings(state, options));
  if (state.state === 'ENABLED' && state.materials.binding) findings.push(...cloudWorkflowFindings(state, toolkitRoot, options), ...cloudSweepReachFindings(state, options));
  const drift = findings.some(entry => entry.severity === 'drift');
  // An online run whose GitHub reads could not confirm a setting is not conformant: it is unverified
  // (exit 3) until a repository admin re-runs the check signed in. An offline or test run chose not to
  // read, so its unverified items keep exit 0.
  return report(drift ? 1 : unverifiedExit(findings, options), state, findings, toolkitRoot, rulesetResult, protectionResult, securityResult, cloudJobsGuide(state, toolkitRoot));
}

// The governance GitHub App: set up while governance is on, nothing left behind once it is off. Read
// only (names of the repository's variables and secrets); a missing App never counts as drift.
function appFindings(state, options) {
  let slug = null;
  try { const identity = governance.readIdentity(state.root); slug = identity.valid ? governance.remoteSlug(identity.remote) : null; } catch { slug = null; }
  if (!slug) return [];
  const read = { reader: options.appReader || governanceApp.ghReader,
    offline: options.offline === true || (!options.appReader && (options.testOnly === true || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1')) };
  const appState = governanceApp.presence(slug, read);
  const others = governance.enabledRepositories(options).filter(name => name.toLowerCase() !== slug.toLowerCase());
  const found = governanceApp.appFinding(state.state, slug, governance.bindingStoreRepository(state.root, options), appState, others);
  return found ? [found] : [];
}

// Report the repository's own switch; governance never asks or drafts an answer here.
function taskMergeSettingFinding(root, options) {
  const answer = governance.taskAutoMerge(root, options);
  const on = answer.auto_merge === 'after-gates';
  if (answer.reason === 'no-switch-set') return finding('TASK_AUTO_MERGE_UNSET', 'info', governance.TASK_SWITCH_UPGRADE_LINE);
  return finding(on ? 'TASK_AUTO_MERGE_ON' : 'TASK_AUTO_MERGE_OFF', 'info',
    `Task auto-merge: ${on ? 'on' : 'off'} (${answer.reason}). It is this repository's task_prs.auto_merge in the merged binding; say refresh governance to see or change it. Governance, hooks, setup and merge-rule changes still wait for the owner's typed merge.`);
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
// materials through a pull request. The Toolkit source checkout runs it through its wrapper instead. A
// repository may switch it off only with a recorded reason (`off_reason` in its settings).
function plainTextFindings(repoRoot, toolkitRoot) {
  if (fs.existsSync(path.join(repoRoot, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs'))
    && fs.existsSync(path.join(repoRoot, 'repo', 'scripts', 'check-plain-references.cjs'))) return [];
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
  P6: ['PROTECTION_UP_TO_DATE', 'The default branch must require branches to be up to date before merging'],
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
      const fix = protection.SETTINGS_CHECKS.includes(id) ? ' The one-time migration offers a Toolkit ruleset for this, with your approval; a rule in another ruleset is changed by hand.' : ' Fix the workflow through a pull request.';
      out.push(finding(code, 'drift', `${rule}: ${check.details.join('; ')}.${fix}`));
    } else if (check.status === 'not-checked') {
      out.push(finding(`${code}_NOT_CHECKED`, 'unverified', `${rule}: not checked (offline).`));
    } else if (check.status === 'unverified') {
      out.push(finding(`${code}_UNVERIFIED`, 'unverified', `${rule}: could not be confirmed (${check.details.join('; ')}).${protection.SETTINGS_CHECKS.includes(id) ? ' Sign in with `gh auth login` as a repository admin and run the check again.' : ''}`));
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

// A governed block left in an ENABLED repository's AGENTS.md. Its sessions follow the rules the
// installed Toolkit gives them, so the block is removed by pull request once every app that works in
// the repository runs this Toolkit version; until then it does no harm. Broken markers still block that removal.
function leftoverBlockFindings(repoRoot, toolkitRoot) {
  const materials = governance.readGovernedBlock(repoRoot);
  if (!materials.present) return [];
  const out = [];
  if (materials.marker_errors > 0) out.push(finding('MARKERS_BROKEN', 'drift', 'The Toolkit markers in AGENTS.md are broken; fix them before the leftover governed block can be removed.'));
  let version = 'this';
  try { version = expectedGovernedBlock(toolkitRoot).version; } catch { /* the note still stands */ }
  out.push(finding('GOVERNED_BLOCK_LEFTOVER', 'info', `AGENTS.md still carries a governed block. The installed Toolkit now gives sessions the governed rules, so the block is a leftover copy: remove it by pull request once every app working here runs Toolkit ${version} or later (toolkit-governance-cleanup.cjs previews and makes the changes).`));
  return out;
}

// The cloud workflow copies a governed repository carries (toolkit-cloud-workflows.cjs): the sweep and
// its gate, plus the test shards workflow and Shard Timings where the repository has a usable shard
// list. A missing or hand-edited copy is drift; one rendered from an older Toolkit commit or an older
// shard list is only noted, since every rules refresh updates it. The Toolkit's own checkout runs its
// own files and is skipped.
// Whether a rules refresh from this Toolkit checkout moves a copy pinned to `pin` forward: true only
// when the checkout's HEAD is on origin/main and already contains the pin. A newer pin (another
// computer refreshed from a later main) or a checkout off main would roll the copy back, or the
// refresh refuses: false. 'shallow' when the checkout is on main but is a shallow clone (cloud
// sessions clone 50 commits deep), whose history may just stop before the pin. Three git reads at
// most per pin, local only.
function pinDirection(toolkitRoot, head) {
  const git = args => { const run = spawnSync('git', args, { cwd: toolkitRoot, encoding: 'utf8', windowsHide: true, shell: false }); return !run.error && run.status === 0 ? String(run.stdout || '').trim() : null; };
  let onMain;
  let shallow;
  return pin => {
    if (!/^[0-9a-f]{40}$/.test(String(pin || '')) || !/^[0-9a-f]{40}$/.test(String(head || ''))) return false;
    if (onMain === undefined) onMain = git(['merge-base', '--is-ancestor', head, 'refs/remotes/origin/main']) !== null;
    if (!onMain) return false;
    if (git(['merge-base', '--is-ancestor', pin, head]) !== null) return true;
    if (shallow === undefined) shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
    return shallow ? 'shallow' : false;
  };
}

function cloudWorkflowFindings(state, toolkitRoot, options = {}) {
  // From a plugin copy (no git) the check renders from the managed Toolkit checkout, with its own
  // installer, as the turn-on and the rules refresh do.
  if (!options.toolkitRoot) toolkitRoot = require('./toolkit-cloud-workflows.cjs').sourceRoot({ self: toolkitRoot });
  const workflows = require('./toolkit-cloud-workflows.cjs').installerAt(toolkitRoot);
  if (workflows.isToolkitCheckout(state.root)) return [];
  let result;
  let merged = null;
  let head = null;
  try {
    // The check compares with this checkout's own commit; only an install needs it to be on main.
    merged = (options.mergedBinding || governance.mergedBinding)(state.root, options);
    head = options.cloudWorkflowsCommit || workflows.toolkitHead(toolkitRoot);
    result = workflows.plan({ repo: state.root, root: toolkitRoot, commit: head, ciShards: merged?.ci_shards?.answer || null });
  } catch (error) {
    return [finding('CLOUD_WORKFLOWS_UNCHECKED', 'info', `The cloud sweep workflows could not be checked: ${error.name === 'InstallError' ? error.message : 'the Toolkit copy could not render them.'}`)];
  }
  const out = [];
  const direction = pinDirection(toolkitRoot, head);
  for (const row of result.rows) {
    if (row.state === 'current') continue;
    // The file, the copy's pin and whether a refresh from this checkout moves it forward ride along for
    // the session-start note (toolkit-governance-gate.cjs stalePinLines).
    if (row.state === 'outdated') out.push(Object.freeze({ ...finding('CLOUD_WORKFLOW_OUTDATED', 'info', `${row.file} differs from what a refresh writes now (${row.pinned ? 'it is pinned to one older Toolkit commit' : 'the Toolkit\'s workflow layout, an action pin, the CI workflow it follows or the shard list\'s shards'}); \`toolkit-cloud-workflows.cjs --repo <checkout> --refresh-pr\` opens its refresh pull request.`), file: row.file, pin: row.toolkit || null, pinned: Boolean(row.pinned), head, refreshable: direction(row.toolkit) }));
    else out.push(finding('CLOUD_WORKFLOW_DRIFT', 'drift', `${row.file} is ${row.state === 'missing' ? 'missing' : row.state === 'edited' ? 'edited by hand' : 'not a Toolkit copy'}, so ${row.consequence || 'this repository\'s programme board gets no cloud sweep'}. Refresh the repository rules to fix it.`));
  }
  // A shard copy an earlier list brought, while the list is now missing, not usable or not supported:
  // nothing refreshes it, and the test shards copy runs a list it no longer matches.
  for (const row of result.not_copied || []) {
    for (const file of row.left || []) out.push(finding('CLOUD_WORKFLOW_DRIFT', 'drift', `${file} is a Toolkit ${row.id === 'test-shards' ? 'test shards' : 'Shard Timings'} copy, but the shard copies are no longer copied: ${row.reason}. Repair the shard list and refresh the repository rules, or remove the shard copies in a pull request.`));
  }
  // A test shards copy left at an older workflow name after the list renamed it.
  for (const row of result.renamed || []) out.push(finding('CLOUD_WORKFLOW_DRIFT', 'drift', `${row.file} is a Toolkit test shards copy at an old name; the shard list now names ${row.workflow}, so both run. Remove ${row.file} in a pull request.`));
  // The shard gate is suggested as a required check, never set: the owner decides (info only).
  const shards = result.rows.find(row => row.id === 'test-shards');
  if (shards && ['current', 'outdated'].includes(shards.state) && !(merged?.required_checks || []).includes('Toolkit test shards')) {
    out.push(finding('CI_SHARDS_GATE_NOT_REQUIRED', 'info', `${shards.file} runs the Toolkit test shards gate, but "Toolkit test shards" is not a required check here. Consider making it required on the default branch so a pull request waits for every test file to pass; Toolkit never sets it for you.`));
  }
  return out;
}

// Record 808: a governed repository the cloud sweep skips gets one line here. Toolkit no longer sweeps
// from a computer, so nothing else runs its pass: state on a public branch, or an evidence store under
// another owner (one governance App cannot reach it). Reported as info with the fix; never a drift.
// Setup names the same reasons for every governed repository this computer knows.
function cloudSweepSkipReason(binding) {
  if (!binding) return null;
  if (binding.state) return { code: 'CLOUD_SWEEP_PUBLIC_STATE', why: 'its programme state is on a public branch', fix: 'Move the state to a private evidence store (say toolkit store)' };
  const owner = String(binding.repository || '').split('/')[0].toLowerCase();
  const store = String(binding.store?.repository || '');
  if (owner && store && store.split('/')[0].toLowerCase() !== owner) return { code: 'CLOUD_SWEEP_FOREIGN_STORE', why: `its evidence store ${store} belongs to another owner, so one governance App cannot reach it`, fix: "Move the store under this repository's owner" };
  return null;
}

function cloudSweepReachFindings(state, options = {}) {
  const reason = cloudSweepSkipReason((options.mergedBinding || governance.mergedBinding)(state.root, options));
  if (!reason) return [];
  return [finding(reason.code, 'info', `The cloud sweep skips this repository: ${reason.why}. ${reason.fix}; until then nothing sweeps this repository, so run ${require('./toolkit-user-state.cjs').programmeCommand('refresh')} by hand.`)];
}

// Toolkit workflow copies left in a repository whose merged binding turns governance off: the sweep
// and its gate, and the test shards and Shard Timings copies. The pull request that turns governance
// off removes them; a copy still here means it was made before that, or by hand. Only a file starting
// with the Toolkit's rendered-copy marker counts, found by that marker wherever the test shards copy's
// list put it. Report only, never a drift.
function cloudWorkflowLeftovers(state) {
  const workflows = require('./toolkit-cloud-workflows.cjs');
  if (workflows.isToolkitCheckout(state.root)) return [];
  const left = workflows.markedCopies(state.root).map(row => row.file);
  return left.length ? [finding('CLOUD_WORKFLOW_LEFT_OVER', 'info', `Governance is off, but the Toolkit's cloud workflow copies are still here: ${left.join(', ')}. Remove them in a pull request; they do nothing for governance while it is off.`)] : [];
}

// The cloud jobs guide from the contract: each job and the tokens it mints from the governance App.
function cloudJobsGuide(state, toolkitRoot) {
  if (state?.state !== 'ENABLED' || !fs.existsSync(path.join(toolkitRoot, 'repo/contracts/cloud-jobs.json'))) return null;
  return require('./toolkit-cloud-jobs.cjs').buildCloudJobsGuide({ root: toolkitRoot });
}

function unverifiedExit(findings, options = {}, environment = process.env) {
  const offline = options.offline === true || options.testOnly === true || environment.TOOLKIT_GOVERNANCE_OFFLINE === '1';
  return !offline && findings.some(entry => entry.severity === 'unverified') ? 3 : 0;
}

const UNVERIFIED_STEP = 'A repository admin signs in with `gh auth login` and runs the governance check (`toolkit-governance.cjs check`) again; until then nothing here counts as conformant.';

function report(exitCode, state, findings, toolkitRoot, rulesetResult = null, protectionResult = null, securityResult = null, cloudJobs = null) {
  const code = exitCode === 2 ? 2 : (findings.some(entry => entry.severity === 'drift') ? 1 : exitCode);
  return Object.freeze({
    schema: 'toolkit.governance-conformance.v1',
    exit_code: code,
    status: code === 0 ? 'conformant' : code === 1 ? 'drift' : code === 3 ? 'unverified' : 'error',
    ...(code === 3 ? { next_step: UNVERIFIED_STEP } : {}),
    state,
    findings: Object.freeze([...findings]),
    no_force_push_ruleset: rulesetResult,
    default_branch_protection: protectionResult,
    dependency_security: securityResult,
    cloud_jobs: cloudJobs,
    enforcement: enforcementStatus(toolkitRoot),
  });
}

module.exports = Object.freeze({ checkConformance, cloudWorkflowFindings, cloudSweepReachFindings, cloudSweepSkipReason, enforcementStatus, expectedGovernedBlock, unverifiedExit, report, QUESTION_HOOK });
