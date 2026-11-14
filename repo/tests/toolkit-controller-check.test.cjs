'use strict';

const assert = require('node:assert/strict');
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
};

// A fake child-process runner: canned results per script, and every call recorded.
function world({ results = {}, binding = GOVERNED, library = true } = {}) {
  const calls = [];
  const deps = {
    run(script, args, options) { calls.push({ script, args, options }); return { stderr: '', error: null, ...(results[script] || CLEAN[script]) }; },
    exists: () => library,
    readBinding: checkout => (checkout ? binding : null),
    now: () => new Date('2026-11-14T12:00:00Z'),
  };
  return { deps, calls };
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
  assert.equal(text, 'CONTROLLER CHECK: clear (ok: guidebook instructions memory tasks programme traces ci footer)\n');
});

test('checks are segregated by host and governance, and skip cleanly with the reason', () => {
  const chat = controllerCheck(parseArgs(ALL), world({ library: false }).deps);
  assert.equal(chat.host, 'chat');
  for (const name of ['guidebook', 'instructions', 'memory', 'tasks']) {
    assert.deepEqual(chat.checks.find(check => check.name === name), { name, state: 'skipped', lines: ['Claude Projects only'] });
  }
  assert.deepEqual(chat.checks.filter(check => check.state === 'ok').map(check => check.name), ['programme', 'traces', 'ci', 'footer']);
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
  assert.match(text, /skipped: guidebook programme/);
});

test('findings print compactly: counts by code and the top items, full detail behind --expand', () => {
  const findings = Array.from({ length: 6 }, (_, index) => `- F${index} new ${index < 4 ? 'CLOSING_STORY' : 'STALE_PR'} #${index}: do it`);
  const results = { [SCRIPTS.programme]: { status: 0, stdout: ['Attention: 6 new, 0 acknowledged', '', ...findings, '', 'The controller answers each new finding'].join('\n') } };
  const compact = run(ALL, { results });
  assert.equal(compact.code, 1);
  assert.deepEqual(compact.text.trimEnd().split('\n'), [
    'CONTROLLER CHECK: 1 need attention, 0 could not run (ok: guidebook instructions memory tasks traces ci footer)',
    'ATTENTION programme: Attention: 6 new, 0 acknowledged (CLOSING_STORY 4, STALE_PR 2)',
    `  ${findings[0]}`, `  ${findings[1]}`, `  ${findings[2]}`,
    '  ... 3 more (--expand, or programme.cjs attention)',
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
  assert.equal(report.attention, 6);
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
  for (const call of calls) for (const flag of ['--apply', '--out', '--refresh', '--repair', '--write']) assert.equal(call.args.includes(flag), false);
  const defaults = run(['--host', 'chat', '--checkout', '/repo']).calls.find(call => call.script === SCRIPTS.footer);
  assert.deepEqual(defaults.args, ['--repo', 'acme/app', '--since', '2026-11-13T10:00:00.000Z']);
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
  assert.equal(report.checks.length, 8);
  assert.equal(format(report).split('\n')[0].startsWith('CONTROLLER CHECK: clear'), true);
});
