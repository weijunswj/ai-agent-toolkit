#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const PRIVILEGED = new Set([
  '.github/workflows/auto-sync-generated-surfaces.yml',
  '.github/workflows/source-watch-pr.yml'
]);
const ACTION_MANIFEST = 'repo/scripts/trusted-workflows/external-actions-manifest.json';
const ACTION_SHA = /^[0-9a-f]{40}$/;

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
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    if ([';', '|', '&'].includes(char)) {
      if (current) { tokens.push(current); current = ''; }
      const pair = command.slice(i, i + 2);
      if (['&&', '||'].includes(pair)) { tokens.push(pair); i += 1; }
      else tokens.push(char);
      continue;
    }
    if (char === '`' || (char === '$' && command[i + 1] === '(')) throw new InventoryError('WF_DYNAMIC_COMMAND', location);
    current += char;
  }
  if (quote) throw new InventoryError('WF_UNCLOSED_QUOTE', location);
  if (current) tokens.push(current);
  return tokens;
}

function segments(command, shell, location) {
  if (/powershell|pwsh/i.test(shell || '')) {
    if (/(@'|@"|'@|"@)/.test(command)) throw new InventoryError('WF_POWERSHELL_HERE_STRING', location);
    if (/[{}()]/.test(command) || /\$\(/.test(command) || /`[^\r\n]/.test(command) || /(?:^|\s)>{1,2}(?:\s|$)/.test(command)) {
      throw new InventoryError('WF_POWERSHELL_UNSUPPORTED', location);
    }
  }
  const tokens = tokenize(command.replace(/\r\n/g, '\n'), location);
  const result = [];
  let current = [];
  for (const token of tokens) {
    if ([';', '|', '&&', '||', '\n'].includes(token)) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(token);
  }
  if (current.length) result.push(current);
  if (/powershell|pwsh/i.test(shell || '')) {
    for (const item of result) {
      if (item[0] === '&') {
        if (item.length < 2 || /[$`]/.test(item[1])) throw new InventoryError('WF_POWERSHELL_CALL_OPERATOR', location);
        item.shift();
      } else if (item[0] === '.') {
        if (item.length < 2 || /[$`]/.test(item[1])) throw new InventoryError('WF_POWERSHELL_DOT_SOURCE', location);
        item.shift();
        item.unshift('dot-source');
      }
    }
  }
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

function analyzeJob(relative, jobId, job, privileged) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const defaultShell = /windows/i.test(String(job['runs-on'] || 'ubuntu-latest')) ? 'pwsh' : 'bash';
  const checkouts = new Map();
  const env = new Map();
  let checkoutGeneration = 0;
  let setupGeneration = 0;
  let capturedGeneration = 0;
  let pathIdentity = 0;
  let installed = new Map();
  const activeScripts = new Set();

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] || {};
    const location = relative + '#' + jobId + '.step[' + index + ']';
    if (step.if === '${{ false }}') continue;
    for (const [name, value] of Object.entries(step.env || {})) {
      if (env.has('$' + name) || typeof value !== 'string' || !/^\$\{\{ github\.workspace \}\}(?:\/[A-Za-z0-9._/-]+)?$/.test(value)) {
        if (['TRUSTED_ROOT', 'PR_ROOT'].includes(name)) throw new InventoryError('WF_ENV_ALIAS_REASSIGN', location);
      } else env.set('$' + name, value);
    }
    if (step.uses && String(step.uses).startsWith('actions/checkout@')) {
      checkoutGeneration += 1;
      const rawCheckoutPath = (step.with && step.with.path) || '.';
      const checkoutPath = rawCheckoutPath === '.' ? '.' : normalizeRelative(rawCheckoutPath, location);
      installed.clear();
      checkouts.set(step.id || 'checkout-' + index, { id: step.id || 'checkout-' + index, generation: checkoutGeneration, path: checkoutPath });
      continue;
    }
    if (step.uses && String(step.uses).startsWith('actions/setup-node@')) {
      setupGeneration += 1;
      capturedGeneration = 0;
      pathIdentity += 1;
      installed.clear();
      continue;
    }
    if (step.uses && String(step.uses).startsWith('./')) {
      const local = String(step.uses).slice(2);
      const actionPath = resolveContained(REPO_ROOT, local + '/action.yml', location);
      const action = parseDocument(actionPath);
      const nested = { steps: action.runs && action.runs.steps };
      analyzeJob(relative + '->' + local, jobId, nested, privileged);
      continue;
    }
    if (!step.run) continue;
    const root = structuralPath(step['working-directory'], checkouts, env, location);
    const shell = step.shell || defaultShell;
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
      continue;
    }
    const commandSegments = segments(String(step.run), String(shell), location);
    for (const tokens of commandSegments) {
      validateWrapper(tokens, location);
      const joined = tokens.join(' ');
      if (mutatesDependencyTree(tokens)) installed.clear();
      if (/capture-node-toolchain\.cjs/.test(joined)) {
        if (!setupGeneration) throw new InventoryError('WF_CAPTURE_WITHOUT_SETUP', location);
        capturedGeneration = setupGeneration;
        continue;
      }
      if (/^(set|test)$/.test(tokens[0]) || tokens[0] === 'capture_line=$(/usr/bin/sha256sum' ||
          tokens[0] === 'verifier_line=$(/usr/bin/sha256sum') continue;
      if (/^npm(?:\.cmd)?$/.test(tokens[0]) && tokens[1] === 'ci') {
        const shape = tokens.slice(1).join(' ');
        const exact = shape === 'ci' || shape === 'ci --ignore-scripts';
        if (!exact) throw new InventoryError('WF_NPM_CI_SHAPE', location);
        installed.set(JSON.stringify(root), { checkoutGeneration, setupGeneration, pathIdentity });
        continue;
      }
      if (/^npm(?:\.cmd)?$/.test(tokens[0]) && tokens[1] === 'run') {
        if (tokens.length !== 3) throw new InventoryError('WF_PACKAGE_SCRIPT_ARGUMENTS', location);
        const key = JSON.stringify(root) + ':' + tokens[2];
        if (activeScripts.has(key)) throw new InventoryError('WF_PACKAGE_SCRIPT_CYCLE', location);
        activeScripts.add(key);
        if (root.kind === 'WORKSPACE_ROOT') resolvePackageScriptGraph(REPO_ROOT, REPO_ROOT, tokens[2], location);
        activeScripts.delete(key);
      }
      if (isNodeLike(tokens)) {
        if (!setupGeneration) throw new InventoryError('WF_NODE_WITHOUT_SETUP', location);
        if (privileged) {
          if (capturedGeneration !== setupGeneration) throw new InventoryError('WF_NODE_IDENTITY_UNCAPTURED', location);
          if (!/verify-closure-manifest\.cjs/.test(joined) && !/capture-node-toolchain\.cjs/.test(joined)) {
            throw new InventoryError('WF_PRIVILEGED_UNVERIFIED_NODE', location);
          }
        } else if (!installed.has(JSON.stringify(root))) {
          throw new InventoryError('WF_NODE_WITHOUT_INSTALL', location);
        }
      }
    }
  }
}

function analyzeWorkflow(relative, authority, active, memo) {
  if (memo.has(relative)) return;
  if (active.has(relative)) throw new InventoryError('WF_REUSE_CYCLE', relative);
  active.add(relative);
  const absolute = resolveContained(REPO_ROOT, relative, relative);
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
      analyzeWorkflow(local.slice(2), authority, active, memo);
    } else analyzeJob(relative, jobId, job || {}, privileged);
  }
  active.delete(relative);
  memo.add(relative);
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
  segments,
  derivePackageRoot,
  resolvePackageScriptGraph,
  mutatesDependencyTree,
  validateWrapper,
  structuralPath,
  PowerShellState,
  RunnerIdentityState,
  ExecutableIdentityState,
  runInventory
};
