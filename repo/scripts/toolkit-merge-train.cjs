#!/usr/bin/env node
'use strict';

// Merge train: lands several reviewed pull requests with one version bump and one CI run.
// Each member boards at the exact head its review passed, as its own merge commit, so its
// commits and review stay its own. The train adds nothing else except one bump commit at the end,
// made by the repository's bump command, and `verify` proves that before CI and again before the
// merge. A member that does not merge cleanly is ejected, never hand-fixed. The script never
// merges, pushes or writes to GitHub: `land` only checks, then names the train pull request and the
// exact head the merging agent may merge, by the repository's normal merge route.
//
//   node repo/scripts/toolkit-merge-train.cjs build  --manifest <file> --branch <name> [--main <ref>] [--onto <ref>] [--out <file>] [--json]
//   node repo/scripts/toolkit-merge-train.cjs verify --manifest <file> --head <ref> [--main <ref>] [--json]
//   node repo/scripts/toolkit-merge-train.cjs body   --manifest <file> [--json]
//   node repo/scripts/toolkit-merge-train.cjs split  --manifest <file> --out-prefix <path> [--json]
//   node repo/scripts/toolkit-merge-train.cjs eject  --manifest <file> --pr <member PR> --reason <text> [--main <ref>] [--out <file>] [--json]
//   node repo/scripts/toolkit-merge-train.cjs land   --manifest <file> --pr <train PR> --head <sha> [--main <ref>] [--live <file>] [--json]
//
// The manifest (JSON) lists the members in the order they board:
//   { "repository": "owner/name",
//     "bump_command": "node repo/scripts/bump-version.cjs --next {level} --base {base}",   (optional)
//     "members": [ { "pr": 12, "head": "<40-hex SHA the review passed>", "g2": "<report link>",
//                    "tier": "LIGHT|NORMAL|RISKY", "bump": "patch|minor|major|none",
//                    "uat": "UAT: NOT_REQUIRED (...)", "links": ["Closes #34"],
//                    "owner_ok": "<link to the owner's typed merge OK; RISKY members only>" } ] }
// With no bump_command, a repository holding repo/scripts/bump-version.cjs uses the line above and
// any other repository takes no bump commit; "none" turns the bump off. The command runs without a
// shell, with {level} as the highest member level and {base} as the main commit.
//
// build runs in a clean checkout of its own (a worktree) and refuses a --branch checked out in any
// other worktree. It resets --branch to --onto (default
// --main, default origin/main), merges each member head, ejects one that conflicts or is already on
// main, then runs the bump command and commits the result. --onto another train's head combines new
// members while that train waits on CI: such a stacked train takes no bump and cannot land; rebuild
// it on main once the earlier train has merged. --out writes the boarded manifest, with the ejected
// members and their reasons under "ejected", for verify, body and land.
//
// eject takes a boarded member off a train that is already pushed, without rewriting its history,
// so the train keeps its branch and pull request. Run in a clean checkout of the train, it adds
// revert commits on top: when the train ends in its bump, first a revert of that bump, then a revert
// of the member's boarding merge (`git revert -m 1`), then a fresh bump at the remaining members'
// level. It moves the member to "ejected" with its boarding merge and every revert it made, and
// writes the manifest back (or to --out). A revert that does not apply cleanly (a later member
// builds on the ejected one) is refused and the checkout left as it was. The ejected pull request
// stays open: its commits are in the train, so GitHub would mark it merged if the train landed with
// it still at that head; land refuses that until its branch moves on or it closes. It rejoins only a
// later train, after its branch merges main and reverts the eject revert, with a fresh review.
//
// verify walks the train's first-parent commits after main and refuses anything that is not a
// member merge or a main catch-up merge whose tree equals Git's own clean merge, or a last bump
// commit whose tree equals a fresh run of the bump command. Every member must board exactly once.
// It also accepts exactly the reverts recorded under "ejected": each must equal Git's own revert of
// an earlier train commit (an ejected member's boarding merge, or a bump that a later bump replaced),
// and every recorded revert must be there. Each bump is checked at the level of the members on board
// when it was made.
// land re-runs verify, requires main to be inside the train (else main moved: rebuild), every
// member's pull request open at its boarded head, the train pull request at --head and an owner OK
// for every RISKY member, then names the pull request and head to merge. --live reads those pull request facts from
// a JSON file ({"<number>": {"state": "OPEN", "head": "<sha>"}}) instead of `gh api` (REST).
//
// Exit 0: done or ready. Exit 1: refused, with every reason. Exit 2: bad arguments or unreadable input.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA = /^[0-9a-f]{40}$/;
const LEVELS = Object.freeze(['patch', 'minor', 'major']);
const TIERS = Object.freeze(['LIGHT', 'NORMAL', 'RISKY']);
const TOOLKIT_BUMP = 'node repo/scripts/bump-version.cjs --next {level} --base {base}';
const UAT_LINE = /^UAT: (NOT_REQUIRED|OWNER_TEST_NEEDED|PASSED)\b/;
const LINK_LINE = /^(Closes|Fixes|Resolves|Refs) #\d+$/;
const COMMANDS = Object.freeze(['build', 'verify', 'body', 'split', 'land', 'eject']);

class TrainError extends Error {
  constructor(message, code = 2) { super(message); this.code = code; }
}

function git(cwd, args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new TrainError(`git could not run: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) throw new TrainError(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function safeRef(ref, name) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..')) {
    throw new TrainError(`${name} is not a plain ref: ${JSON.stringify(ref)}`);
  }
  return ref;
}

function resolve(cwd, ref, name) {
  const out = git(cwd, ['rev-parse', '--verify', '--quiet', `${safeRef(ref, name)}^{commit}`], { allowFail: true });
  if (out.status !== 0 || !SHA.test(out.stdout)) throw new TrainError(`${name} ${ref} is not a commit here; fetch it first`);
  return out.stdout;
}

function isAncestor(cwd, older, newer) {
  return git(cwd, ['merge-base', '--is-ancestor', older, newer], { allowFail: true }).status === 0;
}

// Git's own merge of two commits, without touching the work tree or index: the tree, or null on a conflict.
function cleanMergeTree(cwd, first, second) {
  const out = git(cwd, ['merge-tree', '--write-tree', '--no-messages', first, second], { allowFail: true });
  if (out.status !== 0) return null;
  const tree = out.stdout.split('\n')[0].trim();
  return SHA.test(tree) ? tree : null;
}

function readManifest(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    throw new TrainError(`manifest ${file} is not readable JSON: ${error.message}`);
  }
  return checkManifest(value);
}

function checkManifest(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.members) || value.members.length === 0) {
    throw new TrainError('the manifest needs a non-empty "members" list');
  }
  if (value.repository !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) {
    throw new TrainError(`"repository" must be owner/name, found ${JSON.stringify(value.repository)}`);
  }
  if (value.bump_command !== undefined && (typeof value.bump_command !== 'string' || !value.bump_command.trim())) {
    throw new TrainError('"bump_command" must be a command line or "none"');
  }
  const seenPr = new Set();
  const seenHead = new Set();
  for (const member of value.members) {
    const where = `member ${JSON.stringify(member && member.pr)}`;
    if (!member || !Number.isInteger(member.pr) || member.pr <= 0) throw new TrainError(`${where}: "pr" must be a pull request number`);
    if (seenPr.has(member.pr)) throw new TrainError(`${where} is listed twice`);
    seenPr.add(member.pr);
    if (!SHA.test(member.head || '')) throw new TrainError(`${where}: "head" must be the full 40-character SHA its review passed`);
    if (seenHead.has(member.head)) throw new TrainError(`${where} shares its head with another member`);
    seenHead.add(member.head);
    if (typeof member.g2 !== 'string' || !member.g2.trim()) throw new TrainError(`${where}: "g2" must name its review PASS at that head`);
    if (!TIERS.includes(member.tier)) throw new TrainError(`${where}: "tier" must be ${TIERS.join(', ')}`);
    if (!['none', ...LEVELS].includes(member.bump)) throw new TrainError(`${where}: "bump" must be none, ${LEVELS.join(', ')}`);
    if (typeof member.uat !== 'string' || !UAT_LINE.test(member.uat.trim()) || member.uat.includes('\n')) {
      throw new TrainError(`${where}: "uat" must be its one UAT: line`);
    }
    if (member.links !== undefined && (!Array.isArray(member.links) || !member.links.every(line => typeof line === 'string' && LINK_LINE.test(line.trim())))) {
      throw new TrainError(`${where}: "links" lines must each be "Closes #n", "Fixes #n", "Resolves #n" or "Refs #n"`);
    }
    if (member.owner_ok !== undefined && (typeof member.owner_ok !== 'string' || !member.owner_ok.trim())) {
      throw new TrainError(`${where}: "owner_ok" must link the owner's typed merge OK`);
    }
  }
  checkEjected(value, seenPr);
  return value;
}

// "ejected" lists members that left the train: by build (no "merge") or by eject after boarding
// ("merge" is its boarding merge commit, "bump" its level, "reverts" every revert commit eject added for it).
function checkEjected(value, memberPrs) {
  if (value.ejected === undefined) return;
  if (!Array.isArray(value.ejected)) throw new TrainError('"ejected" must be a list');
  const seenCommit = new Set();
  for (const entry of value.ejected) {
    const where = `ejected ${JSON.stringify(entry && entry.pr)}`;
    if (!entry || !Number.isInteger(entry.pr) || entry.pr <= 0) throw new TrainError(`${where}: "pr" must be a pull request number`);
    if (typeof entry.head !== 'string' || !entry.head) throw new TrainError(`${where}: "head" must name the head it was ejected at`);
    if (entry.merge === undefined && entry.reverts === undefined) continue;
    if (memberPrs.has(entry.pr)) throw new TrainError(`${where} left this train after boarding: it rejoins only a later train`);
    if (!SHA.test(entry.head)) throw new TrainError(`${where}: "head" must be a full SHA`);
    if (!SHA.test(entry.merge || '')) throw new TrainError(`${where}: "merge" must be its boarding merge commit as a full SHA`);
    if (!['none', ...LEVELS].includes(entry.bump)) throw new TrainError(`${where}: "bump" must keep its level, so the bump it rode in still checks`);
    if (!Array.isArray(entry.reverts) || !entry.reverts.length) throw new TrainError(`${where}: "reverts" must list the revert commits eject made`);
    for (const revert of entry.reverts) {
      if (!revert || !SHA.test(revert.commit || '') || !SHA.test(revert.of || '')) throw new TrainError(`${where}: each revert needs "commit" and "of" as full SHAs`);
      if (seenCommit.has(revert.commit) || seenCommit.has(`of:${revert.of}`)) throw new TrainError(`${where}: revert ${revert.commit.slice(0, 12)} is recorded twice`);
      seenCommit.add(revert.commit);
      seenCommit.add(`of:${revert.of}`);
    }
    if (!entry.reverts.some(revert => revert.of === entry.merge)) throw new TrainError(`${where}: no recorded revert undoes its boarding merge`);
  }
}

// Members that left the train after boarding, keyed by their ejected head.
function boardedThenEjected(manifest) {
  return (manifest.ejected || []).filter(entry => entry.merge);
}

// Git's own revert of `target` (its first parent as mainline) on top of `onto`: the tree, or null on a conflict.
function cleanRevertTree(cwd, target, onto) {
  const out = git(cwd, ['merge-tree', '--write-tree', '--no-messages', `--merge-base=${target}`, onto, `${target}^1`], { allowFail: true });
  if (out.status !== 0) return null;
  const tree = out.stdout.split('\n')[0].trim();
  return SHA.test(tree) ? tree : null;
}

function trainLevel(members) {
  return members.reduce((top, member) => (LEVELS.indexOf(member.bump) > LEVELS.indexOf(top) ? member.bump : top), 'none');
}

function trainTier(members) {
  return members.reduce((top, member) => (TIERS.indexOf(member.tier) > TIERS.indexOf(top) ? member.tier : top), 'LIGHT');
}

function bumpArgv(cwd, manifest, level, base) {
  let line = manifest.bump_command;
  if (line === undefined) line = fs.existsSync(path.join(cwd, 'repo', 'scripts', 'bump-version.cjs')) ? TOOLKIT_BUMP : 'none';
  if (line.trim() === 'none' || level === 'none') return null;
  return line.trim().split(/\s+/).map(part => part.replaceAll('{level}', level).replaceAll('{base}', base));
}

function runBump(cwd, argv) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new TrainError(`the bump command failed: ${result.error ? result.error.message : (result.stderr || result.stdout).trim()}`, 1);
  }
}

function memberMessage(member) {
  return `Merge train: board #${member.pr} at ${member.head.slice(0, 12)}`;
}

function build(cwd, manifest, options) {
  const branch = safeRef(options.branch || '', '--branch');
  const here = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).stdout);
  const elsewhere = git(cwd, ['worktree', 'list', '--porcelain']).stdout.split('\n\n')
    .map(block => ({ tree: (block.match(/^worktree (.+)$/m) || [])[1], ref: (block.match(/^branch (.+)$/m) || [])[1] }))
    .find(entry => entry.ref === `refs/heads/${branch}` && entry.tree && fs.existsSync(entry.tree) && fs.realpathSync(entry.tree) !== here);
  if (elsewhere) throw new TrainError(`${branch} is checked out in another worktree (${elsewhere.tree}); pick another branch or free that checkout first`);
  if (git(cwd, ['status', '--porcelain']).stdout) throw new TrainError('build needs a clean checkout of its own; use a fresh worktree');
  const main = resolve(cwd, options.main, '--main');
  const onto = resolve(cwd, options.onto || options.main, '--onto');
  if (!isAncestor(cwd, main, onto)) throw new TrainError('--onto must contain main; rebuild the earlier train on main first');
  const stacked = onto !== main;
  git(cwd, ['switch', '--quiet', '--force-create', branch, onto]);
  const boarded = [];
  const ejected = [];
  for (const member of manifest.members) {
    const head = git(cwd, ['rev-parse', '--verify', '--quiet', `${member.head}^{commit}`], { allowFail: true });
    if (head.status !== 0) { ejected.push({ ...member, reason: 'head not fetched here' }); continue; }
    if (isAncestor(cwd, member.head, 'HEAD')) { ejected.push({ ...member, reason: 'already on the train base' }); continue; }
    const merged = git(cwd, ['-c', 'rerere.enabled=false', 'merge', '--no-ff', '--no-edit', '-m', memberMessage(member), member.head], { allowFail: true });
    if (merged.status !== 0) {
      git(cwd, ['merge', '--abort'], { allowFail: true });
      ejected.push({ ...member, reason: 'conflicts with the train; land it on its own or rejoin after a delta review of the resolution' });
      continue;
    }
    boarded.push(member);
  }
  let bump = null;
  const level = trainLevel(boarded);
  if (boarded.length && !stacked) {
    const argv = bumpArgv(cwd, manifest, level, main);
    if (argv) {
      try {
        runBump(cwd, argv);
      } catch (error) {
        git(cwd, ['reset', '--quiet', '--hard', 'HEAD'], { allowFail: true });
        git(cwd, ['clean', '--quiet', '-fd'], { allowFail: true });
        const out = { ...manifest, members: boarded, ejected: ejected.map(({ pr, head: sha, reason }) => ({ pr, head: sha, reason })) };
        if (options.out) fs.writeFileSync(options.out, `${JSON.stringify(out, null, 2)}\n`);
        return {
          ok: false, branch, head: git(cwd, ['rev-parse', 'HEAD']).stdout, main, onto, stacked, level, bump: null,
          boarded: boarded.map(member => member.pr), ejected: out.ejected,
          problems: [`${error.message}; a member that already carries its own version bump must hold main's version before it boards`],
        };
      }
      git(cwd, ['add', '--all']);
      if (git(cwd, ['diff', '--cached', '--quiet'], { allowFail: true }).status !== 0) {
        git(cwd, ['commit', '--quiet', '--no-verify', '-m', `Merge train: bump ${level} for ${boarded.map(member => `#${member.pr}`).join(', ')}`]);
        bump = git(cwd, ['rev-parse', 'HEAD']).stdout;
      }
    }
  }
  const head = git(cwd, ['rev-parse', 'HEAD']).stdout;
  const out = { ...manifest, members: boarded, ejected: ejected.map(({ pr, head: sha, reason }) => ({ pr, head: sha, reason })) };
  if (options.out) fs.writeFileSync(options.out, `${JSON.stringify(out, null, 2)}\n`);
  return { ok: boarded.length > 0, branch, head, main, onto, stacked, level, bump, boarded: boarded.map(member => member.pr), ejected: out.ejected };
}

function eject(cwd, manifest, options) {
  if (!Number.isInteger(options.pr) || options.pr <= 0) throw new TrainError('--pr must be the member pull request to eject');
  const reason = String(options.reason || '').trim();
  if (!reason || reason.includes('\n')) throw new TrainError('--reason must say in one line why the member leaves the train');
  if (git(cwd, ['status', '--porcelain']).stdout) throw new TrainError('eject needs a clean checkout of the train; use its own worktree');
  const member = manifest.members.find(entry => entry.pr === options.pr);
  if (!member) throw new TrainError(`#${options.pr} is not a member of this train`, 1);
  const remaining = manifest.members.filter(entry => entry !== member);
  if (!remaining.length) throw new TrainError(`#${options.pr} is the train's last member: close the train pull request instead`, 1);
  const main = resolve(cwd, options.main, '--main');
  const start = git(cwd, ['rev-parse', 'HEAD']).stdout;
  const checked = verify(cwd, manifest, { main: options.main, head: start });
  if (!checked.ok) return { ok: false, pr: options.pr, head: start, main, problems: ['the checkout does not verify as this train, so nothing was ejected', ...checked.problems] };
  const commits = git(cwd, ['rev-list', '--first-parent', '--reverse', '--parents', `${main}..HEAD`]).stdout.split('\n').map(line => line.trim().split(/\s+/));
  const board = commits.find(([, , second]) => second === member.head)[0];
  const recorded = new Set(boardedThenEjected(manifest).flatMap(entry => entry.reverts.map(revert => revert.commit)));
  const [lastCommit, ...lastParents] = commits[commits.length - 1];
  const bump = lastParents.length === 1 && !recorded.has(lastCommit) ? lastCommit : null;
  const made = [];
  const undo = problem => {
    git(cwd, ['revert', '--abort'], { allowFail: true });
    git(cwd, ['reset', '--quiet', '--hard', start], { allowFail: true });
    git(cwd, ['clean', '--quiet', '-fd'], { allowFail: true });
    return { ok: false, pr: options.pr, head: start, main, problems: [problem] };
  };
  const revert = (target, mainline, message) => {
    const args = ['-c', 'rerere.enabled=false', 'revert', '--no-commit', ...(mainline ? ['-m', '1'] : []), target];
    if (git(cwd, args, { allowFail: true }).status !== 0) return false;
    git(cwd, ['commit', '--quiet', '--no-verify', '--allow-empty', '-m', message]);
    made.push({ commit: git(cwd, ['rev-parse', 'HEAD']).stdout, of: target });
    return true;
  };
  // The bump is reverted first: it folded the member's notes, so the member cannot be reverted under it.
  if (bump && !revert(bump, false, `Merge train: eject #${member.pr}, revert the bump to re-bump without it`)) {
    return undo('the bump does not revert cleanly; rebuild the train instead');
  }
  if (!revert(board, true, `Merge train: eject #${member.pr} (${reason})`)) {
    return undo(`#${member.pr}'s boarding does not revert cleanly: a later member builds on it, so eject that member first`);
  }
  let rebump = null;
  if (bump) {
    const level = trainLevel(remaining);
    const argv = bumpArgv(cwd, manifest, level, main);
    if (argv) {
      try {
        runBump(cwd, argv);
      } catch (error) {
        return undo(`${error.message}; nothing was ejected`);
      }
      git(cwd, ['add', '--all']);
      if (git(cwd, ['diff', '--cached', '--quiet'], { allowFail: true }).status !== 0) {
        git(cwd, ['commit', '--quiet', '--no-verify', '-m', `Merge train: bump ${level} for ${remaining.map(entry => `#${entry.pr}`).join(', ')}`]);
        rebump = git(cwd, ['rev-parse', 'HEAD']).stdout;
      }
    }
  }
  const boardRevert = made.find(entry => entry.of === board).commit;
  const out = {
    ...manifest,
    members: remaining,
    ejected: [...(manifest.ejected || []), { pr: member.pr, head: member.head, bump: member.bump, reason, merge: board, reverts: made }],
  };
  fs.writeFileSync(options.out || options.manifest, `${JSON.stringify(out, null, 2)}\n`);
  return {
    ok: true,
    pr: member.pr,
    head: git(cwd, ['rev-parse', 'HEAD']).stdout,
    main,
    reverts: made,
    bump: rebump,
    members: remaining.map(entry => entry.pr),
    next: `push the train branch (no force), run verify and wait for CI; #${member.pr} stays open and must move off ${member.head.slice(0, 12)} or close before the train lands`,
    rejoin: `after this train lands, on #${member.pr}'s branch: merge main, then git revert --no-edit ${boardRevert}, fix it and pass a fresh review; it boards a later train`,
  };
}

function reproducesBump(cwd, manifest, commit, parent, level, main) {
  const argv = bumpArgv(cwd, manifest, level, main);
  if (!argv) return 'the train has no bump to make, so a plain commit is not allowed';
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-train-'));
  const tree = path.join(scratch, 'tree');
  try {
    git(cwd, ['worktree', 'add', '--quiet', '--detach', tree, parent]);
    try {
      runBump(tree, argv);
      git(tree, ['add', '--all']);
      const made = git(tree, ['write-tree']).stdout;
      const recorded = git(cwd, ['rev-parse', `${commit}^{tree}`]).stdout;
      return made === recorded ? '' : 'the last commit differs from a fresh run of the bump command';
    } finally {
      git(cwd, ['worktree', 'remove', '--force', tree], { allowFail: true });
      git(cwd, ['worktree', 'prune'], { allowFail: true });
    }
  } catch (error) {
    return error instanceof TrainError ? error.message : String(error);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function verify(cwd, manifest, options) {
  const main = resolve(cwd, options.main, '--main');
  const head = resolve(cwd, options.head || '', '--head');
  const problems = [];
  const byHead = new Map(manifest.members.map(member => [member.head, member]));
  const left = boardedThenEjected(manifest);
  const leftByHead = new Map(left.map(entry => [entry.head, entry]));
  const reverts = new Map(left.flatMap(entry => entry.reverts.map(revert => [revert.commit, { ...revert, entry }])));
  const seen = new Map();
  const listed = git(cwd, ['rev-list', '--first-parent', '--reverse', '--parents', `${main}..${head}`]).stdout;
  const commits = listed ? listed.split('\n').map(line => line.trim().split(/\s+/)) : [];
  if (!commits.length) problems.push('the train holds nothing that main does not');
  const level = trainLevel(manifest.members);
  const position = new Map(commits.map(([commit], index) => [commit, index]));
  const onBoard = new Map(); // boarding merge commit -> member or ejected entry, while it is not reverted
  const plain = []; // bump commits, by index
  const reverted = new Set();
  const seenReverts = new Set();
  commits.forEach(([commit, ...parents], index) => {
    const short = commit.slice(0, 12);
    if (parents.length === 2) {
      const [first, second] = parents;
      const member = byHead.get(second) || leftByHead.get(second);
      if (!member && !isAncestor(cwd, second, main)) {
        problems.push(`${short} merges ${second.slice(0, 12)}, which is neither a member's reviewed head nor main`);
        return;
      }
      if (member) {
        if (seen.has(member.pr)) problems.push(`#${member.pr} boards twice`);
        seen.set(member.pr, commit);
        onBoard.set(commit, member);
        if (leftByHead.has(second) && member.merge !== commit) problems.push(`${short} boards ejected #${member.pr}, but its recorded boarding merge is ${member.merge.slice(0, 12)}`);
      }
      const clean = cleanMergeTree(cwd, first, second);
      if (!clean) problems.push(`${short} is a merge Git cannot make cleanly: a hand-resolved conflict is not allowed`);
      else if (clean !== git(cwd, ['rev-parse', `${commit}^{tree}`]).stdout) problems.push(`${short} differs from Git's own clean merge: the merge was edited`);
      return;
    }
    if (parents.length > 2) { problems.push(`${short} merges more than two commits at once`); return; }
    const revert = reverts.get(commit);
    if (revert) {
      seenReverts.add(commit);
      const where = position.get(revert.of);
      if (where === undefined || where >= index) { problems.push(`${short} reverts ${revert.of.slice(0, 12)}, which is not an earlier commit of this train`); return; }
      if (reverted.has(revert.of)) { problems.push(`${short} reverts ${revert.of.slice(0, 12)} a second time`); return; }
      const target = onBoard.get(revert.of);
      if (target && target !== revert.entry) { problems.push(`${short} reverts the boarding of #${target.pr}, but the revert is recorded for #${revert.entry.pr}`); return; }
      if (!target && !plain.includes(where)) { problems.push(`${short} reverts ${revert.of.slice(0, 12)}, which is neither a boarding merge nor a bump`); return; }
      reverted.add(revert.of);
      onBoard.delete(revert.of);
      const clean = cleanRevertTree(cwd, revert.of, parents[0]);
      if (!clean) problems.push(`${short} is a revert Git cannot make cleanly: a hand-resolved revert is not allowed`);
      else if (clean !== git(cwd, ['rev-parse', `${commit}^{tree}`]).stdout) problems.push(`${short} differs from Git's own revert of ${revert.of.slice(0, 12)}: the revert was edited`);
      return;
    }
    plain.push(index);
    // A bump is made at the level of the members on board at that point.
    const reason = reproducesBump(cwd, manifest, commit, parents[0], trainLevel([...onBoard.values()]), main);
    if (reason) problems.push(`${short}: ${reason}`);
  });
  const last = commits.length - 1;
  for (const index of plain) {
    if (index !== last && !reverted.has(commits[index][0])) {
      problems.push(`${commits[index][0].slice(0, 12)} is a commit of its own inside the train: only member merges, recorded eject reverts and one last bump commit are allowed`);
    }
  }
  for (const member of manifest.members) {
    if (!seen.has(member.pr)) problems.push(`#${member.pr} at ${member.head.slice(0, 12)} is not on the train`);
  }
  for (const entry of left) {
    if (!reverted.has(entry.merge)) problems.push(`ejected #${entry.pr}: its boarding merge ${entry.merge.slice(0, 12)} is not reverted on the train`);
    for (const revert of entry.reverts) {
      if (!seenReverts.has(revert.commit)) problems.push(`ejected #${entry.pr}: recorded revert ${revert.commit.slice(0, 12)} is not on the train`);
    }
  }
  return { ok: problems.length === 0, head, main, members: manifest.members.map(member => member.pr), level, problems };
}

function body(manifest) {
  const members = manifest.members;
  const level = trainLevel(members);
  const tests = members.filter(member => /^UAT: OWNER_TEST_NEEDED\b/.test(member.uat.trim()));
  const uat = tests.length
    ? `UAT: OWNER_TEST_NEEDED (each member's own test after the merge: ${tests.map(member => `#${member.pr}`).join(', ')})`
    : `UAT: NOT_REQUIRED (no member needs an owner test: ${members.map(member => `#${member.pr}`).join(', ')})`;
  const lines = [
    '## Merge train',
    '',
    `Lands ${members.length} reviewed pull requests with one version bump and one CI run. Each member boarded at the exact head its review passed; the train adds only its own merge commits${level === 'none' ? '' : ' and one bump commit'}.`,
    '',
    '| Member | Reviewed head | Tier | Bump | Review |',
    '|---|---|---|---|---|',
    ...members.map(member => `| #${member.pr} | \`${member.head}\` | ${member.tier} | ${member.bump} | ${member.g2} |`),
    '',
    ...boardedThenEjected(manifest).flatMap(entry => [
      `Ejected: #${entry.pr} at \`${entry.head.slice(0, 12)}\` (${entry.reason || 'no reason recorded'}); its boarding is reverted by \`${entry.reverts.find(revert => revert.of === entry.merge).commit.slice(0, 12)}\`, so it does not land with this train.`,
      '',
    ]),
    `Tier: ${trainTier(members)}`,
    level === 'none' ? 'Bump: none' : `Bump: ${level}`,
    uat,
    '',
    // A Closes line would close its issue before the owner's test, which the issue-closure guard
    // refuses; on such a train it becomes Refs, and the member's own Closes line closes the issue
    // when the train lands, since GitHub treats the member as merged.
    ...members.flatMap(member => (member.links || []).map(line => line.trim()).map(line => (tests.length && !/^Refs /.test(line)
      ? `Refs ${line.replace(/^\S+ /, '')} (closed by #${member.pr}'s own closing line when the train lands)`
      : line))),
  ];
  while (lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

function split(manifest, prefix) {
  if (manifest.members.length < 2) throw new TrainError('a train of one member cannot split; that member is the culprit', 1);
  const half = Math.ceil(manifest.members.length / 2);
  const halves = [manifest.members.slice(0, half), manifest.members.slice(half)];
  const files = halves.map((members, index) => {
    const file = `${prefix}-${index === 0 ? 'a' : 'b'}.json`;
    fs.writeFileSync(file, `${JSON.stringify({ ...manifest, members, ejected: undefined }, null, 2)}\n`);
    return { file, members: members.map(member => member.pr) };
  });
  return { ok: true, halves: files };
}

function livePr(repository, number, liveFile) {
  if (liveFile) {
    const facts = JSON.parse(fs.readFileSync(liveFile, 'utf8'))[String(number)];
    if (!facts) throw new TrainError(`--live has no entry for #${number}`);
    return { state: facts.state, head: facts.head };
  }
  if (!repository) throw new TrainError('land needs "repository" in the manifest to read pull requests');
  // REST, not `gh pr view`: some hosts (cloud sessions among them) refuse GitHub's GraphQL API.
  const result = spawnSync('gh', ['api', `repos/${repository}/pulls/${number}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new TrainError(`could not read #${number}: ${result.error ? result.error.message : (result.stderr || '').trim()}`);
  const value = JSON.parse(result.stdout);
  return { state: value.merged ? 'MERGED' : String(value.state || '').toUpperCase(), head: value.head && value.head.sha };
}

function land(cwd, manifest, options) {
  if (!Number.isInteger(options.pr) || options.pr <= 0) throw new TrainError('--pr must be the train pull request number');
  if (!SHA.test(options.head || '')) throw new TrainError('--head must be the train pull request head as a full SHA');
  const checked = verify(cwd, manifest, options);
  const problems = [...checked.problems];
  if (!isAncestor(cwd, checked.main, checked.head)) problems.push('main moved since the train was built: rebuild it on main and rerun CI');
  const train = livePr(manifest.repository, options.pr, options.live);
  if (train.state !== 'OPEN') problems.push(`the train pull request #${options.pr} is ${train.state}`);
  if (train.head !== options.head) problems.push(`the train pull request head is ${String(train.head).slice(0, 12)}, not ${options.head.slice(0, 12)}`);
  for (const member of manifest.members) {
    const facts = livePr(manifest.repository, member.pr, options.live);
    if (facts.state !== 'OPEN') problems.push(`#${member.pr} is ${facts.state}`);
    if (facts.head !== member.head) problems.push(`#${member.pr} moved to ${String(facts.head).slice(0, 12)} after boarding: eject it until its review passes the new head`);
    if (member.tier === 'RISKY' && !member.owner_ok) problems.push(`#${member.pr} is RISKY and has no owner merge OK recorded`);
  }
  // An ejected member's commits stay in the train, reverted: GitHub marks its pull request merged
  // when the train lands if its head is still the one that boarded.
  for (const entry of boardedThenEjected(manifest)) {
    const facts = livePr(manifest.repository, entry.pr, options.live);
    if (facts.state === 'OPEN' && facts.head === entry.head) {
      problems.push(`ejected #${entry.pr} is still open at ${entry.head.slice(0, 12)}, which the train carries: GitHub would mark it merged; push its next commit or close it first`);
    }
  }
  return {
    ok: problems.length === 0,
    pr: options.pr,
    head: options.head,
    members: checked.members,
    problems,
    merge: problems.length ? null : { repository: manifest.repository || '', pr: options.pr, head: options.head, method: 'merge commit' },
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new TrainError(`usage: toolkit-merge-train.cjs <${COMMANDS.join('|')}> --manifest <file> ...`);
  const options = { command, main: 'origin/main', json: false };
  const takes = new Set(['--manifest', '--branch', '--main', '--onto', '--out', '--head', '--out-prefix', '--pr', '--live', '--reason']);
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') { options.json = true; continue; }
    if (!takes.has(arg) || index + 1 >= rest.length) throw new TrainError(`unknown or incomplete argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = rest[++index];
  }
  if (!options.manifest) throw new TrainError('--manifest is required');
  if (options.pr !== undefined) options.pr = /^\d+$/.test(options.pr) ? Number(options.pr) : -1;
  return options;
}

function run(argv, cwd = process.cwd()) {
  const options = parseArgs(argv);
  const manifest = readManifest(options.manifest);
  if (options.command === 'build') return build(cwd, manifest, options);
  if (options.command === 'verify') return verify(cwd, manifest, options);
  if (options.command === 'body') return { ok: true, body: body(manifest) };
  if (options.command === 'split') {
    if (!options.outPrefix) throw new TrainError('--out-prefix is required');
    return split(manifest, options.outPrefix);
  }
  if (options.command === 'eject') return eject(cwd, manifest, options);
  return land(cwd, manifest, options);
}

function print(result, json) {
  if (json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
  if (result.body) { process.stdout.write(result.body); return; }
  const lines = [result.ok ? 'OK' : 'REFUSED'];
  for (const [key, value] of Object.entries(result)) {
    if (key === 'ok' || key === 'problems' || value === undefined) continue;
    lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
  for (const problem of result.problems || []) lines.push(`- ${problem}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) {
  const json = process.argv.includes('--json');
  try {
    const result = run(process.argv.slice(2));
    print(result, json);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const code = error instanceof TrainError ? error.code : 2;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    else process.stderr.write(`toolkit-merge-train: ${error.message}\n`);
    process.exitCode = code;
  }
}

module.exports = { TOOLKIT_BUMP, TrainError, body, build, checkManifest, eject, land, run, split, trainLevel, trainTier, verify };
