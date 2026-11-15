#!/usr/bin/env node
'use strict';

// Recovery identity for a temporary outside resource that later work depends on, such as a scratch
// branch, preview app or restore database. It keeps the exact provider handle in one local Toolkit
// state file, so a fresh session finds that one resource without guessing, listing the provider or
// creating a duplicate. The failure it prevents: a session that lost its chat memory makes a second
// resource, or picks the wrong one by name.
//
// Lifecycle of one key: absent -> claim (before creating; the exact name and scope) -> record (after
// creating; the provider read-back gives the handle) -> resolve and check (any later session) ->
// dispose (after removal; the provider read-back says it is gone, and the file is deleted).
// Anything missing, half-done, unreadable or different from the provider holds the work.
//
// Offline: it never calls a provider and reads no credentials. Every read-back file must hold what
// the provider itself returned for the exact handle or name, never a listing or a label. It writes
// only its own files in the state folder (default ~/.ai-agent-toolkit/recovery-identities).
// Long-lived identities belong in the platform's own configuration and reusable owner credentials in
// toolkit env, not here.
//
// Usage: node recovery-identity.cjs claim --key <key> --identity <identity.json> [--state-dir <dir>]
//        node recovery-identity.cjs record|check|dispose --key <key> --read-back <read-back.json> [--state-dir <dir>]
//        node recovery-identity.cjs resolve --key <key> [--state-dir <dir>]
// Exit codes: 0 OK, 2 HOLD, 1 usage error.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findSecrets, parseDate } = require('./preflight-check.cjs');

const RECORD_SCHEMA = 'toolkit.recovery-identity.v1';
const RESULT_SCHEMA = 'toolkit.recovery-identity-result.v1';
const COMMANDS = Object.freeze(['claim', 'record', 'resolve', 'check', 'dispose']);
// The fields that pin one resource: a read-back must agree on every one of them.
const IDENTITY_FIELDS = Object.freeze(['provider', 'scope', 'environment', 'kind', 'name']);
const KEY = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const REASONS = Object.freeze({
  INPUT_INVALID: 'INPUT_INVALID',
  SECRET_IN_INPUT: 'SECRET_IN_INPUT',
  RECOVERY_IDENTITY_EXISTS: 'RECOVERY_IDENTITY_EXISTS',
  RECOVERY_IDENTITY_MISSING: 'RECOVERY_IDENTITY_MISSING',
  RECOVERY_IDENTITY_UNCLEAR: 'RECOVERY_IDENTITY_UNCLEAR',
  RECOVERY_IDENTITY_UNREADABLE: 'RECOVERY_IDENTITY_UNREADABLE',
  RECOVERY_IDENTITY_MISMATCH: 'RECOVERY_IDENTITY_MISMATCH',
  RECOVERY_RESOURCE_GONE: 'RECOVERY_RESOURCE_GONE',
  RECOVERY_RESOURCE_STILL_PRESENT: 'RECOVERY_RESOURCE_STILL_PRESENT'
});

class UsageError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultStateDir() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'recovery-identities');
}

function recordPath(stateDir, key) {
  return path.join(stateDir, `${key}.json`);
}

function hold(reason, detail, extra = {}) {
  return { verdict: 'HOLD', reason, detail, ...extra };
}

function ok(detail, extra = {}) {
  return { verdict: 'OK', detail, ...extra };
}

// Problems with an input file's content, or null. Secrets are checked first so no message echoes one.
function inputProblem(value, label, required) {
  if (findSecrets(value, '', []).length) {
    return hold(REASONS.SECRET_IN_INPUT, `the ${label} looks like it holds a secret value; it carries names and handles only`);
  }
  if (!isObject(value)) return hold(REASONS.INPUT_INVALID, `the ${label} must be a JSON object`);
  const missing = required.filter((field) => !text(value[field]));
  if (missing.length) return hold(REASONS.INPUT_INVALID, `the ${label} needs ${missing.join(', ')}`);
  return null;
}

function identityProblem(identity) {
  const problem = inputProblem(identity, 'identity', [...IDENTITY_FIELDS, 'cleanup_owner', 'end_date']);
  if (problem) return problem;
  if (parseDate(identity.end_date) === null) return hold(REASONS.INPUT_INVALID, 'the identity needs end_date as a real date (YYYY-MM-DD)');
  return null;
}

function readBackProblem(readBack) {
  const problem = inputProblem(readBack, 'read-back', IDENTITY_FIELDS);
  if (problem) return problem;
  if (typeof readBack.exists !== 'boolean') return hold(REASONS.INPUT_INVALID, 'the read-back needs exists as true or false');
  if (readBack.exists && !text(readBack.handle)) return hold(REASONS.INPUT_INVALID, 'a read-back of a resource that exists needs its exact handle');
  return null;
}

// The stored record: { found: false } when there is none, { record } when it reads cleanly, or a HOLD.
function loadRecord(stateDir, key) {
  let raw;
  try {
    raw = fs.readFileSync(recordPath(stateDir, key), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { found: false };
    return { hold: hold(REASONS.RECOVERY_IDENTITY_UNREADABLE, `the record for ${key} could not be read (${error.code || 'read error'})`) };
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    record = null;
  }
  const valid = isObject(record) && record.schema === RECORD_SCHEMA && record.key === key &&
    ['claimed', 'confirmed'].includes(record.state) && isObject(record.identity) &&
    IDENTITY_FIELDS.every((field) => text(record.identity[field])) &&
    (record.state === 'claimed' || text(record.handle));
  if (!valid) {
    return { hold: hold(REASONS.RECOVERY_IDENTITY_UNREADABLE, `the record for ${key} is damaged; do not guess or create a replacement, ask the owner`) };
  }
  return { found: true, record };
}

function writeRecord(stateDir, record) {
  const file = recordPath(stateDir, record.key);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Fields where the provider's read-back differs from the record.
function differences(record, readBack, withHandle) {
  const fields = IDENTITY_FIELDS.filter((field) => text(readBack[field]) !== text(record.identity[field]));
  // A recorded resource is read back by its exact handle, so a missing handle differs too.
  if (withHandle && text(readBack.handle) !== text(record.handle)) fields.push('handle');
  return fields;
}

function missing(key) {
  return hold(REASONS.RECOVERY_IDENTITY_MISSING,
    `no recovery identity is recorded for ${key}; do not guess, search the provider or create a replacement; ask the owner`);
}

function unclear(record) {
  const { name, scope, provider } = record.identity;
  return hold(REASONS.RECOVERY_IDENTITY_UNCLEAR,
    `${record.key} was claimed but never recorded, so the create may have run: read back exactly ${name} in ${scope} from ${provider}, then record it if it exists or dispose the claim if it does not; never create another`,
    { record });
}

function claim(stateDir, key, identity, now) {
  const problem = identityProblem(identity);
  if (problem) return problem;
  const existing = loadRecord(stateDir, key);
  if (existing.hold) return existing.hold;
  if (existing.found) {
    return hold(REASONS.RECOVERY_IDENTITY_EXISTS, `${key} already has a ${existing.record.state} record; resolve it instead of creating another`,
      { record: existing.record });
  }
  const record = {
    schema: RECORD_SCHEMA,
    key,
    state: 'claimed',
    identity: Object.fromEntries([...IDENTITY_FIELDS, 'cleanup_owner', 'end_date'].map((field) => [field, text(identity[field])])),
    claimed_at: new Date(now).toISOString()
  };
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try {
    // Exclusive create: of two sessions claiming the same key at once, only one wins.
    fs.writeFileSync(recordPath(stateDir, key), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return hold(REASONS.RECOVERY_IDENTITY_EXISTS, `${key} was claimed by another session just now; resolve it instead`);
    throw error;
  }
  return ok(`claimed ${key}: create exactly ${record.identity.name} in ${record.identity.scope}, then record it from the provider's read-back`, { record });
}

function recordIdentity(stateDir, key, readBack, now) {
  const problem = readBackProblem(readBack);
  if (problem) return problem;
  const loaded = loadRecord(stateDir, key);
  if (loaded.hold) return loaded.hold;
  if (!loaded.found) return missing(key);
  const record = loaded.record;
  if (record.state === 'confirmed') {
    return hold(REASONS.RECOVERY_IDENTITY_EXISTS, `${key} is already recorded as ${record.handle}; use check`, { record });
  }
  const changed = differences(record, readBack, false);
  if (changed.length) {
    return hold(REASONS.RECOVERY_IDENTITY_MISMATCH,
      `the provider's read-back differs from the claim on ${changed.join(', ')}; never rename, delete or move it to fit, ask the owner`, { record });
  }
  if (!readBack.exists) {
    return hold(REASONS.RECOVERY_RESOURCE_GONE, `the provider says ${record.identity.name} does not exist; nothing to record`, { record });
  }
  const confirmed = { ...record, state: 'confirmed', handle: text(readBack.handle), confirmed_at: new Date(now).toISOString() };
  writeRecord(stateDir, confirmed);
  return ok(`recorded ${key} as ${confirmed.handle}`, { record: confirmed });
}

function resolve(stateDir, key) {
  const loaded = loadRecord(stateDir, key);
  if (loaded.hold) return loaded.hold;
  if (!loaded.found) return missing(key);
  if (loaded.record.state === 'claimed') return unclear(loaded.record);
  const { record } = loaded;
  return ok(`${key} is ${record.handle} in ${record.identity.scope} on ${record.identity.provider}; read back that exact handle and run check before using it`,
    { record });
}

function check(stateDir, key, readBack) {
  const problem = readBackProblem(readBack);
  if (problem) return problem;
  const loaded = loadRecord(stateDir, key);
  if (loaded.hold) return loaded.hold;
  if (!loaded.found) return missing(key);
  const record = loaded.record;
  if (record.state === 'claimed') return unclear(record);
  const changed = differences(record, readBack, true);
  if (changed.length) {
    return hold(REASONS.RECOVERY_IDENTITY_MISMATCH,
      `the provider's read-back differs from the record on ${changed.join(', ')}; never rename, delete or move it to fit, ask the owner`, { record });
  }
  if (!readBack.exists) {
    return hold(REASONS.RECOVERY_RESOURCE_GONE,
      `the provider says ${record.handle} no longer exists; do not create a replacement without the owner's approval`, { record });
  }
  return ok(`the provider confirms ${key} is ${record.handle}`, { record });
}

function dispose(stateDir, key, readBack) {
  const problem = readBackProblem(readBack);
  if (problem) return problem;
  const loaded = loadRecord(stateDir, key);
  if (loaded.hold) return loaded.hold;
  if (!loaded.found) return missing(key);
  const record = loaded.record;
  const changed = differences(record, readBack, record.state === 'confirmed');
  if (changed.length) {
    return hold(REASONS.RECOVERY_IDENTITY_MISMATCH,
      `the removal read-back differs from the record on ${changed.join(', ')}; the record stays`, { record });
  }
  if (readBack.exists) {
    return hold(REASONS.RECOVERY_RESOURCE_STILL_PRESENT,
      `the provider still shows ${text(readBack.handle)}; remove it first, then dispose with a read-back that says it is gone`, { record });
  }
  fs.rmSync(recordPath(stateDir, key));
  return ok(`the provider says ${record.identity.name} is gone; the record for ${key} is deleted`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new UsageError(`the first argument must be one of ${COMMANDS.join(', ')}`);
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const match = /^--(key|identity|read-back|state-dir)(?:=(.*))?$/.exec(rest[index]);
    if (!match) throw new UsageError('unknown argument');
    const value = match[2] !== undefined ? match[2] : rest[++index];
    if (value === undefined || value === '') throw new UsageError(`--${match[1]} needs a value`);
    if (options[match[1]] !== undefined) throw new UsageError(`--${match[1]} is given twice`);
    options[match[1]] = value;
  }
  if (!KEY.test(options.key || '')) throw new UsageError('--key needs lower-case letters, digits, dots, dashes or underscores (at most 80)');
  const needs = { claim: ['identity'], record: ['read-back'], check: ['read-back'], dispose: ['read-back'], resolve: [] }[command];
  for (const name of ['identity', 'read-back']) {
    if (needs.includes(name) !== (options[name] !== undefined)) {
      throw new UsageError(needs.includes(name) ? `${command} needs --${name}` : `${command} does not take --${name}`);
    }
  }
  if (options['state-dir'] !== undefined && !path.isAbsolute(options['state-dir'])) throw new UsageError('--state-dir must be an absolute path');
  return { command, key: options.key, input: options.identity || options['read-back'], stateDir: options['state-dir'] || defaultStateDir() };
}

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (error) {
    throw new UsageError(`could not read the input file (${error.code || 'read error'})`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Never echo the input: a pasted secret would end up in the log.
    throw new UsageError('the input file is not valid JSON');
  }
}

function run(args, now = Date.now()) {
  const input = args.input === undefined ? undefined : readJson(args.input);
  const outcome = {
    claim: () => claim(args.stateDir, args.key, input, now),
    record: () => recordIdentity(args.stateDir, args.key, input, now),
    resolve: () => resolve(args.stateDir, args.key),
    check: () => check(args.stateDir, args.key, input),
    dispose: () => dispose(args.stateDir, args.key, input)
  }[args.command]();
  return { schema: RESULT_SCHEMA, command: args.command, key: args.key, ...outcome };
}

function main(argv) {
  let result;
  try {
    result = run(parseArgs(argv));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.verdict === 'HOLD' ? 2 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { IDENTITY_FIELDS, REASONS, RECORD_SCHEMA, parseArgs, run };
