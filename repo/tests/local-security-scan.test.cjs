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
  for (const closer of [' -->', ' */', ' --!>', ' # #']) assert.deepEqual(rules(`t = "${value}" <!-- secret-scan: allow${closer}`), ['github-token'], `a comment closer${closer} is not a reason`);
  assert.deepEqual(rules(`t = "${value}" <!-- secret-scan: allow revoked fixture -->`), [], 'a reason inside an HTML comment');
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

// ---- review fixes: patterns ---------------------------------------------------------------------

test('SP-07: longer token forms, armoured and encrypted private keys, and the allow marker edges', () => {
  // A dot-free GitHub App token of any length from 36, and a routable GitLab token, match.
  assert.deepEqual(rules(j('gh', 's_', filler(2100, ALNUM, 41))), ['github-installation-token']);
  assert.deepEqual(rules(j('gl', 'pat-', filler(27, URLSAFE, 42), '.01.', filler(9, ALNUM, 43))), ['gitlab-token']);
  // PGP blocks have armour headers and a blank line before the material; encrypted PEM has Proc-Type.
  const pgp = j('-----BEGIN ', 'PGP PRIVATE', ' KEY BLOCK-----');
  assert.deepEqual(rules(`${pgp}\nVersion: GnuPG v2\nComment: fixture\n\n${filler(64, B64, 44)}\n`), ['private-key']);
  const rsa = j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----');
  assert.deepEqual(rules(`${rsa}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,${filler(32, HEX, 45).toUpperCase()}\n\n${filler(64, B64, 46)}\n`), ['private-key']);
  assert.deepEqual(rules(`${pgp}\nVersion: GnuPG v2\n\nno key material here\n`), [], 'headers with no material');
  // A closer with letters is not a reason, and a credential after the marker is still found.
  const value = SAMPLES['github-token'](47);
  assert.deepEqual(rules(`t = "${value}" {# secret-scan: allow {% endcomment %}`), ['github-token']);
  assert.deepEqual(rules(`t = "${value}" % secret-scan: allow \\end{comment}`), ['github-token']);
  assert.deepEqual(rules(`# secret-scan: allow ${SAMPLES['npm-token'](48)}`), ['npm-token'], 'a value written as the reason is found');
  assert.deepEqual(rules(`t = "${value}" # secret-scan: allow revoked, see rotation log`), []);
});

// ---- review fixes: the scan ---------------------------------------------------------------------

test('LS-06: git is taken only from an absolute PATH folder', (t) => {
  const root = scratch(t);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  fs.writeFileSync(path.join(bin, name), '');
  fs.chmodSync(path.join(bin, name), 0o755);
  const sep = process.platform === 'win32' ? ';' : ':';
  assert.equal(scanner.resolveGit({ env: { PATH: ['.', 'bin', '', bin].join(sep) } }), path.join(bin, name));
  assert.throws(() => scanner.resolveGit({ env: { PATH: ['.', 'bin'].join(sep) } }), /not found/);
  const text = fs.readFileSync(path.join(scripts, 'local-security-scan.cjs'), 'utf8');
  assert.doesNotMatch(text, /spawn(?:Sync)?\('git'/, 'git is never started by a bare name');
});

test('LS-07: a git.exe planted in the scanned folder does not run', { skip: process.platform !== 'win32' }, (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'a.js': 'one\n' });
  // The planted git.exe is a copy of node.exe: if it ran, git commands would fail and the scan would exit 2.
  try { fs.linkSync(process.execPath, path.join(repo, 'git.exe')); } catch { fs.copyFileSync(process.execPath, path.join(repo, 'git.exe')); }
  fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), 'git.exe\n');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[key];
  const result = childProcess.spawnSync(process.execPath, [path.join(scripts, 'local-security-scan.cjs'), '--json'], { cwd: repo, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'clean');
});

test('LS-08: history reads "++ " lines as content and finds private keys whose material is on later lines', async (t) => {
  const root = scratch(t);
  const hidden = SAMPLES['npm-token'](51);
  const key = `${j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----')}\n${filler(64, B64, 52)}\n${filler(64, B64, 53)}\n${j('-----END ', 'RSA PRIVATE', ' KEY-----')}\n`;
  const repo = repository(root, { 'notes.txt': `++ ${hidden}\nk = "${SAMPLES['github-token'](54)}"\n`, 'deploy/id_rsa': key });
  git(repo, ['rm', '--quiet', 'notes.txt', 'deploy/id_rsa']);
  git(repo, ['commit', '--quiet', '-m', 'remove']);
  const result = await scan(['--repo', repo, '--json']);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout.includes(hidden), false, 'no part of a value becomes a file name');
  assert.equal(result.stdout.includes(hidden.slice(4, 20)), false);
  const seen = JSON.parse(result.stdout).findings.map(item => [item.file, item.rule, item.line]).sort();
  assert.deepEqual(seen, [['deploy/id_rsa', 'private-key', 1], ['notes.txt', 'github-token', 2], ['notes.txt', 'npm-token', 1]]);
});

test('LS-09: history has no blind spots: long lines, -diff files, merge-only lines and log.showRoot=false', async (t) => {
  const root = scratch(t);
  const long = SAMPLES['npm-token'](61);
  const repo = repository(root, { 'first.js': `${SAMPLES['github-token'](62)}\n` });
  git(repo, ['config', 'log.showRoot', 'false']);
  write(repo, { 'long.txt': `${'a '.repeat(60002)}${long}\n`, '.gitattributes': 'secret.dat -diff\n', 'secret.dat': `${SAMPLES['stripe-secret-key'](63)}\n` });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'more']);
  const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(repo, ['checkout', '--quiet', '-b', 'side']);
  write(repo, { 'side.js': 'side\n' });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'side']);
  git(repo, ['checkout', '--quiet', base]);
  git(repo, ['merge', '--quiet', '--no-ff', '--no-commit', 'side']);
  write(repo, { 'merge-only.js': `${SAMPLES['slack-token'](64)}\n` });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'merge']);
  git(repo, ['rm', '--quiet', 'first.js', 'long.txt', 'secret.dat', 'merge-only.js']);
  git(repo, ['commit', '--quiet', '-m', 'remove']);
  const report = JSON.parse((await scan(['--repo', repo, '--json'])).stdout);
  assert.equal(report.scanned.history_complete, true);
  assert.deepEqual([...new Set(report.findings.map(item => `${item.file} ${item.rule}`))].sort(), ['first.js github-token', 'long.txt npm-token', 'merge-only.js slack-token', 'secret.dat stripe-secret-key']);
});

test('LS-10: an unscanned file is incomplete, an unwritable --out is exit 2, and --out through a link into the repository is refused', async (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'a.js': 'one\n' });
  write(repo, { 'big.txt': 'x'.repeat(5 * 1024 * 1024 + 1) });
  const big = await scan(['--repo', repo, '--json', '--no-history']);
  assert.equal(big.code, 3);
  assert.equal(JSON.parse(big.stdout).status, 'incomplete');
  fs.rmSync(path.join(repo, 'big.txt'));
  const blocker = path.join(root, 'not-a-folder');
  fs.writeFileSync(blocker, 'x');
  const unwritable = await scan(['--repo', repo, '--out', path.join(blocker, 'reports'), '--no-history']);
  assert.equal(unwritable.code, 2);
  assert.match(unwritable.stderr, /could not be written/);
  const link = path.join(root, 'link');
  fs.symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
  const through = await scan(['--repo', repo, '--out', path.join(link, 'reports', 'deep'), '--no-history']);
  assert.equal(through.code, 2);
  assert.match(through.stderr, /inside the scanned repository/);
  assert.equal(fs.existsSync(path.join(repo, 'reports')), false);
});

test('LS-11: a core.fsmonitor command in the scanned repository does not run', { skip: process.platform === 'win32' }, async (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'a.js': 'one\n' });
  const marker = path.join(root, 'fsmonitor-ran');
  const hook = path.join(root, 'hook.sh');
  fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
  fs.chmodSync(hook, 0o755);
  git(repo, ['config', 'core.fsmonitor', hook]);
  const result = await scan(['--repo', repo, '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
});

// ---- review fixes, second round -----------------------------------------------------------------

test('SP-08: closers with letters, x runs inside real tokens and keys in JSON with escaped CRLF', () => {
  const value = SAMPLES['github-token'](71);
  for (const closer of ['</script>', '<% end %>', '{{/each}}']) assert.deepEqual(rules(`t = "${value}" secret-scan: allow ${closer}`), ['github-token'], closer);
  // Four x's inside a real token body are not a placeholder; a long run still is.
  assert.deepEqual(rules(j('gh', 'p_', filler(14, ALNUM, 72), 'xXxx', filler(18, ALNUM, 73))), ['github-token']);
  assert.deepEqual(rules(j('gh', 'p_', filler(14, ALNUM, 74), 'xxxxxxxx', filler(14, ALNUM, 75))), []);
  assert.deepEqual(rules(`{"key": "${j('-----BEGIN ', 'PRIVATE', ' KEY-----')}\\r\\n${filler(64, B64, 76)}\\r\\n"}`), ['private-key']);
});

test('LS-12: git inside the scanned repository is never used, even from an absolute PATH entry', (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'a.js': 'one\n' });
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  const planted = path.join(repo, 'node_modules', '.bin');
  const outside = path.join(root, 'bin');
  for (const dir of [planted, outside]) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), ''); fs.chmodSync(path.join(dir, name), 0o755); }
  const sep = process.platform === 'win32' ? ';' : ':';
  const real = fs.realpathSync(repo);
  assert.equal(scanner.resolveGit({ env: { PATH: [planted, outside].join(sep) }, exclude: real }), path.join(outside, name));
  assert.throws(() => scanner.resolveGit({ env: { PATH: planted }, exclude: real }), /not found/);
});

// Every file name a report gives must be a real path in history: a crafted line can never become one.
function assertNamesReal(repo, report) {
  const names = new Set(git(repo, ['-c', 'core.quotePath=false', 'log', '--all', '--name-only', '-z', '--format=']).split(/[\0\n]/).filter(Boolean));
  for (const item of report.findings) assert.ok(names.has(item.file), `reported file ${JSON.stringify(item.file)} is not a path in history`);
}

test('LS-13: history ends lines only at LF, so a lone CR neither hides a key nor fakes a header', async (t) => {
  const root = scratch(t);
  const crOnly = SAMPLES['stripe-secret-key'](81);
  const hidden = SAMPLES['npm-token'](82);
  const crafted = ['x', 'diff --git a/q b/q', `+++ b/${hidden}`, '@@ -0,0 +1 @@'].join('\r');
  const repo = repository(root, { 'export.csv': `name,key\rrow,${crOnly}\r`, 'crafted.txt': `${crafted}\nk = "${SAMPLES['github-token'](83)}"\n` });
  git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['rm', '--quiet', 'export.csv', 'crafted.txt']);
  git(repo, ['commit', '--quiet', '-m', 'remove']);
  const result = await scan(['--repo', repo, '--json']);
  assert.equal(result.stdout.includes(hidden), false);
  assert.equal(result.stdout.includes(hidden.slice(4, 20)), false);
  const report = JSON.parse(result.stdout);
  // The crafted value sits right after "b/", so the format's edge rule does not take it; what matters is
  // that it never becomes a file name.
  assert.deepEqual(report.findings.map(item => `${item.file} ${item.rule}`).sort(), ['crafted.txt github-token', 'export.csv stripe-secret-key']);
  assertNamesReal(repo, report);
  for (const hit of patterns.scanText(result.stdout)) assert.fail(`the report itself matches ${hit.rule}`);
});

test('LS-14: key material added without its header is still found in history', async (t) => {
  const root = scratch(t);
  const pgp = (seed) => [j('-----BEGIN ', 'PGP PRIVATE', ' KEY BLOCK-----'), '', filler(64, B64, seed), filler(64, B64, seed + 1), j('-----END ', 'PGP PRIVATE', ' KEY BLOCK-----')].join('\n');
  const pem = (seed) => [j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----'), filler(64, B64, seed), filler(64, B64, seed + 1), j('-----END ', 'RSA PRIVATE', ' KEY-----')].join('\n');
  const template = [j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----'), 'paste the key here', j('-----END ', 'RSA PRIVATE', ' KEY-----')].join('\n');
  const repo = repository(root, { 'README.md': '# Notes\n\nSee below.\n', 'deploy/rotate.pem': `${pem(91)}\n`, 'deploy/template.pem': `${template}\n` });
  // The PGP block's own blank line lines up with the README's, so git splits it into two sections.
  write(repo, { 'README.md': `# Notes\n${pgp(93)}\nSee below.\n`, 'deploy/rotate.pem': `${pem(95)}\n`, 'deploy/template.pem': `${pem(97)}\n` });
  git(repo, ['commit', '--quiet', '-am', 'keys']);
  const keys = git(repo, ['rev-parse', 'HEAD']).slice(0, 12);
  write(repo, { 'README.md': '# Notes\n\nSee below.\n', 'deploy/rotate.pem': 'moved\n', 'deploy/template.pem': 'moved\n' });
  git(repo, ['commit', '--quiet', '-am', 'remove']);
  const report = JSON.parse((await scan(['--repo', repo, '--json'])).stdout);
  const atKeys = report.findings.filter(item => item.commit === keys).map(item => `${item.file} ${item.rule}`).sort();
  assert.deepEqual(atKeys, ['README.md private-key', 'deploy/rotate.pem private-key', 'deploy/template.pem private-key']);
  assertNamesReal(repo, report);
});

test('LS-15: hunk merging, names with spaces and uncommitted deletions', async (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'my file.txt': 'a\nb\nc\nd\ne\nf\n', 'gone.js': 'x\n' });
  git(repo, ['config', 'diff.interHunkContext', '3']);
  write(repo, { 'my file.txt': `a\nchanged\nc\nk = "${SAMPLES['npm-token'](101)}"\ne\nf\n` });
  git(repo, ['commit', '--quiet', '-am', 'edit']);
  write(repo, { 'my file.txt': 'clean\n' });
  git(repo, ['commit', '--quiet', '-am', 'clean']);
  const report = JSON.parse((await scan(['--repo', repo, '--json'])).stdout);
  assert.deepEqual(report.findings.map(item => [item.file, item.line]), [['my file.txt', 4]]);
  fs.rmSync(path.join(repo, 'gone.js'));
  const deleted = await scan(['--repo', repo, '--json', '--no-history']);
  assert.equal(deleted.code, 0, deleted.stderr);
  const after = JSON.parse(deleted.stdout);
  assert.deepEqual([after.status, after.scanned.dirty, after.not_scanned.length], ['clean', true, 0]);
});

// ---- review fixes, third round ------------------------------------------------------------------

test('LS-16: a rotated key is found when its section also adds another key, and in a C-quoted file name', async (t) => {
  const root = scratch(t);
  const begin = j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----');
  const end = j('-----END ', 'RSA PRIVATE', ' KEY-----');
  const key = (seed) => [begin, filler(64, B64, seed), end].join('\n');
  const repo = repository(root, { 'mixed.pem': `${key(111)}\n`, 'caf\u00e9.pem': `${key(113)}\n` });
  // Rotating mixed.pem and appending a second key gives git one section: -m +m +E +H +m.
  write(repo, { 'mixed.pem': `${key(115)}\n${key(117)}\n`, 'caf\u00e9.pem': `${key(119)}\n` });
  git(repo, ['commit', '--quiet', '-am', 'rotate']);
  const rotated = git(repo, ['rev-parse', 'HEAD']).slice(0, 12);
  write(repo, { 'mixed.pem': 'moved\n', 'caf\u00e9.pem': 'moved\n' });
  git(repo, ['commit', '--quiet', '-am', 'remove']);
  const result = await scan(['--repo', repo, '--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scanned.history_complete, true, result.stderr);
  const atRotate = report.findings.filter(item => item.commit === rotated).map(item => `${item.file} ${item.line}`).sort();
  assert.deepEqual(atRotate, ['caf\u00e9.pem 1', 'mixed.pem 1', 'mixed.pem 4']);
  assertNamesReal(repo, report);
});

test('LS-17: a folder named ..bin is inside the repository, for git and for --out', async (t) => {
  const root = scratch(t);
  const repo = repository(root, { 'a.js': 'one\n' });
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  const planted = path.join(repo, '..bin');
  const outside = path.join(root, 'bin');
  for (const dir of [planted, outside]) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), ''); fs.chmodSync(path.join(dir, name), 0o755); }
  const sep = process.platform === 'win32' ? ';' : ':';
  const real = fs.realpathSync.native(repo);
  assert.equal(scanner.resolveGit({ env: { PATH: [planted, outside].join(sep) }, exclude: real }), path.join(outside, name));
  const out = await scan(['--repo', repo, '--out', path.join(repo, '..reports')]);
  assert.equal(out.code, 2);
  assert.match(out.stderr, /inside the scanned repository/);
  assert.equal(fs.existsSync(path.join(repo, '..reports')), false);
});

test('SP-09: template and Blade closers are not reasons, and placeholder words count only at the start of a long body', () => {
  const value = SAMPLES['github-token'](121);
  for (const closer of ['{{ end }}', '{{- end }}', '{{end}}', '{{/each }}', '{{ /each }}', '@endif', '</ script>', 'end']) {
    assert.deepEqual(rules(`t = "${value}" secret-scan: allow ${closer}`), ['github-token'], closer);
  }
  assert.deepEqual(rules(j('gh', 's_', filler(240, ALNUM, 122), 'dummy', filler(240, ALNUM, 123))), ['github-installation-token']);
  assert.deepEqual(rules(j('gh', 's_', filler(240, ALNUM, 124), 'your_', filler(240, ALNUM, 125))), ['github-installation-token']);
  assert.deepEqual(rules(j('gh', 's_', 'dummy', filler(500, ALNUM, 126))), [], 'a placeholder word at the start still counts');
});

test('LS-18: a history line of many MB is scanned without overflowing the regexes', async (t) => {
  const root = scratch(t);
  const body = filler(4096, ALNUM, 131).repeat(4096); // 16 MB, built fast from a repeated block
  const header = j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----');
  const files = { 'dist/app.js': `var a="${j('gh', 's_', body)}";\n`, 'dist/b.js': `${j('gl', 'pat-', body)}\n`, 'dist/k.txt': `${header}\n${body}\n` };
  const repo = repository(root, files);
  git(repo, ['rm', '--quiet', ...Object.keys(files)]);
  git(repo, ['commit', '--quiet', '-m', 'remove']);
  const result = await scan(['--repo', repo, '--json']);
  assert.equal(result.code, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scanned.history_complete, true);
  assert.deepEqual(report.findings.map(item => `${item.file} ${item.rule}`).sort(), ['dist/app.js github-installation-token', 'dist/b.js gitlab-token', 'dist/k.txt private-key']);
});
