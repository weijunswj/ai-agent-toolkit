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
  // Copies already there are the owner's saved "Copy and keep updated" answer: Keep current keeps copying
  // (and refreshes anything out of date), whatever their state; the other choice is Remove.
  for (const [outOfDate, short] of [[0, 'Copied, kept updated'], [3, 'Copied, kept updated, 3 to refresh'], [null, 'Copied, kept updated, could not check']]) {
    const row = spec({ installed: true, copies: true, outOfDate });
    assert.equal(row.recommended, 'copy', short);
    assert.equal(row.current_short, short);
    assert.deepEqual(row.choices.map((choice) => [choice.value, choice.label]), [['copy', 'Keep current'], ['remove', "Remove Toolkit's copies"]]);
    assert.match(row.choices[0].consequence, /session start does the same/);
    assert.equal(row.folded_value, 'keep', 'a typed keep applies as Keep current');
  }
  // A typed keep with copies there refreshes them (setup applies it as copy); without copies it changes nothing.
  const answered = (antigravity) => {
    const args = core.parseArgs(['--plan', '--host', 'codex', '--antigravity-skills', 'keep']);
    core.setupQuestionSpecs(args, { ...core.documentationFixtureState(), antigravity });
    return args.setupChoices.antigravitySkills;
  };
  assert.equal(answered({ installed: true, copies: true, outOfDate: 3 }), 'copy');
  assert.equal(answered({ installed: true, copies: false }), 'keep');
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
    installed: () => true, hasCopies: () => true,
    outOfDate: () => { throw new Error('The skills copy found a symbolic link and stopped: a/link'); },
  };
  const state = core.antigravityState({ repoRoot }, failing);
  assert.deepEqual(state, { installed: true, copies: true, outOfDate: null });
  const row = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), {
    ...core.documentationFixtureState(), antigravity: state,
  }).find((spec) => spec.id === 'antigravity-skills');
  assert.equal(row.current_short, 'Copied, kept updated, could not check');
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

// Session start keeps Toolkit's copies in Antigravity current from the managed checkout, once the owner
// chose them in setup. A source stamp makes most session starts do nothing.
const { spawnSync } = require('node:child_process');
const { ManagedSkillCopies } = require('../scripts/toolkit-skill-copies.cjs');
const { OfficialN8nSkills } = require('../scripts/toolkit-n8n-official-skills.cjs');
const { AntigravitySessionRefresh, sessionRefreshCheck } = require('../scripts/toolkit-antigravity-project-skills.cjs');

const N8N_REL = ['repo', 'contracts', 'third-party', 'n8n-io-skills', 'skills'];

function gitIn(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function writeIn(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }

// A managed checkout with two portable skills, one Toolkit-only skill and one official n8n skill; a home
// where setup already copied them into Antigravity (the owner's "Copy and keep updated" answer).
function opted(t, { copy = true } = {}) {
  const dir = home(t);
  const checkout = path.join(dir, 'checkout');
  const homeDir = path.join(dir, 'home');
  writeIn(path.join(checkout, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), '{"version":"1.0.0"}\n');
  for (const name of ['alpha', 'beta', 'toolkit-setup']) writeIn(path.join(checkout, 'skills', name, 'SKILL.md'), `${name} v1\n`);
  writeIn(path.join(checkout, ...N8N_REL, 'n8n-one-official', 'SKILL.md'), 'n8n v1\n');
  gitIn(checkout, ['init', '-q', '-b', 'main']);
  const commit = (message) => { gitIn(checkout, ['add', '-A']); gitIn(checkout, ['commit', '-q', '-m', message]); return gitIn(checkout, ['rev-parse', 'HEAD']); };
  commit('one');
  fs.mkdirSync(path.join(homeDir, '.gemini'), { recursive: true });
  const portable = new AntigravityGlobalSkills({ toolkitRoot: checkout, homeDir });
  const n8n = new OfficialN8nSkills({ toolkitRoot: checkout, host: 'codex', homeDir, antigravity: true });
  if (copy) { portable.install(); n8n.install(); }
  const target = path.join(homeDir, '.gemini', 'config', 'skills');
  const stampPath = path.join(homeDir, '.ai-agent-toolkit', 'antigravity-refresh', 'source.json');
  const refresh = (options = {}) => new AntigravitySessionRefresh({ checkout, homeDir, ...options }).run();
  const read = (...parts) => fs.readFileSync(path.join(target, ...parts), 'utf8');
  return { dir, checkout, homeDir, target, stampPath, portable, n8n, commit, refresh, read };
}

// Every file under a folder with its bytes, to prove a run wrote nothing there.
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full); else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

test('session start refreshes only Toolkit\'s recorded Antigravity copies, from the managed checkout', async (t) => {
  const rows = [
    ['M1 no ledger: nothing is written and no Antigravity folder is created', (f) => {
      fs.rmSync(path.join(f.homeDir, '.gemini'), { recursive: true });
      assert.equal(f.refresh().status, 'not-opted-in');
      assert.equal(fs.existsSync(path.join(f.homeDir, '.gemini')), false);
      fs.mkdirSync(path.join(f.homeDir, '.gemini'));
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n'); f.commit('two');
      assert.equal(f.refresh().status, 'not-opted-in');
      assert.deepEqual(snapshot(path.join(f.homeDir, '.gemini')), {});
      assert.equal(fs.existsSync(f.stampPath), false);
    }, { copy: false }],
    ['M2 a changed source skill is refreshed and reported', (f) => {
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n'); f.commit('two');
      const result = f.refresh();
      assert.equal(result.status, 'updated');
      assert.equal(result.copied, 1);
      assert.equal(f.read('alpha', 'SKILL.md'), 'alpha v2\n');
      assert.equal(f.read('beta', 'SKILL.md'), 'beta v1\n');
      assert.equal(fs.existsSync(path.join(f.target, 'toolkit-setup')), false, 'Toolkit-only skills stay out');
    }],
    ['M3 a skill Toolkit added is copied and recorded', (f) => {
      writeIn(path.join(f.checkout, 'skills', 'gamma', 'SKILL.md'), 'gamma v1\n'); f.commit('two');
      assert.equal(f.refresh().status, 'updated');
      assert.equal(f.read('gamma', 'SKILL.md'), 'gamma v1\n');
      assert.ok(f.portable.recorded().some((row) => row.skill === 'gamma'));
    }],
    ['M4 a retired skill\'s copy and ledger entry are pruned', (f) => {
      fs.rmSync(path.join(f.checkout, 'skills', 'beta'), { recursive: true }); f.commit('two');
      const result = f.refresh();
      assert.equal(result.status, 'updated');
      assert.equal(result.pruned, 1);
      assert.equal(fs.existsSync(path.join(f.target, 'beta')), false);
      assert.equal(f.portable.recorded().some((row) => row.skill === 'beta'), false);
    }],
    ['M5 a hand copy with a Toolkit skill\'s name is never changed or recorded', (f) => {
      writeIn(path.join(f.target, 'gamma', 'SKILL.md'), 'mine\n');
      writeIn(path.join(f.checkout, 'skills', 'gamma', 'SKILL.md'), 'gamma v1\n'); f.commit('two');
      const result = f.refresh();
      assert.equal(result.status, 'current', 'a hand copy alone is nothing to refresh');
      assert.equal(f.read('gamma', 'SKILL.md'), 'mine\n');
      assert.equal(f.portable.recorded().some((row) => row.skill === 'gamma'), false);
    }],
    ['M6 Antigravity gone: nothing is written', (f) => {
      fs.rmSync(path.join(f.homeDir, '.gemini'), { recursive: true });
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n'); f.commit('two');
      assert.equal(f.refresh().status, 'not-installed');
      assert.equal(fs.existsSync(path.join(f.homeDir, '.gemini')), false);
      assert.equal(fs.existsSync(f.stampPath), false);
    }],
    ['M7 and S3 another refresh holds the lock: nothing is written, no stamp, and the next start refreshes', (f) => {
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n'); f.commit('two');
      assert.equal(f.refresh({ lock: () => ({ acquired: false, release() {} }) }).status, 'busy');
      assert.equal(f.read('alpha', 'SKILL.md'), 'alpha v1\n');
      assert.equal(fs.existsSync(f.stampPath), false);
      assert.equal(f.refresh().status, 'updated');
      assert.equal(f.read('alpha', 'SKILL.md'), 'alpha v2\n');
    }],
    ['M8 and S3 a copy that fails (a file held open) is reported by its code only, keeps its ledger entry and heals next start', (f) => {
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n'); f.commit('two');
      const original = fs.copyFileSync;
      fs.copyFileSync = () => { throw Object.assign(new Error(`EBUSY: resource busy or locked, copyfile '${f.target}'`), { code: 'EBUSY' }); };
      let result;
      try { result = f.refresh(); } finally { fs.copyFileSync = original; }
      assert.equal(result.status, 'failed');
      assert.equal(result.error, 'EBUSY');
      const check = sessionRefreshCheck(result);
      assert.equal(check.status, 'action-required');
      assert.match(check.summary, /file error EBUSY/);
      assert.equal(`${check.summary} ${check.action}`.includes(f.homeDir), false, 'no private path');
      assert.ok(f.portable.recorded().some((row) => row.skill === 'alpha'), 'the interrupted copy is still Toolkit\'s');
      assert.equal(fs.existsSync(f.stampPath), false);
      assert.equal(f.refresh().status, 'updated');
      assert.equal(f.read('alpha', 'SKILL.md'), 'alpha v2\n');
    }],
    ['M10 a ledger path outside Antigravity\'s skills folder is never touched', (f) => {
      const elsewhere = path.join(f.homeDir, 'elsewhere', 'skills');
      writeIn(path.join(elsewhere, 'alpha', 'SKILL.md'), 'not Toolkit\'s\n');
      const ledgerPath = path.join(f.homeDir, '.ai-agent-toolkit', 'antigravity-toolkit-skills.json');
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      ledger.targets[elsewhere] = ['alpha', 'retired'];
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n'); f.commit('two');
      assert.equal(f.refresh().status, 'updated');
      assert.equal(fs.readFileSync(path.join(elsewhere, 'alpha', 'SKILL.md'), 'utf8'), 'not Toolkit\'s\n');
      assert.equal(f.read('alpha', 'SKILL.md'), 'alpha v2\n');
    }],
    ['M12 and S2 a new commit with nothing to copy compares once, copies nothing, stamps, and stays silent', (f) => {
      writeIn(path.join(f.checkout, 'README.md'), 'docs only\n');
      const head = f.commit('two');
      const before = snapshot(f.target);
      const result = f.refresh();
      assert.equal(result.status, 'current');
      assert.equal(sessionRefreshCheck(result), null);
      assert.deepEqual(snapshot(f.target), before);
      assert.equal(JSON.parse(fs.readFileSync(f.stampPath, 'utf8')).source_commit, head);
    }],
    ['N1 a changed official n8n skill is refreshed in Antigravity in the same run', (f) => {
      writeIn(path.join(f.checkout, ...N8N_REL, 'n8n-one-official', 'SKILL.md'), 'n8n v2\n'); f.commit('two');
      const result = f.refresh();
      assert.equal(result.status, 'updated');
      assert.equal(f.read('n8n-one-official', 'SKILL.md'), 'n8n v2\n');
    }],
    ['N2 without the Antigravity ledger, n8n copies recorded there are never refreshed at session start', (f) => {
      f.portable.remove();
      writeIn(path.join(f.checkout, ...N8N_REL, 'n8n-one-official', 'SKILL.md'), 'n8n v2\n'); f.commit('two');
      const before = snapshot(f.target);
      assert.equal(f.refresh().status, 'not-opted-in');
      assert.deepEqual(snapshot(f.target), before);
    }],
    ['N3 the n8n copies in the apps\' own skills folders stay setup-only, and their ledger entries stay', (f) => {
      const appFolder = path.join(f.homeDir, '.agents', 'skills');
      writeIn(path.join(f.checkout, ...N8N_REL, 'n8n-one-official', 'SKILL.md'), 'n8n v2\n'); f.commit('two');
      const ledgerPath = path.join(f.homeDir, '.ai-agent-toolkit', 'n8n-official-skills.json');
      assert.equal(f.refresh().status, 'updated');
      assert.equal(fs.readFileSync(path.join(appFolder, 'n8n-one-official', 'SKILL.md'), 'utf8'), 'n8n v1\n');
      assert.deepEqual(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).targets[appFolder], ['n8n-one-official']);
    }],
    ['N4 a hand copy with an n8n skill\'s name in Antigravity is never changed', (f) => {
      f.n8n.remove(f.n8n.antigravityTarget());
      writeIn(path.join(f.target, 'n8n-one-official', 'SKILL.md'), 'mine\n');
      writeIn(path.join(f.checkout, ...N8N_REL, 'n8n-one-official', 'SKILL.md'), 'n8n v2\n'); f.commit('two');
      f.refresh();
      assert.equal(f.read('n8n-one-official', 'SKILL.md'), 'mine\n');
    }],
    ['S1 a stamp that matches the checkout costs no lock, no compare and no read of Antigravity\'s folder', (f) => {
      assert.equal(f.refresh().status, 'current', 'the first start compares once and stamps');
      fs.appendFileSync(path.join(f.target, 'alpha', 'SKILL.md'), 'edited by hand\n');
      let locks = 0;
      let compares = 0;
      const inspect = ManagedSkillCopies.prototype.inspect;
      ManagedSkillCopies.prototype.inspect = function counted() { compares += 1; return inspect.call(this); };
      let result;
      try { result = f.refresh({ lock: () => { locks += 1; return { acquired: true, release() {} }; } }); }
      finally { ManagedSkillCopies.prototype.inspect = inspect; }
      assert.deepEqual([result.status, locks, compares], ['current', 0, 0]);
      assert.equal(sessionRefreshCheck(result), null);
      assert.match(f.read('alpha', 'SKILL.md'), /edited by hand/, 'known limit: a hand edit waits for the next Toolkit update or setup');
    }],
    ['S4 a missing, unreadable or foreign stamp counts as changed: one full compare', (f) => {
      writeIn(path.join(f.checkout, 'skills', 'alpha', 'SKILL.md'), 'alpha v2\n');
      const head = f.commit('two');
      for (const stamp of [null, 'not json', '[]', JSON.stringify({ schema: 'other', source_commit: head }), JSON.stringify({ schema: 'ai-agent-toolkit.antigravity-refresh.v1', source_commit: 42 })]) {
        fs.rmSync(f.stampPath, { force: true });
        if (stamp !== null) writeIn(f.stampPath, stamp);
        fs.appendFileSync(path.join(f.target, 'alpha', 'SKILL.md'), 'stale\n');
        assert.equal(f.refresh().status, 'updated', String(stamp));
        assert.equal(f.read('alpha', 'SKILL.md'), 'alpha v2\n');
      }
    }],
  ];
  for (const [name, check, options] of rows) await t.test(name, (st) => check(opted(st, options)));
});

test('the session-start check reports only a change or a failure', () => {
  assert.equal(sessionRefreshCheck({ status: 'not-opted-in' }), null);
  for (const status of ['current', 'not-installed', 'busy', 'no-source']) assert.equal(sessionRefreshCheck({ status }), null, status);
  const updated = sessionRefreshCheck({ status: 'updated', copied: 2, pruned: 1, source: 'abc1234def567' });
  assert.equal(updated.status, 'passed');
  assert.equal(updated.updated, true);
  assert.equal(updated.run, 'abc1234def567', 'a later refresh on another commit gets its own update report');
  assert.match(updated.summary, /refreshed 2 and removed 1 retired.*Start a new Antigravity session to load the changed skills\./);
});

test('the checkout commit is read from git files alone: loose or packed branch, detached, linked worktree', (t) => {
  const { checkoutCommit } = require('../scripts/toolkit-antigravity-project-skills.cjs');
  const f = opted(t, { copy: false });
  const head = gitIn(f.checkout, ['rev-parse', 'HEAD']);
  assert.equal(checkoutCommit(f.checkout), head, 'loose ref');
  gitIn(f.checkout, ['pack-refs', '--all']);
  assert.equal(fs.existsSync(path.join(f.checkout, '.git', 'refs', 'heads', 'main')), false);
  assert.equal(checkoutCommit(f.checkout), head, 'packed ref');
  const worktree = path.join(f.dir, 'worktree');
  gitIn(f.checkout, ['worktree', 'add', '-q', '-b', 'side', worktree]);
  writeIn(path.join(worktree, 'README.md'), 'side\n');
  gitIn(worktree, ['add', '-A']); gitIn(worktree, ['commit', '-q', '-m', 'side']);
  assert.equal(checkoutCommit(worktree), gitIn(worktree, ['rev-parse', 'HEAD']), 'linked worktree');
  gitIn(f.checkout, ['checkout', '-q', '--detach']);
  assert.equal(checkoutCommit(f.checkout), head, 'detached');
  assert.equal(checkoutCommit(path.join(f.dir, 'missing')), '', 'unreadable counts as changed');
});
