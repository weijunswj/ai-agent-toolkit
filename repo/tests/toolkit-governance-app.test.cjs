'use strict';

// The governance GitHub App: turning governance on shows the owner how to set the App up, turning it
// off suggests and guides its removal, and `check` keeps reporting either. Toolkit only prints the
// owner's steps and reads whether the variable and the secret exist; it never writes either.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const app = require('../scripts/toolkit-governance-app.cjs');

const SLUG = 'example-owner/example-repo';
const STORE = 'example-owner/example-store';
const found = { variable: 'found', secret: 'found' };
const missing = { variable: 'missing', secret: 'missing' };

test('the App holds one permission list', () => {
  assert.deepEqual(app.APP.permissions, { contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' });
  assert.equal(app.creationLink, undefined, 'the setup script builds the App from its own manifest');
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

// Owner decision INT-TK421-1263 (24 Nov): one line to paste into PowerShell, nothing to choose. The
// owner's other steps are the Enters the script asks for and the Create and Install clicks on GitHub.
test('setup is one line to paste into PowerShell, with this repository and its store filled in', () => {
  const script = path.join(__dirname, '..', 'scripts', 'toolkit-governance-app-setup.cjs');
  const lines = app.setupLines(SLUG, STORE, missing);
  assert.deepEqual(lines, [
    'Governance GitHub App: the governance jobs on GitHub do nothing until the App is set up (variable missing, secret missing). Toolkit never creates it for you. After you merge the governance pull request, paste this one line into PowerShell and press Enter:',
    `   node "${script}" --repo ${SLUG} --store ${STORE}`,
    "It asks for Enter before it opens GitHub and again before it checks the installation; on GitHub you click Create, then Install. It runs only outside an agent, so the App's private key never passes through one.",
  ]);
  assert.doesNotMatch(lines.join('\n'), /<Client ID>|\.pem|By hand|--save|settings\/apps\/new|^\d\. /m, 'no steps or values to fill in');
  assert.equal(app.setupLines(SLUG, null, missing)[1], `   node "${script}" --repo ${SLUG}`, 'no store, no --store');
});

test('setup is one line once the variable and the secret exist, and says when they could not be checked', () => {
  assert.deepEqual(app.setupLines(SLUG, STORE, found), [`Governance GitHub App: the variable and the secret are set on ${SLUG}. Reuse that App: do not set it up again. The first governance job run proves the App is installed.`]);
  const half = app.setupLines(SLUG, STORE, { variable: 'found', secret: 'missing' }).join('\n');
  assert.match(half, /variable found, secret missing/);
  const unknown = app.setupLines(SLUG, STORE, { variable: 'unverified', secret: 'unverified', reason: 'offline' }).join('\n');
  assert.match(unknown, /could not be checked \(offline\)/);
  assert.ok(unknown.includes(app.setupCommand(SLUG, STORE)));
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
  assert.ok(on.message.includes(app.setupCommand(SLUG, STORE)));
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
  const cli = new ToolkitGovernanceCli({ cwd: repo, registryOptions: { registryPath: ctx.registryPath, testOnly: true }, interactive: true, environment: {}, stdout, stderr,
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
  const reads = [];
  const run = state => conformance.checkConformance(repo, { ...options, appReader: args => { reads.push(args); return answering(state)(args); },
    rulesetReader: () => ({ ok: false, reason: 'offline' }), protectionReader: () => ({ ok: false, reason: 'offline' }), securityReader: () => ({ ok: false, reason: 'offline' }) });
  const appOnly = result => result.findings.filter(entry => entry.id.startsWith('GOVERNANCE_APP'));
  const ids = state => appOnly(run(state));
  const notSet = ids(missing);
  assert.deepEqual(notSet.map(entry => entry.id), ['GOVERNANCE_APP_NOT_SET_UP']);
  assert.ok(notSet[0].message.includes('toolkit-test-fixture/store'), 'the install step names the evidence store');
  assert.deepEqual(ids(found).map(entry => entry.id), ['GOVERNANCE_APP_SET']);
  assert.deepEqual(conformance.checkConformance(repo, { ...options, offline: true, appReader: () => assert.fail('no read offline') }).findings
    .filter(entry => entry.id.startsWith('GOVERNANCE_APP')).map(entry => entry.severity), ['unverified']);
  // A missing App never changes the exit code: both runs go through the reader, which tells them apart.
  reads.length = 0;
  const withMissing = run(missing);
  assert.ok(reads.length > 0, 'the App reader ran for the missing App');
  reads.length = 0;
  const withFound = run(found);
  assert.ok(reads.length > 0, 'the App reader ran for the found App');
  assert.deepEqual([appOnly(withMissing), appOnly(withFound)].map(list => list.map(entry => entry.id)), [['GOVERNANCE_APP_NOT_SET_UP'], ['GOVERNANCE_APP_SET']]);
  // The fixture drifts for other reasons, so compare the drift itself as well as the exit code.
  const drift = result => result.findings.filter(entry => entry.severity === 'drift').map(entry => entry.id);
  assert.deepEqual(drift(withMissing), drift(withFound));
  assert.equal(withMissing.exit_code, withFound.exit_code);
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
    assert.ok(!text.includes(app.setupCommand(SLUG, STORE)), 'no new App is offered over an existing one');
    assert.match(text, new RegExp(`To set only the missing ${missingName}`));
    for (const line of app.saveCommands(SLUG, missingName)) assert.ok(lines.includes(line), line);
    assert.match(text, /once you have seen in chat what would be replaced.*asks for Enter before it overwrites anything/);
    assert.match(text, /remove this repository from the old App's installation/);
    // Only the replace route carries --replace.
    assert.deepEqual(lines.filter(line => /--replace/.test(line)), app.saveCommands(SLUG, 'both', { replace: true }));
  }
  // A fresh repository gets the one setup line, never a by-hand save step.
  for (const state of [missing, { variable: 'unverified', secret: 'unverified', reason: 'offline' }]) {
    assert.deepEqual(app.setupLines(SLUG, STORE, state).filter(line => /--save|--replace|Read-Host|gh (variable|secret) set/.test(line)), [], JSON.stringify(state));
  }
  assert.match(app.saveCommands(SLUG)[0], /toolkit-governance-app-setup\.cjs" --repo example-owner\/example-repo --save both --client-id "<Client ID>" --key-file "<key file>\.pem"$/);
  // The single-name commands write only their own name.
  assert.doesNotMatch(app.saveCommands(SLUG, 'secret').join('\n'), /--client-id/);
  assert.doesNotMatch(app.saveCommands(SLUG, 'variable').join('\n'), /--key-file/);
});

test('by-hand website steps lead every repair and removal; the commands follow as the other way', () => {
  const variables = `https://github.com/${SLUG}/settings/variables/actions`;
  const secrets = `https://github.com/${SLUG}/settings/secrets/actions`;
  const both = app.manualSteps(SLUG).join('\n');
  assert.match(both, /By hand on GitHub: open .*Settings, Secrets and variables, Actions/);
  assert.match(both, /New repository variable, Name TOOLKIT_GOVERNANCE_APP_CLIENT_ID, Value the Client ID, then Add variable/);
  assert.match(both, /New repository secret, Name TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY\. For Secret, open the \.pem file .*paste all of it, the BEGIN and END lines included, then Add secret/);
  // Each by-hand step stops on a name that is already there, so it never overwrites another App.
  for (const name of [app.APP.variable, app.APP.secret]) assert.ok(both.includes(`if ${name} is already listed, stop and reuse that App`), name);
  const repair = app.setupLines(SLUG, STORE, { variable: 'found', secret: 'missing' });
  const byHand = repair.findIndex(line => line.includes('By hand on GitHub'));
  const commands = repair.findIndex(line => /Or in your own terminal/.test(line));
  const firstSet = repair.findIndex(line => /--save/.test(line));
  assert.ok(byHand >= 0 && byHand < commands && commands < firstSet, 'by hand first, commands after');
  // A part setup gets by-hand steps for the missing name only.
  const half = app.setupLines(SLUG, STORE, { variable: 'found', secret: 'missing' }).join('\n');
  assert.ok(half.includes(secrets) && !half.includes('New repository variable'));
  assert.deepEqual(app.manualSteps(SLUG, 'variable').filter(line => /New repository secret/.test(line)), []);
  // Removal leads with the website too, and keeps the commands.
  const removal = app.removalLines(SLUG, found, []).join('\n');
  assert.ok(removal.indexOf('By hand on GitHub') < removal.indexOf('gh variable delete'));
  assert.ok(removal.includes(variables) && removal.includes(secrets));
});

test('removal ends by checking both halves: the App and the cloud sweep copies', () => {
  const removal = app.removalLines(SLUG, found, []).join('\n');
  assert.match(removal, /turns governance off also removes the cloud sweep copies/);
  assert.match(removal, /4\. Check both halves are gone: ask your agent to check governance in .*no App variable or secret left over and no cloud sweep copies/);
});

test('check reports cloud sweep copies left behind once governance is off, and only Toolkit copies', t => {
  const ctx = home(t), repo = governed(ctx, 'leftover');
  const options = { registryPath: ctx.registryPath, testOnly: true, offline: true, appReader: answering(missing) };
  recordMerged(repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'toolkit-test-fixture/leftover', governance: 'disabled' }) });
  const left = () => conformance.checkConformance(repo, options).findings.filter(entry => entry.id === 'CLOUD_WORKFLOW_LEFT_OVER');
  assert.deepEqual(left(), []);
  const [sweep, gate] = require('./support/default-cloud-workflows.cjs').SWEEPS.map(row => row.file);
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repo, ...gate.split('/')), 'name: my own gate\n');
  assert.deepEqual(left(), [], 'a file without the Toolkit marker is not a Toolkit copy');
  fs.writeFileSync(path.join(repo, ...sweep.split('/')), `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\r\nname: sweep\r\n`);
  const found = left();
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'info');
  assert.ok(found[0].message.includes(sweep) && !found[0].message.includes(gate));
  assert.equal(conformance.checkConformance(repo, options).exit_code, 0, 'a left-over copy never changes the exit code');
  // The test shards copy is found by its marker at the name its shard list chose, and Shard Timings too.
  const marked = id => `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${id} toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\nname: x\n`;
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'shards.yml'), marked('test-shards'));
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'toolkit-shard-timings.yml'), marked('shard-timings'));
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), marked('programme-sweep'));
  const all = left();
  assert.equal(all.length, 1);
  for (const file of [sweep, '.github/workflows/shards.yml', '.github/workflows/toolkit-shard-timings.yml']) assert.ok(all[0].message.includes(file), file);
  assert.ok(!all[0].message.includes('ci.yml'), 'a sweep marker at another name is not a copy');
});

// The organisation or personal App page is the setup script's choice (toolkit-governance-app-setup.test.cjs).
test('the setup line is the same for an organisation and a personal account', () => {
  assert.equal(app.setupLines.length, 3, 'setupLines takes no owner type');
  assert.equal(app.setupLines('example-org/example-repo', STORE, missing)[1], `   ${app.setupCommand('example-org/example-repo', STORE)}`);
});

test('ownerType reads only the repository, with GET, and anything unreadable is null', () => {
  const calls = [];
  const answer = value => args => { calls.push(args); return value; };
  assert.equal(app.ownerType('example-org/example-repo', { reader: answer({ ok: true, value: { owner: { type: 'Organization' } } }) }), 'Organization');
  assert.deepEqual(calls, [['repos/example-org/example-repo']]);
  assert.equal(app.ownerType(SLUG, { reader: answer({ ok: true, value: { owner: { type: 'User' } } }) }), 'User');
  assert.equal(app.ownerType(SLUG, { reader: answer({ ok: true, value: { owner: { type: 'Bot' } } }) }), null);
  assert.equal(app.ownerType(SLUG, { reader: answer({ ok: false, reason: 'gh-request-failed' }) }), null);
  assert.equal(app.ownerType(SLUG, { reader: () => { throw new Error('boom'); } }), null);
  assert.equal(app.ownerType(SLUG, { offline: true, reader: () => assert.fail('no read offline') }), null);
  const seen = [];
  app.ownerType(SLUG, { reader: args => app.ghReader(args, { spawn: (command, list) => { seen.push(list); return { status: 0, stdout: '{"owner":{"type":"User"}}' }; } }) });
  assert.deepEqual(seen, [['api', `repos/${SLUG}`]]);
});

test('an online check that could not confirm a setting is unverified (exit 3) with the admin step, never conformant', () => {
  const unverified = [{ id: 'RULESET_UNVERIFIED', severity: 'unverified', message: 'x' }];
  assert.equal(conformance.unverifiedExit(unverified, {}, {}), 3);
  assert.equal(conformance.unverifiedExit(unverified, { offline: true }, {}), 0, 'an offline run chose not to read');
  assert.equal(conformance.unverifiedExit(unverified, { testOnly: true }, {}), 0);
  assert.equal(conformance.unverifiedExit(unverified, {}, { TOOLKIT_GOVERNANCE_OFFLINE: '1' }), 0);
  assert.equal(conformance.unverifiedExit([{ id: 'X', severity: 'info', message: 'x' }], {}, {}), 0);
  const result = conformance.report(3, null, unverified, path.resolve(__dirname, '..', '..'));
  assert.deepEqual([result.exit_code, result.status], [3, 'unverified']);
  assert.match(result.next_step, /repository admin signs in with `gh auth login` and runs the governance check \(`toolkit-governance\.cjs check`\) again/);
  const drift = conformance.report(1, null, [...unverified, { id: 'D', severity: 'drift', message: 'd' }], path.resolve(__dirname, '..', '..'));
  assert.deepEqual([drift.exit_code, drift.status, drift.next_step], [1, 'drift', undefined], 'drift still wins');
});
