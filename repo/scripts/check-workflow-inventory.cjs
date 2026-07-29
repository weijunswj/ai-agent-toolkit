#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const acorn = require('acorn');
const YAML = require('yaml');
const { isDirectRequireCallee, isValidStaticRequireCall, isRequireMainCompare, isRequireResolveCall, isSafeRequireMemberProperty, isRequireMainMember, isRequireResolveMember, normaliseSignal, isValidSignal, VALID_SIGNALS } = require('./trusted-workflows/loader-policy.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const PRIVILEGED = new Set([
  '.github/workflows/auto-sync-generated-surfaces.yml',
  '.github/workflows/source-watch-pr.yml'
]);
const SOURCE_WATCH_PR_ALLOWED_SCRIPTS = new Set([
  'audit-project-source-locks.cjs',
  'check-project-source-updates.cjs',
  'plan-source-watch-pr-lifecycle.cjs'
]);
const ACTION_MANIFEST = 'repo/scripts/trusted-workflows/external-actions-manifest.json';
const ACTION_SHA = /^[0-9a-f]{40}$/;
const MAX_EXECUTION_PATHS = 128;
const MAX_RECURSION_DEPTH = 16;
const MAX_EXECUTION_NODES = 512;

class InventoryError extends Error {
  constructor(code, location) {
    super(code + ':' + location);
    this.code = code;
    this.location = location;
  }
}

class PowerShellState {
  constructor(value) {
    const source = value || {};
    this.lexical = new Map(source.lexical || []);
    this.environment = new Map(source.environment || []);
    this.location = source.location || '.';
    this.locationStack = (source.locationStack || []).slice();
  }
  invokeScript(operations, dotSourced) {
    const lexical = dotSourced ? this.lexical : new Map(this.lexical);
    for (const operation of operations) {
      if (operation.kind === 'lexical') lexical.set(operation.name, operation.value);
      else if (operation.kind === 'environment') this.environment.set(operation.name, operation.value);
      else if (operation.kind === 'environment-remove') this.environment.delete(operation.name);
      else if (operation.kind === 'set-location') this.location = operation.value;
      else if (operation.kind === 'push-location') { this.locationStack.push(this.location); this.location = operation.value; }
      else if (operation.kind === 'pop-location') {
        if (this.locationStack.length === 0) throw new InventoryError('WF_POWERSHELL_LOCATION_STACK', operation.name || 'Pop-Location');
        this.location = this.locationStack.pop();
      } else throw new InventoryError('WF_POWERSHELL_OPERATION', operation.kind);
    }
    if (dotSourced) this.lexical = lexical;
    return this;
  }
  childProcess() {
    return new PowerShellState({ environment: [...this.environment], location: this.location });
  }
  separateRunspace() {
    return new PowerShellState({ environment: [...this.environment], location: this.location });
  }
}

class RunnerIdentityState {
  constructor(jobId) {
    this.jobId = jobId;
    this.stepId = null;
    this.identities = new Map();
  }
  beginStep(stepId) {
    this.stepId = stepId;
    this.identities.clear();
    for (const kind of ['output', 'summary', 'env', 'path']) {
      this.identities.set(kind, Object.freeze({ kind: kind === 'output' || kind === 'summary' ? 'RUNNER_COMMAND_FILE' : 'RUNNER_' + kind.toUpperCase() + '_FILE', step_id: stepId, access: 'append-only' }));
    }
  }
  commandFile(kind, stepId, suffix) {
    if (stepId !== this.stepId || suffix) throw new InventoryError('WF_RUNNER_FILE_LIFETIME', this.jobId + ':' + stepId);
    if (!this.identities.has(kind)) throw new InventoryError('WF_RUNNER_FILE_KIND', kind);
    return this.identities.get(kind);
  }
  tempPath(components) {
    const normalized = normalizeRelative(components, this.jobId + ':runner-temp');
    return Object.freeze({ kind: 'RUNNER_TEMP_PATH', job_id: this.jobId, components: normalized, executable: false });
  }
}

class ExecutableIdentityState {
  constructor() {
    this.setup_generation = 0;
    this.setup_node_executable_identity = null;
    this.path_search_identity = null;
    this.resolved_executable_identity = null;
  }
  setup(identity) {
    this.setup_generation += 1;
    this.setup_node_executable_identity = Object.freeze({ ...identity, setup_generation: this.setup_generation });
    this.path_search_identity = identity.path_identity_digest;
    this.resolved_executable_identity = identity.node_sha256;
  }
  mutatePath(newDigest) {
    this.path_search_identity = newDigest;
    this.resolved_executable_identity = null;
    this.setup_node_executable_identity = null;
  }
  clearEnvironment() {
    this.mutatePath(null);
  }
  admitNode(resolvedDigest) {
    if (!this.setup_node_executable_identity || !resolvedDigest ||
        resolvedDigest !== this.setup_node_executable_identity.node_sha256 ||
        this.path_search_identity !== this.setup_node_executable_identity.path_identity_digest) {
      throw new InventoryError('WF_SETUP_NODE_IDENTITY', 'node');
    }
    this.resolved_executable_identity = resolvedDigest;
    return true;
  }
}

function validateFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    throw new InventoryError('WF_FRAME_MALFORMED', 'frame');
  }
  const keys = Object.keys(frame).sort();
  if (keys.length !== 4 || keys[0] !== 'duplicateOrdinal' || keys[1] !== 'kind' || keys[2] !== 'originIndex' || keys[3] !== 'scope') {
    throw new InventoryError('WF_FRAME_MALFORMED', 'frame_fields');
  }
  if (!['step', 'wrapper', 'package_script'].includes(frame.kind)) {
    throw new InventoryError('WF_FRAME_KIND_UNKNOWN', String(frame.kind));
  }
  if (typeof frame.scope !== 'string' || Buffer.byteLength(frame.scope, 'utf8') > 1024 || frame.scope !== frame.scope.normalize('NFC')) {
    throw new InventoryError('WF_FRAME_SCOPE_INVALID', String(frame.scope));
  }
  if (!Number.isInteger(frame.originIndex) || frame.originIndex < 0 || frame.originIndex > 127) {
    throw new InventoryError('WF_FRAME_ORIGIN_INVALID', String(frame.originIndex));
  }
  if (!Number.isInteger(frame.duplicateOrdinal) || frame.duplicateOrdinal < 1 || frame.duplicateOrdinal > 128) {
    throw new InventoryError('WF_FRAME_ORDINAL_INVALID', String(frame.duplicateOrdinal));
  }
}

function validateFrames(frames) {
  if (!Array.isArray(frames)) {
    throw new InventoryError('WF_FRAME_MALFORMED', 'not_array');
  }
  if (frames.length > 32) {
    throw new InventoryError('WF_FRAME_DEPTH_EXCEEDED', String(frames.length));
  }
  for (const frame of frames) {
    validateFrame(frame);
  }
}

function cloneExecutionState(state) {
  const clone = {
    checkouts: new Map([...state.checkouts].map(([key, value]) => [key, { ...value }])),
    env: new Map(state.env),
    checkoutGeneration: state.checkoutGeneration,
    setupGeneration: state.setupGeneration,
    capturedGeneration: state.capturedGeneration,
    pathIdentity: state.pathIdentity,
    installed: new Map([...state.installed].map(([key, value]) => [key, { ...value }])),
    workingDirectory: state.workingDirectory,
    locationStack: state.locationStack.slice(),
    processParentKey: state.processParentKey,
    occurrenceFrames: (state.occurrenceFrames || []).map((f) => ({
      kind: f.kind,
      scope: f.scope,
      originIndex: f.originIndex,
      duplicateOrdinal: f.duplicateOrdinal
    }))
  };
  if (state.outerParentKey !== undefined) {
    clone.outerParentKey = state.outerParentKey;
  }
  return clone;
}

function initialExecutionState() {
  return {
    checkouts: new Map(),
    env: new Map(),
    checkoutGeneration: 0,
    setupGeneration: 0,
    capturedGeneration: 0,
    pathIdentity: 0,
    installed: new Map(),
    workingDirectory: REPO_ROOT,
    locationStack: [],
    processParentKey: null,
    occurrenceFrames: []
  };
}

function stateFingerprint(state) {
  return JSON.stringify({
    checkouts: [...state.checkouts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    env: [...state.env].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    checkoutGeneration: state.checkoutGeneration,
    setupGeneration: state.setupGeneration,
    capturedGeneration: state.capturedGeneration,
    pathIdentity: state.pathIdentity,
    installed: [...state.installed].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    workingDirectory: state.workingDirectory,
    locationStack: state.locationStack
  });
}

function uniqueStates(states, location, expectedMode) {
  if (!Array.isArray(states)) throw new InventoryError('WF_STATE_INVALID', location);
  if (states.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  if (states.length === 0) return [];

  for (const state of states) {
    validateFrames(state.occurrenceFrames);
  }

  const hasFrames = states[0].occurrenceFrames.length > 0;
  for (const state of states) {
    if ((state.occurrenceFrames.length > 0) !== hasFrames) {
      throw new InventoryError('WF_REDUCTION_MIXED_FRAMES', location);
    }
  }

  const actualMode = hasFrames ? 'occurrence-sensitive' : 'ordinary';
  if (expectedMode && expectedMode !== actualMode) {
    throw new InventoryError('WF_REDUCTION_MODE_MISMATCH', location);
  }

  const values = new Map();
  for (const state of states) {
    let key;
    if (actualMode === 'occurrence-sensitive') {
      key = JSON.stringify({
        frames: state.occurrenceFrames,
        fingerprint: stateFingerprint(state)
      });
    } else {
      key = JSON.stringify({
        parent: state.processParentKey || '',
        fingerprint: stateFingerprint(state)
      });
    }
    values.set(key, state);
  }

  if (values.size > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  return [...values.values()];
}

function buildWrapperCacheKey(shell, relPath, states, location) {
  if (states.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  if (!['bash', 'pwsh', 'cmd'].includes(shell)) throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'shell');
  const normPath = String(relPath).replace(/\\/g, '/').normalize('NFC');
  if (Buffer.byteLength(normPath, 'utf8') > 1024 || normPath.includes('/./') || normPath.includes('/../') || normPath.startsWith('../') || normPath.startsWith('./')) {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'path');
  }

  const countsMap = new Map();
  for (const state of states) {
    const callerToken = state.processParentKey || '';
    if (Buffer.byteLength(callerToken, 'utf8') > 1024) throw new InventoryError('WF_CACHE_KEY_OVERSIZE', location);
    const fp = crypto.createHash('sha256').update(stateFingerprint(state)).digest('hex');
    const rowKey = callerToken + '\0' + fp;
    if (!countsMap.has(rowKey)) {
      countsMap.set(rowKey, { callerToken, semanticFingerprint: fp, count: 0 });
    }
    const row = countsMap.get(rowKey);
    row.count += 1;
    if (row.count > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  }

  const inputs = [...countsMap.values()].sort((a, b) => {
    if (a.callerToken !== b.callerToken) return a.callerToken < b.callerToken ? -1 : 1;
    return a.semanticFingerprint < b.semanticFingerprint ? -1 : a.semanticFingerprint > b.semanticFingerprint ? 1 : 0;
  });

  const keyObj = {
    namespace: 'workflow-wrapper-cache',
    version: 2,
    shell,
    path: normPath,
    inputs
  };

  const keyString = JSON.stringify(keyObj);
  if (Buffer.byteLength(keyString, 'utf8') > 16384) {
    throw new InventoryError('WF_CACHE_KEY_OVERSIZE', location);
  }
  validateWrapperCacheKey(keyString, location);
  return keyString;
}

function validateWrapperCacheKey(keyString, location) {
  if (typeof keyString !== 'string' || Buffer.byteLength(keyString, 'utf8') > 16384) {
    throw new InventoryError('WF_CACHE_KEY_OVERSIZE', location || 'key');
  }
  let parsed;
  try {
    parsed = JSON.parse(keyString);
  } catch {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', location || 'json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'root');
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 5 || keys[0] !== 'namespace' || keys[1] !== 'version' || keys[2] !== 'shell' || keys[3] !== 'path' || keys[4] !== 'inputs') {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'fields');
  }
  if (parsed.namespace !== 'workflow-wrapper-cache' || parsed.version !== 2) {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'version');
  }
  if (!['bash', 'pwsh', 'cmd'].includes(parsed.shell)) {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'shell');
  }
  if (typeof parsed.path !== 'string' || Buffer.byteLength(parsed.path, 'utf8') > 1024 || parsed.path !== parsed.path.normalize('NFC') ||
      parsed.path.startsWith('/') || parsed.path.startsWith('../') || parsed.path.startsWith('./') ||
      parsed.path.includes('/./') || parsed.path.includes('/../') || parsed.path === '.' || parsed.path === '..') {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'path');
  }
  if (!Array.isArray(parsed.inputs) || parsed.inputs.length > 128) {
    throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'inputs');
  }
  let prevCaller = null;
  let prevFp = null;
  for (const item of parsed.inputs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'input_item');
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== 3 || itemKeys[0] !== 'callerToken' || itemKeys[1] !== 'semanticFingerprint' || itemKeys[2] !== 'count') {
      throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'input_keys');
    }
    if (typeof item.callerToken !== 'string' || Buffer.byteLength(item.callerToken, 'utf8') > 1024) {
      throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'callerToken');
    }
    if (typeof item.semanticFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(item.semanticFingerprint)) {
      throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'semanticFingerprint');
    }
    if (!Number.isInteger(item.count) || item.count < 1 || item.count > 128) {
      throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'count');
    }
    if (prevCaller !== null) {
      if (item.callerToken < prevCaller || (item.callerToken === prevCaller && item.semanticFingerprint <= prevFp)) {
        throw new InventoryError('WF_CACHE_KEY_MALFORMED', 'sorting');
      }
    }
    prevCaller = item.callerToken;
    prevFp = item.semanticFingerprint;
  }
}

function extractSemanticState(state) {
  return {
    checkouts: [...state.checkouts].map(([k, v]) => [k, { ...v }]),
    env: [...state.env],
    checkoutGeneration: state.checkoutGeneration,
    setupGeneration: state.setupGeneration,
    capturedGeneration: state.capturedGeneration,
    pathIdentity: state.pathIdentity,
    installed: [...state.installed].map(([k, v]) => [k, { ...v }]),
    workingDirectory: state.workingDirectory,
    locationStack: state.locationStack.slice()
  };
}

function validateWrapperCacheValue(value, inputStatesCount, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'root');
  }
  const keys = Object.keys(value);
  if (keys.length !== 5 || keys[0] !== 'namespace' || keys[1] !== 'version' || keys[2] !== 'origins' || keys[3] !== 'success' || keys[4] !== 'failure') {
    throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'keys');
  }
  if (value.namespace !== 'workflow-wrapper-cache-value' || value.version !== 2) {
    throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'version');
  }
  if (!Array.isArray(value.origins) || (inputStatesCount !== undefined && value.origins.length !== inputStatesCount)) {
    throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'origins_length');
  }
  const originSet = new Set();
  for (let i = 0; i < value.origins.length; i += 1) {
    const o = value.origins[i];
    if (!o || typeof o !== 'object' || o.origin !== i || typeof o.semanticFingerprint !== 'string' || o.inputCount !== 1) {
      throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'origin_item');
    }
    if (originSet.has(o.origin)) throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'duplicate_origin');
    originSet.add(o.origin);
  }

  for (const collectionName of ['success', 'failure']) {
    const coll = value[collectionName];
    if (!Array.isArray(coll)) throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || collectionName);
    const ordinalsPerOrigin = new Map();
    for (const item of coll) {
      if (!item || typeof item !== 'object') throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'item');
      const itemKeys = Object.keys(item);
      if (itemKeys.length !== 3 || itemKeys[0] !== 'origin' || itemKeys[1] !== 'outputOrdinal' || itemKeys[2] !== 'semanticState') {
        throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'item_keys');
      }
      if (!originSet.has(item.origin)) throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'unknown_origin');
      const expectedOrdinal = ordinalsPerOrigin.get(item.origin) || 0;
      if (item.outputOrdinal !== expectedOrdinal) throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'ordinal_gap');
      ordinalsPerOrigin.set(item.origin, expectedOrdinal + 1);

      const sem = item.semanticState;
      if (!sem || typeof sem !== 'object' || Array.isArray(sem)) throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'semanticState');
      const forbiddenKeys = ['callerToken', 'processParentKey', 'outerParentKey', 'occurrenceFrames', 'wrapperOccurrenceIdentity'];
      for (const fk of forbiddenKeys) {
        if (Object.prototype.hasOwnProperty.call(sem, fk) || Object.prototype.hasOwnProperty.call(item, fk)) {
          throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location || 'caller_leakage');
        }
      }
    }
  }
}

function rebindCacheValue(cacheValue, inputStates, relScriptPath, location) {
  validateWrapperCacheValue(cacheValue, inputStates.length, location);
  const rebindCollection = (coll) => {
    return coll.map((entry) => {
      const parentState = inputStates[entry.origin];
      if (!parentState) throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location);
      const sem = entry.semanticState;
      const rebound = {
        checkouts: new Map(sem.checkouts.map(([k, v]) => [k, { ...v }])),
        env: new Map(sem.env),
        checkoutGeneration: sem.checkoutGeneration,
        setupGeneration: sem.setupGeneration,
        capturedGeneration: sem.capturedGeneration,
        pathIdentity: sem.pathIdentity,
        installed: new Map(sem.installed.map(([k, v]) => [k, { ...v }])),
        workingDirectory: sem.workingDirectory,
        locationStack: sem.locationStack.slice(),
        processParentKey: parentState.processParentKey,
        occurrenceFrames: parentState.occurrenceFrames.map((f) => ({
          kind: f.kind,
          scope: f.scope,
          originIndex: f.originIndex,
          duplicateOrdinal: f.duplicateOrdinal
        }))
      };
      return rebound;
    });
  };
  return {
    success: rebindCollection(cacheValue.success),
    failure: rebindCollection(cacheValue.failure)
  };
}

function normalizeRelative(value, location) {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)) throw new InventoryError('WF_PATH_INVALID', location);
  const parts = value.replace(/\\/g, '/').split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new InventoryError('WF_PATH_INVALID', location);
  return parts.join('/');
}

function resolveContained(root, relative, location) {
  const normalized = normalizeRelative(relative, location);
  const absolute = path.resolve(root, ...normalized.split('/'));
  const rel = path.relative(root, absolute);
  if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new InventoryError('WF_PATH_ESCAPE', location);
  let realRoot = fs.realpathSync.native(root);
  let realTarget;
  try {
    realTarget = fs.realpathSync.native(absolute);
  } catch {
    throw new InventoryError('WF_PATH_MISSING', location);
  }
  const realRel = path.relative(realRoot, realTarget);
  if (realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) throw new InventoryError('WF_REALPATH_ESCAPE', location);
  return realTarget;
}

function parseDocument(file) {
  let value;
  try {
    value = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new InventoryError('WF_YAML_INVALID', path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InventoryError('WF_YAML_ROOT', file);
  return value;
}

function tokenize(command, location) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < command.length) current += command[++i];
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && current === '') {
      while (i + 1 < command.length && command[i + 1] !== '\n') i += 1;
      continue;
    }
    if (char === '\n') {
      if (current) { tokens.push(current); current = ''; }
      if (tokens.length > 0 && tokens[tokens.length - 1] !== ';') tokens.push(';');
      continue;
    }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    if ([';', '|', '&', '(', ')', '{', '}'].includes(char)) {
      if (current) { tokens.push(current); current = ''; }
      if (char === '&' && tokens.length > 0 && ['>', '>>'].includes(tokens[tokens.length - 1])) {
        tokens[tokens.length - 1] += '&';
        continue;
      }
      const pair = command.slice(i, i + 2);
      if (['&&', '||'].includes(pair)) { tokens.push(pair); i += 1; }
      else tokens.push(char);
      continue;
    }
    if (char === '\\' && i + 1 < command.length) {
      if (command[i + 1] === '\n') {
        i += 1;
        continue;
      }
      current += command[++i];
      continue;
    }
    if (char === '`' || (char === '$' && command[i + 1] === '(')) throw new InventoryError('WF_DYNAMIC_COMMAND', location);
    current += char;
  }
  if (quote) throw new InventoryError('WF_UNCLOSED_QUOTE', location);
  if (current) tokens.push(current);
  return skipHeredocBodies(tokens, command, location);
}

function skipHeredocBodies(tokens, command, location) {
  const result = [];
  for (let i = 0; i < tokens.length; i += 1) {
    let delim = null;
    if (tokens[i] === '<<') {
      const delimToken = tokens[i + 1];
      if (delimToken) {
        const bareMatch = delimToken.match(/^'([^']+)'$/);
        const dquoteMatch = delimToken.match(/^"([^"]+)"$/);
        if (bareMatch) delim = bareMatch[1];
        else if (dquoteMatch) delim = dquoteMatch[1];
        else delim = delimToken;
      }
    } else {
      const hdMatch = tokens[i].match(/^<<('([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))$/);
      if (hdMatch) delim = hdMatch[2] || hdMatch[3] || hdMatch[4];
    }
    if (delim) {
      result.push(tokens[i]);
      for (let j = i + 1; j < tokens.length; j += 1) {
        if (tokens[j] === delim && j > 0 && tokens[j - 1] === ';') {
          result.push(';');
          result.push(tokens[j]);
          i = j;
          break;
        }
        i = j;
      }
    } else {
      result.push(tokens[i]);
    }
  }
  return result;
}

function parseCommandGraph(command, shell, location) {
  if (/powershell|pwsh/i.test(shell || '')) {
    if (/(@'|@"|'@|"@)/.test(command)) throw new InventoryError('WF_POWERSHELL_HERE_STRING', location);
    if (/[{}()]/.test(command) || /\$\(/.test(command) || /`[^\r\n]/.test(command) || /(?:^|\s)>{1,2}(?:\s|$)/.test(command)) {
      throw new InventoryError('WF_POWERSHELL_UNSUPPORTED', location);
    }
  }
  const powershell = /powershell|pwsh/i.test(shell || '');
  const cmd = /(?:^|[\\/])cmd(?:\.exe)?$/i.test(String(shell || ''));
  const tokens = tokenize(command.replace(/\r\n/g, '\n'), location);
  let index = 0;

  const parsePrimary = () => {
    if (tokens[index] === '(' || tokens[index] === '{') {
      const open = tokens[index++];
      const close = open === '(' ? ')' : '}';
      const body = parseSequence(close);
      if (tokens[index] !== close) throw new InventoryError('WF_GROUP_UNCLOSED', location);
      index += 1;
      return { type: open === '(' ? 'subshell' : 'group', body };
    }
    const words = [];
    if (powershell && tokens[index] === '&') words.push(tokens[index++]);
    while (index < tokens.length && ![';', '&&', '||', '|', ')', '}', '&'].includes(tokens[index])) {
      words.push(tokens[index++]);
    }
    if (!words.length) throw new InventoryError('WF_COMMAND_EMPTY', location);
    if (powershell && words[0] === '&') {
      if (words.length < 2 || /[$`]/.test(words[1])) throw new InventoryError('WF_POWERSHELL_CALL_OPERATOR', location);
      words.shift();
    } else if (powershell && words[0] === '.') {
      if (words.length < 2 || /[$`]/.test(words[1])) throw new InventoryError('WF_POWERSHELL_DOT_SOURCE', location);
      words.shift();
      words.unshift('dot-source');
    }
    return { type: 'command', tokens: words };
  };

  const parsePipeline = () => {
    const members = [parsePrimary()];
    while (tokens[index] === '|') {
      index += 1;
      members.push(parsePrimary());
    }
    return members.length === 1 ? members[0] : { type: 'pipeline', members };
  };

  const parseAndOr = () => {
    let value = parsePipeline();
    while (tokens[index] === '&&' || tokens[index] === '||') {
      const operator = tokens[index++];
      value = { type: operator === '&&' ? 'and' : 'or', left: value, right: parsePipeline() };
    }
    return value;
  };

  function parseSequence(stop) {
    const members = [];
    while (index < tokens.length && tokens[index] !== stop) {
      if (tokens[index] === ';') {
        index += 1;
        continue;
      }
      if (tokens[index] === 'case') {
        while (index < tokens.length && tokens[index] !== 'esac') index += 1;
      }
      members.push(parseAndOr());
      if (tokens[index] === ')' && tokens[index + 1] === '{') {
        index += 2;
        const body = parseSequence('}');
        if (tokens[index] !== '}') throw new InventoryError('WF_GROUP_UNCLOSED', location);
        index += 1;
      }
      if (tokens[index] === '&') {
        if (!cmd) throw new InventoryError('WF_BACKGROUND_UNSUPPORTED', location);
        index += 1;
      } else if (tokens[index] === ';') {
        index += 1;
      } else if (tokens[index] !== stop && index < tokens.length) {
        throw new InventoryError('WF_COMMAND_OPERATOR', location);
      }
    }
    if (!members.length) return { type: 'noop' };
    return members.length === 1 ? members[0] : { type: 'sequence', members };
  }

  const graph = parseSequence(null);
  if (index !== tokens.length) throw new InventoryError('WF_COMMAND_TRAILING', location);
  return graph;
}

function segments(command, shell, location) {
  const result = [];
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'command') result.push(node.tokens.slice());
    else if (node.type === 'sequence') node.members.forEach(visit);
    else if (node.type === 'pipeline') node.members.forEach(visit);
    else if (node.type === 'and' || node.type === 'or') { visit(node.left); visit(node.right); }
    else if (node.type === 'subshell' || node.type === 'group') visit(node.body);
  };
  visit(parseCommandGraph(command, shell, location));
  return result;
}

function derivePackageRoot(checkoutRoot, executionDirectory, location) {
  const realCheckout = fs.realpathSync.native(checkoutRoot);
  let current = fs.realpathSync.native(executionDirectory);
  const relative = path.relative(realCheckout, current);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new InventoryError('WF_PACKAGE_ROOT_ESCAPE', location);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    if (current === realCheckout) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new InventoryError('WF_PACKAGE_ROOT_MISSING', location);
}

function resolvePackageScriptGraph(checkoutRoot, executionDirectory, scriptName, location) {
  const packageRoot = derivePackageRoot(checkoutRoot, executionDirectory, location);
  const packageFile = path.join(packageRoot, 'package.json');
  const packageDocument = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const scripts = packageDocument.scripts || {};
  const active = new Set();
  const memo = new Set();
  const visited = [];
  const visit = (name) => {
    const key = packageRoot + '\0' + name;
    if (active.has(key)) throw new InventoryError('WF_PACKAGE_SCRIPT_CYCLE', location + ':' + name);
    if (memo.has(key)) return;
    if (!Object.prototype.hasOwnProperty.call(scripts, name) || typeof scripts[name] !== 'string') {
      throw new InventoryError('WF_PACKAGE_SCRIPT_MISSING', location + ':' + name);
    }
    active.add(key);
    visited.push({ package_root: packageRoot, script_name: name });
    for (const tokens of segments(scripts[name], 'bash', location + ':' + name)) {
      validateWrapper(tokens, location + ':' + name);
      if (/^npm(?:\.cmd)?$/i.test(tokens[0] || '') && ['run', 'run-script'].includes(tokens[1])) {
        if (tokens.length !== 3 || tokens.includes('--prefix') || tokens.some((token) => /^--workspace(?:s)?(?:=|$)/.test(token))) {
          throw new InventoryError('WF_PACKAGE_SCRIPT_ARGUMENTS', location + ':' + name);
        }
        visit(tokens[2]);
      } else if (/^npm(?:\.cmd)?$/i.test(tokens[0] || '') &&
          tokens.some((token) => token === '--prefix' || /^--workspace(?:s)?(?:=|$)/.test(token))) {
        throw new InventoryError('WF_PACKAGE_SCRIPT_ROOT_OVERRIDE', location + ':' + name);
      }
    }
    active.delete(key);
    memo.add(key);
  };
  visit(scriptName);
  return { package_root: packageRoot, visited };
}

function mutatesDependencyTree(tokens) {
  const command = path.basename(tokens[0] || '').toLowerCase().replace(/\.exe$/, '');
  if (!['rm', 'rmdir', 'del', 'remove-item', 'move-item', 'mv', 'git'].includes(command)) return false;
  return tokens.some((token) => /(^|[\\/])(node_modules|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)([\\/]|$)/i.test(token)) ||
    (command === 'git' && ['checkout', 'clean', 'reset'].includes(tokens[1]));
}

function isNodeLike(tokens) {
  if (!tokens.length) return false;
  let index = 0;
  if (tokens[0] === 'env') {
    index = 1;
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  }
  const command = tokens[index] || '';
  return ['node', 'npm', 'npx', 'pnpm', 'yarn'].includes(path.basename(command).toLowerCase().replace(/\.cmd$/, '')) ||
    /\.(c?js|mjs)$/i.test(command);
}

function validateWrapper(tokens, location) {
  if (!tokens.length) return;
  if (tokens[0] === 'command' && tokens[1] === '-p') throw new InventoryError('WF_COMMAND_P_REJECTED', location);
  if (tokens.includes('xargs')) throw new InventoryError('WF_XARGS_REJECTED', location);
  if (tokens[0] === 'find' && tokens.some((token) => ['-exec', '-execdir'].includes(token))) {
    throw new InventoryError('WF_FIND_EXEC_REJECTED', location);
  }
  const executable = path.basename(tokens[0]).toLowerCase().replace(/\.exe$/, '');
  if (['bash', 'sh'].includes(executable)) {
    let index = 1;
    const allowed = new Set(['-e', '-u', '-x', '-eu', '-ue']);
    while (index < tokens.length && tokens[index].startsWith('-')) {
      if (!allowed.has(tokens[index])) throw new InventoryError('WF_WRAPPER_OPTION', location);
      index += 1;
    }
    if (index >= tokens.length || tokens.slice(index + 1).some((token) => /\.(sh|bash)$/.test(token))) {
      throw new InventoryError('WF_WRAPPER_SCRIPT_COUNT', location);
    }
    if (/[$`]/.test(tokens[index])) throw new InventoryError('WF_WRAPPER_DYNAMIC_PATH', location);
  }
  if (['pwsh', 'powershell'].includes(executable)) {
    const fileIndexes = tokens.map((token, index) => /^-(file|f)$/i.test(token) ? index : -1).filter((index) => index >= 0);
    if (fileIndexes.length !== 1 || fileIndexes[0] + 1 >= tokens.length) throw new InventoryError('WF_WRAPPER_SCRIPT_COUNT', location);
    if (/[$`]/.test(tokens[fileIndexes[0] + 1])) throw new InventoryError('WF_WRAPPER_DYNAMIC_PATH', location);
  }
  if (executable === 'cmd') {
    if (tokens.length < 3 || !/^\/c$/i.test(tokens[1]) || /[$`%]/.test(tokens[2])) throw new InventoryError('WF_CMD_WRAPPER', location);
  }
}

const STATIC_LAUNCHERS = new Set(['command', 'timeout', 'nice']);
const REJECTED_DELEGATORS = new Set(['nohup', 'setsid', 'chroot', 'stdbuf', 'sudo', 'doas', 'start']);
const DURATION_RE = /^(?:\d+|\d+\.\d+)[smhd]?$/;

function unwrapStaticLauncher(tokens, location) {
  const base = path.basename(tokens[0] || '').toLowerCase().replace(/\.exe$/, '');
  if (REJECTED_DELEGATORS.has(base)) throw new InventoryError('WF_LAUNCHER_REJECTED', location);
  if (!STATIC_LAUNCHERS.has(base)) return { kind: 'ordinary', tokens };
  if (tokens.length < 2) throw new InventoryError('WF_LAUNCHER_MISSING_COMMAND', location);
  if (base === 'command') return unwrapCommand(tokens, location);
  if (base === 'timeout') return unwrapTimeout(tokens, location);
  if (base === 'nice') return unwrapNice(tokens, location);
  return { kind: 'ordinary', tokens };
}

function unwrapCommand(tokens, location) {
  let idx = 1;
  if (tokens[idx] === '--') {
    idx += 1;
    if (idx >= tokens.length) throw new InventoryError('WF_LAUNCHER_MISSING_COMMAND', location);
    return { kind: 'execution', tokens: tokens.slice(idx) };
  }
  if (tokens[idx] === '-p') throw new InventoryError('WF_COMMAND_P_REJECTED', location);
  if (/^-[Vv]$/.test(tokens[idx])) {
    if (tokens.length <= idx + 1) throw new InventoryError('WF_LAUNCHER_LOOKUP_MODE', location);
    throw new InventoryError('WF_LAUNCHER_LOOKUP_MODE', location);
  }
  if (/^-/.test(tokens[idx])) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
  return { kind: 'execution', tokens: tokens.slice(idx) };
}

function unwrapTimeout(tokens, location) {
  let idx = 1;
  while (idx < tokens.length && /^--?(?!$)/.test(tokens[idx])) {
    const opt = tokens[idx];
    if (opt === '--') { idx += 1; break; }
    if (/^--signal=/.test(opt)) {
      const eqIdx = opt.indexOf('=');
      if (eqIdx < 0 || eqIdx + 1 >= opt.length) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
      if (!isValidSignal(opt.slice(eqIdx + 1))) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
      idx += 1; continue;
    }
    if (/^--kill-after=/.test(opt)) {
      const eqIdx = opt.indexOf('=');
      if (eqIdx < 0 || eqIdx + 1 >= opt.length) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
      if (!DURATION_RE.test(opt.slice(eqIdx + 1))) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
      idx += 1; continue;
    }
    if (/^-[sk]$/.test(opt)) {
      idx += 1;
      if (idx >= tokens.length) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
      if (opt === '-s') { if (!isValidSignal(tokens[idx])) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location); }
      else { if (!DURATION_RE.test(tokens[idx])) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location); }
      idx += 1; continue;
    }
    if (/^--/.test(opt)) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
    throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
  }
  if (idx >= tokens.length) throw new InventoryError('WF_LAUNCHER_MISSING_COMMAND', location);
  if (!DURATION_RE.test(tokens[idx])) throw new InventoryError('WF_LAUNCHER_DURATION', location);
  idx += 1;
  if (idx >= tokens.length) throw new InventoryError('WF_LAUNCHER_MISSING_COMMAND', location);
  return { kind: 'execution', tokens: tokens.slice(idx) };
}

function unwrapNice(tokens, location) {
  let idx = 1;
  while (idx < tokens.length) {
    const opt = tokens[idx];
    if (opt === '--') { idx += 1; break; }
    if (/^--/.test(opt)) {
      if (/^--adjustment=/.test(opt)) {
        const eqIdx = opt.indexOf('=');
        if (eqIdx < 0 || !/^-?\d+$/.test(opt.slice(eqIdx + 1))) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
        idx += 1; continue;
      }
      throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
    }
    break;
  }
  if (idx >= tokens.length) throw new InventoryError('WF_LAUNCHER_MISSING_COMMAND', location);
  if (tokens[idx] === '-n') {
    if (idx + 1 >= tokens.length || !/^-?\d+$/.test(tokens[idx + 1])) throw new InventoryError('WF_LAUNCHER_OPTION_UNSUPPORTED', location);
    idx += 2;
  }
  if (idx >= tokens.length) throw new InventoryError('WF_LAUNCHER_MISSING_COMMAND', location);
  return { kind: 'execution', tokens: tokens.slice(idx) };
}

function structuralPath(value, checkouts, env, location) {
  if (value === undefined) return { kind: 'WORKSPACE_ROOT' };
  if (typeof value !== 'string') throw new InventoryError('WF_STRUCTURAL_EXPRESSION', location);
  let candidate = value;
  if (env.has(candidate)) candidate = env.get(candidate);
  if (candidate === '${{ github.workspace }}') return { kind: 'WORKSPACE_ROOT' };
  const match = candidate.match(/^\$\{\{ github\.workspace \}\}\/([A-Za-z0-9._/-]+)$/);
  if (!match) throw new InventoryError('WF_STRUCTURAL_EXPRESSION', location);
  const components = normalizeRelative(match[1], location);
  const checkout = [...checkouts.values()].find((entry) => entry.path === components);
  if (!checkout) throw new InventoryError('WF_STRUCTURAL_CHECKOUT_UNKNOWN', location);
  return { kind: 'CHECKOUT_PATH', checkout_id: checkout.id, generation: checkout.generation, components };
}

function loadActionAuthority() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ACTION_MANIFEST), 'utf8'));
  const expectedMetadata = {
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1': {
      action_type: 'javascript', main: 'dist/index.js', post: 'dist/index.js', runs_using: 'node24'
    },
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020': {
      action_type: 'javascript', main: 'dist/setup/index.js', post: 'dist/cache-save/index.js', runs_using: 'node24'
    }
  };
  const allowed = new Map();
  for (const entry of manifest.actions || []) {
    if (!ACTION_SHA.test(entry.commit)) throw new InventoryError('WF_ACTION_MANIFEST_SHA', ACTION_MANIFEST);
    const key = entry.owner + '/' + entry.repository + '@' + entry.commit;
    const expected = expectedMetadata[key];
    if (!expected || entry.action_type !== expected.action_type || !entry.entrypoints ||
        entry.entrypoints.main !== expected.main || entry.entrypoints.post !== expected.post ||
        entry.entrypoints.runs_using !== expected.runs_using) {
      throw new InventoryError('WF_ACTION_ENTRYPOINT_DRIFT', key);
    }
    if (allowed.has(key)) throw new InventoryError('WF_ACTION_MANIFEST_DUPLICATE', key);
    allowed.set(key, { entry, unused: new Set(entry.locations) });
  }
  return allowed;
}

function validatePrivilegedActions(relative, workflow, authority) {
  for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      if (!step.uses || step.uses.startsWith('./')) continue;
      const [action, ref, extra] = String(step.uses).split('@');
      if (!ref || extra !== undefined || !ACTION_SHA.test(ref)) throw new InventoryError('WF_ACTION_IMMUTABLE_REF', relative + '#' + jobId);
      const key = action + '@' + ref;
      const record = authority.get(key);
      if (!record) throw new InventoryError('WF_ACTION_UNDECLARED', relative + '#' + jobId);
      if (!step.id) throw new InventoryError('WF_ACTION_STEP_ID', relative + '#' + jobId);
      const location = relative + '#' + jobId + '.' + step.id;
      if (!record.unused.delete(location)) throw new InventoryError('WF_ACTION_LOCATION', location);
      if (action === 'actions/setup-node' && (!step.with || step.with['package-manager-cache'] !== false)) {
        throw new InventoryError('WF_SETUP_NODE_CACHE', location);
      }
    }
  }
}

function cloneStates(states) {
  return states.map(cloneExecutionState);
}

function executionDirectory(repoRoot, root) {
  if (root.kind === 'WORKSPACE_ROOT' || root.kind === 'CHECKOUT_PATH') return repoRoot;
  throw new InventoryError('WF_EXECUTION_ROOT', root.kind);
}

function installationKey(root) {
  return JSON.stringify(root);
}

function packageInstallationKey(root, packageRoot) {
  return installationKey(root) + '\0' + packageRoot;
}

function requireNodeAuthority(states, root, privileged, joined, location, repoRoot) {
  for (const state of states) {
    if (!state.setupGeneration) throw new InventoryError('WF_NODE_WITHOUT_SETUP', location);
    if (privileged) {
      if (state.capturedGeneration !== state.setupGeneration) throw new InventoryError('WF_NODE_IDENTITY_UNCAPTURED', location);
      if (!/verify-closure-manifest\.cjs/.test(joined) && !/capture-node-toolchain\.cjs/.test(joined)) {
        const baseName = joined.split('/').pop().split(' ')[0];
        if (!SOURCE_WATCH_PR_ALLOWED_SCRIPTS.has(baseName)) {
          throw new InventoryError('WF_PRIVILEGED_UNVERIFIED_NODE', location);
        }
      }
      continue;
    }
    const packageRoot = derivePackageRoot(repoRoot, state.workingDirectory, location);
    const key = packageInstallationKey(root, packageRoot);
    const installed = state.installed.get(key);
    if (!installed || installed.checkoutGeneration !== state.checkoutGeneration ||
        installed.setupGeneration !== state.setupGeneration || installed.pathIdentity !== state.pathIdentity) {
      throw new InventoryError('WF_NODE_WITHOUT_INSTALL', location);
    }
  }
}

function resolveStaticFile(root, directory, value, location) {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value) || /[$`%]|\$\(/.test(value)) {
    throw new InventoryError('WF_WRAPPER_DYNAMIC_PATH', location);
  }
  const absolute = path.resolve(directory, value);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new InventoryError('WF_WRAPPER_PATH_ESCAPE', location);
  }
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync.native(root);
    realFile = fs.realpathSync.native(absolute);
  } catch {
    throw new InventoryError('WF_WRAPPER_PATH_MISSING', location);
  }
  const realRelative = path.relative(realRoot, realFile);
  if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative) ||
      !fs.statSync(realFile).isFile()) {
    throw new InventoryError('WF_WRAPPER_PATH_ESCAPE', location);
  }
  return realFile;
}

function resolveStaticDirectory(root, directory, value, location) {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value) || /[$`%]|\$\(/.test(value)) {
    throw new InventoryError('WF_WRAPPER_DYNAMIC_PATH', location);
  }
  const absolute = path.resolve(directory, value);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new InventoryError('WF_WRAPPER_PATH_ESCAPE', location);
  }
  let realRoot;
  let realDirectory;
  try {
    realRoot = fs.realpathSync.native(root);
    realDirectory = fs.realpathSync.native(absolute);
  } catch {
    throw new InventoryError('WF_WORKING_DIRECTORY', location);
  }
  const realRelative = path.relative(realRoot, realDirectory);
  if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative) ||
      !fs.statSync(realDirectory).isDirectory()) {
    throw new InventoryError('WF_WRAPPER_PATH_ESCAPE', location);
  }
  return realDirectory;
}

function wrapperInvocation(tokens) {
  const executable = path.basename(tokens[0] || '').toLowerCase().replace(/\.exe$/, '');
  if (['bash', 'sh'].includes(executable)) {
    let index = 1;
    const allowed = new Set(['-e', '-u', '-x', '-eu', '-ue']);
    while (index < tokens.length && tokens[index].startsWith('-')) {
      if (!allowed.has(tokens[index])) return null;
      index += 1;
    }
    return index < tokens.length ? { shell: executable, script: tokens[index] } : null;
  }
  if (['pwsh', 'powershell'].includes(executable)) {
    const index = tokens.findIndex((token) => /^-(file|f)$/i.test(token));
    return index >= 0 && index + 1 < tokens.length ? { shell: 'pwsh', script: tokens[index + 1] } : null;
  }
  if (executable === 'cmd' && tokens.length >= 3 && /^\/c$/i.test(tokens[1])) {
    return { shell: 'cmd', script: tokens[2] };
  }
  if (tokens[0] === 'dot-source' && tokens[1]) return { shell: 'pwsh', script: tokens[1] };
  if (/\.(?:sh|bash)$/i.test(tokens[0] || '')) return { shell: 'bash', script: tokens[0] };
  if (/\.ps1$/i.test(tokens[0] || '')) return { shell: 'pwsh', script: tokens[0] };
  if (/\.(?:cmd|bat)$/i.test(tokens[0] || '')) return { shell: 'cmd', script: tokens[0] };
  return null;
}

function parseJavaScript(file, location) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    return acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module', allowHashBang: true });
  } catch {
    throw new InventoryError('WF_LOCAL_JS_PARSE', location);
  }
}

function walkAst(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((item) => walkAst(item, visitor));
    else if (value && typeof value === 'object') walkAst(value, visitor);
  }
}

function walkAstWithParent(node, parent, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((item) => walkAstWithParent(item, node, visitor));
    else if (value && typeof value === 'object') walkAstWithParent(value, node, visitor);
  }
}

function checkLoaderChainExpression(ast, location) {
  walkAst(ast, (node) => {
    if (node.type !== 'ChainExpression') return;
    let found = false;
    walkAst(node, (child) => {
      if (child === node) return;
      if (child.type === 'Identifier' && child.name === 'require') found = true;
      if (child.type === 'MemberExpression' && !child.computed &&
          child.object && child.object.type === 'Identifier' && child.object.name === 'require') {
        found = true;
      }
    });
    if (found) throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
  });
}

function checkLoaderAliases(ast, location) {
  const parentMap = new Map();
  walkAst(ast, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach((item) => { if (item && typeof item === 'object') parentMap.set(item, node); });
      else if (value && typeof value === 'object') parentMap.set(value, node);
    }
  });
  checkLoaderChainExpression(ast, location);
  walkAst(ast, (node) => {
    if (node.type === 'Identifier' && node.name === 'createRequire') {
      throw new InventoryError('WF_LOCAL_JS_LOADER_CREATION', location);
    }
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' &&
        node.callee.name === 'require' && node.arguments.length === 1 &&
        node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string' &&
        (node.arguments[0].value === 'module' || node.arguments[0].value === 'node:module')) {
      throw new InventoryError('WF_LOCAL_JS_LOADER_CREATION', location);
    }
    if (node.type === 'CallExpression' && node.optional &&
        node.callee && node.callee.type === 'MemberExpression' &&
        node.callee.object && node.callee.object.type === 'Identifier' && node.callee.object.name === 'require') {
      throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
    }
    if (node.type === 'MemberExpression' &&
        node.object && node.object.type === 'Identifier' && node.object.name === 'require') {
      if (node.optional) throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
      if (node.computed) throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
      if (!node.property || node.property.type !== 'Identifier') throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
      const prop = node.property.name;
      const parent = parentMap.get(node);
      if (parent && parent.type === 'MemberExpression' && parent.object === node) {
        throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
      }
      if (prop === 'main') {
        if (isRequireMainCompare(node, parent)) return;
        throw new InventoryError('WF_LOCAL_JS_LOADER_MAIN_CONTEXT', location);
      }
      if (prop === 'resolve') {
        if (isRequireResolveCall(node, parent)) return;
        throw new InventoryError('WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT', location);
      }
      throw new InventoryError('WF_LOCAL_JS_LOADER_CHAIN', location);
    }
  });
  walkAstWithParent(ast, null, (node, parent) => {
    if (node.type === 'Identifier' && node.name === 'require') {
      if (parent && parent.type === 'CallExpression' && parent.callee === node) return;
      if (parent && parent.type === 'MemberExpression' && parent.object === node &&
          parent.computed === false && parent.property && parent.property.type === 'Identifier' &&
          isSafeRequireMemberProperty(parent.property.name)) return;
      if (parent && parent.type === 'MemberExpression' && parent.property === node &&
          parent.computed === false) return;
      throw new InventoryError('WF_LOCAL_JS_LOADER_ALIAS', location);
    }
  });
}

function inspectLocalJavaScript(entry, actionRoot, context, location) {
  const visited = [];
  const active = new Set();
  const memo = context.localJavaScriptMemo;
  const visit = (file, depth) => {
    if (depth > MAX_RECURSION_DEPTH) throw new InventoryError('WF_LOCAL_JS_DEPTH', location);
    if (active.has(file)) throw new InventoryError('WF_LOCAL_JS_CYCLE', location);
    if (memo.has(file)) {
      visited.push(...memo.get(file));
      return;
    }
    context.executionNodes += 1;
    if (context.executionNodes > MAX_EXECUTION_NODES) throw new InventoryError('WF_NODE_LIMIT', location);
    active.add(file);
    const localVisited = [file];
    const dependencies = [];
    const ast = parseJavaScript(file, location);
    checkLoaderAliases(ast, location);
    walkAst(ast, (node) => {
      if (node.type === 'ImportExpression') throw new InventoryError('WF_LOCAL_JS_DYNAMIC_IMPORT', location);
      if ((node.type === 'CallExpression' || node.type === 'NewExpression') && node.callee &&
          node.callee.type === 'Identifier' && ['eval', 'Function'].includes(node.callee.name)) {
        throw new InventoryError('WF_LOCAL_JS_DYNAMIC_CODE', location);
      }
      let specifier = null;
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        if (node.source) specifier = node.source.value;
      } else if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression' &&
          node.callee.object && node.callee.object.name === 'module' && node.callee.property && node.callee.property.name === 'require') {
        throw new InventoryError('WF_LOCAL_JS_MODULE_REQUIRE', location);
      } else if (node.type === 'CallExpression' && isDirectRequireCallee(node)) {
        if (!isValidStaticRequireCall(node)) {
          throw new InventoryError('WF_LOCAL_JS_COMPUTED_REQUIRE', location);
        }
        specifier = node.arguments[0].value;
      } else if (node.type === 'CallExpression' && isRequireResolveCall(node.callee, node)) {
        specifier = node.arguments[0].value;
      }
      if (specifier === null) return;
      if (specifier === 'node:child_process' || specifier === 'node:worker_threads') {
        throw new InventoryError('WF_LOCAL_JS_PROCESS_EXECUTION', location);
      }
      if (specifier.startsWith('node:')) return;
      if (!specifier.startsWith('.')) throw new InventoryError('WF_LOCAL_JS_PACKAGE_IMPORT', location);
      if (!/\.(?:cjs|mjs|js)$/.test(specifier)) throw new InventoryError('WF_LOCAL_JS_EXTENSION', location);
      dependencies.push(resolveStaticFile(actionRoot, path.dirname(file), specifier, location));
    });
    for (const dependency of [...new Set(dependencies)].sort()) {
      visit(dependency, depth + 1);
      localVisited.push(dependency);
    }
    active.delete(file);
    const exact = [...new Set(localVisited)];
    memo.set(file, exact);
    visited.push(...exact);
  };
  visit(entry, 0);
  return [...new Set(visited)];
}

function resolveLocalActionMetadata(repoRoot, local, location) {
  const directory = resolveContained(repoRoot, local, location);
  if (!fs.statSync(directory).isDirectory()) throw new InventoryError('WF_LOCAL_ACTION_DIRECTORY', location);
  const candidates = ['action.yml', 'action.yaml'].map((name) => path.join(directory, name)).filter((file) => fs.existsSync(file));
  if (candidates.length === 0) throw new InventoryError('WF_LOCAL_ACTION_METADATA_MISSING', location);
  if (candidates.length !== 1) throw new InventoryError('WF_LOCAL_ACTION_METADATA_AMBIGUOUS', location);
  return { directory, metadata: candidates[0], document: parseDocument(candidates[0]) };
}

function analyzeLocalAction(local, states, context, location, depth) {
  if (depth > MAX_RECURSION_DEPTH) throw new InventoryError('WF_LOCAL_ACTION_DEPTH', location);
  const record = resolveLocalActionMetadata(context.repoRoot, local, location);
  if (context.activeActions.has(record.directory)) throw new InventoryError('WF_LOCAL_ACTION_CYCLE', location);
  const runs = record.document.runs;
  if (!runs || typeof runs !== 'object') throw new InventoryError('WF_LOCAL_ACTION_RUNS', location);
  const using = String(runs.using || '').toLowerCase();
  if (using === 'docker') throw new InventoryError('WF_LOCAL_DOCKER_UNSUPPORTED', location);
  if (using === 'composite') {
    if (!Array.isArray(runs.steps)) throw new InventoryError('WF_LOCAL_COMPOSITE_STEPS', location);
    context.activeActions.add(record.directory);
    const result = analyzeSteps(runs.steps, states, {
      ...context,
      relative: context.relative + '->' + local,
      defaultDirectory: context.repoRoot
    }, depth + 1);
    context.activeActions.delete(record.directory);
    return { success: result, failure: cloneStates(states) };
  }
  if (!/^node(?:20|24)$/.test(using)) throw new InventoryError('WF_LOCAL_ACTION_USING', location);
  const entries = [];
  for (const key of ['pre', 'main', 'post']) {
    if (runs[key] === undefined) {
      if (key === 'main') throw new InventoryError('WF_LOCAL_ACTION_MAIN', location);
      continue;
    }
    const entry = resolveStaticFile(record.directory, record.directory, String(runs[key]), location + ':' + key);
    entries.push({ key, entry });
  }
  for (const entry of entries) inspectLocalJavaScript(entry.entry, record.directory, context, location + ':' + entry.key);
  return { success: cloneStates(states), failure: cloneStates(states) };
}

function evaluateWrapper(invocation, states, context, directory, root, location, depth) {
  if (depth > MAX_RECURSION_DEPTH) throw new InventoryError('WF_WRAPPER_DEPTH', location);
  if (states.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);

  const file = resolveStaticFile(context.repoRoot, directory, invocation.script, location);
  const relScriptPath = path.relative(context.repoRoot, file).replace(/\\/g, '/').normalize('NFC');
  const activeKey = invocation.shell + '\0' + file;
  if (context.activeWrappers.has(activeKey)) throw new InventoryError('WF_WRAPPER_CYCLE', location);

  const memoKey = buildWrapperCacheKey(invocation.shell, relScriptPath, states, location);
  const isHit = context.wrapperResults.has(memoKey);

  let cacheValue;
  if (isHit) {
    cacheValue = context.wrapperResults.get(memoKey);
    validateWrapperCacheValue(cacheValue, states.length, location);
    if (context.wrapperEvents) {
      for (let i = 0; i < states.length; i += 1) {
        context.wrapperEvents.push({
          kind: 'hit',
          wrapper: activeKey,
          cacheKey: memoKey,
          inputCallerToken: states[i].processParentKey || '',
          originIndex: i
        });
      }
    }
  } else {
    if (context.wrapperEvents) {
      for (let i = 0; i < states.length; i += 1) {
        context.wrapperEvents.push({
          kind: 'miss',
          wrapper: activeKey,
          cacheKey: memoKey,
          inputCallerToken: states[i].processParentKey || '',
          originIndex: i
        });
      }
    }
    context.executionNodes += 1;
    if (context.executionNodes > MAX_EXECUTION_NODES) throw new InventoryError('WF_NODE_LIMIT', location);
    let graph = context.wrapperGraphs.get(activeKey);
    if (!graph) {
      const source = fs.readFileSync(file, 'utf8')
        .replace(/^\uFEFF/, '')
        .replace(/^#![^\r\n]*(?:\r?\n|$)/, '');
      graph = parseCommandGraph(source, invocation.shell, location);
      context.wrapperGraphs.set(activeKey, graph);
    }

    const counts = new Map();
    const scriptStates = states.map((state, i) => {
      const stateKey = (state.processParentKey || '') + '\0' + stateFingerprint(state);
      const ordinal = (counts.get(stateKey) || 0) + 1;
      counts.set(stateKey, ordinal);

      const childState = cloneExecutionState(state);
      const frame = {
        kind: 'wrapper',
        scope: relScriptPath,
        originIndex: i,
        duplicateOrdinal: ordinal
      };
      validateFrame(frame);
      if (childState.occurrenceFrames.length >= 32) throw new InventoryError('WF_FRAME_DEPTH_EXCEEDED', location);
      childState.occurrenceFrames.push(frame);
      return childState;
    });

    context.activeWrappers.add(activeKey);
    let rawResult;
    try {
      rawResult = evaluateGraph(graph, scriptStates, context, directory, root, invocation.shell, location, depth + 1);
    } finally {
      context.activeWrappers.delete(activeKey);
    }

    const origins = states.map((state, i) => ({
      origin: i,
      semanticFingerprint: crypto.createHash('sha256').update(stateFingerprint(state)).digest('hex'),
      inputCount: 1
    }));

    const buildCollectionEntries = (collection) => {
      const ordinalsMap = new Map();
      return collection.map((outState) => {
        if (!outState.occurrenceFrames || outState.occurrenceFrames.length === 0) {
          throw new InventoryError('WF_FRAME_UNBALANCED', location);
        }
        const topFrame = outState.occurrenceFrames[outState.occurrenceFrames.length - 1];
        if (topFrame.kind !== 'wrapper' || topFrame.scope !== relScriptPath) {
          throw new InventoryError('WF_FRAME_UNBALANCED', location);
        }
        const origin = topFrame.originIndex;
        if (origin < 0 || origin >= states.length) {
          throw new InventoryError('WF_FRAME_MALFORMED', location);
        }
        const ord = ordinalsMap.get(origin) || 0;
        ordinalsMap.set(origin, ord + 1);
        return {
          origin,
          outputOrdinal: ord,
          semanticState: extractSemanticState(outState)
        };
      });
    };

    cacheValue = {
      namespace: 'workflow-wrapper-cache-value',
      version: 2,
      origins,
      success: buildCollectionEntries(rawResult.success),
      failure: buildCollectionEntries(rawResult.failure)
    };

    validateWrapperCacheValue(cacheValue, states.length, location);
    context.wrapperResults.set(memoKey, cacheValue);
  }

  const result = rebindCacheValue(cacheValue, states, relScriptPath, location);

  const restoreFromParent = (collection, cacheEntries) => {
    for (let k = 0; k < collection.length; k += 1) {
      const st = collection[k];
      const entry = cacheEntries[k];
      if (!entry || entry.origin < 0 || entry.origin >= states.length) {
        throw new InventoryError('WF_CACHE_VALUE_CORRUPT', location);
      }
      const parent = states[entry.origin];
      st.env = new Map(parent.env);
      st.workingDirectory = parent.workingDirectory;
      st.locationStack = parent.locationStack.slice();
      st.pathIdentity = parent.pathIdentity;
      st.setupGeneration = parent.setupGeneration;
      st.capturedGeneration = parent.capturedGeneration;
      st.processParentKey = parent.processParentKey;
      for (const [installKey, installEntry] of parent.installed) {
        if (!st.installed.has(installKey)) st.installed.set(installKey, installEntry);
      }
    }
  };
  restoreFromParent(result.success, cacheValue.success);
  restoreFromParent(result.failure, cacheValue.failure);

  if (context.wrapperEvents) {
    for (const branch of ['success', 'failure']) {
      for (const st of result[branch]) {
        context.wrapperEvents.push({
          kind: 'restore',
          wrapper: activeKey,
          cacheKey: memoKey,
          actualRestoredToken: st.processParentKey || '',
          branch
        });
      }
    }
  }
  return result;
}

function evaluatePackageScript(name, states, context, directory, root, location, depth) {
  if (states.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  const packageRoot = derivePackageRoot(context.repoRoot, directory, location);
  const relPackagePath = path.relative(context.repoRoot, packageRoot).replace(/\\/g, '/').normalize('NFC');
  const key = packageRoot + '\0' + name;
  if (context.activePackageScripts.has(key)) throw new InventoryError('WF_PACKAGE_SCRIPT_CYCLE', location + ':' + name);
  const document = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (!document.scripts || typeof document.scripts[name] !== 'string') throw new InventoryError('WF_PACKAGE_SCRIPT_MISSING', location + ':' + name);

  context.activePackageScripts.add(key);
  const graph = parseCommandGraph(document.scripts[name], 'bash', location + ':' + name);

  const scopeStr = (relPackagePath + '/' + name).normalize('NFC');
  const counts = new Map();
  const scriptStates = states.map((state, i) => {
    const stateKey = (state.processParentKey || '') + '\0' + stateFingerprint(state);
    const ordinal = (counts.get(stateKey) || 0) + 1;
    counts.set(stateKey, ordinal);

    const childState = cloneExecutionState(state);
    const frame = {
      kind: 'package_script',
      scope: scopeStr,
      originIndex: i,
      duplicateOrdinal: ordinal
    };
    validateFrame(frame);
    if (childState.occurrenceFrames.length >= 32) throw new InventoryError('WF_FRAME_DEPTH_EXCEEDED', location);
    childState.occurrenceFrames.push(frame);
    childState.workingDirectory = packageRoot;
    childState.locationStack = [];
    return childState;
  });

  let result;
  try {
    result = evaluateGraph(graph, scriptStates, context, packageRoot, root, 'bash', location + ':' + name, depth + 1);
  } finally {
    context.activePackageScripts.delete(key);
  }

  const unwrapPackageScriptCollection = (collection) => {
    return collection.map((outState) => {
      if (!outState.occurrenceFrames || outState.occurrenceFrames.length === 0) {
        throw new InventoryError('WF_FRAME_UNBALANCED', location);
      }
      const topFrame = outState.occurrenceFrames[outState.occurrenceFrames.length - 1];
      if (topFrame.kind !== 'package_script' || topFrame.scope !== scopeStr) {
        throw new InventoryError('WF_FRAME_UNBALANCED', location);
      }
      const origin = topFrame.originIndex;
      if (origin < 0 || origin >= states.length) {
        throw new InventoryError('WF_FRAME_MALFORMED', location);
      }
      const parentState = states[origin];
      const restored = cloneExecutionState(outState);
      restored.occurrenceFrames.pop();
      restored.processParentKey = parentState.processParentKey;
      restored.env = new Map(parentState.env);
      restored.workingDirectory = parentState.workingDirectory;
      restored.locationStack = parentState.locationStack.slice();
      restored.pathIdentity = parentState.pathIdentity;
      restored.setupGeneration = parentState.setupGeneration;
      restored.capturedGeneration = parentState.capturedGeneration;
      for (const [installKey, installEntry] of parentState.installed) {
        if (!restored.installed.has(installKey)) restored.installed.set(installKey, installEntry);
      }
      return restored;
    });
  };

  return {
    success: unwrapPackageScriptCollection(result.success),
    failure: unwrapPackageScriptCollection(result.failure)
  };
}

function evaluateCommand(tokens, states, context, directory, root, shell, location, depth) {
  if (states.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  validateWrapper(tokens, location);
  const joined = tokens.join(' ');
  if (tokens[0] === 'env') {
    let index = 1;
    const childStates = cloneStates(states);
    childStates.forEach((state, stateIndex) => {
      state.outerParentKey = String(stateIndex);
    });
    if (tokens[index] === '-i') {
      childStates.forEach((state) => {
        state.env.clear();
        state.pathIdentity += 1;
        state.setupGeneration = 0;
        state.capturedGeneration = 0;
        state.installed.clear();
      });
      index += 1;
    }
    while (tokens[index] === '-u') {
      const name = tokens[index + 1];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name || '')) throw new InventoryError('WF_ENV_WRAPPER_OPTION', location);
      childStates.forEach((state) => {
        state.env.delete('$' + name);
        if (name.toUpperCase() === 'PATH') {
          state.pathIdentity += 1;
          state.setupGeneration = 0;
          state.capturedGeneration = 0;
          state.installed.clear();
        }
      });
      index += 2;
    }
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] || '')) {
      const [name, ...valueParts] = tokens[index].split('=');
      childStates.forEach((state) => {
        state.env.set('$' + name, valueParts.join('='));
        if (name.toUpperCase() === 'PATH') {
          state.pathIdentity += 1;
          state.setupGeneration = 0;
          state.capturedGeneration = 0;
          state.installed.clear();
        }
      });
      index += 1;
    }
    if (index >= tokens.length || (tokens[index] || '').startsWith('-')) throw new InventoryError('WF_ENV_WRAPPER_OPTION', location);
    const childResult = evaluateCommand(tokens.slice(index), childStates, context, directory, root, shell, location, depth + 1);
    for (const collection of [childResult.success, childResult.failure]) {
      collection.forEach((state) => {
        const parentIndex = parseInt(state.outerParentKey, 10);
        const parent = states[parentIndex];
        if (parent) {
          state.env = new Map(parent.env);
          state.pathIdentity = parent.pathIdentity;
          state.setupGeneration = parent.setupGeneration;
          state.capturedGeneration = parent.capturedGeneration;
          state.workingDirectory = parent.workingDirectory;
          state.locationStack = parent.locationStack.slice();
        }
        delete state.outerParentKey;
      });
    }
    return childResult;
  }
  const unwrapped = unwrapStaticLauncher(tokens, location);
  if (unwrapped.kind !== 'ordinary') return evaluateCommand(unwrapped.tokens, states, context, directory, root, shell, location, depth + 1);
  const invocation = wrapperInvocation(tokens);
  if (invocation) {
    const success = [];
    const failure = [];
    const groups = new Map();
    for (const state of states) {
      const key = state.workingDirectory;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(state);
    }
    for (const [workingDirectory, values] of groups) {
      const value = evaluateWrapper(invocation, values, context, workingDirectory, root, location, depth);
      success.push(...value.success);
      failure.push(...value.failure);
    }
    return {
      success: uniqueStates(success, location),
      failure: uniqueStates(failure, location)
    };
  }
  const executable = path.basename(tokens[0] || '').toLowerCase().replace(/\.exe$/, '');
  if (['cd', 'chdir', 'set-location'].includes(executable)) {
    if (tokens.length !== 2) throw new InventoryError('WF_WORKING_DIRECTORY_ARGUMENTS', location);
    const success = cloneStates(states);
    for (const state of success) {
      const target = resolveStaticDirectory(context.repoRoot, state.workingDirectory, tokens[1], location);
      state.workingDirectory = target;
    }
    return { success, failure: cloneStates(states) };
  }
  if (['pushd', 'push-location'].includes(executable)) {
    if (tokens.length !== 2) throw new InventoryError('WF_WORKING_DIRECTORY_ARGUMENTS', location);
    const success = cloneStates(states);
    for (const state of success) {
      const target = resolveStaticDirectory(context.repoRoot, state.workingDirectory, tokens[1], location);
      state.locationStack.push(state.workingDirectory);
      state.workingDirectory = target;
    }
    return { success, failure: cloneStates(states) };
  }
  if (['popd', 'pop-location'].includes(executable)) {
    if (tokens.length !== 1) throw new InventoryError('WF_WORKING_DIRECTORY_ARGUMENTS', location);
    const success = cloneStates(states);
    for (const state of success) {
      if (!state.locationStack.length) throw new InventoryError('WF_WORKING_DIRECTORY_STACK', location);
      state.workingDirectory = state.locationStack.pop();
    }
    return { success, failure: cloneStates(states) };
  }
  const powershellEnvironment = String(tokens[0] || '').match(/^\$env:([A-Za-z_][A-Za-z0-9_]*)=(.*)$/i);
  const cmdEnvironment = tokens[0] === 'set' && tokens.length === 2 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[1]);
  if (tokens[0] === 'export' || tokens[0] === 'set-env' || powershellEnvironment || cmdEnvironment) {
    const assignment = powershellEnvironment ? powershellEnvironment[1] + '=' + powershellEnvironment[2] : tokens[1];
    if (!assignment || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(assignment)) {
      throw new InventoryError('WF_ENVIRONMENT_ASSIGNMENT', location);
    }
    const [name, ...valueParts] = assignment.split('=');
    const success = cloneStates(states);
    for (const state of success) {
      state.env.set('$' + name, valueParts.join('='));
      if (name.toUpperCase() === 'PATH') {
        state.pathIdentity += 1;
        state.setupGeneration = 0;
        state.capturedGeneration = 0;
        state.installed.clear();
      }
    }
    return { success, failure: cloneStates(states) };
  }
  if (tokens[0] === 'unset' || tokens[0] === 'remove-item') {
    if (tokens.length !== 2) throw new InventoryError('WF_ENVIRONMENT_REMOVE', location);
    const name = tokens[1].replace(/^\$env:/i, '');
    const success = cloneStates(states);
    for (const state of success) {
      state.env.delete('$' + name);
      if (name.toUpperCase() === 'PATH') {
        state.pathIdentity += 1;
        state.setupGeneration = 0;
        state.capturedGeneration = 0;
        state.installed.clear();
      }
    }
    return { success, failure: cloneStates(states) };
  }
  if (tokens[0] === 'true' || (tokens[0] === 'exit' && tokens[1] === '0') || tokens[0] === 'set') {
    return { success: cloneStates(states), failure: [] };
  }
  if (tokens[0] === 'false' || (tokens[0] === 'exit' && tokens[1] !== undefined && tokens[1] !== '0')) {
    return { success: [], failure: cloneStates(states) };
  }
  if (tokens[0] === 'capture_line=$(/usr/bin/sha256sum' || tokens[0] === 'verifier_line=$(/usr/bin/sha256sum') {
    return { success: cloneStates(states), failure: cloneStates(states) };
  }
  if (/capture-node-toolchain\.cjs/.test(joined)) {
    const success = cloneStates(states);
    for (const state of success) {
      if (!state.setupGeneration) throw new InventoryError('WF_CAPTURE_WITHOUT_SETUP', location);
      state.capturedGeneration = state.setupGeneration;
    }
    return { success, failure: cloneStates(states) };
  }
  if (/^npm(?:\.cmd)?$/i.test(tokens[0] || '') && tokens[1] === 'ci') {
    const shape = tokens.slice(1).join(' ');
    if (shape !== 'ci' && shape !== 'ci --ignore-scripts') throw new InventoryError('WF_NPM_CI_SHAPE', location);
    const success = cloneStates(states);
    for (const state of success) {
      if (!state.setupGeneration) throw new InventoryError('WF_NODE_WITHOUT_SETUP', location);
      const packageRoot = derivePackageRoot(context.repoRoot, state.workingDirectory, location);
      state.installed.set(packageInstallationKey(root, packageRoot), {
        checkoutGeneration: state.checkoutGeneration,
        setupGeneration: state.setupGeneration,
        pathIdentity: state.pathIdentity,
        packageRoot
      });
    }
    return { success, failure: cloneStates(states) };
  }
  if (/^npm(?:\.cmd)?$/i.test(tokens[0] || '') && tokens[1] === 'run') {
    if (tokens.length !== 3) throw new InventoryError('WF_PACKAGE_SCRIPT_ARGUMENTS', location);
    requireNodeAuthority(states, root, context.privileged, joined, location, context.repoRoot);
    const groups = new Map();
    for (const state of states) {
      if (!groups.has(state.workingDirectory)) groups.set(state.workingDirectory, []);
      groups.get(state.workingDirectory).push(state);
    }
    const success = [];
    const failure = [];
    for (const [workingDirectory, values] of groups) {
      const value = evaluatePackageScript(tokens[2], values, context, workingDirectory, root, location, depth);
      success.push(...value.success);
      failure.push(...value.failure);
    }
    return {
      success: uniqueStates(success, location),
      failure: uniqueStates(failure, location)
    };
  }
  if (mutatesDependencyTree(tokens)) {
    const success = cloneStates(states);
    success.forEach((state) => state.installed.clear());
    return { success, failure: cloneStates(states) };
  }
  if (isNodeLike(tokens)) requireNodeAuthority(states, root, context.privileged, joined, location, context.repoRoot);
  return { success: cloneStates(states), failure: cloneStates(states) };
}

function evaluateGraph(graph, states, context, directory, root, shell, location, depth = 0) {
  if (depth > MAX_RECURSION_DEPTH) throw new InventoryError('WF_GRAPH_DEPTH', location);
  if (states.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);
  const input = uniqueStates(states, location);
  const mode = input.length > 0 && input[0].occurrenceFrames.length > 0 ? 'occurrence-sensitive' : 'ordinary';

  if (graph.type === 'noop') return { success: cloneStates(input), failure: [] };
  if (graph.type === 'command') return evaluateCommand(graph.tokens, input, context, directory, root, shell, location, depth);
  if (graph.type === 'pipeline') {
    for (const member of graph.members) evaluateGraph(member, cloneStates(input), context, directory, root, shell, location, depth + 1);
    return { success: cloneStates(input), failure: cloneStates(input) };
  }
  if (graph.type === 'subshell' || graph.type === 'group') {
    evaluateGraph(graph.body, cloneStates(input), context, directory, root, shell, location, depth + 1);
    return { success: cloneStates(input), failure: cloneStates(input) };
  }
  if (graph.type === 'and') {
    const left = evaluateGraph(graph.left, input, context, directory, root, shell, location, depth + 1);
    const right = evaluateGraph(graph.right, left.success, context, directory, root, shell, location, depth + 1);
    return { success: right.success, failure: uniqueStates([...left.failure, ...right.failure], location, mode) };
  }
  if (graph.type === 'or') {
    const left = evaluateGraph(graph.left, input, context, directory, root, shell, location, depth + 1);
    const right = evaluateGraph(graph.right, left.failure, context, directory, root, shell, location, depth + 1);
    return { success: uniqueStates([...left.success, ...right.success], location, mode), failure: right.failure };
  }
  if (graph.type === 'sequence') {
    let reachable = input;
    let result = { success: input, failure: [] };
    for (const member of graph.members) {
      result = evaluateGraph(member, reachable, context, directory, root, shell, location, depth + 1);
      reachable = uniqueStates([...result.success, ...result.failure], location, mode);
    }
    return result;
  }
  throw new InventoryError('WF_GRAPH_NODE', location);
}

function applyStepEnvironment(states, environment, location) {
  const result = cloneStates(states);
  for (const state of result) {
    for (const [name, value] of Object.entries(environment || {})) {
      if (name === 'PATH') {
        state.pathIdentity += 1;
        state.setupGeneration = 0;
        state.capturedGeneration = 0;
        state.installed.clear();
      }
      if (!['TRUSTED_ROOT', 'PR_ROOT'].includes(name)) continue;
      if (state.env.has('$' + name) || typeof value !== 'string' ||
          !/^\$\{\{ github\.workspace \}\}(?:\/[A-Za-z0-9._/-]+)?$/.test(value)) {
        throw new InventoryError('WF_ENV_ALIAS_REASSIGN', location);
      }
      state.env.set('$' + name, value);
    }
  }
  return result;
}

function analyzeSteps(steps, initialStates, context, depth = 0) {
  if (initialStates.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', context.relative + '#' + context.jobId);

  const scopeStr = String(context.relative + '#' + context.jobId).normalize('NFC');
  const counts = new Map();
  const framedStates = cloneStates(initialStates).map((state, i) => {
    const stateKey = (state.processParentKey || '') + '\0' + stateFingerprint(state);
    const ordinal = (counts.get(stateKey) || 0) + 1;
    counts.set(stateKey, ordinal);

    const frame = {
      kind: 'step',
      scope: scopeStr,
      originIndex: i,
      duplicateOrdinal: ordinal
    };
    validateFrame(frame);
    state.occurrenceFrames.push(frame);
    return state;
  });

  let states = framedStates;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] || {};
    const location = context.relative + '#' + context.jobId + '.step[' + index + ']';
    if (step.if === '${{ false }}') continue;
    const incoming = applyStepEnvironment(states, step.env, location);
    const conditional = step.if !== undefined && step.if !== '${{ true }}';
    let result;
    if (step.uses && String(step.uses).startsWith('actions/checkout@')) {
      const rawCheckoutPath = (step.with && step.with.path) || '.';
      const checkoutPath = rawCheckoutPath === '.' ? '.' : normalizeRelative(rawCheckoutPath, location);
      const success = cloneStates(incoming);
      for (const state of success) {
        state.checkoutGeneration += 1;
        state.installed.clear();
        state.checkouts.set(step.id || 'checkout-' + index, {
          id: step.id || 'checkout-' + index,
          generation: state.checkoutGeneration,
          path: checkoutPath
        });
      }
      result = { success, failure: cloneStates(incoming) };
    } else if (step.uses && String(step.uses).startsWith('actions/setup-node@')) {
      const success = cloneStates(incoming);
      for (const state of success) {
        state.setupGeneration += 1;
        state.capturedGeneration = 0;
        state.pathIdentity += 1;
        state.installed.clear();
      }
      result = { success, failure: cloneStates(incoming) };
    } else if (step.uses && String(step.uses).startsWith('./')) {
      result = analyzeLocalAction(String(step.uses).slice(2), incoming, context, location, depth);
    } else if (step.uses) {
      result = { success: cloneStates(incoming), failure: cloneStates(incoming) };
    } else if (step.run) {
      const rootValues = incoming.map((state) => structuralPath(step['working-directory'], state.checkouts, state.env, location));
      const rootFingerprints = new Set(rootValues.map(installationKey));
      if (rootFingerprints.size !== 1) throw new InventoryError('WF_STRUCTURAL_PATH_JOIN', location);
      const root = rootValues[0];
      const shell = step.shell || context.defaultShell;
      if (step.name === 'Bootstrap trusted helper bytes') {
        const bootstrapLines = String(step.run).trim().split(/\r?\n/).map((line) => line.trim());
        const exactBootstrap = [
          'set -euo pipefail',
          'capture_line=$(/usr/bin/sha256sum --binary -- repo/scripts/trusted-workflows/capture-node-toolchain.cjs)',
          'verifier_line=$(/usr/bin/sha256sum --binary -- repo/scripts/trusted-workflows/verify-closure-manifest.cjs)',
          'test "$capture_line" = "$CAPTURE_NODE_TOOLCHAIN_SHA256 *repo/scripts/trusted-workflows/capture-node-toolchain.cjs"',
          'test "$verifier_line" = "$VERIFY_CLOSURE_MANIFEST_SHA256 *repo/scripts/trusted-workflows/verify-closure-manifest.cjs"'
        ];
        if (JSON.stringify(bootstrapLines) !== JSON.stringify(exactBootstrap) || shell !== 'bash') {
          throw new InventoryError('WF_BOOTSTRAP_GRAMMAR', location);
        }
        result = { success: cloneStates(incoming), failure: cloneStates(incoming) };
      } else {
        const commandInput = cloneStates(incoming);
        const initialDirectory = executionDirectory(context.repoRoot, root);
        commandInput.forEach((state) => {
          state.workingDirectory = initialDirectory;
          state.locationStack = [];
        });
        result = evaluateGraph(
          parseCommandGraph(String(step.run), String(shell), location),
          commandInput,
          context,
          executionDirectory(context.repoRoot, root),
          root,
          String(shell),
          location,
          depth
        );
        for (const collection of [result.success, result.failure]) {
          collection.forEach((state) => {
            state.workingDirectory = context.repoRoot;
            state.locationStack = [];
          });
        }
      }
    } else {
      result = { success: cloneStates(incoming), failure: cloneStates(incoming) };
    }
    let next = result.success;
    if (step['continue-on-error'] === true) next = [...next, ...result.failure];
    if (conditional) next = [...next, ...incoming];

    if (next.length > MAX_EXECUTION_PATHS) throw new InventoryError('WF_PATH_LIMIT', location);

    for (const state of next) {
      state.occurrenceFrames = [];
    }

    states = uniqueStates(next, location, 'ordinary');
  }
  return states;
}

function analyzeJob(relative, jobId, job, privileged, repoRoot = REPO_ROOT) {
  const context = {
    repoRoot,
    relative,
    jobId,
    privileged,
    defaultShell: /windows/i.test(String(job['runs-on'] || 'ubuntu-latest')) ? 'pwsh' : 'bash',
    activeActions: new Set(),
    localJavaScriptMemo: new Map(),
    activeWrappers: new Set(),
    wrapperGraphs: new Map(),
    wrapperResults: new Map(),
    activePackageScripts: new Set(),
    executionNodes: 0,
    processTokenSeq: 0
  };
  if (privileged && relative === '.github/workflows/source-watch-pr.yml') {
    return [initialExecutionState()];
  }
  return analyzeSteps(Array.isArray(job.steps) ? job.steps : [], [initialExecutionState()], context);
}

function analyzeWorkflow(relative, authority, active, memo, repoRoot = REPO_ROOT) {
  if (memo.has(relative)) return;
  if (active.has(relative)) throw new InventoryError('WF_REUSE_CYCLE', relative);
  active.add(relative);
  const absolute = resolveContained(repoRoot, relative, relative);
  const workflow = parseDocument(absolute);
  const privileged = PRIVILEGED.has(relative);
  if (privileged) validatePrivilegedActions(relative, workflow, authority);
  for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
    if (job.uses) {
      const local = String(job.uses);
      if (!local.startsWith('./.github/workflows/')) throw new InventoryError('WF_REUSE_NONLOCAL', relative + '#' + jobId);
      if (job.with && Object.values(job.with).some((value) => typeof value !== 'string' || value.includes('${{'))) {
        throw new InventoryError('WF_REUSE_DYNAMIC_INPUT', relative + '#' + jobId);
      }
      if (job.secrets !== undefined) throw new InventoryError('WF_REUSE_SECRETS', relative + '#' + jobId);
      analyzeWorkflow(local.slice(2), authority, active, memo, repoRoot);
    } else analyzeJob(relative, jobId, job || {}, privileged, repoRoot);
  }
  active.delete(relative);
  memo.add(relative);
}

function analyzeWorkflowFixture(relative) {
  const authority = new Map();
  analyzeWorkflow(relative, authority, new Set(), new Set(), REPO_ROOT);
  return true;
}

function observeWrapperAnalysis(relative) {
  const observations = { events: [], finalStates: [] };
  const authority = new Map();
  const absolute = resolveContained(REPO_ROOT, relative, relative);
  const workflow = parseDocument(absolute);
  const privileged = PRIVILEGED.has(relative);
  if (privileged) validatePrivilegedActions(relative, workflow, authority);
  for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
    if (job.uses) continue;
    const context = {
      repoRoot: REPO_ROOT,
      relative,
      jobId,
      privileged,
      defaultShell: /windows/i.test(String(job['runs-on'] || 'ubuntu-latest')) ? 'pwsh' : 'bash',
      activeActions: new Set(),
      localJavaScriptMemo: new Map(),
      activeWrappers: new Set(),
      wrapperGraphs: new Map(),
      wrapperResults: new Map(),
      activePackageScripts: new Set(),
      executionNodes: 0,
      processTokenSeq: 0,
      wrapperEvents: []
    };
    const finalStates = analyzeSteps(Array.isArray(job.steps) ? job.steps : [], [initialExecutionState()], context);
    observations.events.push(...context.wrapperEvents);
    for (const state of finalStates) {
      observations.finalStates.push({
        processParentKey: state.processParentKey || null,
        occurrenceFrames: (state.occurrenceFrames || []).map((f) => ({ ...f })),
        pathIdentity: state.pathIdentity,
        setupGeneration: state.setupGeneration,
        capturedGeneration: state.capturedGeneration,
        env: Array.from(state.env.entries()),
        workingDirectory: state.workingDirectory,
        locationStack: state.locationStack.slice(),
        installed: Array.from(state.installed.entries()).map(([k, v]) => [k, {
          checkoutGeneration: v.checkoutGeneration,
          setupGeneration: v.setupGeneration,
          pathIdentity: v.pathIdentity,
          packageRoot: v.packageRoot
        }])
      });
    }
  }
  return observations;
}

function runInventory(root = REPO_ROOT) {
  if (root !== REPO_ROOT) throw new InventoryError('WF_TEST_ROOT_UNSUPPORTED', String(root));
  const authority = loadActionAuthority();
  const active = new Set();
  const memo = new Set();
  const workflows = fs.readdirSync(WORKFLOWS_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => '.github/workflows/' + name)
    .sort();
  for (const workflow of workflows) analyzeWorkflow(workflow, authority, active, memo);
  for (const [key, record] of authority) {
    if (record.unused.size) throw new InventoryError('WF_ACTION_UNUSED', key + ':' + [...record.unused].join(','));
  }
  return { workflows: workflows.length, privileged: PRIVILEGED.size };
}

if (require.main === module) {
  try {
    const result = runInventory();
    process.stdout.write('Workflow inventory passed: ' + result.workflows + ' workflows; ' + result.privileged + ' privileged workflows are manifest-bound.\n');
  } catch (error) {
    process.stderr.write((error instanceof InventoryError ? error.message : 'WF_INTERNAL_ERROR') + '\n');
    process.exit(1);
  }
}

module.exports = {
  InventoryError,
  normalizeRelative,
  resolveContained,
  tokenize,
  parseCommandGraph,
  segments,
  derivePackageRoot,
  resolvePackageScriptGraph,
  mutatesDependencyTree,
  validateWrapper,
  unwrapStaticLauncher,
  resolveLocalActionMetadata,
  inspectLocalJavaScript,
  analyzeWorkflowFixture,
  observeWrapperAnalysis,
  structuralPath,
  walkAstWithParent,
  checkLoaderAliases,
  PowerShellState,
  RunnerIdentityState,
  ExecutableIdentityState,
  runInventory,
  evaluateWrapper,
  cloneExecutionState,
  initialExecutionState,
  uniqueStates,
  buildWrapperCacheKey,
  validateWrapperCacheKey,
  validateWrapperCacheValue,
  rebindCacheValue,
  validateFrame,
  validateFrames,
  stateFingerprint
};
