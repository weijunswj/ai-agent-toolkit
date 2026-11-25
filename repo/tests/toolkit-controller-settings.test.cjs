'use strict';

// Controller settings (#1242 S4): the stack profile, live lanes and gate placement are settings the
// project lines and the GATE ROUTE line are rendered from. Only a controller writes them, on the
// owner's kept words; the reader is default-deny; a write never loses the file it replaces. The
// owner-line lint is in toolkit-owner-lines.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const hostile = require('./support/hostile-inputs.cjs');

const ROOT = path.join(__dirname, '..', '..');
const settingsModule = require('../scripts/toolkit-controller-settings.cjs');
const SCRIPT = path.join(ROOT, 'repo/scripts/toolkit-controller-settings.cjs');
const PROFILES = Object.keys(require('../contracts/controller-kernel/stack-registry-v3.json').profiles);
const DAY = date => () => new Date(`${date}T08:00:00.000Z`);
const NOW = DAY('2026-11-25');
const cp = (...points) => String.fromCodePoint(...points);
const pretty = value => `${JSON.stringify(value, null, 2)}\n`;

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-controller-settings-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cli(argv, { environment = {}, now = NOW } = {}) {
  let out = '', err = '';
  const code = settingsModule.main(argv, { stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } }, environment, now });
  return { code, out, err };
}
const set = (file, flags, options) => cli(['set', '--file', file, ...flags], options);
const render = file => JSON.parse(cli(['render', '--file', file, '--json']).out);
const stored = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const FIRST = ['--repository', 'example-owner/example-repo', '--stack-profile', 'owner-claude'];
function settingsFile(t, flags = ['--live-lanes', '1']) {
  const file = path.join(scratch(t), 'settings.json');
  const made = set(file, [...FIRST, '--placement', 'remote_control,G2=cloud', '--folder', 'C:\\work\\example-repo', ...flags, '--owner-said', 'one lane, G2 in the cloud']);
  assert.equal(made.code, 0, made.err);
  return file;
}
// Runs fn with fs functions replaced, then puts them back.
function withFs(replacements, fn) {
  const real = Object.fromEntries(Object.keys(replacements).map(name => [name, fs[name]]));
  Object.assign(fs, replacements);
  try { return fn(real); } finally { Object.assign(fs, real); }
}

test('row 1: changing live lanes from 1 to 2 changes the rendered project lines and the GATE ROUTE line', t => {
  const file = settingsFile(t);
  const one = render(file);
  assert.equal(one.gate_route, 'GATE ROUTE: profile owner-claude lanes 1 placement remote_control G2=cloud folder C:\\work\\example-repo');
  assert.equal(one.project_lines[0], '- Lanes: 1 working lane (owner, 2026-11-25)');
  const changed = set(file, ['--live-lanes', '2', '--owner-said', 'lanes 2'], { now: () => new Date('2026-11-26T09:00:00.000Z') });
  assert.equal(changed.code, 0, changed.err);
  assert.match(changed.out, /^Changed and read back: live_lanes\.$/m);
  assert.match(changed.out, /Save it to the evidence store at state\/example-owner\/example-repo\/controller-settings\.json with toolkit-store\.cjs save \(governance off: commit and push it there as any custody file, and read it back\)/);
  assert.match(changed.out, /If save reports conflicts, the store's copy won: render again\./);
  const two = render(file);
  assert.equal(two.gate_route, 'GATE ROUTE: profile owner-claude lanes 2 placement remote_control G2=cloud folder C:\\work\\example-repo');
  assert.equal(two.project_lines[0], '- Lanes: 2 working lanes (owner, 2026-11-26)');
  assert.deepEqual(two.project_lines.slice(1), one.project_lines.slice(1), 'only the lanes line moves');
  // The owner's words are kept with the change and with the setting; the same value again changes nothing.
  assert.deepEqual(stored(file).changes.at(-1), { at: '2026-11-26T09:00:00.000Z', keys: ['live_lanes'], owner_said: 'lanes 2' });
  assert.deepEqual(stored(file).said.live_lanes, { at: '2026-11-26T09:00:00.000Z', owner_said: 'lanes 2' });
  assert.match(set(file, ['--live-lanes', '2', '--owner-said', 'lanes 2']).out, /^Nothing changed: the settings already say that\.$/m);
  // The Projects block renders with the settings' lines after it, and says why when it cannot read them.
  const projects = settings => spawnSync(process.execPath, [path.join(ROOT, 'repo/scripts/toolkit-projects-instructions.cjs'), '--render', '--settings', settings], { encoding: 'utf8' });
  const rendered = projects(file);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(rendered.stdout.endsWith(`-->\n\n${two.project_lines.join('\n')}\n`), rendered.stdout.slice(-400));
  const missing = projects(`${file}.none`);
  assert.deepEqual([missing.status, missing.stdout], [2, '']);
  assert.match(missing.stderr, /^There are no controller settings yet/);
});

test('the lanes line names the owner only for a number the owner set, with the date they set it', t => {
  const file = path.join(scratch(t), 'settings.json');
  assert.equal(set(file, [...FIRST, '--owner-said', 'use owner-claude here']).code, 0);
  assert.equal(render(file).project_lines[0], '- Lanes: 1 working lane', 'the owner gave no number');
  // The owner says the number that is also the default: it is recorded and named.
  assert.equal(set(file, ['--live-lanes', '1', '--owner-said', 'one lane'], { now: DAY('2026-11-26') }).code, 0);
  assert.equal(render(file).project_lines[0], '- Lanes: 1 working lane (owner, 2026-11-26)');
  assert.equal(set(file, ['--live-lanes', '3', '--owner-said', 'lanes 3'], { now: DAY('2026-11-27') }).code, 0);
  // Changes of other settings, even enough to drop the record of this one, move neither date nor words.
  for (let day = 1; day <= 25; day += 1) assert.equal(set(file, ['--device', `dev-${day}`, '--owner-said', `device ${day}`], { now: DAY(`2026-12-${String(day).padStart(2, '0')}`) }).code, 0);
  assert.equal(stored(file).changes.length, 20);
  assert.ok(stored(file).changes.every(change => !change.keys.includes('live_lanes')));
  assert.equal(render(file).project_lines[0], '- Lanes: 3 working lanes (owner, 2026-11-27)');
  assert.equal(stored(file).said.live_lanes.owner_said, 'lanes 3');
  // A placement or profile the owner says again for the first time is recorded the same way.
  const other = path.join(scratch(t), 'settings.json');
  set(other, [...FIRST, '--owner-said', 'use owner-claude here']);
  assert.match(set(other, ['--placement', 'remote_control', '--owner-said', 'gates on my computer']).out, /^Changed and read back: placement\.$/m);
});

// ---- Who may write (closure matrix: role x row x state) ---------------------------------------

// A session whose first prompt is `brief`, as the host writes it, and the environment that names it.
function session(t, brief) {
  const host = scratch(t);
  const folder = path.join(host, 'projects', 'p');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'session-1.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: brief } })}\n`);
  return { CLAUDE_CODE_SESSION_ID: 'session-1', CLAUDE_CONFIG_DIR: host };
}
const ROUTES = { G0: 'DISCOVERY opus-5.5/high', G1: 'BUILDER opus-5.5/high', G2: 'REVIEWER opus-5.5/xhigh', 'design challenge': 'DESIGN_CHALLENGE opus-5.5/xhigh' };

test('only the controller changes settings, on the owner\'s word: gates and launcher-bound helpers are refused', t => {
  const file = settingsFile(t);
  const text = fs.readFileSync(file, 'utf8');
  const attempt = environment => set(file, ['--live-lanes', '3', '--owner-said', 'lanes 3'], { environment });
  const refused = [
    ...['G0', 'G1', 'G2'].map(role => [`launcher mark ${role}`, { TOOLKIT_GATE_ROLE: role }, new RegExp(`^A ${role} session cannot change controller settings`)]),
    ['another launcher mark', { TOOLKIT_GATE_ROLE: 'reviewer' }, /^A gate session cannot change/],
    ['a launcher-bound helper', { TOOLKIT_NATIVE_HELPER_BINDING: 'helper.json' }, /^A session a Toolkit launcher started as a helper cannot change/],
    ['a launcher task profile', { TOOLKIT_CLAUDE_TASK_PROFILE_SHA256: 'a'.repeat(64) }, /as a helper cannot change/],
    ...Object.entries(ROUTES).map(([gate, route]) => [`brief ${gate}`, session(t, `Gate: ${gate}\nRoute: owner-claude ${route}\nAssignment: probe\n\nDo it.`), gate === 'design challenge' ? /^A design challenge session cannot change/ : new RegExp(`^A ${gate} session cannot change`)]),
    // A gate that is off its route is still a gate.
    ['a brief off its pin', session(t, 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/low\n\nDo it.'), /^A G1 session cannot change/],
  ];
  for (const [name, environment, said] of refused) {
    const result = attempt(environment);
    assert.equal(result.code, 1, name);
    assert.match(result.err, said, name);
  }
  assert.match(set(file, ['--live-lanes', '3']).err, /Pass the owner's own words with --owner-said/);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'nothing was written');
  // Reading is open to them, and an ordinary chat that is neither is the controller's own.
  assert.equal(cli(['show', '--file', file], { environment: { TOOLKIT_GATE_ROLE: 'G1' } }).code, 0);
  for (const [lanes, brief] of [['3', 'You are taking over as controller for example-owner/example-repo.'], ['4', 'Gate: none\nRoute: owner-claude BUILDER opus-5.5/high\n\nKeep the records.'], ['5', 'Gate: please check the side gate']]) {
    const allowed = set(file, ['--live-lanes', lanes, '--owner-said', `lanes ${lanes}`], { environment: session(t, brief) });
    assert.equal(allowed.code, 0, `${brief}: ${allowed.err}`);
  }
});

test('every state of the flow (governance on, off or undecided, project host or chat, store reachable or not) gives the same answer by role', t => {
  const states = {
    'governance on': { binding: 'enabled' },
    'governance off': { binding: 'disabled' },
    'no binding': {},
    'project host': { binding: 'enabled', environment: { TOOLKIT_HOST_SESSION: 'project-thread' } },
    'store not reachable here': { binding: 'enabled', environment: { PATH: '' } },
  };
  const outcomes = {};
  for (const [name, { binding, environment = {} }] of Object.entries(states)) {
    const dir = scratch(t);
    fs.mkdirSync(path.join(dir, '.github'));
    if (binding) fs.writeFileSync(path.join(dir, '.github', 'toolkit-programme.json'), JSON.stringify({ version: 2, governance: binding, repository: 'example-owner/example-repo' }));
    const keep = Object.fromEntries(['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const base = { ...keep, HOME: dir, USERPROFILE: dir, ...environment };
    const run = (args, extra = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...base, ...extra } });
    const write = extra => run(['set', '--file', 'settings.json', ...FIRST, '--live-lanes', '2', '--owner-said', 'lanes 2'], extra);
    outcomes[name] = {
      gate: write({ TOOLKIT_GATE_ROLE: 'G1' }).status,
      helper: write({ TOOLKIT_NATIVE_HELPER_BINDING: 'helper.json' }).status,
      controller: write().status,
      read: run(['render', '--file', 'settings.json']).stdout.replace(/\d{4}-\d{2}-\d{2}/g, 'DATE'),
      files: fs.readdirSync(dir).filter(entry => entry !== '.github'),
    };
  }
  const expected = { gate: 1, helper: 1, controller: 0, files: ['settings.json'],
    read: 'Project lines:\n- Lanes: 2 working lanes (owner, DATE)\n- Stack profile: owner-claude\n- Gates run on this device by Remote Control.\n\nProject memory line:\nGATE ROUTE: profile owner-claude lanes 2 placement remote_control\n' };
  for (const name of Object.keys(states)) assert.deepEqual(outcomes[name], expected, name);
});

test('bad values are refused before anything is written', t => {
  const file = settingsFile(t);
  const text = fs.readFileSync(file, 'utf8');
  for (const bad of [['--live-lanes', '0'], ['--live-lanes', '10'], ['--placement', 'laptop'], ['--placement', 'cloud,G3=cloud'], ['--placement', 'cloud,G2=any,G2=cloud'],
    ...['not a repo', 'example-owner/..', 'example-owner/.', 'example-owner/repo.git', 'example-owner/repo.GIT', '-x/repo'].map(name => ['--repository', name])]) {
    assert.equal(set(file, [...bad, '--owner-said', 'x']).code, 2, bad.join(' '));
  }
  assert.equal(set(file, ['--repository', 'example-owner/.github', '--owner-said', 'x']).code, 0, 'a repository may start with a full stop');
  fs.writeFileSync(file, text);
  assert.equal(set(file, ['--stack-profile', 'no-such-profile', '--owner-said', 'x']).code, 1, 'a profile the registry does not have');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  // A first set needs the repository and the profile, and says so.
  for (const flags of [['--live-lanes', '1'], ['--placement', 'remote_control'], ['--repository', 'example-owner/example-repo'], ['--stack-profile', 'owner-claude']]) {
    const first = set(`${file}.new`, [...flags, '--owner-said', 'x']);
    assert.deepEqual([first.code, first.err], [2, 'There are no controller settings yet: the first set needs --repository and --stack-profile.\n'], flags.join(' '));
  }
  assert.ok(!fs.existsSync(`${file}.new`));
});

test('the owner\'s words are kept as they said them, and only text that could mislead a reader is refused', t => {
  const file = settingsFile(t);
  const phone = `it${cp(0x2019)}s fine ${cp(0x1f44d, 0x1f3fd)}\nlanes 2 ${cp(0x2013)} no more`;
  const said = set(file, ['--live-lanes', '2', '--owner-said', phone]);
  assert.equal(said.code, 0, said.err);
  assert.equal(stored(file).said.live_lanes.owner_said, phone);
  assert.equal(cli(['render', '--file', file]).code, 0, 'the file with those words reads back');
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, words] of [['empty', ''], ['blank', ' \n'], ['too long', 'a'.repeat(501)], ['escape', `a${cp(0x1b)}[2J`], ['null', `a${cp(0)}b`], ['bidirectional override', `a${cp(0x202e)}b`], ['bidirectional isolate', `a${cp(0x2066)}b`], ['line separator', `a${cp(0x2028)}b`], ['broken pair', `a${String.fromCharCode(0xd83d)}b`]]) {
    assert.equal(set(file, ['--live-lanes', '3', '--owner-said', words]).code, 2, name);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

// ---- The reader -------------------------------------------------------------------------------

const read = text => { try { settingsModule.readSettings(text, PROFILES); return true; } catch (error) { assert.equal(error.code, 'SETTINGS_INVALID', error.stack); return false; } };

test('the settings reader is default-deny: unknown keys, types, characters and forms make the file unreadable', t => {
  const file = settingsFile(t);
  const bytes = fs.readFileSync(file);
  const good = JSON.parse(bytes);
  assert.equal(read(bytes), true);
  const change = good.changes[0];
  for (const [name, value] of [
    ['extra key', { ...good, lanes: 2 }],
    ['prototype key', JSON.parse(`{"__proto__":{},${JSON.stringify(good).slice(1)}`)],
    ['other schema', { ...good, schema: 'toolkit.controller-settings.v2' }],
    ['lanes as text', { ...good, live_lanes: '2' }],
    ['lanes zero', { ...good, live_lanes: 0 }],
    ['lanes ten', { ...good, live_lanes: 10 }],
    ['lanes one and a half', { ...good, live_lanes: 1.5 }],
    ['unknown place', { ...good, placement: { default: 'laptop' } }],
    ['unknown gate', { ...good, placement: { default: 'cloud', gates: { G9: 'cloud' } } }],
    ['placement extra key', { ...good, placement: { ...good.placement, owner: 'me' } }],
    ['unknown profile', { ...good, stack_profile: 'no-such-profile' }],
    ['repository outside its folder', { ...good, repository: 'example-owner/..' }],
    ['no said', (({ said, ...rest }) => rest)(good)],
    ['said for another key', { ...good, said: { ...good.said, repository: good.said.live_lanes } }],
    ['said without words', { ...good, said: { live_lanes: { at: change.at } } }],
    ['said with an extra key', { ...good, said: { live_lanes: { ...good.said.live_lanes, by: 'me' } } }],
    ['no changes', { ...good, changes: [] }],
    ['too many changes', { ...good, changes: Array(21).fill(change) }],
    ['change without words', { ...good, changes: [{ at: change.at, keys: change.keys }] }],
    ['change of no key', { ...good, changes: [{ ...change, keys: [] }] }],
    ['impossible day', { ...good, changes: [{ ...change, at: '2026-02-31T08:00:00.000Z' }] }],
    ['impossible hour', { ...good, said: { ...good.said, live_lanes: { ...good.said.live_lanes, at: '2026-02-01T25:00:00.000Z' } } }],
    ['date only', { ...good, changes: [{ ...change, at: '2026-02-01' }] }],
  ]) assert.equal(read(pretty(value)), false, name);
  const text = bytes.toString();
  for (const [name, form] of [
    ['a repeated key', text.replace('"live_lanes": 1', '"live_lanes": 1,\n  "live_lanes": 9')],
    ['a repeated key in placement', text.replace('"default": "remote_control"', '"default": "remote_control",\n    "default": "cloud"')],
    ['one line', JSON.stringify(good)],
    ['a comment', `// settings\n${text}`],
    ['no final newline', text.trimEnd()],
    ['two documents', `${text}${text}`],
    ['over 64 KB', pretty({ ...good, changes: [{ ...change, keys: Array(6000).fill('placement') }] })],
    ['empty', ''],
  ]) assert.equal(read(form), false, name);
  assert.equal(read(Buffer.concat([bytes.subarray(0, 20), Buffer.from([0xe9]), bytes.subarray(20)])), false, 'not UTF-8');
});

test('hostile inputs: as the whole file, as another line-break form, inside the text and as each free value', t => {
  const bytes = fs.readFileSync(settingsFile(t));
  const text = bytes.toString();
  const good = JSON.parse(text);
  const shapes = hostile.shapes.filter(shape => typeof shape.text === 'string' && shape.text.length < 4000);
  hostile.expectDefaultDeny(assert, (value, shape) => read(shape.bytes || value), hostile.shapes);
  // Only CRLF, which a checkout may give, reads as the same file.
  hostile.expectDefaultDeny(assert, value => read(value), hostile.variants(text), { allow: ['crlf'] });
  // Put before, after and between two lines of a good file, none reads as a good file.
  const lines = text.split('\n');
  for (const place of [0, 3, lines.length - 1]) hostile.expectDefaultDeny(assert, value => read([...lines.slice(0, place), value, ...lines.slice(place)].join('\n')), shapes);
  // As a value: only the named plain ones are a folder, a device or the owner's words.
  const names = ['name-yaml-number', 'name-yaml-boolean', 'name-letter-case'];
  hostile.expectDefaultDeny(assert, value => read(pretty({ ...good, placement: { ...good.placement, device: value } })), shapes, { allow: names });
  hostile.expectDefaultDeny(assert, value => read(pretty({ ...good, placement: { ...good.placement, folder: value } })), shapes, { allow: [...names,
    'null-~', 'null-null', 'null-Null', 'null-NULL', 'null-empty', 'space-before-colon', 'count-after-number', 'refusal-cancelled', 'refusal-holding', 'condition-should-ci-pass'] });
  // The words are kept, never rendered: what they may not hold is control and override characters.
  const unsafe = shape => shape.points.some(point => (point < 0xa0 && ![0x09, 0x0d].includes(point)) || [0x2028, 0x2029].includes(point));
  const accepted = shapes.filter(shape => !unsafe(shape) && shape.text.trim()).map(shape => shape.id);
  hostile.expectDefaultDeny(assert, value => read(pretty({ ...good, changes: [{ ...good.changes[0], owner_said: value }] })), shapes, { allow: accepted });
  assert.ok(shapes.some(unsafe));
});

// ---- The write --------------------------------------------------------------------------------

test('a failed write keeps the settings file and says what it holds now', t => {
  const file = settingsFile(t);
  const text = fs.readFileSync(file, 'utf8');
  const change = () => set(file, ['--live-lanes', '4', '--owner-said', 'lanes 4']);
  const half = withFs({ writeFileSync: (target, data, ...rest) => { realWrite(target, String(data).slice(0, 40), ...rest); throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } }, change);
  assert.deepEqual([half.code, half.err], [1, 'The write failed (ENOSPC). The file is unchanged (read back).\n']);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'the file is never written in place');
  const busy = withFs({ renameSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } }, change);
  assert.deepEqual([busy.code, busy.err], [1, 'The write failed (EBUSY). The file is unchanged (read back).\n']);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  // Another writer's change between the read and the rename is kept, not overwritten.
  const other = text.replace('"live_lanes": 1', '"live_lanes": 7');
  const raced = withFs({ writeFileSync: (target, ...rest) => { realWrite(target, ...rest); realWrite(file, other); } }, change);
  assert.deepEqual([raced.code, raced.err], [1, 'It changed while this ran, so nothing was written. Run it again.\n']);
  assert.equal(fs.readFileSync(file, 'utf8'), other);
  // A write that does not read back the same is never reported as done.
  fs.writeFileSync(file, text);
  const wrong = withFs({ renameSync: (from, to) => { realRename(from, to); realWrite(to, other); } }, change);
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /did not read back the same/);
  assert.equal(wrong.out, '');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'], 'no temporary file is left');
});

test('a linked settings file stays a link', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, t => {
  const file = settingsFile(t);
  const link = path.join(scratch(t), 'link.json');
  fs.symlinkSync(file, link);
  assert.equal(set(link, ['--live-lanes', '2', '--owner-said', 'lanes 2']).code, 0);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(stored(file).live_lanes, 2);
});

test('a profile the registry dropped is repaired by setting another, and holds everything else', t => {
  const file = settingsFile(t);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"stack_profile": "owner-claude"', '"stack_profile": "dropped-profile"'));
  assert.equal(cli(['render', '--file', file]).code, 1);
  assert.equal(set(file, ['--live-lanes', '2', '--owner-said', 'x']).code, 1);
  assert.equal(set(file, ['--stack-profile', 'owner-claude', '--owner-said', 'back to owner-claude']).code, 0);
  assert.equal(render(file).project_lines[1], '- Stack profile: owner-claude');
});

const realWrite = fs.writeFileSync;
const realRename = fs.renameSync;
