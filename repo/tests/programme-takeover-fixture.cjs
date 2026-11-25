'use strict';

// One programme to take over, in an in-memory GitHub, for the takeover tests. `backend` picks where its
// state documents are: in the private store (`store`), or on the public state branch (`branch`).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { sessionHash } = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
const { BranchFakeGitHub } = require('./toolkit-programme-branch-fake.cjs');

const REPO = 'acme/app';
const STORE_REPO = 'acme/state-store';
const STORE_PATH = `state/${REPO}/`;
const PARENT_FILE = `${STORE_PATH}parent-421.json`;
const PREFIX = 'INT-TK421-';
const MINUTE = 60 * 1000;
const controller = { session: 'desk-controller-1', prefix: PREFIX };
const NEW = 'desk-controller-2';
const WORDS = ['--surface', 'test harness (host evidence read)', '--next', 'read the repository map'];
const PAGE = /^<!-- programme-page-archive/;
const OUTCOMES = [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1 }];
const STORE = { kind: 'github', repository: STORE_REPO, branch: 'main', path: STORE_PATH };
const temps = [];
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-takeover-')); temps.push(dir); return dir; };

function fixture({ held = true, missing = false, holder = controller, backend = 'store' } = {}) {
  const branch = backend === 'branch';
  const github = new (branch ? BranchFakeGitHub : FakeGitHub)({ repository: REPO, store: STORE_REPO });
  github.repos.get(REPO).default_branch = 'main';
  github.addIssue(421, { body: '## CURRENT\n' });
  github.addIssue(423, { body: 'Task' });
  const now = () => new Date(github.clock).toISOString();
  const common = { transport: github, now, toolkitVersion: '3.9.0' };
  const v2 = { schema: state.SCHEMA.bindingV2, repository: REPO, governance: 'enabled', parents: [{ issue: 421, record_prefix: PREFIX }], store: STORE, required_checks: ['validate'] };
  const binding = branch ? state.validateBinding({ ...v2, state: { kind: 'branch', branch: state.STATE_BRANCH, path: 'state/' } })
    : { schema: state.SCHEMA.binding, repository: REPO, parent_issue: 421, record_prefix: PREFIX, writer_prefix: PREFIX, store: STORE, required_checks: ['validate'] };
  const dir = branch ? temporary() : __dirname;
  const fx = { github, binding, now, backend, output: '', errors: '' };
  fx.other = () => (branch ? state.openStore({ ...common, binding, localCheckpoint: null }) : new state.StateStore({ ...common, store: STORE }));
  fx.deps = (extra = {}) => ({ transport: github, binding, originUrl: `https://github.com/${REPO}.git`, repoRoot: dir, toolkitVersion: '3.9.0', environment: {}, now, toolkitGit: () => ({ status: 128, stdout: '', stderr: '', error: null }),
    ...(branch ? { stateCheckpointDir: path.join(dir, 'checkpoints'), attentionDir: path.join(dir, 'attention') } : {}),
    stdout: { write: text => { fx.output += text; } }, stderr: { write: text => { fx.errors += text; } }, ...extra });
  fx.run = (argv, extra) => {
    fx.output = '';
    fx.errors = '';
    const from = github.calls.length;
    try {
      const code = cli.main(argv, fx.deps(extra));
      return { code, result: fx.output.startsWith('{') ? JSON.parse(fx.output) : fx.output, error: null, calls: github.calls.slice(from) };
    } catch (error) {
      if (!error.code) throw error;
      return { result: null, error, calls: github.calls.slice(from) };
    }
  };
  const first = new state.StateStore({ ...common, store: STORE });
  const empty = state.newParent({ repository: REPO, parentIssue: 421, outcomes: OUTCOMES });
  if (!missing) first.write('parent', 421, held ? state.claimDocument(empty, holder, {}) : empty, { sha: null, previous: null });
  if (branch) {
    const move = { binding: state.validateBinding(v2), confirm: () => true };
    const dry = fx.run(['migrate-state', '--dry-run', '--json'], move);
    assert.equal(dry.error, null, dry.error?.message);
    const moved = fx.run(['migrate-state', '--apply', '--plan-digest', dry.result.plan_digest, '--controller', '--session', holder.session, '--json'], move);
    assert.equal(moved.error, null, moved.error?.message);
  }
  fx.store = branch ? null : first;
  // The old controller has been quiet for an hour unless a test says otherwise.
  fx.wait = minutes => { github.clock += minutes * MINUTE; };
  fx.wait(60);
  // A part of a test done by someone else: no hook of the run under test sees it, nor does a lagging branch read.
  fx.aside = effect => {
    const { hooks, branchLag } = github;
    github.hooks = [];
    github.branchLag = false;
    try { return effect(); } finally { github.hooks = hooks; github.branchLag = branchLag; }
  };
  fx.parentDoc = () => fx.aside(() => fx.other().read('parent', 421).doc);
  fx.fence = () => (branch ? fx.parentDoc().fence : JSON.parse(github.files.get(PARENT_FILE).text).fence);
  // Every parent fence that ever was: what really landed, whatever anyone was told.
  fx.fences = () => {
    const texts = branch ? [...github.git(REPO).commits.values()].map(commit => commit.files.get('state/parent-421.json')) : [...github.snapshots.values()].map(files => files?.get(PARENT_FILE)?.text);
    return texts.filter(Boolean).map(text => JSON.parse(text).fence);
  };
  fx.everHeld = (session, epoch) => fx.fences().some(fence => fence.epoch === epoch && (branch ? fence.holder_session_hash === sessionHash(session) : fence.holder_session === session));
  fx.takeover = (extra = [], { session = NEW, apply = true, deps = {} } = {}) => fx.run(['takeover', '--session', session, ...WORDS, ...(apply ? ['--apply', '--controller'] : []), '--json', ...extra], deps);
  fx.dry = (extra = [], options = {}) => fx.takeover(extra, { ...options, apply: false });
  // Another writer, on its own store object, as another process would be.
  fx.oldWrites = (note = 'old controller at work') => fx.other().mutate('parent', 421, { writer: holder, change: doc => { doc.private.note = `${note} ${github.clock}`; return doc; } });
  fx.sweepWrites = () => fx.other().mutate('parent', 421, { writer: state.refreshWriter(fx.other().read('parent', 421).doc),
    change: doc => { doc.attention = []; doc.private.sweep_note = String(github.clock); return doc; } });
  fx.commit = (file, message, login = github.login) => { github.committer = login; github.putFile(`${STORE_PATH}${file}`, { at: github.clock, message }, message); github.committer = null; };
  // Another controller's claim from the epoch the parent is at, whole: the fence and its record.
  fx.rivalClaims = (session = 'desk-controller-9', commentId = 1) => fx.other().mutate('parent', 421, { writer: { session, prefix: PREFIX }, authorise: false, change: doc => {
    const next = state.claimDocument(doc, { session, prefix: PREFIX }, { takeover: true });
    return { ...next, private: { ...next.private, takeovers: [...(next.private.takeovers || []), { comment_id: commentId, from_epoch: doc.fence.epoch }] } };
  } });
  // Runs `effect` once, just before the first call that `when` matches.
  fx.before = (when, effect) => {
    let done = false;
    github.intercept(call => { if (!done && when(call)) { done = true; effect(call); } return undefined; });
  };
  fx.records = () => [...github.comments.values()].filter(comment => comment.issue === 421 && /TAKEOVER: controller/.test(comment.body));
  fx.writes = calls => calls.filter(call => call.method !== 'GET');
  return fx;
}

const POSTS = call => call.method === 'POST' && call.path.endsWith('/issues/421/comments');
const READS_RECORD = call => call.method === 'GET' && /issues\/comments\/\d+$/.test(call.path);
const CLAIMS = call => call.method === 'PUT' && call.path.endsWith('/parent-421.json');
// A read of the parent document on its branch, and one at a fixed commit.
const READS_PARENT = call => call.method === 'GET' && call.path.includes('/parent-421.json?ref=');
const AT_COMMIT = call => READS_PARENT(call) && /\?ref=(?:c\d+|[0-9a-f]{40})$/.test(call.path);
const ON_BRANCH = call => READS_PARENT(call) && !AT_COMMIT(call);
// Nothing anywhere: no comment, no edit, no store commit.
function wroteNothing(fx, run, label) { assert.deepEqual(fx.writes(run.calls).map(call => `${call.method} ${call.path}`), [], `${label}: nothing was written`); }

module.exports = { state, FakeGitHub, fixture, wroteNothing, REPO, STORE_REPO, STORE_PATH, PARENT_FILE, PREFIX, MINUTE, controller, NEW, WORDS, PAGE, POSTS, READS_RECORD, CLAIMS, READS_PARENT, AT_COMMIT, ON_BRANCH };
