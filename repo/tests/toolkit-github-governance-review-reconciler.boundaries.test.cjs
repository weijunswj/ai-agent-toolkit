'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');
const root = path.resolve(__dirname, '..', '..');

function authorityPacket(overrides = {}) {
  const source = {
    repository: 'weijunswj/ai-agent-toolkit',
    issue_number: 435,
    comment_id: 5772542748,
    node_id: 'IC_kwDOSTHjGM8AAAABWBIDHA',
    author_login: 'weijunswj',
    updated_at: '2026-09-22T07:09:31Z',
    body_digest: 'a'.repeat(64),
  };
  return {
    schema: n5.AUTHORITY_PACKET_CURRENT_SCHEMA,
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 421,
    child_issue: 435,
    lane_id: 'lane-g3-leaf-d',
    human_owner: 'weijunswj',
    consumer: { run: 'run-061', lock: 'lock-061', stage: 'G3', role: 'leaf-d', scope_digest: 'b'.repeat(64) },
    authority: source,
    candidate: { pr_number: 447, branch: 'codex/c1-authority-packet', base_ref: 'main', base_sha: 'c'.repeat(40), head_sha: 'd'.repeat(40), tree_sha: 'e'.repeat(40) },
    predecessors: [{
      packet_id: 'packet-060',
      packet_digest: 'f'.repeat(64),
      content_digest: '1'.repeat(64),
      binding_digest: '2'.repeat(64),
      producer: { run: 'run-060', lock: 'lock-060', stage: 'G2', role: 'G2' },
      candidate: { pr_number: 447, branch: 'codex/c1-foundation', base_ref: 'main', base_sha: '3'.repeat(40), head_sha: '4'.repeat(40), tree_sha: '5'.repeat(40) },
      dependency_id: 'g2-contract',
      acceptance_event_id: 'acceptance-060',
      web_source: source,
      readback_event_id: 'readback-060',
      store_identity_digest: '6'.repeat(64),
    }],
    ...overrides,
  };
}

function trackerState(packet = authorityPacket()) {
  const current = { child_id: 'child-435', issue_number: 435, lifecycle: 'current' };
  if (packet) current.authority_packet_current = packet;
  return {
    kind: 'parent',
    tracker_version: 'v3',
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 421,
    current_work: [current],
    pending_work: [],
    other_open_prs: [],
    terminal: [],
    deferred_findings: [],
    owner_detail: 'safe',
  };
}

test('A1 is sole mutation and ticket authority', () => { const b = n5.authorityBoundary(); assert.equal(b.a1.sole_mutation_authority, true); assert.equal(b.a1.sole_opaque_ticket_authority, true); assert.equal(b.a1.public_ticket_mint, false); assert.equal(b.n5.authority_or_finality_token, false); });
test('A2 is consent/state only', () => { const b = n5.authorityBoundary(); assert.equal(b.a2.consent_only, true); assert.equal(b.a2.widens_task_or_delegation, false); assert.equal(b.a2.grants_review_mutation, false); assert.equal(b.a2.grants_finality, false); });
test('A3 remains exactly five contracts without finality', () => { const b = n5.authorityBoundary(); assert.equal(b.a3.durable_contract_count, 5); assert.equal(b.a3.finality_authority, false); assert.equal(b.a3.additional_contract, false); });
test('A4 owns nested review projection and six predicates', () => { const b = n5.authorityBoundary(); assert.equal(b.a4.review_projection, 'nested-only'); assert.deepEqual(b.a4.material_predicates, n5.A4_MATERIAL_PREDICATES); assert.equal(b.a4.web_finality_handoff, true); });
test('all controller-owned review mutation actions are denied to executors', () => { for (const action of ['reply', 'resolve', 'reopen', 'dismiss', 'final_disposition', 'ready', 'merge', 'cleanup']) { const r = n5.authorizeReviewMutation({ action, actor: 'ordinary_executor', a2_governance: 'enabled' }); assert.equal(r.code, 'N5_REVIEW_MUTATION_DENIED'); } });
test('disposition needs factual close and evidence, not merge or closure', () => { const base = { controller_disposition: 'fixed', exact_head: true, canonical: true, validation: true, readback: true, controlling_reference: 'ref-1' }; for (const reason of ['merge', 'closed', 'outdated', 'disagreement', 'follow_up_created']) assert.equal(n5.resolveFinding({ ...base, only_reason: reason }).code, 'N5_REVIEW_DISPOSITION_INCOMPLETE'); assert.equal(n5.resolveFinding({ ...base, closing_reply_factual: true, evidence_backed_completion: true, resolved: true }).code, 'N5_REVIEW_DISPOSITION_COMPLETE'); });
test('executor blocking recommendation is not final disposition', () => { const predicates = Object.fromEntries(n5.A4_MATERIAL_PREDICATES.map((key) => [key, true])); const r = n5.evaluateMateriality({ predicates, exclusions: [], executor_recommendation: 'blocking' }); assert.equal(r.material, true); assert.equal(r.final_disposition, null); });
test('review completeness never becomes empty-green', () => { const complete = n5.buildReviewInventory({ pull_requests: [{ number: 1, state: 'open' }], submitted_reviews: [], inline_conversations: [], pagination: { pull_requests: true, submitted_reviews: true, inline_conversations: true } }); assert.equal(Object.hasOwn(complete, 'findings'), false); const incomplete = n5.buildReviewInventory({ pull_requests: [], submitted_reviews: [], inline_conversations: [], pagination: { pull_requests: true, submitted_reviews: false, inline_conversations: true } }); assert.equal(incomplete.review.complete, false); assert.equal(incomplete.review.verifiable, false); });
test('public-safe evidence excludes raw code, private paths, and provider secrets', () => { assert.equal(n5.isPublicSafeEvidence({ text: 'public', path: 'repo/x.cjs', component: 'a' }), true); assert.equal(n5.isPublicSafeEvidence({ text: 'private token=abc', path: 'repo/x.cjs', component: 'a' }), false); assert.equal(n5.isPublicSafeEvidence({ text: 'public', path: '/private/x', component: 'a' }), false); assert.equal(n5.isPublicSafeEvidence({ text: 'public', path: 'repo/x.cjs', component: 'provider-secret' }), false); });
test('DF is not a second queue and ambiguous records fail closed', () => { const parent = { pending_work: [], current_work: [], deferred_findings: [], terminal: [], owner_detail: 'safe' }; assert.equal(n5.registerDeferredFinding({ parent, finding: { id: 'f', materiality: 'nonblocking', component: '', text: 'x' }, triggers: n5.DF_TRIGGERS }).code, 'N5_DF_AMBIGUOUS'); const finding = n5.classifyFinding({ id: 'f', source_pr: 1, source_thread: 'thread-1', source_candidate: { pr_number: 1, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) }, component: 'x', path: 'repo/x.cjs', text: 'x', predicates: {} }).finding; const valid = n5.registerDeferredFinding({ parent, finding, triggers: n5.DF_TRIGGERS }); assert.equal(valid.code, 'N5_DF_REGISTERED'); assert.equal(valid.parent.pending_work.length, 0); assert.equal(valid.record.linked_child, null); });
test('frozen/current DF promotion needs controller decision', () => { const parent = { pending_work: [], current_work: [], deferred_findings: [], terminal: [], owner_detail: 'safe' }; const finding = n5.classifyFinding({ id: 'frozen-finding', source_pr: 1, source_thread: 'thread-1', source_candidate: { pr_number: 1, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) }, component: 'x', path: 'repo/x.cjs', text: 'x', predicates: {} }).finding; const materialFinding = n5.classifyFinding({ id: 'frozen-finding', source_pr: 1, source_thread: 'thread-1', source_candidate: { pr_number: 1, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) }, component: 'x', path: 'repo/x.cjs', text: 'x', predicates: Object.fromEntries(n5.A4_MATERIAL_PREDICATES.map((key) => [key, true])) }).finding; const registered = n5.registerDeferredFinding({ parent, finding, triggers: n5.DF_TRIGGERS }); const r = n5.revalidateDeferredFinding({ record: registered.record, fresh_finding: materialFinding, material: true, compatible_child: { issue_number: 1, direct: true, compatible: true, frozen: true, lifecycle: 'current' } }); assert.equal(r.code, 'N5_AUTHORITY_REQUIRED'); });
test('body limit never fabricates threshold', () => { assert.equal(n5.classifyBodyLimit('x', { value: '65536', unit: 'bytes', provenance: 'unknown' }).known, false); assert.equal(n5.classifyBodyLimit('x', { value: 65536, unit: 'bytes', provenance: 'verified-github-transport' }).known, true); assert.equal(n5.classifyBodyLimit('x'.repeat(10), { value: 5, unit: 'bytes', provenance: 'verified-github-transport' }).code, 'PARENT_BODY_LIMIT'); });
test('transaction contract is serialized and not arbitrary-editor CAS', () => { const c = n5.transactionContract(); assert.equal(c.endpoint_cas_claim, false); assert.equal(c.serial_toolkit_owner, true); assert.equal(c.blind_retry, false); assert.equal(c.readback_required, true); assert.equal(c.key, 'repository+parent'); });
test('Auto-code readiness performs no install schedule claim or launch', () => { const r = n5.autoCodeReadiness({ governance: 'enabled', tracker_valid: true, review_inventory_complete: true }); assert.equal(r.install_attempted, false); assert.equal(r.schedule_attempted, false); assert.equal(r.worker_claimed, false); });
test('historical caller-cache symbols are absent from N5 runtime', () => { const source = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-github-governance-review-reconciler.cjs'), 'utf8'); assert.doesNotMatch(source, /getPairedRecords|evaluateWrapper|callerTokenCache/); });
test('one next action has no generic authority class', () => { assert.deepEqual(n5.nextAction('N5_RECONCILED'), { next_action: 'READY_FOR_WEB_EXACT_HEAD_VALIDATION' }); assert.doesNotMatch(JSON.stringify(n5.authorityBoundary()), /web_controller/); });

test('bounded CURRENT authority packet validates, round-trips, updates and exposes without history', () => {
  const packet = authorityPacket();
  const state = trackerState(packet);
  assert.equal(n5.validateAuthorityPacketCurrent(packet, { repository: state.repository, parent_issue: state.parent_issue, child_issue: 435 }), true);
  assert.equal(n5.validateTracker(state).ok, true);
  const body = n5.renderManagedBlock('parent', state);
  const parsed = n5.parseManagedBlock(body, 'parent');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, state);
  assert.deepEqual(n5.boundedProjection(state, parsed).current_work[0].authority_packet_current, packet);
  assert.deepEqual(Object.keys(packet).sort(), ['authority', 'candidate', 'child_issue', 'consumer', 'human_owner', 'lane_id', 'parent_issue', 'predecessors', 'repository', 'schema'].sort());
  assert.equal(Object.prototype.hasOwnProperty.call(packet, 'body'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(packet, 'findings'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(packet, 'history'), false);

  const updated = n5.applyBoundedUpdate(trackerState(null), { child_id: 'child-435' }, { type: 'set_field', field: 'authority_packet_current', value: packet });
  assert.equal(updated.ok, true, updated.code);
  assert.deepEqual(updated.state.current_work[0].authority_packet_current, packet);
  const absent = n5.parseManagedBlock(n5.renderManagedBlock('parent', trackerState(null)), 'parent');
  assert.equal(absent.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(absent.state.current_work[0], 'authority_packet_current'), false);
});

test('CURRENT packet rejects unknown, recursive and non-current shapes', () => {
  const packet = authorityPacket();
  const unknown = authorityPacket({ body: 'not allowed' });
  assert.equal(n5.validateAuthorityPacketCurrent(unknown), false);
  const recursive = authorityPacket();
  recursive.predecessors[0].predecessors = [];
  assert.equal(n5.validateAuthorityPacketCurrent(recursive), false);
  const pending = trackerState(null);
  pending.current_work = [];
  pending.pending_work = [{ child_id: 'child-435', issue_number: 435, lifecycle: 'pending', queue_order: 1, authority_packet_current: packet }];
  assert.equal(n5.validateTracker(pending).ok, false);
});
