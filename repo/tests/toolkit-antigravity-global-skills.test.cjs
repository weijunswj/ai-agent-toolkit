'use strict';

// Setup's "Copy Toolkit's skills into Antigravity?" question and the global copy it manages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AntigravityGlobalSkills, INTERNAL_SKILLS } = require('../scripts/toolkit-antigravity-project-skills.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-antigravity-global-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the global copy takes the portable skills only and keeps hand copies', (t) => {
  const dir = home(t);
  const owner = new AntigravityGlobalSkills({ toolkitRoot: repoRoot, homeDir: dir });
  assert.equal(owner.installed(), false);
  const names = owner.skillNames();
  assert.ok(names.length > 5);
  for (const internal of INTERNAL_SKILLS) assert.equal(names.includes(internal), false, internal);
  const target = path.join(dir, '.gemini', 'config', 'skills');
  fs.mkdirSync(path.join(target, names[0]), { recursive: true });
  fs.writeFileSync(path.join(target, names[0], 'SKILL.md'), 'mine\n');
  const result = owner.install();
  assert.equal(result.copied.length, names.length - 1);
  assert.deepEqual(result.handCopies.map((row) => row.skill), [names[0]]);
  assert.equal(owner.hasCopies(), true);
  assert.equal(owner.installed(), true);
  assert.equal(owner.remove().length, names.length - 1);
  assert.equal(fs.readFileSync(path.join(target, names[0], 'SKILL.md'), 'utf8'), 'mine\n');
  assert.equal(owner.hasCopies(), false);
});

test('the setup answer copies, removes or changes nothing', (t) => {
  const dir = home(t);
  const owner = new AntigravityGlobalSkills({ toolkitRoot: repoRoot, homeDir: dir });
  const { OfficialN8nSkills } = require('../scripts/toolkit-n8n-official-skills.cjs');
  const n8n = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'codex', homeDir: dir, antigravity: true });
  n8n.install();
  const answer = (choice) => core.applyAntigravitySkills({ setupChoices: { antigravitySkills: choice } }, owner, n8n);
  assert.equal(answer(''), '');
  assert.equal(answer('keep'), '');
  assert.equal(owner.hasCopies(), false);
  assert.match(answer('copy'), /^\d+ folder copies updated\.$/);
  assert.match(answer('copy'), /^\d+ already current\.$/);
  assert.match(answer('remove'), /^removed \d+ Toolkit skill folders\.$/);
  assert.equal(owner.hasCopies(), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.gemini', 'config', 'skills')), [], 'the n8n copies in Antigravity go too');
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', 'using-n8n-skills-official')), 'the app folder copies stay');
});

test('the question shows only when Antigravity is installed or Toolkit copies exist, and is opt-in', () => {
  const ids = (antigravity) => core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), {
    ...core.documentationFixtureState(), antigravity,
  }).map((spec) => spec.id);
  assert.equal(ids({ installed: false, copies: false }).includes('antigravity-skills'), false);
  const spec = (antigravity) => core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), {
    ...core.documentationFixtureState(), antigravity,
  }).find((row) => row.id === 'antigravity-skills');
  const fresh = spec({ installed: true, copies: false });
  assert.equal(fresh.recommended, 'keep');
  assert.deepEqual(fresh.choices.map((choice) => choice.value), ['copy', 'keep']);
  const kept = spec({ installed: true, copies: true });
  assert.equal(kept.recommended, 'copy');
  assert.deepEqual(kept.choices.map((choice) => choice.value), ['copy', 'remove', 'keep']);
  assert.throws(() => core.parseArgs(['--antigravity-skills', 'everything']), /Unsupported --antigravity-skills choice/);
  assert.equal(core.parseArgs(['--antigravity-skills', 'copy']).setupChoices.antigravitySkills, 'copy');
});
