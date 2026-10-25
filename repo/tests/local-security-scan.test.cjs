'use strict';

// The shared secret patterns (skills/secure-ci-cd/scripts/secret-patterns.cjs) and the local
// security scan (local-security-scan.cjs): every format matches its own shape and nothing near it,
// placeholders and reviewed exceptions are skipped, no result carries any part of a match, the
// Toolkit repository itself has zero findings, and the scan finds credentials in the tree and in
// history without changing the scanned repository.
//
// No credential-shaped literal is written in this file: every test value is assembled at run time
// from short pieces.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scripts = path.join(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'scripts');
const patterns = require(path.join(scripts, 'secret-patterns.cjs'));
const scanner = require(path.join(scripts, 'local-security-scan.cjs'));
const repoRoot = path.resolve(__dirname, '..', '..');

// Deterministic filler from a seed, in a given alphabet, with no long runs or sample words.
function filler(length, alphabet, seed) {
  let out = '';
  let block = crypto.createHash('sha256').update(String(seed)).digest();
  let index = 0;
  while (out.length < length) {
    if (index >= block.length) { block = crypto.createHash('sha256').update(block).digest(); index = 0; }
    out += alphabet[block[index] % alphabet.length];
    index += 1;
  }
  return out;
}
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALNUM = UPPER + LOWER + DIGITS;
const URLSAFE = ALNUM + '_-';
const HEX = '0123456789abcdef';
const B64 = ALNUM + '+/';
const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.toUpperCase();

const j = (...parts) => parts.join('');
// One value per rule, built from pieces.
const SAMPLES = {
  'github-token': s => j('gh', 'p_', filler(36, ALNUM, s)),
  'github-installation-token': s => j('gh', 's_', filler(7, DIGITS, s), '_', 'ey', 'J', filler(30, URLSAFE, s + 1), '.', 'ey', 'J', filler(300, URLSAFE, s + 2), '.', filler(170, URLSAFE, s + 3)),
  'github-fine-grained-token': s => j('github', '_pat_', filler(22, ALNUM, s), '_', filler(59, ALNUM, s + 1)),
  'gitlab-token': s => j('gl', 'pat-', filler(20, URLSAFE, s)),
  'slack-token': s => j('xo', 'xb-', filler(12, DIGITS, s), '-', filler(13, DIGITS, s + 1), '-', filler(24, ALNUM, s + 2)),
  'slack-app-token': s => j('xa', 'pp-1-', filler(11, UPPER + DIGITS, s), '-', filler(13, DIGITS, s + 1), '-', filler(64, HEX, s + 2)),
  'slack-webhook': s => j('https://hooks', '.slack.com/services/T', filler(10, UPPER + DIGITS, s), '/B', filler(10, UPPER + DIGITS, s + 1), '/', filler(24, ALNUM, s + 2)),
  'aws-access-key-id': s => j('AK', 'IA', filler(16, UPPER + '234567', s)),
  'stripe-secret-key': s => j('sk', '_live_', filler(32, ALNUM, s)),
  'google-api-key': s => j('AI', 'za', filler(35, URLSAFE, s)),
  'google-oauth-client-secret': s => j('GOC', 'SPX-', filler(28, URLSAFE, s)),
  'openai-key': s => j('sk', '-proj-', filler(64, URLSAFE, s)),
  'anthropic-key': s => j('sk', '-ant-', 'api03-', filler(93, URLSAFE, s), 'AA'),
  'npm-token': s => j('np', 'm_', filler(36, ALNUM, s)),
  'pypi-token': s => j('py', 'pi-', 'AgEIcHlwaS5vcmc', filler(80, URLSAFE, s)),
  'huggingface-token': s => j('h', 'f_', filler(34, UPPER + LOWER, s)),
  'digitalocean-token': s => j('do', 'p_v1_', filler(64, HEX, s)),
  'shopify-token': s => j('sh', 'pat_', filler(32, HEX, s)),
  'sendgrid-key': s => j('S', 'G.', filler(22, URLSAFE, s), '.', filler(43, URLSAFE, s + 1)),
  'twilio-api-key': s => j('S', 'K', filler(32, HEX, s)),
  'square-token': s => j('sq0', 'atp-', filler(22, URLSAFE, s)),
  'mapbox-secret-token': s => j('sk', '.eyJ', filler(60, URLSAFE, s), '.', filler(22, URLSAFE, s + 1)),
  'linear-api-key': s => j('lin', '_api_', filler(40, ALNUM, s)),
  'postman-api-key': s => j('PM', 'AK-', filler(24, HEX, s), '-', filler(34, HEX, s + 1)),
  'discord-webhook': s => j('https://discord', '.com/api/webhooks/', filler(18, DIGITS, s), '/', filler(68, URLSAFE, s + 1)),
  'telegram-bot-token': s => j(filler(9, DIGITS, s), ':', 'AA', filler(33, URLSAFE, s + 1)),
  'azure-storage-key': s => j('Account', 'Key=', filler(86, B64, s), '=='),
  'age-secret-key': s => j('AGE-', 'SECRET-KEY-1', filler(58, BECH, s)),
  'private-key': s => j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----\n', filler(64, B64, s)),
};

function rules(text) { return patterns.scanText(text).map(hit => hit.rule); }

test('SP-01: every format matches its own shape, alone, inside quotes and after an assignment', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), patterns.PATTERNS.map(item => item.id).sort(), 'one sample per rule');
  assert.ok(patterns.PATTERNS.length >= 25);
  for (const [id, build] of Object.entries(SAMPLES)) {
    const value = build(id.length);
    for (const text of [value, `token = "${value}"`, `KEY=${value}`, `{"k": "${value}"}`]) {
      assert.deepEqual(rules(text), [id], `${id} in ${text.slice(0, 12)}`);
    }
  }
});

test('SP-02: one character short, a wrong character or a longer word around it does not match', () => {
  const near = [
    j('gh', 'p_', filler(35, ALNUM, 1)), j('gh', 'p_', filler(37, ALNUM, 1)), j('x', 'gh', 'p_', filler(36, ALNUM, 1)),
    j('gh', 's_', filler(35, ALNUM, 1)), j('x', 'gh', 's_', filler(40, ALNUM, 1)),
    j('AK', 'IA', filler(16, UPPER + '234567', 2), 'Z'), j('AK', 'IA', filler(15, UPPER + '234567', 2), '1'),
    j('np', 'm_', filler(36, ALNUM, 3), '_more'), j('sk', '_test_', filler(32, ALNUM, 4)), j('h', 'f_', filler(34, LOWER, 5), '9'),
    j('S', 'K', filler(32, HEX, 6).toUpperCase()), j('do', 'p_v1_', filler(63, HEX, 7)),
  ];
  for (const text of near) assert.deepEqual(rules(text), [], text.slice(0, 10));
  // Hashes, UUIDs and long identifiers are not credentials.
  for (const text of [crypto.randomUUID(), crypto.createHash('sha256').update('x').digest('hex'), filler(40, HEX, 8), filler(64, ALNUM, 9)]) assert.deepEqual(rules(text), []);
});

test('SP-03: placeholders and reviewed exceptions are skipped; a marker without a reason does not count', () => {
  const placeholders = [
    j('AK', 'IA', 'IOSFODNN7', 'EXAMPLE'), j('gh', 'p_', 'x'.repeat(36)), j('gh', 'p_', 'your', '_token_', filler(25, ALNUM, 1)),
    j('np', 'm_', 'A'.repeat(36)), j('sk', '_live_', 'placeholder', filler(20, ALNUM, 2)),
  ];
  for (const text of placeholders) assert.deepEqual(rules(text), [], text.slice(0, 12));
  const value = SAMPLES['github-token'](3);
  assert.deepEqual(rules(`t = "${value}" // secret-scan: allow revoked test token kept for the parser test`), []);
  assert.deepEqual(rules(`t = "${value}" # secret-scan: allow`), ['github-token']);
  assert.deepEqual(rules(`# secret-scan: allow reviewed\nt = "${value}"`), ['github-token'], 'the marker covers its own line only');
});

test('SP-04: results name the rule and place, never any part of the match', () => {
  const values = Object.values(SAMPLES).map((build, index) => build(100 + index));
  const text = values.map((value, index) => `line${index} = "${value}"`).join('\n');
  const hits = patterns.scanText(text);
  assert.equal(hits.length, values.length);
  const serialized = JSON.stringify(hits);
  for (const value of values) {
    for (const piece of [value, value.slice(-12), value.slice(4, 16)]) assert.equal(serialized.includes(piece), false);
  }
  assert.deepEqual(Object.keys(hits[0]).sort(), ['column', 'label', 'line', 'rule']);
  assert.deepEqual(patterns.scanLines([{ line: 7, text: `a ${values[0]}` }]).map(hit => [hit.line, hit.column]), [[7, 3]]);
});

test('SP-05: a private key header counts only with key material after it', () => {
  const header = j('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----');
  assert.deepEqual(rules(`Never commit a ${header} block.`), []);
  assert.deepEqual(rules(`${header}\n...`), []);
  assert.deepEqual(rules(`${header}\n${filler(70, B64, 1)}\n`), ['private-key']);
  assert.deepEqual(rules(`{"private_key": "${j('-----BEGIN ', 'PRIVATE', ' KEY-----')}\\n${filler(64, B64, 2)}\\n"}`), ['private-key']);
});

test('SP-06: the Toolkit repository has zero findings', () => {
  const files = childProcess.execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const hits = [];
  for (const file of files) {
    let bytes;
    try { bytes = fs.readFileSync(path.join(repoRoot, file)); } catch { continue; }
    if (bytes.length > 5 * 1024 * 1024 || bytes.includes(0)) continue;
    for (const hit of patterns.scanText(bytes.toString('utf8'))) hits.push(`${file}:${hit.line} ${hit.rule}`);
  }
  assert.deepEqual(hits, []);
});

// ---- the scan -----------------------------------------------------------------------------------

const AUTHOR_EMAIL = j('author', '@', 'example.invalid');

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-security-scan-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(root, files = {}, name = 'repo') {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--quiet', repo]);
  git(repo, ['config', 'user.email', AUTHOR_EMAIL]);
  git(repo, ['config', 'user.name', 'Fixture Author']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  write(repo, files);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'fixture']);
  return repo;
}

function write(repo, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }
}

async function scan(args) {
  const out = [];
  const err = [];
  const code = await scanner.main(args, { stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) } });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

function snapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

test('LS-01: positive control: tree and history findings, classed, with places only and nothing private', async (t) => {
  const root = scratch(t);
  const token = SAMPLES['github-token'](11);
  const sample = SAMPLES['npm-token'](12);
  const repo = repository(root, { 'src/config.js': `const token = "${token}";\n`, 'tests/fixture.js': `const t = "${sample}";\n`, 'image.bin': Buffer.from([0, 1, 2]) });
  const commit = git(repo, ['rev-parse', 'HEAD']);
  const out = path.join(root, 'out');
  const before = snapshot(repo);
  const result = await scan(['--repo', repo, '--out', out, '--json']);
  assert.equal(result.code, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'toolkit.local-security-scan.v1');
  assert.equal(report.status, 'release-blocker');
  assert.deepEqual([report.scanned.commit, report.scanned.dirty, report.scanned.history_complete], [commit, false, true]);
  const tree = report.findings.filter(item => item.kind === 'secret').map(item => [item.file, item.rule, item.class, item.line]).sort();
  assert.deepEqual(tree, [['src/config.js', 'github-token', 'release-blocker', 1], ['tests/fixture.js', 'npm-token', 'likely-false-positive', 1]]);
  const history = report.findings.filter(item => item.kind === 'secret-in-history');
  assert.deepEqual(history.map(item => [item.file, item.commit]).sort(), [['src/config.js', commit.slice(0, 12)], ['tests/fixture.js', commit.slice(0, 12)]]);
  assert.deepEqual(report.summary, { release_blocker: 2, likely_false_positive: 2 });
  for (const text of [result.stdout, fs.readFileSync(path.join(out, 'local-security-scan.json'), 'utf8'), fs.readFileSync(path.join(out, 'local-security-scan.md'), 'utf8')]) {
    for (const value of [token, token.slice(-10), sample, AUTHOR_EMAIL, 'Fixture Author']) assert.equal(text.includes(value), false);
  }
  assert.deepEqual(snapshot(repo), before, 'the scanned repository is unchanged, .git included');
});

test('LS-02: removed from the tree, a credential is still found in history; a clean repository is clean', async (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'app.js': `key = "${SAMPLES['stripe-secret-key'](21)}"\n` });
  write(repo, { 'app.js': 'key = process.env.KEY\n' });
  git(repo, ['commit', '--quiet', '-am', 'move the key out']);
  const fixed = JSON.parse((await scan(['--repo', repo, '--json'])).stdout);
  assert.deepEqual(fixed.findings.map(item => [item.kind, item.class]), [['secret-in-history', 'release-blocker']]);
  const clean = repository(root, { 'a.js': 'const a = 1;\n' }, 'clean');
  const result = await scan(['--repo', clean, '--json']);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).status, 'clean');
});

test('LS-03: re-check classes findings as fixed, still open or new', async (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'a.js': `${SAMPLES['npm-token'](31)}\n`, 'b.js': `${SAMPLES['npm-token'](32)}\n` });
  const first = path.join(root, 'first');
  await scan(['--repo', repo, '--out', first, '--no-history']);
  write(repo, { 'a.js': 'gone\n', 'c.js': `${SAMPLES['npm-token'](33)}\n` });
  const report = path.join(first, 'local-security-scan.json');
  const again = JSON.parse((await scan(['--repo', repo, '--json', '--no-history', '--recheck', report])).stdout);
  const previous = JSON.parse(fs.readFileSync(report, 'utf8'));
  const idOf = (list, file) => list.find(item => item.file === file).id;
  assert.deepEqual(again.recheck.fixed, [idOf(previous.findings, 'a.js')]);
  assert.deepEqual(again.recheck.still_open, [idOf(again.findings, 'b.js')]);
  assert.deepEqual(again.recheck.new, [idOf(again.findings, 'c.js')]);
  assert.equal(again.scanned.dirty, true, 'uncommitted changes are flagged');
  assert.equal(again.scanned.history_complete, null);
  assert.equal((await scan(['--repo', repo, '--recheck', path.join(root, 'nope.json')])).code, 2);
});

test('LS-04: a shallow clone is scanned but reported incomplete, never clean', async (t) => {
  const root = scratch(t);
  const source = repository(root, { 'a.js': 'one\n' }, 'source');
  write(source, { 'a.js': 'two\n' });
  git(source, ['commit', '--quiet', '-am', 'two']);
  const shallow = path.join(root, 'shallow');
  childProcess.execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${source.split(path.sep).join('/')}`, shallow], { windowsHide: true });
  const result = await scan(['--repo', shallow, '--json']);
  assert.equal(result.code, 3);
  const report = JSON.parse(result.stdout);
  assert.deepEqual([report.status, report.scanned.history_complete], ['incomplete', false]);
});

test('LS-05: refuses to write inside the scanned repository, and refuses what it cannot scan', async (t) => {
  const root = scratch(t);
  const repo = repository(root);
  const inside = await scan(['--repo', repo, '--out', path.join(repo, 'reports')]);
  assert.equal(inside.code, 2);
  assert.match(inside.stderr, /inside the scanned repository/);
  assert.equal(fs.existsSync(path.join(repo, 'reports')), false);
  const plain = path.join(root, 'plain');
  fs.mkdirSync(plain);
  assert.match((await scan(['--repo', plain])).stderr, /not inside a git repository/);
  assert.equal((await scan(['--bogus'])).code, 2);
  assert.equal((await scan(['--out'])).code, 2);
});
