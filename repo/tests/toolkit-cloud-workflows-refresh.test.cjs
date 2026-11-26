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
const { SWEEPS, putCopied } = require('./support/default-cloud-workflows.cjs');
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
  for (const row of SWEEPS) {
    const text = workflows.render(row.id, source(row.file), COMMIT);
    put(row.file, pinned ? pinnedCopy(text, COMMIT) : text);
  }
  putCopied(dir, { root: ROOT, commit: COMMIT });
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
        this.commits.set(sha, { tree: input.tree, parents: input.parents, message: input.message });
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
  assert.match(pr.body, /^This pull request brings this repository's Toolkit copies up to date\. .*Where this repository's task auto-merge is on, the controller lands it once its checks are green, after `toolkit-cloud-workflows\.cjs --repo <checkout> --land-refresh` proves every file, and tells the owner after; otherwise the owner merges it\./);
  // The one UAT line the auto-merge check reads, beside the Toolkit commit line it points to.
  assert.equal(require(path.join(ROOT, 'repo/scripts/toolkit-auto-merge-eligible.cjs')).uatVerdict(pr.body).state, 'NOT_REQUIRED');
  assert.match(pr.body, /`\.github\/workflows\/toolkit-programme-sweep\.yml`: pinned to one Toolkit commit, now follows Toolkit main/);
  assert.match(pr.body, /`\.github\/scripts\/plain-text-check\.cjs`: vendored check updated/);
  assert.match(pr.body, /`\.github\/plain-text-baseline\.json`: plain-text baseline moved to the fingerprint format \(--migrate-baseline\)/);
  assert.doesNotMatch(pr.body, /Generated with|Co-Authored-By|claude\.ai/, 'no tool attribution');
  // The full Toolkit commit the copies were rendered from, on one line of the body and the commit.
  assert.equal(pr.body.split('\n').at(-1), `Toolkit commit: ${COMMIT}`);
  assert.equal(pr.body.match(/^Toolkit commit: /gm).length, 1);
  assert.equal(github.commits.get(github.refs.get(BRANCH)).message, `Refresh the Toolkit copies\n\nToolkit commit: ${COMMIT}`);
  const files = github.diff(github.refs.get('main'), github.refs.get(BRANCH)).map(entry => entry.filename);
  assert.deepEqual(files, ['.github/plain-text-baseline.json', '.github/scripts/plain-text-check.cjs', ...SWEEPS.map(row => row.file)].sort());
  const head = github.filesOf(github.refs.get(BRANCH));
  for (const row of SWEEPS) assert.equal(head[row.file], workflows.render(row.id, source(row.file), COMMIT), `${row.file} is today's render`);
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
  const older = '0123456'.padEnd(40, '0');
  github.pulls[0].body = github.pulls[0].body.replace(`Toolkit commit: ${COMMIT}`, `Toolkit commit: ${older}`);
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

// A Toolkit checkout on its origin/main one commit after COMMIT, with the same files: its renders differ
// from COMMIT's only in the header's toolkit=. { root, commit } for runRefresh.
function laterToolkit(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-later-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet', '-b', 'main']);
  fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), `${path.resolve(ROOT, git(ROOT, ['rev-parse', '--git-path', 'objects']))}\n`);
  const head = git(root, ['commit-tree', git(ROOT, ['rev-parse', 'HEAD^{tree}']), '-p', COMMIT, '-m', 'later']);
  git(root, ['update-ref', 'refs/heads/main', head]);
  git(root, ['update-ref', 'refs/remotes/origin/main', head]);
  git(root, ['remote', 'add', 'origin', 'https://github.com/weijunswj/ai-agent-toolkit.git']);
  return { root, commit: head };
}

// Red on the parent: a branch that moved kept the workflow copies an earlier run made, so its files were
// not all the render of the one Toolkit commit the pull request names.
test('refresh PR: when the branch moves, every copy on it is the render of the Toolkit commit its commit line names', t => {
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  assert.equal(runRefresh(dir, github).code, 0);
  // Main moves on (its readme changes, its vendored check gets older), and a later Toolkit commit
  // refreshes again.
  github.advanceMain('README.md', 'App, more\n');
  fs.writeFileSync(path.join(dir, '.github/scripts/plain-text-check.cjs'), plainText.vendoredText(`${source('skills/secure-ci-cd/scripts/plain-text-check.cjs')}// an even older check\n`));
  github.advanceMain('.github/scripts/plain-text-check.cjs', fs.readFileSync(path.join(dir, '.github/scripts/plain-text-check.cjs'), 'utf8'));
  const later = laterToolkit(t);
  assert.match(runRefresh(dir, github, later).line, /^Updated refresh pull request /);
  const files = github.filesOf(github.refs.get(BRANCH));
  for (const row of SWEEPS) assert.equal(files[row.file], workflows.render(row.id, source(row.file), later.commit), `${row.file} is the render of ${later.commit.slice(0, 7)}`);
  assert.equal(github.pulls[0].body.split('\n').at(-1), `Toolkit commit: ${later.commit}`);
  assert.equal(github.commits.get(github.refs.get(BRANCH)).message, `Refresh the Toolkit copies\n\nToolkit commit: ${later.commit}`);
});

// Red on the parent: the refresh refused unless the checkout sat at the default branch head with no
// change under .github, so a controller working in a feature-branch worktree could not run it.
test('refresh PR: works from any checkout of the repository, reading the default branch head, never the working tree', t => {
  const dir = governedCheckout(t);
  const github = new FakeGitHub(dir);
  // A feature branch with its own change to a copy, and changes under .github not committed anywhere.
  git(dir, ['checkout', '--quiet', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, SWEEPS[0].file), 'name: mine\non: push\n');
  git(dir, ['commit', '--quiet', '-am', 'feature work']);
  fs.appendFileSync(path.join(dir, '.github/plain-text.json'), '\n');
  fs.rmSync(path.join(dir, '.github/scripts/plain-text-check.cjs'));
  const status = git(dir, ['status', '--porcelain']);
  const result = runRefresh(dir, github);
  assert.equal(result.code, 0, result.line);
  assert.match(result.line, /^Opened refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 \(4 files: /);
  assert.deepEqual(github.diff(github.refs.get('main'), github.refs.get(BRANCH)).map(entry => entry.filename), ['.github/plain-text-baseline.json', '.github/scripts/plain-text-check.cjs', ...SWEEPS.map(row => row.file)].sort());
  assert.equal(github.filesOf(github.refs.get(BRANCH))[SWEEPS[0].file], workflows.render(SWEEPS[0].id, source(SWEEPS[0].file), COMMIT));
  assert.equal(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature', 'the checkout stays on its branch');
  assert.equal(git(dir, ['status', '--porcelain']), status, 'its local changes stay as they were');
  // GitHub's default branch head is not in this checkout: one fetch from origin brings it, and the
  // refresh compares that commit (here its vendored check is current, so it is not changed).
  const fetched = governedCheckout(t);
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-origin-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-refresh-other-'));
  t.after(() => { fs.rmSync(origin, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); });
  git(origin, ['clone', '--quiet', '--bare', fetched, '.']);
  git(fetched, ['remote', 'add', 'origin', origin]);
  git(other, ['clone', '--quiet', origin, '.']);
  fs.writeFileSync(path.join(other, '.github/scripts/plain-text-check.cjs'), plainText.vendoredText(source('skills/secure-ci-cd/scripts/plain-text-check.cjs')));
  git(other, ['commit', '--quiet', '-am', 'current check']);
  git(other, ['push', '--quiet', 'origin', 'main']);
  const ahead = git(other, ['rev-parse', 'HEAD']);
  const later = new FakeGitHub(fetched);
  later.seed(ahead, [later.refs.get('main')], treeOf(other, 'HEAD'));
  later.refs.set('main', ahead);
  const head = git(fetched, ['rev-parse', 'HEAD']);
  const pulled = runRefresh(fetched, later);
  assert.equal(pulled.code, 0, pulled.line);
  assert.match(pulled.line, /\(3 files: /, 'the vendored check on the fetched head is current');
  assert.equal(git(fetched, ['rev-parse', 'HEAD']), head, 'no local branch moved');
  // Not in the checkout and origin cannot give it: one line, nothing written.
  const lost = governedCheckout(t);
  const missing = new FakeGitHub(lost);
  missing.seed('a'.repeat(40), [missing.refs.get('main')], treeOf(lost, 'HEAD'));
  missing.refs.set('main', 'a'.repeat(40));
  const refused = runRefresh(lost, missing);
  assert.equal(refused.code, 2);
  assert.equal(refused.line, 'No refresh pull request: main\'s head aaaaaaa on GitHub is not in this checkout, and fetching main from origin did not bring it; run git fetch origin in the checkout, then run this again.');
  assert.deepEqual(missing.writes(), []);
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

test('refresh PR: it stops, with the step, on a copy it would roll back, someone else\'s copy or work on its branch', t => {
  const cases = [
    ['copy from a newer Toolkit', dir => { const row = SWEEPS[0]; fs.writeFileSync(path.join(dir, row.file), pinnedCopy(workflows.render(row.id, source(row.file), 'f'.repeat(40)), 'f'.repeat(40))); git(dir, ['commit', '--quiet', '-am', 'newer']); }, /made by Toolkit commit fffffff, which this Toolkit checkout [^]*update the Toolkit checkout/],
    ['not a Toolkit copy', dir => { fs.writeFileSync(path.join(dir, SWEEPS[0].file), 'name: Mine\non: push\n'); git(dir, ['commit', '--quiet', '-am', 'mine']); }, /is not a Toolkit copy; move it aside/],
  ];
  for (const [name, change, why] of cases) {
    const dir = governedCheckout(t);
    const github = new FakeGitHub(dir);
    change(dir, github);
    github.seed(git(dir, ['rev-parse', 'HEAD']), [github.refs.get('main')], treeOf(dir, 'HEAD'));
    github.refs.set('main', git(dir, ['rev-parse', 'HEAD']));
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
  // Nor is someone's own file at a copied workflow's path, or guard settings this run would not carry on;
  // a Toolkit copy there, edited by hand or not, is the refresh's to rewrite.
  const installer = require(path.join(ROOT, 'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs'));
  for (const [file, text, stops] of [
    ['.github/workflows/personal-data-sweep.yml', 'name: ours\n', true],
    ['.github/workflows/personal-data-guard.yml', 'name: ours\n', true],
    ['.github/scripts/personal-data-guard.cjs', '// ours\n', true],
    ['.github/workflows/dependency-auto-merge.yml', 'name: ours\n', true],
    ['.github/personal-data-guard.json', '{"ours":true}\n', true],
    ['.github/scripts/personal-data-guard.cjs', `${installer.vendoredText()}// a hand edit\n`, false],
    ['.github/workflows/personal-data-guard.yml', installer.workflowText('personal-data-guard', 'name: an older check\n'), false],
  ]) {
    const held = new FakeGitHub(dir);
    held.commits.set('d'.repeat(40), { tree: held.treeSha({ ...held.filesOf(base), [file]: text }), parents: [base] });
    held.refs.set(BRANCH, 'd'.repeat(40));
    const outcome = runRefresh(dir, held);
    assert.equal(outcome.code, stops ? 2 : 0, `${file}: ${outcome.line}`);
    if (stops) { assert.ok(outcome.line.includes(`also changes ${file}; land or remove that work first`), outcome.line); assert.deepEqual(held.writes(), [], file); }
  }
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
  assert.match(err.join(''), /choose one of --check, --refresh-pr and --land-refresh/);
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

// Red on the parent: a refresh added only the sweep and its gate.
test('refresh PR: a governed repository missing default workflows gets them in one pull request, and a rerun once merged changes nothing', t => {
  const dir = governedCheckout(t, { pinned: false, vendored: false, baseline: false });
  const missing = ['.github/personal-data-guard.json', '.github/scripts/personal-data-guard.cjs', '.github/workflows/dependency-auto-merge.yml', '.github/workflows/personal-data-guard.yml', '.github/workflows/personal-data-sweep.yml'];
  git(dir, ['rm', '--quiet', ...missing]);
  git(dir, ['commit', '--quiet', '-m', 'without two workflows']);
  const github = new FakeGitHub(dir);
  const first = runRefresh(dir, github);
  assert.match(first.line, /^Opened refresh pull request https:\/\/github\.com\/acme\/app\/pull\/1 \(5 files: /, first.line);
  assert.deepEqual(github.diff(github.refs.get('main'), github.refs.get(BRANCH)).map(entry => entry.filename), missing);
  for (const file of missing) assert.ok(github.pulls[0].body.includes(`- \`${file}\`: added`), file);
  assert.match(github.pulls[0].body, /to list what is already here, start \.github\/workflows\/personal-data-sweep\.yml once by hand after the merge/);
  assert.match(runRefresh(dir, github).line, /^Unchanged refresh pull request /);
  assert.equal(github.pulls.length, 1, 'the open pull request is kept, never doubled');
  // Settings someone changed on the open refresh branch stay theirs on a rerun.
  const branch = github.refs.get(BRANCH), own = '{ "schema": "personal-data-guard/v1", "mine": true }\n';
  github.commits.set('d'.repeat(40), { tree: github.treeSha({ ...github.filesOf(branch), [missing[0]]: own }), parents: [branch] });
  github.refs.set(BRANCH, 'd'.repeat(40));
  assert.match(runRefresh(dir, github).line, /^Unchanged refresh pull request /);
  assert.equal(github.filesOf(github.refs.get(BRANCH))[missing[0]], own);
  // Merged: nothing is left to do.
  for (const file of missing) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), github.filesOf(github.refs.get(BRANCH))[file]); }
  github.advanceMain('README.md', 'App, merged\n');
  github.pulls[0].state = 'closed';
  const done = runRefresh(dir, github);
  assert.equal(done.line, 'The Toolkit copies in acme/app are current; no refresh pull request is needed.');
  assert.equal(github.pulls.length, 1);
});

test('refresh PR: an edited guard is brought back, and someone else\'s file in a copied workflow\'s place is left with a note', t => {
  const dir = governedCheckout(t, { pinned: false, vendored: false, baseline: false });
  fs.appendFileSync(path.join(dir, '.github/scripts/personal-data-guard.cjs'), '// mine\n');
  fs.writeFileSync(path.join(dir, '.github/workflows/dependency-auto-merge.yml'), 'name: Mine\non: push\n');
  git(dir, ['commit', '--quiet', '-am', 'local changes']);
  const github = new FakeGitHub(dir);
  assert.match(runRefresh(dir, github).line, /\(1 file: \.github\/scripts\/personal-data-guard\.cjs\)/);
  assert.match(github.pulls[0].body, /`\.github\/scripts\/personal-data-guard\.cjs`: edited by hand, rewritten/);
  assert.match(github.pulls[0].body, /dependency-auto-merge\.yml is not a Toolkit copy, so it is left as it is/);
  assert.equal(github.filesOf(github.refs.get(BRANCH))['.github/workflows/dependency-auto-merge.yml'], 'name: Mine\non: push\n');
});

test('refresh PR: the retired identity setting goes in the same pull request as the new guard script, named, with the owner\'s other settings kept', t => {
  const dir = governedCheckout(t, { pinned: false, vendored: false, baseline: false });
  const installer = require(path.join(ROOT, 'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs'));
  const config = '.github/personal-data-guard.json', script = '.github/scripts/personal-data-guard.cjs';
  const own = { ...JSON.parse(fs.readFileSync(path.join(dir, config), 'utf8')), not_scanned: [{ path: 'a.png', reason: 'artwork' }] };
  fs.writeFileSync(path.join(dir, config), `${JSON.stringify({ ...own, identity: 'included' }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, script), installer.vendoredText('#!/usr/bin/env node\n// older\n'));
  git(dir, ['commit', '--quiet', '-am', 'an older guard']);
  const github = new FakeGitHub(dir);
  assert.match(runRefresh(dir, github).line, /\(2 files: \.github\/scripts\/personal-data-guard\.cjs, \.github\/personal-data-guard\.json\)/);
  assert.match(github.pulls[0].body, /`\.github\/personal-data-guard\.json`: the retired identity setting, which no guard reads any more, taken out/);
  assert.deepEqual(JSON.parse(github.filesOf(github.refs.get(BRANCH))[config]), own);
  // A rerun with the branch already there changes nothing, and settings someone added on it stay.
  assert.match(runRefresh(dir, github).line, /^Unchanged refresh pull request /);
  const branch = github.refs.get(BRANCH), mine = { ...own, identity: 'included', mine: true };
  github.commits.set('e'.repeat(40), { tree: github.treeSha({ ...github.filesOf(branch), [config]: `${JSON.stringify(mine, null, 2)}\n` }), parents: [branch] });
  github.refs.set(BRANCH, 'e'.repeat(40));
  runRefresh(dir, github);
  assert.deepEqual(JSON.parse(github.filesOf(github.refs.get(BRANCH))[config]), { ...own, mine: true });
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
  assert.equal(github.pulls[0].body.split('\n').at(-1), `Toolkit commit: ${head}`, 'rendered at the checkout\'s own commit');
  assert.deepEqual(err, []);
  out.length = 0;
  const held = () => ({ ...ENABLED(), governed_effects_hold: true });
  assert.equal(workflows.main(['--repo', dir, '--refresh-pr'], { ...io, root, refresh: () => {}, governance: held, github: new FakeGitHub(dir).api() }), 2);
  assert.deepEqual(out, [], 'nothing on stdout');
  assert.equal(err.join(''), 'No refresh pull request: the merged programme binding could not be read in the last 24 hours; run refresh governance online first.\n');
});
