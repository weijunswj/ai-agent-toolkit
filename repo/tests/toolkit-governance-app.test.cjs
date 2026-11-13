'use strict';

// The governance GitHub App: turning governance on shows the owner how to set the App up, turning it
// off suggests and guides its removal, and `check` keeps reporting either. Toolkit only prints the
// owner's steps and reads whether the variable and the secret exist; it never writes either.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
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
  // One App per governed repository, named for it, within GitHub's 34-character limit.
  assert.equal(link.searchParams.get('name'), 'example-repo-governance', 'owner-repo-governance would pass 34 characters');
  assert.equal(link.searchParams.get('url'), `https://github.com/${SLUG}`);
  assert.equal(link.searchParams.get('public'), 'false');
  assert.equal(link.searchParams.get('webhook_active'), 'false');
  for (const [name, level] of Object.entries(app.APP.permissions)) assert.equal(link.searchParams.get(name), level, name);
  for (const never of ['workflows', 'secrets', 'administration']) assert.equal(link.searchParams.has(never), false, never);
});

test('the App name is per repository, at most 34 characters, and falls back to the repository name', () => {
  assert.equal(app.NAME_LIMIT, 34);
  assert.equal(app.appName('ab/cd'), 'ab-cd-governance');
  assert.equal(app.appName('weijunswj/ai-agent-toolkit'), 'ai-agent-toolkit-governance');
  assert.equal(app.appName('owner/a-very-long-repository-name-indeed'), 'a-very-long-repository-governance');
  assert.notEqual(app.appName('owner/one'), app.appName('owner/two'), 'two repositories get two names');
  for (const slug of ['ab/cd', 'weijunswj/ai-agent-toolkit', 'owner/a-very-long-repository-name-indeed', 'o/x'.padEnd(80, 'y')]) assert.ok(app.appName(slug).length <= 34, slug);
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
  assert.match(text, /Create this repository's own App/);
  assert.match(text, /one App per governed repository/i);
  assert.match(text, /cannot tell whether two repositories share an App/);
  assert.doesNotMatch(text, /Already set the App up for another repository/);
  // Without a store the install step names this repository only.
  assert.doesNotMatch(app.setupLines(SLUG, null, missing).join('\n'), /example-store/);
});

test('setup is one line once the variable and the secret exist, and says when they could not be checked', () => {
  assert.deepEqual(app.setupLines(SLUG, STORE, found), [`Governance GitHub App: the variable and the secret are set on ${SLUG}. Reuse that App: do not set it up again. The first governance job run proves the App is installed.`]);
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

test('an existing setup is reused: no new App link, single-name commands for what is missing, and a guarded replace', () => {
  for (const [state, missingName] of [[{ variable: 'found', secret: 'missing' }, 'secret'], [{ variable: 'missing', secret: 'found' }, 'variable']]) {
    const lines = app.setupLines(SLUG, STORE, state);
    const text = lines.join('\n');
    assert.match(text, /already has part of an App setup/);
    assert.match(text, /Reuse that App: set only what is missing, from the same App/);
    assert.ok(!text.includes(app.creationLink(SLUG)), 'no new App is offered over an existing one');
    assert.match(text, new RegExp(`To set only the missing ${missingName}`));
    for (const line of app.saveCommands(SLUG, missingName)) assert.ok(lines.includes(line), line);
    assert.match(text, /type replace first/);
    assert.match(text, /remove this repository from the old App's installation/);
  }
  // Every printed save step is guarded, whatever the state, and the names never change.
  for (const state of [missing, { variable: 'unverified', secret: 'unverified', reason: 'offline' }, { variable: 'found', secret: 'missing' }]) {
    const lines = app.setupLines(SLUG, STORE, state).filter(line => /gh (variable|secret) set/.test(line));
    assert.ok(lines.length >= 2, JSON.stringify(state));
    for (const line of lines) {
      assert.match(line, /Type replace to overwrite it/);
      assert.match(line, /Could not read the names\. Nothing changed\./);
      for (const [name, write] of [['TOOLKIT_GOVERNANCE_APP_CLIENT_ID', 'gh variable set'], ['TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY', 'gh secret set']]) {
        if (line.includes(write)) assert.ok(line.split(name).length >= 3, `${name} is checked before it is written`);
      }
      assert.ok(line.indexOf(' list --repo ') < line.indexOf(' set '), 'names are listed before anything is set');
    }
  }
  // The single-name commands write only their own name.
  assert.doesNotMatch(app.saveCommands(SLUG, 'secret').join('\n'), /gh variable set/);
  assert.doesNotMatch(app.saveCommands(SLUG, 'variable').join('\n'), /gh secret set/);
  // The POSIX line never uses read -p, which zsh and dash do not support.
  for (const which of ['both', 'variable', 'secret']) assert.doesNotMatch(app.saveCommands(SLUG, which)[1], /read -r -p|read -p/);
});

const shells = ['bash', 'dash', 'zsh'].filter(shell => process.platform !== 'win32' && childProcess.spawnSync(shell, ['-c', 'exit 0']).status === 0);

test('the macOS or Linux save command overwrites an existing setup only after a typed replace, and stops when names cannot be read', { skip: shells.length === 0 }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-app-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'gh'), [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  "variable list") [ -n "$FAIL_VARIABLE_LIST" ] && exit 1; [ -n "$HAS_VARIABLE" ] && echo TOOLKIT_GOVERNANCE_APP_CLIENT_ID; echo OTHER_VARIABLE;;',
    '  "secret list") [ -n "$FAIL_SECRET_LIST" ] && exit 1; [ -n "$HAS_SECRET" ] && echo TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY; echo OTHER_SECRET;;',
    '  *) echo "$1 $2" >> "$WRITES"; cat > /dev/null;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, '<key file>.pem'), 'not a key\n');
  for (const shell of shells) {
    const run = (which, answer, env) => {
      const script = app.saveCommands(SLUG, which)[1].replace(/^\s*macOS or Linux: /, '');
      const writes = path.join(dir, `writes-${Math.random().toString(16).slice(2)}`);
      const result = childProcess.spawnSync(shell, ['-c', script], { cwd: dir, input: `${answer}\n`, encoding: 'utf8',
        env: { ...process.env, ...env, WRITES: writes, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      return { out: result.stdout, writes: fs.existsSync(writes) ? fs.readFileSync(writes, 'utf8').trim().split('\n') : [] };
    };
    assert.deepEqual(run('both', '', {}).writes, ['variable set', 'secret set'], `${shell}: a fresh repository is saved without a question`);
    for (const env of [{ HAS_VARIABLE: '1' }, { HAS_SECRET: '1' }]) {
      const kept = run('both', 'yes', env);
      assert.deepEqual(kept.writes, [], `${shell} ${JSON.stringify(env)}`);
      assert.match(kept.out, /Kept the existing App\. Nothing changed\./);
      assert.deepEqual(run('both', 'replace', env).writes, ['variable set', 'secret set'], `${shell} ${JSON.stringify(env)}`);
    }
    assert.deepEqual(run('both', '', { HAS_VARIABLE: '1', HAS_SECRET: '1' }).writes, [], `${shell}: no answer, as from an agent, keeps the existing App`);
    for (const env of [{ FAIL_VARIABLE_LIST: '1' }, { FAIL_SECRET_LIST: '1' }]) {
      const unread = run('both', 'replace', env);
      assert.deepEqual(unread.writes, [], `${shell} ${JSON.stringify(env)}`);
      assert.match(unread.out, /Could not read the names\. Nothing changed\./);
    }
    // Filling in what is missing writes only that name, without a question, next to the other one.
    assert.deepEqual(run('secret', '', { HAS_VARIABLE: '1' }).writes, ['secret set'], shell);
    assert.deepEqual(run('variable', '', { HAS_SECRET: '1' }).writes, ['variable set'], shell);
    assert.deepEqual(run('secret', '', { HAS_VARIABLE: '1', HAS_SECRET: '1' }).writes, [], `${shell}: an existing secret is kept`);
  }
});
