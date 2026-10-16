'use strict';
// Claude Code native helper-route qualification for the owner-claude stack.
//
// Runs against the installed `claude` CLI in an isolated session: user settings are
// excluded (so no installed Toolkit plugin or user hook loads), the candidate's
// PreToolUse hook is registered through --settings, the helper definition through
// --agents, and an isolated control root and pinned binding are passed through the
// environment. The live builder's own profile, hooks and credentials are untouched.
//
// Evidence kinds are labelled per case:
//   HOST      - real Claude Code session; the hook decision is traced and the
//               downstream result observed in stream-json output.
//   HOOK      - the real hook process invoked with a crafted PreToolUse event; used
//               for wrong-route negatives so no wrong model is ever called.
//   IN_PROCESS - the real hook/guard modules with a controlled observer, only for
//               faults the CLI cannot inject (guard timeout, post-check drift).
//
// Usage: node repo/tests/qualification/claude-native-helper.live.cjs <output.json> [--host]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-agent-hook.cjs');
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const control = require(path.join(ROOT, 'repo/scripts/toolkit-agent-control.cjs'));
const { StackRegistrySnapshot } = require(path.join(ROOT, 'repo/scripts/toolkit-stack-selection.cjs'));
const native = require(path.join(ROOT, 'repo/scripts/toolkit-v3-native-helper-adapter.cjs'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const [outFile, ...flags] = process.argv.slice(2);
const runHost = flags.includes('--host');
const only = (flags.find(f => f.startsWith('--only=')) || '').slice(7);

function git(args) { const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }
// The npm wrapper is a .cmd shim around a native executable; spawn that executable
// directly so every argument is passed verbatim without a shell.
const CLAUDE = (() => {
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return process.platform === 'win32' && fs.existsSync(exe) ? exe : 'claude';
})();
function hostVersion() { const r = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8' }); return (r.stdout || '').trim(); }

// Isolated episode: project dir, control root with a broader-native profile, pinned binding.
function prepare(label, mutate = () => {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-claude-q-${label}-`)));
  const project = path.join(base, 'project'), controlRoot = path.join(base, 'control');
  fs.mkdirSync(project); fs.mkdirSync(controlRoot);
  fs.writeFileSync(path.join(base, 'toolkit-fixture-owner.json'), JSON.stringify({ owner_pid: process.pid, purpose: 'claude-native-qualification', label }));
  control.configureProfile('claude-code', { topology: 'broader-native', capacity_mode: 'root-only' }, { root: controlRoot });
  const bytes = fs.readFileSync(path.join(ROOT, REGISTRY_REL));
  const reference = { id: 'stack-registry', repository: 'weijunswj/ai-agent-toolkit', revision: git(['rev-parse', 'HEAD']) || 'working-tree',
    path: REGISTRY_REL, content_sha256: sha(bytes), blob_sha1: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
  const sourceCapture = { reference, content_base64: bytes.toString('base64') };
  const selection = new StackRegistrySnapshot(sourceCapture).resolve('owner-claude');
  const definition = native.renderNativeHelperDefinition('claude-code', 'G1', { source_capture: sourceCapture, selection });
  const helper = definition.native_configuration;
  const sessionId = crypto.randomUUID();
  const binding = {
    schema: 'toolkit.v3.native-helper-binding.v1', session_id: sessionId, cwd: project, helper_identity: helper.name,
    caller_model: 'claude-opus-5-5', source_capture: sourceCapture, selection,
    native_config: { loaded_agent: helper.name, mods_present: false, provider: 'anthropic',
      available_models: ['claude-haiku-5-5', 'claude-opus-5-5'], parent_model: 'claude-opus-5-5',
      agent_model: helper.model, agent_effort: helper.effort, session_effort: 'high' },
    host_state: { state: 'ready', host_version: hostVersion(),
      registration: { host: 'claude-code', api_generation: 'PreToolUse', entry: 'Agent', registered: true, loaded: true, enabled: true },
      session: { caller_role: 'G1', profile_id: 'owner-claude', registry_revision: definition.registry_revision, lifecycle: 'fresh' },
      routing: { profile_id: 'owner-claude', registry_revision: definition.registry_revision, helper_role: 'BUILDER_HELPER',
        effective_route: definition.route, native_defaults: definition.route,
        pinned_defaults: { provider: true, model: true, reasoning: true }, inherited_route: null } },
  };
  const agentDef = { [helper.name]: { description: helper.description, prompt: helper.prompt, model: helper.model,
    effort: helper.effort, disallowedTools: helper.disallowedTools } };
  mutate({ binding, agentDef, helper });
  const bindingPath = path.join(base, 'binding.json');
  fs.writeFileSync(bindingPath, JSON.stringify(binding));
  const trace = path.join(base, 'hook-decisions.ndjson');
  const env = { ...process.env, AI_AGENT_TOOLKIT_CONTROL_ROOT: controlRoot, TOOLKIT_NATIVE_HELPER_BINDING: bindingPath,
    TOOLKIT_NATIVE_HELPER_BINDING_SHA256: sha(fs.readFileSync(bindingPath)), TOOLKIT_HOOK_DECISION_LOG: trace };
  for (const key of ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE', 'CLAUDE_CODE_EFFORT_LEVEL', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) delete env[key];
  return { base, project, controlRoot, bindingPath, binding, sessionId, helper, agentDef, env, trace, definition };
}

function event(ep, toolInput, extra = {}) {
  return { hook_event_name: 'PreToolUse', session_id: ep.sessionId, cwd: ep.project, tool_name: 'Agent',
    tool_input: { subagent_type: ep.helper.name, description: 'qualification', prompt: 'Reply HELPER-OK', ...toolInput }, ...extra };
}

// Runs the actual hook command exactly as Claude Code would.
function hook(ep, ev) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(ev), env: ep.env, encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse((r.stdout || '{}').trim() || '{}');
  return { decision: out.hookSpecificOutput?.permissionDecision || 'none', reason: out.hookSpecificOutput?.permissionDecisionReason || null };
}

// Launcher refuses to start a helper-capable session unless its hook is registered.
function launcherSettings(ep, { withHook = true } = {}) {
  const settings = { permissions: { deny: ['Workflow'] },
    hooks: withHook ? { PreToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: `node "${HOOK}"`, timeout: 10 }] }] } : {} };
  const hooks = settings.hooks.PreToolUse || [];
  if (!hooks.some(h => h.matcher === 'Agent|Task' && h.hooks.some(x => x.command.includes('toolkit-claude-agent-hook.cjs')))) {
    return { refused: true, code: 'LAUNCHER_HOOK_REGISTRATION_REQUIRED' };
  }
  const file = path.join(ep.base, 'settings.json'); fs.writeFileSync(file, JSON.stringify(settings));
  return { refused: false, file };
}

// Claude Code persists subagent transcripts beside the parent session transcript.
function subagentTranscriptModels(sessionId) {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const models = [];
  if (!fs.existsSync(projects)) return models;
  for (const dir of fs.readdirSync(projects)) {
    const sub = path.join(projects, dir, sessionId, 'subagents');
    if (!fs.existsSync(sub)) continue;
    for (const file of fs.readdirSync(sub).filter(n => n.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(sub, file), 'utf8').split(/\r?\n/).filter(Boolean)) {
        try { const m = JSON.parse(line).message?.model; if (m) models.push(m); } catch { /* ignore partial line */ }
      }
    }
  }
  return models;
}

function host(ep, prompt) {
  const settings = launcherSettings(ep);
  const agentsFile = path.join(ep.base, 'agents.json'); fs.writeFileSync(agentsFile, JSON.stringify(ep.agentDef));
  const args = ['-p', prompt, '--session-id', ep.sessionId, '--model', 'claude-opus-5-5', '--effort', 'high',
    '--setting-sources', 'project,local', '--settings', settings.file, '--agents', agentsFile, '--tools', 'Agent',
    '--allowedTools', 'Agent', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'];
  const started = Date.now();
  const r = spawnSync(CLAUDE, args, { cwd: ep.project, env: ep.env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(ep.base, 'stream.ndjson'), r.stdout || '');
  const lines = (r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = lines.find(l => l.type === 'system' && l.subtype === 'init') || {};
  const agentCalls = lines.flatMap(l => (l.message?.content || []).filter(c => c.type === 'tool_use' && c.name === 'Agent').map(c => ({ id: c.id, input: c.input })));
  const results = lines.flatMap(l => (l.message?.content || []).filter(c => c.type === 'tool_result').map(c => ({ tool_use_id: c.tool_use_id,
    is_error: c.is_error === true, text: (Array.isArray(c.content) ? c.content.map(x => x.text || '').join('') : String(c.content || '')).slice(0, 4000) })));
  const subagentModels = [...new Set([...lines.filter(l => l.parent_tool_use_id && l.message?.model).map(l => l.message.model),
    ...subagentTranscriptModels(init.session_id || ep.sessionId)])];
  const final = lines.find(l => l.type === 'result') || {};
  const decisions = fs.existsSync(ep.trace) ? fs.readFileSync(ep.trace, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  return { exit: r.status, elapsed_ms: Date.now() - started, session_model: init.model || null, session_id: init.session_id || null,
    plugins: (init.plugins || []).map(p => p.name || p), hooks_declared: settings.file ? true : false,
    agent_calls: agentCalls, tool_results: results, subagent_models: subagentModels, hook_decisions: decisions,
    result_subtype: final.subtype || null, cost_usd: typeof final.total_cost_usd === 'number' ? final.total_cost_usd : null,
    stderr_tail: (r.stderr || '').slice(-600) };
}

const cases = [];
function record(id, kind, expected, observed, pass, note = null) { cases.push({ id, kind, expected, observed, pass, note }); }

async function main() {
  const version = hostVersion();
  // HOOK-level matrix, each in its own isolated episode.
  const ok = prepare('omitted');
  let r = hook(ok, event(ok, {}));
  record('05-omitted-native-field-matching-pinned-config', 'HOOK', 'allow', r, r.decision === 'allow');
  r = hook(ok, event(ok, { model: 'claude-haiku-5-5' }));
  record('01b-correct-explicit-route', 'HOOK', 'allow', r, r.decision === 'allow');
  const wrongModel = prepare('wrong-model', ({ binding }) => { binding.native_config.agent_model = 'claude-sonnet-5-5'; binding.native_config.available_models.push('claude-sonnet-5-5'); });
  r = hook(wrongModel, event(wrongModel, {}));
  record('02-wrong-provider-or-model', 'HOOK', 'deny', r, r.decision === 'deny' && /ALIAS_UNQUALIFIED|ROUTE_MISMATCH/.test(r.reason || ''));
  const wrongEffort = prepare('wrong-effort', ({ binding }) => { binding.native_config.agent_effort = 'low'; });
  r = hook(wrongEffort, event(wrongEffort, {}));
  record('03-wrong-effort', 'HOOK', 'deny', r, r.decision === 'deny' && /ROUTE_MISMATCH/.test(r.reason || ''));
  const inherited = prepare('inherited', ({ binding }) => { binding.native_config.agent_model = 'inherit'; });
  r = hook(inherited, event(inherited, {}));
  record('04-inherited-config-conflicts-with-pinned-registry', 'HOOK', 'deny', r, r.decision === 'deny' && /ROUTE_MISMATCH/.test(r.reason || ''));
  r = hook(ok, event(ok, { model: 'claude-opus-5-5' }));
  record('06-conflicting-override', 'HOOK', 'deny', r, r.decision === 'deny' && /OVERRIDE_CONFLICT|ROUTE_MISMATCH/.test(r.reason || ''),
    'A requested model becomes the effective native route, so it is refused as a route mismatch before dispatch.');
  const broken = prepare('guard-error'); fs.writeFileSync(broken.bindingPath, '{not json');
  broken.env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256 = sha(fs.readFileSync(broken.bindingPath));
  r = hook(broken, event(broken, {}));
  record('07-guard-error', 'HOOK', 'deny', r, r.decision === 'deny');
  const drift = prepare('malformed-config'); drift.env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256 = '0'.repeat(64);
  r = hook(drift, event(drift, {}));
  record('10-malformed-or-drifted-configuration', 'HOOK', 'deny', r, r.decision === 'deny' && /DRIFT/.test(r.reason || ''));
  r = hook(ok, event(ok, { resume: 'previous-agent' }));
  record('12a-resume-requested', 'HOOK', 'deny', r, r.decision === 'deny' && /SESSION_TRANSITION/.test(r.reason || ''));
  const resumed = prepare('resumed-lifecycle', ({ binding }) => { binding.host_state.session.lifecycle = 'resumed'; });
  r = hook(resumed, event(resumed, {}));
  record('12b-restored-session-lifecycle', 'HOOK', 'deny', r, r.decision === 'deny' && /RESTORE_OR_ALTERNATE_SESSION/.test(r.reason || ''));
  r = hook(ok, { ...event(ok, {}), tool_name: 'Task' });
  record('13-alternate-entry-task-alias', 'HOOK', 'deny', r, r.decision === 'deny' && /ALIAS_UNQUALIFIED/.test(r.reason || ''));
  r = hook(ok, event(ok, {}, { agent_id: 'leaf-agent', agent_type: ok.helper.name }));
  record('14a-leaf-delegation', 'HOOK', 'deny', r, r.decision === 'deny' && /LEAF_CANNOT_DELEGATE/.test(r.reason || ''));
  const g2 = prepare('g2-caller', ({ binding }) => { binding.host_state.session.caller_role = 'G2'; });
  r = hook(g2, event(g2, {}));
  record('14b-g2-caller-delegation', 'HOOK', 'deny', r, r.decision === 'deny');
  r = hook(ok, event(ok, { subagent_type: 'some-other-agent' }));
  record('16-unbound-helper-identity', 'HOOK', 'deny', r, r.decision === 'deny' && /IDENTITY_MISMATCH/.test(r.reason || ''));
  const noProfile = prepare('root-only'); fs.rmSync(path.join(noProfile.controlRoot, 'profiles'), { recursive: true, force: true });
  r = hook(noProfile, event(noProfile, {}));
  record('17-unconfigured-profile-stays-root-only', 'HOOK', 'deny', r, r.decision === 'deny' && /root-only/.test(r.reason || ''));

  // Launcher-level: a missing hook cannot be self-reported by the hook, so the launcher refuses.
  const missing = launcherSettings(prepare('missing-hook'), { withHook: false });
  record('09-missing-or-disabled-hook', 'LAUNCHER', 'refuse launch', missing, missing.refused === true);

  // IN_PROCESS faults the CLI cannot inject, through the real modules.
  const binding = JSON.parse(fs.readFileSync(ok.bindingPath, 'utf8'));
  const slow = await native.commandDecision(event(ok, {}), 'claude-code', { observe_host_state: () => new Promise(res => setTimeout(() => res(binding.host_state), 400)),
    source_capture: binding.source_capture, selection: binding.selection, helper_identity: ok.helper.name });
  record('08-guard-timeout', 'IN_PROCESS', 'deny', slow, slow.hookSpecificOutput?.permissionDecision === 'deny' && /TIMEOUT/.test(slow.hookSpecificOutput?.permissionDecisionReason || ''));
  let calls = 0;
  const changing = await native.commandDecision(event(ok, {}), 'claude-code', { observe_host_state: () => {
    calls += 1; const s = structuredClone(binding.host_state); if (calls > 2) s.host_version = `${s.host_version}-changed`; return s; },
  source_capture: binding.source_capture, selection: binding.selection, helper_identity: ok.helper.name });
  record('11-post-check-configuration-change', 'IN_PROCESS', 'deny', changing, changing.hookSpecificOutput?.permissionDecision === 'deny' && /POSTCHECK/.test(changing.hookSpecificOutput?.permissionDecisionReason || ''));

  // HOST-level: real Claude Code sessions.
  if (runHost && (!only || only === 'positive')) {
    const pos = prepare('host-positive');
    const h1 = host(pos, `Use the Agent tool exactly once with subagent_type "${pos.helper.name}" and prompt "Reply with exactly HELPER-OK and nothing else." Do not pass a model. Then reply with the helper's answer.`);
    const allowed = h1.hook_decisions.some(d => d.decision === 'allow' && d.subagent_type === pos.helper.name);
    const helperOk = h1.tool_results.some(t => /HELPER-OK/.test(t.text) && !t.is_error);
    record('01-correct-route-executes', 'HOST', 'hook allow; helper runs on the pinned Haiku route', h1,
      allowed && helperOk && h1.subagent_models.every(m => m === 'claude-haiku-5-5') && h1.subagent_models.length > 0);
  }
  if (runHost && !only) {
    const neg = prepare('host-override');
    const h2 = host(neg, `Use the Agent tool exactly once with subagent_type "${neg.helper.name}", model "opus", and prompt "Reply HELPER-OK". If the tool is blocked, reply BLOCKED.`);
    const denied = h2.hook_decisions.some(d => d.decision === 'deny');
    record('06h-conflicting-override-denied-by-host', 'HOST', 'hook deny; no helper inference', h2,
      denied && h2.subagent_models.length === 0 && !h2.tool_results.some(t => /HELPER-OK/.test(t.text)));
    const none = prepare('host-no-helper');
    const h3 = host(none, 'Reply with exactly NO-HELPER. Do not use any tools.');
    record('15-no-helper-request-no-spawn', 'HOST', 'no Agent call and no hook decision', h3,
      h3.agent_calls.length === 0 && h3.hook_decisions.length === 0 && h3.subagent_models.length === 0);
  }
  const report = { schema: 'toolkit.qualification.claude-native-helper.v1', host: 'claude-code', host_version: version,
    candidate_head: git(['rev-parse', 'HEAD']), candidate_dirty: git(['status', '--porcelain']) !== '', stack: 'owner-claude',
    hook_sha256: sha(fs.readFileSync(HOOK)), registry_sha256: ok.binding.source_capture.reference.content_sha256,
    host_runs: runHost, cases, passed: cases.filter(c => c.pass).length, total: cases.length,
    result: cases.every(c => c.pass) ? 'PASS' : 'FAIL' };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`${report.result} ${report.passed}/${report.total}`);
  for (const c of cases.filter(x => !x.pass)) console.log('FAILED', c.id, JSON.stringify(c.observed).slice(0, 500));
}
main().catch(e => { console.error(e); process.exit(1); });
