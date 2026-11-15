'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'skills', 'external-operation-preflight', 'scripts', 'recovery-identity.cjs');
const { IDENTITY_FIELDS, REASONS, RECORD_SCHEMA, parseArgs, run } = require(scriptPath);

const NOW = Date.parse('2026-11-15T00:00:00Z');
const IDENTITY = Object.freeze({
  provider: 'github', scope: 'owner/evidence-store', environment: 'scratch', kind: 'branch', name: 'scratch/recovery-uat',
  cleanup_owner: 'controller', end_date: '2026-11-30'
});
const HANDLE = 'refs/heads/scratch/recovery-uat';
const FOUND = Object.freeze({ ...IDENTITY, handle: HANDLE, exists: true });
const GONE = Object.freeze({ ...IDENTITY, handle: HANDLE, exists: false });

const temps = [];
test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-identity-'));
  temps.push(dir);
  return dir;
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function stateFile(stateDir) {
  return path.join(stateDir, 'uat.json');
}

// A state folder holding key `uat` in one of the four states a record can be in.
function seed(state) {
  const root = tempDir();
  const stateDir = path.join(root, 'state');
  if (state === 'absent') return { root, stateDir };
  fs.mkdirSync(stateDir);
  if (state === 'damaged') {
    fs.writeFileSync(stateFile(stateDir), '{"schema":');
    return { root, stateDir };
  }
  const identity = { ...IDENTITY };
  const record = { schema: RECORD_SCHEMA, key: 'uat', state, identity, claimed_at: '2026-11-14T00:00:00.000Z' };
  if (state === 'confirmed') Object.assign(record, { handle: HANDLE, confirmed_at: '2026-11-14T00:01:00.000Z' });
  fs.writeFileSync(stateFile(stateDir), JSON.stringify(record));
  return { root, stateDir };
}

// The record's state after a command: absent, claimed, confirmed or damaged.
function stateAfter(stateDir) {
  let raw;
  try {
    raw = fs.readFileSync(stateFile(stateDir), 'utf8');
  } catch {
    return 'absent';
  }
  try {
    return JSON.parse(raw).state;
  } catch {
    return 'damaged';
  }
}

function runCommand(state, command, input) {
  const { root, stateDir } = seed(state);
  const argv = [command, '--key', 'uat', '--state-dir', stateDir];
  if (command === 'claim') argv.push('--identity', writeJson(root, 'identity.json', input));
  else if (input !== undefined) argv.push('--read-back', writeJson(root, 'read-back.json', input));
  const result = run(parseArgs(argv), NOW);
  return { result, after: stateAfter(stateDir) };
}

const MISMATCH = { ...FOUND, scope: 'owner/other-repo' };
const OTHER_HANDLE = { ...FOUND, handle: 'refs/heads/scratch/recovery-uat-2' };
const GONE_NO_HANDLE = { ...IDENTITY, exists: false };

// Closure matrix: every record state x every command and read-back shape. Each row is
// [state, command, input, verdict, reason or null, state after]. A HOLD never changes the record.
const MATRIX = [
  ['absent', 'claim', IDENTITY, 'OK', null, 'claimed'],
  ['absent', 'record', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_MISSING, 'absent'],
  ['absent', 'resolve', undefined, 'HOLD', REASONS.RECOVERY_IDENTITY_MISSING, 'absent'],
  ['absent', 'check', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_MISSING, 'absent'],
  ['absent', 'dispose', GONE, 'HOLD', REASONS.RECOVERY_IDENTITY_MISSING, 'absent'],

  ['claimed', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'claimed'],
  ['claimed', 'record', FOUND, 'OK', null, 'confirmed'],
  ['claimed', 'record', MISMATCH, 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'claimed'],
  ['claimed', 'record', GONE, 'HOLD', REASONS.RECOVERY_RESOURCE_GONE, 'claimed'],
  ['claimed', 'resolve', undefined, 'HOLD', REASONS.RECOVERY_IDENTITY_UNCLEAR, 'claimed'],
  ['claimed', 'check', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_UNCLEAR, 'claimed'],
  ['claimed', 'check', GONE, 'HOLD', REASONS.RECOVERY_IDENTITY_UNCLEAR, 'claimed'],
  ['claimed', 'dispose', GONE_NO_HANDLE, 'OK', null, 'absent'],
  ['claimed', 'dispose', FOUND, 'HOLD', REASONS.RECOVERY_RESOURCE_STILL_PRESENT, 'claimed'],
  ['claimed', 'dispose', { ...GONE, scope: 'owner/other-repo' }, 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'claimed'],

  ['confirmed', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'confirmed'],
  ['confirmed', 'record', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'confirmed'],
  ['confirmed', 'resolve', undefined, 'OK', null, 'confirmed'],
  ['confirmed', 'check', FOUND, 'OK', null, 'confirmed'],
  ['confirmed', 'check', MISMATCH, 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'confirmed'],
  ['confirmed', 'check', OTHER_HANDLE, 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'confirmed'],
  ['confirmed', 'check', GONE, 'HOLD', REASONS.RECOVERY_RESOURCE_GONE, 'confirmed'],
  ['confirmed', 'dispose', GONE, 'OK', null, 'absent'],
  ['confirmed', 'dispose', GONE_NO_HANDLE, 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'confirmed'],
  ['confirmed', 'dispose', FOUND, 'HOLD', REASONS.RECOVERY_RESOURCE_STILL_PRESENT, 'confirmed'],
  ['confirmed', 'dispose', { ...GONE, kind: 'tag' }, 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'confirmed'],

  ['damaged', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'damaged'],
  ['damaged', 'record', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'damaged'],
  ['damaged', 'resolve', undefined, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'damaged'],
  ['damaged', 'check', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'damaged'],
  ['damaged', 'dispose', GONE, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'damaged']
];

// Every identity field on its own: a read-back that differs only there holds, and nothing changes.
for (const field of IDENTITY_FIELDS) {
  const differ = (readBack) => ({ ...readBack, [field]: `${readBack[field]}-other` });
  MATRIX.push(
    ['claimed', 'record', differ(FOUND), 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'claimed'],
    ['confirmed', 'check', differ(FOUND), 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'confirmed'],
    ['confirmed', 'dispose', differ(GONE), 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'confirmed'],
    ['claimed', 'dispose', differ(GONE_NO_HANDLE), 'HOLD', REASONS.RECOVERY_IDENTITY_MISMATCH, 'claimed']
  );
}

test('closure matrix: each record state and command gives its expected verdict and leaves the expected state', () => {
  for (const [state, command, input, verdict, reason, after] of MATRIX) {
    const label = `${state} + ${command}${input && input !== IDENTITY ? ` (${JSON.stringify(input)})` : ''}`;
    const outcome = runCommand(state, command, input);
    assert.equal(outcome.result.verdict, verdict, label);
    assert.equal(outcome.result.reason, reason === null ? undefined : reason, label);
    assert.equal(outcome.after, after, label);
  }
});

test('record keeps the exact handle the provider read back, and resolve returns it with the scope', () => {
  const { root, stateDir } = seed('claimed');
  const recorded = run(parseArgs(['record', '--key', 'uat', '--state-dir', stateDir, '--read-back', writeJson(root, 'rb.json', FOUND)]), NOW);
  assert.equal(recorded.record.handle, HANDLE);
  const resolved = run(parseArgs(['resolve', '--key', 'uat', '--state-dir', stateDir]), NOW);
  assert.equal(resolved.record.handle, HANDLE);
  // A second claim on the key shows the session the record it must use instead.
  const again = run(parseArgs(['claim', '--key', 'uat', '--state-dir', stateDir, '--identity', writeJson(root, 'identity.json', IDENTITY)]), NOW);
  assert.equal(again.reason, REASONS.RECOVERY_IDENTITY_EXISTS);
  assert.equal(again.record.handle, HANDLE);
  assert.equal(resolved.record.identity.scope, IDENTITY.scope);
  assert.match(resolved.detail, /read back that exact handle/);
});

test('a record that is valid JSON but the wrong shape is unreadable, never trusted', () => {
  const damaged = [
    { schema: RECORD_SCHEMA, key: 'other', state: 'confirmed', identity: IDENTITY, handle: HANDLE },
    { schema: RECORD_SCHEMA, key: 'uat', state: 'confirmed', identity: IDENTITY },
    { schema: RECORD_SCHEMA, key: 'uat', state: 'pending', identity: IDENTITY },
    { schema: RECORD_SCHEMA, key: 'uat', state: 'claimed', identity: { ...IDENTITY, scope: '' } },
    { schema: 'other', key: 'uat', state: 'claimed', identity: IDENTITY },
    { schema: RECORD_SCHEMA, key: 'uat', state: 'confirmed', identity: IDENTITY, handle: `ghp_${'f'.repeat(36)}` }
  ];
  for (const record of damaged) {
    const { stateDir } = seed('absent');
    fs.mkdirSync(stateDir);
    fs.writeFileSync(stateFile(stateDir), JSON.stringify(record));
    const result = run(parseArgs(['resolve', '--key', 'uat', '--state-dir', stateDir]), NOW);
    assert.equal(result.reason, REASONS.RECOVERY_IDENTITY_UNREADABLE, JSON.stringify(record));
  }
});

test('invalid or secret-bearing inputs hold without writing or echoing the value', () => {
  const secret = `ghp_${'d'.repeat(36)}`;
  const rows = [
    ['absent', 'claim', { ...IDENTITY, name: secret }, REASONS.SECRET_IN_INPUT],
    ['absent', 'claim', { ...IDENTITY, token: 'raw-value' }, REASONS.SECRET_IN_INPUT],
    ['absent', 'claim', { ...IDENTITY, cleanup_owner: '' }, REASONS.INPUT_INVALID],
    ['absent', 'claim', { ...IDENTITY, end_date: '2026-02-30' }, REASONS.INPUT_INVALID],
    ['absent', 'claim', { ...IDENTITY, end_date: '2026-11-14' }, REASONS.INPUT_INVALID],
    ['absent', 'claim', [IDENTITY], REASONS.INPUT_INVALID],
    ['claimed', 'record', { ...FOUND, handle: secret }, REASONS.SECRET_IN_INPUT],
    ['claimed', 'record', { ...FOUND, handle: '' }, REASONS.INPUT_INVALID],
    ['claimed', 'record', { ...FOUND, exists: 'yes' }, REASONS.INPUT_INVALID],
    ['confirmed', 'check', { ...FOUND, provider: '' }, REASONS.INPUT_INVALID],
    ['confirmed', 'dispose', { ...GONE, exists: undefined }, REASONS.INPUT_INVALID]
  ];
  for (const [state, command, input, reason] of rows) {
    const outcome = runCommand(state, command, input);
    assert.equal(outcome.result.reason, reason, `${state} ${command} ${JSON.stringify(input)}`);
    assert.equal(outcome.after, state);
    assert.ok(!JSON.stringify(outcome.result).includes(secret));
  }
});

// One record per resource: rows of [another key's record, command on key uat, its input, verdict, reason
// or null, uat's state after]. Same resource means same provider, scope, kind and name, ignoring case and
// the environment label. The other key's record never changes.
function otherRecord(state, identity, handle) {
  const record = { schema: RECORD_SCHEMA, key: 'other', state, identity: { ...IDENTITY, ...identity }, claimed_at: '2026-11-14T00:00:00.000Z' };
  if (state === 'confirmed') record.handle = handle;
  return JSON.stringify(record);
}

const OTHER_NAME = { name: 'scratch/another-branch' };
const ONE_RECORD_PER_RESOURCE = [
  [otherRecord('claimed', {}), 'absent', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'absent'],
  [otherRecord('confirmed', {}, HANDLE), 'absent', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'absent'],
  [otherRecord('confirmed', { name: IDENTITY.name.toUpperCase() }, HANDLE), 'absent', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'absent'],
  [otherRecord('confirmed', { environment: 'other-label' }, HANDLE), 'absent', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'absent'],
  [otherRecord('confirmed', { scope: 'owner/other-repo' }, HANDLE), 'absent', 'claim', IDENTITY, 'OK', null, 'claimed'],
  [otherRecord('confirmed', { kind: 'tag' }, HANDLE), 'absent', 'claim', IDENTITY, 'OK', null, 'claimed'],
  [otherRecord('confirmed', { provider: 'gitlab' }, HANDLE), 'absent', 'claim', IDENTITY, 'OK', null, 'claimed'],
  [otherRecord('confirmed', OTHER_NAME, 'refs/heads/scratch/another-branch'), 'absent', 'claim', IDENTITY, 'OK', null, 'claimed'],
  ['{"schema":', 'absent', 'claim', IDENTITY, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'absent'],
  [otherRecord('confirmed', OTHER_NAME, HANDLE), 'claimed', 'record', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'claimed'],
  [otherRecord('confirmed', OTHER_NAME, HANDLE.toUpperCase()), 'claimed', 'record', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_EXISTS, 'claimed'],
  [otherRecord('confirmed', { ...OTHER_NAME, scope: 'owner/other-repo' }, HANDLE), 'claimed', 'record', FOUND, 'OK', null, 'confirmed'],
  [otherRecord('claimed', OTHER_NAME), 'claimed', 'record', FOUND, 'OK', null, 'confirmed'],
  ['{"schema":', 'claimed', 'record', FOUND, 'HOLD', REASONS.RECOVERY_IDENTITY_UNREADABLE, 'claimed']
];

test('one record per resource: a resource another key holds is never claimed or recorded again', () => {
  for (const [other, state, command, input, verdict, reason, after] of ONE_RECORD_PER_RESOURCE) {
    const { root, stateDir } = seed(state);
    fs.mkdirSync(stateDir, { recursive: true });
    const otherFile = path.join(stateDir, 'other.json');
    fs.writeFileSync(otherFile, other);
    const argv = [command, '--key', 'uat', '--state-dir', stateDir];
    argv.push(command === 'claim' ? '--identity' : '--read-back', writeJson(root, 'input.json', input));
    const result = run(parseArgs(argv), NOW);
    const label = `${other} + ${state} ${command}`;
    assert.equal(result.verdict, verdict, label);
    assert.equal(result.reason, reason === null ? undefined : reason, label);
    assert.equal(stateAfter(stateDir), after, label);
    assert.equal(fs.readFileSync(otherFile, 'utf8'), other, label);
    if (reason === REASONS.RECOVERY_IDENTITY_EXISTS) assert.equal(result.record.key, 'other', label);
  }
});

test('usage errors exit 1 and never echo the input file', () => {
  const root = tempDir();
  const secretJson = writeJson(root, 'bad.json', `{"name": "ghp_${'e'.repeat(36)}"`);
  const identity = writeJson(root, 'identity.json', IDENTITY);
  const rows = [
    [],
    ['create', '--key', 'uat'],
    ['resolve'],
    ['resolve', '--key', '../uat'],
    ['resolve', '--key', 'UAT'],
    ['resolve', '--key', 'uat', '--state-dir', 'relative/dir'],
    ['resolve', '--key', 'uat', '--key', 'uat'],
    ['resolve', '--key', 'uat', '--read-back', identity],
    ['claim', '--key', 'uat'],
    ['claim', '--key', 'uat', '--read-back', identity],
    ['claim', '--key', 'uat', '--identity', secretJson, '--state-dir', root],
    ['claim', '--key', 'uat', '--identity', path.join(root, 'missing.json'), '--state-dir', root],
    ['check', '--key', 'uat', '--state-dir', root],
    ['resolve', '--key', 'uat', '--verbose']
  ];
  for (const argv of rows) {
    const child = spawnSync(process.execPath, [scriptPath, ...argv], { encoding: 'utf8' });
    assert.equal(child.status, 1, argv.join(' '));
    assert.equal(child.stdout, '');
    assert.ok(!child.stderr.includes('ghp_'), argv.join(' '));
  }
  assert.ok(!fs.existsSync(path.join(root, 'uat.json')));
});

test('a fresh process finds the exact resource from the record alone, then disposal deletes the record', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  // Each step is its own process with no shared memory; the default state folder lives under the home folder.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const cli = (...argv) => {
    const child = spawnSync(process.execPath, [scriptPath, ...argv, '--key', 'uat'], { encoding: 'utf8', env });
    return { status: child.status, result: child.stdout ? JSON.parse(child.stdout) : null };
  };
  // The script reads the real clock here, so the end date is set from it.
  const identity = { ...IDENTITY, end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) };
  assert.equal(cli('claim', '--identity', writeJson(root, 'identity.json', identity)).status, 0);
  assert.equal(cli('claim', '--identity', writeJson(root, 'identity.json', identity)).result.reason, REASONS.RECOVERY_IDENTITY_EXISTS);
  assert.equal(cli('record', '--read-back', writeJson(root, 'found.json', FOUND)).status, 0);
  const resolved = cli('resolve');
  assert.equal(resolved.status, 0);
  assert.equal(resolved.result.record.handle, HANDLE);
  const recordFile = path.join(home, '.ai-agent-toolkit', 'recovery-identities', 'uat.json');
  assert.ok(fs.existsSync(recordFile));
  assert.equal(cli('check', '--read-back', writeJson(root, 'found.json', FOUND)).status, 0);
  assert.equal(cli('dispose', '--read-back', writeJson(root, 'found.json', FOUND)).status, 2);
  assert.equal(cli('dispose', '--read-back', writeJson(root, 'gone.json', GONE)).status, 0);
  assert.ok(!fs.existsSync(recordFile));
  const after = cli('resolve');
  assert.equal(after.status, 2);
  assert.equal(after.result.reason, REASONS.RECOVERY_IDENTITY_MISSING);
});

test('a claim made by another session after this one looked still wins: the create is exclusive', () => {
  const { root, stateDir } = seed('claimed');
  const before = fs.readFileSync(stateFile(stateDir), 'utf8');
  // This session reads no record (the other session had not written yet), then tries to write its own.
  const realRead = fs.readFileSync;
  fs.readFileSync = function readFileSync(file, ...rest) {
    if (file === stateFile(stateDir)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    return realRead.call(this, file, ...rest);
  };
  let result;
  try {
    result = run(parseArgs(['claim', '--key', 'uat', '--state-dir', stateDir, '--identity', writeJson(root, 'identity.json', IDENTITY)]), NOW);
  } finally {
    fs.readFileSync = realRead;
  }
  assert.equal(result.reason, REASONS.RECOVERY_IDENTITY_EXISTS);
  assert.equal(fs.readFileSync(stateFile(stateDir), 'utf8'), before);
});

test('the recovery identity rules name every reason the script can return, and the skill links them', () => {
  const skillRoot = path.join(repoRoot, 'skills', 'external-operation-preflight');
  const rules = fs.readFileSync(path.join(skillRoot, 'references', 'recovery-identity.md'), 'utf8');
  for (const code of Object.values(REASONS)) assert.ok(rules.includes(code), `the rules should explain ${code}`);
  assert.ok(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8').includes('(references/recovery-identity.md)'));
});
