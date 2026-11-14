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
//   node repo/scripts/toolkit-merge-train.cjs catchup --manifest <file> [--main <ref>] [--json]
//   node repo/scripts/toolkit-merge-train.cjs verify --manifest <file> --head <ref> [--main <ref>] [--json]
//   node repo/scripts/toolkit-merge-train.cjs body   --manifest <file> [--json]
//   node repo/scripts/toolkit-merge-train.cjs split  --manifest <file> --out-prefix <path> [--json]
//   node repo/scripts/toolkit-merge-train.cjs land   --manifest <file> --pr <train PR> --head <sha> [--main <ref>] [--live <file>] [--json]
//
// The manifest (JSON) lists the members in the order they board:
//   { "repository": "owner/name",
//     "bump_command": "node repo/scripts/bump-version.cjs --next {level} --base {base}",   (optional)
//     "members": [ { "pr": 12, "head": "<40-hex SHA the review passed>", "g2": "<report link>",
//                    "tier": "LIGHT|NORMAL|RISKY", "bump": "patch|minor|major|none",
//                    "uat": "UAT: NOT_REQUIRED (...)", "links": ["Closes #34"],
//                    "owner_ok": "<link to the owner's typed merge OK; RISKY members only>",
//                    "pack_changes": ["<row id>: <why>", ...]   (optional: the member's own "Pack changes" lines) } ] }
// build takes at most six members; body copies every member's pack_changes under one "## Pack changes".
// With no bump_command, a repository holding repo/scripts/bump-version.cjs uses the line above and
// any other repository takes no bump commit; "none" turns the bump off. The command runs without a
// shell, with {level} as the highest member level and {base} as the main commit.
//
// build runs in a clean checkout of its own (a worktree) and refuses a --branch checked out in any
// other worktree. It resets --branch to --onto (default
// --main, default origin/main), merges each member head, ejects one that conflicts or is already on
// main, then runs the bump command and commits the result. --onto another train's head combines new
// members while that train waits on CI: such a stacked train takes no bump and cannot land until
// the earlier train has merged. Then catchup, run in a clean checkout of the stacked train, merges
// main in as one merge commit (no rebuild and no force-push) and adds the one bump; a main that does
// not merge cleanly is refused, never hand-fixed. --out writes the boarded manifest, with the
// ejected members and their reasons under "ejected", for catchup, verify, body and land.
//
// verify walks the train's first-parent commits after main and refuses anything that is not a
// member merge or a main catch-up merge whose tree equals Git's own clean merge, or a last bump
// commit whose tree equals a fresh run of the bump command. Every member must board exactly once.
// It also lists every file two or more members change ("overlap") and the review the train needs:
// none when there is no overlap, else a delta review of the shared files.
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
// A train holds at most this many members; the next ready PRs board the next train.
const MAX_MEMBERS = 6;
const COMMANDS = Object.freeze(['build', 'catchup', 'verify', 'body', 'split', 'land']);

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
    if (member.pack_changes !== undefined && (!Array.isArray(member.pack_changes) || !member.pack_changes.every(line => typeof line === 'string' && line.trim() && !line.includes('\n')))) {
      throw new TrainError(`${where}: "pack_changes" must be the member's own "Pack changes" lines, one string each`);
    }
    if (member.owner_ok !== undefined && (typeof member.owner_ok !== 'string' || !member.owner_ok.trim())) {
      throw new TrainError(`${where}: "owner_ok" must link the owner's typed merge OK`);
    }
  }
  return value;
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
  if (manifest.members.length > MAX_MEMBERS) {
    throw new TrainError(`a train holds at most ${MAX_MEMBERS} members; board the rest on the next train`, 1);
  }
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

function catchup(cwd, manifest, options) {
  if (git(cwd, ['status', '--porcelain']).stdout) throw new TrainError('catchup needs a clean checkout of the train; use its own worktree');
  const main = resolve(cwd, options.main, '--main');
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
  const missing = manifest.members.filter(member => !isAncestor(cwd, member.head, 'HEAD')).map(member => `#${member.pr}`);
  if (missing.length) throw new TrainError(`the checkout is not this train: ${missing.join(', ')} not on ${branch}`, 1);
  if (isAncestor(cwd, main, 'HEAD')) throw new TrainError('main is already inside the train; nothing to catch up', 1);
  if (git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.split(/\s+/).length !== 3) {
    throw new TrainError('the train already carries its bump: only a stacked train (built with --onto) catches up; rebuild this one on main', 1);
  }
  const before = git(cwd, ['rev-parse', 'HEAD']).stdout;
  const merged = git(cwd, ['-c', 'rerere.enabled=false', 'merge', '--no-ff', '--no-edit', '-m', `Merge train: catch up with main at ${main.slice(0, 12)}`, main], { allowFail: true });
  if (merged.status !== 0) {
    git(cwd, ['merge', '--abort'], { allowFail: true });
    return { ok: false, branch, head: git(cwd, ['rev-parse', 'HEAD']).stdout, main, problems: ['main does not merge cleanly into the train: eject the clashing member (split or rebuild without it), never hand-fix'] };
  }
  const level = trainLevel(manifest.members);
  let bump = null;
  const argv = bumpArgv(cwd, manifest, level, main);
  if (argv) {
    try {
      runBump(cwd, argv);
    } catch (error) {
      // Undo the local catch-up merge too, so the train is left exactly as it was: a catch-up
      // merge with no bump after it would not verify. Nothing here was pushed yet.
      git(cwd, ['reset', '--quiet', '--hard', before], { allowFail: true });
      git(cwd, ['clean', '--quiet', '-fd'], { allowFail: true });
      return { ok: false, branch, head: git(cwd, ['rev-parse', 'HEAD']).stdout, main, level, problems: [error.message] };
    }
    git(cwd, ['add', '--all']);
    if (git(cwd, ['diff', '--cached', '--quiet'], { allowFail: true }).status !== 0) {
      git(cwd, ['commit', '--quiet', '--no-verify', '-m', `Merge train: bump ${level} for ${manifest.members.map(member => `#${member.pr}`).join(', ')}`]);
      bump = git(cwd, ['rev-parse', 'HEAD']).stdout;
    }
  }
  return { ok: true, branch, head: git(cwd, ['rev-parse', 'HEAD']).stdout, main, level, bump };
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
  const seen = new Map();
  const listed = git(cwd, ['rev-list', '--first-parent', '--reverse', '--parents', `${main}..${head}`]).stdout;
  const commits = listed ? listed.split('\n').map(line => line.trim().split(/\s+/)) : [];
  if (!commits.length) problems.push('the train holds nothing that main does not');
  const level = trainLevel(manifest.members);
  commits.forEach(([commit, ...parents], index) => {
    const short = commit.slice(0, 12);
    if (parents.length === 2) {
      const [first, second] = parents;
      const member = byHead.get(second);
      if (!member && !isAncestor(cwd, second, main)) {
        problems.push(`${short} merges ${second.slice(0, 12)}, which is neither a member's reviewed head nor main`);
        return;
      }
      if (member) {
        if (seen.has(member.pr)) problems.push(`#${member.pr} boards twice`);
        seen.set(member.pr, commit);
      }
      const clean = cleanMergeTree(cwd, first, second);
      if (!clean) problems.push(`${short} is a merge Git cannot make cleanly: a hand-resolved conflict is not allowed`);
      else if (clean !== git(cwd, ['rev-parse', `${commit}^{tree}`]).stdout) problems.push(`${short} differs from Git's own clean merge: the merge was edited`);
      return;
    }
    if (parents.length > 2) { problems.push(`${short} merges more than two commits at once`); return; }
    if (index !== commits.length - 1) { problems.push(`${short} is a commit of its own inside the train: only member merges and one last bump commit are allowed`); return; }
    const reason = reproducesBump(cwd, manifest, commit, parents[0], level, main);
    if (reason) problems.push(`${short}: ${reason}`);
  });
  for (const member of manifest.members) {
    if (!seen.has(member.pr)) problems.push(`#${member.pr} at ${member.head.slice(0, 12)} is not on the train`);
  }
  const last = commits[commits.length - 1];
  if (last && last.length === 3 && bumpArgv(cwd, manifest, level, main)) {
    problems.push('the train has no bump commit: build it on main, or run catchup on a stacked train, before verify');
  }
  const overlap = memberOverlap(cwd, manifest.members, main);
  const review = overlap.length ? 'delta review of the shared files' : 'none: verify and green CI suffice';
  return { ok: problems.length === 0, head, main, members: manifest.members.map(member => member.pr), level, overlap, review, problems };
}

// Files that two or more members change, each counted from where that member left main. A train
// with none needs no review of its own once verify passes and CI is green; shared files get a
// short delta review, because each member's review saw only its own change to them.
function memberOverlap(cwd, members, main) {
  const owners = new Map();
  for (const member of members) {
    const base = git(cwd, ['merge-base', main, member.head]).stdout;
    const listed = git(cwd, ['diff', '--name-only', '-z', '--no-renames', base, member.head]).stdout;
    for (const file of listed.split('\0').filter(Boolean)) owners.set(file, [...(owners.get(file) || []), member.pr]);
  }
  return [...owners].filter(([, prs]) => prs.length > 1).map(([file, prs]) => ({ file, members: prs })).sort((a, b) => a.file.localeCompare(b.file));
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
    `Tier: ${trainTier(members)}`,
    level === 'none' ? 'Bump: none' : `Bump: ${level}`,
    uat,
    '',
    // A Closes line would close its issue before the owner's test, which the issue-closure guard
    // refuses; on such a train it becomes Refs, and the member's own Closes line closes the issue
    // when the train lands, since GitHub treats the member as merged.
    // Each link line names its member and that member's own UAT state, so the issue-closure guard
    // and a reader can tell which member answers for the issue.
    ...members.flatMap(member => {
      const note = `member #${member.pr}, UAT: ${UAT_LINE.exec(member.uat.trim())[1]}`;
      return (member.links || []).map(line => line.trim()).map(line => (tests.length && !/^Refs /.test(line)
        ? `Refs ${line.replace(/^\S+ /, '')} (${note}; closed by #${member.pr}'s own closing line when the train lands)`
        : `${line} (${note})`));
    }),
  ];
  // Hook-pack rows a member changed stay explained on the train, or the pack check fails it.
  const pack = members.flatMap(member => (member.pack_changes || []).map(line => line.trim()));
  if (pack.length) lines.push('', '## Pack changes', '', ...pack);
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
  const takes = new Set(['--manifest', '--branch', '--main', '--onto', '--out', '--head', '--out-prefix', '--pr', '--live']);
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
  if (options.command === 'catchup') return catchup(cwd, manifest, options);
  if (options.command === 'verify') return verify(cwd, manifest, options);
  if (options.command === 'body') return { ok: true, body: body(manifest) };
  if (options.command === 'split') {
    if (!options.outPrefix) throw new TrainError('--out-prefix is required');
    return split(manifest, options.outPrefix);
  }
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

module.exports = { MAX_MEMBERS, TOOLKIT_BUMP, TrainError, body, build, catchup, checkManifest, land, run, split, trainLevel, trainTier, verify };
