'use strict';

// The validation gate has one list (the validate.yml "Run validation" step), the whitespace check
// compares the whole change with its base, and Toolkit's own workflows pin every action to a commit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DURATIONS_COMMAND, LOCAL_TESTS, gateCommands, localCommands } = require('../scripts/run-validation-gate.cjs');
const { VERIFY_COMMAND } = require('../scripts/ci-test-shards.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

test('npm run validate:all runs exactly the CI gate list from validate.yml', () => {
  const commands = gateCommands(read('.github/workflows/validate.yml'));
  const checks = [
    'node repo/scripts/sync-repo-doc-contract.cjs --check',
    'node repo/scripts/sync-agent-instruction-shims.cjs --check',
    'node repo/scripts/audit-project-source-locks.cjs',
    'node repo/scripts/audit-skill-portability.cjs',
    'node repo/scripts/audit-published-surfaces.cjs --check',
    'node repo/scripts/audit-fallback-risk.cjs',
    'node repo/scripts/validate-toolkit.cjs',
    'node repo/scripts/run-design-tests.cjs',
    'node repo/scripts/generate-n8n-stack-launcher-flow.cjs --check',
    'node repo/scripts/check-diff-whitespace.cjs',
    DURATIONS_COMMAND,
  ];
  for (const required of checks) assert.ok(commands.includes(required), required);
  // CI ends by checking the shard summaries; a local run has no shards and runs every test file there.
  assert.equal(commands.at(-1), VERIFY_COMMAND);
  assert.equal(commands.length, checks.length + 1);
  // The budget check reads the CI shard summaries, so a local run leaves only it out.
  assert.equal(DURATIONS_COMMAND, 'node repo/scripts/check-test-durations.cjs --ci');
  const local = localCommands(commands);
  assert.deepEqual(local.slice(0, -1), commands.slice(0, -1).filter((command) => command !== DURATIONS_COMMAND));
  assert.equal(local.at(-1), LOCAL_TESTS);
  assert.equal(LOCAL_TESTS, 'node repo/scripts/run-tests.cjs --all');
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['validate:all'], 'node repo/scripts/run-validation-gate.cjs');
  assert.equal(scripts.test, 'node repo/scripts/run-tests.cjs --all');
  assert.equal(scripts['test:changed'], 'node repo/scripts/run-tests.cjs --changed');
  assert.equal(scripts['validate:whitespace'], 'node repo/scripts/check-diff-whitespace.cjs');
  assert.doesNotMatch(read('.github/workflows/validate.yml'), /^\s+git diff --check\s*$/m, 'no whitespace check that compares nothing');
});

test('the gate list parser reads only the named step and refuses a missing or empty step', () => {
  const workflow = [
    'jobs:', '  validate:', '    steps:',
    '      - name: Run validation', '        env:', '          X: y', '        run: |', '          first --a', '', '          second', '      - name: Later', '        run: |', '          not-in-gate',
  ].join('\n');
  assert.deepEqual(gateCommands(workflow), ['first --a', 'second']);
  assert.throws(() => gateCommands(workflow, 'Absent'), /has no "Absent" step/);
  assert.throws(() => gateCommands(['      - name: Run validation', '        run: echo one', '      - name: Next', '        run: |', '          x'].join('\n')), /no multi-line run block/);
});

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function whitespaceCheck(cwd, environment = {}) {
  const env = { ...process.env, ...environment };
  if (!Object.hasOwn(environment, 'DIFF_BASE')) delete env.DIFF_BASE;
  return spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'check-diff-whitespace.cjs')], { cwd, env, encoding: 'utf8' });
}

test('the whitespace check finds a committed whitespace error that a clean-tree git diff --check misses', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-whitespace-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'clean\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
  git(repo, ['switch', '-q', '-c', 'feature']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'clean\ntrailing space \n');
  git(repo, ['commit', '-q', '-am', 'change with trailing whitespace']);

  const plain = spawnSync('git', ['diff', '--check'], { cwd: repo, encoding: 'utf8' });
  assert.equal(plain.status, 0, 'a clean checkout gives plain git diff --check nothing to compare');
  const ci = whitespaceCheck(repo, { DIFF_BASE: base });
  assert.notEqual(ci.status, 0, 'CI base: the committed error is found');
  assert.match(`${ci.stdout}${ci.stderr}`, /a\.txt:2: trailing whitespace/);
  const local = whitespaceCheck(repo);
  assert.notEqual(local.status, 0, 'local: compared with where the branch left origin/main');
  const missing = whitespaceCheck(repo, { DIFF_BASE: 'f'.repeat(40) });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /is not a commit in this checkout/);

  fs.writeFileSync(path.join(repo, 'a.txt'), 'clean\nfixed\n');
  git(repo, ['commit', '-q', '-am', 'fix']);
  assert.equal(whitespaceCheck(repo, { DIFF_BASE: base }).status, 0);
});

test("every action in Toolkit's own workflows is pinned to a commit SHA with its version", () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  const uses = [];
  for (const name of fs.readdirSync(dir).filter((file) => /\.ya?ml$/.test(file))) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/);
      if (match) uses.push(`${name}: ${match[1]}`);
    }
  }
  assert.ok(uses.length > 0);
  for (const use of uses) assert.match(use, /: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, use);
});
