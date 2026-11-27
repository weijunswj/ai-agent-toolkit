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

function fixture(t, { quiet = false, taskPrs = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-summary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'card'), 'card', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const text = `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'],
    ...(taskPrs ? { task_prs: taskPrs } : {}),
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text);
  recordMerged(repo, { registryPath, text });
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
  assert.equal(lines[0], '**Governance: on, not ready: 2 steps left.**', 'an older programme file (no min_toolkit) is not held: no held sentence');
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
    '| Branch protection and rulesets | Not checked here yet | Pull requests only, required checks and no force pushes on the default branch |',
    '| Security settings | Not checked here yet | Flags and updates vulnerable dependencies |',
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
  assert.deepEqual(Object.keys(pending).sort(), ['at', 'bank_reference', 'epoch', 'repository_id', 'repository_mark', 'root'], 'a change in words can answer it');
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
  assert.match(changed.out, /^What Toolkit showed has changed since, so the answer was not used and nothing was written\. Here it is as it stands now:$/m);
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
