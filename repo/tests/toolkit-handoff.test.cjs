'use strict';

// The controller handoff snapshot: `toolkit-store.cjs handoff` saves it only when a file changed, the
// after-tool hook starts that save after a gate-end store save or a remembered-source write, and the
// controller health check flags a stale one at session start. Real Git against a local bare store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const store = require('../scripts/toolkit-store.cjs');
// Loaded inside the hook test, so the other tests still run where the hook does not exist yet.
const hookModule = () => require('../scripts/toolkit-handoff-hook.cjs');
const { parseArgs, controllerCheck } = require('../scripts/toolkit-controller-check.cjs');
const { PLANTED, git, pushes, world } = require('./support/toolkit-store-world.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const FOLDER = 'evidence/handoff/acme/widget';

// A controlled-repository checkout (acme/widget), a memory folder and two working files that share
// a name, outside the store.
function sources(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-handoff-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'widget');
  git(base, 'init', '--quiet', repo);
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); return path.join(base, rel); };
  put('memory/MEMORY.md', '# Memory\n- queue: #1 > #2\n');
  put('memory/owner-rules.md', 'merge commits only\n');
  const hourly = put('hourly/additions.md', 'hourly step\n');
  const daily = put('daily/additions.md', 'daily step\n');
  const instructions = put('instructions.md', 'project instructions\n');
  const state = path.join(base, 'state', 'handoff-refresh.json');
  return { base, repo, put, memory: path.join(base, 'memory'), hourly, daily, instructions, state };
}

const NOW = () => new Date('2026-11-21T13:00:00Z');

test('handoff saves the per-repository snapshot with its manifest, then sends nothing when nothing changed', t => {
  const w = world(t);
  const s = sources(t);
  const first = w.act(['handoff', '--repo-root', s.repo, '--memory', s.memory, '--instructions', s.instructions, '--file', s.hourly, '--file', s.daily], { handoffState: s.state, now: NOW });
  assert.equal(first.code, 0, JSON.stringify(first.result));
  assert.equal(first.result.handoff, 'SAVED');
  assert.equal(first.result.read_back, true);
  for (const file of ['README.md', 'manifest.json', 'MEMORY.md', 'memory/owner-rules.md', 'files/instructions.md', 'files/hourly-additions.md', 'files/daily-additions.md']) assert.ok(w.remoteHas(`${FOLDER}/${file}`), file);
  const manifest = JSON.parse(w.remoteFile(`${FOLDER}/manifest.json`));
  assert.equal(manifest.stamp.taken_at, '2026-11-21T13:00:00.000Z');
  assert.match(manifest.stamp.toolkit_version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.files.map(row => row.path), ['files/daily-additions.md', 'files/hourly-additions.md', 'files/instructions.md', 'MEMORY.md', 'memory/owner-rules.md'].sort((a, b) => a.localeCompare(b)));
  assert.ok(manifest.files.every(row => /^[0-9a-f]{64}$/.test(row.sha256)));
  assert.equal(manifest.sources.memory, s.memory, 'the manifest remembers the sources');
  assert.equal(JSON.parse(fs.readFileSync(s.state, 'utf8')).store, w.dir, 'the hook record names the store');

  // Later runs need only the store and repository; a new time alone changes nothing.
  const tip = w.remoteTip();
  const pushed = pushes(w.calls).length;
  const again = w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: () => new Date('2026-11-21T14:00:00Z') });
  assert.equal(again.code, 0, JSON.stringify(again.result));
  assert.equal(again.result.handoff, 'UNCHANGED');
  assert.equal(again.result.taken_at, '2026-11-21T13:00:00.000Z');
  assert.equal(w.remoteTip(), tip);
  assert.equal(pushes(w.calls).length, pushed, 'an unchanged snapshot pushes nothing');

  // One changed memory file is saved; a removed one stays in the store but leaves the manifest.
  s.put('memory/MEMORY.md', '# Memory\n- queue: #2\n');
  fs.rmSync(path.join(s.memory, 'owner-rules.md'));
  const changed = w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: NOW });
  assert.equal(changed.result.handoff, 'SAVED');
  assert.match(w.remoteFile(`${FOLDER}/MEMORY.md`), /queue: #2/);
  assert.ok(w.remoteHas(`${FOLDER}/memory/owner-rules.md`), 'nothing is deleted');
  assert.ok(!JSON.parse(w.remoteFile(`${FOLDER}/manifest.json`)).files.some(row => row.path === 'memory/owner-rules.md'));
});

test('a snapshot an earlier run could not push is sent by the next run, never reported unchanged', t => {
  const w = world(t);
  const s = sources(t);
  w.hooks.refusePushes = 4;
  const failed = w.act(['handoff', '--repo-root', s.repo, '--memory', s.memory], { handoffState: s.state, now: NOW });
  assert.equal(failed.code, 1, JSON.stringify(failed.result));
  assert.ok(!w.remoteHas(`${FOLDER}/MEMORY.md`));
  const again = w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: () => new Date('2026-11-21T14:00:00Z') });
  assert.equal(again.code, 0, JSON.stringify(again.result));
  assert.equal(again.result.handoff, 'SAVED');
  assert.equal(again.result.taken_at, '2026-11-21T13:00:00.000Z', 'the stamp is the one the files carry');
  assert.ok(w.remoteHas(`${FOLDER}/MEMORY.md`));
});

test('a secret-shaped source refuses the whole run: nothing written, nothing pushed', t => {
  const w = world(t);
  const s = sources(t);
  s.put('memory/leak.md', `token = ${PLANTED}\n`);
  const tip = w.remoteTip();
  const run = w.act(['handoff', '--repo-root', s.repo, '--memory', s.memory], { handoffState: s.state, now: NOW });
  assert.equal(run.code, 1);
  assert.match(run.result.stopped, /secret scan found 1 match\(es\): .*leak\.md:1 \(github-token\)\. Nothing was written\./);
  assert.ok(!run.result.stopped.includes(PLANTED));
  assert.ok(!fs.existsSync(path.join(w.dir, FOLDER)), 'no file is copied');
  assert.equal(w.remoteTip(), tip);
  assert.ok(!fs.existsSync(s.state));
});

test('with governance off, --out writes the same snapshot and says nothing was sent; a missing source keeps its last copy', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const act = argv => { const lines = []; const code = store.main(['handoff', '--out', out, '--repo-root', s.repo, ...argv, '--json'], { handoffState: s.state, now: NOW, stdout: text => lines.push(text), stderr: text => lines.push(text) }); return { code, result: JSON.parse(lines.join('')) }; };
  const first = act(['--memory', s.memory, '--file', s.hourly]);
  assert.equal(first.code, 0, JSON.stringify(first.result));
  assert.equal(first.result.handoff, 'WRITTEN');
  assert.equal(first.result.sent, 'nothing');
  assert.equal(fs.readFileSync(path.join(out, FOLDER, 'files', 'additions.md'), 'utf8'), 'hourly step\n');

  // The working file is not reachable here (another computer's path): its last copy and row stay.
  fs.rmSync(s.hourly);
  const again = act([]);
  assert.equal(again.result.handoff, 'UNCHANGED');
  assert.equal(again.result.kept, s.hourly);
  assert.equal(fs.readFileSync(path.join(out, FOLDER, 'files', 'additions.md'), 'utf8'), 'hourly step\n');
  assert.ok(JSON.parse(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8')).files.some(row => row.path === 'files/additions.md'));
  assert.equal(JSON.parse(fs.readFileSync(s.state, 'utf8')).out, out);
});

test('--check is read-only: CURRENT when fresh, STALE (exit 1) naming what changed, MISSING with no snapshot', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const act = argv => { const lines = []; const code = store.main(['handoff', '--out', out, '--repo-root', s.repo, ...argv], { handoffState: s.state, now: NOW, stdout: text => lines.push(text), stderr: text => lines.push(text) }); return { code, text: lines.join('') }; };
  let run = act(['--check']);
  assert.equal(run.code, 1);
  assert.match(run.text, /^HANDOFF MISSING /);
  assert.equal(act(['--memory', s.memory]).code, 0);
  run = act(['--check']);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /^HANDOFF CURRENT .*taken_at=2026-11-21T13:00:00\.000Z/);
  s.put('memory/new-rule.md', 'a new owner rule\n');
  const before = fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8');
  run = act(['--check']);
  assert.equal(run.code, 1);
  assert.match(run.text, /^HANDOFF STALE .*changed=memory\/new-rule\.md/);
  assert.equal(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8'), before, 'the check writes nothing');
});

test('the controller check runs the handoff check only with its inputs, and the periodic runs skip it', () => {
  const calls = [];
  const deps = (status, stdout) => ({ run(script, args) { calls.push({ script, args }); return { status, stdout, stderr: '', error: null }; }, exists: () => false, readBinding: () => null, readHubState: () => null, now: NOW });
  const skipped = controllerCheck(parseArgs(['--host', 'chat']), deps(0, '')).checks.find(check => check.name === 'handoff');
  assert.equal(skipped.state, 'skipped');
  assert.match(skipped.lines[0], /pass --handoff/);
  const stale = controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo', '--handoff', '/store']), deps(1, 'HANDOFF STALE folder=evidence/handoff/acme/widget changed=MEMORY.md\n')).checks.find(check => check.name === 'handoff');
  assert.equal(stale.state, 'attention');
  assert.match(stale.lines[0], /HANDOFF STALE/);
  assert.deepEqual(calls.find(call => call.script === 'repo/scripts/toolkit-store.cjs').args, ['handoff', '--check', '--store', '/store', '--repo-root', '/repo']);
  assert.equal(controllerCheck(parseArgs(['--host', 'chat', '--checkout', '/repo', '--handoff', '/store']), deps(0, 'HANDOFF CURRENT\n')).checks.find(check => check.name === 'handoff').state, 'ok');
  // Never in a scheduled run: every controller-check call in the hourly and daily checklists skips it.
  const dir = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects', 'tasks');
  for (const kind of ['hourly-nudge.md', 'daily-check-in.md']) {
    const calls = [...fs.readFileSync(path.join(dir, kind), 'utf8').matchAll(/toolkit-controller-check\.cjs[^`]*/g)].map(match => match[0]);
    assert.ok(calls.length, kind);
    for (const call of calls) assert.match(call, /--skip [a-z,]*\bhandoff\b/, `${kind}: ${call}`);
  }
});

test('the after-tool hook starts one background refresh after a store save or a remembered-source write, and nothing else', t => {
  const hook = hookModule();
  const s = sources(t);
  const dir = path.dirname(s.state);
  const out = path.join(s.base, 'drive');
  assert.equal(store.main(['handoff', '--out', out, '--repo-root', s.repo, '--memory', s.memory, '--file', s.hourly], { handoffState: s.state, now: NOW, stdout: () => {}, stderr: () => {} }), 0);
  const started = [];
  let clock = Date.parse('2026-11-21T13:00:00Z');
  const fire = (payload, extra = {}) => hook.main({ stdin: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: s.base, ...payload }), stateDirectory: dir, now: () => clock, spawn: (command, args, options) => { started.push({ args, options }); return { unref() {} }; }, ...extra });
  const saved = { tool_name: 'Bash', tool_input: { command: 'node repo/scripts/toolkit-store.cjs save --store ../store --path evidence/x --message "gate end"' }, tool_response: { stdout: 'Done: save store=owner/store commit=abc read_back=true\n' } };

  // Ignored: other commands, a failed save, a write outside the sources, another event.
  assert.equal(fire({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_response: { stdout: '' } }), 0);
  assert.equal(fire({ ...saved, tool_response: { stdout: '', stderr: 'Stopped: secret scan found 1 match(es)' } }), 0);
  assert.equal(fire({ tool_name: 'Write', tool_input: { file_path: path.join(s.base, 'elsewhere.md') } }), 0);
  assert.equal(fire({ ...saved, hook_event_name: 'PreToolUse' }), 0);
  assert.equal(started.length, 0);

  // A successful store save starts one run with the recorded folder and repository.
  assert.equal(fire(saved), 0);
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].args.slice(1), ['handoff', '--out', out, '--repo-root', s.repo]);
  assert.match(started[0].args[0], /toolkit-store\.cjs$/);
  assert.equal(started[0].options.detached, true);
  assert.equal(started[0].options.stdio, 'ignore');

  // Debounced: a memory write five minutes later starts nothing; eleven minutes later it does.
  clock += 5 * 60 * 1000;
  fire({ tool_name: 'Edit', tool_input: { file_path: path.join(s.memory, 'MEMORY.md') } });
  assert.equal(started.length, 1);
  clock += 6 * 60 * 1000;
  fire({ tool_name: 'Edit', tool_input: { file_path: path.join(s.memory, 'MEMORY.md') } });
  assert.equal(started.length, 2);
  clock += 11 * 60 * 1000;
  fire({ tool_name: 'apply_patch', tool_input: { input: `*** Begin Patch\n*** Update File: ${s.hourly}\n@@\n-a\n+b\n*** End Patch\n` } });
  assert.equal(started.length, 3, 'a patch to a remembered working file');

  // Fails open: no record, a broken record, a spawn that throws, unreadable input.
  clock += 11 * 60 * 1000;
  assert.equal(fire(saved, { stateDirectory: path.join(s.base, 'no-state') }), 0);
  assert.equal(fire(saved, { spawn: () => { throw new Error('spawn failed'); } }), 0);
  assert.equal(hook.main({ stdin: '{not json', stateDirectory: dir }), 0);
  fs.writeFileSync(s.state, '{broken');
  clock += 11 * 60 * 1000;
  assert.equal(fire(saved), 0);
  assert.equal(started.length, 3);
});

test('the store command refuses handoff without exactly one of --store or --out, and the hook is wired for Claude Code', () => {
  for (const argv of [['handoff'], ['handoff', '--store', 'a', '--out', 'b'], ['handoff', '--out', 'b', '--path', 'x'], ['save', '--store', 'x', '--path', 'a', '--message', 'm', '--check']]) {
    assert.equal(store.main(argv, { stdout: () => {}, stderr: () => {} }), 2, argv.join(' '));
  }
  for (const file of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const entry = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks.PostToolUse.at(-1);
    assert.deepEqual(entry, { matcher: '^(?:Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit)$', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-handoff-hook.cjs"', timeout: 10 }] }, file);
  }
});
