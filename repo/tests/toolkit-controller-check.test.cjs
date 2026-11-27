'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseArgs, controllerCheck, format, main, SCRIPTS } = require('../scripts/toolkit-controller-check.cjs');

const GOVERNED = { repository: 'acme/app', governance: 'enabled', parents: [{ issue: 7, record_prefix: 'INT-7-' }] };
const CLEAN = {
  [SCRIPTS.guidebook]: { status: 0, stdout: 'current 2026-11-14.8\n' },
  [SCRIPTS.instructions]: { status: 0, stdout: 'current\n' },
  [SCRIPTS.tasks]: { status: 0, stdout: 'current\n' },
  [SCRIPTS.programme]: { status: 0, stdout: 'Attention: clear\n' },
  [SCRIPTS.traces]: { status: 0, stdout: JSON.stringify({ ok: true }) },
  [SCRIPTS.ci]: { status: 0, stdout: JSON.stringify({ items: [{ level: 'CHECK', check: 'speed.jobs', path: '', message: 'judge' }] }) },
  [SCRIPTS.footer]: { status: 0, stdout: 'GitHub footer sweep (report only) of acme/app: no posts with the footer\n' },
  [SCRIPTS.refs]: { status: 0, stdout: 'SCRIPT REFERENCES: clear\n' },
  [SCRIPTS.ownerLines]: { status: 0, stdout: 'Nothing to fix.\n' },
};

const NOW = new Date('2026-11-14T12:00:00Z');

// A fake child-process runner: canned results per script, and every call recorded.
function world({ results = {}, binding = GOVERNED, library = true, hub = null, git = null } = {}) {
  const calls = [];
  const deps = {
    run(script, args, options) { calls.push({ script, args, options }); return { stderr: '', error: null, ...(results[script] || CLEAN[script]) }; },
    exists: () => library,
    readBinding: checkout => (checkout ? binding : null),
    readHubState: () => hub,
    git(cwd, args) { calls.push({ git: args, cwd }); return { stderr: '', error: null, ...(git ? git(args) : { status: 1, stdout: '' }) }; },
    now: () => NOW,
  };
  return { deps, calls };
}
const run = (argv, setup) => {
  const { deps, calls } = world(setup);
  let text = '';
  const code = main(argv, { ...deps, stdout: chunk => { text += chunk; }, stderr: chunk => { text += chunk; } });
  return { code, text, calls };
};
const ALL = ['--checkout', '/repo', '--instructions', 'i.md', '--memory', 'm.md', '--task', 'hourly-nudge=h.md', '--owner-lines', 'o.md'];

test('a clean run prints one line and exits 0', () => {
  const { code, text } = run(ALL);
  assert.equal(code, 0);
  assert.equal(text, 'CONTROLLER CHECK: clear (ok: guidebook instructions memory tasks owner-lines programme traces ci footer refs; skipped: toolkit)\n');
});

test('checks are segregated by host and governance, and skip cleanly with the reason', () => {
  const chat = controllerCheck(parseArgs(ALL), world({ library: false }).deps);
  assert.equal(chat.host, 'chat');
  for (const name of ['guidebook', 'instructions', 'memory', 'tasks']) {
    assert.deepEqual(chat.checks.find(check => check.name === name), { name, state: 'skipped', lines: ['Claude Projects only'] });
  }
  assert.deepEqual(chat.checks.filter(check => check.state === 'ok').map(check => check.name), ['owner-lines', 'programme', 'traces', 'ci', 'footer', 'refs']);
  const off = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: { ...GOVERNED, governance: 'disabled' } }).deps);
  assert.deepEqual(off.checks.filter(check => check.state === 'skipped').map(check => `${check.name}: ${check.lines[0]}`).slice(-2), ['programme: governance off', 'traces: governance off']);
  const none = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: null }).deps);
  assert.equal(none.checks.find(check => check.name === 'programme').lines[0], 'no programme binding in the checkout');
  assert.equal(none.checks.find(check => check.name === 'footer').lines[0], 'pass --repo <owner/name>');
  const bare = controllerCheck(parseArgs([]), world().deps);
  assert.equal(bare.host, 'projects');
  assert.match(bare.checks.find(check => check.name === 'instructions').lines[0], /^pass --instructions/);
  assert.match(bare.checks.find(check => check.name === 'ci').lines[0], /^pass --checkout/);
});

test('--skip leaves out checks the caller already ran', () => {
  const { calls, text } = run([...ALL, '--skip', 'guidebook,programme']);
  assert.equal(calls.some(call => [SCRIPTS.guidebook, SCRIPTS.programme].includes(call.script)), false);
  assert.match(text, /skipped: toolkit guidebook programme/);
});

test('findings print compactly: counts by code and the top items, full detail behind --expand', () => {
  const findings = Array.from({ length: 6 }, (_, index) => `- F${index} new ${index < 4 ? 'CLOSING_STORY' : 'STALE_PR'} #${index}: do it`);
  const results = { [SCRIPTS.programme]: { status: 0, stdout: ['Attention: 6 new, 0 acknowledged', '', ...findings, '', 'The controller answers each new finding'].join('\n') } };
  const compact = run(ALL, { results });
  assert.equal(compact.code, 1);
  assert.deepEqual(compact.text.trimEnd().split('\n'), [
    'CONTROLLER CHECK: 1 need attention, 0 could not run (ok: guidebook instructions memory tasks owner-lines traces ci footer refs; skipped: toolkit)',
    'ATTENTION programme: Attention: 6 new, 0 acknowledged (CLOSING_STORY 4, STALE_PR 2)',
    `  ${findings[0]}`, `  ${findings[1]}`, `  ${findings[2]}`,
    `  ... 3 more (--expand, or ${require('../scripts/toolkit-user-state.cjs').programmeCommand('attention')})`,
  ]);
  const expanded = run([...ALL, '--expand'], { results });
  for (const line of findings) assert.ok(expanded.text.includes(`  ${line}\n`));
  assert.match(expanded.text, /\nOK ci: 0 GAP, 1 CHECK/);
});

test('the Open PRs list of attention is neither counted nor listed as a finding', () => {
  const finding = '- aaaaaaaaaaaa new PR_UNOWNED PR #1261: Controller: today, land this open pull request';
  const stdout = ['Attention: 1 new, 0 acknowledged', '', 'Owner waits (0)', '', 'Open PRs (3)', '- PR #1261 "Upstream updates", open 7 d, owner none, flagged aaaaaaaaaaaa',
    '- PR #1523 "A slice", open 3 h, owner #1242, next: Builder: finish it', '- store PR 12 "Clean-up", open 2 h, owner none, flagged after 2026-11-25T09:00:00.000Z', '', finding].join('\n');
  const { text } = run([...ALL, '--expand'], { results: { [SCRIPTS.programme]: { status: 0, stdout } } });
  assert.ok(text.includes(`ATTENTION programme: Attention: 1 new, 0 acknowledged (PR_UNOWNED 1)\n  ${finding}\n`), text);
  assert.doesNotMatch(text, /Upstream updates|A slice|Clean-up/);
});

test('each checker maps its own exit codes and output to attention or could-not-run', () => {
  const results = {
    [SCRIPTS.guidebook]: { status: 1, stdout: 'stale skill 2026-11-14.7, main 2026-11-14.8\n' },
    [SCRIPTS.instructions]: { status: 2, stdout: '', stderr: 'Project instructions could not be processed (PROJECT_INSTRUCTIONS_INVALID).\n' },
    [SCRIPTS.tasks]: { status: 1, stdout: 'outdated\n' },
    [SCRIPTS.programme]: { status: 1, stdout: 'Attention: unknown (gh not signed in)\n' },
    [SCRIPTS.traces]: { status: 1, stdout: JSON.stringify({ ok: false, unlinked: ['1', '2', '3'], unlinked_decisions: ['1', '2'], unknown_supersedes: [], superseded_unmarked: [{ id: '3' }], index_errors: [] }) },
    [SCRIPTS.ci]: { status: 0, stdout: JSON.stringify({ items: [{ level: 'GAP', check: 'parts.docker', path: 'Dockerfile', message: 'no CI step builds this Dockerfile' }] }) },
    [SCRIPTS.footer]: { status: 3, stdout: 'FOUND pull_request https://github.com/acme/app/pull/9 (me)\nGitHub footer sweep (report only) of acme/app: 1 FOUND\n' },
    [SCRIPTS.refs]: { status: 1, stdout: 'SCRIPT REFERENCES: 1 found\nRETIRED permission row tasks-plan runs repo/scripts/old.cjs\n' },
  };
  const report = controllerCheck(parseArgs(ALL), world({ results }).deps);
  const byName = Object.fromEntries(report.checks.map(check => [check.name, check]));
  assert.equal(byName.guidebook.state, 'attention');
  assert.deepEqual(byName.instructions, { name: 'instructions', state: 'failed', lines: ['Project instructions could not be processed (PROJECT_INSTRUCTIONS_INVALID).'] });
  assert.equal(byName.memory.state, 'attention');
  assert.deepEqual(byName.tasks.lines, ['hourly-nudge: outdated']);
  assert.deepEqual(byName.programme, { name: 'programme', state: 'failed', lines: ['Attention: unknown (gh not signed in)'] });
  assert.equal(byName.traces.state, 'attention');
  assert.match(byName.traces.lines[0], /^#7: 2 unlinked decision comments, 1 superseded records not marked \(/);
  assert.deepEqual(byName.ci.lines, ['1 GAP, 0 CHECK (CHECK needs judgement: ci-checkup.cjs lists them)', 'parts.docker Dockerfile: no CI step builds this Dockerfile']);
  assert.equal(byName.footer.state, 'attention');
  assert.deepEqual(byName.refs.lines, ['SCRIPT REFERENCES: 1 found', 'RETIRED permission row tasks-plan runs repo/scripts/old.cjs']);
  assert.equal(report.attention, 7);
  assert.equal(report.failed, 2);
  const unreadable = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ results: { [SCRIPTS.traces]: { status: 2, stdout: '', stderr: 'FAIL: gh api failed\n' }, [SCRIPTS.footer]: { status: 1, stdout: 'FAILED scan acme/app: HTTP 403\n' } } }).deps);
  assert.deepEqual(unreadable.checks.find(check => check.name === 'traces').lines, ['#7: could not run: FAIL: gh api failed']);
  assert.equal(unreadable.checks.find(check => check.name === 'footer').state, 'failed');
});

test('every child runs in its read-only mode with the inputs given', () => {
  const { calls } = run([...ALL, '--repo', 'acme/other', '--since', '2026-11-13T00:00:00Z']);
  const args = Object.fromEntries(calls.map(call => [`${call.script} ${call.args[0]}`, call.args]));
  assert.deepEqual(args[`${SCRIPTS.guidebook} --check`], ['--check', '/mnt/project-files/toolkit/web-controller-projects']);
  assert.deepEqual(args[`${SCRIPTS.instructions} --check`], ['--check', 'i.md']);
  assert.deepEqual(args[`${SCRIPTS.tasks} --check-memory`], ['--check-memory', 'm.md']);
  assert.deepEqual(args[`${SCRIPTS.tasks} --check`], ['--check', 'hourly-nudge', 'h.md']);
  assert.deepEqual(args[`${SCRIPTS.programme} attention`], ['attention', '--repo-root', '/repo']);
  assert.deepEqual(args[`${SCRIPTS.traces} --repo`], ['--repo', 'acme/other', '--issue', '7', '--record-prefix', 'INT-7-']);
  assert.deepEqual(args[`${SCRIPTS.ci} --repo`], ['--repo', '/repo', '--json']);
  assert.deepEqual(args[`${SCRIPTS.footer} --repo`], ['--repo', 'acme/other', '--since', '2026-11-13T00:00:00Z']);
  assert.deepEqual(calls.find(call => call.script === SCRIPTS.refs).args, []);
  for (const call of calls) for (const flag of ['--apply', '--out', '--refresh', '--repair', '--write']) assert.equal(call.args.includes(flag), false);
  const defaults = run(['--host', 'chat', '--checkout', '/repo']).calls.find(call => call.script === SCRIPTS.footer);
  assert.deepEqual(defaults.args, ['--repo', 'acme/app', '--since', '2026-11-13T10:00:00.000Z']);
});

test('a chat controller sees when this computer\'s Toolkit checkout is behind its origin branch, with the update command', () => {
  const HEAD = 'a'.repeat(40), NEWER = 'b'.repeat(40);
  const hub = { repo_path: '/home/me/.ai-agent-toolkit/source', repo_branch: 'main' };
  const gitAt = (upstream, lsRemoteStatus = 0) => (args) => (args[0] === 'rev-parse' ? { status: 0, stdout: `${HEAD}\n` }
    : { status: lsRemoteStatus, stdout: lsRemoteStatus ? '' : `${upstream}\trefs/heads/main\n`, stderr: lsRemoteStatus ? 'fatal: unable to access remote\n' : '' });
  const toolkit = (setup, argv = ['--host', 'chat']) => {
    const { deps, calls } = world(setup);
    return { check: controllerCheck(parseArgs(argv), deps).checks.find(check => check.name === 'toolkit'), calls };
  };
  const current = toolkit({ hub, git: gitAt(HEAD) });
  assert.deepEqual(current.check, { name: 'toolkit', state: 'ok', lines: ["this computer's Toolkit is current with origin main at aaaaaaa"] });
  // Read-only: one local read and one remote read, in the checkout.
  assert.deepEqual(current.calls.filter(call => call.git).map(call => [call.cwd, call.git.join(' ')]),
    [[hub.repo_path, 'rev-parse HEAD'], [hub.repo_path, 'ls-remote --exit-code origin refs/heads/main']]);
  const behind = toolkit({ hub, git: gitAt(NEWER) }).check;
  assert.equal(behind.state, 'attention');
  assert.equal(behind.command, 'node "/home/me/.ai-agent-toolkit/source/repo/scripts/toolkit-local-bridge.cjs" --repo-update-now --write');
  assert.equal(behind.lines[0], `this computer's Toolkit is at aaaaaaa, origin main is at bbbbbbb: run ${behind.command}, then reread CONTROLLER.md and the global rules`);
  const offline = toolkit({ hub, git: gitAt(NEWER, 128) }).check;
  assert.deepEqual(offline, { name: 'toolkit', state: 'failed', lines: ['cannot read origin main: fatal: unable to access remote'] });
  assert.deepEqual(toolkit({ hub: null }).check.lines, ['no managed Toolkit checkout on this computer (setup toolkit records one)']);
  const projects = toolkit({ hub, git: gitAt(NEWER) }, []);
  assert.deepEqual(projects.check.lines, ['chat only']);
  assert.equal(projects.calls.some(call => call.git), false);
});

test('bad arguments exit 2 with the usage', () => {
  for (const argv of [['--host', 'web'], ['--task', 'nightly=x.md'], ['--skip', 'nothing'], ['--skip', 'handoff'], ['--skip', 'programme,handoff,refs'], ['--handoff', '/store'], ['--repo', 'bad'], ['--since', 'soon'], ['--checkout'], ['--what']]) {
    const { code, text } = run(argv);
    assert.equal(code, 2, argv.join(' '));
    assert.match(text, /Usage: toolkit-controller-check\.cjs/);
  }
});

test('--json prints the report as data', () => {
  const { text } = run([...ALL, '--json']);
  const report = JSON.parse(text);
  assert.equal(report.host, 'projects');
  assert.equal(report.governed, true);
  assert.equal(report.checks.length, 11);
  assert.equal(format(report).split('\n')[0].startsWith('CONTROLLER CHECK: clear'), true);
});

test('a run where every check is skipped says nothing ran and exits 1, never clear', () => {
  const { code, text } = run(['--host', 'chat', '--skip', 'refs']);
  assert.equal(code, 1);
  assert.match(text, /^CONTROLLER CHECK: nothing ran \(skipped: toolkit guidebook instructions memory tasks owner-lines programme traces ci footer refs\): pass the inputs each skipped check names/);
  // With no inputs at all only the Toolkit's own script-reference check runs, which is not a clear run.
  const bare = run(['--host', 'chat']);
  assert.equal(bare.code, 1);
  assert.match(bare.text, /^CONTROLLER CHECK: nothing ran \(ok: refs; skipped: toolkit guidebook instructions memory tasks owner-lines programme traces ci footer\)/);
});

test('there is no stale check: a stored task prompt that still skips it runs the rest', () => {
  assert.equal(require('../scripts/toolkit-controller-check.cjs').CHECKS.includes('stale'), false);
  const { code, text, calls } = run([...ALL, '--skip', 'programme,traces,stale,ci']);
  assert.equal(code, 0);
  assert.equal(text, 'CONTROLLER CHECK: clear (ok: guidebook instructions memory tasks owner-lines footer refs; skipped: toolkit programme traces ci)\n');
  assert.equal(calls.some(call => call.gh), false, 'no GitHub read of its own');
});

// #1242 S4: the owner's own lines are linted on any host, against the controller settings when given,
// and against Toolkit's block only on a Projects host.
test('owner-lines lints the owner\'s lines on any host, with the settings and, on Projects, the block', () => {
  const chat = run(['--host', 'chat', '--owner-lines', 'CLAUDE.md', '--settings', 's.json']);
  const lint = chat.calls.find(call => call.script === SCRIPTS.ownerLines);
  assert.deepEqual(lint.args, ['check', '--file', 'CLAUDE.md', '--settings', 's.json']);
  // Where the controlled repository is known, the settings must be its own.
  for (const named of [['--repo', 'acme/app'], ['--checkout', '/repo']]) {
    const owned = run(['--host', 'chat', ...named, '--owner-lines', 'CLAUDE.md', '--settings', 's.json']);
    assert.deepEqual(owned.calls.find(call => call.script === SCRIPTS.ownerLines).args, ['check', '--file', 'CLAUDE.md', '--settings', 's.json', '--repository', 'acme/app'], named[0]);
  }
  const projects = run(['--owner-lines', 'i.md']);
  assert.deepEqual(projects.calls.find(call => call.script === SCRIPTS.ownerLines).args, ['check', '--file', 'i.md', '--block', 'projects']);
  const fixes = run(['--host', 'chat', '--owner-lines', 'CLAUDE.md'], { results: { [SCRIPTS.ownerLines]: { status: 1, stdout: 'line 3: "- Lanes: 1" It says live lanes 1, but the controller settings say 2. Fix 3-conflicts-setting-abcd1234: replace it.\n' } } });
  assert.equal(fixes.code, 1);
  assert.match(fixes.text, /ATTENTION owner-lines: line 3: "- Lanes: 1" It says live lanes 1/);
  // A lint that could not run is said so, never as something to settle.
  const stopped = run(['--host', 'chat', '--owner-lines', 'CLAUDE.md', '--settings', 's.json'], { results: { [SCRIPTS.ownerLines]: { status: 2, stdout: '', stderr: 'The controller settings file is not JSON.' } } });
  assert.match(stopped.text, /0 need attention, 1 could not run/);
  assert.match(stopped.text, /The controller settings file is not JSON/);
  const none = run(['--host', 'chat']);
  assert.ok(none.calls.every(call => call.script !== SCRIPTS.ownerLines), 'no file, no lint');
});

test('a shard finding from the CI check-up is ATTENTION on the ci row with the playbook as its next action', () => {
  const ciCheckup = require('../../skills/secure-ci-cd/scripts/ci-checkup.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-check-shards-'));
  try {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\non:\n  pull_request:\njobs:\n  validate:\n    name: Validate app\n    runs-on: ubuntu-latest\n    steps:\n      - run: python -m unittest discover -s tests\n');
    // The real check-up's report, as the ci child prints it, from measured job times.
    const report = ciCheckup.checkup(dir, { github: false, jobTimes: new Map([['CI / Validate app', 2880]]) });
    const results = { [SCRIPTS.ci]: { status: 0, stdout: JSON.stringify(report) } };
    const ci = controllerCheck(parseArgs(ALL), world({ results }).deps).checks.find(check => check.name === 'ci');
    assert.equal(ci.state, 'attention');
    const line = ci.lines.find(text => text.startsWith('speed.shards '));
    assert.match(line, /^speed\.shards \.github\/workflows\/ci\.yml: CI \/ Validate app took up to 48 min with no sharding; about 5 shards would bring it near 10 min/);
    assert.match(line, /; next: arrange shards for this job in this repository's own CI \(fast-tests-and-sharding playbook, section Arrange Shards In This Repository's CI\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
