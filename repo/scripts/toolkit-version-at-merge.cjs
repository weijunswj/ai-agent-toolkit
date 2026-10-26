'use strict';

// Version at merge time: an open branch keeps its base's Toolkit version and writes its notes in its
// own changelog fragment (repo/docs/changelog.d/<branch>.md); bump-version.cjs --next sets the next
// version at merge time. This module holds the shared reading rules and the CI guard
// (validate-toolkit.cjs), which accepts a branch that holds its base's version, or one that sets
// exactly the next patch or minor version with its notes folded under that heading.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SEMVER, VERSION_REL_PATH, readToolkitVersion } = require('./toolkit-version.cjs');

const CHANGELOG_REL_PATH = 'repo/docs/CHANGELOG.md';
const FRAGMENT_DIR_REL_PATH = 'repo/docs/changelog.d';
const PROJECTS_SKILL_DIR_REL_PATH = 'repo/contracts/claude-projects/web-controller-projects';
const PROJECTS_SKILL_REL_PATH = `${PROJECTS_SKILL_DIR_REL_PATH}/SKILL.md`;
const LEVELS = Object.freeze(['patch', 'minor']);

function nextVersion(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  return level === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

function git(workspace, args) {
  return spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
}

// The version a commit records, or '' when the commit has no readable version.json.
function versionAt(workspace, commit) {
  const shown = git(workspace, ['show', `${commit}:${VERSION_REL_PATH}`]);
  if (shown.status !== 0) return '';
  try {
    const version = JSON.parse(shown.stdout).version;
    return SEMVER.test(version || '') ? version : '';
  } catch {
    return '';
  }
}

// The version in the first "## " heading of a CHANGELOG text, or '' when there is none.
function topChangelogVersion(text) {
  const heading = /^## (\d+\.\d+\.\d+)(?:\s.*)?$/m.exec(String(text || '').replace(/\r\n/g, '\n'));
  return heading ? heading[1] : '';
}

const UNRELEASED_HEADING = '## Unreleased';

// Every "## " heading line of a CHANGELOG text, in order.
function changelogHeadings(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n').filter((line) => line.startsWith('## ')).map((line) => line.trimEnd());
}

// The CHANGELOG as a commit records it, or null when the commit has none.
function changelogAt(workspace, commit) {
  const shown = git(workspace, ['show', `${commit}:${CHANGELOG_REL_PATH}`]);
  return shown.status === 0 ? shown.stdout : null;
}

// An open branch's CHANGELOG headings are the base's, with at most one "## Unreleased" section on
// top (the older way to hold notes, folded at merge like a fragment). Returns the problem, or ''.
function heldHeadingsProblem(head, base) {
  const extra = head[0] === UNRELEASED_HEADING ? head.slice(1) : head;
  if (JSON.stringify(extra) === JSON.stringify(base)) return '';
  const added = extra.filter((heading) => !base.includes(heading));
  const detail = added.length ? `it adds ${added.map((heading) => `"${heading}"`).join(', ')}` : 'its headings are not in the base\'s order';
  return `the CHANGELOG headings differ from the base's (${detail}); keep this branch's notes in a fragment in ${FRAGMENT_DIR_REL_PATH}/ (or one "${UNRELEASED_HEADING}" section on top) and leave the version headings to bump-version.cjs --next`;
}

// The "## Unreleased" section on top of a CHANGELOG, taken out: its notes and the text without it.
function takeUnreleased(text) {
  const lf = String(text || '').replace(/\r\n/g, '\n');
  const start = lf.search(/^## Unreleased[ \t]*$/m);
  if (start === -1 || start !== lf.search(/^## /m)) return { notes: '', text: lf };
  const rest = lf.slice(start).replace(/^[^\n]*\n?/, '');
  const next = rest.search(/^## /m);
  const notes = (next === -1 ? rest : rest.slice(0, next)).trim();
  return { notes, text: lf.slice(0, start) + (next === -1 ? '' : rest.slice(next)) };
}

function fragmentFiles(workspace) {
  const dir = path.join(workspace, ...FRAGMENT_DIR_REL_PATH.split('/'));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md').sort()
    .map((name) => `${FRAGMENT_DIR_REL_PATH}/${name}`);
}

// A fragment holds "### Section" headings and bullets, as a CHANGELOG version entry does, with an
// optional first line "Title: <words>" for the version heading. Returns its problems, if any.
function fragmentProblems(rel, text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const problems = [];
  if (/^Title:/.test(lines[0] || '') && !/^Title:\s*\S/.test(lines[0])) problems.push(`${rel} has an empty Title: line`);
  const body = /^Title:/.test(lines[0] || '') ? lines.slice(1) : lines;
  if (body.some((line) => /^Title:/.test(line))) problems.push(`${rel} has a Title: line that is not its first line`);
  if (body.some((line) => /^#{1,2} /.test(line))) problems.push(`${rel} must use "###" section headings only; the version heading is added at merge`);
  const first = body.findIndex((line) => line.startsWith('### '));
  if (first === -1) problems.push(`${rel} has no "###" section heading`);
  else if (body.slice(0, first).some((line) => line.trim())) problems.push(`${rel} has text before its first "###" section heading`);
  return problems;
}

function parseFragment(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const title = /^Title:\s*(.*\S)\s*$/.exec(lines[0] || '');
  return { title: title ? title[1] : '', body: (title ? lines.slice(1) : lines).join('\n').trim() };
}

function foldFragments(changelog, version, fragments) {
  const text = changelog.replace(/\r\n/g, '\n');
  const titles = fragments.map((fragment) => fragment.title).filter(Boolean);
  const heading = `## ${version}${titles.length ? ` (${titles.join('; ')})` : ''}`;
  const entry = [heading, ...fragments.map((fragment) => fragment.body)].join('\n\n');
  const first = text.search(/^## /m);
  if (first === -1) return `${text.trimEnd()}\n\n${entry}\n`;
  return `${text.slice(0, first)}${entry}\n\n${text.slice(first)}`;
}

// Versions look like 2026-10-23.6: the date, then a counter for that day. The next one is today's
// date with counter 1, or the next counter when the base already used today (or a later date).
function nextSkillVersion(baseVersion, today) {
  const match = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(baseVersion || '');
  if (!match || today > match[1]) return `${today}.1`;
  return `${match[1]}.${Number(match[2]) + 1}`;
}

function compareSkillVersions(left, right) {
  const [leftDate, leftCount] = left.split('.');
  const [rightDate, rightCount] = right.split('.');
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
  return Math.sign(Number(leftCount) - Number(rightCount));
}

function skillVersionOf(text) {
  return /^Version: (\d{4}-\d{2}-\d{2}\.\d+)\s*$/m.exec(String(text || ''))?.[1] || '';
}

// The CI guard. Without a base (a local run) only the fragments are checked; a base that does not
// resolve is a problem, never a skip.
function versionProblems({ workspace, base }) {
  const problems = [];
  for (const rel of fragmentFiles(workspace)) {
    problems.push(...fragmentProblems(rel, fs.readFileSync(path.join(workspace, ...rel.split('/')), 'utf8')));
  }
  if (!base) return problems;
  const baseVersion = versionAt(workspace, base);
  const baseChangelog = changelogAt(workspace, base);
  if (!baseVersion || baseChangelog === null) {
    problems.push(`the base ${base} has no readable ${VERSION_REL_PATH} or ${CHANGELOG_REL_PATH}, so the version cannot be checked; fetch full history`);
    return problems;
  }
  const shownSkill = git(workspace, ['show', `${base}:${PROJECTS_SKILL_REL_PATH}`]);
  const skillPath = path.join(workspace, ...PROJECTS_SKILL_REL_PATH.split('/'));
  const baseSkill = shownSkill.status === 0 ? skillVersionOf(shownSkill.stdout) : '';
  const headSkill = fs.existsSync(skillPath) ? skillVersionOf(fs.readFileSync(skillPath, 'utf8')) : '';
  if (baseSkill && headSkill && compareSkillVersions(headSkill, baseSkill) < 0) {
    problems.push(`the Projects skill Version ${headSkill} is older than the base's ${baseSkill}; keep the base's until merge time`);
  }
  const current = readToolkitVersion(path.join(workspace, ...VERSION_REL_PATH.split('/')));
  const headHeadings = changelogHeadings(fs.readFileSync(path.join(workspace, ...CHANGELOG_REL_PATH.split('/')), 'utf8'));
  const baseHeadings = changelogHeadings(baseChangelog);
  if (current === baseVersion) {
    const problem = heldHeadingsProblem(headHeadings, baseHeadings);
    if (problem) problems.push(problem);
    return problems;
  }
  const allowed = LEVELS.map((level) => nextVersion(baseVersion, level));
  if (!allowed.includes(current)) {
    problems.push(`version ${current} is not the next version after the base's ${baseVersion} (${allowed.join(' or ')}); keep ${baseVersion} until merge time, then run bump-version.cjs --next`);
    return problems;
  }
  if (topChangelogVersion(headHeadings[0] || '') !== current) {
    problems.push(`version ${current} needs its CHANGELOG heading first, found ${headHeadings[0] ? `"${headHeadings[0]}"` : 'none'}`);
  } else if (JSON.stringify(headHeadings.slice(1)) !== JSON.stringify(baseHeadings)) {
    problems.push(`below the ${current} heading the CHANGELOG headings must be the base's exactly; ${heldHeadingsProblem(headHeadings.slice(1), baseHeadings).replace(/^the CHANGELOG headings differ from the base's /, '')}`);
  }
  const left = fragmentFiles(workspace);
  if (left.length) problems.push(`version ${current} is set but ${left.join(', ')} is not folded into the CHANGELOG`);
  return problems;
}

module.exports = {
  CHANGELOG_REL_PATH, FRAGMENT_DIR_REL_PATH, LEVELS, PROJECTS_SKILL_DIR_REL_PATH, PROJECTS_SKILL_REL_PATH, UNRELEASED_HEADING,
  changelogAt, changelogHeadings, foldFragments, fragmentFiles, fragmentProblems, git, heldHeadingsProblem,
  nextSkillVersion, nextVersion, parseFragment, skillVersionOf, takeUnreleased, topChangelogVersion, versionAt,
  versionProblems,
};
