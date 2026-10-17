'use strict';

// Thin launcher between a GateAssignment and the supported Claude Code CLI.
// The registry binding supplies model and effort; the gate decides whether a
// session may start, resume or continue. A retired, submitted or interrupted
// session is refused here before any native process is started, so retirement
// holds even if a caller tries to resume the native session directly.

const fs = require('node:fs');
const os = require('node:os');
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

// Effort inputs other than --effort that Claude Code 2.1.x applies to a session, checked
// before any native process starts. CLAUDE_CODE_EFFORT_LEVEL takes precedence over the flag,
// and an effort in CLAUDE_CODE_EXTRA_BODY bypasses client clamps, so a conflicting value in
// either is refused rather than stripped. maxEffortLevel in a selected settings file clamps
// the flag (lowest across files wins; modelSettings.<model>.maxEffortLevel replaces it per
// model, "max" exempts), so a lower applicable clamp is refused too. Claude Code also copies
// the `env` map of every enabled settings source, and of the global config file it selects
// (whatever --setting-sources selects), into its process environment, so the same two
// variables are checked there. Environment names are case-insensitive on Windows, so every
// casing of a name is the same variable there. Managed/MDM, server-delivered settings and an
// organization's per-model cap are not observable here, and the native init event does not
// report effort, so exact effort is reported as not exposed.
const EFFORT_ORDER = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const SETTING_SOURCES = Object.freeze(['user', 'project', 'local']);
const UNOBSERVED_EFFORT_SOURCES = Object.freeze(['managed settings (managed-settings.json, MDM or policy helper)',
  'server-managed settings', 'organization per-model effort cap']);
const CALLER_ENV_REFUSALS = Object.freeze({ level: 'LAUNCHER_ENV_EFFORT_OVERRIDE_REFUSED', body: 'LAUNCHER_ENV_EXTRA_BODY_EFFORT_REFUSED' });
const SETTINGS_ENV_REFUSALS = Object.freeze({ level: 'LAUNCHER_SETTINGS_ENV_EFFORT_OVERRIDE_REFUSED',
  body: 'LAUNCHER_SETTINGS_ENV_EXTRA_BODY_EFFORT_REFUSED' });
class EffortRouteCheck {
  #readFile; #platform;
  constructor(readFile, platform) { this.#readFile = readFile; this.#platform = platform; }

  // Every value an environment map holds for `name`, in each casing the platform treats as that name.
  #values(map, name) {
    return Object.entries(map).filter(([key]) => (this.#platform === 'win32' ? key.toUpperCase() === name : key === name)).map(([, v]) => v);
  }

  // One variable's value, or undefined; differing casings of it are ambiguous on Windows.
  #one(map, name) {
    const values = [...new Set(this.#values(map, name).filter(v => v !== undefined && v !== ''))];
    if (values.length > 1 || values.some(v => typeof v !== 'string')) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    return values[0];
  }

  // Applies the effort rules to one environment map; returns 'EQUAL' or 'ABSENT'. Values are never reported.
  #envEffort(map, effort, refusals) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    const level = this.#one(map, 'CLAUDE_CODE_EFFORT_LEVEL');
    if (level !== undefined && level !== effort) fail(refusals.level);
    const extra = this.#one(map, 'CLAUDE_CODE_EXTRA_BODY');
    if (extra !== undefined) {
      let body;
      try { body = JSON.parse(extra); } catch { fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED'); }
      const visit = value => value && typeof value === 'object' && Object.entries(value)
        .some(([key, child]) => /effort|reasoning|thinking/i.test(key) || visit(child));
      if (visit(body)) fail(refusals.body);
    }
    return level === undefined ? 'ABSENT' : 'EQUAL';
  }

  // A settings object's own `env` map, which must be an object when present.
  #settingsEnv(settings, effort) {
    if (settings === null || settings.env === undefined) return 'ABSENT';
    return this.#envEffort(settings.env, effort, SETTINGS_ENV_REFUSALS);
  }

  static #flagValues(args, flag) {
    const values = [];
    args.forEach((a, i) => {
      if (a === flag) values.push(args[i + 1]);
      else if (a.startsWith(`${flag}=`)) values.push(a.slice(flag.length + 1));
    });
    if (values.some(v => typeof v !== 'string')) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    return values;
  }

  // One settings object's applicable clamp for the model, or null when it sets none.
  static #clamp(settings, model) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    const perModel = Object.entries(settings.modelSettings && typeof settings.modelSettings === 'object' ? settings.modelSettings : {})
      .filter(([key, value]) => (key === model || key.startsWith(`${model}-`) || key.startsWith(`${model}[`))
        && value && typeof value === 'object' && value.maxEffortLevel !== undefined)
      .map(([, value]) => value.maxEffortLevel);
    const values = perModel.length ? perModel : settings.maxEffortLevel === undefined ? [] : [settings.maxEffortLevel];
    if (values.some(v => !EFFORT_ORDER.includes(v))) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    const ranked = values.filter(v => v !== 'max').map(v => EFFORT_ORDER.indexOf(v));
    return ranked.length ? EFFORT_ORDER[Math.min(...ranked)] : null;
  }

  // A file's text, or null when it does not exist; any other read failure holds the launch.
  #readText(file) {
    try { return this.#readFile(file); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    }
  }

  #readSettings(file) {
    const text = this.#readText(file);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED'); }
  }

  // The global config Claude Code 2.1.301 applies: <config home>/.config.json when that is a nonempty
  // file, otherwise .claude.json in CLAUDE_CONFIG_DIR or the home directory. When .claude.json is absent
  // it may instead select a zero-length writable .config.json; which file it then uses is not established
  // here, so that row names the file as UNVERIFIED (neither file carries an env map). A custom OAuth URL
  // changes the fallback file name, which is not modelled here, so it holds rather than guessing the
  // location; a .config.json that cannot be read as a file (a directory, say) holds too.
  #globalConfig(configDir, fallbackDir, env) {
    if (this.#one(env, 'CLAUDE_CODE_CUSTOM_OAUTH_URL') !== undefined) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    const text = this.#readText(path.join(configDir, '.config.json'));
    if (text === null || text === '') {
      const config = this.#readSettings(path.join(fallbackDir, '.claude.json'));
      return { file: text === '' && config === null ? 'UNVERIFIED' : '.claude.json', config };
    }
    try { return { file: '.config.json', config: JSON.parse(text) }; } catch { fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED'); }
  }

  // CLAUDE_CONFIG_DIR as the native process receives it, or undefined when the caller omits it. Claude
  // Code keeps an explicit empty value and resolves a relative one against the spawned session's cwd, so
  // neither names a location checked here; both hold, as does a non-string value. On Windows more than one
  // casing of the name holds even with equal values, since which entry the child reads is not established.
  #configDir(env) {
    const values = this.#values(env, 'CLAUDE_CONFIG_DIR').filter(v => v !== undefined);
    if (values.length === 0) return undefined;
    if (values.length > 1 || typeof values[0] !== 'string' || !this.#absolute(values[0])) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    return values[0];
  }

  // The home directory the native process derives its default config home from, when CLAUDE_CONFIG_DIR is
  // omitted: USERPROFILE on Windows, HOME elsewhere. A present value must be one absolute string, as for
  // CLAUDE_CONFIG_DIR. On Windows a HOME without USERPROFILE holds, since the native home is then not
  // established. An omitted variable uses this process's home directory.
  #homeDir(env) {
    const name = this.#platform === 'win32' ? 'USERPROFILE' : 'HOME';
    const values = this.#values(env, name).filter(v => v !== undefined);
    if (values.length === 0) {
      if (this.#platform === 'win32' && this.#values(env, 'HOME').some(v => v !== undefined)) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
      return os.homedir();
    }
    if (values.length > 1 || typeof values[0] !== 'string' || !this.#absolute(values[0])) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    return values[0];
  }

  // Absolute on the target platform: a drive-letter or UNC path on Windows (a rooted `\dir` or a `C:dir`
  // depends on the child's current drive or directory), a `/` path elsewhere.
  #absolute(dir) {
    return this.#platform === 'win32' ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(dir) : dir.startsWith('/');
  }

  assert({ effort, model, env, cwd, args }) {
    const inherited = this.#envEffort(env, effort, CALLER_ENV_REFUSALS);
    const declared = EffortRouteCheck.#flagValues(args, '--setting-sources');
    const sources = declared.length ? declared.at(-1).split(',').map(s => s.trim()).filter(Boolean) : [...SETTING_SOURCES];
    if (sources.some(s => !SETTING_SOURCES.includes(s))) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    const configOverride = this.#configDir(env);
    // The home directory matters only when no CLAUDE_CONFIG_DIR names the config home.
    const home = configOverride === undefined ? this.#homeDir(env) : null;
    const configDir = configOverride || path.join(home, '.claude');
    const files = { user: path.join(configDir, 'settings.json'), project: path.join(cwd, '.claude', 'settings.json'),
      local: path.join(cwd, '.claude', 'settings.local.json') };
    // The selected global config is read for its `env` map only; nothing else in it is inspected.
    const { file: globalFile, config: legacy } = this.#globalConfig(configDir, configOverride || home, env);
    if (legacy !== null && (typeof legacy !== 'object' || Array.isArray(legacy))) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
    const checked = [{ source: 'legacy-global-config', file: globalFile, present: legacy !== null, clamp: null,
      env_effort: this.#settingsEnv(legacy, effort) }];
    for (const source of sources) {
      const settings = this.#readSettings(files[source]);
      checked.push({ source, present: settings !== null, clamp: settings === null ? null : EffortRouteCheck.#clamp(settings, model),
        env_effort: this.#settingsEnv(settings, effort) });
    }
    for (const value of EffortRouteCheck.#flagValues(args, '--settings')) {
      let settings;
      if (value.trim().startsWith('{')) {
        try { settings = JSON.parse(value); } catch { fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED'); }
      } else settings = this.#readSettings(path.resolve(cwd, value));
      if (settings === null) fail('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED');
      checked.push({ source: '--settings', present: true, clamp: EffortRouteCheck.#clamp(settings, model), env_effort: this.#settingsEnv(settings, effort) });
    }
    const clamps = checked.map(c => c.clamp).filter(Boolean).map(v => EFFORT_ORDER.indexOf(v));
    const clamp = clamps.length ? EFFORT_ORDER[Math.min(...clamps)] : null;
    if (clamp !== null && EFFORT_ORDER.indexOf(clamp) < EFFORT_ORDER.indexOf(effort)) fail('LAUNCHER_EFFORT_CLAMPED');
    return Object.freeze({ pinned_effort: effort, inherited_effort: inherited, setting_sources: sources,
      checked: checked.map(c => Object.freeze(c)), client_clamp: clamp, exact_effort: 'NOT_EXPOSED',
      unobserved_sources: UNOBSERVED_EFFORT_SOURCES });
  }
}

class GateSessionLauncher {
  #binding; #role; #claude; #spawn; #baseArgs; #effort;
  constructor({ captured, role, claude = defaultClaude(), spawn = spawnSync, base_args = [], read_file = file => fs.readFileSync(file, 'utf8'),
    platform = process.platform }) {
    if (!ROLE_ROUTE[role]) fail('LAUNCHER_ROLE_UNSUPPORTED');
    if (typeof read_file !== 'function' || typeof platform !== 'string') fail('LAUNCHER_ARGS_INVALID');
    this.#binding = new CapturedStackBinding(captured);
    this.#role = role; this.#claude = claude; this.#spawn = spawn;
    this.#baseArgs = confinedArgs(base_args);
    this.#effort = new EffortRouteCheck(read_file, platform);
  }

  // The concrete native model and effort for this role, from the pinned registry only.
  get route() {
    const { route } = this.#binding.role(ROLE_ROUTE[this.#role]);
    return { model: claudeNativeModel(route), effort: route.reasoning, registry_digest: this.#binding.sourceDigest };
  }

  #run(args, cwd, env, expectedModel, effortAssurance) {
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
      route_observed: routeObserved, effort_assurance: effortAssurance, terminal_result: Boolean(terminal),
      result_text: typeof result.result === 'string' ? result.result : null,
      is_error: !terminal || result.is_error === true || !routeObserved,
      cost_usd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null, raw: r.stdout || '' };
  }

  // Validates every caller input and the inherited effort route before any native process.
  #prepare(extra_args, env, cwd) {
    if (!env || typeof env !== 'object' || typeof cwd !== 'string' || !cwd) fail('LAUNCHER_ARGS_INVALID');
    const extra = confinedArgs(extra_args), { model, effort } = this.route;
    const effortAssurance = this.#effort.assert({ effort, model, env, cwd: path.resolve(cwd), args: [...this.#baseArgs, ...extra] });
    return { extra, model, effort, effortAssurance };
  }

  // Starts a fresh native session for a session the gate has just launched.
  start(gate, { session_id, prompt, cwd, env = process.env, extra_args = [] }) {
    if (!(gate instanceof GateAssignment) || gate.value.role !== this.#role) fail('LAUNCHER_GATE_ROLE_MISMATCH');
    const session = gate.assertExecutable(session_id);
    if (session.history.length !== 1 || session.history[0].event !== 'LAUNCH') fail('LAUNCHER_SESSION_NOT_FRESH');
    const { extra, model, effort, effortAssurance } = this.#prepare(extra_args, env, cwd);
    const nativeId = GateSessionLauncher.nativeSessionId(gate, session_id);
    return { native_session_id: nativeId, ...this.#run(['-p', prompt, '--session-id', nativeId, '--model', model, '--effort', effort,
      ...this.#baseArgs, ...extra, '--output-format', 'stream-json', '--verbose'], cwd, env, model, effortAssurance) };
  }

  // Resumes the same native session only while the gate keeps it executable,
  // for example after an owner reply returns it from WAITING_OWNER to ACTIVE.
  resume(gate, { session_id, prompt, cwd, env = process.env, extra_args = [] }) {
    if (!(gate instanceof GateAssignment) || gate.value.role !== this.#role) fail('LAUNCHER_GATE_ROLE_MISMATCH');
    gate.assertExecutable(session_id);
    const { extra, model, effort, effortAssurance } = this.#prepare(extra_args, env, cwd);
    const nativeId = GateSessionLauncher.nativeSessionId(gate, session_id);
    return { native_session_id: nativeId, ...this.#run(['-p', prompt, '--resume', nativeId, '--model', model, '--effort', effort,
      ...this.#baseArgs, ...extra, '--output-format', 'stream-json', '--verbose'], cwd, env, model, effortAssurance) };
  }

  // Native session identity is derived from the gate assignment and gate session,
  // so a launcher cannot attach an unrelated native transcript to the gate.
  static nativeSessionId(gate, sessionId) {
    const h = crypto.createHash('sha256').update(`${gate.value.assignment_id}\0${sessionId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
}

module.exports = Object.freeze({ GateSessionLauncher });
