'use strict';

// Shared PR release rules and the CI guard. A PR carries its own next patch, minor
// or major version and folded notes. A branch without a bump may retain the base's
// version. toolkit-rebump-prs.cjs reconciles bumped PRs after main moves.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SEMVER, VERSION_REL_PATH, readToolkitVersion } = require('./toolkit-version.cjs');

const CHANGELOG_REL_PATH = 'repo/docs/CHANGELOG.md';
const FRAGMENT_DIR_REL_PATH = 'repo/docs/changelog.d';
const PROJECTS_SKILL_DIR_REL_PATH = 'repo/contracts/claude-projects/web-controller-projects';
const PROJECTS_SKILL_REL_PATH = `${PROJECTS_SKILL_DIR_REL_PATH}/SKILL.md`;
const LEVELS = Object.freeze(['patch', 'minor', 'major']);

function nextVersion(version, level) {
  if (!SEMVER.test(version) || !LEVELS.includes(level)) throw new Error('expected a semver version and patch, minor or major');
  const [major, minor, patch] = version.split('.').map(Number);
  return level === 'major' ? `${major + 1}.0.0` : level === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
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

// A "## " heading as GitHub shows it: up to three spaces before "##", then a space or a tab.
// Returns the heading in one form ("## <words>") or '' for any other line.
function headingOf(line) {
  const match = /^ {0,3}##(?:[ \t]+(.*?))?[ \t]*$/.exec(String(line).replace(/\r$/, ''));
  return match ? `## ${(match[1] || '').replace(/[ \t]+#*$/, '').trim()}`.trimEnd() : '';
}

// Every "## " heading of a CHANGELOG text, in order, in one form.
function changelogHeadings(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n').map(headingOf).filter(Boolean);
}

// The version in the first "## " heading of a CHANGELOG text (or of one heading line), or '' when it has none.
function topChangelogVersion(text) {
  const heading = /^## (\d+\.\d+\.\d+)(?:\s.*)?$/.exec(changelogHeadings(text)[0] || '');
  return heading ? heading[1] : '';
}

const UNRELEASED_HEADING = '## Unreleased';
// "## Unreleased", or "## Unreleased (<words>)" whose words join the version heading's title.
const UNRELEASED = /^## Unreleased(?: \((.*\S)\))?$/;

const withoutUnreleased = (headings) => (UNRELEASED.test(headings[0] || '') ? headings.slice(1) : headings);

// The CHANGELOG as a commit records it, or null when the commit has none.
function changelogAt(workspace, commit) {
  const shown = git(workspace, ['show', `${commit}:${CHANGELOG_REL_PATH}`]);
  return shown.status === 0 ? shown.stdout : null;
}

// What differs between two heading lists, named: headings added, dropped or repeated.
function headingDifference(head, base) {
  const count = (list) => list.reduce((map, heading) => map.set(heading, (map.get(heading) || 0) + 1), new Map());
  const [have, want] = [count(head), count(base)];
  const named = (list) => list.map((heading) => `"${heading}"`).join(', ');
  const added = [...have].filter(([heading]) => !want.has(heading)).map(([heading]) => heading);
  const dropped = [...want].filter(([heading]) => !have.has(heading)).map(([heading]) => heading);
  const repeated = [...have].filter(([heading, n]) => want.has(heading) && n > want.get(heading)).map(([heading]) => heading);
  const missing = [...want].filter(([heading, n]) => have.has(heading) && n > have.get(heading)).map(([heading]) => heading);
  const parts = [];
  if (added.length) parts.push(`it adds ${named(added)}`);
  if (repeated.length) parts.push(`it repeats ${named(repeated)}`);
  if (dropped.length || missing.length) parts.push(`it drops ${named([...dropped, ...missing])}`);
  return parts.join('; ') || 'its headings are in a different order from the base\'s';
}

// An open branch's CHANGELOG headings are the base's, with at most one "## Unreleased" section on
// top (the older way to hold notes, folded at merge like a fragment); a base that already carries
// one counts the same. Returns the problem, or ''.
function heldHeadingsProblem(head, base) {
  const [mine, theirs] = [withoutUnreleased(head), withoutUnreleased(base)];
  if (JSON.stringify(mine) === JSON.stringify(theirs)) return '';
  return `the CHANGELOG headings differ from the base's (${headingDifference(mine, theirs)}); keep this branch's notes in a fragment in ${FRAGMENT_DIR_REL_PATH}/ (or one "${UNRELEASED_HEADING}" section on top) and leave the version headings to bump-version.cjs --next`;
}

// The "## Unreleased" section on top of a CHANGELOG, taken out: its notes, its title words and the
// text without it.
function takeUnreleased(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => headingOf(line));
  const match = start === -1 ? null : UNRELEASED.exec(headingOf(lines[start]));
  if (!match) return { notes: '', title: '', text: lines.join('\n') };
  let end = lines.findIndex((line, index) => index > start && headingOf(line));
  if (end === -1) end = lines.length;
  return {
    notes: lines.slice(start + 1, end).join('\n').trim(),
    title: match[1] || '',
    text: [...lines.slice(0, start), ...lines.slice(end)].join('\n'),
  };
}

// The "## Unreleased" notes are checked as a fragment, except that a title belongs in the heading.
function unreleasedProblems(notes) {
  const label = `the "${UNRELEASED_HEADING}" section`;
  const problems = fragmentProblems(label, notes);
  if (/^\uFEFF?Title:/.test(notes)) problems.push(`${label} cannot start with a Title: line; write "${UNRELEASED_HEADING} (<words>)" instead`);
  return problems;
}

// Notes the base holds under "## Unreleased" must reach the fold: an open branch keeps every line of
// them in its own "## Unreleased" section on top, and a bumped branch keeps every line in the
// CHANGELOG. Returns the problem, or ''.
function droppedUnreleasedProblem(headText, baseText, bumped) {
  const notes = takeUnreleased(baseText).notes;
  if (!notes) return '';
  if (!bumped && !UNRELEASED.test(changelogHeadings(headText)[0] || '')) {
    return `the base's "${UNRELEASED_HEADING}" section is missing from this branch; take it back from the base so its notes are folded at merge`;
  }
  const kept = bumped ? String(headText) : takeUnreleased(headText).notes;
  const have = new Set(kept.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()));
  const lost = notes.split('\n').map((line) => line.trim()).filter((line) => line && !have.has(line));
  if (!lost.length) return '';
  return bumped
    ? `the base's "${UNRELEASED_HEADING}" notes are not all under the new heading (missing "${lost[0]}")`
    : `this branch's "${UNRELEASED_HEADING}" section drops notes the base holds there (missing "${lost[0]}"); add to that section, never remove from it`;
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

// The notes as "### " sections; sections that share a name across fragments become one, in the
// order each name first appears, each fragment's part of a section kept together.
function mergeSections(bodies) {
  const sections = new Map();
  for (const body of bodies) {
    const parts = new Map();
    let name = '';
    for (const line of body.split('\n')) {
      if (line.startsWith('### ')) {
        name = line.trimEnd();
        if (!parts.has(name)) parts.set(name, []);
      } else if (name) parts.get(name).push(line);
    }
    for (const [section, lines] of parts) {
      const text = lines.join('\n').trim();
      if (!sections.has(section)) sections.set(section, []);
      if (text) sections.get(section).push(text);
    }
  }
  return [...sections].map(([name, parts]) => [name, parts.join('\n')].filter(Boolean).join('\n\n'));
}

function foldFragments(changelog, version, fragments) {
  const text = changelog.replace(/\r\n/g, '\n');
  const titles = fragments.map((fragment) => fragment.title).filter(Boolean);
  const heading = `## ${version}${titles.length ? ` (${titles.join('; ')})` : ''}`;
  const entry = [heading, ...mergeSections(fragments.map((fragment) => fragment.body))].join('\n\n');
  const lines = text.split('\n');
  const first = lines.findIndex((line) => headingOf(line));
  if (first === -1) return `${text.trimEnd()}\n\n${entry}\n`;
  return [...lines.slice(0, first), entry, '', ...lines.slice(first)].join('\n');
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
  const headText = fs.readFileSync(path.join(workspace, ...CHANGELOG_REL_PATH.split('/')), 'utf8');
  const headHeadings = changelogHeadings(headText);
  const baseHeadings = changelogHeadings(baseChangelog);
  if (current === baseVersion) {
    const problem = heldHeadingsProblem(headHeadings, baseHeadings);
    if (problem) problems.push(problem);
    const unreleased = takeUnreleased(headText).notes;
    if (unreleased) problems.push(...unreleasedProblems(unreleased));
    const dropped = droppedUnreleasedProblem(headText, baseChangelog, false);
    if (dropped) problems.push(dropped);
    return problems;
  }
  const allowed = LEVELS.map((level) => nextVersion(baseVersion, level));
  if (!allowed.includes(current)) {
    problems.push(`version ${current} is not the next version after the base's ${baseVersion} (${allowed.join(' or ')}); prepare a bump from the base or run toolkit-rebump-prs.cjs after main moves`);
    return problems;
  }
  if (topChangelogVersion(headHeadings[0] || '') !== current) {
    problems.push(`version ${current} needs its CHANGELOG heading first, found ${headHeadings[0] ? `"${headHeadings[0]}"` : 'none'}`);
  } else if (JSON.stringify(headHeadings.slice(1)) !== JSON.stringify(withoutUnreleased(baseHeadings))) {
    problems.push(`below the ${current} heading the CHANGELOG headings must be the base's, with any "${UNRELEASED_HEADING}" folded in (${headingDifference(headHeadings.slice(1), withoutUnreleased(baseHeadings))})`);
  }
  const dropped = droppedUnreleasedProblem(headText, baseChangelog, true);
  if (dropped) problems.push(dropped);
  const left = fragmentFiles(workspace);
  if (left.length) problems.push(`version ${current} is set but ${left.join(', ')} is not folded into the CHANGELOG`);
  return problems;
}

module.exports = {
  CHANGELOG_REL_PATH, FRAGMENT_DIR_REL_PATH, LEVELS, PROJECTS_SKILL_DIR_REL_PATH, PROJECTS_SKILL_REL_PATH, UNRELEASED_HEADING,
  changelogAt, changelogHeadings, droppedUnreleasedProblem, headingOf, mergeSections, foldFragments, fragmentFiles, fragmentProblems, git, heldHeadingsProblem,
  nextSkillVersion, nextVersion, parseFragment, skillVersionOf, takeUnreleased, topChangelogVersion, unreleasedProblems, versionAt,
  versionProblems,
};
