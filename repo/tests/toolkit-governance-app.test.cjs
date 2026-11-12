'use strict';

// The governance GitHub App: turning governance on shows the owner how to set the App up, turning it
// off suggests and guides its removal, and `check` keeps reporting either. Toolkit only prints the
// owner's steps and reads whether the variable and the secret exist; it never writes either.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = require('../scripts/toolkit-governance-app.cjs');

const SLUG = 'example-owner/example-repo';
const STORE = 'example-owner/example-store';
const found = { variable: 'found', secret: 'found' };
const missing = { variable: 'missing', secret: 'missing' };

test('the App holds one permission list, and the creation link is built from it', () => {
  assert.deepEqual(app.APP.permissions, { contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' });
  const link = new URL(app.creationLink(SLUG));
  assert.equal(`${link.origin}${link.pathname}`, 'https://github.com/settings/apps/new');
  assert.equal(link.searchParams.get('name'), 'example-owner-toolkit-governance');
  assert.equal(link.searchParams.get('url'), `https://github.com/${SLUG}`);
  assert.equal(link.searchParams.get('public'), 'false');
  assert.equal(link.searchParams.get('webhook_active'), 'false');
  for (const [name, level] of Object.entries(app.APP.permissions)) assert.equal(link.searchParams.get(name), level, name);
  for (const never of ['workflows', 'secrets', 'administration']) assert.equal(link.searchParams.has(never), false, never);
});

test('every workflow token stays within the App permission list', () => {
  const folder = path.join(__dirname, '..', '..', '.github', 'workflows');
  const order = { read: 1, write: 2 };
  for (const name of fs.readdirSync(folder)) {
    const text = fs.readFileSync(path.join(folder, name), 'utf8');
    for (const [, permission, level] of text.matchAll(/^\s*permission-([a-z-]+):\s*(read|write)\s*$/gm)) {
      const key = permission.replace(/-/g, '_');
      assert.ok(order[app.APP.permissions[key]] >= order[level], `${name}: ${permission} ${level} is outside the App`);
    }
  }
});

test('setup names the link, the page checks, both repositories and the owner commands, never a value', () => {
  const text = app.setupLines(SLUG, STORE, missing).join('\n');
  assert.ok(text.includes(app.creationLink(SLUG)));
  assert.match(text, /after you merge/i);
  assert.match(text, /Toolkit never creates/);
  assert.match(text, /Active.*unticked/);
  assert.match(text, /only on this account/i);
  assert.match(text, /Contents read and write, Issues read and write, Pull requests read and write, Checks read-only, Commit statuses read-only/);
  assert.match(text, /Workflows/);
  assert.ok(text.includes(SLUG) && text.includes(STORE));
  assert.ok(text.includes(`gh variable set TOOLKIT_GOVERNANCE_APP_CLIENT_ID --repo ${SLUG} --body "<Client ID>"`));
  assert.ok(text.includes(`Get-Content -Raw "<key file>.pem" | gh secret set TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY --repo ${SLUG}`));
  assert.ok(text.includes(`gh secret set TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY --repo ${SLUG} < "<key file>.pem"`));
  assert.match(text, /Already set the App up for another repository/);
  // Without a store the install step names this repository only.
  assert.doesNotMatch(app.setupLines(SLUG, null, missing).join('\n'), /example-store/);
});

test('setup is one line once the variable and the secret exist, and says when they could not be checked', () => {
  assert.deepEqual(app.setupLines(SLUG, STORE, found), [`Governance GitHub App: the variable and the secret are set on ${SLUG}. The first governance job run proves the App is installed.`]);
  const half = app.setupLines(SLUG, STORE, { variable: 'found', secret: 'missing' }).join('\n');
  assert.match(half, /variable found, secret missing/);
  const unknown = app.setupLines(SLUG, STORE, { variable: 'unverified', secret: 'unverified', reason: 'offline' }).join('\n');
  assert.match(unknown, /could not be checked \(offline\)/);
  assert.ok(unknown.includes(app.creationLink(SLUG)));
});

test('removal suggests the owner commands and names who else still uses governance; nothing left is one line', () => {
  const text = app.removalLines(SLUG, found, ['example-owner/other-repo']).join('\n');
  assert.match(text, /after you merge/i);
  assert.match(text, /Toolkit never deletes/);
  assert.ok(text.includes(`gh variable delete TOOLKIT_GOVERNANCE_APP_CLIENT_ID --repo ${SLUG}`));
  assert.ok(text.includes(`gh secret delete TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY --repo ${SLUG}`));
  assert.match(text, /Installed GitHub Apps.*Configure.*Repository access/);
  assert.match(text, /If no other repository uses the App.*Delete GitHub App/);
  assert.match(text, /still use governance: example-owner\/other-repo/);
  assert.match(text, /Other computers/);
  assert.match(app.removalLines(SLUG, found, []).join('\n'), /knows no other repository that still uses governance/);
  assert.deepEqual(app.removalLines(SLUG, missing, []), [`Governance GitHub App: no App variable or secret is left on ${SLUG}. If the App's installation still lists ${SLUG}, remove it there (Installed GitHub Apps, Configure, Repository access).`]);
});

test('presence reads names only, in one page each, and anything unreadable is unverified, never missing', () => {
  const calls = [];
  const reader = answers => args => { calls.push(args.join(' ')); return answers.shift(); };
  const names = (key, list) => ({ ok: true, value: { total_count: list.length, [key]: list.map(name => ({ name, value: 'never-printed' })) } });
  assert.deepEqual(app.presence(SLUG, { reader: reader([names('variables', ['TOOLKIT_GOVERNANCE_APP_CLIENT_ID']), names('secrets', [])]) }), { variable: 'found', secret: 'missing' });
  assert.deepEqual(calls, [`repos/${SLUG}/actions/variables?per_page=100`, `repos/${SLUG}/actions/secrets?per_page=100`]);
  assert.deepEqual(app.presence(SLUG, { reader: reader([{ ok: false, reason: 'gh-request-failed' }, names('secrets', ['TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY'])]) }),
    { variable: 'unverified', secret: 'found', reason: 'gh-request-failed' });
  const crowded = { ok: true, value: { total_count: 101, variables: [] } };
  assert.equal(app.presence(SLUG, { reader: reader([crowded, names('secrets', [])]) }).variable, 'unverified');
  assert.deepEqual(app.presence(SLUG, { reader: () => { throw new Error('boom'); } }), { variable: 'unverified', secret: 'unverified', reason: 'reader-failed' });
  assert.deepEqual(app.presence(SLUG, { offline: true, reader: () => assert.fail('no read offline') }), { variable: 'unverified', secret: 'unverified', reason: 'offline' });
});

test('the default reader only ever sends GET requests', () => {
  const seen = [];
  const spawn = (command, args) => { seen.push(args); return { status: 0, stdout: '{"total_count":0,"variables":[],"secrets":[]}' }; };
  app.presence(SLUG, { reader: args => app.ghReader(args, { spawn }) });
  assert.equal(seen.length, 2);
  for (const args of seen) {
    assert.equal(args[0], 'api');
    assert.ok(!args.some(arg => /^(?:-X|--method|-f|-F|--field|--raw-field|--input)$/.test(arg)), args.join(' '));
  }
});

test('check findings: missing App while on, leftovers while off, nothing when off and clean', () => {
  const on = app.appFinding('ENABLED', SLUG, STORE, missing, []);
  assert.equal(on.id, 'GOVERNANCE_APP_NOT_SET_UP'); assert.equal(on.severity, 'info');
  assert.ok(on.message.includes(app.creationLink(SLUG)));
  assert.deepEqual(app.appFinding('ENABLED', SLUG, STORE, found, []).id, 'GOVERNANCE_APP_SET');
  assert.equal(app.appFinding('ENABLED', SLUG, STORE, { variable: 'unverified', secret: 'found', reason: 'offline' }, []).severity, 'unverified');
  const left = app.appFinding('DISABLED', SLUG, null, { variable: 'found', secret: 'missing' }, []);
  assert.equal(left.id, 'GOVERNANCE_APP_LEFT_OVER'); assert.equal(left.severity, 'info');
  assert.match(left.message, /gh variable delete/);
  assert.equal(app.appFinding('DISABLED', SLUG, null, missing, []), null);
  assert.equal(app.appFinding('DISABLED', SLUG, null, { variable: 'unverified', secret: 'unverified', reason: 'offline' }, []), null);
});

// ---- wired into `toolkit governance` ----------------------------------------------------------

const os = require('node:os');
const childProcess = require('node:child_process');
const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
const conformance = require('../scripts/toolkit-governance-conformance.cjs');
const governance = require('../scripts/toolkit-governance-state.cjs');
const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');

function home(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-app-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, registryPath: path.join(root, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json') };
}
const governed = (ctx, name) => makeGoverned(path.join(ctx.root, name), name, { home: ctx.root });
const sink = () => { const chunks = []; return { write: text => { chunks.push(String(text)); return true; }, text: () => chunks.join('') }; };
const answering = state => args => {
  const kind = /\/actions\/(variables|secrets)\?/.exec(args[0])[1];
  const name = kind === 'variables' ? app.APP.variable : app.APP.secret;
  const present = state[kind === 'variables' ? 'variable' : 'secret'] === 'found';
  return { ok: true, value: { total_count: present ? 1 : 0, [kind]: present ? [{ name }] : [] } };
};

test('a published disable proposal suggests the removal, naming other governed repositories this computer knows', async t => {
  const ctx = home(t), repo = governed(ctx, 'leaving');
  governed(ctx, 'staying');
  const slug = 'toolkit-test-fixture/leaving';
  const proposal = { repository: slug, number: 3, head: 'b'.repeat(40), url: `https://github.com/${slug}/pull/3`, state: 'open', answer: 'no' };
  let open = [];
  const reads = [], stdout = sink(), stderr = sink();
  const cli = new ToolkitGovernanceCli({ cwd: repo, registryOptions: { registryPath: ctx.registryPath, testOnly: true }, interactive: true, ask: async () => 'yes', stdout, stderr,
    proposalTransport: { list: () => open, publish() { open = [proposal]; return proposal; }, read: () => proposal },
    appReader: args => { reads.push(args); return answering(found)(args); } });
  assert.equal(await cli.main(['disable']), 0, stderr.text());
  const text = stdout.text();
  assert.match(text, /decision pending/);
  assert.ok(text.includes(`gh variable delete ${app.APP.variable} --repo ${slug}`));
  assert.match(text, /still use governance: toolkit-test-fixture\/staying\./);
  assert.ok(reads.every(args => args.length === 1 && /^repos\/[^?]+\/actions\/(variables|secrets)\?per_page=100$/.test(args[0])), JSON.stringify(reads));
});

test('check reports the App while governance is on and left-overs once it is off', t => {
  const ctx = home(t), repo = governed(ctx, 'checked');
  const options = { registryPath: ctx.registryPath, testOnly: true };
  const ids = (state, extra = {}) => conformance.checkConformance(repo, { ...options, appReader: answering(state), rulesetReader: () => ({ ok: false, reason: 'offline' }),
    protectionReader: () => ({ ok: false, reason: 'offline' }), securityReader: () => ({ ok: false, reason: 'offline' }), ...extra }).findings.filter(entry => entry.id.startsWith('GOVERNANCE_APP'));
  const notSet = ids(missing);
  assert.deepEqual(notSet.map(entry => entry.id), ['GOVERNANCE_APP_NOT_SET_UP']);
  assert.ok(notSet[0].message.includes('toolkit-test-fixture/store'), 'the install step names the evidence store');
  assert.deepEqual(ids(found).map(entry => entry.id), ['GOVERNANCE_APP_SET']);
  assert.deepEqual(conformance.checkConformance(repo, { ...options, offline: true, appReader: () => assert.fail('no read offline') }).findings
    .filter(entry => entry.id.startsWith('GOVERNANCE_APP')).map(entry => entry.severity), ['unverified']);
  // A missing App never changes the exit code.
  const exitWith = state => conformance.checkConformance(repo, { ...options, offline: true, appReader: answering(state) }).exit_code;
  assert.equal(exitWith(missing), exitWith(found));
  recordMerged(repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'toolkit-test-fixture/checked', governance: 'disabled' }) });
  assert.equal(governance.governanceState(repo, options).rule, 'M2');
  assert.deepEqual(ids({ variable: 'missing', secret: 'found' }).map(entry => entry.id), ['GOVERNANCE_APP_LEFT_OVER']);
  assert.deepEqual(ids(missing), []);
});
