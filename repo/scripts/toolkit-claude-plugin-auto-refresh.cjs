'use strict';

// Opt-in Claude Code Toolkit plugin-cache refresh for the Claude SessionStart
// bridge hook. The owner below verifies the managed source, holds the Toolkit
// hub lock, records every mutation attempt durably before it starts, and asks
// the verified managed source's setup helper to run only Claude Code's own
// in-place `plugin update`. Anything that cannot be proven safe is reported as
// action required; an attempt whose effect is unknown or unverified is never
// retried automatically.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RECURSION_ENV = 'TOOLKIT_CLAUDE_PLUGIN_AUTO_REFRESH_ACTIVE';
const ATTEMPT_FILE = 'claude-plugin-auto-refresh.json';
const ATTEMPT_SCHEMA = 1;
const SETUP_HELPER_REL_PATH = ['repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'];
// Hook-light validation (at most 150s) plus these budgets stays under Claude
// Code's 600s default command-hook timeout. A helper still running at its
// budget is killed and its attempt is held as an unknown outcome.
const PLAN_TIMEOUT_MS = 135000;
const APPLY_TIMEOUT_MS = 300000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
// Running-cache bytes that must equal the managed source for a same-version
// cache to count as current without asking Claude Code.
const CURRENT_IDENTITY_FILES = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/hooks/hooks.json',
  'repo/contracts/toolkit-local-bridge/version.json',
  'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/toolkit-claude-plugin-auto-refresh.cjs',
  'repo/scripts/setup-claude-toolkit-plugin.cjs'
];
const MANUAL_ACTION = 'run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then start a fresh Claude Code session';

// Report status for each detailed outcome. `action-required` opens an update
// report; `refreshed` is successful activity; the rest are informational.
const REPORT_STATUS = {
  current: 'fresh',
  'resolved-current': 'fresh',
  updated: 'refreshed',
  'installed-current': 'restart-required',
  busy: 'skipped',
  'skipped-recursion': 'skipped',
  'plan-changed': 'deferred',
  'source-moved': 'deferred'
};

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
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8').replace(/^﻿/, ''));
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

class ClaudePluginAutoRefreshOperation {
  #lockRoot; #repoPath; #runningRoot; #executingRoot; #env; #deps; #attemptPath;

  // deps: acquireLock(lockRoot) -> lock, releaseLock(lock), git(repoPath, args) -> {ok, stdout},
  // validateRepo(repoPath) (throws on failure), runNode(scriptPath, args, {cwd, timeout, env}) ->
  // {ok, status, stdout, stderr, error, timedOut}, now() -> ISO string.
  constructor({ lockRoot, repoPath, runningPluginRoot, executingRoot, env = process.env, deps }) {
    this.#lockRoot = lockRoot;
    this.#repoPath = repoPath ? path.resolve(repoPath) : '';
    this.#runningRoot = runningPluginRoot ? path.resolve(runningPluginRoot) : '';
    this.#executingRoot = executingRoot ? path.resolve(executingRoot) : '';
    this.#env = env;
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

  #actionRequired(status, reason, details = {}) {
    return this.#result(status, { ...details, errors: [reason], manual_action: MANUAL_ACTION });
  }

  #readAttempt() {
    try {
      const record = JSON.parse(fs.readFileSync(this.#attemptPath, 'utf8'));
      return record && record.schema === ATTEMPT_SCHEMA ? record : { schema: ATTEMPT_SCHEMA, phase: 'unreadable' };
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      return { schema: ATTEMPT_SCHEMA, phase: 'unreadable' };
    }
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

  #verifySource() {
    const repoPath = this.#repoPath;
    if (!repoPath || !fs.existsSync(repoPath)) return { ok: false, reason: 'the managed Toolkit checkout is not configured or does not exist' };
    const top = this.#deps.git(repoPath, ['rev-parse', '--show-toplevel']);
    if (!top.ok || !samePath(top.stdout.trim(), repoPath)) return { ok: false, reason: 'the configured managed Toolkit path is not the root of a git checkout' };
    const head = this.#deps.git(repoPath, ['rev-parse', 'HEAD']);
    const commit = head.ok ? head.stdout.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{40}$/.test(commit)) return { ok: false, reason: 'the managed Toolkit checkout commit could not be read' };
    const status = this.#deps.git(repoPath, ['status', '--porcelain', '--untracked-files=normal']);
    if (!status.ok) return { ok: false, reason: 'the managed Toolkit checkout status could not be read' };
    if (status.stdout.trim()) return { ok: false, reason: 'the managed Toolkit checkout has uncommitted changes' };
    const version = readManifestVersion(repoPath);
    if (!version) return { ok: false, reason: 'the managed Toolkit checkout has no valid Claude plugin manifest version' };
    if (!fs.existsSync(path.join(repoPath, ...SETUP_HELPER_REL_PATH))) return { ok: false, reason: 'the managed Toolkit checkout has no Claude plugin setup helper' };
    return { ok: true, commit, version };
  }

  #runningBytesMatchSource() {
    for (const relPath of CURRENT_IDENTITY_FILES) {
      const running = path.join(this.#runningRoot, ...relPath.split('/'));
      const source = path.join(this.#repoPath, ...relPath.split('/'));
      try {
        if (!fs.readFileSync(running).equals(fs.readFileSync(source))) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  #helper(mode, args, timeout) {
    const script = path.join(this.#repoPath, ...SETUP_HELPER_REL_PATH);
    const result = this.#deps.runNode(script, [mode, '--json', '--repo-root', this.#repoPath, ...args], {
      cwd: this.#repoPath,
      timeout,
      env: { ...this.#env, [RECURSION_ENV]: '1' }
    });
    return { ...result, report: result.timedOut ? null : lastJsonLine(result.stdout) };
  }

  #clearResolvedAttempt(attempt) {
    if (attempt && ['in-flight', 'held', 'unreadable'].includes(attempt.phase)) {
      this.#writeAttempt({ phase: 'resolved', resolved_at: this.#deps.now(), previous: attempt });
      return true;
    }
    return false;
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
    const attempt = this.#readAttempt();
    const runningVersion = readManifestVersion(this.#runningRoot);
    if (!runningVersion) return this.#actionRequired('untrusted-runtime', 'the running Claude plugin cache has no valid Toolkit manifest');
    const source = this.#verifySource();
    if (!source.ok) return this.#actionRequired('source-untrusted', source.reason, { running_version: runningVersion });
    const versions = { running_version: runningVersion, source_version: source.version, source_commit: source.commit };
    const order = compareVersions(runningVersion, source.version);
    if (order > 0) {
      return this.#actionRequired('newer-than-source', `the running plugin ${runningVersion} is newer than managed source ${source.version}; downgrade is refused`, versions);
    }
    if (order === 0) {
      if (!this.#runningBytesMatchSource()) {
        return this.#actionRequired('stale-same-version', 'the running plugin reports the source version but its files differ from the managed source', versions);
      }
      const resolved = this.#clearResolvedAttempt(attempt);
      return this.#result(resolved ? 'resolved-current' : 'current', versions);
    }
    if (attempt && ['in-flight', 'held', 'unreadable'].includes(attempt.phase)) {
      const reason = attempt.phase === 'held'
        ? `a previous automatic refresh (${attempt.outcome || 'unverified'}) was not verified; it is not retried automatically`
        : 'a previous automatic refresh did not record its outcome; its effect is unknown and it is not retried automatically';
      return this.#actionRequired('held', reason, { ...versions, attempt_id: attempt.attempt_id || '' });
    }
    try {
      this.#deps.validateRepo(this.#repoPath);
    } catch (error) {
      return this.#actionRequired('source-validation-failed', `managed source validation failed: ${error.message}`, versions);
    }
    const plan = this.#helper('--auto-refresh-plan', ['--expected-commit', source.commit, '--running-plugin-root', this.#runningRoot], PLAN_TIMEOUT_MS);
    const planReport = plan.report;
    if (!planReport || planReport.mutation_attempted !== false) {
      return this.#actionRequired('plan-failed', plan.timedOut ? 'the read-only plugin state check timed out' : 'the read-only plugin state check returned no valid result', versions);
    }
    if (planReport.status === 'current') {
      return this.#result('installed-current', { ...versions, fresh_session_required: true, detail: 'Claude Code already has the current plugin installed; this session still runs an older cache.' });
    }
    if (planReport.status !== 'stale') {
      return this.#actionRequired(planReport.status || 'plan-failed', planReport.reason || 'the plugin state cannot be refreshed automatically', {
        ...versions, shadow_entries: planReport.shadow_entries || []
      });
    }
    const fromVersion = planReport.installed?.version || '';
    if (fromVersion !== runningVersion) {
      return this.#actionRequired('untrusted-runtime', 'Claude Code reports a different installed version than the running hook', versions);
    }
    const attemptId = crypto.randomUUID();
    const scope = planReport.installed.scope;
    this.#writeAttempt({
      phase: 'in-flight', attempt_id: attemptId, started_at: this.#deps.now(), pid: process.pid,
      from_version: fromVersion, to_version: source.version, source_commit: source.commit, scope
    });
    const apply = this.#helper('--auto-refresh-apply', [
      '--expected-commit', source.commit,
      '--expected-from-version', fromVersion,
      '--expected-to-version', source.version,
      '--running-plugin-root', this.#runningRoot
    ], APPLY_TIMEOUT_MS);
    const report = apply.report;
    const details = { ...versions, attempt_id: attemptId, from_version: fromVersion, to_version: source.version, scope, mutation_attempted: true };
    if (report && report.ok === true && report.status === 'updated') {
      this.#writeAttempt({ phase: 'completed', outcome: 'updated', attempt_id: attemptId, completed_at: this.#deps.now(), from_version: fromVersion, to_version: source.version, source_commit: source.commit, scope });
      return this.#result('updated', {
        ...details,
        install_path: report.install_path || '',
        fresh_session_required: true,
        trust_action: report.trust_action || '',
        warnings: report.warning ? [report.warning] : []
      });
    }
    if (report && report.mutation_attempted === false) {
      this.#writeAttempt({ phase: 'completed', outcome: 'not-attempted', attempt_id: attemptId, completed_at: this.#deps.now(), reason: report.status || '' });
      return this.#result(report.status === 'source-moved' ? 'source-moved' : 'plan-changed', { ...details, mutation_attempted: false, errors: [report.reason || 'the plan changed before update'] });
    }
    const outcome = report?.status || (apply.timedOut ? 'unknown-timeout' : 'unknown');
    this.#writeAttempt({ phase: 'held', outcome, attempt_id: attemptId, held_at: this.#deps.now(), from_version: fromVersion, to_version: source.version, source_commit: source.commit, scope });
    const reason = report
      ? `Claude Code plugin update was not verified (${outcome}): ${report.reason || 'no detail'}`
      : `Claude Code plugin update outcome is unknown (${apply.timedOut ? 'timed out' : 'no valid result'})`;
    return this.#actionRequired(report ? outcome : 'unknown-outcome', reason, details);
  }
}

function claudeAutoRefreshStdoutLine(result) {
  if (!result || !result.refresh_status) return '';
  const status = result.refresh_status;
  if (status === 'updated') {
    return `Toolkit Claude plugin auto-refresh: updated ${result.from_version} -> ${result.to_version} (scope ${result.scope}) from verified managed source ${String(result.source_commit || '').slice(0, 8)}. This session still runs ${result.from_version}; start a fresh Claude Code session to activate it and approve any trust prompt Claude Code shows.`;
  }
  if (status === 'installed-current') {
    return 'Toolkit Claude plugin auto-refresh: the current plugin is already installed; start a fresh Claude Code session to use it.';
  }
  if (status === 'resolved-current') {
    return 'Toolkit Claude plugin auto-refresh: the plugin is current; the earlier unverified refresh record is resolved.';
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
  ATTEMPT_FILE,
  CURRENT_IDENTITY_FILES,
  ClaudePluginAutoRefreshOperation,
  MANUAL_ACTION,
  RECURSION_ENV,
  claudeAutoRefreshStdoutLine,
  lastJsonLine,
  readManifestVersion
};
