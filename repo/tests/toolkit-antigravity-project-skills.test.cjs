'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { copyPortableSkills } = require('../scripts/toolkit-antigravity-project-skills.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-antigravity-skills-'));
}

function sourceFixture() {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'skills', 'release-readiness-audit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'release-readiness-audit', 'SKILL.md'), '---\nname: release-readiness-audit\ndescription: Fixture\n---\n', 'utf8');
  fs.mkdirSync(path.join(root, 'skills', 'release-readiness-audit', 'resources'));
  fs.writeFileSync(path.join(root, 'skills', 'release-readiness-audit', 'resources', 'guide.md'), 'reference\n', 'utf8');
  return root;
}

test('portable Antigravity preview writes nothing and targets only workspace .agents/skills', (t) => {
  const project = tempRoot();
  const source = sourceFixture();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));

  const result = copyPortableSkills({ projectRoot: project, sourceSkillsRoot: path.join(source, 'skills') });
  assert.deepEqual(result, {
    status: 'dry-run',
    target: '.agents/skills',
    skills: 1,
    files: 2,
    files_to_copy: 2,
    wrote: false
  });
  assert.deepEqual(fs.readdirSync(project), []);
});

test('portable Antigravity copy adds skill folders only and is idempotent', (t) => {
  const project = tempRoot();
  const source = sourceFixture();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));

  const result = copyPortableSkills({ projectRoot: project, sourceSkillsRoot: path.join(source, 'skills'), write: true });
  assert.equal(result.status, 'copied');
  assert.equal(result.files_copied, 2);
  assert.deepEqual(fs.readdirSync(path.join(project, '.agents', 'skills')), ['release-readiness-audit']);
  assert.equal(fs.readFileSync(path.join(project, '.agents', 'skills', 'release-readiness-audit', 'SKILL.md'), 'utf8').includes('name: release-readiness-audit'), true);
  assert.deepEqual(fs.readdirSync(path.join(project, '.agents', 'skills', 'release-readiness-audit')).sort(), ['SKILL.md', 'resources']);

  const repeated = copyPortableSkills({ projectRoot: project, sourceSkillsRoot: path.join(source, 'skills'), write: true });
  assert.equal(repeated.status, 'already-current');
  assert.equal(repeated.files_copied, 0);
});

test('portable Antigravity copy preflights conflicts and preserves user content', (t) => {
  const project = tempRoot();
  const source = sourceFixture();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const skillRoot = path.join(project, '.agents', 'skills', 'release-readiness-audit');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), 'user-owned content\n', 'utf8');

  assert.throws(() => copyPortableSkills({ projectRoot: project, sourceSkillsRoot: path.join(source, 'skills'), write: true }), /refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8'), 'user-owned content\n');
  assert.equal(fs.existsSync(path.join(skillRoot, 'resources', 'guide.md')), false);
});

test('portable Antigravity copy refuses symlinked target directories', (t) => {
  const project = tempRoot();
  const source = sourceFixture();
  const external = tempRoot();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(project, '.agents'), 'junction');

  assert.throws(() => copyPortableSkills({ projectRoot: project, sourceSkillsRoot: path.join(source, 'skills'), write: true }), /symbolic link or junction/);
  assert.deepEqual(fs.readdirSync(external), []);
});

test('portable Antigravity copy leaves out the Toolkit-only skills', (t) => {
  const { INTERNAL_SKILLS } = require('../scripts/toolkit-antigravity-project-skills.cjs');
  const project = tempRoot();
  const source = sourceFixture();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  for (const name of INTERNAL_SKILLS) {
    fs.mkdirSync(path.join(source, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture\n---\n`, 'utf8');
  }
  const result = copyPortableSkills({ projectRoot: project, sourceSkillsRoot: path.join(source, 'skills'), write: true });
  assert.equal(result.skills, 1);
  assert.deepEqual(fs.readdirSync(path.join(project, '.agents', 'skills')), ['release-readiness-audit']);
  assert.deepEqual([...INTERNAL_SKILLS].sort(), ['controller-bootstrap', 'github-program-reconciler', 'toolkit-env', 'toolkit-setup']);
});
