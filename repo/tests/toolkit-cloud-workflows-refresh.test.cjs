'use strict';

// The refresh pull request (toolkit-cloud-workflows.cjs --refresh-pr): governed repositories only,
// one open pull request per repository, no partial pull request on any failure, only Toolkit-made files
// change, and it is read back and never merged. GitHub is an in-memory fake that keeps commits, trees,
// the refresh branch and its pull requests.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflows = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows.cjs'));
const refresh = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows-refresh.cjs'));
const plainText = require(path.join(ROOT, 'skills/secure-ci-cd/scripts/install-plain-text-check.cjs'));
const { pinnedCopy } = require('./support/pinned-cloud-copy.cjs');
const COMMIT = workflows.toolkitHead(ROOT);
const BRANCH = 'toolkit/refresh-cloud-workflows';
const REPOSITORY = 'acme/app';
const ENABLED = () => ({ state: 'ENABLED', rule: 'M1', repository: REPOSITORY });
const source = file => spawnSync('git', ['show', `${COMMIT}:${file}`], { cwd: ROOT, encoding: 'utf8' }).stdout;

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// A governed checkout whose sweep and gate are pinned to one Toolkit commit (as before layouts), with
// an outdated vendored plain-text check and a baseline in the old format, committed on main.
function governedCheckout(t, { pinned = true, vendored = true, baseline = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '--quiet', '-b', 'main']);
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  for (const row of workflows.WORKFLOWS) {
    const text = workflows.render(row.id, source(row.file), COMMIT);
    put(row.file, pinned ? pinnedCopy(text, COMMIT) : text);
  }
  put('README.md', 'App\n');
  put('.github/plain-text.json', `${JSON.stringify({ schema: 'toolkit-plain-text-config/v1', rules: { 'github-link': true, 'number-reference': true, 'pr-number-label': true, 'codex-mode-name': false }, banned_terms: [], explained_terms: [], kept_terms: [] }, null, 2)}\n`);
  if (vendored) put('.github/scripts/plain-text-check.cjs', plainText.vendoredText(`${source('skills/secure-ci-cd/scripts/plain-text-check.cjs')}// an older check\n`));
  if (baseline) put('.github/plain-text-baseline.json', `${JSON.stringify({ schema: 'toolkit-plain-references-baseline/v1', description: 'old', allowed: [{ file: 'README.md', rule: 'number-reference', text: '#12', count: 1 }] }, null, 2)}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'one']);
  return dir;
}

// The files of a local commit, as the fake's base tree.
function treeOf(dir, sha) {
  const files = {};
  for (const name of git(dir, ['ls-tree', '-r', '--name-only', sha]).split('\n').filter(Boolean)) files[name] = git(dir, ['show', `${sha}:${name}`]) + '\n';
  return files;
}

class FakeGitHub {
  constructor(dir) {
    this.dir = dir;
    this.trees = new Map();
    this.commits = new Map();
    this.refs = new Map();
    this.pulls = [];
    this.calls = [];
    this.failAt = null;
    this.seed(git(dir, ['rev-parse', 'HEAD']), [], treeOf(dir, 'HEAD'));
    this.refs.set('main', git(dir, ['rev-parse', 'HEAD']));
  }
  seed(sha, parents, files) {
    const tree = this.treeSha(files);
    this.commits.set(sha, { tree, parents });
  }
  treeSha(files) {
    const sha = crypto.createHash('sha1').update(JSON.stringify(Object.entries(files).sort())).digest('hex');
    this.trees.set(sha, { ...files });
    return sha;
  }
  ancestors(sha) {
    const seen = new Set();
    const walk = at => { if (!at || seen.has(at)) return; seen.add(at); for (const parent of this.commits.get(at)?.parents || []) walk(parent); };
    walk(sha);
    return seen;
  }
  filesOf(sha) { return this.trees.get(this.commits.get(sha).tree); }
  diff(from, to) {
    const a = this.filesOf(from), b = this.filesOf(to);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(name => a[name] !== b[name]).sort().map(filename => ({ filename }));
  }
  // Moves main on GitHub and in the checkout: one more commit changing `file`.
  advanceMain(file, text) {
    fs.writeFileSync(path.join(this.dir, file), text);
    git(this.dir, ['add', '-A']);
    git(this.dir, ['commit', '--quiet', '-m', 'more']);
    const sha = git(this.dir, ['rev-parse', 'HEAD']);
    this.seed(sha, [this.refs.get('main')], treeOf(this.dir, 'HEAD'));
    this.refs.set('main', sha);
  }
  api() {
    return (endpoint, { method = null, input, missing = false } = {}) => {
      const verb = method || 'GET';
      this.calls.push(`${verb} ${endpoint}`);
      if (this.failAt && this.failAt.test(`${verb} ${endpoint}`)) throw new refresh.RefreshError(`GitHub refused ${verb} ${endpoint.split('?')[0]} (HTTP 502).`);
      const base = `repos/${REPOSITORY}`;
      assert.ok(endpoint.startsWith(base), endpoint);
      const rest = endpoint.slice(base.length);
      let match;
      if (rest === '') return { default_branch: 'main' };
      if ((match = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
        const sha = this.refs.get(decodeURIComponent(match[1]));
        if (!sha) { if (missing) return null; throw new refresh.RefreshError('404'); }
        return { object: { sha } };
      }
      if ((match = /^\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(rest))) {
        const [, from, to] = match;
        const status = from === to ? 'identical' : this.ancestors(from).has(to) ? 'behind' : this.ancestors(to).has(from) ? 'ahead' : 'diverged';
        const common = [...this.ancestors(to)].filter(sha => this.ancestors(from).has(sha));
        const mergeBase = common.find(sha => common.every(other => this.ancestors(sha).has(other))) || from;
        return { status, files: this.diff(mergeBase, to) };
      }
      if ((match = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest))) return { tree: { sha: this.commits.get(match[1]).tree } };
      if ((match = /^\/contents\/([^?]+)\?ref=([0-9a-f]+)$/.exec(rest))) {
        const text = this.filesOf(match[2])[match[1].split('/').map(decodeURIComponent).join('/')];
        if (text === undefined) { if (missing) return null; throw new refresh.RefreshError('404'); }
        return { encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') };
      }
      if (rest === '/git/trees' && verb === 'POST') {
        const files = { ...this.trees.get(input.base_tree) };
        for (const entry of input.tree) files[entry.path] = entry.content;
        return { sha: this.treeSha(files) };
      }
      if (rest === '/git/commits' && verb === 'POST') {
        const sha = crypto.createHash('sha1').update(JSON.stringify([input.tree, input.parents, this.commits.size])).digest('hex');
        this.commits.set(sha, { tree: input.tree, parents: input.parents });
        return { sha };
      }
      if (rest === '/git/refs' && verb === 'POST') { this.refs.set(input.ref.replace('refs/heads/', ''), input.sha); return {}; }
      if ((match = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && verb === 'PATCH') {
        assert.equal(input.force, false, 'the refresh branch never moves by force');
        assert.ok(this.ancestors(input.sha).has(this.refs.get(match[1])), 'the refresh branch only moves forward');
        this.refs.set(match[1], input.sha);
        return {};
      }
      if (/^\/pulls\?state=open&head=/.test(rest)) return this.pulls.filter(pr => pr.state === 'open' && `${REPOSITORY.split('/')[0]}:${pr.head}` === decodeURIComponent(/head=([^&]+)/.exec(rest)[1]));
      if (rest === '/pulls' && verb === 'POST') {
        const pr = { number: this.pulls.length + 1, state: 'open', head: input.head, base: input.base, title: input.title, body: input.body };
        this.pulls.push(pr);
        return { number: pr.number };
      }
      if ((match = /^\/pulls\/(\d+)$/.exec(rest))) {
        const pr = this.pulls[Number(match[1]) - 1];
        if (verb === 'PATCH') { Object.assign(pr, input); return {}; }
        return { state: pr.state, head: { ref: pr.head, sha: this.refs.get(pr.head) }, base: { ref: pr.base }, html_url: `https://github.com/${REPOSITORY}/pull/${pr.number}`, body: pr.body };
      }
      if ((match = /^\/pulls\/(\d+)\/files/.exec(rest))) {
        const pr = this.pulls[Number(match[1]) - 1];
        return this.diff(this.refs.get(pr.base), this.refs.get(pr.head));
      }
      throw new Error(`fake GitHub has no ${verb} ${endpoint}`);
    };
  }
  writes() { return this.calls.filter(call => !call.startsWith('GET ')); }
}

// A Toolkit checkout on main whose history does not hold the copies' commit (COMMIT): A, then B on
// top, sharing this checkout's objects. `shallow` marks B as its oldest commit, as a clone made 50
// commits deep does. { root, commit } for runRefresh.
function unrelatedToolkit(t, { shallow = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-toolkit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet', '-b', 'main']);
  fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), `${path.resolve(ROOT, git(ROOT, ['rev-parse', '--git-path', 'objects']))}\n`);
  const tree = git(ROOT, ['rev-parse', 'HEAD^{tree}']);
  const B = git(root, ['commit-tree', tree, '-p', git(root, ['commit-tree', tree, '-m', 'a']), '-m', 'b']);
  git(root, ['update-ref', 'refs/heads/main', B]);
  if (shallow) fs.writeFileSync(path.join(root, '.git', 'shallow'), `${B}\n`);
  return { root, commit: B };
}

const runRefresh = (dir, github, extra = {}) => refresh.refreshPr({ repo: dir, root: ROOT, commit: COMMIT, ciShards: null, governance: ENABLED, github: github.api(), ...extra });

test('refresh PR: governed repositories only; any other repository gets one note and nothing is read or written', t => {
  const dir = governedCheckout(t);
  for (const [state, why] of [[{ state: 'DISABLED' }, /governance is off/], [{ state: 'UNDECIDED' }, /not decided/], [{ state: 'DISABLED', rule: 'S1' }, /evidence store/], [{ state: 'ERROR' }, /binding cannot be used/]]) {
    const github = new FakeGitHub(dir);
    const result = runRefresh(dir, github, { governance: () => state });
    assert.equal(result.code, 0);
    assert.match(result.line, why);
    assert.deepEqual(github.calls, [], 'nothing read from GitHub');
  }
  const github = new FakeGitHub(dir);
  const toolkit = runRefresh(ROOT, github);
  assert.match(toolkit.line, /Toolkit source checkout/);
  assert.deepEqual(github.calls, []);
  // A binding last read over 24 hours ago holds, with the step.
  const held = runRefresh(dir, github, { governance: () => ({ ...ENABLED(), governed_effects_hold: true }) });
  assert.equal(held.code, 2);
  assert.match(held.line, /^No refresh pull request: [^\n]*refresh governance/);
});

// A Toolkit checkout whose HEAD is not on its origin/main (a pull request's merge commit, a local
// branch): its own one commit, origin set to the Toolkit repository and no origin/main.
function offMainToolkit(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-offmain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['commit', '--quiet', '--allow-empty', '-m', 'one']);
  git(root, ['remote', 'add', 'origin', 'https://github.com/weijunswj/ai-agent-toolkit.git']);
  return root;
}

test('refresh PR: governance is checked before the Toolkit commit, so a Toolkit checkout off main only stops a governed repository', t => {
  const dir = governedCheckout(t);
  const root = offMainToolkit(t);
  const run = (github, governance) => refresh.refreshPr({ repo: dir, root, ciShards: null, governance, github: github.api() });
  const ungoverned = new FakeGitHub(dir);
  const note = run(ungoverned, () => ({ state: 'DISABLED' }));
  assert.equal(note.code, 0, note.line);
  assert.equal(note.line, 'No refresh pull request: its governance is off, and only governed repositories carry Toolkit copies.');
  assert.deepEqual(ungoverned.calls, [], 'nothing read from GitHub');
  const governed = new FakeGitHub(dir);
  const stopped = run(governed, ENABLED);
  assert.equal(stopped.code, 2, stopped.line);
  assert.match(stopped.line, /^No refresh pull request: Toolkit commit [0-9a-f]{7} is not on origin\/main, so GitHub could not fetch it\. Update the Toolkit checkout to main first\.$/);
  assert.deepEqual(governed.calls, [], 'stopped before any GitHub read or write');
});

test('refresh PR: one pull request with only Toolkit-made files, read back and never merged; a rerun adds nothing', t => {
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  const first = runRefresh(dir, github);
  assert.equal(first.code, 0, first.line);
  assert.match(first.line, /^Opened refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 \(4 files: /);
  assert.equal(github.pulls.length, 1);
  const pr = github.pulls[0];
  assert.equal(pr.head, BRANCH);
  assert.equal(pr.base, 'main');
  assert.match(pr.body, /^Owner: please merge this pull request\./);
  assert.match(pr.body, /`\.github\/workflows\/toolkit-programme-sweep\.yml`: pinned to one Toolkit commit, now follows Toolkit main/);
  assert.match(pr.body, /`\.github\/scripts\/plain-text-check\.cjs`: vendored check updated/);
  assert.match(pr.body, /`\.github\/plain-text-baseline\.json`: plain-text baseline moved to the fingerprint format \(--migrate-baseline\)/);
  assert.doesNotMatch(pr.body, /Generated with|Co-Authored-By|claude\.ai/, 'no tool attribution');
  const files = github.diff(github.refs.get('main'), github.refs.get(BRANCH)).map(entry => entry.filename);
  assert.deepEqual(files, ['.github/plain-text-baseline.json', '.github/scripts/plain-text-check.cjs', ...workflows.WORKFLOWS.map(row => row.file)].sort());
  const head = github.filesOf(github.refs.get(BRANCH));
  for (const row of workflows.WORKFLOWS) assert.equal(head[row.file], workflows.render(row.id, source(row.file), COMMIT), `${row.file} is today's render`);
  assert.equal(JSON.parse(head['.github/plain-text-baseline.json']).schema, 'toolkit-plain-references-baseline/v2');
  assert.equal(JSON.parse(head['.github/plain-text-baseline.json']).allowed[0].count, 1, 'the same allowance');
  assert.equal(head['README.md'], 'App\n', 'nothing else changes');
  assert.ok(!github.calls.some(call => /merge/.test(call)), 'never merged');
  assert.equal(git(dir, ['status', '--porcelain']), '', 'the checkout is not written');
  // A rerun with nothing new: no commit, no branch move, no second pull request.
  const writes = github.writes().length;
  const again = runRefresh(dir, github);
  assert.match(again.line, /^Unchanged refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 /);
  assert.equal(github.pulls.length, 1);
  assert.deepEqual(github.writes().slice(writes).filter(call => !/^POST .*\/git\/trees$/.test(call)), [], 'only the tree is rebuilt to compare');
});

test('refresh PR: a rerun from a newer Toolkit commit with the same layout and copies adds no commit and leaves the pull request', t => {
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  assert.equal(runRefresh(dir, github).code, 0);
  const before = github.refs.get(BRANCH);
  // The pull request was opened from an older Toolkit commit, and the next Toolkit commit renders the
  // same copies: only the header's toolkit= differs.
  github.pulls[0].body = github.pulls[0].body.replace(` from Toolkit ${COMMIT.slice(0, 7)}. `, ' from Toolkit 0123456. ');
  const body = github.pulls[0].body;
  const newer = 'f'.repeat(40);
  const later = { ...workflows, plan: options => { const result = workflows.plan(options); return { ...result, rows: result.rows.map(row => ({ ...row, expected: row.expected.replace(`toolkit=${COMMIT}`, `toolkit=${newer}`) })) }; } };
  const writes = github.writes().length;
  const again = runRefresh(dir, github, { workflows: later });
  assert.match(again.line, /^Unchanged refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 /, again.line);
  assert.equal(github.refs.get(BRANCH), before, 'the branch does not move');
  assert.equal(github.pulls[0].body, body, 'the pull request body is left as it is');
  assert.deepEqual(github.writes().slice(writes).filter(call => !/^POST .*\/git\/trees$/.test(call)), [], 'no commit, branch move or body edit');
  // A copy whose body changes still gets a new commit.
  const changed = { ...workflows, plan: options => { const result = workflows.plan(options); return { ...result, rows: result.rows.map(row => row.id === 'programme-sweep' ? { ...row, expected: workflows.render(row.id, `${source(row.file)}# one more line\n`, newer) } : row) }; } };
  assert.match(runRefresh(dir, github, { workflows: changed }).line, /^Updated refresh pull request /);
  assert.notEqual(github.refs.get(BRANCH), before);
});

test('refresh PR: after main moves, the open pull request is updated by a merge commit, never doubled or forced; a branch left without one gets one', t => {
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  assert.equal(runRefresh(dir, github).code, 0);
  const before = github.refs.get(BRANCH);
  github.advanceMain('README.md', 'App, more\n');
  // The vendored check moves on too, so the refresh has new content.
  fs.writeFileSync(path.join(dir, '.github/scripts/plain-text-check.cjs'), plainText.vendoredText(`${source('skills/secure-ci-cd/scripts/plain-text-check.cjs')}// an even older check\n`));
  github.advanceMain('.github/scripts/plain-text-check.cjs', fs.readFileSync(path.join(dir, '.github/scripts/plain-text-check.cjs'), 'utf8'));
  const updated = runRefresh(dir, github);
  assert.match(updated.line, /^Updated refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 /);
  assert.equal(github.pulls.length, 1, 'still one pull request');
  const head = github.commits.get(github.refs.get(BRANCH));
  assert.deepEqual(head.parents, [before, github.refs.get('main')], 'a merge commit of the old branch and main');
  assert.equal(github.filesOf(github.refs.get(BRANCH))['README.md'], 'App, more\n');
  // The owner closed it: the branch stays, a fresh pull request is opened from it.
  github.pulls[0].state = 'closed';
  const reopened = runRefresh(dir, github);
  assert.match(reopened.line, /^Opened refresh pull request https:\/\/github\.com\/acme\/app\/pull\/2 /);
  assert.equal(github.pulls.filter(pr => pr.state === 'open').length, 1);
});

test('refresh PR: a failure at any step is one line and leaves no partial pull request; a rerun finishes the job', t => {
  for (const [step, at] of [['tree', /^POST .*\/git\/trees$/], ['commit', /^POST .*\/git\/commits$/], ['branch', /^POST .*\/git\/refs$/], ['pull request', /^POST .*\/pulls$/], ['read-back', /^GET .*\/pulls\/1\/files/]]) {
    const dir = governedCheckout(t);
    const github = new FakeGitHub(dir);
    github.failAt = at;
    const failed = runRefresh(dir, github);
    assert.equal(failed.code, 2, step);
    assert.equal(failed.line.split('\n').length, 1, step);
    assert.match(failed.line, /^No refresh pull request: /, step);
    if (step !== 'read-back') assert.equal(github.pulls.length, 0, `${step}: no pull request`);
    if (['tree', 'commit'].includes(step)) assert.equal(github.refs.has(BRANCH), false, `${step}: no branch`);
    github.failAt = null;
    const rerun = runRefresh(dir, github);
    assert.equal(rerun.code, 0, `${step}: ${rerun.line}`);
    assert.equal(github.pulls.filter(pr => pr.state === 'open').length, 1, `${step}: one pull request after the rerun`);
  }
});

test('refresh PR: it stops, with the step, on a stale or changed checkout, a copy it would roll back, someone else\'s copy or work on its branch', t => {
  const cases = [
    ['checkout behind main', (dir, github) => github.advanceMain('README.md', 'x\n') || git(dir, ['reset', '--quiet', '--hard', 'HEAD~1']), /not at main's head [0-9a-f]{7} on GitHub; update it/],
    ['local change under .github', dir => fs.appendFileSync(path.join(dir, '.github/plain-text.json'), '\n'), /local changes under \.github/],
    ['copy from a newer Toolkit', dir => { const row = workflows.WORKFLOWS[0]; fs.writeFileSync(path.join(dir, row.file), pinnedCopy(workflows.render(row.id, source(row.file), 'f'.repeat(40)), 'f'.repeat(40))); git(dir, ['commit', '--quiet', '-am', 'newer']); }, /made by Toolkit commit fffffff, which this Toolkit checkout [^]*update the Toolkit checkout/],
    ['not a Toolkit copy', dir => { fs.writeFileSync(path.join(dir, workflows.WORKFLOWS[0].file), 'name: Mine\non: push\n'); git(dir, ['commit', '--quiet', '-am', 'mine']); }, /is not a Toolkit copy; move it aside/],
  ];
  for (const [name, change, why] of cases) {
    const dir = governedCheckout(t);
    const github = new FakeGitHub(dir);
    change(dir, github);
    if (name !== 'checkout behind main' && name !== 'local change under .github') { github.seed(git(dir, ['rev-parse', 'HEAD']), [github.refs.get('main')], treeOf(dir, 'HEAD')); github.refs.set('main', git(dir, ['rev-parse', 'HEAD'])); }
    // A full Toolkit checkout, so the newer copy is known to be missing whatever this checkout's depth.
    const result = runRefresh(dir, github, name === 'copy from a newer Toolkit' ? unrelatedToolkit(t) : {});
    assert.equal(result.code, 2, name);
    assert.match(result.line, why, `${name}: ${result.line}`);
    assert.deepEqual(github.writes(), [], `${name}: nothing written`);
  }
  // Someone's own work on the refresh branch is never folded in.
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  const base = github.refs.get('main');
  const tree = github.treeSha({ ...github.filesOf(base), 'src/app.js': 'mine\n' });
  github.commits.set('c'.repeat(40), { tree, parents: [base] });
  github.refs.set(BRANCH, 'c'.repeat(40));
  const result = runRefresh(dir, github);
  assert.equal(result.code, 2);
  assert.match(result.line, /branch toolkit\/refresh-cloud-workflows also changes src\/app\.js; land or remove that work first/);
  assert.deepEqual(github.writes(), []);
});

test('refresh PR: a shallow Toolkit clone that cannot reach a copy\'s commit is told to fetch its history, not to update to main', t => {
  for (const [shallow, why, not] of [[false, /which this Toolkit checkout [^]*update the Toolkit checkout to the latest main first/, /unshallow/], [true, /which this shallow Toolkit checkout \([0-9a-f]{7}\) cannot reach; run git fetch --unshallow origin in the Toolkit checkout, then run this again\.$/, /latest main/]]) {
    const toolkit = unrelatedToolkit(t, { shallow });
    const dir = governedCheckout(t);
    const github = new FakeGitHub(dir);
    const result = runRefresh(dir, github, toolkit);
    assert.equal(result.code, 2, result.line);
    assert.match(result.line, why);
    assert.doesNotMatch(result.line, not);
    assert.deepEqual(github.writes(), [], 'nothing written');
  }
});

test('refresh PR: current copies need no pull request; the command line wires --refresh-pr and refuses it with --check', t => {
  const dir = governedCheckout(t, { pinned: false, vendored: false, baseline: false });
  const github = new FakeGitHub(dir);
  const result = runRefresh(dir, github);
  assert.equal(result.code, 0);
  assert.match(result.line, /^The Toolkit copies in acme\/app are current; no refresh pull request is needed\.$/);
  assert.deepEqual(github.writes(), []);
  const out = [], err = [];
  const io = { out: { write: text => out.push(text) }, err: { write: text => err.push(text) } };
  const stale = governedCheckout(t);
  const fake = new FakeGitHub(stale);
  assert.equal(workflows.main(['--repo', stale, '--refresh-pr'], { ...io, root: ROOT, commit: COMMIT, refresh: () => {}, governance: ENABLED, github: fake.api() }), 0);
  assert.match(out.join(''), /^Opened refresh pull request /);
  assert.equal(workflows.main(['--repo', stale, '--refresh-pr', '--check'], { ...io, root: ROOT, commit: COMMIT, refresh: () => {} }), 2);
  assert.match(err.join(''), /choose --check or --refresh-pr/);
  // Run as a command, the script hands the refresh its own finished exports, never a half-loaded copy.
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-cli-'));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  git(plain, ['init', '-q']);
  // A plain folder is not governed (not a github.com repository), and that note comes before the
  // Toolkit commit check, so the result is the same wherever this checkout's HEAD is.
  const command = spawnSync(process.execPath, [path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows.cjs'), '--repo', plain, '--refresh-pr'], { cwd: plain, encoding: 'utf8', windowsHide: true });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stdout, 'No refresh pull request: its governance is off, and only governed repositories carry Toolkit copies.\n');
  assert.equal(command.stderr, '');
});

// The command once had no test past the commit check without an injected commit (a change that handed
// the raw option to the file step went unseen), and none that a refused refresh goes to stderr with exit 2.
test('refresh PR: the command finds its own Toolkit commit, and a refusal goes to stderr with exit 2', t => {
  // A Toolkit checkout whose HEAD is on its origin/main and holds COMMIT, so the copies' own commit is reachable.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-onmain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet', '-b', 'main']);
  fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), `${path.resolve(ROOT, git(ROOT, ['rev-parse', '--git-path', 'objects']))}\n`);
  const head = git(root, ['commit-tree', git(ROOT, ['rev-parse', 'HEAD^{tree}']), '-p', COMMIT, '-m', 'on main']);
  git(root, ['update-ref', 'refs/heads/main', head]);
  git(root, ['update-ref', 'refs/remotes/origin/main', head]);
  git(root, ['remote', 'add', 'origin', 'https://github.com/weijunswj/ai-agent-toolkit.git']);
  const out = [], err = [];
  const io = { out: { write: text => out.push(text) }, err: { write: text => err.push(text) } };
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  assert.equal(workflows.main(['--repo', dir, '--refresh-pr'], { ...io, root, refresh: () => {}, governance: ENABLED, github: github.api() }), 0, err.join(''));
  assert.match(out.join(''), /^Opened refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 \(4 files: /);
  assert.match(github.pulls[0].body, new RegExp(`from Toolkit ${head.slice(0, 7)}\\.`), 'rendered at the checkout\'s own commit');
  assert.deepEqual(err, []);
  out.length = 0;
  const held = () => ({ ...ENABLED(), governed_effects_hold: true });
  assert.equal(workflows.main(['--repo', dir, '--refresh-pr'], { ...io, root, refresh: () => {}, governance: held, github: new FakeGitHub(dir).api() }), 2);
  assert.deepEqual(out, [], 'nothing on stdout');
  assert.equal(err.join(''), 'No refresh pull request: the merged programme binding could not be read in the last 24 hours; run refresh governance online first.\n');
});
