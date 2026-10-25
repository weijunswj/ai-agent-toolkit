'use strict';

// Tokenless programme refresh: the `refresh` command any session may run, the per-computer pass lock,
// and the after-tool and turn-end hook paths that start it after a GitHub write.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const trigger = require('../../skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs');
const hook = require('../scripts/toolkit-programme-checkpoint-hook.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const controller = { session: 'toolkit-421-controller', prefix: 'INT-TK421-' };
const GOVERNED = () => ({ state: 'ENABLED', governed_rules_bind: true });
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-refresh-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture({ held = true } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  const outcomes = [{ issue: 423, label: 'C2', class: 'CORE', parent: 421, order: 1 }];
  github.addIssue(421, { body: '## CURRENT\n' });
  github.addIssue(423, { body: 'Body of 423' });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  const parent = state.newParent({ repository, parentIssue: 421, outcomes });
  store.write('parent', 421, held ? state.claimDocument(parent, controller, {}) : parent, { sha: null, previous: null });
  const fx = { github, store, output: '', lockFile: path.join(tmp(), 'pass.lock') };
  fx.run = (argv, extra = {}) => {
    fx.output = '';
    const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0',
      lockFile: fx.lockFile, environment: {}, stdout: { write: text => { fx.output += text; } }, ...extra };
    try { return { code: cli.main([...argv, '--json'], deps), result: JSON.parse(fx.output), error: null }; }
    catch (error) { return { code: null, result: null, error }; }
  };
  return fx;
}

test('refresh runs the full pass as the parent holder, with no session or controller flag', () => {
  const fx = fixture();
  const { result, error } = fx.run(['refresh']);
  assert.equal(error, null);
  assert.equal(result.mode, 'apply');
  assert.ok(result.writes.github > 0, 'the pages were written');
  assert.match(fx.github.issues.get(423).body, /AI-AGENT-TOOLKIT:programme-state:BEGIN STATE/);
  assert.equal(fx.store.read('parent', 421).doc.fence.holder_session, controller.session, 'the fence is unchanged');
  assert.equal(fx.run(['refresh']).result.summary, 'No changes', 'a second pass writes nothing');
});

test('refresh also runs for a session a Toolkit launcher started', () => {
  const fx = fixture();
  const { error } = fx.run(['refresh'], { environment: { TOOLKIT_GATE_ROLE: 'G1' } });
  assert.equal(error, null);
  const blocked = fx.run(['reconcile', '--apply', '--controller', '--session', controller.session], { environment: { TOOLKIT_GATE_ROLE: 'G1' } });
  assert.equal(blocked.error.code, 'USAGE', 'the controller pass stays refused for an executor');
});

test('refresh takes no decision input', () => {
  for (const extra of [['--session', 'x'], ['--controller'], ['--issue', '423'], ['--apply'], ['--patch', 'x.json']]) {
    assert.throws(() => cli.parseArgs(['refresh', ...extra]), { code: 'USAGE' }, extra.join(' '));
  }
  assert.doesNotThrow(() => cli.parseArgs(['refresh', '--json', '--repo-root', '.']));
});

test('refresh refuses when no controller holds the parent', () => {
  const fx = fixture({ held: false });
  assert.equal(fx.run(['refresh']).error.code, 'PARENT_UNHELD');
});

test('the pass lock: refresh skips and reconcile --apply refuses while another pass holds it; a stale lock is taken over', () => {
  const fx = fixture();
  const release = cli.takeLock(fx.lockFile);
  assert.equal(typeof release, 'function');
  const skipped = fx.run(['refresh']);
  assert.deepEqual([skipped.code, skipped.result.outcome], [0, 'SKIPPED']);
  assert.equal(fx.github.issues.get(423).body, 'Body of 423', 'nothing was written');
  assert.equal(fx.run(['reconcile', '--apply', '--controller', '--session', controller.session]).error.code, 'PASS_RUNNING');
  assert.equal(fx.run(['reconcile']).error, null, 'a dry run needs no lock');
  release();
  assert.equal(fs.existsSync(fx.lockFile), false);
  assert.equal(fx.run(['refresh']).error, null);
  assert.equal(fs.existsSync(fx.lockFile), false, 'released after the pass');
  cli.takeLock(fx.lockFile);
  assert.equal(cli.takeLock(fx.lockFile), null);
  assert.equal(typeof cli.takeLock(fx.lockFile, Date.now() + cli.LOCK_STALE_MS + 1000), 'function', 'a lock from a dead pass is replaced');
});

// --- Hook paths ---

function governedCheckout() {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.github'));
  fs.writeFileSync(path.join(root, '.github', 'toolkit-programme.json'), JSON.stringify({ repository: 'acme/app' }));
  fs.mkdirSync(path.join(root, 'sub'));
  return root;
}

const post = (tool, toolInput, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: extra.cwd || '/nowhere', tool_name: tool, tool_input: toolInput, ...extra });

test('GitHub writes are recognised; reads and other repositories are not', () => {
  const writes = [
    post('mcp__github__issue_write', { owner: 'acme', repo: 'app', method: 'update' }),
    post('mcp__github__add_issue_comment', { owner: 'acme', repo: 'app' }),
    post('mcp__github__merge_pull_request', { owner: 'acme', repo: 'app' }),
    post('mcp__plugin_engineering_github__push_files', { owner: 'acme', repo: 'app' }),
    post('Bash', { command: 'gh pr create --fill' }),
    post('Bash', { command: 'gh issue comment 421 --body-file x.md' }),
    post('PowerShell', { command: 'gh.exe pr merge 12 --merge' }),
    post('Bash', { command: 'gh api repos/acme/app/issues/1 -X PATCH -f body=x' }),
    post('Bash', { command: 'gh api repos/acme/app/issues/1/comments -f body=x' }),
    post('Bash', { command: 'gh api graphql -f query="mutation { x }"' }),
    post('Bash', { command: 'git push -u origin feature' }),
    post('Bash', { command: ['bash', '-lc', 'git -C repo push'] }),
  ];
  for (const input of writes) assert.ok(trigger.githubWrite(input), `${input.tool_name} ${JSON.stringify(input.tool_input)}`);
  assert.equal(trigger.githubWrite(writes[0]).repository, 'acme/app');
  assert.equal(trigger.githubWrite(writes[4]).repository, null);
  const reads = [
    post('mcp__github__issue_read', { owner: 'acme', repo: 'app' }),
    post('mcp__github__list_pull_requests', { owner: 'acme', repo: 'app' }),
    post('mcp__notion__notion-create-pages', {}),
    post('mcp__slack__issue_write', {}),
    post('Bash', { command: 'gh pr view 12 --json state' }),
    post('Bash', { command: 'gh api repos/acme/app/issues/1' }),
    post('Bash', { command: 'git status && git log' }),
    post('Edit', { file_path: 'x' }),
  ];
  for (const input of reads) assert.equal(trigger.githubWrite(input), null, `${input.tool_name} ${JSON.stringify(input.tool_input)}`);
});

test('a marked session starts one refresh per governed checkout at turn end, then the mark is gone', () => {
  const root = governedCheckout();
  const deps = { refreshDir: tmp(), governanceState: GOVERNED, started: [] };
  deps.start = folder => deps.started.push(folder);
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify(post('Bash', { command: 'gh pr create' }, { cwd: path.join(root, 'sub') })) }), 0);
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify(post('mcp__github__issue_write', { owner: 'Acme', repo: 'App' }, { cwd: root })) }), 0);
  assert.equal(fs.readdirSync(deps.refreshDir).length, 1, 'one mark for the session');
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: root }) }), 0);
  assert.deepEqual(deps.started, [root]);
  assert.deepEqual(fs.readdirSync(deps.refreshDir), [], 'mark cleared');
  assert.equal(trigger.onStop({ session_id: 's1', cwd: root }, deps).outcome, 'UNMARKED', 'the next turn end starts nothing');
});

test('no refresh for unmarked sessions, other repositories, ungoverned folders or governance off', () => {
  const root = governedCheckout();
  const base = { refreshDir: tmp(), started: [] };
  const start = folder => base.started.push(folder);
  const cases = [
    [post('mcp__github__issue_write', { owner: 'other', repo: 'thing' }, { cwd: root }), GOVERNED, 'NOT_GOVERNED'],
    [post('Bash', { command: 'gh pr create' }, { cwd: tmp() }), GOVERNED, 'NOT_GOVERNED'],
    [post('Bash', { command: 'gh pr create' }, { cwd: root }), () => ({ state: 'DISABLED' }), 'NOT_GOVERNED'],
  ];
  for (const [input, governanceState, outcome] of cases) {
    const deps = { ...base, governanceState, start };
    trigger.markWrite(input, deps);
    assert.equal(trigger.onStop({ session_id: 's1', cwd: input.cwd }, deps).outcome, outcome);
  }
  assert.equal(trigger.onStop({ session_id: 'never-wrote', cwd: root }, { ...base, governanceState: GOVERNED, start }).outcome, 'UNMARKED');
  assert.deepEqual(base.started, []);
});

test('the real hook script marks nothing for reads, exits 0 and prints nothing', () => {
  const home = tmp();
  for (const input of [post('mcp__github__issue_read', { owner: 'acme', repo: 'app' }), { hook_event_name: 'Stop', session_id: 'nobody', cwd: home }, 'not json']) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-programme-checkpoint-hook.cjs')], {
      input: typeof input === 'string' ? input : JSON.stringify(input), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 30000,
    });
    assert.deepEqual([result.status, result.stdout], [0, '']);
  }
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit')), false);
});

test('the shipped hooks send after-tool events for shell and connector tools to the same script', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/host-contract-v1.json'), 'utf8'));
  const spec = contract.after_tool_hook;
  assert.equal(spec.script, contract.turn_end_hook.script);
  for (const [host, hostSpec] of Object.entries(contract.hosts)) {
    for (const file of [hostSpec.hooks_file, `repo/contracts/toolkit-local-bridge/${host === 'codex' ? 'codex' : 'claude'}-plugin/hooks/hooks.json`]) {
      const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks;
      assert.deepEqual(hooks[spec.event], [{ matcher: hostSpec.after_tool_matcher, hooks: [{ type: 'command', command: `node "\${${hostSpec.plugin_root_variable}}/${spec.script}"`, timeout: spec.timeout_seconds }] }], file);
    }
  }
});
