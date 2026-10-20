'use strict';

// Opt-in Claude Code Toolkit plugin-cache refresh for the Claude SessionStart
// bridge hook. The owner below verifies the managed source, holds the Toolkit
// hub lock, records every mutation attempt and its exact native target durably
// before it starts, and asks the verified managed source's setup helper to run
// only Claude Code's own `plugin update` for the cache this session runs from.
// A session that runs Toolkit directly from the managed checkout (Claude Code
// reads a directory-source plugin in place) never updates anything and never
// resolves an earlier attempt. Anything that cannot be proven safe is reported
// as action required; an attempt whose effect is unknown is never retried
// automatically and is resolved only by its own independently verified target.
//
// The Toolkit hub is shared by every Claude Code configuration home of one OS
// user, so a target is a native install namespace, not just a plugin id and
// scope: the effective Claude configuration home, the plugins root and the
// stable per-plugin cache family that holds each versioned cache directory.
// All native plugin commands run from the session's own project context.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const RECURSION_ENV = 'TOOLKIT_CLAUDE_PLUGIN_AUTO_REFRESH_ACTIVE';
const ATTEMPT_FILE = 'claude-plugin-auto-refresh.json';
const ATTEMPT_SCHEMA = 1;
const PLUGIN_NAME = 'ai-agent-toolkit';
const MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const SETUP_HELPER_REL_PATH = ['repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'];
const NATIVE_SCOPES = ['user', 'project', 'local'];

// Startup budget, all within Claude Code's 600s default command-hook limit.
// The helper environment is pinned so the helper's own worst case (which it
// checks against --budget-ms before any Claude call) fits inside each outer
// kill timeout. A helper still running at its timeout is killed and its
// attempt is held as an unknown outcome.
const GIT_TIMEOUT_MS = 10000;
const SOURCE_VALIDATION_BUDGET_MS = 150000; // validate-toolkit (120s) + hook-light test (30s)
const CHILD_ENV = {
  CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS: '45000',
  CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS: '10000',
  CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS: '150000'
};
const PLAN_BUDGET_MS = 85000;
const PLAN_TIMEOUT_MS = 90000;
const APPLY_BUDGET_MS = 285000;
const APPLY_TIMEOUT_MS = 290000;
const HOOK_WORST_CASE_MS = 3 * GIT_TIMEOUT_MS + SOURCE_VALIDATION_BUDGET_MS + PLAN_TIMEOUT_MS + APPLY_TIMEOUT_MS;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
// Core files that must match for a same-version cache to count as current.
// The full set adds the installed-enforcement identity contract from the
// setup helper, which is itself in this core set.
const CURRENT_IDENTITY_FILES = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/hooks/hooks.json',
  'repo/contracts/toolkit-local-bridge/version.json',
  'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/toolkit-claude-plugin-auto-refresh.cjs',
  'repo/scripts/setup-claude-toolkit-plugin.cjs'
];
const MANUAL_ACTION = 'run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then start a fresh Claude Code session';
const HELD_ACTION = 'check the plugin with `setup toolkit --host claude-code`; once it is correct, choose "Turn on" for Claude Code automatic Toolkit refresh in that setup run to clear the held record (a later session running that same install, verified current, also clears it)';

// Report status for each detailed outcome. `action-required` opens an update
// report; `refreshed` is successful activity; the rest are informational.
const REPORT_STATUS = {
  current: 'fresh',
  'resolved-current': 'fresh',
  'running-in-place': 'in-place',
  updated: 'refreshed',
  'installed-current': 'restart-required',
  busy: 'skipped',
  'skipped-recursion': 'skipped',
  'plan-changed': 'deferred',
  'source-moved': 'deferred'
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => {
    const resolved = path.resolve(String(value)).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function readManifestVersion(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
    return manifest?.name === 'ai-agent-toolkit' && VERSION_PATTERN.test(String(manifest.version || '')) ? manifest.version : '';
  } catch {
    return '';
  }
}

function lastJsonLine(text) {
  const lines = String(text || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try { return JSON.parse(trimmed); } catch { /* keep looking */ }
  }
  return null;
}

// Helper environment: the caller's environment with the auto-refresh budget
// controls pinned, so an owner override cannot stretch the helper past the
// outer timeout.
function autoRefreshChildEnv(env) {
  return { ...env, ...CHILD_ENV, [RECURSION_ENV]: '1' };
}

// The full same-version identity set: the core files plus the installed-
// enforcement contract of the setup helper running beside this module. When
// the core files match the source, that helper (and so its list) is the source's.
function enforcementIdentityFiles() {
  const { INSTALLED_ENFORCEMENT_FILES } = require('./setup-claude-toolkit-plugin.cjs');
  if (!Array.isArray(INSTALLED_ENFORCEMENT_FILES) || INSTALLED_ENFORCEMENT_FILES.length === 0) {
    throw new Error('the installed-enforcement identity list is unavailable');
  }
  return [...new Set([...CURRENT_IDENTITY_FILES, ...INSTALLED_ENFORCEMENT_FILES])];
}

function isAbsoluteDir(value) {
  if (!value || !path.isAbsolute(String(value))) return false;
  try { return fs.statSync(String(value)).isDirectory(); } catch { return false; }
}

// The verified native install namespace of a cache-backed session. Claude Code
// installs this plugin at <plugins root>/cache/<marketplace>/<plugin>/<version>
// (the shape recorded in installed_plugins.json), so the directory above the
// version is the stable cache family that survives version changes. The
// plugins root is CLAUDE_CODE_PLUGIN_CACHE_DIR when set, otherwise
// <config home>/plugins; the config home is CLAUDE_CONFIG_DIR when set.
// A missing CLAUDE_CONFIG_DIR proves the default home only when the running
// cache sits under the default home's own plugins root and nothing scrubbed
// the variable; anything else is unverified and fails closed.
function resolveClaudeNativeIdentity({ env = process.env, runningRoot, homedir = os.homedir() } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!runningRoot || !path.isAbsolute(String(runningRoot))) return fail('the running plugin root is not an absolute path');
  const installPath = path.resolve(String(runningRoot));
  const version = path.basename(installPath);
  const cacheFamily = path.dirname(installPath);
  const marketplaceDir = path.dirname(cacheFamily);
  const cacheDir = path.dirname(marketplaceDir);
  const pluginsRoot = path.dirname(cacheDir);
  if (!VERSION_PATTERN.test(version) || path.basename(cacheFamily) !== PLUGIN_NAME
    || path.basename(marketplaceDir) !== MARKETPLACE_NAME || path.basename(cacheDir) !== 'cache') {
    return fail(`the running plugin root is not a Claude Code cache entry of ${PLUGIN_ID}`);
  }
  const configEnv = String(env.CLAUDE_CONFIG_DIR || '').trim();
  const cacheEnv = String(env.CLAUDE_CODE_PLUGIN_CACHE_DIR || '').trim();
  const scrubbed = /^(1|true|yes)$/i.test(String(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB || '').trim());
  let configHome;
  let configSource;
  if (configEnv) {
    if (!path.isAbsolute(configEnv)) return fail('CLAUDE_CONFIG_DIR is not an absolute path');
    configHome = path.resolve(configEnv);
    configSource = 'env';
  } else {
    if (scrubbed) return fail('Claude Code scrubbed CLAUDE_CONFIG_DIR from this hook, so the configuration home cannot be verified');
    if (cacheEnv) return fail('CLAUDE_CODE_PLUGIN_CACHE_DIR is set without CLAUDE_CONFIG_DIR, so the configuration home cannot be verified');
    if (!homedir) return fail('the default Claude configuration home cannot be resolved');
    configHome = path.resolve(homedir, '.claude');
    configSource = 'default';
  }
  let expectedPluginsRoot;
  let pluginsSource;
  if (cacheEnv) {
    if (!path.isAbsolute(cacheEnv)) return fail('CLAUDE_CODE_PLUGIN_CACHE_DIR is not an absolute path');
    expectedPluginsRoot = path.resolve(cacheEnv);
    pluginsSource = 'env';
  } else {
    expectedPluginsRoot = path.join(configHome, 'plugins');
    pluginsSource = 'config-home';
  }
  if (!samePath(pluginsRoot, expectedPluginsRoot)) {
    return fail('the running plugin cache is not under the plugins root of the configured Claude Code home');
  }
  return {
    ok: true,
    identity: {
      config_home: configHome,
      config_home_source: configSource,
      plugins_root: pluginsRoot,
      plugins_root_source: pluginsSource,
      cache_family: cacheFamily
    }
  };
}

function sameNativeIdentity(left, right) {
  return Boolean(left && right)
    && ['config_home', 'plugins_root', 'cache_family'].every((key) => samePath(left[key], right[key]));
}

// True when a native install path is a versioned entry of the cache family.
function inCacheFamily(installPath, cacheFamily, version) {
  return Boolean(installPath && cacheFamily && VERSION_PATTERN.test(String(version || '')))
    && samePath(path.dirname(path.resolve(String(installPath))), cacheFamily)
    && path.basename(path.resolve(String(installPath))) === String(version);
}

// The immutable native target an attempt is bound to before any mutation:
// one install record (scope and, for project/local scope, project) inside one
// verified install namespace, sourced from one managed checkout. The versioned
// cache path is evidence only; it changes with each update.
function attemptTarget(installed, identity, sourcePath) {
  return {
    plugin_id: PLUGIN_ID,
    marketplace: MARKETPLACE_NAME,
    scope: String(installed?.scope || ''),
    project_path: String(installed?.project_path || ''),
    install_path: String(installed?.install_path || ''),
    config_home: identity.config_home,
    config_home_source: identity.config_home_source,
    plugins_root: identity.plugins_root,
    plugins_root_source: identity.plugins_root_source,
    cache_family: identity.cache_family,
    source_path: sourcePath
  };
}

const TARGET_KEYS = Object.keys(attemptTarget({}, {}, ''));

// A complete target names every identity field with the values and layout
// attemptTarget() and resolveClaudeNativeIdentity() produce; anything older,
// partial or inconsistent cannot be matched and stays held until explicit
// setup recovery.
function completeTarget(target) {
  if (!isPlainObject(target)) return false;
  if (target.plugin_id !== PLUGIN_ID || target.marketplace !== MARKETPLACE_NAME || !NATIVE_SCOPES.includes(target.scope)) return false;
  if (typeof target.project_path !== 'string') return false;
  if (target.scope === 'user' ? Boolean(target.project_path) : !path.isAbsolute(target.project_path)) return false;
  if (!['config_home', 'plugins_root', 'cache_family', 'source_path', 'install_path']
    .every((key) => typeof target[key] === 'string' && path.isAbsolute(target[key]))) return false;
  if (!['env', 'default'].includes(target.config_home_source) || !['env', 'config-home'].includes(target.plugins_root_source)) return false;
  if (target.plugins_root_source === 'config-home' && !samePath(target.plugins_root, path.join(target.config_home, 'plugins'))) return false;
  return samePath(target.cache_family, path.join(target.plugins_root, 'cache', MARKETPLACE_NAME, PLUGIN_NAME))
    && inCacheFamily(target.install_path, target.cache_family, path.basename(path.resolve(target.install_path)));
}

// Two records name the same target only when every identity field is equal.
function sameTarget(left, right) {
  return completeTarget(left) && completeTarget(right) && TARGET_KEYS.every((key) => left[key] === right[key]);
}

// The pending attempt shape #runStale writes before any mutation (in-flight,
// then held): the only records a same-target verification may resolve.
function resolvableAttempt(attempt) {
  return isPlainObject(attempt) && (attempt.phase === 'in-flight' || attempt.phase === 'held')
    && nonEmptyString(attempt.attempt_id) && VERSION_PATTERN.test(String(attempt.to_version || ''))
    && completeTarget(attempt.target);
}

// The recorded target matches this session's verified namespace and source.
function sameNamespace(target, identity, sourcePath) {
  return completeTarget(target) && sameNativeIdentity(target, identity) && samePath(target.source_path, sourcePath);
}

// The native install record a plan reports is the recorded target's record,
// at any version inside the target's cache family.
function sameInstallRecord(target, installed) {
  if (!completeTarget(target) || !installed) return false;
  const projectPath = String(installed.project_path || '');
  return target.scope === String(installed.scope || '')
    && (target.project_path ? samePath(target.project_path, projectPath) : !projectPath)
    && inCacheFamily(installed.install_path, target.cache_family, installed.version);
}

// Conservative attempt-state admission. Only these exact, fully attested
// terminal records discharge an attempt; `in-flight`, `held` and every
// missing, unknown, malformed or unattested state are pending and are never
// retried automatically. Unknown records are kept byte-for-byte. Each
// attestation is the full shape its only producer writes: `completed` by
// #runStale, `resolved` by #runSameVersion, and `cleared` by the bridge's
// explicit setup recovery, which keeps any malformed old record verbatim
// inside a plain-object `previous` (so that payload is not target-checked).
const TERMINAL_ATTESTATIONS = {
  completed: (record) => nonEmptyString(record.attempt_id) && nonEmptyString(record.completed_at)
    && completeTarget(record.target)
    && (record.outcome === 'updated'
      ? VERSION_PATTERN.test(String(record.from_version || '')) && VERSION_PATTERN.test(String(record.to_version || ''))
        && COMMIT_PATTERN.test(String(record.source_commit || '')) && record.scope === record.target.scope
      : record.outcome === 'not-attempted' && typeof record.reason === 'string'),
  resolved: (record) => record.resolved_by === 'same-target-verified' && nonEmptyString(record.resolved_at)
    && resolvableAttempt(record.previous) && sameTarget(record.target, record.previous.target),
  cleared: (record) => nonEmptyString(record.cleared_at) && isPlainObject(record.previous)
};

function classifyAttemptRecord(record) {
  if (record === undefined) return { pending: false, phase: 'none', record: null };
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.schema !== ATTEMPT_SCHEMA) {
    return { pending: true, phase: 'unreadable', record: { schema: ATTEMPT_SCHEMA, phase: 'unreadable' } };
  }
  if (record.phase === 'in-flight' || record.phase === 'held') return { pending: true, phase: record.phase, record };
  const attest = Object.prototype.hasOwnProperty.call(TERMINAL_ATTESTATIONS, record.phase) ? TERMINAL_ATTESTATIONS[record.phase] : null;
  if (attest && attest(record)) return { pending: false, phase: record.phase, record };
  return {
    pending: true,
    phase: 'unreadable',
    record: { schema: ATTEMPT_SCHEMA, phase: 'unreadable', recorded_phase: typeof record.phase === 'string' ? record.phase : '<missing>' }
  };
}

function readAttemptFile(attemptPath) {
  let text;
  try {
    text = fs.readFileSync(attemptPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return classifyAttemptRecord(undefined);
    return classifyAttemptRecord(null);
  }
  try {
    return classifyAttemptRecord(JSON.parse(text));
  } catch {
    return classifyAttemptRecord(null);
  }
}

class ClaudePluginAutoRefreshOperation {
  #lockRoot; #repoPath; #runningRoot; #executingRoot; #projectDir; #env; #homedir; #deps; #attemptPath;

  // projectDir: the session's project context (CLAUDE_PROJECT_DIR, else the
  // hook's working directory); every native plugin command runs from it.
  // deps: acquireLock(lockRoot) -> lock, releaseLock(lock), git(repoPath, args, {timeout}) -> {ok, stdout},
  // validateRepo(repoPath) (throws on failure), runNode(scriptPath, args, {cwd, timeout, env}) ->
  // {ok, status, stdout, stderr, error, timedOut}, now() -> ISO string.
  constructor({ lockRoot, repoPath, runningPluginRoot, executingRoot, projectDir = '', env = process.env, homedir = os.homedir(), deps }) {
    this.#lockRoot = lockRoot;
    this.#repoPath = repoPath ? path.resolve(repoPath) : '';
    this.#runningRoot = runningPluginRoot ? path.resolve(runningPluginRoot) : '';
    this.#executingRoot = executingRoot ? path.resolve(executingRoot) : '';
    this.#projectDir = projectDir ? String(projectDir) : '';
    this.#env = env;
    this.#homedir = homedir;
    this.#deps = deps;
    // The record lives beside the hub lock, outside the hub snapshot directory
    // that bridge writes replace atomically.
    this.#attemptPath = path.join(lockRoot, ATTEMPT_FILE);
  }

  #result(status, details = {}) {
    return {
      host: 'claude-code',
      status: REPORT_STATUS[status] || 'action-required',
      refresh_status: status,
      fresh_session_required: false,
      errors: [],
      ...details
    };
  }

  #actionRequired(status, reason, details = {}, manualAction = MANUAL_ACTION) {
    return this.#result(status, { ...details, errors: [reason], manual_action: manualAction });
  }

  // The pending attempt record, or null when no attempt is pending.
  #readPendingAttempt() {
    const state = readAttemptFile(this.#attemptPath);
    return state.pending ? state.record : null;
  }

  #nativeIdentity() {
    return resolveClaudeNativeIdentity({ env: this.#env, runningRoot: this.#runningRoot, homedir: this.#homedir });
  }

  #projectContext() {
    return isAbsoluteDir(this.#projectDir) ? path.resolve(this.#projectDir) : '';
  }

  #identityArgs(identity, projectContext) {
    return ['--running-plugin-root', this.#runningRoot, '--project-context', projectContext,
      '--claude-config-home', identity.config_home, '--claude-plugins-root', identity.plugins_root];
  }

  // The plan report's verified native namespace is this session's namespace.
  #reportMatchesIdentity(report, identity, projectContext) {
    const native = report?.native_identity;
    return sameNativeIdentity(native, identity) && samePath(native?.project_context, projectContext);
  }

  // Durable write: the record reaches disk before any mutation starts.
  #writeAttempt(record) {
    fs.mkdirSync(path.dirname(this.#attemptPath), { recursive: true });
    const temporary = `${this.#attemptPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle = fs.openSync(temporary, 'wx');
    try {
      fs.writeSync(handle, `${JSON.stringify({ schema: ATTEMPT_SCHEMA, ...record }, null, 2)}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, this.#attemptPath);
  }

  #git(args) {
    return this.#deps.git(this.#repoPath, args, { timeout: GIT_TIMEOUT_MS });
  }

  #verifySource() {
    const repoPath = this.#repoPath;
    if (!repoPath || !fs.existsSync(repoPath)) return { ok: false, reason: 'the managed Toolkit checkout is not configured or does not exist' };
    const top = this.#git(['rev-parse', '--show-toplevel']);
    if (!top.ok || !samePath(top.stdout.trim(), repoPath)) return { ok: false, reason: 'the configured managed Toolkit path is not the root of a git checkout' };
    const head = this.#git(['rev-parse', 'HEAD']);
    const commit = head.ok ? head.stdout.trim().toLowerCase() : '';
    if (!COMMIT_PATTERN.test(commit)) return { ok: false, reason: 'the managed Toolkit checkout commit could not be read' };
    const status = this.#git(['status', '--porcelain', '--untracked-files=normal']);
    if (!status.ok) return { ok: false, reason: 'the managed Toolkit checkout status could not be read' };
    if (status.stdout.trim()) return { ok: false, reason: 'the managed Toolkit checkout has uncommitted changes' };
    const version = readManifestVersion(repoPath);
    if (!version) return { ok: false, reason: 'the managed Toolkit checkout has no valid Claude plugin manifest version' };
    if (!fs.existsSync(path.join(repoPath, ...SETUP_HELPER_REL_PATH))) return { ok: false, reason: 'the managed Toolkit checkout has no Claude plugin setup helper' };
    return { ok: true, commit, version };
  }

  // Returns the first identity file whose running bytes differ from the
  // managed source (or are missing), or '' when every file matches.
  #firstIdentityMismatch(files) {
    for (const relPath of files) {
      const running = path.join(this.#runningRoot, ...relPath.split('/'));
      const source = path.join(this.#repoPath, ...relPath.split('/'));
      try {
        if (!fs.lstatSync(running).isFile() || !fs.readFileSync(running).equals(fs.readFileSync(source))) return relPath;
      } catch {
        return relPath;
      }
    }
    return '';
  }

  #helper(mode, args, budget, timeout) {
    const script = path.join(this.#repoPath, ...SETUP_HELPER_REL_PATH);
    const result = this.#deps.runNode(script, [mode, '--json', '--repo-root', this.#repoPath, '--budget-ms', String(budget), ...args], {
      cwd: this.#repoPath,
      timeout,
      env: autoRefreshChildEnv(this.#env)
    });
    return { ...result, report: result.timedOut ? null : lastJsonLine(result.stdout) };
  }

  #plan(source, rootArgs) {
    const plan = this.#helper('--auto-refresh-plan', ['--expected-commit', source.commit, ...rootArgs], PLAN_BUDGET_MS, PLAN_TIMEOUT_MS);
    const report = plan.report && plan.report.mutation_attempted === false ? plan.report : null;
    return { report, timedOut: Boolean(plan.timedOut) };
  }

  #heldResult(attempt, versions, extraReason = '') {
    const target = typeof attempt.target?.scope === 'string' && attempt.target.scope ? ` for the scope ${attempt.target.scope} install` : '';
    const base = attempt.phase === 'held'
      ? `a previous automatic refresh${target} (${attempt.outcome || 'unverified'}) was not verified`
      : attempt.phase === 'unreadable'
        ? 'the previous automatic refresh record is unreadable or has no recognised verified state, so its effect is unknown'
        : `a previous automatic refresh${target} did not record its outcome; its effect is unknown`;
    return this.#actionRequired('held', `${base}${extraReason}; it is not retried automatically`,
      { ...versions, attempt_id: attempt.attempt_id || '', mutation_attempted: false }, HELD_ACTION);
  }

  run() {
    if (this.#env[RECURSION_ENV] === '1') return this.#result('skipped-recursion');
    if (!this.#runningRoot || !this.#executingRoot || !samePath(this.#runningRoot, this.#executingRoot)) {
      return this.#actionRequired('untrusted-runtime', 'the running hook is not executing from the Claude plugin root it reports');
    }
    const lock = this.#deps.acquireLock(this.#lockRoot);
    if (!lock?.acquired) return this.#result('busy', { detail: lock?.skipReason || 'another Toolkit maintenance run holds the hub lock' });
    try {
      return this.#runLocked();
    } finally {
      this.#deps.releaseLock(lock);
    }
  }

  #runLocked() {
    const attempt = this.#readPendingAttempt();
    const runningVersion = readManifestVersion(this.#runningRoot);
    if (!runningVersion) return this.#actionRequired('untrusted-runtime', 'the running Claude plugin root has no valid Toolkit manifest');
    const source = this.#verifySource();
    if (!source.ok) return this.#actionRequired('source-untrusted', source.reason, { running_version: runningVersion });
    if (samePath(this.#runningRoot, this.#repoPath)) return this.#runInPlace(attempt, source, runningVersion);
    const versions = { running_version: runningVersion, source_version: source.version, source_commit: source.commit, execution: 'plugin-cache' };
    const order = compareVersions(runningVersion, source.version);
    if (order > 0) {
      return this.#actionRequired('newer-than-source', `the running plugin ${runningVersion} is newer than managed source ${source.version}; downgrade is refused`, versions);
    }
    if (order === 0) return this.#runSameVersion(attempt, source, versions);
    // One shared-hub fence: any pending attempt blocks every automatic update.
    if (attempt) return this.#heldResult(attempt, versions);
    return this.#runStale(source, versions, runningVersion);
  }

  // Toolkit is executing directly from the managed checkout. This session has
  // no plugin cache of its own: it reports, read-only, what Claude Code's
  // install record says and never updates another entry or resolves an attempt.
  #runInPlace(attempt, source, runningVersion) {
    const versions = { running_version: runningVersion, source_version: source.version, source_commit: source.commit, execution: 'managed-source', mutation_attempted: false };
    if (attempt) {
      return this.#heldResult(attempt, versions, '; this session runs Toolkit directly from the managed checkout and cannot verify or resolve that install');
    }
    const projectContext = this.#projectContext();
    if (!projectContext) {
      return this.#actionRequired('project-context-unverified', 'the session project directory is not available, so Claude Code\'s plugin record cannot be read for this session', versions);
    }
    const plan = this.#plan(source, ['--running-in-place', '--project-context', projectContext]);
    if (!plan.report) {
      return this.#actionRequired('in-place-unverified', plan.timedOut
        ? 'the read-only check of Claude Code\'s plugin record timed out, so this in-place session could not be matched to its native install'
        : 'the read-only check of Claude Code\'s plugin record returned no valid result, so this in-place session could not be matched to its native install', versions);
    }
    const report = plan.report;
    const details = { ...versions, installed: report.installed || null, shadow_entries: report.shadow_entries || [] };
    if (report.status === 'in-place-current') return this.#result('running-in-place', details);
    return this.#actionRequired(report.status || 'in-place-unverified', report.reason || 'Claude Code\'s plugin record does not confirm this in-place session', details);
  }

  // Same version from an installed cache: current only when every
  // installed-enforcement identity file matches the source. A pending attempt
  // is resolved only when its own target is independently verified current
  // and is the install this session runs from: the same configuration home,
  // plugins root, cache family, managed source, scope and project.
  #runSameVersion(attempt, source, versions) {
    let mismatch;
    try {
      mismatch = this.#firstIdentityMismatch(enforcementIdentityFiles());
    } catch (error) {
      return this.#actionRequired('stale-same-version', `the running plugin identity could not be checked: ${error.message}`, versions);
    }
    if (mismatch) {
      return this.#actionRequired('stale-same-version', `the running plugin reports the source version but ${mismatch} differs from the managed source`, versions);
    }
    if (!attempt) return this.#result('current', versions);
    if (!resolvableAttempt(attempt) || attempt.to_version !== source.version) {
      return this.#heldResult(attempt, versions);
    }
    const native = this.#nativeIdentity();
    if (!native.ok) return this.#heldResult(attempt, versions, `; ${native.reason}`);
    if (!sameNamespace(attempt.target, native.identity, this.#repoPath)) {
      return this.#heldResult(attempt, versions, '; it belongs to a different Claude Code install, so this session cannot verify or resolve it');
    }
    const projectContext = this.#projectContext();
    if (!projectContext) return this.#heldResult(attempt, versions, '; the session project directory is not available');
    try {
      this.#deps.validateRepo(this.#repoPath);
    } catch {
      return this.#heldResult(attempt, versions, '; the managed source failed validation, so the install could not be re-verified');
    }
    const report = this.#plan(source, this.#identityArgs(native.identity, projectContext)).report;
    const verified = report && report.status === 'current' && report.installed
      && report.installed.version === source.version
      && samePath(report.installed.install_path, this.#runningRoot)
      && this.#reportMatchesIdentity(report, native.identity, projectContext)
      && sameInstallRecord(attempt.target, report.installed);
    if (!verified) return this.#heldResult(attempt, versions, '; this session could not verify that the same install is now current');
    this.#writeAttempt({ phase: 'resolved', resolved_by: 'same-target-verified', resolved_at: this.#deps.now(), target: attempt.target, previous: attempt });
    return this.#result('resolved-current', versions);
  }

  #runStale(source, versions, runningVersion) {
    const native = this.#nativeIdentity();
    if (!native.ok) return this.#actionRequired('native-identity-unverified', native.reason, versions);
    const projectContext = this.#projectContext();
    if (!projectContext) {
      return this.#actionRequired('project-context-unverified', 'the session project directory is not available, so the plugin cannot be checked in this session\'s context', versions);
    }
    try {
      this.#deps.validateRepo(this.#repoPath);
    } catch (error) {
      return this.#actionRequired('source-validation-failed', `managed source validation failed: ${error.message}`, versions);
    }
    const identityArgs = this.#identityArgs(native.identity, projectContext);
    const plan = this.#plan(source, identityArgs);
    const planReport = plan.report;
    if (!planReport) {
      return this.#actionRequired('plan-failed', plan.timedOut ? 'the read-only plugin state check timed out' : 'the read-only plugin state check returned no valid result', versions);
    }
    if (planReport.status === 'current') {
      return this.#result('installed-current', { ...versions, fresh_session_required: true, detail: 'Claude Code already has the current plugin installed; this session still runs an older plugin cache.' });
    }
    if (planReport.status !== 'stale') {
      return this.#actionRequired(planReport.status || 'plan-failed', planReport.reason || 'the plugin state cannot be refreshed automatically', {
        ...versions, shadow_entries: planReport.shadow_entries || []
      });
    }
    const fromVersion = planReport.installed?.version || '';
    if (fromVersion !== runningVersion || !samePath(planReport.installed?.install_path, this.#runningRoot)) {
      return this.#actionRequired('untrusted-runtime', 'Claude Code reports a different installed version or cache than the running hook', versions);
    }
    if (!this.#reportMatchesIdentity(planReport, native.identity, projectContext)) {
      return this.#actionRequired('native-identity-unverified', 'the plugin check did not confirm this session\'s Claude Code configuration home, plugin cache and project', versions);
    }
    const attemptId = crypto.randomUUID();
    const target = attemptTarget(planReport.installed, native.identity, this.#repoPath);
    if (!completeTarget(target)) {
      return this.#actionRequired('native-identity-unverified', 'the installed plugin record does not name a complete native target', versions);
    }
    const scope = target.scope;
    this.#writeAttempt({
      phase: 'in-flight', attempt_id: attemptId, started_at: this.#deps.now(), pid: process.pid,
      from_version: fromVersion, to_version: source.version, source_commit: source.commit, scope, target,
      project_context: projectContext
    });
    const apply = this.#helper('--auto-refresh-apply', [
      '--expected-commit', source.commit,
      '--expected-from-version', fromVersion,
      '--expected-to-version', source.version,
      ...identityArgs
    ], APPLY_BUDGET_MS, APPLY_TIMEOUT_MS);
    const report = apply.report;
    const details = { ...versions, attempt_id: attemptId, from_version: fromVersion, to_version: source.version, scope, mutation_attempted: true };
    if (report && report.ok === true && report.status === 'updated'
      && this.#reportMatchesIdentity(report, native.identity, projectContext)
      && sameInstallRecord(target, { scope: report.scope, project_path: report.project_path, install_path: report.install_path, version: report.to_version })
      && report.to_version === source.version) {
      this.#writeAttempt({ phase: 'completed', outcome: 'updated', attempt_id: attemptId, completed_at: this.#deps.now(), from_version: fromVersion, to_version: source.version, source_commit: source.commit, scope, target });
      return this.#result('updated', {
        ...details,
        install_path: report.install_path || '',
        fresh_session_required: true,
        trust_action: report.trust_action || '',
        warnings: report.warning ? [report.warning] : []
      });
    }
    // Only an apply-mode report that positively says the native update never
    // started may discharge the attempt; anything else stays held.
    if (report && report.mode === 'apply' && report.ok !== true && report.mutation_attempted === false) {
      this.#writeAttempt({ phase: 'completed', outcome: 'not-attempted', attempt_id: attemptId, completed_at: this.#deps.now(), reason: report.status || '', target });
      return this.#result(report.status === 'source-moved' ? 'source-moved' : 'plan-changed', { ...details, mutation_attempted: false, errors: [report.reason || 'the plan changed before update'] });
    }
    const outcome = report?.status === 'updated' ? 'update-unverified' : (report?.status || (apply.timedOut ? 'unknown-timeout' : 'unknown'));
    this.#writeAttempt({ phase: 'held', outcome, attempt_id: attemptId, held_at: this.#deps.now(), from_version: fromVersion, to_version: source.version, source_commit: source.commit, scope, target });
    const reason = report
      ? `Claude Code plugin update was not verified (${outcome}): ${report.reason || (report.status === 'updated' ? 'the reported install is not the verified target of this session' : 'no detail')}`
      : `Claude Code plugin update outcome is unknown (${apply.timedOut ? 'timed out' : 'no valid result'})`;
    return this.#actionRequired(report ? outcome : 'unknown-outcome', reason, details, HELD_ACTION);
  }
}

function claudeAutoRefreshStdoutLine(result) {
  if (!result || !result.refresh_status) return '';
  const status = result.refresh_status;
  if (status === 'updated') {
    return `Toolkit Claude plugin auto-refresh: updated ${result.from_version} -> ${result.to_version} (scope ${result.scope}) from verified managed source ${String(result.source_commit || '').slice(0, 8)}. This session still runs ${result.from_version}; start a fresh Claude Code session to activate it (clearing or compacting the conversation keeps the old plugin) and approve any trust prompt Claude Code shows.`;
  }
  if (status === 'installed-current') {
    return 'Toolkit Claude plugin auto-refresh: the current plugin is already installed; start a fresh Claude Code session to use it (clearing or compacting the conversation keeps the old plugin).';
  }
  if (status === 'resolved-current') {
    return 'Toolkit Claude plugin auto-refresh: this install is verified current; the earlier unverified refresh record for it is resolved.';
  }
  if (status === 'running-in-place') {
    return `Toolkit Claude plugin auto-refresh: this session runs Toolkit ${result.running_version} directly from the managed checkout (${String(result.source_commit || '').slice(0, 8)}), so there is no plugin cache to refresh; Claude Code's install record matches it.`;
  }
  if (result.status === 'action-required') {
    const effect = result.mutation_attempted
      ? 'The update effect is unverified and will not be retried automatically'
      : 'No plugin change was made';
    return `Toolkit Claude plugin auto-refresh: action required (${status}): ${(result.errors || []).join('; ')}. ${effect}; ${result.manual_action || MANUAL_ACTION}.`;
  }
  return '';
}

module.exports = {
  APPLY_BUDGET_MS,
  APPLY_TIMEOUT_MS,
  ATTEMPT_FILE,
  CURRENT_IDENTITY_FILES,
  ClaudePluginAutoRefreshOperation,
  HELD_ACTION,
  MARKETPLACE_NAME,
  PLUGIN_ID,
  PLUGIN_NAME,
  HOOK_WORST_CASE_MS,
  MANUAL_ACTION,
  PLAN_BUDGET_MS,
  PLAN_TIMEOUT_MS,
  RECURSION_ENV,
  attemptTarget,
  autoRefreshChildEnv,
  classifyAttemptRecord,
  claudeAutoRefreshStdoutLine,
  completeTarget,
  enforcementIdentityFiles,
  inCacheFamily,
  lastJsonLine,
  readAttemptFile,
  readManifestVersion,
  resolveClaudeNativeIdentity,
  sameInstallRecord,
  sameNativeIdentity,
  samePath
};
