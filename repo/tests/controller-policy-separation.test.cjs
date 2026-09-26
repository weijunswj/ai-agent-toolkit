'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const controller = fs.readFileSync(path.join(repoRoot, 'repo', 'CONTROLLER.md'), 'utf8');
const architecture = fs.readFileSync(path.join(repoRoot, 'repo', 'ARCHITECTURE.md'), 'utf8');
const registry = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v2.json'),
  'utf8'
));

const requiredRoutes = ['G_FRAME', 'G0', 'G1', 'G1_RECONVERGENCE', 'G2', 'G3', 'G4', 'FINAL_AUDIT', 'BROWSER'];

test('controller bootstrap does not manufacture Toolkit or merge authority', () => {
  assert.match(controller, /Reading this file.*does not itself make the target repository Toolkit-managed.*grants no merge, close, or repository-finality authority/s);
  assert.match(controller, /Toolkit governance applies only when current explicit User\/Web direction or durable repository\/programme authority establishes that binding/);
  assert.match(controller, /GitHub permissions, connector\/CLI access, or the ability to push are transport capabilities only/);
  assert.match(controller, /default delivery stops at a reviewable pull request/);
  assert.match(controller, /mark it Ready for Review when appropriate and leave merge\/finality to repository maintainers/);
  assert.match(controller, /Before deciding whether Toolkit governance applies, bind the exact repository named by the user as the controller repository fence/);
  assert.match(controller, /This one-repository fence applies to both Toolkit-governed and non-Toolkit work/);
});

test('controller stage policy is provider/model agnostic', () => {
  assert.match(controller, /## Stage and stack routing/);
  assert.match(controller, /Concrete provider\/model\/reasoning choices live in the cold stack registry/);
  for (const stack of Object.values(registry.stacks)) {
    for (const route of Object.values(stack.routes)) {
      assert.equal(controller.includes(route.model), false, `model leaked into Controller law: ${route.model}`);
      assert.equal(architecture.includes(route.model), false, `model leaked into Architecture law: ${route.model}`);
      if (route.subagent) {
        assert.equal(controller.includes(route.subagent.model), false, `subagent model leaked into Controller law: ${route.subagent.model}`);
        assert.equal(architecture.includes(route.subagent.model), false, `subagent model leaked into Architecture law: ${route.subagent.model}`);
      }
    }
  }
});

test('stack registry has explicit complete symbolic routes and only G0/G3 subagent bindings', () => {
  assert.equal(registry.schema, 'toolkit.controller.stack-registry.v2');
  assert.equal(registry.version, 2);
  for (const [stackId, stack] of Object.entries(registry.stacks)) {
    assert.deepEqual(Object.keys(stack.routes), requiredRoutes, `${stackId} route presentation order`);
    assert.equal(Object.hasOwn(stack, 'subagents'), false, `${stackId} must use stage-local subagent routes`);
    for (const [role, route] of Object.entries(stack.routes)) {
      assert.equal(typeof route.provider, 'string');
      assert.ok(route.provider.length > 0);
      assert.equal(typeof route.model, 'string');
      assert.ok(route.model.length > 0);
      assert.equal(typeof route.reasoning, 'string');
      assert.ok(route.reasoning.length > 0);
      if (['G0', 'G3'].includes(role)) {
        assert.equal(Object.hasOwn(route, 'subagent'), true, `${stackId}.${role} must expose its child route locally`);
      } else {
        assert.equal(Object.hasOwn(route, 'subagent'), false, `${stackId}.${role} cannot expose a semantic child route`);
      }
    }
  }
});

test('stack registry keeps reconvergence next to G1 and nests child routes under G0/G3', () => {
  assert.deepEqual(requiredRoutes, ['G_FRAME', 'G0', 'G1', 'G1_RECONVERGENCE', 'G2', 'G3', 'G4', 'FINAL_AUDIT', 'BROWSER']);
  for (const [stackId, stack] of Object.entries(registry.stacks)) {
    assert.deepEqual(Object.keys(stack.routes), requiredRoutes, stackId);
    assert.equal(Object.hasOwn(stack, 'subagents'), false, stackId);
    assert.equal(Object.hasOwn(stack.routes.G0, 'subagent'), true, stackId);
    assert.equal(Object.hasOwn(stack.routes.G3, 'subagent'), true, stackId);
    for (const role of requiredRoutes.filter((role) => !['G0', 'G3'].includes(role))) {
      assert.equal(Object.hasOwn(stack.routes[role], 'subagent'), false, `${stackId}.${role}`);
    }
  }
});

test('named stacks support explicit cross-harness selection without harness authority', () => {
  for (const stackId of ['owner-openai-default', 'owner-claude', 'owner-mixed-claude-gpt']) {
    assert.ok(registry.stacks[stackId], `missing named stack: ${stackId}`);
  }
  assert.equal(Object.hasOwn(registry.stacks, 'owner-deepseek'), false);
  assert.equal(Object.hasOwn(registry.stacks, 'owner-mixed-openai-deepseek'), false);
  assert.match(controller, /Root stack selection is an explicit User\/Web execution decision and is independent of the physical harness/);
  assert.match(controller, /HARNESS_HANDOFF_REQUIRED/);
  assert.match(controller, /subagent semantic prompt names the role\/capability, not a concrete model/i);
  assert.match(architecture, /Stack selection and physical harness selection are orthogonal/);
  assert.match(architecture, /logical lane may hand off between qualified harnesses/);
});

test('Web route recommendations are advisory and exact Owner-approved overrides do not change semantic authority', () => {
  assert.match(controller, /Web route recommendation/);
  assert.match(controller, /concrete current-run evidence that the selected provider\/model\/reasoning route may be materially too light/);
  assert.match(controller, /AUTHORITY_EFFECT=NONE/);
  assert.match(controller, /OWNER_APPROVAL_REQUIRED=YES/);
  assert.match(controller, /Recommendation alone never changes routing/);
  assert.match(controller, /After explicit Owner approval/);
  assert.match(controller, /one-run\/stage-episode route override/);
  assert.match(controller, /safe worker launch\/adoption\/replacement boundary/);
  assert.match(controller, /not a new named stack or silent fallback/);
  assert.match(controller, /must not hot-swap a running semantic worker/);
  assert.match(controller, /resets no attempt\/budget/);
  assert.match(controller, /cannot substitute for missing G1\/G2\/evidence authority or create an automatic escalation stage/);
  assert.match(architecture, /recommendation has no authority effect/);
  assert.match(architecture, /explicit Owner approval/);
  assert.match(architecture, /bounded orchestration overlay, not a new stack, fallback chain or semantic escalation stage/);
});

test('root workers never self-verify model identity while G0/G3 parents configure child routes before launch', () => {
  assert.match(controller, /Root execution threads are bound.*out of band by User\/Web\/controller\/harness before launch or adoption/s);
  assert.match(controller, /root semantic worker must never resolve, inspect, verify, attest, compare, reject, or HOLD on its own provider\/model\/reasoning identity/i);
  assert.match(controller, /regardless of whether the harness exposes model metadata/i);
  assert.match(controller, /inability to introspect its own model can never create either HOLD/i);
  assert.doesNotMatch(controller, /current harness cannot launch and verify it/i);
  assert.match(controller, /Only `G0` and `G3` may resolve semantic subagent routes/);
  assert.match(controller, /parent\/launcher resolves the concrete child provider\/model\/reasoning route.*before child creation/s);
  assert.match(controller, /spawned child never self-attests after launch/i);
  assert.match(controller, /Silent provider\/model\/reasoning substitution remains prohibited.*controller\/launcher boundary/s);
  assert.match(controller, /root semantic prompts.*do not carry concrete provider\/model\/reasoning verification obligations/i);
  assert.match(architecture, /Root model\/route selection is an out-of-band User\/Web\/controller\/harness act/i);
  assert.match(architecture, /root semantic worker never verifies or attests its own model identity/i);
  assert.match(architecture, /parent\/launcher resolves the concrete child route.*before child creation/s);
  assert.match(architecture, /spawned children never self-attest after launch/i);
});

test('ordinary semantic executors receive bounded authority instead of being told to read the full Controller', () => {
  assert.match(controller, /Full `repo\/CONTROLLER\.md` retrieval is a control-plane responsibility/);
  assert.match(controller, /Ordinary G0\/G1\/G2\/G3\/G4 root executors and subagents must not be instructed to read\/apply the full Controller as a prerequisite/);
  assert.match(controller, /bounded stage\/task\/authority packet plus the smallest relevant repository instructions\/playbooks/);
  assert.match(controller, /Reading the Controller never grants worker authority/);
  assert.match(architecture, /full Controller is control-plane source material and is not a default worker prerequisite/i);
});

test('Claude stack mirrors current OpenAI role classes without leaking model names into policy', () => {
  const claude = registry.stacks['owner-claude'];
  assert.equal(new Set(Object.values(claude.routes).map((route) => route.model)).size, 1);
  assert.equal(claude.routes['G_FRAME'].reasoning, 'high');
  assert.equal(claude.routes['G0'].reasoning, 'medium');
  assert.equal(claude.routes.G1.reasoning, 'high');
  const openai = registry.stacks['owner-openai-default'];
  for (const [role, route] of Object.entries(openai.routes)) {
    if (route.model === 'gpt-6-sol') assert.equal(route.reasoning, 'max', `OpenAI Sol route must be max: ${role}`);
  }
  assert.equal(registry.stacks['owner-openai-default'].routes.G1.reasoning, 'max');
  assert.equal(registry.stacks['owner-openai-default'].routes.G2.reasoning, 'high');
  assert.equal(claude.routes.G2.reasoning, 'high');
  assert.equal(claude.routes.G3.reasoning, 'medium');
  assert.equal(claude.routes.G4.reasoning, 'xhigh');
  assert.equal(claude.routes.G1_RECONVERGENCE.reasoning, 'high');
  assert.equal(claude.routes.FINAL_AUDIT.reasoning, 'max');
  assert.equal(claude.routes.BROWSER.reasoning, 'high');
  assert.equal(claude.routes.G0.subagent.reasoning, 'medium');
  assert.equal(claude.routes.G3.subagent.reasoning, 'medium');
});

test('mixed Claude/GPT stack uses Opus for framing/G1 and every OpenAI Luna Max worker slot', () => {
  const openai = registry.stacks['owner-openai-default'];
  const mixed = registry.stacks['owner-mixed-claude-gpt'];
  assert.ok(mixed);

  assert.deepEqual(mixed.routes.G_FRAME, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(mixed.routes.G1, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(mixed.routes.G1_RECONVERGENCE, mixed.routes.G1);

  for (const role of requiredRoutes) {
    if (['G_FRAME', 'G1', 'G1_RECONVERGENCE'].includes(role)) continue;
    const openaiRoute = openai.routes[role];
    const mixedRoute = mixed.routes[role];
    const openaiRoot = { provider: openaiRoute.provider, model: openaiRoute.model, reasoning: openaiRoute.reasoning };
    const mixedRoot = { provider: mixedRoute.provider, model: mixedRoute.model, reasoning: mixedRoute.reasoning };

    if (openaiRoot.provider === 'openai' && openaiRoot.model === 'gpt-6-luna' && openaiRoot.reasoning === 'max') {
      assert.deepEqual(mixedRoot, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'medium' }, `mixed Luna replacement mismatch: ${role}`);
    } else {
      assert.deepEqual(mixedRoot, openaiRoot, `mixed route must mirror OpenAI for ${role}`);
    }

    if (['G0', 'G3'].includes(role)) {
      const openaiSubagent = openaiRoute.subagent;
      const mixedSubagent = mixedRoute.subagent;
      if (openaiSubagent && openaiSubagent.provider === 'openai' && openaiSubagent.model === 'gpt-6-luna' && openaiSubagent.reasoning === 'max') {
        assert.deepEqual(mixedSubagent, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'medium' }, `mixed Luna subagent replacement mismatch: ${role}`);
      } else {
        assert.deepEqual(mixedSubagent, openaiSubagent, `mixed subagent route must mirror OpenAI for ${role}`);
      }
    }
  }
});
test('G1_RECONVERGENCE always inherits the selected stack G1 route', () => {
  for (const [stackId, stack] of Object.entries(registry.stacks)) {
    assert.deepEqual(stack.routes.G1_RECONVERGENCE, stack.routes.G1, stackId);
  }
  assert.match(controller, /G1_RECONVERGENCE.*uses exactly the selected stack's `G1` provider\/model\/reasoning route/);
  assert.match(controller, /not an independent model-strength tier/);
  assert.match(architecture, /uses exactly the selected stack's G1 provider\/model\/reasoning route/);
});

test('OpenAI G2 is Astra High and current G2 has no automatic higher-reasoning retry', () => {
  const openai = registry.stacks['owner-openai-default'];
  assert.equal(openai.routes.G2.provider, 'openai');
  assert.equal(openai.routes.G2.model, 'gpt-6-astra');
  assert.equal(openai.routes.G2.reasoning, 'high');
  assert.match(controller, /G2 always resolves through the selected named stack's single `G2` route/);
  assert.match(controller, /There is no automatic higher-reasoning G2 retry category/);
  assert.match(controller, /return to Web for causal adjudication rather than automatically spending another model tier/);
  assert.match(controller, /Web may explicitly select another registered stack for a later run when justified/);
});

test('delegation capability is stage law, not model law', () => {
  assert.match(controller, /G0.*G3.*only subagent-capable stages\/roles/s);
  assert.match(controller, /Concrete parent\/child provider\/model\/reasoning bindings come from the explicitly selected stack registry/);
  assert.match(architecture, /Only G0 and G3 may use semantic depth-1 subagents/);
});

test('git publication transport probes do not manufacture publication certainty', () => {
  assert.match(controller, /Transport availability is operation-local and point-in-time/);
  assert.match(controller, /Successful `gh` access or a successful Git probe such as `git ls-remote` does not prove that a later `git push` route will remain available/);
  assert.match(controller, /preserve the exact immutable candidate.*transport infrastructure, not an implementation\/candidate defect/s);
  assert.match(controller, /consume no implementation\/correction budget/);
  assert.match(controller, /Re-establish the required Git transport before retry/);
  assert.match(controller, /If publication outcome is ambiguous, reconcile the remote ref\/readback first/);
});

test('executor transport keeps gh escalation separate from sandbox-native git publication', () => {
  assert.match(controller, /`gh` may require executor-side escalation/);
  assert.match(controller, /specific to `gh`, not to all Git\/GitHub transport/);
  assert.match(controller, /including an authorised `git push`, without `gh` escalation/);
  assert.match(controller, /Do not reject or reroute an authorised `git push` merely because `gh` is the escalated GitHub CLI path/);
  assert.match(controller, /Transport does not grant authority/);
});

test('github presentation mechanics stay in renderer automation, not Controller law', () => {
  for (const presentationToken of ['[ PARENT THREAD ]', 'delivery-child', 'deferred-child']) {
    assert.equal(controller.includes(presentationToken), false, `presentation token leaked into Controller law: ${presentationToken}`);
  }
  assert.match(controller, /authorised renderer\/schema owns concrete presentation mechanics/);
  assert.match(architecture, /Presentation structure, title prefixes, display ordering\/numbering and wording conventions belong to the authorised renderer\/schema/);
});

test('stack registry has no default stack or authoritative service tier', () => {
  assert.equal(Object.hasOwn(registry, 'default_stack'), false);
  for (const stack of Object.values(registry.stacks)) {
    for (const route of Object.values(stack.routes)) {
      assert.equal(Object.hasOwn(route, 'tier'), false);
      if (route.subagent) assert.equal(Object.hasOwn(route.subagent, 'tier'), false);
    }
  }
});

test('convergence-first roles are represented without widening delegation', () => {
  assert.match(controller, /G_FRAME.*problem framing/s);
  assert.match(controller, /G2.*adversarial executable-contract closure/s);
  assert.match(controller, /G1_RECONVERGENCE.*read-only.*not a gate/s);
  assert.match(architecture, /Reconverged correction exception/);
  assert.match(architecture, /Web-directed continuation after autonomous exhaustion/);
  assert.match(controller, /WEB_DIRECTED_CONTINUATION/);
  assert.match(controller, /does not automatically spend a higher-model `G1_RECONVERGENCE` call/);
});

test('shipping-first policy is singular, ordered, and retains canonical Shipping Law', () => {
  const heading = '## Shipping-first scope and repair decisions';
  assert.equal(controller.split(heading).length - 1, 1);
  assert.ok(controller.indexOf(heading) < controller.indexOf('## Structural-change law'));
  assert.match(controller, /Apply the canonical \[Shipping Law\]\(contracts\/agent-rules\/ai-coding-agent-execution\.md#shipping-law\)/);
});

test('shipping scope admission preserves minimum safety, acceptance, and blocker evidence', () => {
  assert.match(controller, /smallest usable outcome, supported environment, applicable minimum safety floor and explicit acceptance criteria/);
  assert.match(controller, /concrete failure evidence or a critical evidence gap, and the consequence for this shipment/);
  assert.match(controller, /Existing criteria and blockers require evidence-backed User\/Web adjudication before reclassification; exhaustion or deadline pressure is not grounds to weaken the floor/);
});

test('POST_SHIP findings retain ownership without granting authority or forcing repair', () => {
  assert.match(controller, /Preserve each material `POST_SHIP` finding with its original evidence, disposition\/reason and exactly one verified continuing owner/);
  assert.match(controller, /Deferral grants no implementation authority/);
  assert.match(controller, /Non-blocking follow-ups alone must not cause G4 AMEND, current repair or repair-budget consumption; G4 may PASS with such follow-ups only when all applicable assurance obligations are satisfied/);
});

test('shipping repair routing distinguishes settled G3, targeted G2, G1, and evidence work', () => {
  assert.match(controller, /existing authorised G3 correction path when the accepted contract already settles the required behaviour, trust boundary, mutation scope and validation/);
  assert.match(controller, /Missing semantic, coverage or implementation-boundary decisions require a targeted G2 amendment; a changed root model, architecture or trust ordering requires bounded G1 re-entry/);
  assert.match(controller, /Evidence-only failure calls for bounded evidence acquisition, not automatic code repair/);
});

test('shipping repair routing preserves exhausted history and candidate limits', () => {
  assert.match(controller, /Repair routing does not reset budgets, grant another candidate, create Repair 3 or waive an explicitly required fresh G2 for an exceptional continuation/);
  assert.match(controller, /Same implementation lineage has a maximum of 2 corrections regardless of run, head, branch, or renamed repair label/);
  assert.match(controller, /After 2\/2, a same-lineage material defect => `NON_CONVERGENCE_DECISION_REQUIRED`; no Repair-3 alias\/reset/);
  assert.match(controller, /Each grant authorises at most one bounded implementation candidate plus its required fresh G4/);
  assert.match(controller, /Monotonic Web-directed continuation chain/);
  assert.match(controller, /durable continuation-chain\/root-family identity plus the unresolved accepted blocker set/);
  assert.match(controller, /Repeated materially equivalent G4 rejection.*root\/Owner adjudication/s);
  assert.match(controller, /Do not impose a crude cumulative numeric cap/);
});

test('post-Web-directed G4 amend defaults to targeted G2 reclosure before another grant', () => {
  assert.match(controller, /Post-Web-directed G4 reclosure default/);
  assert.match(controller, /material `G4_AMEND`.*fresh targeted G2 reclosure.*exact material G4 counterexamples/s);
  assert.match(controller, /deterministic regressions plus positive controls/);
  assert.match(controller, /production-boundary evidence/);
  assert.match(controller, /changed root\/trust\/architecture model requires G1 re-entry/);
  assert.match(controller, /`G2_CONTRACT_COVERAGE_MISS` requires targeted G2 re-entry under the selected stack's normal `G2` route/);
  assert.match(controller, /Narrow G2-reuse exception/);
  assert.match(controller, /every exact material G4 counterexample.*executable G2 invariant.*regression plus positive-control obligation.*production-boundary evidence requirement.*validation criterion/s);
  assert.match(controller, /`MECHANISM_COMPLETENESS_ALREADY_BOUND=YES`/);
  assert.match(controller, /mechanism covers the counterexample family/);
  assert.match(controller, /`MECHANISM_COMPLETENESS_UNPROVEN` forces targeted G2\./);
  assert.match(controller, /`G3_IMPLEMENTATION_MISS` label alone is insufficient/);
  assert.match(controller, /G2 reclosure grants no mutation authority, budget reset, new lineage or automatic follow-on/);
});

test('G4 repair handoff retains complete evidence and independent follow-up obligations', () => {
  assert.match(controller, /actual and required observable results; affected consequential\/equivalent surfaces and unexamined areas; regression and positive-control obligations/);
  assert.match(controller, /Mark unexamined material areas explicitly; do not infer assurance from silence/);
  assert.match(controller, /Keep the original complete G4 packet unchanged/);
  assert.match(controller, /Fresh follow-up G4 receives prior findings and reproducers as evidence, independently verifies the current exact candidate and affected interactions/);
  assert.match(controller, /There is no finding quota or rejection limit/);
});

test('G3 leaf guidance preserves fixed interfaces, isolation, and serial parent integration', () => {
  assert.match(controller, /depth-one leaves only for genuinely independent slices with fixed interfaces, explicit expected results, disjoint mutation ownership, isolated workspaces, tests and an integration order/);
  assert.match(controller, /parent owns serial integration, combined validation and candidate publication; leaves do not race to push the delivery branch/);
  assert.match(controller, /Serial execution is valid when fan-out is unsupported or not useful, and active worker contracts are not retroactively widened/);
});

test('G0 differential evidence starts from known-good and keeps incidental environment failures out of the root model', () => {
  assert.match(controller, /Known-good vs production differential/);
  assert.match(controller, /when a qualified path works but production fails and the causal question is not already sufficiently framed, `G_FRAME` records the material differences/);
  assert.match(controller, /known-good positive control/);
  assert.match(controller, /real production entry point/);
  assert.match(controller, /`G0` then prefers one bounded differential experiment/);
  assert.match(controller, /When the supplied framing already contains those facts, G0 may proceed directly without a ceremonial G_FRAME invocation\./);
  assert.match(controller, /Serial one-delta probes are fallback-only when a prior boundary blocks deeper observation/);
  assert.match(controller, /Incidental environment\/check\/transport failure does not replace the causal question/);
  assert.match(architecture, /known-good qualified path succeeds while the real production path fails/);
});

test('active legacy lineages adopt current governance only at safe boundaries without resetting history', () => {
  assert.match(controller, /still-required lineage admitted under older governance.*next safe terminal\/reconciliation boundary/s);
  assert.match(controller, /never by rewriting an in-flight worker/);
  assert.match(controller, /Preserve child\/root\/continuation identity, consumed budgets\/attempts, historical evidence\/candidates and original gate outcomes/);
  assert.match(controller, /Newer governance alone does not reopen accepted architecture\/contract or reset history/);
  assert.match(architecture, /compatible stricter current governance is adopted prospectively/);
});

test('later-required candidates and evidence survive disposable execution teardown', () => {
  assert.match(controller, /Before disposable execution teardown/);
  assert.match(controller, /preserve every later-required exact candidate and non-repository evidence/);
  assert.match(controller, /prove the later consumer can recover it/);
  assert.match(controller, /Temporary paths, chat memory, digest-only evidence or disappearing uncommitted state are insufficient/);
  assert.match(controller, /publication is not implied/i);
  assert.match(architecture, /Before a disposable execution surface is destroyed/);
});

test('ordinary coding path keeps exception mechanics exceptional', () => {
  assert.match(controller, /ordinary coding path is `G1 -> G2 -> G3 in-gate convergence -> G4 -> Web finality`/);
  assert.match(controller, /G0, targeted re-entry, G1_RECONVERGENCE, HOLD recovery and Web-directed continuation are exception mechanics/);
  assert.match(controller, /Repeated exception use without material blocker\/root reduction returns to the responsible root\/Owner boundary/);
});

test('causal negative controls cannot manufacture the consequential outcome they claim to prove', () => {
  assert.match(controller, /Causal negative-control oracle/);
  assert.match(controller, /instrumentation may expose\/synchronise X but must not manufacture Y/);
  assert.match(controller, /missing observation fails/i);
  assert.match(controller, /constructed\/fallback\/cleanup\/fault-injection evidence from another actor cannot substitute/);
  assert.match(architecture, /causal negative-control requirements that prove the named production actor caused the consequential observation/);
});

test('async waiters and deferred work require adversarial progress and truthful outstanding-work accounting', () => {
  assert.match(controller, /Async\/liveness validation/);
  assert.match(controller, /deterministic waiter-first control/);
  assert.match(controller, /later completion requires event-loop\/I\/O\/timer\/callback progress/);
  assert.match(controller, /Already-complete-before-waiter is insufficient alone/);
  assert.match(controller, /non-zero outstanding work without a progress signal fails loudly/);
  assert.match(controller, /Deferred-work accounting/);
  assert.match(controller, /remains outstanding until real consequential completion/);
  assert.match(controller, /Cancelling its scheduler does not erase it/);
  assert.match(controller, /Flush either permits the normal dispatch or takes ownership of that same work/);
});

test('logical identities that alias one consequential resource are closed before G3', () => {
  assert.match(controller, /Resource-equivalence identity/);
  assert.match(controller, /distinct accepted identities can address the same resource/);
  assert.match(controller, /one resource-equivalence identity or explicit alias semantics before G3/);
  assert.match(controller, /do not generalise beyond the resource's actual rules/);
  assert.match(architecture, /distinct accepted logical identities can address the same underlying resource/);
});

test('universal invariants require mechanism-complete enforcement and observable boundaries', () => {
  assert.match(controller, /Mechanism completeness \/ observability/);
  assert.match(controller, /universal\/arbitrary\/unknown claims/);
  assert.match(controller, /name the enforcement mechanism and prove it complete under actual runtime observability/);
  assert.match(controller, /Finite hooks\/detectors\/brands\/APIs\/events do not prove universal coverage unless exhaustiveness is established/);
  assert.match(controller, /required post-exposure state is not generically observable/);
  assert.match(controller, /complete trusted boundary/);
  assert.match(controller, /post-hoc detection cannot substitute/);
  assert.match(architecture, /Mechanism completeness is distinct from semantic correctness/);
  assert.match(architecture, /Post-hoc detector coverage is not a substitute for observability the platform does not provide/);
});

test('blocking findings attribute the causal layer instead of collapsing everything into G3 implementation', () => {
  assert.match(controller, /Failure attribution/);
  assert.match(controller, /OWNER=PRODUCT\|CONTRACT\|TOOLKIT\|HARNESS\|ENVIRONMENT\|UNKNOWN/);
  assert.match(controller, /PRODUCT_SEMANTICS_PROVEN_BAD=YES\|NO/);
  assert.match(controller, /G3_IMPLEMENTATION_MISS.*OWNER=PRODUCT.*candidate semantics themselves violate an accepted invariant/s);
  assert.match(controller, /Contract\/completeness\/proof-model defects are CONTRACT\/G2/);
  assert.match(controller, /Toolkit, harness and environment defects do not consume product\/G3 correction budget/);
  assert.match(controller, /UNKNOWN.*bounded diagnosis rather than blind candidate mutation/);

  assert.match(architecture, /OWNER=PRODUCT/);
  assert.match(architecture, /OWNER=CONTRACT/);
  assert.match(architecture, /OWNER=TOOLKIT/);
  assert.match(architecture, /OWNER=HARNESS/);
  assert.match(architecture, /OWNER=ENVIRONMENT/);
  assert.match(architecture, /OWNER=UNKNOWN/);
  assert.match(architecture, /product convergence and delivery-machinery convergence remain distinguishable/);
});

test('broken verifier substitution preserves the invariant and separate defect ownership', () => {
  assert.match(controller, /Equivalent evidence for a broken verifier/);
  assert.match(controller, /not itself an unresolved required product\/security\/finality deliverable/);
  assert.match(controller, /same unchanged invariant.*same consequential boundary or a proven faithful equivalent/s);
  assert.match(controller, /same positive\/negative\/effect obligations/);
  assert.match(controller, /normal independent review/);
  assert.match(controller, /verifier defect remains separately owned/);
  assert.match(controller, /PRODUCT_SEMANTICS_PROVEN_BAD=NO/);

  assert.match(architecture, /known-broken canonical verifier may be replaced by bounded equivalent evidence/);
  assert.match(architecture, /required positive\/negative\/adversarial and effect\/zero-effect semantics/);
  assert.match(architecture, /allow product delivery to continue.*defect remains separately owned and unresolved/s);
  assert.match(architecture, /validation\/evidence block with product semantics not proven bad/);
});

test('fresh G4 attacks the enforcement mechanism itself and routes observer incompleteness back to G2', () => {
  assert.match(controller, /MECHANISM_COMPLETENESS_UNPROVEN/);
  assert.match(controller, /detector\/interceptor\/hook\/brand\/parser\/ledger mechanisms/);
  assert.match(controller, /equivalent violating path that avoids the candidate observer/);
  assert.match(controller, /targeted G2 re-entry, not a new gate/);
  assert.match(architecture, /vary how the same forbidden semantic state is produced, not only the input value/);
  assert.match(architecture, /different lexical identity/);
  assert.match(architecture, /ordinary construction instead of an intercepted API/);
  assert.match(architecture, /state change that leaves watched shape\/prototype evidence unchanged/);
  assert.match(architecture, /return to targeted G2 before another G3/);
});

test('same-root G2 contract defects converge inside one G2 episode instead of chaining fresh G2 runs', () => {
  assert.match(controller, /G2 in-gate convergence/);
  assert.match(controller, /challenge -> refine -> challenge/);
  assert.match(controller, /defect found in G2's own draft contract is ordinary in-gate refinement/);
  assert.match(controller, /not by itself `G2_AMEND` or authority for a fresh same-root G2 RUN\/Lock/);
  assert.match(controller, /G2_PASS/);
  assert.match(controller, /G2_HOLD/);
  assert.match(controller, /G2_REENTRY_REQUIRED/);
  assert.match(controller, /G2_NONCONVERGED/);
  assert.match(controller, /do not manufacture another materially equivalent G2 merely by issuing a new RUN\/Lock/);
  assert.match(architecture, /Discovering a defect in that proposed contract is not itself a terminal AMEND/);
  assert.match(architecture, /Renaming RUN\/Lock without materially changed input does not create another admissible G2 episode/);
});

test('G2 cannot drop mandatory requirements when freezing the candidate contract', () => {
  assert.match(controller, /Mandatory requirement coverage closure/);
  assert.match(controller, /every current mandatory acceptance criterion, inherited blocker\/defect family and still-required contract obligation exactly once/);
  assert.match(controller, /IMPLEMENT_IN_THIS_CANDIDATE/);
  assert.match(controller, /ALREADY_SATISFIED_WITH_EXACT_EVIDENCE/);
  assert.match(controller, /UNCHANGED_REQUIRED_CONSUMER/);
  assert.match(controller, /OUT_OF_SCOPE_WITH_EXPLICIT_CONTINUING_OWNER/);
  assert.match(controller, /Missing, duplicate\/conflicting, unevidenced or proof-less current rows are `G2_CONTRACT_COVERAGE_MISS`/);
  assert.match(architecture, /one complete current-requirement coverage manifest/);
  assert.match(architecture, /requirement -> invariant -> consequential boundary -> affected consumers\/surfaces -> negative regression -> positive control -> G3 executable proof -> G4 assurance surface/);
});

test('public-boundary and compatibility claims close bypasses and use predecessor-produced evidence', () => {
  assert.match(controller, /Public-surface \/ predecessor-compatibility closure/);
  assert.match(controller, /enumerate exported\/callable aliases and materially reachable alternate routes/);
  assert.match(controller, /every public\/reachable route must use the accepted enforcement/);
  assert.match(controller, /immutable bytes\/artifacts produced by an exact accepted predecessor producer and consumed unchanged by the candidate/);
  assert.match(controller, /candidate-regenerated equivalents are insufficient/);
  assert.match(architecture, /callable-surface inventory/);
  assert.match(architecture, /predecessor-produced bytes\/artifacts from an exact accepted producer revision consumed unchanged by the candidate/);
});

test('canonical equivalence and rejection noninterference are consequential evidence, not eventual-error checks', () => {
  assert.match(controller, /Canonical equivalence \/ rejection noninterference/);
  assert.match(controller, /semantically equivalent accepted representations canonicalise before consequential identity\/digest\/hash\/signature comparison/);
  assert.match(controller, /eventual rejection is insufficient/);
  assert.match(controller, /getters, Proxy traps, coercion, iterators, serialization hooks or callbacks/);
  assert.match(controller, /zero prohibited executions at the real boundary/);
  assert.match(architecture, /canonicalisation rule applied before identity\/digest\/hash\/signature/);
  assert.match(architecture, /instrumentation proving zero prohibited execution at the real boundary/);
  assert.match(architecture, /final error code alone cannot prove zero execution/);
});

test('universal and no-bypass claims require an explicit mechanism-completeness proof model beyond finite regressions', () => {
  assert.match(controller, /Mechanism-completeness proof model/);
  assert.match(controller, /MECHANISM_COMPLETENESS_PROOF_MODEL/);
  assert.match(controller, /regression breadth cannot establish exhaustiveness by itself/);
  assert.match(controller, /complete trusted-boundary inventory, material state machine, protocol schema, enforcement mapping and falsifiable assumptions/);
  assert.match(controller, /ingress\/egress\/export\/receipt\/binding\/actor\/state transition/);
  assert.match(controller, /multiplicity\/replay\/reordering, malformed evidence, actor\/identity substitution and bypass transitions/);
  assert.match(controller, /MECHANISM_COMPLETENESS_UNPROVEN/);
  assert.match(controller, /conditional on exhaustive claims, not ordinary bounded finite behaviour/);

  assert.match(architecture, /complete trusted-boundary inventory across executable ingress\/egress/);
  assert.match(architecture, /material state-machine artefact/);
  assert.match(architecture, /protocol-schema artefact/);
  assert.match(architecture, /Existing canonical schemas may be referenced rather than duplicated when complete/);
  assert.match(architecture, /dense finite regression matrix remains necessary falsification\/implementation evidence but is not a completeness proof/);
  assert.match(architecture, /coordinator versus actual executor/);
  assert.match(architecture, /G4 directly challenges the proof model/);
});

test('validation cases cannot manufacture later false RED by consuming a shared bounded resource', () => {
  assert.match(controller, /Validation resource non-interference/);
  assert.match(controller, /shared resource\/equivalence identity/);
  assert.match(controller, /which cases consume or mutate it/);
  assert.match(controller, /later oracle's prerequisite state/);
  assert.match(controller, /isolation first, then deterministic reset, then explicit shared-state ordering\/ownership/);
  assert.match(controller, /bounded pacing\/window separation only when the real resource is inherently time-windowed/);
  assert.match(controller, /Do not spoof identities, disable limits, bypass production controls or scatter sleeps/);
  assert.match(controller, /must not make an otherwise-valid later oracle fail merely by consuming its prerequisite shared resource/);

  assert.match(architecture, /validation cases share a materially bounded\/mutable resource/);
  assert.match(architecture, /per-case consumption\/mutation/);
  assert.match(architecture, /rate-limit\/quota windows/);
  assert.match(architecture, /one explicit bounded group\/window boundary/);
  assert.match(architecture, /If the shared interference is itself the behavior under test, declare that intentionally/);
  assert.match(architecture, /validation self-interference is harness\/evidence failure rather than product failure/);
});

test('stateful and async contracts close on named transition regressions, not prose or suite green alone', () => {
  assert.match(controller, /State-transition adversarial closure/);
  assert.match(controller, /each material transition is bound to a named deterministic negative transition regression plus a positive control/);
  assert.match(controller, /relevant interruption\/replacement\/cancellation\/late-completion windows/);
  assert.match(controller, /G3 PASS maps every material G2 invariant to a named executable regression or production-boundary check/);
  assert.match(controller, /green suite without that transition mapping is insufficient/);
  assert.match(architecture, /each material stateful\/async transition, a named deterministic negative transition regression plus positive control/);
  assert.match(architecture, /invariant-to-regression map/);
  assert.match(architecture, /Aggregate suite-green status cannot substitute for this mapping/);
  assert.match(architecture, /pre-commit, partial commit, cleanup, and retry after interruption/);
  assert.match(architecture, /pre-wait, during-wait, replacement\/cancellation, late arrival, and completion after a snapshot\/decision point/);
  assert.match(architecture, /not a mandatory combinatorial matrix/);
});

test('complex G3 work gets conditional adversarial pre-publication validation without adding a gate', () => {
  assert.match(controller, /Conditional G3 adversarial pre-publication validation/);
  assert.match(controller, /sufficiently complex\/STRICT G3 involving concurrency, async\/deferred work, causal controls, lifecycle coordination or identity\/resource mapping/);
  assert.match(controller, /optional depth-1 read-only validation leaf/);
  assert.match(controller, /leaf never mutates or declares completion/);
  assert.match(controller, /parent remains sole integrator\/revalidator/);
  assert.match(controller, /Settled-behaviour RED stays in G3/);
  assert.match(controller, /missing product\/compatibility semantics return to G2/);
  assert.match(controller, /changed root\/trust\/architecture returns to G1/);
  assert.match(architecture, /It is not another gate/);
});

test('commit-required validation sequencing freezes one local candidate before clean-head validators without publishing it', () => {
  assert.match(controller, /Commit-required validation sequencing/);
  assert.match(controller, /accepted validator materially requires immutable commit identity or a clean committed working tree/);
  assert.match(controller, /all meaningful non-commit-dependent checks are green and candidate contents\/mutation scope are frozen/);
  assert.match(controller, /Bind the exact commit\/tree\/parent/);
  assert.match(controller, /prohibit amendment\/rebase\/reconstruction of that candidate identity/);
  assert.match(controller, /Publication remains prohibited until the complete required floor is green/);
  assert.match(controller, /local candidate commit is construction\/custody, not publication, `G3_PASS`, G4 admission, Ready, merge or finality/);
  assert.match(controller, /environment\/transport\/evidence HOLD preserves the exact commit rather than rebuilding it/);
  assert.match(architecture, /COMMIT_REQUIRED_VALIDATION=YES/);
  assert.match(architecture, /create the ordinary immutable local candidate commit under the existing allowance/);
  assert.match(architecture, /Run the identity\/clean-tree-dependent and remaining floor against that exact commit/);
});

test('G3 in-gate convergence keeps ordinary repair inside G3 and bounds same-root thrashing', () => {
  assert.match(controller, /G3 in-gate convergence/);
  assert.match(controller, /3 normal materially distinct substantive recovery attempts and an absolute ceiling of 5/);
  assert.match(controller, /After attempt 3.*attempts 4-5 only when.*materially shrunk.*clearly narrower corrective path/s);
  assert.match(controller, /Attempt 5 is the absolute ceiling/);
  assert.match(controller, /G3_IN_CONTRACT_NONCONVERGENCE/);
  assert.match(controller, /must not publish a knowingly failing candidate/);
  assert.match(controller, /parent remains the sole G3 owner\/integrator/);
  assert.match(controller, /G3_PASS.*complete integrated production-boundary validation floor green/);
  assert.match(controller, /Web alone reconciles and launches fresh G4/);
  assert.match(controller, /Before Web admits fresh G4/);
  assert.match(controller, /zero unresolved required in-contract roots/);
  assert.match(controller, /worker's `G3_PASS` label alone never authorises G4/);
});

test('hosted non-product validation reclosure stays inside G3 while every candidate remains immutable', () => {
  assert.match(controller, /Hosted non-product reclosure inside G3/);
  assert.match(controller, /candidate immutability is per exact candidate identity, not a singleton constraint on the G3 episode/i);
  assert.match(controller, /same RUN\/Lock\/G3 episode/);
  assert.match(controller, /primary owner is `HARNESS`, `TOOLKIT` or `ENVIRONMENT`/);
  assert.match(controller, /`PRODUCT_SEMANTICS_PROVEN_BAD=NO`/);
  assert.match(controller, /failed candidate remains immutable and preserved as evidence/);
  assert.match(controller, /does not consume a product\/G3 correction attempt or reset any historical budget/);
  assert.match(controller, /Product RED remains ordinary G3 convergence/);
  assert.match(controller, /Repeated materially equivalent non-product hosted RED.*returns to Web diagnosis/s);
  assert.match(controller, /hosted non-product reclosure rule.*same G3 RUN\/Lock.*without manufacturing another semantic continuation grant/s);
  assert.match(architecture, /Candidate immutability is per exact candidate identity, not a requirement that the entire G3 episode contain only one candidate/);
  assert.match(architecture, /This is validation reclosure, not product correction/);
  assert.match(architecture, /Every failed candidate remains immutable durable evidence/);
});

test('candidate acceptance, child completion, and per-repository wait removal stay distinct', () => {
  assert.match(controller, /Distinguish candidate acceptance from programme completion/);
  assert.match(controller, /safe independently accepted increment need not wait for unrelated future-owned work, but the continuing child remains open until its required outcomes are complete/);
  assert.match(controller, /release an otherwise unsupported blanket Toolkit wait only after recording that no genuine local safety, evidence, authority or code dependency requires it/);
  assert.match(controller, /Keep named real holds, active-worker protections and all existing permissions\/budgets/);
});

test('shipping policy remains symbolic and preserves existing policy boundaries', () => {
  for (const stack of Object.values(registry.stacks)) {
    for (const route of Object.values(stack.routes)) {
      assert.equal(controller.includes(route.model), false, `model leaked into Controller law: ${route.model}`);
      assert.equal(architecture.includes(route.model), false, `model leaked into Architecture law: ${route.model}`);
    }
  }
  assert.match(controller, /G0.*G3.*only subagent-capable stages\/roles/s);
  assert.match(controller, /Concrete parent\/child provider\/model\/reasoning bindings come from the explicitly selected stack registry/);
  assert.match(architecture, /Only G0 and G3 may use semantic depth-1 subagents/);
});
