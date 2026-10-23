'use strict';
// Claude Code native qualification for the named-helper path (the one setup installs).
//
// Runs the launch matrix (repo/tests/support/claude-helper-matrix.cjs) against a real host:
//   hook rows  the plugin's own hook command as a process, with recorded stdin, in a scratch
//              governed repository; a denied launch never reaches a model.
//   live rows  (--host) real `claude -p` sessions in that scratch repository. Served model and
//              effort come from Claude Code's run records (the subagent transcript's
//              `message.model`, `effort` and `perTurnEffort`, and its `.meta.json`), never from
//              what a model says about itself.
//
// Modes:
//   --mode plugin     (default) user settings are skipped; the plugin under test is loaded with
//                     --plugin-dir and the rendered helpers are written to the scratch project's
//                     `.claude/agents`. Nothing in the user's Claude setup is read or changed.
//   --mode installed  the user's own settings, installed plugin and installed helpers are used
//                     unchanged, so the result covers that machine as it is.
//
// Output: <out>/verdicts.json (one verdict per case, with host version, hook hash and registry
// hash) and, for live rows, one folder per run holding the stream output, the hook decision log and
// a privacy-minimised summary of the run records (model, effort and agent type only; no prompt or
// reply text). The scratch repository, and the run records Claude Code wrote for it, are removed
// at the end. Results are evidence; this file is not part of CI.
//
// Usage: node repo/tests/qualification/claude-helper-matrix.live.cjs --out <dir> [--host]
//          [--mode plugin|installed] [--plugin-root <dir>] [--max-budget-usd <n>] [--only <row,...>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const matrix = require('../support/claude-helper-matrix.cjs');
const sessionAgents = require('../../scripts/toolkit-claude-session-agents.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const REGISTRY = path.join(ROOT, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v3.json');
// Limits that are recorded, not failed: the host gives Toolkit no way to enforce them.
const KNOWN_LIMITS = Object.freeze({
  A14: 'A session started with its own --agents copy of a Toolkit helper is not route-enforced by the hook: no hook can see session definitions. Toolkit launchers refuse such a launch with toolkit-claude-session-agents.cjs.',
});
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function parseArgs(argv) {
  const options = { host: false, mode: 'plugin', pluginRoot: ROOT, maxBudgetUsd: '1', only: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i], value = () => { if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`); return argv[++i]; };
    if (flag === '--host') options.host = true;
    else if (flag === '--mode') options.mode = value();
    else if (flag === '--plugin-root') options.pluginRoot = path.resolve(value());
    else if (flag === '--max-budget-usd') options.maxBudgetUsd = value();
    else if (flag === '--only') options.only = new Set(value().split(','));
    else if (flag === '--out') options.out = path.resolve(value());
    else throw new Error(`unknown option ${flag}`);
  }
  if (!options.out) throw new Error('--out <dir> is required');
  if (!['plugin', 'installed'].includes(options.mode)) throw new Error('--mode is plugin or installed');
  if (!/^\d+(\.\d+)?$/.test(options.maxBudgetUsd)) throw new Error('--max-budget-usd takes a number');
  return options;
}

// On Windows the npm `claude` is a .cmd shim; run the native executable so arguments pass verbatim.
const CLAUDE = (() => {
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return process.platform === 'win32' && fs.existsSync(exe) ? exe : 'claude';
})();
function hostVersion() { const r = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8' }); return (r.stdout || '').trim() || null; }
function git(args) { const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }

// The pinned helper route as the rendered definition states it.
function pinnedRoute(definitionText) {
  const field = name => new RegExp(`^${name}: (\\S+)$`, 'm').exec(definitionText)?.[1] || null;
  return { model: field('model'), effort: field('effort') };
}

// Claude Code keeps a session's records under <config>/projects/<folder>/<session id>; the folder
// name is derived from the working directory, so search for the session id instead of rebuilding it.
function sessionRecords(configDir, sessionId) {
  const projects = path.join(configDir, 'projects');
  if (!fs.existsSync(projects)) return null;
  for (const folder of fs.readdirSync(projects)) {
    const transcript = path.join(projects, folder, `${sessionId}.jsonl`);
    if (fs.existsSync(transcript)) return { folder: path.join(projects, folder), transcript, subagents: path.join(projects, folder, sessionId, 'subagents') };
  }
  return null;
}

// Model and effort per assistant turn, plus the agent metadata; no message text.
function turnSummary(file) {
  const turns = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'assistant' || !record.message?.model) continue;
    turns.push({ model: record.message.model, effort: record.effort ?? null, per_turn_effort: record.perTurnEffort ?? null,
      requested_model: record.requestedModel ?? null, version: record.version ?? null });
  }
  return turns;
}

function runRecords(configDir, sessionId) {
  const found = sessionRecords(configDir, sessionId);
  if (!found) return { found: false, lead: [], helpers: [] };
  const helpers = [];
  if (fs.existsSync(found.subagents)) {
    for (const name of fs.readdirSync(found.subagents).filter(n => /^agent-.*\.jsonl$/.test(n))) {
      const metaFile = path.join(found.subagents, name.replace(/\.jsonl$/, '.meta.json'));
      let meta = null; try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* recorded as missing */ }
      helpers.push({ agent_type: meta?.agentType ?? null, spawn_depth: meta?.spawnDepth ?? null, turns: turnSummary(path.join(found.subagents, name)) });
    }
  }
  return { found: true, folder: found.folder, lead: turnSummary(found.transcript), helpers };
}

class LiveRun {
  constructor(options, context, configDir, recordFolders) {
    this.options = options; this.context = context; this.configDir = configDir; this.recordFolders = recordFolders;
  }

  // Plugin mode runs on the scratch context; installed mode keeps this machine's own environment.
  #environment(decisions) {
    if (this.options.mode === 'installed') return { ...process.env, TOOLKIT_HOOK_DECISION_LOG: decisions };
    const environment = { ...this.context.environment, TOOLKIT_HOOK_DECISION_LOG: decisions };
    // The scratch config folder only holds helper definitions; the session signs in with the real one.
    delete environment.CLAUDE_CONFIG_DIR;
    return environment;
  }

  run(label, prompt, { agents = null } = {}) {
    const dir = path.join(this.options.out, 'runs', label);
    fs.mkdirSync(dir, { recursive: true });
    const sessionId = crypto.randomUUID();
    const decisions = path.join(dir, 'hook-decisions.ndjson');
    const args = ['-p', prompt, '--session-id', sessionId, '--model', 'claude-opus-5-5', '--effort', 'high', '--output-format', 'stream-json',
      '--verbose', '--strict-mcp-config', '--tools', 'Agent', '--allowedTools', 'Agent', '--max-budget-usd', this.options.maxBudgetUsd];
    if (this.options.mode === 'plugin') args.push('--setting-sources', 'project,local', '--plugin-dir', this.options.pluginRoot);
    if (agents) { const file = path.join(dir, 'agents.json'); fs.writeFileSync(file, JSON.stringify(agents)); args.push('--agents', file); }
    const environment = this.#environment(decisions);
    const started = Date.now();
    const r = spawnSync(CLAUDE, args, { cwd: this.context.repo, env: environment, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(dir, 'stream.ndjson'), r.stdout || '');
    const lines = (r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const calls = lines.flatMap(l => (l.message?.content || []).filter(c => c.type === 'tool_use' && c.name === 'Agent')
      .map(c => ({ subagent_type: c.input?.subagent_type ?? null, model: c.input?.model ?? null, effort: c.input?.effort ?? null })));
    const final = lines.find(l => l.type === 'result') || {};
    const hookDecisions = fs.existsSync(decisions) ? fs.readFileSync(decisions, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : [];
    const records = runRecords(this.configDir, sessionId);
    const summary = { label, session_id: sessionId, exit: r.status, elapsed_ms: Date.now() - started, agent_calls: calls,
      hook_decisions: hookDecisions.map(d => ({ subagent_type: d.subagent_type, decision: d.decision, reason: d.reason })),
      result_subtype: final.subtype ?? null, cost_usd: final.total_cost_usd ?? null, lead_turns: records.lead, helpers: records.helpers,
      records_found: records.found, stderr_tail: (r.stderr || '').slice(-600) };
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    if (records.folder) this.recordFolders.add(records.folder);
    return summary;
  }
}

// Every helper turn ran on the pinned model and effort, and at least one helper turn exists.
function servedOnPin(summary, agentType, pin) {
  const helpers = summary.helpers.filter(h => h.agent_type === agentType);
  const turns = helpers.flatMap(h => h.turns);
  return helpers.length > 0 && turns.length > 0 && turns.every(t => t.model === pin.model && t.effort === pin.effort && t.per_turn_effort === pin.effort);
}
const leadOnRoute = summary => summary.lead_turns.length > 0 && summary.lead_turns.every(t => t.model === 'claude-opus-5-5' && t.effort === 'high');

function liveCases(live, context) {
  const g0 = pinnedRoute(context.definitions.G0.text), g1 = pinnedRoute(context.definitions.G1.text);
  const ask = name => `Use the Agent tool exactly once with subagent_type "${name}" and prompt "Reply with exactly HELPER-OK and nothing else." Do not pass a model or effort. Then reply with the helper's answer.`;
  return [
    ['A1', 'G0 helper runs on its pinned route (headless lead)', () => {
      const s = live.run('a1-g0-helper', ask('toolkit-g0-helper'));
      return { observed: s, pass: s.exit === 0 && servedOnPin(s, 'toolkit-g0-helper', g0) && leadOnRoute(s) && s.hook_decisions.every(d => d.decision !== 'deny') };
    }],
    ['A2', 'G1 helper runs on its pinned route (headless lead)', () => {
      const s = live.run('a2-g1-helper', ask('toolkit-g1-helper'));
      return { observed: s, pass: s.exit === 0 && servedOnPin(s, 'toolkit-g1-helper', g1) && leadOnRoute(s) };
    }],
    ['A6', 'the call carried no model or effort and the definition supplied them', () => {
      const s = live.run('a6-omitted-fields', ask('toolkit-g0-helper'));
      return { observed: s, pass: s.agent_calls.length > 0 && s.agent_calls.every(c => c.model === null && c.effort === null) && servedOnPin(s, 'toolkit-g0-helper', g0) };
    }],
    ['A7', 'a call that names a model is refused before any helper inference', () => {
      const s = live.run('a7-model-override', 'Use the Agent tool exactly once with subagent_type "toolkit-g1-helper", model "opus", and prompt "Reply HELPER-OK". If the tool is blocked, reply BLOCKED.');
      return { observed: s, pass: s.hook_decisions.some(d => d.decision === 'deny') && s.helpers.every(h => h.turns.length === 0) };
    }],
    ['A14', 'a session --agents definition with a Toolkit name does not run off-route', () => {
      const agents = { 'toolkit-g0-helper': { description: 'session copy', prompt: 'Reply HELPER-OK.', model: 'claude-opus-5-5', effort: 'low' } };
      // A Toolkit launcher runs this check first and would not start the session.
      const launcher = sessionAgents.checkClaudeArguments(['--agents', JSON.stringify(agents)], { stack: 'owner-claude', toolkitRoot: ROOT });
      const s = { ...live.run('a14-session-agents', ask('toolkit-g0-helper'), { agents }), launcher_check: launcher };
      // Known limit: no hook input carries session definitions and SubagentStart cannot block, so a
      // session started with its own --agents copy of a Toolkit helper is not route-enforced. The row
      // records what ran; it passes only if no helper turn ran off the pin.
      const onPin = s.helpers.flatMap(h => h.turns).every(t => t.model === g0.model && t.effort === g0.effort);
      return { observed: s, pass: onPin, limit: onPin ? null : launcher.refused ? KNOWN_LIMITS.A14 : `${KNOWN_LIMITS.A14} The launcher check did not refuse it either.` };
    }],
    ['A16', 'no helper requested: no agent call, no hook decision, no helper records', () => {
      const s = live.run('a16-no-helper', 'Reply with exactly NO-HELPER. Do not use any tools.');
      return { observed: s, pass: s.exit === 0 && s.agent_calls.length === 0 && s.hook_decisions.length === 0 && s.helpers.length === 0 };
    }],
    ['A26', 'headless lead and helper both on their routes, from run records', () => {
      const s = live.run('a26-headless', ask('toolkit-g1-helper'));
      return { observed: s, pass: s.exit === 0 && s.result_subtype === 'success' && leadOnRoute(s) && servedOnPin(s, 'toolkit-g1-helper', g1) };
    }],
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.out, { recursive: true });
  const hook = path.join(options.pluginRoot, 'repo', 'scripts', 'toolkit-claude-agent-hook.cjs');
  if (!fs.existsSync(hook)) throw new Error(`no agent hook under ${options.pluginRoot}`);
  const context = new matrix.ClaudeMatrixContext();
  const verdicts = [];
  const wanted = row => !options.only || options.only.has(row);
  const recordFolders = new Set();
  try {
    const timings = [];
    for (const entry of matrix.HOOK_CASES.filter(([row]) => wanted(row))) {
      const verdict = matrix.runHookCase(context, entry, { hook });
      if (verdict.observed) timings.push(verdict.observed.elapsed_ms);
      verdicts.push({ kind: 'hook', ...verdict });
    }
    if (options.host) {
      const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
      if (options.mode === 'plugin') {
        // Project agents outrank the user's, so the session loads the rendered helpers from here.
        const agents = path.join(context.repo, '.claude', 'agents');
        fs.mkdirSync(agents, { recursive: true });
        for (const { file, text } of Object.values(context.definitions)) fs.writeFileSync(path.join(agents, file), text);
      }
      const live = new LiveRun(options, context, configDir, recordFolders);
      for (const [row, name, run] of liveCases(live, context).filter(([row]) => wanted(row))) {
        const { observed, pass, limit } = run();
        verdicts.push({ kind: 'live', row, case: name, observed, pass: limit ? null : pass, ...(limit ? { known_limit: limit } : {}) });
      }
    }
    const sorted = [...timings].sort((a, b) => a - b);
    const report = { schema: 'toolkit.qualification.claude-helper-matrix.v1', host: 'claude-code', host_version: hostVersion(), mode: options.mode,
      host_runs: options.host, plugin_root: options.pluginRoot, hook_sha256: sha256(hook), registry_sha256: sha256(REGISTRY),
      candidate_head: git(['rev-parse', 'HEAD']), candidate_dirty: (git(['status', '--porcelain']) || '') !== '', at: new Date().toISOString(),
      hook_process_ms: sorted.length ? { median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] } : null,
      not_run_here: Object.fromEntries(Object.entries(matrix.OTHER_ROWS).filter(([, e]) => e.proof !== 'live')),
      verdicts, passed: verdicts.filter(v => v.pass === true).length, failed: verdicts.filter(v => v.pass === false).length,
      skipped: verdicts.filter(v => v.pass === null && !v.known_limit).length,
      known_limits: verdicts.filter(v => v.known_limit).map(v => ({ row: v.row, limit: v.known_limit })) };
    report.result = report.failed === 0 && report.passed > 0 ? 'PASS' : 'FAIL';
    fs.writeFileSync(path.join(options.out, 'verdicts.json'), JSON.stringify(report, null, 2));
    console.log(`${report.result} passed=${report.passed} failed=${report.failed} skipped=${report.skipped} known_limits=${report.known_limits.length} host=${report.host_version}`);
    for (const v of verdicts.filter(x => x.pass === false)) console.log('FAILED', v.row, v.case);
  } finally {
    context.remove();
    // Only folders Claude Code created for this run's scratch repository; the folder name derives from its path.
    for (const folder of recordFolders) if (path.basename(folder).includes(path.basename(context.base))) fs.rmSync(folder, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = Object.freeze({ parseArgs, pinnedRoute, turnSummary, runRecords, servedOnPin, KNOWN_LIMITS });
