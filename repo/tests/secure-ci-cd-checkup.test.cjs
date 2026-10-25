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

// Tests that let the check-up look for gh point it at an empty config folder with no token, so a
// logged-in machine makes no GitHub call.
function offlineGh(t) {
  const saved = { ...process.env };
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-checkup-gh-'));
  process.env.GH_CONFIG_DIR = config;
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete process.env[key];
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); fs.rmSync(config, { recursive: true, force: true }); });
  return process.env;
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
  const hashed = report({ 'package.json': pkg, 'a.test.js': '', '.github/workflows/ci.yml': WORKFLOW('echo "build #1" && npm test') });
  assert.deepEqual(hashed.filter((e) => e.level === 'GAP' && /^(parts|tests)\./.test(e.check)), [], 'a quoted # does not cut the real command');
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

// Fixes from the gate review: programs outside the repository, unknown required checks, started
// versus named scripts, and one fixture per coverage rule.

test('git and gh resolve to absolute paths outside the repository and never start inside it', (t) => {
  const childProcess = require('node:child_process');
  const real = childProcess.spawnSync;
  const seen = [];
  childProcess.spawnSync = (command, args, options) => { seen.push({ command, cwd: options && options.cwd }); return real(command, args, options); };
  t.after(() => { childProcess.spawnSync = real; });
  offlineGh(t);
  const dir = fixture({ 'tools/once.sh': '', '.github/workflows/ci.yml': WORKFLOW('echo ok'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml') });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['git', 'gh', 'git.exe', 'gh.exe']) fs.writeFileSync(path.join(dir, name), '');
  for (const name of ['git', 'gh', 'git.exe', 'gh.exe']) fs.writeFileSync(path.join(bin, name), '');
  const saved = process.env.PATH;
  process.env.PATH = [dir, bin, '.', saved].join(path.delimiter);
  t.after(() => { process.env.PATH = saved; });
  checkup.checkup(dir, { github: true });
  // Again with the temp folder inside the repository.
  fs.mkdirSync(path.join(dir, '.tmp'));
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) process.env[key] = path.join(dir, '.tmp');
  checkup.checkup(dir, { github: true });
  // A folder in the repository whose name starts with two dots is still inside it.
  fs.mkdirSync(path.join(dir, '..cache'));
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) process.env[key] = path.join(dir, '..cache');
  checkup.checkup(dir, { github: true });
  assert.ok(seen.length > 0, 'git ran');
  const realDir = fs.realpathSync(dir).toLowerCase();
  for (const { command, cwd } of seen) {
    assert.ok(path.isAbsolute(command), `absolute: ${command}`);
    assert.ok(!path.resolve(command).toLowerCase().startsWith(path.resolve(dir).toLowerCase()) && !path.resolve(command).toLowerCase().startsWith(realDir), `outside the repository: ${command}`);
    assert.ok(cwd && !path.resolve(cwd).toLowerCase().startsWith(path.resolve(dir).toLowerCase()) && !fs.realpathSync(cwd).toLowerCase().startsWith(realDir), `cwd outside the repository: ${cwd}`);
  }
});

test('resolveExecutable skips the repository, folders inside it and relative entries', () => {
  const exists = (file) => true;
  const posix = { platform: 'linux', exists };
  assert.equal(checkup.resolveExecutable('git', '/work/repo', { ...posix, environment: { PATH: '/work/repo:/work/repo/bin:.:bin:/usr/bin' } }), '/usr/bin/git');
  assert.equal(checkup.resolveExecutable('git', '/work/repo', { ...posix, environment: { PATH: '/work/repo:/work/repo/bin' } }), null);
  assert.equal(checkup.resolveExecutable('/work/repo/git', '/work/repo', posix), null, 'an absolute name inside the repository is refused');
  assert.equal(checkup.resolveExecutable('/opt/git/bin/git', '/work/repo', posix), '/opt/git/bin/git');
  const win = { platform: 'win32', exists };
  assert.equal(checkup.resolveExecutable('gh', 'C:\\Work\\Repo', { ...win, environment: { Path: 'c:\\work\\repo;C:\\WORK\\REPO\\tools;"C:\\Program Files\\GitHub CLI"' } }), 'C:\\Program Files\\GitHub CLI\\gh.exe');
});

test('a git.exe and gh.exe planted in the repository do not run', { skip: process.platform !== 'win32' }, (t) => {
  const dir = fixture({ '.github/workflows/ci.yml': WORKFLOW('echo ok'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml') });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The planted copies are node.exe, so they would run and answer instead of git or gh if started.
  for (const name of ['git.exe', 'gh.exe']) { try { fs.linkSync(process.execPath, path.join(dir, name)); } catch { fs.copyFileSync(process.execPath, path.join(dir, name)); } }
  const env = { ...offlineGh(t) };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[key];
  const probe = `const childProcess = require('node:child_process');
const seen = [];
const real = childProcess.spawnSync;
childProcess.spawnSync = (command, ...rest) => { seen.push(String(command)); return real(command, ...rest); };
require(${JSON.stringify(SCRIPT)}).checkup(process.cwd(), { github: true });
console.log(JSON.stringify(seen));`;
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: dir, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.ok(seen.length > 0);
  for (const command of seen) {
    assert.match(command, /^[A-Za-z]:\\.*\\(git|gh)\.exe$/i, command);
    assert.ok(!command.toLowerCase().startsWith(dir.toLowerCase()), command);
  }
});

test('required checks: any read that fails is unknown, never "nothing required"', () => {
  const api = (answers) => (args) => (Object.prototype.hasOwnProperty.call(answers, args[0]) ? answers[args[0]] : null);
  const b = 'repos/o/r/branches/main';
  const r = 'repos/o/r/rules/branches/main';
  const p = 'repos/o/r/branches/main/protection/required_status_checks';
  assert.equal(checkup.requiredCheckNames(api({}), 'o/r', 'main'), null, 'branch unreadable');
  assert.equal(checkup.requiredCheckNames(api({ [b]: { protected: true } }), 'o/r', 'main'), null, 'rules unreadable');
  assert.equal(checkup.requiredCheckNames(api({ [b]: { protected: true }, [r]: [] }), 'o/r', 'main'), null, 'protection needs admin');
  assert.deepEqual(checkup.requiredCheckNames(api({ [b]: { protected: false }, [r]: [] }), 'o/r', 'main'), []);
  assert.deepEqual(checkup.requiredCheckNames(api({ [b]: { protected: true }, [r]: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }], [p]: { contexts: ['test'], checks: [] } }), 'o/r', 'main'), ['lint', 'test']);
  const workflow = WORKFLOW('pytest').replace('  pull_request:\n', "  pull_request:\n    paths: ['src/**']\n");
  assert.equal(hits(report({ '.github/workflows/ci.yml': workflow }, { requiredChecks: null }), 'hygiene.paths').length, 1, 'unknown keeps the CHECK');
  const on = "name: CI\non:\n  pull_request:\n    paths: ['src/**']\npermissions: {}\njobs:\n";
  const paths = (jobs, required) => hits(checkup.checkHygiene([], [checkup.parseWorkflow('.github/workflows/ci.yml', on + jobs)], '.', required), 'hygiene.paths').length;
  assert.equal(paths('  call:\n    uses: ./.github/workflows/reusable.yml\n', ['call / test']), 1, 'a reusable workflow job reports as <caller> / <job>');
  assert.equal(paths('  test:\n    name: Node ${{ matrix.node }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n', ['Node 20']), 1, 'an expression name is unknown');
  assert.equal(paths('  test:\n    name: Node ${{ matrix.node }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n', []), 0, 'nothing required');
  assert.equal(paths('  call:\n    uses: ./.github/workflows/reusable.yml\n', ['lint']), 1, 'a reusable workflow may hold the unmatched check');
  assert.equal(paths('  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n', ['lint']), 0, 'the required check is elsewhere');
  const caller = checkup.parseWorkflow('.github/workflows/call.yml', 'name: Call\non: push\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n');
  const matrix = checkup.parseWorkflow('.github/workflows/ci.yml', on + '  build:\n    name: Node ${{ matrix.node }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run build\n');
  assert.equal(hits(checkup.checkHygiene([], [caller, matrix], '.', ['call / test']), 'hygiene.paths').length, 0, 'the check matched its reusable caller, so the other workflow holds none');
});

test('scripts: a script CI only names (compiles or lints) is not counted as run', () => {
  const files = { 'scripts/x.py': '', 'scripts/y.py': '' };
  const items = report({ ...files, '.github/workflows/ci.yml': WORKFLOW('|\n          python -m py_compile scripts/x.py\n          ruff check scripts/y.py') });
  assert.deepEqual(hits(items, 'scripts.untested').map((e) => e.path), ['scripts/x.py', 'scripts/y.py']);
  const run = report({ ...files, '.github/workflows/ci.yml': WORKFLOW('|\n          python -u scripts/x.py\n          ./scripts/y.py') });
  assert.deepEqual(hits(run, 'scripts.untested'), []);
  const named = { 'scripts/x.sh': '', 'scripts/y.js': '', 'tests/smoke.py': '', 'smoke.py': '' };
  const quiet = report({ ...named, '.github/workflows/ci.yml': WORKFLOW('|\n          echo ok # bash scripts/x.sh\n          bash -n scripts/x.sh\n          node --check scripts/y.js\n          pytest -m smoke') });
  assert.deepEqual(hits(quiet, 'scripts.untested').map((e) => e.path), ['scripts/x.sh', 'scripts/y.js', 'smoke.py'], 'a comment, a syntax check and a pytest marker run nothing');
  const started = report({ ...named, '.github/workflows/ci.yml': WORKFLOW('|\n          bash -e scripts/x.sh\n          node scripts/y.js\n          python -m smoke') });
  assert.deepEqual(hits(started, 'scripts.untested'), []);
  const text = report({ ...named, '.github/workflows/ci.yml': WORKFLOW('|\n          echo "run bash scripts/x.sh to fix"\n          echo \'node scripts/y.js\'') });
  assert.deepEqual(hits(text, 'scripts.untested').map((e) => e.path).filter((rel) => rel.startsWith('scripts/')), ['scripts/x.sh', 'scripts/y.js'], 'an interpreter inside a quoted string runs nothing');
  const afterHash = report({ ...named, '.github/workflows/ci.yml': WORKFLOW('|\n          echo "step #1" && bash scripts/x.sh\n          echo \'a # b\'; node "scripts/y.js"') });
  assert.deepEqual(hits(afterHash, 'scripts.untested').map((e) => e.path).filter((rel) => rel.startsWith('scripts/')), [], 'a quoted # starts no comment');
});

test('--base leaves the git index untouched and refuses a ref that starts with -', () => {
  const dir = fixture({ 'tools/old.sh': '', '.github/workflows/ci.yml': WORKFLOW('echo ok'), 'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml') });
  const git = (...args) => assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).status, 0);
  try {
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    // An old file time makes git want to refresh the index; the check-up must not.
    const old = new Date(Date.now() - 86400000);
    fs.utimesSync(path.join(dir, 'tools', 'old.sh'), old, old);
    const index = path.join(dir, '.git', 'index');
    const before = fs.readFileSync(index);
    const beforeTime = fs.statSync(index).mtimeMs;
    checkup.checkup(dir, { github: false, base: 'HEAD' });
    assert.deepEqual(fs.readFileSync(index), before);
    assert.equal(fs.statSync(index).mtimeMs, beforeTime);
    const saved = process.cwd();
    process.chdir(dir);
    // Without an index refresh a touched file counts as changed; that only widens the report.
    try { assert.deepEqual(checkup.checkup('.', { github: false, base: 'HEAD' }).items.map((e) => e.path), ['tools/old.sh'], 'a relative root works with git'); }
    finally { process.chdir(saved); }
    const result = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--no-github', '--base', '--output=x'], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'x')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a file whose real location is outside the repository is not read', (t) => {
  const outside = fixture({ 'STATUS.md': STATUS('ci.yml'), 'tests/a.test.js': '', 'secret.cjs': '' });
  const dir = fixture({ '.github/workflows/ci.yml': WORKFLOW('echo ok') });
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  // A status document named by a path that climbs out of the repository is not read.
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'ci-checkup.json'), JSON.stringify({ schema: 'ci-checkup/v1', status_doc: `../${path.basename(outside)}/STATUS.md` }));
  assert.deepEqual(hits(checkup.checkup(dir, { github: false }).items, 'status.doc').map((e) => e.message), ['no CI status document']);
  // A folder link (a junction on Windows, which needs no privilege): git lists the files under a
  // junction, so only the real-location test keeps them out.
  try { fs.symlinkSync(path.join(outside, 'tests'), path.join(dir, 'away'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.skip('folder links are not allowed here'); return; }
  try { fs.symlinkSync(path.join(outside, 'secret.cjs'), path.join(dir, 'linked.cjs')); } catch { /* file links need privilege on Windows */ }
  for (const useGit of [false, true]) {
    if (useGit) assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
    const items = checkup.checkup(dir, { github: false }).items;
    assert.deepEqual(items.filter((e) => /linked\.cjs|away\//.test(e.path)), [], useGit ? 'with git' : 'folder walk');
  }
});

test('scripts: each coverage rule counts on its own', () => {
  const lone = (files) => hits(report({ '.github/workflows/ci.yml': WORKFLOW('echo ok'), ...files }), 'scripts.untested').map((e) => e.path);
  assert.deepEqual(lone({ 'pkg/app/__main__.py': 'from app.cli import main\nmain()\n' }), [], 'thin __main__.py');
  assert.deepEqual(lone({ 'pkg/app/__main__.py': 'x = 1\n'.repeat(31) }), ['pkg/app/__main__.py'], 'a long __main__.py is not thin');
  assert.deepEqual(lone({ 'package.json': JSON.stringify({ scripts: { gen: 'node tools/gen.cjs' } }), 'tools/gen.cjs': '' }), [], 'started by a package script');
  assert.deepEqual(lone({ 'package.json': JSON.stringify({ scripts: { gen: 'eslint tools/gen.cjs' } }), 'tools/gen.cjs': '' }), ['tools/gen.cjs'], 'only named by a package script');
  assert.deepEqual(lone({ 'deep/scripts/render_page.py': '', 'tests/test_x.py': 'import sys\nsys.path.insert(0, "deep/scripts")\nfrom render_page import go\n' }), [], 'bare import found anywhere');
  assert.deepEqual(hits(report({ 'tools/report_job/__main__.py': 'x = 1\n'.repeat(40), '.github/workflows/ci.yml': WORKFLOW('python -m tools.report_job') }), 'scripts.untested'), [], 'python -m in a CI command');
});

test('speed and parts: a long non-test job is not raised, and a dev container Dockerfile is not a gap', () => {
  const dir = fixture({
    '.github/workflows/ci.yml': WORKFLOW('echo analyse').replace('  test:\n', '  analyze:\n').replace('name: Test', 'name: CodeQL analyse'),
    '.devcontainer/Dockerfile': 'FROM scratch\n',
    'docs/ci-cd/CURRENT_CICD_STATUS.md': STATUS('ci.yml'),
  });
  try {
    const items = checkup.checkup(dir, { github: false, jobTimes: new Map([['CI / analyze', 1800]]) }).items;
    assert.deepEqual(hits(items, 'speed.jobs'), []);
    assert.deepEqual(hits(items, 'parts.docker'), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scripts: a test named after a longer script does not cover the shorter one', () => {
  const items = report({ 'scripts/deploy.py': '', 'scripts/deploy_template.py': '', 'tests/test_deploy_template.py': '', '.github/workflows/ci.yml': WORKFLOW('pytest tests') });
  assert.deepEqual(hits(items, 'scripts.untested').map((e) => e.path), ['scripts/deploy.py']);
});

test('hygiene: path filters are found in flow style and at any indentation', () => {
  const flow = WORKFLOW('pytest').replace("on:\n  pull_request:\n  push:\n    branches: [main]\n", "on:\n  pull_request: { paths: ['src/**'] }\n");
  const deep = WORKFLOW('pytest').replace("on:\n  pull_request:\n  push:\n    branches: [main]\n", "on:\n    pull_request:\n        branches: [main]\n        paths-ignore:\n            - docs/**\n    push:\n        branches: [main]\n");
  const fullyFlow = "name: CI\non: { pull_request: { paths: ['src/**'] }, push: {} }\njobs: {}\n";
  const fullyFlowPush = "name: CI\non: { pull_request: {}, push: { paths: ['src/**'] } }\njobs: {}\n";
  const pushOnly = WORKFLOW('pytest').replace("  push:\n    branches: [main]\n", "  push:\n    paths: ['src/**']\n");
  for (const [text, want] of [[flow, true], [deep, true], [fullyFlow, true], [fullyFlowPush, false], [pushOnly, false]]) assert.equal(checkup.parseWorkflow('.github/workflows/ci.yml', text).prPathFilters, want, text);
});
