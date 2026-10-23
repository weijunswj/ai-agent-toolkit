'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { GitHubClient, PromiseChecker, compareVersions, exitCode, main, parseArguments, parseList, validateList } = require('../scripts/toolkit-promise-check.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-promise-check.cjs');
const repo = 'example-owner/example-repo';

function scratch(t) {
  const base = path.join(repoRoot, '.tmp');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'toolkit-promises-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function promise(trigger, extra = {}) {
  return { id: 'follow-up', action: 'Run the promised follow-up', trigger, ...extra };
}

function fakeClient({ pr = null, content = null, error = false } = {}) {
  const calls = [];
  return {
    calls,
    getPullRequest(...args) { calls.push(['pr', ...args]); if (error) throw new Error('secret stderr'); return pr; },
    getFile(...args) { calls.push(['file', ...args]); if (error) throw new Error('secret stderr'); return content; },
  };
}

function runMain(text, { filename = 'list.json', client = fakeClient(), args = [], readFile } = {}) {
  let stdout = ''; let stderr = '';
  const code = main(['--list', filename, ...args], {
    checker: new PromiseChecker({ client, ...(readFile ? { readFile } : {}) }),
    readFile: () => text,
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
  });
  return { code, stdout, stderr, client };
}

test('JSON and text lists parse, default status and trigger defaults are explicit', () => {
  const list = { promises: [promise({ type: 'version_shipped', repo, version: '3.7.2' }, { owner: 'Coordinator', made_at: 'Today', evidence: '' })] };
  const json = JSON.stringify(list);
  const expected = validateList(list);
  assert.deepEqual(parseList(json, 'list.json'), expected);
  assert.deepEqual(parseList(`Project memory\n\n\`\`\`toolkit-promises\n${json}\n\`\`\`\n`, 'memory.md'), expected);
  assert.deepEqual(parseList(`~~~toolkit-promises\n${json}\n~~~`, 'memory.txt'), expected);
  assert.equal(expected[0].status, 'open');
  assert.equal(expected[0].trigger.ref, 'main');
  assert.equal(expected[0].trigger.path, 'repo/contracts/toolkit-local-bridge/version.json');
  assert.deepEqual(validateList({ promises: [] }), []);
});

test('Markdown requires exactly one real, closed toolkit-promises fence', () => {
  for (const text of [
    'No block', '```json\n{}\n```',
    '```toolkit-promises\n{"promises":[]}\n```\n```toolkit-promises\n{"promises":[]}\n```',
    '```toolkit-promises\n{"promises":[]}',
    '````markdown\n```toolkit-promises\n{"promises":[]}\n```\n````',
  ]) assert.throws(() => parseList(text, 'memory.md'), /fence|fenced block/);
  assert.throws(() => parseList('{broken secret contents', 'list.json'), /not valid JSON/);
});

test('PR triggers fire only after merge, including not-yet and missing PRs', () => {
  for (const [pr, overdue] of [[{ merged_at: '2026-10-23T00:00:00Z' }, 1], [{ merged_at: null }, 0], [null, 0]]) {
    const client = fakeClient({ pr });
    const result = new PromiseChecker({ client }).check([promise({ type: 'pr_merged', repo, pr: 123 })], 'list.json');
    assert.equal(result.overdue.length, overdue);
    assert.equal(result.waiting.length, 1 - overdue);
    assert.deepEqual(client.calls, [['pr', repo, 123]]);
  }
});

test('local PASS files resolve relative to the list and optionally require plain text', (t) => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, 'reports'));
  fs.writeFileSync(path.join(dir, 'reports', 'x-PASS.md'), 'Verdict: PASS\nLiteral [text].');
  for (const [file, contains, overdue] of [
    ['reports/x-PASS.md', undefined, 1], ['reports/missing.md', undefined, 0],
    ['reports/x-PASS.md', 'Verdict: PASS', 1], ['reports/x-PASS.md', 'Verdict: FAIL', 0],
    ['reports/x-PASS.md', '[text].', 1], ['reports/x-PASS.md', '', 1],
  ]) {
    const client = fakeClient({ error: true });
    const trigger = { type: 'pass_file', path: file, ...(contains === undefined ? {} : { contains }) };
    const result = new PromiseChecker({ client }).check([promise(trigger)], path.join(dir, 'memory.md'));
    assert.equal(result.overdue.length, overdue);
    assert.equal(result.waiting.length, 1 - overdue);
    assert.equal(client.calls.length, 0);
  }
});

test('remote PASS files use the requested ref and contains requirement', () => {
  for (const [content, overdue] of [[null, 0], ['Verdict: WAIT', 0], ['Verdict: PASS', 1]]) {
    const client = fakeClient({ content });
    const result = new PromiseChecker({ client }).check([promise({ type: 'pass_file', repo, path: 'reports/x.md', ref: 'release/test', contains: 'Verdict: PASS' })], 'list.json');
    assert.equal(result.overdue.length, overdue);
    assert.equal(result.waiting.length, 1 - overdue);
    assert.deepEqual(client.calls, [['file', repo, 'reports/x.md', 'release/test']]);
  }
  const client = fakeClient({ content: 'Any file text' });
  assert.equal(new PromiseChecker({ client }).check([promise({ type: 'pass_file', repo, path: 'x.md' })], 'list.json').overdue.length, 1);
  assert.equal(client.calls[0][3], 'main');
});

test('shipped versions compare semver components, equality and absence', () => {
  for (const [version, overdue] of [['3.10.0', 1], ['3.9.9', 1], ['3.9.8', 0], ['2.99.99', 0], [null, 0]]) {
    const client = fakeClient({ content: version === null ? null : JSON.stringify({ version }) });
    const result = new PromiseChecker({ client }).check([promise({ type: 'version_shipped', repo, version: '3.9.9' })], 'list.json');
    assert.equal(result.overdue.length, overdue);
    assert.equal(result.waiting.length, 1 - overdue);
    assert.deepEqual(client.calls[0], ['file', repo, 'repo/contracts/toolkit-local-bridge/version.json', 'main']);
  }
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('3.7.2', '3.7.2'), 0);
  assert.equal(compareVersions('3.7.1', '3.7.2'), -1);
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  const client = fakeClient({ content: '{"version":"4.0.0"}' });
  new PromiseChecker({ client }).check([promise({ type: 'version_shipped', repo, version: '3.7.2', path: 'version.json', ref: 'release' })], 'list.json');
  assert.deepEqual(client.calls[0], ['file', repo, 'version.json', 'release']);
});

test('done promises are counted and never looked up, even local files', () => {
  const client = fakeClient({ error: true });
  const checker = new PromiseChecker({ client, readFile() { assert.fail('done local files must be skipped'); } });
  const list = [
    promise({ type: 'pr_merged', repo, pr: 1 }, { status: 'done' }),
    promise({ type: 'pass_file', path: 'missing' }, { id: 'local', status: 'done' }),
    promise({ type: 'version_shipped', repo, version: '3.7.2' }, { id: 'version', status: 'done' }),
  ];
  const result = checker.check(list, 'list.json');
  assert.deepEqual(result.summary, { open: 0, overdue: 0, waiting: 0, unknown: 0, done: 3 });
  assert.equal(exitCode(result), 0);
  assert.equal(client.calls.length, 0);
});

test('invalid lists fail closed before any lookup and produce input exit 2', () => {
  const valid = promise({ type: 'pr_merged', repo, pr: 1 });
  const invalid = [
    { promises: [valid, { ...valid, typo: true }] },
    { promises: [promise({ type: 'surprise' })] },
    { promises: [valid, valid] },
    { promises: [promise({ type: 'pr_merged', repo: 'bad repo', pr: 1 })] },
    { promises: [promise({ type: 'pr_merged', repo: `${repo}\n`, pr: 1 })] },
    { promises: [promise({ type: 'pr_merged', repo, pr: 0 })] },
    { promises: [promise({ type: 'pr_merged', repo, pr: 1.5 })] },
    { promises: [promise({ type: 'pr_merged', repo })] },
    { promises: [promise({ type: 'pr_merged', repo, pr: 1, ref: 'main' })] },
    { promises: [promise({ type: 'pass_file' })] },
    { promises: [promise({ type: 'pass_file', path: '\0' })] },
    { promises: [promise({ type: 'pass_file', path: 'x', ref: 'main' })] },
    { promises: [promise({ type: 'pass_file', repo: null, path: 'x' })] },
    { promises: [promise({ type: 'pass_file', repo, path: '../x' })] },
    { promises: [promise({ type: 'pass_file', repo, path: 'x', ref: '' })] },
    { promises: [promise({ type: 'pass_file', path: 'x', contains: false })] },
    { promises: [promise({ type: 'version_shipped', repo, version: '3.7' })] },
    { promises: [promise({ type: 'version_shipped', repo, version: '3.7.2-beta' })] },
    { promises: [promise({ type: 'version_shipped', repo, version: '03.7.2' })] },
    { promises: [promise({ type: 'version_shipped', repo, version: '3.7.2\n' })] },
    { promises: [promise({ type: 'pass_file', path: 'x' }, { status: 'waiting' })] },
    { promises: [promise({ type: 'pass_file', path: 'x' }, { owner: 5 })] },
    { promises: [promise({ type: 'pass_file', path: 'x' }, { action: '' })] },
    { promises: [promise({ type: 'pass_file', path: 'x' }, { id: '' })] },
    { promises: [null] }, { promises: {} }, { promises: [], typo: true }, [], null,
  ];
  for (const value of invalid) {
    const result = runMain(JSON.stringify(value));
    assert.equal(result.code, 2, JSON.stringify(value));
    assert.match(result.stderr, /^Input error: (?:Promise\[|List)/);
    assert.equal(result.stdout, '');
    assert.equal(result.client.calls.length, 0);
  }
  const result = runMain('```toolkit-promises\n{"promises":[]}\n```\n```toolkit-promises\n{"promises":[]}\n```', { filename: 'memory.md' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /exactly one/);
});

test('lookup failures and invalid remote data are unknown with exit 3, without raw errors', () => {
  const list = { promises: [promise({ type: 'pr_merged', repo, pr: 1 })] };
  const result = runMain(JSON.stringify(list), { client: fakeClient({ error: true }) });
  assert.equal(result.code, 3);
  assert.match(result.stdout, /Could not check: follow-up: Run the promised follow-up \(GitHub lookup could not be completed\.\)/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret stderr/);
  for (const content of ['not JSON', '{"version":"latest"}', '{}', 'null']) {
    const checked = new PromiseChecker({ client: fakeClient({ content }) }).check([promise({ type: 'version_shipped', repo, version: '3.7.2' })], 'list.json');
    assert.equal(exitCode(checked), 3);
  }
  const checked = new PromiseChecker({ client: fakeClient({ pr: {} }) }).check(list.promises, 'list.json');
  assert.equal(exitCode(checked), 3);
  const local = runMain(JSON.stringify({ promises: [promise({ type: 'pass_file', path: 'x' })] }), {
    readFile() { const error = new Error('private path'); error.code = 'EACCES'; throw error; },
  });
  assert.equal(local.code, 3);
  assert.match(local.stdout, /Local file could not be checked/);
});

test('identical lookups and failures are cached for one run, and fresh on the next run', () => {
  for (const error of [false, true]) {
    const client = fakeClient({ content: 'Verdict: PASS', error });
    const checker = new PromiseChecker({ client });
    const list = [
      promise({ type: 'pass_file', repo, path: 'x.md', contains: 'PASS' }),
      promise({ type: 'pass_file', repo, path: 'x.md', contains: 'WAIT' }, { id: 'second' }),
    ];
    checker.check(list, 'list.json');
    assert.equal(client.calls.length, 1);
    checker.check(list, 'list.json');
    assert.equal(client.calls.length, 2);
  }
  let reads = 0;
  const checker = new PromiseChecker({ client: fakeClient(), readFile() { reads += 1; return 'PASS'; } });
  checker.check([promise({ type: 'pass_file', path: 'x' }), promise({ type: 'pass_file', path: './x' }, { id: 'second' })], 'list.json');
  assert.equal(reads, 1);
  const client = fakeClient({ pr: { merged_at: null } });
  new PromiseChecker({ client }).check([promise({ type: 'pr_merged', repo, pr: 1 }), promise({ type: 'pr_merged', repo, pr: 1 }, { id: 'second' })], 'list.json');
  assert.equal(client.calls.length, 1);
});

test('text and JSON output report overdue, waiting, unknown and done with exit precedence', () => {
  const list = { promises: [
    promise({ type: 'pr_merged', repo, pr: 123 }),
    promise({ type: 'pass_file', repo, path: 'waiting.md' }, { id: 'wait' }),
    promise({ type: 'pass_file', path: 'unreadable' }, { id: 'unknown' }),
    promise({ type: 'pr_merged', repo, pr: 4 }, { id: 'finished', status: 'done' }),
  ] };
  const options = {
    client: fakeClient({ pr: { merged_at: '2026-10-23T00:00:00Z' } }),
    readFile() { throw new Error('secret error'); },
  };
  const result = runMain(JSON.stringify(list), options);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Overdue promise: follow-up: Run the promised follow-up \(trigger met: PR example-owner\/example-repo#123 merged\)/);
  assert.match(result.stdout, /Waiting: wait: .*trigger not met yet: file waiting.md/);
  assert.match(result.stdout, /Done: finished:/);
  assert.match(result.stdout, /Promises: 3 open, 1 overdue, 1 waiting, 1 could not be checked, 1 done\./);
  assert.equal(result.stdout.trim().split('\n').length, 5);
  const json = runMain(JSON.stringify(list), { ...options, args: ['--json'] });
  assert.equal(json.code, 1);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(parsed), ['overdue', 'waiting', 'unknown', 'done', 'summary']);
  assert.deepEqual(parsed.summary, { open: 3, overdue: 1, waiting: 1, unknown: 1, done: 1 });
});

test('usage and unreadable input errors return exit 2 without file contents', () => {
  for (const args of [[], ['--list'], ['--list', 'x', '--unexpected'], ['--list', 'x', '--now', '2026-10-23T00:00:00Z'], ['--list', 'x', '--json', '--json'], ['--list', 'x', '--list', 'y']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(parseArguments(['--list', 'x', '--json']).list, 'x');
  const result = runMain('secret not JSON');
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.stderr, /secret/);
  let stderr = '';
  assert.equal(main(['--list', 'missing'], { readFile() { throw new Error('private path'); }, stderr: { write(value) { stderr += value; } } }), 2);
  assert.equal(stderr, 'Input error: The list file could not be read.\n');
});

test('GitHub client uses a resolved executable, argument arrays, no shell, and base64 decoding', () => {
  const calls = []; const resolved = [];
  const client = new GitHubClient({
    resolveExecutable(name) { resolved.push(name); return '/trusted/gh'; },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: `${Buffer.from('Verdict: PASS\n').toString('base64')}\n` }) };
    },
  });
  assert.equal(client.getFile(repo, 'reports/a b.md', 'release/test & x'), 'Verdict: PASS\n');
  assert.deepEqual(resolved, ['gh']);
  assert.equal(calls[0].command, '/trusted/gh');
  assert.deepEqual(calls[0].args, ['api', `repos/${repo}/contents/reports/a%20b.md?ref=release%2Ftest%20%26%20x`]);
  assert.equal(calls[0].options.shell, false);
  const pr = new GitHubClient({ resolveExecutable: () => '/trusted/gh', spawn(command, args) {
    assert.deepEqual(args, ['api', `repos/${repo}/pulls/123`]);
    return { status: 0, stdout: '{"merged_at":null}' };
  } });
  assert.deepEqual(pr.getPullRequest(repo, 123), { merged_at: null });
});

test('GitHub 404 is not yet, other CLI failures and malformed responses cannot pass', () => {
  const make = (result) => new GitHubClient({ resolveExecutable: () => '/trusted/gh', spawn: () => result });
  const missing = make({ status: 1, stderr: 'gh: Not Found (HTTP 404)\n' });
  assert.equal(missing.getPullRequest(repo, 1), null);
  assert.equal(missing.getFile(repo, 'x', 'main'), null);
  for (const result of [
    { status: 1, stderr: 'secret token HTTP 403' }, { status: null, error: new Error('secret token') },
    { status: 0, stdout: 'not JSON' },
    { status: 0, stdout: '{"type":"dir"}' },
    { status: 0, stdout: '{"type":"file","encoding":"base64","content":"not!base64"}' },
  ]) assert.throws(() => make(result).getFile(repo, 'x', 'main'), (error) => !error.message.includes('secret'));
  const unavailable = new GitHubClient({ resolveExecutable() { throw new Error('private path'); }, spawn() { assert.fail('must not spawn'); } });
  assert.throws(() => unavailable.getPullRequest(repo, 1), /^Error: GitHub lookup failed\.$/);
});

test('CLI subprocess returns input exit 2 and local PASS-file overdue exit 1 without gh', (t) => {
  const dir = scratch(t);
  const list = path.join(dir, 'list.json');
  fs.writeFileSync(list, JSON.stringify({ promises: [promise({ type: 'unknown' })] }));
  const bad = spawnSync(process.execPath, [script, '--list', list], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Promise\[0\]\.trigger.type is unknown/);
  fs.writeFileSync(path.join(dir, 'x-PASS.md'), 'Verdict: PASS');
  fs.writeFileSync(list, JSON.stringify({ promises: [promise({ type: 'pass_file', path: 'x-PASS.md', contains: 'Verdict: PASS' })] }));
  const overdue = spawnSync(process.execPath, [script, '--list', list], { encoding: 'utf8' });
  assert.equal(overdue.status, 1);
  assert.match(overdue.stdout, /^Overdue promise: follow-up:/);
  assert.match(overdue.stdout, /Promises: 1 open, 1 overdue, 0 waiting, 0 could not be checked, 0 done\./);
  assert.equal(overdue.stderr, '');
  fs.unlinkSync(path.join(dir, 'x-PASS.md'));
  const waiting = spawnSync(process.execPath, [script, '--list', list, '--json'], { encoding: 'utf8' });
  assert.equal(waiting.status, 0);
  assert.equal(JSON.parse(waiting.stdout).waiting.length, 1);
});
