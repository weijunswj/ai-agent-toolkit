'use strict';
// OpenCode native helper-route qualification for the owner-gpt stack (V1 plugin API).
//
// Each episode is an isolated temp project holding the candidate project plugin
// (installed by the product installer) and the registry-rendered helper agent. The
// parent session is created first, then the launcher pins a binding to that exact
// session and continues it. The user's global OpenCode config and credentials are
// used unchanged; nothing global is written.
//
// Usage: node repo/tests/qualification/opencode-native-helper.live.cjs <output.json> [--only=<case>]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const { StackRegistrySnapshot } = require(path.join(ROOT, 'repo/scripts/toolkit-stack-selection.cjs'));
const native = require(path.join(ROOT, 'repo/scripts/toolkit-v3-native-helper-adapter.cjs'));
const { installProjectPlugin } = require(path.join(ROOT, 'repo/scripts/toolkit-opencode-project-plugin.cjs'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const [outFile, ...flags] = process.argv.slice(2);
const only = (flags.find(f => f.startsWith('--only=')) || '').slice(7);
const OPENCODE = (() => {
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  return process.platform === 'win32' && fs.existsSync(exe) ? exe : 'opencode';
})();
function git(args) { const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }
function version() { const r = spawnSync(OPENCODE, ['--version'], { encoding: 'utf8', shell: OPENCODE === 'opencode' && process.platform === 'win32' }); return (r.stdout || '').trim(); }

function prepare(label, mutateAgent = () => {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-opencode-q-${label}-`)));
  const project = path.join(base, 'project'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(base, 'toolkit-fixture-owner.json'), JSON.stringify({ owner_pid: process.pid, purpose: 'opencode-native-qualification', label }));
  spawnSync('git', ['init', '--quiet', project]);
  const install = installProjectPlugin({ projectRoot: project, write: true, generation: 'V1' });
  const bytes = fs.readFileSync(path.join(ROOT, REGISTRY_REL));
  const reference = { id: 'stack-registry', repository: 'weijunswj/ai-agent-toolkit', revision: git(['rev-parse', 'HEAD']) || 'working-tree',
    path: REGISTRY_REL, content_sha256: sha(bytes), blob_sha1: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
  const sourceCapture = { reference, content_base64: bytes.toString('base64') };
  const selection = new StackRegistrySnapshot(sourceCapture).resolve('owner-gpt');
  const definition = native.renderNativeHelperDefinition('opencode', 'G1', { source_capture: sourceCapture, selection });
  const agentName = Object.keys(definition.native_configuration.agent)[0];
  const agent = structuredClone(definition.native_configuration.agent);
  mutateAgent(agent[agentName]);
  fs.writeFileSync(path.join(project, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', agent }, null, 2));
  return { base, project, sourceCapture, selection, definition, agentName, install };
}

function bind(ep, sessionId) {
  const binding = { schema: 'toolkit.v3.native-helper-binding.v1', api_generation: 'V1', session_id: sessionId, cwd: ep.project,
    helper_identity: ep.agentName, caller_model: 'gpt-6.1-sol', source_capture: ep.sourceCapture, selection: ep.selection,
    host_state: { state: 'ready', host_version: version(),
      registration: { host: 'opencode', api_generation: 'V1', entry: 'tool.execute.before/task', registered: true, loaded: true, enabled: true },
      session: { caller_role: 'G1', profile_id: 'owner-gpt', registry_revision: ep.definition.registry_revision, lifecycle: 'fresh' },
      routing: { profile_id: 'owner-gpt', registry_revision: ep.definition.registry_revision, helper_role: 'BUILDER_HELPER',
        effective_route: ep.definition.route, native_defaults: ep.definition.route,
        pinned_defaults: { provider: true, model: true, reasoning: true }, inherited_route: null } } };
  const file = path.join(ep.base, 'binding.json'); fs.writeFileSync(file, JSON.stringify(binding));
  return { TOOLKIT_NATIVE_HELPER_BINDING: file, TOOLKIT_NATIVE_HELPER_BINDING_SHA256: sha(fs.readFileSync(file)) };
}

function run(ep, message, { session = null, env = {} } = {}) {
  const args = ['run', '--format', 'json', '--model', 'openai/gpt-6.1-sol', '--variant', 'high', '--dir', ep.project,
    ...(session ? ['--session', session] : []), message];
  const started = Date.now();
  const r = spawnSync(OPENCODE, args, { cwd: ep.project, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 300000,
    maxBuffer: 32 * 1024 * 1024, shell: OPENCODE === 'opencode' && process.platform === 'win32' });
  fs.appendFileSync(path.join(ep.base, 'events.ndjson'), r.stdout || '');
  const events = (r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sessionId = events.map(e => e.sessionID || e.part?.sessionID || e.properties?.sessionID).find(Boolean) || null;
  const tools = events.filter(e => e.part?.type === 'tool').map(e => ({ tool: e.part.tool, status: e.part.state?.status,
    input: e.part.state?.input || null, error: e.part.state?.error ? String(e.part.state.error).slice(0, 300) : null,
    output: e.part.state?.output ? String(e.part.state.output).slice(0, 600) : null, child: e.part.state?.metadata?.sessionId || null }));
  const text = events.filter(e => e.part?.type === 'text').map(e => e.part.text || '').join('').slice(0, 600);
  return { exit: r.status, elapsed_ms: Date.now() - started, session_id: sessionId, event_types: [...new Set(events.map(e => e.type))],
    tools, text, stderr_tail: (r.stderr || '').slice(-800) };
}

// Exports the native session record to read each message's actual provider/model.
function sessionModels(ep, sessionId) {
  if (!sessionId) return [];
  const r = spawnSync(OPENCODE, ['export', sessionId], { cwd: ep.project, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    shell: OPENCODE === 'opencode' && process.platform === 'win32' });
  try {
    const raw = (r.stdout || '').slice((r.stdout || '').indexOf('{'));
    const doc = JSON.parse(raw);
    return [...new Set((doc.messages || []).map(m => m.info || m).filter(i => i.role === 'assistant')
      .map(i => `${i.providerID}/${i.modelID}${i.variant ? '#' + i.variant : ''}`))];
  } catch { return []; }
}

const cases = [];
function record(id, kind, expected, observed, pass, note = null) { cases.push({ id, kind, expected, observed, pass, note }); }

function episode(label, prompt, mutateAgent) {
  const ep = prepare(label, mutateAgent);
  const first = run(ep, 'Reply with exactly READY. Do not use tools.');
  const env = bind(ep, first.session_id);
  const second = run(ep, prompt, { session: first.session_id, env });
  const children = second.tools.filter(t => t.tool === 'task').map(t => t.child).filter(Boolean);
  return { ep, first, second, parent_models: sessionModels(ep, first.session_id), child_models: children.flatMap(c => sessionModels(ep, c)) };
}

function main() {
  const v = version();
  if (!only || only === 'positive') {
    const e = episode('positive', 'Use the task tool exactly once with subagent_type "toolkit-g1-helper" and prompt "Reply with exactly HELPER-OK and nothing else." Then reply with its answer.');
    const task = e.second.tools.find(t => t.tool === 'task');
    record('01-correct-route-executes', 'HOST', 'plugin allows; helper runs on openai/gpt-6-luna', { ...e, ep: undefined },
      Boolean(task && task.status === 'completed' && /HELPER-OK/.test(task.output || e.second.text)
        && e.child_models.length > 0 && e.child_models.every(m => m.startsWith('openai/gpt-6-luna'))));
  }
  if (!only || only === 'wrong-effort') {
    const e = episode('wrong-effort', 'Use the task tool exactly once with subagent_type "toolkit-g1-helper" and prompt "Reply HELPER-OK". If the tool fails, reply BLOCKED.',
      agent => { agent.variant = 'low'; agent.options.reasoningEffort = 'low'; });
    const task = e.second.tools.find(t => t.tool === 'task');
    record('03-wrong-effort-held-before-helper', 'HOST', 'plugin holds; no helper inference', { ...e, ep: undefined },
      Boolean(task && task.status === 'error' && /held|MISMATCH/i.test(task.error || '') && e.child_models.length === 0));
  }
  if (!only || only === 'override') {
    const e = episode('override', 'Use the task tool exactly once with subagent_type "toolkit-g1-helper", model "openai/gpt-6.1-sol", and prompt "Reply HELPER-OK". If the tool fails, reply BLOCKED.');
    const task = e.second.tools.find(t => t.tool === 'task');
    const overrideRequested = Boolean(task && typeof task.input?.model === 'string');
    record('06-conflicting-override', 'HOST', 'plugin holds a conflicting model override; no helper inference', { ...e, ep: undefined },
      overrideRequested ? Boolean(task.status === 'error' && e.child_models.length === 0) : null,
      overrideRequested ? null : 'The parent model did not pass a model argument, so this run did not exercise the override path.');
  }
  if (!only || only === 'no-helper') {
    const ep = prepare('no-helper');
    const r = run(ep, 'Reply with exactly NO-HELPER. Do not use any tools.');
    record('15-no-helper-request-no-spawn', 'HOST', 'no task call and root session unaffected', r,
      r.exit === 0 && !r.tools.some(t => t.tool === 'task') && /NO-HELPER/.test(r.text));
  }
  const report = { schema: 'toolkit.qualification.opencode-native-helper.v1', host: 'opencode', host_version: v, api_generation: 'V1',
    candidate_head: git(['rev-parse', 'HEAD']), candidate_dirty: git(['status', '--porcelain']) !== '', stack: 'owner-gpt',
    cases, passed: cases.filter(c => c.pass === true).length, unexercised: cases.filter(c => c.pass === null).length, total: cases.length,
    result: cases.every(c => c.pass !== false) ? (cases.some(c => c.pass === null) ? 'PARTIAL' : 'PASS') : 'FAIL' };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`${report.result} ${report.passed}/${report.total} unexercised=${report.unexercised}`);
  for (const c of cases.filter(x => x.pass !== true)) console.log('CASE', c.id, c.pass, JSON.stringify(c.observed).slice(0, 900));
}
main();
