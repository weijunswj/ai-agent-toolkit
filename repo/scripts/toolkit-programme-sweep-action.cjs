'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SECRET_NAME = 'TOOLKIT_GOVERNANCE_TOKEN';
const BINDING_PATH = Object.freeze(['.github', 'toolkit-programme.json']);
const BINDING_LIMIT = 64 * 1024;
const RUN_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const MISSING_GOVERNANCE_NOTICE = 'Programme Sweep skipped: a valid enabled binding on the default branch was not verified.';
const MISSING_SECRET_NOTICE = `Programme Sweep skipped: ${SECRET_NAME} is missing. Run toolkit governance check.`;
const REJECTED_SECRET_FAILURE = `Programme Sweep failed: GitHub rejected ${SECRET_NAME}. Check toolkit governance check.`;
const GENERAL_FAILURE = 'Programme Sweep failed. Check the workflow run and toolkit governance check for access problems.';
const SUMMARY_FAILURE = 'Programme Sweep could not produce the required metrics summary.';
const METRICS = /^[A-Za-z0-9_ =,.:/()-]{1,500}$/;
const QUEUED_SUMMARY = 'Programme Sweep queued: another refresh pass is still running; the next hourly run will retry.';

function defaultBindingValidator(binding) {
  return require('../../skills/github-program-reconciler/scripts/programme-state.cjs').validateBinding(binding);
}

function readMergedGovernance({ root = process.env.GITHUB_WORKSPACE || process.cwd(), env = process.env,
  readFile = fs.readFileSync, validateBinding = defaultBindingValidator } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const defaultBranch = env.DEFAULT_BRANCH;
  if (!SAFE_REPOSITORY.test(repository || '') || !SAFE_BRANCH.test(defaultBranch || '')
      || env.GITHUB_REF !== `refs/heads/${defaultBranch}`) {
    return { status: 'unverified' };
  }

  let raw;
  try {
    raw = readFile(path.join(root, ...BINDING_PATH));
  } catch (error) {
    return error && error.code === 'ENOENT'
      ? { status: 'absent', merged: true, repository, default_branch: defaultBranch }
      : { status: 'unknown' };
  }
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  if (bytes.length > BINDING_LIMIT) return { status: 'invalid', merged: true, repository, default_branch: defaultBranch };

  let binding;
  try {
    binding = JSON.parse(bytes.toString('utf8'));
    validateBinding(binding);
  } catch {
    return { status: 'invalid', merged: true, repository, default_branch: defaultBranch };
  }
  if (!binding || typeof binding.repository !== 'string' || binding.repository.toLowerCase() !== repository.toLowerCase()) {
    return { status: 'invalid', merged: true, repository, default_branch: defaultBranch };
  }
  return {
    status: binding.governance === 'enabled' ? 'enabled' : 'disabled',
    merged: true,
    repository,
    default_branch: defaultBranch,
  };
}

function parseProgrammeReports(output) {
  const text = String(output || '');
  const reports = [];
  let index = 0;
  while (index < text.length) {
    while (/\s/.test(text[index] || '')) index += 1;
    if (index >= text.length) break;
    if (text[index] !== '{') return null;
    const start = index;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          let parsed;
          try { parsed = JSON.parse(text.slice(start, index + 1)); } catch { return null; }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
          reports.push(parsed);
          index += 1;
          break;
        }
      }
    }
    if (depth !== 0 || quoted) return null;
  }
  return reports.length ? reports : null;
}

function executeProgrammeCli({ root = process.cwd(), token, cliEntry = path.join(root, 'skills', 'github-program-reconciler', 'scripts', 'programme.cjs'),
  args = ['refresh', '--json'], spawn = spawnSync, environment = process.env } = {}) {
  if (typeof token !== 'string' || token.trim() === '' || typeof cliEntry !== 'string' || !Array.isArray(args)) {
    return { status: 1, error_code: 'INVALID_INPUT' };
  }
  const childEnvironment = { ...environment, GH_TOKEN: token, TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1' };
  delete childEnvironment.GITHUB_TOKEN;
  delete childEnvironment.TOOLKIT_GOVERNANCE_TOKEN;

  let child;
  try {
    child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: root,
      env: childEnvironment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch {
    return { status: 1, error_code: 'EXEC_FAILED' };
  }

  const errorCodeMatch = /^([A-Z][A-Z0-9_]{0,63}):/.exec(String(child.stderr || '').trimStart());
  const errorCode = child.error ? 'EXEC_FAILED' : (errorCodeMatch ? errorCodeMatch[1] : null);
  const reports = parseProgrammeReports(child.stdout);
  const report = reports ? reports[reports.length - 1] : null;
  if (child.error) return { status: 1, error_code: errorCode || 'EXEC_FAILED' };
  if (child.status === 0) return report ? { status: 0, report } : { status: 1, error_code: 'INVALID_REPORT' };
  if (child.status === 1 && errorCode !== 'GH_AUTH' && report && Array.isArray(report.holds) && report.holds.length > 0) {
    return { status: 1, error_code: 'RESUMABLE_HOLD', report };
  }
  return { status: 1, error_code: errorCode || 'REFRESH_FAILED' };
}

function isVerifiedEnabled(verification, env) {
  return Boolean(verification && verification.status === 'enabled' && verification.merged === true
    && verification.repository === env.GITHUB_REPOSITORY
    && verification.default_branch === env.DEFAULT_BRANCH
    && env.GITHUB_REF === `refs/heads/${env.DEFAULT_BRANCH}`);
}

function metricsSummary(report, token) {
  if (!report || typeof report.metrics !== 'string' || !METRICS.test(report.metrics)
      || report.metrics.includes(token) || !Number.isSafeInteger(report.queue_left) || report.queue_left < 0
      || (report.holds !== undefined && !Array.isArray(report.holds))) return null;
  const summary = `Programme Sweep metrics: ${report.metrics}; queue left: ${report.queue_left}`;
  return Array.isArray(report.holds) && report.holds.length > 0
    ? `${summary}; pass held, next hourly run will retry`
    : summary;
}

function summaryForReport(report, token) {
  if (report && report.outcome === 'QUEUED') return QUEUED_SUMMARY;
  return metricsSummary(report, token);
}

function writeNoticeAnnotation(message, output = process.stdout) {
  output.write(`::notice::${message}\n`);
}

function appendGithubSummary(line, env = process.env, appendFile = fs.appendFileSync) {
  if (typeof env.GITHUB_STEP_SUMMARY !== 'string' || !path.isAbsolute(env.GITHUB_STEP_SUMMARY)
      || typeof line !== 'string' || line.includes('\n') || line.includes('\r')) throw new Error('summary output is unavailable');
  appendFile(env.GITHUB_STEP_SUMMARY, `${line}\n`, { encoding: 'utf8' });
}

class ProgrammeSweepAction {
  #env;
  #root;
  #verifyMergedGovernance;
  #runProgrammeCli;
  #writeNotice;
  #writeFailure;
  #writeSummary;

  constructor({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd(),
    verifyMergedGovernance = () => readMergedGovernance({ root, env }),
    runProgrammeCli = input => executeProgrammeCli({ ...input, root }),
    writeNotice = message => writeNoticeAnnotation(message),
    writeFailure = message => process.stderr.write(`${message}\n`),
    writeSummary = line => appendGithubSummary(line, env),
  } = {}) {
    this.#env = env;
    this.#root = root;
    this.#verifyMergedGovernance = verifyMergedGovernance;
    this.#runProgrammeCli = runProgrammeCli;
    this.#writeNotice = writeNotice;
    this.#writeFailure = writeFailure;
    this.#writeSummary = writeSummary;
  }

  async run() {
    let verification;
    try {
      verification = await this.#verifyMergedGovernance({ root: this.#root, env: this.#env });
    } catch {
      this.#writeNotice(MISSING_GOVERNANCE_NOTICE);
      return 0;
    }
    if (!isVerifiedEnabled(verification, this.#env)) {
      this.#writeNotice(MISSING_GOVERNANCE_NOTICE);
      return 0;
    }

    const token = this.#env.GH_TOKEN;
    if (typeof token !== 'string' || token.trim() === '') {
      this.#writeNotice(MISSING_SECRET_NOTICE);
      return 0;
    }

    let result;
    try {
      result = await this.#runProgrammeCli({
        root: this.#root,
        token,
        cliEntry: path.join(this.#root, 'skills', 'github-program-reconciler', 'scripts', 'programme.cjs'),
        args: ['refresh', '--json'],
      });
    } catch {
      this.#writeFailure(GENERAL_FAILURE);
      return 1;
    }
    const resumableHold = result && result.status === 1 && result.error_code === 'RESUMABLE_HOLD'
      && Array.isArray(result.report && result.report.holds) && result.report.holds.length > 0;
    if (!result || (result.status !== 0 && !resumableHold)) {
      this.#writeFailure(result && result.error_code === 'GH_AUTH' ? REJECTED_SECRET_FAILURE : GENERAL_FAILURE);
      return 1;
    }

    const summary = summaryForReport(result.report, token);
    if (!summary) {
      this.#writeFailure(SUMMARY_FAILURE);
      return 1;
    }
    try {
      this.#writeSummary(summary);
    } catch {
      this.#writeFailure(SUMMARY_FAILURE);
      return 1;
    }
    return 0;
  }
}

function createProgrammeSweepAction(dependencies = {}) {
  return new ProgrammeSweepAction(dependencies);
}

async function main() {
  const action = createProgrammeSweepAction();
  process.exitCode = await action.run();
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(`${GENERAL_FAILURE}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  SECRET_NAME,
  readMergedGovernance,
  parseProgrammeReports,
  executeProgrammeCli,
  metricsSummary,
  summaryForReport,
  writeNoticeAnnotation,
  ProgrammeSweepAction,
  createProgrammeSweepAction,
});
