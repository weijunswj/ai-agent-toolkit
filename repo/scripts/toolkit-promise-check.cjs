#!/usr/bin/env node
'use strict';

// Check controller follow-ups against observed events. Validation precedes all lookups.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const VERSION_PATH = 'repo/contracts/toolkit-local-bridge/version.json';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

class InputError extends Error {}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`${label} must be an object.`);
}

function keys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new InputError(`${label} has an unknown key.`);
}

function string(value, label, required = true) {
  if (typeof value !== 'string' || (required && !value.trim())) throw new InputError(`${label} must be ${required ? 'a non-empty' : 'a'} string.`);
}

function validVersion(value) {
  return typeof value === 'string' && value === value.trim() && VERSION.test(value);
}

function validateTrigger(value, label) {
  object(value, label);
  const allowed = {
    pr_merged: ['type', 'repo', 'pr'],
    pass_file: ['type', 'path', 'contains', ...(value.repo === undefined ? [] : ['repo', 'ref'])],
    version_shipped: ['type', 'repo', 'version', 'path', 'ref'],
  };
  if (typeof value.type !== 'string' || !Object.hasOwn(allowed, value.type)) throw new InputError(`${label}.type is unknown.`);
  keys(value, allowed[value.type], label);
  if (value.type !== 'pass_file' || value.repo !== undefined) {
    if (typeof value.repo !== 'string' || value.repo !== value.repo.trim() || !REPO.test(value.repo)) throw new InputError(`${label}.repo must be owner/name.`);
  }
  if (value.type === 'pr_merged') {
    if (!Number.isSafeInteger(value.pr) || value.pr <= 0) throw new InputError(`${label}.pr must be a positive integer.`);
    return { ...value };
  }
  const result = { ...value };
  if (value.type === 'version_shipped') {
    if (!validVersion(value.version)) throw new InputError(`${label}.version must be X.Y.Z.`);
    if (result.path === undefined) result.path = VERSION_PATH;
  }
  string(result.path, `${label}.path`);
  if (result.path.includes('\0')) throw new InputError(`${label}.path contains a null character.`);
  if (value.contains !== undefined) string(value.contains, `${label}.contains`, false);
  if (value.repo !== undefined) {
    if (result.ref === undefined) result.ref = 'main';
    string(result.ref, `${label}.ref`);
    if (/[\x00-\x1f\x7f]/.test(result.ref)) throw new InputError(`${label}.ref contains control characters.`);
    if (result.path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\x00-\x1f\x7f]/.test(result.path)) {
      throw new InputError(`${label}.path must be a relative repository file path.`);
    }
  }
  return result;
}

function validateList(value) {
  object(value, 'List');
  keys(value, ['promises'], 'List');
  if (!Array.isArray(value.promises)) throw new InputError('List.promises must be an array.');
  const ids = new Set();
  return value.promises.map((promise, index) => {
    const label = `Promise[${index}]`;
    object(promise, label);
    keys(promise, ['id', 'action', 'trigger', 'status', 'owner', 'made_at', 'evidence'], label);
    string(promise.id, `${label}.id`);
    string(promise.action, `${label}.action`);
    if (ids.has(promise.id)) throw new InputError(`${label}.id is duplicated.`);
    ids.add(promise.id);
    for (const key of ['owner', 'made_at', 'evidence']) if (promise[key] !== undefined) string(promise[key], `${label}.${key}`, false);
    const status = promise.status === undefined ? 'open' : promise.status;
    if (!['open', 'done'].includes(status)) throw new InputError(`${label}.status must be open or done.`);
    return { ...promise, status, trigger: validateTrigger(promise.trigger, `${label}.trigger`) };
  });
}

function fencedJson(text) {
  const blocks = [];
  let fence = null; let body = [];
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        if (fence.target) blocks.push(body.join('\n'));
        fence = null; body = [];
      } else if (fence.target) body.push(line);
    } else {
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening) fence = { char: opening[1][0], length: opening[1].length, target: opening[2].trim() === 'toolkit-promises' };
    }
  }
  if (fence?.target) throw new InputError('The toolkit-promises fence is not closed.');
  if (blocks.length !== 1) throw new InputError('Expected exactly one toolkit-promises fenced block.');
  return blocks[0];
}

function parseList(text, filename) {
  const source = path.extname(filename).toLowerCase() === '.json' ? text : fencedJson(text);
  let value;
  try { value = JSON.parse(source); } catch { throw new InputError('The promise list is not valid JSON.'); }
  return validateList(value);
}

function compareVersions(left, right) {
  if (!validVersion(left) || !validVersion(right)) throw new Error('Invalid version.');
  const a = left.split('.').map(BigInt); const b = right.split('.').map(BigInt);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

class GitHubClient {
  constructor({ spawn = spawnSync, resolveExecutable = resolvePathExecutable } = {}) {
    this.spawn = spawn;
    this.resolveExecutable = resolveExecutable;
  }

  api(endpoint) {
    let result;
    try {
      result = this.spawn(this.resolveExecutable('gh'), ['api', endpoint], {
        shell: false, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
      });
    } catch { throw new Error('GitHub lookup failed.'); }
    if (result.error) throw new Error('GitHub lookup failed.');
    if (result.status !== 0) {
      if (/\bHTTP 404\b/.test(result.stderr || '')) return null;
      throw new Error('GitHub lookup failed.');
    }
    try { return JSON.parse(result.stdout); } catch { throw new Error('GitHub response could not be read.'); }
  }

  getPullRequest(repo, pr) {
    return this.api(`repos/${repo}/pulls/${pr}`);
  }

  getFile(repo, file, ref) {
    const result = this.api(`repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
    if (result === null) return null;
    if (result?.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string') throw new Error('GitHub file could not be read.');
    const content = result.content.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error('GitHub file could not be read.');
    return Buffer.from(content, 'base64').toString('utf8');
  }
}

function triggerDescription(trigger) {
  if (trigger.type === 'pr_merged') return `PR ${trigger.repo}#${trigger.pr} merged`;
  if (trigger.type === 'version_shipped') return `version ${trigger.version} shipped in ${trigger.repo} at ${trigger.ref}`;
  return `file ${trigger.path}${trigger.repo ? ` in ${trigger.repo} at ${trigger.ref}` : ''} exists${trigger.contains === undefined ? '' : ' with the required text'}`;
}

class PromiseChecker {
  constructor({ client = new GitHubClient(), readFile = fs.readFileSync } = {}) {
    this.client = client;
    this.readFile = readFile;
  }

  check(list, listFile) {
    // Revalidate callers too, so a later invalid promise cannot follow an earlier lookup.
    const promises = validateList({ promises: list });
    const result = { overdue: [], waiting: [], unknown: [], done: [], summary: {} };
    const cache = new Map();
    const lookup = (key, read) => {
      if (!cache.has(key)) {
        try { cache.set(key, { value: read() }); } catch { cache.set(key, { failed: true }); }
      }
      const cached = cache.get(key);
      if (cached.failed) throw new Error('Lookup failed.');
      return cached.value;
    };
    for (const promise of promises) {
      if (promise.status === 'done') { result.done.push(promise); continue; }
      const trigger = promise.trigger;
      const entry = { ...promise, description: triggerDescription(trigger) };
      try {
        let met;
        if (trigger.type === 'pr_merged') {
          const pr = lookup(JSON.stringify(['pr', trigger.repo, trigger.pr]), () => this.client.getPullRequest(trigger.repo, trigger.pr));
          if (pr !== null && (!pr || (typeof pr.merged_at !== 'string' && pr.merged_at !== null))) throw new Error('Invalid PR response.');
          met = pr !== null && pr.merged_at !== null;
        } else {
          const file = trigger.repo ? null : path.resolve(path.dirname(path.resolve(listFile)), trigger.path);
          const content = lookup(JSON.stringify(trigger.repo ? ['file', trigger.repo, trigger.path, trigger.ref] : ['local', file]), () => {
            if (trigger.repo) return this.client.getFile(trigger.repo, trigger.path, trigger.ref);
            try { return this.readFile(file, 'utf8'); } catch (error) {
              if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
              throw error;
            }
          });
          if (content !== null && typeof content !== 'string') throw new Error('Invalid file response.');
          if (trigger.type === 'pass_file') met = content !== null && (trigger.contains === undefined || content.includes(trigger.contains));
          else if (content === null) met = false;
          else {
            const shipped = JSON.parse(content)?.version;
            if (typeof shipped !== 'string') throw new Error('Invalid version file.');
            met = compareVersions(shipped, trigger.version) >= 0;
          }
        }
        result[met ? 'overdue' : 'waiting'].push(entry);
      } catch {
        result.unknown.push({ ...entry, reason: trigger.repo ? 'GitHub lookup could not be completed.' : 'Local file could not be checked.' });
      }
    }
    result.summary = {
      open: promises.length - result.done.length, overdue: result.overdue.length,
      waiting: result.waiting.length, unknown: result.unknown.length, done: result.done.length,
    };
    return result;
  }
}

function exitCode(result) {
  return result.overdue.length ? 1 : result.unknown.length ? 3 : 0;
}

function oneLine(value) { return value.replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' '); }

function formatResult(result, promises) {
  const lines = new Map();
  for (const [group, label, detail] of [
    ['overdue', 'Overdue promise', 'trigger met: '], ['waiting', 'Waiting', 'trigger not met yet: '],
    ['unknown', 'Could not check', ''], ['done', 'Done', ''],
  ]) for (const entry of result[group]) {
    lines.set(entry.id, `${label}: ${oneLine(entry.id)}: ${oneLine(entry.action)}${group === 'done' ? '' : ` (${detail}${oneLine(group === 'unknown' ? entry.reason : entry.description)})`}`);
  }
  const s = result.summary;
  return [...promises.map((promise) => lines.get(promise.id)), `Promises: ${s.open} open, ${s.overdue} overdue, ${s.waiting} waiting, ${s.unknown} could not be checked, ${s.done} done.`].join('\n');
}

function parseArguments(args) {
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' && !options.json) options.json = true;
    else if (arg === '--list' && options.list === undefined) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new InputError('--list requires a value.');
      options.list = value;
    } else throw new InputError('Unknown or repeated command-line option.');
  }
  if (!options.list) throw new InputError('Usage: --list <file> [--json].');
  return options;
}

function main(args, { checker = new PromiseChecker(), readFile = fs.readFileSync, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseArguments(args);
    let text;
    try { text = readFile(options.list, 'utf8'); } catch { throw new InputError('The list file could not be read.'); }
    const promises = parseList(text, options.list);
    const result = checker.check(promises, options.list);
    stdout.write(`${options.json ? JSON.stringify(result) : formatResult(result, promises)}\n`);
    return exitCode(result);
  } catch (error) {
    stderr.write(`Input error: ${error instanceof InputError ? error.message : 'The promise list could not be checked.'}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { GitHubClient, InputError, PromiseChecker, compareVersions, exitCode, formatResult, main, parseArguments, parseList, validateList };
