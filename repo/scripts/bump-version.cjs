#!/usr/bin/env node
'use strict';

// Sets the Toolkit version in one step: writes version.json (the one version source) and the four
// plugin manifests hosts read, then refreshes the generated surfaces that carry the version
// (managed-block markers, the README contract block and the published-surface baseline).
// A PR prepares its own bump from main and folds its changelog fragments. When main
// moves, toolkit-rebump-prs.cjs preserves that bump level and reapplies it above main.
// Usage: node repo/scripts/bump-version.cjs <x.y.z> [--workspace <repo root>]
//        node repo/scripts/bump-version.cjs --next patch|minor|major [--base <ref>] [--workspace <repo root>]

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SEMVER, VERSION_REL_PATH, readToolkitVersion } = require('./toolkit-version.cjs');
const {
  CHANGELOG_REL_PATH, FRAGMENT_DIR_REL_PATH, LEVELS, PROJECTS_SKILL_DIR_REL_PATH, PROJECTS_SKILL_REL_PATH, UNRELEASED_HEADING,
  changelogAt, changelogHeadings, droppedUnreleasedProblem, foldFragments, fragmentFiles, fragmentProblems, git, heldHeadingsProblem,
  nextSkillVersion, nextVersion, parseFragment, skillVersionOf, takeUnreleased, topChangelogVersion, unreleasedProblems, versionAt,
} = require('./toolkit-version-at-merge.cjs');

// Hosts read these literal versions, so they stay literal and the validator checks them against version.json.
const MANIFEST_REL_PATHS = Object.freeze([
  'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json',
  'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
]);
const REFRESH_COMMANDS = Object.freeze([
  ['repo/scripts/sync-agent-instruction-shims.cjs', '--write'],
  ['repo/scripts/sync-repo-doc-contract.cjs', '--write'],
  ['repo/scripts/audit-published-surfaces.cjs', '--write-baseline'],
]);
const USAGE = 'usage: node repo/scripts/bump-version.cjs <x.y.z> [--workspace <repo root>], or --next patch|minor|major [--base <ref>]';

function parseArgs(argv) {
  const args = { version: '', next: '', base: 'origin/main', workspace: path.resolve(__dirname, '..', '..') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') args.workspace = path.resolve(argv[++index] || '');
    else if (arg.startsWith('--workspace=')) args.workspace = path.resolve(arg.slice('--workspace='.length));
    else if (arg === '--next') args.next = argv[++index] || '';
    else if (arg.startsWith('--next=')) args.next = arg.slice('--next='.length);
    else if (arg === '--base') args.base = argv[++index] || '';
    else if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    else if (!args.version && !arg.startsWith('-')) args.version = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.next) {
    if (args.version) throw new Error(`give a version or --next, not both; ${USAGE}`);
    if (!LEVELS.includes(args.next)) throw new Error(`--next takes patch, minor or major; ${USAGE}`);
    if (!args.base) throw new Error(`--base needs a ref; ${USAGE}`);
  } else if (!SEMVER.test(args.version)) throw new Error(USAGE);
  return args;
}

function setJsonVersion(file, version) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof value.version !== 'string') throw new Error(`${file} has no version field`);
  value.version = version;
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, workspace) {
  const files = [VERSION_REL_PATH, ...MANIFEST_REL_PATHS];
  for (const rel of files) setJsonVersion(path.join(workspace, ...rel.split('/')), version);
  for (const [script, ...args] of REFRESH_COMMANDS) {
    const result = spawnSync(process.execPath, [path.join(workspace, ...script.split('/')), ...args, '--workspace', workspace], {
      cwd: workspace, encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`${script} ${args.join(' ')} failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
    }
  }
  const written = readToolkitVersion(path.join(workspace, ...VERSION_REL_PATH.split('/')));
  if (written !== version) throw new Error(`${VERSION_REL_PATH} reads ${written} after the bump, expected ${version}`);
  return { version, files, refreshed: REFRESH_COMMANDS.map(([script]) => script) };
}

function bumpNext({ level, base, workspace, today = new Date().toISOString().slice(0, 10) }) {
  const baseCommit = git(workspace, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (baseCommit.status !== 0) throw new Error(`${base} is not a commit here; fetch it first (git fetch origin main)`);
  const baseSha = baseCommit.stdout.trim();
  if (git(workspace, ['merge-base', '--is-ancestor', baseSha, 'HEAD']).status !== 0) {
    throw new Error(`this branch does not contain ${base} yet; merge it in first so the version is the next free one`);
  }
  const dirty = git(workspace, ['status', '--porcelain']);
  if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('the working tree has uncommitted changes; commit or stash them first');

  const baseVersion = versionAt(workspace, baseSha);
  if (!baseVersion) throw new Error(`${base} has no readable ${VERSION_REL_PATH}`);
  const current = readToolkitVersion(path.join(workspace, ...VERSION_REL_PATH.split('/')));
  const changelogFile = path.join(workspace, ...CHANGELOG_REL_PATH.split('/'));
  const changelog = fs.readFileSync(changelogFile, 'utf8');
  if (current !== baseVersion) {
    if (LEVELS.some((next) => nextVersion(baseVersion, next) === current) && topChangelogVersion(changelog) === current) {
      throw new Error(`this branch is already bumped to ${current}; if ${base} moved since, run toolkit-rebump-prs.cjs to report and reconcile the open PR`);
    }
    throw new Error(`this branch sets ${current} but ${base} is at ${baseVersion}; take ${base}'s version lines and run --next again`);
  }
  const baseChangelog = changelogAt(workspace, baseSha);
  if (baseChangelog === null) throw new Error(`${base} has no readable ${CHANGELOG_REL_PATH}`);
  const headingProblem = heldHeadingsProblem(changelogHeadings(changelog), changelogHeadings(baseChangelog));
  if (headingProblem) throw new Error(headingProblem);
  const droppedProblem = droppedUnreleasedProblem(changelog, baseChangelog, false);
  if (droppedProblem) throw new Error(droppedProblem);
  const unreleased = takeUnreleased(changelog);
  const fragmentRels = fragmentFiles(workspace);
  if (!fragmentRels.length && !unreleased.notes) {
    throw new Error(`no changelog fragment in ${FRAGMENT_DIR_REL_PATH}/ and no "${UNRELEASED_HEADING}" notes; write this branch's notes in a fragment first`);
  }
  const texts = fragmentRels.map((rel) => fs.readFileSync(path.join(workspace, ...rel.split('/')), 'utf8'));
  const problems = fragmentRels.flatMap((rel, index) => fragmentProblems(rel, texts[index]));
  if (unreleased.notes) problems.push(...unreleasedProblems(unreleased.notes));
  if (problems.length) throw new Error(problems.join('; '));

  const version = nextVersion(baseVersion, level);
  if (changelogHeadings(changelog).some((heading) => topChangelogVersion(heading) === version)) {
    throw new Error(`the CHANGELOG already has a ${version} heading`);
  }

  let skillVersion = '';
  const skillChanged = git(workspace, ['diff', '--quiet', baseSha, 'HEAD', '--', PROJECTS_SKILL_DIR_REL_PATH]).status === 1;
  if (skillChanged) {
    const skillFile = path.join(workspace, ...PROJECTS_SKILL_REL_PATH.split('/'));
    const skillText = fs.readFileSync(skillFile, 'utf8');
    const shownSkill = git(workspace, ['show', `${baseSha}:${PROJECTS_SKILL_REL_PATH}`]);
    skillVersion = nextSkillVersion(skillVersionOf(shownSkill.status === 0 ? shownSkill.stdout : ''), today);
    if (!skillVersionOf(skillText)) throw new Error(`${PROJECTS_SKILL_REL_PATH} has no Version line`);
    fs.writeFileSync(skillFile, skillText.replace(/^Version: \d{4}-\d{2}-\d{2}\.\d+(\s*)$/m, `Version: ${skillVersion}$1`));
  }

  const notes = [...texts.map(parseFragment), ...(unreleased.notes ? [{ title: unreleased.title, body: unreleased.notes }] : [])];
  fs.writeFileSync(changelogFile, foldFragments(unreleased.text, version, notes));
  for (const rel of fragmentRels) fs.rmSync(path.join(workspace, ...rel.split('/')));
  const result = bumpVersion(version, workspace);
  return { ...result, baseSha, baseVersion, folded: [...fragmentRels, ...(unreleased.notes ? [`the "${UNRELEASED_HEADING}" section`] : [])], skillVersion };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.next) {
      const result = bumpNext({ level: args.next, base: args.base, workspace: args.workspace });
      console.log(`Toolkit version is now ${result.version} (${args.base} at ${result.baseSha} was ${result.baseVersion}). Wrote ${result.files.join(', ')}; refreshed ${result.refreshed.join(', ')}.`);
      console.log(`Folded ${result.folded.join(', ')} into ${CHANGELOG_REL_PATH}.${result.skillVersion ? ` Projects skill Version is now ${result.skillVersion}.` : ''}`);
      console.log('Review the diff, commit it as the last commit, push and wait for green CI before the merge.');
      return;
    }
    const result = bumpVersion(args.version, args.workspace);
    console.log(`Toolkit version is now ${result.version}. Wrote ${result.files.join(', ')}; refreshed ${result.refreshed.join(', ')}.`);
    console.log('Add the CHANGELOG entry for this version yourself.');
  } catch (error) {
    console.error(`bump-version: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { MANIFEST_REL_PATHS, REFRESH_COMMANDS, bumpNext, bumpVersion, parseArgs };
