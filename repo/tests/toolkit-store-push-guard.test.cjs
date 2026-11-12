'use strict';

// A raw git push to an evidence store this computer has bound is refused by the shell hooks: store
// work goes through toolkit-store.cjs. Pushes elsewhere, dry runs, the store command itself and a
// computer with no cached binding are not judged here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');
const guard = require('../scripts/toolkit-attribution-guard.cjs');
const { seedMerged } = require('./support/governance-observations.cjs');

const STORE = 'https://github.com/example-owner/evidence-store.git';

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-store-push-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const registryOptions = { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  const repo = (name, remotes) => {
    const root = path.join(dir, name);
    fs.mkdirSync(root, { recursive: true });
    childProcess.execFileSync('git', ['init', '--quiet', root]);
    for (const [remote, url] of remotes) childProcess.execFileSync('git', ['-C', root, 'remote', 'add', remote, url]);
    return root;
  };
  const governed = repo('governed', [['origin', 'https://github.com/example-owner/governed.git']]);
  const store = repo('store', [['origin', STORE]]);
  const other = repo('other', [['origin', 'git@github.com:example-owner/other-repo.git'], ['backup', 'git@github.com:Example-Owner/Evidence-Store.git']]);
  return { dir, home, registryOptions, governed, store, other, bind: () => seedMerged(governed, 'enable', { registryOptions }) };
}

const refuse = (f, command, cwd, shell = null) => guard.storePushRefusal(command, cwd, 0, f.registryOptions, shell);

test('raw pushes to a bound store are refused in every shape the shell walker reads', (t) => {
  const f = fixture(t);
  f.bind();
  for (const [command, cwd] of [
    ['git push', f.store],
    ['git push origin main', f.store],
    ['git push origin HEAD:refs/heads/main', f.store],
    ['git push --delete origin old', f.store],
    ['git push origin :old', f.store],
    ['git push -u origin feature', f.store],
    [`git -C "${f.store}" push origin main`, f.governed],
    [`git -c push.default=current -C "${f.store}" push`, f.governed],
    [`cd "${f.store}" && git push`, f.governed],
    [`git -C "${f.store}" add archives/x && git -C "${f.store}" commit -m x && git -C "${f.store}" push`, f.governed],
    [`bash -lc "cd '${f.store}' && git push origin main"`, f.governed],
    [`git push ${STORE} main`, f.governed],
    ['git push git@github.com:example-owner/evidence-store main', f.governed],
    ['git push backup main', f.other],
    ['git push', f.other],
    [`git push --repo=${STORE} main`, f.governed],
    [`git push --repo ${STORE} main`, f.governed],
    [`git --git-dir="${f.store}/.git" push origin main`, f.governed],
    [`git --git-dir "${f.store}/.git" --work-tree "${f.store}" push`, f.governed],
    [`GIT_DIR="${f.store}/.git" git push origin main`, f.governed],
    ['git push ssh://git@github.com:22/example-owner/evidence-store.git main', f.governed],
    ['git push ssh://git@ssh.github.com:443/example-owner/evidence-store.git main', f.governed],
    ['git push https://www.github.com/example-owner/evidence-store main', f.governed],
    ['git push https://x-access-token:abc@github.com/example-owner/evidence-store.git main', f.governed],
  ]) assert.equal(refuse(f, command, cwd), guard.STORE_PUSH_MESSAGE, command);
  for (const command of [`Set-Location "${f.store}"; git push origin main`, `Push-Location "${f.store}"; git push origin main`, `pushd "${f.store}"; git push`]) {
    assert.equal(refuse(f, command, f.governed, 'powershell'), guard.STORE_PUSH_MESSAGE, `PowerShell: ${command}`);
  }
});

test('other pushes, dry runs and the store command itself are not judged here', (t) => {
  const f = fixture(t);
  f.bind();
  for (const [command, cwd] of [
    ['git push origin feature', f.governed],
    ['git push origin main', f.other],
    [`git -C "${f.governed}" push origin feature`, f.store],
    ['git push --dry-run origin main', f.store],
    ['git push -n origin main', f.store],
    ['git status && git fetch origin', f.store],
    ['git commit -m "fix push logic"', f.store],
    [`node "${f.dir}/tk/repo/scripts/toolkit-store.cjs" save --store "${f.store}" --path archives/x --message x`, f.store],
    ['git push https://github.com/example-owner/evidence-store-copy.git main', f.governed],
    [`git push --repo=${STORE} feature`.replace('evidence-store', 'governed'), f.governed],
    [`git --git-dir="${f.governed}/.git" push origin main`, f.store],
    ['git push https://github.com.evil.example/example-owner/evidence-store main', f.governed],
  ]) assert.equal(refuse(f, command, cwd), '', command);
});

test('a computer with no cached binding keeps today\'s behaviour', (t) => {
  const f = fixture(t);
  assert.equal(refuse(f, 'git push origin main', f.store), '');
  assert.equal(refuse(f, `git push ${STORE} main`, f.governed), '');
});

test('the hook decision refuses a raw store push on both hosts, with the store command named', (t) => {
  const f = fixture(t);
  f.bind();
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = f.home; process.env.USERPROFILE = f.home;
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const host of ['claude', 'codex']) {
    const decision = guard.attributionDecision({ tool_name: 'Bash', cwd: f.store, tool_input: { command: 'git push origin main' } }, { host });
    assert.equal(decision.hookSpecificOutput?.permissionDecision, 'deny', host);
    assert.match(decision.hookSpecificOutput.permissionDecisionReason, /toolkit-store\.cjs" save/);
  }
});
