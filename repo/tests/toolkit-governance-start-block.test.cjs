'use strict';

// What a session start says while a governed repository's setup is not complete (INT-TK421-1386, 1387;
// the second-chat evidence of 27 Nov 2026 in a fresh test repository: App not set up, permissions
// never set up, local main behind and not moved, GitHub Free, first sweep still running at the
// finish). One block leads the text every session: what is held, each missing part with its one step,
// the checkout that could not move; the finish's GitHub Free line and the first sweep's counts are
// said once each. Nothing in it says "nothing waits on it" or "no action needed".
// Fixtures only: an isolated user-state folder, a fake GitHub for the sweep; no network.

const assert = require('node:assert/strict');
const test = require('node:test');

const gate = require('../scripts/toolkit-governance-gate.cjs');
const finishing = require('../scripts/toolkit-governance-finish.cjs');
const firstSweep = require('../scripts/toolkit-governance-first-sweep.cjs');
const { APP, PERMISSIONS, SLUG, STORE, readyRepo } = require('./support/governance-ready-fixture.cjs');

const STUCK = 'Toolkit: local main is 2 commits behind origin/main and was not moved: uncommitted changes. The agent lists the changed or extra files for the user to keep or drop (Toolkit clears untracked copies identical to the merged ones itself); the next session start then moves it.';
const COUNTS = '0 found (0 in files, 0 in commit messages, 0 in pull request text, 0 in comments), 0 not readable';
const PASSIVE = /nothing waits on it|no action needed/i;
const count = (text, part) => text.split(part).length - 1;

function start(f, { permissions = PERMISSIONS.never, localCopy = null, reads = [] } = {}) {
  return gate.sessionLine(f.repo, { registryOptions: f.registryOptions, host: 'claude', localCopy,
    programmeDeps: { permissions: () => permissions, store: STORE, startCheck: () => {}, startSweepRead: root => reads.push(root) } });
}

// The finish as it ended in the evidence: protection and rulesets not available on GitHub Free, and the
// first sweep still going (run 77), its result owed.
function finished(f) {
  const id = f.state().repository_id;
  finishing.markPending(f.registryOptions, id, { proposal: 2, firstSweep: true });
  finishing.record(f.registryOptions, id, {
    result: 'done', on: ['the free dependency and security settings'], unavailable: ['the no-force-push ruleset', 'default-branch protection'], held: [],
    reports: [`First personal data sweep: started, and its list (places and rule names only) will be at https://github.com/${SLUG}/actions/runs/77; a later session here shows its counts. On a public repository anyone can read it. It changes and posts nothing.`],
    files: [], sweep_owed: { run: 77 },
  });
}

function fakeSweepGitHub() {
  return args => {
    const [endpoint] = args;
    if (endpoint === `repos/${SLUG}/actions/runs/77`) return { ok: true, value: { id: 77, status: 'completed', conclusion: 'success', created_at: '2026-11-27T18:37:00Z' } };
    if (endpoint === `repos/${SLUG}/actions/runs/77/jobs?per_page=20`) return { ok: true, value: { jobs: [{ name: 'sweep', id: 501 }] } };
    if (endpoint === `repos/${SLUG}/check-runs/501/annotations?per_page=50`) return { ok: true, value: [{ title: 'Toolkit personal data sweep', message: COUNTS }] };
    return { ok: false, reason: 'not-found' };
  };
}

test('SB-1 the start text leads with one held block naming each missing part with its one step, never as optional', t => {
  const f = readyRepo(t);
  f.saveParts({ app: APP.missing, store: { state: 'usable' } });
  const text = start(f, { localCopy: STUCK });
  assert.match(text, /^Toolkit governance: held until setup is complete\./);
  assert.match(text, /\n- Held: Governance is on but held until setup is complete: programme records, gate records and task auto-merge wait; evidence saves still work\.\n/);
  assert.match(text, /\n- Governance App: Not set up on example-owner\/example-repo \(GitHub lists neither its variable nor its secret\)\. Say `toolkit governance` for the one line that sets it up\.\n/);
  assert.match(text, /\n- Toolkit permissions \(Claude Code, this computer\): Not set up\. Say `toolkit permissions` for the one command\./);
  assert.doesNotMatch(text, PASSIVE);
  assert.equal(count(text, 'Governance App'), 1, 'the App is named once, in the block');
  assert.equal(count(text, 'Toolkit permissions'), 1, 'the permissions are named once, in the block');
});

test('SB-2 a checkout that could not move is one line inside the block, with its reason and step', t => {
  const f = readyRepo(t);
  f.saveParts({ app: APP.missing, store: { state: 'usable' } });
  const text = start(f, { localCopy: STUCK });
  assert.equal(count(text, 'behind origin/main'), 1);
  assert.match(text, /\n- Local copy: main is 2 commits behind origin\/main and was not moved: uncommitted changes\. The agent lists the changed or extra files for the user to keep or drop/);
  // A checkout that moved is not a problem: it leads the text as before, outside the block.
  const moved = 'Toolkit: brought local main up to date with origin/main (1111111 to 2222222, 2 commits).';
  const text2 = start(f, { localCopy: moved });
  assert.ok(text2.startsWith(`${moved}\nToolkit governance: held until setup is complete.`));
});

test('SB-3 the GitHub Free line is said once, and the first sweep counts once a later start has read them', t => {
  const f = readyRepo(t);
  f.saveParts({ app: APP.missing, store: { state: 'usable' } });
  finished(f);
  const reads = [];
  const first = start(f, { reads });
  assert.equal(count(first, 'GitHub Free'), 1, 'the finish line, with the GitHub Free fallback, once');
  assert.match(first, /\n- Setup: governance setup finished here\. On and read back: the free dependency and security settings\. Not set: GitHub cannot enforce the no-force-push ruleset and default-branch protection on a private repository on GitHub Free/);
  assert.match(first, /\n- First personal data sweep: started/);
  assert.doesNotMatch(first, PASSIVE);
  // The next start: still held (every session), no GitHub Free line again, and the sweep's result is read
  // in the background, once.
  const second = start(f, { reads });
  assert.match(second, /^Toolkit governance: held until setup is complete\./);
  assert.equal(count(second, 'GitHub Free'), 0);
  assert.equal(count(second, 'First personal data sweep'), 0);
  assert.deepEqual(reads, [f.repo]);
  assert.equal(start(f, { reads }).includes('First personal data sweep'), false);
  assert.equal(reads.length, 1, 'the background read starts at most once per gap');
  // The background read finds the run finished; the next start shows its counts and link once.
  assert.ok(firstSweep.readOwed(f.repo, { registryOptions: f.registryOptions, sweep: new firstSweep.FirstInstallSweep({ gh: fakeSweepGitHub() }) }));
  const third = start(f, { reads });
  assert.equal(count(third, COUNTS), 1);
  assert.match(third, new RegExp(`- First personal data sweep: ${COUNTS.replace(/[()]/g, '\\$&')}; the list \\(places and rule names only\\) is at https://github\\.com/${SLUG}/actions/runs/77`));
  assert.equal(count(start(f, { reads }), COUNTS), 0, 'said once');
});

test('SB-4 a run still going when read again saves nothing, so a later start reads it once more', t => {
  const f = readyRepo(t);
  finished(f);
  start(f);
  const going = args => (args[0] === `repos/${SLUG}/actions/runs/77` ? { ok: true, value: { id: 77, status: 'in_progress' } } : { ok: false, reason: 'not-found' });
  assert.equal(firstSweep.readOwed(f.repo, { registryOptions: f.registryOptions, sweep: new firstSweep.FirstInstallSweep({ gh: going }) }), null);
  assert.equal(finishing.entryFor(f.registryOptions, f.state().repository_id).status, 'sweep-owed');
  // A result still unread three days on is said once, then dropped: never owed for ever.
  const later = () => new Date(Date.now() + 4 * 24 * 3600000);
  const lapsed = gate.sessionLine(f.repo, { registryOptions: f.registryOptions, host: 'claude', programmeDeps: { permissions: () => PERMISSIONS.never, store: STORE, startCheck: () => {}, startSweepRead: () => {}, now: later } });
  assert.equal(count(lapsed, 'First personal data sweep: its result could not be read here within three days'), 1);
  assert.equal(finishing.entryFor(f.registryOptions, f.state().repository_id), null);
});

test('SB-5 ready, unknown or an older programme file gives no held block; drift keeps its own nag', t => {
  // Ready, with permissions one line short: drift nags and holds nothing.
  const ready = readyRepo(t);
  ready.saveParts({ app: APP.found, store: { state: 'usable' } });
  const drift = start(ready, { permissions: PERMISSIONS.drift });
  assert.doesNotMatch(drift, /held until setup is complete/);
  assert.match(drift, /Toolkit permission lines on this computer are out of date \(1 missing\)/);
  // Unknown parts never hold.
  const unknown = readyRepo(t);
  unknown.saveParts({ app: APP.unread });
  assert.doesNotMatch(start(unknown, { permissions: PERMISSIONS.current }), /held until setup is complete/);
  // An older programme file (no min_toolkit, or one before the hold): warnings only, as before.
  for (const minToolkit of [null, '3.137.0']) {
    const older = readyRepo(t, { minToolkit });
    older.saveParts({ app: APP.missing, store: { state: 'usable' } });
    const text = start(older, { localCopy: STUCK });
    assert.doesNotMatch(text, /held until setup is complete/, String(minToolkit));
    assert.ok(text.startsWith(`${STUCK}\n`), 'the catch-up line leads, outside any block');
    assert.match(text, /the Governance App is not set up on example-owner\/example-repo/);
  }
});
