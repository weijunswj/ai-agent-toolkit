#!/usr/bin/env node
'use strict';

// The escape list: one line for each bug found after merge (an escape), saying what broke and why
// the tests missed it, so later work can add the missing kind of test. It lives in the private
// evidence store at state/<owner>/<repo>/escapes.jsonl, beside the repository's programme state (the
// folder its governance binding names and the store command writes), one JSON object per line,
// schema toolkit.escape.v1:
//
//   id          a short lower-case slug, unique in the file, for example fetch-races
//   date        the day it was found, YYYY-MM-DD, not later than today (UTC)
//   kind        the kind of test that should have caught it: unit, integration, end-to-end, ci,
//               install or rules
//   found_by    who found it: owner, uat, g0 (a planning or discovery pass), g2 (an independent
//               review), controller or ci
//   what_broke  what went wrong, 12 to 280 printable ASCII characters
//   why_missed  why the tests did not catch it, same limits
//   fix_pr      the pull request number that fixed it, or null until fixed
//   test        the repository path of the test that now catches it, or null until there is one
//
// The reader is default-deny: the whole file must be printable ASCII with LF line ends, every line
// the exact canonical form this script writes (so no other spacing, key order, duplicate key or
// escape), every key known and every value of its type and shape. Text that holds a local path, a
// secret-shaped value, personal data or an AI footer is refused. One bad line refuses the whole
// file. Errors name the line, field and rule, never the refused text.
//
// The script only reads and writes the ledger file. It never commits or pushes: the caller commits
// the store, pushes and fetches once to read it back (evidence custody).
//
// Usage:
//   node repo/scripts/toolkit-escape-ledger.cjs add --store <dir> --repo <owner/repo> --id <slug>
//        --kind <kind> --found-by <who> --what-broke <text> --why-missed <text>
//        [--date YYYY-MM-DD] [--fix-pr <n>] [--test <path>]
//   node repo/scripts/toolkit-escape-ledger.cjs fix --store <dir> --repo <owner/repo> --id <slug>
//        [--fix-pr <n>] [--test <path>]          fills an empty field once, never overwrites
//   node repo/scripts/toolkit-escape-ledger.cjs check --store <dir> --repo <owner/repo>
//   node repo/scripts/toolkit-escape-ledger.cjs group --store <dir> --repo <owner/repo> [--json]
//        counts per kind and the ids with no test yet; never prints what_broke or why_missed
// Exit codes: 0 done, 1 refused or invalid, 2 usage error.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PATTERNS } = require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs');
const { detect, detectPrText } = require('../../skills/secure-ci-cd/scripts/personal-data-guard.cjs');

const SCHEMA = 'toolkit.escape.v1';
const GROUP_SCHEMA = 'toolkit.escape-group.v1';
const KEYS = Object.freeze(['schema', 'id', 'date', 'kind', 'found_by', 'what_broke', 'why_missed', 'fix_pr', 'test']);
const KINDS = Object.freeze(['unit', 'integration', 'end-to-end', 'ci', 'install', 'rules']);
const FOUND_BY = Object.freeze(['owner', 'uat', 'g0', 'g2', 'controller', 'ci']);
const MIN_TEXT = 12;
const MAX_TEXT = 280;
const MAX_TEST_PATH = 200;
const MAX_LINE_BYTES = 2048;
const MAX_FILE_BYTES = 1 << 20;
const MAX_FIX_PR = 9999999;
const LEDGER_FILE = 'escapes.jsonl';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRINTABLE = /^[\x20-\x7e]*$/;
const FILE_TEXT = /^[\x20-\x7e\n]*$/;
const TEST_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

// Text that names a place on someone's computer, beyond the home folders the personal-data guard
// already finds. A slash command (/loop) or a URL path is not one of these.
const LOCAL_PATHS = Object.freeze([
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/,
  /\\/,
  /(?:^|[\s("'`=,;:])~[\\/]/,
  /(?:^|[\s("'`=,;])\/(?:home|Users|root|tmp|mnt|var|private|opt|etc|srv|workspace|Volumes)(?:\/|$|[\s"'`),;])/,
  /\$env:|\$\{?HOME\b|%[A-Za-z_][A-Za-z0-9_]*%/i,
  /\bfile:\/\//i,
]);

// A long unbroken run of token characters with upper case, lower case and digits looks like a
// credential even when no provider format names it. Lower-case hex (commit hashes) does not.
const TOKEN_RUN = /[A-Za-z0-9+/=_-]{32,}/g;

function textProblem(text) {
  if (!PRINTABLE.test(text)) return 'not-printable-ascii';
  if (text !== text.trim()) return 'edge-space';
  if (text.length < MIN_TEXT) return 'too-short';
  if (text.length > MAX_TEXT) return 'too-long';
  if (LOCAL_PATHS.some(pattern => pattern.test(text))) return 'local-path';
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) return 'secret-shaped';
  }
  for (const run of text.match(TOKEN_RUN) || []) {
    if (/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)) return 'secret-shaped';
  }
  if (detectPrText(text, true).length > 0) return 'local-path-or-footer';
  if (detect(text).length > 0) return 'personal-data';
  return null;
}

function realDate(text, today) {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return false;
  return year >= 2020 && text <= today;
}

function testPathProblem(value) {
  if (typeof value !== 'string') return 'type';
  if (value.length > MAX_TEST_PATH || !TEST_PATH.test(value)) return 'shape';
  if (value.split('/').some(part => part === '.' || part === '..')) return 'outside-repository';
  return null;
}

// Problems with one parsed entry (schema key included): [{ field, rule }]. Pure.
function entryErrors(value, today) {
  const errors = [];
  const add = (field, rule) => errors.push({ field, rule });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [{ field: null, rule: 'not-object' }];
  for (const key of Object.keys(value)) if (!KEYS.includes(key)) add(null, 'unknown-key');
  for (const key of KEYS) if (!Object.prototype.hasOwnProperty.call(value, key)) add(key, 'missing-key');
  if (errors.length) return errors;
  if (value.schema !== SCHEMA) add('schema', 'schema');
  if (typeof value.id !== 'string' || value.id.length < 3 || value.id.length > 64 || !ID.test(value.id)) add('id', 'id');
  if (typeof value.date !== 'string' || !realDate(value.date, today)) add('date', 'date');
  if (!KINDS.includes(value.kind)) add('kind', 'kind');
  if (!FOUND_BY.includes(value.found_by)) add('found_by', 'found_by');
  for (const field of ['what_broke', 'why_missed']) {
    if (typeof value[field] !== 'string') { add(field, 'type'); continue; }
    const problem = textProblem(value[field]);
    if (problem) add(field, problem);
  }
  if (value.fix_pr !== null && !(Number.isSafeInteger(value.fix_pr) && value.fix_pr >= 1 && value.fix_pr <= MAX_FIX_PR)) add('fix_pr', 'fix_pr');
  if (value.test !== null) {
    const problem = testPathProblem(value.test);
    if (problem) add('test', problem);
  }
  return errors;
}

// The one line this script writes for an entry (without its newline).
function canonicalLine(entry) {
  const value = { schema: SCHEMA };
  for (const key of KEYS.slice(1)) value[key] = entry[key];
  return JSON.stringify(value);
}

function withoutSchema(value) {
  const entry = {};
  for (const key of KEYS.slice(1)) entry[key] = value[key];
  return entry;
}

const utcToday = () => new Date().toISOString().slice(0, 10);

// Reads a whole ledger from its bytes: { ok, entries, errors }, errors as [{ line, field, rule }].
// Any error refuses the whole file and returns no entries. Pure.
function readLedger(bytes, today = utcToday()) {
  const refuse = (line, field, rule) => ({ ok: false, entries: [], errors: [{ line, field, rule }] });
  if (bytes.length > MAX_FILE_BYTES) return refuse(null, null, 'too-large');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return refuse(null, null, 'not-utf8');
  }
  if (text === '') return { ok: true, entries: [], errors: [] };
  if (!FILE_TEXT.test(text)) {
    const at = text.search(/[^\x20-\x7e\n]/);
    return refuse(text.slice(0, at).split('\n').length, null, 'not-printable-ascii');
  }
  if (!text.endsWith('\n')) return refuse(text.split('\n').length, null, 'no-final-newline');
  const errors = [];
  const entries = [];
  const seen = new Set();
  text.slice(0, -1).split('\n').forEach((source, index) => {
    const line = index + 1;
    if (source === '') { errors.push({ line, field: null, rule: 'blank-line' }); return; }
    if (source.length > MAX_LINE_BYTES) { errors.push({ line, field: null, rule: 'line-too-long' }); return; }
    let value;
    try { value = JSON.parse(source); } catch { errors.push({ line, field: null, rule: 'not-json' }); return; }
    const problems = entryErrors(value, today);
    if (problems.length) { errors.push(...problems.map(problem => ({ line, ...problem }))); return; }
    if (canonicalLine(value) !== source) { errors.push({ line, field: null, rule: 'not-canonical' }); return; }
    if (seen.has(value.id)) { errors.push({ line, field: 'id', rule: 'duplicate-id' }); return; }
    seen.add(value.id);
    entries.push(withoutSchema(value));
  });
  return errors.length ? { ok: false, entries: [], errors } : { ok: true, entries, errors: [] };
}

function formatError(error) {
  return [error.line === null || error.line === undefined ? null : `line ${error.line}`, error.field, error.rule].filter(Boolean).join(': ');
}

// state/<owner>/<repo>/escapes.jsonl under the store, with the names as given (the binding's
// spelling). Throws on a name that is not a plain GitHub owner/repository pair.
function ledgerPath(store, repo) {
  const parts = String(repo).split('/');
  if (parts.length !== 2 || !OWNER.test(parts[0]) || !REPO_NAME.test(parts[1]) || /^\.+$/.test(parts[1])) {
    throw new Error('the repository must be <owner>/<name>');
  }
  return path.join(store, 'state', parts[0], parts[1], LEDGER_FILE);
}

// Counts per kind (every kind, zeros included) and the ids with no test yet, sorted. Never any
// what_broke or why_missed text. Pure.
function summarise(entries) {
  const byKind = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  for (const entry of entries) byKind[entry.kind] += 1;
  const untested = entries.filter(entry => entry.test === null).map(entry => entry.id).sort();
  return { total: entries.length, by_kind: byKind, untested };
}

// Owns reading and writing one store's ledger files. Dependencies: the file system and today's
// date (UTC, YYYY-MM-DD). Every method returns { ok, errors, ... } and never throws for a refusal.
class EscapeLedger {
  constructor({ fileSystem = fs, today = utcToday } = {}) {
    this.fs = fileSystem;
    this.today = today;
  }

  // The ledger file, refusing a store that is not a folder and any symbolic link on the way, so a
  // write never lands outside the store.
  locate(store, repo) {
    let file;
    try { file = ledgerPath(store, repo); } catch { return { errors: [{ line: null, field: 'repo', rule: 'repository' }] }; }
    const storeStat = this.statOrNull(store);
    if (!storeStat || storeStat.isSymbolicLink() || !storeStat.isDirectory()) return { errors: [{ line: null, field: 'store', rule: 'not-a-folder' }] };
    const owner = path.dirname(path.dirname(file));
    for (const dir of [path.dirname(owner), owner, path.dirname(file)]) {
      const stat = this.statOrNull(dir);
      if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) return { errors: [{ line: null, field: 'store', rule: 'not-a-folder' }] };
    }
    const stat = this.statOrNull(file);
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) return { errors: [{ line: null, field: 'ledger', rule: 'not-a-file' }] };
    return { file, exists: Boolean(stat), errors: [] };
  }

  statOrNull(target) {
    try { return this.fs.lstatSync(target); } catch { return null; }
  }

  load(store, repo) {
    const place = this.locate(store, repo);
    if (place.errors.length) return { ok: false, entries: [], errors: place.errors };
    if (!place.exists) return { ok: true, file: place.file, exists: false, entries: [], errors: [] };
    const read = readLedger(this.fs.readFileSync(place.file), this.today());
    return { ...read, file: place.file, exists: true };
  }

  // Writes the whole file through a new temporary file in the same folder, then renames it.
  save(file, entries) {
    this.fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      this.fs.writeFileSync(temp, entries.map(entry => `${canonicalLine(entry)}\n`).join(''), { flag: 'wx' });
      this.fs.renameSync(temp, file);
    } finally {
      try { this.fs.rmSync(temp, { force: true }); } catch { /* already renamed */ }
    }
  }

  check(store, repo) {
    return this.load(store, repo);
  }

  add(store, repo, entry) {
    const value = { schema: SCHEMA, ...entry };
    const problems = entryErrors(value, this.today());
    if (problems.length) return { ok: false, errors: problems.map(problem => ({ line: null, ...problem })) };
    const loaded = this.load(store, repo);
    if (!loaded.ok) return { ok: false, errors: loaded.errors };
    if (loaded.entries.some(item => item.id === value.id)) return { ok: false, errors: [{ line: null, field: 'id', rule: 'duplicate-id' }] };
    const entries = [...loaded.entries, withoutSchema(value)];
    this.save(loaded.file, entries);
    return { ok: true, errors: [], file: loaded.file, count: entries.length };
  }

  // Fills fix_pr and/or test on one entry, only where they are still null.
  fix(store, repo, id, changes) {
    const loaded = this.load(store, repo);
    if (!loaded.ok) return { ok: false, errors: loaded.errors };
    const index = loaded.entries.findIndex(item => item.id === id);
    if (index < 0) return { ok: false, errors: [{ line: null, field: 'id', rule: 'unknown-id' }] };
    const current = loaded.entries[index];
    const fields = ['fix_pr', 'test'].filter(field => changes[field] !== undefined);
    if (!fields.length) return { ok: false, errors: [{ line: null, field: null, rule: 'nothing-to-fill' }] };
    const set = fields.filter(field => current[field] !== null);
    if (set.length) return { ok: false, errors: set.map(field => ({ line: null, field, rule: 'already-set' })) };
    const next = { ...current };
    for (const field of fields) next[field] = changes[field];
    const problems = entryErrors({ schema: SCHEMA, ...next }, this.today());
    if (problems.length) return { ok: false, errors: problems.map(problem => ({ line: null, ...problem })) };
    const entries = loaded.entries.map((item, at) => (at === index ? next : item));
    this.save(loaded.file, entries);
    return { ok: true, errors: [], file: loaded.file, entry: next };
  }

  group(store, repo) {
    const loaded = this.load(store, repo);
    if (!loaded.ok) return { ok: false, errors: loaded.errors };
    return { ok: true, errors: [], summary: summarise(loaded.entries) };
  }
}

const FLAGS = Object.freeze({
  add: ['store', 'repo', 'id', 'date', 'kind', 'found-by', 'what-broke', 'why-missed', 'fix-pr', 'test'],
  fix: ['store', 'repo', 'id', 'fix-pr', 'test'],
  check: ['store', 'repo'],
  group: ['store', 'repo', 'json'],
});
const SWITCHES = Object.freeze(['json']);
const REQUIRED = Object.freeze({
  add: ['store', 'repo', 'id', 'kind', 'found-by', 'what-broke', 'why-missed'],
  fix: ['store', 'repo', 'id'],
  check: ['store', 'repo'],
  group: ['store', 'repo'],
});

const USAGE = `Usage:
  node repo/scripts/toolkit-escape-ledger.cjs add --store <dir> --repo <owner/repo> --id <slug> --kind <kind>
       --found-by <who> --what-broke <text> --why-missed <text> [--date YYYY-MM-DD] [--fix-pr <n>] [--test <path>]
  node repo/scripts/toolkit-escape-ledger.cjs fix --store <dir> --repo <owner/repo> --id <slug> [--fix-pr <n>] [--test <path>]
  node repo/scripts/toolkit-escape-ledger.cjs check --store <dir> --repo <owner/repo>
  node repo/scripts/toolkit-escape-ledger.cjs group --store <dir> --repo <owner/repo> [--json]
Kinds: ${KINDS.join(', ')}. Found by: ${FOUND_BY.join(', ')}.
`;

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.prototype.hasOwnProperty.call(FLAGS, command || '')) throw new UsageError('unknown or missing command');
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const name = flag.startsWith('--') ? flag.slice(2) : '';
    if (!FLAGS[command].includes(name)) throw new UsageError(`unknown option for ${command}`);
    if (Object.prototype.hasOwnProperty.call(options, name)) throw new UsageError(`--${name} given twice`);
    if (SWITCHES.includes(name)) { options[name] = true; continue; }
    if (index + 1 >= rest.length || rest[index + 1].startsWith('--')) throw new UsageError(`--${name} needs a value`);
    options[name] = rest[index + 1];
    index += 1;
  }
  for (const name of REQUIRED[command]) if (options[name] === undefined) throw new UsageError(`--${name} is required`);
  if (options['fix-pr'] !== undefined && !/^[1-9][0-9]{0,6}$/.test(options['fix-pr'])) throw new UsageError('--fix-pr must be a pull request number');
  return { command, options };
}

function main(argv, { stdout = process.stdout, stderr = process.stderr, book = new EscapeLedger() } = {}) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) { stdout.write(USAGE); return 0; }
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr.write(`toolkit-escape-ledger: ${error.message}\n${USAGE}`);
    return 2;
  }
  const { command, options } = parsed;
  const { store, repo } = options;
  const fixPr = options['fix-pr'] === undefined ? undefined : Number(options['fix-pr']);
  let result;
  if (command === 'add') {
    result = book.add(store, repo, {
      id: options.id, date: options.date === undefined ? book.today() : options.date, kind: options.kind, found_by: options['found-by'],
      what_broke: options['what-broke'], why_missed: options['why-missed'], fix_pr: fixPr === undefined ? null : fixPr, test: options.test === undefined ? null : options.test,
    });
  } else if (command === 'fix') {
    result = book.fix(store, repo, options.id, { fix_pr: fixPr, test: options.test });
  } else if (command === 'check') {
    result = book.check(store, repo);
  } else {
    result = book.group(store, repo);
  }
  if (!result.ok) {
    stderr.write(`toolkit-escape-ledger: ${command} refused for ${repo}:\n${result.errors.map(error => `  ${formatError(error)}`).join('\n')}\n`);
    return 1;
  }
  const where = `state/${repo}/${LEDGER_FILE}`;
  const custody = 'Commit and push the evidence store, then fetch once to read it back.';
  if (command === 'add') stdout.write(`Added escape ${options.id} to ${where} (${result.count} in all). ${custody}\n`);
  else if (command === 'fix') stdout.write(`Filled ${[fixPr === undefined ? null : 'fix_pr', options.test === undefined ? null : 'test'].filter(Boolean).join(' and ')} on escape ${options.id} in ${where}. ${custody}\n`);
  else if (command === 'check') stdout.write(result.exists ? `${where} is valid: ${result.entries.length} escape${result.entries.length === 1 ? '' : 's'}.\n` : `${where} does not exist yet: 0 escapes.\n`);
  else if (options.json) stdout.write(`${JSON.stringify({ schema: GROUP_SCHEMA, repo, ...result.summary })}\n`);
  else {
    const { total, by_kind: byKind, untested } = result.summary;
    const kinds = KINDS.filter(kind => byKind[kind] > 0).map(kind => `${kind} ${byKind[kind]}`);
    stdout.write(`Escape list for ${repo}: ${total} escape${total === 1 ? '' : 's'}.\n`);
    if (kinds.length) stdout.write(`By kind: ${kinds.join(', ')}.\n`);
    stdout.write(untested.length ? `No test yet (${untested.length}): ${untested.join(', ')}.\n` : 'No test yet: none.\n');
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({
  SCHEMA, GROUP_SCHEMA, KEYS, KINDS, FOUND_BY, MIN_TEXT, MAX_TEXT, MAX_LINE_BYTES, MAX_FILE_BYTES,
  EscapeLedger, canonicalLine, entryErrors, formatError, ledgerPath, main, readLedger, summarise, textProblem,
});
