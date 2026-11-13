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
  assert.deepEqual(fresh.choices.map((choice) => choice.value), ['keep', 'copy']);
  // Copies that already match this Toolkit version recommend keeping them; out-of-date copies recommend a refresh.
  const current = spec({ installed: true, copies: true, outOfDate: 0 });
  assert.equal(current.recommended, 'keep');
  assert.equal(current.current_short, 'Copied, up to date');
  assert.deepEqual(current.choices.map((choice) => choice.value), ['keep', 'copy', 'remove']);
  const behind = spec({ installed: true, copies: true, outOfDate: 3 });
  assert.equal(behind.recommended, 'copy');
  assert.equal(behind.current_short, 'Copied, 3 out of date');
  assert.deepEqual(behind.choices.map((choice) => choice.value), ['keep', 'copy', 'remove']);
  assert.throws(() => core.parseArgs(['--antigravity-skills', 'everything']), /Unsupported --antigravity-skills choice/);
  assert.equal(core.parseArgs(['--antigravity-skills', 'copy']).setupChoices.antigravitySkills, 'copy');
});

test('setup counts Toolkit copies in Antigravity that a copy run would change', (t) => {
  const dir = home(t);
  const owner = new AntigravityGlobalSkills({ toolkitRoot: repoRoot, homeDir: dir });
  assert.deepEqual(core.antigravityState({ repoRoot }, owner), { installed: owner.installed(), copies: false, outOfDate: 0 });
  const target = path.join(dir, '.gemini', 'config', 'skills');
  const names = owner.skillNames();
  // A folder the owner copied by hand is never Toolkit's, whatever its content.
  fs.mkdirSync(path.join(target, names[0]), { recursive: true });
  fs.writeFileSync(path.join(target, names[0], 'SKILL.md'), 'mine\n');
  owner.install();
  assert.equal(core.antigravityState({ repoRoot }, owner).outOfDate, 0, 'a hand copy is not out of date');
  // An edited copy is stale.
  fs.appendFileSync(path.join(target, names[1], 'SKILL.md'), '\nolder copy\n');
  assert.equal(core.antigravityState({ repoRoot }, owner).outOfDate, 1);
  // A deleted copy is missing.
  fs.rmSync(path.join(target, names[2]), { recursive: true, force: true });
  assert.equal(core.antigravityState({ repoRoot }, owner).outOfDate, 2);
  // A copy of a skill the source no longer has is removed by a copy run, so it counts too.
  const ledgerPath = path.join(dir, '.ai-agent-toolkit', 'antigravity-toolkit-skills.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.targets[target] = [...ledger.targets[target], 'retired-skill'].sort();
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  fs.mkdirSync(path.join(target, 'retired-skill'), { recursive: true });
  fs.writeFileSync(path.join(target, 'retired-skill', 'SKILL.md'), 'old\n');
  assert.equal(core.antigravityState({ repoRoot }, owner).outOfDate, 3);
});

test('a copy setup cannot read never hides the copies', (t) => {
  // The copies stay "copied" (so the question shows and Toolkit's n8n copies there are kept), with an
  // honest "could not check" and a refresh recommended, never "up to date".
  const failing = {
    installed: () => true, hasCopies: () => true, skillNames: () => ['a'], recorded: () => [],
    inspect: () => { throw new Error('The skills copy found a symbolic link and stopped: a/link'); },
  };
  const state = core.antigravityState({ repoRoot }, failing);
  assert.deepEqual(state, { installed: true, copies: true, outOfDate: null });
  const row = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), {
    ...core.documentationFixtureState(), antigravity: state,
  }).find((spec) => spec.id === 'antigravity-skills');
  assert.equal(row.current_short, 'Copied, could not check');
  assert.equal(row.recommended, 'copy');
  if (process.platform === 'win32') return;
  // The same with a real link inside a recorded copy.
  const dir = home(t);
  const owner = new AntigravityGlobalSkills({ toolkitRoot: repoRoot, homeDir: dir });
  owner.install();
  const [first] = owner.recorded();
  fs.symlinkSync(path.join(first.target, first.skill, 'SKILL.md'), path.join(first.target, first.skill, 'link.md'));
  assert.deepEqual(core.antigravityState({ repoRoot }, owner), { installed: true, copies: true, outOfDate: null });
});
