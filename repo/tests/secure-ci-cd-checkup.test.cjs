'use strict';

// CI check-up: one fixture per row of what it compares (parts, tests, scripts, speed, hygiene,
// status document), each with a clean twin that must report nothing for that row.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'ci-checkup.cjs');
const checkup = require(SCRIPT);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHA = 'a'.repeat(40);

const STATUS = (...workflows) => `# Current CI/CD Status\n\n${workflows.map((name) => `- .github/workflows/${name}`).join('\n')}\n`;
const WORKFLOW = (run, extra = '') => `name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v4
      - name: Test
        run: ${run}
${extra}`;

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-checkup-'));
  for (const [rel, text] of Object.entries(files)) {
    if (text === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function report(files, options = {}) {
  const dir = fixture({ 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml'), ...files });
  try { return checkup.checkup(dir, { github: false, ...options }).items; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function hits(items, check, rel) {
  return items.filter((entry) => entry.check === check && (rel === undefined || entry.path.replace(/:\d+$/, '') === rel));
}

test('parts: a package test script no step runs is a gap; the twin that runs it is clean', () => {
  const pkg = JSON.stringify({ scripts: { test: 'node --test' } });
  const gap = report({ 'package.json': pkg, 'a.test.js': '', '.github/workflows/ci.yml': WORKFLOW('node lint.js'), 'lint.js': '' });
  assert.equal(hits(gap, 'parts.package-script', 'package.json')[0].level, 'GAP');
  assert.match(hits(gap, 'parts.package-script', 'package.json')[0].fix, /npm run test/);
  assert.deepEqual(hits(gap, 'tests.unreached', 'a.test.js').map((e) => e.level), ['GAP']);
  const clean = report({ 'package.json': pkg, 'a.test.js': '', '.github/workflows/ci.yml': WORKFLOW('npm test') });
  assert.deepEqual(hits(clean, 'parts.package-script'), []);
  assert.deepEqual(hits(clean, 'tests.unreached'), [], 'node --test in the package folder reaches its test files');
});

test('parts: a package script in a subfolder counts only when run there', () => {
  const files = { 'web/package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) };
  assert.equal(hits(report({ ...files, '.github/workflows/ci.yml': WORKFLOW('npm run lint') }), 'parts.package-script', 'web/package.json').length, 1);
  assert.deepEqual(hits(report({ ...files, '.github/workflows/ci.yml': WORKFLOW('npm --prefix web run lint') }), 'parts.package-script'), []);
  assert.deepEqual(hits(report({ ...files, '.github/workflows/ci.yml': WORKFLOW('cd web && npm run lint') }), 'parts.package-script'), []);
});

test('parts: manifests and Dockerfiles with no build step are gaps', () => {
  const gap = report({ 'svc/go.mod': 'module x\n', 'Dockerfile': 'FROM scratch\n', '.github/workflows/ci.yml': WORKFLOW('echo hi') });
  assert.equal(hits(gap, 'parts.manifest', 'svc/go.mod')[0].level, 'GAP');
  assert.equal(hits(gap, 'parts.docker', 'Dockerfile')[0].level, 'GAP');
  const clean = report({ 'svc/go.mod': 'module x\n', 'Dockerfile': 'FROM scratch\n', '.github/workflows/ci.yml': WORKFLOW('|\n          cd svc && go test ./...\n          docker build .') });
  assert.deepEqual(hits(clean, 'parts.manifest'), []);
  assert.deepEqual(hits(clean, 'parts.docker'), []);
});

test('tests: a Python test folder no step reaches is a gap; pytest on it is clean', () => {
  const files = { 'pyproject.toml': '[project]\nname = "x"\n', 'app/core.py': 'X = 1\n', 'tests/test_core.py': 'from app import core\n' };
  const gap = report({ ...files, '.github/workflows/ci.yml': WORKFLOW('pip install .') });
  assert.deepEqual(hits(gap, 'tests.unreached', 'tests/test_core.py').map((e) => e.level), ['GAP']);
  const clean = report({ ...files, '.github/workflows/ci.yml': WORKFLOW('pytest tests') });
  assert.deepEqual(hits(clean, 'tests.unreached'), []);
  assert.deepEqual(hits(clean, 'scripts.untested'), [], 'the test imports app/core.py');
});

test('tests: a folder a reached script names is reached, so a custom runner needs no glob in CI', () => {
  const items = report({
    'scripts/run-tests.cjs': "const DIR = 'checks/unit';\n",
    'checks/unit/a.test.cjs': "require('../../scripts/run-tests.cjs');\n",
    '.github/workflows/ci.yml': WORKFLOW('node scripts/run-tests.cjs'),
  });
  assert.deepEqual(hits(items, 'tests.unreached'), []);
});

test('scripts: a script reached only through require is not flagged; a lone script is a CHECK', () => {
  const items = report({
    'lib/main.cjs': "require('./helper.cjs');\nrequire('./util');\n",
    'lib/helper.cjs': '',
    'lib/util.js': '',
    'tools/once.sh': 'echo once\n',
    'test/main.test.cjs': "require('../lib/main.cjs');\n",
    '.github/workflows/ci.yml': WORKFLOW('node --test test/'),
  });
  assert.deepEqual(hits(items, 'scripts.untested').map((e) => [e.level, e.path]), [['CHECK', 'tools/once.sh']]);
});

test('scripts: a script a test runs through its package script name is covered', () => {
  const items = report({
    'package.json': JSON.stringify({ scripts: { 'sync-docs': 'node tools/sync.cjs' } }),
    'tools/sync.cjs': '',
    'test/sync.test.cjs': "spawnSync('npm', ['run', 'sync-docs']);\n",
    '.github/workflows/ci.yml': WORKFLOW('node --test test/'),
  });
  assert.deepEqual(hits(items, 'scripts.untested'), []);
});

test('hygiene: unpinned actions, masked test steps, missing permissions and path filters', () => {
  const bad = `name: CI
on:
  pull_request:
    paths: ['src/**']
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Unit tests
        run: npm test || true
      - name: More tests
        continue-on-error: true
        run: npm test
      - name: Quiet
        shell: bash {0}
        run: npm test
`;
  const items = report({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), '.github/workflows/ci.yml': bad });
  assert.deepEqual(hits(items, 'hygiene.unpinned').map((e) => e.path), ['.github/workflows/ci.yml:9']);
  assert.equal(hits(items, 'hygiene.masked').length, 3);
  assert.ok(hits(items, 'hygiene.masked').every((e) => e.level === 'GAP'));
  assert.equal(hits(items, 'hygiene.permissions').length, 1);
  assert.equal(hits(items, 'hygiene.paths')[0].level, 'CHECK');
  assert.equal(hits(items, 'hygiene.dependabot')[0].level, 'CHECK');

  const clean = report({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    '.github/workflows/ci.yml': WORKFLOW('npm test'),
    '.github/dependabot.yml': 'version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n',
  });
  for (const check of ['hygiene.unpinned', 'hygiene.masked', 'hygiene.permissions', 'hygiene.paths', 'hygiene.dependabot']) assert.deepEqual(hits(clean, check), [], check);
});

test('hygiene: a job-level continue-on-error on a test job is a gap', () => {
  const items = report({ '.github/workflows/ci.yml': WORKFLOW('pytest').replace('    runs-on:', '    continue-on-error: true\n    runs-on:') });
  assert.equal(hits(items, 'hygiene.masked')[0].level, 'GAP');
});

test('status: a missing document, an unlisted workflow and a listed workflow that is gone', () => {
  const workflow = { '.github/workflows/ci.yml': WORKFLOW('echo ok') };
  const dir = fixture(workflow);
  try { assert.match(hits(checkup.checkup(dir, { github: false }).items, 'status.doc')[0].message, /no CI status document/); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const stale = report({ ...workflow, '.github/workflows/release.yml': WORKFLOW('echo ok'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml', 'deploy.yml') });
  assert.deepEqual(hits(stale, 'status.doc').map((e) => e.message).sort(), ['does not list .github/workflows/release.yml', 'lists .github/workflows/deploy.yml, which does not exist']);
  assert.deepEqual(hits(report(workflow), 'status.doc'), []);
  const named = report({ ...workflow, 'docs/ci-cd/CURRENT_CICD_STATUS.md': '', 'docs/CI.md': STATUS('ci.yml'), '.github/ci-checkup.json': JSON.stringify({ schema: 'ci-checkup/v1', status_doc: 'docs/CI.md' }) });
  assert.deepEqual(hits(named, 'status.doc'), [], 'the settings file names the status document');
});

test('settings: ignores need a reason and a known check; a reasoned ignore hides its item', () => {
  const base = { 'tools/once.sh': '', '.github/workflows/ci.yml': WORKFLOW('echo ok') };
  for (const ignore of [[{ check: 'scripts.untested', path: 'tools/once.sh' }], [{ check: 'scripts.untested', path: 'tools/once.sh', reason: 'short' }], [{ check: 'no.such', path: 'x', reason: 'a long enough reason' }]]) {
    const dir = fixture({ ...base, '.github/ci-checkup.json': JSON.stringify({ schema: 'ci-checkup/v1', ignore }) });
    try {
      const result = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--no-github'], { encoding: 'utf8' });
      assert.equal(result.status, 2, JSON.stringify(ignore));
      assert.match(result.stderr, /ci-checkup\.json refused/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const ok = report({ ...base, '.github/ci-checkup.json': JSON.stringify({ schema: 'ci-checkup/v1', ignore: [{ check: 'scripts.untested', path: 'tools/', reason: 'one-off maintenance helpers, run by hand' }] }) });
  assert.deepEqual(hits(ok, 'scripts.untested'), []);
});

test('speed: without GitHub access job times say "not checked"; no budget is a CHECK', () => {
  const dir = fixture({ '.github/workflows/ci.yml': WORKFLOW('pytest'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml') });
  try {
    const items = checkup.checkup(dir, { github: true, gh: 'gh-not-installed-for-ci-checkup-test' }).items;
    assert.match(hits(items, 'speed.jobs')[0].message, /not checked \(no GitHub access\)/);
    assert.equal(hits(items, 'speed.budget')[0].level, 'CHECK');
    const budgeted = fixture({ '.github/ci-checkup.json': JSON.stringify({ schema: 'ci-checkup/v1', budgets: { job_seconds: 600 } }) });
    try { assert.deepEqual(hits(checkup.checkup(budgeted, { github: false }).items, 'speed.budget'), []); }
    finally { fs.rmSync(budgeted, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--base keeps only items that touch changed paths', () => {
  const dir = fixture({ 'tools/old.sh': '', '.github/workflows/ci.yml': WORKFLOW('echo ok'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml') });
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(dir, 'tools', 'new.sh'), '');
    const all = hits(checkup.checkup(dir, { github: false }).items, 'scripts.untested').map((e) => e.path);
    assert.deepEqual(all, ['tools/new.sh', 'tools/old.sh']);
    const changed = checkup.checkup(dir, { github: false, base: 'HEAD' }).items.map((e) => e.path);
    assert.deepEqual(changed, ['tools/new.sh']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('it writes nothing and reports in text and JSON', () => {
  const dir = fixture({ 'tools/once.sh': '', '.github/workflows/ci.yml': WORKFLOW('echo ok') });
  const snapshot = () => {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(`${path.relative(dir, p)} ${fs.statSync(p).mtimeMs} ${fs.statSync(p).size}`); } };
    walk(dir);
    return out.sort();
  };
  try {
    const before = snapshot();
    const text = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--no-github'], { encoding: 'utf8' });
    assert.equal(text.status, 0);
    assert.match(text.stdout, /^CHECK scripts\.untested {2}tools\/once\.sh: /m);
    assert.match(text.stdout, /This report changes nothing\./);
    const json = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--no-github', '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(json.stdout).schema, 'ci-checkup-report/v1');
    assert.deepEqual(snapshot(), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /\b(writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|mkdirSync|copyFileSync)\b/);
  assert.doesNotMatch(source, /require\(['"](?!node:)/, 'zero dependencies');
});

test('this repository: no gap in parts, tests or workflow hygiene', () => {
  const items = checkup.checkup(REPO_ROOT, { github: false }).items;
  const noisy = items.filter((entry) => entry.level === 'GAP' && /^(parts|tests|hygiene)\./.test(entry.check));
  assert.deepEqual(noisy, []);
});

// Rules tightened after measuring the check-up on two other governed repositories.

test('hygiene: shell: bash runs with -e and is not masked; the shell test builtin is not a test step', () => {
  const workflow = WORKFLOW('pytest').replace('      - name: Test', `      - name: Assert head
        shell: bash
        run: test "$A" = "$B"
      - name: Quiet assert
        shell: bash {0}
        run: test "$A" = "$B"
      - name: Test`);
  const items = hits(report({ '.github/workflows/ci.yml': workflow }), 'hygiene.masked');
  assert.deepEqual(items.map((e) => [e.level, e.path]), [['CHECK', '.github/workflows/ci.yml:16']]);
});

test('hygiene: path filters are not raised when the required checks are known and none is in that workflow', () => {
  const workflow = checkup.parseWorkflow('.github/workflows/ci.yml', WORKFLOW('pytest').replace('  pull_request:\n', "  pull_request:\n    paths: ['src/**']\n"));
  assert.equal(hits(checkup.checkHygiene([], [workflow], '.', null), 'hygiene.paths').length, 1, 'unknown required checks: raised');
  assert.equal(hits(checkup.checkHygiene([], [workflow], '.', ['scan-pr-commits']), 'hygiene.paths').length, 0);
  assert.equal(hits(checkup.checkHygiene([], [workflow], '.', ['test']), 'hygiene.paths').length, 1);
});

test('tests: test_*.js is a test file, and a runner given a target reaches only that target', () => {
  const items = report({
    'tests/test_core.py': '',
    'monitor/test_monitor.py': '',
    'monitor/test_code.js': '',
    '.github/workflows/ci.yml': WORKFLOW('python -m unittest discover -s tests'),
  });
  assert.deepEqual(hits(items, 'tests.unreached').map((e) => e.path).sort(), ['monitor/test_code.js', 'monitor/test_monitor.py']);
  assert.deepEqual(hits(items, 'scripts.untested'), [], 'a test file is never an untested script');
});

test('scripts: CI-run scripts, thin __main__ wrappers, bare imports and tests named after a script all count', () => {
  const items = report({
    'scripts/validate_rules.py': '',
    'scripts/verify_hosted_validation.py': '',
    'scripts/deploy_template.py': '',
    'webapp/internal_auth.py': '',
    'pkg/app/__main__.py': 'from app.cli import main\nraise SystemExit(main())\n',
    'pkg/app/cli.py': '',
    'scripts/lonely_helper.py': '',
    'tests/test_hosted_validation_verifier.py': '',
    'tests/test_internal_auth.py': '',
    'tests/test_webapp.py': 'import sys\nsys.path.insert(0, "scripts")\nfrom deploy_template import render\n',
    'tests/test_cli.py': 'subprocess.run([sys.executable, "-m", "app"])\nfrom app import cli\n',
    '.github/workflows/ci.yml': WORKFLOW('|\n          pytest tests\n          python scripts/validate_rules.py'),
  });
  assert.deepEqual(hits(items, 'scripts.untested').map((e) => e.path), ['scripts/lonely_helper.py']);
});

test('status: a lone docs file named like a CI/CD status document is used when the default is missing', () => {
  const items = report({ '.github/workflows/ci.yml': WORKFLOW('echo ok'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': undefined, 'docs/current-cicd-status.md': STATUS('ci.yml') });
  assert.deepEqual(hits(items, 'status.doc'), []);
});

test('speed: a long job with no matrix is raised from measured times, whatever command it runs', () => {
  const dir = fixture({
    '.github/workflows/ci.yml': WORKFLOW('python tests/_run_ci_full_suite.py').replace('  test:\n', '  full-regression:\n'),
    'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml'),
  });
  try {
    const times = new Map([['CI / full-regression', 1491], ['CI / other', 900]]);
    const items = hits(checkup.checkup(dir, { github: false, jobTimes: times }).items, 'speed.jobs');
    assert.deepEqual(items.map((e) => e.message), ['job full-regression took up to 1491 s with no sharding or matrix']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
