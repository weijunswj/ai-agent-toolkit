'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, controllerCheck, format, main, polishRows, SCRIPTS } = require('../scripts/toolkit-controller-check.cjs');

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
};

const NOW = new Date('2026-11-14T12:00:00Z');
// The local date the stale sweep stamps, whatever time zone the tests run in.
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;
// By default the stale sweep already ran today for every repository the tests use.
const SWEPT = { 'acme/app': { date: TODAY, at: '2026-11-14T01:00:00Z' }, 'acme/other': { date: TODAY, at: '2026-11-14T01:00:00Z' } };

// A fake child-process runner: canned results per script, and every call recorded.
function world({ results = {}, binding = GOVERNED, library = true, hub = null, git = null, stamps = SWEPT, gh = null } = {}) {
  const calls = [];
  const written = [];
  const deps = {
    run(script, args, options) { calls.push({ script, args, options }); return { stderr: '', error: null, ...(results[script] || CLEAN[script]) }; },
    exists: () => library,
    readBinding: checkout => (checkout ? binding : null),
    readHubState: () => hub,
    git(cwd, args) { calls.push({ git: args, cwd }); return { stderr: '', error: null, ...(git ? git(args) : { status: 1, stdout: '' }) }; },
    gh(args) { calls.push({ gh: args }); return { stderr: '', error: null, ...(gh ? gh(args) : { status: 4, stdout: '', stderr: 'gh not stubbed' }) }; },
    stamp: { read: () => structuredClone(stamps), write: value => written.push(value) },
    now: () => NOW,
  };
  return { deps, calls, written };
}
const run = (argv, setup) => {
  const { deps, calls } = world(setup);
  let text = '';
  const code = main(argv, { ...deps, stdout: chunk => { text += chunk; }, stderr: chunk => { text += chunk; } });
  return { code, text, calls };
};
const ALL = ['--checkout', '/repo', '--instructions', 'i.md', '--memory', 'm.md', '--task', 'hourly-nudge=h.md'];

test('a clean run prints one line and exits 0', () => {
  const { code, text } = run(ALL);
  assert.equal(code, 0);
  assert.equal(text, 'CONTROLLER CHECK: clear (ok: guidebook instructions memory tasks programme traces stale ci footer refs; skipped: toolkit)\n');
});

test('checks are segregated by host and governance, and skip cleanly with the reason', () => {
  const chat = controllerCheck(parseArgs(ALL), world({ library: false }).deps);
  assert.equal(chat.host, 'chat');
  for (const name of ['guidebook', 'instructions', 'memory', 'tasks']) {
    assert.deepEqual(chat.checks.find(check => check.name === name), { name, state: 'skipped', lines: ['Claude Projects only'] });
  }
  assert.deepEqual(chat.checks.filter(check => check.state === 'ok').map(check => check.name), ['programme', 'traces', 'stale', 'ci', 'footer', 'refs']);
  const off = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: { ...GOVERNED, governance: 'disabled' } }).deps);
  assert.deepEqual(off.checks.filter(check => check.state === 'skipped').map(check => `${check.name}: ${check.lines[0]}`).slice(-3), ['programme: governance off', 'traces: governance off', 'stale: governance off']);
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
    'CONTROLLER CHECK: 1 need attention, 0 could not run (ok: guidebook instructions memory tasks traces stale ci footer refs; skipped: toolkit)',
    'ATTENTION programme: Attention: 6 new, 0 acknowledged (CLOSING_STORY 4, STALE_PR 2)',
    `  ${findings[0]}`, `  ${findings[1]}`, `  ${findings[2]}`,
    `  ... 3 more (--expand, or ${require('../scripts/toolkit-user-state.cjs').programmeCommand('attention')})`,
  ]);
  const expanded = run([...ALL, '--expand'], { results });
  for (const line of findings) assert.ok(expanded.text.includes(`  ${line}\n`));
  assert.match(expanded.text, /\nOK ci: 0 GAP, 1 CHECK/);
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
  for (const argv of [['--host', 'web'], ['--task', 'nightly=x.md'], ['--skip', 'nothing'], ['--repo', 'bad'], ['--since', 'soon'], ['--checkout'], ['--what']]) {
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
  assert.match(text, /^CONTROLLER CHECK: nothing ran \(skipped: toolkit guidebook instructions memory tasks programme traces stale ci footer refs\): pass the inputs each skipped check names/);
  // With no inputs at all only the Toolkit's own script-reference check runs, which is not a clear run.
  const bare = run(['--host', 'chat']);
  assert.equal(bare.code, 1);
  assert.match(bare.text, /^CONTROLLER CHECK: nothing ran \(ok: refs; skipped: toolkit guidebook instructions memory tasks programme traces stale ci footer\)/);
});

// The daily stale sweep, against a canned attention report and the parent's sub-issues.
const issue = (number, extra = {}) => ({ number, title: `Task ${number}`, state: 'open', body: 'Nearest child: #1, a different script', created_at: '2026-11-01T00:00:00Z', sub_issues_summary: { total: 0, completed: 0 }, ...extra });
const rowsBody = n => `# TASK\n\n### ROWS\n\n${Array.from({ length: n }, (_, i) => `- [ ] **P${i + 1}** fix it\n`).join('')}\n## DONE WHEN\n\n- [ ] Every row ticked.\n`;
function sweep({ findings = [], children = [], stamps = {}, attention = null, gh = null, waits = [] } = {}) {
  const results = { [SCRIPTS.programme]: attention || { status: 1, stdout: JSON.stringify({ line: 'Attention: 1 new', findings, owner_waits: waits }) } };
  const setup = world({ results, stamps, gh: gh || (() => ({ status: 0, stdout: children.map(child => JSON.stringify(child)).join('\n') })) });
  const report = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), setup.deps);
  return { check: report.checks.find(check => check.name === 'stale'), calls: setup.calls, written: setup.written };
}

test('the stale sweep lists children whose PRs merged for the controller to judge, and stamps the day with its list', () => {
  const findings = [{ state: 'new', code: 'TASK_MERGED_OPEN', issue: 12 }, { state: 'new', code: 'READY_TO_CLOSE', issue: 12 }, { state: 'new', code: 'READY_TO_CLOSE', issue: 13 }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 15 }, { state: 'new', code: 'STALE_PR', issue: 14 }];
  const { check, calls, written } = sweep({ findings, children: [issue(12), issue(13), issue(15)] });
  assert.equal(check.state, 'attention');
  const judge = 'PR merged: check its DONE WHEN before it goes to the owner';
  const rows = [`JUDGE? #12 ${judge} (READY_TO_CLOSE)`, `JUDGE? #13 ${judge} (READY_TO_CLOSE)`, `JUDGE? #15 ${judge} (TASK_MERGED_OPEN)`];
  assert.deepEqual(check.lines.slice(1), rows);
  assert.match(check.lines[0], /^3 rows \(\d{4}-\d{2}-\d{2}\): judge each JUDGE\? against its child's DONE WHEN/);
  // Read only: attention without --refresh, and one paginated sub-issue read of the parent.
  assert.deepEqual(calls.find(call => call.script === SCRIPTS.programme && call.args.includes('--json')).args, ['attention', '--json', '--repo-root', '/repo']);
  assert.deepEqual(calls.filter(call => call.gh).map(call => call.gh.slice(0, 3)), [['api', '--paginate', 'repos/acme/app/issues/7/sub_issues?per_page=100']]);
  const close = [`CLOSE LIST ${TODAY} (0 ready): post to the owner as its own message`, `add each JUDGE? you judge done as a row; if none remain and no rows above, post "Close list ${TODAY}: nothing to close today"`];
  assert.deepEqual(check.close, close);
  assert.deepEqual(written, [{ 'acme/app': { date: TODAY, at: NOW.toISOString(), rows, close } }]);
});

// The stale check never proposes live work: an acknowledged finding (the controller's own hold), an
// unchecked DONE WHEN row, an open sub-issue or a child it cannot read is held, not a JUDGE? row.
test('the stale sweep holds done findings whose child is still live and never lists them to close', () => {
  const doneWhen = '## DONE WHEN\n\n- [x] PR B lands\n- [ ] PR A lands\n\n## PLAN\n\n- [x] other\n';
  const children = [issue(30), issue(31), issue(32, { body: doneWhen }), issue(33, { sub_issues_summary: { total: 2, completed: 1 } }), issue(35, { state: 'closed' }), issue(36, { body: '## DONE WHEN\n\n- [x] all done\n' })];
  const findings = [
    { state: 'acknowledged', code: 'READY_TO_CLOSE', issue: 30, due: '2026-11-15T08:00:00Z', promised: 'Not closing: slice 2 unbuilt' },
    { state: 'acknowledged', code: 'TASK_MERGED_OPEN', issue: 31 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 32 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 33 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 34 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 35 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 36 },
  ];
  const { check } = sweep({ findings, children });
  assert.equal(check.lines.some(line => /^(CLOSE|JUDGE)\? #(30|31|32|33|34|35) /.test(line)), false, check.lines.join('\n'));
  assert.deepEqual(check.lines.slice(1), [
    'JUDGE? #36 PR merged: check its DONE WHEN before it goes to the owner (READY_TO_CLOSE)',
    'held, not proposed: #30 acknowledged, #32 1 unchecked DONE WHEN row(s), #33 1 open sub-issue(s), #34 not a sub-issue of a registered parent, #35 already closed, #31 acknowledged',
  ]);
  assert.match(check.lines[0], /^1 row \(/);
  // All held: nothing to put to the owner, and the held line still says why.
  const none = sweep({ findings: findings.slice(0, 2), children }).check;
  assert.equal(none.state, 'ok');
  assert.match(none.lines[0], /^no stale children .*; held, not proposed: #30 acknowledged, #31 acknowledged$/);
});

// Live-shaped children: most write DONE WHEN as plain text and keep their hold in the reconciler's
// `Kept open:` line or in an acknowledgement note that lapses after its due time (the finding turns
// `new` again, keeping its due and note). Neither may reach the owner as done, and no programme
// finding is ever called done: a merged PR is a JUDGE? row the controller checks against DONE WHEN.
const graph = (n, kept = '') => `<!-- programme-state child=${n}@45 -->\n<!-- Task status: IN PROGRESS -->\n# PR GRAPH\n\n| PR Task | PR # | Status | Merged SHA |\n|---|---|---|---|\n|\`Slice A\`|#1176|MERGED|[b2dde08](x)|\n${kept ? `\n${kept}\n` : ''}`;
const plainDoneWhen = '# TASK\n\n## DONE WHEN\n\n- A green scheduled cloud sweep is recorded first.\n- Setup makes no Windows task call.\n\n# PLAN\n\nSlices 0, A, B, C.\n\n';
const LIVE_SHAPED = [
  // #886 and #827: plain DONE WHEN bullets, held by the reconciler's Kept open line.
  issue(886, { body: `${plainDoneWhen}${graph(886, 'Kept open: Closes once child 1164 completes (since 2026-11-18 08:13Z)')}` }),
  issue(827, { body: `${plainDoneWhen}${graph(827, 'Kept open: Waits for the proof run; then close with the owner\'s OK. (since 2026-11-16 02:34Z)')}` }),
  // #473: a "Complete when" heading, held by Kept open.
  issue(473, { body: `# PATH\n\n${graph(473, 'Kept open: Lows moved to 1275; close 473 after 1275 lands (since 2026-11-18 09:22Z)')}\n# W1\n\n## Complete when\n\n- Source watch conforms.\n` }),
  // #1030: a prose Done when: paragraph, held only by the controller's lapsed acknowledgement note.
  issue(1030, { body: `# PATH\n\n${graph(1030)}\n# AGENT CONTEXT\n\nDone when: a train lands that member with the markers rebuilt, and tests cover both cases.\n` }),
  // #759: no DONE WHEN at all, held only by the lapsed note.
  issue(759, { body: `# PATH\n\n${graph(759)}\n# Toolkit 4.0\n\n## Folded jobs\n\n- several\n` }),
  // #893: checkbox DONE WHEN rows and Kept open.
  issue(893, { body: `# TASK\n\n## DONE WHEN\n\n- [ ] Slice 2 lands.\n- [x] Slice 1 lands.\n\n${graph(893, 'Kept open: Slice 2 unbuilt (since 2026-11-18 06:27Z)')}` }),
  // A child with nothing holding it: its merged PR is still only a judgement.
  issue(901, { body: `# TASK\n\n## DONE WHEN\n\n- Everything lands.\n\n${graph(901)}` }),
];
const LAPSED = { due: '2026-11-21T08:00:00Z', overdue: true };

test('red: a live-shaped child kept open or under a lapsed hold is never put to the owner as done', () => {
  const findings = [
    { state: 'new', code: 'READY_TO_CLOSE', issue: 886 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 827 },
    { state: 'new', code: 'TASK_MERGED_OPEN', issue: 473 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 1030, ...LAPSED, promised: 'Not closing: slice 2 unbuilt' },
    { state: 'new', code: 'TASK_MERGED_OPEN', issue: 759, ...LAPSED, promised: 'Plan the 4.0 slices' },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 893 },
    { state: 'new', code: 'READY_TO_CLOSE', issue: 901 },
  ];
  const { check } = sweep({ findings, children: LIVE_SHAPED });
  assert.equal(check.lines.slice(1).some(line => /^CLOSE\?|\bdone\b/.test(line) && !line.startsWith('held')), false, check.lines.join('\n'));
  assert.deepEqual(check.lines.slice(1), [
    'JUDGE? #901 PR merged: check its DONE WHEN before it goes to the owner (READY_TO_CLOSE)',
    'held, not proposed: #886 Kept open line, #827 Kept open line, #1030 hold lapsed at 2026-11-21T08:00:00Z (Not closing: slice 2 unbuilt), #893 Kept open line, #473 Kept open line, #759 hold lapsed at 2026-11-21T08:00:00Z (Plan the 4.0 slices)',
  ]);
  assert.match(check.lines[0], /^1 row \(\d{4}-\d{2}-\d{2}\): judge each JUDGE\? against its child's DONE WHEN, PR GRAPH and notes; only children judged done go on the owner's one approve list, with the other rows and obsolete children$/);
});

test('red: a Kept open line only counts at the start of a line', () => {
  const quoted = issue(902, { body: `# TASK\n\nSome children say Kept open: when the controller holds them.\n\n${graph(902)}` });
  const { check } = sweep({ findings: [{ state: 'new', code: 'READY_TO_CLOSE', issue: 902 }], children: [quoted] });
  assert.deepEqual(check.lines.slice(1), ['JUDGE? #902 PR merged: check its DONE WHEN before it goes to the owner (READY_TO_CLOSE)']);
});

test('a second run on the same day says so and reads nothing', () => {
  const { check, calls, written } = sweep({ stamps: { 'acme/app': { date: TODAY, at: '2026-11-14T01:00:00Z' } }, findings: [{ code: 'READY_TO_CLOSE', issue: 12 }] });
  assert.deepEqual(check, { name: 'stale', state: 'ok', lines: [`ran today (${TODAY})`] });
  assert.equal(calls.some(call => call.gh || (call.script === SCRIPTS.programme && call.args.includes('--json'))), false);
  assert.deepEqual(written, []);
  // Another repository's stamp, or yesterday's, does not count.
  assert.equal(sweep({ stamps: { 'acme/other': { date: TODAY, at: '2026-11-14T01:00:00Z' } } }).written.length, 1);
  assert.equal(sweep({ stamps: { 'acme/app': { date: '2026-11-13', at: '2026-11-13T01:00:00Z' } } }).written.length, 1);
});

test('compact output prints every stale row, and a same-day run shows the day\'s list again', () => {
  const children = Array.from({ length: 6 }, (_, i) => issue(50 + i, { body: 'No reason given', created_at: '2026-11-14T02:00:00Z' }));
  const results = { [SCRIPTS.programme]: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] }) } };
  const setup = world({ results, stamps: {}, gh: () => ({ status: 0, stdout: children.map(child => JSON.stringify(child)).join('\n') }) });
  let kept = {};
  setup.deps.stamp = { read: () => structuredClone(kept), write: value => { kept = value; } };
  const argv = ['--host', 'chat', '--checkout', '/repo', '--skip', 'toolkit,programme,traces,ci,footer,refs'];
  const first = format(controllerCheck(parseArgs(argv), setup.deps));
  const rows = children.map(child => `  FOLD? #${child.number} new under #7 with no Nearest child: line`);
  assert.deepEqual(first.split('\n').filter(line => line.startsWith('  ')), rows);
  assert.doesNotMatch(first, /more \(--expand/);
  const again = controllerCheck(parseArgs(argv), setup.deps).checks.find(check => check.name === 'stale');
  assert.equal(again.state, 'attention');
  assert.match(again.lines[0], /^6 rows \(\d{4}-\d{2}-\d{2}, swept at 2026-11-14T12:00:00.000Z, shown again\): judge each JUDGE\? /);
  assert.deepEqual(again.lines.slice(1), rows.map(row => row.trim()));
  assert.deepEqual(again.close, [`CLOSE LIST ${TODAY}: nothing to close today`], 'the stored close list comes back with the rows');
  assert.equal(setup.calls.filter(call => call.gh).length, 1);
});

test('a stamp that cannot be written fails the stale line only, keeping its rows', () => {
  const results = { [SCRIPTS.programme]: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] }) } };
  const setup = world({ results, stamps: {}, gh: () => ({ status: 0, stdout: JSON.stringify(issue(60, { body: 'none', created_at: '2026-11-14T02:00:00Z' })) }) });
  setup.deps.stamp = { read: () => ({}), write: () => { throw new Error('EACCES: permission denied'); } };
  const report = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), setup.deps);
  assert.deepEqual(report.checks.find(check => check.name === 'stale'), { name: 'stale', state: 'failed', lines: ['stamp not written (EACCES: permission denied); the next run sweeps again', 'FOLD? #60 new under #7 with no Nearest child: line'], close: [`CLOSE LIST ${TODAY}: nothing to close today`] });
  assert.equal(report.checks.find(check => check.name === 'ci').state, 'ok');
});

test('a child opened since the last sweep with no Nearest child: line is a fold candidate', () => {
  const stamps = { 'acme/app': { date: '2026-11-13', at: '2026-11-13T09:00:00Z' } };
  const children = [
    issue(20, { body: 'No reason given', created_at: '2026-11-14T02:00:00Z' }),
    issue(21, { created_at: '2026-11-14T02:00:00Z' }),
    issue(22, { body: 'Older than the last sweep', created_at: '2026-11-12T00:00:00Z' }),
    issue(23, { body: 'Closed', state: 'closed', created_at: '2026-11-14T02:00:00Z' }),
  ];
  const { check } = sweep({ stamps, children });
  assert.deepEqual(check.lines.slice(1), ['FOLD? #20 new under #7 with no Nearest child: line']);
});

test('a closed child holding open work is a move candidate', () => {
  const children = [issue(30, { state: 'closed', sub_issues_summary: { total: 3, completed: 1 } }), issue(31, { state: 'closed', sub_issues_summary: { total: 2, completed: 2 } })];
  assert.deepEqual(sweep({ children }).check.lines.slice(1), ['MOVE? #30 closed under #7 with 2 open sub-issue(s): move them to the parent so it detaches']);
});

test('the polish child is flagged full at 8 rows and over cap above 8 or when a second one is open', () => {
  const full = sweep({ children: [issue(40, { title: 'Polish 1: leftovers', body: rowsBody(8) })] }).check;
  assert.deepEqual(full.lines.slice(1), ['POLISH FULL #40: 8 rows (ROWS): ship it as one PR, then open a fresh one']);
  const over = sweep({ children: [issue(41, { title: 'Polish 2: more', body: rowsBody(9) }), issue(42, { title: 'polish 3', body: rowsBody(2) })] }).check;
  assert.deepEqual(over.lines.slice(1), ['POLISH OVER CAP: 2 open polish children (#41, #42); keep one', 'POLISH OVER CAP #41: 9 rows (ROWS), cap 8']);
  assert.deepEqual(sweep({ children: [issue(43, { title: 'Polish 4', body: rowsBody(7) }), issue(44, { title: 'Polishing the docs', body: rowsBody(9) })] }).check.lines,
    [`no stale children (${TODAY}, 2 children read)`]);
  // Rows are counted under ROWS, else DONE WHEN, and the count says which.
  assert.deepEqual(polishRows(rowsBody(3)), { rows: 3, under: 'ROWS' });
  assert.deepEqual(polishRows('## DONE WHEN\n\n- [x] one\n- [ ] two\n\n# PLAN\n\n- [ ] not a row\n'), { rows: 2, under: 'DONE WHEN' });
  assert.deepEqual(polishRows('Just text'), { rows: 0, under: 'no ROWS or DONE WHEN heading' });
});

test('a sweep that cannot read programme attention or the sub-issues fails and writes no stamp', () => {
  const unknown = sweep({ attention: { status: 1, stdout: JSON.stringify({ line: 'Attention: unknown (gh not signed in)', reason: 'gh not signed in' }) } });
  assert.deepEqual(unknown.check, { name: 'stale', state: 'failed', lines: ['programme attention: Attention: unknown (gh not signed in); no stamp written'] });
  assert.deepEqual(unknown.written, []);
  const ghDown = sweep({ gh: () => ({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials\n' }) });
  assert.deepEqual(ghDown.check, { name: 'stale', state: 'failed', lines: ['#7 sub-issues: HTTP 401: Bad credentials; no stamp written'] });
  assert.deepEqual(ghDown.written, []);
  assert.equal(sweep({ gh: () => ({ status: 0, stdout: 'not json\n' }) }).written.length, 0);
});

test('the stale sweep runs only with governance on and a repository, and --skip stale leaves it out', () => {
  const off = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: { ...GOVERNED, governance: 'disabled' } }).deps);
  assert.deepEqual(off.checks.find(check => check.name === 'stale').lines, ['governance off']);
  const norepo = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: { governance: 'enabled', parents: [] } }).deps);
  assert.deepEqual(norepo.checks.find(check => check.name === 'stale').lines, ['pass --repo <owner/name>']);
  const skipped = run(['--host', 'chat', '--checkout', '/repo', '--skip', 'stale']);
  assert.equal(skipped.calls.some(call => call.gh), false);
  assert.equal(parseArgs(['--stale-stamp', '/tmp/s.json']).staleStamp, '/tmp/s.json');
});

// The daily close list: owner-only holds (a merged PR whose only owed step is the owner's UAT after
// the agent's UAT PASSED there) reach the owner as one ready-to-post block, every run, empty days too.
const SHA = 'a'.repeat(40);
test('red: a held child that waits only on the owner after an agent UAT PASS reaches the close list', () => {
  const ticked = '## DONE WHEN\n\n- [x] PR lands\n';
  const children = [issue(40, { body: ticked }), issue(41, { body: ticked }), issue(42, { body: `${ticked}\nKept open: slice 2 (since 2026-11-18 06:27Z)\n` })];
  const findings = [40, 41, 42].map(n => ({ state: 'acknowledged', code: 'READY_TO_CLOSE', issue: n }));
  const waits = [
    { issue: 40, ask: 'UAT on PR #900', after: null, agent_uat: 'PASSED', pr: 900, head: SHA },
    { issue: 41, ask: 'UAT on PR #901', after: null, agent_uat: 'OWNER_ONLY', pr: 901, head: SHA },
    { issue: 42, ask: 'UAT on PR #902', after: null, agent_uat: 'PASSED', pr: 902, head: SHA },
  ];
  const { check, written } = sweep({ findings, children, waits });
  assert.deepEqual(check.close, [
    `CLOSE LIST ${TODAY} (1 ready): post to the owner as its own message`,
    '- #40 Task 40: PR #900 merged, agent UAT PASSED at aaaaaaa; reply ok to close',
  ]);
  assert.match(check.lines.at(-1), /^held, not proposed: #41 acknowledged, #42 acknowledged$/);
  assert.deepEqual(written[0]['acme/app'].close, check.close);
  assert.equal(check.state, 'attention', 'a ready row needs the owner, so the check is never clear');
  const again = sweep({ stamps: written[0] }).check;
  assert.deepEqual([again.state, again.close], ['attention', check.close], 'a same-day rerun shows the ready list again');
  // An unticked DONE WHEN row or an acknowledgement note makes it a judgement, never a silent hold.
  const unsure = sweep({ findings: [{ state: 'acknowledged', code: 'READY_TO_CLOSE', issue: 43, promised: 'Not closing: slice 2 unbuilt' }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 44 }],
    children: [issue(43, { body: ticked }), issue(44, { body: '## DONE WHEN\n\n- [ ] Slice 2 lands\n' })],
    waits: [{ issue: 43, ask: 'UAT on PR #903', after: null, agent_uat: 'PASSED', pr: 903, head: SHA }, { issue: 44, ask: 'UAT on PR #904', after: null, agent_uat: 'PASSED', pr: 904, head: SHA }] }).check;
  assert.deepEqual(unsure.lines.slice(1), [
    'JUDGE? #43 owner-only hold: agent UAT PASSED, but ack note (Not closing: slice 2 unbuilt); judge it done before it goes on the close list (READY_TO_CLOSE)',
    'JUDGE? #44 owner-only hold: agent UAT PASSED, but 1 unchecked DONE WHEN row(s); judge it done before it goes on the close list (TASK_MERGED_OPEN)',
  ]);
  assert.deepEqual(unsure.close, [
    `CLOSE LIST ${TODAY} (0 ready): post to the owner as its own message`,
    `add each JUDGE? you judge done as a row; if none remain and no rows above, post "Close list ${TODAY}: nothing to close today"`,
  ]);
});

test('red: an empty day still prints its close list, and an unknown owner-wait list fails instead', () => {
  const results = { [SCRIPTS.programme]: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] }) } };
  const setup = world({ results, stamps: {}, gh: () => ({ status: 0, stdout: JSON.stringify(issue(70)) }) });
  let kept = {};
  setup.deps.stamp = { read: () => structuredClone(kept), write: value => { kept = value; } };
  const argv = ['--host', 'chat', '--checkout', '/repo', '--skip', 'toolkit,programme,traces,ci,footer,refs'];
  const report = controllerCheck(parseArgs(argv), setup.deps);
  const check = report.checks.find(item => item.name === 'stale');
  assert.equal(check.state, 'ok');
  assert.deepEqual(check.close, [`CLOSE LIST ${TODAY}: nothing to close today`]);
  assert.deepEqual(kept['acme/app'].close, check.close);
  assert.match(format(report), new RegExp(`^CLOSE LIST ${TODAY}: nothing to close today$`, 'm'), 'compact output prints it although the check is ok');
  // A same-day rerun shows the stored list again.
  const again = controllerCheck(parseArgs(argv), setup.deps);
  assert.deepEqual(again.checks.find(item => item.name === 'stale').close, check.close);
  assert.match(format(again), /nothing to close today/);
  // A failed owner-wait read never reads as an empty day.
  const unknown = sweep({ attention: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: null, owner_waits_unknown: 'STATE_INVALID' }) }, children: [issue(70)] });
  assert.deepEqual(unknown.check, { name: 'stale', state: 'failed', lines: ['owner waits unknown (STATE_INVALID); no stamp written'] });
  assert.deepEqual(unknown.written, []);
});
