#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deduplicateDriftEvidence, isPublicHttpsReference, sha256 } = require('./external-system-router.cjs');

const CONFIG_SCHEMA_VERSION = 'ai-agent-toolkit.external-capability-drift-config.v1';

function fail(message) {
  const error = new Error(message);
  error.code = 'EXTERNAL_DRIFT_INVALID';
  throw error;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) fail(`Unexpected argument ${entry}.`);
    const key = entry.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${entry} requires a value.`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveLocalOutputPath(repositoryRoot, candidate, expectedName) {
  const expected = path.resolve(repositoryRoot, '.tmp', expectedName);
  const resolved = path.resolve(candidate);
  if (resolved !== expected) fail(`Drift ${expectedName} output must use the exact ignored Toolkit .tmp path.`);
  const parent = path.dirname(expected);
  if (fs.existsSync(parent)) {
    const stat = fs.lstatSync(parent);
    const normalize = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(fs.realpathSync(parent)) !== normalize(parent)) {
      fail('Drift output root must be one exact non-symlink .tmp directory.');
    }
  }
  if (fs.existsSync(expected)) {
    const stat = fs.lstatSync(expected);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`Drift ${expectedName} output must be one regular non-symlink file.`);
  }
  return expected;
}

function validatePreviousState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'findingDigests')) fail('Drift deduplication state is malformed.');
  if (!Array.isArray(value.findingDigests) || value.findingDigests.length > 10000 || new Set(value.findingDigests).size !== value.findingDigests.length) fail('Drift findingDigests must be one bounded unique array.');
  for (const digest of value.findingDigests) if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail('Drift findingDigests contains an invalid digest.');
  return value;
}

function resolveAllowlistedPath(repositoryRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) fail('Drift target path must be repository-relative.');
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) fail(`Drift target escapes the repository: ${relativePath}`);
  if (/(^|\/)\.env(?:\.|$)|(^|\/)(?:secrets?|credentials?)(?:\/|$)/i.test(normalized)) fail(`Drift target may not inspect secret-bearing paths: ${relativePath}`);
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) fail(`Drift target escapes the repository: ${relativePath}`);
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    const normalize = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (!stat.isFile() || stat.isSymbolicLink() || normalize(fs.realpathSync(resolved)) !== normalize(resolved)) {
      fail(`Drift target must be one exact regular non-symlink file: ${relativePath}`);
    }
  }
  return resolved;
}

function validatePublicReference(reference, key) {
  if (!isPublicHttpsReference(reference)) fail(`Drift publicReference is not a credential-free public HTTPS URL without query or fragment data for ${key}.`);
}

function jsonPointer(value, pointer) {
  if (pointer === '') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) fail('jsonPointer must be empty or start with /.');
  return pointer.slice(1).split('/').reduce((current, segment) => {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, key)) fail(`jsonPointer segment ${key} is missing.`);
    return current[key];
  }, value);
}

function evaluateTarget(repositoryRoot, target, now) {
  const allowedKinds = new Set(['upstream-release', 'tool-schema', 'provider-version', 'source-lock', 'adapter-version', 'repository-requirement', 'stale-audit']);
  if (!target || typeof target !== 'object' || Array.isArray(target)) fail('Each drift target must be an object.');
  if (!allowedKinds.has(target.kind)) fail(`Unsupported drift kind ${target.kind}.`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(target.key || '')) fail('Drift target key is invalid.');
  validatePublicReference(target.publicReference, target.key);
  let currentDigest;
  if (target.kind === 'stale-audit') {
    const audited = Date.parse(target.lastAuditedAt);
    if (!Number.isFinite(audited) || !Number.isInteger(target.maxAgeHours) || target.maxAgeHours < 1) fail(`Stale-audit target ${target.key} is invalid.`);
    const stale = now - audited > target.maxAgeHours * 60 * 60 * 1000;
    currentDigest = sha256({ stale, lastAuditedAt: target.lastAuditedAt, maxAgeHours: target.maxAgeHours });
    return {
      kind: target.kind,
      key: target.key,
      previousDigest: target.expectedDigest,
      currentDigest,
      publicReference: target.publicReference,
      detectedAt: new Date(now).toISOString(),
      material: stale && currentDigest !== target.expectedDigest
    };
  }
  if (target.mode === 'git-public-ref-sha256') {
    if (!/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\.git$/.test(target.repository || '')) fail(`Public Git repository is not allowlisted for ${target.key}.`);
    if (!/^refs\/heads\/[a-zA-Z0-9._/-]+$/.test(target.ref || '')) fail(`Public Git ref is invalid for ${target.key}.`);
    const git = spawnSync('git', [
      '-c', 'credential.helper=',
      '-c', 'core.askPass=',
      'ls-remote', '--exit-code', '--heads', target.repository, target.ref
    ], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      env: {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || '',
        WINDIR: process.env.WINDIR || '',
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_ASKPASS: '',
        SSH_ASKPASS: ''
      }
    });
    if (git.status !== 0) fail(`Public Git ref check failed for ${target.key}; no cached or guessed result is allowed.`);
    const match = String(git.stdout || '').trim().match(/^([0-9a-f]{40})\s+([^\s]+)$/);
    if (!match || match[2] !== target.ref) fail(`Public Git ref output is malformed for ${target.key}.`);
    currentDigest = sha256(match[1]);
    return {
      kind: target.kind,
      key: target.key,
      previousDigest: target.expectedDigest,
      currentDigest,
      publicReference: target.publicReference,
      detectedAt: new Date(now).toISOString(),
      material: currentDigest !== target.expectedDigest
    };
  }
  const resolved = resolveAllowlistedPath(repositoryRoot, target.path);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail(`Allowlisted drift target is missing: ${target.key}`);
  if (target.mode === 'json-value-sha256') {
    currentDigest = sha256(jsonPointer(readJson(resolved), target.jsonPointer || ''));
  } else if (target.mode === 'file-sha256') {
    currentDigest = sha256(fs.readFileSync(resolved));
  } else {
    fail(`Unsupported drift target mode ${target.mode}.`);
  }
  return {
    kind: target.kind,
    key: target.key,
    previousDigest: target.expectedDigest,
    currentDigest,
    publicReference: target.publicReference,
    detectedAt: new Date(now).toISOString(),
    material: currentDigest !== target.expectedDigest
  };
}

function run(options) {
  const repositoryRoot = path.resolve(options['repository-root'] || '.');
  const configPath = resolveAllowlistedPath(repositoryRoot, options.config || 'repo/external-capability/targets.json');
  const config = readJson(configPath);
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION || !Array.isArray(config.targets)) fail('Unsupported external capability drift config.');
  const statePath = options.state ? resolveLocalOutputPath(repositoryRoot, options.state, 'external-capability-drift-state.json') : null;
  const outputPath = options.output ? resolveLocalOutputPath(repositoryRoot, options.output, 'external-capability-drift-report.json') : null;
  const previousState = validatePreviousState(statePath && fs.existsSync(statePath) ? readJson(statePath) : { findingDigests: [] });
  const now = options.now ? Date.parse(options.now) : Date.now();
  if (!Number.isFinite(now)) fail('--now must be an ISO date-time.');
  const rawEvidence = config.targets.map((target) => evaluateTarget(repositoryRoot, target, now));
  const result = deduplicateDriftEvidence(rawEvidence, previousState.findingDigests || []);
  const report = {
    schemaVersion: 'ai-agent-toolkit.external-capability-drift-report.v1',
    checkedAt: new Date(now).toISOString(),
    noAction: result.noAction,
    findings: result.newMaterialFindings,
    guarantees: {
      aiCalls: false,
      browserAccess: false,
      secretReads: false,
      providerWrites: false,
      integrationMutation: false,
      routePromotionOrDemotion: false,
      credentialOperations: false,
      configurationMutation: false
    }
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  }
  if (statePath) {
    const next = { findingDigests: [...new Set([...(previousState.findingDigests || []), ...result.findingDigests])].sort() };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `material=${result.noAction ? 'false' : 'true'}\n`, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY && !result.noAction) {
    const rows = result.newMaterialFindings.map((entry) => `| ${entry.kind} | ${entry.key} | ${entry.findingDigest} |`).join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## External capability drift\n\n| Kind | Key | Finding digest |\n| --- | --- | --- |\n${rows}\n`, 'utf8');
  }
  process.stdout.write(`${result.noAction ? 'NO_ACTION' : `MATERIAL_DRIFT:${result.newMaterialFindings.length}`}\n`);
  return report;
}

module.exports = { CONFIG_SCHEMA_VERSION, parseArgs, resolveAllowlistedPath, resolveLocalOutputPath, validatePreviousState, jsonPointer, evaluateTarget, run };

if (require.main === module) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.code || 'EXTERNAL_DRIFT_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
