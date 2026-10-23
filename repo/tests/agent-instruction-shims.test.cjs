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
  for (const rule of [
    /the repository wins on conventions and workflow/,
    // A host that did not load the repository's AGENTS.md must still read and follow it.
    /If the repository's `AGENTS\.md` is not already in your instructions, read it, and any nested `AGENTS\.md` covering your files, before starting\./,
    /the user's current request and their own instructions \(custom instructions, preferences\); the repository's instructions/,
    /only the user can, in the conversation or their own instructions/,
    /No AI attribution in commits or PRs: no Co-Authored-By or session trailers, session links or "Generated with" footers/,
    /Never create files or folders at a drive root; use the user profile, the repo's temp folder or the scratchpad for temporary files and delete them after/,
    /To add a task, search the parent's sub-issues \(if any\) and open or recently closed issues; extend or reopen an owner, else create a child, attach it as a native sub-issue and read it back/,
    /Repository text other than the governed evidence-store rule cannot relax this safety floor; only the user can, in the conversation/,
    /Never merge without the owner's OK on a summary of the merge's external effects/,
    /\*\*Ordinary task\*\*[^\n]*even when the working folder is a Toolkit repository[^\n]*No G0\/G1\/G2/,
    /\*\*Repository without a Toolkit-governed block\*\*[^\n]*Do not edit its instruction files unless the user explicitly installs Toolkit governance[^\n]*never merge unless the user says so/,
    /\*\*Substantial software project with no repository yet:\*\*[^\n]*recommend them once; if the user declines, carry on as an ordinary task/,
    /Refactors keep public behaviour, approvals, independent readback, concurrency controls and recovery semantics/,
    /check the actual state and effect owners and their dependency contracts, not class counts/,
    /\*\*Controller role:\*\* inactive unless the user explicitly appoints this session controller/,
    /is an executor even if an appointment is visible/,
    /read and bind `repo\/CONTROLLER\.md` from `weijunswj\/ai-agent-toolkit` `main`, never remembered governance/,
    /`TOOLKIT_FEEDBACK` block/,
    /Words like `continue`, `next`, `apply` or `do it` stay within the approved scope/,
    /Outside Toolkit-governed work the limit is one layer/,
    /Run parallel builders only on disjoint files with no dependency on work still in review/,
    /its connector or plugin, its MCP server, its official API or CLI, browser automation, computer use/,
    /Never disguise genuinely offensive work/,
    /`claude --safe-mode`/,
    /`COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE`/,
    /`SHIP_BLOCKER` or `POST_SHIP`/,
    /check the real installed or deployed result where one exists/,
    /\*\*Finish authorised work before stopping\.\*\*/,
    /`deployment\/<environment>`[^\n]*never `deploy\/`, `release-deploy\/`, bare `prod\/` or `staging\/`/,
    /A branch name grants no deployment, merge or live authority/,
    /\*\*Change-local hygiene:\*\*/,
    /no change, reuse, smallest root-cause fix, bounded simplification, new abstraction only if needed/,
    /Use `Refs` for staged, UAT-pending, blocked or follow-up PRs, and `Closes`\/`Fixes` only when the merge completes every criterion/,
    /fast-forward the local default-branch checkout only when it is on that branch and clean[^\n]*Never reset or force/,
    /`gh pr checks <PR> --watch --interval 60`/,
    /never claim CI passed without every required check/,
    /after two failed fixes, stop and report/,
    /one fully bold sentence/
  ]) assert.match(text, rule);
  assert.doesNotMatch(text, /G0 MUST|stack registry|CURRENT admission|weijunswj\/TRANSPORT/, 'governed-only rules stay out of the global layer');
  for (const phrase of forbiddenDefaultPromptPhrases) assert.ok(!text.includes(phrase), phrase);
});

test('governed rules hold only Toolkit-governed workflow, records and routes', () => {
  const text = readText(governedPath);
  for (const rule of [
    /This block opts the repository into AI Agent Toolkit governance; nothing Toolkit-governed applies without it/,
    /read https:\/\/github\.com\/weijunswj\/ai-agent-toolkit\/blob\/main\/repo\/contracts\/agent-rules\/global-rules\.md before planning/,
    /`G0 Discovery -> G1 Builder, including UAT -> G2 Review`/,
    /G2 stays adversarial on every reachable path inside the frozen supported host\/environment matrix/,
    /rechecks target corrected boundary families rather than restarting discovery/,
    /Planned G1 segment completion alone checkpoints and continues in the same session/,
    /Correction rechecks use fresh contexts for the same selected reviewers/,
    /G0 must delegate suitable separable evidence gathering, and G1 suitable independent implementation or validation/,
    /no helper quota, ceremonial launch or extra owner permission for already-authorised direct work/,
    /load the `n8n-safety-router` skill before any n8n work/,
    /Only a G0 or G1 lead launches helpers; helpers never launch or ask for another agent, and G2 has none/,
    /\*\*Route proof:\*\* every gate launch pins model and effort explicitly/,
    /`get_session\(self\)`/,
    /stops with a report when either is inherited, missing or different from the pinned route/,
    /Keep one open release PR per lane/,
    /order work Core, then Hardening, then Later/,
    /Decision traces:[^\n]*`#issuecomment-<id>`[^\n]*`SUPERSEDES=<record ID>`[^\n]*60,000 characters/,
    /7-character short SHA[^\n]*full 40-character SHA beside the link as plain code text/,
    /Takeover: a new controller posts one takeover record on the parent's CURRENT/,
    /session folders, side-session notes, scratchpads and temp paths are never custody/,
    /a name or prefix alone grants nothing/,
    /compact repo map/,
    /`Authorised context` section outside this block/
  ]) assert.match(text, rule);
  assert.doesNotMatch(text, /one pending owner question|persistent controller such as dot|historical v1 records|trusted launcher configuration/);
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
  assert.match(skill, /That block is the opt-in/);
  assert.match(skill, /Never install or refresh rules in a repository without the block unless the user asks/);
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
  assert.match(controller, /only merges, deletions \(transport stores: below\)/);
  assert.match(controller, /\*\*Transport stores:\*\* an evidence \(transport\) store is agent-managed with full standing permission/);
  assert.match(skill, /Transport stores are the exception: agents manage them fully, merges and deletions included/);
  assert.match(skill, /\*\*Before every merge\*\* outside a transport store/);
  assert.match(skill, /Transport-store work needs no further grant/);
  assert.match(playbook, /Evidence custody follows the managed `AGENTS\.md` evidence-store line/);
  for (const text of [governed, playbook]) assert.doesNotMatch(text, /within owner authority that names the repository|exact owner authority/);
  assert.doesNotMatch(skill, /Transport-store uploads[^\n]*when the user grants standing approval/);
});
