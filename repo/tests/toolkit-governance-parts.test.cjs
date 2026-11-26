'use strict';

// The governance App and evidence store nags (repo/scripts/toolkit-governance-parts.cjs, INT-TK421-1360):
// what a store read means, which saved results give a session-start line, that unknown is never
// missing, and that GitHub is read at most once a day (once an hour while unread) in the background.
// Every test uses its own temp state folder and a fake GitHub reader; nothing reaches the network.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const parts = require('../scripts/toolkit-governance-parts.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');

const NOW = Date.parse('2026-11-26T10:00:00Z');
const HOUR = 3600000;
const STORE = 'acme/TRANSPORT-app';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-parts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registryOptions = { testOnly: true, stateDirectory: path.join(dir, 'state') };
  const started = [];
  const state = { state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root: dir, repository_id: 'repo-id-1', repository: 'acme/app' };
  const deps = (hoursLater = 0, extra = {}) => ({ now: () => new Date(NOW + hoursLater * HOUR).toISOString(), store: STORE, startCheck: root => started.push(root), ...extra });
  const save = (result, hoursAgo = 0) => parts.record(registryOptions, state.repository_id, { storeRepository: STORE, ...result }, { now: new Date(NOW - hoursAgo * HOUR) });
  return { dir, registryOptions, started, state, deps, save, lines: (hoursLater, extra) => parts.sessionLines(state, registryOptions, deps(hoursLater, extra)) };
}

const APP_MISSING = { variable: 'missing', secret: 'missing' };
const APP_SET = { variable: 'found', secret: 'found' };
const USABLE = { state: 'usable' };

test('P-1 a store read is usable only when it exists, is private and this sign-in can write it; anything unread is unverified', () => {
  const answer = value => () => ({ ok: true, value });
  assert.deepEqual(parts.storeState(STORE, { reader: answer({ private: true, permissions: { push: true } }) }), { state: 'usable' });
  assert.deepEqual(parts.storeState(STORE, { reader: answer({ private: false, permissions: { push: true } }) }), { state: 'not-private' });
  assert.deepEqual(parts.storeState(STORE, { reader: answer({ private: true, permissions: { push: false } }) }), { state: 'read-only' });
  assert.deepEqual(parts.storeState(STORE, { reader: () => ({ ok: false, reason: 'repository-not-visible' }) }), { state: 'missing' });
  assert.deepEqual(parts.storeState(STORE, { reader: () => ({ ok: false, reason: 'gh-unavailable' }) }), { state: 'unverified', reason: 'gh-unavailable' });
  assert.equal(parts.storeState(STORE, { reader: () => { throw new Error('boom'); } }).state, 'unverified');
  assert.equal(parts.storeState(STORE, { reader: answer({ private: true }) }).state, 'unverified', 'no permissions in the answer');
  assert.equal(parts.storeState(STORE, { reader: answer({ permissions: { push: true } }) }).state, 'unverified', 'no visibility in the answer');
  const asked = [];
  assert.equal(parts.storeState('not a repo', { reader: args => { asked.push(args); return { ok: true, value: {} }; } }).state, 'unverified');
  assert.deepEqual(asked, [], 'a name that is not owner/name is never sent to GitHub');
});

test('P-2 a missing or partly set up App gives one line; set up or unknown gives none', t => {
  const fx = fixture(t);
  fx.save({ app: APP_MISSING, store: USABLE });
  const missing = fx.lines();
  assert.equal(missing.length, 1);
  assert.match(missing[0], /^Toolkit governance: the Governance App is not set up on acme\/app \(GitHub lists neither its variable nor its secret\), so the governance jobs on GitHub \(the cloud sweep and the shard refresh\) do nothing; everything else, this computer's own refresh included, still works\. In your first reply, tell the user once, in one line, that saying `refresh governance` gives the one line that sets it up; nothing waits on it\.$/);
  fx.save({ app: { variable: 'found', secret: 'missing' } });
  assert.match(fx.lines()[0], /only partly set up on acme\/app \(variable found, secret missing\).*saying `refresh governance` shows how to finish it/);
  for (const app of [APP_SET, { variable: 'unverified', secret: 'missing', reason: 'gh-unavailable' }, { variable: 'missing', secret: 'unverified' }]) {
    fx.save({ app });
    assert.deepEqual(fx.lines(), [], JSON.stringify(app));
  }
});

test('P-3 a store that cannot be used gives one line naming it and what is wrong; usable, unknown or another store gives none', t => {
  const fx = fixture(t);
  for (const [state, why] of [['missing', 'cannot be found with this computer\'s GitHub sign-in'], ['not-private', 'is not private'], ['read-only', 'cannot be written with this computer\'s GitHub sign-in']]) {
    fx.save({ app: APP_SET, store: { state } });
    const lines = fx.lines();
    assert.equal(lines.length, 1, state);
    assert.equal(lines[0], `Toolkit governance: the evidence store ${STORE} named in the programme file ${why}, so programme records and evidence cannot be saved and every governance step that writes them stops until it is fixed. In your first reply, tell the user once, in one line, what is wrong and that saying \`change store\` sets up a store with the controller.`);
  }
  fx.save({ app: APP_SET, store: { state: 'unverified', reason: 'gh-unavailable' } });
  assert.deepEqual(fx.lines(), []);
  fx.save({ app: APP_SET, store: { state: 'missing' } });
  assert.deepEqual(fx.lines(0, { store: 'acme/TRANSPORT-other' }), [], 'a result for a store the programme file no longer names');
  // Both parts at once: two lines, App first.
  fx.save({ app: APP_MISSING, store: { state: 'not-private' } });
  assert.deepEqual(fx.lines().map(line => /Governance App|evidence store/.exec(line)[0]), ['Governance App', 'evidence store']);
});

test('P-4 GitHub is checked in the background at most once a day, once an hour while unread, and one session starts it', t => {
  const fx = fixture(t);
  // Nothing saved yet: one start, claimed so a second session at the same moment starts none.
  assert.deepEqual(fx.lines(), []);
  assert.equal(fx.started.length, 1);
  fx.lines();
  assert.equal(fx.started.length, 1, 'claimed for an hour');
  // A full result: nothing more for a day.
  fx.save({ app: APP_SET, store: USABLE });
  fx.lines(2);
  fx.lines(23);
  assert.equal(fx.started.length, 1);
  fx.lines(24);
  assert.equal(fx.started.length, 2);
  // An unread part: checked again after an hour, not a day.
  const fy = fixture(t);
  fy.save({ app: { variable: 'unverified', secret: 'unverified', reason: 'offline' }, store: USABLE });
  fy.lines(0.5);
  assert.equal(fy.started.length, 0);
  fy.lines(1);
  assert.equal(fy.started.length, 1);
  // A result for an older store is checked again at once.
  const fz = fixture(t);
  fz.save({ app: APP_SET, store: USABLE });
  fz.lines(0, { store: 'acme/TRANSPORT-new' });
  assert.equal(fz.started.length, 1);
});

test('P-5 offline and test runs start nothing; a broken state folder drops the lines and never throws', t => {
  const fx = fixture(t);
  fx.save({ app: APP_MISSING, store: USABLE }, 48);
  const offline = parts.sessionLines(fx.state, fx.registryOptions, { now: () => new Date(NOW).toISOString(), store: STORE });
  assert.equal(offline.length, 1, 'the saved result is still shown');
  const env = parts.sessionLines(fx.state, { ...fx.registryOptions, testOnly: true }, { now: () => new Date(NOW).toISOString(), store: STORE, environment: { TOOLKIT_GOVERNANCE_OFFLINE: '1' } });
  assert.equal(env.length, 1);
  assert.equal(fx.started.length, 0);
  for (const off of [{ ...fx.state, state: 'DISABLED' }, { ...fx.state, programme_records_bind: false }, { ...fx.state, repository_id: null }]) {
    assert.deepEqual(parts.sessionLines(off, fx.registryOptions, fx.deps()), []);
  }
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-parts-file-'));
  t.after(() => fs.rmSync(broken, { recursive: true, force: true }));
  const notAFolder = path.join(broken, 'state');
  fs.writeFileSync(notAFolder, 'x');
  assert.deepEqual(parts.sessionLines(fx.state, { testOnly: true, stateDirectory: notAFolder }, fx.deps()), []);
});

test('P-6 the saved file holds only ids, names, states and times, never anything else GitHub sent', t => {
  const fx = fixture(t);
  fx.save({ app: { variable: 'found', secret: 'missing', reason: 'x'.repeat(300), token: 'ghp_notreal' }, store: { state: 'usable', html_url: 'https://example.com', owner: { login: 'someone' } } });
  const saved = JSON.parse(fs.readFileSync(path.join(fx.registryOptions.stateDirectory, parts.BASENAME), 'utf8'));
  assert.equal(saved.schema, parts.SCHEMA);
  const entry = saved.repositories['repo-id-1'];
  assert.deepEqual(Object.keys(entry).sort(), ['app', 'checked_at', 'store']);
  assert.deepEqual(Object.keys(entry.app).sort(), ['reason', 'secret', 'variable']);
  assert.equal(entry.app.reason.length, 60);
  assert.deepEqual(entry.store, { repository: STORE, state: 'usable' });
  // A state outside the known set is not saved.
  assert.equal(parts.record(fx.registryOptions, 'repo-id-2', { app: { variable: 'yes', secret: 'found' }, store: { state: 'great' }, storeRepository: STORE }), null);
});

test('P-8 the background check reads only the App names and the store, from the merged programme file, and saves the result', t => {
  const support = require('./toolkit-governed-fixture-support.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-parts-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const repo = support.makeGoverned(path.join(dir, 'work'), 'parts', { home });
  const registryOptions = { testOnly: true, userHome: home };
  const asked = [];
  const reader = ([url]) => {
    asked.push(url);
    if (url.endsWith('/variables?per_page=100')) return { ok: true, value: { total_count: 0, variables: [] } };
    if (url.endsWith('/secrets?per_page=100')) return { ok: true, value: { total_count: 0, secrets: [] } };
    return { ok: false, reason: 'repository-not-visible' };
  };
  parts.check(repo, { registryOptions, reader, now: new Date(NOW) });
  assert.deepEqual(asked, ['repos/toolkit-test-fixture/parts/actions/variables?per_page=100', 'repos/toolkit-test-fixture/parts/actions/secrets?per_page=100', 'repos/toolkit-test-fixture/store']);
  const state = require('../scripts/toolkit-governance-state.cjs').governanceState(repo, registryOptions);
  assert.equal(state.programme_records_bind, true);
  const lines = parts.sessionLines(state, registryOptions, { now: () => new Date(NOW).toISOString() });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Governance App is not set up on toolkit-test-fixture\/parts/);
  assert.match(lines[1], /evidence store toolkit-test-fixture\/store named in the programme file cannot be found/);
  // Governance off: nothing is read.
  asked.length = 0;
  support.recordAbsent(repo, { home });
  assert.equal(parts.check(repo, { registryOptions, reader, now: new Date(NOW) }), null);
  assert.deepEqual(asked, []);
});

test('P-7 a governed session start carries the lines from the last check; off, undecided and cloud texts do not', t => {
  const fx = fixture(t);
  fx.save({ app: APP_MISSING, store: { state: 'missing' } });
  const line = state => gate.sessionLine(fx.dir, { registryOptions: fx.registryOptions, stateReader: () => state, programmeDeps: { ...fx.deps(), permissions: () => ({ checked: true, missing: 0, stale: 0 }) } });
  const text = line(fx.state);
  assert.match(text, /^Toolkit governance: ENABLED/);
  assert.match(text, /the Governance App is not set up on acme\/app/);
  assert.match(text, /the evidence store acme\/TRANSPORT-app named in the programme file cannot be found/);
  assert.doesNotMatch(line({ ...fx.state, state: 'DISABLED', rule: 'M2' }), /Governance App|evidence store acme/);
  assert.doesNotMatch(line({ ...fx.state, programme_records_bind: false }), /Governance App is not set up/);
});
