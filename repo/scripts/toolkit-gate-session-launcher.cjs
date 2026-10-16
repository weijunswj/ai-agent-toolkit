'use strict';

// Thin launcher between a GateAssignment and the supported Claude Code CLI.
// The registry binding supplies model and effort; the gate decides whether a
// session may start, resume or continue. A retired, submitted or interrupted
// session is refused here before any native process is started, so retirement
// holds even if a caller tries to resume the native session directly.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { GateAssignment } = require('./toolkit-v3-lifecycle.cjs');
const { CapturedStackBinding } = require('./toolkit-stack-selection.cjs');
const { claudeNativeModel } = require('./toolkit-v3-native-helper-adapter.cjs');

function fail(code) { throw Object.assign(new Error(code), { code }); }
const ROLE_ROUTE = Object.freeze({ G0: 'DISCOVERY', G1: 'BUILDER' });
// Route-affecting native flags come only from the pinned registry binding. A caller may add
// other supported flags, but never a conflicting model, effort, fallback model or main agent.
const ROUTE_FLAGS = Object.freeze(['--model', '--effort', '--fallback-model', '--agent']);
function confinedArgs(args) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) fail('LAUNCHER_ARGS_INVALID');
  if (args.some(a => ROUTE_FLAGS.some(flag => a === flag || a.startsWith(`${flag}=`)))) fail('LAUNCHER_ROUTE_OVERRIDE_REFUSED');
  return [...args];
}

function defaultClaude() {
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return process.platform === 'win32' && fs.existsSync(exe) ? exe : 'claude';
}

class GateSessionLauncher {
  #binding; #role; #claude; #spawn; #baseArgs;
  constructor({ captured, role, claude = defaultClaude(), spawn = spawnSync, base_args = [] }) {
    if (!ROLE_ROUTE[role]) fail('LAUNCHER_ROLE_UNSUPPORTED');
    this.#binding = new CapturedStackBinding(captured);
    this.#role = role; this.#claude = claude; this.#spawn = spawn;
    this.#baseArgs = confinedArgs(base_args);
  }

  // The concrete native model and effort for this role, from the pinned registry only.
  get route() {
    const { route } = this.#binding.role(ROLE_ROUTE[this.#role]);
    return { model: claudeNativeModel(route), effort: route.reasoning, registry_digest: this.#binding.sourceDigest };
  }

  #run(args, cwd, env, expectedModel) {
    const started = Date.now();
    const r = this.#spawn(this.#claude, args, { cwd, env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
    const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const init = lines.find(l => l.type === 'system' && l.subtype === 'init') || {};
    // A run that waits on a background helper emits one result per resumed turn;
    // only the last one is terminal, so earlier ones are never reported. A run with
    // no terminal result has not shown completion and is reported as an error.
    const terminal = lines.findLast(l => l.type === 'result');
    const result = terminal || {};
    // The native init event reports the model that actually ran; a different or missing
    // model is not success even when the process exits cleanly.
    const routeObserved = init.model === expectedModel;
    return { exit: r.status, elapsed_ms: Date.now() - started, native_session_id: init.session_id || null, model: init.model || null,
      route_observed: routeObserved, terminal_result: Boolean(terminal), result_text: typeof result.result === 'string' ? result.result : null,
      is_error: !terminal || result.is_error === true || !routeObserved,
      cost_usd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null, raw: r.stdout || '' };
  }

  // Starts a fresh native session for a session the gate has just launched.
  start(gate, { session_id, prompt, cwd, env = process.env, extra_args = [] }) {
    if (!(gate instanceof GateAssignment) || gate.value.role !== this.#role) fail('LAUNCHER_GATE_ROLE_MISMATCH');
    const session = gate.assertExecutable(session_id);
    if (session.history.length !== 1 || session.history[0].event !== 'LAUNCH') fail('LAUNCHER_SESSION_NOT_FRESH');
    const extra = confinedArgs(extra_args), { model, effort } = this.route;
    const nativeId = GateSessionLauncher.nativeSessionId(gate, session_id);
    return { native_session_id: nativeId, ...this.#run(['-p', prompt, '--session-id', nativeId, '--model', model, '--effort', effort,
      ...this.#baseArgs, ...extra, '--output-format', 'stream-json', '--verbose'], cwd, env, model) };
  }

  // Resumes the same native session only while the gate keeps it executable,
  // for example after an owner reply returns it from WAITING_OWNER to ACTIVE.
  resume(gate, { session_id, prompt, cwd, env = process.env, extra_args = [] }) {
    if (!(gate instanceof GateAssignment) || gate.value.role !== this.#role) fail('LAUNCHER_GATE_ROLE_MISMATCH');
    gate.assertExecutable(session_id);
    const extra = confinedArgs(extra_args), { model, effort } = this.route;
    const nativeId = GateSessionLauncher.nativeSessionId(gate, session_id);
    return { native_session_id: nativeId, ...this.#run(['-p', prompt, '--resume', nativeId, '--model', model, '--effort', effort,
      ...this.#baseArgs, ...extra, '--output-format', 'stream-json', '--verbose'], cwd, env, model) };
  }

  // Native session identity is derived from the gate assignment and gate session,
  // so a launcher cannot attach an unrelated native transcript to the gate.
  static nativeSessionId(gate, sessionId) {
    const h = crypto.createHash('sha256').update(`${gate.value.assignment_id}\0${sessionId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
}

module.exports = Object.freeze({ GateSessionLauncher });
