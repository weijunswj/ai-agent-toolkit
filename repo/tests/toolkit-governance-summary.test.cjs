'use strict';

// The governance summary (INT-TK421-1386): where governance is on, `toolkit governance` shows one top
// line, the owner's steps left with their commands in PowerShell blocks (Toolkit permissions first, then
// the Governance App), and one table of every part: Part | State | What it does. Changes are said in
// words. Red on the parent: it showed the old bank, a table of codes to answer (1.2=B), and listed the
// owner's own permission lines as raw commands.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const { BankTickets } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const summary = require(path.join(scripts, 'toolkit-governance-summary.cjs'));
const governanceApp = require(path.join(scripts, 'toolkit-governance-app.cjs'));
const SESSION = 'session-card-1';
const SLUG = 'toolkit-test-fixture/card';

const RUNNING = require(path.join(scripts, 'toolkit-version.cjs')).readToolkitVersion();
// `minToolkit` defaults to none for the full summary (an older programme file) and to the running
// release where every part is in place; `commitFiles` makes the merged commit a real one holding them.
function fixture(t, { quiet = false, taskPrs = null, minToolkit = quiet ? RUNNING : null, requiredChecks = ['validate'], commitFiles = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-summary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'card'), 'card', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const text = `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: requiredChecks,
    ...(taskPrs ? { task_prs: taskPrs } : {}),
    ...(minToolkit ? { min_toolkit: minToolkit } : {}),
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text);
  let commit;
  if (commitFiles) {
    const git = args => require('node:child_process').execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
    git(['init', '--quiet']);
    for (const [file, body] of Object.entries(commitFiles)) {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      fs.writeFileSync(path.join(repo, file), body);
    }
    git(['add', '--', ...Object.keys(commitFiles), '.github/toolkit-programme.json']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'merged']);
    commit = git(['rev-parse', 'HEAD']);
  }
  recordMerged(repo, { registryPath, text, ...(commit ? { commit } : {}) });
  const registryOptions = { registryPath, testOnly: true };
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repo, registryOptions).repository_id);
  if (!quiet) return { repo, registryOptions };
  // Nothing left to do: no instruction copies, permissions current, the App set up.
  const copy = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  fs.rmSync(path.join(repo, 'AGENTS.md'));
  return { repo, registryOptions, cli: QUIET, copy };
}
const appFound = args => {
  const kind = /\/actions\/(variables|secrets)\?/.exec(args[0])[1];
  return { ok: true, value: { total_count: 1, [kind]: [{ name: kind === 'variables' ? governanceApp.APP.variable : governanceApp.APP.secret }] } };
};
const QUIET = Object.freeze({ permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }), appReader: appFound });
const NO_APP = args => ({ ok: true, value: { total_count: 0, [/\/actions\/(variables|secrets)\?/.exec(args[0])[1]]: [] } });

async function run(ctx, argv, { interactive = false, answers = [] } = {}) {
  let out = ''; let err = '';
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions, ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 2, stale: 1, other: 12, review: 'Your lines:\n- `node "C:/own/thing.cjs" --go`', update: 'node fixture-apply.cjs --apply', remove: 'node fixture-apply.cjs --remove' }),
    environment: { TOOLKIT_HOST_SESSION: SESSION }, ...(ctx.cli || {}),
  });
  const code = await cli.main(argv);
  return { code, out, err };
}

// What the agent is told sits in one last line that starts with "Agents"; nothing for the agent sits elsewhere.
function agentsLast(out) {
  const paragraphs = out.trim().split(/\n\s*\n/);
  assert.match(paragraphs.at(-1), /^Agents: [^\n]+$/, 'the last paragraph is the one Agents line');
  for (const paragraph of paragraphs.slice(0, -1)) assert.doesNotMatch(paragraph, /^Agents:|AskUserQuestion|\{"questions"/m, 'no agent instruction outside it');
}
const tableOf = out => out.split('\n').filter(line => /^\| (?!Part |---)/.test(line));

test('a governed repository shows its steps left, Toolkit permissions first with the owner\'s own lines counted, never listed, then one table', async t => {
  const ctx = fixture(t);
  ctx.cli = { appReader: NO_APP };
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  const lines = shown.out.split('\n');
  assert.equal(lines[0], '**Governance: on, not ready: 3 steps left.**', 'an older programme file (no min_toolkit) is not held: no held sentence');
  // The third step: that older programme file is offered its update, asked as the last question.
  assert.ok(lines.includes(`**Programme file:** It is behind this Toolkit: one pull request sets min_toolkit to ${RUNNING}, so governance waits while a setup part is missing. The default branch's required checks could not be read, so only Toolkit's own are added. Answer question 1 below.`));
  assert.equal(lines.at(lines.findIndex(line => line.startsWith('Agents:')) - 2), '   - **B. No:** Nothing is written, and Toolkit asks again next time.', 'the question is the last thing before the Agents line');
  const permissions = lines.findIndex(line => line.startsWith('**Toolkit permissions (Claude Code, this computer):**'));
  const app = lines.findIndex(line => line.startsWith('**Governance App:**'));
  assert.ok(permissions > 0 && app > permissions, 'Toolkit permissions first, then the Governance App');
  assert.equal(lines[permissions], '**Toolkit permissions (Claude Code, this computer):** Lets agents run Toolkit\'s own commands without asking each time. Adds 2 Toolkit lines and updates 1 old one. Your 12 own lines stay as they are. Run it in PowerShell; it shows the changes and waits for Enter.');
  const blocks = [...shown.out.matchAll(/^```powershell\n([\s\S]*?)\n```$/gm)].map(match => match[1]);
  assert.deepEqual(blocks, ['node fixture-apply.cjs --apply', `node "${path.join(scripts, 'toolkit-governance-app-setup.cjs')}" --repo ${SLUG} --store toolkit-test-fixture/store`]);
  assert.doesNotMatch(shown.out, /C:\/own\/thing|Your lines:/, 'the owner\'s own lines are never printed here');
  assert.match(shown.out, /^Say done when you have run them\.$/m);
  assert.deepEqual(tableOf(shown.out), [
    '| GitHub governance | On | Records, decisions and evidence for this repository, the same on every computer |',
    '| Evidence store | toolkit-test-fixture/store (not checked) | Keeps programme records, plans and reviews apart from the code |',
    '| Parent issue | Ready: #1 | Tracks every task as a sub-issue |',
    '| Task auto-merge with merge train | Off | Reviewed, green task pull requests land on their own, in merge trains |',
    '| Required checks | Set: validate | Every pull request passes these before it lands |',
    '| Branch protection and rulesets | Not checked here yet: this run does not read GitHub | Pull requests only, required checks and no force pushes on the default branch |',
    '| Security settings | Not checked here yet: this run does not read GitHub | Flags and updates vulnerable dependencies |',
    '| Cloud workflows | Not read | Keep records in step from GitHub, with no computer on |',
    '| Guards | Not read | Check every pull request and push |',
    '| Toolkit permissions (Claude Code, this computer) | Waiting: 2 to add, 1 old to update | Agents run Toolkit\'s own commands without asking each time |',
    '| Governance App | Waiting: not set up | Lets the cloud workflows act on GitHub |',
    '| Toolkit instruction copies | 1 file left; say clean up copies | Old Toolkit instruction copies an earlier setup left |',
  ]);
  assert.match(shown.out, /^To change something later, say: turn off governance, task auto-merge on or off, or change store\.$/m);
  assert.doesNotMatch(shown.out, /Bank reference|1\.1=|explain 1\./, 'no bank codes');
  assert.match(shown.out.trim().split(/\n\s*\n/).at(-1), /^Agents: this line is for you alone\. .*When the owner says they have run them, run node "[^"]+toolkit-governance\.cjs" setup again and show its output\./);
  agentsLast(shown.out);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const pending = new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch);
  assert.deepEqual(Object.keys(pending).sort(), ['at', 'bank_reference', 'epoch', 'repository_id', 'repository_mark', 'root', 'shown_parts'], 'a change in words can answer it');
  assert.ok(Object.values(pending.shown_parts).every(value => /^[0-9a-f]{12}$/.test(value)), 'what was shown is kept as short hashes, never as text');
});

test('with every part in place the summary says on and ready, with no command and no step', async t => {
  const ctx = fixture(t, { quiet: true, taskPrs: { auto_merge: 'after-gates' } });
  const { out } = await run(ctx, ['setup']);
  assert.equal(out.split('\n')[0], '**Governance: on and ready.**');
  assert.doesNotMatch(out, /```|Say done/);
  const table = tableOf(out);
  assert.ok(table.includes('| Task auto-merge with merge train | On | Reviewed, green task pull requests land on their own, in merge trains |'), 'no merge_train key means trains on');
  assert.ok(table.includes('| Toolkit permissions (Claude Code, this computer) | Up to date | Agents run Toolkit\'s own commands without asking each time |'));
  assert.ok(table.includes('| Governance App | Set up | Lets the cloud workflows act on GitHub |'));
  assert.ok(!table.some(line => line.startsWith('| Toolkit instruction copies')));
});

// ---- the programme file update ----------------------------------------------------------------
// An older governed programme file (the SQAG shape: min_toolkit 3.137.0, below the setup hold, and no
// required checks while a ruleset requires one). Red on main: the summary offered nothing, and the
// finish told the owner to edit required_checks by hand.
const PLAIN_TEXT = 'name: plain-text\non: [pull_request]\njobs:\n  plain-text:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n';
const RULESET_CHECK = 'Quote Basis click budget';
const protectedBy = (...contexts) => () => ({ ok: true, default_branch: 'main', repository: {}, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: contexts.map(context => ({ context, integration_id: 15368 })) } }], classic: null, toolkit_ruleset: null });

test('an older programme file gets one update pull request on the owner\'s yes: min_toolkit to this release, the ruleset\'s check and Toolkit\'s own; a no writes nothing', async t => {
  const ctx = fixture(t, { quiet: true, minToolkit: '3.137.0', requiredChecks: [], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT } });
  const published = [];
  const writes = [];
  ctx.cli = { ...QUIET, protectionReader: protectedBy(RULESET_CHECK), switchTransport: {
    openProgrammeUpdate: () => null,
    publishProgrammeUpdate: (...args) => { published.push(args); return { number: 31, url: `https://github.com/${SLUG}/pull/31`, head: 'b'.repeat(40) }; },
    publishSwitch: (...args) => { writes.push(args); throw new Error('not this one'); },
  } };
  const words = `sets min_toolkit to ${RUNNING} (now 3.137.0), so governance waits while a setup part is missing, and adds ${RULESET_CHECK} and plain-text to the required checks`;
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(shown.out.split('\n')[0], '**Governance: on, not ready: 1 step left.**');
  assert.ok(shown.out.split('\n').includes(`**Programme file:** It is behind this Toolkit: one pull request ${words}. Answer question 1 below.`));
  assert.match(shown.out, /^\*\*1\. Question: Bring the programme file up to date\?\*\*\n {3}- \*\*A\. Yes \(my pick\):\*\* One pull request [^\n]+ Nothing else changes, and it applies only after you merge it\.\n {3}- \*\*B\. No:\*\* Nothing is written, and Toolkit asks again next time\.$/m);
  agentsLast(shown.out);
  assert.deepEqual(published, [], 'nothing is written before the owner\'s yes');
  const no = await reply(ctx, '1B');
  assert.equal(no.code, 0, no.err);
  assert.match(no.out, /^Programme file: not updated\. Nothing was written; Toolkit asks again next time\.$/m);
  assert.deepEqual(published, [], 'a no writes nothing');
  // A plain yes after that used answer is never read as a second one.
  const stray = await reply(ctx, 'yes');
  assert.match(stray.out, /^Your earlier answer was already used, and this reply changes nothing\. Nothing more was written\.$/m);
  assert.deepEqual(published, []);
  const yes = await reply(ctx, '1A');
  assert.equal(yes.code, 0, yes.err);
  assert.equal(published.length, 1, 'one pull request');
  assert.deepEqual(writes, [], 'no other pull request');
  const [repository, mergedText, text, update] = published[0];
  assert.equal(repository, SLUG);
  assert.equal(mergedText, fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8'), 'built from the exact merged text');
  const before = JSON.parse(mergedText), after = JSON.parse(text);
  assert.deepEqual(after, { ...before, min_toolkit: RUNNING, required_checks: [RULESET_CHECK, 'plain-text'] }, 'only min_toolkit and required_checks change');
  assert.deepEqual(text.split('\n').filter(line => !mergedText.split('\n').includes(line)), [`  "required_checks": ["${RULESET_CHECK}", "plain-text"],`, `  "min_toolkit": "${RUNNING}"`], 'the diff shows only those two lines');
  assert.deepEqual(update.added, [RULESET_CHECK, 'plain-text']);
  assert.ok(yes.out.split('\n').includes(`Prepared https://github.com/${SLUG}/pull/31: it ${words}, and changes nothing else. It applies only after you merge it.`), yes.out);
});

test('an update already open is the step to merge, never a second question; a file in step is asked nothing', async t => {
  const open = fixture(t, { quiet: true, minToolkit: '3.137.0' });
  open.cli = { ...QUIET, protectionReader: protectedBy('validate'), switchTransport: { openProgrammeUpdate: () => ({ number: 30, url: `https://github.com/${SLUG}/pull/30` }) } };
  const waiting = await run(open, ['setup']);
  assert.match(waiting.out, /^\*\*Programme file:\*\* An update waits in https:\/\/github\.com\/toolkit-test-fixture\/card\/pull\/30: merge it, then say toolkit governance\.$/m);
  assert.doesNotMatch(waiting.out, /Question: Bring the programme file/);
  const current = fixture(t, { quiet: true });
  current.cli = { ...QUIET, protectionReader: protectedBy('validate'), switchTransport: { openProgrammeUpdate: () => { throw new Error('not read for a file in step'); } } };
  const ready = await run(current, ['setup']);
  assert.equal(ready.out.split('\n')[0], '**Governance: on and ready.**');
  assert.doesNotMatch(ready.out, /Programme file|Question:/);
});

test('the update keeps the repository\'s own checks, moves min_toolkit only below the hold, and keeps the file\'s own layout', () => {
  const binding = { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', required_checks: ['own-z', 'own-a'], min_toolkit: '3.137.0' };
  const update = summary.programmeUpdate({ binding, running: '3.202.0', holdFrom: '3.199.0', branchChecks: ['own-a', 'branch'], ownChecks: ['plain-text'] });
  assert.deepEqual(update, { min_toolkit: { from: '3.137.0', to: '3.202.0' }, required_checks: ['own-z', 'own-a', 'branch', 'plain-text'], added: ['branch', 'plain-text'], branchUnread: false });
  assert.equal(summary.programmeUpdate({ binding: { ...binding, min_toolkit: '3.199.0', required_checks: ['branch', 'plain-text'] }, running: '3.202.0', holdFrom: '3.199.0', branchChecks: ['branch'], ownChecks: ['plain-text'] }), null, 'in step: nothing offered');
  assert.equal(summary.programmeUpdate({ binding: { ...binding, min_toolkit: '3.199.0' }, running: '3.202.0', holdFrom: '3.199.0', branchChecks: null, ownChecks: [] }), null, 'at the hold already, min_toolkit is left as it is');
  const unread = summary.programmeUpdate({ binding: { ...binding, min_toolkit: undefined }, running: '3.202.0', holdFrom: '3.199.0', branchChecks: null, ownChecks: ['plain-text'], keyReadable: false });
  assert.deepEqual(unread, { min_toolkit: null, required_checks: ['own-z', 'own-a', 'plain-text'], added: ['plain-text'], branchUnread: true }, 'no min_toolkit added while pinned sweep copies might not read it');
  assert.equal(summary.programmeUpdate({ binding: { ...binding, governance: 'disabled' }, running: '3.202.0', holdFrom: '3.199.0' }), null);
  // Layout: CRLF line ends and four-space indent stay; only the two values change.
  const text = JSON.stringify(binding, null, 4).replace(/\n/g, '\r\n') + '\r\n';
  const written = summary.programmeUpdateText(text, binding, update);
  assert.deepEqual(JSON.parse(written), { ...binding, min_toolkit: '3.202.0', required_checks: ['own-z', 'own-a', 'branch', 'plain-text'] });
  assert.equal(written.replace('"3.202.0"', '"3.137.0"').replace(/"required_checks": \[[^\]]*\]/, 'X'), text.replace(/"required_checks": \[[^\]]*\]/, 'X'));
  // Default-branch checks: rulesets and classic protection; none on a plan without protection; unknown otherwise.
  assert.deepEqual(summary.branchRequiredChecks({ ok: true, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'b' }] } }, { type: 'pull_request' }], classic: { checks: [{ context: 'a' }, { context: 'b' }] } }), ['a', 'b']);
  assert.deepEqual(summary.branchRequiredChecks({ ok: false, reason: 'plan-has-no-protection' }), []);
  assert.equal(summary.branchRequiredChecks({ ok: false, reason: 'forbidden' }), null);
  assert.equal(summary.branchRequiredChecks(null), null);
});

// The toolkit-uat-v4 values of 27 Nov: private on GitHub Free, the finish wrote what GitHub offers there,
// the guards and cloud workflows merged.
test('the summary after a GitHub Free finish says what is on and what GitHub Free does not offer', () => {
  const files = new Set(['.github/workflows/toolkit-programme-sweep.yml', '.github/workflows/toolkit-programme-sweep-gate.yml',
    require(path.join(scripts, 'toolkit-cloud-workflows-copied.cjs')).SWEEP_WORKFLOW, require(path.join(scripts, 'toolkit-governance-security.cjs')).WORKFLOW_REL,
    '.github/workflows/plain-text.yml', require(path.join(scripts, 'toolkit-cloud-workflows-copied.cjs')).COPIED_FILES['personal-data-guard'][0]]);
  const facts = {
    repository: 'example-owner/toolkit-uat-v4', defaultBranch: 'main', store: { repository: 'example-owner/TRANSPORT-toolkit-uat-v4', state: 'usable' }, parents: [1],
    task: { auto_merge: 'after-gates', merge_train: 'on' }, requiredChecks: ['plain-text', 'personal-data'],
    finish: { on: ['the free dependency and security settings'], unavailable: ['the no-force-push ruleset', 'default-branch protection'], held: [] }, drift: null,
    files, permissions: { checked: true, app: 'Claude Code', missing: 0, stale: 0 }, app: { variable: 'found', secret: 'found' }, appCommand: 'x', copies: null, stale: null,
  };
  const text = summary.renderSummary(facts);
  assert.equal(text.split('\n')[0], '**Governance: on and ready.**');
  assert.deepEqual(tableOf(text), [
    '| GitHub governance | On | Records, decisions and evidence for this repository, the same on every computer |',
    '| Evidence store | Ready: example-owner/TRANSPORT-toolkit-uat-v4 (private) | Keeps programme records, plans and reviews apart from the code |',
    '| Parent issue | Ready: #1 | Tracks every task as a sub-issue |',
    '| Task auto-merge with merge train | On | Reviewed, green task pull requests land on their own, in merge trains |',
    '| Required checks | Set: plain-text, personal-data | Every pull request passes these before it lands |',
    '| Branch protection and rulesets | Not available on GitHub Free (private) | Toolkit\'s guards on each computer stand in |',
    '| Security settings | On: the free dependency and security settings | Flags and updates vulnerable dependencies |',
    '| Cloud workflows | On: programme sweep, sweep gate, personal data sweep and dependency auto-merge | Keep records in step from GitHub, with no computer on |',
    '| Guards | On: plain-text check and personal data guard | Check every pull request and push |',
    '| Toolkit permissions (Claude Code, this computer) | Up to date | Agents run Toolkit\'s own commands without asking each time |',
    '| Governance App | Set up | Lets the cloud workflows act on GitHub |',
  ]);
  // Held: the top line says what waits; a store that cannot be used is a step; an unread App is never missing.
  const held = summary.renderSummary({ ...facts, store: { repository: 'example-owner/TRANSPORT-toolkit-uat-v4', state: 'not-private' }, app: { variable: 'unverified', secret: 'found' } }, { held: true });
  assert.equal(held.split('\n')[0], '**Governance: on, not ready: 1 step left.** Programme records, gate records and task auto-merge are held until then.');
  assert.match(held, /^\*\*Evidence store:\*\* example-owner\/TRANSPORT-toolkit-uat-v4 is not private: make it private again on GitHub/m);
  assert.ok(tableOf(held).includes('| Governance App | Not read | Lets the cloud workflows act on GitHub |'));
  // Missing workflow files are named.
  const missing = new Set([...files].filter(file => !file.endsWith('plain-text.yml')));
  assert.ok(tableOf(summary.renderSummary({ ...facts, files: missing })).includes('| Guards | On: personal data guard. Missing: plain-text check | Check every pull request and push |'));
  // One command to run is "it", never "them" (owner UAT, 28 November 2026).
  const one = summary.renderSummary({ ...facts, app: { variable: 'missing', secret: 'missing' } });
  assert.equal([...one.matchAll(/^```powershell$/gm)].length, 1);
  assert.match(one, /^Say done when you have run it\.$/m);
  assert.doesNotMatch(one, /run them/);
});

// The cloud workflow and guard rows read the merged commit's files with git from its PATH location (the
// binding reader's runner), never a git.exe planted in the repository.
test('the merged files come from the merged commit, through the binding reader\'s git runner', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-summary-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => require('node:child_process').execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']);
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'plain-text.yml'), 'name: plain-text\n');
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'base']);
  const commit = git(['rev-parse', 'HEAD']);
  assert.deepEqual([...summary.mergedFiles(root, commit)], ['.github/workflows/plain-text.yml']);
  assert.equal(summary.mergedFiles(root, 'not-a-commit'), null);
  assert.equal(summary.mergedFiles(root, 'f'.repeat(40)), null, 'a commit that is not here reads as not read');
  const calls = [];
  summary.mergedFiles(root, commit, { runGit: (args, options) => { calls.push([args, options.cwd]); return { status: 0, stdout: Buffer.from('') }; } });
  assert.deepEqual(calls, [[['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', commit, '--', '.github'], root]]);
  assert.match(fs.readFileSync(path.join(scripts, 'toolkit-governance-summary.cjs'), 'utf8'), /defaultRunGit/, 'the default runner is the binding reader\'s');
});

test('the finish record keeps the part names the summary reads, and the parts record keeps settings drift', t => {
  const finishing = require(path.join(scripts, 'toolkit-governance-finish.cjs'));
  const parts = require(path.join(scripts, 'toolkit-governance-parts.cjs'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-summary-records-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const registryOptions = { registryPath: path.join(home, 'user-state', 'repository-governance.v1.json'), testOnly: true };
  finishing.markPending(registryOptions, 'r1', { proposal: 2 });
  finishing.record(registryOptions, 'r1', { result: 'done', on: ['the free dependency and security settings'], unavailable: ['default-branch protection'], held: [{ name: 'the first personal data sweep', step: 'start it by hand.' }] });
  assert.deepEqual(finishing.entryFor(registryOptions, 'r1').parts, { on: ['the free dependency and security settings'], unavailable: ['default-branch protection'], held: ['the first personal data sweep'] });
  parts.record(registryOptions, 'r1', { settings: [{ id: 'SECURITY_DEPENDABOT_ALERTS', severity: 'drift' }] });
  assert.deepEqual(parts.saved(registryOptions, 'r1').settings, { drift: ['SECURITY_DEPENDABOT_ALERTS'], unread: false });
});

// ---- changes in words, with the owner's ticket ---------------------------------------------------

const tickets = ctx => new BankTickets({ registryOptions: ctx.registryOptions });
const epochOf = ctx => new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
async function reply(ctx, answer) {
  const shown = tickets(ctx).pendingFor(SESSION, epochOf(ctx));
  assert.ok(shown, 'the summary waits for a change in words');
  const ticket = tickets(ctx).issue(SESSION, epochOf(ctx));
  return run(ctx, ['setup', '--answers', `${shown.bank_reference}: ${answer}`, '--ticket', ticket]);
}

test('a change in words is one pull request; a reply that is not one gets one line and the same summary stays open', async t => {
  const ctx = fixture(t, { quiet: true });
  const calls = [];
  ctx.cli = { ...QUIET, switchTransport: { publishSwitch: (...args) => { calls.push(args); return { number: 12, url: `https://github.com/${SLUG}/pull/12`, head: 'a'.repeat(40) }; } } };
  await run(ctx, ['setup']);
  const unclear = await reply(ctx, 'yes please');
  assert.equal(unclear.code, 0, unclear.err);
  assert.match(unclear.out, /^This was not read as a change: "yes please"\. Say turn off governance, task auto-merge on or off, or change store\. Nothing was written\.$/m);
  assert.match(unclear.out, /^To change something, say turn off governance, task auto-merge on, task auto-merge off or change store\.$/m);
  assert.doesNotMatch(unclear.out, /^\| /m, 'the table is not shown again');
  agentsLast(unclear.out);
  const already = await reply(ctx, 'task auto-merge off');
  assert.match(already.out, /^Task auto-merge is already off\. Nothing changed\.$/m);
  const on = await reply(ctx, 'task auto-merge on');
  assert.equal(on.code, 0, on.err);
  assert.equal(calls.length, 1, 'one switch pull request');
  assert.deepEqual(calls[0][3], { auto_merge: 'after-gates', merge_train: 'on' }, 'on comes with merge trains, as the guided setup asks it');
  assert.match(on.out, /^Prepared https:\/\/github\.com\/toolkit-test-fixture\/card\/pull\/12: it sets task auto-merge on with merge trains and changes nothing else\. It applies only after you merge it\.$/m);
  const store = await reply(ctx, 'change store');
  assert.match(store.out, /^A new evidence store is set up with the controller: say change store in your controller chat, and it sets up the new store with you\. Nothing changed here\.$/m);
  // After a used change, a bare ok is told the answer was used.
  const ok = await reply(ctx, 'ok');
  assert.match(ok.out, /^Your earlier answer was already used, and this reply changes nothing\. Nothing more was written\.$/m);
  const forged = await run(ctx, ['setup', '--answers', `${tickets(ctx).pendingFor(SESSION, epochOf(ctx)).bank_reference}: turn off governance`, '--ticket', 'f'.repeat(32)]);
  assert.equal(forged.code, 2);
  assert.match(forged.err, /^No live reply ticket from the owner/m);
});

test('a reply after what was shown changed is not used, and the summary as it stands now is shown for the next reply', async t => {
  const ctx = fixture(t, { quiet: true });
  await run(ctx, ['setup']);
  ctx.cli = { ...QUIET, permissionsChecker: () => ({ checked: true, host: 'claude', missing: 3, stale: 0, update: 'node fixture-apply.cjs --apply' }) };
  const changed = await reply(ctx, 'turn off governance');
  assert.equal(changed.code, 0, changed.err);
  // The reason names what changed (owner UAT, 28 Nov: a dropped "2A" said only that something had).
  assert.match(changed.out, /^What Toolkit showed has changed since, so the answer was not used and nothing was written\. What changed: Toolkit permissions \(Claude Code, this computer\)\. Here it is as it stands now:$/m);
  assert.match(changed.out, /^\*\*Governance: on, not ready: 1 step left\.\*\*$/m);
  assert.ok(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), 'the owner\'s next reply answers the summary as it is now');
});

test('in the owner\'s own terminal the summary is shown once and an empty reply changes nothing', async t => {
  const ctx = fixture(t, { quiet: true });
  const result = await run(ctx, ['setup'], { interactive: true, answers: ['maybe', ''] });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out.split('**Governance: on and ready.**').length, 2, 'shown once');
  assert.match(result.out, /^This was not read as a change: "maybe"\..* Nothing was written\. To change something, say/m);
  assert.match(result.out, /^Nothing was written\.$/m);
  assert.doesNotMatch(result.out, /^Agents:/m, 'no Agents line in the owner\'s own terminal');
});

test('commands name the managed Toolkit checkout when this computer records one, and the gate accepts exactly that path too', t => {
  const { managedScript } = require(path.join(scripts, 'toolkit-user-state.cjs'));
  const { bankTicketCommand } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const commands = require(path.join(scripts, 'toolkit-commands.cjs'));
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-managed-home-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const own = path.join(scripts, 'toolkit-governance.cjs');
  const checkout = path.join(home, 'GitHub', 'ai-agent-toolkit');
  const state = path.join(home, '.ai-agent-toolkit', 'current', 'state.json');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, JSON.stringify({ repo_path: checkout }));
  fs.mkdirSync(path.join(checkout, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'repo', 'scripts', 'toolkit-governance.cjs'), '');
  const { safePath } = require(path.join(scripts, 'toolkit-permissions.cjs'));
  const managed = `${safePath(checkout, process.platform)}/repo/scripts/toolkit-governance.cjs`;
  assert.equal(managedScript('toolkit-governance.cjs', { userHome: home }), managed);
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  assert.ok(commands.bankGuide().includes(`node "${managed}" setup`));
  assert.match(commands.bankGuide(), /The questions are shown once: after their reply, show only what Toolkit prints, and never show them again unless they type toolkit governance\./);
  assert.doesNotMatch(commands.bankGuide(), /1\.2=B|all recommended|question bank/);
  const live = { peek: () => ({}) };
  const command = scriptPath => `node "${scriptPath}" setup --answers "ABCD-EFGH-JKMN-PQRS: 1A 2A 3A" --ticket ${'a'.repeat(32)}`;
  for (const scriptPath of [own, managed]) assert.equal(bankTicketCommand(command(scriptPath), SESSION, live), true, scriptPath);
  assert.equal(bankTicketCommand(command(path.join(home, 'elsewhere', 'toolkit-governance.cjs')), SESSION, live), false, 'any other copy is refused');
});

// #1373: typing the phrase while the summary or questions wait asks for them afresh, never a reply ticket.
test('typing toolkit governance while the summary is open asks for it afresh, never a reply ticket', async t => {
  const hook = require(path.join(scripts, 'toolkit-governance-hook.cjs'));
  const ctx = fixture(t, { quiet: true });
  const prompt = text => hook.respond('UserPromptSubmit', { cwd: ctx.repo, prompt: text, session_id: SESSION }, {
    registryOptions: ctx.registryOptions, environment: { [gate.HOST_SESSION_VARIABLE]: SESSION }, mergeHold: { recordPromptNote: () => ({ count: 0, note: '' }) },
  }).hookSpecificOutput?.additionalContext || '';
  for (const phrase of ['toolkit governance', 'Governance setup.', 'refresh governance']) {
    await run(ctx, ['setup']);
    assert.equal(prompt(phrase), '', `${phrase}: no ticket and no line`);
    assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), null, `${phrase}: nothing waits for a reply`);
  }
  await run(ctx, ['setup']);
  assert.match(prompt('task auto-merge on'), /--ticket [0-9a-f]{32}/, 'any other own message still gets its ticket');
});

test('a repository whose governance cannot be read gets one more read, then the line to type it again, never the summary', async t => {
  const cache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
  for (const [error, lasting] of [['remote-redirected', true], ['read-timed-out', false]]) {
    const ctx = fixture(t);
    const stateDir = path.dirname(ctx.registryOptions.registryPath);
    const good = cache.readBindingCache(governance.readIdentity(ctx.repo), stateDir);
    let reads = 0;
    ctx.cli = { refresh: (cwd, budget) => { reads += 1; cache.writeCache(stateDir, { ...good, refresh_error: error }); return { refreshed: false, error, budget }; } };
    const shown = await run(ctx, ['setup']);
    assert.equal(reads, 2, 'one more read after the failed one');
    assert.equal(shown.code, 1, error);
    assert.doesNotMatch(shown.out, /^\| |Governance: on/m, 'no summary from an unread binding');
    if (lasting) assert.match(shown.out, /^Toolkit governance could not be shown because the settings merged for this repository could not be read: .*This does not clear on its own: fix that, then type toolkit governance again\.$/m, error);
    else assert.match(shown.out, /^Toolkit governance could not be shown because GitHub could not be read just now.*Type toolkit governance again in a moment\.$/m, error);
    assert.match(shown.out, /Run no other governance command, and never show a status or check in place of it\./);
    agentsLast(shown.out);
    const answered = await run(ctx, ['setup', '--answers', 'ABCD-EFGH-JKMN-PQRS: turn off governance', '--ticket', 'a'.repeat(32)]);
    assert.equal(answered.code, 1);
    assert.match(answered.out, /^Nothing changed, and this answer was not used: GitHub could not be read just now/m);
  }
});

// ---- the GitHub settings in an already-governed repository ------------------------------------------
// The SQAG shape of 28 Nov: governed long before this Toolkit (no finish record), an active ruleset
// requiring the check, and the repository allowing squash and rebase merges. Red on main: both rows said
// "Not checked here yet" and nothing offered the fix.
const { protectionRulesetBody } = require(path.join(scripts, 'toolkit-governance-protection.cjs'));
const NO_FORCE_PUSH = Object.freeze({ id: 5, name: 'protect all branches', target: 'branch', enforcement: 'active', bypass_actors: [], conditions: { ref_name: { include: ['~ALL'], exclude: [] } }, rules: [{ type: 'non_fast_forward' }] });
const DEPENDABOT = 'version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n    schedule:\n      interval: "weekly"\n';
const SETTINGS_ON = Object.freeze({ visibility: 'public', allow_auto_merge: true, delete_branch_on_merge: 'enabled', alerts: 'enabled', security_updates: 'enabled', secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled', advanced_codeql: null });

// One GitHub repository the readers and writers share, so a write shows in the next read.
function fakeGitHub(ctx, { squash = true, alerts = 'enabled', unreadable = null, noForcePush = true } = {}) {
  const github = { merge: { allow_merge_commit: true, allow_squash_merge: squash, allow_rebase_merge: squash }, own: null, rulesets: noForcePush ? [NO_FORCE_PUSH] : [], alerts, writes: [] };
  const binding = { status: 'ok', text: fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8') };
  // protect-main: pull requests and the check, pinned and up to date; it says nothing on merge methods.
  const rules = () => [
    { type: 'pull_request', ruleset_id: 7, parameters: { required_approving_review_count: 0 } },
    { type: 'required_status_checks', ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'plain-text', integration_id: 15368 }] } },
    ...(github.own ? github.own.rules.map(rule => ({ ...rule, ruleset_id: 99 })) : []),
  ];
  const failed = () => ({ ok: false, reason: unreadable });
  ctx.cli = {
    ...QUIET,
    rulesetReader: () => (unreadable ? failed() : { ok: true, rulesets: github.rulesets }),
    protectionReader: () => (unreadable ? failed() : { ok: true, default_branch: 'main', repository: github.merge, rules: rules(), classic: null, toolkit_ruleset: github.own ? { id: 99 } : null }),
    securityReader: () => (unreadable ? failed() : { ok: true, ...SETTINGS_ON, alerts: github.alerts, binding }),
    rulesetCreator: slug => { github.writes.push(['no-force-push ruleset', slug]); return { ok: false, reason: 'not-expected' }; },
    protectionWriter: (slug, checks, existing) => { github.writes.push(['protection ruleset', slug, checks, existing]); github.own = protectionRulesetBody(checks); return { ok: true, id: 99 }; },
    securityWriter: (slug, plan) => {
      github.writes.push(['security', slug, Object.keys(plan).filter(key => plan[key])]);
      if (plan.alerts) github.alerts = 'enabled';
      return Object.keys(plan).filter(key => plan[key]).map(setting => ({ setting, ok: true, reason: null }));
    },
    securityFileWriter: (root, files) => { github.writes.push(['files', files]); return []; },
  };
  return github;
}
const governedSince = t => fixture(t, { quiet: true, requiredChecks: ['plain-text'], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT, '.github/dependabot.yml': DEPENDABOT } });
const rowOf = (out, part) => tableOf(out).find(line => line.startsWith(`| ${part} |`));

test('an already-governed repository with squash and rebase allowed beside an active ruleset shows the drift and offers one yes; a no writes nothing, a yes fixes it the way a turn-on does', async t => {
  const ctx = governedSince(t);
  const github = fakeGitHub(ctx);
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(rowOf(shown.out, 'Branch protection and rulesets'), '| Branch protection and rulesets | On: 1 item; Drift: 1 item, listed below | Pull requests only, required checks and no force pushes on the default branch |');
  assert.ok(shown.out.includes('\n**Branch protection and rulesets:**\n- On: the no-force-push ruleset\n- Drift: main allows merge, squash, rebase (repository settings); only merge commits are allowed\n'), shown.out);
  assert.equal(rowOf(shown.out, 'Security settings'), '| Security settings | On | Flags and updates vulnerable dependencies |');
  assert.doesNotMatch(shown.out, /\*\*Security settings:\*\*/, 'nothing to list for a part that is all on');
  assert.equal(shown.out.split('\n')[0], '**Governance: on, not ready: 1 step left.**');
  assert.ok(shown.out.split('\n').includes('**GitHub settings:** They have drifted from what governance needs, as the table shows. One yes fixes them the way a turn-on sets them up. Answer question 1 below.'));
  assert.match(shown.out, /^\*\*1\. Question: Fix the drifted GitHub settings\?\*\*\n {3}- \*\*A\. Yes \(my pick\):\*\* Toolkit adds the "Toolkit: protected default branch" ruleset on the default branch \(pull requests only, the programme file's required checks pinned to GitHub Actions, branches up to date before merging, merge commits only, nobody can bypass it\), then reads each one back\. Nothing else changes\.\n {3}- \*\*B\. No:\*\* Nothing is written, and Toolkit asks again next time\.$/m);
  agentsLast(shown.out);
  assert.deepEqual(github.writes, [], 'nothing is written before the owner\'s yes');
  const no = await reply(ctx, '1B');
  assert.equal(no.code, 0, no.err);
  assert.match(no.out, /^GitHub settings: not changed\. Nothing was written; Toolkit asks again next time\.$/m);
  assert.deepEqual(github.writes, [], 'a no writes nothing');
  const yes = await reply(ctx, '1A');
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual(github.writes, [['protection ruleset', SLUG, ['plain-text'], null]], 'only Toolkit\'s own ruleset is written, as the finish writes it');
  assert.match(yes.out, /^On and read back: the no-force-push ruleset, default-branch protection and the free dependency and security settings\.$/m);
  const after = await run(ctx, ['setup']);
  assert.equal(rowOf(after.out, 'Branch protection and rulesets'), '| Branch protection and rulesets | On | Pull requests only, required checks and no force pushes on the default branch |');
  assert.equal(after.out.split('\n')[0], '**Governance: on and ready.**');
  assert.doesNotMatch(after.out, /Question:/);
});

test('a fully conformant governed repository shows On for protection and security, and asks nothing', async t => {
  const ctx = governedSince(t);
  const github = fakeGitHub(ctx, { squash: false });
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(rowOf(shown.out, 'Branch protection and rulesets'), '| Branch protection and rulesets | On | Pull requests only, required checks and no force pushes on the default branch |');
  assert.equal(rowOf(shown.out, 'Security settings'), '| Security settings | On | Flags and updates vulnerable dependencies |');
  assert.equal(shown.out.split('\n')[0], '**Governance: on and ready.**');
  assert.doesNotMatch(shown.out, /Question:|GitHub settings/);
  // The full read is saved for the session-start line, so drift saved earlier ends.
  const parts = require(path.join(scripts, 'toolkit-governance-parts.cjs'));
  assert.deepEqual(parts.saved(ctx.registryOptions, governance.governanceState(ctx.repo, ctx.registryOptions).repository_id).settings, { drift: [], unread: false });
  assert.deepEqual(github.writes, []);
});

test('GitHub that cannot be read keeps Not checked here yet with the reason, offers nothing and clears no saved drift', async t => {
  const ctx = governedSince(t);
  const parts = require(path.join(scripts, 'toolkit-governance-parts.cjs'));
  const id = governance.governanceState(ctx.repo, ctx.registryOptions).repository_id;
  parts.record(ctx.registryOptions, id, { settings: [{ id: 'PROTECTION_MERGE_METHODS', severity: 'drift' }] });
  const github = fakeGitHub(ctx, { unreadable: 'gh-unavailable' });
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(rowOf(shown.out, 'Branch protection and rulesets'), '| Branch protection and rulesets | Not checked here yet: GitHub could not be read (the GitHub CLI could not run) | Pull requests only, required checks and no force pushes on the default branch |');
  assert.equal(rowOf(shown.out, 'Security settings'), '| Security settings | Not checked here yet: GitHub could not be read (the GitHub CLI could not run) | Flags and updates vulnerable dependencies |');
  assert.doesNotMatch(shown.out, /Question: Fix/);
  assert.deepEqual(parts.saved(ctx.registryOptions, id).settings.drift, ['PROTECTION_MERGE_METHODS'], 'an unread read never clears saved drift');
  assert.deepEqual(github.writes, []);
});

test('security drift Toolkit turns on is offered with protection drift in one yes; with the programme file update too, each answer names its question', async t => {
  const ctx = governedSince(t);
  fakeGitHub(ctx, { alerts: 'disabled' });
  const shown = await run(ctx, ['setup']);
  assert.equal(rowOf(shown.out, 'Security settings'), '| Security settings | Drift: 1 item, listed below | Flags and updates vulnerable dependencies |');
  assert.ok(shown.out.includes('\n**Security settings:**\n- Drift: Dependabot alerts is off\n'), shown.out);
  assert.match(shown.out, /^ {3}- \*\*A\. Yes \(my pick\):\*\* Toolkit adds the "Toolkit: protected default branch" ruleset [^\n]+ and turns on Dependabot alerts, then reads each one back\. Nothing else changes\.$/m);
  // Both questions open: a bare answer is refused, a numbered one picks its question.
  assert.deepEqual(summary.parseChange('2A', { update: true, fix: true }), { fix: 'yes' });
  assert.deepEqual(summary.parseChange('1 b', { update: true, fix: true }), { update: 'no' });
  assert.deepEqual(summary.parseChange('fix the settings', { fix: true }), { fix: 'yes' });
  assert.deepEqual(summary.parseChange('yes', { fix: true }), { fix: 'yes' });
  assert.throws(() => summary.parseChange('yes', { update: true, fix: true }), /answer question 1 or 2 with A or B, one at a time \(for example 2A\)/);
  assert.throws(() => summary.parseChange('2A', { update: true }), /answer question 1 with A or B\./);
  assert.equal(summary.questionNumbers({ update: { offer: {} }, settings: { fix: { changes: ['x'] } } }).fix, 2);
});

// SQAG as GitHub showed it on 28 Nov: a programme file from an older Toolkit with no required checks,
// no all-branch force-push ruleset, and squash and rebase allowed. Red on main: neither row was read.
test('with no required checks in the programme file, the merge-method drift still shows and waits for the programme file update; the missing ruleset is question 2', async t => {
  const ctx = fixture(t, { quiet: true, minToolkit: '3.137.0', requiredChecks: [], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT, '.github/dependabot.yml': DEPENDABOT } });
  const github = fakeGitHub(ctx, { noForcePush: false });
  ctx.cli = { ...ctx.cli, switchTransport: { openProgrammeUpdate: () => null } };
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(rowOf(shown.out, 'Branch protection and rulesets'), '| Branch protection and rulesets | Drift: 1 item; Waiting for you: 1 item, listed below | Pull requests only, required checks and no force pushes on the default branch |');
  assert.ok(shown.out.includes('\n**Branch protection and rulesets:**\n- Drift: no ruleset blocks force pushes\n- Waiting for you: default-branch protection: main allows merge, squash, rebase (repository settings); only merge commits are allowed. Toolkit\'s ruleset fixes this once the programme file lists required checks (the programme file update adds them); then refresh governance offers it\n'), shown.out);
  assert.match(shown.out, /^\*\*1\. Question: Bring the programme file up to date\?\*\*$/m);
  assert.match(shown.out, /^\*\*2\. Question: Fix the drifted GitHub settings\?\*\*\n {3}- \*\*A\. Yes \(my pick\):\*\* Toolkit adds the "Toolkit: no force pushes" ruleset \(every branch, no bypass\), then reads each one back\. Nothing else changes\.$/m);
  assert.ok(shown.out.split('\n').includes('**GitHub settings:** They have drifted from what governance needs, as the table shows. One yes fixes them the way a turn-on sets them up. Answer question 2 below.'));
  assert.deepEqual(github.writes, []);
});

test('drift Toolkit\'s ruleset cannot fix waits for the owner by hand, and is never offered', () => {
  const branch = { status: 'drift', reason: null, toolkit_ruleset: null, checks: {
    P1: { status: 'drift', details: ['"lint" is required but not in the binding'], missing: [], extra: ['lint'] },
    P2: { status: 'ok', details: [] }, P3: { status: 'ok', details: [], missing: [] }, P4: { status: 'ok', details: [] }, P5: { status: 'ok', details: [] }, P6: { status: 'ok', details: [] },
  } };
  const rows = summary.settingsRows({ rulesetResult: { status: 'present' }, keepState: null, protectionResult: branch, securityResult: { status: 'conformant', fixes: {}, checks: {} } });
  assert.equal(rows.protection, 'On: 1 item; Waiting for you: 1 item, listed below');
  // What only the owner can change says where on GitHub, never a command.
  assert.deepEqual(rows.details.protection, ['On: the no-force-push ruleset', 'Waiting for you: default-branch protection, change by hand: "lint" is required but not in the binding', summary.WHERE.protection]);
  assert.match(summary.WHERE.protection, /^Where on GitHub: the repository's Settings, then Rules, then Rulesets/);
  assert.equal(rows.fix, null);
  // Settings in step, but a workflow the check cannot confirm: checked by hand, never offered.
  const unsure = { status: 'unverified', reason: null, toolkit_ruleset: null, checks: { ...branch.checks, P1: { status: 'ok', details: [], missing: [], extra: [] }, P4: { status: 'unverified', details: ['"plain-text" job has a needs list'] } } };
  const checked = summary.settingsRows({ rulesetResult: { status: 'present' }, keepState: null, protectionResult: unsure, securityResult: { status: 'conformant', fixes: {}, checks: {} } });
  assert.deepEqual([checked.protection, checked.details.protection, checked.fix], ['On: 1 item; Waiting for you: 1 item, listed below', ['On: the no-force-push ruleset', 'Waiting for you: check the workflow by hand: "plain-text" job has a needs list'], null]);
  // GitHub Free (private): every part not enforceable.
  const free = summary.settingsRows({ rulesetResult: { status: 'not-enforceable' }, keepState: null, protectionResult: { status: 'not-enforceable', checks: {} }, securityResult: { status: 'conformant', fixes: {}, checks: {} } });
  assert.deepEqual([free.protection, free.free], ['Not available on GitHub Free (private)', true]);
});

// SQAG's protection cell held about 12 clauses (owner UAT, 28 Nov): each cell is a state with its
// count, and the clauses are a short list under the table, with where on GitHub to change them.
test('a part with many findings keeps a short cell, and lists each finding under the table with where to change it, never a command', () => {
  const branch = { status: 'drift', reason: null, toolkit_ruleset: null, checks: {
    P1: { status: 'drift', details: ['"Quote Basis click budget" is in the binding but not required'], missing: ['Quote Basis click budget'], extra: [] },
    P2: { status: 'ok', details: [] },
    P3: { status: 'unverified', details: ['no readable workflow job is named "Quote Basis click budget"', '.github/workflows/ci.yml: it is outside the YAML subset this check follows'], missing: ['Quote Basis click budget'] },
    P4: { status: 'unverified', details: ['.github/workflows/ci.yml: it is outside the YAML subset this check follows'] },
    P5: { status: 'drift', details: ['main allows merge, squash, rebase (rulesets); only merge commits are allowed'] },
    P6: { status: 'drift', details: ['main does not require branches to be up to date before merging'] },
  } };
  const security = { status: 'drift', fixes: {}, checks: { S4: { status: 'drift', details: ['secret scanning is off'] } } };
  const settings = summary.settingsRows({ rulesetResult: { status: 'missing' }, keepState: null, protectionResult: branch, securityResult: security });
  assert.equal(settings.protection, 'Drift: 1 item; Waiting for you: 7 items, listed below');
  assert.equal(settings.security, 'Waiting for you: 1 item, listed below');
  const text = summary.renderSummary({ repository: SLUG, defaultBranch: 'main', store: null, parents: [], task: {}, requiredChecks: ['Quote Basis click budget'], settings, files: null, permissions: {}, app: null, copies: null, stale: null });
  for (const line of tableOf(text)) assert.ok(line.split(' | ')[1].length <= 60, `a short cell: ${line}`);
  const listed = text.slice(text.indexOf('**Branch protection and rulesets:**'), text.indexOf('To change something later'));
  assert.equal(listed.split('\n').filter(line => line.startsWith('- ')).length, (1 + 7 + 1) + (1 + 1), 'every finding and each where line, one per line');
  assert.ok(listed.includes(`- ${summary.WHERE.protection}\n`) && listed.includes(`- ${summary.WHERE.security}\n`), listed);
  assert.match(listed, /^- Waiting for you: default-branch protection, change by hand: main does not require branches to be up to date before merging$/m);
  assert.doesNotMatch(text, /migrate|own terminal|```|node /, 'no command for the owner to run');
});

// SQAG, 28 Nov: the programme file update merged (min_toolkit and checks), then a second one came for
// personal-data once Toolkit's refresh pull request landed its guard. One refresh offers one.
const PERSONAL_DATA = 'name: personal-data\non: [pull_request]\njobs:\n  personal-data:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n';
test('while Toolkit\'s refresh pull request adds a check of its own, the programme file update waits for it, then one pull request covers that check too', async t => {
  const refreshUrl = `https://github.com/${SLUG}/pull/40`;
  const pending = fixture(t, { quiet: true, minToolkit: '3.137.0', requiredChecks: [], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT } });
  const published = [];
  pending.cli = { ...QUIET, protectionReader: protectedBy(RULESET_CHECK), switchTransport: {
    openProgrammeUpdate: () => null,
    openRefresh: () => ({ number: 40, url: refreshUrl, checks: ['personal-data', 'plain-text'] }),
    publishProgrammeUpdate: (...args) => { published.push(args); return { number: 41, url: `https://github.com/${SLUG}/pull/41`, head: 'b'.repeat(40) }; },
  } };
  const waiting = await run(pending, ['setup']);
  assert.equal(waiting.code, 0, waiting.err);
  assert.ok(waiting.out.split('\n').includes(`**Programme file:** It is behind this Toolkit, and Toolkit's refresh pull request ${refreshUrl} adds the personal-data check. Once it has merged, say toolkit governance: one pull request then brings the programme file up to date, with that check included.`), waiting.out);
  assert.doesNotMatch(waiting.out, /Question: Bring the programme file/, 'no binding pull request is offered while the refresh is pending');
  assert.deepEqual(published, []);
  // After the refresh lands: its guard is on the default branch, so the one update lists its check.
  const landed = fixture(t, { quiet: true, minToolkit: '3.137.0', requiredChecks: [], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT, '.github/workflows/personal-data-guard.yml': PERSONAL_DATA } });
  landed.cli = { ...pending.cli, switchTransport: { ...pending.cli.switchTransport, openRefresh: () => null } };
  const offered = await run(landed, ['setup']);
  assert.match(offered.out, /^\*\*1\. Question: Bring the programme file up to date\?\*\*$/m);
  assert.ok(offered.out.includes(`adds ${RULESET_CHECK}, personal-data and plain-text to the required checks`), offered.out);
  // A refresh that adds only a check the update already lists holds nothing.
  const same = fixture(t, { quiet: true, minToolkit: '3.137.0', requiredChecks: [], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT } });
  same.cli = { ...pending.cli, switchTransport: { ...pending.cli.switchTransport, openRefresh: () => ({ number: 40, url: refreshUrl, checks: ['plain-text'] }) } };
  assert.match((await run(same, ['setup'])).out, /^\*\*1\. Question: Bring the programme file up to date\?\*\*$/m);
});

// Owner decision INT-TK421-1398, the SQAG shape: the repository's own ruleset allows merge, squash and
// rebase, does not require up-to-date branches and does not require plain-text. One yes covers
// Toolkit's ruleset and the exact change to the own ruleset; a no writes nothing.
const CI = 'name: CI\non: [pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n';
const OWN_SQAG_RULES = () => [
  { type: 'pull_request', parameters: { required_approving_review_count: 0, allowed_merge_methods: ['merge', 'squash', 'rebase'] } },
  { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'validate', integration_id: 15368 }] } },
];
// One GitHub repository with the repository's own ruleset "protect-main" (on the default branch), read
// and written through Toolkit's own ruleset writer, and Toolkit's ruleset once written.
function ownRulesetGitHub(t, { requiredChecks }) {
  const ctx = fixture(t, { quiet: true, requiredChecks, commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT, '.github/workflows/ci.yml': CI, '.github/dependabot.yml': DEPENDABOT } });
  const binding = { status: 'ok', text: fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8') };
  const own = { id: 7, name: 'protect-main', target: 'branch', source_type: 'Repository', enforcement: 'active', bypass_actors: [], conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, rules: OWN_SQAG_RULES() };
  const github = { toolkit: null, writes: [] };
  const spawn = (command, args, options) => {
    if (args.includes('PUT')) { github.writes.push(['own ruleset', args[3], JSON.parse(options.input)]); own.rules = JSON.parse(options.input).rules; }
    return { status: 0, stdout: JSON.stringify(own) };
  };
  const { ghOwnRulesetWriter } = require(path.join(scripts, 'toolkit-governance-protection.cjs'));
  ctx.cli = {
    ...QUIET,
    rulesetReader: () => ({ ok: true, rulesets: [NO_FORCE_PUSH] }),
    protectionReader: () => ({ ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true },
      rules: [...own.rules.map(rule => ({ ...rule, ruleset_id: 7 })), ...(github.toolkit ? github.toolkit.rules.map(rule => ({ ...rule, ruleset_id: 99 })) : [])],
      classic: null, toolkit_ruleset: github.toolkit ? { id: 99 } : null,
      rulesets: [{ id: 5, name: NO_FORCE_PUSH.name, source_type: 'Repository' }, { id: 7, name: 'protect-main', source_type: 'Repository', branches: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, ...(github.toolkit ? [{ id: 99, name: protectionRulesetBody([]).name, source_type: 'Repository' }] : [])] }),
    securityReader: () => ({ ok: true, ...SETTINGS_ON, binding }),
    rulesetCreator: () => { throw new Error('not expected'); },
    protectionWriter: (slug, checks, existing) => { github.writes.push(['toolkit ruleset', checks, existing]); github.toolkit = protectionRulesetBody(checks); return { ok: true, id: 99 }; },
    ownRulesetWriter: (slug, entry) => ghOwnRulesetWriter(slug, entry, { spawn }),
    securityWriter: () => { throw new Error('not expected'); },
    securityFileWriter: () => [],
  };
  return { ctx, own, github };
}
const OWN_WORDS = 'changes the repository\'s own ruleset "protect-main" (it covers the default branch): merge methods from merge, squash, rebase to merge commits only; branches up to date before merging from not required to required';

test('a repository\'s own ruleset that allows squash and rebase gets its exact change in the one offer; a no writes nothing, a yes writes it and reads it back', async t => {
  const { ctx, own, github } = ownRulesetGitHub(t, { requiredChecks: ['plain-text', 'validate'] });
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(shown.out.split('\n')[0], '**Governance: on, not ready: 1 step left.**', 'one offer');
  assert.ok(shown.out.includes(`   - **A. Yes (my pick):** Toolkit ${OWN_WORDS} and adds the "Toolkit: protected default branch" ruleset`), shown.out);
  assert.deepEqual(github.writes, [], 'nothing before the yes');
  const no = await reply(ctx, '1B');
  assert.equal(no.code, 0, no.err);
  assert.deepEqual(github.writes, [], 'a no writes nothing');
  const yes = await reply(ctx, '1A');
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual(github.writes.map(entry => entry[0]), ['own ruleset', 'toolkit ruleset'], 'the own ruleset change, then Toolkit\'s ruleset, nothing else');
  assert.deepEqual(own.rules[0].parameters.allowed_merge_methods, ['merge']);
  assert.equal(own.rules[1].parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(own.rules[1].parameters.required_status_checks, [{ context: 'validate', integration_id: 15368 }], 'its required checks stay as they were');
  assert.match(yes.out, /^- toolkit-test-fixture\/card: the repository's own ruleset "protect-main" changed and read back\.$/m);
  assert.match(yes.out, /^On and read back: [^\n]*the repository's own ruleset "protect-main"/m);
  assert.doesNotMatch(yes.out, /by hand/, 'nothing the yes changed is left to change by hand');
  const after = await run(ctx, ['setup']);
  assert.equal(rowOf(after.out, 'Branch protection and rulesets'), '| Branch protection and rulesets | On | Pull requests only, required checks and no force pushes on the default branch |');
  assert.equal(after.out.split('\n')[0], '**Governance: on and ready.**');
});

// G2 round 1 (probe A): where Toolkit's ruleset is not offered (a programme file check no job produces),
// the yes changes only the own ruleset. Red at 9f75922: its result first said "change by hand (Toolkit
// edits only its own ruleset)" for the merge methods and up-to-date branches the same yes then changed.
test('where Toolkit\'s ruleset is not offered, the yes to the own ruleset change never lists what it changes as by hand', async t => {
  const { ctx, own, github } = ownRulesetGitHub(t, { requiredChecks: ['ghost-check', 'plain-text', 'validate'] });
  const shown = await run(ctx, ['setup']);
  assert.ok(shown.out.includes(`   - **A. Yes (my pick):** Toolkit ${OWN_WORDS}, then reads each one back. Nothing else changes.`), shown.out);
  const listed = shown.out.slice(shown.out.indexOf('**Branch protection and rulesets:**'));
  assert.match(listed, /^- Drift: main allows merge, squash, rebase \(rulesets\); only merge commits are allowed$/m, 'what the yes fixes is drift, not by hand');
  assert.match(listed, /^- Waiting for you: default-branch protection: Toolkit's ruleset is not offered while no workflow job produces "ghost-check"$/m);
  assert.doesNotMatch(listed, /change by hand: main|workflow \(drift, fix by hand\)|by hand: Toolkit's ruleset/, 'one plain thing per line');
  const yes = await reply(ctx, '1A');
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual(github.writes.map(entry => entry[0]), ['own ruleset'], 'only the own ruleset');
  assert.deepEqual([own.rules[0].parameters.allowed_merge_methods, own.rules[1].parameters.strict_required_status_checks_policy], [['merge'], true]);
  assert.doesNotMatch(yes.out, /Toolkit edits only its own ruleset|change by hand:?\s*(?:\n\s*- )?main (?:allows|does not require)/, 'never told to change by hand what the yes changed');
  assert.doesNotMatch(yes.out, /main allows merge, squash, rebase|main does not require branches/, 'the changed settings are not listed as left');
  assert.match(yes.out, /ghost-check/, 'what is truly left is still named');
});

// G-4e edge (G2 round 1, L5): an update opened before the refresh added a check says so, and how to
// end with one binding pull request.
test('an update already open while Toolkit\'s refresh pull request adds a check it lacks says to merge the refresh first', async t => {
  const ctx = fixture(t, { quiet: true, minToolkit: '3.137.0', requiredChecks: [], commitFiles: { '.github/workflows/plain-text.yml': PLAIN_TEXT } });
  ctx.cli = { ...QUIET, protectionReader: protectedBy(RULESET_CHECK), switchTransport: {
    openProgrammeUpdate: () => ({ number: 30, url: `https://github.com/${SLUG}/pull/30` }),
    openRefresh: () => ({ number: 40, url: `https://github.com/${SLUG}/pull/40`, checks: ['personal-data', 'plain-text'] }),
  } };
  const shown = await run(ctx, ['setup']);
  assert.ok(shown.out.split('\n').includes(`**Programme file:** An update waits in https://github.com/${SLUG}/pull/30, but Toolkit's refresh pull request https://github.com/${SLUG}/pull/40 adds the personal-data check, which that update does not list. Merge the refresh pull request first, then close the update on GitHub and say toolkit governance: one update then covers it too. Merging the update now means a second one afterwards.`), shown.out);
  assert.doesNotMatch(shown.out, /Question: Bring the programme file/);
});
