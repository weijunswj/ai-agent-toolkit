'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const check = require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs');
const installer = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs');
const INSTALLER = path.join(ROOT, 'skills', 'secure-ci-cd', 'scripts', 'install-plain-text-check.cjs');
// Built from pieces so this test file stays a plain example of what it checks.
const HASH = '#';
const CODE = 'Q' + '7';
const GITHUB = 'https://' + 'github.com/example-owner/example-repo';
const digest = (file, rule, text) => createHash('sha256').update(JSON.stringify([file, rule, text])).digest('hex');

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

// A deliberately non-Git fixture must not discover the enclosing worktree and install there.
const run = (args, cwd) => spawnSync(process.execPath, args, {
  cwd, encoding: 'utf8', timeout: 30000,
  env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
});
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

test('a kept text also exempts reference rules in its file, and letter_suffix catches suffixed codes', () => {
  const config = check.resolveConfig({
    banned_terms: [{ term: 'Q#', reason: 'a lane code', fix: 'say what the work is', letter_suffix: true }],
    kept_terms: [{ file: 'docs/scores.md', text: `${HASH}42`, reason: 'a score, not a reference' }]
  });
  const texts = (text, file = 'a.md') => check.findInText(text, file, config).map((finding) => finding.text);
  assert.deepEqual(texts(`Top score ${HASH}42.`, 'docs/scores.md'), []);
  assert.deepEqual(texts(`Top score ${HASH}42.`), [`${HASH}42`]);
  assert.deepEqual(texts('The Q4a lane and Q12 and Q4ab and Q4A.'), ['Q4a', 'Q12']);
  assert.throws(() => check.resolveConfig({ banned_terms: [{ term: 'Q#', reason: 'r', fix: 'f', letter_suffix: 'yes' }] }), /letter_suffix/);
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

test('stale matched links reach neither output stream while counts, failures and pruning remain enforced', (t) => {
  const marker = 'RESERVED-STALE-LINK-MARKER';
  const link = `${GITHUB}/issues/3?reserved=${marker}`;
  const root = tempRepo(t, { 'docs/a.md': `${link}\n${link}\n`, 'docs/removed.md': `${link}\n` });
  const config = settings(root);
  check.initBaseline(root, config);
  const baselinePath = path.join(root, config.baseline);
  const before = fs.readFileSync(baselinePath);
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), `${link}\n`);
  fs.unlinkSync(path.join(root, 'docs', 'removed.md'));
  const stale = run([SCRIPT, '--repo', root], root);
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /docs\/a\.md: github-link is in the baseline 2 time\(s\) but occurs 1; run with --prune-baseline/);
  assert.match(stale.stdout, /docs\/removed\.md: github-link is in the baseline 1 time\(s\) but occurs 0/);
  assert.deepEqual(fs.readFileSync(baselinePath), before, 'reporting does not migrate or rewrite existing baselines');
  fs.writeFileSync(path.join(root, 'docs', 'new.md'), `${link}\n`);
  const mixed = run([SCRIPT, '--repo', root], root);
  assert.equal(mixed.status, 1);
  assert.match(mixed.stdout, /occurs 1; run with --prune-baseline/);
  assert.match(mixed.stderr, /FAIL: docs\/new\.md:1: github-link:/);
  assert.match(mixed.stderr, /1 item\(s\) to rewrite/);
  const scoped = run([SCRIPT, '--repo', root, '--files', 'docs/a.md'], root);
  assert.equal(scoped.status, 0, scoped.stderr);
  assert.doesNotMatch(scoped.stdout, /NOTE:|prune-baseline/);
  const pruned = run([SCRIPT, '--repo', root, '--prune-baseline'], root);
  assert.equal(pruned.status, 0, pruned.stderr);
  const baseline = JSON.parse(fs.readFileSync(baselinePath));
  assert.deepEqual(baseline.allowed.map(entry => [entry.file, entry.rule, entry.count]), [['docs/a.md', 'github-link', 1]]);
  assert.equal(baseline.schema, check.BASELINE_SCHEMA);
  assert.deepEqual(baseline.allowed[0], { file: 'docs/a.md', rule: 'github-link', fingerprint: digest('docs/a.md', 'github-link', link), count: 1 });
  assert.equal(JSON.stringify(baseline).includes(marker), false, 'the baseline never stores matched links');
  const fresh = run([SCRIPT, '--repo', root], root);
  assert.equal(fresh.status, 1, 'new findings still fail after pruning');
  assert.doesNotMatch(fresh.stdout, /NOTE:/);
  assert.match(fresh.stderr, /FAIL: docs\/new\.md:1: github-link:/);
  fs.appendFileSync(path.join(root, 'docs', 'a.md'), `${link}\n`);
  const excess = run([SCRIPT, '--repo', root], root);
  assert.equal(excess.status, 1, 'a count above the pruned allowance still fails');
  assert.match(excess.stderr, /3 item\(s\) to rewrite/);
  for (const result of [stale, mixed, scoped, pruned, fresh, excess]) {
    for (const stream of [result.stdout, result.stderr]) {
      assert.equal(stream.includes(marker), false);
      assert.equal(stream.includes(link), false);
    }
  }
});

test('a recorded off reason switches the check off, and says so', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `${CODE}\n` });
  settings(root, banned({ off_reason: 'this repository publishes issue numbers on purpose' }));
  const result = run([SCRIPT, '--repo', root], root);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /switched off in this repository: this repository publishes issue numbers on purpose/);
});

// Invariants: only explicit write modes may write; migration keeps exactly the same identity and
// allowance; pruning only lowers it; read errors deny the check before any finding is reported.
// Each row crosses a baseline state, command and finding state, including an OS-unreadable directory.
const closureRows = ['absent', 'v1', 'v2', 'malformed', 'unreadable'].flatMap(baseline =>
  ['report', 'check', 'init', 'migrate', 'files-scoped', 'prune'].flatMap(mode =>
    ['none', 'within allowance', 'excess', 'stale'].map(finding => {
      const invalid = ['malformed', 'unreadable'].includes(baseline);
      const excess = finding === 'excess' || (baseline === 'absent' && finding !== 'none');
      const exit = mode === 'init' ? (baseline === 'absent' ? 0 : 2)
        : mode === 'migrate' ? (['v1', 'v2'].includes(baseline) ? 0 : 2)
          : invalid ? 2 : mode === 'prune' ? 0 : excess ? 1 : 0;
      const writes = (mode === 'init' && baseline === 'absent') || (mode === 'migrate' && baseline === 'v1')
        || (mode === 'prune' && ['v1', 'v2'].includes(baseline));
      return { baseline, mode, finding, exit, writes };
    })));

for (const row of closureRows) test(`baseline closure: ${row.baseline} / ${row.mode} / ${row.finding} => ${row.exit}`, t => {
  const marker = 'RESERVED-CLOSURE-LINK-MARKER';
  const link = `${GITHUB}/issues/3?reserved=${marker}`;
  const occurrences = { none: 0, 'within allowance': 2, excess: 3, stale: 1 }[row.finding];
  const root = tempRepo(t, { 'docs/a.md': `${link}\n`.repeat(occurrences) }, { git: false });
  const config = settings(root);
  const file = path.join(root, config.baseline);
  const allowed = row.finding === 'none' ? [] : [{ file: 'docs/a.md', rule: 'github-link', count: 2,
    ...(row.baseline === 'v1' ? { text: link } : { fingerprint: digest('docs/a.md', 'github-link', link) }) }];
  if (row.baseline === 'unreadable') fs.mkdirSync(file);
  else if (row.baseline !== 'absent') fs.writeFileSync(file, row.baseline === 'malformed' ? `{"allowed":${link}`
    : JSON.stringify({ schema: row.baseline === 'v1' ? check.LEGACY_BASELINE_SCHEMA : check.BASELINE_SCHEMA, allowed }));
  const before = fs.existsSync(file) && row.baseline !== 'unreadable' ? fs.readFileSync(file) : null;
  let stdout = ''; let stderr = ''; let writes = 0; let status;
  const out = { write: text => { stdout += text; } }; const err = { write: text => { stderr += text; } };
  const originalWrite = fs.writeFileSync; const originalMkdir = fs.mkdirSync;
  fs.writeFileSync = (...args) => { writes++; return originalWrite(...args); };
  fs.mkdirSync = (...args) => { writes++; return originalMkdir(...args); };
  try {
    if (row.mode === 'report') {
      try { status = check.report(check.check(root, config), config, out, err); }
      catch (error) { stderr += error.message; status = 2; }
    } else {
      const flags = { check: [], init: ['--init-baseline'], migrate: ['--migrate-baseline'],
        'files-scoped': ['--files', 'docs/a.md'], prune: ['--prune-baseline'] }[row.mode];
      status = check.main(['--repo', root, ...flags], { out, err });
    }
  } finally { fs.writeFileSync = originalWrite; fs.mkdirSync = originalMkdir; }
  assert.equal(status, row.exit, stderr);
  assert.equal(writes > 0, row.writes, 'only the explicitly selected write mode writes');
  for (const stream of [stdout, stderr]) {
    assert.equal(stream.includes(link), false);
    assert.equal(stream.includes(marker), false);
    assert.equal(stream.includes(digest('docs/a.md', 'github-link', link)), false);
  }
  if (!row.writes && before) assert.deepEqual(fs.readFileSync(file), before);
  if (row.writes) {
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.schema, row.mode === 'prune' && row.baseline === 'v1' ? check.LEGACY_BASELINE_SCHEMA : check.BASELINE_SCHEMA);
    assert.deepEqual(saved.allowed.map(entry => entry.count), row.finding === 'none' ? [] : [row.mode === 'init' ? occurrences : row.mode === 'prune' ? Math.min(2, occurrences) : 2]);
    if (saved.schema === check.BASELINE_SCHEMA) assert.equal(JSON.stringify(saved).includes(marker), false);
  }
});

test('legacy migration preserves identities and counts, is explicit, and edited or moved links fail', t => {
  const link = `${GITHUB}/pull/3?reserved=RESERVED-MIGRATION-MARKER`;
  const root = tempRepo(t, { 'docs/a.md': `${link}\n${link}\n` });
  const config = settings(root);
  const file = path.join(root, config.baseline);
  const legacy = { schema: check.LEGACY_BASELINE_SCHEMA, description: link, allowed: [
    { file: 'docs/a.md', rule: 'github-link', text: link, count: 2 },
    { file: 'docs/gone.md', rule: 'github-link', text: link, count: 1 }
  ] };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const before = fs.readFileSync(file);
  assert.deepEqual(check.check(root, config).failures, []);
  assert.deepEqual(fs.readFileSync(file), before);
  const migrated = run([SCRIPT, '--repo', root, '--migrate-baseline'], root);
  assert.equal(migrated.status, 0, migrated.stderr);
  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(saved.includes(link), false, 'also discard legacy description metadata');
  assert.deepEqual(JSON.parse(saved).allowed, legacy.allowed.map(({ file, rule, text, count }) => ({ file, rule, fingerprint: digest(file, rule, text), count })));
  assert.deepEqual(check.check(root, config).failures, []);
  assert.equal(run([SCRIPT, '--repo', root, '--migrate-baseline'], root).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), saved, 'an already migrated baseline is unchanged');
  fs.writeFileSync(path.join(root, 'docs/a.md'), `${link}-edited\n`);
  fs.writeFileSync(path.join(root, 'docs/b.md'), `${link}\n`);
  assert.deepEqual(check.check(root, config).failures.map(f => f.file), ['docs/a.md', 'docs/b.md']);
  for (const stream of [migrated.stdout, migrated.stderr]) assert.equal(stream.includes('RESERVED-MIGRATION-MARKER'), false);
});

test('malformed baseline shapes deny every reading or migration route without echo or writes', t => {
  const marker = 'RESERVED-MALFORMED-LINK-MARKER';
  const link = `${GITHUB}/pull/3?reserved=${marker}`;
  const root = tempRepo(t, { 'docs/a.md': link });
  const config = settings(root);
  const file = path.join(root, config.baseline);
  const legacy = { file: 'docs/a.md', rule: 'github-link', text: link, count: 1 };
  const current = { file: 'docs/a.md', rule: 'github-link', fingerprint: digest('docs/a.md', 'github-link', link), count: 1 };
  const bad = [null, [], {}, { schema: link, allowed: [] }, { schema: check.BASELINE_SCHEMA, allowed: null }];
  for (const [schema, entry] of [[check.LEGACY_BASELINE_SCHEMA, legacy], [check.BASELINE_SCHEMA, current]]) {
    for (const value of [null, link, {}, { ...entry, count: 0 }, { ...entry, count: -1 }, { ...entry, count: 1.5 },
      { ...entry, count: Number.MAX_SAFE_INTEGER + 1 }, { ...entry, file: null }, { ...entry, file: link },
      { ...entry, rule: link }, { ...entry, fingerprint: link }, { ...entry, extra: link }]) bad.push({ schema, allowed: [value] });
    bad.push({ schema, allowed: [entry, entry] });
  }
  bad.push({ schema: check.BASELINE_SCHEMA, allowed: [{ ...current, text: link }] });
  for (const value of bad) {
    fs.writeFileSync(file, JSON.stringify(value));
    const before = fs.readFileSync(file);
    for (const flags of [[], ['--files', 'docs/a.md'], ['--prune-baseline'], ['--migrate-baseline']]) {
      let stdout = ''; let stderr = '';
      const status = check.main(['--repo', root, ...flags], { out: { write: s => { stdout += s; } }, err: { write: s => { stderr += s; } } });
      assert.equal(status, 2);
      assert.equal(stdout, '');
      assert.equal(stderr, 'Could not check: Baseline could not be read or is invalid.\n');
      assert.deepEqual(fs.readFileSync(file), before);
    }
  }
});

test('write modes reject scoped or conflicting requests, including programmatic scoped pruning', t => {
  const root = tempRepo(t, { 'docs/a.md': `${HASH}3` });
  const config = settings(root);
  for (const flag of ['--init-baseline', '--prune-baseline', '--migrate-baseline']) {
    for (const suffix of [['--files', 'docs/a.md'], ['--explain']]) assert.equal(run([SCRIPT, '--repo', root, flag, ...suffix], root).status, 2);
  }
  assert.equal(run([SCRIPT, '--repo', root, '--init-baseline', '--migrate-baseline'], root).status, 2);
  for (const operation of [check.initBaseline, check.pruneBaseline, check.migrateBaseline]) assert.throws(() => operation(root, config, { files: ['docs/a.md'] }), /cannot be combined/);
  assert.equal(fs.existsSync(path.join(root, config.baseline)), false);
});

test('the installer writes settings, baseline, copy and workflow once, and never overwrites the repository\'s own', (t) => {
  const root = tempRepo(t, { 'docs/a.md': `Old note about ${HASH}12.\n` });
  const first = run([INSTALLER, '--repo', root, '--workflow'], root);
  assert.equal(first.status, 0, first.stderr);
  for (const rel of ['.github/plain-text.json', '.github/plain-text-baseline.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml'])
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  assert.match(first.stdout, /Baseline written: \.github\/plain-text-baseline\.json \(1 existing item/);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, '.github', 'plain-text-baseline.json')));
  assert.equal(baseline.schema, check.BASELINE_SCHEMA);
  assert.equal(Object.hasOwn(baseline.allowed[0], 'text'), false);
  assert.equal(baseline.allowed[0].fingerprint, digest('docs/a.md', 'number-reference', `${HASH}12`));
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

test('installer refresh keeps a legacy baseline byte-for-byte; the installed copy migrates only explicitly', t => {
  const link = `${GITHUB}/pull/3?reserved=RESERVED-INSTALLED-LINK-MARKER`;
  const root = tempRepo(t, { 'docs/a.md': `${link}\n${link}\n` });
  const config = settings(root);
  const file = path.join(root, config.baseline);
  fs.writeFileSync(file, JSON.stringify({ schema: check.LEGACY_BASELINE_SCHEMA, allowed: [{ file: 'docs/a.md', rule: 'github-link', text: link, count: 2 }] }));
  const before = fs.readFileSync(file);
  for (const flags of [[], ['--check'], []]) {
    const result = run([INSTALLER, '--repo', root, ...flags], root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(file), before);
    for (const stream of [result.stdout, result.stderr]) assert.equal(stream.includes(link), false);
  }
  const copy = path.join(root, '.github', 'scripts', 'plain-text-check.cjs');
  assert.equal(run([copy, '--repo', root, '--files', 'docs/a.md'], root).status, 0);
  assert.deepEqual(fs.readFileSync(file), before);
  const migrated = run([copy, '--repo', root, '--migrate-baseline'], root);
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).allowed, [{ file: 'docs/a.md', rule: 'github-link', fingerprint: digest('docs/a.md', 'github-link', link), count: 2 }]);
  fs.appendFileSync(path.join(root, 'docs/a.md'), `${link}\n`);
  const excess = run([copy, '--repo', root], root);
  assert.equal(excess.status, 1);
  fs.writeFileSync(file, `{"allowed":${link}`);
  for (const flags of [[], ['--migrate-baseline']]) {
    const broken = run([copy, '--repo', root, ...flags], root);
    assert.equal(broken.status, 2);
    for (const stream of [broken.stdout, broken.stderr]) assert.equal(stream.includes(link), false);
  }
  for (const result of [migrated, excess]) for (const stream of [result.stdout, result.stderr]) assert.equal(stream.includes(link), false);
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

test('the installer refuses to replace a repository\'s own file at the copy path, and says when local edits were replaced', (t) => {
  const root = tempRepo(t, { '.github/scripts/plain-text-check.cjs': '// the repository\'s own script\n' });
  const refused = run([INSTALLER, '--repo', root], root);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /is not a Toolkit copy, so nothing was installed/);
  assert.equal(fs.existsSync(path.join(root, '.github', 'plain-text.json')), false, 'nothing was written');
  fs.rmSync(path.join(root, '.github', 'scripts', 'plain-text-check.cjs'));
  const first = run([INSTALLER, '--repo', root], root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /the baseline and the check copy through a pull request\. Add the CI job with --workflow/);
  fs.appendFileSync(path.join(root, '.github', 'scripts', 'plain-text-check.cjs'), '// local edit\n');
  assert.match(run([INSTALLER, '--repo', root], root).stdout, /local edits to the copy were replaced/);
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
