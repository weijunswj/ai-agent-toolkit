'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseArgs, controllerCheck, format, main, polishRows, rowTicks, SCRIPTS, staleOnlySkip } = require('../scripts/toolkit-controller-check.cjs');

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
  [SCRIPTS.handoff]: { status: 0, stdout: 'HANDOFF CURRENT folder=evidence/handoff/acme/app\n' },
};

const NOW = new Date('2026-11-14T12:00:00Z');
// The local date the stale check stamps, whatever time zone the tests run in.
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;
// By default the stale check already ran today for every repository the tests use.
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
    // The stamp is per repository: read and write name it; tests keep them keyed by repository.
    stamp: { read: repo => structuredClone(stamps)[repo] ?? null, write: (repo, record) => written.push({ [repo]: record }) },
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
const ALL = ['--checkout', '/repo', '--instructions', 'i.md', '--memory', 'm.md', '--task', 'hourly-nudge=h.md', '--handoff', '/store'];

test('a clean run prints one line and exits 0', () => {
  const { code, text } = run(ALL);
  assert.equal(code, 0);
  assert.equal(text, 'CONTROLLER CHECK: clear (ok: guidebook instructions memory tasks handoff programme traces stale ci footer refs; skipped: toolkit)\n');
});

test('checks are segregated by host and governance, and skip cleanly with the reason', () => {
  const chat = controllerCheck(parseArgs(ALL), world({ library: false }).deps);
  assert.equal(chat.host, 'chat');
  for (const name of ['guidebook', 'instructions', 'memory', 'tasks']) {
    assert.deepEqual(chat.checks.find(check => check.name === name), { name, state: 'skipped', lines: ['Claude Projects only'] });
  }
  assert.deepEqual(chat.checks.filter(check => check.state === 'ok').map(check => check.name), ['handoff', 'programme', 'traces', 'stale', 'ci', 'footer', 'refs']);
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
    'CONTROLLER CHECK: 1 need attention, 0 could not run (ok: guidebook instructions memory tasks handoff traces stale ci footer refs; skipped: toolkit)',
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

test('a handoff check that stops says why on its row', () => {
  const stopped = 'Stopped: the snapshot folder could not be read. Next: check the store checkout, then run this again.';
  const { code, text } = run(ALL, { results: { [SCRIPTS.handoff]: { status: 1, stdout: '', stderr: `${stopped}\n` } } });
  assert.equal(code, 1);
  assert.ok(text.includes(`ATTENTION handoff: ${stopped}`), text);
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
  assert.equal(report.checks.length, 12);
  assert.equal(format(report).split('\n')[0].startsWith('CONTROLLER CHECK: clear'), true);
});

test('a run where every check is skipped says nothing ran and exits 1, never clear', () => {
  const { code, text } = run(['--host', 'chat', '--skip', 'refs']);
  assert.equal(code, 1);
  assert.match(text, /^CONTROLLER CHECK: nothing ran \(skipped: toolkit guidebook instructions memory tasks handoff programme traces stale ci footer refs\): pass the inputs each skipped check names/);
  // With no inputs at all only the Toolkit's own script-reference check runs, which is not a clear run.
  const bare = run(['--host', 'chat']);
  assert.equal(bare.code, 1);
  assert.match(bare.text, /^CONTROLLER CHECK: nothing ran \(ok: refs; skipped: toolkit guidebook instructions memory tasks handoff programme traces stale ci footer\)/);
});

// The stale check, against a canned attention report and the parent's sub-issues.
const issue = (number, extra = {}) => ({ number, title: `Task ${number}`, state: 'open', body: 'Nearest child: #1, a different script', created_at: '2026-11-01T00:00:00Z', sub_issues_summary: { total: 0, completed: 0 }, ...extra });
const rowsBody = n => `# TASK\n\n### ROWS\n\n${Array.from({ length: n }, (_, i) => `- [ ] **P${i + 1}** fix it\n`).join('')}\n## DONE WHEN\n\n- [ ] Every row ticked.\n`;
function sweep({ findings = [], children = [], stamps = {}, attention = null, gh = null, waits = [] } = {}) {
  const results = { [SCRIPTS.programme]: attention || { status: 1, stdout: JSON.stringify({ line: 'Attention: 1 new', findings, owner_waits: waits }) } };
  const setup = world({ results, stamps, gh: gh || (() => ({ status: 0, stdout: children.map(child => JSON.stringify(child)).join('\n') })) });
  const report = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), setup.deps);
  return { check: report.checks.find(check => check.name === 'stale'), calls: setup.calls, written: setup.written };
}

test('the stale check lists children whose PRs merged for the controller to judge, and stamps the day with its rows', () => {
  const findings = [{ state: 'new', code: 'TASK_MERGED_OPEN', issue: 12 }, { state: 'new', code: 'READY_TO_CLOSE', issue: 12 }, { state: 'new', code: 'READY_TO_CLOSE', issue: 13 }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 15 }, { state: 'new', code: 'STALE_PR', issue: 14 }];
  const { check, calls, written } = sweep({ findings, children: [issue(12), issue(13), issue(15)] });
  assert.equal(check.state, 'attention');
  const judge = 'PR merged: check its DONE WHEN, then close it yourself or keep it open';
  const rows = [`JUDGE? #12 ${judge} (READY_TO_CLOSE)`, `JUDGE? #13 ${judge} (READY_TO_CLOSE)`, `JUDGE? #15 ${judge} (TASK_MERGED_OPEN)`];
  assert.deepEqual(check.lines.slice(1), rows);
  assert.match(check.lines[0], /^3 rows \(\d{4}-\d{2}-\d{2}\): judge each JUDGE\? against its child's DONE WHEN/);
  // Read only: attention without --refresh, and one paginated sub-issue read of the parent.
  assert.deepEqual(calls.find(call => call.script === SCRIPTS.programme && call.args.includes('--json')).args, ['attention', '--json', '--repo-root', '/repo']);
  assert.deepEqual(calls.filter(call => call.gh).map(call => call.gh.slice(0, 3)), [['api', '--paginate', 'repos/acme/app/issues/7/sub_issues?per_page=100']]);
  // No owner list: the rows are the controller's, and the stamp holds only the day's rows.
  assert.equal('close' in check, false);
  assert.deepEqual(written, [{ 'acme/app': { date: TODAY, at: NOW.toISOString(), rows } }]);
});

// The stale check never proposes live work: an acknowledged finding (the controller's own hold), an
// unchecked DONE WHEN row, an open sub-issue or a child it cannot read is held, not a JUDGE? row.
test('the stale check holds done findings whose child is still live and never lists them to close', () => {
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
    'JUDGE? #36 PR merged: check its DONE WHEN, then close it yourself or keep it open (READY_TO_CLOSE)',
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
    'JUDGE? #901 PR merged: check its DONE WHEN, then close it yourself or keep it open (READY_TO_CLOSE)',
    'held, not proposed: #886 Kept open line, #827 Kept open line, #1030 hold lapsed at 2026-11-21T08:00:00Z (Not closing: slice 2 unbuilt), #893 Kept open line, #473 Kept open line, #759 hold lapsed at 2026-11-21T08:00:00Z (Plan the 4.0 slices)',
  ]);
  assert.match(check.lines[0], /^1 row \(\d{4}-\d{2}-\d{2}\): judge each JUDGE\? against its child's DONE WHEN, PR GRAPH and notes, and close each child you judge done yourself with a closing comment; put each OWNER OK\? row, each FOLD\? \(a duplicate\) and any child you judge obsolete in your next ask to the owner; MOVE\?, KEPT OPEN\?, UNTICKED\? and POLISH rows are yours$/);
});

test('red: a Kept open line only counts at the start of a line', () => {
  const quoted = issue(902, { body: `# TASK\n\nSome children say Kept open: when the controller holds them.\n\n${graph(902)}` });
  const { check } = sweep({ findings: [{ state: 'new', code: 'READY_TO_CLOSE', issue: 902 }], children: [quoted] });
  assert.deepEqual(check.lines.slice(1), ['JUDGE? #902 PR merged: check its DONE WHEN, then close it yourself or keep it open (READY_TO_CLOSE)']);
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

test('compact output prints every stale row, and a same-day run shows the day\'s rows again', () => {
  const children = Array.from({ length: 6 }, (_, i) => issue(50 + i, { body: 'No reason given', created_at: '2026-11-14T02:00:00Z' }));
  const results = { [SCRIPTS.programme]: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] }) } };
  const setup = world({ results, stamps: {}, gh: () => ({ status: 0, stdout: children.map(child => JSON.stringify(child)).join('\n') }) });
  let kept = {};
  setup.deps.stamp = { read: repo => structuredClone(kept)[repo] ?? null, write: (repo, record) => { kept = { ...kept, [repo]: record }; } };
  const argv = ['--host', 'chat', '--checkout', '/repo', '--skip', 'toolkit,programme,traces,ci,footer,refs'];
  const first = format(controllerCheck(parseArgs(argv), setup.deps));
  const rows = children.map(child => `  FOLD? #${child.number} new under #7 with no Nearest child: line`);
  assert.deepEqual(first.split('\n').filter(line => line.startsWith('  ')), rows);
  assert.doesNotMatch(first, /more \(--expand/);
  const again = controllerCheck(parseArgs(argv), setup.deps).checks.find(check => check.name === 'stale');
  assert.equal(again.state, 'attention');
  assert.match(again.lines[0], /^6 rows \(\d{4}-\d{2}-\d{2}, swept at 2026-11-14T12:00:00.000Z, shown again\): judge each JUDGE\? /);
  assert.deepEqual(again.lines.slice(1), rows.map(row => row.trim()));
  assert.equal('close' in again, false, 'no close list comes back');
  assert.equal(setup.calls.filter(call => call.gh).length, 1);
});

test('a stamp that cannot be written fails the stale line only, keeping its rows', () => {
  const results = { [SCRIPTS.programme]: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] }) } };
  const setup = world({ results, stamps: {}, gh: () => ({ status: 0, stdout: JSON.stringify(issue(60, { body: 'none', created_at: '2026-11-14T02:00:00Z' })) }) });
  setup.deps.stamp = { read: () => null, write: () => { throw new Error('EACCES: permission denied'); } };
  const report = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), setup.deps);
  assert.deepEqual(report.checks.find(check => check.name === 'stale'), { name: 'stale', state: 'failed', lines: ['stamp not written (EACCES: permission denied); the next run sweeps again', 'FOLD? #60 new under #7 with no Nearest child: line'] });
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

// A check that keeps failing is never silent: a failed read stamps no date (the next start retries) but
// records which read failed, as a fixed word with no gh text, for the session-start line; the next good
// run clears it.
test('red: a stale check that cannot read attention, owner waits or the sub-issues records which read failed and keeps the last date', () => {
  const yesterday = { 'acme/app': { date: '2026-11-13', at: '2026-11-13T01:00:00Z', rows: ['FOLD? #9 new under #7 with no Nearest child: line'] } };
  const unknown = sweep({ stamps: yesterday, attention: { status: 1, stdout: JSON.stringify({ line: 'Attention: unknown (gh not signed in)', reason: 'gh not signed in' }) } });
  assert.deepEqual(unknown.check, { name: 'stale', state: 'failed', lines: ['programme attention: Attention: unknown (gh not signed in); no date stamped, so the next run checks again'] });
  assert.deepEqual(unknown.written, [{ 'acme/app': { ...yesterday['acme/app'], failed: { at: NOW.toISOString(), check: 'attention' } } }]);
  const ghDown = sweep({ stamps: {}, gh: () => ({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials\n' }) });
  assert.deepEqual(ghDown.check, { name: 'stale', state: 'failed', lines: ['#7 sub-issues: HTTP 401: Bad credentials; no date stamped, so the next run checks again'] });
  assert.deepEqual(ghDown.written, [{ 'acme/app': { failed: { at: NOW.toISOString(), check: 'sub-issues' } } }]);
  assert.doesNotMatch(JSON.stringify(ghDown.written), /401|Bad credentials/, 'no gh text is stored');
  assert.deepEqual(sweep({ stamps: {}, gh: () => ({ status: 0, stdout: 'not json\n' }) }).written, [{ 'acme/app': { failed: { at: NOW.toISOString(), check: 'sub-issues' } } }]);
  const waits = sweep({ stamps: {}, attention: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: null, owner_waits_unknown: 'STATE_INVALID' }) } });
  assert.deepEqual(waits.written, [{ 'acme/app': { failed: { at: NOW.toISOString(), check: 'owner-waits' } } }]);
  // The next good run writes the day's stamp without the failure.
  const good = sweep({ stamps: { 'acme/app': { failed: { at: '2026-11-14T01:00:00Z', check: 'attention' } } } });
  assert.deepEqual(good.written, [{ 'acme/app': { date: TODAY, at: NOW.toISOString(), rows: [] } }]);
});

// Two governed repositories on one computer: a run reads its stamp before its GitHub reads and writes it
// after them, so with one shared file the run that finished second dropped the other repository's day.
// Real stamp files in a scratch home: each repository keeps its own day, and a second run reads nothing.
test('red: two repositories whose stale checks overlap each keep their own stamp', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-overlap-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const attention = JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] });
  const child = JSON.stringify(issue(60, { body: 'none', created_at: '2026-11-14T02:00:00Z' }));
  // `during` runs inside the sub-issue read, between this run's stamp read and its stamp write.
  const runFor = (repository, during = () => {}) => {
    const deps = {
      run: () => ({ status: 0, stdout: attention, stderr: '', error: null }),
      exists: () => true,
      readBinding: () => ({ repository, governance: 'enabled', parents: [{ issue: 7 }] }),
      readHubState: () => null,
      gh: () => { during(); return { status: 0, stdout: child, stderr: '', error: null }; },
      now: () => NOW,
    };
    return controllerCheck(parseArgs(['--host', 'chat', '--checkout', `/${repository}`, '--skip', staleOnlySkip]), deps).checks.find(check => check.name === 'stale');
  };
  const alpha = runFor('acme/alpha', () => assert.equal(runFor('acme/beta').state, 'attention', 'beta ran inside alpha\'s run'));
  assert.equal(alpha.state, 'attention');
  for (const repository of ['acme/alpha', 'acme/beta']) {
    let read = false;
    const again = runFor(repository, () => { read = true; });
    assert.equal(read, false, `${repository} kept its stamp, so it reads nothing again today`);
    assert.match(again.lines[0], /^1 row \(\d{4}-\d{2}-\d{2}, swept at [^)]+, shown again\)/, repository);
  }
});

test('the stale check runs only with governance on and a repository, and --skip stale leaves it out', () => {
  const off = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: { ...GOVERNED, governance: 'disabled' } }).deps);
  assert.deepEqual(off.checks.find(check => check.name === 'stale').lines, ['governance off']);
  const norepo = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo']), world({ binding: { governance: 'enabled', parents: [] } }).deps);
  assert.deepEqual(norepo.checks.find(check => check.name === 'stale').lines, ['pass --repo <owner/name>']);
  const skipped = run(['--host', 'chat', '--checkout', '/repo', '--skip', 'stale']);
  assert.equal(skipped.calls.some(call => call.gh), false);
});

// Owner-OK closes: a merged PR whose only owed step is the owner's UAT after the agent's UAT PASSED
// there, with no gate live on the task. It is a row for the controller, who puts it in its next ask to
// the owner; the stale check never posts to the owner itself. Acknowledged findings always carry the
// controller's note (`ack` needs one, with its due), so the row shows it rather than holding the child.
const SHA = 'a'.repeat(40);
const TRAIN = 'b'.repeat(40);
const ACK = { state: 'acknowledged', code: 'READY_TO_CLOSE', due: '2026-11-22T08:00:00Z', overdue: false, promised: 'Owner UAT owed; close on the owner\'s OK' };
const passedWait = (issue, extra = {}) => ({ issue, ask: `UAT at ${TRAIN.slice(0, 7)}`, after: null, agent_uat: 'PASSED', uat_head: TRAIN, pr_state: 'MERGED', gate_live: false, pr: 900 + issue, head: SHA, ...extra });
const TICKED = '## DONE WHEN\n\n- [x] PR lands\n';
const JUDGED = n => `JUDGE? #${n} PR merged: check its DONE WHEN, then close it yourself or keep it open (READY_TO_CLOSE)`;

test('red: an owner-only hold is an OWNER OK? row for the controller\'s next ask, and no close list is returned, stamped or printed', () => {
  const children = [issue(40, { body: TICKED }), issue(41, { body: TICKED }), issue(42, { body: `${TICKED}\nKept open: slice 2 (since 2026-11-18 06:27Z)\n` }), issue(45, { body: TICKED })];
  const findings = [40, 41, 42].map(n => ({ ...ACK, issue: n })).concat({ state: 'new', code: 'READY_TO_CLOSE', issue: 45 });
  const waits = [passedWait(40), passedWait(41, { agent_uat: 'OWNER_ONLY' }), passedWait(42), passedWait(45, { after: 'G2', gate_live: true })];
  const { check, written } = sweep({ findings, children, waits });
  // The row names the head the agent's UAT ran at (a train merge here), never the PR head. OWNER_ONLY
  // and Kept open stay held; a wait behind a gate still at work keeps the judged path.
  assert.deepEqual(check.lines.slice(1), [
    'OWNER OK? #40 Task 40: PR #940 merged, agent UAT PASSED at bbbbbbb; controller note: Owner UAT owed; close on the owner\'s OK; put "reply ok to close" in your next ask to the owner',
    JUDGED(45),
    'held, not proposed: #41 acknowledged, #42 acknowledged',
  ]);
  assert.equal(check.state, 'attention', 'an owner-OK row needs the controller, so the check is never clear');
  assert.match(check.lines[0], /^2 rows \(/);
  assert.equal('close' in check, false);
  assert.deepEqual(Object.keys(written[0]['acme/app']).sort(), ['at', 'date', 'held', 'rows']);
  const printed = format({ checks: [check], attention: 1, failed: 0, skipped: 0 });
  assert.doesNotMatch(printed, /CLOSE LIST|post (?:it )?to the owner|as its own message|nothing to close/);
  // A same-day rerun shows the rows again, with no read.
  const again = sweep({ stamps: written[0] }).check;
  assert.equal(again.state, 'attention');
  assert.deepEqual(again.lines.slice(1), check.lines.slice(1));
  // An unticked DONE WHEN row, or no DONE WHEN heading at all, makes it a judgement, never a silent hold.
  const unsure = sweep({ findings: [{ ...ACK, issue: 43 }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 44 }],
    children: [issue(43, { body: '## DONE WHEN\n\n- [ ] Slice 2 lands\n' }), issue(44, { body: 'Nearest child: #1, a different script' })],
    waits: [passedWait(43), passedWait(44)] }).check;
  assert.deepEqual(unsure.lines.slice(1), [
    'JUDGE? #43 owner-only hold: agent UAT PASSED, but 1 unchecked DONE WHEN row(s); judge it done before you ask the owner (READY_TO_CLOSE)',
    'JUDGE? #44 owner-only hold: agent UAT PASSED, but no DONE WHEN heading; judge it done before you ask the owner (TASK_MERGED_OPEN)',
  ]);
  // A PR not shown merged is named without "merged".
  const open = sweep({ findings: [{ ...ACK, issue: 46 }], children: [issue(46, { body: TICKED })], waits: [passedWait(46, { pr_state: 'CLOSED' })] }).check;
  assert.equal(open.lines[1], 'OWNER OK? #46 Task 46: PR #946, agent UAT PASSED at bbbbbbb; controller note: Owner UAT owed; close on the owner\'s OK; put "reply ok to close" in your next ask to the owner');
});

// The two live-gate cases ownerStep's `after` misses: a gate at work on a task waiting on the owner (its
// wait has after: null) and a blocked live gate. Each keeps the judged path, and so does a report too old
// to carry gate_live.
for (const [name, extra] of [
  ['a gate at work on a task waiting on the owner', { after: null, gate_live: true }],
  ['a blocked live gate', { after: null, gate_live: true }],
  ['an attention report with no gate_live field', { gate_live: undefined }],
]) test(`red: ${name} gives a JUDGE? row, never an owner-OK close`, () => {
  const { check } = sweep({ findings: [{ state: 'new', code: 'READY_TO_CLOSE', issue: 47 }], children: [issue(47, { body: TICKED })], waits: [passedWait(47, extra)] });
  assert.deepEqual(check.lines.slice(1), [JUDGED(47)]);
  assert.doesNotMatch(check.lines.slice(1).join('\n'), /OWNER OK\?|reply ok to close/);
});

test('a same-day stamp shows its held line again, after its rows or on the ok line, and reads nothing', () => {
  const stamped = { 'acme/app': { date: TODAY, at: '2026-11-14T01:00:00Z', rows: [JUDGED(48)], held: 'held, not proposed: #49 acknowledged' } };
  const { check, calls, written } = sweep({ stamps: stamped });
  assert.deepEqual(check.lines.slice(1), [JUDGED(48), 'held, not proposed: #49 acknowledged']);
  assert.equal(calls.some(call => call.gh), false);
  assert.deepEqual(written, []);
  const quiet = sweep({ stamps: { 'acme/app': { date: TODAY, at: '2026-11-14T01:00:00Z', rows: [], held: 'held, not proposed: #49 acknowledged' } } }).check;
  assert.deepEqual(quiet, { name: 'stale', state: 'ok', lines: [`ran today (${TODAY}); held, not proposed: #49 acknowledged`] });
});

test('red: an empty day is a clear stale check with no line for the owner, and an unknown owner-wait list fails instead', () => {
  const results = { [SCRIPTS.programme]: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: [] }) } };
  const setup = world({ results, stamps: {}, gh: () => ({ status: 0, stdout: JSON.stringify(issue(70)) }) });
  let kept = {};
  setup.deps.stamp = { read: repo => structuredClone(kept)[repo] ?? null, write: (repo, record) => { kept = { ...kept, [repo]: record }; } };
  const argv = ['--host', 'chat', '--checkout', '/repo', '--skip', 'toolkit,programme,traces,ci,footer,refs'];
  const report = controllerCheck(parseArgs(argv), setup.deps);
  const check = report.checks.find(item => item.name === 'stale');
  assert.deepEqual(check, { name: 'stale', state: 'ok', lines: [`no stale children (${TODAY}, 1 children read)`] });
  assert.deepEqual(kept['acme/app'], { date: TODAY, at: NOW.toISOString(), rows: [] });
  assert.doesNotMatch(format(report), /CLOSE LIST|nothing to close/);
  // A failed owner-wait read never reads as an empty day.
  const unknown = sweep({ attention: { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', findings: [], owner_waits: null, owner_waits_unknown: 'STATE_INVALID' }) }, children: [issue(70)] });
  assert.deepEqual(unknown.check, { name: 'stale', state: 'failed', lines: ['owner waits unknown (STATE_INVALID); no date stamped, so the next run checks again'] });
});

// A kept-open child that stalls, and a merged PR whose rows stay unticked. Pages are drawn with the
// sweep's own renderer, so the reader is tested against the STATE block and Kept open line it writes.
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const COMMIT = 'c'.repeat(40);
function statePage(issueNumber, { prs = [{ number: 900, state: 'MERGED', merge_sha: COMMIT }], keptAt = null, keptReason = 'Slice 2 still to come' } = {}) {
  const finished = prs.filter(pr => ['MERGED', 'CLOSED'].includes(pr.state)).map(pr => pr.number);
  const child = { issue: issueNumber, revision: 3, repository: 'acme/app', lifecycle: 'ACTIVE', pr: prs[0] || null, prs, gate: null, uat: null,
    private: keptAt ? { keep_open: { reason: keptReason, at: keptAt, covers: finished } } : {} };
  return programmeState.renderBlock(programmeState.renderChildBlockBody(child, { issue: issueNumber, class: 'COMMITTED', order: 1 }), '3.165.0');
}
const page = (issueNumber, rows, options) => `# TASK\n\n## DONE WHEN\n\n${rows}\n\n# PLAN\n\nNow.\n\n${statePage(issueNumber, options)}\n`;
const ALL_TICKED = '- [x] Slice 1 lands.';
const KEPT_ROW = (n, since) => `KEPT OPEN? #${n} kept open${since ? ` since ${since}` : ''} with every PR merged, and no lane has worked it for over 6 hours: hand its next slice to a lane, close it if it is done, or dispose of the finding with a reason (TASK_MERGED_OPEN)`;

test('the sweep draws the Kept open line the stale check reads, with its since time', () => {
  assert.match(page(40, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }), /^Kept open: Slice 2 still to come \(since 2026-11-13 08:00Z\)$/m);
  assert.equal(programmeState.KEPT_OPEN_IDLE_HOURS, 6);
});

// The kept-open closure matrix on the stale check side: a new TASK_MERGED_OPEN on a child whose page
// still shows its Kept open line is the sweep's kept-open stall, a row; anything else keeps the old path.
const KEPT_STALE_MATRIX = [
  ['new TASK_MERGED_OPEN, kept open a day ago: a row', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 40 }, issue(40, { body: page(40, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }) }), { row: KEPT_ROW(40, '2026-11-13 08:00Z') }],
  ['new TASK_MERGED_OPEN, kept open 3 hours ago (the sweep settles it next pass): held', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 41 }, issue(41, { body: page(41, ALL_TICKED, { keptAt: '2026-11-14T09:00:00.000Z' }) }), { held: '#41 Kept open line' }],
  ['new TASK_MERGED_OPEN, Kept open line with no readable since: a row', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 42 }, issue(42, { body: `${page(42, ALL_TICKED)}\nKept open: written by hand\n` }), { row: KEPT_ROW(42, null) }],
  ['new TASK_MERGED_OPEN, kept open with unchecked rows (its next slice): still a row', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 43 }, issue(43, { body: page(43, '- [x] Slice 1 lands.\n- [ ] Slice 2 lands.', { keptAt: '2026-11-12T08:00:00.000Z' }) }), { row: KEPT_ROW(43, '2026-11-12 08:00Z') }],
  ['new READY_TO_CLOSE on a kept-open child: held (not a stall code)', { state: 'new', code: 'READY_TO_CLOSE', issue: 44 }, issue(44, { body: page(44, ALL_TICKED, { keptAt: '2026-11-12T08:00:00.000Z' }) }), { held: '#44 Kept open line' }],
  ['acknowledged TASK_MERGED_OPEN on a kept-open child: held', { state: 'acknowledged', code: 'TASK_MERGED_OPEN', issue: 45 }, issue(45, { body: page(45, ALL_TICKED, { keptAt: '2026-11-12T08:00:00.000Z' }) }), { held: '#45 acknowledged' }],
  ['lapsed hold on a kept-open child: held with its note', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 46, ...LAPSED, promised: 'Plan slice 2' }, issue(46, { body: page(46, ALL_TICKED, { keptAt: '2026-11-12T08:00:00.000Z' }) }), { held: '#46 hold lapsed at 2026-11-21T08:00:00Z (Plan slice 2)' }],
  ['closed kept-open child: held', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 47 }, issue(47, { state: 'closed', body: page(47, ALL_TICKED, { keptAt: '2026-11-12T08:00:00.000Z' }) }), { held: '#47 already closed' }],
  ['not kept open, every row ticked: JUDGE? (control)', { state: 'new', code: 'TASK_MERGED_OPEN', issue: 48 }, issue(48, { body: page(48, ALL_TICKED) }), { row: 'JUDGE? #48 PR merged: check its DONE WHEN, then close it yourself or keep it open (TASK_MERGED_OPEN)' }],
  // Two findings on one child: a READY_TO_CLOSE in any state never hides the kept-open stall beside it.
  ['new READY_TO_CLOSE beside a new kept-open TASK_MERGED_OPEN: a row', [{ state: 'new', code: 'READY_TO_CLOSE', issue: 49 }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 49 }], issue(49, { body: page(49, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }) }), { row: KEPT_ROW(49, '2026-11-13 08:00Z') }],
  ['acknowledged READY_TO_CLOSE beside a new kept-open TASK_MERGED_OPEN: a row', [{ state: 'acknowledged', code: 'READY_TO_CLOSE', issue: 49 }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 49 }], issue(49, { body: page(49, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }) }), { row: KEPT_ROW(49, '2026-11-13 08:00Z') }],
  ['lapsed READY_TO_CLOSE beside a new kept-open TASK_MERGED_OPEN: a row', [{ state: 'new', code: 'READY_TO_CLOSE', issue: 49, ...LAPSED, promised: 'Close after slice 2' }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 49 }], issue(49, { body: page(49, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }) }), { row: KEPT_ROW(49, '2026-11-13 08:00Z') }],
  ['new kept-open TASK_MERGED_OPEN listed before a new READY_TO_CLOSE: a row', [{ state: 'new', code: 'TASK_MERGED_OPEN', issue: 49 }, { state: 'new', code: 'READY_TO_CLOSE', issue: 49 }], issue(49, { body: page(49, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }) }), { row: KEPT_ROW(49, '2026-11-13 08:00Z') }],
  ['new READY_TO_CLOSE beside a new TASK_MERGED_OPEN, kept open 3 hours ago: held', [{ state: 'new', code: 'READY_TO_CLOSE', issue: 49 }, { state: 'new', code: 'TASK_MERGED_OPEN', issue: 49 }], issue(49, { body: page(49, ALL_TICKED, { keptAt: '2026-11-14T09:00:00.000Z' }) }), { held: '#49 Kept open line' }],
  ['new READY_TO_CLOSE beside an acknowledged TASK_MERGED_OPEN, kept open: held', [{ state: 'new', code: 'READY_TO_CLOSE', issue: 49 }, { state: 'acknowledged', code: 'TASK_MERGED_OPEN', issue: 49 }], issue(49, { body: page(49, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }) }), { held: '#49 Kept open line' }],
];

test('red: a kept-open child the sweep queues as stalled is a KEPT OPEN? row, never held for ever (closure matrix)', () => {
  for (const [name, finding, child, want] of KEPT_STALE_MATRIX) {
    const { check } = sweep({ findings: [].concat(finding), children: [child] });
    const rows = check.lines.slice(1).filter(line => !line.startsWith('held'));
    const held = check.lines.find(line => /held, not proposed: /.test(line)) || '';
    if (want.row) assert.deepEqual(rows, [want.row], name);
    else { assert.deepEqual(rows, [], name); assert.ok(held.includes(want.held), `${name}: ${held}`); }
  }
  const { check } = sweep({ findings: [KEPT_STALE_MATRIX[0][1]], children: [KEPT_STALE_MATRIX[0][2]] });
  assert.match(check.lines[0], /MOVE\?, KEPT OPEN\?, UNTICKED\? and POLISH rows are yours$/);
});

// The unticked closure matrix: an open child whose page shows a merged PR while none of its DONE WHEN or
// ROWS checkboxes is ticked is a row; every other state is quiet.
const UNTICKED_ROW = (n, prs, count) => `UNTICKED? #${n} PR ${prs} merged, but none of its ${count} DONE WHEN or ROWS checkbox row(s) is ticked: tick each row a merged PR delivered (the stale check counts and judges by them)`;
const TWO_UNTICKED = '- [ ] Slice 1 lands.\n- [ ] Changelog fragment.';
const UNTICKED_MATRIX = [
  ['merged PR, every DONE WHEN row unticked: a row', issue(50, { body: page(50, TWO_UNTICKED) }), UNTICKED_ROW(50, '#900', 2)],
  ['merged PR, rows under ROWS only, all unticked: a row', issue(51, { body: `# TASK\n\n### ROWS\n\n- [ ] **P1** a\n- [ ] **P2** b\n- [ ] **P3** c\n\n${statePage(51)}\n` }), UNTICKED_ROW(51, '#900', 3)],
  ['two merged PRs and an open one: a row naming the merged ones', issue(52, { body: page(52, TWO_UNTICKED, { prs: [{ number: 902, state: 'OPEN', merge_sha: null }, { number: 901, state: 'MERGED', merge_sha: COMMIT }, { number: 900, state: 'MERGED', merge_sha: COMMIT }] }) }), UNTICKED_ROW(52, '#900, #901', 2)],
  ['CRLF line ends read as LF: a row', issue(53, { body: page(53, TWO_UNTICKED).replace(/\n/g, '\r\n') }), UNTICKED_ROW(53, '#900', 2)],
  ['one row ticked: quiet', issue(54, { body: page(54, '- [x] Slice 1 lands.\n- [ ] Changelog fragment.') }), null],
  ['a nested ticked row (two spaces): quiet', issue(55, { body: page(55, '- [ ] Slice 1\n  - [x] part A lands.') }), null],
  ['no merged PR, only an open one: quiet', issue(56, { body: page(56, TWO_UNTICKED, { prs: [{ number: 900, state: 'OPEN', merge_sha: null }] }) }), null],
  ['a closed PR only: quiet', issue(57, { body: page(57, TWO_UNTICKED, { prs: [{ number: 900, state: 'CLOSED', merge_sha: null }] }) }), null],
  ['plain DONE WHEN bullets (nothing to tick): quiet', issue(58, { body: page(58, '- Slice 1 lands.') }), null],
  ['closed child: quiet', issue(59, { state: 'closed', body: page(59, TWO_UNTICKED) }), null],
  ['no STATE block, a hand-written MERGED row: quiet', issue(60, { body: `## DONE WHEN\n\n${TWO_UNTICKED}\n\n|x|#900|MERGED|[ccccccc](https://github.com/acme/app/commit/${COMMIT})|\n` }), null],
  ['two STATE blocks: quiet (the managed-block finding covers a broken page)', issue(61, { body: `${page(61, TWO_UNTICKED)}\n${statePage(61)}\n` }), null],
];

test('red: a merged PR whose rows all stay unticked is an UNTICKED? row once, then named on the held line until a row is ticked (closure matrix)', () => {
  for (const [name, child, row] of UNTICKED_MATRIX) {
    const { check, written } = sweep({ children: [child] });
    assert.deepEqual(check.lines.slice(1).filter(line => !line.startsWith('held')), row ? [row] : [], name);
    const memory = written[0]['acme/app'].unticked;
    if (row) assert.deepEqual(memory, { [child.number]: { prs: rowTicks(child.body).merged, flagged: TODAY } }, `${name}: the stamp remembers the flag`);
    else assert.equal(memory, undefined, `${name}: nothing remembered`);
  }
  const child = UNTICKED_MATRIX[0][1];
  const yesterday = memory => ({ 'acme/app': { date: '2026-11-13', at: '2026-11-13T01:00:00Z', rows: [], unticked: memory } });
  // The next day, the same merged PRs: named on the held line, not a row, and still remembered.
  const again = sweep({ children: [child], stamps: yesterday({ 50: { prs: [900], flagged: '2026-11-13' } }) });
  assert.equal(again.check.state, 'ok');
  assert.match(again.check.lines[0], /held, not proposed: #50 2 row\(s\) unticked after PR #900 merged \(flagged 2026-11-13\)$/);
  assert.deepEqual(again.written[0]['acme/app'].unticked, { 50: { prs: [900], flagged: '2026-11-13' } });
  // Another PR merges: a row again.
  const more = issue(50, { body: page(50, TWO_UNTICKED, { prs: [{ number: 901, state: 'MERGED', merge_sha: COMMIT }, { number: 900, state: 'MERGED', merge_sha: COMMIT }] }) });
  assert.deepEqual(sweep({ children: [more], stamps: yesterday({ 50: { prs: [900], flagged: '2026-11-13' } }) }).check.lines.slice(1), [UNTICKED_ROW(50, '#900, #901', 2)]);
  // A memory entry in any other shape counts as none: a row again.
  for (const bad of [{ prs: '900', flagged: '2026-11-13' }, { prs: [900], flagged: 'yesterday' }, { prs: [0], flagged: '2026-11-13' }, null]) {
    assert.deepEqual(sweep({ children: [child], stamps: yesterday({ 50: bad }) }).check.lines.slice(1), [UNTICKED_ROW(50, '#900', 2)], JSON.stringify(bad));
  }
  // A row ticked: quiet, and the memory goes.
  const ticked = sweep({ children: [issue(50, { body: page(50, '- [x] Slice 1 lands.\n- [ ] Changelog fragment.') })], stamps: yesterday({ 50: { prs: [900], flagged: '2026-11-13' } }) });
  assert.deepEqual(ticked.check.lines, [`no stale children (${TODAY}, 1 children read)`]);
  assert.equal(ticked.written[0]['acme/app'].unticked, undefined);
});

// Default-deny: no shape outside the reader's subset is ever read as a ticked row or a merged PR.
const DONE_WHEN_BASE = impostor => `# TASK\n\n## DONE WHEN\n\n- [ ] a real row\n${impostor}\n\n# PLAN\n\nNow.\n\n${statePage(70)}\n`;
const PLAN_BASE = impostor => `# TASK\n\n## DONE WHEN\n\n- [ ] a real row\n\n## PLAN\n\n${impostor}\n\n${statePage(70)}\n`;
const point = code => String.fromCodePoint(code);
const TICKED_IMPOSTORS = [
  ...[
    ['backtick-fence', '```\n- [x] fake\n```'],
    ['tilde-fence', '~~~\n- [x] fake\n~~~'],
    ['unclosed-fence', '```\n- [x] fake'],
    ['longer-fence-closed-short', '````\n```\n- [x] fake\n````'],
    ['html-comment-block', '<!--\n- [x] fake\n-->'],
    ['four-space-indent', '\n    - [x] fake'],
    ['tab-indent', '\t- [x] fake'],
    ['quoted', '> - [x] fake'],
    ['no-space-after-marker', '-[x] fake'],
    ['no-space-after-box', '- [x]fake'],
    ['check-mark', `- [${point(0x2713)}] fake`],
    ['cyrillic-x', `- [${point(0x0445)}] fake`],
    ['zero-width-in-box', `- [${point(0x200b)}x] fake`],
    ['nbsp-after-marker', `-${point(0xa0)}[x] fake`],
    ['fullwidth-box', `- ${point(0xff3b)}x${point(0xff3d)} fake`],
    ...['cr', 'nel', 'ls', 'ps'].map(name => [`joined-by-${name}`, `a note${hostile.BREAKS[name]}- [x] fake`]),
  ].map(([id, text]) => ({ id, text: DONE_WHEN_BASE(text) })),
  ...[
    ['heading-in-fence', '```\n## DONE WHEN\n- [x] fake\n```'],
    ['heading-in-comment', '<!--\n## DONE WHEN\n- [x] fake\n-->'],
    ['heading-without-space', '#DONE WHEN\n- [x] fake'],
    ['heading-four-space-indent', '    ## DONE WHEN\n- [x] fake'],
    ['heading-other-words', '## NOT DONE WHEN\n- [x] fake'],
    ['heading-with-bom', `${point(0xfeff)}## DONE WHEN\n- [x] fake`],
  ].map(([id, text]) => ({ id: `plan-${id}`, text: PLAN_BASE(text) })),
];

test('red: the row reader never reads a shape outside its subset as a ticked row (hostile inputs)', () => {
  const quiet = text => rowTicks(text).ticked > 0;
  assert.equal(quiet(DONE_WHEN_BASE('- [x] a real ticked row')), true, 'control: a real ticked row counts');
  assert.equal(quiet(DONE_WHEN_BASE('- [X] a real ticked row')), true, 'control: X in either case');
  assert.equal(quiet(PLAN_BASE('### ROWS\n\n* [x] a real ticked row')), true, 'control: a ROWS heading and a star marker');
  hostile.expectDefaultDeny(assert, quiet, TICKED_IMPOSTORS);
  // Every line-break shape of a real page: CRLF reads the same as LF; the rest join lines, so nothing is
  // read as ticked; a leading byte order mark and tab indents leave the page's rows as they are.
  const real = DONE_WHEN_BASE('- [x] a real ticked row');
  hostile.expectDefaultDeny(assert, quiet, hostile.variants(real), { allow: ['crlf', 'bom', 'tabs'] });
  const large = hostile.timing(rowTicks, size => DONE_WHEN_BASE('- [ ] row\n'.repeat(Math.ceil(size / 10))));
  assert.ok(large.ok, large.message);
});

test('red: the row reader reads a merged PR only from a row of the one STATE block the sweep draws (hostile inputs)', () => {
  const merged = text => rowTicks(text).merged.length > 0;
  assert.deepEqual(rowTicks(page(71, TWO_UNTICKED)).merged, [900], 'control: the drawn block');
  const block = statePage(71);
  const [begin, ...rest] = block.split('\n');
  const end = rest.pop();
  const row = rest.find(line => line.includes('|#900|'));
  const without = rest.filter(line => line !== row).join('\n');
  const impostors = [
    ['row-outside-block', `${row}\n\n${begin}\n${without}\n${end}`],
    ['begin-only', `${begin}\n${rest.join('\n')}`],
    ['end-before-begin', `${end}\n${rest.join('\n')}\n${begin}`],
    ['two-blocks', `${block}\n\n${block}`],
    ['lowercase-status', block.replace('|MERGED|', '|merged|')],
    ['status-not-merged', block.replace('|MERGED|', '|NOT MERGED|')],
    ['status-merged-question', block.replace('|MERGED|', '|MERGED?|')],
    ['no-merge-sha', block.replace(/\|\[c{7}\]\([^)]*\)\|$/m, '|-|')],
    ['sha-not-a-commit-link', block.replace(/\(https:[^)]*\)/, '(x)')],
    ['short-commit-in-link', block.replace(`/commit/${COMMIT}`, '/commit/ccccccc')],
    ['row-joined-by-ls', block.replace(row, `|x|#899|OPEN|-|${hostile.BREAKS.ls}${row}`)],
    ['block-in-fence', `\`\`\`\n${block}\n\`\`\``],
  ].map(([id, text]) => ({ id, text: `## DONE WHEN\n\n${TWO_UNTICKED}\n\n${text}\n` }));
  hostile.expectDefaultDeny(assert, merged, impostors);
});
