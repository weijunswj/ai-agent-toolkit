'use strict';

// A governance turn-on never replaces the owner's own files on GitHub, however far behind the checkout it
// runs from is: each wanted file is judged by what GitHub holds right before the commit is made, on the
// first publish and on an update of the open pull request (toolkit-governance-owner-files.cjs). Throwaway
// repositories and a fake GitHub only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const proposal = require('../scripts/toolkit-governance-proposal.cjs');
const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
const security = require('../scripts/toolkit-governance-security.cjs');
const guard = require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs');
const plainText = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
const { COPIED_FILES, SHARDS, SWEEPS } = require('./support/default-cloud-workflows.cjs');
const { recordAbsent } = require('./toolkit-governed-fixture-support.cjs');
const COMMIT = workflows.toolkitHead(ROOT);
const SLUG = 'example-owner/example-repo';
const BASE = '9'.repeat(40), HEAD = 'a'.repeat(40);
const CONFIG = '.github/personal-data-guard.json', SCRIPT = '.github/scripts/personal-data-guard.cjs', AUTO = security.WORKFLOW_REL;
const CHECK = '.github/workflows/personal-data-guard.yml', SWEEP = '.github/workflows/personal-data-sweep.yml';
const GUARD = [CHECK, SWEEP, SCRIPT, CONFIG];
const PLAIN = { settings: '.github/plain-text.json', baseline: '.github/plain-text-baseline.json', script: '.github/scripts/plain-text-check.cjs', workflow: '.github/workflows/plain-text.yml' };
const LIST = '.github/toolkit-test-shards.json', BINDING = '.github/toolkit-programme.json';
const RENDERED = SWEEPS.map(row => row.file);
const binding = { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-' }], store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' }, required_checks: ['validate'] };

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// A checkout with none of these files: what a turn-on from one that is behind sees.
function checkout(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'one']);
  return dir;
}

let cached = null;
// Every file a turn-on can want, as it writes them.
function wantedFiles(t) {
  cached ||= {
    [BINDING]: `${JSON.stringify(binding, null, 2)}\n`,
    [PLAIN.settings]: '{"rules":"new"}\n', [PLAIN.baseline]: '{"allowed":[]}\n', [PLAIN.script]: plainText.vendoredText(), [PLAIN.workflow]: 'name: plain text\n',
    '.github/dependabot.yml': 'version: 2\n', [LIST]: '{"shards":[]}\n',
    ...proposal.cloudWorkflowFiles(checkout(t), { root: ROOT, commit: COMMIT }).files,
  };
  return { ...cached };
}

// An older copy of a file Toolkit made, and one edited by hand.
const older = {
  [CHECK]: () => guard.workflowText('personal-data-guard', 'name: an older check\n'),
  [SWEEP]: () => guard.workflowText('personal-data-sweep', 'name: an older sweep\n'),
  [SCRIPT]: () => guard.vendoredText('#!/usr/bin/env node\n// an older guard\n'),
  [AUTO]: () => `${security.WORKFLOW_MARKER}0\nname: an older one\n`,
  [PLAIN.script]: () => plainText.vendoredText('#!/usr/bin/env node\n// an older check\n'),
  ...Object.fromEntries(SWEEPS.map(row => [row.file, () => {
    const text = workflows.render(row.id, `${spawnSync('git', ['show', `${COMMIT}:${row.file}`], { cwd: ROOT, encoding: 'utf8' }).stdout}`, COMMIT);
    const body = text.slice(text.indexOf('\n') + 1).replace(/^name: .*$/m, 'name: An older layout');
    return text.slice(0, text.indexOf('\n') + 1).replace(/sha256=[0-9a-f]{12}/, `sha256=${workflows.bodyHash(body)}`) + body;
  }])),
};

// GitHub: `base` is the default branch's files and `branch` the open turn-on pull request's (null for a
// first publish). A value may be a string or a reply that is no readable text file.
function fakeGitHub({ base, branch = null }) {
  const world = { tree: null, body: null, reads: [], order: [] };
  const json = value => JSON.stringify(value);
  const missing = () => { throw Object.assign(new Error('missing'), { code: 'PROPOSAL_NOT_FOUND' }); };
  const reply = value => (value === undefined ? missing() : json(typeof value === 'string' ? { type: 'file', encoding: 'base64', sha: 'c'.repeat(40), size: Buffer.byteLength(value), content: Buffer.from(value).toString('base64') } : value));
  const held = ref => (ref === BASE ? base : branch);
  const pr = { number: 1, html_url: `https://github.com/${SLUG}/pull/1`, state: 'open', body: proposal.MARKER, head: { ref: 'toolkit/governance-on-x', repo: { full_name: SLUG }, sha: HEAD }, base: { ref: 'main', sha: BASE } };
  const transport = new proposal.GitHubProposalTransport({ run(args, input) {
    const endpoint = args[1];
    world.order.push(`${input ? 'write' : 'read'} ${endpoint}`);
    if (args[0] === 'auth') return '';
    if (endpoint === 'user') return json({ login: 'example-owner' });
    if (endpoint === `repos/${SLUG}`) return json(args.includes('--jq') ? { push: true } : { default_branch: 'main' });
    if (endpoint.endsWith('/pulls?state=open&per_page=100')) return json(branch ? [{ number: 1, marked: true }] : []);
    if (endpoint.endsWith('/pulls/1')) { if (input) { world.body = input.body; return '{}'; } return json(pr); }
    if (endpoint.endsWith('/git/ref/heads/main')) return json({ object: { sha: BASE } });
    if (endpoint.includes('/git/ref/heads/')) return missing();
    if (endpoint.includes('/compare/')) {
      const files = Object.keys(branch).filter(name => branch[name] !== base[name]).map(filename => ({ filename, status: base[filename] === undefined ? 'added' : 'modified' }));
      return json({ total_commits: 1, merge_base_commit: { sha: BASE }, files });
    }
    if (endpoint.includes('/git/commits/')) return json({ tree: { sha: 'b'.repeat(40) } });
    if (endpoint.endsWith(`/git/trees/${'b'.repeat(40)}`)) return json({ truncated: false, tree: [{ path: '.github', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }] });
    if (endpoint.endsWith(`/git/trees/${'d'.repeat(40)}`)) return json({ truncated: false, tree: [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] });
    const contents = /\/contents\/([^?]+)\?ref=([0-9a-f]{40})$/.exec(endpoint);
    if (contents) { world.reads.push(contents[1]); return reply(held(contents[2])[contents[1]]); }
    if (endpoint.endsWith('/git/refs')) return '{}';
    if (endpoint.endsWith('/git/trees')) { world.tree = Object.fromEntries(input.tree.map(entry => [entry.path, entry.content])); return json({ sha: 'e'.repeat(40) }); }
    if (endpoint.endsWith('/git/commits')) { if (branch) pr.head.sha = 'f'.repeat(40); return json({ sha: 'f'.repeat(40) }); }
    if (endpoint.includes('/git/refs/heads/')) return '{}';
    if (endpoint.endsWith('/pulls')) { world.body = input.body; return json({ number: 1 }); }
    throw Error(`unexpected endpoint ${endpoint}`);
  } });
  return { world, transport };
}

// Both routes with the same files on GitHub: a first publish on a default branch that holds `base`, and
// an answer again on a pull request whose branch holds them too.
function both(wanted, base, check) {
  const first = fakeGitHub({ base });
  const made = first.transport.publish(SLUG, binding, wanted);
  check({ route: 'first publish', result: made, ...first.world });
  const branch = { [BINDING]: wanted[BINDING].replace('validate', 'other'), ...base };
  const again = fakeGitHub({ base, branch });
  const updated = again.transport.update(SLUG, 1, binding, wanted);
  check({ route: 'answer again', result: updated, ...again.world });
}
const UNREADABLE = { 'a folder': [], 'a file too large to read': { type: 'file', encoding: 'none', content: '' }, 'a submodule': { type: 'submodule' } };
const keptNote = file => `${file} is already on GitHub with other content, so it is left as it is.`;

test('a turn-on from a checkout behind the default branch leaves the owner\'s guard settings, sweep and dependency workflow alone', t => {
  const own = `${JSON.stringify({ ...JSON.parse(guard.configText('personal-data')), not_scanned: [{ path: 'public/**', reason: 'our artwork' }] })}\n`;
  const wanted = wantedFiles(t);
  for (const file of [...GUARD, AUTO, ...RENDERED]) assert.equal(typeof wanted[file], 'string', `the checkout itself wants ${file}`);
  both(wanted, { [CONFIG]: own, [SWEEP]: 'name: our own sweep\n', [AUTO]: 'name: our own dependency workflow\n' }, ({ route, result, tree, body }) => {
    for (const file of [...GUARD, AUTO]) assert.equal(tree[file], undefined, `${route}: ${file}`);
    for (const file of RENDERED) assert.equal(tree[file], wanted[file], `${route}: the rest still goes in`);
    assert.equal(tree[PLAIN.settings], wanted[PLAIN.settings], route);
    assert.deepEqual(result.left, [...GUARD, AUTO].sort((a, b) => Object.keys(wanted).indexOf(a) - Object.keys(wanted).indexOf(b)), route);
    for (const file of [SWEEP, AUTO]) {
      assert.ok(result.notes.some(note => note.startsWith(`${file} is not a Toolkit copy, so it is left as it is`)), route);
      assert.ok(body.includes(`- ${file} is not a Toolkit copy`), `${route}: named in the pull request`);
      assert.ok(!body.includes(`\n- ${file}\n`), `${route}: not listed as prepared`);
    }
  });
});

test('every copied workflow file, in every state GitHub can hold it, on both routes', t => {
  const wanted = wantedFiles(t);
  const entry = file => (file === AUTO ? [AUTO] : GUARD);
  for (const file of COPIED_FILES) {
    const states = { missing: undefined, current: wanted[file], 'current with Windows line ends': wanted[file].replace(/\n/g, '\r\n'), 'someone else\'s': 'ours\n', ...UNREADABLE };
    if (older[file]) Object.assign(states, { 'an older copy': older[file]() });
    if (older[file] && file !== AUTO) Object.assign(states, { 'edited by hand': `${wanted[file]}# a hand edit\n` });
    for (const [state, text] of Object.entries(states)) {
      both(wanted, text === undefined ? {} : { [file]: text }, ({ route, result, tree }) => {
        const at = `${file} ${state} (${route})`;
        const clash = (state === 'someone else\'s' && file !== CONFIG) || Object.hasOwn(UNREADABLE, state);
        if (clash) {
          for (const name of entry(file)) assert.equal(tree[name], undefined, `${at}: ${name}`);
          assert.ok(result.notes[0].startsWith(`${file} is not a Toolkit copy`), at);
          assert.equal(result.notes.length, 1, at);
        } else if (file === CONFIG && state === 'someone else\'s') {
          assert.equal(tree[file], undefined, at);
          assert.deepEqual(result.notes, [keptNote(file)], at);
          for (const name of GUARD.filter(entryFile => entryFile !== CONFIG)) assert.equal(tree[name], wanted[name], `${at}: ${name}`);
        } else {
          // Settings with the same content keep their own line ends.
          if (file === CONFIG && state === 'current with Windows line ends') assert.equal(tree[file], undefined, at);
          else if (route === 'first publish' || state !== 'current') assert.equal(tree[file], wanted[file], at);
          assert.deepEqual(result.notes, state === 'edited by hand' ? [`${file} was edited by hand and is brought back to the Toolkit's own text.`] : [], at);
        }
        // Nothing else is ever held back by it.
        for (const name of Object.keys(wanted).filter(other => !entry(file).includes(other) && other !== BINDING)) assert.equal(tree[name], wanted[name], `${at}: ${name}`);
      });
    }
  }
});

test('rendered copies: someone else\'s file on GitHub is kept and no rendered copy goes around it; a Toolkit copy is brought up to date', t => {
  const wanted = wantedFiles(t);
  for (const file of RENDERED) {
    for (const text of ['name: ours\n', ...Object.values(UNREADABLE)]) {
      both(wanted, { [file]: text }, ({ route, result, tree }) => {
        for (const name of RENDERED) assert.equal(tree[name], undefined, `${route}: ${name}`);
        assert.ok(result.notes[0].startsWith(`${file} is not a Toolkit copy, so it is left as it is and the Toolkit's rendered workflow copies are not added around it`), route);
        for (const name of COPIED_FILES) assert.equal(tree[name], wanted[name], `${route}: ${name}`);
      });
    }
    both(wanted, { [file]: older[file]() }, ({ route, result, tree }) => { assert.equal(tree[file], wanted[file], route); assert.deepEqual(result.notes, [], route); });
    both(wanted, { [file]: `${wanted[file]}# a hand edit\n` }, ({ route, result, tree }) => { assert.equal(tree[file], wanted[file], route); assert.match(result.notes[0], /edited by hand and is brought back/, route); });
  }
  assert.equal(SHARDS.length, 2, 'the shard copies are rendered copies too');
});

test('the plain-text check, the Dependabot settings and the shard list on the default branch are the owner\'s', t => {
  const wanted = wantedFiles(t);
  const rows = [
    [{ [PLAIN.settings]: '{"rules":"ours"}\n' }, [PLAIN.settings, PLAIN.baseline], [keptNote(PLAIN.settings)]],
    [{ [PLAIN.baseline]: '{"allowed":["ours"]}\n' }, [PLAIN.baseline], [keptNote(PLAIN.baseline)]],
    [{ [PLAIN.workflow]: 'name: our plain text\n' }, [PLAIN.workflow], [keptNote(PLAIN.workflow)]],
    [{ [PLAIN.script]: '// our own check\n' }, Object.values(PLAIN), [`${PLAIN.script} is not a Toolkit copy, so it is left as it is and the plain-text check is not added around it; move it aside in a pull request first.`]],
    [{ '.github/dependabot.yml': 'version: 2 # ours\n' }, ['.github/dependabot.yml'], [keptNote('.github/dependabot.yml')]],
    [{ '.github/dependabot.yaml': 'version: 2 # ours\n' }, ['.github/dependabot.yml'], [keptNote('.github/dependabot.yaml')]],
    [{ [LIST]: '{"shards":["ours"]}\n' }, [LIST], [keptNote(LIST)]],
    [{ [PLAIN.settings]: [] }, [PLAIN.settings, PLAIN.baseline], [keptNote(PLAIN.settings)]],
  ];
  for (const [base, left, notes] of rows) {
    both(wanted, base, ({ route, result, tree }) => {
      assert.deepEqual(result.notes, notes, route);
      for (const name of Object.keys(wanted).filter(file => file !== BINDING)) assert.equal(tree[name], left.includes(name) ? undefined : wanted[name], `${route}: ${name} with ${Object.keys(base)}`);
    });
  }
  // A Toolkit copy of the plain-text check is brought up to date, a hand edit is named.
  both(wanted, { [PLAIN.script]: older[PLAIN.script]() }, ({ route, result, tree }) => { assert.equal(tree[PLAIN.script], wanted[PLAIN.script], route); assert.deepEqual(result.notes, [], route); });
  both(wanted, { [PLAIN.script]: `${wanted[PLAIN.script]}// a hand edit\n` }, ({ route, result, tree }) => { assert.equal(tree[PLAIN.script], wanted[PLAIN.script], route); assert.match(result.notes[0], /edited by hand/, route); });
});

test('answering again rewrites what its own pull request added, except guard settings and files Toolkit did not write', t => {
  const wanted = wantedFiles(t);
  const branch = { ...wanted, [BINDING]: wanted[BINDING].replace('validate', 'other'), [PLAIN.settings]: '{"rules":"an earlier answer"}\n', [LIST]: '{"shards":["an earlier answer"]}\n', '.github/dependabot.yml': 'version: 2 # an earlier answer\n', [CONFIG]: 'the owner\'s own\n', [AUTO]: 'name: pushed by the owner\n' };
  const github = fakeGitHub({ base: {}, branch });
  const result = github.transport.update(SLUG, 1, binding, wanted);
  assert.deepEqual(Object.keys(github.world.tree).sort(), [BINDING, PLAIN.settings, LIST, '.github/dependabot.yml'].sort());
  assert.deepEqual(result.left.sort(), [CONFIG, AUTO].sort());
  assert.deepEqual(result.onBase, [], 'the default branch holds none of it');
});

test('GitHub is read before anything is written, and a file that cannot be read stops the turn-on with nothing written', t => {
  const wanted = wantedFiles(t);
  const github = fakeGitHub({ base: {} });
  github.transport.publish(SLUG, binding, wanted);
  const firstWrite = github.world.order.findIndex(line => line.startsWith('write '));
  const lastRead = github.world.order.map(line => line.includes('/contents/')).lastIndexOf(true);
  assert.ok(lastRead < firstWrite, 'every file is read first');
  for (const file of [...COPIED_FILES, ...RENDERED, ...Object.values(PLAIN), LIST, '.github/dependabot.yml', '.github/dependabot.yaml']) assert.ok(github.world.reads.includes(file), `${file} is read`);
  const writes = [];
  const broken = new proposal.GitHubProposalTransport({ run(args, input) {
    if (args[0] === 'auth') return '';
    if (input) { writes.push(args[1]); return '{}'; }
    if (args[1] === 'user') return '{"login":"example-owner"}';
    if (args[1] === `repos/${SLUG}`) return '{"default_branch":"main"}';
    if (args[1].endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: BASE } });
    throw Object.assign(new Error('GitHub answered 502'), { code: 'PROPOSAL_GITHUB_UNAVAILABLE' });
  } });
  assert.throws(() => broken.publish(SLUG, binding, wanted), { code: 'PROPOSAL_GITHUB_UNAVAILABLE' });
  assert.deepEqual(writes, []);
});

// The owner-facing result: what the turn-on's summary names, and whether the first sweep runs.
test('the turn-on names the kept files and never counts a workflow GitHub already has, or one left out, as added', t => {
  const { GovernanceProposals } = proposal;
  for (const [name, base, added, note] of [
    ['nothing there', {}, ['programme-sweep', 'programme-sweep-gate', 'personal-data-guard', 'dependency-auto-merge'], null],
    ['the guard is already there', Object.fromEntries(GUARD.map(file => [file, null])), ['programme-sweep', 'programme-sweep-gate', 'dependency-auto-merge'], null],
    ['someone else\'s guard workflow', { [CHECK]: 'name: ours\n' }, ['programme-sweep', 'programme-sweep-gate', 'dependency-auto-merge'], `${CHECK} is not a Toolkit copy`],
    ['someone else\'s sweep only', { [SWEEP]: 'name: ours\n' }, ['programme-sweep', 'programme-sweep-gate', 'dependency-auto-merge'], `${SWEEP} is not a Toolkit copy`],
  ]) {
    const wanted = wantedFiles(t);
    const dir = checkout(t);
    git(dir, ['remote', 'add', 'origin', `https://github.com/${SLUG}.git`]);
    for (const file of [BINDING, ...Object.values(PLAIN)]) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), wanted[file]); }
    const registryPath = path.join(dir, '..', `${path.basename(dir)}-state`, 'repository-governance.v1.json');
    t.after(() => fs.rmSync(path.dirname(registryPath), { recursive: true, force: true }));
    recordAbsent(dir, { registryPath });
    const github = fakeGitHub({ base: Object.fromEntries(Object.entries(base).map(([file, text]) => [file, text ?? wanted[file]])) });
    const read = { repository: SLUG, number: 1, head: 'f'.repeat(40), url: `https://github.com/${SLUG}/pull/1`, answer: 'yes', state: 'open' };
    const transport = { list: () => [], canWrite: () => true, publish: (...args) => github.transport.publish(...args), read: () => read };
    const owner = new GovernanceProposals({ registryOptions: { registryPath, testOnly: true }, transport, cloudWorkflows: cwd => proposal.cloudWorkflowFiles(cwd, { root: ROOT, commit: COMMIT }) });
    const request = owner.request(dir, 'yes', { sessionId: 'owner', epoch: 'e'.repeat(32) });
    const result = owner.publish(dir, request.run, binding);
    assert.deepEqual(result.added, added, name);
    if (note) assert.ok(result.notes.some(line => line.startsWith(note)), name); else assert.equal(result.notes, undefined, name);
    assert.deepEqual(result.files.filter(file => GUARD.includes(file)).length, note ? 0 : 4, name);
  }
});
