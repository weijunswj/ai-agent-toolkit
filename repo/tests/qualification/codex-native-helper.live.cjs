'use strict';
// Codex helper-route qualification, hook-process level (owner-gpt stack).
//
// Every case invokes the real Codex PreToolUse hook command with a crafted event and a
// launcher-pinned binding in an isolated directory, so no wrong model is ever called.
// This does NOT qualify the native Codex path: that still needs the owner's one-time
// trust of the hook in Codex and real host runs. The report says so explicitly.
//
// Usage: node repo/tests/qualification/codex-native-helper.live.cjs <output.json>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs');
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const { StackRegistrySnapshot } = require(path.join(ROOT, 'repo/scripts/toolkit-stack-selection.cjs'));
const native = require(path.join(ROOT, 'repo/scripts/toolkit-v3-native-helper-adapter.cjs'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const [outFile] = process.argv.slice(2);
const codexVersion = (spawnSync('codex', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout || '').trim();

function prepare(label, mutate = () => {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-codex-q-${label}-`)));
  const bytes = fs.readFileSync(path.join(ROOT, REGISTRY_REL));
  const sourceCapture = { reference: { id: 'stack-registry', repository: 'weijunswj/ai-agent-toolkit', revision: 'working-tree', path: REGISTRY_REL,
    content_sha256: sha(bytes), blob_sha1: null }, content_base64: bytes.toString('base64') };
  const selection = new StackRegistrySnapshot(sourceCapture).resolve('owner-gpt');
  const definition = native.renderNativeHelperDefinition('codex', 'G1', { source_capture: sourceCapture, selection });
  const binding = { schema: 'toolkit.v3.native-helper-binding.v1', session_id: crypto.randomUUID(), cwd: base,
    helper_identity: definition.helper_identity, caller_model: 'gpt-6.1-sol', source_capture: sourceCapture, selection,
    host_state: { state: 'ready', host_version: codexVersion || 'unknown',
      registration: { host: 'codex', api_generation: 'PreToolUse', entry: 'spawn_agent', registered: true, loaded: true, enabled: true },
      session: { caller_role: 'G1', profile_id: 'owner-gpt', registry_revision: definition.registry_revision, lifecycle: 'fresh' },
      routing: { profile_id: 'owner-gpt', registry_revision: definition.registry_revision, helper_role: 'BUILDER_HELPER',
        effective_route: definition.route, native_defaults: definition.route,
        pinned_defaults: { provider: true, model: true, reasoning: true }, inherited_route: null } } };
  mutate(binding);
  const file = path.join(base, 'binding.json'); fs.writeFileSync(file, JSON.stringify(binding));
  return { base, binding, definition, env: { TOOLKIT_NATIVE_HELPER_BINDING: file, TOOLKIT_NATIVE_HELPER_BINDING_SHA256: sha(fs.readFileSync(file)) } };
}
function event(ep, toolInput = {}, extra = {}) {
  return { hook_event_name: 'PreToolUse', session_id: ep.binding.session_id, cwd: ep.base, model: 'gpt-6.1-sol', tool_name: 'spawn_agent',
    tool_input: { agent_type: ep.definition.helper_identity, message: 'Reply HELPER-OK', ...toolInput }, ...extra };
}
function hook(ep, ev, envOverride = {}) {
  const env = { ...process.env, ...ep.env, ...envOverride };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(ev), env, encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse((r.stdout || '{}').trim() || '{}');
  return { exit: r.status, stdout: r.stdout || '', decision: out.hookSpecificOutput?.permissionDecision || 'none', reason: out.hookSpecificOutput?.permissionDecisionReason || null };
}
const cases = [];
const record = (id, expected, observed, pass) => cases.push({ id, kind: 'HOOK', expected, observed, pass });
const denied = (r, re) => r.decision === 'deny' && r.exit === 2 && re.test(r.reason || '');
// Codex records a bare permissionDecision allow as a failed hook run, so an admitted request is exit 0 with no output.
const admitted = r => r.exit === 0 && r.stdout === '';

const ok = prepare('ok');
let r = hook(ok, event(ok));
record('01-correct-route-allowed-before-dispatch', 'admitted: exit 0, no output', r, admitted(r));
r = hook(ok, { ...event(ok), tool_name: 'Agent' });
record('13-agent-alias-held-unless-separately-bound', 'deny', r, denied(r, /HOST_ENTRY_MISMATCH/));
r = hook(ok, event(ok, { model: 'gpt-6-luna', reasoning_effort: 'max' }));
record('05-explicit-matching-route', 'admitted: exit 0, no output', r, admitted(r));
r = hook(ok, event(ok, { model: 'gpt-6.1-sol' }));
record('02-wrong-model-override', 'deny', r, denied(r, /OVERRIDE_CONFLICT|ROUTE_MISMATCH/));
r = hook(ok, event(ok, { reasoning_effort: 'low' }));
record('03-wrong-effort-override', 'deny', r, denied(r, /OVERRIDE_CONFLICT|ROUTE_MISMATCH/));
const inherited = prepare('inherited', b => { b.host_state.routing.inherited_route = { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' }; });
r = hook(inherited, event(inherited));
record('04-inherited-route-conflicts', 'deny', r, denied(r, /ROUTE_MISMATCH/));
const wrongNative = prepare('wrong-native', b => { b.host_state.routing.effective_route = { provider: 'openai', model: 'gpt-6-astra', reasoning: 'high' }; });
r = hook(wrongNative, event(wrongNative));
record('02b-wrong-effective-native-route', 'deny', r, denied(r, /ROUTE_MISMATCH/));
r = hook(ok, event(ok), { TOOLKIT_NATIVE_HELPER_BINDING_SHA256: '0'.repeat(64) });
record('10-drifted-configuration', 'deny', r, denied(r, /DRIFT/));
const broken = prepare('broken'); fs.writeFileSync(broken.env.TOOLKIT_NATIVE_HELPER_BINDING, '{not json');
r = hook(broken, event(broken), { TOOLKIT_NATIVE_HELPER_BINDING_SHA256: sha(fs.readFileSync(broken.env.TOOLKIT_NATIVE_HELPER_BINDING)) });
record('07-guard-error', 'deny', r, r.decision === 'deny' && r.exit === 2);
r = hook(ok, { ...event(ok), model: 'gpt-6-luna' });
record('16-caller-model-mismatch', 'deny', r, denied(r, /CALLER_MODEL_MISMATCH/));
r = hook(ok, { ...event(ok), session_id: 'other-session' });
record('17-other-session', 'deny', r, denied(r, /SESSION_MISMATCH/));
r = hook(ok, event(ok, { fork_context: true }));
record('12-fork-requested', 'deny', r, denied(r, /SESSION_TRANSITION/));
const resumed = prepare('resumed', b => { b.host_state.session.lifecycle = 'resumed'; });
r = hook(resumed, event(resumed));
record('12b-restored-lifecycle', 'deny', r, denied(r, /RESTORE_OR_ALTERNATE_SESSION/));
r = hook(ok, event(ok, {}, { agent_id: 'leaf' }));
record('14-leaf-delegation', 'deny', r, denied(r, /LEAF_CANNOT_DELEGATE/));
r = hook(ok, event(ok, { agent_type: 'another-agent' }));
record('18-unbound-helper-identity', 'deny', r, denied(r, /IDENTITY_MISMATCH/));
const unregistered = prepare('unregistered', b => { b.host_state.registration.enabled = false; });
r = hook(unregistered, event(unregistered));
record('09-disabled-registration', 'deny', r, denied(r, /HOOK_UNAVAILABLE/));
r = hook(ok, { tool_name: 'shell', cwd: ok.base, tool_input: {} });
record('15-other-tool-no-decision', 'no decision', r, r.decision === 'none' && r.exit === 0);
// MultiAgentV2 spawns reach hooks as the flattened collaborationspawn_agent and fork the full history unless fork_turns is none.
const v2 = (ep, input = {}) => ({ ...event(ep, { task_name: 'leaf', ...input }), tool_name: 'collaborationspawn_agent' });
r = hook(ok, v2(ok, { fork_turns: 'none' }));
record('19-v2-namespaced-correct-route', 'admitted: exit 0, no output', r, admitted(r));
r = hook(ok, v2(ok));
record('20-v2-omitted-fork-turns-forks-history', 'deny', r, denied(r, /SESSION_TRANSITION/));
r = hook(ok, v2(ok, { fork_turns: 'none', model: 'gpt-6.1-sol' }));
record('21-v2-wrong-model-override', 'deny', r, denied(r, /OVERRIDE_CONFLICT|ROUTE_MISMATCH/));
// F1: Codex accepts any [A-Za-z0-9_-]+ tool_namespace, so hyphenated names are matched and guarded identically.
const hyphen = (ep, input = {}) => ({ ...v2(ep, input), tool_name: 'multi-agentspawn_agent' });
r = hook(ok, hyphen(ok, { fork_turns: 'none' }));
record('22-v2-hyphenated-namespace-correct-route', 'admitted: exit 0, no output', r, admitted(r));
r = hook(ok, hyphen(ok));
record('23-v2-hyphenated-omitted-fork-turns', 'deny', r, denied(r, /SESSION_TRANSITION/));
// Unbound in governed work (a gate-role marker, no launcher binding): the named-helper policy decides, for the
// default and hyphenated V2 names. With no helper file installed the launch is refused; a file rendered from the
// stack is admitted. A scratch CODEX_HOME keeps the real helper files out of it.
const { CodexHelperAgentRenderer } = require(path.join(ROOT, 'repo/scripts/toolkit-codex-helper-agents.cjs'));
const unboundHome = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-q-unbound-')));
const unbound = { TOOLKIT_NATIVE_HELPER_BINDING: '', TOOLKIT_NATIVE_HELPER_BINDING_SHA256: '', TOOLKIT_GATE_ROLE: 'G1', CODEX_HOME: unboundHome };
const spawnNames = ['collaborationspawn_agent', 'multi-agentspawn_agent'];
for (const tool of spawnNames) {
  r = hook(ok, { ...v2(ok, { fork_turns: 'none' }), tool_name: tool }, unbound);
  record(`24-unbound-${tool}-no-helper-file-refused`, 'deny', r, denied(r, /agent file is installed/));
}
const rendered = CodexHelperAgentRenderer.fromRepository('owner-gpt', ROOT).render('G1');
fs.mkdirSync(path.join(unboundHome, 'agents'));
fs.writeFileSync(path.join(unboundHome, 'agents', rendered.file), rendered.text);
for (const tool of spawnNames) {
  r = hook(ok, { ...v2(ok, { fork_turns: 'none' }), tool_name: tool }, unbound);
  record(`24b-unbound-${tool}-matching-helper-admitted`, 'admitted: exit 0, no output', r, admitted(r));
}
const registered = new native.CodexHookMatcher(JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse[0].matcher);
const reached = ['spawn_agent', 'Agent', 'collaborationspawn_agent', 'multi-agentspawn_agent'].every(name => registered.matches(name));
record('25-registered-matcher-reaches-every-spawn-name', 'matched', { reached }, reached);

const report = { schema: 'toolkit.qualification.codex-native-helper-hook.v1', host: 'codex', host_version: codexVersion, stack: 'owner-gpt',
  hook_sha256: sha(fs.readFileSync(HOOK)), scope: 'HOOK_PROCESS_ONLY',
  native_status: 'UNQUALIFIED: hook process only. Native qualification needs real Codex runs with the installed, trusted hook.',
  cases, passed: cases.filter(c => c.pass).length, total: cases.length, result: cases.every(c => c.pass) ? 'HOOK_CASES_PASS' : 'FAIL' };
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`${report.result} ${report.passed}/${report.total}`);
for (const c of cases.filter(x => !x.pass)) console.log('FAILED', c.id, JSON.stringify(c.observed));
