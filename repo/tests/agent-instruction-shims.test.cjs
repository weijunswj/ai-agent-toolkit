'use strict';

// Contract checks for the two instruction layers and their projections: the global rules source,
// the Toolkit-governed rules (delivered at session start; root AGENTS.md carries no copy), the host
// shims and the portable playbooks. These are instruction checks, not native permission or live-operation
// tests.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { controllerText } = require('./support/controller-text.cjs');
const { findBlocks, hasLineOutsideFences } = require('../scripts/toolkit-managed-block.cjs');
const { antigravityBootstrapCopy, managedAgentsCopy } = require('./support/retired-instruction-copies.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const globalPath = 'repo/contracts/agent-rules/global-rules.md';
const governedPath = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const n8nAdapterPath = 'repo/contracts/agent-rules/n8n-safety-router-adapter.md';
const repoLocalSourceRoot = 'repo/contracts/agent-rules/repo-local';
const repoLocalPublishedRoot = 'skills/repository-agent-rules/repo-local';
const forbiddenDefaultPromptPhrases = ['GitHub PR Completion Rules', 'GITHUB APPROVAL NEEDED', 'VERSION CONTROL APPROVAL NEEDED',
  'REMOTE APPROVAL NEEDED', 'LOCAL CHANGE APPROVAL NEEDED', 'PR: none yet', 'PR lane', 'remote source-of-truth', 'GitHub PR URL',
  'Should I push this branch'];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}
const exists = relPath => fs.existsSync(path.join(repoRoot, relPath));

test('the rule sources exist and the superseded sources and templates are gone', () => {
  for (const relPath of [globalPath, governedPath, n8nAdapterPath, 'repo/contracts/agent-rules/n8n-safety-rules.md',
    'repo/contracts/agent-rules/toolkit-skill-routing.md', `skills/toolkit-playbooks/SKILL.md`]) {
    assert.equal(exists(relPath), true, relPath);
  }
  for (const relPath of ['repo/contracts/agent-rules/ai-coding-agent-execution.md', 'repo/contracts/agent-rules/AGENTS.template.md',
    'repo/contracts/agent-rules/CLAUDE.template.md', 'repo/contracts/agent-rules/GEMINI.template.md']) {
    assert.equal(exists(relPath), false, relPath);
  }
});

// The governed-block and Antigravity bootstrap templates are retired: nothing installed them, and a
// Toolkit source checkout is known by files every Toolkit tree keeps. No script, test, hook fixture,
// manifest or workflow may read them again.
const RETIRED_TEMPLATES = ['AGENTS.managed.template.md', 'antigravity-bootstrap.template.md'];
test('the retired instruction templates are gone from both trees and no code or fixture names them', () => {
  for (const root of [repoLocalSourceRoot, repoLocalPublishedRoot]) {
    for (const file of RETIRED_TEMPLATES) assert.equal(exists(`${root}/${file}`), false, `${root}/${file}`);
  }
  // This test, and the test support that builds the old copies, whose markers name their retired source.
  const skipped = [path.relative(repoRoot, __filename), path.relative(repoRoot, require.resolve('./support/retired-instruction-copies.cjs'))]
    .map(file => file.split(path.sep).join('/'));
  // The n8n router test lists this older top-level path as one that must stay absent.
  const olderAbsent = 'skills/repository-agent-rules/antigravity-bootstrap.template.md';
  const code = childProcess.execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0')
    .filter(file => /\.(?:c?js|mjs|json|ps1|sh|ya?ml)$/.test(file) && !skipped.includes(file) && exists(file));
  assert.ok(code.includes('repo/scripts/toolkit-local-bridge.cjs'), 'the scan sees the scripts');
  const naming = code.filter(file => {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8').split(olderAbsent).join('');
    return RETIRED_TEMPLATES.some(name => text.includes(name));
  });
  assert.deepEqual(naming, []);
});

test('root AGENTS.md carries no Toolkit marker and no Antigravity rule file exists', () => {
  // The installed Toolkit delivers the governed rules here too, so the root file is all hand-written.
  const root = readText('AGENTS.md');
  assert.ok(root.startsWith('# AI Agent Toolkit Repo Rules\n\n## This Repository\n'));
  assert.doesNotMatch(root, /^<!-- AI-AGENT-TOOLKIT:/m);
  assert.equal(exists('.agents/rules/00-agent-toolkit-bootstrap.md'), false, 'Antigravity reads AGENTS.md itself');
});

// A copy of the files the sync reads and writes, so its check can be run on a changed root.
function syncWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-instruction-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { PROJECTED_OUTPUTS } = require('../scripts/sync-agent-instruction-shims.cjs');
  for (const relPath of ['repo/contracts/agent-rules', 'repo/contracts/toolkit-local-bridge/version.json', 'AGENTS.md',
    ...PROJECTED_OUTPUTS.map(output => output.path)]) {
    fs.cpSync(path.join(repoRoot, relPath), path.join(dir, relPath), { recursive: true });
  }
  const sync = (...args) => childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'repo/scripts/sync-agent-instruction-shims.cjs'), ...args, '--workspace', dir], { encoding: 'utf8' });
  return { dir, sync };
}

test('the sync check refuses a Toolkit block or the Antigravity bootstrap brought back into the root, and --write never re-adds them', t => {
  const { dir, sync } = syncWorkspace(t);
  const check = sync();
  assert.equal(check.status, 0, check.stderr);
  const original = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  // A stale branch that still carries the governed block (or a broken half of one) must not land.
  const copy = managedAgentsCopy(), [found] = findBlocks(copy).blocks;
  const block = copy.slice(found.start, found.end);
  // A Windows checkout may give the file CRLF line endings, so match either.
  const withBlock = original.replace(/(\r?\n)\1## This Repository/, (_match, eol) => `${eol}${eol}${block}${eol}${eol}## This Repository`);
  assert.notEqual(withBlock, original);
  for (const [label, text] of [['governed block', withBlock],
    ['broken marker', `${original}\n<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=1.0.0 sha256=000000000000 -->\n`]]) {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), text);
    for (const args of [[], ['--write']]) {
      const result = sync(...args);
      assert.equal(result.status, 1, `${label} ${args}`);
      assert.match(result.stderr, /FAIL: Root AGENTS\.md carries a Toolkit managed block; the installed Toolkit delivers the governed rules, so remove it by hand\./, `${label} ${args}`);
      assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), text, `${label} ${args}: never rewritten`);
    }
  }
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), original);
  fs.mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/rules/00-agent-toolkit-bootstrap.md'), antigravityBootstrapCopy());
  const bootstrap = sync();
  assert.equal(bootstrap.status, 1);
  assert.match(bootstrap.stderr, /FAIL: \.agents\/rules\/00-agent-toolkit-bootstrap\.md is not allowed: Antigravity reads AGENTS\.md itself/);
  fs.rmSync(path.join(dir, '.agents'), { recursive: true });
  // --write leaves the hand-written root as it is.
  assert.equal(sync('--write').status, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(dir, '.agents')), false);
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

// Claude Code reads AGENTS.md itself where a repository has no CLAUDE.md, and reads both while its
// "Read AGENTS.md as well as CLAUDE.md" setting is on, so calling the shim expected everywhere sent
// agents to add a CLAUDE.md nobody needed.
test('the CLAUDE.md shim is expected only where Claude Code would otherwise miss AGENTS.md', () => {
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  const check = skill.split('## Cheap state check')[1].split('\n## ')[0];
  assert.match(check, /A `CLAUDE\.md` that loads `AGENTS\.md` is expected only when Claude Code would otherwise miss it: the repository has its own `AGENTS\.md` and its own `CLAUDE\.md` \(or `\.claude\/CLAUDE\.md` or `CLAUDE\.local\.md`\), and Claude Code's "Read AGENTS\.md as well as CLAUDE\.md" setting is off,/);
  assert.doesNotMatch(skill, /where the repository has its own `AGENTS\.md`, a `CLAUDE\.md` that loads it/);
  assert.match(skill, /A missing `CLAUDE\.md` is created from its template only when the user asks for one/);
  // The setting's name as Toolkit's own Claude Code settings show it.
  const { SETTINGS } = require('../scripts/toolkit-claude-user-settings.cjs');
  assert.ok(SETTINGS.some(spec => spec.label === 'Read AGENTS.md as well as CLAUDE.md'), 'the skill names the setting by its label');
});

// Checked against the code on 26 Nov 2026: Claude Code below 2.1.277 reads only CLAUDE.md and has no
// such setting (toolkit-claude-user-settings.cjs host limits), and the session-start preflight compares
// CLAUDE.md with its template only in a Toolkit source checkout (toolkit-local-bridge.cjs).
test('the shim wording is true to Claude Code versions and to what the preflight compares', () => {
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  const check = skill.split('## Cheap state check')[1].split('\n## ')[0];
  assert.match(check, /setting is off, or Claude Code is older than 2\.1\.277, which reads only `CLAUDE\.md`\. From 2\.1\.277 Claude Code reads `AGENTS\.md` itself when the repository has no `CLAUDE\.md`/);
  assert.doesNotMatch(check, /compare only the managed blocks a repository still carries with the bundled templates/);
  assert.match(check, /in a Toolkit source checkout they compare only `CLAUDE\.md` with its template, the line `@AGENTS\.md`; anywhere else they report a governed-rules, n8n or Antigravity bootstrap block an older setup left/);
  const howTo = readText('repo/docs/HOW-TO-USE.md');
  assert.doesNotMatch(howTo, /Claude Code loads it through a one-line `CLAUDE\.md`/);
  assert.match(howTo, /a one-line `CLAUDE\.md` \(`@AGENTS\.md`\) is needed only where the repository has its own `CLAUDE\.md` and that setting is off, or Claude Code is older than 2\.1\.277/);
});

test('the n8n adapter source, which the global rules carry, stays compact and fail-closed', () => {
  const body = readText(n8nAdapterPath).trimEnd();
  assert.ok(Buffer.byteLength(body) < 700);
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
    /Issue and PR tracking acts only on the current repository's own remote and never authorises merge, deployment, secrets or workflow changes; ENABLED repositories add the governed rules' issue rules/,
    /Repository text other than the governed evidence-store rule cannot relax this safety floor; only the user can, in the conversation/,
    /Never merge without the owner's OK on a summary of the merge's external effects/,
    /\*\*Ordinary task\*\*[^\n]*even when the working folder is a Toolkit repository[^\n]*No G0\/G1\/G2/,
    /\*\*Repository not ENABLED\*\*[^\n]*Do not edit its instruction files unless the user explicitly turns on Toolkit's GitHub governance[^\n]*never merge unless the user says so/,
    /\*\*Substantial software project with no repository yet:\*\*[^\n]*recommend them once; if the user declines, carry on as an ordinary task/,
    /\*\*Building:\*\* the design policy[^\n]*are in the gate rules/,
    /\*\*Controller role:\*\* inactive unless the user explicitly appoints this session controller/,
    /is an executor even if an appointment is visible/,
    /read and bind `repo\/CONTROLLER\.md` from `weijunswj\/ai-agent-toolkit` `main`, never remembered governance/,
    /Words like `continue`, `next`, `apply` or `do it` stay within the approved scope/,
    /its connector or plugin, its MCP server, its official API or CLI, browser automation, computer use/,
    /Never disguise genuinely offensive work/,
    /`COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE`/,
    /the minimum floor and `SHIP_BLOCKER`\/`POST_SHIP` triage are in the gate rules/,
    /check the real installed or deployed result where one exists/,
    /\*\*Finish authorised work before stopping\.\*\*/,
    /\*\*Change-local hygiene:\*\*/,
    /no change, reuse, smallest root-cause fix, bounded simplification, new abstraction only if needed/,
    /fast-forward the local default-branch checkout only when it is on that branch and clean[^\n]*Never reset or force/,
    // Lane worktrees and branches once outlived their merge, and three rules named three worktree homes.
    /\(e\.g\. `\.tmp\/`, worktrees in `\.tmp\/worktrees\/<lane>-<gate>-<sha>`\)/,
    /`gh pr checks <PR> --watch --interval 60`/,
    /never claim CI passed without every required check/,
    /after two failed fixes, stop and report/,
    // Agents once asked their own merge question before the merge guard could ask its exact one,
    // and a merge guard is optional, so the guard's question replaces the agent's only where one runs.
    /Never merge without the owner's OK on a summary of the merge's external effects; a task auto-merge yes counts; where a merge guard is known to run, let it ask and take the owner's yes; else ask \(gate rules\)\./,
    /\*\*Generic, platform first:\*\* shared rules and tools name no project, issue, record or harness unless needed; state outcomes and safety floors, not steps/
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
    /Outside gates, delegate when it saves context or wall time and run each automation, thread and helper cheapest first, medium effort at least \(`agent-cost-control`\)/,
    /Gate models, effort and route proof are in the gate rules/,
    /retry in a fresh session with a clearer request/,
    /A lower option may win when much better for one operation/,
    /only origin's default-branch programme file decides GitHub governance on\/off on every computer/,
    /No Git, non-GitHub, programme-bound stores and ignored \.tmp clones: off automatically/,
    /Undecided GitHub holds for yes\/no\/later, except verified read-only: continue/,
    /Read a repo map where one exists; keep one only where an ENABLED repository's governed rules ask/,
  ]) assert.match(text, rule);
  // The safe-mode trigger check lives in its playbook, read when a flag happens, not in always-on text.
  assert.match(readText('skills/toolkit-playbooks/model-safety-flags.md'), /Start `claude --safe-mode` in the same folder/);
  assert.doesNotMatch(text, /G0 MUST|CURRENT admission|weijunswj\/TRANSPORT|Decision traces|takeover record/, 'GitHub-tracking rules stay out of the global layer');
  assert.doesNotMatch(text, /maintain repo maps/, 'plugin-only sessions never start writing repo maps');
  // Toolkit-improvement feedback is the owner's own rule, kept in their instructions, never Toolkit's.
  assert.doesNotMatch(text, /TOOLKIT_FEEDBACK|Toolkit feedback/);
  for (const phrase of forbiddenDefaultPromptPhrases) assert.ok(!text.includes(phrase), phrase);
});

// Questions once defaulted to bold text, so agents typed a question where the harness had a native one,
// and a few pages named one harness's question UI in shared text.
function shippedInstructionFiles() {
  const files = ['AGENTS.md', 'repo/CONTROLLER.md'];
  const walk = (dir, deep) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (deep) walk(rel, deep); } else if (entry.name.endsWith('.md') && entry.name !== 'CHANGELOG.md') files.push(rel);
    }
  };
  walk('repo/controller', false);
  walk('repo/contracts/agent-rules', true);
  walk('repo/docs', false);
  walk('repo/docs/agent-playbooks', false);
  walk('skills', true);
  return files;
}

// Chat replies once folded a question's choices inline while Projects posts nested them, and Toolkit
// text told agents to open question cards the harness then dropped or cut short. The global rules now
// carry the one question shape, and how a question shows (card, end-of-turn box, text) is the harness's.
test('the global rules carry the one question shape, and no shipped instruction steers a question card', () => {
  const communication = readText(globalPath).split('## Communication\n\n')[1];
  assert.ok(communication.startsWith('Questions go last. Each is a numbered, fully bold question, its choices lettered (A., B.) and nested under it, best first, each with a short plain reason, the recommended one marked (my pick). A blank line between questions.'), communication.slice(0, 300));
  // The root-cause principle once read "make it in the shared source that copies, prompts and later runs
  // inherit", which parses two ways beside "upstream" meaning third-party code.
  assert.match(readText(globalPath), /make it at the shared source every copy, prompt and later run inherits;/);
  const files = shippedInstructionFiles();
  assert.ok(files.includes('skills/toolkit-setup/SKILL.md') && files.includes('repo/docs/agent-playbooks/controller-takeover.md'));
  const found = [];
  for (const rel of files) {
    readText(rel).split('\n').forEach((line, index) => {
      // Lines that only describe a card (where an owner's answer is kept, the merge card) are not steering.
      if (/native question method|question UI|cards? first|card last|(?:open|use|show) (?:a|the) (?:question|decision) card|as a (?:question|decision) card|by card\b/i.test(line)) found.push(`${rel}:${index + 1}`);
    });
  }
  assert.deepEqual(found, [], 'no shipped instruction tells the agent to use a question card or a native question method');
});

// A merge guard is an optional hook: a harness can skip it or let a merge through when it fails, and a
// skill-only copy has none. A line that let the guard ask without that condition let an agent merge
// with no owner OK, so every line handing the merge ask to a guard (or the merge hold) keeps the condition.
test('a merge guard stands in for the merge ask only where it is known to run', () => {
  const files = [...shippedInstructionFiles(), 'repo/contracts/claude-projects/web-controller-projects/SKILL.md'];
  const handed = [];
  const unconditional = [];
  for (const rel of files) {
    readText(rel).split('\n').forEach((line, index) => {
      // The merge hold is the code's and the Bridge doc's name for the same guard. A line naming it
      // once handed the ask over unseen, so it counts when it hands the ask over, not when it only
      // describes the hold.
      const guard = /merge guard/i.test(line) && /\b(ask|question|OK)\b/.test(line);
      const hold = /merge hold/i.test(line) && /\bquestion is (that|the) (ask|OK)\b|\blet (it|the merge hold) ask\b/i.test(line);
      if (!guard && !hold) return;
      handed.push(rel);
      if (!/merge (guard|hold) is known to run/.test(line)) unconditional.push(`${rel}:${index + 1}`);
    });
  }
  for (const rel of ['repo/contracts/agent-rules/global-rules.md', 'repo/docs/agent-playbooks/safety-gates.md', 'skills/toolkit-playbooks/safety-gates.md', 'skills/secure-ci-cd/SKILL.md']) assert.ok(handed.includes(rel), rel);
  assert.deepEqual(unconditional, [], 'a merge guard question replaces the merge ask only where the guard is known to run');
});

// The reset message once ended with its bold question while the agent also asked it natively, so the
// user saw the same question twice.
test('the session reset question is asked once', () => {
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  assert.match(skill, /Keep the reset message bolded exactly as shown, except its last line: ask that once, as the reply's question in the global rules' question shape \(continue here best-effort, or start a new session\)\./);
});

test('no standing approval covers a Windows task command on any approval surface', () => {
  const global = readText(globalPath);
  assert.doesNotMatch(global, /Toolkit task standing approval|toolkit-windows-tasks/);
  assert.doesNotMatch(global, /sync tasks per safety-gates playbook/);
  assert.match(global, /Local answers and proposals grant no authority\./);
  assert.match(global, /Approval, assignment, custody and capability never supply a missing host-native permission/);
  assert.doesNotMatch(readText('AGENTS.md'), /Toolkit task standing approval/);
  assert.match(readText('AGENTS.md'), /need explicit current-turn approval naming the target and operation\./);
  assert.doesNotMatch(readText('repo/contracts/claude-projects/web-controller-projects/SKILL.md'), /Toolkit task standing approval/);
  for (const file of ['repo/docs/agent-playbooks/safety-gates.md', `skills/toolkit-playbooks/safety-gates.md`]) {
    const safety = readText(file);
    assert.match(safety, /No standing approval covers a Windows task command\. Removing Toolkit's old tasks goes through `remove toolkit`, whose plan the owner confirms\./, file);
    assert.match(safety, /the deciding chat immediately reads the decision fresh from origin's default branch/, file);
    assert.doesNotMatch(safety, /toolkit-windows-tasks\.cjs apply|--repair-owned|Session start informs an agent/, file);
  }
});


test('the controller removes a merged lane worktree and branch without --force or -D and keeps what it cannot prove', () => {
  // Lane worktrees and branches once outlived their merge; git worktree remove deletes ignored files
  // (kept evidence, .env) without --force, and git branch -d deletes a pushed unmerged branch.
  const controller = controllerText();
  assert.match(controller, /after a lane's PR merges, remove its worktree \(`git worktree remove`, then `git worktree prune`\) and its branch \(`git branch -d` once `git merge-base --is-ancestor` shows it merged\), never `--force` or `-D`; keep and report a dirty, locked or unmerged worktree, one with ignored files \(`git status --ignored`: removal deletes them\) and a closed-unmerged PR's branch;/);
});

test('gate rules hold the gate mechanics every gate session reads on demand', () => {
  const text = readText('repo/contracts/agent-rules/gate-rules.md');
  for (const rule of [
    /G0 Discovery\*\* runs for every new task, repository or environment; only LIGHT edits/,
    /G1 Builder\*\* starts in a fresh session, with the G0 plan passed in its brief as the handoff/,
    /full G2 for RISKY, one independent review for NORMAL, the builder's own diff read for LIGHT/,
    /There are no handover packets/,
    // Lane worktrees and branches once outlived their merge.
    /unless it needs its own worktree, then uses `\.tmp\/worktrees\/<lane>-<gate>-<sha>` at the admitted commit and records HEAD; the controller removes it after merge\./,
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
    /the launcher's brief route line attests it \(`launcher-attested`\); with neither it is `UNVERIFIED`/,
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
    /only the valid `\.github\/toolkit-programme\.json` merged on origin's default branch decides on\/off on every computer/,
    /Pending proposals and local answers decide nothing/,
    /Coding gates and delegation always apply from the user-level global rules and gate rules/,
    /read https:\/\/github\.com\/weijunswj\/ai-agent-toolkit\/blob\/main\/repo\/contracts\/agent-rules\/global-rules\.md before planning/,
    /load the `n8n-safety-router` skill before any n8n work/,
    /Keep one open release PR per lane/,
    /order work Now, then Later by priority/,
    /Decision traces:[^\n]*Record each owner decision that changes scope, authority or the plan as one tagged comment[^\n]*other comments need no index entry[^\n]*`SUPERSEDES=<record ID>`/,
    /7-character short SHA[^\n]*Write the full 40-character SHA only in review verdicts, UAT results and merge summaries/,
    // Work and findings go on their area's open child; a new one only when none fits, saying why (a new child per review is what split the parent).
    /Reuse first \(hard\):\*\* work and findings go on their area's open issue or job; a new one only when none fits, saying why\./,
    /Issues: to add a task, search the parent's sub-issues and open or recently closed issues; extend or reopen the one in its area \(same page, script or feature; once in progress, one follow-up sibling takes later work\), else create a native sub-issue with a `Nearest child:` line naming the closest open child and why it does not fit\./,
    /Programme tracking: the parent shows queue and status; each child's PR GRAPH shows each PR's SHA, gate and owed UAT, and its handover file the release and review\. Gate ends run `programme\.cjs handover`\./,
    /A child closes as completed once a merge completes every criterion and any owner UAT passed, any remainder moved to its area's open child first: that PR says `Closes #n`, else the controller does\. Use `Refs` for staged, UAT-pending, blocked, partial or follow-up PRs\./,
    /in a Git store the commit is the manifest and a push plus one fetch the read-back/,
    /session folders, side-session notes, scratchpads and temp paths are never custody/,
    /a name or prefix alone grants nothing/,
    /compact repo map/,
    /`Authorised context` section of its own `AGENTS\.md`/
  ]) assert.match(text, rule);
  assert.doesNotMatch(text, /one pending owner question|persistent controller such as dot|historical v1 records|trusted launcher configuration/);
  assert.doesNotMatch(text, /G0 Discovery -> G1 Builder|Route proof|G0 must delegate|Takeover:/, 'the coding gates live in the global rules and takeover in CONTROLLER');
});

test('portable playbooks are complete and keep the governed custody limits', () => {
  const index = readText(`skills/toolkit-playbooks/SKILL.md`);
  for (const match of index.matchAll(/\]\(([a-z-]+\.md)\)/g)) assert.equal(exists(`skills/toolkit-playbooks/${match[1]}`), true, match[1]);
  assert.match(index, /\[Model safety flags\]\(model-safety-flags\.md\)/);
  const playbook = readText(`skills/toolkit-playbooks/git-completion.md`);
  assert.match(playbook, /- Do not push task\/product source to `main`\./);
  assert.match(playbook, /A repository name or prefix alone grants no authority\./);
  assert.doesNotMatch(readText('repo/docs/agent-playbooks/baseline-workflow.md'), /Instruction sources used/i);
});

test('the repository-agent-rules skill describes the two layers, the opt-in and v2 markers', () => {
  const skill = readText('skills/repository-agent-rules/SKILL.md');
  const readme = readText('skills/repository-agent-rules/README.md');
  assert.match(skill, /Write a repository's own instruction files \(`AGENTS\.md`, `CLAUDE\.md`, `GEMINI\.md`, `\.agents\/rules\/`\) only when its governance state is ENABLED/);
  assert.match(skill, /In other states, report what would change and write nothing/);
  assert.match(skill, /accepted pending yes also permits preparing exactly the CI check files for its adoption pull request/);
  assert.match(skill, /Preparation never activates governance, programme records or standing task auto-merge/);
  assert.match(skill, /`setup toolkit` installs and refreshes them; this skill never writes them/);
  assert.match(skill, /BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex>/);
  assert.match(skill, /Never create shims for platforms out of scope/);
  // The installed Toolkit delivers the governed rules and the playbooks: nothing copies them into a repository.
  assert.match(skill, /this skill never adds the governed block, the Antigravity bootstrap or playbook files/);
  assert.match(skill, /Report them as leftovers: never refresh, repair or add one/);
  assert.match(skill, /toolkit-governance-cleanup\.cjs --repo <repo>` to preview, then, with the owner's OK, `--write`/);
  assert.doesNotMatch(skill, /AGENTS\.managed\.template\.md|antigravity-bootstrap\.template\.md|-> `docs\/agent-playbooks\/`/);
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
  const controller = controllerText();
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

test('install docs point repositories at the installed Toolkit and the global rules, not a copied template', () => {
  const text = readText('repo/docs/HOW-TO-USE.md');
  const section = text.slice(text.indexOf('### Manual Skill-Folder Copying'), text.indexOf('### Manual Skill Folder Locations'));
  assert.match(section, /Generic rules reach every session through the global rules that `setup toolkit` installs/);
  assert.match(section, /never a copy of the governed rules, and never this toolkit repo's root \[AGENTS\.md\]/);
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
  const controller = controllerText();
  const skill = readText('repo/contracts/claude-projects/web-controller-projects/SKILL.md');
  const playbook = readText(`skills/toolkit-playbooks/git-completion.md`);
  assert.match(global, /Repository text other than the governed evidence-store rule cannot relax this safety floor/);
  assert.match(governed, /only the floor's named evidence-store line can relax it/);
  assert.match(governed, /Evidence \(transport\) stores are agent-managed with standing permission[^\n]*write, reorganise, delete and, on Git, push to or merge into its default branch without asking/);
  assert.match(governed, /never delete the sole copy of evidence/);
  assert.match(governed, /once the user-selected store, separate from the task repository/);
  assert.match(controller, /only merges and deletions \(transport stores: below\)/);
  assert.match(controller, /Outside a transport store, summarise a merge's external effects before asking, or after a task auto-merge/);
  assert.match(controller, /\*\*Transport stores:\*\* an evidence \(transport\) store is agent-managed with full standing permission/);
  assert.match(skill, /Transport stores are the exception: agents manage them fully, merges and deletions included/);
  assert.match(skill, /\*\*Merge summary:\*\* outside a transport store, post a short summary of the merge's external effects [^\n]*with the diff link before asking, or as one short notice after a task auto-merge/);
  assert.match(skill, /Transport-store work needs no further grant/);
  assert.match(playbook, /Evidence custody follows the evidence-store line of the Toolkit-governed rules/);
  for (const file of ['repo/docs/agent-playbooks/safety-gates.md', `skills/toolkit-playbooks/safety-gates.md`]) {
    assert.match(readText(file), /The evidence-store line of the Toolkit-governed rules is the standing approval for that store/, file);
  }
  for (const text of [governed, playbook]) assert.doesNotMatch(text, /within owner authority that names the repository|exact owner authority/);
  assert.doesNotMatch(skill, /Transport-store uploads[^\n]*when the user grants standing approval/);
});

// Toolkit's own checkout keeps no rule file under .agents/rules/, not only the retired
// bootstrap name, and a case variant (which a case-insensitive checkout reads as the same folder)
// is refused too. A file elsewhere under .agents/ is left alone.
test('the sync check refuses any file under .agents/rules/, in any letter case, and --write never adds or removes one', t => {
  const { dir, sync } = syncWorkspace(t);
  for (const rel of ['.agents/rules/team-rules.md', '.agents/rules/nested/deep.md', '.agents/rules/notes.txt', '.Agents/Rules/x.md']) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '# Rules\n');
    for (const args of [[], ['--write']]) {
      const result = sync(...args);
      assert.equal(result.status, 1, `${rel} ${args}`);
      assert.match(result.stderr, new RegExp(`FAIL: ${rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} `), `${rel} ${args}`);
      assert.equal(fs.readFileSync(path.join(dir, rel), 'utf8'), '# Rules\n', `${rel} ${args}: never rewritten`);
    }
    fs.rmSync(path.join(dir, rel.split('/')[0]), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, '.agents/plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/plugins/marketplace.json'), '{}\n');
  const other = sync();
  assert.equal(other.status, 0, other.stderr);
});

// A linked rule folder or rule file is reported by its own path and never followed, so a link that
// points outside the workspace cannot hide a rule copy or leak the target's file names.
test('the sync check refuses a linked rule folder or rule file without following it', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, t => {
  const { dir, sync } = syncWorkspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-rules-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'hidden.md'), '# Rules\n');
  fs.mkdirSync(path.join(dir, '.agents'));
  fs.symlinkSync(outside, path.join(dir, '.agents/rules'), 'dir');
  const folder = sync();
  assert.equal(folder.status, 1, folder.stderr);
  assert.match(folder.stderr, /FAIL: \.agents\/rules is not allowed/);
  assert.doesNotMatch(folder.stderr, /hidden\.md/);
  fs.rmSync(path.join(dir, '.agents/rules'));
  fs.mkdirSync(path.join(dir, '.agents/rules'));
  fs.symlinkSync(path.join(outside, 'hidden.md'), path.join(dir, '.agents/rules/linked.md'));
  const file = sync('--write');
  assert.equal(file.status, 1, file.stderr);
  assert.match(file.stderr, /FAIL: \.agents\/rules\/linked\.md is not allowed/);
  assert.equal(fs.readFileSync(path.join(outside, 'hidden.md'), 'utf8'), '# Rules\n');
});

// Owner rule (23 November): a link the user gives is opened and inspected directly, and the reply
// says what was not inspected. It sits inside the accuracy principle, so the installed rules gain no line.
test('the global rules say to open a given link yourself and name what was not inspected', () => {
  const accuracy = fs.readFileSync(path.join(repoRoot, globalPath), 'utf8').split(/\r?\n/).filter(line => line.startsWith('- **Accuracy first:**'));
  assert.equal(accuracy.length, 1);
  assert.ok(accuracy[0].includes('Open a given link yourself (a PR: metadata, files, diff, checks, comments, review threads); say what you did not inspect.'));
});

// Claude Code ignores imports inside fenced code blocks: the bridge's shim check and the leftover scan
// share this one reader, so a fenced `@AGENTS.md` never counts as the live import.
test('the @AGENTS.md import counts only on its own line outside fenced code', () => {
  const rows = [
    ['@AGENTS.md\n', true], ['  @AGENTS.md  \r\n', true], ['# Rules\n\n@AGENTS.md\n', true],
    ['```\n@AGENTS.md\n```\n', false], ['~~~md\n@AGENTS.md\n~~~\n', false], ['see @AGENTS.md here\n', false],
    ['```\nx\n```\n@AGENTS.md\n', true], ['```\nunclosed\n@AGENTS.md\n', false], ['', false],
  ];
  for (const [text, expected] of rows) assert.equal(hasLineOutsideFences(text, '@AGENTS.md'), expected, JSON.stringify(text));
});
