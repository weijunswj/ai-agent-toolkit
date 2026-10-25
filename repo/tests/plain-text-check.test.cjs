'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const check = require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs');
const installer = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs');
const INSTALLER = path.join(ROOT, 'skills', 'secure-ci-cd', 'scripts', 'install-plain-text-check.cjs');
// Built from pieces so this test file stays a plain example of what it checks.
const HASH = '#';
const CODE = 'Q' + '7';
const GITHUB = 'https://' + 'github.com/example-owner/example-repo';

function tempRepo(t, files = {}, { git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plain-text-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  if (git) {
    const result = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

function settings(root, extra = {}) {
  const config = { schema: check.CONFIG_SCHEMA, ...extra };
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'plain-text.json'), JSON.stringify(config));
  return check.resolveConfig(config);
}

const run = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 30000 });
const banned = (extra = {}) => ({ banned_terms: [{ term: 'Q#', reason: 'a lane code', fix: 'say what the work is' }], ...extra });

test('a banned term matches its digits as a whole token, case-sensitive unless told otherwise', () => {
  const config = check.resolveConfig(banned());
  const texts = (text) => check.findInText(text, 'a.md', config).map((finding) => finding.text);
  assert.deepEqual(texts(`Ship ${CODE}, then Q12 (and Q3).`), [CODE, 'Q12', 'Q3']);
  assert.deepEqual(texts('AQ7 Q7x q7 Q-7 file-q7.md'), []);
  const loose = check.resolveConfig({ banned_terms: [{ term: 'Q#', reason: 'r', fix: 'f', case_sensitive: false }] });
  assert.deepEqual(check.findInText('q7 and Q8', 'a.md', loose).map((finding) => finding.text), ['q7', 'Q8']);
});

test('an explained term passes once the same file explains it; a kept term passes only in its file', () => {
  const config = check.resolveConfig({
    banned_terms: [{ term: 'V#', reason: 'a version code', fix: 'name it' }],
    explained_terms: [{ term: 'V1', reason: 'a mode name' }],
    kept_terms: [{ file: 'docs/keep/', text: 'V9', reason: 'stored name' }]
  });
  const texts = (text, file = 'a.md') => check.findInText(text, file, config).map((finding) => finding.text);
  assert.deepEqual(texts('Mode V1 (`one`). Later V1 again.'), []);
  assert.deepEqual(texts('Mode V1 again with no explanation.'), ['V1']);
  assert.deepEqual(texts('The V9 job.', 'docs/keep/a.md'), []);
  assert.deepEqual(texts('The V9 job.', 'docs/other.md'), ['V9']);
});

test('structured files are checked on their readable fields only', () => {
  const config = check.resolveConfig(banned({ field_extensions: ['.json', '.yml'] }));
  assert.equal(check.scopeOf('x/a.json', config), 'fields');
  assert.equal(check.scopeOf('x/a.md', config), 'text');
  assert.equal(check.scopeOf('x/a.cjs', config), null);
  const json = `{\n  "title": "The ${CODE} plan",\n  "id": "${CODE}",\n  "owner": "${HASH}12"\n}\n`;
  assert.deepEqual(check.findInText(json, 'x/a.json', config, 'fields').map((finding) => [finding.line, finding.text]), [[2, CODE]]);
  assert.deepEqual(check.findInText(`name: ${CODE} job\nrun: echo ${CODE}\n`, 'x/a.yml', config, 'fields').map((finding) => finding.line), [1]);
});

test('default scope skips history, archives, vendored copies and templates for issues and pull requests', () => {
  const config = check.resolveConfig({});
  for (const rel of ['README.md', 'docs/guide.md', 'skills/x/SKILL.md']) assert.equal(check.scopeOf(rel, config), 'text', rel);
  for (const rel of ['CHANGELOG.md', 'docs/archive/a.md', 'vendor/x/README.md', '.github/ISSUE_TEMPLATE/bug.md', '.github/pull_request_template.md', 'a.json'])
    assert.equal(check.scopeOf(rel, config), null, rel);
});

test('malformed settings fail instead of allowing everything', () => {
  assert.throws(() => check.resolveConfig({ schema: 'other/v1' }), /is not a toolkit-plain-text-config/);
  assert.throws(() => check.resolveConfig({ rules: { 'made-up': true } }), /unknown rule/);
  assert.throws(() => check.resolveConfig({ banned_terms: [{ term: '#', reason: 'r', fix: 'f' }] }), /letter/);
  assert.throws(() => check.resolveConfig({ banned_terms: [{ term: 'Q#' }] }), /reason and a fix/);
  assert.throws(() => check.resolveConfig({ kept_terms: [{ file: 'a.md', text: 'Q1' }] }), /file, text, reason/);
  assert.throws(() => check.resolveConfig({ off_reason: '  ' }), /off_reason/);
});

test('the command line fails with file, line and fix, passes when clean and exits 2 on bad settings', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `Done in ${CODE}.\nSee ${GITHUB}/issues/3.\n` });
  settings(root, banned());
  const failed = run([SCRIPT, '--repo', root], root);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /docs\/a\.md:1: banned-term "Q7": a lane code; say what the work is/);
  assert.match(failed.stderr, /docs\/a\.md:2: github-link/);
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), 'Done in the import work.\n');
  assert.equal(run([SCRIPT, '--repo', root], root).status, 0);
  fs.writeFileSync(path.join(root, '.github', 'plain-text.json'), '{ not json');
  const broken = run([SCRIPT, '--repo', root], root);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /Could not check: .*not valid JSON/);
});

test('git-tracked and new unignored files are checked; ignored files are not; a folder walk works without git', (t) => {
  const root = tempRepo(t, { '.gitignore': 'private/\n', 'docs/new.md': `${CODE}\n`, 'private/x.md': `${CODE}\n` });
  const config = settings(root, banned());
  assert.deepEqual(check.check(root, config).failures.map((finding) => finding.file), ['docs/new.md']);
  const plain = tempRepo(t, { 'docs/new.md': `${CODE}\n`, 'node_modules/x/README.md': `${CODE}\n` }, { git: false });
  const plainConfig = settings(plain, banned());
  assert.deepEqual(check.check(plain, plainConfig).failures.map((finding) => finding.file), ['docs/new.md']);
});

test('--files checks only the named in-scope files and judges no staleness', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `${CODE}\n`, 'docs/b.md': 'clean\n', 'tool.cjs': `${CODE}\n` });
  const config = settings(root, banned());
  assert.deepEqual(check.check(root, config, { files: ['docs/b.md', 'tool.cjs', 'docs/gone.md'] }).failures, []);
  const result = run([SCRIPT, '--repo', root, '--files', 'docs/a.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/a\.md:1/);
});

test('the starting baseline is written once, then only shrinks', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `${CODE} and ${CODE}.\n` });
  const config = settings(root, banned());
  assert.deepEqual(check.initBaseline(root, config), { entries: 1 });
  assert.throws(() => check.initBaseline(root, config), /already exists/);
  assert.deepEqual(check.check(root, config).failures, []);
  fs.writeFileSync(path.join(root, 'docs', 'b.md'), `${CODE}\n`);
  assert.deepEqual(check.check(root, config).failures.map((finding) => finding.file), ['docs/b.md']);
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), `${CODE} only once.\n`);
  check.pruneBaseline(root, config);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, config.baseline), 'utf8'));
  assert.deepEqual(baseline.allowed.map((entry) => [entry.file, entry.count]), [['docs/a.md', 1]], 'the new file is never added');
});

test('a recorded off reason switches the check off, and says so', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `${CODE}\n` });
  settings(root, banned({ off_reason: 'this repository publishes issue numbers on purpose' }));
  const result = run([SCRIPT, '--repo', root], root);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /switched off in this repository: this repository publishes issue numbers on purpose/);
});

test('the installer writes settings, baseline, copy and workflow once, and never overwrites the repository\'s own', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `Old note about ${HASH}12.\n` });
  const first = run([INSTALLER, '--repo', root, '--workflow'], root);
  assert.equal(first.status, 0, first.stderr);
  for (const rel of ['.github/plain-text.json', '.github/plain-text-baseline.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml'])
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  assert.match(first.stdout, /Baseline written: \.github\/plain-text-baseline\.json \(1 existing item/);
  assert.equal(run([path.join(root, '.github', 'scripts', 'plain-text-check.cjs'), '--repo', root], root).status, 0, 'the copy passes with the old note baselined');
  const own = JSON.stringify({ schema: check.CONFIG_SCHEMA, ...banned() });
  fs.writeFileSync(path.join(root, '.github', 'plain-text.json'), own);
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'plain-text.yml'), 'name: changed\n');
  const second = run([INSTALLER, '--repo', root, '--workflow'], root);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Settings kept/);
  assert.match(second.stdout, /Baseline kept/);
  assert.match(second.stdout, /CI workflow kept as it is/);
  assert.equal(fs.readFileSync(path.join(root, '.github', 'plain-text.json'), 'utf8'), own);
});

test('--check reports a missing, edited or outdated copy and missing settings, and changes nothing', (t) => {
  const root = tempRepo(t);
  const missing = run([INSTALLER, '--repo', root, '--check'], root);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /check copy \.github\/scripts\/plain-text-check\.cjs: missing/);
  assert.match(missing.stdout, /settings \.github\/plain-text\.json: missing/);
  assert.equal(fs.existsSync(path.join(root, '.github')), false, 'nothing was written');
  assert.equal(run([INSTALLER, '--repo', root], root).status, 0);
  assert.equal(run([INSTALLER, '--repo', root, '--check'], root).status, 0);
  const copy = path.join(root, '.github', 'scripts', 'plain-text-check.cjs');
  fs.appendFileSync(copy, '// local edit\n');
  assert.match(run([INSTALLER, '--repo', root, '--check'], root).stdout, /: edited/);
  const source = fs.readFileSync(path.join(ROOT, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs'), 'utf8');
  fs.writeFileSync(copy, installer.vendoredText(`${source}// an older copy\n`));
  assert.equal(installer.vendoredState(fs.readFileSync(copy, 'utf8')).state, 'outdated');
});

test('the installer refuses a folder that is not a git working tree', (t) => {
  const root = tempRepo(t, {}, { git: false });
  const result = run([INSTALLER, '--repo', root], root);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not inside a git working tree/);
});

test('the CI template reads only, pins its actions to the guard template\'s SHAs and runs the vendored copy', () => {
  const template = fs.readFileSync(path.join(ROOT, 'skills', 'secure-ci-cd', 'templates', 'github-actions', 'plain-text.yml'), 'utf8');
  const guard = fs.readFileSync(path.join(ROOT, 'skills', 'secure-ci-cd', 'templates', 'github-actions', 'personal-data-guard.yml'), 'utf8');
  assert.match(template, /^permissions:\n {2}contents: read$/m);
  assert.match(template, /persist-credentials: false/);
  for (const action of ['actions/checkout', 'actions/setup-node']) {
    const pin = new RegExp(`${action}@([0-9a-f]{40})`);
    assert.equal(pin.exec(template)[1], pin.exec(guard)[1], action);
  }
  assert.match(template, /run: node \.github\/scripts\/plain-text-check\.cjs$/m);
});
