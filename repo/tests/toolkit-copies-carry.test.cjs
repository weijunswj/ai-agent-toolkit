'use strict';

// Proved Toolkit refreshes land on their own: the closure matrix of who may land what, as one table,
// against a governed fixture repository, a Toolkit fixture checkout and fakes for GitHub's reads. A
// refresh pull request whose every changed file is byte for byte Toolkit main's own render at the
// commit its head names lands under the repository's task auto-merge switch, pinned to that head, with
// one notice after; anything outside the proof keeps the owner's typed merge. Red on the parent: no
// copy proof, no `--land-refresh`, and every refresh waited for a typed merge (its workflows are on the
// merge-authority list).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const hostile = require('./support/hostile-inputs.cjs');
const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
const refresh = require('../scripts/toolkit-cloud-workflows-refresh.cjs');
const { RefreshProof, commitLine, scopeWithProof } = require('../scripts/toolkit-copies-proof.cjs');
const { RefreshLanding } = require('../scripts/toolkit-cloud-workflows-land.cjs');
const eligible = require('../scripts/toolkit-auto-merge-eligible.cjs');
const hold = require('../scripts/toolkit-merge-hold.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const governance = require('../scripts/toolkit-governance-state.cjs');
const bindingCache = require('../scripts/toolkit-governance-binding.cjs');

const ROOT = path.resolve(__dirname, '../..');
const UNKNOWN = 'f'.repeat(40);
const SLUG = 'owner/a';

function git(cwd, args, input = undefined) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', input, windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const message = commit => `${refresh.TITLE}\n\nToolkit commit: ${commit}\n`;

// A Toolkit git checkout sharing this checkout's objects: `main` (this checkout's tree, on its
// origin/main) and `off` (a child commit that is not on origin/main).
function toolkitCheckout(root) {
  const dir = path.join(root, 'toolkit');
  fs.mkdirSync(dir);
  git(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, '.git', 'objects', 'info', 'alternates'), `${path.resolve(ROOT, git(ROOT, ['rev-parse', '--git-path', 'objects']))}\n`);
  const tree = git(ROOT, ['rev-parse', 'HEAD^{tree}']);
  const main = git(dir, ['commit-tree', tree, '-m', 'main']);
  const off = git(dir, ['commit-tree', tree, '-p', main, '-m', 'off main']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', main]);
  return { dir, main, off };
}

function bindingFor(extra = {}) {
  return { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-A-' }],
    store: { kind: 'github', repository: 'owner/TRANSPORT-a', branch: 'main', path: 'state/owner/a/' }, required_checks: ['validate'], task_prs: { auto_merge: 'after-gates' }, ...extra };
}

// A governed fixture repository with this computer's read of its merged binding, and the Toolkit
// fixture checkout the proof reads.
function context(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-copies-carry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'a');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'feature']);
  git(repo, ['remote', 'add', 'origin', `https://github.com/${SLUG}.git`]);
  fs.writeFileSync(path.join(repo, 'README.md'), 'a\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'start']);
  const main = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', main]);
  git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  const registryOptions = { registryPath: path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true, host: 'claude', home: path.join(root, 'home') };
  const ctx = { root, repo, main, registryOptions, toolkit: toolkitCheckout(root) };
  ctx.merged = (value = bindingFor(), { ageMs = 0 } = {}) => {
    const identity = governance.readIdentity(repo);
    const text = JSON.stringify(value);
    const file = bindingCache.cacheFileFor(governance.userStateDirectory(registryOptions), identity.repository_id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schema: bindingCache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical, default_branch: 'main',
      commit: ctx.main, fetched_at: new Date(Date.now() - ageMs).toISOString(), status: 'present', bytes_sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'), text, problem: null }));
  };
  ctx.merged();
  // A refresh branch made from `from` the way the refresh writes it: every copy a refresh renders at
  // `commit`, committed with the refresh's own message; `change` edits the files first.
  ctx.refreshHead = ({ from = ctx.main, commit = ctx.toolkit.main, change = null, text = message(commit) } = {}) => {
    git(repo, ['checkout', '-q', '-B', refresh.BRANCH, from]);
    workflows.apply(workflows.plan({ repo, root: ctx.toolkit.dir, commit: ctx.toolkit.main }));
    if (change) change(repo);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-F', '-'], text);
    const head = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['checkout', '-q', 'feature']);
    return head;
  };
  ctx.proof = () => new RefreshProof({ root: repo, toolkitRoot: ctx.toolkit.dir, workflows, governance: folder => governance.governanceState(folder, registryOptions) });
  return ctx;
}

// GitHub as the land check reads it: one open refresh pull request at `head` in a repository `owner`
// owns (a User, an Organization, or unreadable), its checks, the TOOLKIT_REF variable and, for an
// organization, the organization variables shared with the repository (null: that read is refused).
// Every call is recorded with its method, so a test can show it only reads.
function github(ctx, head, { checks = [['validate', 'completed', 'success']], pin = null, open = true, owner = 'User', shared = [] } = {}) {
  const calls = [];
  const read = (endpoint, options = {}) => {
    calls.push({ endpoint, method: options.method || 'GET' });
    if (endpoint.startsWith(`repos/${SLUG}/pulls?state=open`)) return open ? [{ number: 7, head: { ref: refresh.BRANCH, sha: head, repo: { full_name: SLUG, ...(owner ? { owner: { type: owner } } : {}) } }, base: { ref: 'main' } }] : [];
    if (endpoint === `repos/${SLUG}/actions/variables/TOOLKIT_REF`) return pin;
    const sharedPage = new RegExp(`^repos/${SLUG}/actions/organization-variables\\?per_page=30&page=(\\d+)$`).exec(endpoint);
    if (sharedPage) {
      // GitHub refuses this read for a user's repository (HTTP 422).
      if (owner !== 'Organization' || shared === null) throw new Error('GitHub refused GET (HTTP 422).');
      const variables = shared.map(name => ({ name, value: 'x' }));
      return { total_count: variables.length, variables: variables.slice((Number(sharedPage[1]) - 1) * 30, Number(sharedPage[1]) * 30) };
    }
    const page = new RegExp(`^repos/${SLUG}/commits/${head}/check-runs\\?per_page=100&page=(\\d+)$`).exec(endpoint);
    if (page) {
      const runs = checks.map(([name, status, conclusion], id) => ({ id: id + 1, name, status, conclusion }));
      return { total_count: runs.length, check_runs: runs.slice((Number(page[1]) - 1) * 100, Number(page[1]) * 100) };
    }
    if (endpoint === `repos/${SLUG}/commits/${head}/status`) return { statuses: [] };
    throw new Error(`unexpected read ${endpoint}`);
  };
  read.calls = calls;
  return read;
}

const land = (ctx, head, options = {}) => new RefreshLanding({ root: ctx.repo, registryOptions: ctx.registryOptions, github: options.github || github(ctx, head, options), proof: () => ctx.proof(), fetch: () => true }).decide();

test('commit line reader: exactly the refresh\'s two lines name the Toolkit commit; every other shape refuses', () => {
  const sha = 'a'.repeat(40);
  assert.equal(commitLine(message(sha), refresh.TITLE), sha);
  assert.equal(commitLine(message(sha).trimEnd(), refresh.TITLE), sha);
  hostile.expectDefaultDeny(assert, text => commitLine(text, refresh.TITLE) !== null, hostile.shapes);
  // Every other line break, a byte order mark, tabs (none here, so that variant is the message itself).
  hostile.expectDefaultDeny(assert, text => commitLine(text, refresh.TITLE) !== null, hostile.variants(message(sha)), { allow: ['tabs'] });
  for (const text of [
    `${refresh.TITLE} \n\nToolkit commit: ${sha}\n`, `${refresh.TITLE}\n\nToolkit commit: ${sha} \n`, `${refresh.TITLE}\n\nToolkit commit: ${sha.toUpperCase()}\n`,
    `${refresh.TITLE}\n\nToolkit commit: ${sha.slice(1)}\n`, `${refresh.TITLE}\n\nToolkit commit: ${sha}a\n`, `${refresh.TITLE}\n\nToolkit commit: ${sha}\n\n`,
    `${refresh.TITLE}\n\nToolkit commit: ${sha}\nToolkit commit: ${sha}\n`, `${refresh.TITLE}\n\nSomething else\nToolkit commit: ${sha}\n`, `\n${message(sha)}`,
    `${refresh.TITLE}\nToolkit commit: ${sha}\n`, `${refresh.TITLE}\n\n Toolkit commit: ${sha}\n`, `Refresh the toolkit copies\n\nToolkit commit: ${sha}\n`,
    `${refresh.TITLE}\n\ntoolkit commit: ${sha}\n`, `${refresh.TITLE}\n\nToolkit commit:  ${sha}\n`, `${refresh.TITLE}\n\nToolkit commit: ${sha}\r\n`, '',
  ]) assert.equal(commitLine(text, refresh.TITLE), null, JSON.stringify(text));
  for (const value of [null, undefined, 42, {}, Buffer.from(message(sha))]) assert.equal(commitLine(value, refresh.TITLE), null);
  assert.equal(commitLine(message(sha), ''), null);
  // Linear in the message's length.
  const timed = hostile.timing(text => commitLine(text, refresh.TITLE), size => `${refresh.TITLE}\n\n${'Toolkit commit: '.repeat(Math.ceil(size / 16))}`);
  assert.ok(timed.ok, timed.message);
});

test('closure matrix: a proved refresh lands pinned with a notice; everything else waits, holds or keeps the typed merge', t => {
  const ctx = context(t);
  const head = ctx.refreshHead();
  const rows = [
    // [row, what, set-up returning the head, options, route, line pattern]
    ['1', 'switch on, unpinned, all copies, proof passes, on main, green', () => head, {}, 'land', /is proved \(every file is Toolkit commit [0-9a-f]{7}'s render, on Toolkit main\) and green/],
    ['2', 'a required check still running', () => head, { checks: [['validate', 'in_progress', null]] }, 'wait', /still running .* nothing to ask/],
    ['3', 'a required check failed', () => head, { checks: [['validate', 'completed', 'failure']] }, 'attention', /validate failed .* a Toolkit copy that breaks this repository's CI needs a person/],
    ['3', 'a required check never ran', () => head, { checks: [] }, 'attention', /validate never ran/],
    ['4', 'one byte differs from the render', () => ctx.refreshHead({ change: repo => fs.appendFileSync(path.join(repo, '.github', 'workflows', 'toolkit-programme-sweep.yml'), ' ') }), {}, 'owner', /toolkit-programme-sweep\.yml differs from Toolkit commit [0-9a-f]{7}'s render/],
    ['5', 'another path changed too', () => ctx.refreshHead({ change: repo => fs.writeFileSync(path.join(repo, 'README.md'), 'b\n') }), {}, 'owner', /README\.md is not a file a refresh at [0-9a-f]{7} writes here/],
    ['5', 'a file deleted', () => ctx.refreshHead({ change: repo => fs.rmSync(path.join(repo, 'README.md')) }), {}, 'owner', /README\.md is deleted/],
    ['6', 'the named Toolkit commit is not on Toolkit main', () => ctx.refreshHead({ commit: ctx.toolkit.off }), {}, 'owner', /is not on Toolkit main/],
    ['7', 'the named Toolkit commit is not in this computer\'s Toolkit checkout', () => ctx.refreshHead({ commit: UNKNOWN }), {}, 'hold', /not in this computer's Toolkit checkout/],
    ['10', 'TOOLKIT_REF is set', () => head, { pin: { name: 'TOOLKIT_REF', value: ctx.toolkit.main } }, 'owner', /TOOLKIT_REF variable is set/],
    // G2 L4: an organization's TOOLKIT_REF shared with the repository pins it too (vars.TOOLKIT_REF reads it).
    ['10', 'an organization\'s TOOLKIT_REF shared with the repository', () => head, { owner: 'Organization', shared: ['OTHER', 'TOOLKIT_REF'] }, 'owner', /its organization's TOOLKIT_REF variable is shared with it/],
    ['10', 'TOOLKIT_REF as the 31st variable shared, one page on', () => head, { owner: 'Organization', shared: [...Array.from({ length: 30 }, (_, i) => `VAR_${i}`), 'toolkit_ref'] }, 'owner', /its organization's TOOLKIT_REF variable is shared with it/],
    ['1', 'an organization\'s repository with no TOOLKIT_REF shared', () => head, { owner: 'Organization', shared: ['OTHER'] }, 'land', /is proved/],
    ['10', 'the organization variables cannot be read', () => head, { owner: 'Organization', shared: null }, 'hold', /organization variables shared with the repository could not be read/],
    ['10', 'the repository\'s owner cannot be read', () => head, { owner: null }, 'hold', /Who owns owner\/a could not be read/],
    // G2 round 1, L3: a busy head's required check on the second page of check runs still counts.
    ['1', 'the required check on the second page of 150 check runs', () => head, { checks: [...Array.from({ length: 149 }, (_, i) => [`sweep-${i}`, 'completed', 'success']), ['validate', 'completed', 'success']] }, 'land', /is proved/],
    ['18', 'another actor\'s commit with any other message, the same files', () => ctx.refreshHead({ text: 'Update workflows\n' }), {}, 'owner', /message is not exactly the refresh's/],
    ['18', 'another actor\'s commit with the refresh message and the exact render', () => ctx.refreshHead({ text: message(ctx.toolkit.main) }), {}, 'land', /is proved/],
  ];
  for (const [row, what, make, options, route, line] of rows) {
    const at = make();
    const result = land(ctx, at, options);
    assert.equal(result.route, route, `row ${row} (${what}): ${result.line}`);
    assert.match(result.line, line, `row ${row} (${what})`);
    if (route === 'land') {
      // Pinned to the proved head, with the controller's own checks named, and one notice with its undo.
      assert.equal(result.merge, `gh pr merge 7 --merge --match-head-commit ${at}`);
      assert.match(result.line, /Unless the owner said hold 7 or another merge is running here/, `rows 12 and 13 stay the controller's: ${result.line}`);
      assert.match(result.notice, new RegExp(`^Landed ${SLUG}#7: its Toolkit copies \\(.*\\) now match Toolkit main at [0-9a-f]{7}, under this repository's task auto-merge\\. To undo it, revert that merge in a pull request; to hold this repository on one Toolkit commit, set its TOOLKIT_REF variable; to stop automatic landings, merge an Off switch \\(refresh governance\\)\\.$`));
    } else assert.equal(result.merge, undefined, `row ${row}: no merge command`);
  }
  // Row 11: the head moved after the proof. The merge named the proved head, so GitHub refuses it; the
  // new head is judged again and here fails.
  const proved = land(ctx, head);
  const moved = ctx.refreshHead({ from: head, change: repo => fs.writeFileSync(path.join(repo, 'notes.md'), 'x\n') });
  assert.match(proved.merge, new RegExp(`--match-head-commit ${head}$`));
  assert.equal(land(ctx, moved).route, 'owner');
  // Row 14: the owner's guard settings file already existed and the pull request changes it.
  git(ctx.repo, ['checkout', '-q', '-B', 'settings', ctx.main]);
  fs.mkdirSync(path.join(ctx.repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, '.github', 'personal-data-guard.json'), '{"owner": true}\n');
  git(ctx.repo, ['add', '-A']);
  git(ctx.repo, ['commit', '-q', '-m', 'owner settings']);
  const owned = git(ctx.repo, ['rev-parse', 'HEAD']);
  git(ctx.repo, ['checkout', '-q', 'feature']);
  git(ctx.repo, ['update-ref', 'refs/remotes/origin/main', owned]);
  const settings = ctx.refreshHead({ from: owned, change: repo => fs.writeFileSync(path.join(repo, '.github', 'personal-data-guard.json'), '{"changed": true}\n') });
  const row14 = land(ctx, settings);
  assert.equal(row14.route, 'owner', row14.line);
  assert.match(row14.line, /personal-data-guard\.json already existed, so it is the owner's settings file/);
  git(ctx.repo, ['update-ref', 'refs/remotes/origin/main', ctx.main]);
  // Row 21: a refresh that removes a retired Toolkit file (an older Toolkit's Shard Timings copy) does
  // exactly what the refresh writes, but a removal never passes the proof: it waits for the owner.
  const timings = '.github/workflows/toolkit-shard-timings.yml';
  git(ctx.repo, ['checkout', '-q', '-B', 'retired', ctx.main]);
  fs.mkdirSync(path.join(ctx.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, ...timings.split('/')), `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED shard-timings toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)} layout=1\nname: x\n`);
  git(ctx.repo, ['add', '-A']);
  git(ctx.repo, ['commit', '-q', '-m', 'an older Toolkit left it']);
  const withRetired = git(ctx.repo, ['rev-parse', 'HEAD']);
  git(ctx.repo, ['checkout', '-q', 'feature']);
  git(ctx.repo, ['update-ref', 'refs/remotes/origin/main', withRetired]);
  const removing = ctx.refreshHead({ from: withRetired, change: repo => fs.rmSync(path.join(repo, ...timings.split('/'))) });
  const row21 = land(ctx, removing);
  assert.equal(row21.route, 'owner', row21.line);
  assert.match(row21.line, /toolkit-shard-timings\.yml is deleted/);
  git(ctx.repo, ['update-ref', 'refs/remotes/origin/main', ctx.main]);
  // Row 8: the switch off, and a binding with no switch.
  for (const value of [bindingFor({ task_prs: { auto_merge: 'off' } }), bindingFor({ task_prs: undefined })]) {
    ctx.merged(value);
    const off = land(ctx, head);
    assert.equal(off.route, 'owner', off.line);
    assert.match(off.line, /Task auto-merge is off for owner\/a/);
  }
  // G2 round 1, L2: a binding that lists no required check never lands on its own.
  ctx.merged(bindingFor({ required_checks: [] }));
  const unchecked = land(ctx, head);
  assert.equal(unchecked.route, 'attention', unchecked.line);
  assert.match(unchecked.line, /lists no required check, so nothing shows the copies pass this repository's CI/);
  ctx.merged();
  // Row 9: the binding read over 24 hours ago.
  ctx.merged(bindingFor(), { ageMs: 25 * 60 * 60 * 1000 });
  assert.equal(land(ctx, head).route, 'hold');
  ctx.merged();
  // No open refresh pull request; and the land check only ever reads GitHub.
  assert.equal(land(ctx, head, { open: false }).route, 'none');
  const reads = github(ctx, head);
  land(ctx, head, { github: reads });
  assert.ok(reads.calls.length > 0 && reads.calls.every(call => call.method === 'GET'), 'reads only');
  // The command line: --land-refresh prints the route's line and the notice, exit 0 only for land.
  const printed = [];
  const out = { write: text => printed.push(text) };
  const landing = { registryOptions: ctx.registryOptions, github: github(ctx, head), proof: () => ctx.proof(), fetch: () => true };
  assert.equal(workflows.main(['--repo', ctx.repo, '--land-refresh'], { out, err: out, refresh: () => {}, landing }), 0, printed.join(''));
  assert.match(printed.join(''), new RegExp(`gh pr merge 7 --merge --match-head-commit ${head}\\nAfter the merge, tell the owner once: Landed ${SLUG}#7: `));
  assert.equal(workflows.main(['--repo', ctx.repo, '--land-refresh'], { out, err: out, refresh: () => {}, landing: { ...landing, github: github(ctx, head, { checks: [['validate', 'queued', null]] }) } }), 1);
  // Row 20: the Toolkit's own repository.
  assert.equal(new RefreshLanding({ root: ROOT, registryOptions: ctx.registryOptions, github: () => assert.fail('no read'), fetch: () => true }).decide().route, 'none');
});

test('the merge scope the hold reads: a proved refresh is in scope; an unproved one, or anything beside it, waits for the typed merge', t => {
  const ctx = context(t);
  const head = ctx.refreshHead();
  const prove = (base, at) => ctx.proof().prove(base, at);
  // Base: CI workflows are on the merge-authority list.
  const plain = eligible.eligibilityOf(ctx.repo, ctx.main, head);
  assert.equal(plain.eligible, false);
  assert.ok(plain.reasons.every(entry => entry.why === 'a CI workflow'));
  const scope = scopeWithProof(ctx.repo, ctx.main, head, { prove });
  assert.equal(scope.eligible, true);
  assert.equal(scope.proved_refresh.toolkit_commit, ctx.toolkit.main);
  // The auto-merge check itself stays as it was (Node's own modules only): it still names the workflows,
  // and --land-refresh is the controller's route for a refresh.
  const out = { text: '', write(chunk) { this.text += chunk; } };
  assert.equal(eligible.main(['--base', ctx.main, '--head', head, '--scope-only'], { cwd: ctx.repo, stdout: out, stderr: out }), 1, out.text);
  // The gate rules say the same where they list what that exit 1 sends to the typed merge, so a
  // controller reading them lands a proved refresh by --land-refresh instead of waiting.
  const rules = fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'agent-rules', 'gate-rules.md'), 'utf8');
  assert.match(rules, /Those wait for the owner's typed `merge N` \(a proved refresh lands by `--land-refresh`\)/);
  // One differing byte: the CI workflow reasons stay, with why the proof failed.
  const edited = ctx.refreshHead({ change: repo => fs.appendFileSync(path.join(repo, '.github', 'workflows', 'personal-data-guard.yml'), '#\n') });
  const failed = scopeWithProof(ctx.repo, ctx.main, edited, { prove });
  assert.equal(failed.eligible, false);
  assert.match(failed.proof, /personal-data-guard\.yml differs/);
  // A workflow change that is no refresh at all reads exactly as before, with no proof tried.
  git(ctx.repo, ['checkout', '-q', '-B', 'ci', ctx.main]);
  fs.mkdirSync(path.join(ctx.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  git(ctx.repo, ['add', '-A']);
  git(ctx.repo, ['commit', '-q', '-m', 'ci']);
  const ci = git(ctx.repo, ['rev-parse', 'HEAD']);
  git(ctx.repo, ['checkout', '-q', 'feature']);
  assert.deepEqual(scopeWithProof(ctx.repo, ctx.main, ci, { prove: () => assert.fail('no proof for a commit with no Toolkit commit line') }), eligible.eligibilityOf(ctx.repo, ctx.main, ci));
  // A reason other than a CI workflow is never lifted, even beside proved copies.
  const binding = ctx.refreshHead({ change: repo => fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), '{}\n') });
  const kept = scopeWithProof(ctx.repo, ctx.main, binding, { prove: () => ({ proved: true, commit: ctx.toolkit.main, files: [] }) });
  assert.equal(kept.eligible, false);
  assert.ok(kept.reasons.some(entry => entry.why === 'the programme binding'));
});

test('the merge hold lets an owner-started session merge a proved refresh pinned to its head, and nothing looser', t => {
  // The hold's own proof reads this checkout as the Toolkit and names the commit it shares with its
  // origin/main, as a controller's managed checkout would.
  const ctx = context(t);
  const named = git(ROOT, ['merge-base', 'HEAD', 'refs/remotes/origin/main']);
  ctx.toolkit = { dir: ROOT, main: named };
  const head = ctx.refreshHead({ commit: named });
  const session = 'owner-session';
  gate.startSession({ session_id: session, source: 'startup', cwd: ctx.repo }, { registryOptions: ctx.registryOptions, environment: {}, host: 'claude' });
  const transport = { request(method, endpoint) {
    const pr = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(endpoint);
    if (pr) return { status: 200, json: { number: Number(pr[1]), title: refresh.TITLE, body: 'Refresh', commits: 0, head: { sha: head } } };
    if (/\/pulls\/\d+\/commits\?/.test(endpoint)) return { status: 200, json: [] };
    return { status: 404 };
  } };
  const decide = (command, id = session) => hold.decide({ cwd: ctx.repo, session_id: id, tool_name: 'Bash', tool_input: { command } }, { registryOptions: ctx.registryOptions, environment: {}, host: 'claude', transport });
  // Row 1: the exact pinned merge passes with no typed approval.
  assert.equal(decide(`gh pr merge 7 --merge --match-head-commit ${head}`), null);
  // Row 17: unpinned, short, --auto, squash: each still needs the typed approval.
  for (const command of [`gh pr merge 7 --merge`, `gh pr merge 7 --merge --match-head-commit ${head.slice(0, 12)}`, `gh pr merge 7 --merge --auto --match-head-commit ${head}`, `gh pr merge 7 --squash --match-head-commit ${head}`]) {
    assert.match(decide(command)?.deny || '', /typed|approval/i, command);
  }
  // Row 15: a session with no owner-started record (a launched executor) has no standing.
  assert.match(decide(`gh pr merge 7 --merge --match-head-commit ${head}`, 'executor-session')?.deny || '', /no unused approval|Standing task auto-merge is unavailable/);
  // Row 4 through the hold: one byte off and the refusal names the proof.
  const edited = ctx.refreshHead({ commit: named, change: repo => fs.appendFileSync(path.join(repo, '.github', 'workflows', 'toolkit-programme-sweep-gate.yml'), ' ') });
  assert.match(decide(`gh pr merge 7 --merge --match-head-commit ${edited}`)?.deny || '', /changes the merge rules .* and is not a proved Toolkit refresh \(.*toolkit-programme-sweep-gate\.yml differs/);
  // Switch off: no standing at all.
  ctx.merged(bindingFor({ task_prs: { auto_merge: 'off' } }));
  assert.match(decide(`gh pr merge 7 --merge --match-head-commit ${head}`)?.deny || '', /Standing task auto-merge is unavailable/);
});

// Red on the first round (G2 H1): the hook ran the merge hold twice per call, each pass with its own
// full copy proof, inside one 7.5-second deadline the proof never looked at, so on a repository with a
// shard list and 600 test files the pinned merge `--land-refresh` names was refused for lack of time.
// Now the proof runs once per hook call, stops short of the deadline, and never lists test files.
test('the hook lets a proved refresh merge through within its own deadline on a large repository, proving it once', t => {
  const ctx = context(t);
  const named = git(ROOT, ['merge-base', 'HEAD', 'refs/remotes/origin/main']);
  ctx.toolkit = { dir: ROOT, main: named };
  // The reviewer's large fixture: 600 test files on the default branch.
  git(ctx.repo, ['checkout', '-q', '-B', 'large', ctx.main]);
  for (let i = 0; i < 600; i += 1) {
    const folder = path.join(ctx.repo, 'tests', `d${i % 50}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `t${i}.test.js`), `// ${i}\n`);
  }
  git(ctx.repo, ['add', '-A']);
  git(ctx.repo, ['commit', '-q', '-m', 'tests']);
  ctx.main = git(ctx.repo, ['rev-parse', 'HEAD']);
  git(ctx.repo, ['checkout', '-q', 'feature']);
  git(ctx.repo, ['update-ref', 'refs/remotes/origin/main', ctx.main]);
  ctx.merged();
  const head = ctx.refreshHead({ commit: named });
  const session = 'owner-session';
  gate.startSession({ session_id: session, source: 'startup', cwd: ctx.repo }, { registryOptions: ctx.registryOptions, environment: {}, host: 'claude' });
  const transport = { request(method, endpoint) {
    const pr = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(endpoint);
    if (pr) return { status: 200, json: { number: Number(pr[1]), title: refresh.TITLE, body: 'Refresh', commits: 0, head: { sha: head } } };
    if (/\/pulls\/\d+\/commits\?/.test(endpoint)) return { status: 200, json: [] };
    return { status: 404 };
  } };
  const hook = require('../scripts/toolkit-governance-hook.cjs');
  const scopeProofs = new Map();
  const started = Date.now();
  const out = hook.respond('PreToolUse', { cwd: ctx.repo, session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `gh pr merge 7 --merge --match-head-commit ${head}` } },
    { registryOptions: ctx.registryOptions, environment: {}, transport, scopeProofs });
  assert.deepEqual(out, {}, `allowed through both passes (${Date.now() - started} ms): ${JSON.stringify(out)}`);
  assert.equal(scopeProofs.size, 1, 'one scope for both passes');
  assert.equal([...scopeProofs.values()][0].proved_refresh.toolkit_commit, named);
  // A proof with no time left stops at once, holds and says why; the merge then waits.
  const late = scopeWithProof(ctx.repo, ctx.main, head, { registryOptions: ctx.registryOptions, deadline: globalThis.performance.now() - 1 });
  assert.equal(late.eligible, false);
  assert.match(late.proof, /the copy proof did not finish within this call's time; run the same merge again/);
});

test('the refresh body carries the UAT line the auto-merge check accepts and says who lands it', () => {
  const body = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-cloud-workflows-refresh.cjs'), 'utf8');
  const line = /const UAT_LINE = '([^']+)';/.exec(body)[1];
  const verdict = eligible.uatVerdict(`Refresh\n\n${line}\n`);
  assert.equal(verdict.state, 'NOT_REQUIRED');
  assert.equal(verdict.ready, true);
});
