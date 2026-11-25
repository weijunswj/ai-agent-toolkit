'use strict';

// The governance App setup: the owner's own command that makes the repository's App through GitHub's
// manifest flow and saves its Client ID and key on the repository. Agents cannot run it, the key
// never reaches the screen, the command line or a file, and an existing App is never overwritten.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const setup = require('../scripts/toolkit-governance-app-setup.cjs');
const app = require('../scripts/toolkit-governance-app.cjs');

const SLUG = 'example-owner/example-repo';
const STORE = 'example-owner/example-store';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const MADE = { id: 4242, owner: { login: 'example-owner' }, slug: 'example-repo-governance', client_id: 'Iv23example', client_secret: 'unused-secret', webhook_secret: null, pem: PEM, html_url: 'https://github.com/apps/example-repo-governance' };

// A fake gh: the repository, its variable and secret names, the manifest conversion and the two saves.
function fakeGh({ ownerType = 'User', names = [], namesAfterConversion = null, convert = MADE } = {}) {
  const calls = [];
  let saved = [...names];
  let converted = false;
  const spawn = (command, args, options) => {
    calls.push({ args, input: options.input });
    const reply = (value, status = 0) => ({ status, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
    const [first, second, third] = args;
    if (first === 'api' && second === `repos/${SLUG}`) return reply({ owner: { type: ownerType } });
    const kind = /^repos\/[^/]+\/[^/]+\/actions\/(variables|secrets)\?/.exec(second || '');
    if (first === 'api' && kind) {
      const list = (converted && namesAfterConversion) ? namesAfterConversion : saved;
      const entries = list.filter(name => (kind[1] === 'variables' ? name === app.APP.variable : name === app.APP.secret)).map(name => ({ name }));
      return reply({ total_count: entries.length, [kind[1]]: entries });
    }
    if (first === 'api' && second === '-X' && third === 'POST') { converted = true; return convert ? reply(convert) : reply('', 1); }
    if (first === 'variable' && second === 'set') { saved.push(third); return reply(''); }
    if (first === 'secret' && second === 'set') { saved.push(third); return reply(''); }
    return reply('', 1);
  };
  // `addName` sets a name on the repository as someone else would, for a test that changes it mid-prompt.
  return { spawn, calls, addName: name => { saved.push(name); } };
}

// The owner's terminal and browser: Enter (true) or not, in order, the pages opened, GitHub sending the code back.
function owner(t, { answers = [true, true], code = 'abc123', installedOn = [SLUG, STORE], environment = {}, tty = { stdin: true, stdout: true }, gh = fakeGh() } = {}) {
  const said = [];
  const opened = [];
  const asked = [];
  const pages = [];
  const fetched = [];
  const queue = [...answers];
  return {
    said, opened, asked, pages, fetched, gh,
    deps: {
      environment, tty: () => tty, spawn: gh.spawn, wait: 50, now: () => Date.UTC(2026, 10, 15, 8),
      confirm: effect => { asked.push(effect); return queue.shift() ?? false; },
      say: line => said.push(line),
      open: url => opened.push(url),
      // GitHub answers after the browser loaded the page, which is built once the server is up.
      serve: async ({ page, state }) => ({ url: 'http://127.0.0.1:5555', close: () => {},
        code: code === null ? new Promise(() => {}) : new Promise(resolve => setImmediate(() => { pages.push({ page: page(), state }); resolve(code); })) }),
      fetcher: async (url, options) => {
        fetched.push({ url, options });
        const slug = /repos\/([^/]+\/[^/]+)\/installation$/.exec(url)[1];
        return { status: installedOn.includes(slug) ? 200 : 404 };
      },
    },
  };
}

test('the arguments are one repository and an optional store, each owner/name', () => {
  const none = { save: null, clientId: null, keyFile: null, replace: false };
  assert.deepEqual(setup.parseArgs(['--repo', SLUG, '--store', STORE]), { repo: SLUG, store: STORE, ...none });
  assert.deepEqual(setup.parseArgs(['--repo', SLUG]), { repo: SLUG, store: null, ...none });
  assert.deepEqual(setup.parseArgs(['--repo', SLUG, '--save', 'secret', '--key-file', 'k.pem', '--replace']), { repo: SLUG, store: null, save: 'secret', clientId: null, keyFile: 'k.pem', replace: true });
  for (const argv of [[], ['--store', STORE], ['--repo'], ['--repo', 'not a slug'], ['--repo', SLUG, '--repo', SLUG], ['--repo', SLUG, '--key', 'x'], ['--repo', 'a/b;rm'],
    ['--repo', SLUG, '--replace'], ['--repo', SLUG, '--client-id', 'Iv1'], ['--repo', SLUG, '--save', 'both', '--client-id', 'Iv1'], ['--repo', SLUG, '--save', 'variable', '--client-id', 'Iv1', '--key-file', 'k.pem'],
    ['--repo', SLUG, '--save', 'secret', '--key-file', 'k.pem', '--store', STORE], ['--repo', SLUG, '--save', 'all']]) {
    assert.throws(() => setup.parseArgs(argv), error => error instanceof setup.SetupStop && error.exitCode === 2, JSON.stringify(argv));
  }
  // The stop names what is wrong: a bad value is not blamed on the flag.
  assert.throws(() => setup.parseArgs(['--repo', 'weijunswj/<repo>']), error => error.stopped === '--repo has a value that does not fit: "weijunswj/<repo>".');
  assert.throws(() => setup.parseArgs(['--repo']), error => error.stopped === '--repo has no value.');
  assert.throws(() => setup.parseArgs(['--repo', SLUG, '--key', 'x']), error => error.stopped === '"--key" is not one of the flags below.');
});

test('the manifest asks for the App\'s one permission list, webhook off, installable only here, no events', () => {
  const body = setup.manifest(SLUG, 'http://127.0.0.1:5555/callback');
  assert.equal(body.name, app.appName(SLUG));
  assert.deepEqual(body.default_permissions, app.APP.permissions);
  assert.deepEqual(body.hook_attributes, { url: `https://github.com/${SLUG}`, active: false });
  assert.equal(body.public, false);
  assert.deepEqual(body.default_events, []);
  assert.equal(body.redirect_url, 'http://127.0.0.1:5555/callback');
  const page = setup.formPage('https://github.com/settings/apps/new?state=s', { name: '"><script>x</script>' });
  assert.match(page, /<form method="post" action="https:\/\/github\.com\/settings\/apps\/new\?state=s">/);
  assert.doesNotMatch(page, /"><script>x/, 'the manifest is escaped inside the form');
});

test('agents and pipes are refused before anything is read', async t => {
  for (const [label, options] of [['agent', { environment: { CLAUDECODE: '1' } }], ['codex', { environment: { CODEX_THREAD_ID: 'x' } }], ['a tab Claude opened', { environment: { CLAUDE_CODE_LAUNCHED_BY_SESSION_IDS: 'x' } }], ['pipe', { tty: { stdin: false, stdout: true } }]]) {
    const run = owner(t, options);
    assert.equal(await setup.main(['--repo', SLUG], run.deps), 1, label);
    assert.deepEqual(run.gh.calls, [], `${label}: gh is never called`);
    assert.match(run.said.join('\n'), /Nothing changed\./, label);
  }
});

test('an App already on the repository, or no Enter, changes nothing', async t => {
  const existing = owner(t, { gh: fakeGh({ names: [app.APP.secret] }) });
  assert.equal(await setup.main(['--repo', SLUG], existing.deps), 1);
  assert.match(existing.said.join('\n'), /already holds part of an App setup.*ask your agent to check governance/s);
  assert.deepEqual(existing.asked, [], 'it stops before asking');
  const declined = owner(t, { answers: [false] });
  assert.equal(await setup.main(['--repo', SLUG], declined.deps), 1);
  assert.deepEqual(declined.asked, ['open GitHub and create the App']);
  assert.match(declined.said.join('\n'), /Enter was not pressed\..*Nothing changed\./s);
  assert.deepEqual(declined.opened, [], 'no browser page opens');
  assert.ok(declined.gh.calls.every(call => call.args[0] === 'api' && !call.args.includes('-X')), 'only reads');
});

test('the full run: Create on GitHub, the key piped into the secret, read back, installed on both repositories', async t => {
  const run = owner(t);
  assert.equal(await setup.main(['--repo', SLUG, '--store', STORE], run.deps), 0, run.said.join('\n'));
  assert.equal(run.opened[0], 'http://127.0.0.1:5555', 'the browser opens the loopback form first');
  const { page, state } = run.pages[0];
  assert.match(page, new RegExp(`action="https://github\\.com/settings/apps/new\\?state=${state}"`));
  assert.match(page, /&#34;redirect_url&#34;:&#34;http:\/\/127\.0\.0\.1:5555\/callback&#34;/);
  const conversion = run.gh.calls.find(call => call.args.includes('-X'));
  assert.deepEqual(conversion.args, ['api', '-X', 'POST', 'app-manifests/abc123/conversions']);
  const variable = run.gh.calls.find(call => call.args[0] === 'variable');
  assert.deepEqual(variable.args, ['variable', 'set', app.APP.variable, '--repo', SLUG, '--body', MADE.client_id]);
  const secret = run.gh.calls.find(call => call.args[0] === 'secret');
  assert.deepEqual(secret.args, ['secret', 'set', app.APP.secret, '--repo', SLUG], 'the key is never on the command line');
  assert.equal(secret.input, PEM, 'the key goes in on stdin');
  assert.equal(run.opened[1], `${MADE.html_url}/installations/new`);
  const out = run.said.join('\n');
  for (const value of [PEM.split('\n')[1], MADE.client_secret]) assert.ok(!out.includes(value), 'no secret value is printed');
  assert.match(out, /Saved on example-owner\/example-repo: .* read back\./);
  assert.match(out, new RegExp(`${SLUG}: installed\\.\\n${STORE}: installed\\.\\nDone\\.`));
  // The installation check signs an App token with the new key.
  const [header, payload, signature] = run.fetched[0].options.headers.authorization.slice('Bearer '.length).split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, String(MADE.id));
});

test('an organisation\'s App is made on the organisation\'s page', async t => {
  const run = owner(t, { gh: fakeGh({ ownerType: 'Organization' }) });
  assert.equal(await setup.main(['--repo', SLUG], run.deps), 0, run.said.join('\n'));
  assert.match(run.pages[0].page, /action="https:\/\/github\.com\/organizations\/example-owner\/settings\/apps\/new\?state=/);
});

test('no code in time, a failed conversion, or an App saved meanwhile stops before anything is saved', async t => {
  const late = owner(t, { code: null });
  assert.equal(await setup.main(['--repo', SLUG], late.deps), 1);
  assert.match(late.said.join('\n'), /did not send the App back in time.*Nothing was saved/s);
  const failed = owner(t, { gh: fakeGh({ convert: null }) });
  assert.equal(await setup.main(['--repo', SLUG], failed.deps), 1);
  assert.match(failed.said.join('\n'), /did not hand over the new App/);
  const raced = owner(t, { gh: fakeGh({ namesAfterConversion: [app.APP.variable] }) });
  assert.equal(await setup.main(['--repo', SLUG], raced.deps), 1);
  assert.match(raced.said.join('\n'), /someone set up an App on example-owner\/example-repo meanwhile.*delete the App just made \(https:\/\/github\.com\/settings\/apps\/example-repo-governance/s);
  for (const run of [late, failed, raced]) assert.ok(!run.gh.calls.some(call => ['variable', 'secret'].includes(call.args[0])), 'nothing is saved');
});

test('an App not yet installed on the repository is not finished', async t => {
  const run = owner(t, { installedOn: [STORE] });
  assert.equal(await setup.main(['--repo', SLUG, '--store', STORE], run.deps), 1);
  assert.match(run.said.join('\n'), /example-owner\/example-repo: not installed yet; add it on https:\/\/github\.com\/apps\/example-repo-governance\/installations\/new\..*Not finished/s);
});

// A request with any Host header, which fetch cannot set.
function hostGet(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    http.get({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, headers: { host } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
}

test('the loopback server answers only requests addressed to its own 127.0.0.1 address (no DNS rebinding)', async t => {
  let delivered = false;
  const server = await setup.serveLoopback({ page: () => '<p>form with state</p>', state: 'expected-state' });
  t.after(() => server.close());
  server.code.then(() => { delivered = true; });
  const own = new URL(server.url).host;
  for (const host of ['attacker.example', `attacker.example:${new URL(server.url).port}`, 'localhost', '127.0.0.1', `localhost:${new URL(server.url).port}`]) {
    assert.equal(await hostGet(`${server.url}/`, host), 404, `page for Host ${JSON.stringify(host)}`);
    assert.equal(await hostGet(`${server.url}/callback?code=abc&state=expected-state`, host), 404, `callback for Host ${JSON.stringify(host)}`);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, false, 'a code from another Host is never taken');
  assert.equal(await hostGet(`${server.url}/`, own), 200);
});

test('an App made under another account than the repository owner is not saved', async t => {
  const run = owner(t, { gh: fakeGh({ convert: { ...MADE, owner: { login: 'someone-else' } } }) });
  assert.equal(await setup.main(['--repo', SLUG], run.deps), 1);
  assert.match(run.said.join('\n'), /belongs to someone-else, not example-owner/);
  assert.ok(!run.gh.calls.some(call => ['variable', 'secret'].includes(call.args[0])), 'nothing is saved');
});

test('the loopback server serves the form and takes only the code with the right state', async t => {
  let page = '<p>form</p>';
  const server = await setup.serveLoopback({ page: () => page, state: 'expected-state' });
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  page = '<p>built after start</p>';
  assert.equal(await (await fetch(`${server.url}/`)).text(), '<p>built after start</p>');
  assert.equal((await fetch(`${server.url}/callback?code=abc&state=wrong`)).status, 404);
  assert.equal((await fetch(`${server.url}/elsewhere`)).status, 404);
  assert.equal((await fetch(`${server.url}/callback?code=abc123&state=expected-state`)).status, 200);
  assert.equal(await server.code, 'abc123');
});

// The by-hand App's save step (--save): it overwrites a name already there only with --replace and a
// fresh Enter, stops when the names cannot be read, writes only the names it was given, and pipes
// the key file's key into the secret on stdin.
test('--save keeps an existing App unless --replace and Enter, and writes only the names given', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-app-save-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(keyFile, PEM);
  const both = ['--repo', SLUG, '--save', 'both', '--client-id', 'Iv23example', '--key-file', keyFile];
  const writes = run => run.gh.calls.filter(call => ['variable', 'secret'].includes(call.args[0])).map(call => call.args[0]);
  const fresh = owner(t, { answers: [true] });
  assert.equal(await setup.main(both, fresh.deps), 0, fresh.said.join('\n'));
  assert.deepEqual(writes(fresh), ['variable', 'secret']);
  assert.deepEqual(fresh.asked, [`save both on ${SLUG}`]);
  const secret = fresh.gh.calls.find(call => call.args[0] === 'secret');
  assert.deepEqual(secret.args, ['secret', 'set', app.APP.secret, '--repo', SLUG], 'the key is never on the command line');
  assert.equal(secret.input, PEM);
  assert.ok(!fresh.said.join('\n').includes(PEM.split('\n')[1]), 'the key is never printed');
  for (const names of [[app.APP.variable], [app.APP.secret]]) {
    const kept = owner(t, { gh: fakeGh({ names }) });
    assert.equal(await setup.main(both, kept.deps), 1);
    assert.deepEqual([writes(kept), kept.asked], [[], []], 'kept without asking');
    assert.match(kept.said.join('\n'), /so its App was kept.*--replace.*Nothing changed\./s);
    const declined = owner(t, { answers: [false], gh: fakeGh({ names }) });
    assert.equal(await setup.main([...both, '--replace'], declined.deps), 1);
    assert.deepEqual(writes(declined), [], 'no Enter, no overwrite');
    const replaced = owner(t, { answers: [true], gh: fakeGh({ names }) });
    assert.equal(await setup.main([...both, '--replace'], replaced.deps), 0, replaced.said.join('\n'));
    assert.deepEqual(writes(replaced), ['variable', 'secret']);
    assert.match(replaced.asked[0], /^replace both on /);
  }
  // Filling in what is missing writes only that name.
  const missingSecret = owner(t, { answers: [true], gh: fakeGh({ names: [app.APP.variable] }) });
  assert.equal(await setup.main(['--repo', SLUG, '--save', 'secret', '--key-file', keyFile], missingSecret.deps), 0, missingSecret.said.join('\n'));
  assert.deepEqual(writes(missingSecret), ['secret']);
  // A key file that is not a key, or names that cannot be read, stop before anything is asked.
  fs.writeFileSync(path.join(dir, 'not.pem'), 'not a key\n');
  const badKey = owner(t);
  assert.equal(await setup.main(['--repo', SLUG, '--save', 'secret', '--key-file', path.join(dir, 'not.pem')], badKey.deps), 1);
  assert.deepEqual([writes(badKey), badKey.asked], [[], []]);
  const unread = owner(t, { gh: fakeGh() });
  const spawn = unread.deps.spawn;
  unread.deps.spawn = (command, args, options) => (/actions\/secrets\?/.test(args[1] || '') ? { status: 1, stdout: '', stderr: '' } : spawn(command, args, options));
  assert.equal(await setup.main(both, unread.deps), 1);
  assert.deepEqual([writes(unread), unread.asked], [[], []]);
  assert.match(unread.said.join('\n'), /could not be read/);
});

// The names are read before the prompt, so a name set while the owner reads it is one they were never
// shown: --save stops and writes nothing, whichever of the two names it was going to write.
test('--save writes nothing when a name appears on the repository between the prompt and the Enter', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-app-save-race-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(keyFile, PEM);
  for (const name of [app.APP.variable, app.APP.secret]) {
    const run = owner(t, { answers: [true] });
    const ask = run.deps.confirm;
    run.deps.confirm = effect => { run.gh.addName(name); return ask(effect); };
    assert.equal(await setup.main(['--repo', SLUG, '--save', 'both', '--client-id', 'Iv23example', '--key-file', keyFile], run.deps), 1, `${name} set during the prompt`);
    assert.deepEqual(run.asked, [`save both on ${SLUG}`], name);
    assert.deepEqual(run.gh.calls.filter(call => ['variable', 'secret'].includes(call.args[0])), [], `${name}: nothing is written`);
    assert.match(run.said.join('\n'), /changed while the prompt was open.*Nothing changed\./s, name);
  }
});

// When the names cannot be read back after Enter, nothing is known to have changed: the stop says they could
// not be read, not that the repository changed. The names read fine before the prompt, as the owner saw them.
test('--save says the names could not be read back after Enter, and writes nothing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-app-save-unread-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(keyFile, PEM);
  const run = owner(t, { answers: [true] });
  const ask = run.deps.confirm;
  const spawn = run.deps.spawn;
  let readable = true;
  run.deps.confirm = effect => { readable = false; return ask(effect); };
  run.deps.spawn = (command, args, options) => (!readable && /actions\/(variables|secrets)\?/.test(args[1] || '') ? { status: 1, stdout: '', stderr: '' } : spawn(command, args, options));
  assert.equal(await setup.main(['--repo', SLUG, '--save', 'both', '--client-id', 'Iv23example', '--key-file', keyFile], run.deps), 1, run.said.join('\n'));
  assert.deepEqual(run.asked, [`save both on ${SLUG}`]);
  assert.deepEqual(run.gh.calls.filter(call => ['variable', 'secret'].includes(call.args[0])), [], 'nothing is written');
  const out = run.said.join('\n');
  assert.match(out, /names on example-owner\/example-repo could not be read back after Enter, so nothing was saved\..*Nothing changed\./s);
  assert.doesNotMatch(out, /changed while the prompt was open/);
});
