'use strict';

// A governed test repository for the readiness hold (repo/scripts/toolkit-governance-ready.cjs): a
// version 2 programme file with min_toolkit, merged and read back into an isolated user-state folder,
// plus helpers that save the background check's App and store results there. Nothing reaches GitHub.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recordMerged } = require('../toolkit-governed-fixture-support.cjs');
const governance = require('../../scripts/toolkit-governance-state.cjs');
const parts = require('../../scripts/toolkit-governance-parts.cjs');
// The first min_toolkit the hold reads (toolkit-governance-ready.cjs HOLD_FROM), written out so a run on
// a copy without the hold still builds the fixture.
const HOLD_FROM = '3.199.0';

const SLUG = 'example-owner/example-repo';
const STORE = 'example-owner/TRANSPORT-example-repo';
// This computer's Toolkit permissions: never set up, set up but one line short (drift), up to date.
const PERMISSIONS = Object.freeze({
  never: Object.freeze({ checked: true, host: 'claude', app: 'Claude Code', wanted: 40, missing: 40, stale: 0 }),
  drift: Object.freeze({ checked: true, host: 'claude', app: 'Claude Code', wanted: 40, missing: 1, stale: 0 }),
  current: Object.freeze({ checked: true, host: 'claude', app: 'Claude Code', wanted: 40, missing: 0, stale: 0 }),
});
const APP = Object.freeze({ missing: { variable: 'missing', secret: 'missing' }, found: { variable: 'found', secret: 'found' }, unread: { variable: 'unverified', secret: 'unverified', reason: 'gh-unavailable' } });

// `minToolkit` null leaves the key out (an older governed repository). `home` (a scratch home this
// process already uses as its own) records the binding there, for code that reads this computer's
// default user-state; otherwise the fixture has its own user-state folder.
function readyRepo(t, { minToolkit = HOLD_FROM, taskPrs = null, home = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-ready-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'example-repo');
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  const git = args => childProcess.execFileSync('git', ['-C', repo, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  childProcess.execFileSync('git', ['init', '--quiet', '-b', 'main', repo], { windowsHide: true });
  git(['remote', 'add', 'origin', `https://github.com/${SLUG}.git`]);
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', ...(minToolkit ? { min_toolkit: minToolkit } : {}),
    parents: [{ issue: 1, record_prefix: 'INT-EX-' }], store: { kind: 'github', repository: STORE, branch: 'main', path: 'state/' },
    required_checks: ['plain-text'], ...(taskPrs ? { task_prs: taskPrs } : {}),
  }, null, 2)}\n`);
  const registryOptions = home ? {} : { registryPath: path.join(root, 'state', 'repository-governance.v1.json'), testOnly: true };
  recordMerged(repo, home ? { home } : { registryPath: registryOptions.registryPath });
  const state = () => governance.governanceState(repo, registryOptions);
  const saveParts = ({ app = null, store = null } = {}) => parts.record(registryOptions, state().repository_id, { app, store, storeRepository: STORE });
  return { root, repo, registryOptions, git, state, saveParts };
}

module.exports = Object.freeze({ APP, HOLD_FROM, PERMISSIONS, SLUG, STORE, readyRepo });
