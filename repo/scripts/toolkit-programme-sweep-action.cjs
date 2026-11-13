'use strict';

// The steps of the Toolkit Programme Sweep workflow (.github/workflows/toolkit-programme-sweep.yml).
//
// `store` runs before any token is minted. It reads the binding this run checked out and names the
// evidence store for the store token. It ends with a notice and nothing else (exit 0) when the
// repository is not governed, the store has another owner, or the state lives on a public branch,
// which this cloud sweep does not run yet: the computer's sweep stays for such a repository.
//
// `refresh` runs `programme.cjs refresh` with the two installation tokens the workflow minted. With
// no App configured it prints a notice and exits 0. A failed sign-in fails the job with a fixed
// message naming the App's variable and secret. Any other failure names the CLI's stop code and the
// HTTP status of a failed GitHub request, when there is one; GitHub's own error text, tokens and keys
// are never printed. The job summary gets the pass's metrics line. When the pass stopped early and
// read something, `follow_up_at` (milliseconds) tells the workflow's follow-up job when to start the
// next run: once GitHub's hourly App limit has reset, or at once after the pass's time limit.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLIENT_ID_VARIABLE = 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID';
const PRIVATE_KEY_SECRET = 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY';
const BINDING_PATH = Object.freeze(['.github', 'toolkit-programme.json']);
const BINDING_LIMIT = 64 * 1024;
// The scheduled pass's own kill; the workflow stops the job three minutes after it.
const { RESET_WAIT_MS } = require('./toolkit-programme-sweep-gate.cjs');
const RUN_TIMEOUT_MS = require('../../skills/github-program-reconciler/scripts/programme-state.cjs').PASS_BUDGETS.scheduled.killMs;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BOT_LOGIN = /^[A-Za-z0-9-]{1,100}\[bot\]$/;
const METRICS = /^[A-Za-z0-9_ =,.:/()-]{1,500}$/;
const NOTICES = Object.freeze({
  ungoverned: 'Programme Sweep skipped: this repository has no enabled programme binding on the commit this run checked out.',
  foreign_store: 'Programme Sweep skipped: the evidence store belongs to another owner, so one governance App cannot reach it.',
  public_state: 'Programme Sweep skipped: this repository keeps its state on a public branch; the cloud sweep does not run it yet, so the computer\'s sweep stays.',
  no_app: `Programme Sweep skipped: the governance GitHub App is not set up here. Set the repository variable ${CLIENT_ID_VARIABLE} and the secret ${PRIVATE_KEY_SECRET}; toolkit governance check lists what the App needs.`,
  main_moved: 'Programme Sweep skipped: the default branch moved while this run was starting; the next run picks it up.',
  queued: 'Programme Sweep queued: another sweep is running; the next hourly run will retry.',
  paused: 'Programme Sweep paused: GitHub\'s hourly App limit for this repository is at the safety margin, so this pass read nothing; the next run picks up where the last one stopped.',
});
const SIGN_IN_FAILURE = `Programme Sweep failed: the governance GitHub App could not sign in. Check ${CLIENT_ID_VARIABLE} and ${PRIVATE_KEY_SECRET}: the App may not be installed on this repository or its evidence store, or the key was revoked.`;
const GENERAL_FAILURE = 'Programme Sweep failed. Open this workflow run and toolkit governance check for the cause.';
const SUMMARY_FAILURE = 'Programme Sweep could not write its metrics summary.';

// The binding this run checked out: { status, store } with status enabled, ungoverned, foreign_store or public_state.
function readCheckedOutBinding({ root, env, readFile = fs.readFileSync, validateBinding }) {
  const repository = env.GITHUB_REPOSITORY;
  if (!SAFE_REPOSITORY.test(repository || '')) return { status: 'ungoverned' };
  let bytes;
  try { bytes = readFile(path.join(root, ...BINDING_PATH)); } catch { return { status: 'ungoverned' }; }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  if (buffer.length > BINDING_LIMIT) return { status: 'ungoverned' };
  let binding;
  try { binding = validateBinding(JSON.parse(buffer.toString('utf8'))); } catch { return { status: 'ungoverned' }; }
  if (binding.governance !== 'enabled' || String(binding.repository).toLowerCase() !== repository.toLowerCase()) return { status: 'ungoverned' };
  if (binding.state) return { status: 'public_state' };
  const store = String(binding.store?.repository || '');
  if (!SAFE_REPOSITORY.test(store) || store.split('/')[0].toLowerCase() !== repository.split('/')[0].toLowerCase()) return { status: 'foreign_store' };
  return { status: 'enabled', store };
}

// The last JSON report the CLI printed, or null.
function lastReport(output) {
  const text = String(output || '').trim();
  for (let at = text.lastIndexOf('\n{'); ; at = text.lastIndexOf('\n{', at - 1)) {
    try { const value = JSON.parse(text.slice(at + 1)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
    catch { if (at < 0) return null; }
  }
}

// Runs the CLI without a shell. Only the two tokens, the App's login and the store reach it; the
// built-in token, the private key and any other token variable are removed.
function runRefresh({ root, env, spawn = spawnSync }) {
  const child = { ...env, TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', GITHUB_ACTIONS: 'true' };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', PRIVATE_KEY_SECRET, 'TOOLKIT_GOVERNANCE_TOKEN']) delete child[name];
  let result;
  try {
    result = spawn(process.execPath, [path.join(root, 'skills', 'github-program-reconciler', 'scripts', 'programme.cjs'), 'refresh', '--scheduled', '--json'],
      { cwd: root, env: child, encoding: 'utf8', windowsHide: true, timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, shell: false });
  } catch { return { code: 'EXEC_FAILED', report: null, status: 1 }; }
  if (!result || result.error) return { code: 'EXEC_FAILED', report: null, status: 1 };
  const first = String(result.stderr || '').trimStart().split('\n')[0];
  const code = /^([A-Z][A-Z0-9_]{0,63}):/.exec(first)?.[1] || null;
  // Only the HTTP status number of a failed GitHub request is kept, never GitHub's own text.
  const http = code ? /\(([1-5][0-9]{2})\)/.exec(first)?.[1] || null : null;
  return { code, http, report: lastReport(result.stdout), status: result.status };
}

// The general failure, naming the stop code and HTTP status when the CLI gave them, so a failed run
// shows its cause without GitHub's own text.
function failureLine(result) {
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(result?.code || '') ? result.code : null;
  if (!code) return GENERAL_FAILURE;
  const http = /^[1-5][0-9]{2}$/.test(result?.http || '') ? `, HTTP ${result.http}` : '';
  return GENERAL_FAILURE.replace('Programme Sweep failed.', `Programme Sweep failed (${code}${http}).`);
}

function summaryLine(report) {
  if (report?.outcome === 'QUEUED') return NOTICES.queued;
  if (report?.outcome === 'PAUSED') return NOTICES.paused;
  if (!report || typeof report.metrics !== 'string' || !METRICS.test(report.metrics)) return null;
  const held = Array.isArray(report.holds) && report.holds.length ? '; this pass held, the next run retries' : '';
  return `Programme Sweep: ${report.metrics}${held}`;
}

// When the next run should start after this pass, or 0 when the hourly start is enough. Only a pass
// that read something and left tasks follows up, so a pass that cannot make progress never loops.
function followUpAt(report, started, now) {
  const sweep = report?.sweep;
  if (!sweep || !(sweep.left > 0) || !(sweep.read > 0)) return 0;
  if (sweep.reason === 'GitHub rate limit') return started + RESET_WAIT_MS;
  if (sweep.reason === 'time limit') return now;
  return 0;
}

class ProgrammeSweepAction {
  constructor({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd(), readFile = fs.readFileSync,
    validateBinding = binding => require(path.join(root, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs')).validateBinding(binding),
    refresh = input => runRefresh(input), notice = message => process.stdout.write(`::notice::${message}\n`),
    failure = message => process.stderr.write(`${message}\n`), output = (name, value) => fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`),
    summary = line => fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`), now = () => Date.now() } = {}) {
    Object.assign(this, { env, root, readFile, validateBinding, refresh, notice, failure, output, summary, now });
  }

  // Step one: the store to mint a token for, or a notice and nothing more.
  store() {
    const binding = readCheckedOutBinding({ root: this.root, env: this.env, readFile: this.readFile, validateBinding: this.validateBinding });
    if (binding.status !== 'enabled') { this.notice(NOTICES[binding.status]); this.output('store', ''); return 0; }
    this.output('store', binding.store.split('/')[1]);
    this.output('store_repository', binding.store);
    return 0;
  }

  // Step two: the refresh under the minted tokens.
  run() {
    const env = this.env;
    if (!env.STORE_REPOSITORY) return 0;
    if (!env.APP_CLIENT_ID_SET || env.APP_CLIENT_ID_SET === 'false') { this.notice(NOTICES.no_app); return 0; }
    if (env.MINT_OUTCOME !== 'success/success' || !env.GOVERNED_TOKEN || !env.STORE_TOKEN || !BOT_LOGIN.test(env.SWEEP_LOGIN || '')) {
      this.failure(SIGN_IN_FAILURE); return 1;
    }
    const started = this.now();
    let result;
    try { result = this.refresh({ root: this.root, env }); } catch { this.failure(GENERAL_FAILURE); return 1; }
    if (result.code === 'GH_AUTH') { this.failure(SIGN_IN_FAILURE); return 1; }
    if (result.code === 'MAIN_MOVED' || result.code === 'CLOUD_PUBLIC_STATE') { this.notice(result.code === 'MAIN_MOVED' ? NOTICES.main_moved : NOTICES.public_state); return 0; }
    const held = result.status === 1 && Array.isArray(result.report?.holds) && result.report.holds.length > 0;
    if (result.status !== 0 && !held) { this.failure(failureLine(result)); return 1; }
    const line = summaryLine(result.report);
    // A line that could carry a token is never written.
    if (!line || [env.GOVERNED_TOKEN, env.STORE_TOKEN].some(token => line.includes(token))) { this.failure(SUMMARY_FAILURE); return 1; }
    try { this.summary(line); } catch { this.failure(SUMMARY_FAILURE); return 1; }
    const at = followUpAt(result.report, started, this.now());
    if (at) try { this.output('follow_up_at', String(at)); } catch { /* no follow-up; the hourly start resumes */ }
    return 0;
  }
}

if (require.main === module) {
  const action = new ProgrammeSweepAction();
  try { process.exitCode = process.argv[2] === 'store' ? action.store() : action.run(); }
  catch { process.stderr.write(`${GENERAL_FAILURE}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ CLIENT_ID_VARIABLE, PRIVATE_KEY_SECRET, RUN_TIMEOUT_MS, NOTICES, SIGN_IN_FAILURE, GENERAL_FAILURE, readCheckedOutBinding, lastReport, runRefresh, failureLine, summaryLine, followUpAt, ProgrammeSweepAction });
