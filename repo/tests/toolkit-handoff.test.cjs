'use strict';

// The controller handoff snapshot: `toolkit-store.cjs handoff` saves it only when a file changed, the
// after-tool hook starts that save when a remembered source's content moved (whatever tool moved it),
// and the controller health check flags a stale one at session start. Real Git against a local bare store.
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

test('a run that names one kind of source keeps every remembered kind it does not name (G2 M1)', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const act = argv => { const lines = []; const code = store.main(['handoff', '--out', out, '--repo-root', s.repo, ...argv], { handoffState: s.state, now: NOW, stdout: text => lines.push(text), stderr: text => lines.push(text) }); return { code, text: lines.join('') }; };
  assert.equal(act(['--memory', s.memory, '--instructions', s.instructions, '--file', s.hourly]).code, 0);
  const plan = s.put('plans/G0-plan.md', 'the plan\n');
  assert.equal(act(['--file', plan]).code, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sources.memory, s.memory, 'memory stays remembered');
  assert.equal(manifest.sources.instructions, s.instructions);
  assert.deepEqual(manifest.sources.files, [plan], 'a named --file list replaces the file list');
  assert.ok(manifest.files.some(row => row.path === 'MEMORY.md'));
  // A memory change is still seen by --check and copied by the next run with no sources named.
  s.put('memory/MEMORY.md', '# Memory\n- queue: #3\n');
  assert.match(act(['--check']).text, /^HANDOFF STALE .*changed=MEMORY\.md/);
  assert.match(act([]).text, /^HANDOFF WRITTEN /);
  assert.match(fs.readFileSync(path.join(out, FOLDER, 'MEMORY.md'), 'utf8'), /queue: #3/);
});

// Paths in the other operating system's style: what a snapshot looks like after the owner's other
// computer saved it (Windows drive paths read here on Linux, Linux paths read here on Windows).
const FOREIGN = process.platform === 'win32'
  ? { memory: '/home/wj/memory', instructions: '/home/wj/instructions.md', files: ['/home/wj/plans/G0-plan.md'] }
  : { memory: 'C:\\Users\\wj\\memory', instructions: 'C:\\Users\\wj\\instructions.md', files: ['C:\\Users\\wj\\plans\\G0-plan.md'] };
const sha = text => require('node:crypto').createHash('sha256').update(text).digest('hex');

test('a snapshot the other operating system saved keeps its paths exactly as saved and never loses their rows (G2 H1)', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const act = argv => { const lines = []; const code = store.main(['handoff', '--out', out, '--repo-root', s.repo, ...argv], { handoffState: s.state, now: NOW, stdout: text => lines.push(text), stderr: text => lines.push(text) }); return { code, text: lines.join('') }; };
  const copies = { 'MEMORY.md': '# Memory\n- queue: #9\n', 'memory/owner-rules.md': 'merge commits only\n', 'files/instructions.md': 'other computer instructions\n', 'files/G0-plan.md': 'the plan\n' };
  const sourceOf = rel => (rel === 'files/G0-plan.md' ? FOREIGN.files[0] : rel === 'files/instructions.md' ? FOREIGN.instructions : FOREIGN.memory);
  for (const [rel, text] of Object.entries(copies)) { fs.mkdirSync(path.dirname(path.join(out, FOLDER, rel)), { recursive: true }); fs.writeFileSync(path.join(out, FOLDER, rel), text); }
  const seeded = `${JSON.stringify({ schema: 'toolkit.handoff-snapshot.v1', stamp: { taken_at: '2026-11-21T12:00:00.000Z', toolkit_version: '3.162.1', repository_commit: null }, sources: FOREIGN,
    files: Object.entries(copies).map(([rel, text]) => ({ path: rel, sha256: sha(text), source: sourceOf(rel) })).sort((a, b) => a.path.localeCompare(b.path)) }, null, 2)}\n`;
  fs.writeFileSync(path.join(out, FOLDER, 'manifest.json'), seeded);

  // Nothing here can reach those paths: every row and copy stays, nothing is written, the check is CURRENT.
  let run = act([]);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /^HANDOFF UNCHANGED /);
  assert.equal(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8'), seeded);
  run = act(['--check']);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /^HANDOFF CURRENT /);

  // Naming one source here replaces only that kind; the other computer's paths stay exactly as saved.
  run = act(['--instructions', s.instructions]);
  assert.match(run.text, /^HANDOFF WRITTEN /, run.text);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sources.memory, FOREIGN.memory);
  assert.deepEqual(manifest.sources.files, FOREIGN.files);
  assert.equal(manifest.sources.instructions, s.instructions);
  const rows = Object.fromEntries(manifest.files.map(row => [row.path, row]));
  assert.deepEqual(Object.keys(rows), ['files/G0-plan.md', 'files/instructions.md', 'MEMORY.md', 'memory/owner-rules.md'].sort((a, b) => a.localeCompare(b)));
  assert.equal(rows['MEMORY.md'].source, FOREIGN.memory);
  assert.equal(rows['MEMORY.md'].sha256, sha(copies['MEMORY.md']));
  assert.equal(rows['files/G0-plan.md'].source, FOREIGN.files[0]);
  assert.equal(rows['files/instructions.md'].sha256, sha('project instructions\n'));
  assert.match(act(['--check']).text, /^HANDOFF CURRENT /);
});

test('a run on the other operating system never reads, rewrites or drops this computer\'s saved paths (G2 H1)', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const other = process.platform === 'win32' ? 'linux' : 'win32';
  const touched = [];
  // That computer's view of this disk: every path is recorded, so a read of a path saved here shows.
  const otherFs = new Proxy(fs, { get: (target, key) => (typeof target[key] === 'function' ? (...args) => { if (typeof args[0] === 'string') touched.push(args[0]); return target[key](...args); } : target[key]) });
  const act = (argv, deps = {}) => { const lines = []; const code = store.main(['handoff', '--out', out, '--repo-root', s.repo, ...argv], { handoffState: s.state, now: NOW, stdout: text => lines.push(text), stderr: text => lines.push(text), ...deps }); return { code, text: lines.join('') }; };
  assert.equal(act(['--memory', s.memory, '--instructions', s.instructions, '--file', s.hourly]).code, 0);
  const saved = fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8');
  const there = { platform: other, fs: otherFs, readRepository: () => ({ repository: 'acme/widget', commit: null }) };

  let run = act([], there);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /^HANDOFF UNCHANGED /);
  assert.equal(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8'), saved, 'every row and saved path stays');
  run = act(['--check'], there);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /^HANDOFF CURRENT /);
  assert.deepEqual(touched.filter(file => [s.memory, s.instructions, s.hourly].some(source => file.startsWith(source))), [], 'no saved source was read there');
});

test('a save that stops before its commit puts the snapshot folder back, so later saves are not blocked (G2 M2)', t => {
  const w = world(t);
  const s = sources(t);
  assert.equal(w.act(['handoff', '--repo-root', s.repo, '--memory', s.memory], { handoffState: s.state, now: NOW }).code, 0);
  s.put('memory/MEMORY.md', '# Memory\n- queue: #9\n');
  // The second fetch of the run (save's, after the snapshot is written) drops.
  let fetches = 0;
  const run = (cmd, args, options) => {
    const rest = args.slice(args.indexOf('-C') + 2);
    if (rest[0] === 'fetch' && (fetches += 1) === 2) return { status: 128, stdout: '', stderr: 'network down in the test' };
    return w.deps.run(cmd, args, options);
  };
  const failed = w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: NOW, run });
  assert.equal(failed.code, 1, JSON.stringify(failed.result));
  assert.equal(git(w.dir, 'status', '--porcelain'), '', 'the checkout is back to its committed copy');
  // Another writer refreshes the snapshot; the next gate-end save and the next handoff still run.
  w.raceIn(`${FOLDER}/MEMORY.md`, '# Memory\n- from the other writer\n')();
  w.write('evidence/g2-x/report.md', 'report\n');
  assert.equal(w.act(['save', '--path', 'evidence/g2-x/report.md', '--message', 'gate end']).code, 0);
  const again = w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: NOW });
  assert.equal(again.code, 0, JSON.stringify(again.result));
  assert.equal(again.result.handoff, 'SAVED');
  assert.match(w.remoteFile(`${FOLDER}/MEMORY.md`), /queue: #9/);
});

test('handoff syncs before it compares: a snapshot another writer already pushed is unchanged here', t => {
  const w = world(t);
  const s = sources(t);
  assert.equal(w.act(['handoff', '--repo-root', s.repo, '--memory', s.memory], { handoffState: s.state, now: NOW }).code, 0);
  // The other clone pushes the same snapshot content with a later stamp; this checkout is behind.
  git(w.other, 'pull', '--quiet', '--no-rebase', 'origin', w.branch);
  const manifestPath = path.join(w.other, FOLDER, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  s.put('memory/MEMORY.md', '# Memory\n- queue: #5\n');
  fs.writeFileSync(path.join(w.other, FOLDER, 'MEMORY.md'), '# Memory\n- queue: #5\n');
  manifest.files.find(row => row.path === 'MEMORY.md').sha256 = require('node:crypto').createHash('sha256').update('# Memory\n- queue: #5\n').digest('hex');
  manifest.stamp.taken_at = '2026-11-21T13:30:00.000Z';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'other writer'); git(w.other, 'push', '--quiet', 'origin', w.branch);
  const tip = w.remoteTip();
  const run = w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: NOW });
  assert.equal(run.result.handoff, 'UNCHANGED', JSON.stringify(run.result));
  assert.equal(run.result.taken_at, '2026-11-21T13:30:00.000Z');
  assert.equal(w.remoteTip(), tip);
});

test('a byte-order mark stays in the copy, so its sha256 is the one the manifest records (G2 L3)', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const bom = s.put('bom.md', '﻿with a mark\n');
  assert.equal(store.main(['handoff', '--out', out, '--repo-root', s.repo, '--file', bom], { handoffState: s.state, now: NOW, stdout: () => {}, stderr: () => {} }), 0);
  const copy = fs.readFileSync(path.join(out, FOLDER, 'files', 'bom.md'));
  const row = JSON.parse(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8')).files.find(item => item.path === 'files/bom.md');
  assert.equal(require('node:crypto').createHash('sha256').update(copy).digest('hex'), row.sha256);
  assert.deepEqual(copy, fs.readFileSync(bom));
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


// ---- after-tool hook ------------------------------------------------------------------------------

const MINUTE = 60 * 1000;
// Sets a file's modified time, as a synced memory copy keeps the time each file was saved.
const touch = (file, iso) => fs.utimesSync(file, new Date(iso), new Date(iso));
// A memory folder whose files were saved at different times (real modified times).
function aged(s) {
  touch(path.join(s.memory, 'MEMORY.md'), '2026-11-21T10:00:00Z');
  touch(path.join(s.memory, 'owner-rules.md'), '2026-11-20T09:00:00Z');
}

// A hook harness: a fresh state folder, a fake clock and a spawn that records each start.
function hookHarness(s, { cwd = s.base, record = s.state } = {}) {
  const hook = hookModule();
  const dir = path.join(s.base, `hook-state-${path.basename(cwd)}`);
  const started = [];
  const clock = { now: Date.parse('2026-11-21T13:00:00Z') };
  const fire = (payload = {}, extra = {}) => hook.main({
    stdin: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'session-a', cwd, tool_name: 'Bash', tool_input: { command: 'true' }, ...payload }),
    stateDirectory: dir, handoffRecord: record, now: () => clock.now,
    spawn: (command, args, options) => { started.push({ command, args, options }); return { unref() {} }; }, ...extra,
  });
  return { hook, dir, started, fire, later: minutes => { clock.now += minutes * MINUTE; } };
}

const runOut = (s, out) => (argv, now = NOW) => {
  const lines = [];
  const code = store.main(['handoff', '--out', out, '--repo-root', s.repo, ...argv, '--json'], { handoffState: s.state, now, stdout: text => lines.push(text), stderr: text => lines.push(text) });
  return { code, result: JSON.parse(lines.join('')) };
};

test('the after-tool hook starts one refresh when a remembered source\'s content moves, whatever tool moved it', t => {
  const s = sources(t);
  aged(s);
  const out = path.join(s.base, 'drive');
  assert.equal(runOut(s, out)(['--memory', s.memory, '--file', s.hourly]).code, 0);
  const h = hookHarness(s);

  // Nothing moved: no start, whatever the tool.
  assert.equal(h.fire({ tool_name: 'Bash', tool_input: { command: 'git status' } }), 0);
  h.later(2);
  fs.writeFileSync(path.join(s.base, 'elsewhere.md'), 'x\n');
  assert.equal(h.fire({ tool_name: 'Write', tool_input: { file_path: path.join(s.base, 'elsewhere.md') } }), 0);
  assert.equal(h.started.length, 0, 'an unrelated write starts nothing');

  // A memory tool with an unknown name and no path saves a newer memory file: one start.
  h.later(2);
  s.put('memory/MEMORY.md', '# Memory\n- queue: #7\n');
  touch(path.join(s.memory, 'MEMORY.md'), '2026-11-21T13:03:00Z');
  assert.equal(h.fire({ tool_name: 'update_memory', tool_input: { text: 'queue: #7' } }), 0);
  assert.equal(h.started.length, 1);
  const [first] = h.started;
  assert.match(first.args[0], /toolkit-store\.cjs$/);
  assert.deepEqual(first.args.slice(1, 6), ['handoff', '--out', out, '--repo-root', s.repo]);
  assert.equal(first.args[6], '--baseline');
  assert.ok(fs.existsSync(first.args[7]), 'the session baseline file exists');
  assert.equal(first.options.detached, true);
  assert.equal(first.options.stdio, 'ignore');

  // A read-only tool never compares; other events are ignored.
  h.later(11);
  s.put('hourly/additions.md', 'hourly step two\n');
  assert.equal(h.fire({ tool_name: 'Read', tool_input: { file_path: s.hourly } }), 0);
  assert.equal(h.fire({ hook_event_name: 'PreToolUse' }), 0);
  assert.equal(h.started.length, 1);
  // A shell write (sed -i) to a remembered working file: the shell call itself starts one.
  assert.equal(h.fire({ tool_name: 'Bash', tool_input: { command: `sed -i s/step/step-two/ ${s.hourly}` } }), 0);
  assert.equal(h.started.length, 2);
});

test('the hook compares at most once a minute, starts at most once per 10 minutes, and a change inside the window is not lost', t => {
  const s = sources(t);
  aged(s);
  const out = path.join(s.base, 'drive');
  assert.equal(runOut(s, out)(['--memory', s.memory]).code, 0);
  const h = hookHarness(s);
  assert.equal(h.fire(), 0); // first call: the session baseline
  s.put('memory/MEMORY.md', '# Memory\n- one\n');
  h.fire();
  assert.equal(h.started.length, 0, 'compared under a minute ago');
  h.later(1);
  h.fire();
  assert.equal(h.started.length, 1);
  // The refresh has not landed (the snapshot still differs), and a second change comes in.
  h.later(3);
  s.put('memory/second.md', 'second\n');
  h.fire();
  assert.equal(h.started.length, 1, 'inside the 10-minute window');
  h.later(8);
  h.fire();
  assert.equal(h.started.length, 2, 'the next call after the window still sees the difference');
});

test('a session with no handoff record finds the snapshot in a nearby store checkout and refreshes it', t => {
  const w = world(t);
  const s = sources(t);
  aged(s);
  // The controlled repository's checkout sits next to the store checkout, as cloud sessions clone them.
  const repo = path.join(w.base, 'widget');
  git(w.base, 'init', '--quiet', repo);
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
  const saved = w.act(['handoff', '--repo-root', repo, '--memory', s.memory], { handoffState: path.join(s.base, 'gate-end', 'handoff-refresh.json'), now: NOW });
  assert.equal(saved.result.handoff, 'SAVED', JSON.stringify(saved.result));

  const none = path.join(s.base, 'no-record.json');
  const h = hookHarness(s, { cwd: repo, record: none });
  assert.equal(h.fire({ tool_name: 'some_new_tool' }), 0);
  assert.equal(h.started.length, 0, 'found, but nothing moved yet');
  h.later(2);
  s.put('memory/MEMORY.md', '# Memory\n- from the coordinator\n');
  touch(path.join(s.memory, 'MEMORY.md'), '2026-11-21T13:01:00Z');
  assert.equal(h.fire({ tool_name: 'some_new_tool' }), 0);
  assert.equal(h.started.length, 1);
  assert.deepEqual(h.started[0].args.slice(1, 6), ['handoff', '--store', w.dir, '--repo-root', repo]);

  // A session with no record and no nearby snapshot starts nothing.
  const lone = path.join(s.base, 'lone');
  fs.mkdirSync(lone);
  const miss = hookHarness(s, { cwd: lone, record: none });
  for (let index = 0; index < 3; index += 1) { assert.equal(miss.fire(), 0); miss.later(2); }
  assert.equal(miss.started.length, 0);
});

test('a hook-started refresh writes only newer files: an older session copy never overwrites newer rows', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const run = runOut(s, out);
  const manifest = () => JSON.parse(fs.readFileSync(path.join(out, FOLDER, 'manifest.json'), 'utf8'));
  const row = name => manifest().files.find(item => item.path === name);
  const copy = name => fs.readFileSync(path.join(out, FOLDER, name), 'utf8');
  // A newer copy (the coordinator's 12:00 save) is in the snapshot.
  s.put('memory/MEMORY.md', '# Memory\n- newest queue\n');
  touch(path.join(s.memory, 'MEMORY.md'), '2026-11-21T12:00:00Z');
  touch(path.join(s.memory, 'owner-rules.md'), '2026-11-20T09:00:00Z');
  assert.equal(run(['--memory', s.memory]).result.handoff, 'WRITTEN');
  assert.equal(row('MEMORY.md').modified, '2026-11-21T12:00:00.000Z', 'each row records its file\'s modified time');

  // This session started earlier: its MEMORY.md copy is older.
  const baseline = path.join(s.base, 'baseline.json');
  s.put('memory/MEMORY.md', '# Memory\n- old queue\n');
  touch(path.join(s.memory, 'MEMORY.md'), '2026-11-21T08:00:00Z');
  fs.writeFileSync(baseline, JSON.stringify({ rows: [] }));
  const old = run(['--baseline', baseline]);
  assert.equal(old.result.handoff, 'UNCHANGED', JSON.stringify(old.result));
  // It changes owner-rules.md itself: only that file is written.
  s.put('memory/owner-rules.md', 'merge commits only; no rebase\n');
  assert.equal(run(['--baseline', baseline]).result.handoff, 'WRITTEN');
  assert.match(copy('MEMORY.md'), /newest queue/, 'the newer row stays');
  assert.equal(row('MEMORY.md').modified, '2026-11-21T12:00:00.000Z');
  assert.match(copy('memory/owner-rules.md'), /no rebase/, 'this session\'s own change is written');
  // A file the snapshot lacks: added only when newer than every row of its source.
  s.put('memory/stale.md', 'deleted elsewhere long ago\n');
  touch(path.join(s.memory, 'stale.md'), '2026-11-19T00:00:00Z');
  assert.equal(run(['--baseline', baseline]).result.handoff, 'UNCHANGED');
  s.put('memory/fresh.md', 'new topic\n');
  assert.equal(run(['--baseline', baseline]).result.handoff, 'WRITTEN');
  assert.ok(row('memory/fresh.md'));
  assert.ok(!row('memory/stale.md'));
  // The baseline moves to what each run saw; a file this session then deletes leaves the manifest.
  assert.ok(JSON.parse(fs.readFileSync(baseline, 'utf8')).rows.some(item => item.path === 'memory/fresh.md'), 'the baseline moves');
  fs.rmSync(path.join(s.memory, 'fresh.md'));
  assert.equal(run(['--baseline', baseline]).result.handoff, 'WRITTEN');
  assert.ok(!row('memory/fresh.md'));
  assert.ok(row('MEMORY.md'), 'a row this session did not delete stays');
  // A manual run still copies everything this session holds.
  assert.equal(run([]).result.handoff, 'WRITTEN');
  assert.match(copy('MEMORY.md'), /old queue/);
});

test('where modified times are not real (a plain copy), only this session\'s own changes are written', t => {
  const s = sources(t);
  const out = path.join(s.base, 'drive');
  const run = runOut(s, out);
  for (const name of ['MEMORY.md', 'owner-rules.md']) touch(path.join(s.memory, name), '2026-11-21T12:00:00Z');
  assert.equal(run(['--memory', s.memory]).result.handoff, 'WRITTEN');
  // An older session's plain copy: every file copied at one moment, MEMORY.md older in content.
  s.put('memory/MEMORY.md', '# Memory\n- old queue\n');
  for (const name of ['MEMORY.md', 'owner-rules.md']) touch(path.join(s.memory, name), '2026-11-21T12:30:00Z');
  const baseline = path.join(s.base, 'baseline.json');
  const seen = require('../scripts/toolkit-handoff.cjs').sessionRows({ memory: s.memory, instructions: null, files: [] });
  fs.writeFileSync(baseline, JSON.stringify({ rows: seen }));
  assert.equal(run(['--baseline', baseline]).result.handoff, 'UNCHANGED', 'not newer: the copy times are not real');
  s.put('memory/owner-rules.md', 'changed here\n');
  touch(path.join(s.memory, 'owner-rules.md'), '2026-11-21T12:30:10Z');
  assert.equal(run(['--baseline', baseline]).result.handoff, 'WRITTEN');
  assert.match(fs.readFileSync(path.join(out, FOLDER, 'memory', 'owner-rules.md'), 'utf8'), /changed here/);
  assert.doesNotMatch(fs.readFileSync(path.join(out, FOLDER, 'MEMORY.md'), 'utf8'), /old queue/);
});

test('a hook-started refresh readies a shallow, detached store clone (as a fresh cloud session has) and saves', t => {
  const w = world(t);
  const s = sources(t);
  aged(s);
  const first = w.act(['handoff', '--repo-root', s.repo, '--memory', s.memory], { handoffState: s.state, now: NOW });
  assert.equal(first.result.handoff, 'SAVED', JSON.stringify(first.result));
  // Replace the store checkout with a fresh shallow clone on a detached HEAD.
  fs.rmSync(w.dir, { recursive: true, force: true });
  git(w.base, 'clone', '--quiet', '--depth', '1', `file://${w.remote}`, w.dir);
  git(w.dir, 'config', 'user.name', 'Test');
  git(w.dir, 'config', 'user.email', 'test@example.invalid');
  git(w.dir, 'checkout', '--quiet', '--detach');
  s.put('memory/MEMORY.md', '# Memory\n- newer\n');
  const baseline = path.join(s.base, 'baseline.json');
  fs.writeFileSync(baseline, JSON.stringify({ rows: [] }));
  // A manual run is refused as before; the hook-started run readies the checkout first.
  assert.notEqual(w.act(['handoff', '--repo-root', s.repo], { handoffState: s.state, now: NOW }).code, 0);
  const hooked = w.act(['handoff', '--repo-root', s.repo, '--baseline', baseline], { handoffState: s.state, now: NOW });
  assert.equal(hooked.result.handoff, 'SAVED', JSON.stringify(hooked.result));
  assert.match(w.remoteFile(`${FOLDER}/MEMORY.md`), /newer/);
  assert.equal(git(w.dir, 'rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git(w.dir, 'symbolic-ref', '--short', 'HEAD'), 'main');
});

test('the hook fails open and never prints', t => {
  const s = sources(t);
  const h = hookHarness(s);
  assert.equal(h.hook.main({ stdin: '{not json', stateDirectory: h.dir }), 0);
  fs.mkdirSync(path.dirname(s.state), { recursive: true });
  fs.writeFileSync(s.state, '{broken');
  assert.equal(h.fire(), 0);
  assert.equal(h.fire({}, { spawn: () => { throw new Error('spawn failed'); } }), 0);
  assert.equal(h.started.length, 0);
});

test('the store command refuses handoff without exactly one of --store or --out, and the hook runs for every tool but known read-only ones', () => {
  for (const argv of [['handoff'], ['handoff', '--store', 'a', '--out', 'b'], ['handoff', '--out', 'b', '--path', 'x'], ['save', '--store', 'x', '--path', 'a', '--message', 'm', '--check']]) {
    assert.equal(store.main(argv, { stdout: () => {}, stderr: () => {} }), 2, argv.join(' '));
  }
  const { READ_ONLY_TOOLS, MATCHER } = hookModule();
  for (const file of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const entry = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks.PostToolUse.at(-1);
    assert.deepEqual(entry, { matcher: MATCHER, hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-handoff-hook.cjs"', timeout: 10 }] }, file);
    const matches = name => new RegExp(entry.matcher).test(name);
    for (const name of READ_ONLY_TOOLS) assert.equal(matches(name), false, name);
    for (const name of ['Bash', 'PowerShell', 'Edit', 'Write', 'update_memory', 'mcp__memory__save', 'SomeFutureTool']) assert.equal(matches(name), true, name);
  }
});
