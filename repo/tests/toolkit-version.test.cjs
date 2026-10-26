'use strict';

// The one version source: every runtime constant reads version.json, and bump-version.cjs changes
// the version everywhere it appears and nowhere else, either explicitly or as the next version at merge time.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { TOOLKIT_VERSION, VERSION_REL_PATH, readToolkitVersion } = require('../scripts/toolkit-version.cjs');
const { MANIFEST_REL_PATHS, parseArgs } = require('../scripts/bump-version.cjs');
const {
  CHANGELOG_REL_PATH, headingOf, heldHeadingsProblem, mergeSections, nextSkillVersion, nextVersion, topChangelogVersion,
  unreleasedProblems, versionProblems,
} = require('../scripts/toolkit-version-at-merge.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

test('every runtime version constant equals version.json', () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(repoRoot, ...VERSION_REL_PATH.split('/')), 'utf8')).version;
  assert.equal(TOOLKIT_VERSION, recorded);
  assert.equal(require('../scripts/toolkit-local-bridge.cjs').BRIDGE_VERSION, recorded);
  assert.equal(require('../scripts/setup-codex-toolkit-plugin.cjs').EXPECTED_TOOLKIT_VERSION, recorded);
  assert.equal(require('../scripts/toolkit-agent-control.cjs').CONTROL_VERSION, recorded);
  const delegation = fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', 'codex-app-server.cjs'), 'utf8');
  assert.match(delegation, /^const TOOLKIT_CLIENT_VERSION = TOOLKIT_VERSION;$/m);
  for (const rel of MANIFEST_REL_PATHS) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8')).version, recorded, rel);
  }
});

test('the version source refuses a version.json without a semver version', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'version.json');
  fs.writeFileSync(file, JSON.stringify({ version: '3.x' }));
  assert.throws(() => readToolkitVersion(file), /must contain a semver version/);
  fs.writeFileSync(file, JSON.stringify({ version: '3.10.0' }));
  assert.equal(readToolkitVersion(file), '3.10.0');
});

function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').filter((rel) => rel && fs.existsSync(path.join(repoRoot, rel)));
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('bump-version changes the version everywhere it appears and nothing else', (t) => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-bump-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  const files = trackedFiles();
  const before = new Map();
  for (const rel of files) {
    const target = path.join(copy, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), target);
    before.set(rel, digest(target));
  }

  const result = spawnSync(process.execPath, [path.join(copy, 'repo', 'scripts', 'bump-version.cjs'), '9.9.9'], { cwd: copy, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Toolkit version is now 9\.9\.9\./);

  const changed = files.filter((rel) => digest(path.join(copy, rel)) !== before.get(rel));
  for (const rel of [VERSION_REL_PATH, ...MANIFEST_REL_PATHS, 'repo/docs/published-surface-audit-baseline.json', 'AGENTS.md', 'README.md']) {
    assert.ok(changed.includes(rel), `${rel} should carry the new version`);
  }
  // Every changed file differs from the original only by the version number. The syncs write LF;
  // a Windows checkout holds CRLF, which git stores as the same LF content, so compare as LF.
  const lf = (rel, root) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  for (const rel of changed) {
    assert.equal(lf(rel, copy).split('9.9.9').join(TOOLKIT_VERSION), lf(rel, repoRoot), `${rel} changed beyond the version`);
  }

  const runtime = spawnSync(process.execPath, ['-e', [
    "const v = require('./repo/scripts/toolkit-version.cjs').TOOLKIT_VERSION;",
    "const b = require('./repo/scripts/toolkit-local-bridge.cjs').BRIDGE_VERSION;",
    "const c = require('./repo/scripts/toolkit-agent-control.cjs').CONTROL_VERSION;",
    "const s = require('./repo/scripts/setup-codex-toolkit-plugin.cjs').EXPECTED_TOOLKIT_VERSION;",
    'process.stdout.write([v, b, c, s].join(" "));',
  ].join('\n')], { cwd: copy, encoding: 'utf8' });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout, '9.9.9 9.9.9 9.9.9 9.9.9');

  const validation = spawnSync(process.execPath, [path.join(copy, 'repo', 'scripts', 'validate-toolkit.cjs')], { cwd: copy, encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
});

test('bump-version refuses a non-semver version without writing', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'bump-version.cjs'), 'next'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: node repo\/scripts\/bump-version\.cjs <x\.y\.z>/);
  assert.equal(readToolkitVersion(), TOOLKIT_VERSION);
});

// A git copy of the repository with one "base" commit, as main would be at merge time.
function gitCopy(t) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-next-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  for (const rel of trackedFiles()) {
    const target = path.join(copy, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), target);
  }
  // Start from no fragments, as main has after every merge.
  for (const name of fs.readdirSync(path.join(copy, 'repo', 'docs', 'changelog.d'))) {
    if (name !== 'README.md') fs.rmSync(path.join(copy, 'repo', 'docs', 'changelog.d', name));
  }
  const run = (...args) => {
    const result = spawnSync('git', args, { cwd: copy, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.invalid');
  run('config', 'user.name', 'Test');
  run('config', 'core.autocrlf', 'false');
  // No background gc or maintenance after a commit, which could still be writing objects at cleanup.
  run('config', 'gc.auto', '0');
  run('config', 'maintenance.auto', 'false');
  run('add', '-A');
  run('commit', '-q', '-m', 'base');
  run('tag', 'base');
  run('checkout', '-q', '-b', 'lane');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
    fs.writeFileSync(path.join(copy, rel), text);
  };
  const read = (rel) => fs.readFileSync(path.join(copy, rel), 'utf8');
  const commit = (message) => { run('add', '-A'); run('commit', '-q', '-m', message); };
  const bump = (...args) => spawnSync(process.execPath, [path.join(copy, 'repo', 'scripts', 'bump-version.cjs'), ...args], { cwd: copy, encoding: 'utf8' });
  return { copy, run, write, read, commit, bump };
}

const FRAGMENT = 'repo/docs/changelog.d/lane.md';
const SKILL = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
const NOTES = 'Title: lane work\n\n### Lane\n\n- **A change:** what it does.\n';

test('next versions count from the base', () => {
  assert.equal(nextVersion('3.15.0', 'patch'), '3.15.1');
  assert.equal(nextVersion('3.15.4', 'minor'), '3.16.0');
  assert.equal(nextSkillVersion('2026-10-25.9', '2026-10-26'), '2026-10-26.1');
  assert.equal(nextSkillVersion('2026-10-26.2', '2026-10-26'), '2026-10-26.3');
  assert.equal(nextSkillVersion('2026-10-27.1', '2026-10-26'), '2026-10-27.2', 'never older than the base');
  assert.throws(() => parseArgs(['--next', 'major']), /--next takes patch or minor/);
  assert.throws(() => parseArgs(['--next', 'patch', '1.2.3']), /not both/);
});

test('--next sets the base version plus one, folds the fragment and bumps a changed Projects skill', (t) => {
  const lane = gitCopy(t);
  lane.write(FRAGMENT, NOTES);
  lane.write(SKILL, `${lane.read(SKILL)}\n- A lane rule.\n`);
  lane.commit('lane work');
  assert.deepEqual(versionProblems({ workspace: lane.copy, base: 'base' }), [], 'a lane holding the base version passes CI');

  const result = lane.bump('--next', 'minor', '--base', 'base');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const expected = nextVersion(TOOLKIT_VERSION, 'minor');
  assert.ok(result.stdout.includes(`Toolkit version is now ${expected} `), result.stdout);
  assert.equal(readToolkitVersion(path.join(lane.copy, ...VERSION_REL_PATH.split('/'))), expected);
  for (const rel of MANIFEST_REL_PATHS) assert.equal(JSON.parse(lane.read(rel)).version, expected, rel);
  assert.ok(lane.read('AGENTS.md').includes(`toolkit=${expected} `), 'markers carry the new version');
  const changelog = lane.read(CHANGELOG_REL_PATH);
  assert.equal(topChangelogVersion(changelog), expected);
  assert.ok(changelog.includes(`## ${expected} (lane work)\n\n### Lane\n\n- **A change:** what it does.\n\n## ${TOOLKIT_VERSION}`), 'the notes sit under the new heading, above the base entry');
  assert.equal(fs.existsSync(path.join(lane.copy, FRAGMENT)), false, 'the fragment is folded away');
  assert.ok(fs.existsSync(path.join(lane.copy, 'repo/docs/changelog.d/README.md')), 'the folder guide stays');
  assert.match(lane.read(SKILL), /^Version: \d{4}-\d{2}-\d{2}\.\d+$/m);
  assert.notEqual(/^Version: (.*)$/m.exec(lane.read(SKILL))[1], /^Version: (.*)$/m.exec(fs.readFileSync(path.join(repoRoot, SKILL), 'utf8'))[1]);

  lane.commit('bump');
  assert.deepEqual(versionProblems({ workspace: lane.copy, base: 'base' }), [], 'the bumped head passes CI');
  const validation = spawnSync(process.execPath, [path.join(lane.copy, 'repo', 'scripts', 'validate-toolkit.cjs')], { cwd: lane.copy, encoding: 'utf8', env: { ...process.env, DIFF_BASE: 'base' } });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
});

test('--next leaves an unchanged Projects skill alone', (t) => {
  const lane = gitCopy(t);
  const skill = lane.read(SKILL);
  lane.write(FRAGMENT, '### Lane\n\n- **A change:** what it does.\n');
  lane.commit('lane work');
  const result = lane.bump('--next', 'patch', '--base', 'base');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(lane.read(SKILL), skill);
  assert.ok(lane.read(CHANGELOG_REL_PATH).includes(`## ${nextVersion(TOOLKIT_VERSION, 'patch')}\n\n### Lane`), 'no title, plain heading');
});

test('--next refuses without writing when the lane is not ready', (t) => {
  const lane = gitCopy(t);
  const refuse = (pattern, message, version = TOOLKIT_VERSION) => {
    const before = lane.run('status', '--porcelain');
    const result = lane.bump('--next', 'patch', '--base', 'base');
    assert.equal(result.status, 1, message);
    assert.match(result.stderr, pattern, message);
    assert.equal(lane.run('status', '--porcelain'), before, `${message}: nothing written`);
    assert.equal(readToolkitVersion(path.join(lane.copy, ...VERSION_REL_PATH.split('/'))), version, message);
  };
  refuse(/no changelog fragment/, 'no fragment');

  lane.write(FRAGMENT, NOTES);
  refuse(/uncommitted changes/, 'dirty tree');
  lane.commit('lane work');

  lane.write(FRAGMENT, '## 9.9.9\n\n- **A change:** what it does.\n');
  lane.commit('bad fragment');
  refuse(/"###" section headings only/, 'a fragment with its own version heading');
  lane.write(FRAGMENT, NOTES);
  lane.commit('good fragment');

  for (const [bad, pattern, message] of [
    ['Title:\n\n### Lane\n\n- A change.\n', /empty Title: line/, 'an empty title'],
    ['### Lane\n\nTitle: late\n\n- A change.\n', /Title: line that is not its first line/, 'a late title'],
    ['Some words first.\n\n### Lane\n\n- A change.\n', /text before its first "###"/, 'stray text before the first section'],
    ['- A change with no section.\n', /no "###" section heading/, 'no section heading'],
  ]) {
    lane.write(FRAGMENT, bad);
    lane.commit(message);
    refuse(pattern, message);
  }
  lane.write(FRAGMENT, NOTES);
  lane.commit('good fragment again');

  const changelog = () => lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n');
  const top = changelog().match(/^## .*$/m)[0];
  for (const [edit, pattern, message] of [
    [(text) => text.replace('# Toolkit Changelog\n\n', '# Toolkit Changelog\n\n## 9.9.9\n\n- Old style.\n\n'), /it adds "## 9\.9\.9"/, 'an old-style heading on top'],
    [(text) => text.replace('# Toolkit Changelog\n\n', `# Toolkit Changelog\n\n${top}\n\n- Reused number.\n\n`), /headings differ from the base's/, "a heading that reuses main's number"],
    [(text) => text.replace(/(^## [^\n]*\n[\s\S]*?)\n## /m, '$1\n## 9.9.9\n\n- Below the top.\n\n## '), /it adds "## 9\.9\.9"/, "a heading below main's top one"],
    [(text) => text.replace('# Toolkit Changelog\n\n', '# Toolkit Changelog\n\n## Unreleased\n\n- Notes.\n\n## Unreleased\n\n- More.\n\n'), /headings differ from the base's/, 'two Unreleased sections'],
  ]) {
    lane.write(CHANGELOG_REL_PATH, edit(changelog()));
    lane.commit(message);
    refuse(pattern, message);
    lane.run('revert', '--no-edit', 'HEAD');
  }

  const setOwn = lane.bump('9.9.9');
  assert.equal(setOwn.status, 0, setOwn.stderr);
  lane.commit('own version');
  refuse(/this branch sets 9\.9\.9/, 'a lane that set its own version', '9.9.9');
  lane.run('reset', '-q', '--hard', 'HEAD~1');

  const bumped = lane.bump('--next', 'patch', '--base', 'base');
  assert.equal(bumped.status, 0, bumped.stderr);
  lane.commit('bump');
  refuse(/already bumped to .*revert that bump commit, merge base and run --next again/, 'a second --next', nextVersion(TOOLKIT_VERSION, 'patch'));
  lane.run('reset', '-q', '--hard', 'HEAD~1');

  lane.run('checkout', '-q', 'main');
  const next = nextVersion(TOOLKIT_VERSION, 'patch');
  lane.write(CHANGELOG_REL_PATH, `${lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n').trimEnd()}\n\n##\t${next}\n\n- An old entry that took the number.\n`);
  lane.commit('main moved');
  lane.run('checkout', '-q', 'lane');
  const behind = lane.bump('--next', 'patch', '--base', 'main');
  assert.equal(behind.status, 1);
  assert.match(behind.stderr, /does not contain main yet; merge it in first/);
  lane.run('merge', '-q', '--no-edit', 'main');
  const taken = lane.bump('--next', 'patch', '--base', 'main');
  assert.equal(taken.status, 1);
  assert.ok(taken.stderr.includes(`the CHANGELOG already has a ${next} heading`), taken.stderr);
});

test('--next folds an older "## Unreleased" section with the fragments', (t) => {
  const lane = gitCopy(t);
  lane.write(CHANGELOG_REL_PATH, lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n').replace('# Toolkit Changelog\n\n', '# Toolkit Changelog\n\n## Unreleased\n\n### Older lane\n\n- **Old way:** a note.\n\n'));
  lane.commit('unreleased notes');
  assert.deepEqual(versionProblems({ workspace: lane.copy, base: 'base' }), [], 'one Unreleased section on top is allowed while open');
  const alone = lane.bump('--next', 'minor', '--base', 'base');
  assert.equal(alone.status, 0, alone.stderr || alone.stdout);
  assert.ok(lane.read(CHANGELOG_REL_PATH).includes(`## ${nextVersion(TOOLKIT_VERSION, 'minor')}\n\n### Older lane`), 'an Unreleased section alone is enough notes');
  lane.run('checkout', '-q', '--', '.');
  lane.write(FRAGMENT, NOTES);
  lane.commit('and a fragment');
  const result = lane.bump('--next', 'patch', '--base', 'base');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const next = nextVersion(TOOLKIT_VERSION, 'patch');
  const folded = lane.read(CHANGELOG_REL_PATH);
  assert.ok(folded.includes(`## ${next} (lane work)\n\n### Lane\n\n- **A change:** what it does.\n\n### Older lane\n\n- **Old way:** a note.\n\n## ${TOOLKIT_VERSION}`), folded.slice(0, 600));
  assert.equal(folded.includes('## Unreleased'), false);
  lane.commit('bump');
  assert.deepEqual(versionProblems({ workspace: lane.copy, base: 'base' }), []);
});

test('headings are read as GitHub shows them and every difference is named', () => {
  assert.equal(headingOf('##\t3.1.0'), '## 3.1.0', 'a tab after ##');
  assert.equal(headingOf('   ## 3.1.0  '), '## 3.1.0', 'up to three spaces before ##');
  assert.equal(headingOf('    ## 3.1.0'), '', 'four spaces is a code block');
  assert.equal(headingOf('##3.1.0'), '');
  assert.equal(headingOf('### Lane'), '');
  assert.equal(topChangelogVersion('## 3.1.0 (words)'), '3.1.0');

  const base = ['## 1.0.1', '## 1.0.0', '## 0.9.0'];
  assert.equal(heldHeadingsProblem(base, base), '');
  assert.equal(heldHeadingsProblem(['## Unreleased (older lane)', ...base], base), '', 'a titled Unreleased on top');
  assert.equal(heldHeadingsProblem(base, ['## Unreleased', ...base]), '', 'the base already has Unreleased');
  assert.equal(heldHeadingsProblem(['## Unreleased', ...base], ['## Unreleased', ...base]), '');
  assert.match(heldHeadingsProblem(['## 1.0.1', '## 1.0.0'], base), /it drops "## 0\.9\.0"/);
  assert.match(heldHeadingsProblem(['## 1.0.1', ...base], base), /it repeats "## 1\.0\.1"/);
  assert.match(heldHeadingsProblem(['## 1.0.0'], ['## 1.0.0', '## 1.0.0']), /it drops "## 1\.0\.0"/, 'one fewer of a repeated heading');
  assert.match(heldHeadingsProblem(['## 1.0.0', '## 1.0.1', '## 0.9.0'], base), /in a different order/);
  assert.match(heldHeadingsProblem(['## Unreleased', '## Unreleased', ...base], base), /it adds "## Unreleased"/);

  assert.deepEqual(mergeSections(['### A\n\n- one\n\n### B\n\n- two\n', '### A\n\n- three\n']), ['### A\n\n- one\n- three', '### B\n\n- two'], 'one section per name');
});

test('the CI guard reads indented and tab headings', (t) => {
  const lane = gitCopy(t);
  const text = lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n');
  for (const heading of ['##\t9.9.9', '  ## 9.9.9']) {
    lane.write(CHANGELOG_REL_PATH, text.replace('# Toolkit Changelog\n\n', `# Toolkit Changelog\n\n${heading}\n\n- Old style.\n\n`));
    assert.match(versionProblems({ workspace: lane.copy, base: 'base' }).join('\n'), /it adds "## 9\.9\.9"/, JSON.stringify(heading));
  }
});

test('the guard and --next check the format of "## Unreleased" notes', (t) => {
  const lane = gitCopy(t);
  lane.write(CHANGELOG_REL_PATH, lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n').replace('# Toolkit Changelog\n\n', '# Toolkit Changelog\n\n## Unreleased\n\n- A bullet with no section.\n\n'));
  lane.commit('bare unreleased');
  assert.match(versionProblems({ workspace: lane.copy, base: 'base' }).join('\n'), /the "## Unreleased" section has no "###" section heading/);
  const result = lane.bump('--next', 'patch', '--base', 'base');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the "## Unreleased" section has no "###" section heading/);
  assert.equal(readToolkitVersion(path.join(lane.copy, ...VERSION_REL_PATH.split('/'))), TOOLKIT_VERSION);
  assert.match(unreleasedProblems('Title: words\n\n### Lane\n\n- A note.').join('\n'), /cannot start with a Title: line/, 'a title belongs in the heading');
  assert.deepEqual(unreleasedProblems('### Lane\n\n- A note.'), []);
});

test('a base that already holds "## Unreleased" folds with the lane at merge', (t) => {
  const lane = gitCopy(t);
  lane.run('checkout', '-q', 'main');
  lane.write(CHANGELOG_REL_PATH, lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n').replace('# Toolkit Changelog\n\n', '# Toolkit Changelog\n\n## Unreleased (older lane)\n\n### Lane\n\n- **Old way:** a note.\n\n'));
  lane.commit('main holds unreleased notes');
  lane.run('checkout', '-q', 'lane');
  lane.run('merge', '-q', '--no-edit', 'main');
  lane.write(FRAGMENT, NOTES);
  lane.write('repo/docs/changelog.d/other.md', '\uFEFFTitle: other work\r\n\r\n### Lane\r\n\r\n- **Other:** more.\r\n');
  lane.commit('lane work');
  assert.deepEqual(versionProblems({ workspace: lane.copy, base: 'main' }), [], 'the held lane passes');

  const withUnreleased = lane.read(CHANGELOG_REL_PATH);
  lane.write(CHANGELOG_REL_PATH, withUnreleased.split('## Unreleased (older lane)\n\n### Lane\n\n- **Old way:** a note.\n\n').join(''));
  lane.commit('drop main notes');
  assert.match(versionProblems({ workspace: lane.copy, base: 'main' }).join('\n'), /base's "## Unreleased" section is missing from this branch/);
  const dropped = lane.bump('--next', 'patch', '--base', 'main');
  assert.equal(dropped.status, 1, 'notes main holds are never dropped');
  assert.match(dropped.stderr, /base's "## Unreleased" section is missing from this branch/);
  lane.run('revert', '--no-edit', 'HEAD');

  const result = lane.bump('--next', 'patch', '--base', 'main');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const next = nextVersion(TOOLKIT_VERSION, 'patch');
  const folded = lane.read(CHANGELOG_REL_PATH);
  assert.ok(folded.includes(`## ${next} (lane work; other work; older lane)\n\n### Lane\n\n- **A change:** what it does.\n- **Other:** more.\n- **Old way:** a note.\n\n## ${TOOLKIT_VERSION}`), folded.slice(0, 600));
  assert.equal(folded.includes('Unreleased'), false);
  assert.equal(folded.includes('\uFEFF'), false, 'the byte order mark is dropped');
  lane.commit('bump');
  assert.deepEqual(versionProblems({ workspace: lane.copy, base: 'main' }), [], 'the bumped lane passes against a base with Unreleased');
  lane.write(CHANGELOG_REL_PATH, folded.replace('- **Old way:** a note.\n', ''));
  assert.match(versionProblems({ workspace: lane.copy, base: 'main' }).join('\n'), /notes are not all under the new heading \(missing "- \*\*Old way:\*\* a note\."\)/, 'a bump that drops main\'s notes');
});

test('the CI guard fails stale, skipped and half-done versions', (t) => {
  const lane = gitCopy(t);
  const check = () => versionProblems({ workspace: lane.copy, base: 'base' }).join('\n');
  lane.write(FRAGMENT, NOTES);
  lane.commit('lane work');
  assert.equal(check(), '');

  const skipped = nextVersion(nextVersion(TOOLKIT_VERSION, 'patch'), 'patch');
  assert.equal(lane.bump(skipped).status, 0);
  assert.ok(check().includes(`version ${skipped} is not the next version after the base's`), check());

  const next = nextVersion(TOOLKIT_VERSION, 'patch');
  assert.equal(lane.bump(next).status, 0);
  const problems = check();
  assert.match(problems, /needs its CHANGELOG heading first/);
  assert.match(problems, /is not folded into the CHANGELOG/);

  lane.run('checkout', '-q', '--', '.');
  lane.write(SKILL, lane.read(SKILL).replace(/^Version: .*$/m, 'Version: 2000-01-01.1'));
  assert.match(check(), /Projects skill Version 2000-01-01\.1 is older than the base's/);
  assert.equal(versionProblems({ workspace: lane.copy, base: '' }).length, 0, 'without a base only fragments are checked');
  assert.match(versionProblems({ workspace: lane.copy, base: 'no-such-commit' }).join('\n'), /cannot be checked; fetch full history/);
  lane.run('checkout', '-q', '--', '.');

  const text = lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n');
  lane.write(CHANGELOG_REL_PATH, text.replace('# Toolkit Changelog\n\n', '# Toolkit Changelog\n\n## 9.9.9\n\n- Old style.\n\n'));
  assert.match(check(), /it adds "## 9\.9\.9"/, 'an open branch with its own numbered heading');
  lane.run('checkout', '-q', '--', '.');

  const bumped = lane.bump('--next', 'patch', '--base', 'base');
  assert.equal(bumped.status, 0, bumped.stderr);
  assert.equal(check(), '');
  const folded = lane.read(CHANGELOG_REL_PATH).replace(/\r\n/g, '\n');
  lane.write(CHANGELOG_REL_PATH, folded.replace(/(^## [^\n]*\n[\s\S]*?)\n## /m, '$1\n## Unreleased\n\n- Left behind.\n\n## '));
  assert.match(check(), /below the .* heading the CHANGELOG headings must be the base's, with any "## Unreleased" folded in \(it adds "## Unreleased"\)/, 'a stale section left under the new heading');
});

test('the validator runs the CI guard against DIFF_BASE and fails closed', (t) => {
  const lane = gitCopy(t);
  lane.write(FRAGMENT, NOTES);
  lane.commit('lane work');
  const validate = (base) => spawnSync(process.execPath, [path.join(lane.copy, 'repo', 'scripts', 'validate-toolkit.cjs')], {
    cwd: lane.copy, encoding: 'utf8', env: { ...process.env, DIFF_BASE: base },
  });
  const held = validate('base');
  assert.equal(held.status, 0, held.stderr || held.stdout);
  const skipped = nextVersion(nextVersion(TOOLKIT_VERSION, 'patch'), 'patch');
  assert.equal(lane.bump(skipped).status, 0);
  const stale = validate('base');
  assert.equal(stale.status, 1);
  assert.ok(`${stale.stdout}${stale.stderr}`.includes(`version ${skipped} is not the next version`), stale.stderr);
  lane.run('checkout', '-q', '--', '.');
  const unknown = validate('no-such-commit');
  assert.equal(unknown.status, 1);
  assert.match(`${unknown.stdout}${unknown.stderr}`, /DIFF_BASE no-such-commit is not a commit in this checkout/);
});
