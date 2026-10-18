'use strict';
// End-to-end V3 Core lifecycle qualification episode (harmless, task-owned effects).
//
//   assignment -> launch -> question -> native resume -> checkpoint
//   -> private custody upload + independent retrieval -> eligible cleanup + held control
//   -> return consumption -> retirement and retired-session refusal
//   -> fresh successor that recovers from the packet and custody alone.
//
// Gate state, the retained-resource register and evidence live in the agreed PRIVATE
// store and are written only with conditional (expected-revision) updates. Native
// sessions are real Claude Code runs started by GateSessionLauncher with user
// settings excluded. The question in this episode is answered by the harness and is
// labelled as qualification input, not as an owner decision.
//
// Usage: node repo/tests/qualification/core-lifecycle-slice.live.cjs <owner/private-repo> <prefix> <episode> <out.json>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const req = rel => require(path.join(ROOT, rel));
const { GateAssignment, successorPacket } = req('repo/scripts/toolkit-v3-lifecycle.cjs');
const { GateSessionLauncher } = req('repo/scripts/toolkit-gate-session-launcher.cjs');
const { GhTransport, CanonicalStateStore, sha256 } = req('repo/scripts/toolkit-programme-publication.cjs');
const { RetainedResourceRegister } = req('repo/scripts/toolkit-custody-retention-v3.cjs');
const { StackRegistrySnapshot } = req('repo/scripts/toolkit-stack-selection.cjs');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const [repository, prefix, episode, outFile] = process.argv.slice(2);
if (!repository || !prefix || !/^[a-z0-9-]+$/.test(episode || '') || !outFile) throw new Error('usage: <repo> <prefix> <episode> <out.json>');
const gh = new GhTransport();
const meta = JSON.parse(GhTransport.spawn(['api', `repos/${repository}`]).stdout);
if (meta.private !== true) throw new Error('qualification store must be private');
const dir = `${prefix}/${episode}`;
const steps = [];
const step = (name, value = {}) => { steps.push({ step: name, at: new Date().toISOString(), ...value }); };
const now = () => new Date().toISOString();

// Conditional persistence of one document; a stale revision is a hard stop.
class Persisted {
  #store; #revision = null;
  constructor(file) { this.#store = new CanonicalStateStore({ transport: gh, repository, path: `${dir}/${file}` }); }
  save(value, message) {
    const r = this.#store.write(value, this.#revision, `Qualification ${episode}: ${message}`);
    if (r.state !== 'APPLIED') throw new Error(`PERSIST_${r.state}: ${message}`);
    this.#revision = r.revision; return r.revision;
  }
  read() { return this.#store.read(); }
}
const gateDoc = new Persisted('gate.json'), registerDoc = new Persisted('resources.json');

// Registry binding for the owner-claude G1 lead route.
const regBytes = fs.readFileSync(path.join(ROOT, 'repo/contracts/controller-kernel/stack-registry-v3.json'));
const sourceCapture = { reference: { id: 'stack-registry', repository: 'weijunswj/ai-agent-toolkit', revision: 'working-tree',
  path: 'repo/contracts/controller-kernel/stack-registry-v3.json', content_sha256: sha(regBytes), blob_sha1: null }, content_base64: regBytes.toString('base64') };
const captured = { source_capture: sourceCapture, selection: new StackRegistrySnapshot(sourceCapture).resolve('owner-claude') };

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-slice-${episode}-`)));
const project = path.join(base, 'project'); fs.mkdirSync(project);
const baseArgs = ['--setting-sources', 'project,local', '--strict-mcp-config'];
const env = { ...process.env }; for (const k of ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_EFFORT_LEVEL']) delete env[k];
const launcher = new GateSessionLauncher({ captured, role: 'G1', base_args: baseArgs });
const criteria = { episode, result_word: 'lantern', require: ['result uploaded and independently retrieved', 'local copy released', 'held control untouched'] };

function main() {
  // 1. Assignment with acceptance fixed upfront (objective criteria for a qualification episode).
  let gate = GateAssignment.admit({ assignment_id: `qual-${episode}`, programme: 421, child: 461, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: sha(JSON.stringify(criteria)), owner: 'qualification-harness' } });
  gateDoc.save(gate.value, 'admit assignment'); step('assignment-admitted', { digest: gate.digest });

  // 2. Launch exactly one session; a repeated launch request reuses it.
  gate = gate.launch({ session_id: 's1', launch_request_id: 'launch-1', requested_by: 'CONTROLLER' }).gate;
  const repeat = gate.launch({ session_id: 's1', launch_request_id: 'launch-1', requested_by: 'CONTROLLER' });
  gateDoc.save(gate.value, 'launch s1'); step('launched', { duplicate_request: repeat.outcome });
  const first = launcher.start(gate, { session_id: 's1', cwd: project, env, extra_args: ['--tools', ''],
    prompt: 'You are a short qualification session. Do not use tools. Reply with exactly: QUESTION: Which word should result.txt contain?' });
  step('native-start', { native_session_id: first.native_session_id, model: first.model, exit: first.exit, reply: first.result_text, cost_usd: first.cost_usd });
  if (!/QUESTION:/.test(first.result_text || '')) throw new Error('session did not ask its question');

  // 3. The question keeps the gate unfinished; the answer resumes the same native session.
  gate = gate.transition('s1', 'ASK_OWNER', sha(first.result_text));
  gateDoc.save(gate.value, 'waiting for answer'); step('waiting-owner', { state: gate.session('s1').state, gate_state: gate.state });
  const answer = 'lantern';
  gate = gate.recordOwnerDecision({ question_id: 'result-word', decision_digest: sha(answer),
    provenance_digest: sha('qualification-harness-supplied-answer'), based_on_revision: gate.revision }).gate;
  gate = gate.transition('s1', 'OWNER_REPLY', sha(answer));
  gateDoc.save(gate.value, 'answer recorded'); step('answer-recorded', { provenance: 'qualification-harness' });
  const second = launcher.resume(gate, { session_id: 's1', cwd: project, env,
    extra_args: ['--tools', 'Write', '--allowedTools', 'Write'],
    prompt: `The answer is "${answer}". Use the Write tool to create result.txt in the current directory containing exactly that word, then reply DONE.` });
  const resultFile = path.join(project, 'result.txt');
  const produced = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').trim() : null;
  step('native-resume', { same_native_session: second.native_session_id === first.native_session_id, exit: second.exit, reply: second.result_text,
    produced, cost_usd: second.cost_usd });
  if (produced !== answer) throw new Error('resumed session did not produce the agreed result');
  gate = gate.transition('s1', 'CHECKPOINT', sha(produced));
  gateDoc.save(gate.value, 'checkpoint after work'); step('checkpoint', { state: gate.session('s1').state });

  // 4. Private custody upload and independent retrieval by a fresh process.
  const bytes = fs.readFileSync(resultFile);
  const up = gh.writeContent(repository, `${dir}/evidence/result.txt`, { text: bytes.toString('utf8'), message: `Qualification ${episode}: evidence`, branch: 'main' });
  if (up.state !== 'APPLIED') throw new Error('custody upload failed');
  const consumer = spawnSync(process.execPath, ['-e', 'const {spawnSync}=require("node:child_process");const r=spawnSync("gh",["api",process.argv[1],"-H","Accept: application/vnd.github.raw"],{encoding:"buffer"});process.stdout.write(require("node:crypto").createHash("sha256").update(r.stdout).digest("hex"));',
    `repos/${repository}/contents/${dir}/evidence/result.txt`], { encoding: 'utf8' });
  const retrieved = consumer.stdout.trim();
  step('custody-verified', { blob: up.sha, local_sha256: sha(bytes), consumer_sha256: retrieved, consumer_pid_differs: true });
  if (retrieved !== sha(bytes)) throw new Error('independent retrieval mismatch');

  // 5. Retained resources: eligible control is released, newly held control is protected.
  const preview = path.join(project, 'uat-preview'); fs.mkdirSync(preview); fs.writeFileSync(path.join(preview, 'index.txt'), 'preview');
  let reg = new RetainedResourceRegister()
    .register({ resource_id: 'local-result-copy', kind: 'DIRECTORY', purpose: 'Local copy of the uploaded result', owner: 's1', need: 'PRESERVED',
      release_condition: 'custody-verified-and-retrieved', reassess: { trigger: 'EVENT', event: 'custody-verified' }, created_at: now(), created_by: 's1' })
    .register({ resource_id: 'uat-preview', kind: 'DIRECTORY', purpose: 'Preview used by acceptance', owner: 's1', need: 'PRESERVED',
      release_condition: 'acceptance-complete', reassess: { trigger: 'EVENT', event: 'acceptance-complete' }, created_at: now(), created_by: 's1' });
  reg = reg.setHolds('uat-preview', ['UAT'], { at: now(), reason: 'acceptance-in-progress' });
  registerDoc.save(reg.value, 'register resources');
  const eligible = reg.reassess('local-result-copy', { observed_at: now(), release_condition_met: true, custody_verified: true });
  const held = reg.reassess('uat-preview', { observed_at: now(), release_condition_met: true, custody_verified: true });
  if (eligible.disposition === 'RELEASE_ELIGIBLE') fs.rmSync(resultFile);
  const absent = !fs.existsSync(resultFile);
  reg = reg.release('local-result-copy', { at: now(), readback_digest: sha(`absent:${resultFile}:${absent}`) });
  registerDoc.save(reg.value, 'release eligible copy');
  step('cleanup', { eligible: eligible.disposition, local_copy_absent: absent, held: held.disposition, held_preserved: fs.existsSync(path.join(preview, 'index.txt')) });
  if (!absent || held.disposition !== 'HOLD' || !fs.existsSync(path.join(preview, 'index.txt'))) throw new Error('cleanup controls failed');

  // 6. Submit, consume once, retire; a resume of the retired session is refused.
  gate = gate.transition('s1', 'SUBMIT', sha('return'));
  const returnDigest = sha(JSON.stringify({ upload: up.sha, retrieved, released: true }));
  const consumed = gate.consumeReturn({ session_id: 's1', return_digest: returnDigest, disposition: 'ACCEPT' });
  gate = consumed.gate;
  const replay = gate.consumeReturn({ session_id: 's1', return_digest: returnDigest, disposition: 'ACCEPT' });
  gateDoc.save(gate.value, 'accepted and retired');
  let refusal = null;
  try { launcher.resume(gate, { session_id: 's1', cwd: project, env, prompt: 'continue' }); } catch (e) { refusal = e.code; }
  step('retired', { outcome: consumed.outcome, replay: replay.outcome, gate_state: gate.state, resume_refusal: refusal });
  if (refusal !== 'V3_RETIRED_SESSION_REFUSED') throw new Error('retired session was not refused');

  // 7. Fresh successor: a new assignment receives only the packet and recovers from custody.
  const packet = successorPacket(gate, { next_role: 'G1', carried_evidence: ['evidence:result.txt'] });
  const packetDoc = new Persisted('successor-packet.json'); packetDoc.save(packet, 'successor packet');
  let next = GateAssignment.admit({ assignment_id: `qual-${episode}-successor`, programme: 421, child: 461, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: sha('successor-recovers-evidence'), owner: 'qualification-harness' } });
  next = next.launch({ session_id: 's2', launch_request_id: 'launch-2', requested_by: 'CONTROLLER' }).gate;
  const fresh = launcher.start(next, { session_id: 's2', cwd: project, env,
    extra_args: ['--tools', 'Bash', '--allowedTools', 'Bash(gh api:*)'],
    prompt: `You are a fresh successor with no prior chat. Your packet: ${JSON.stringify({ predecessor: packet.predecessor, carried_evidence: packet.carried_evidence, budget_reset: packet.budget_reset })}. `
      + `Run exactly: gh api repos/${repository}/contents/${dir}/evidence/result.txt --jq .content and decode the base64 yourself. Reply with only the decoded word.` });
  step('fresh-successor', { native_session_id: fresh.native_session_id, distinct_native_session: fresh.native_session_id !== first.native_session_id,
    reply: fresh.result_text, cost_usd: fresh.cost_usd, recovered: (fresh.result_text || '').trim().toLowerCase().includes(answer) });
  if (!(fresh.result_text || '').toLowerCase().includes(answer)) throw new Error('successor did not recover the evidence');

  const report = { schema: 'toolkit.qualification.core-lifecycle-slice.v1', episode, store_private: true, store_dir: dir, steps,
    final_gate_digest: gate.digest, successor_packet_digest: sha(JSON.stringify(packet)), result: 'PASS' };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('PASS'); for (const s of steps) console.log(s.step, JSON.stringify({ ...s, step: undefined, at: undefined }).slice(0, 220));
}
try { main(); } catch (e) {
  fs.writeFileSync(outFile, JSON.stringify({ schema: 'toolkit.qualification.core-lifecycle-slice.v1', episode, steps, result: 'FAIL', error: String(e.message) }, null, 2));
  console.log('FAIL', e.message); for (const s of steps) console.log(s.step, JSON.stringify(s).slice(0, 220)); process.exitCode = 1;
}
