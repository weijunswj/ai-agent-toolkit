'use strict';

// Contract checks for the two instruction layers and their projections: the global rules source,
// the Toolkit-governed block (root AGENTS.md and the portable template), the host shims and the
// portable playbooks. These are instruction checks, not native permission or live-operation tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { findBlocks, bodyDigest, blockState } = require('../scripts/toolkit-managed-block.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const globalPath = 'repo/contracts/agent-rules/global-rules.md';
const governedPath = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const n8nAdapterPath = 'repo/contracts/agent-rules/n8n-safety-router-adapter.md';
const repoLocalSourceRoot = 'repo/contracts/agent-rules/repo-local';
const repoLocalPublishedRoot = 'skills/repository-agent-rules/repo-local';
const VERSION = JSON.parse(fs.readFileSync(path.join(repoRoot, 'repo/contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
const SHIMS = [
  { file: 'antigravity-bootstrap.template.md', name: 'ANTIGRAVITY.BOOTSTRAP', active: '.agents/rules/00-agent-toolkit-bootstrap.md', heading: '# Agent Toolkit Antigravity Bootstrap' }
];
const safetyComment = [
  '<!--',
  'Curated AI-facing source.',
  'Source: repo/contracts/agent-rules/repo-local',
  'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
  '-->'
].join('\n');
const forbiddenDefaultPromptPhrases = ['GitHub PR Completion Rules', 'GITHUB APPROVAL NEEDED', 'VERSION CONTROL APPROVAL NEEDED',
  'REMOTE APPROVAL NEEDED', 'LOCAL CHANGE APPROVAL NEEDED', 'PR: none yet', 'PR lane', 'remote source-of-truth', 'GitHub PR URL',
  'Should I push this branch'];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}
const exists = relPath => fs.existsSync(path.join(repoRoot, relPath));

function onlyBlock(relPath, name) {
  const { blocks, errors } = findBlocks(readText(relPath));
  assert.deepEqual(errors, [], relPath);
  const found = blocks.filter(block => block.name === name);
  assert.equal(found.length, 1, `${relPath}: one ${name} block`);
  return found[0];
}

function assertCurrentBlock(relPath, name, source, body) {
  const block = onlyBlock(relPath, name);
  assert.equal(block.format, 2, `${relPath}: v2 markers`);
  assert.equal(block.version, VERSION, `${relPath}: package version`);
  assert.equal(block.digest, bodyDigest(block.body), `${relPath}: digest matches body`);
  assert.equal(blockState(block, { source, name, version: VERSION, body }), 'current', relPath);
  return block;
}

test('the rule sources exist and the superseded sources and templates are gone', () => {
  for (const relPath of [globalPath, governedPath, n8nAdapterPath, 'repo/contracts/agent-rules/n8n-safety-rules.md',
    'repo/contracts/agent-rules/toolkit-skill-routing.md', `${repoLocalPublishedRoot}/docs/agent-playbooks/INDEX.md`]) {
    assert.equal(exists(relPath), true, relPath);
  }
  for (const relPath of ['repo/contracts/agent-rules/ai-coding-agent-execution.md', 'repo/contracts/agent-rules/AGENTS.template.md',
    'repo/contracts/agent-rules/CLAUDE.template.md', 'repo/contracts/agent-rules/GEMINI.template.md']) {
    assert.equal(exists(relPath), false, relPath);
  }
});

test('the governed block reaches root AGENTS.md and both templates unchanged, inside current v2 markers', () => {
  const governed = readText(governedPath).trimEnd();
  for (const relPath of ['AGENTS.md', `${repoLocalSourceRoot}/AGENTS.managed.template.md`, `${repoLocalPublishedRoot}/AGENTS.managed.template.md`]) {
    assertCurrentBlock(relPath, 'TOOLKIT-GOVERNED-RULES', governedPath, governed);
  }
  const template = readText(`${repoLocalSourceRoot}/AGENTS.managed.template.md`);
  assert.equal(readText(`${repoLocalPublishedRoot}/AGENTS.managed.template.md`), template);
  assert.ok(template.startsWith(`${safetyComment}\n\n`));
  assert.equal(findBlocks(template).blocks.length, 1, 'the template carries only the governed block');
  const root = readText('AGENTS.md');
  assert.ok(root.startsWith('# AI Agent Toolkit Repo Rules\n\n<!-- AI-AGENT-TOOLKIT:'));
  assert.doesNotMatch(root, /GLOBAL-AGENTS\.MD-TEMPLATE|N8N-AGENT-RULES-ADAPTER|SOURCE-OF-TRUTH-CONTRACT/);
});

test('host shims stay tiny, carry current markers and match their templates', () => {
  for (const shim of SHIMS) {
    const source = `${repoLocalSourceRoot}/${shim.file}`;
    const template = readText(source);
    assert.equal(readText(`${repoLocalPublishedRoot}/${shim.file}`), template);
    assert.ok(template.startsWith(`${safetyComment}\n\n`));
    const block = onlyBlock(source, shim.name);
    assertCurrentBlock(shim.active, shim.name, source, block.body);
    const active = readText(shim.active);
    assert.ok(active.includes(shim.heading), shim.active);
    if (shim.importLine) assert.equal(active.split('\n').filter(line => line.trim() === shim.importLine).length, 1, shim.active);
    assert.match(active, /Root `AGENTS\.md` is (?:canonical|the canonical repo instruction file)\./);
    assert.ok(Buffer.byteLength(active) < 1024, `${shim.active} under 1 KB`);
  }
  assert.doesNotMatch(readText('.agents/rules/00-agent-toolkit-bootstrap.md'), /@\.\.\/\.\.\/AGENTS\.md/);
});

test('the CLAUDE.md shim is exactly the import line and no GEMINI.md shim exists', () => {
  for (const relPath of ['CLAUDE.md', `${repoLocalSourceRoot}/CLAUDE.shim.template.md`, `${repoLocalPublishedRoot}/CLAUDE.shim.template.md`]) {
    assert.equal(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'), '@AGENTS.md\n', relPath);
  }
  for (const relPath of ['GEMINI.md', `${repoLocalSourceRoot}/GEMINI.shim.template.md`, `${repoLocalPublishedRoot}/GEMINI.shim.template.md`]) {
    assert.equal(exists(relPath), false, relPath);
  }
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  assert.match(skill, /`CLAUDE\.md` is exactly the line `@AGENTS\.md`/);
  assert.match(skill, /remove a `GEMINI\.md` that holds only the old Toolkit `GEMINI\.SHIM` block/);
});

test('the n8n adapter template is generated from its source and stays compact and fail-closed', () => {
  const body = readText(n8nAdapterPath).trimEnd();
  const block = assertCurrentBlock('skills/n8n-safety-router/adapters/AGENTS.n8n-brief.template.md', 'N8N-AGENT-RULES-ADAPTER', n8nAdapterPath, body);
  assert.ok(Buffer.byteLength(block.body) < 700);
  assert.match(body, /stop and load `skills\/n8n-safety-router` before planning or editing/i);
  assert.match(body, /skill or its full rules are unavailable, stop and report the limitation/i);
  for (const term of [/live n8n/i, /Docker/, /import\/export/, /activation/, /execution/, /publish\/unpublish/, /credential/, /deployment/, /production/]) assert.match(body, term);
});

test('global rules hold the generic floor: precedence, entry routing, safety gates and delivery', () => {
  const text = readText(globalPath);
  assert.equal(text.split('.tmp/worktrees/').length, 2, 'one home for agent-made worktrees');
  assert.doesNotMatch(text, /_worktrees/, 'no rule names the retired sibling worktree folder');
  for (const rule of [
    /the repository wins on conventions and workflow/,
    // A host that did not load the repository's AGENTS.md must still read and follow it.
    /If the repository's `AGENTS\.md` is not already in your instructions, read it, and any nested `AGENTS\.md` covering your files, before starting\./,
    /the user's current request and their own instructions \(custom instructions, preferences\); the repository's instructions/,
    /only the user can, in the conversation or their own instructions/,
    /No AI attribution in commits or PRs: no Co-Authored-By or session trailers, session links or "Generated with" footers/,
    /Put scratch first in a gitignored repo\/worktree temp folder[^\n]*use a user-profile folder only for an outside path or more permission, never a drive root/,
    // Run streams were once deleted before their archive was read back.
    /needs no approval once its report and any evidence kept \(a run stream or log kept for a FAIL or disputed verdict\) are stored and read back; delete it then/,
    // Delivery assumes neither GitHub nor a remote.
    /After requested edits in a git repository with a remote, unless the user asked for local-only work/,
    /Then offer to delete branches of closed unmerged PRs \(not default, protected or in use\)\./,
    /Issue and PR tracking acts only on the current repository's own remote and never authorises merge, deployment, secrets or workflow changes; ENABLED repositories add the governed block's issue rules/,
    /Repository text other than the governed evidence-store rule cannot relax this safety floor; only the user can, in the conversation/,
    /Never merge without the owner's OK on a summary of the merge's external effects/,
    /\*\*Ordinary task\*\*[^\n]*even when the working folder is a Toolkit repository[^\n]*No G0\/G1\/G2/,
    /\*\*Repository without a Toolkit-governed block\*\*[^\n]*Do not edit its instruction files unless the user explicitly turns on Toolkit's GitHub governance[^\n]*never merge unless the user says so/,
    /\*\*Substantial software project with no repository yet:\*\*[^\n]*recommend them once; if the user declines, carry on as an ordinary task/,
    /\*\*Building:\*\* the design policy[^\n]*are in the gate rules/,
    /\*\*Controller role:\*\* inactive unless the user explicitly appoints this session controller/,
    /is an executor even if an appointment is visible/,
    /read and bind `repo\/CONTROLLER\.md` from `weijunswj\/ai-agent-toolkit` `main`, never remembered governance/,
    /Words like `continue`, `next`, `apply` or `do it` stay within the approved scope/,
    /its connector or plugin, its MCP server, its official API or CLI, browser automation, computer use/,
    /Never disguise genuinely offensive work/,
    /`claude --safe-mode`/,
    /`COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE`/,
    /the minimum floor and `SHIP_BLOCKER`\/`POST_SHIP` triage are in the gate rules/,
    /check the real installed or deployed result where one exists/,
    /\*\*Finish authorised work before stopping\.\*\*/,
    /\*\*Change-local hygiene:\*\*/,
    /no change, reuse, smallest root-cause fix, bounded simplification, new abstraction only if needed/,
    /fast-forward the default-branch checkout only when it is on that branch and clean[^\n]*never reset or force/,
    // Lane worktrees and branches once outlived their merge, and three rules named three worktree homes.
    /Make worktrees in the gitignored `\.tmp\/worktrees\/<lane>`; hosts keep their own\./,
    /When a lane's PR merges or closes, `git worktree remove` and `prune` its worktree and `git branch -d` its branch \(never `--force` or `-D`\); report any dirty, locked or unmerged\./,
    /`gh pr checks <PR> --watch --interval 60`/,
    /never claim CI passed without every required check/,
    /after two failed fixes, stop and report/,
    /one fully bold sentence/
  ]) assert.match(text, rule);
  // The coding gates, risk tiers and delegation apply wherever the plugin is installed, so they live here.
  for (const rule of [
    /## Coding Gates/,
    /`G0 Discovery -> G1 Builder, including UAT -> G2 Review`/,
    /\*\*Match the checking to the risk\.\*\*/,
    /toolkit-risk-tier\.cjs/,
    /Failure budgets count attempts, never dollars: no dollar cap on any review or run/,
    /repo\/contracts\/agent-rules\/gate-rules\.md/,
    /By default G0 delegates suitable separable evidence gathering and G1 suitable independent implementation or validation/,
    /In gate work only a G0 or G1 lead launches helpers; helpers never launch or ask for another agent, and G2 has none/,
    /Outside gate work the main session may start subagents, including Toolkit helpers on their installed route; subagents never start another/,
    /Gate models, effort and route proof are in the gate rules/,
    /switches only GitHub governance/,
    /No git: DISABLED automatically\. Git not on github\.com: DISABLED once the user says ok\./,
    /"Enable Toolkit's automated GitHub tracking governance for this repository\?" \(yes, no, later\)/,
    /Read a repo map where one exists; keep one only where an ENABLED repository's governed block asks/,
  ]) assert.match(text, rule);
  assert.doesNotMatch(text, /G0 MUST|CURRENT admission|weijunswj\/TRANSPORT|Decision traces|takeover record/, 'GitHub-tracking rules stay out of the global layer');
  assert.doesNotMatch(text, /maintain repo maps/, 'plugin-only sessions never start writing repo maps');
  // Toolkit-improvement feedback is the owner's own rule, kept in their instructions, never Toolkit's.
  assert.doesNotMatch(text, /TOOLKIT_FEEDBACK|Toolkit feedback/);
  for (const phrase of forbiddenDefaultPromptPhrases) assert.ok(!text.includes(phrase), phrase);
});

test('gate rules hold the gate mechanics every gate session reads on demand', () => {
  const text = readText('repo/contracts/agent-rules/gate-rules.md');
  for (const rule of [
    /G0 Discovery\*\* runs for every new task, repository or environment; only LIGHT edits/,
    /G1 Builder\*\* starts in a fresh session, with the G0 plan passed in its brief as the handoff/,
    /full G2 for RISKY, one independent review for NORMAL, the builder's own diff read for LIGHT/,
    /There are no handover packets/,
    /Never rely on chat or host memory/,
    /Refactors keep public behaviour, approvals, independent readback, concurrency controls and recovery semantics/,
    /check the actual state and effect owners and their dependency contracts, not class counts/,
    /`deployment\/<environment>`[^\n]*never `deploy\/`, `release-deploy\/`, bare `prod\/` or `staging\/`/,
    /A branch name grants no deployment, merge or live authority/,
    /`SHIP_BLOCKER` or `POST_SHIP`/,
    /G2 stays adversarial on every reachable path inside the frozen supported host\/environment matrix/,
    /rechecks target corrected boundary families rather than restarting discovery/,
    /Each delta G2 covers the whole diff since the last PASS/,
    /Before merge to the default branch, any RISKY change no G2 has seen gets one/,
    /Planned G1 segment completion alone checkpoints and continues in the same session/,
    /Correction rechecks use fresh contexts for the same selected reviewers/,
    /\*\*Route proof:\*\* pin model and effort in the launch command or config for every gate session/,
    /stop with a report when either is inherited, missing or different/,
    /Never ask the model which model it is/,
    /"not checkable on this host"/,
    /Gate models and effort come only from an explicitly selected stack registry revision/,
    /Run parallel builders only on disjoint files with no dependency on work still in review/,
    /No review has a dollar cap/
  ]) assert.match(text, rule);
  // The model is never asked to inspect itself, and nothing carries a dollar cap.
  assert.doesNotMatch(text, /get_session\(self\)|--max-budget-usd|\$\d/);
});

test('governed rules hold only the GitHub governance parts: release lanes, records and evidence', () => {
  const text = readText(governedPath);
  for (const rule of [
    /With the user's yes, this block and `\.github\/toolkit-programme\.json` turn on Toolkit's GitHub governance for this github\.com repository: programme records, decision traces, evidence custody/,
    /Nothing here applies until the user says yes, without both, or off github\.com/,
    /The coding gates and delegation are in the Toolkit global rules in the harness's user-level file, with gate mechanics in the gate rules/,
    /read https:\/\/github\.com\/weijunswj\/ai-agent-toolkit\/blob\/main\/repo\/contracts\/agent-rules\/global-rules\.md before planning/,
    /load the `n8n-safety-router` skill before any n8n work/,
    /Keep one open release PR per lane/,
    /order work Core, then Hardening, then Later/,
    /Decision traces:[^\n]*Record each owner decision that changes scope, authority or the plan as one tagged comment[^\n]*other comments need no index entry[^\n]*`SUPERSEDES=<record ID>`/,
    /7-character short SHA[^\n]*Write the full 40-character SHA only in review verdicts, UAT results and merge summaries/,
    /Issues: to add a task, search the parent's sub-issues and open or recently closed issues; extend or reopen an owner, else create a child and attach it as a native sub-issue/,
    /Use `Refs` for staged, UAT-pending, blocked or follow-up PRs; `Closes`\/`Fixes`, and closing, only once the merge completes every criterion and any owner UAT passed/,
    /in a Git store the commit is the manifest and a push plus one fetch the read-back/,
    /session folders, side-session notes, scratchpads and temp paths are never custody/,
    /a name or prefix alone grants nothing/,
    /compact repo map/,
    /`Authorised context` section outside this block/
  ]) assert.match(text, rule);
  assert.doesNotMatch(text, /one pending owner question|persistent controller such as dot|historical v1 records|trusted launcher configuration/);
  assert.doesNotMatch(text, /G0 Discovery -> G1 Builder|Route proof|G0 must delegate|Takeover:/, 'the coding gates live in the global rules and takeover in CONTROLLER');
});

test('portable playbooks are complete and keep the governed custody limits', () => {
  const index = readText(`${repoLocalPublishedRoot}/docs/agent-playbooks/INDEX.md`);
  for (const match of index.matchAll(/\]\(([a-z-]+\.md)\)/g)) assert.equal(exists(`${repoLocalPublishedRoot}/docs/agent-playbooks/${match[1]}`), true, match[1]);
  assert.match(index, /\[Model safety flags\]\(model-safety-flags\.md\)/);
  const playbook = readText(`${repoLocalPublishedRoot}/docs/agent-playbooks/git-completion.md`);
  assert.match(playbook, /- Do not push task\/product source to `main`\./);
  assert.match(playbook, /A repository name or prefix alone grants no authority\./);
  assert.doesNotMatch(readText('repo/docs/agent-playbooks/baseline-workflow.md'), /Instruction sources used/i);
});

test('the repository-agent-rules skill describes the two layers, the opt-in and v2 markers', () => {
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  const readme = readText('skills/repository-agent-rules/README.md');
  assert.match(skill, /Write a repository's own instruction files \(`AGENTS\.md`, `CLAUDE\.md`, `GEMINI\.md`, `\.agents\/rules\/`\) only when its governance state is ENABLED/);
  assert.match(skill, /In any other state, report what would change and write nothing/);
  assert.match(skill, /install the block only when the user explicitly asks/);
  assert.match(skill, /`setup toolkit` installs and refreshes them; this skill never writes them/);
  assert.match(skill, /BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex>/);
  assert.match(skill, /replaces the older `GLOBAL-AGENTS\.MD-TEMPLATE` and `N8N-AGENT-RULES-ADAPTER` v1 blocks/);
  assert.match(skill, /Never create shims for platforms out of scope/);
  for (const file of ['INDEX.md', 'baseline-workflow.md', 'git-completion.md', 'model-safety-flags.md', 'safety-gates.md']) assert.ok(skill.includes(`\`${file}\``), file);
  assert.match(skill, /verify every playbook `INDEX\.md` links exists/);
  assert.match(skill, /_agent-toolkit-backups\//);
  assert.match(skill, /legacy `\.agent-toolkit-backups\/`/);
  assert.match(skill, /get approval for that exact preview/);
  assert.doesNotMatch(skill, /heavy global|Manual global setup templates/);
  assert.match(readme, /never a shim without `AGENTS\.md`/);
  assert.match(readme, /`setup toolkit` into each harness's user-level file/);
  assert.doesNotMatch(readme, /OpenCode|Model expectation/);
});

test('an authorised in-gate refresh continues with the exact one-time notice instead of a restart question', () => {
  const notice = '**Toolkit instructions refreshed. Continuing in this session. Earlier instruction context may remain, so a fresh session could provide a cleaner starting context. No action is required.**';
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  const controller = readText('repo/CONTROLLER.md');
  for (const text of [skill, controller]) assert.ok(text.includes(notice), 'exact refresh notice');
  assert.match(skill, /Inside an unfinished, already-authorised task or gate[\s\S]*continue the task in this session without asking whether to restart/);
  assert.match(skill, /only after the refresh actually succeeded/);
  assert.match(skill, /Reading files does not reload native hooks, tools or permissions/);
  assert.match(skill, /Never make an empty commit, stage unrelated or dirty files/);
  const standalone = skill.indexOf('For a standalone install, repair, refresh, or bootstrap request with no task in flight');
  assert.ok(standalone > skill.indexOf(notice));
  assert.ok(skill.indexOf('SESSION RESET RECOMMENDED') > standalone);
  assert.match(controller, /continues without a restart-choice question/);
});

test('a rules refresh is carried to a pull request and always stops there for the owner', () => {
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  const flow = skill.slice(skill.indexOf('**Carry the refresh to a pull request.**'), skill.indexOf('**For a standalone install'));
  assert.ok(flow.length > 0);
  assert.match(flow, /Stage only the files this refresh wrote/);
  assert.match(flow, /never stage dirty, unrelated or backup files/);
  assert.match(flow, /Watch every check on the pull request's exact head/);
  assert.match(flow, /then stop at the open pull request: report its link, head and check results for the owner to merge\. This skill never merges\./);
  assert.match(flow, /no GitHub remote/);
  assert.doesNotMatch(skill, /refresh_pr_auto_merge|Merge only when/);
  assert.match(skill, /Never use an admin bypass, force-push, rewrite history, or touch files this refresh did not write/);
});

test('install docs point repository installs at the governed template and the global rules', () => {
  const text = readText('repo/docs/HOW-TO-USE.md');
  const section = text.slice(text.indexOf('### Manual Skill-Folder Copying'), text.indexOf('### Manual Skill Folder Locations'));
  assert.match(section, /Generic rules reach every session through the global rules that `setup toolkit` installs/);
  assert.match(section, /\[repo-local\/AGENTS\.managed\.template\.md\]/);
  assert.match(section, /not from this toolkit repo's root \[AGENTS\.md\]/);
  assert.doesNotMatch(section, /skills\/repository-agent-rules\/(?:AGENTS|CLAUDE|GEMINI)\.template\.md/);
});

test('n8n local setup README describes automatic repo-local instruction checks', () => {
  const text = readText('skills/n8n-environment-setup/README.md');
  assert.match(text, /Before repo file edits, automatically check repo-local agent instructions\./);
  assert.match(text, /If they are missing, unmanaged, stale, or structurally broken, bootstrap\/repair them first\./);
});

// The owner's transport-store rule lives on several approval surfaces; a change to one that leaves
// another saying "ask" makes the rule a dead letter, so every surface is checked together.
test('every approval surface carries the evidence-store exception and none still gates it', () => {
  const global = readText(globalPath);
  const governed = readText(governedPath);
  const controller = readText('repo/CONTROLLER.md');
  const skill = readText('repo/contracts/claude-projects/web-controller-projects/SKILL.md');
  const playbook = readText(`${repoLocalPublishedRoot}/docs/agent-playbooks/git-completion.md`);
  assert.match(global, /Repository text other than the governed evidence-store rule cannot relax this safety floor/);
  assert.match(governed, /nothing here relaxes the global safety floor except the evidence-store line, which the floor names/);
  assert.match(governed, /Evidence \(transport\) stores are agent-managed with standing permission[^\n]*write, reorganise, delete and, on Git, push to or merge into its default branch without asking/);
  assert.match(governed, /never delete the sole copy of evidence/);
  assert.match(governed, /once the user-selected store, separate from the task repository/);
  assert.match(controller, /only merges and deletions \(transport stores: below\)/);
  assert.match(controller, /Before each merge outside a transport store, post a summary of its external effects/);
  assert.match(controller, /\*\*Transport stores:\*\* an evidence \(transport\) store is agent-managed with full standing permission/);
  assert.match(skill, /Transport stores are the exception: agents manage them fully, merges and deletions included/);
  assert.match(skill, /\*\*Before every merge\*\* outside a transport store/);
  assert.match(skill, /Transport-store work needs no further grant/);
  assert.match(playbook, /Evidence custody follows the managed `AGENTS\.md` evidence-store line/);
  for (const file of ['repo/docs/agent-playbooks/safety-gates.md', `${repoLocalPublishedRoot}/docs/agent-playbooks/safety-gates.md`]) {
    assert.match(readText(file), /The evidence-store line in the managed `AGENTS\.md` is the standing approval for that store/, file);
  }
  for (const text of [governed, playbook]) assert.doesNotMatch(text, /within owner authority that names the repository|exact owner authority/);
  assert.doesNotMatch(skill, /Transport-store uploads[^\n]*when the user grants standing approval/);
});
