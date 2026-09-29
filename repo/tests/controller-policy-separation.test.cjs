'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
      if (route.adversarial_subagent) {
        assert.equal(controller.includes(route.adversarial_subagent.model), false, `adversarial subagent model leaked into Controller law: ${route.adversarial_subagent.model}`);
        assert.equal(architecture.includes(route.adversarial_subagent.model), false, `adversarial subagent model leaked into Architecture law: ${route.adversarial_subagent.model}`);
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
      if (role === 'G0') {
        assert.equal(Object.hasOwn(route, 'subagent'), true, `${stackId}.G0 must expose its child route locally`);
        assert.equal(Object.hasOwn(route, 'adversarial_subagent'), false, `${stackId}.G0 cannot expose the G3 adversarial route`);
      } else if (role === 'G3') {
        assert.equal(Object.hasOwn(route, 'subagent'), true, `${stackId}.G3 must expose its ordinary child route locally`);
        assert.equal(Object.hasOwn(route, 'adversarial_subagent'), true, `${stackId}.G3 must expose its adversarial child route locally`);
      } else {
        assert.equal(Object.hasOwn(route, 'subagent'), false, `${stackId}.${role} cannot expose a semantic child route`);
        assert.equal(Object.hasOwn(route, 'adversarial_subagent'), false, `${stackId}.${role} cannot expose a G3 adversarial child route`);
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
    assert.equal(Object.hasOwn(stack.routes.G0, 'adversarial_subagent'), false, stackId);
    assert.equal(Object.hasOwn(stack.routes.G3, 'subagent'), true, stackId);
    assert.equal(Object.hasOwn(stack.routes.G3, 'adversarial_subagent'), true, stackId);
    for (const role of requiredRoutes.filter((role) => !['G0', 'G3'].includes(role))) {
      assert.equal(Object.hasOwn(stack.routes[role], 'subagent'), false, `${stackId}.${role}`);
      assert.equal(Object.hasOwn(stack.routes[role], 'adversarial_subagent'), false, `${stackId}.${role}`);
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
  assert.match(controller, /ordinary subagent.*stage-local `subagent` provider\/model\/reasoning route/s);
  assert.match(controller, /mandatory complex\/STRICT G3 adversarial pre-publication challenge.*`adversarial_subagent` route/s);
  assert.match(controller, /parent\/launcher resolves.*before child creation/s);
  assert.match(controller, /spawned child never self-attests after launch/i);
  assert.match(controller, /Silent provider\/model\/reasoning substitution remains prohibited.*controller\/launcher boundary/s);
  assert.match(controller, /root semantic prompts.*do not carry concrete provider\/model\/reasoning verification obligations/i);
  assert.match(architecture, /Root model\/route selection is an out-of-band User\/Web\/controller\/harness act/i);
  assert.match(architecture, /root semantic worker never verifies or attests its own model identity/i);
  assert.match(architecture, /parent\/launcher resolves the concrete child route.*before child creation/s);
  assert.match(architecture, /spawned children never self-attest after launch/i);
});

test('web owns CURRENT reconciliation while semantic workers receive compiled bounded context', () => {
  assert.match(controller, /Web\/controller CURRENT ownership/);
  assert.match(controller, /Update and read back CURRENT after every material transition that changes a projected current fact/);
  assert.match(controller, /Do not write merely because another chat turn occurred when no current fact changed/);
  assert.match(controller, /CURRENT-first bounded worker context/);
  assert.match(controller, /Before worker launch\/adoption, Web\/controller must reconcile stale, missing or contradictory CURRENT facts/);
  assert.match(controller, /must not be emitted wholesale into an ordinary worker packet/);
  assert.match(controller, /Current-facing body sections that still claim an obsolete RUN\/Lock\/gate\/NEXT\/route or prior CURRENT state are presentation drift/);
  assert.match(controller, /repair them from canonical CURRENT at the next safe reconciliation boundary/);

  assert.match(controller, /bounded stage\/task\/authority packet compiled from CURRENT/);
  assert.match(controller, /full programme-parent body, Delivery Child body, issue\/PR chronology, historical authority list/);
  assert.match(controller, /are not default worker context/);
  assert.match(controller, /If CURRENT is insufficient, reconcile CURRENT; never compensate by dumping chronology into the worker prompt/);
  assert.match(controller, /issue body is not itself the semantic worker packet/);
});

test('Toolkit controller future-owns reusable improvements instead of expanding the CURRENT delivery child', () => {
  assert.match(controller, /Toolkit-controller active-child improvement quarantine/);
  assert.match(controller, /applies only when the Web Controller repository fence is exactly `weijunswj\/ai-agent-toolkit`/);
  assert.match(controller, /defaults to canonical disposition `FUTURE_OWNED`/);
  assert.match(controller, /projected as v1 `NON_BLOCKING` while unresolved/);
  assert.match(controller, /smallest compatible existing durable future child\/shared carrier\/seed/);
  assert.match(controller, /does not by itself widen that child's scope, mutation ceiling, prerequisite graph, RUN\/Lock lineage or repair budget/);
  assert.match(controller, /CURRENT_CHILD_INVARIANT_AFFECTED/);
  assert.match(controller, /CURRENT_CHILD_ASSURANCE_INVALIDATED/);
  assert.match(controller, /SAFE_DEFERRAL_IMPOSSIBLE/);
  assert.match(controller, /SMALLEST_CURRENT_CORRECTION/);
  assert.match(controller, /Missing any field means future-own the improvement and continue the current child/);
  assert.match(controller, /never launders a real current-child defect into follow-up work/);
  assert.match(controller, /Controllers bound to SQAG, Platform, Design, Automation or any other repository do not inherit this Toolkit programme-topology rule/);
  assert.match(controller, /may surface reusable `TOOLKIT_FEEDBACK`/);
});

test('generic interim Controller law is canonicalised only by the Toolkit source-owning controller', () => {
  assert.match(controller, /Interim Controller-law canonicalisation/);
  assert.match(controller, /generic Owner\/Web interim rule that changes Controller behaviour across chats, workers or Toolkit-managed repositories/);
  assert.match(controller, /Canonicalisation into `weijunswj\/ai-agent-toolkit:repo\/CONTROLLER\.md` is owned only by the Web Controller currently bound to the Toolkit repository/);
  assert.match(controller, /explicitly authorised Toolkit executor operating under that controller/);
  assert.match(controller, /Web Controller bound to another repository must not cross its repository fence/);
  assert.match(controller, /must not.*stage Toolkit source.*open\/update a Toolkit source PR.*treat this clause as mutation authority/s);
  assert.match(controller, /surface the reusable gap\/feedback or exact handoff to the Toolkit source-owning controller\/durable owner/);
  assert.match(controller, /next safe Toolkit source boundary/);
  assert.match(controller, /does not remain indefinitely comment-only/);
  assert.match(controller, /Repository\/task-specific facts, receipts and implementation contracts remain on their owning programme\/child surfaces/);
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
  assert.match(controller, /Web may optionally invoke one read-only `G1_RECONVERGENCE` synthesis/);
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
  assert.match(controller, /accepted temporal model classifies as a still-required obligation.*remains outstanding until real consequential completion/s);
  assert.match(controller, /Cancelling or replacing a scheduler cannot erase an independently required obligation/);
  assert.match(controller, /latest-state debounce\/coalescing\/supersession semantics.*not automatically lost work/s);
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

test('task-specific terminal vocabularies cannot suppress controller typed non-product holds', () => {
  assert.match(controller, /Task\/stage prompts may enumerate semantic terminal outcomes/);
  assert.match(controller, /`return exactly one`/);
  assert.match(controller, /do not implicitly suppress Controller-defined typed non-product HOLDs/);
  assert.match(controller, /executor\/runtime\/harness permission or safety interruption/);
  assert.match(controller, /pure non-product interruption does not consume product\/G3 correction budget unless it independently establishes a candidate defect/);
  assert.match(controller, /PRODUCT_SEMANTICS_PROVEN_BAD/);
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

test('G2 adversarially tries to falsify its own contract before PASS', () => {
  assert.match(controller, /G2 adversarial contract falsification/);
  assert.match(controller, /implementation that follows the written mechanism yet violates the invariant/);
  assert.match(controller, /competing semantic models/);
  assert.match(controller, /validation\/evidence false positives or false greens/);
  assert.match(controller, /Surviving assumptions must be explicitly bound/);
  assert.match(controller, /mapped to deterministic G3 negative regressions plus positive controls/);
  assert.match(controller, /G2 proves the contract\/design is adversarially coherent enough to implement; it does not prove the implementation itself/);
  assert.match(architecture, /adversarial reviewer of its own proposed contract/);
  assert.match(architecture, /design\/contract analogue of G4 attacking the realised candidate/);
});

test('async/deferred contracts freeze temporal semantics instead of inferring them from timers', () => {
  assert.match(controller, /Async\/deferred temporal-semantics closure/);
  assert.match(controller, /individually consequential or latest\/coalesced only/);
  assert.match(controller, /debounce\/coalescing/);
  assert.match(controller, /replacement\/supersession\/cancellation/);
  assert.match(controller, /queue-time snapshot versus execution-time\/current-state lookup/);
  assert.match(controller, /G3 and G4 must not infer product semantics merely from timers, queues, promises, callbacks/);
  assert.match(controller, /Replacing a timer is not lost required work unless the accepted temporal model says that individual obligation remained consequential/);
  assert.match(architecture, /timer\/queue\/promise\/callback mechanics are evidence about implementation shape, not authority for product semantics/);
  assert.match(architecture, /latest-state debounce\/coalescing.*obligation transfers\/merges into the latest consequential state/s);
  assert.match(architecture, /under each-state-required semantics, replacement\/cancellation must preserve or truthfully fail the individual obligation/);
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

test('complex G3 uses paired implementation and strong-review convergence attempts without adding a gate', () => {
  assert.match(controller, /Complex\/STRICT G3 paired convergence \+ adversarial pre-publication validation/);
  assert.match(controller, /each substantive G3 convergence attempt as one paired cycle/);
  assert.match(controller, /parent implementation\/correction -> complete affected integrated validation green -> fresh depth-1 read-only adversarial challenge leaf/);
  assert.match(controller, /separately registered G3 `adversarial_subagent` route/);
  assert.match(controller, /deliberately stronger reasoning route/);
  assert.match(controller, /privilege\/context boundaries/);
  assert.match(controller, /production-boundary reachability/);
  assert.match(controller, /validation false-greens/);
  assert.match(controller, /leaf never mutates, publishes, grants authority or declares G3 completion/);
  assert.match(controller, /clean challenge closes that paired attempt successfully/);
  assert.match(controller, /material settled in-contract implementation finding.*paired attempt is unsuccessful/s);
  assert.match(controller, /next materially distinct correction attempt inside the same RUN\/Lock/);
  assert.match(controller, /3 normal materially distinct attempts and an absolute ceiling of 5/);
  assert.match(controller, /Strong G3 challenge packet \/ implementation handoff/);
  assert.match(controller, /self-sufficient diagnostic packet, not only `PASS`\/`RED`/);
  assert.match(controller, /exact accepted G2 invariant\/contract obligation violated/);
  assert.match(controller, /smallest suggested in-contract correction mechanism\/direction/);
  assert.match(controller, /deterministic negative regression plus same-boundary positive control and effect\/zero-effect oracle/);
  assert.match(controller, /scope guard\/what must remain unchanged/);
  assert.match(controller, /Suggested fixes are diagnostic guidance, not mutation\/contract authority/);
  assert.match(controller, /primary handoff for the next parent correction attempt/);
  assert.match(controller, /cheaper G3 route can verify\/adapt the proposed direction instead of repeating open-ended root-cause discovery/);
  assert.match(controller, /no separate reviewer retry budget beyond the G3 attempt budget/);
  assert.match(controller, /no one-leaf-per-G3 ceiling/);
  assert.match(controller, /unchanged-byte rechecks, evidence gathering and typed non-product HOLD recovery do not manufacture or consume a substantive attempt/);
  assert.match(controller, /simple\/low-risk G3.*leaf remains optional/s);
  assert.match(controller, /must not silently fall back to the ordinary G3 implementer or ordinary G3 `subagent` route/);
  assert.match(controller, /pre-publication route\/harness HOLD/);
  assert.match(controller, /G3 anti-bounce \/ Web-return boundary/);
  assert.match(controller, /ordinary settled in-contract RED, strong-review RED, diagnosis, correction and revalidation are internal to the already-admitted G3 RUN\/Lock/);
  assert.match(controller, /must not emit `NEXT=RETURN_TO_WEB`/);
  assert.match(controller, /request a fresh continuation receipt/);
  assert.match(controller, /manufacture a new G3 RUN\/Lock/);
  assert.match(controller, /Historical issue text, old continuation receipts, obsolete NEXT instructions or prior Web-directed examples never grant current return authority/);
  assert.match(controller, /Settled-behaviour RED stays in G3/);
  assert.match(controller, /missing product\/compatibility semantics return to G2/);
  assert.match(controller, /changed root\/trust\/architecture returns to G1/);

  assert.match(architecture, /paired convergence cycle inside the same G3 episode/);
  assert.match(architecture, /One substantive attempt consists of parent implementation\/correction/);
  assert.match(architecture, /complete affected integrated validation floor reaching green/);
  assert.match(architecture, /fresh depth-1 read-only adversarial challenge leaf against those exact current bytes/);
  assert.match(architecture, /clean challenge closes that paired attempt successfully/);
  assert.match(architecture, /3 normal materially distinct attempts and an absolute ceiling of 5/);
  assert.match(architecture, /implementation-ready diagnostic handoff rather than a bare verdict/);
  assert.match(architecture, /smallest suggested in-contract correction direction/);
  assert.match(architecture, /negative regression plus same-boundary positive control and effect\/zero-effect oracle/);
  assert.match(architecture, /cheaper G3 parent to consume findings and implement\/verify the next in-contract correction without reconstructing the reviewer's root-cause analysis from scratch/);
  assert.match(architecture, /no independent reviewer retry budget/);
  assert.match(architecture, /no one-leaf-per-G3 ceiling/);
  assert.match(architecture, /no new G3 RUN\/Lock/);
  assert.match(architecture, /It is not another gate/);

  const openai = registry.stacks['owner-openai-default'].routes.G3.adversarial_subagent;
  assert.deepEqual(openai, { provider: 'openai', model: 'gpt-6-sol', reasoning: 'max' });
  const claude = registry.stacks['owner-claude'].routes.G3.adversarial_subagent;
  assert.deepEqual(claude, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  const mixed = registry.stacks['owner-mixed-claude-gpt'].routes.G3.adversarial_subagent;
  assert.deepEqual(mixed, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
});

test('commit-required validation sequencing freezes each candidate identity before clean-head validators without publishing it', () => {
  assert.match(controller, /Commit-required validation sequencing/);
  assert.match(controller, /accepted validator materially requires immutable commit identity or a clean committed working tree/);
  assert.match(controller, /all meaningful non-commit-dependent checks are green and candidate contents\/mutation scope are frozen/);
  assert.match(controller, /Bind the exact commit\/tree\/parent/);
  assert.match(controller, /prohibit amendment\/rebase\/reconstruction of that candidate identity/);
  assert.match(controller, /Publication remains prohibited until the complete required floor is green/);
  assert.match(controller, /local candidate commit is construction\/custody, not publication, `G3_PASS`, G4 admission, Ready, merge or finality/);
  assert.match(controller, /environment\/transport\/evidence HOLD preserves the exact commit/);
  assert.match(controller, /pre-publication identity-bound validation or the required adversarial challenge proves a settled in-contract product RED.*new immutable local candidate in the same RUN\/Lock.*existing G3 attempt budget/s);
  assert.match(controller, /Preserve the failed candidate as evidence; never amend, rebase, reconstruct or overwrite it/);
  assert.match(controller, /Repeat applicable non-commit-dependent checks, freeze the corrected contents\/scope, and bind the replacement's exact commit\/tree\/parent before its identity-dependent checks/);
  assert.match(controller, /pre-publication product correction is separate from the published\/hosted non-product reclosure rule below/);
  assert.match(architecture, /COMMIT_REQUIRED_VALIDATION=YES/);
  assert.match(architecture, /create the ordinary immutable local candidate commit under the existing allowance/);
  assert.match(architecture, /Run the identity\/clean-tree-dependent and remaining floor against that exact commit/);
  assert.match(architecture, /pre-publication identity-bound validation or the required adversarial challenge proves a settled in-contract product RED.*new immutable local candidate in the same RUN\/Lock.*existing G3 attempt budget/s);
  assert.match(architecture, /failed candidate as durable evidence; never amend, rebase, reconstruct or overwrite it/);
  assert.match(architecture, /does not authorize publication before one exact candidate completes the full floor/);
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

function s1aSection(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, 'missing canonical section: ' + heading);
  const remainder = source.slice(start + heading.length);
  const nextHeading = remainder.search(/^#{1,6} /m);
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

function s1aTable(source, heading) {
  const lines = s1aSection(source, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  assert.ok(lines.length >= 2, 'missing canonical table: ' + heading);
  const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
  const headers = cells(lines[0]);
  const tick = String.fromCharCode(96);
  const rows = [];
  for (const line of lines.slice(2)) {
    const values = cells(line);
    if (!values.length || values.every((value) => /^:?-+:?$/.test(value))) continue;
    assert.equal(values.length, headers.length, 'malformed canonical table row in ' + heading);
    rows.push(Object.fromEntries(headers.map((header, index) => [
      header,
      values[index].replace(new RegExp('^' + tick + '|' + tick + '$', 'g'), ''),
    ])));
  }
  return rows;
}

function assertS1aBlockerContract(source) {
  const section = s1aSection(source, '### Current blocker field contract');
  const rows = s1aTable(source, '### Current blocker field contract');
  const ids = rows.map((row) => row['Required field']);
  assert.deepEqual(ids, S1A_ORACLE_BLOCKER_FIELDS);
  assert.deepEqual(parseS1aPolicyContract(source).blocker.requiredFields, ids);
  assert.match(rows.find((row) => row['Required field'] === 'REQUIRED_OUTCOME_EFFECT')['Bound value or proof'],
    /FALSE.*MATERIALLY_UNSAFE.*UNASSURABLE/);
  assert.match(section, /DISPOSITION=CURRENT_SHIP_BLOCKER/);
  assert.match(section, /LIFECYCLE=UNRESOLVED/);
  assert.match(section, /ALL_FIELDS_REQUIRED=YES/);
}

test('S1A increment 1 canonical shipping semantics I1-01..I1-25', async (t) => {
  const dispositions = s1aTable(architecture, '### Canonical disposition vocabulary');
  const projections = s1aTable(architecture, '### Lossless legacy projections');
  const fields = s1aTable(architecture, '### Current blocker field contract');
  const examples = s1aTable(architecture, '### Current-frontier effect and examples');
  const dispositionByName = new Map(dispositions.map((row) => [row.Disposition, row['Meaning and timing']]));
  const projectionKey = (row) => row['Canonical disposition'] + '/' + row.Lifecycle;
  const projectionByKey = new Map(projections.map((row) => [projectionKey(row), row]));
  const fieldByName = new Map(fields.map((row) => [row['Required field'], row['Bound value or proof']]));
  const cases = [
    ['I1-01', 'the canonical vocabulary has exactly five dispositions', () => {
      assert.deepEqual(dispositions.map((row) => row.Disposition), [
        'CURRENT_SHIP_BLOCKER', 'IMMEDIATE_POST_SHIP', 'FUTURE_OWNED', 'OBSERVE', 'EVIDENCE_ONLY',
      ]);
    }],
    ['I1-02', 'only CURRENT_SHIP_BLOCKER names a present shipment failure', () => {
      assert.match(dispositionByName.get('CURRENT_SHIP_BLOCKER'), /admitted finding.*satisfied every current-blocker predicate.*while UNRESOLVED.*false, materially unsafe, or unassurable now/);
    }],
    ['I1-03', 'IMMEDIATE_POST_SHIP keeps current outcome and floor intact', () => {
      assert.match(dispositionByName.get('IMMEDIATE_POST_SHIP'), /next post-ship opportunity.*does not make.*fail now/);
    }],
    ['I1-04', 'FUTURE_OWNED preserves a verified continuing owner', () => {
      assert.match(dispositionByName.get('FUTURE_OWNED'), /verified continuing owner and future home.*remains unresolved/);
    }],
    ['I1-05', 'OBSERVE retains a trigger without admitting correction', () => {
      assert.match(dispositionByName.get('OBSERVE'), /signal, trigger, or threshold.*no current correction/);
    }],
    ['I1-06', 'EVIDENCE_ONLY does not assert a product defect', () => {
      assert.match(dispositionByName.get('EVIDENCE_ONLY'), /custody-only action.*neither asserts a product defect nor authorises product correction/);
      assert.match(dispositionByName.get('EVIDENCE_ONLY'), /required evidence gates remain independently binding/);
    }],
    ['I1-07', 'lifecycle is independent of disposition', () => {
      assert.match(s1aSection(architecture, '### Canonical disposition vocabulary'), /separate lifecycle/);
      assert.match(s1aSection(architecture, '### Canonical disposition vocabulary'), /UNRESOLVED.*RESOLVED/s);
    }],
    ['I1-08', 'an unresolved current blocker projects to the legacy blocking labels', () => {
      const row = projectionByKey.get('CURRENT_SHIP_BLOCKER/UNRESOLVED');
      assert.equal(row['Two-way projection'], 'SHIP_BLOCKER');
      assert.equal(row['v1 projection'], 'BLOCKING');
    }],
    ['I1-09', 'a resolved blocker retains its class while v1 records resolution', () => {
      const row = projectionByKey.get('CURRENT_SHIP_BLOCKER/RESOLVED');
      assert.equal(row['Two-way projection'], 'SHIP_BLOCKER');
      assert.equal(row['v1 projection'], 'RESOLVED');
    }],
    ['I1-10', 'every unresolved non-blocker projects as POST_SHIP and NON_BLOCKING', () => {
      for (const disposition of ['IMMEDIATE_POST_SHIP', 'FUTURE_OWNED', 'OBSERVE', 'EVIDENCE_ONLY']) {
        const row = projectionByKey.get(disposition + '/UNRESOLVED');
        assert.equal(row['Two-way projection'], 'POST_SHIP');
        assert.equal(row['v1 projection'], 'NON_BLOCKING');
      }
    }],
    ['I1-11', 'all resolved v1 findings project as RESOLVED', () => {
      for (const disposition of dispositions.map((row) => row.Disposition)) {
        assert.equal(projectionByKey.get(disposition + '/RESOLVED')['v1 projection'], 'RESOLVED');
      }
    }],
    ['I1-12', 'the projection table covers each disposition-lifecycle pair once', () => {
      assert.equal(projections.length, 10);
      assert.equal(new Set(projections.map(projectionKey)).size, 10);
      assert.equal(projections.filter((row) => row.Lifecycle === 'UNRESOLVED').length, 5);
      assert.equal(projections.filter((row) => row.Lifecycle === 'RESOLVED').length, 5);
    }],
    ['I1-13', 'the sidecar retains timing owner evidence and revision', () => {
      assert.match(s1aSection(architecture, '### Lossless legacy projections'),
        /canonical disposition, lifecycle, timing, verified owner.*exact evidence references, candidate identity and Web-admitted revision/);
    }],
    ['I1-14', 'the current outcome is bound to milestone audience and environment', () => {
      assert.match(fieldByName.get('ADMITTED_CURRENT_OUTCOME'), /non-empty outcome id, milestone, intended audience and supported environment/);
      assert.match(fieldByName.get('WEB_ADMITTED_REVISION'), /Exact durable Web-admitted revision/);
    }],
    ['I1-15', 'the blocker names a locked criterion or applicable floor', () => {
      assert.match(fieldByName.get('LOCKED_CRITERION_OR_FLOOR'), /Exact locked acceptance-criterion identifier or applicable minimum-safety-floor obligation/);
    }],
    ['I1-16', 'the blocker records the ship-now consequence and allowed effect set', () => {
      assert.match(fieldByName.get('SHIP_NOW_CONSEQUENCE'), /Concrete, evidence-backed consequence/);
      assert.match(fieldByName.get('REQUIRED_OUTCOME_EFFECT'), /FALSE.*MATERIALLY_UNSAFE.*UNASSURABLE/);
    }],
    ['I1-17', 'safe deferral must be demonstrated impossible', () => {
      assert.match(fieldByName.get('SAFE_DEFERRAL_IMPOSSIBLE'), /why an existing or newly verified future owner cannot safely close/);
      assert.match(fieldByName.get('SAFE_DEFERRAL_IMPOSSIBLE'), /correct and assurable/);
    }],
    ['I1-18', 'the smallest correction has a verifiable closure oracle', () => {
      assert.match(fieldByName.get('SMALLEST_CORRECTION'), /smallest correction/);
      assert.match(fieldByName.get('VERIFIABLE_CLOSURE'), /falsifiable closure oracle at the relevant consequential boundary/);
    }],
    ['I1-19', 'evidence and immutable candidate identity are exact', () => {
      assert.match(fieldByName.get('EXACT_EVIDENCE'), /Durable exact evidence references/);
      assert.match(fieldByName.get('CANDIDATE_IDENTITY'), /Exact candidate commit\/tree or other accepted immutable candidate identity/);
    }],
    ['I1-20', 'all blocker fields are conjunctive and Web-admitted', () => {
      assertS1aBlockerContract(architecture);
      assert.match(s1aSection(architecture, '### Current blocker field contract'), /Web durably reconciles the full predicate/);
    }],
    ['I1-21', 'severity novelty G4 labels and evidence gaps cannot replace the predicate', () => {
      assert.match(s1aSection(architecture, '### Current blocker field contract'),
        /Severity, novelty, a G4 label, a critical evidence gap by itself.*cannot substitute for any field/);
    }],
    ['I1-22', 'only a properly admitted unresolved blocker blocks its dependent frontier', () => {
      assert.match(s1aSection(architecture, '### Current-frontier effect and examples'),
        /Only a properly admitted, unresolved .+CURRENT_SHIP_BLOCKER.+may block the finding-derived dependent current frontier/);
    }],
    ['I1-23', 'independent CI assurance authority evidence and checkpoint gates remain binding', () => {
      assert.match(s1aSection(architecture, '### Current-frontier effect and examples'),
        /cannot suppress or replace independent CI, assurance, authority, evidence, checkpoint/);
    }],
    ['I1-24', 'a safely deferrable alpha edge is not a current blocker', () => {
      const row = examples.find((example) => /alpha edge/.test(example.Example));
      assert.ok(row);
      assert.equal(row.Disposition, 'FUTURE_OWNED');
      assert.match(row['Evidence result'], /Safe deferral is demonstrated.*remains correct and assurable/);
    }],
    ['I1-25', 'an admitted alpha journey data-integrity or safety-floor defect can qualify', () => {
      const row = examples.find((example) => /admitted alpha journey/.test(example.Example));
      assert.ok(row);
      assert.equal(row.Disposition, 'CURRENT_SHIP_BLOCKER');
      assert.match(row.Example + ' ' + row['Evidence result'], /every required predicate.*exact candidate and Web-admitted revision/);
    }],
  ];
  for (const [id, name, check] of cases) {
    await t.test('S1A increment 1 ' + id + ' ' + name, check);
  }
});

test('S1A increment 1 blocker predicate rejects clause removal and negation', () => {
  assertS1aBlockerContract(architecture);
  const section = s1aSection(architecture, '### Current blocker field contract');
  const tableRows = section.split(/\r?\n/).filter((line) => /^\| (WEB_ADMITTED_REVISION|ADMITTED_CURRENT_OUTCOME|LOCKED_CRITERION_OR_FLOOR|SHIP_NOW_CONSEQUENCE|REQUIRED_OUTCOME_EFFECT|SAFE_DEFERRAL_IMPOSSIBLE|SMALLEST_CORRECTION|VERIFIABLE_CLOSURE|EXACT_EVIDENCE|CANDIDATE_IDENTITY) \|/.test(line));
  assert.equal(tableRows.length, 10);
  for (const row of tableRows) {
    const withoutClause = architecture.replace(row + (architecture.includes('\r\n') ? '\r\n' : '\n'), '');
    assert.notEqual(withoutClause, architecture);
    assert.throws(() => assertS1aBlockerContract(withoutClause));
  }
  assert.throws(() => assertS1aBlockerContract(
    architecture.replace('ALL_FIELDS_REQUIRED=YES', 'ALL_FIELDS_REQUIRED=ANY')
  ));
  assert.throws(() => assertS1aBlockerContract(
    architecture.replace('One demonstrated effect in {FALSE, MATERIALLY_UNSAFE, UNASSURABLE}', 'One demonstrated effect in {TRUE}')
  ));
});

test('S1A increment 1 post-child review binds the integrated Toolkit checkpoint', () => {
  const section = s1aSection(architecture, '### Post-child integrated dual review');
  assert.match(section, /only to explicitly Toolkit-managed repositories/);
  assert.match(section, /after each Delivery Child's final PR is merged/);
  assert.match(section, /canonical commit\/tree is read back/);
  assert.match(section, /supporting or incremental PRs do not trigger/i);
  assert.match(section, /route for each review is supplied by current Owner\/Web authority/);
  assert.match(section, /not an authoritative default or permanent Architecture route law/);
  assert.match(section, /exact provider\/model\/reasoning bindings from that current readback/);
  assert.match(section, /integration CI to that same exact integrated identity/);
  assert.match(section, /Each reviewer receives.*neither sees the other's report/);
  assert.match(section, /only a dependent next-child frontier/);
  assert.match(section, /final integrated programme review/);
  assert.match(section, /CURRENT canonical parent programme contract is an authoritative input to both reviews/);
  assert.match(section, /relevant current or terminal child state/);
  assert.match(section, /complete terminal object-receipt inventory from its canonical ledger/);
  assert.match(section, /complete applicable integration-check inventory from its canonical source/);
  assert.match(section, /whole programme from the same snapshot/);
  assert.match(section, /Both reports, terminal receipts and all applicable checks must be terminal before Web adjudication/);
  assert.match(section, /mutually blind until both reports have returned/);
  assert.match(section, /only a dependent next-child frontier/);
  assert.match(section, /final integrated programme review occurs at the final Delivery Child checkpoint for this lifecycle/);
  assert.match(controller, /Launch two independent read-only whole-programme reviews alongside merge-triggered CI/);
  assert.match(controller, /Read back the complete terminal receipt\/check inventories after completion and before Web adjudication/);
  assert.doesNotMatch(controller, /Verify both complete inventories before the reviews start/);
  assert.match(controller, /post-child dual review.*does not replace pre-merge G4/);
});

test('S1A increment 1 non-product continuation stays bounded to accepted work', () => {
  const section = s1aSection(architecture, '### Bounded non-product continuation');
  assert.match(section, /HARNESS.*TOOLKIT.*ENVIRONMENT.*TRANSPORT/);
  assert.match(section, /PRODUCT_SEMANTICS_PROVEN_BAD=NO/);
  assert.match(section, /exact current G3 RUN\/Lock, a parent-owned already-authorised LIGHT operation, or any other currently accepted Web-bounded evidence episode recorded by its authoritative readback/);
  assert.match(section, /Identity-preserving recovery keeps the exact candidate and evidence identities, and every candidate remains immutable/);
  assert.match(section, /Neither path grants product correction.*does not widen the existing authority, mutation boundary, accepted scope\/floor or prerequisite graph/);
  assert.match(section, /product RED follows ordinary G3 correction/);
  assert.match(section, /existing explicitly Web-authorised hosted non-product reclosure.*distinct immutable replacement candidate/);
  assert.match(section, /primary owner HARNESS, TOOLKIT, or ENVIRONMENT/);
  assert.match(section, /consume no product\/G3 correction attempt, and reset no budget/);
  assert.match(section, /TRANSPORT-only recovery does not use this replacement-candidate exception/);
  assert.match(controller, /bounded non-product continuation.*product RED follows ordinary G3 correction/);
});

test('S1A increment 1 private validation carrier remains the default', () => {
  const section = s1aSection(architecture, '### Faithful validation carrier');
  assert.match(section, /PRIVATE\/NONPUBLIC/);
  assert.match(section, /without domain registration, DNS or public ingress/);
  assert.match(section, /specific accepted validation criterion requires it and a current authoritative Owner\/Web readback/);
  assert.match(section, /If no such evidence is available.*incomplete evidence or a typed HOLD/);
  assert.match(controller, /PRIVATE\/NONPUBLIC by default; persistence does not imply exposure/);
});

test('S1A increment 1 existing lifecycle and continuation boundaries remain intact', () => {
  assert.match(controller, /G4 = fresh isolated read-only exact-head independent assurance/);
  assert.match(controller, /existing authorised G3 correction path/);
  assert.match(controller, /distinguish candidate acceptance from programme completion/i);
  assert.match(controller, /Toolkit-controller active-child improvement quarantine/);
  assert.match(architecture, /RECONVERGED_CORRECTION/);
  assert.match(architecture, /WEB_DIRECTED_CONTINUATION/);
  assert.match(architecture, /G1 re-convergence/);
  assert.match(architecture, /G2.*G3.*G4/s);
  assert.match(controller, /Web retains judgement\/finality/);
});
const S1A_ORACLE_BOUNDED_CONTINUATION_POLICY = Object.freeze({
  eligiblePrimaryOwners: Object.freeze(['HARNESS', 'TOOLKIT', 'ENVIRONMENT', 'VALIDATION_CARRIER', 'TRANSPORT']),
  excludedAutonomousOwners: Object.freeze(['PRODUCT', 'UNKNOWN']),
  productSemanticsRequired: 'NO',
  episodeAuthority: Object.freeze({
    mode: 'CURRENT_EXPLICIT_WEB_BOUNDED_EPISODE',
    requiredFields: Object.freeze([
      'repository', 'webAuthorityIdentity', 'webAuthorityRevision', 'webAuthorityContent',
      'episodeId', 'episodeKind', 'runId', 'lockId', 'authorityReference', 'primaryOwner',
      'source', 'authoritative', 'current', 'readBack', 'explicitWebBound', 'digest',
      'rootFamilyId', 'acceptedContractId', 'trustModelId', 'scopeId', 'assuranceFloorId',
      'evidenceBoundaryId'
    ]),
    kindBinding: 'EXACT_CURRENT_INDEPENDENT_WEB_READBACK',
    anyExplicitWebBoundKindAllowedWhenIndependentlyAccepted: true
  }),
  acceptedAuthorityBinding: Object.freeze({
    source: 'CURRENT_ACCEPTED_G2_EPISODE_AUTHORITY_READBACK',
    stateField: 'acceptedEpisodeAuthority',
    requiredFields: Object.freeze(['repository', 'webAuthorityIdentity', 'webAuthorityRevision',
      'webAuthorityContent', 'episodeId', 'episodeKind', 'runId', 'lockId', 'authorityReference',
      'primaryOwner', 'rootFamilyId', 'acceptedContractId', 'trustModelId', 'scopeId',
      'assuranceFloorId', 'evidenceBoundaryId']),
    mustMatchIndependentAcceptedReadback: true
  }),
  acceptedBoundaryBinding: Object.freeze({
    inputField: 'acceptedBoundary',
    source: 'CURRENT_ACCEPTED_G2_BOUNDARY_READBACK',
    requiredFields: Object.freeze(['source', 'authoritative', 'current', 'readBack', 'repository',
      'webAuthorityIdentity', 'webAuthorityRevision', 'webAuthorityContent', 'episodeId', 'episodeKind',
      'runId', 'lockId', 'authorityReference', 'rootFamilyId', 'acceptedContractId', 'trustModelId',
      'scopeId', 'assuranceFloorId', 'evidenceBoundaryId', 'digest']),
    episodeFields: Object.freeze(['repository', 'webAuthorityIdentity', 'webAuthorityRevision',
      'webAuthorityContent', 'episodeId', 'episodeKind', 'runId', 'lockId', 'authorityReference',
      'rootFamilyId', 'acceptedContractId', 'trustModelId', 'scopeId', 'assuranceFloorId', 'evidenceBoundaryId']),
    mustRemainExact: true
  }),
  currentStateReadback: Object.freeze({
    inputField: 'currentStateReadback',
    source: 'CURRENT_ACCEPTED_G2_CONTINUATION_STATE_READBACK',
    requiredFields: Object.freeze(['source', 'authoritative', 'current', 'complete', 'readBack', 'episodeId',
      'acceptedEpisodeAuthority', 'candidateIdentity', 'evidenceIdentity', 'attemptState',
      'currentFailureSignature', 'history', 'effectReconciliation', 'faithfulPathInventoryDigest', 'digest']),
    attemptFields: Object.freeze(['attemptCount', 'attemptLimit', 'productCorrectionAttempts',
      'productCorrectionLimit', 'budgetConsumed', 'budgetLimit']),
    historyMustMatchExactly: true,
    mustMatchIndependentAcceptedReadback: true
  }),
  requiredConditions: Object.freeze([
    'CONCLUSIVE_PRIMARY_OWNER', 'PRODUCT_SEMANTICS_PROVEN_BAD_NO', 'RECONCILED_EFFECTS',
    'FAITHFUL_PATH_REMAINS', 'NO_EQUIVALENT_NO_PROGRESS_REPEAT', 'SAME_ROOT_TRUST_AUTHORITY_SCOPE',
    'SAME_ASSURANCE_FLOOR_AND_EVIDENCE_BOUNDARY', 'EXACT_CANDIDATE_AND_EVIDENCE_IDENTITY',
    'NO_ATTEMPT_OR_BUDGET_RESET', 'AUTHORITATIVE_CURRENT_STATE_READBACK',
    'ACCEPTED_EPISODE_AUTHORITY_READBACK', 'CONSUMPTION_WITHIN_ACCEPTED_LIMITS',
    'FAITHFUL_PATH_HAS_BOUND_EVIDENCE'
  ]),
  effectReconciliation: Object.freeze({
    requiredFields: Object.freeze(['source', 'authoritative', 'current', 'complete', 'readBack', 'effects', 'digest']),
    acceptedEffectState: 'RECONCILED',
    independentReadbackField: 'effectReconciliation',
    mustMatchCurrentAcceptedStateReadback: true,
    equivalentEffectOrderAllowed: true
  }),
  faithfulPathInventory: Object.freeze({
    requiredFields: Object.freeze(['source', 'authoritative', 'current', 'complete', 'readBack', 'paths', 'digest']),
    requiresRemainingFaithfulPath: true,
    pathFields: Object.freeze(['pathId', 'faithful', 'available', 'actualPath', 'evidenceRef',
      'evidenceBoundaryId', 'candidateIdentity']),
    pathInventoryDigestBoundToCurrentState: true
  }),
  equivalenceFields: Object.freeze([
    'rootFamilyId', 'unresolvedBlockerIds', 'primaryOwner', 'failedMechanism', 'effectClass', 'evidenceBoundaryId'
  ]),
  equivalenceIgnoresLabels: Object.freeze(['runId', 'workerId', 'branch', 'candidateIdentity', 'episodeId']),
  candidateTransition: 'PRESERVE_EXACT_IDENTITY',
  evidenceTransition: 'PRESERVE_EXACT_IDENTITY',
  attemptAndBudget: Object.freeze({
    attemptCountMayDecrease: false,
    budgetSpentMayDecrease: false,
    limitsMayIncrease: false,
    attemptCountMayExceedLimit: false,
    productCorrectionsMayExceedLimit: false,
    budgetConsumedMayExceedLimit: false,
    overLimitResult: 'RETURN_TO_WEB',
    resetAllowed: false
  }),
  resultFields: Object.freeze([
    'admission', 'violatedObligationIds', 'candidateTransition', 'evidenceTransition',
    'attemptEffects', 'budgetEffects', 'mutationEffects'
  ]),
  replacementAuthority: Object.freeze({
    observerSignature: 'observe(policy, request, trustedContext)',
    trustedContextFields: Object.freeze(['currentAuthority', 'candidateReadback', 'evidenceReadback']),
    mustBeIndependentOfRequest: true,
    mustNotBeSelectedByCallerLabelsOrDigests: true,
    mustNotBeMutableThroughRequest: true,
    currentAuthorityFields: Object.freeze([
      'source', 'repository', 'webAuthorityIdentity', 'webAuthorityRevision', 'webAuthorityContent',
      'episode', 'run', 'lock', 'replacementPermission', 'eligibleOwner', 'correctionMechanism',
      'predecessorCandidate', 'replacementCandidate', 'pathEffectCeiling', 'revalidationBoundary',
      'lifetime', 'currentness', 'permissionConsumption', 'readBack'
    ]),
    requiresExactCurrentReadback: true,
    eligiblePrimaryOwners: Object.freeze(['HARNESS', 'TOOLKIT', 'ENVIRONMENT']),
    eligibleCorrectionMechanisms: Object.freeze([
      'HARNESS_VALIDATION', 'TOOLKIT_VALIDATION', 'ENVIRONMENT_VALIDATION'
    ]),
    episodeKind: 'G3_RUN_LOCK',
    permissionStateRequired: 'AVAILABLE',
    permissionUseCount: 1,
    rejectStaleRevokedSupersededAuthority: true,
    pathAndEffectMustStayWithinCeiling: true,
    productAttemptDelta: 0,
    budgetResetAllowed: false
  }),
  replacementCandidateValidity: Object.freeze({
    requiredFields: Object.freeze([
      'repository', 'kind', 'objectFormat', 'commit', 'head', 'tree', 'orderedParents',
      'baseCommit', 'commitTreeReadback', 'lineage', 'hostedBinding', 'localCustodyBinding',
      'observedMutationScope', 'predecessorPreservation', 'revalidationLinkage'
    ]),
    supportedKinds: Object.freeze(['HOSTED', 'LOCAL']),
    supportedObjectFormats: Object.freeze(['sha1', 'sha256']),
    headMustMatchCommit: true,
    commitTreeReadbackMustMatch: true,
    orderedParentsAndBaseMustMatchLineage: true,
    repositoryEpisodePredecessorMustMatch: true,
    hostedBindingFields: Object.freeze([
      'repository', 'prNumber', 'branch', 'headSha', 'baseCommit', 'readBack'
    ]),
    localCustodyBindingFields: Object.freeze([
      'repository', 'custodyId', 'worktreeId', 'commit', 'tree', 'readBack'
    ]),
    observedMutationScopeMustFitAuthorityCeiling: true,
    predecessorEvidenceMustBePreserved: true,
    evidenceReadbackMustBindCandidateAndRevalidation: true,
    callerHashesAreEqualityAssertionsOnly: true
  }),
  replacementRejection: Object.freeze({
    admission: 'RETURN_TO_WEB',
    candidateTransition: 'NO_ACCEPTED_TRANSITION',
    evidenceTransition: 'NO_ACCEPTED_TRANSITION',
    mutationEffects: Object.freeze([])
  })
});
const S1A_ORACLE_GOVERNED_PROSE_SHA256 = 'd05cf916a616e599709207fea870305502670cf47631a57ff1aae9f66e6cf030';
const S1A_ORACLE_DISPOSITIONS = Object.freeze([
  'CURRENT_SHIP_BLOCKER', 'IMMEDIATE_POST_SHIP', 'FUTURE_OWNED', 'OBSERVE', 'EVIDENCE_ONLY'
]);
const S1A_ORACLE_LIFECYCLES = Object.freeze(['UNRESOLVED', 'RESOLVED']);
const S1A_ORACLE_PROJECTION_ROWS = Object.freeze([
  Object.freeze({ disposition: 'CURRENT_SHIP_BLOCKER', lifecycle: 'UNRESOLVED', twoWay: 'SHIP_BLOCKER', v1: 'BLOCKING' }),
  Object.freeze({ disposition: 'CURRENT_SHIP_BLOCKER', lifecycle: 'RESOLVED', twoWay: 'SHIP_BLOCKER', v1: 'RESOLVED' }),
  ...['IMMEDIATE_POST_SHIP', 'FUTURE_OWNED', 'OBSERVE', 'EVIDENCE_ONLY'].flatMap((disposition) => [
    Object.freeze({ disposition, lifecycle: 'UNRESOLVED', twoWay: 'POST_SHIP', v1: 'NON_BLOCKING' }),
    Object.freeze({ disposition, lifecycle: 'RESOLVED', twoWay: 'POST_SHIP', v1: 'RESOLVED' })
  ])
]);
const S1A_ORACLE_OWNERSHIP_READBACK_RULE = Object.freeze({
  source: 'CURRENT_AUTHORITATIVE_OWNERSHIP_READBACK',
  trustedContextField: 'currentOwnershipReadback',
  mustBeSuppliedIndependently: true,
  mustNotAliasRequestedRecord: true,
  mustMatchRecordReadbackExactly: true,
  mustMatchIndependentAuthoritySnapshot: true,
  requiredFields: Object.freeze([
    'source', 'authoritative', 'current', 'readBack', 'repository', 'packetIdentity', 'findingId',
    'webAdmittedRevision', 'findingRevision', 'candidateIdentity', 'acceptedDecisionId', 'programmeId',
    'childId', 'frontierId', 'controllerId', 'acceptedContractId', 'subjectId', 'observedBehavior',
    'requiredBehavior', 'primaryOwner', 'adjudication', 'ownerRole', 'owner', 'resolution', 'revision', 'digest'
  ]),
  recordBindings: Object.freeze([
    Object.freeze({ readback: 'repository', record: 'REPOSITORY' }),
    Object.freeze({ readback: 'packetIdentity', record: 'PACKET_IDENTITY' }),
    Object.freeze({ readback: 'findingId', record: 'FINDING_ID' }),
    Object.freeze({ readback: 'webAdmittedRevision', record: 'WEB_ADMITTED_REVISION' }),
    Object.freeze({ readback: 'findingRevision', record: 'FINDING_REVISION' }),
    Object.freeze({ readback: 'candidateIdentity', record: 'CANDIDATE_IDENTITY' }),
    Object.freeze({ readback: 'acceptedDecisionId', record: 'ACCEPTED_DECISION_ID' }),
    Object.freeze({ readback: 'programmeId', record: 'PROGRAMME_ID' }),
    Object.freeze({ readback: 'childId', record: 'CHILD_ID' }),
    Object.freeze({ readback: 'frontierId', record: 'FRONTIER_ID' }),
    Object.freeze({ readback: 'controllerId', record: 'CONTROLLER_ID' }),
    Object.freeze({ readback: 'acceptedContractId', record: 'ACCEPTED_CONTRACT_ID' }),
    Object.freeze({ readback: 'subjectId', record: 'SUBJECT_ID' }),
    Object.freeze({ readback: 'observedBehavior', record: 'OBSERVED_BEHAVIOR' }),
    Object.freeze({ readback: 'requiredBehavior', record: 'REQUIRED_BEHAVIOR' }),
    Object.freeze({ readback: 'primaryOwner', record: 'PRIMARY_OWNER' }),
    Object.freeze({ readback: 'adjudication', record: 'ADJUDICATION' }),
    Object.freeze({ readback: 'ownerRole', record: 'OWNER_ROLE' }),
    Object.freeze({ readback: 'owner', record: 'VERIFIED_OWNER' }),
    Object.freeze({ readback: 'resolution', record: 'RESOLUTION' })
  ]),
  digestMode: 'CANONICAL_READBACK_CORE_SHA256',
  resolutionMustRemain: 'NOT_RESOLVED'
});
const S1A_ORACLE_LIFECYCLE_TRANSITIONS = Object.freeze([
  Object.freeze({ event: 'DEFER', from: 'UNRESOLVED', to: 'UNRESOLVED',
    requires: Object.freeze(['VERIFIED_OWNER', 'TIMING', 'TRIGGER_OR_REASON']),
    requiredValueTypes: Object.freeze({ VERIFIED_OWNER: 'NONEMPTY_STRING', TIMING: 'NONEMPTY_STRING',
      TRIGGER_OR_REASON: 'NONEMPTY_STRING' }) }),
  Object.freeze({ event: 'TRANSFER', from: 'UNRESOLVED', to: 'UNRESOLVED',
    requires: Object.freeze(['VERIFIED_OWNER', 'OWNER_READBACK']),
    requiredValueTypes: Object.freeze({ VERIFIED_OWNER: 'NONEMPTY_STRING', OWNER_READBACK: 'NONEMPTY_OBJECT' }),
    ownerReadback: S1A_ORACLE_OWNERSHIP_READBACK_RULE }),
  Object.freeze({ event: 'EVIDENCE_ACQUIRED', from: 'UNRESOLVED', to: 'UNRESOLVED',
    requires: Object.freeze(['EXACT_EVIDENCE']),
    requiredValueTypes: Object.freeze({ EXACT_EVIDENCE: 'NONEMPTY_EVIDENCE_REFERENCES' }) }),
  Object.freeze({ event: 'VERIFIED_CLOSURE', from: 'UNRESOLVED', to: 'RESOLVED',
    requires: Object.freeze(['CLOSURE_CRITERION', 'EXACT_EVIDENCE']),
    requiredValueTypes: Object.freeze({ CLOSURE_CRITERION: 'NONEMPTY_STRING',
      EXACT_EVIDENCE: 'NONEMPTY_EVIDENCE_REFERENCES' }) })
]);
const S1A_ORACLE_EVIDENCE_ONLY = Object.freeze({
  effect: 'CUSTODY_ONLY',
  assertsProductDefect: false,
  authorizesProductCorrection: false,
  independentEvidenceGatesRemainBinding: true
});
const S1A_ORACLE_EVIDENCE_ONLY_MEANING = 'Acquire, preserve or verify evidence as a custody-only action; it neither asserts a product defect nor authorises product correction. Evidence acquisition does not resolve or discard the obligation; required evidence gates remain independently binding.';
const S1A_ORACLE_COMMON_FIELD_NAMES = Object.freeze([
  'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_REVISION', 'ACCEPTED_DECISION_ID',
  'PROGRAMME_ID', 'CHILD_ID', 'FRONTIER_ID', 'CONTROLLER_ID', 'ACCEPTED_CONTRACT_ID',
  'SUBJECT_ID', 'OBSERVED_BEHAVIOR', 'REQUIRED_BEHAVIOR', 'PRIMARY_OWNER', 'ADJUDICATION',
  'OWNER_ROLE', 'OWNER_READBACK', 'RESOLUTION'
]);
const S1A_ORACLE_BLOCKER_FIELDS = Object.freeze([
  'WEB_ADMITTED_REVISION', 'ADMITTED_CURRENT_OUTCOME', 'LOCKED_CRITERION_OR_FLOOR',
  'SHIP_NOW_CONSEQUENCE', 'REQUIRED_OUTCOME_EFFECT', 'SAFE_DEFERRAL_IMPOSSIBLE',
  'SMALLEST_CORRECTION', 'VERIFIABLE_CLOSURE', 'EXACT_EVIDENCE', 'CANDIDATE_IDENTITY',
  ...S1A_ORACLE_COMMON_FIELD_NAMES
]);
const S1A_ORACLE_BLOCKER_RECORD_FIELDS = Object.freeze([
  'FINDING_ID', 'WEB_ADMITTED_REVISION', 'DISPOSITION', 'LIFECYCLE', 'TIMING',
  'VERIFIED_OWNER', 'TRIGGER_OR_REASON', 'CLOSURE_CRITERION', 'EXACT_EVIDENCE',
  'CANDIDATE_IDENTITY', 'DETAIL_REF', 'ADMITTED_CURRENT_OUTCOME',
  'LOCKED_CRITERION_OR_FLOOR', 'SHIP_NOW_CONSEQUENCE', 'REQUIRED_OUTCOME_EFFECT',
  'SAFE_DEFERRAL_IMPOSSIBLE', 'SMALLEST_CORRECTION', 'VERIFIABLE_CLOSURE',
  'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_REVISION', 'ACCEPTED_DECISION_ID',
  'PROGRAMME_ID', 'CHILD_ID', 'FRONTIER_ID', 'CONTROLLER_ID', 'ACCEPTED_CONTRACT_ID',
  'SUBJECT_ID', 'OBSERVED_BEHAVIOR', 'REQUIRED_BEHAVIOR', 'PRIMARY_OWNER', 'ADJUDICATION',
  'OWNER_ROLE', 'OWNER_READBACK', 'RESOLUTION'
]);
const S1A_ORACLE_BLOCKER_TYPED_PATHS = Object.freeze({
  FINDING_ID: 'NONEMPTY_STRING', WEB_ADMITTED_REVISION: 'NONEMPTY_STRING',
  DISPOSITION: 'NONEMPTY_STRING', LIFECYCLE: 'NONEMPTY_STRING', TIMING: 'NONEMPTY_STRING',
  VERIFIED_OWNER: 'NONEMPTY_STRING', TRIGGER_OR_REASON: 'NONEMPTY_STRING',
  CLOSURE_CRITERION: 'NONEMPTY_STRING', EXACT_EVIDENCE: 'NONEMPTY_EVIDENCE_REFERENCES',
  CANDIDATE_IDENTITY: 'NONEMPTY_OBJECT', DETAIL_REF: 'SHA256_REFERENCE',
  REPOSITORY: 'NONEMPTY_STRING', PACKET_IDENTITY: 'NONEMPTY_OBJECT',
  FINDING_REVISION: 'NONEMPTY_STRING', ACCEPTED_DECISION_ID: 'NONEMPTY_STRING',
  PROGRAMME_ID: 'NONEMPTY_STRING', CHILD_ID: 'NONEMPTY_STRING', FRONTIER_ID: 'NONEMPTY_STRING',
  CONTROLLER_ID: 'NONEMPTY_STRING', ACCEPTED_CONTRACT_ID: 'NONEMPTY_STRING', SUBJECT_ID: 'NONEMPTY_STRING',
  OBSERVED_BEHAVIOR: 'NONEMPTY_STRING', REQUIRED_BEHAVIOR: 'NONEMPTY_STRING',
  PRIMARY_OWNER: 'NONEMPTY_STRING', ADJUDICATION: 'NONEMPTY_STRING', OWNER_ROLE: 'NONEMPTY_STRING',
  OWNER_READBACK: 'NONEMPTY_OBJECT', RESOLUTION: 'NONEMPTY_STRING',
  'ADMITTED_CURRENT_OUTCOME.id': 'NONEMPTY_STRING',
  'ADMITTED_CURRENT_OUTCOME.milestone': 'NONEMPTY_STRING',
  'ADMITTED_CURRENT_OUTCOME.audience': 'NONEMPTY_STRING',
  'ADMITTED_CURRENT_OUTCOME.environment': 'NONEMPTY_STRING',
  LOCKED_CRITERION_OR_FLOOR: 'NONEMPTY_STRING',
  'SHIP_NOW_CONSEQUENCE.description': 'NONEMPTY_STRING',
  'SHIP_NOW_CONSEQUENCE.effect': 'ALLOWED_EFFECT',
  'SHIP_NOW_CONSEQUENCE.evidenceRefs': 'NONEMPTY_EVIDENCE_REFERENCES',
  REQUIRED_OUTCOME_EFFECT: 'ALLOWED_EFFECT',
  'SAFE_DEFERRAL_IMPOSSIBLE.satisfied': 'EXACT_TRUE',
  'SAFE_DEFERRAL_IMPOSSIBLE.evidenceRefs': 'NONEMPTY_EVIDENCE_REFERENCES',
  SMALLEST_CORRECTION: 'NONEMPTY_STRING',
  'VERIFIABLE_CLOSURE.oracleId': 'NONEMPTY_STRING',
  'VERIFIABLE_CLOSURE.positiveControlId': 'NONEMPTY_STRING',
  'VERIFIABLE_CLOSURE.evidenceRefs': 'NONEMPTY_EVIDENCE_REFERENCES'
});
const S1A_ORACLE_BLOCKER_ADMISSION_READBACK = Object.freeze({
  mode: 'CURRENT_AUTHORITATIVE_READBACK', field: 'admissionReadback',
  source: 'CANONICAL_WEB_ADMISSION',
  requiredFields: Object.freeze(['source', 'authoritative', 'current', 'readBack',
    'repository', 'revision', 'body', 'bodyDigest']),
  bodySchema: 'toolkit.s1a.web-admission.v1',
  bodyDigestMode: 'SHA256_EXACT_READBACK_BODY'
});
const S1A_ORACLE_BLOCKER_NESTED_FIELDS = Object.freeze([
  Object.freeze({ record: 'ADMITTED_CURRENT_OUTCOME', fields: Object.freeze(['id', 'milestone', 'audience', 'environment']) }),
  Object.freeze({ record: 'SHIP_NOW_CONSEQUENCE', fields: Object.freeze(['description', 'effect', 'evidenceRefs']) }),
  Object.freeze({ record: 'SAFE_DEFERRAL_IMPOSSIBLE', fields: Object.freeze(['satisfied', 'evidenceRefs']) }),
  Object.freeze({ record: 'VERIFIABLE_CLOSURE', fields: Object.freeze(['oracleId', 'positiveControlId', 'evidenceRefs']) })
]);
const S1A_ORACLE_BLOCKER_BINDINGS = Object.freeze([
  Object.freeze({ record: 'FINDING_ID', decision: 'findingId' }),
  Object.freeze({ record: 'REPOSITORY', decision: 'repository' }),
  Object.freeze({ record: 'PACKET_IDENTITY', decision: 'packetIdentity' }),
  Object.freeze({ record: 'FINDING_REVISION', decision: 'findingRevision' }),
  Object.freeze({ record: 'ACCEPTED_DECISION_ID', decision: 'acceptedDecisionId' }),
  Object.freeze({ record: 'ADJUDICATION', decision: 'adjudication' }),
  Object.freeze({ record: 'WEB_ADMITTED_REVISION', decision: 'webRevision' }),
  Object.freeze({ record: 'ADMITTED_CURRENT_OUTCOME', decision: 'currentOutcome' }),
  Object.freeze({ record: 'REQUIRED_OUTCOME_EFFECT', decision: 'requiredOutcomeEffect' }),
  Object.freeze({ record: 'VERIFIABLE_CLOSURE.oracleId', decision: 'closureCriterion' }),
  Object.freeze({ record: 'CANDIDATE_IDENTITY', decision: 'candidateIdentity' }),
  Object.freeze({ record: 'DETAIL_REF', decision: 'detailRef' })
]);
const S1A_ORACLE_BLOCKER_MEMBERSHIP_BINDINGS = Object.freeze([
  Object.freeze({ record: 'LOCKED_CRITERION_OR_FLOOR', decision: 'acceptedCriteria' }),
  Object.freeze({ record: 'EXACT_EVIDENCE', decision: 'evidenceRefs' })
]);
const S1A_ORACLE_BLOCKER_TRUTH_CHECKS = Object.freeze([
  Object.freeze({ record: 'SAFE_DEFERRAL_IMPOSSIBLE', path: 'satisfied', value: true })
]);
const S1A_ORACLE_BLOCKER_EVIDENCE_PATHS = Object.freeze([
  'EXACT_EVIDENCE', 'SHIP_NOW_CONSEQUENCE.evidenceRefs',
  'SAFE_DEFERRAL_IMPOSSIBLE.evidenceRefs', 'VERIFIABLE_CLOSURE.evidenceRefs'
]);
const S1A_ORACLE_EFFECTS = Object.freeze(['FALSE', 'MATERIALLY_UNSAFE', 'UNASSURABLE']);
const S1A_ORACLE_COMPANION_HISTORY_SOURCE = 'CANONICAL_IMMUTABLE_COMPANION_LEDGER';
const S1A_ORACLE_COMPANION_HISTORY_ANCHOR = Object.freeze({
  source: 'CURRENT_CANONICAL_PARENT_CONTRACT',
  field: 'companionHistoryDigest',
  digestMode: 'CANONICAL_LEDGER_SHA256',
  ledgerDigestBinds: 'COMPLETE_APPEND_ONLY_RECORDS',
  readBackRequired: true,
  parentReadbackFields: ['source', 'authoritative', 'current', 'readBack', 'repository', 'revision', 'body', 'bodyDigest'],
  parentBodyBindsLedgerDigest: true
});
const S1A_ORACLE_COMMON_FIELD_TYPES = Object.freeze({
  REPOSITORY: 'NONEMPTY_STRING',
  PACKET_IDENTITY: 'NONEMPTY_OBJECT',
  FINDING_REVISION: 'NONEMPTY_STRING',
  ACCEPTED_DECISION_ID: 'NONEMPTY_STRING',
  PROGRAMME_ID: 'NONEMPTY_STRING',
  CHILD_ID: 'NONEMPTY_STRING',
  FRONTIER_ID: 'NONEMPTY_STRING',
  CONTROLLER_ID: 'NONEMPTY_STRING',
  ACCEPTED_CONTRACT_ID: 'NONEMPTY_STRING',
  SUBJECT_ID: 'NONEMPTY_STRING',
  OBSERVED_BEHAVIOR: 'NONEMPTY_STRING',
  REQUIRED_BEHAVIOR: 'NONEMPTY_STRING',
  PRIMARY_OWNER: 'NONEMPTY_STRING',
  ADJUDICATION: 'NONEMPTY_STRING',
  OWNER_ROLE: 'NONEMPTY_STRING',
  OWNER_READBACK: 'NONEMPTY_OBJECT',
  RESOLUTION: 'NONEMPTY_STRING'
});
const S1A_ORACLE_PACKET_IDENTITY = Object.freeze({
  repository: 'weijunswj/ai-agent-toolkit',
  packetId: 'packet:s1a-increment-1',
  packetRevision: 'packet:revision-7'
});
function makeS1aCommonFindingFields(identity) {
  const fields = {
    REPOSITORY: 'weijunswj/ai-agent-toolkit',
    PACKET_IDENTITY: s1aClone(S1A_ORACLE_PACKET_IDENTITY),
    FINDING_REVISION: 'finding-revision:7',
    ACCEPTED_DECISION_ID: 'decision:web:7',
    PROGRAMME_ID: 'programme:s1a',
    CHILD_ID: 'child:s1a-increment-1',
    FRONTIER_ID: 'frontier:increment-1',
    CONTROLLER_ID: 'controller:web-459',
    ACCEPTED_CONTRACT_ID: 'contract:s1a-i1-25',
    SUBJECT_ID: 'subject:current-candidate',
    OBSERVED_BEHAVIOR: 'Observed behavior violates the accepted criterion.',
    REQUIRED_BEHAVIOR: 'Required behavior satisfies the accepted criterion.',
    PRIMARY_OWNER: 'TOOLKIT',
    ADJUDICATION: 'EVIDENCE_ONLY',
    OWNER_ROLE: 'TOOLKIT_OWNER',
    RESOLUTION: 'NOT_RESOLVED',
    ...s1aClone(identity)
  };
  const readbackCore = {
    source: 'CURRENT_AUTHORITATIVE_OWNERSHIP_READBACK',
    authoritative: true,
    current: true,
    readBack: true,
    repository: fields.REPOSITORY,
    packetIdentity: s1aClone(fields.PACKET_IDENTITY),
    findingId: fields.FINDING_ID,
    findingRevision: fields.FINDING_REVISION,
    candidateIdentity: s1aClone(fields.CANDIDATE_IDENTITY),
    acceptedDecisionId: fields.ACCEPTED_DECISION_ID,
    primaryOwner: fields.PRIMARY_OWNER,
    ownerRole: fields.OWNER_ROLE,
    owner: fields.VERIFIED_OWNER,
    webAdmittedRevision: fields.WEB_ADMITTED_REVISION,
    programmeId: fields.PROGRAMME_ID,
    childId: fields.CHILD_ID,
    frontierId: fields.FRONTIER_ID,
    controllerId: fields.CONTROLLER_ID,
    acceptedContractId: fields.ACCEPTED_CONTRACT_ID,
    subjectId: fields.SUBJECT_ID,
    observedBehavior: fields.OBSERVED_BEHAVIOR,
    requiredBehavior: fields.REQUIRED_BEHAVIOR,
    adjudication: fields.ADJUDICATION,
    resolution: fields.RESOLUTION,
    revision: 'ownership:readback-revision-7'
  };
  fields.OWNER_READBACK = { ...readbackCore, digest: s1aHashRecord(readbackCore) };
  return fields;
}
const S1A_ORACLE_TRANSFER_FINDING_IDENTITY = Object.freeze({
  FINDING_ID: 'finding:transfer',
  WEB_ADMITTED_REVISION: 'web:transfer-7',
  FINDING_REVISION: 'finding-revision:transfer-7',
  ACCEPTED_DECISION_ID: 'decision:web:transfer-7',
  CANDIDATE_IDENTITY: Object.freeze({ commit: 'commit:transfer', tree: 'tree:transfer' }),
  VERIFIED_OWNER: 'owner:current'
});
const S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK = s1aDeepFreeze(s1aClone(
  makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY).OWNER_READBACK));
const S1A_ORACLE_COMPANION_TYPED_FIELDS = Object.freeze({...S1A_ORACLE_COMMON_FIELD_TYPES,

  FINDING_ID: 'NONEMPTY_STRING',
  WEB_ADMITTED_REVISION: 'NONEMPTY_STRING',
  DISPOSITION: 'NONEMPTY_STRING',
  LIFECYCLE: 'NONEMPTY_STRING',
  TIMING: 'NONEMPTY_STRING',
  VERIFIED_OWNER: 'NONEMPTY_STRING',
  TRIGGER_OR_REASON: 'NONEMPTY_STRING',
  CLOSURE_CRITERION: 'NONEMPTY_STRING',
  EXACT_EVIDENCE: 'NONEMPTY_EVIDENCE_REFERENCES',
  CANDIDATE_IDENTITY: 'NONEMPTY_OBJECT'
});
const S1A_ORACLE_COMPANION_CURRENT_INVENTORY_RULE = Object.freeze({
  mode: 'CURRENT_AUTHORITATIVE_COMPLETE_READBACK',
  source: 'CURRENT_WEB_ADMISSION_COMPANION_INVENTORY',
  readbackFields: Object.freeze([
    'source', 'authoritative', 'current', 'complete', 'readBack', 'repository', 'packetIdentity', 'acceptedDecisionIds', 'candidateIdentities', 'revision', 'records', 'digest'
  ]),
  recordFields: Object.freeze(['ref', 'record']),
  digestMode: 'CANONICAL_COMPLETE_RECORD_INVENTORY_SHA256',
  recordsField: 'records'
});
const S1A_ORACLE_CLOSURE_VERIFICATION = Object.freeze({
  mode: 'CURRENT_AUTHORITATIVE_WEB_CLOSURE_READBACK',
  source: 'CURRENT_WEB_CLOSURE_ADMISSION',
  requiredFields: Object.freeze([
    'source', 'authoritative', 'current', 'readBack', 'repository', 'revision',
    'findingId', 'webAdmittedRevision', 'disposition', 'fromLifecycle', 'toLifecycle',
    'closureCriterion', 'exactEvidence', 'candidateIdentity', 'body', 'bodyDigest'
  ]),
  bodyFields: Object.freeze([
    'repository', 'findingId', 'webAdmittedRevision', 'disposition',
    'fromLifecycle', 'toLifecycle', 'closureCriterion', 'exactEvidence', 'candidateIdentity'
  ]),
  digestMode: 'SHA256_EXACT_READBACK_BODY',
  resolvesOnlyAfterVerifiedReadback: true,
  retainsAdmittedDisposition: true
});
const S1A_ORACLE_CLOSURE_BODY = Object.freeze({
  repository: 'weijunswj/ai-agent-toolkit',
  findingId: 'finding:closure',
  webAdmittedRevision: 'web:revision-7',
  disposition: 'FUTURE_OWNED',
  fromLifecycle: 'UNRESOLVED',
  toLifecycle: 'RESOLVED',
  closureCriterion: 'criterion:close',
  exactEvidence: Object.freeze(['evidence:verified']),
  candidateIdentity: Object.freeze({ commit: 'commit:7', tree: 'tree:7' })
});
const S1A_ORACLE_CLOSURE_BODY_TEXT = s1aCanonical(S1A_ORACLE_CLOSURE_BODY);
const S1A_ORACLE_CLOSURE_READBACK = Object.freeze({
  source: 'CURRENT_WEB_CLOSURE_ADMISSION',
  authoritative: true,
  current: true,
  readBack: true,
  repository: S1A_ORACLE_CLOSURE_BODY.repository,
  revision: 'web:closure-admission-8',
  findingId: S1A_ORACLE_CLOSURE_BODY.findingId,
  webAdmittedRevision: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
  disposition: S1A_ORACLE_CLOSURE_BODY.disposition,
  fromLifecycle: S1A_ORACLE_CLOSURE_BODY.fromLifecycle,
  toLifecycle: S1A_ORACLE_CLOSURE_BODY.toLifecycle,
  closureCriterion: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
  exactEvidence: S1A_ORACLE_CLOSURE_BODY.exactEvidence,
  candidateIdentity: S1A_ORACLE_CLOSURE_BODY.candidateIdentity,
  body: S1A_ORACLE_CLOSURE_BODY_TEXT,
  bodyDigest: s1aHashText(S1A_ORACLE_CLOSURE_BODY_TEXT)
});
const S1A_ORACLE_HISTORY_IDENTITY_FIELDS = Object.freeze(['FINDING_ID', 'WEB_ADMITTED_REVISION', 'CANDIDATE_IDENTITY']);
const S1A_ORACLE_COMPANION_IDENTITY_FIELDS = Object.freeze([
  'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_ID', 'WEB_ADMITTED_REVISION', 'CANDIDATE_IDENTITY'
]);
const S1A_ORACLE_COMPANION_PROJECTION_FIELDS = Object.freeze([
  'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_ID', 'FINDING_REVISION',
  'WEB_ADMITTED_REVISION', 'DISPOSITION', 'LIFECYCLE', 'CANDIDATE_IDENTITY', 'ACCEPTED_DECISION_ID'
]);const S1A_ORACLE_POST_CHILD_RECEIPT_IDS = Object.freeze(['receipt:merge', 'receipt:child-terminal']);
const S1A_ORACLE_POST_CHILD_CHECK_IDS = Object.freeze(['check:integration', 'check:policy']);
const S1A_ORACLE_BOUNDARY_RUN_EVENTS = Object.freeze([
  'CANDIDATE_BOUND', 'ACCEPTED_BOUNDARY_INVOKED', 'BOUNDARY_OUTCOME_OBSERVED', 'RUN_TERMINAL'
]);
const S1A_ORACLE_IDENTITY_FIELDS = Object.freeze([
  'FINDING_ID', 'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_REVISION',
  'WEB_ADMITTED_REVISION', 'CANDIDATE_IDENTITY', 'ACCEPTED_DECISION_ID',
  'DISPOSITION', 'LIFECYCLE', 'DETAIL_REF'
]);
const S1A_ORACLE_DETAIL_FIELDS = Object.freeze([
  'FINDING_ID', 'WEB_ADMITTED_REVISION', 'DISPOSITION', 'LIFECYCLE', 'TIMING',
  'VERIFIED_OWNER', 'TRIGGER_OR_REASON', 'CLOSURE_CRITERION', 'EXACT_EVIDENCE',
  'CANDIDATE_IDENTITY', ...Object.keys(S1A_ORACLE_COMMON_FIELD_TYPES)
]);
const S1A_ORACLE_BLOCKER_PROOF_FIELDS = Object.freeze(
  S1A_ORACLE_BLOCKER_RECORD_FIELDS.filter((field) => field !== 'DETAIL_REF'));
const S1A_ORACLE_REVIEW_SNAPSHOT_FIELDS = Object.freeze([
  'repository', 'deliveryChildId', 'commit', 'tree',
  'reviewRouteAuthorityRevision', 'reviewRouteAuthorityDigest',
  'parentContractRevision', 'parentContractDigest',
  'childStateRevision', 'childStateDigest', 'terminalReceiptIds',
  'applicableIntegratedCheckIds'
]);
const S1A_REVIEW_EVENTS = Object.freeze([
  'FINAL_DELIVERY_CHILD_MERGED', 'INTEGRATED_IDENTITY_READ_BACK',
  'CURRENT_PARENT_CONTRACT_READ_BACK', 'CURRENT_CHILD_STATE_READ_BACK',
  'REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK', 'APPLICABLE_CHECK_MEMBERSHIP_READ_BACK',
  'MERGE_TRIGGERED_CI_STARTED', 'REVIEW_A_STARTED', 'REVIEW_B_STARTED',
  'REPORT_A_TERMINAL', 'REPORT_B_TERMINAL', 'TERMINAL_RECEIPTS_READ_BACK',
  'TERMINAL_RECEIPTS_TERMINAL', 'APPLICABLE_CHECKS_READ_BACK',
  'APPLICABLE_CHECKS_TERMINAL', 'WEB_ADJUDICATION'
]);
const S1A_PEER_VISIBILITY_EVENTS = Object.freeze([
  'REPORT_A_VISIBLE_TO_B', 'REPORT_B_VISIBLE_TO_A'
]);

function s1aRequire(condition, message) {
  if (!condition) throw new Error(message);
}

function s1aExactKeys(value, expected, label) {
  s1aRequire(value !== null && typeof value === 'object' && !Array.isArray(value),
    label + ' must be an object');
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  s1aRequire(unknown.length === 0, 'unknown declaration at ' + label + ': ' + unknown.join(','));
  s1aRequire(missing.length === 0, 'missing declaration at ' + label + ': ' + missing.join(','));
}

function s1aUniqueStrings(value, label, allowed) {
  s1aRequire(Array.isArray(value), label + ' must be an array');
  s1aRequire(value.every((item) => typeof item === 'string' && item.length > 0),
    label + ' contains a non-string or empty declaration');
  s1aRequire(new Set(value).size === value.length, 'duplicate declaration at ' + label);
  if (allowed) {
    const unknown = value.filter((item) => !allowed.includes(item));
    s1aRequire(unknown.length === 0, 'unresolved declaration at ' + label + ': ' + unknown.join(','));
  }
}

function s1aParseJsonRejectDuplicates(source) {
  let index = 0;
  function whitespace() {
    while (index < source.length && /\s/.test(source[index])) index++;
  }
  function stringValue() {
    s1aRequire(source[index] === '"', 'expected JSON string at ' + index);
    const start = index++;
    while (index < source.length) {
      if (source[index] === '\\') index += 2;
      else if (source[index] === '"') {
        index++;
        return JSON.parse(source.slice(start, index));
      } else index++;
    }
    throw new Error('unterminated JSON string');
  }
  function value(depth) {
    s1aRequire(depth <= 32, 'JSON nesting limit exceeded');
    whitespace();
    const token = source[index];
    if (token === '{') {
      index++;
      const result = Object.create(null);
      const keys = new Set();
      whitespace();
      if (source[index] === '}') { index++; return result; }
      while (index < source.length) {
        whitespace();
        const key = stringValue();
        s1aRequire(!keys.has(key), 'duplicate JSON key: ' + key);
        keys.add(key);
        whitespace();
        s1aRequire(source[index] === ':', 'expected colon after JSON key ' + key);
        index++;
        result[key] = value(depth + 1);
        whitespace();
        if (source[index] === '}') { index++; return result; }
        s1aRequire(source[index] === ',', 'expected comma in JSON object');
        index++;
      }
      throw new Error('unterminated JSON object');
    }
    if (token === '[') {
      index++;
      const result = [];
      whitespace();
      if (source[index] === ']') { index++; return result; }
      while (index < source.length) {
        result.push(value(depth + 1));
        whitespace();
        if (source[index] === ']') { index++; return result; }
        s1aRequire(source[index] === ',', 'expected comma in JSON array');
        index++;
      }
      throw new Error('unterminated JSON array');
    }
    if (token === '"') return stringValue();
    const start = index;
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
    const primitive = source.slice(start, index);
    s1aRequire(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(primitive),
      'invalid JSON value at ' + start);
    return JSON.parse(primitive);
  }
  const result = value(0);
  whitespace();
  s1aRequire(index === source.length, 'trailing JSON content');
  return result;
}

function s1aGovernedHumanPolicyDigest(source) {
  const policyLawStart = source.indexOf('## Shipping disposition and current blocker admission');
  const policyLaw = source.slice(policyLawStart);
  const policyLawEnd = /\r?\n## Child sizing and splitting/.exec(policyLaw);
  s1aRequire(policyLawStart >= 0 && policyLawEnd,
    'Architecture current shipping law section is missing or ambiguous');
  const governedSection = policyLaw.slice(0, policyLawEnd.index);
  const canonicalStart = governedSection.indexOf('### Canonical disposition vocabulary');
  const g1Start = governedSection.indexOf('### G1 re-convergence', canonicalStart);
  s1aRequire(canonicalStart >= 0 && g1Start > canonicalStart,
    'Architecture governed human policy range is missing or ambiguous');
  const canonicalFailClosed =
    'If any field is missing or contradictory, do not admit this disposition; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.';
  const acceptedEquivalentFailClosed =
    'If any field is missing or contradictory, this disposition must fail closed; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.';
  // G1 re-convergence is separate policy. Normalize line endings; the machine contract is independently interpreted below.
  const governedHumanPolicy = governedSection.slice(0, g1Start)
    .replace(/~~~s1a-policy-contract-v1\r?\n[\s\S]*?\r?\n~~~/,
      '~~~s1a-policy-contract-v1\n[fixed-machine-contract]\n~~~')
    .replace(/\r\n?/g, '\n')
    .replace(acceptedEquivalentFailClosed, canonicalFailClosed);
  return crypto.createHash('sha256').update(governedHumanPolicy, 'utf8').digest('hex');
}
function s1aProseRange(source, startHeading, endHeading) {
  const start = source.indexOf(startHeading);
  const end = source.indexOf(endHeading, start);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function s1aContinuationProseViolations(source) {
  const prose = s1aProseRange(source, '### Bounded non-product continuation', '### Faithful validation carrier');
  const required = [
    ['CONTINUATION_OWNER_PRODUCT_BOUNDARY', [
      'conclusive primary attribution to HARNESS, TOOLKIT, ENVIRONMENT, VALIDATION_CARRIER, or TRANSPORT',
      'PRODUCT or UNKNOWN never grants autonomous continuation',
      'PRODUCT_SEMANTICS_PROVEN_BAD=YES is not product-correction authority'
    ]],
    ['CONTINUATION_EPISODE_SCOPE_AUTHORITY', [
      'any other currently accepted Web-bounded evidence episode recorded by its authoritative readback',
      'G3 and LIGHT are examples, not an exclusive episode set.',
      'The current episode authority, primary owner, semantics, root, trust model, scope, assurance floor and accepted evidence boundary remain exact.'
    ]],
    ['CONTINUATION_ACCEPTED_AUTHORITY_READBACK', [
      'The episode kind and primary owner must match the independently accepted current Web authority readback.'
    ]],
    ['CONTINUATION_CURRENT_STATE_READBACK', [
      'A complete current accepted-G2 state readback binds the exact episode authority and owner, candidate and evidence identities, attempt and budget counters and limits, current failure signature, faithful-path inventory digest, and full continuation history.',
      'Omitted, stale, partial or caller-rebound authority, history, identities, counters or limits return to Web.'
    ]],
    ['CONTINUATION_ATTEMPT_LIMITS', [
      'Attempt, product-correction and consumed-budget counts may not exceed their accepted limits; any over-limit count returns to Web.'
    ]],
    ['CONTINUATION_EFFECT_RECONCILIATION', [
      'Independently reconcile effects and faithful-path inventory; an unreconciled effect or exhausted faithful path returns to Web.'
    ]],
    ['CONTINUATION_FAITHFUL_PATH_USABILITY', [
      'A remaining faithful path must have an exact non-empty path identity, actual path and evidence reference bound to the accepted candidate, evidence boundary and independent accepted-state inventory digest; missing or caller-rebound path evidence returns to Web.'
    ]],
    ['CONTINUATION_FAITHFUL_PATH_PROGRESS', [
      'Repeated materially equivalent no-progress history returns to Web even when run, worker, branch or candidate labels change.'
    ]],
    ['CONTINUATION_IDENTITY_BUDGET_PRESERVATION', [
      'Identity-preserving recovery keeps the exact candidate and evidence identities, and every candidate remains immutable.',
      'It does not widen the existing authority, mutation boundary, accepted scope/floor or prerequisite graph, grant a new continuation, reset a budget'
    ]],
    ['CONTINUATION_REPLACEMENT_AUTHORITY', [
      'only the existing explicitly Web-authorised hosted non-product reclosure may create a distinct immutable replacement candidate',
      'TRANSPORT-only recovery does not use this replacement-candidate exception without separate explicit Web authority.'
    ]],
    ['CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', [
      'The replacement observer receives observe(policy, request, trustedContext).',
      'trustedContext.currentAuthority, candidateReadback, and evidenceReadback are separate from the request and remain unchanged when request fields are mutated.',
      'Caller-selected labels and caller-recomputed hashes or digests are equality assertions only; they never select or establish authority.',
      'The independent candidate readback binds repository, HOSTED or LOCAL kind, object format, non-empty commit/head/tree identities, ordered parents, base commit, exact commit-to-tree readback, predecessor/base/parent lineage, kind-specific hosted PR/branch/head or local custody, observed mutation/effect scope, predecessor preservation and exact revalidation linkage.',
      'HOSTED and LOCAL bindings cannot be substituted for each other.',
      'Independent evidence readback must bind the exact replacement candidate, preserved predecessor evidence and revalidation boundary.',
      'A rejected replacement produces no accepted candidate transition, no accepted evidence transition and no CREATE_DISTINCT_WEB_AUTHORISED_REPLACEMENT effect, even when another helper condition succeeded.'
    ]]
  ];
  const failures = required.filter(([, clauses]) => clauses.some((clause) => !prose.includes(clause)))
    .map(([id]) => id);
  const contradictions = [
    [/Contradiction:\s*PRODUCT or UNKNOWN may continue autonomously/i, 'CONTINUATION_OWNER_PRODUCT_BOUNDARY'],
    [/Contradiction:\s*PRODUCT_SEMANTICS_PROVEN_BAD=YES authorizes product correction/i, 'CONTINUATION_OWNER_PRODUCT_BOUNDARY'],
    [/Contradiction:\s*G3 and LIGHT are the only accepted evidence episodes/i, 'CONTINUATION_EPISODE_SCOPE_AUTHORITY'],
    [/Contradiction:\s*the episode may widen root, trust, scope, floor, or evidence boundary/i, 'CONTINUATION_EPISODE_SCOPE_AUTHORITY'],
    [/Contradiction:\s*caller-rebound episode authority or owner may replace the accepted Web readback/i, 'CONTINUATION_ACCEPTED_AUTHORITY_READBACK'],
    [/Contradiction:\s*partial caller history may replace the authoritative readback/i, 'CONTINUATION_CURRENT_STATE_READBACK'],
    [/Contradiction:\s*attempt, product-correction or consumed-budget counts may exceed their accepted limits/i, 'CONTINUATION_ATTEMPT_LIMITS'],
    [/Contradiction:\s*unreconciled effects may be ignored/i, 'CONTINUATION_EFFECT_RECONCILIATION'],
    [/Contradiction:\s*an exhausted faithful path may continue/i, 'CONTINUATION_FAITHFUL_PATH_PROGRESS'],
    [/Contradiction:\s*renamed no-progress history is new progress/i, 'CONTINUATION_FAITHFUL_PATH_PROGRESS'],
    [/Contradiction:\s*a path without an actual path or evidence reference may continue/i, 'CONTINUATION_FAITHFUL_PATH_USABILITY'],
    [/Contradiction:\s*candidate, evidence, attempts, or consumed budgets may be reset/i, 'CONTINUATION_IDENTITY_BUDGET_PRESERVATION'],
    [/Contradiction:\s*TRANSPORT may create a replacement candidate/i, 'CONTINUATION_REPLACEMENT_AUTHORITY'],
    [/Contradiction:\s*caller-selected labels or caller-recomputed hashes or digests may select or establish authority/i, 'CONTINUATION_REPLACEMENT_AUTHORITY'],
    [/Contradiction:\s*HOSTED and LOCAL bindings may be substituted for each other/i, 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY'],
    [/Contradiction:\s*caller-supplied labels and rehashed evidence establish a replacement candidate/i, 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY'],
    [/Contradiction:\s*a rejected replacement may retain a CREATE_DISTINCT_WEB_AUTHORISED_REPLACEMENT effect/i, 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY']
  ];
  for (const [pattern, id] of contradictions) if (pattern.test(prose) && !failures.includes(id)) failures.push(id);
  return failures;
}
function s1aCarrierProseViolations(source) {
  const prose = s1aProseRange(source, '### Faithful validation carrier', '### G1 re-convergence');
  const required = [
    ['CARRIER_AUTHORITATIVE_INVENTORY_ORDER', [
      'Treat the carrier inventory as an authoritative current readback, not caller-supplied availability.',
      'A carrier is an execution substrate, not one dedicated test application per repository;',
      'Select faithful local/dev first, then reconcile suitable existing Owner-authorised execution infrastructure, and provision or expand only after that reconciliation proves necessity.'
    ]],
    ['CARRIER_EXECUTION_EVIDENCE_BINDING', [
      'Bind the selected carrier identity and actual path to the candidate, accepted criterion, accepted execution path, enforcement boundary and required terminal execution/readback evidence.',
      'A carrier is faithful only when independently bound read-back evidence contains a terminal execution receipt from an actual invocation of the selected carrier path and accepted production path, and binds that exact carrier identity, accepted criterion, immutable candidate and enforcement boundary to its ordered run events and execution-evidence digest.'
    ]],
    ['CARRIER_PUBLIC_AUTHORITY_MATCH', [
      'Public ingress is admissible only when a specific accepted validation criterion requires it and a current authoritative Owner/Web readback binds the exact exposure and public request, including consumer, protocol, path, hostname requirement and hostname, accepted criterion, necessity, audience, boundary, lifetime and cleanup.'
    ]],
    ['CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY', [
      'If domain registration or DNS is required, each operation needs its own current authoritative Owner/Web readback bound to that exposure with a distinct authority reference; one combined grant is insufficient.'
    ]],
    ['CARRIER_PRIVATE_PERSISTENCE', [
      'The default carrier remains PRIVATE/NONPUBLIC without domain registration, DNS or public ingress.',
      'Persistence does not imply exposure.'
    ]]
  ];
  const failures = required.filter(([, clauses]) => clauses.some((clause) => !prose.includes(clause)))
    .map(([id]) => id);
  const contradictions = [
    [/Contradiction:\s*caller-supplied availability is authoritative/i, 'CARRIER_AUTHORITATIVE_INVENTORY_ORDER'],
    [/Contradiction:\s*one dedicated test application is required per repository/i, 'CARRIER_AUTHORITATIVE_INVENTORY_ORDER'],
    [/Contradiction:\s*provision before reconciling existing Owner infrastructure/i, 'CARRIER_AUTHORITATIVE_INVENTORY_ORDER'],
    [/Contradiction:\s*equivalent shape alone proves boundary exercise/i, 'CARRIER_EXECUTION_EVIDENCE_BINDING'],
    [/Contradiction:\s*faithful by shape equivalence without a terminal execution receipt/i, 'CARRIER_EXECUTION_EVIDENCE_BINDING'],
    [/Contradiction:\s*public request details need not match Owner authority/i, 'CARRIER_PUBLIC_AUTHORITY_MATCH'],
    [/Contradiction:\s*one combined domain and DNS grant is sufficient/i, 'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY'],
    [/Contradiction:\s*persistence implies public exposure/i, 'CARRIER_PRIVATE_PERSISTENCE']
  ];
  for (const [pattern, id] of contradictions) if (pattern.test(prose) && !failures.includes(id)) failures.push(id);
  return failures;
}

function s1aReadPolicy(source) {
  const matches = [...source.matchAll(/~~~s1a-policy-contract-v1\r?\n([\s\S]*?)\r?\n~~~/g)];
  s1aRequire(matches.length === 1, 'Architecture must contain exactly one S1-A policy contract');
  const policy = s1aParseJsonRejectDuplicates(matches[0][1]);
  const policyLawStart = source.indexOf('## Shipping disposition and current blocker admission');
  const policyLawEnd = source.indexOf('\n## Child sizing and splitting', policyLawStart);
  s1aRequire(policyLawStart >= 0 && policyLawEnd > policyLawStart,
    'Architecture current shipping law section is missing or ambiguous');
  const policyLawProse = source.slice(policyLawStart, policyLawEnd);
  s1aExactKeys(policy, [
    'schema', 'dispositions', 'lifecycles', 'evidenceOnly', 'projectionRows', 'blocker', 'companion',
    'lifecycleTransitions', 'closureVerification', 'postChildReview', 'faithfulCarrier', 'boundedContinuation'
  ], 'root');
  s1aRequire(policy.schema === 'toolkit.s1a.policy-contract.v1', 'unknown S1-A policy schema');
  s1aRequire(s1aSame(policy.boundedContinuation, S1A_ORACLE_BOUNDED_CONTINUATION_POLICY),
    'bounded continuation contract differs from fixed behavioral observer');
  s1aUniqueStrings(policy.dispositions, 'dispositions', S1A_ORACLE_DISPOSITIONS);
  s1aRequire(s1aSame(policy.dispositions, S1A_ORACLE_DISPOSITIONS), 'canonical disposition set or order changed');
  s1aUniqueStrings(policy.lifecycles, 'lifecycles', S1A_ORACLE_LIFECYCLES);
  s1aRequire(s1aSame(policy.lifecycles, S1A_ORACLE_LIFECYCLES), 'lifecycle set or order changed');
  s1aExactKeys(policy.evidenceOnly,
    ['effect', 'assertsProductDefect', 'authorizesProductCorrection',
      'independentEvidenceGatesRemainBinding'], 'evidenceOnly');
  s1aRequire(['CUSTODY_ONLY', 'PRODUCT_EFFECT_ALLOWED'].includes(policy.evidenceOnly.effect),
    'unknown EVIDENCE_ONLY effect mode');
  s1aRequire(s1aSame(policy.evidenceOnly, S1A_ORACLE_EVIDENCE_ONLY),
    'EVIDENCE_ONLY custody and independent-gate semantics changed');
  s1aRequire(Array.isArray(policy.projectionRows), 'projectionRows must be an array');
  const projectionKeys = new Set();
  for (const row of policy.projectionRows) {
    s1aExactKeys(row, ['disposition', 'lifecycle', 'twoWay', 'v1'], 'projection row');
    s1aRequire(S1A_ORACLE_DISPOSITIONS.includes(row.disposition), 'unresolved projection disposition');
    s1aRequire(S1A_ORACLE_LIFECYCLES.includes(row.lifecycle), 'unresolved projection lifecycle');
    s1aRequire(['SHIP_BLOCKER', 'POST_SHIP'].includes(row.twoWay), 'unresolved two-way projection');
    s1aRequire(['BLOCKING', 'NON_BLOCKING', 'RESOLVED'].includes(row.v1), 'unresolved v1 projection');
    const key = row.disposition + '/' + row.lifecycle;
    s1aRequire(!projectionKeys.has(key), 'duplicate projection declaration: ' + key);
    projectionKeys.add(key);
  }
  s1aRequire(projectionKeys.size === S1A_ORACLE_DISPOSITIONS.length * S1A_ORACLE_LIFECYCLES.length,
    'projectionRows must cover every disposition/lifecycle pair');
  s1aRequire(s1aSame(policy.projectionRows, S1A_ORACLE_PROJECTION_ROWS),
    'legacy projection mapping changed from the fixed oracle');

  const blockerFields = [...S1A_ORACLE_BLOCKER_RECORD_FIELDS];
  const blockerPaths = [...blockerFields, 'SHIP_NOW_CONSEQUENCE.effect',
    'SHIP_NOW_CONSEQUENCE.evidenceRefs', 'SAFE_DEFERRAL_IMPOSSIBLE.satisfied',
    'SAFE_DEFERRAL_IMPOSSIBLE.evidenceRefs', 'VERIFIABLE_CLOSURE.oracleId',
    'VERIFIABLE_CLOSURE.evidenceRefs', 'VERIFIABLE_CLOSURE.positiveControlId'];
  s1aExactKeys(policy.blocker, [
    'requiredFields', 'identityFields', 'admittedDisposition', 'admittedLifecycle',
    'allowedEffects', 'bindings', 'membershipBindings', 'truthChecks',
    'recordFields', 'typedPaths', 'nestedShapeMode', 'admissionReadback',
    'nestedRequiredFields', 'evidenceReferencePaths', 'effectBinding', 'proofBinding'
  ], 'blocker');
  s1aUniqueStrings(policy.blocker.requiredFields, 'blocker.requiredFields', S1A_ORACLE_BLOCKER_FIELDS);
  s1aRequire(s1aSame(policy.blocker.requiredFields, S1A_ORACLE_BLOCKER_FIELDS),
    'blocker required fields are incomplete');
  s1aUniqueStrings(policy.blocker.identityFields, 'blocker.identityFields', S1A_ORACLE_IDENTITY_FIELDS);
  s1aRequire(s1aSame(policy.blocker.identityFields, S1A_ORACLE_IDENTITY_FIELDS),
    'blocker identity fields are incomplete');
  s1aUniqueStrings(policy.blocker.recordFields, 'blocker.recordFields', S1A_ORACLE_BLOCKER_RECORD_FIELDS);
  s1aRequire(s1aSame(policy.blocker.recordFields, S1A_ORACLE_BLOCKER_RECORD_FIELDS),
    'blocker record shape is incomplete');
  s1aRequire(s1aSame(policy.blocker.typedPaths, S1A_ORACLE_BLOCKER_TYPED_PATHS) &&
    policy.blocker.nestedShapeMode === 'EXACT_DECLARED_FIELDS' &&
    s1aSame(policy.blocker.admissionReadback, S1A_ORACLE_BLOCKER_ADMISSION_READBACK),
    'blocker value types or authoritative admission readback are incomplete');
  s1aUniqueStrings(policy.blocker.allowedEffects, 'blocker.allowedEffects', S1A_ORACLE_EFFECTS);
  s1aRequire(s1aSame(policy.blocker.allowedEffects, S1A_ORACLE_EFFECTS),
    'blocker effect set is incomplete');
  s1aRequire(policy.blocker.admittedDisposition === 'CURRENT_SHIP_BLOCKER' &&
    policy.blocker.admittedLifecycle === 'UNRESOLVED',
    'blocker admission must remain current and unresolved');
  s1aRequire(Array.isArray(policy.blocker.bindings), 'blocker.bindings must be an array');
  for (const row of policy.blocker.bindings) {
    s1aExactKeys(row, ['record', 'decision'], 'blocker binding');
    s1aRequire(blockerPaths.includes(row.record), 'unresolved blocker record binding');
    s1aRequire(['findingId', 'repository', 'packetIdentity', 'findingRevision', 'acceptedDecisionId',
      'adjudication', 'webRevision', 'currentOutcome', 'closureCriterion',
      'candidateIdentity', 'detailRef', 'requiredOutcomeEffect'].includes(row.decision), 'unresolved blocker decision binding');
  }
  s1aRequire(s1aSame(policy.blocker.bindings, S1A_ORACLE_BLOCKER_BINDINGS),
    'blocker decision bindings are incomplete');
  s1aRequire(Array.isArray(policy.blocker.membershipBindings), 'membershipBindings must be an array');
  for (const row of policy.blocker.membershipBindings) {
    s1aExactKeys(row, ['record', 'decision'], 'blocker membership');
    s1aRequire(['LOCKED_CRITERION_OR_FLOOR', 'EXACT_EVIDENCE'].includes(row.record) &&
      ['acceptedCriteria', 'evidenceRefs'].includes(row.decision), 'unresolved blocker membership');
  }
  s1aRequire(s1aSame(policy.blocker.membershipBindings, S1A_ORACLE_BLOCKER_MEMBERSHIP_BINDINGS),
    'blocker membership bindings are incomplete');
  s1aRequire(Array.isArray(policy.blocker.truthChecks), 'truthChecks must be an array');
  for (const row of policy.blocker.truthChecks) {
    s1aExactKeys(row, ['record', 'path', 'value'], 'blocker truth check');
    s1aRequire(row.record === 'SAFE_DEFERRAL_IMPOSSIBLE' && row.path === 'satisfied' &&
      typeof row.value === 'boolean', 'unresolved blocker truth check');
  }
  s1aRequire(s1aSame(policy.blocker.truthChecks, S1A_ORACLE_BLOCKER_TRUTH_CHECKS),
    'blocker truth checks are incomplete');
  s1aRequire(Array.isArray(policy.blocker.nestedRequiredFields), 'nestedRequiredFields must be an array');
  const nestedFields = Object.fromEntries(S1A_ORACLE_BLOCKER_NESTED_FIELDS
    .map((row) => [row.record, row.fields]));
  for (const row of policy.blocker.nestedRequiredFields) {
    s1aExactKeys(row, ['record', 'fields'], 'nested blocker requirement');
    s1aRequire(Object.prototype.hasOwnProperty.call(nestedFields, row.record),
      'unresolved nested blocker record');
    s1aUniqueStrings(row.fields, 'nested fields', nestedFields[row.record]);
  }
  s1aRequire(s1aSame(policy.blocker.nestedRequiredFields, S1A_ORACLE_BLOCKER_NESTED_FIELDS),
    'nested blocker field set is incomplete');
  s1aUniqueStrings(policy.blocker.evidenceReferencePaths, 'evidenceReferencePaths', [
    'EXACT_EVIDENCE', 'SHIP_NOW_CONSEQUENCE.evidenceRefs',
    'SAFE_DEFERRAL_IMPOSSIBLE.evidenceRefs', 'VERIFIABLE_CLOSURE.evidenceRefs'
  ]);
  s1aRequire(s1aSame(policy.blocker.evidenceReferencePaths, S1A_ORACLE_BLOCKER_EVIDENCE_PATHS),
    'blocker evidence references are incomplete');
  s1aExactKeys(policy.blocker.effectBinding, ['record', 'consequence'], 'effect binding');
  s1aRequire(policy.blocker.effectBinding.record === 'REQUIRED_OUTCOME_EFFECT' &&
    policy.blocker.effectBinding.consequence === 'SHIP_NOW_CONSEQUENCE.effect',
    'unresolved effect binding');
  s1aExactKeys(policy.blocker.proofBinding, ['mode', 'fields'], 'blocker proofBinding');
  s1aRequire(policy.blocker.proofBinding.mode === 'SAME_CONTENT_ADDRESSED_COMPANION_RECORD' &&
    s1aSame(policy.blocker.proofBinding.fields, S1A_ORACLE_BLOCKER_PROOF_FIELDS),
    'blocker proof must be bound to the full content-addressed companion');
  s1aRequire(s1aSame(policy.blocker.bindings, S1A_ORACLE_BLOCKER_BINDINGS),
    'blocker decision bindings are incomplete');
  s1aRequire(s1aSame(policy.blocker.membershipBindings, S1A_ORACLE_BLOCKER_MEMBERSHIP_BINDINGS),
    'blocker membership bindings are incomplete');
  s1aRequire(s1aSame(policy.blocker.truthChecks, S1A_ORACLE_BLOCKER_TRUTH_CHECKS),
    'blocker truth checks are incomplete');
  s1aRequire(s1aSame(policy.blocker.evidenceReferencePaths, S1A_ORACLE_BLOCKER_EVIDENCE_PATHS),
    'blocker evidence references are incomplete');

  s1aExactKeys(policy.companion, [
    'requiredFields', 'projectionBindingFields', 'legacyProjectionFields', 'referenceField',
    'recordReferenceField', 'referenceMode', 'currentUniquenessFields', 'typedFields', 'currentInventory',
    'historicalEvidenceMode', 'historySource', 'historyAnchor'
  ], 'companion');
  s1aUniqueStrings(policy.companion.requiredFields, 'companion.requiredFields', S1A_ORACLE_DETAIL_FIELDS);
  s1aRequire(s1aSame(policy.companion.requiredFields, S1A_ORACLE_DETAIL_FIELDS),
    'companion detail fields are incomplete');
  s1aUniqueStrings(policy.companion.projectionBindingFields, 'projectionBindingFields', S1A_ORACLE_COMPANION_PROJECTION_FIELDS);
  s1aRequire(s1aSame(policy.companion.projectionBindingFields, S1A_ORACLE_COMPANION_PROJECTION_FIELDS),
    'companion projection identity bindings are incomplete');
  s1aUniqueStrings(policy.companion.legacyProjectionFields, 'legacyProjectionFields',
    ['TWO_WAY', 'V1']);
  s1aRequire(s1aSame(policy.companion.legacyProjectionFields, ['TWO_WAY', 'V1']),
    'legacy projection bindings are incomplete');
  s1aRequire(policy.companion.referenceField === 'DETAIL_REF' &&
    policy.companion.recordReferenceField === 'ref', 'unresolved companion reference binding');
  s1aRequire(policy.companion.referenceMode === 'CANONICAL_RECORD_SHA256',
    'companion references must bind canonical record content');
  s1aRequire(s1aSame(policy.companion.currentUniquenessFields, S1A_ORACLE_COMPANION_IDENTITY_FIELDS) &&
    s1aSame(policy.companion.typedFields, S1A_ORACLE_COMPANION_TYPED_FIELDS) &&
    s1aSame(policy.companion.currentInventory, S1A_ORACLE_COMPANION_CURRENT_INVENTORY_RULE) &&
    policy.companion.historicalEvidenceMode === 'APPEND_ONLY_CONTENT_ADDRESSED' &&
    policy.companion.historySource === S1A_ORACLE_COMPANION_HISTORY_SOURCE &&
    s1aSame(policy.companion.historyAnchor, S1A_ORACLE_COMPANION_HISTORY_ANCHOR),
    'companion identity, typed detail, current inventory, or parent-anchored history semantics are incomplete');

  s1aRequire(Array.isArray(policy.lifecycleTransitions), 'lifecycleTransitions must be an array');
  const transitionIds = new Set();
  for (const row of policy.lifecycleTransitions) {
    s1aExactKeys(row, row.event === 'TRANSFER'
      ? ['event', 'from', 'to', 'requires', 'requiredValueTypes', 'ownerReadback']
      : ['event', 'from', 'to', 'requires', 'requiredValueTypes'], 'lifecycle transition');
    if (row.event === 'TRANSFER') {
      s1aRequire(s1aSame(row.ownerReadback, S1A_ORACLE_OWNERSHIP_READBACK_RULE),
        'transfer ownership readback fields and bindings are incomplete');
    }
    s1aRequire(['DEFER', 'TRANSFER', 'EVIDENCE_ACQUIRED', 'VERIFIED_CLOSURE'].includes(row.event),
      'unknown lifecycle event');
    s1aRequire(!transitionIds.has(row.event), 'duplicate lifecycle event: ' + row.event);
    transitionIds.add(row.event);
    s1aRequire(S1A_ORACLE_LIFECYCLES.includes(row.from) &&
      S1A_ORACLE_LIFECYCLES.includes(row.to), 'unresolved lifecycle endpoint');
    s1aUniqueStrings(row.requires, 'lifecycle requirements', S1A_ORACLE_DETAIL_FIELDS);
  }
  s1aRequire(s1aSame(policy.lifecycleTransitions, S1A_ORACLE_LIFECYCLE_TRANSITIONS),
    'lifecycle transition requirements or outcomes changed from the fixed oracle');
  s1aRequire(s1aSame(policy.closureVerification, S1A_ORACLE_CLOSURE_VERIFICATION),
    'verified closure must use the complete current Web closure readback');

  const review = policy.postChildReview;
  s1aExactKeys(review, [
    'trigger', 'scope', 'readOnly', 'parentContractMode', 'parentContractBodyField',
    'parentContractDigestField', 'parentContractDigestMode', 'receiptInventoryField',
    'checkInventoryField', 'acceptedChildStates', 'reviewSlots', 'sameSnapshotFields',
    'blindUntil', 'trace', 'frontierEffect', 'receiptInventoryMode', 'checkInventoryMode',
    'childStateDigestMode', 'inventorySources', 'parentContractReadbackFields',
    'integratedIdentityField', 'integratedIdentityMode', 'integratedIdentityReadbackFields',
    'deliveryChildStateIdentityField', 'childStateCurrentField', 'childStateMustBeCurrent',
    'childStateReadbackMode', 'reviewerIdentityFields',
    'reviewRouteAuthorityMode', 'reviewRouteAuthorityField', 'reviewRouteAuthorityFields',
    'reviewRouteFields'
  ], 'postChildReview');
  s1aRequire(review.trigger === 'FINAL_DELIVERY_CHILD_MERGE' &&
    review.scope === 'WHOLE_PROGRAMME' && review.readOnly === true &&
    review.parentContractMode === 'CURRENT_CANONICAL_AUTHORITATIVE' &&
    review.parentContractBodyField === 'body' &&
    review.parentContractDigestField === 'bodyDigest' &&
    review.parentContractDigestMode === 'SHA256_EXACT_READBACK_BODY' &&
    review.frontierEffect === 'DEPENDENT_NEXT_CHILD' &&
    review.receiptInventoryMode === 'CANONICAL_AUTHORITATIVE_COMPLETE_TERMINAL_READBACK' &&
    review.checkInventoryMode === 'CANONICAL_AUTHORITATIVE_COMPLETE_TERMINAL_READBACK' &&
    review.childStateDigestMode === 'CANONICAL_STATE_SHA256' &&
    s1aSame(review.inventorySources, {
      receipts: 'CANONICAL_TERMINAL_OBJECT_RECEIPT_READBACK',
      checks: 'CANONICAL_APPLICABLE_INTEGRATED_CHECK_READBACK'
    }),
    'post-child review scope and authority semantics are fixed');
  s1aRequire(s1aSame(review.parentContractReadbackFields, [
      'source', 'authoritative', 'current', 'readBack', 'repository', 'revision', 'body', 'bodyDigest'
    ]) && review.integratedIdentityField === 'integratedIdentityReadback' &&
    review.integratedIdentityMode === 'CANONICAL_MERGED_DELIVERY_CHILD_READBACK' &&
    s1aSame(review.integratedIdentityReadbackFields, [
      'source', 'authoritative', 'current', 'readBack', 'repository', 'deliveryChildId',
      'commit', 'tree', 'mergeReceiptId', 'digest'
    ]) && review.deliveryChildStateIdentityField === 'childId' &&
    review.childStateCurrentField === 'current' && review.childStateMustBeCurrent === true &&
    review.childStateReadbackMode === 'CURRENT_AUTHORITATIVE_CANONICAL_READBACK' &&
    s1aSame(review.reviewerIdentityFields, ['reviewerId', 'contextId']) &&
    review.reviewRouteAuthorityMode === 'CURRENT_OWNER_WEB_AUTHORITY_READBACK' &&
    review.reviewRouteAuthorityField === 'reviewRouteAuthority' &&
    s1aSame(review.reviewRouteAuthorityFields, [
      'source', 'authoritative', 'current', 'readBack', 'authorityReference', 'revision', 'routes', 'digest'
    ]) && s1aSame(review.reviewRouteFields, ['provider', 'model', 'reasoning']),
    'post-child review requires canonical current readback identities and independently authorised review routes');
  s1aRequire(review.receiptInventoryField === 'terminalReceiptIds' &&
    review.checkInventoryField === 'applicableIntegratedCheckIds',
    'post-child receipt/check inventories must come from canonical child state');
  s1aUniqueStrings(review.acceptedChildStates, 'acceptedChildStates', ['CURRENT', 'COMPLETED', 'RETIRED']);
  s1aRequire(s1aSame(review.acceptedChildStates, ['CURRENT', 'COMPLETED']),
    'post-child review must bind the relevant current or completed child');
  s1aRequire(Array.isArray(review.reviewSlots), 'reviewSlots must be an array');
  const slotIds = new Set();
  for (const row of review.reviewSlots) {
    s1aExactKeys(row, ['slot', 'scope', 'readOnly', 'routeSlot'], 'review slot');
    s1aRequire(['A', 'B'].includes(row.slot) && !slotIds.has(row.slot), 'duplicate or unknown review slot');
    slotIds.add(row.slot);
    s1aRequire(row.scope === 'WHOLE_PROGRAMME' && row.readOnly === true && row.routeSlot === row.slot,
      'review slots must be independent read-only whole-programme reviews');
  }
  s1aRequire(s1aSame([...slotIds], ['A', 'B']),
    'post-child review requires both independent review slots');
  s1aUniqueStrings(review.sameSnapshotFields, 'sameSnapshotFields',
    S1A_ORACLE_REVIEW_SNAPSHOT_FIELDS);
  s1aRequire(s1aSame(review.sameSnapshotFields, S1A_ORACLE_REVIEW_SNAPSHOT_FIELDS),
    'post-child snapshot bindings are incomplete');
  s1aRequire(review.receiptInventoryField === 'terminalReceiptIds' &&
    review.checkInventoryField === 'applicableIntegratedCheckIds',
    'post-child receipt/check inventories must come from canonical child state');
  s1aRequire(review.sameSnapshotFields.includes('terminalReceiptIds') &&
    review.sameSnapshotFields.includes('applicableIntegratedCheckIds') &&
    !review.sameSnapshotFields.includes('terminalReceiptInventoryDigest') &&
    !review.sameSnapshotFields.includes('applicableIntegratedCheckInventoryDigest'),
    'post-child launch snapshot binds stable inventory membership, not terminal status digests');
  s1aRequire(review.blindUntil === 'BOTH_REPORTS_TERMINAL',
    'reviewers remain blind until both reports are terminal');
  s1aExactKeys(review.trace, [
    'requiredEvents', 'reviewStartsAfter', 'peerVisibilityEvents',
    'bothReviewsStartBeforeAnyReport', 'adjudicationAfter', 'terminalReadbackPrecedes'
  ], 'review trace');
  s1aUniqueStrings(review.trace.requiredEvents, 'review events', S1A_REVIEW_EVENTS);
  s1aRequire(s1aSame(review.trace.requiredEvents, S1A_REVIEW_EVENTS),
    'post-child trace must include every merge, input, report and adjudication event');
  s1aUniqueStrings(review.trace.reviewStartsAfter, 'reviewStartsAfter', S1A_REVIEW_EVENTS);
  s1aRequire(s1aSame(review.trace.reviewStartsAfter, [
    'FINAL_DELIVERY_CHILD_MERGED', 'INTEGRATED_IDENTITY_READ_BACK',
    'CURRENT_PARENT_CONTRACT_READ_BACK', 'CURRENT_CHILD_STATE_READ_BACK',
    'REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK', 'APPLICABLE_CHECK_MEMBERSHIP_READ_BACK'
  ]), 'post-child reviews require exact input membership before launch; CI may still be running');
  s1aUniqueStrings(review.trace.peerVisibilityEvents, 'peer visibility events', S1A_PEER_VISIBILITY_EVENTS);
  s1aRequire(s1aSame(review.trace.peerVisibilityEvents, S1A_PEER_VISIBILITY_EVENTS),
    'both peer-visibility attacks must remain observable');
  s1aRequire(review.trace.bothReviewsStartBeforeAnyReport === true,
    'both reviewers must start before either report returns');
  s1aUniqueStrings(review.trace.adjudicationAfter, 'adjudicationAfter', S1A_REVIEW_EVENTS);
  s1aRequire(s1aSame(review.trace.adjudicationAfter, [
    'REPORT_A_TERMINAL', 'REPORT_B_TERMINAL',
    'TERMINAL_RECEIPTS_READ_BACK', 'TERMINAL_RECEIPTS_TERMINAL',
    'APPLICABLE_CHECKS_READ_BACK', 'APPLICABLE_CHECKS_TERMINAL'
  ]), 'Web adjudication must follow both reports and all terminal readbacks');
  s1aRequire(s1aSame(review.trace.terminalReadbackPrecedes, [
    ['TERMINAL_RECEIPTS_READ_BACK', 'TERMINAL_RECEIPTS_TERMINAL'],
    ['APPLICABLE_CHECKS_READ_BACK', 'APPLICABLE_CHECKS_TERMINAL']
  ]), 'terminal receipt/check readback must precede terminal attestation');

  const carrier = policy.faithfulCarrier;
  s1aExactKeys(carrier, [
    'inventory', 'selectionOrder', 'defaultExposure', 'acceptedBoundaryId', 'faithfulnessRule',
    'boundaryExercise', 'publicExposureRequires', 'domainDnsRequiresSeparateAuthority',
    'persistenceImpliesExposure', 'publicExposureAuthority', 'domainDnsAuthority'
  ], 'faithfulCarrier');
  s1aRequire(s1aSame(carrier.inventory, S1A_ORACLE_CARRIER_INVENTORY_POLICY),
    'carrier inventory must be an authoritative complete readback');
  s1aUniqueStrings(carrier.selectionOrder, 'carrier selectionOrder',
    ['LOCAL_DEV', 'AUTHORIZED_EXISTING_OWNER', 'NEW_OWNER_PROVISIONED']);
  s1aRequire(s1aSame(carrier.selectionOrder,
    ['LOCAL_DEV', 'AUTHORIZED_EXISTING_OWNER', 'NEW_OWNER_PROVISIONED']),
    'carrier selection order is incomplete');
  s1aRequire(carrier.defaultExposure === 'PRIVATE_NONPUBLIC',
    'carrier default exposure must remain private and nonpublic');
  s1aRequire(carrier.acceptedBoundaryId === 'ACCEPTED_PRODUCTION_BOUNDARY',
    'accepted carrier boundary identity changed');
  s1aRequire(carrier.faithfulnessRule === 'EXERCISED_ACCEPTED_BOUNDARY',
    'carrier faithfulness must require observed accepted-boundary exercise');
  s1aExactKeys(carrier.boundaryExercise, [
    'mode', 'evidenceInputField', 'carrierIdentityField', 'acceptedCarrierIds',
    'readbackFields', 'requiredFields', 'acceptedExecutionPath', 'acceptedOutcome',
    'requiredRunEvents'
  ], 'carrier boundaryExercise');
  s1aRequire(carrier.boundaryExercise.mode === 'INDEPENDENTLY_BOUND_TERMINAL_EXECUTION_EVIDENCE' &&
    carrier.boundaryExercise.evidenceInputField === 'acceptedBoundaryEvidence' &&
    carrier.boundaryExercise.carrierIdentityField === 'identity' &&
    s1aSame(carrier.boundaryExercise.acceptedCarrierIds, carrier.selectionOrder) &&
    s1aSame(carrier.boundaryExercise.readbackFields, [
      'source', 'authoritative', 'current', 'complete', 'readBack', 'repository',
      'acceptedCriterion', 'carrierId', 'carrierIdentity', 'actualPath', 'candidateIdentity',
      'enforcementBoundary', 'run', 'receipt', 'digest'
    ]) &&
    carrier.boundaryExercise.acceptedExecutionPath === 'ACCEPTED_PRODUCTION_PATH' &&
    carrier.boundaryExercise.acceptedOutcome === 'BOUNDARY_EXERCISED' &&
    s1aSame(carrier.boundaryExercise.requiredRunEvents, S1A_ORACLE_BOUNDARY_RUN_EVENTS),
    'carrier exercise must be independently bound terminal execution evidence');
  s1aUniqueStrings(carrier.boundaryExercise.requiredFields, 'boundary receipt fields', [
    'receiptId', 'acceptedCriterion', 'carrierId', 'carrierIdentity', 'candidateIdentity', 'boundaryId',
    'enforcementBoundary',
    'actualPath', 'executionPath', 'outcome', 'terminal', 'evidenceRef', 'runId', 'runEvents',
    'executionEvidenceDigest', 'receiptDigest'
  ]);
  s1aRequire(s1aSame(carrier.boundaryExercise.requiredFields, [
    'receiptId', 'acceptedCriterion', 'carrierId', 'carrierIdentity', 'candidateIdentity', 'boundaryId',
    'enforcementBoundary',
    'actualPath', 'executionPath', 'outcome', 'terminal', 'evidenceRef', 'runId', 'runEvents',
    'executionEvidenceDigest', 'receiptDigest'
  ]), 'carrier boundary receipt is incomplete');
  s1aRequire(s1aSame(carrier.boundaryExercise.requiredRunEvents, S1A_ORACLE_BOUNDARY_RUN_EVENTS),
    'carrier run event set is incomplete');
  s1aUniqueStrings(carrier.publicExposureRequires, 'publicExposureRequires', [
    'ACCEPTED_CRITERION', 'EXPLICIT_EXPOSURE_AUTHORITY', 'CONSUMER', 'PROTOCOL',
    'PATH', 'HOSTNAME', 'NECESSITY', 'AUDIENCE', 'BOUNDARY', 'LIFETIME', 'CLEANUP'
  ]);
  s1aRequire(s1aSame(carrier.publicExposureRequires, [
    'ACCEPTED_CRITERION', 'EXPLICIT_EXPOSURE_AUTHORITY', 'CONSUMER', 'PROTOCOL',
    'PATH', 'HOSTNAME', 'NECESSITY', 'AUDIENCE', 'BOUNDARY', 'LIFETIME', 'CLEANUP'
  ]), 'public exposure authority requirements are incomplete');
  s1aRequire(carrier.domainDnsRequiresSeparateAuthority === true &&
    carrier.persistenceImpliesExposure === false,
    'domain/DNS authority and private-persistence semantics are incomplete');
  s1aExactKeys(carrier.publicExposureAuthority, [
    'mode', 'inputField', 'requestField', 'requestMatchFields', 'source', 'requiredFields', 'digestMode', 'exposureValue'
  ], 'publicExposureAuthority');
  s1aRequire(carrier.publicExposureAuthority.mode === 'CURRENT_OWNER_WEB_AUTHORITY_READBACK' &&
    carrier.publicExposureAuthority.inputField === 'exposureAuthority' &&
    carrier.publicExposureAuthority.requestField === 'publicExposureRequest' &&
    s1aSame(carrier.publicExposureAuthority.requestMatchFields, ['consumer', 'protocol', 'path', 'hostnameRequired', 'hostname', 'lifetime', 'cleanup', 'necessity']) &&
    carrier.publicExposureAuthority.source === 'CURRENT_OWNER_WEB_AUTHORITY' &&
    s1aSame(carrier.publicExposureAuthority.requiredFields, [
      'source', 'authoritative', 'current', 'readBack', 'authorityReference',
      'criterion', 'exposure', 'consumer', 'protocol', 'path', 'hostnameRequired', 'hostname',
      'audience', 'boundary', 'lifetime', 'cleanup', 'necessity', 'requiredOperations', 'digest'
    ]) && carrier.publicExposureAuthority.digestMode === 'SHA256_CANONICAL_AUTHORITY_READBACK' &&
    carrier.publicExposureAuthority.exposureValue === 'PUBLIC',
    'public exposure must bind current exact Owner/Web authority');
  s1aExactKeys(carrier.domainDnsAuthority, [
    'requiredOperationsField', 'domainInputField', 'dnsInputField', 'requiredFields', 'domainOperation',
    'dnsOperation', 'referencesMustDiffer', 'eachReferenceMustDifferFromExposure'
  ], 'domainDnsAuthority');
  s1aRequire(carrier.domainDnsAuthority.requiredOperationsField === 'requiredOperations' &&
    carrier.domainDnsAuthority.domainInputField === 'domainAuthority' &&
    carrier.domainDnsAuthority.dnsInputField === 'dnsAuthority' &&
    s1aSame(carrier.domainDnsAuthority.requiredFields, [
      'source', 'authoritative', 'current', 'readBack', 'authorityReference',
      'exposureReference', 'operation', 'target', 'digest'
    ]) && carrier.domainDnsAuthority.domainOperation === 'DOMAIN_REGISTRATION' &&
    carrier.domainDnsAuthority.dnsOperation === 'DNS_CONFIGURATION' &&
    carrier.domainDnsAuthority.referencesMustDiffer === true &&
    carrier.domainDnsAuthority.eachReferenceMustDifferFromExposure === true,
    'domain and DNS operations require separate current authority readbacks');
  const dispositionRows = s1aTable(source, '### Canonical disposition vocabulary');
  const dispositionTable = Object.fromEntries(dispositionRows.map((row) => [row.Disposition, row['Meaning and timing']]));
  s1aRequire(dispositionRows.length === S1A_ORACLE_DISPOSITIONS.length &&
    dispositionRows.map((row) => row.Disposition).join('|') === S1A_ORACLE_DISPOSITIONS.join('|') &&
    dispositionTable.EVIDENCE_ONLY === S1A_ORACLE_EVIDENCE_ONLY_MEANING,
    'canonical disposition prose diverged from the fixed behavioral oracle');
  const projectionRows = s1aTable(source, '### Lossless legacy projections').map((row) => ({
    disposition: row['Canonical disposition'], lifecycle: row.Lifecycle,
    twoWay: row['Two-way projection'], v1: row['v1 projection']
  }));
  s1aRequire(s1aSame(projectionRows, S1A_ORACLE_PROJECTION_ROWS),
    'legacy projection prose diverged from the fixed behavioral oracle');
  const companionStart = source.indexOf('Every coarse row carries a content-addressed DETAIL_REF');
  const companionEnd = source.indexOf('### Current blocker field contract');
  const companionProse = companionStart >= 0 && companionEnd > companionStart
    ? source.slice(companionStart, companionEnd) : '';
  s1aRequire(companionProse.includes('Every current companion row and its complete inventory must be read back from the current authoritative Web admission source') &&
    companionProse.includes('inventory digest binding every exact record and reference') &&
    companionProse.includes('checks every declared field type') &&
    !/caller[- ](?:supplied|recomputed) hashes alone (?:admit|authorize) (?:an? )?(?:altered|changed) record/i.test(companionProse),
    'current companion prose must bind typed details to a complete authoritative inventory');
  const blockerStart = source.indexOf('### Current blocker field contract');
  const blockerEnd = source.indexOf('### Current-frontier effect and examples', blockerStart);
  const blockerProse = blockerStart >= 0 && blockerEnd > blockerStart
    ? source.slice(blockerStart, blockerEnd) : '';
  const blockerFailClosedClauses = [
    'If any field is missing or contradictory, do not admit this disposition; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.',
    'If any field is missing or contradictory, this disposition must fail closed; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.'
  ];
  const blockerWaiverContradiction = /(?:missing|contradictory).{0,100}(?:field|blocker).{0,100}(?:may|can|should|is allowed to|may still)\s+(?:be\s+)?(?:waived|ignored|disregarded|bypassed|excused|overlooked)|(?:field|blocker).{0,100}(?:may|can|should|is allowed to|may still)\s+(?:be\s+)?(?:waived|ignored|disregarded|bypassed|excused|overlooked).{0,100}(?:missing|contradictory)/i;
  s1aRequire(blockerFailClosedClauses.some((clause) => blockerProse.includes(clause)) &&
    !/admit(?:ted)?\s+(?:this disposition|a blocker)\s+even (?:when|if)\s+(?:a |any )?(?:required )?field is missing/i.test(blockerProse) &&
    !blockerWaiverContradiction.test(policyLawProse),
    'blocker prose must fail closed on missing or contradictory proof');
  s1aRequire(blockerProse.includes('Resolution changes only lifecycle to RESOLVED after an authoritative, current Web closure readback verifies the exact finding, admitted disposition, closure criterion, evidence references, candidate identity and transition; a caller-supplied criterion or evidence label alone cannot resolve work.') &&
    !/caller[- ]supplied (?:criterion|evidence label) alone can resolve/i.test(blockerProse),
    'closure prose must require current authoritative verification');
  const postChildStart = source.indexOf('### Post-child integrated dual review');
  const postChildEnd = source.indexOf('### Bounded non-product continuation', postChildStart);
  const postChildProse = postChildStart >= 0 && postChildEnd > postChildStart
    ? source.slice(postChildStart, postChildEnd) : '';
  s1aRequire(postChildProse.includes('The CURRENT canonical parent programme contract is an authoritative input to both reviews.') &&
    postChildProse.includes('Read back the exact merged identity and the relevant current or terminal child state from their canonical sources; both readbacks must be authoritative, current and explicit.') &&
    postChildProse.includes('Both reviews receive the same accepted inputs and the same immutable snapshot.') &&
    postChildProse.includes('Both are independent, read-only whole-programme reviews.') &&
    postChildProse.includes('Both reports, terminal receipts and all applicable checks must be terminal before Web adjudication.') &&
    postChildProse.includes('Do not copy programme-wide parent law into every child.') &&
    !/(?:completed|terminal|current) child state.{0,120}(?:may be accepted|is accepted|suffices).{0,120}(?:child[- ]local summary|summary).{0,120}without.{0,80}(?:current )?canonical readback/i.test(policyLawProse) &&
    !/parent programme contract (?:is|may be) optional|adjudicat(?:e|ion) before both reports|reviewers? may see the other report before both reports are terminal/i.test(postChildProse),
    'post-child prose must bind current inputs, independent blind reviews and terminal adjudication order');
  const carrierStart = source.indexOf('### Faithful validation carrier');
  const carrierEnd = source.indexOf('### G1 re-convergence', carrierStart);
  const carrierProse = carrierStart >= 0 && carrierEnd > carrierStart
    ? source.slice(carrierStart, carrierEnd) : '';
  const carrierProseFailures = s1aCarrierProseViolations(source);
  s1aRequire(carrierProseFailures.length === 0,
    'carrier prose must preserve inventory, execution, exposure, DNS/domain and privacy semantics: ' + carrierProseFailures.join(','));
  const continuationProseFailures = s1aContinuationProseViolations(source);
  s1aRequire(continuationProseFailures.length === 0,
    'bounded continuation prose must preserve fixed behavioral obligations: ' + continuationProseFailures.join(','));
  const governedHumanPolicyDigest = s1aGovernedHumanPolicyDigest(source);
  s1aRequire(governedHumanPolicyDigest === S1A_ORACLE_GOVERNED_PROSE_SHA256,
    'S1-A governed human policy prose differs from fixed semantic oracle');
  return { policy, block: matches[0][0] };
}

function parseS1aPolicyContract(source) {
  return s1aReadPolicy(source).policy;
}
function s1aInterpretPolicyContract(source) {
  const matches = [...source.matchAll(/~~~s1a-policy-contract-v1\r?\n([\s\S]*?)\r?\n~~~/g)];
  s1aRequire(matches.length === 1, 'Architecture must contain exactly one S1-A policy contract');
  return s1aParseJsonRejectDuplicates(matches[0][1]);
}
function rewriteS1aPolicy(source, mutate) {
  const parsed = s1aReadPolicy(source);
  const policy = JSON.parse(JSON.stringify(parsed.policy));
  mutate(policy);
  const replacement = '~~~s1a-policy-contract-v1\n' + JSON.stringify(policy, null, 2) + '\n~~~';
  return source.replace(parsed.block, replacement);
}

function removeS1aProseField(source, field) {
  const lines = source.split(/\r?\n/);
  const prefix = '| ' + field + ' |';
  const matches = lines.filter((line) => line.startsWith(prefix));
  s1aRequire(matches.length === 1, 'expected one human blocker row for ' + field);
  return lines.filter((line) => !line.startsWith(prefix)).join('\n');
}

function s1aPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function s1aPath(value, path) {
  let current = value;
  for (const component of path.split('.')) {
    if (current === null || typeof current !== 'object' ||
        !Object.prototype.hasOwnProperty.call(current, component)) return undefined;
    current = current[component];
  }
  return current;
}

function s1aHasExactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    s1aSame([...Object.keys(value)].sort(), [...expected].sort());
}

function s1aTypeMatches(value, type, allowedEffects = S1A_ORACLE_EFFECTS) {
  if (type === 'NONEMPTY_STRING') return typeof value === 'string' && value.trim().length > 0;
  if (type === 'NONEMPTY_EVIDENCE_REFERENCES') return Array.isArray(value) && value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0) &&
    new Set(value).size === value.length;
  if (type === 'ALLOWED_EFFECT') return allowedEffects.includes(value);
  if (type === 'EXACT_TRUE') return value === true;
  if (type === 'NONEMPTY_OBJECT') return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).length > 0;
  if (type === 'SHA256_REFERENCE') return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  return false;
}

function s1aCanonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(s1aCanonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ':' + s1aCanonical(value[key])).join(',') + '}';
}

function s1aSame(left, right) {
  return s1aCanonical(left) === s1aCanonical(right);
}

function s1aObjectReferences(value) {
  const references = new Set();
  const visit = (entry) => {
    if (!entry || typeof entry !== 'object' || references.has(entry)) return;
    references.add(entry);
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return references;
}

function s1aOwnershipReadbackMatches(record) {
  const readback = record && record.OWNER_READBACK;
  const rule = S1A_ORACLE_OWNERSHIP_READBACK_RULE;
  if (!s1aHasExactKeys(readback, rule.requiredFields) ||
      readback.source !== rule.source || readback.authoritative !== true ||
      readback.current !== true || readback.readBack !== true ||
      record.RESOLUTION !== rule.resolutionMustRemain ||
      readback.resolution !== rule.resolutionMustRemain) return false;
  for (const [field, type] of Object.entries(S1A_ORACLE_COMMON_FIELD_TYPES)) {
    if (!s1aTypeMatches(record && record[field], type)) return false;
  }
  for (const [field, type] of Object.entries({
    FINDING_ID: 'NONEMPTY_STRING', WEB_ADMITTED_REVISION: 'NONEMPTY_STRING',
    CANDIDATE_IDENTITY: 'NONEMPTY_OBJECT', VERIFIED_OWNER: 'NONEMPTY_STRING'
  })) {
    if (!s1aTypeMatches(record && record[field], type)) return false;
  }
  for (const binding of rule.recordBindings) {
    if (!s1aPresent(record[binding.record]) || !s1aPresent(readback[binding.readback]) ||
        !s1aSame(readback[binding.readback], record[binding.record])) return false;
  }
  if (!s1aPresent(readback.revision)) return false;
  const core = Object.fromEntries(rule.requiredFields.filter((field) => field !== 'digest')
    .map((field) => [field, readback[field]]));
  return readback.digest === s1aHashRecord(core);
}

function s1aOwnershipTransferReadbackMatches(record, trustedOwnershipReadback) {
  const readback = record && record.OWNER_READBACK;
  const rule = S1A_ORACLE_OWNERSHIP_READBACK_RULE;
  const recordReferences = s1aObjectReferences(record);
  const independentReferences = s1aObjectReferences(trustedOwnershipReadback);
  const aliasesRequestedRecord = [...independentReferences].some((reference) => recordReferences.has(reference));
  return Boolean(trustedOwnershipReadback && !aliasesRequestedRecord &&
    s1aHasExactKeys(trustedOwnershipReadback, rule.requiredFields) &&
    trustedOwnershipReadback.source === rule.source && trustedOwnershipReadback.authoritative === true &&
    trustedOwnershipReadback.current === true && trustedOwnershipReadback.readBack === true &&
    trustedOwnershipReadback.resolution === rule.resolutionMustRemain &&
    s1aSame(trustedOwnershipReadback, S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK) &&
    s1aSame(readback, trustedOwnershipReadback) && s1aOwnershipReadbackMatches(record));
}

function evaluateS1aBlocker(policy, record, decision, companionProjection, companionEntries, currentInventory) {
  const failures = [];
  const blocker = policy.blocker;
  if (!s1aHasExactKeys(record, blocker.recordFields)) failures.push('BLOCKER_RECORD_SHAPE');
  for (const [path, type] of Object.entries(blocker.typedPaths)) {
    if (!s1aTypeMatches(s1aPath(record, path), type, blocker.allowedEffects)) {
      failures.push('BLOCKER_TYPE_MISMATCH:' + path);
    }
  }
  if (!s1aOwnershipReadbackMatches(record)) failures.push('BLOCKER_OWNER_READBACK');
  for (const requirement of blocker.nestedRequiredFields) {
    const nested = record && record[requirement.record];
    if (!s1aHasExactKeys(nested, requirement.fields)) {
      failures.push('BLOCKER_NESTED_SHAPE:' + requirement.record);
    }
  }
  if (record.DISPOSITION !== blocker.admittedDisposition) failures.push('BLOCKER_DISPOSITION');
  if (record.LIFECYCLE !== blocker.admittedLifecycle) failures.push('BLOCKER_LIFECYCLE');
  for (const binding of blocker.bindings) {
    const actual = s1aPath(record, binding.record);
    const expected = s1aPath(decision, binding.decision);
    if (!s1aPresent(actual) || !s1aPresent(expected) || !s1aSame(actual, expected)) {
      failures.push('BLOCKER_BINDING_MISMATCH:' + binding.record);
    }
  }
  for (const binding of blocker.membershipBindings) {
    const values = s1aPath(record, binding.record);
    const allowed = s1aPath(decision, binding.decision);
    const candidates = Array.isArray(values) ? values : [values];
    if (!Array.isArray(allowed) || candidates.length === 0 ||
        candidates.some((candidate) => !allowed.some((entry) => s1aSame(candidate, entry)))) {
      failures.push('BLOCKER_MEMBERSHIP_MISMATCH:' + binding.record);
    }
  }
  for (const check of blocker.truthChecks) {
    if (s1aPath(record, check.record + '.' + check.path) !== check.value) {
      failures.push('BLOCKER_TRUTH_MISMATCH:' + check.record);
    }
  }
  for (const path of blocker.evidenceReferencePaths) {
    const refs = s1aPath(record, path);
    if (!Array.isArray(refs) || refs.length === 0 || new Set(refs).size !== refs.length ||
        !Array.isArray(decision.evidenceRefs) ||
        refs.some((ref) => !decision.evidenceRefs.includes(ref))) {
      failures.push('BLOCKER_EVIDENCE_REFERENCE_MISMATCH:' + path);
    }
  }
  const effect = s1aPath(record, blocker.effectBinding.record);
  const consequence = s1aPath(record, blocker.effectBinding.consequence);
  if (!s1aPresent(effect) || !s1aPresent(consequence) || effect !== consequence) {
    failures.push('BLOCKER_EFFECT_CONTRADICTION');
  }
  if (!s1aHasExactKeys(decision, [...Object.keys(S1A_ORACLE_WEB_ADMISSION_DECISION_CORE), 'admissionReadback']) ||
      !s1aSame(Object.fromEntries(Object.entries(decision || {}).filter(([key]) => key !== 'admissionReadback')),
        S1A_ORACLE_WEB_ADMISSION_DECISION_CORE) ||
      !s1aHasExactKeys(decision && decision.admissionReadback, blocker.admissionReadback.requiredFields) ||
      !s1aSame(decision && decision.admissionReadback, S1A_ORACLE_WEB_ADMISSION_READBACK) ||
      decision.admissionReadback.source !== blocker.admissionReadback.source ||
      decision.admissionReadback.authoritative !== true || decision.admissionReadback.current !== true ||
      decision.admissionReadback.readBack !== true ||
      decision.admissionReadback.body !== s1aWebAdmissionBody(decision) ||
      decision.admissionReadback.bodyDigest !== s1aHashText(decision.admissionReadback.body)) {
    failures.push('BLOCKER_CURRENT_WEB_ADMISSION_READBACK');
  }
  if (!companionProjection ||
      !s1aSame(record[policy.companion.referenceField],
        companionProjection[policy.companion.referenceField])) {
    failures.push('BLOCKER_COMPANION_PROJECTION_BINDING');
  } else {
    for (const field of policy.companion.projectionBindingFields) {
      if (!s1aSame(record[field], companionProjection[field])) {
        failures.push('BLOCKER_COMPANION_PROJECTION_BINDING:' + field);
      }
    }
  }
  const companionResult = evaluateS1aCompanions(policy,
    companionProjection ? [companionProjection] : [], companionEntries,
    makeS1aCompanionHistoryLedger(), currentInventory);
  if (!companionResult.ok) {
    failures.push(...companionResult.failures.map((failure) => 'BLOCKER_' + failure));
  }
  const detailRef = record[policy.companion.referenceField];
  const detailEntries = Array.isArray(companionEntries)
    ? companionEntries.filter((entry) => entry[policy.companion.recordReferenceField] === detailRef)
    : [];
  if (detailEntries.length !== 1 || !s1aPresent(detailEntries[0].record)) {
    failures.push('BLOCKER_COMPANION_RECORD');
  } else {
    const detail = detailEntries[0].record;
    const completeProofRecordFields = blocker.recordFields.filter((field) =>
      field !== policy.companion.referenceField);
    if (!s1aHasExactKeys(detail, completeProofRecordFields)) {
      failures.push('BLOCKER_COMPANION_RECORD_SHAPE');
    }
    if (detailRef !== s1aHashRecord(detail)) failures.push('BLOCKER_COMPANION_CONTENT_ADDRESS');
    if (!s1aSame(decision && decision.detailRef, detailRef)) failures.push('BLOCKER_DETAIL_REVISION_BINDING');
    for (const field of policy.blocker.proofBinding.fields) {
      if (!s1aSame(record[field], detail[field])) {
        failures.push('BLOCKER_PROOF_CONTENT_BINDING:' + field);
      }
    }
  }
  return { admitted: failures.length === 0, failures };
}
function makeS1aBlockerFixture() {
  const proofRecord = s1aClone(S1A_ORACLE_BLOCKER_PROOF_RECORD);
  const detailRef = S1A_ORACLE_BLOCKER_DETAIL_REF;
  const companionProjection = makeS1aCompanionProjection(proofRecord, detailRef, {
    TWO_WAY: 'SHIP_BLOCKER', V1: 'BLOCKING'
  });
  return {
    record: { ...proofRecord, DETAIL_REF: detailRef },
    decision: s1aClone(S1A_ORACLE_WEB_ADMISSION_DECISION),
    companionProjection,
    companionEntries: [{ ref: detailRef, record: proofRecord }],
    currentInventory: s1aClone(S1A_ORACLE_BLOCKER_COMPANION_INVENTORY)
  };
}

function refreshS1aBlockerFixture(fixture, rebindDecision = true) {
  const proofRecord = { ...fixture.record };
  delete proofRecord.DETAIL_REF;
  const detailRef = s1aHashRecord(proofRecord);
  fixture.record.DETAIL_REF = detailRef;
  fixture.companionProjection.DETAIL_REF = detailRef;
  fixture.companionEntries = [{ ref: detailRef, record: proofRecord }];
  fixture.currentInventory = makeS1aCurrentCompanionInventory(
    [proofRecord], 'web:inventory-revision-blocker-7');
  if (rebindDecision) {
    fixture.decision.detailRef = detailRef;
    s1aRefreshWebAdmissionReadback(fixture.decision);
  }
  return fixture;
}

const S1A_BLOCKER_ORACLE_CASES = [
  {
    id: 'blocker-complete-current-record', expected: true, obligation: 'BLOCKER_COMPLETE_RECORD',
    build: () => makeS1aBlockerFixture()
  },

  ...S1A_ORACLE_BLOCKER_NESTED_FIELDS.flatMap((requirement) => requirement.fields.map((field) => ({
    id: 'blocker-missing-nested-' + requirement.record + '.' + field, expected: false,
    obligation: 'BLOCKER_NESTED_FIELD_MISSING:' + requirement.record + '.' + field,
    build: () => {
      const fixture = makeS1aBlockerFixture();
      delete fixture.record[requirement.record][field];
      if (requirement.record === 'ADMITTED_CURRENT_OUTCOME') {
        delete fixture.decision.currentOutcome[field];
      }
      return fixture;
    }
  }))),
  ...S1A_ORACLE_BLOCKER_FIELDS.map((field) => ({
    id: 'blocker-missing-' + field, expected: false,
    obligation: 'BLOCKER_REQUIRED_FIELD:' + field,
    build: () => {
      const fixture = makeS1aBlockerFixture();
      delete fixture.record[field];
      return fixture;
    }
  })),
  ...S1A_ORACLE_IDENTITY_FIELDS.map((field) => ({
    id: 'blocker-missing-identity-' + field, expected: false,
    obligation: 'BLOCKER_COMMON_FIELD:' + field,
    build: () => {
      const fixture = makeS1aBlockerFixture();
      delete fixture.record[field];
      return fixture;
    }
  })),
  {
    id: 'blocker-conflicting-revision', expected: false, obligation: 'BLOCKER_REVISION_IDENTITY',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.WEB_ADMITTED_REVISION = 'web:459:stale';
      return fixture;
    }
  },
  {
    id: 'blocker-conflicting-candidate-tree', expected: false, obligation: 'BLOCKER_CANDIDATE_IDENTITY',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.CANDIDATE_IDENTITY.tree = 'tree:stale';
      return fixture;
    }
  },
  {
    id: 'blocker-conflicting-current-outcome', expected: false, obligation: 'BLOCKER_CURRENT_OUTCOME',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.ADMITTED_CURRENT_OUTCOME.audience = 'different-audience';
      return fixture;
    }
  },
  {
    id: 'blocker-incomplete-current-outcome', expected: false,
    obligation: 'BLOCKER_NESTED_FIELD_MISSING:ADMITTED_CURRENT_OUTCOME.environment',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      delete fixture.record.ADMITTED_CURRENT_OUTCOME.environment;
      delete fixture.decision.currentOutcome.environment;
      return fixture;
    }
  },
  {
    id: 'blocker-proof-field-changed-without-rebind', expected: false,
    obligation: 'BLOCKER_PROOF_CONTENT_BINDING:SMALLEST_CORRECTION',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.SMALLEST_CORRECTION = 'correction:substituted';
      return fixture;
    }
  },
  {
    id: 'blocker-rehashed-proof-not-web-admitted', expected: false,
    obligation: 'BLOCKER_DETAIL_REVISION_BINDING',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.SMALLEST_CORRECTION = 'correction:substituted';
      return refreshS1aBlockerFixture(fixture, false);
    }
  },
  {
    id: 'blocker-discarded-companion', expected: false,
    obligation: 'BLOCKER_COMPANION_RECORD',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.companionEntries = [];
      return fixture;
    }
  },
  {
    id: 'blocker-unaccepted-criterion', expected: false, obligation: 'BLOCKER_CRITERION_MEMBERSHIP',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.LOCKED_CRITERION_OR_FLOOR = 'criterion:unaccepted';
      return fixture;
    }
  },
  {
    id: 'blocker-conflicting-effect', expected: false, obligation: 'BLOCKER_EFFECT_CONSISTENCY',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.REQUIRED_OUTCOME_EFFECT = 'MATERIALLY_UNSAFE';
      return fixture;
    }
  },
  {
    id: 'blocker-deferral-is-possible', expected: false, obligation: 'BLOCKER_SAFE_DEFERRAL_IMPOSSIBLE',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.SAFE_DEFERRAL_IMPOSSIBLE.satisfied = false;
      return fixture;
    }
  },
  {
    id: 'blocker-unregistered-evidence', expected: false, obligation: 'BLOCKER_EXACT_EVIDENCE',
    build: () => {
      const fixture = makeS1aBlockerFixture();
      fixture.record.EXACT_EVIDENCE = ['evidence:impact', 'evidence:unknown'];
      return fixture;
    }
  }
];

function observeS1aBlockerOracle(policy) {
  return S1A_BLOCKER_ORACLE_CASES.map((scenario) => {
    const fixture = scenario.build();
    const result = evaluateS1aBlocker(policy, fixture.record, fixture.decision,
      fixture.companionProjection, fixture.companionEntries, fixture.currentInventory);
    return {
      id: scenario.id,
      expected: scenario.expected,
      observed: result.admitted,
      obligation: result.admitted === scenario.expected ? null : scenario.obligation,
      evaluatorFailures: result.failures
    };
  });
}

function assertS1aOracleMismatch(source, scenarioId, obligation) {
  const result = observeS1aBlockerOracle(parseS1aPolicyContract(source))
    .find((item) => item.id === scenarioId);
  s1aRequire(result, 'missing fixed oracle scenario ' + scenarioId);
  s1aRequire(result.expected !== result.observed, 'mutation was not detected for ' + scenarioId);
  s1aRequire(result.obligation === obligation, 'wrong failure obligation for ' + scenarioId);
}

function s1aClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function s1aHashRecord(record) {
  return 'sha256:' + crypto.createHash('sha256').update(s1aCanonical(record), 'utf8').digest('hex');
}

function s1aHashText(value) {
  return 'sha256:' + crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

const S1A_ORACLE_BLOCKER_PROOF_RECORD = Object.freeze({
  FINDING_ID: 'finding:alpha',
  WEB_ADMITTED_REVISION: 'web:459:revision-7',
  DISPOSITION: 'CURRENT_SHIP_BLOCKER',
  LIFECYCLE: 'UNRESOLVED',
  TIMING: 'current-shipment',
  VERIFIED_OWNER: 'owner:current-outcome',
  TRIGGER_OR_REASON: 'current candidate violates an accepted criterion',
  CLOSURE_CRITERION: 'closure:alpha',
  EXACT_EVIDENCE: Object.freeze(['evidence:impact', 'evidence:deferral', 'evidence:closure']),
  CANDIDATE_IDENTITY: Object.freeze({ commit: 'commit:7', tree: 'tree:7' }),
  ADMITTED_CURRENT_OUTCOME: Object.freeze({
    id: 'outcome:alpha', milestone: 'alpha', audience: 'internal', environment: 'staging'
  }),
  LOCKED_CRITERION_OR_FLOOR: 'criterion:alpha',
  SHIP_NOW_CONSEQUENCE: Object.freeze({
    description: 'Current shipment violates the accepted criterion',
    effect: 'FALSE', evidenceRefs: Object.freeze(['evidence:impact'])
  }),
  REQUIRED_OUTCOME_EFFECT: 'FALSE',
  SAFE_DEFERRAL_IMPOSSIBLE: Object.freeze({
    satisfied: true, evidenceRefs: Object.freeze(['evidence:deferral'])
  }),
  SMALLEST_CORRECTION: 'correction:smallest',
  VERIFIABLE_CLOSURE: Object.freeze({
    oracleId: 'closure:alpha', positiveControlId: 'control:alpha',
    evidenceRefs: Object.freeze(['evidence:closure'])
  }),
  ...makeS1aCommonFindingFields({
    FINDING_ID: 'finding:alpha', WEB_ADMITTED_REVISION: 'web:459:revision-7',
    FINDING_REVISION: 'finding-revision:alpha-7', ACCEPTED_DECISION_ID: 'decision:web:alpha-7',
    CANDIDATE_IDENTITY: { commit: 'commit:7', tree: 'tree:7' },
    VERIFIED_OWNER: 'owner:current-outcome', PRIMARY_OWNER: 'PRODUCT',
    ADJUDICATION: 'CURRENT_SHIP_BLOCKER', OWNER_ROLE: 'PRODUCT_OWNER',
    OBSERVED_BEHAVIOR: 'Current candidate violates criterion:alpha.',
    REQUIRED_BEHAVIOR: 'Current candidate satisfies criterion:alpha.'
  })
});
const S1A_ORACLE_BLOCKER_DETAIL_REF = s1aHashRecord(S1A_ORACLE_BLOCKER_PROOF_RECORD);
const S1A_ORACLE_WEB_ADMISSION_DECISION_CORE = Object.freeze({
  repository: S1A_ORACLE_BLOCKER_PROOF_RECORD.REPOSITORY,
  packetIdentity: S1A_ORACLE_BLOCKER_PROOF_RECORD.PACKET_IDENTITY,
  findingId: 'finding:alpha',
  findingRevision: S1A_ORACLE_BLOCKER_PROOF_RECORD.FINDING_REVISION,
  acceptedDecisionId: S1A_ORACLE_BLOCKER_PROOF_RECORD.ACCEPTED_DECISION_ID,
  adjudication: S1A_ORACLE_BLOCKER_PROOF_RECORD.ADJUDICATION,
  webRevision: 'web:459:revision-7',
  currentOutcome: S1A_ORACLE_BLOCKER_PROOF_RECORD.ADMITTED_CURRENT_OUTCOME,
  closureCriterion: 'closure:alpha',
  candidateIdentity: S1A_ORACLE_BLOCKER_PROOF_RECORD.CANDIDATE_IDENTITY,
  detailRef: S1A_ORACLE_BLOCKER_DETAIL_REF,
  acceptedCriteria: Object.freeze(['criterion:alpha']),
  evidenceRefs: S1A_ORACLE_BLOCKER_PROOF_RECORD.EXACT_EVIDENCE,
  requiredOutcomeEffect: 'FALSE'
});
function s1aWebAdmissionBody(decision) {
  return s1aCanonical({
    schema: 'toolkit.s1a.web-admission.v1',
    repository: decision.repository,
    packetIdentity: decision.packetIdentity,
    findingId: decision.findingId,
    findingRevision: decision.findingRevision,
    acceptedDecisionId: decision.acceptedDecisionId,
    adjudication: decision.adjudication,
    webRevision: decision.webRevision,
    currentOutcome: decision.currentOutcome,
    closureCriterion: decision.closureCriterion,
    candidateIdentity: decision.candidateIdentity,
    detailRef: decision.detailRef,
    acceptedCriteria: decision.acceptedCriteria,
    evidenceRefs: decision.evidenceRefs,
    requiredOutcomeEffect: decision.requiredOutcomeEffect
  });
}
function s1aRefreshWebAdmissionReadback(decision) {
  const readback = decision.admissionReadback;
  readback.revision = decision.webRevision;
  readback.body = s1aWebAdmissionBody(decision);
  readback.bodyDigest = s1aHashText(readback.body);
}
const S1A_ORACLE_WEB_ADMISSION_READBACK = Object.freeze({
  source: 'CANONICAL_WEB_ADMISSION',
  authoritative: true,
  current: true,
  readBack: true,
  repository: 'weijunswj/ai-agent-toolkit',
  revision: S1A_ORACLE_WEB_ADMISSION_DECISION_CORE.webRevision,
  body: s1aWebAdmissionBody(S1A_ORACLE_WEB_ADMISSION_DECISION_CORE),
  bodyDigest: s1aHashText(s1aWebAdmissionBody(S1A_ORACLE_WEB_ADMISSION_DECISION_CORE))
});
const S1A_ORACLE_WEB_ADMISSION_DECISION = Object.freeze({
  ...S1A_ORACLE_WEB_ADMISSION_DECISION_CORE,
  admissionReadback: S1A_ORACLE_WEB_ADMISSION_READBACK
});

const S1A_ORACLE_HISTORY_RECORD = Object.freeze({
  FINDING_ID: 'finding:one',
  WEB_ADMITTED_REVISION: 'web:revision-6',
  DISPOSITION: 'FUTURE_OWNED',
  LIFECYCLE: 'UNRESOLVED',
  TIMING: 'future-release',
  VERIFIED_OWNER: 'team:one',
  TRIGGER_OR_REASON: 'accepted prior owner and trigger',
  CLOSURE_CRITERION: 'closure:one',
  EXACT_EVIDENCE: Object.freeze(['evidence:one-prior']),
  CANDIDATE_IDENTITY: Object.freeze({ commit: 'commit:6', tree: 'tree:6' })
});
const S1A_ORACLE_HISTORY_RECORDS = Object.freeze([Object.freeze({
  ref: s1aHashRecord(S1A_ORACLE_HISTORY_RECORD),
  record: S1A_ORACLE_HISTORY_RECORD
})]);
const S1A_ORACLE_HISTORY_LEDGER_VALUE = Object.freeze({
  source: S1A_ORACLE_COMPANION_HISTORY_SOURCE,
  authoritative: true,
  complete: true,
  records: S1A_ORACLE_HISTORY_RECORDS
});
const S1A_ORACLE_HISTORY_LEDGER_DIGEST = s1aHashRecord(S1A_ORACLE_HISTORY_LEDGER_VALUE);
const S1A_ORACLE_PARENT_CONTRACT_REVISION = 'parent:revision-42';
const S1A_ORACLE_PARENT_CONTRACT_BODY = s1aCanonical({
  schema: 'toolkit.s1a.current-parent-contract.v1',
  repository: 'weijunswj/ai-agent-toolkit',
  revision: S1A_ORACLE_PARENT_CONTRACT_REVISION,
  companionHistoryDigest: S1A_ORACLE_HISTORY_LEDGER_DIGEST
});
const S1A_ORACLE_PARENT_CONTRACT_DIGEST = s1aHashText(S1A_ORACLE_PARENT_CONTRACT_BODY);
const S1A_ORACLE_INTEGRATED_IDENTITY = Object.freeze({
  repository: 'weijunswj/ai-agent-toolkit',
  deliveryChildId: 'child:current',
  commit: 'integrated:commit-8',
  tree: 'integrated:tree-8'
});
const S1A_ORACLE_REVIEW_ROUTE_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_OWNER_WEB_AUTHORITY',
  authoritative: true,
  current: true,
  readBack: true,
  authorityReference: 'authority:review-routes:3',
  revision: 'authority:route-revision-3',
  routes: Object.freeze([
    Object.freeze({ slot: 'A', provider: 'openai', model: 'gpt-6-luna', reasoning: 'max' }),
    Object.freeze({ slot: 'B', provider: 'openai', model: 'gpt-6-sol', reasoning: 'max' })
  ])
});
const S1A_ORACLE_REVIEW_ROUTE_AUTHORITY = Object.freeze({
  ...S1A_ORACLE_REVIEW_ROUTE_AUTHORITY_CORE,
  digest: s1aHashRecord(S1A_ORACLE_REVIEW_ROUTE_AUTHORITY_CORE)
});

function makeS1aCompanionHistoryLedger() {
  return {
    ...s1aClone(S1A_ORACLE_HISTORY_LEDGER_VALUE),
    digest: S1A_ORACLE_HISTORY_LEDGER_DIGEST,
    parentContractReadback: {
      source: 'CANONICAL_PARENT',
      authoritative: true,
      current: true,
      readBack: true,
      repository: 'weijunswj/ai-agent-toolkit',
      revision: S1A_ORACLE_PARENT_CONTRACT_REVISION,
      body: S1A_ORACLE_PARENT_CONTRACT_BODY,
      bodyDigest: S1A_ORACLE_PARENT_CONTRACT_DIGEST
    }
  };
}

const S1A_ORACLE_CURRENT_COMPANION_RECORDS = Object.freeze([
  Object.freeze({
    FINDING_ID: 'finding:one', WEB_ADMITTED_REVISION: 'web:revision-7',
    DISPOSITION: 'FUTURE_OWNED', LIFECYCLE: 'UNRESOLVED', TIMING: 'future-release',
    VERIFIED_OWNER: 'team:one', TRIGGER_OR_REASON: 'new acceptance evidence',
    CLOSURE_CRITERION: 'closure:one', EXACT_EVIDENCE: Object.freeze(['evidence:one']),
    CANDIDATE_IDENTITY: Object.freeze({ commit: 'commit:7', tree: 'tree:7' }),
    ...makeS1aCommonFindingFields({
      FINDING_ID: 'finding:one', WEB_ADMITTED_REVISION: 'web:revision-7',
      FINDING_REVISION: 'finding-revision:one-7', ACCEPTED_DECISION_ID: 'decision:web:one',
      VERIFIED_OWNER: 'team:one', CANDIDATE_IDENTITY: { commit: 'commit:7', tree: 'tree:7' },
      PRIMARY_OWNER: 'TOOLKIT', ADJUDICATION: 'FUTURE_OWNED', OWNER_ROLE: 'TOOLKIT_OWNER',
      OBSERVED_BEHAVIOR: 'The accepted future criterion remains unresolved.',
      REQUIRED_BEHAVIOR: 'The verified future owner closes the criterion before its trigger.'
    })
  }),
  Object.freeze({
    FINDING_ID: 'finding:two', WEB_ADMITTED_REVISION: 'web:revision-7',
    DISPOSITION: 'EVIDENCE_ONLY', LIFECYCLE: 'UNRESOLVED', TIMING: 'before-next-review',
    VERIFIED_OWNER: 'team:two', TRIGGER_OR_REASON: 'required evidence acquisition',
    CLOSURE_CRITERION: 'closure:two', EXACT_EVIDENCE: Object.freeze(['evidence:two']),
    CANDIDATE_IDENTITY: Object.freeze({ commit: 'commit:7', tree: 'tree:7' }),
    ...makeS1aCommonFindingFields({
      FINDING_ID: 'finding:two', WEB_ADMITTED_REVISION: 'web:revision-7',
      FINDING_REVISION: 'finding-revision:two-7', ACCEPTED_DECISION_ID: 'decision:web:two',
      VERIFIED_OWNER: 'team:two', CANDIDATE_IDENTITY: { commit: 'commit:7', tree: 'tree:7' },
      PRIMARY_OWNER: 'HARNESS', ADJUDICATION: 'EVIDENCE_ONLY', OWNER_ROLE: 'TOOLKIT_OWNER',
      OBSERVED_BEHAVIOR: 'The current evidence does not establish a product defect.',
      REQUIRED_BEHAVIOR: 'Acquire and preserve the exact evidence before the next review.'
    })
  })
]);
function makeS1aCurrentCompanionInventory(records, revision) {
  const core = {
    source: 'CURRENT_WEB_ADMISSION_COMPANION_INVENTORY',
    authoritative: true,
    current: true,
    complete: true,
    readBack: true,
    repository: 'weijunswj/ai-agent-toolkit',
    packetIdentity: s1aClone(records[0].PACKET_IDENTITY),
    acceptedDecisionIds: [...new Set(records.map((record) => record.ACCEPTED_DECISION_ID))].sort(),
    candidateIdentities: records.map((record) => s1aClone(record.CANDIDATE_IDENTITY)),
    revision,
    records: records.map((record) => ({ ref: s1aHashRecord(record), record: s1aClone(record) }))
  };
  return { ...core, digest: s1aHashRecord(core) };
}
function makeS1aCompanionProjection(record, ref, legacy = {}) {
  return {
    ...Object.fromEntries(S1A_ORACLE_COMPANION_PROJECTION_FIELDS.map((field) =>
      [field, record[field] === undefined ? undefined : s1aClone(record[field])])),
    DISPOSITION: record.DISPOSITION,
    LIFECYCLE: record.LIFECYCLE,
    DETAIL_REF: ref,
    TWO_WAY: legacy.TWO_WAY,
    V1: legacy.V1
  };
}
const S1A_ORACLE_CURRENT_COMPANION_INVENTORY = Object.freeze(
  makeS1aCurrentCompanionInventory(S1A_ORACLE_CURRENT_COMPANION_RECORDS, 'web:inventory-revision-7'));
const S1A_ORACLE_BLOCKER_COMPANION_INVENTORY = Object.freeze(
  makeS1aCurrentCompanionInventory([S1A_ORACLE_BLOCKER_PROOF_RECORD], 'web:inventory-revision-blocker-7'));
const S1A_ORACLE_DUPLICATE_CURRENT_COMPANION_INVENTORY = (() => {
  const records = s1aClone(S1A_ORACLE_CURRENT_COMPANION_RECORDS);
  const duplicate = s1aClone(records[0]);
  duplicate.FINDING_REVISION = 'finding-revision:one-8';
  duplicate.ACCEPTED_DECISION_ID = 'decision:web:one-8';
  duplicate.DISPOSITION = 'OBSERVE';
  duplicate.ADJUDICATION = 'OBSERVE';
  records.push(duplicate);
  return makeS1aCurrentCompanionInventory(records, 'web:inventory-revision-duplicate-current-slot');
})();
const S1A_ORACLE_ALLOWED_COMPANION_INVENTORIES = Object.freeze([
  S1A_ORACLE_CURRENT_COMPANION_INVENTORY,
  S1A_ORACLE_BLOCKER_COMPANION_INVENTORY,
  S1A_ORACLE_DUPLICATE_CURRENT_COMPANION_INVENTORY
]);
function makeS1aCompanionFixture() {
  const currentInventory = s1aClone(S1A_ORACLE_CURRENT_COMPANION_INVENTORY);
  const entries = s1aClone(currentInventory.records);
  const projections = entries.map((entry) => {
    const record = entry.record;
    const mapping = S1A_ORACLE_PROJECTION_ROWS.find((row) =>
      row.disposition === record.DISPOSITION && row.lifecycle === record.LIFECYCLE);
    return makeS1aCompanionProjection(record, entry.ref, {
      TWO_WAY: mapping.twoWay,
      V1: mapping.v1
    });
  });
  return {
    projections, entries, currentInventory,
    historyLedger: makeS1aCompanionHistoryLedger()
  };
}
function s1aCompanionIdentity(record, fields) {
  if (!record || fields.some((field) => !s1aPresent(record[field]))) return null;
  return s1aCanonical(fields.map((field) => record[field]));
}

function observeS1aCompanionOracle(policy) {
  const cases = [{
    id: 'companion-complete-positive',
    expected: true,
    obligation: null,
    build: () => makeS1aCompanionFixture()
  }, {
    id: 'companion-contradictory-legacy-projection',
    expected: false,
    obligation: 'COMPANION_LEGACY_PROJECTION_BINDING',
    build: () => {
      const fixture = makeS1aCompanionFixture();
      fixture.projections[0].TWO_WAY = 'SHIP_BLOCKER';
      fixture.projections[0].V1 = 'BLOCKING';
      return fixture;
    }
  }, {
    id: 'companion-missing-history-readback',
    expected: false,
    obligation: 'COMPANION_HISTORY_READBACK',
    build: () => {
      const fixture = makeS1aCompanionFixture();
      fixture.historyLedger = null;
      return fixture;
    }
  }, {
    id: 'companion-prior-history-deleted-and-rehashed',
    expected: false,
    obligation: 'COMPANION_HISTORY_READBACK',
    build: () => {
      const fixture = makeS1aCompanionFixture();
      fixture.historyLedger.records.pop();
      fixture.historyLedger.digest = s1aHashRecord({
        source: fixture.historyLedger.source,
        authoritative: fixture.historyLedger.authoritative,
        complete: fixture.historyLedger.complete,
        records: fixture.historyLedger.records
      });
      return fixture;
    }
  }, {
    id: 'companion-parent-history-anchor-mismatch',
    expected: false,
    obligation: 'COMPANION_HISTORY_READBACK',
    build: () => {
      const fixture = makeS1aCompanionFixture();
      fixture.historyLedger.parentContractReadback.body = s1aCanonical({
        schema: 'toolkit.s1a.current-parent-contract.v1',
        repository: 'weijunswj/ai-agent-toolkit',
        revision: S1A_ORACLE_PARENT_CONTRACT_REVISION
      });
      fixture.historyLedger.parentContractReadback.bodyDigest =
        s1aHashText(fixture.historyLedger.parentContractReadback.body);
      return fixture;
    }
  }, {
    id: 'companion-duplicate-current-disposition',
    expected: false,
    obligation: 'COMPANION_CURRENT_DISPOSITION_UNIQUENESS',
    build: () => {
      const fixture = makeS1aCompanionFixture();
      fixture.currentInventory = s1aClone(S1A_ORACLE_DUPLICATE_CURRENT_COMPANION_INVENTORY);
      fixture.entries = s1aClone(fixture.currentInventory.records);
      fixture.projections = fixture.entries.map((entry) => {
        const record = entry.record;
        const mapping = S1A_ORACLE_PROJECTION_ROWS.find((row) =>
          row.disposition === record.DISPOSITION && row.lifecycle === record.LIFECYCLE);
        return makeS1aCompanionProjection(record, entry.ref, { TWO_WAY: mapping.twoWay, V1: mapping.v1 });
      });
      return fixture;
    }
  }, {
    id: 'companion-historical-record-rewrite',
    expected: false,
    obligation: 'COMPANION_HISTORICAL_RECORD_IMMUTABILITY',
    build: () => {
      const fixture = makeS1aCompanionFixture();
      const rewritten = s1aClone(S1A_ORACLE_HISTORY_RECORD);
      rewritten.TIMING = 'rewritten-historical-detail';
      const ref = s1aHashRecord(rewritten);
      fixture.entries[0] = { ref, record: rewritten };
      fixture.projections[0] = makeS1aCompanionProjection(rewritten, ref, {
        TWO_WAY: 'POST_SHIP', V1: 'NON_BLOCKING'
      });
      return fixture;
    }
  }];
  for (const field of S1A_ORACLE_DETAIL_FIELDS) {
    cases.push({
      id: 'companion-missing-' + field,
      expected: false,
      obligation: 'COMPANION_REQUIRED_FIELD:' + field,
      build: () => {
        const fixture = makeS1aCompanionFixture();
        const entry = fixture.entries[0];
        delete entry.record[field];
        entry.ref = s1aHashRecord(entry.record);
        fixture.projections[0].DETAIL_REF = entry.ref;
        return fixture;
      }
    });
  }
  return cases.map((scenario) => {
    const fixture = scenario.build();
    const result = evaluateS1aCompanions(policy, fixture.projections, fixture.entries,
      fixture.historyLedger, fixture.currentInventory);
    const missingField = scenario.id.startsWith('companion-missing-')
      ? scenario.id.slice('companion-missing-'.length) : null;
    const targetedFailure = missingField
      ? result.failures.includes('COMPANION_FIELD_MISSING:' + missingField)
      : null;
    return {
      id: scenario.id,
      expected: scenario.expected,
      observed: result.ok,
      obligation: result.ok === scenario.expected ? null : (scenario.obligation || result.failures[0] || 'COMPANION_ORACLE_MISMATCH'),
      targetedFailure,
      failures: result.failures
    };
  });
}

function evaluateS1aCompanions(policy, projections, entries, historyLedger, currentInventory) {
  const failures = [];
  const refField = policy.companion.referenceField;
  const recordRefField = policy.companion.recordReferenceField;
  if (!Array.isArray(projections) || projections.length === 0 ||
      !Array.isArray(entries) || entries.length !== projections.length ||
      !currentInventory || !Array.isArray(currentInventory.records) ||
      currentInventory.records.length !== entries.length) {
    return { ok: false, failures: ['COMPANION_CARDINALITY'] };
  }
  const parentReadback = historyLedger && historyLedger.parentContractReadback;
  const ledgerDigestInput = historyLedger && {
    source: historyLedger.source, authoritative: historyLedger.authoritative,
    complete: historyLedger.complete, records: historyLedger.records
  };
  let parentBody;
  try {
    parentBody = parentReadback && typeof parentReadback.body === 'string'
      ? s1aParseJsonRejectDuplicates(parentReadback.body) : null;
  } catch {
    parentBody = null;
  }
  if (!historyLedger || typeof historyLedger !== 'object' || Array.isArray(historyLedger) ||
      !s1aSame([...Object.keys(historyLedger)].sort(),
        ['source', 'authoritative', 'complete', 'records', 'digest', 'parentContractReadback'].sort()) ||
      historyLedger.source !== policy.companion.historySource ||
      historyLedger.authoritative !== true || historyLedger.complete !== true ||
      !Array.isArray(historyLedger.records) ||
      !s1aSame(policy.companion.historyAnchor, S1A_ORACLE_COMPANION_HISTORY_ANCHOR) ||
      !s1aSame(historyLedger.records, S1A_ORACLE_HISTORY_RECORDS) ||
      historyLedger.digest !== S1A_ORACLE_HISTORY_LEDGER_DIGEST ||
      historyLedger.digest !== s1aHashRecord(ledgerDigestInput) ||
      !parentReadback || !s1aSame([...Object.keys(parentReadback)].sort(),
        [...S1A_ORACLE_COMPANION_HISTORY_ANCHOR.parentReadbackFields].sort()) ||
      parentReadback.source !== 'CANONICAL_PARENT' || parentReadback.authoritative !== true ||
      parentReadback.current !== true || parentReadback.readBack !== true ||
      parentReadback.repository !== 'weijunswj/ai-agent-toolkit' ||
      parentReadback.revision !== S1A_ORACLE_PARENT_CONTRACT_REVISION ||
      parentReadback.body !== S1A_ORACLE_PARENT_CONTRACT_BODY ||
      parentReadback.bodyDigest !== S1A_ORACLE_PARENT_CONTRACT_DIGEST ||
      parentReadback.bodyDigest !== s1aHashText(parentReadback.body) ||
      !parentBody || parentBody[policy.companion.historyAnchor.field] !== historyLedger.digest ||
      parentBody.repository !== parentReadback.repository ||
      parentBody.revision !== parentReadback.revision ||
      s1aCanonical(parentBody) !== parentReadback.body) {
    return { ok: false, failures: ['COMPANION_HISTORY_READBACK'] };
  }
  if (!s1aHasExactKeys(currentInventory, policy.companion.currentInventory.readbackFields) ||
      !S1A_ORACLE_ALLOWED_COMPANION_INVENTORIES.some((oracle) => s1aSame(currentInventory, oracle)) ||
      currentInventory.source !== policy.companion.currentInventory.source ||
      currentInventory.repository !== 'weijunswj/ai-agent-toolkit' ||
      !s1aSame(currentInventory.packetIdentity, S1A_ORACLE_PACKET_IDENTITY) ||
      !s1aSame(currentInventory.acceptedDecisionIds,
        [...new Set(entries.map((entry) => entry.record.ACCEPTED_DECISION_ID))].sort()) ||
      !s1aSame(currentInventory.candidateIdentities,
        entries.map((entry) => entry.record.CANDIDATE_IDENTITY)) ||
      currentInventory.authoritative !== true || currentInventory.current !== true ||
      currentInventory.complete !== true || currentInventory.readBack !== true ||
      currentInventory.digest !== s1aHashWithoutField(currentInventory, 'digest') ||
      !s1aSame(entries, currentInventory.records)) {
    failures.push('COMPANION_CURRENT_INVENTORY_READBACK');
  }
  for (const entry of entries) {
    for (const [field, type] of Object.entries(policy.companion.typedFields)) {
      if (!s1aTypeMatches(entry && entry.record && entry.record[field], type)) {
        failures.push('COMPANION_FIELD_TYPE:' + field);
      }
    }
  }
  const history = historyLedger.records;
  const refs = entries.map((entry) => entry[recordRefField]);
  if (refs.some((ref) => !s1aPresent(ref)) || new Set(refs).size !== refs.length) {
    failures.push('COMPANION_DUPLICATE_OR_MISSING_REFERENCE');
  }
  if (new Set(projections.map((row) => row[refField])).size !== projections.length) {
    failures.push('COMPANION_DUPLICATE_PROJECTION_REFERENCE');
  }
  const currentKeys = entries.map((entry) =>
    s1aCompanionIdentity(entry.record, policy.companion.currentUniquenessFields));
  if (currentKeys.some((key) => key === null) || new Set(currentKeys).size !== currentKeys.length) {
    failures.push('COMPANION_CURRENT_DISPOSITION_UNIQUENESS');
  }
  const historicalByIdentity = new Map();
  for (const item of history) {
    const key = item && s1aCompanionIdentity(item.record, S1A_ORACLE_HISTORY_IDENTITY_FIELDS);
    if (!item || !s1aPresent(item.ref) || !key ||
        item.ref !== s1aHashRecord(item.record) || historicalByIdentity.has(key)) {
      failures.push('COMPANION_HISTORICAL_RECORD_IMMUTABILITY');
      continue;
    }
    historicalByIdentity.set(key, item);
  }
  for (let index = 0; index < entries.length; index++) {
    const historyKey = s1aCompanionIdentity(entries[index].record, S1A_ORACLE_HISTORY_IDENTITY_FIELDS);
    const prior = historicalByIdentity.get(historyKey);
    if (prior && (prior.ref !== entries[index][recordRefField] ||
        !s1aSame(prior.record, entries[index].record))) {
      failures.push('COMPANION_HISTORICAL_RECORD_IMMUTABILITY');
    }
  }
  for (const projection of projections) {
    const ref = projection[refField];
    const matches = entries.filter((entry) => entry[recordRefField] === ref);
    if (!s1aPresent(ref) || matches.length !== 1) {
      failures.push('COMPANION_REFERENCE_MEMBERSHIP');
      continue;
    }
    const record = matches[0].record;
    if (!s1aPresent(record)) {
      failures.push('COMPANION_RECORD_MISSING');
      continue;
    }
    const projectionRows = policy.projectionRows.filter((row) =>
      row.disposition === record.DISPOSITION && row.lifecycle === record.LIFECYCLE);
    if (projectionRows.length !== 1) {
      failures.push('COMPANION_LEGACY_PROJECTION_RULE_MISSING');
    } else {
      const expectedLegacy = { TWO_WAY: projectionRows[0].twoWay, V1: projectionRows[0].v1 };
      for (const field of policy.companion.legacyProjectionFields) {
        if (!s1aSame(projection[field], expectedLegacy[field])) {
          failures.push('COMPANION_LEGACY_PROJECTION_BINDING');
        }
      }
    }
    for (const field of policy.companion.requiredFields) {
      if (!s1aPresent(record[field])) failures.push('COMPANION_FIELD_MISSING:' + field);
    }
    if (ref !== s1aHashRecord(record)) failures.push('COMPANION_EXACT_CONTENT_BINDING');
    for (const field of policy.companion.projectionBindingFields) {
      if (!s1aSame(projection[field], record[field])) {
        failures.push('COMPANION_IDENTITY_BINDING:' + field);
      }
    }
  }
  if (entries.some((entry) => !projections.some((row) => row[refField] === entry[recordRefField]))) {
    failures.push('COMPANION_UNREFERENCED_RECORD');
  }
  return { ok: failures.length === 0, failures };
}
test('S1-A canonical Architecture prose baseline matches the fixed oracle before mutations', () => {
  assert.equal(s1aGovernedHumanPolicyDigest(architecture), S1A_ORACLE_GOVERNED_PROSE_SHA256);
  assert.doesNotThrow(() => parseS1aPolicyContract(architecture));
});
test('S1-A Architecture contract is read directly and agrees with the human tables', () => {
  const policy = parseS1aPolicyContract(architecture);
  assert.deepEqual(policy.dispositions,
    s1aTable(architecture, '### Canonical disposition vocabulary').map((row) => row.Disposition));
  assert.deepEqual(policy.lifecycles, ['UNRESOLVED', 'RESOLVED']);
  assert.deepEqual(policy.projectionRows.map((row) => ({
    'Canonical disposition': row.disposition,
    Lifecycle: row.lifecycle,
    'Two-way projection': row.twoWay,
    'v1 projection': row.v1
  })), s1aTable(architecture, '### Lossless legacy projections'));
  assert.match(architecture, /policy-source structure for closed regression interpretation/);
  assert.match(architecture, /Historical evidence remains immutable/);
});

test('S1-A closed interpreter rejects duplicate, unknown, ambiguous, and unresolved declarations', () => {
  const block = s1aReadPolicy(architecture).block;
  const duplicateJson = architecture.replace(
    '"schema": "toolkit.s1a.policy-contract.v1",',
    '"schema": "toolkit.s1a.policy-contract.v1",\n  "schema": "toolkit.s1a.policy-contract.v1",'
  );
  assert.throws(() => parseS1aPolicyContract(duplicateJson), /duplicate JSON key: schema/);
  assert.throws(() => parseS1aPolicyContract(architecture.replace(block, block + '\n' + block)),
    /exactly one S1-A policy contract/);
  assert.throws(() => parseS1aPolicyContract(rewriteS1aPolicy(architecture, (policy) => { policy.unknownRule = true; })),
    /unknown declaration at root/);
  assert.throws(() => parseS1aPolicyContract(rewriteS1aPolicy(architecture, (policy) => {
    policy.blocker.requiredFields.push('SMALLEST_CORRECTION');
  })), /duplicate declaration at blocker.requiredFields/);
  assert.throws(() => parseS1aPolicyContract(rewriteS1aPolicy(architecture, (policy) => {
    policy.blocker.bindings[0].record = 'UNDECLARED_FIELD';
  })), /unresolved blocker record binding/);
});

test('S1-A blocker observer applies fixed outcomes to complete, missing, and contradictory records', () => {
  const results = observeS1aBlockerOracle(parseS1aPolicyContract(architecture));
  assert.deepEqual(results.filter((item) => item.expected !== item.observed).map((item) => item.id), []);
  assert.equal(results.filter((item) => item.id.startsWith('blocker-missing-') &&
    !item.id.startsWith('blocker-missing-nested-')).length,
    S1A_ORACLE_BLOCKER_FIELDS.length + S1A_ORACLE_IDENTITY_FIELDS.length);
  assert.equal(results.filter((item) => item.id.startsWith('blocker-missing-nested-')).length,
    S1A_ORACLE_BLOCKER_NESTED_FIELDS.reduce((count, row) => count + row.fields.length, 0));  assert.equal(results.find((item) => item.id === 'blocker-complete-current-record').observed, true);
});

test('S1-A blocker admission rejects wrong value types and caller-rehashed Web decisions', () => {
  const policy = parseS1aPolicyContract(architecture);
  const evaluate = (fixture) => evaluateS1aBlocker(policy, fixture.record, fixture.decision,
    fixture.companionProjection, fixture.companionEntries, fixture.currentInventory).admitted;

  for (const value of [false, 0, [], [null], {}]) {
    const fixture = makeS1aBlockerFixture();
    fixture.record.VERIFIED_OWNER = value;
    assert.equal(evaluate(fixture), false, 'non-string owner must not satisfy blocker admission');
  }
  for (const value of [false, 0, null, []]) {
    const fixture = makeS1aBlockerFixture();
    fixture.record.SHIP_NOW_CONSEQUENCE.description = value;
    assert.equal(evaluate(fixture), false, 'non-string consequence must not satisfy blocker admission');
  }
  const missingReadback = makeS1aBlockerFixture();
  delete missingReadback.decision.admissionReadback;
  assert.equal(evaluate(missingReadback), false);

  const rehashedCoMutation = makeS1aBlockerFixture();
  rehashedCoMutation.record.SMALLEST_CORRECTION = 'correction:caller-rewritten';
  refreshS1aBlockerFixture(rehashedCoMutation, true);
  assert.equal(evaluate(rehashedCoMutation), false,
    'recomputed detail and Web-body hashes cannot replace the independent current Web readback');

  const contradictoryReadback = makeS1aBlockerFixture();
  contradictoryReadback.decision.admissionReadback.current = false;
  contradictoryReadback.decision.admissionReadback.bodyDigest =
    s1aHashText(contradictoryReadback.decision.admissionReadback.body);
  assert.equal(evaluate(contradictoryReadback), false);
});

test('S1-A lifecycle proof values remain typed and transfer or deferral cannot resolve work', () => {
  const policy = parseS1aPolicyContract(architecture);
  for (const value of [false, 0, null, [], {}]) {
    const result = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
      'TRANSFER', { VERIFIED_OWNER: value });
    assert.equal(result.ok, false);
    assert.equal(result.lifecycle, 'UNRESOLVED');
  }
  const deferredFalse = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED', 'DEFER', {
    VERIFIED_OWNER: 'owner:verified', TIMING: 'future-release',
    TRIGGER_OR_REASON: false
  });
  assert.equal(deferredFalse.ok, false);
  assert.equal(deferredFalse.lifecycle, 'UNRESOLVED');

  const verified = {
    FINDING_ID: S1A_ORACLE_CLOSURE_BODY.findingId,
    WEB_ADMITTED_REVISION: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
    DISPOSITION: S1A_ORACLE_CLOSURE_BODY.disposition,
    CLOSURE_CRITERION: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
    EXACT_EVIDENCE: [...S1A_ORACLE_CLOSURE_BODY.exactEvidence],
    CANDIDATE_IDENTITY: s1aClone(S1A_ORACLE_CLOSURE_BODY.candidateIdentity),
    closureReadback: s1aClone(S1A_ORACLE_CLOSURE_READBACK)
  };
  const acceptedClosure = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', verified);
  assert.equal(acceptedClosure.ok, true);
  assert.equal(acceptedClosure.lifecycle, 'RESOLVED');

  const arbitraryEvidence = s1aClone(verified);
  arbitraryEvidence.CLOSURE_CRITERION = 'criterion:unrelated';
  arbitraryEvidence.EXACT_EVIDENCE = ['evidence:unverified'];
  const rejectedClosure = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', arbitraryEvidence);
  assert.equal(rejectedClosure.ok, false);
  assert.equal(rejectedClosure.lifecycle, 'UNRESOLVED');

  const callerRehashedClosure = s1aClone(verified);
  callerRehashedClosure.closureReadback.closureCriterion = 'criterion:unrelated';
  callerRehashedClosure.closureReadback.exactEvidence = ['evidence:unverified'];
  callerRehashedClosure.closureReadback.body = s1aCanonical({
    ...S1A_ORACLE_CLOSURE_BODY,
    closureCriterion: 'criterion:unrelated',
    exactEvidence: ['evidence:unverified']
  });
  callerRehashedClosure.closureReadback.bodyDigest =
    s1aHashText(callerRehashedClosure.closureReadback.body);
  callerRehashedClosure.CLOSURE_CRITERION = 'criterion:unrelated';
  callerRehashedClosure.EXACT_EVIDENCE = ['evidence:unverified'];
  const reboundClosure = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', callerRehashedClosure);
  assert.equal(reboundClosure.ok, false);
  assert.equal(reboundClosure.lifecycle, 'UNRESOLVED');
});
test('S1-A ownership transfer requires a current authoritative readback bound to every shared identity', () => {
  const policy = parseS1aPolicyContract(architecture);
  const makeTransfer = () => makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY);
  const trustedContext = Object.freeze({
    currentOwnershipReadback: s1aDeepFreeze(s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK))
  });
  const transfer = makeTransfer();
  const transferBefore = s1aClone(transfer);
  const historyLedger = makeS1aCompanionHistoryLedger();
  const historyBefore = s1aClone(historyLedger);
  const accepted = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
    'TRANSFER', transfer, trustedContext);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.lifecycle, 'UNRESOLVED');
  assert.deepEqual(transfer, transferBefore, 'transfer preserves the admitted finding record');
  assert.deepEqual(historyLedger, historyBefore, 'transfer preserves append-only companion history');

  const rebindReadback = (detail) => {
    const { digest, ...core } = detail.OWNER_READBACK;
    detail.OWNER_READBACK.digest = s1aHashRecord(core);
  };
  const attacks = [
    ['missing readback', (detail) => { delete detail.OWNER_READBACK; }],
    ['non-authoritative readback', (detail) => {
      detail.OWNER_READBACK.authoritative = false;
      rebindReadback(detail);
    }],
    ['stale readback', (detail) => {
      detail.OWNER_READBACK.current = false;
      rebindReadback(detail);
    }],
    ['unread readback', (detail) => {
      detail.OWNER_READBACK.readBack = false;
      rebindReadback(detail);
    }],
    ['repository mismatch', (detail) => {
      detail.OWNER_READBACK.repository = 'other/repository';
      rebindReadback(detail);
    }],
    ['packet mismatch', (detail) => {
      detail.OWNER_READBACK.packetIdentity.packetId = 'packet:other';
      rebindReadback(detail);
    }],
    ['finding revision mismatch', (detail) => {
      detail.OWNER_READBACK.findingRevision = 'finding-revision:stale';
      rebindReadback(detail);
    }],
    ['candidate mismatch', (detail) => {
      detail.OWNER_READBACK.candidateIdentity.tree = 'tree:other';
      rebindReadback(detail);
    }],
    ['Web revision mismatch', (detail) => { detail.OWNER_READBACK.webAdmittedRevision = 'web:other'; rebindReadback(detail); }],
    ['programme mismatch', (detail) => { detail.OWNER_READBACK.programmeId = 'programme:other'; rebindReadback(detail); }],
    ['child mismatch', (detail) => { detail.OWNER_READBACK.childId = 'child:other'; rebindReadback(detail); }],
    ['frontier mismatch', (detail) => { detail.OWNER_READBACK.frontierId = 'frontier:other'; rebindReadback(detail); }],
    ['controller mismatch', (detail) => { detail.OWNER_READBACK.controllerId = 'controller:other'; rebindReadback(detail); }],
    ['contract mismatch', (detail) => { detail.OWNER_READBACK.acceptedContractId = 'contract:other'; rebindReadback(detail); }],
    ['subject mismatch', (detail) => { detail.OWNER_READBACK.subjectId = 'subject:other'; rebindReadback(detail); }],
    ['observed behavior mismatch', (detail) => { detail.OWNER_READBACK.observedBehavior = 'other observed behavior'; rebindReadback(detail); }],
    ['required behavior mismatch', (detail) => { detail.OWNER_READBACK.requiredBehavior = 'other required behavior'; rebindReadback(detail); }],
    ['primary owner mismatch', (detail) => { detail.OWNER_READBACK.primaryOwner = 'OTHER_OWNER'; rebindReadback(detail); }],
    ['adjudication mismatch', (detail) => { detail.OWNER_READBACK.adjudication = 'OTHER_DISPOSITION'; rebindReadback(detail); }],
    ['resolution mismatch', (detail) => { detail.OWNER_READBACK.resolution = 'RESOLVED'; rebindReadback(detail); }],
    ['co-rebound resolved record', (detail) => {
      detail.RESOLUTION = 'RESOLVED';
      detail.OWNER_READBACK.resolution = 'RESOLVED';
      rebindReadback(detail);
    }],
    ['missing shared finding field', (detail) => { delete detail.CHILD_ID; }],
    ['accepted decision mismatch', (detail) => {
      detail.OWNER_READBACK.acceptedDecisionId = 'decision:web:other';
      rebindReadback(detail);
    }],
    ['owner mismatch', (detail) => {
      detail.OWNER_READBACK.owner = 'owner:other';
      rebindReadback(detail);
    }],
    ['co-rebound owner and readback', (detail) => {
      detail.VERIFIED_OWNER = 'owner:other';
      detail.OWNER_READBACK.owner = 'owner:other';
      rebindReadback(detail);
    }],
    ['role mismatch', (detail) => {
      detail.OWNER_READBACK.ownerRole = 'OTHER_ROLE';
      rebindReadback(detail);
    }],
    ['invalid digest', (detail) => {
      detail.OWNER_READBACK.digest = 'sha256:caller-value';
    }]
  ];
  for (const [name, attack] of attacks) {
    const detail = makeTransfer();
    attack(detail);
    const result = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
      'TRANSFER', detail, trustedContext);
    assert.equal(result.ok, false, name + ' must not transfer ownership');
    assert.equal(result.lifecycle, 'UNRESOLVED', name + ' must not resolve the finding');
    assert.ok(result.failures.includes('LIFECYCLE_OWNER_TRANSFER_READBACK'),
      name + ' must fail the ownership readback obligation');
  }
  const aliasedTransfer = makeTransfer();
  const aliasedResult = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
    'TRANSFER', aliasedTransfer, { currentOwnershipReadback: aliasedTransfer.OWNER_READBACK });
  assert.equal(aliasedResult.ok, false, 'a request-owned readback cannot serve as trusted context');
  assert.equal(aliasedResult.lifecycle, 'UNRESOLVED');
  assert.ok(aliasedResult.failures.includes('LIFECYCLE_OWNER_TRANSFER_READBACK'));

  const coReboundTransfer = makeTransfer();
  coReboundTransfer.VERIFIED_OWNER = 'owner:forged';
  coReboundTransfer.OWNER_READBACK.owner = 'owner:forged';
  rebindReadback(coReboundTransfer);
  const forgedTrustedReadback = s1aClone(trustedContext.currentOwnershipReadback);
  forgedTrustedReadback.owner = 'owner:forged';
  const { digest, ...trustedReadbackCore } = forgedTrustedReadback;
  forgedTrustedReadback.digest = s1aHashRecord(trustedReadbackCore);
  const forgedContextResult = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
    'TRANSFER', coReboundTransfer, { currentOwnershipReadback: forgedTrustedReadback });
  assert.equal(forgedContextResult.ok, false,
    'co-rebinding request, embedded readback, digest, and a cloned fake trusted readback is rejected');
  assert.equal(forgedContextResult.lifecycle, 'UNRESOLVED');
  assert.ok(forgedContextResult.failures.includes('LIFECYCLE_OWNER_TRANSFER_READBACK'));
});
test('S1-A clause-removal and polarity controls are rejected by the closed contract', () => {
  const removed = rewriteS1aPolicy(architecture, (policy) => {
    policy.blocker.requiredFields = policy.blocker.requiredFields.filter((field) =>
      field !== 'SMALLEST_CORRECTION');
  });
  const proseAlsoRemoved = removeS1aProseField(removed, 'SMALLEST_CORRECTION');
  assert.throws(() => parseS1aPolicyContract(proseAlsoRemoved),
    /blocker required fields are incomplete/);

  const polarity = rewriteS1aPolicy(architecture, (policy) => {
    policy.blocker.truthChecks[0].value = false;
  });
  assert.throws(() => parseS1aPolicyContract(polarity),
    /blocker truth checks are incomplete/);
});
test('S1-A companion observer rejects discarded, altered, and swapped detailed records', () => {
  const policy = parseS1aPolicyContract(architecture);
  const fixed = observeS1aCompanionOracle(policy);
  assert.deepEqual(fixed.filter((item) => item.expected !== item.observed).map((item) => item.id), []);
  const missingDetail = fixed.filter((item) =>
    S1A_ORACLE_DETAIL_FIELDS.some((field) => item.id === 'companion-missing-' + field));
  assert.equal(missingDetail.length, S1A_ORACLE_DETAIL_FIELDS.length);
  assert.equal(missingDetail.filter((item) => item.targetedFailure).length,
    S1A_ORACLE_DETAIL_FIELDS.length);

  const valid = makeS1aCompanionFixture();
  assert.equal(evaluateS1aCompanions(policy, valid.projections, valid.entries,
    valid.historyLedger, valid.currentInventory).ok, true);
  const duplicateSlot = fixed.find((item) => item.id === 'companion-duplicate-current-disposition');
  assert.ok(duplicateSlot.failures.includes('COMPANION_CURRENT_DISPOSITION_UNIQUENESS'));
  assert.equal(duplicateSlot.failures.some((id) =>
    ['COMPANION_CURRENT_INVENTORY_READBACK', 'COMPANION_HISTORICAL_RECORD_IMMUTABILITY'].includes(id)), false);
  assert.equal(evaluateS1aCompanions(policy, valid.projections, valid.entries).ok, false);
  assert.equal(evaluateS1aCompanions(policy, valid.projections, [], valid.historyLedger,
    valid.currentInventory).ok, false);

  const relabeled = makeS1aCompanionFixture();
  relabeled.projections[0].TWO_WAY = 'SHIP_BLOCKER';
  relabeled.projections[0].V1 = 'BLOCKING';
  assert.equal(evaluateS1aCompanions(policy, relabeled.projections,
    relabeled.entries, relabeled.historyLedger, relabeled.currentInventory).ok, false);

  const altered = makeS1aCompanionFixture();
  altered.entries[0].record.TIMING = 'silently-swapped-timing';
  assert.equal(evaluateS1aCompanions(policy, altered.projections,
    altered.entries, altered.historyLedger, altered.currentInventory).ok, false);

  const coherentlyRehashed = makeS1aCompanionFixture();
  coherentlyRehashed.entries[0].record.TIMING = 'caller-rebound-timing';
  coherentlyRehashed.entries[0].ref = s1aHashRecord(coherentlyRehashed.entries[0].record);
  coherentlyRehashed.projections[0].DETAIL_REF = coherentlyRehashed.entries[0].ref;
  coherentlyRehashed.currentInventory = makeS1aCurrentCompanionInventory(
    coherentlyRehashed.entries.map((entry) => entry.record), 'web:inventory-revision-7');
  assert.equal(evaluateS1aCompanions(policy, coherentlyRehashed.projections,
    coherentlyRehashed.entries, coherentlyRehashed.historyLedger,
    coherentlyRehashed.currentInventory).ok, false,
  'caller-rehashed detail and complete inventory do not replace the independent oracle');

  const coDeleted = makeS1aCompanionFixture();
  coDeleted.entries.pop();
  coDeleted.projections.pop();
  coDeleted.currentInventory = makeS1aCurrentCompanionInventory(
    coDeleted.entries.map((entry) => entry.record), 'web:inventory-revision-7');
  assert.equal(evaluateS1aCompanions(policy, coDeleted.projections,
    coDeleted.entries, coDeleted.historyLedger, coDeleted.currentInventory).ok, false,
  'co-deleting a detailed entry and its projection cannot shrink the current inventory');

  const wrongOwnerType = makeS1aCompanionFixture();
  wrongOwnerType.entries[0].record.VERIFIED_OWNER = false;
  wrongOwnerType.entries[0].ref = s1aHashRecord(wrongOwnerType.entries[0].record);
  wrongOwnerType.projections[0].DETAIL_REF = wrongOwnerType.entries[0].ref;
  wrongOwnerType.currentInventory = makeS1aCurrentCompanionInventory(
    wrongOwnerType.entries.map((entry) => entry.record), 'web:inventory-revision-7');
  assert.equal(evaluateS1aCompanions(policy, wrongOwnerType.projections,
    wrongOwnerType.entries, wrongOwnerType.historyLedger, wrongOwnerType.currentInventory).ok, false,
  'typed companion values reject false even after reference recomputation');

  const swapped = makeS1aCompanionFixture();
  const first = swapped.entries[0].record;
  swapped.entries[0].record = swapped.entries[1].record;
  swapped.entries[1].record = first;
  assert.equal(evaluateS1aCompanions(policy, swapped.projections,
    swapped.entries, swapped.historyLedger, swapped.currentInventory).ok, false);
});
test('S1-A coherent projection mapping and prose weakening fail the fixed oracle', () => {
  const weakened = rewriteS1aPolicy(architecture, (policy) => {
    const row = policy.projectionRows.find((item) =>
      item.disposition === 'FUTURE_OWNED' && item.lifecycle === 'UNRESOLVED');
    row.twoWay = 'SHIP_BLOCKER';
    row.v1 = 'BLOCKING';
  });
  const oldRow = '| FUTURE_OWNED | UNRESOLVED | POST_SHIP | NON_BLOCKING |';
  s1aRequire(weakened.includes(oldRow), 'missing fixed human projection row');
  const proseWeakened = weakened.replace(oldRow,
    '| FUTURE_OWNED | UNRESOLVED | SHIP_BLOCKER | BLOCKING |');
  assert.throws(() => parseS1aPolicyContract(proseWeakened),
    /legacy projection mapping changed from the fixed oracle/);
});

test('S1-A coherent nested blocker field removal fails the fixed contract', () => {
  const weakened = rewriteS1aPolicy(architecture, (policy) => {
    const outcome = policy.blocker.nestedRequiredFields.find((row) =>
      row.record === 'ADMITTED_CURRENT_OUTCOME');
    outcome.fields = outcome.fields.filter((field) => field !== 'milestone');
  });
  const oldRow = '| ADMITTED_CURRENT_OUTCOME | The exact non-empty outcome id, milestone, intended audience and supported environment admitted for this shipment. |';
  const newRow = '| ADMITTED_CURRENT_OUTCOME | The exact non-empty outcome id, intended audience and supported environment admitted for this shipment. |';
  s1aRequire(weakened.includes(oldRow), 'missing milestone prose for coherent weakening control');
  const bothWeakened = weakened.replace(oldRow, newRow);
  assert.throws(() => parseS1aPolicyContract(bothWeakened),
    /nested blocker field set is incomplete/);
});
test('S1-A historical companion mode and immutable source cannot be weakened', () => {
  const overwriteMode = rewriteS1aPolicy(architecture, (policy) => {
    policy.companion.historicalEvidenceMode = 'MUTABLE_HISTORY';
  });
  assert.throws(() => parseS1aPolicyContract(overwriteMode),
    /companion identity, typed detail, current inventory, or parent-anchored history semantics are incomplete/);

  const substituteSource = rewriteS1aPolicy(architecture, (policy) => {
    policy.companion.historySource = 'CHILD_LOCAL_SUMMARY';
  });
  assert.throws(() => parseS1aPolicyContract(substituteSource),
    /companion identity, typed detail, current inventory, or parent-anchored history semantics are incomplete/);
});

test('S1-A companion required-field removal is rejected by the closed contract', () => {
  const weakened = rewriteS1aPolicy(architecture, (policy) => {
    policy.companion.requiredFields = policy.companion.requiredFields.filter((field) =>
      field !== 'VERIFIED_OWNER');
  });
  assert.throws(() => parseS1aPolicyContract(weakened),
    /companion detail fields are incomplete/);
});
test('S1-A weakening content-addressed companion references is rejected', () => {
  const weakened = rewriteS1aPolicy(architecture, (policy) => {
    policy.companion.referenceMode = 'FINDING_ID_ONLY';
  });
  assert.throws(() => parseS1aPolicyContract(weakened),
    /companion references must bind canonical record content/);
});
test('S1-A source contract pins complete companion inventories and closure readbacks', () => {
  const missingInventory = rewriteS1aPolicy(architecture, (policy) => {
    delete policy.companion.currentInventory;
  });
  assert.throws(() => parseS1aPolicyContract(missingInventory),
    /missing declaration at companion: currentInventory/);

  const weakenedType = rewriteS1aPolicy(architecture, (policy) => {
    policy.companion.typedFields.VERIFIED_OWNER = 'ANY_PRESENT_VALUE';
  });
  assert.throws(() => parseS1aPolicyContract(weakenedType),
    /companion identity, typed detail, current inventory/);

  const closureRule = rewriteS1aPolicy(architecture, (policy) => {
    policy.closureVerification.resolvesOnlyAfterVerifiedReadback = false;
  });
  const correctClosureSentence = 'Resolution changes only lifecycle to RESOLVED after an authoritative, current Web closure readback verifies the exact finding, admitted disposition, closure criterion, evidence references, candidate identity and transition; a caller-supplied criterion or evidence label alone cannot resolve work.';
  const weakClosureSentence = 'Resolution changes lifecycle to RESOLVED after a caller supplies a closure criterion and evidence label.';
  s1aRequire(closureRule.includes(correctClosureSentence), 'missing current closure prose mutation anchor');
  assert.throws(() => parseS1aPolicyContract(closureRule.replace(correctClosureSentence, weakClosureSentence)),
    /verified closure must use the complete current Web closure readback/);

  const staleChildRule = rewriteS1aPolicy(architecture, (policy) => {
    policy.postChildReview.childStateMustBeCurrent = false;
  });
  assert.throws(() => parseS1aPolicyContract(staleChildRule),
    /post-child review requires canonical current readback identities/);

  const weakReviewerIdentity = rewriteS1aPolicy(architecture, (policy) => {
    policy.postChildReview.reviewerIdentityFields = ['reviewerId'];
  });
  assert.throws(() => parseS1aPolicyContract(weakReviewerIdentity),
    /post-child review requires canonical current readback identities/);
});

function evaluateS1aTransition(policy, disposition, lifecycle, event, detail, trustedContext) {
  if (!s1aSame(policy.lifecycleTransitions, S1A_ORACLE_LIFECYCLE_TRANSITIONS) ||
      !s1aSame(policy.closureVerification, S1A_ORACLE_CLOSURE_VERIFICATION)) {
    return { ok: false, lifecycle, failures: ['LIFECYCLE_POLICY_NOT_FIXED'] };
  }
  if (!S1A_ORACLE_DISPOSITIONS.includes(disposition)) {
    return { ok: false, lifecycle, failures: ['LIFECYCLE_DISPOSITION_UNKNOWN'] };
  }
  const matches = policy.lifecycleTransitions.filter((row) => row.event === event);
  if (matches.length !== 1) return { ok: false, lifecycle, failures: ['LIFECYCLE_TRANSITION_MISSING_OR_AMBIGUOUS'] };
  const rule = matches[0];
  const safeDetail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const failures = [];
  if (lifecycle !== rule.from) failures.push('LIFECYCLE_SOURCE_MISMATCH');
  for (const field of rule.requires) {
    if (!s1aPresent(safeDetail[field])) failures.push('LIFECYCLE_PROOF_MISSING:' + field);
    if (!s1aTypeMatches(safeDetail[field], rule.requiredValueTypes[field])) {
      failures.push('LIFECYCLE_VALUE_TYPE:' + field);
    }
  }
  const safeTrustedContext = trustedContext && typeof trustedContext === 'object' &&
    !Array.isArray(trustedContext) ? trustedContext : {};
  if (event === 'TRANSFER' && !s1aOwnershipTransferReadbackMatches(safeDetail,
    safeTrustedContext.currentOwnershipReadback)) {
    failures.push('LIFECYCLE_OWNER_TRANSFER_READBACK');
  }
  if (event === 'VERIFIED_CLOSURE') {
    const closure = safeDetail.closureReadback;
    const body = closure && Object.fromEntries(policy.closureVerification.bodyFields
      .map((field) => [field, closure[field]]));
    const boundToTransition = closure &&
      safeDetail.FINDING_ID === closure.findingId &&
      safeDetail.WEB_ADMITTED_REVISION === closure.webAdmittedRevision &&
      safeDetail.DISPOSITION === disposition && closure.disposition === disposition &&
      safeDetail.CLOSURE_CRITERION === closure.closureCriterion &&
      s1aSame(safeDetail.EXACT_EVIDENCE, closure.exactEvidence) &&
      s1aSame(safeDetail.CANDIDATE_IDENTITY, closure.candidateIdentity) &&
      closure.fromLifecycle === lifecycle && closure.toLifecycle === rule.to;
    if (!s1aHasExactKeys(closure, policy.closureVerification.requiredFields) ||
        !s1aSame(closure, S1A_ORACLE_CLOSURE_READBACK) ||
        closure.source !== policy.closureVerification.source ||
        closure.authoritative !== true || closure.current !== true || closure.readBack !== true ||
        closure.body !== s1aCanonical(body) ||
        closure.bodyDigest !== s1aHashText(closure.body) ||
        !boundToTransition) {
      failures.push('LIFECYCLE_CLOSURE_NOT_VERIFIED');
    }
  }
  return {
    ok: failures.length === 0,
    disposition,
    lifecycle: failures.length === 0 ? rule.to : lifecycle,
    failures
  };
}

function observeS1aLifecycleOracle(policy) {
  const detail = {
    FINDING_ID: S1A_ORACLE_CLOSURE_BODY.findingId,
    WEB_ADMITTED_REVISION: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
    DISPOSITION: S1A_ORACLE_CLOSURE_BODY.disposition,
    VERIFIED_OWNER: 'owner:verified',
    TIMING: 'future-release',
    TRIGGER_OR_REASON: 'reassess on accepted evidence',
    CLOSURE_CRITERION: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
    EXACT_EVIDENCE: [...S1A_ORACLE_CLOSURE_BODY.exactEvidence],
    CANDIDATE_IDENTITY: s1aClone(S1A_ORACLE_CLOSURE_BODY.candidateIdentity),
    closureReadback: s1aClone(S1A_ORACLE_CLOSURE_READBACK)
  };
  const transferDetail = {
    ...detail,
    ...makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY)
  };
  const transferTrustedContext = Object.freeze({
    currentOwnershipReadback: s1aDeepFreeze(s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK))
  });
  const cases = [
    { id: 'lifecycle-defer', event: 'DEFER', expectedLifecycle: 'UNRESOLVED' },
    { id: 'lifecycle-transfer', event: 'TRANSFER', detail: transferDetail,
      trustedContext: transferTrustedContext, expectedLifecycle: 'UNRESOLVED' },
    { id: 'lifecycle-evidence-acquired', event: 'EVIDENCE_ACQUIRED', expectedLifecycle: 'UNRESOLVED' },
    { id: 'lifecycle-verified-closure', event: 'VERIFIED_CLOSURE', expectedLifecycle: 'RESOLVED' }
  ];
  return cases.map((scenario) => {
    const result = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
      scenario.event, scenario.detail || detail, scenario.trustedContext);
    const mismatch = !result.ok || result.lifecycle !== scenario.expectedLifecycle;
    return {
      id: scenario.id,
      expectedOk: true,
      expectedLifecycle: scenario.expectedLifecycle,
      observedOk: result.ok,
      observedLifecycle: result.lifecycle,
      obligation: mismatch
        ? (scenario.expectedLifecycle === 'UNRESOLVED'
          ? 'LIFECYCLE_' + scenario.event + '_MUST_REMAIN_UNRESOLVED'
          : 'LIFECYCLE_VERIFIED_CLOSURE')
        : null,
      failures: result.failures
    };
  });
}

function s1aUniqueEventIndex(trace, event) {
  const indices = [];
  for (let i = 0; i < trace.length; i++) if (trace[i] === event) indices.push(i);
  return indices.length === 1 ? indices[0] : -1;
}

function evaluateS1aEvidenceOnly(policy, input) {
  const rule = policy.evidenceOnly;
  const failures = [];
  if (input.disposition !== 'EVIDENCE_ONLY') failures.push('EVIDENCE_ONLY_DISPOSITION');
  if (input.effect !== rule.effect ||
      input.assertsProductDefect !== rule.assertsProductDefect ||
      input.authorizesProductCorrection !== rule.authorizesProductCorrection) {
    failures.push('EVIDENCE_ONLY_CUSTODY_ONLY');
  }
  if (rule.independentEvidenceGatesRemainBinding !== true) {
    failures.push('EVIDENCE_ONLY_INDEPENDENT_GATES');
  }
  const transition = evaluateS1aTransition(policy, input.disposition, input.lifecycle,
    'EVIDENCE_ACQUIRED', { EXACT_EVIDENCE: input.evidence });
  if (!transition.ok) failures.push(...transition.failures);
  return { ok: failures.length === 0, lifecycle: transition.lifecycle, failures };
}

function observeS1aEvidenceOnlyOracle(policy) {
  const cases = [
    {
      id: 'evidence-only-custody-positive', expected: true, obligation: null,
      input: {
        disposition: 'EVIDENCE_ONLY', effect: 'CUSTODY_ONLY',
        assertsProductDefect: false, authorizesProductCorrection: false,
        lifecycle: 'UNRESOLVED', evidence: ['evidence:custody']
      }
    },
    {
      id: 'evidence-only-product-effect', expected: false,
      obligation: 'EVIDENCE_ONLY_CUSTODY_ONLY',
      input: {
        disposition: 'EVIDENCE_ONLY', effect: 'PRODUCT_EFFECT_ALLOWED',
        assertsProductDefect: true, authorizesProductCorrection: true,
        lifecycle: 'UNRESOLVED', evidence: ['evidence:product-effect']
      }
    },
    {
      id: 'evidence-only-acquisition-resolves', expected: false,
      obligation: 'EVIDENCE_ONLY_UNRESOLVED',
      input: {
        disposition: 'EVIDENCE_ONLY', effect: 'CUSTODY_ONLY',
        assertsProductDefect: false, authorizesProductCorrection: false,
        lifecycle: 'RESOLVED', evidence: ['evidence:premature-resolution']
      }
    }
  ];
  return cases.map((scenario) => {
    const result = evaluateS1aEvidenceOnly(policy, scenario.input);
    return {
      id: scenario.id, expected: scenario.expected, observed: result.ok,
      obligation: result.ok === scenario.expected ? null : (scenario.obligation || result.failures[0] || 'COMPANION_ORACLE_MISMATCH'),
      failures: result.failures
    };
  });
}

function evaluateS1aPostChildReview(policy, input) {
  const rule = policy.postChildReview;
  const failures = [];
  if (rule.trigger !== 'ANY_CHILD_MERGE' && input.trigger !== rule.trigger) {
    failures.push('POST_CHILD_TRIGGER');
  }
  const identity = input.identity || {};
  const integratedReadback = input[rule.integratedIdentityField] || {};
  const integratedProjection = {
    repository: integratedReadback.repository,
    deliveryChildId: integratedReadback.deliveryChildId,
    commit: integratedReadback.commit,
    tree: integratedReadback.tree
  };
  if (!s1aSame(identity, S1A_ORACLE_INTEGRATED_IDENTITY) ||
      !s1aHasExactKeys(integratedReadback, rule.integratedIdentityReadbackFields) ||
      integratedReadback.source !== 'CANONICAL_MERGED_DELIVERY_CHILD_READBACK' ||
      integratedReadback.authoritative !== true || integratedReadback.current !== true ||
      integratedReadback.readBack !== true || integratedReadback.mergeReceiptId !== 'receipt:merge' ||
      !s1aSame(integratedProjection, S1A_ORACLE_INTEGRATED_IDENTITY) ||
      integratedReadback.digest !== s1aHashWithoutField(integratedReadback, 'digest') ||
      integratedReadback.digest !== s1aHashRecord({
        source: integratedReadback.source,
        authoritative: integratedReadback.authoritative,
        current: integratedReadback.current,
        readBack: integratedReadback.readBack,
        ...integratedProjection,
        mergeReceiptId: integratedReadback.mergeReceiptId
      })) {
    failures.push('POST_CHILD_INTEGRATED_IDENTITY');
  }
  const parent = input.parentContract || {};
  if (rule.parentContractMode === 'CURRENT_CANONICAL_AUTHORITATIVE') {
    if (!s1aHasExactKeys(parent, rule.parentContractReadbackFields) ||
        parent.source !== 'CANONICAL_PARENT' || parent.authoritative !== true ||
        parent.current !== true || parent.readBack !== true ||
        parent.repository !== identity.repository ||
        parent.revision !== S1A_ORACLE_PARENT_CONTRACT_REVISION ||
        parent.body !== S1A_ORACLE_PARENT_CONTRACT_BODY ||
        parent.bodyDigest !== S1A_ORACLE_PARENT_CONTRACT_DIGEST ||
        parent.bodyDigest !== s1aHashText(parent.body)) {
      failures.push('POST_CHILD_CURRENT_PARENT_CONTRACT');
    }
  } else if (!s1aPresent(parent.revision)) {
    failures.push('POST_CHILD_PARENT_CONTRACT_MISSING');
  }
  const child = input.childState || {};
  if (child.source !== 'CANONICAL_CHILD' || child.authoritative !== true ||
      child.repository !== identity.repository || child[rule.deliveryChildStateIdentityField] !== identity.deliveryChildId ||
      child[rule.childStateCurrentField] !== rule.childStateMustBeCurrent ||
      child.readBack !== true || !s1aPresent(child.revision) || !s1aPresent(child.stateDigest) ||
      !rule.acceptedChildStates.includes(child.lifecycle) ||
      child.stateDigest !== s1aHashWithoutField(child, 'stateDigest') ||
      !S1A_ORACLE_POST_CHILD_STATES.some((oracle) => s1aSame(child, oracle))) {
    failures.push('POST_CHILD_RELEVANT_CHILD_STATE');
  }
  const reviewRouteAuthority = input[rule.reviewRouteAuthorityField] || {};
  const routeFields = rule.reviewRouteAuthorityFields;
  if (!s1aHasExactKeys(reviewRouteAuthority, routeFields) ||
      !s1aSame(reviewRouteAuthority, S1A_ORACLE_REVIEW_ROUTE_AUTHORITY) ||
      reviewRouteAuthority.source !== 'CURRENT_OWNER_WEB_AUTHORITY' ||
      reviewRouteAuthority.authoritative !== true || reviewRouteAuthority.current !== true ||
      reviewRouteAuthority.readBack !== true ||
      reviewRouteAuthority.digest !== s1aHashWithoutField(reviewRouteAuthority, 'digest') ||
      !Array.isArray(reviewRouteAuthority.routes) ||
      reviewRouteAuthority.routes.length !== rule.reviewSlots.length ||
      reviewRouteAuthority.routes.some((route) => !s1aHasExactKeys(route,
        ['slot', ...rule.reviewRouteFields]) || !s1aPresent(route.provider) ||
        !s1aPresent(route.model) || !s1aPresent(route.reasoning)) ||
      new Set(reviewRouteAuthority.routes.map((route) =>
        [route.provider, route.model, route.reasoning].join('/'))).size !== rule.reviewSlots.length) {
    failures.push('POST_CHILD_REVIEW_ROUTE_AUTHORITY');
  }
  const receiptInventory = input.receiptInventory || {};
  const requiredReceiptIds = child[rule.receiptInventoryField];
  const actualReceiptIds = Array.isArray(input.receipts) ? input.receipts.map((receipt) => receipt.id) : [];
  const inventoryReceiptIds = Array.isArray(receiptInventory.items)
    ? receiptInventory.items.map((receipt) => receipt.id) : [];
  if (receiptInventory.source !== rule.inventorySources.receipts ||
      receiptInventory.authoritative !== true || receiptInventory.complete !== true ||
      !s1aSame(receiptInventory.identity, identity) ||
      !Array.isArray(requiredReceiptIds) || !Array.isArray(input.receipts) ||
      !Array.isArray(receiptInventory.items) ||
      !s1aSame(requiredReceiptIds, S1A_ORACLE_POST_CHILD_RECEIPT_IDS) ||
      !s1aSame(inventoryReceiptIds, S1A_ORACLE_POST_CHILD_RECEIPT_IDS) ||
      !s1aSame(actualReceiptIds, inventoryReceiptIds) ||
      !s1aSame(input.receipts, receiptInventory.items) ||
      receiptInventory.digest !== s1aHashWithoutField(receiptInventory, 'digest') ||
      input.receipts.some((receipt) => receipt.terminal !== true || receipt.readBack !== true ||
        !s1aSame(receipt.identity, identity))) {
    failures.push('POST_CHILD_TERMINAL_RECEIPT_INVENTORY');
  }
  const checkInventory = input.checkInventory || {};
  const requiredCheckIds = child[rule.checkInventoryField];
  const actualCheckIds = Array.isArray(input.checks) ? input.checks.map((check) => check.id) : [];
  const inventoryCheckIds = Array.isArray(checkInventory.items)
    ? checkInventory.items.map((check) => check.id) : [];
  if (checkInventory.source !== rule.inventorySources.checks ||
      checkInventory.authoritative !== true || checkInventory.complete !== true ||
      !s1aSame(checkInventory.identity, identity) ||
      !Array.isArray(requiredCheckIds) || !Array.isArray(input.checks) ||
      !Array.isArray(checkInventory.items) ||
      !s1aSame(requiredCheckIds, S1A_ORACLE_POST_CHILD_CHECK_IDS) ||
      !s1aSame(inventoryCheckIds, S1A_ORACLE_POST_CHILD_CHECK_IDS) ||
      !s1aSame(actualCheckIds, inventoryCheckIds) ||
      !s1aSame(input.checks, checkInventory.items) ||
      checkInventory.digest !== s1aHashWithoutField(checkInventory, 'digest') ||
      input.checks.some((check) => check.applicable !== true || check.terminal !== true ||
        check.readBack !== true || !s1aSame(check.identity, identity))) {
    failures.push('POST_CHILD_APPLICABLE_CHECK_INVENTORY');
  }
  const slots = rule.reviewSlots;
  if (!Array.isArray(input.reviews) || input.reviews.length !== slots.length) {
    failures.push('POST_CHILD_REVIEW_COUNT');
  }
  const snapshots = {
    repository: identity.repository,
    deliveryChildId: identity.deliveryChildId,
    commit: identity.commit,
    tree: identity.tree,
    reviewRouteAuthorityRevision: reviewRouteAuthority.revision,
    reviewRouteAuthorityDigest: reviewRouteAuthority.digest,
    parentContractRevision: parent.revision,
    parentContractDigest: parent.bodyDigest,
    childStateRevision: child.revision,
    childStateDigest: child.stateDigest,
    terminalReceiptIds: requiredReceiptIds,
    applicableIntegratedCheckIds: requiredCheckIds
  };
  const reviewers = new Set();
  const contexts = new Set();
  for (const slot of slots) {
    const reports = (input.reviews || []).filter((review) => review.slot === slot.slot);
    if (reports.length !== 1) {
      failures.push('POST_CHILD_REVIEW_SLOT:' + slot.slot);
      continue;
    }
    const report = reports[0];
    const route = Array.isArray(reviewRouteAuthority.routes)
      ? reviewRouteAuthority.routes.find((item) => item.slot === slot.routeSlot) : null;
    if (report.scope !== slot.scope || report.scope !== rule.scope ||
        report.readOnly !== slot.readOnly || report.readOnly !== rule.readOnly) {
      failures.push('POST_CHILD_REVIEW_SCOPE_OR_MUTATION:' + slot.slot);
    }
    if (report.reportTerminal !== true ||
        rule.reviewerIdentityFields.some((field) =>
          typeof report[field] !== 'string' || report[field].trim().length === 0)) {
      failures.push('POST_CHILD_REVIEW_NOT_TERMINAL_OR_INDEPENDENT:' + slot.slot);
    }
    if (!route || rule.reviewRouteFields.some((field) => report[field] !== route[field])) {
      failures.push('POST_CHILD_REVIEW_ROUTE_MISMATCH:' + slot.slot);
    }
    reviewers.add(report.reviewerId);
    contexts.add(report.contextId);
    for (const field of rule.sameSnapshotFields) {
      if (!s1aSame(report[field], snapshots[field])) {
        failures.push('POST_CHILD_SNAPSHOT_MISMATCH:' + field);
      }
    }
  }
  if (reviewers.size !== slots.length || contexts.size !== slots.length) {
    failures.push('POST_CHILD_REVIEWS_NOT_INDEPENDENT');
  }

  const trace = input.trace;
  if (!Array.isArray(trace) || new Set(trace).size !== trace.length) {
    return { ok: false, failures: failures.concat(['POST_CHILD_EVENT_TRACE_AMBIGUOUS']) };
  }
  const allowedEvents = [...rule.trace.requiredEvents, ...rule.trace.peerVisibilityEvents];
  if (trace.some((event) => !allowedEvents.includes(event))) {
    failures.push('POST_CHILD_EVENT_TRACE_UNKNOWN');
  }
  const eventIndex = new Map();
  for (const event of trace) {
    const index = s1aUniqueEventIndex(trace, event);
    eventIndex.set(event, index);
  }
  for (const event of rule.trace.requiredEvents) {
    if (!eventIndex.has(event)) failures.push('POST_CHILD_EVENT_MISSING:' + event);
  }
  const startEvents = slots.map((slot) => 'REVIEW_' + slot.slot + '_STARTED');
  for (const before of rule.trace.reviewStartsAfter) {
    for (const after of startEvents) {
      if (!(eventIndex.get(before) < eventIndex.get(after))) {
        failures.push('POST_CHILD_INPUT_ORDER:' + before + ':' + after);
      }
    }
  }
  const reportEvents = slots.map((slot) => 'REPORT_' + slot.slot + '_TERMINAL');
  if (rule.trace.bothReviewsStartBeforeAnyReport && startEvents.length > 1) {
    const lastStart = Math.max(...startEvents.map((event) => eventIndex.get(event) ?? -1));
    const firstReport = Math.min(...reportEvents.map((event) => eventIndex.get(event) ?? -1));
    if (lastStart < 0 || firstReport < 0 || lastStart >= firstReport) {
      failures.push('POST_CHILD_REVIEWS_NOT_PARALLEL');
    }
  }
  const terminalReports = reportEvents.map((event) => eventIndex.get(event) ?? -1);
  const bothReportsTerminal = terminalReports.length > 0 && terminalReports.every((index) => index >= 0);
  const bothTerminalAt = bothReportsTerminal ? Math.max(...terminalReports) : -1;
  const firstTerminalAt = bothReportsTerminal ? Math.min(...terminalReports) : -1;
  for (const event of rule.trace.peerVisibilityEvents) {
    const at = eventIndex.get(event);
    if (at === undefined) continue;
    if (rule.blindUntil === 'NEVER' ||
        (rule.blindUntil === 'BOTH_REPORTS_TERMINAL' && (!bothReportsTerminal || at < bothTerminalAt)) ||
        (rule.blindUntil === 'FIRST_REPORT_TERMINAL' && (!bothReportsTerminal || at < firstTerminalAt))) {
      failures.push('POST_CHILD_MUTUAL_BLINDNESS');
    }
  }
  for (const [readbackEvent, terminalEvent] of rule.trace.terminalReadbackPrecedes) {
    if (!(eventIndex.get(readbackEvent) < eventIndex.get(terminalEvent))) {
      failures.push('POST_CHILD_TERMINAL_READBACK_ORDER:' + readbackEvent + ':' + terminalEvent);
    }
  }
  const adjudicationAt = eventIndex.get('WEB_ADJUDICATION') ?? -1;
  for (const event of rule.trace.adjudicationAfter) {
    if (!(eventIndex.get(event) < adjudicationAt)) {
      failures.push('POST_CHILD_ADJUDICATION_ORDER:' + event);
    }
  }
  return { ok: failures.length === 0, failures, frontierEffect: rule.frontierEffect };
}
function s1aHashWithoutField(value, field) {
  const body = { ...value };
  delete body[field];
  return s1aHashRecord(body);
}

function makeS1aInventory(source, identity, items) {
  const inventory = {
    source,
    authoritative: true,
    complete: true,
    identity: s1aClone(identity),
    items: s1aClone(items)
  };
  inventory.digest = s1aHashRecord(inventory);
  return inventory;
}

const S1A_ORACLE_POST_CHILD_RECEIPTS = Object.freeze([
  Object.freeze({ id: 'receipt:merge', terminal: true, readBack: true, identity: S1A_ORACLE_INTEGRATED_IDENTITY }),
  Object.freeze({ id: 'receipt:child-terminal', terminal: true, readBack: true, identity: S1A_ORACLE_INTEGRATED_IDENTITY })
]);
const S1A_ORACLE_POST_CHILD_CHECKS = Object.freeze([
  Object.freeze({ id: 'check:integration', applicable: true, terminal: true, readBack: true, identity: S1A_ORACLE_INTEGRATED_IDENTITY }),
  Object.freeze({ id: 'check:policy', applicable: true, terminal: true, readBack: true, identity: S1A_ORACLE_INTEGRATED_IDENTITY })
]);
const S1A_ORACLE_POST_CHILD_RECEIPT_INVENTORY = Object.freeze(makeS1aInventory(
  'CANONICAL_TERMINAL_OBJECT_RECEIPT_READBACK',
  S1A_ORACLE_INTEGRATED_IDENTITY, S1A_ORACLE_POST_CHILD_RECEIPTS));
const S1A_ORACLE_POST_CHILD_CHECK_INVENTORY = Object.freeze(makeS1aInventory(
  'CANONICAL_APPLICABLE_INTEGRATED_CHECK_READBACK',
  S1A_ORACLE_INTEGRATED_IDENTITY, S1A_ORACLE_POST_CHILD_CHECKS));
const S1A_ORACLE_POST_CHILD_STATE_CORE = Object.freeze({
  source: 'CANONICAL_CHILD',
  authoritative: true,
  current: true,
  readBack: true,
  repository: S1A_ORACLE_INTEGRATED_IDENTITY.repository,
  childId: S1A_ORACLE_INTEGRATED_IDENTITY.deliveryChildId,
  lifecycle: 'CURRENT',
  revision: 'child:revision-12',
  terminalReceiptIds: Object.freeze(S1A_ORACLE_POST_CHILD_RECEIPTS.map((receipt) => receipt.id)),
  applicableIntegratedCheckIds: Object.freeze(S1A_ORACLE_POST_CHILD_CHECKS.map((check) => check.id))
});
const S1A_ORACLE_POST_CHILD_STATE = Object.freeze({
  ...S1A_ORACLE_POST_CHILD_STATE_CORE,
  stateDigest: s1aHashRecord(S1A_ORACLE_POST_CHILD_STATE_CORE)
});
const S1A_ORACLE_POST_CHILD_COMPLETED_STATE_CORE = Object.freeze({
  ...S1A_ORACLE_POST_CHILD_STATE_CORE,
  lifecycle: 'COMPLETED',
  revision: 'child:revision-13'
});
const S1A_ORACLE_POST_CHILD_COMPLETED_STATE = Object.freeze({
  ...S1A_ORACLE_POST_CHILD_COMPLETED_STATE_CORE,
  stateDigest: s1aHashRecord(S1A_ORACLE_POST_CHILD_COMPLETED_STATE_CORE)
});
const S1A_ORACLE_POST_CHILD_STATES = Object.freeze([
  S1A_ORACLE_POST_CHILD_STATE,
  S1A_ORACLE_POST_CHILD_COMPLETED_STATE
]);
function makeS1aReviewFixture() {
  const identity = s1aClone(S1A_ORACLE_INTEGRATED_IDENTITY);
  const integratedIdentityReadback = {
    source: 'CANONICAL_MERGED_DELIVERY_CHILD_READBACK',
    authoritative: true,
    current: true,
    readBack: true,
    ...s1aClone(identity),
    mergeReceiptId: 'receipt:merge'
  };
  integratedIdentityReadback.digest = s1aHashRecord(integratedIdentityReadback);
  const parentContract = {
    source: 'CANONICAL_PARENT', authoritative: true, current: true, readBack: true,
    repository: identity.repository,
    revision: S1A_ORACLE_PARENT_CONTRACT_REVISION,
    body: S1A_ORACLE_PARENT_CONTRACT_BODY,
    bodyDigest: S1A_ORACLE_PARENT_CONTRACT_DIGEST
  };
  const reviewRouteAuthority = s1aClone(S1A_ORACLE_REVIEW_ROUTE_AUTHORITY);
  const receipts = s1aClone(S1A_ORACLE_POST_CHILD_RECEIPTS);
  const checks = s1aClone(S1A_ORACLE_POST_CHILD_CHECKS);
  const receiptInventory = s1aClone(S1A_ORACLE_POST_CHILD_RECEIPT_INVENTORY);
  const checkInventory = s1aClone(S1A_ORACLE_POST_CHILD_CHECK_INVENTORY);
  const childState = s1aClone(S1A_ORACLE_POST_CHILD_STATE);
  const snapshot = {
    repository: identity.repository,
    deliveryChildId: identity.deliveryChildId,
    commit: identity.commit,
    tree: identity.tree,
    reviewRouteAuthorityRevision: reviewRouteAuthority.revision,
    reviewRouteAuthorityDigest: reviewRouteAuthority.digest,
    parentContractRevision: parentContract.revision,
    parentContractDigest: parentContract.bodyDigest,
    childStateRevision: childState.revision,
    childStateDigest: childState.stateDigest,
    terminalReceiptIds: [...childState.terminalReceiptIds],
    applicableIntegratedCheckIds: [...childState.applicableIntegratedCheckIds]
  };
  const reviews = ['A', 'B'].map((slot) => {
    const route = reviewRouteAuthority.routes.find((item) => item.slot === slot);
    return {
      slot,
      reviewerId: 'reviewer:' + slot,
      contextId: 'context:' + slot,
      provider: route.provider,
      model: route.model,
      reasoning: route.reasoning,
      scope: 'WHOLE_PROGRAMME',
      readOnly: true,
      reportTerminal: true,
      ...s1aClone(snapshot)
    };
  });
  const trace = [
    'FINAL_DELIVERY_CHILD_MERGED',
    'INTEGRATED_IDENTITY_READ_BACK',
    'CURRENT_PARENT_CONTRACT_READ_BACK',
    'CURRENT_CHILD_STATE_READ_BACK',
    'REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK',
    'APPLICABLE_CHECK_MEMBERSHIP_READ_BACK',
    'MERGE_TRIGGERED_CI_STARTED',
    'REVIEW_A_STARTED',
    'REVIEW_B_STARTED',
    'REPORT_A_TERMINAL',
    'REPORT_B_TERMINAL',
    'TERMINAL_RECEIPTS_READ_BACK',
    'TERMINAL_RECEIPTS_TERMINAL',
    'APPLICABLE_CHECKS_READ_BACK',
    'APPLICABLE_CHECKS_TERMINAL',
    'WEB_ADJUDICATION'
  ];
  return {
    trigger: 'FINAL_DELIVERY_CHILD_MERGE',
    identity,
    integratedIdentityReadback,
    parentContract,
    reviewRouteAuthority,
    childState,
    receiptInventory,
    checkInventory,
    reviews,
    receipts,
    checks,
    trace
  };
}
function observeS1aPostChildOracle(policy) {
  const cases = [
    { id: 'post-child-complete-positive', expected: true, build: () => makeS1aReviewFixture() },
    { id: 'post-child-missing-terminal-receipt', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.receipts.pop();
      return input;
    } },
    { id: 'post-child-missing-applicable-check', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.checks.pop();
      return input;
    } },
    { id: 'post-child-applicable-check-not-read-back', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.checks[0].readBack = false;
      input.checkInventory.items[0].readBack = false;
      input.checkInventory.digest = s1aHashWithoutField(input.checkInventory, 'digest');
      return input;
    } },
    { id: 'post-child-co-omission-from-authoritative-inventory', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.childState.terminalReceiptIds.pop();
      input.childState.applicableIntegratedCheckIds.pop();
      input.receipts.pop();
      input.checks.pop();
      input.reviews.forEach((review) => {
        review.terminalReceiptIds.pop();
        review.applicableIntegratedCheckIds.pop();
      });
      input.childState.stateDigest = s1aHashWithoutField(input.childState, 'stateDigest');
      input.reviews.forEach((review) => { review.childStateDigest = input.childState.stateDigest; });
      return input;
    } },
    { id: 'post-child-stale-child-state-digest', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.childState.lifecycle = 'COMPLETED';
      return input;
    } },
    { id: 'post-child-receipt-membership-after-review-start', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      const at = input.trace.indexOf('REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK');
      input.trace.splice(at, 1);
      input.trace.splice(input.trace.indexOf('REVIEW_A_STARTED') + 1, 0, 'REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK');
      return input;
    } },
    { id: 'post-child-terminal-receipts-after-web', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      const readAt = input.trace.indexOf('TERMINAL_RECEIPTS_READ_BACK');
      const terminalAt = input.trace.indexOf('TERMINAL_RECEIPTS_TERMINAL');
      input.trace.splice(terminalAt, 1);
      input.trace.splice(readAt, 1);
      input.trace.push('TERMINAL_RECEIPTS_READ_BACK', 'TERMINAL_RECEIPTS_TERMINAL');
      return input;
    } },
    { id: 'post-child-terminal-check-readback-order', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      const readAt = input.trace.indexOf('APPLICABLE_CHECKS_READ_BACK');
      input.trace.splice(readAt, 1);
      const terminalAt = input.trace.indexOf('APPLICABLE_CHECKS_TERMINAL');
      input.trace.splice(terminalAt + 1, 0, 'APPLICABLE_CHECKS_READ_BACK');
      return input;
    } },
    { id: 'post-child-one-report', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.reviews = [input.reviews[0]];
      input.trace = input.trace.filter((event) =>
        event !== 'REVIEW_B_STARTED' && event !== 'REPORT_B_TERMINAL');
      return input;
    } },
    { id: 'post-child-peer-visible-early', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      const at = input.trace.indexOf('REPORT_A_TERMINAL');
      input.trace.splice(at + 1, 0, 'REPORT_A_VISIBLE_TO_B');
      return input;
    } },
    { id: 'post-child-web-before-check-terminal', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      const at = input.trace.indexOf('WEB_ADJUDICATION');
      input.trace.splice(at, 1);
      input.trace.splice(input.trace.indexOf('APPLICABLE_CHECKS_TERMINAL'), 0, 'WEB_ADJUDICATION');
      return input;
    } },
    { id: 'post-child-noncurrent-parent', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.parentContract.source = 'child-body';
      input.parentContract.authoritative = false;
      input.parentContract.current = false;
      return input;
    } },
    { id: 'post-child-parent-digest-does-not-hash-readback-bytes', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.parentContract.bodyDigest = 'sha256:unverified-arbitrary';
      input.reviews.forEach((review) => {
        review.parentContractDigest = input.parentContract.bodyDigest;
      });
      return input;
    } },
    { id: 'post-child-coherently-replaced-parent-body', expected: false, build: () => {
      const input = makeS1aReviewFixture();
      input.parentContract.body = s1aCanonical({
        schema: 'toolkit.s1a.current-parent-contract.v1',
        repository: input.identity.repository,
        revision: input.parentContract.revision,
        companionHistoryDigest: 'sha256:rewritten-history-anchor'
      });
      input.parentContract.bodyDigest = s1aHashText(input.parentContract.body);
      input.reviews.forEach((review) => {
        review.parentContractDigest = input.parentContract.bodyDigest;
      });
      return input;
    } },
    ...S1A_ORACLE_REVIEW_SNAPSHOT_FIELDS.map((field) => ({
      id: 'post-child-snapshot-' + field,
      expected: false,
      build: () => {
        const input = makeS1aReviewFixture();
        const review = input.reviews[0];
        if (Array.isArray(review[field])) review[field].pop();
        else review[field] = 'stale:' + field;
        return input;
      }
    }))
  ];
  return cases.map((scenario) => {
    const result = evaluateS1aPostChildReview(policy, scenario.build());
    return {
      id: scenario.id,
      expected: scenario.expected,
      observed: result.ok,
      obligation: scenario.expected === result.ok ? null : scenario.id.toUpperCase(),
      failures: result.failures
    };
  });
}

// Fixed carrier inventories and evidence model authoritative external readbacks.
// These source-policy vectors do not execute production code or qualify a runtime carrier.
const S1A_ORACLE_CARRIER_INVENTORY_SOURCE = 'CURRENT_OWNER_WEB_CARRIER_INVENTORY';
const S1A_ORACLE_CARRIER_RECONCILIATION_SOURCE = 'CURRENT_OWNER_WEB_CARRIER_RECONCILIATION';
const S1A_ORACLE_CARRIER_PROVISIONING_SOURCE = 'CURRENT_OWNER_WEB_PROVISIONING_AUTHORITY';
const S1A_ORACLE_BOUNDARY_EVIDENCE_SOURCE = 'INDEPENDENTLY_BOUND_ACCEPTED_BOUNDARY_EVIDENCE';
const S1A_ORACLE_CARRIER_REPOSITORY = 'weijunswj/ai-agent-toolkit';
const S1A_ORACLE_CARRIER_CANDIDATE = Object.freeze({ commit: 'carrier:commit-8', tree: 'carrier:tree-8' });
const S1A_ORACLE_CARRIER_CRITERIA = Object.freeze(['criterion:accepted-boundary', 'criterion:public-validation']);
const S1A_ORACLE_CARRIER_SELECTION_ORDER = Object.freeze(['LOCAL_DEV', 'AUTHORIZED_EXISTING_OWNER', 'NEW_OWNER_PROVISIONED']);
const S1A_ORACLE_CARRIER_INVENTORY_FIELDS = Object.freeze([
  'source', 'authoritative', 'current', 'complete', 'readBack', 'repository', 'revision',
  'criterion', 'candidateIdentity', 'records', 'digest'
]);
const S1A_ORACLE_CARRIER_RECORD_FIELDS = Object.freeze([
  'carrierId', 'identity', 'executionSubstrate', 'available', 'authorized', 'ownerProvisioned',
  'faithful', 'actualPath', 'acceptedExecutionPath', 'enforcementBoundary', 'reconciliation', 'provisioning'
]);
const S1A_ORACLE_CARRIER_RECONCILIATION_FIELDS = Object.freeze([
  'source', 'authoritative', 'current', 'complete', 'readBack', 'inventoryRevision',
  'carrierId', 'identity', 'actualPath', 'suitability', 'necessity', 'digest'
]);
const S1A_ORACLE_CARRIER_INVENTORY_POLICY = Object.freeze({
  mode: 'CURRENT_AUTHORITATIVE_COMPLETE_READBACK',
  inputField: 'authoritativeInventory',
  source: S1A_ORACLE_CARRIER_INVENTORY_SOURCE,
  requiredFields: Object.freeze([...S1A_ORACLE_CARRIER_INVENTORY_FIELDS]),
  recordFields: Object.freeze([...S1A_ORACLE_CARRIER_RECORD_FIELDS]),
  reconciliationFields: Object.freeze([...S1A_ORACLE_CARRIER_RECONCILIATION_FIELDS]),
  localFirstWhenFaithful: true,
  reconcileExistingBeforeProvisioning: true,
  provisionOnlyAfterNecessityProven: true,
  requestCannotChangeInventory: true
});
const S1A_ORACLE_CARRIER_BOUNDARY_POLICY = Object.freeze({
  mode: 'INDEPENDENTLY_BOUND_TERMINAL_EXECUTION_EVIDENCE',
  evidenceInputField: 'acceptedBoundaryEvidence',
  carrierIdentityField: 'identity',
  acceptedCarrierIds: S1A_ORACLE_CARRIER_SELECTION_ORDER,
  readbackFields: Object.freeze([
    'source', 'authoritative', 'current', 'complete', 'readBack', 'repository',
    'acceptedCriterion', 'carrierId', 'carrierIdentity', 'actualPath', 'candidateIdentity',
    'enforcementBoundary', 'run', 'receipt', 'digest'
  ]),
  requiredFields: Object.freeze([
    'receiptId', 'acceptedCriterion', 'carrierId', 'carrierIdentity', 'candidateIdentity',
    'boundaryId', 'enforcementBoundary', 'actualPath', 'executionPath', 'outcome', 'terminal', 'evidenceRef',
    'runId', 'runEvents', 'executionEvidenceDigest', 'receiptDigest'
  ]),
  acceptedExecutionPath: 'ACCEPTED_PRODUCTION_PATH',
  acceptedOutcome: 'BOUNDARY_EXERCISED',
  requiredRunEvents: S1A_ORACLE_BOUNDARY_RUN_EVENTS
});
const S1A_ORACLE_PUBLIC_REQUEST_MATCH_FIELDS = Object.freeze([
  'consumer', 'protocol', 'path', 'hostnameRequired', 'hostname', 'lifetime', 'cleanup', 'necessity'
]);
const S1A_ORACLE_PUBLIC_REQUEST = Object.freeze({
  criterion: 'criterion:public-validation', exposure: 'PUBLIC',
  consumer: 'external-validation-client', protocol: 'https', path: '/accepted-boundary',
  hostnameRequired: true, hostname: 'validation.example.test',
  necessity: 'REQUIRED_BY_ACCEPTED_CRITERION', audience: 'named-test-audience',
  boundary: 'named-public-ingress', lifetime: 'until-validation-completes',
  cleanup: 'cleanup:remove-public-ingress'
});
const S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_OWNER_WEB_AUTHORITY', authoritative: true, current: true, readBack: true,
  authorityReference: 'authority:public-ingress:5',
  ...S1A_ORACLE_PUBLIC_REQUEST,
  requiredOperations: Object.freeze(['DOMAIN_REGISTRATION', 'DNS_CONFIGURATION'])
});
const S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY = Object.freeze({
  ...S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY_CORE,
  digest: s1aHashRecord(S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY_CORE)
});
const S1A_ORACLE_DOMAIN_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_OWNER_WEB_AUTHORITY', authoritative: true, current: true, readBack: true,
  authorityReference: 'authority:domain-registration:8',
  exposureReference: S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY.authorityReference,
  operation: 'DOMAIN_REGISTRATION', target: S1A_ORACLE_PUBLIC_REQUEST.hostname
});
const S1A_ORACLE_DOMAIN_AUTHORITY = Object.freeze({
  ...S1A_ORACLE_DOMAIN_AUTHORITY_CORE, digest: s1aHashRecord(S1A_ORACLE_DOMAIN_AUTHORITY_CORE)
});
const S1A_ORACLE_DNS_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_OWNER_WEB_AUTHORITY', authoritative: true, current: true, readBack: true,
  authorityReference: 'authority:dns-configuration:9',
  exposureReference: S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY.authorityReference,
  operation: 'DNS_CONFIGURATION', target: S1A_ORACLE_PUBLIC_REQUEST.hostname
});
const S1A_ORACLE_DNS_AUTHORITY = Object.freeze({
  ...S1A_ORACLE_DNS_AUTHORITY_CORE, digest: s1aHashRecord(S1A_ORACLE_DNS_AUTHORITY_CORE)
});
const S1A_ORACLE_PUBLIC_AUTHORITY_POLICY = Object.freeze({
  mode: 'CURRENT_OWNER_WEB_AUTHORITY_READBACK', inputField: 'exposureAuthority',
  requestField: 'publicExposureRequest',
  requestMatchFields: S1A_ORACLE_PUBLIC_REQUEST_MATCH_FIELDS,
  source: 'CURRENT_OWNER_WEB_AUTHORITY',
  requiredFields: Object.freeze([
    'source', 'authoritative', 'current', 'readBack', 'authorityReference', 'criterion',
    'exposure', 'consumer', 'protocol', 'path', 'hostnameRequired', 'hostname', 'audience',
    'boundary', 'lifetime', 'cleanup', 'necessity', 'requiredOperations', 'digest'
  ]),
  digestMode: 'SHA256_CANONICAL_AUTHORITY_READBACK', exposureValue: 'PUBLIC'
});
const S1A_ORACLE_DOMAIN_DNS_POLICY = Object.freeze({
  requiredOperationsField: 'requiredOperations', domainInputField: 'domainAuthority',
  dnsInputField: 'dnsAuthority',
  requiredFields: Object.freeze(['source', 'authoritative', 'current', 'readBack', 'authorityReference',
    'exposureReference', 'operation', 'target', 'digest']),
  domainOperation: 'DOMAIN_REGISTRATION', dnsOperation: 'DNS_CONFIGURATION',
  referencesMustDiffer: true, eachReferenceMustDifferFromExposure: true
});
const S1A_ORACLE_PUBLIC_EXPOSURE_REQUIRES = Object.freeze([
  'ACCEPTED_CRITERION', 'EXPLICIT_EXPOSURE_AUTHORITY', 'CONSUMER', 'PROTOCOL', 'PATH',
  'HOSTNAME', 'NECESSITY', 'AUDIENCE', 'BOUNDARY', 'LIFETIME', 'CLEANUP'
]);
const S1A_ORACLE_CARRIER_POLICY = Object.freeze({
  inventory: S1A_ORACLE_CARRIER_INVENTORY_POLICY,
  selectionOrder: S1A_ORACLE_CARRIER_SELECTION_ORDER,
  defaultExposure: 'PRIVATE_NONPUBLIC',
  acceptedBoundaryId: 'ACCEPTED_PRODUCTION_BOUNDARY',
  faithfulnessRule: 'EXERCISED_ACCEPTED_BOUNDARY',
  boundaryExercise: S1A_ORACLE_CARRIER_BOUNDARY_POLICY,
  publicExposureRequires: S1A_ORACLE_PUBLIC_EXPOSURE_REQUIRES,
  domainDnsRequiresSeparateAuthority: true,
  persistenceImpliesExposure: false,
  publicExposureAuthority: S1A_ORACLE_PUBLIC_AUTHORITY_POLICY,
  domainDnsAuthority: S1A_ORACLE_DOMAIN_DNS_POLICY
});

function makeS1aOracleCarrierReconciliation(inventoryRevision, carrierId, identity, actualPath, suitability, necessity) {
  const core = {
    source: S1A_ORACLE_CARRIER_RECONCILIATION_SOURCE,
    authoritative: true, current: true, complete: true, readBack: true,
    inventoryRevision, carrierId, identity, actualPath, suitability, necessity
  };
  return { ...core, digest: s1aHashRecord(core) };
}

function makeS1aOracleCarrierRecord(carrierId, inventoryRevision, profile) {
  const defaults = {
    LOCAL_DEV: {
      identity: 'carrier-identity:local-dev-8', executionSubstrate: 'LOCAL_PROCESS',
      actualPath: 'workspace-local-dev-path', ownerProvisioned: false,
      acceptedExecutionPath: 'ACCEPTED_PRODUCTION_PATH', enforcementBoundary: 'ACCEPTED_PRODUCTION_BOUNDARY'
    },
    AUTHORIZED_EXISTING_OWNER: {
      identity: 'carrier-identity:owner-existing-8', executionSubstrate: 'OWNER_AUTHORISED_EXECUTION_SUBSTRATE',
      actualPath: 'owner-existing-validation-path', ownerProvisioned: false,
      acceptedExecutionPath: 'ACCEPTED_PRODUCTION_PATH', enforcementBoundary: 'ACCEPTED_PRODUCTION_BOUNDARY'
    },
    NEW_OWNER_PROVISIONED: {
      identity: 'carrier-identity:owner-provisioned-8', executionSubstrate: 'OWNER_PROVISIONED_EXECUTION_SUBSTRATE',
      actualPath: 'owner-provisioned-validation-path', ownerProvisioned: true,
      acceptedExecutionPath: 'ACCEPTED_PRODUCTION_PATH', enforcementBoundary: 'ACCEPTED_PRODUCTION_BOUNDARY'
    }
  }[carrierId];
  const state = profile[carrierId];
  let reconciliation = null;
  let provisioning = null;
  if (carrierId === 'AUTHORIZED_EXISTING_OWNER') {
    reconciliation = makeS1aOracleCarrierReconciliation(inventoryRevision, carrierId,
      defaults.identity, defaults.actualPath,
      state.available && state.authorized && state.faithful ? 'FAITHFUL' : 'UNSUITABLE',
      'RECONCILED_EXISTING_OWNER_INFRASTRUCTURE');
  } else if (carrierId === 'NEW_OWNER_PROVISIONED') {
    reconciliation = makeS1aOracleCarrierReconciliation(inventoryRevision, carrierId,
      defaults.identity, defaults.actualPath, 'NO_SUITABLE_EXISTING_CARRIER',
      'PROVEN_NO_SUITABLE_EXISTING_CARRIER');
    const provisionCore = {
      source: S1A_ORACLE_CARRIER_PROVISIONING_SOURCE,
      authoritative: true, current: true, complete: true, readBack: true,
      authorityReference: 'authority:carrier-provisioning:8', inventoryRevision,
      carrierId, identity: defaults.identity, actualPath: defaults.actualPath,
      necessity: 'PROVEN_NO_SUITABLE_EXISTING_CARRIER'
    };
    provisioning = { ...provisionCore, digest: s1aHashRecord(provisionCore) };
  }
  return {
    carrierId, identity: defaults.identity, executionSubstrate: defaults.executionSubstrate,
    available: state.available, authorized: state.authorized, ownerProvisioned: defaults.ownerProvisioned,
    faithful: state.faithful, actualPath: defaults.actualPath,
    acceptedExecutionPath: defaults.acceptedExecutionPath,
    enforcementBoundary: defaults.enforcementBoundary, reconciliation, provisioning
  };
}

function makeS1aOracleCarrierInventory(profileName, criterion, candidateIdentity = S1A_ORACLE_CARRIER_CANDIDATE) {
  const profiles = {
    local: {
      LOCAL_DEV: { available: true, authorized: true, faithful: true },
      AUTHORIZED_EXISTING_OWNER: { available: true, authorized: true, faithful: true },
      NEW_OWNER_PROVISIONED: { available: false, authorized: false, faithful: false }
    },
    existing: {
      LOCAL_DEV: { available: false, authorized: false, faithful: false },
      AUTHORIZED_EXISTING_OWNER: { available: true, authorized: true, faithful: true },
      NEW_OWNER_PROVISIONED: { available: false, authorized: false, faithful: false }
    },
    provisioned: {
      LOCAL_DEV: { available: false, authorized: false, faithful: false },
      AUTHORIZED_EXISTING_OWNER: { available: false, authorized: false, faithful: false },
      NEW_OWNER_PROVISIONED: { available: true, authorized: true, faithful: true }
    }
  };
  const profile = profiles[profileName];
  if (!profile) throw new Error('unknown fixed carrier inventory profile ' + profileName);
  const revision = 'carrier-inventory:' + profileName + ':' + criterion + ':8';
  const core = {
    source: S1A_ORACLE_CARRIER_INVENTORY_SOURCE,
    authoritative: true, current: true, complete: true, readBack: true,
    repository: S1A_ORACLE_CARRIER_REPOSITORY, revision, criterion,
    candidateIdentity: s1aClone(candidateIdentity),
    records: S1A_ORACLE_CARRIER_SELECTION_ORDER.map((carrierId) =>
      makeS1aOracleCarrierRecord(carrierId, revision, profile))
  };
  return { ...core, digest: s1aHashRecord(core) };
}
const S1A_ORACLE_CARRIER_INVENTORIES = Object.freeze(
  ['local', 'existing', 'provisioned'].flatMap((profile) => S1A_ORACLE_CARRIER_CRITERIA.map((criterion) =>
    Object.freeze(makeS1aOracleCarrierInventory(profile, criterion)))));

function makeS1aOracleBoundaryEvidence(inventory, carrier) {
  const runId = 'run:oracle:' + inventory.revision + ':' + carrier.carrierId;
  const receiptId = 'receipt:oracle:' + inventory.revision + ':' + carrier.carrierId;
  const runEvents = [...S1A_ORACLE_BOUNDARY_RUN_EVENTS];
  const evidenceCore = {
    runId, acceptedCriterion: inventory.criterion, carrierId: carrier.carrierId,
    carrierIdentity: carrier.identity, actualPath: carrier.actualPath,
    candidateIdentity: s1aClone(inventory.candidateIdentity),
    enforcementBoundary: carrier.enforcementBoundary,
    boundaryId: carrier.enforcementBoundary, executionPath: carrier.acceptedExecutionPath,
    outcome: 'BOUNDARY_EXERCISED', runEvents, terminal: true
  };
  const executionEvidenceDigest = s1aHashRecord(evidenceCore);
  const run = { ...evidenceCore, executionEvidenceDigest };
  const receiptCore = {
    receiptId, acceptedCriterion: inventory.criterion, carrierId: carrier.carrierId,
    carrierIdentity: carrier.identity, candidateIdentity: s1aClone(inventory.candidateIdentity),
    boundaryId: carrier.enforcementBoundary, enforcementBoundary: carrier.enforcementBoundary,
    actualPath: carrier.actualPath, executionPath: carrier.acceptedExecutionPath, outcome: 'BOUNDARY_EXERCISED',
    terminal: true, evidenceRef: 'execution-evidence:' + executionEvidenceDigest,
    runId, runEvents, executionEvidenceDigest
  };
  const receipt = { ...receiptCore, receiptDigest: s1aHashRecord(receiptCore) };
  const readbackCore = {
    source: S1A_ORACLE_BOUNDARY_EVIDENCE_SOURCE,
    authoritative: true, current: true, complete: true, readBack: true,
    repository: inventory.repository, acceptedCriterion: inventory.criterion,
    carrierId: carrier.carrierId, carrierIdentity: carrier.identity,
    actualPath: carrier.actualPath, candidateIdentity: s1aClone(inventory.candidateIdentity),
    enforcementBoundary: carrier.enforcementBoundary, run, receipt
  };
  return { ...readbackCore, digest: s1aHashRecord(readbackCore) };
}
const S1A_ORACLE_BOUNDARY_EVIDENCE_READBACKS = Object.freeze(S1A_ORACLE_CARRIER_INVENTORIES.flatMap((inventory) =>
  inventory.records.filter((carrier) => carrier.available && carrier.authorized && carrier.faithful)
    .map((carrier) => Object.freeze(makeS1aOracleBoundaryEvidence(inventory, carrier)))));

function setS1aCarrierEvidence(input, carrierId) {
  const inventory = input.authoritativeInventory;
  const carrier = inventory.records.find((record) => record.carrierId === carrierId);
  const evidence = S1A_ORACLE_BOUNDARY_EVIDENCE_READBACKS.find((candidate) =>
    candidate.acceptedCriterion === input.criterion && candidate.carrierId === carrierId &&
    candidate.actualPath === (carrier && carrier.actualPath) &&
    s1aSame(candidate.candidateIdentity, input.candidateIdentity) &&
    candidate.run.runId.includes(inventory.revision));
  if (!evidence) throw new Error('missing fixed accepted boundary vector for ' + carrierId);
  input.acceptedBoundaryEvidence = s1aClone(evidence);
}

function s1aCarrierReconciliationIsCurrent(record, inventory) {
  const readback = record.reconciliation;
  if (!s1aHasExactKeys(readback, S1A_ORACLE_CARRIER_RECONCILIATION_FIELDS) ||
      readback.source !== S1A_ORACLE_CARRIER_RECONCILIATION_SOURCE ||
      readback.authoritative !== true || readback.current !== true ||
      readback.complete !== true || readback.readBack !== true ||
      readback.inventoryRevision !== inventory.revision || readback.carrierId !== record.carrierId ||
      readback.identity !== record.identity || readback.actualPath !== record.actualPath ||
      readback.digest !== s1aHashWithoutField(readback, 'digest')) return false;
  if (record.carrierId === 'AUTHORIZED_EXISTING_OWNER') {
    return readback.suitability === 'FAITHFUL' &&
      readback.necessity === 'RECONCILED_EXISTING_OWNER_INFRASTRUCTURE';
  }
  if (record.carrierId === 'NEW_OWNER_PROVISIONED') {
    return readback.suitability === 'NO_SUITABLE_EXISTING_CARRIER' &&
      readback.necessity === 'PROVEN_NO_SUITABLE_EXISTING_CARRIER';
  }
  return false;
}

function s1aCarrierProvisioningIsAuthorised(record, inventory) {
  const proof = record.provisioning;
  const expectedFields = [
    'source', 'authoritative', 'current', 'complete', 'readBack', 'authorityReference',
    'inventoryRevision', 'carrierId', 'identity', 'actualPath', 'necessity', 'digest'
  ];
  return s1aHasExactKeys(proof, expectedFields) &&
    proof.source === S1A_ORACLE_CARRIER_PROVISIONING_SOURCE &&
    proof.authoritative === true && proof.current === true && proof.complete === true &&
    proof.readBack === true && proof.authorityReference === 'authority:carrier-provisioning:8' &&
    proof.inventoryRevision === inventory.revision && proof.carrierId === record.carrierId &&
    proof.identity === record.identity && proof.actualPath === record.actualPath &&
    proof.necessity === 'PROVEN_NO_SUITABLE_EXISTING_CARRIER' &&
    proof.digest === s1aHashWithoutField(proof, 'digest');
}

function s1aCarrierExecutionEvidenceIsBound(input, inventory, carrier, rule) {
  const readback = input[rule.boundaryExercise.evidenceInputField];
  const expected = S1A_ORACLE_BOUNDARY_EVIDENCE_READBACKS.filter((candidate) =>
    candidate.acceptedCriterion === inventory.criterion && candidate.carrierId === carrier.carrierId &&
    candidate.actualPath === carrier.actualPath && s1aSame(candidate.candidateIdentity, inventory.candidateIdentity) &&
    candidate.run.runId.includes(inventory.revision));
  if (expected.length !== 1 || !s1aHasExactKeys(readback, rule.boundaryExercise.readbackFields) ||
      !s1aSame(readback, expected[0]) || readback.source !== S1A_ORACLE_BOUNDARY_EVIDENCE_SOURCE ||
      readback.authoritative !== true || readback.current !== true || readback.complete !== true ||
      readback.readBack !== true || readback.repository !== inventory.repository ||
      readback.acceptedCriterion !== inventory.criterion || readback.carrierId !== carrier.carrierId ||
      readback.carrierIdentity !== carrier.identity || readback.actualPath !== carrier.actualPath ||
      !s1aSame(readback.candidateIdentity, inventory.candidateIdentity) ||
      readback.enforcementBoundary !== carrier.enforcementBoundary ||
      readback.digest !== s1aHashWithoutField(readback, 'digest')) return false;
  const receipt = readback.receipt;
  const run = readback.run;
  if (!s1aHasExactKeys(receipt, rule.boundaryExercise.requiredFields) ||
      !s1aHasExactKeys(run, [
        'runId', 'acceptedCriterion', 'carrierId', 'carrierIdentity', 'actualPath',
        'candidateIdentity', 'enforcementBoundary', 'boundaryId', 'executionPath',
        'outcome', 'runEvents', 'terminal', 'executionEvidenceDigest'
      ]) ||
      receipt.carrierId !== carrier.carrierId || receipt.carrierIdentity !== carrier.identity ||
      receipt.actualPath !== carrier.actualPath || receipt.acceptedCriterion !== inventory.criterion ||
      !s1aSame(receipt.candidateIdentity, inventory.candidateIdentity) ||
      receipt.boundaryId !== rule.acceptedBoundaryId || receipt.executionPath !== carrier.acceptedExecutionPath ||
      receipt.enforcementBoundary !== carrier.enforcementBoundary || receipt.outcome !== rule.boundaryExercise.acceptedOutcome ||
      receipt.terminal !== true || receipt.runId !== run.runId ||
      !s1aSame(receipt.runEvents, rule.boundaryExercise.requiredRunEvents) ||
      receipt.executionEvidenceDigest !== run.executionEvidenceDigest ||
      receipt.evidenceRef !== 'execution-evidence:' + run.executionEvidenceDigest ||
      receipt.receiptDigest !== s1aHashWithoutField(receipt, 'receiptDigest')) return false;
  const runCore = Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'executionEvidenceDigest'));
  return run.acceptedCriterion === inventory.criterion && run.carrierId === carrier.carrierId &&
    run.carrierIdentity === carrier.identity && run.actualPath === carrier.actualPath &&
    run.enforcementBoundary === carrier.enforcementBoundary && run.boundaryId === rule.acceptedBoundaryId &&
    run.executionPath === carrier.acceptedExecutionPath &&
    run.outcome === rule.boundaryExercise.acceptedOutcome && run.terminal === true &&
    s1aSame(run.candidateIdentity, inventory.candidateIdentity) &&
    s1aSame(run.runEvents, rule.boundaryExercise.requiredRunEvents) &&
    run.executionEvidenceDigest === s1aHashRecord(runCore);
}

function s1aPublicExposureRequestAuthorityMatches(rule, input, criterion) {
  const request = input && input[rule.publicExposureAuthority.requestField];
  const authority = input && input[rule.publicExposureAuthority.inputField];
  const requestFields = [
    'criterion', 'exposure', 'consumer', 'protocol', 'path', 'hostnameRequired', 'hostname',
    'necessity', 'audience', 'boundary', 'lifetime', 'cleanup'
  ];
  return s1aHasExactKeys(request, requestFields) && s1aSame(request, S1A_ORACLE_PUBLIC_REQUEST) &&
    s1aHasExactKeys(authority, rule.publicExposureAuthority.requiredFields) &&
    s1aSame(authority, S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY) &&
    authority.source === rule.publicExposureAuthority.source && authority.authoritative === true &&
    authority.current === true && authority.readBack === true && authority.criterion === criterion &&
    authority.exposure === rule.publicExposureAuthority.exposureValue &&
    Array.isArray(input.acceptedCriteria) && input.acceptedCriteria.includes(criterion) &&
    request.criterion === criterion && request.exposure === authority.exposure &&
    rule.publicExposureAuthority.requestMatchFields.every((field) => request[field] === authority[field]) &&
    request.audience === authority.audience && request.boundary === authority.boundary &&
    request.necessity === authority.necessity && authority.necessity === 'REQUIRED_BY_ACCEPTED_CRITERION' &&
    authority.digest === s1aHashWithoutField(authority, 'digest');
}

function s1aPublicExposureIsAuthorised(rule, input, criterion) {
  if (!s1aPublicExposureRequestAuthorityMatches(rule, input, criterion)) return false;
  const authority = input[rule.publicExposureAuthority.inputField];
  if (!Array.isArray(authority.requiredOperations)) return false;
  const operations = new Set(authority.requiredOperations);
  if (operations.size !== authority.requiredOperations.length ||
      [...operations].some((operation) => !['DOMAIN_REGISTRATION', 'DNS_CONFIGURATION'].includes(operation))) return false;
  if (!operations.size) return true;
  const dnsRule = rule.domainDnsAuthority;
  const domain = input[dnsRule.domainInputField];
  const dns = input[dnsRule.dnsInputField];
  const validOperation = (value, expected, operation) =>
    s1aHasExactKeys(value, dnsRule.requiredFields) && s1aSame(value, expected) &&
    value.source === authority.source && value.authoritative === true && value.current === true &&
    value.readBack === true && value.exposureReference === authority.authorityReference &&
    value.operation === operation && value.target === authority.hostname &&
    value.digest === s1aHashWithoutField(value, 'digest');
  const needsDomain = operations.has(dnsRule.domainOperation);
  const needsDns = operations.has(dnsRule.dnsOperation);
  return (!needsDomain || validOperation(domain, S1A_ORACLE_DOMAIN_AUTHORITY, dnsRule.domainOperation)) &&
    (!needsDns || validOperation(dns, S1A_ORACLE_DNS_AUTHORITY, dnsRule.dnsOperation)) &&
    (!needsDomain || !needsDns || domain.authorityReference !== dns.authorityReference) &&
    (!needsDomain || domain.authorityReference !== authority.authorityReference) &&
    (!needsDns || dns.authorityReference !== authority.authorityReference);
}

function evaluateS1aCarrier(policy, input) {
  const rule = policy && policy.faithfulCarrier ? policy.faithfulCarrier : {};
  const violations = [];
  const fail = (id) => { if (!violations.includes(id)) violations.push(id); };
  if (!s1aSame(rule.inventory, S1A_ORACLE_CARRIER_INVENTORY_POLICY) ||
      !s1aSame(rule.selectionOrder, S1A_ORACLE_CARRIER_SELECTION_ORDER)) {
    fail('CARRIER_AUTHORITATIVE_INVENTORY_ORDER');
  }
  if (!s1aSame(rule.boundaryExercise, S1A_ORACLE_CARRIER_BOUNDARY_POLICY) ||
      rule.acceptedBoundaryId !== S1A_ORACLE_CARRIER_POLICY.acceptedBoundaryId ||
      rule.faithfulnessRule !== S1A_ORACLE_CARRIER_POLICY.faithfulnessRule) {
    fail('CARRIER_EXECUTION_EVIDENCE_BINDING');
  }
  if (!s1aSame(rule.publicExposureRequires, S1A_ORACLE_PUBLIC_EXPOSURE_REQUIRES) ||
      !s1aSame(rule.publicExposureAuthority, S1A_ORACLE_PUBLIC_AUTHORITY_POLICY)) {
    fail('CARRIER_PUBLIC_AUTHORITY_MATCH');
  }
  if (rule.domainDnsRequiresSeparateAuthority !== true ||
      !s1aSame(rule.domainDnsAuthority, S1A_ORACLE_DOMAIN_DNS_POLICY)) {
    fail('CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY');
  }
  if (rule.defaultExposure !== 'PRIVATE_NONPUBLIC' || rule.persistenceImpliesExposure !== false) {
    fail('CARRIER_PRIVATE_PERSISTENCE');
  }
  const inventory = input && input.authoritativeInventory;
  const fixedInventory = S1A_ORACLE_CARRIER_INVENTORIES.find((candidate) => s1aSame(candidate, inventory));
  if (!fixedInventory || !s1aHasExactKeys(inventory, S1A_ORACLE_CARRIER_INVENTORY_FIELDS) ||
      inventory.source !== S1A_ORACLE_CARRIER_INVENTORY_SOURCE || inventory.authoritative !== true ||
      inventory.current !== true || inventory.complete !== true || inventory.readBack !== true ||
      inventory.repository !== S1A_ORACLE_CARRIER_REPOSITORY ||
      inventory.digest !== s1aHashWithoutField(inventory, 'digest')) {
    fail('CARRIER_AUTHORITATIVE_INVENTORY_READBACK');
  }
  const criterion = input && input.criterion;
  if (!fixedInventory || !S1A_ORACLE_CARRIER_CRITERIA.includes(criterion) ||
      inventory.criterion !== criterion || !s1aSame(inventory.candidateIdentity, S1A_ORACLE_CARRIER_CANDIDATE) ||
      !s1aSame(input.candidateIdentity, inventory.candidateIdentity) ||
      !Array.isArray(input.acceptedCriteria) || !input.acceptedCriteria.includes(criterion)) {
    fail('CARRIER_INVENTORY_CANDIDATE_CRITERION_BINDING');
  }
  let exposure = 'PRIVATE_NONPUBLIC';
  const request = input && input.publicExposureRequest;
  const requestedExposure = input && input.requestedExposure ||
    (request && request.exposure) || S1A_ORACLE_CARRIER_POLICY.defaultExposure;
  if (requestedExposure === 'PUBLIC') {
    exposure = 'PUBLIC';
    if (!s1aPublicExposureIsAuthorised(rule, input, criterion)) {
      fail(s1aPublicExposureRequestAuthorityMatches(rule, input, criterion)
        ? 'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY' : 'CARRIER_PUBLIC_AUTHORITY_MATCH');
    }
  } else if (requestedExposure !== 'PRIVATE_NONPUBLIC') {
    fail('CARRIER_PRIVATE_PERSISTENCE');
  } else if (request && request.exposure === 'PUBLIC') {
    fail('CARRIER_PUBLIC_AUTHORITY_MATCH');
  }
  let selected = null;
  if (fixedInventory && Array.isArray(inventory.records)) {
    for (const carrierId of S1A_ORACLE_CARRIER_SELECTION_ORDER) {
      const record = inventory.records.find((entry) => entry.carrierId === carrierId);
      if (!record || !record.available || !record.authorized || !record.faithful ||
          !s1aHasExactKeys(record, S1A_ORACLE_CARRIER_RECORD_FIELDS) ||
          record.executionSubstrate === 'LOCAL_PROCESS' && record.ownerProvisioned !== false) continue;
      if (carrierId === 'AUTHORIZED_EXISTING_OWNER' &&
          (!s1aCarrierReconciliationIsCurrent(record, inventory) || record.ownerProvisioned !== false)) continue;
      if (carrierId === 'NEW_OWNER_PROVISIONED') {
        const suitableExisting = inventory.records.some((candidate) =>
          candidate.carrierId !== 'NEW_OWNER_PROVISIONED' && candidate.available === true &&
          candidate.authorized === true && candidate.faithful === true);
        if (suitableExisting || !s1aCarrierReconciliationIsCurrent(record, inventory) ||
            !s1aCarrierProvisioningIsAuthorised(record, inventory) || record.ownerProvisioned !== true) continue;
      }
      if (record.acceptedExecutionPath !== S1A_ORACLE_CARRIER_BOUNDARY_POLICY.acceptedExecutionPath ||
          record.enforcementBoundary !== S1A_ORACLE_CARRIER_POLICY.acceptedBoundaryId) continue;
      selected = record;
      break;
    }
  }
  if (!selected) fail('CARRIER_INVENTORY_ORDER_OR_PROVISIONING');
  else if (!s1aCarrierExecutionEvidenceIsBound(input, inventory, selected, S1A_ORACLE_CARRIER_POLICY)) {
    fail('CARRIER_EXECUTION_EVIDENCE_BINDING');
    selected = null;
  }
  return {
    ok: violations.length === 0, selected: selected ? selected.carrierId : 'HOLD',
    exposure, failures: violations
  };
}

function observeS1aCarrierSource(source, input, claimedDigest = s1aGovernedHumanPolicyDigest(source)) {
  const policy = s1aInterpretPolicyContract(source);
  const result = evaluateS1aCarrier(policy, input);
  result.governedProseDigest = claimedDigest;
  result.violatedObligationIds = result.failures;
  for (const id of s1aCarrierProseViolations(source)) {
    if (!result.violatedObligationIds.includes(id)) result.violatedObligationIds.push(id);
  }
  result.failures = result.violatedObligationIds;
  result.ok = result.violatedObligationIds.length === 0;
  if (!result.ok && result.selected !== 'HOLD') result.selected = 'HOLD';
  return result;
}

function makeS1aCarrierFixture(profileName = 'local', criterion = 'criterion:accepted-boundary') {
  const authoritativeInventory = s1aClone(makeS1aOracleCarrierInventory(profileName, criterion));
  const input = {
    persistent: true, criterion, acceptedCriteria: [criterion],
    candidateIdentity: s1aClone(S1A_ORACLE_CARRIER_CANDIDATE),
    authoritativeInventory,
    options: { LOCAL_DEV: { available: true, authorized: true, claimedEquivalent: true } }
  };
  const selected = authoritativeInventory.records.find((record) =>
    record.available && record.authorized && record.faithful);
  if (selected) setS1aCarrierEvidence(input, selected.carrierId);
  return input;
}

function makeS1aAuthorizedPublicCarrierFixture() {
  const input = makeS1aCarrierFixture('local', 'criterion:public-validation');
  input.requestedExposure = 'PUBLIC';
  input.publicExposureRequest = s1aClone(S1A_ORACLE_PUBLIC_REQUEST);
  input.exposureAuthority = s1aClone(S1A_ORACLE_PUBLIC_EXPOSURE_AUTHORITY);
  input.domainAuthority = s1aClone(S1A_ORACLE_DOMAIN_AUTHORITY);
  input.dnsAuthority = s1aClone(S1A_ORACLE_DNS_AUTHORITY);
  return input;
}


const S1A_ORACLE_CONTINUATION_AUTHORITY_SOURCE = 'CURRENT_OWNER_WEB_BOUNDED_EPISODE_AUTHORITY';
const S1A_ORACLE_CONTINUATION_EFFECT_SOURCE = 'CURRENT_OWNER_EFFECT_RECONCILIATION_READBACK';
const S1A_ORACLE_CONTINUATION_PATH_SOURCE = 'CURRENT_OWNER_FAITHFUL_PATH_INVENTORY';
const S1A_ORACLE_CONTINUATION_REPOSITORY = 'weijunswj/ai-agent-toolkit';
const S1A_ORACLE_CONTINUATION_BOUNDARY_FIELDS = Object.freeze([
  'repository', 'webAuthorityIdentity', 'webAuthorityRevision', 'webAuthorityContent',
  'episodeId', 'episodeKind', 'runId', 'lockId', 'authorityReference', 'rootFamilyId',
  'acceptedContractId', 'trustModelId', 'scopeId', 'assuranceFloorId', 'evidenceBoundaryId'
]);
const S1A_ORACLE_CONTINUATION_EPISODE_FIELDS = Object.freeze([
  'repository', 'webAuthorityIdentity', 'webAuthorityRevision', 'webAuthorityContent',
  'episodeId', 'episodeKind', 'runId', 'lockId', 'authorityReference', 'primaryOwner',
  'source', 'authoritative', 'current', 'readBack', 'explicitWebBound', 'digest',
  'rootFamilyId', 'acceptedContractId', 'trustModelId', 'scopeId', 'assuranceFloorId',
  'evidenceBoundaryId'
]);
function s1aDeepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) s1aDeepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
function s1aCanonicalContinuationEffects(value) {
  if (!value || !Array.isArray(value.effects)) return value;
  const core = { ...value, effects: [...value.effects].sort((a, b) => String(a.effectId).localeCompare(String(b.effectId))) };
  delete core.digest;
  return { ...core, digest: s1aHashRecord(core) };
}
const S1A_ORACLE_CONTINUATION_SCENARIO_SPECS = s1aDeepFreeze({
  G3_RUN_LOCK_TOOLKIT: {
    episodeKind: 'G3_RUN_LOCK', primaryOwner: 'TOOLKIT', episodeId: 'episode:g3-toolkit-7',
    authorityReference: 'authority:web:g3-toolkit-7', webAuthorityIdentity: 'web-authority:g3-toolkit',
    webAuthorityRevision: 'revision:g3-toolkit-7', webAuthorityContent: 'accepted g3 toolkit evidence authority',
    rootFamilyId: 'root:g3-toolkit', acceptedContractId: 'contract:g2:g3-toolkit',
    trustModelId: 'trust:g3-toolkit', scopeId: 'scope:g3-toolkit', assuranceFloorId: 'floor:g3-toolkit',
    evidenceBoundaryId: 'boundary:g3-toolkit', runId: 'run:g3-toolkit-7', lockId: 'lock:g3-toolkit-7',
    candidateCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    candidateTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    parentCommit: 'cccccccccccccccccccccccccccccccccccccccc',
    baseCommit: 'dddddddddddddddddddddddddddddddddddddddd',
    evidenceId: 'evidence:g3-toolkit-7', priorRunId: 'run:g3-toolkit-prior',
    priorWorkerId: 'worker:g3-toolkit-prior', priorBranch: 'branch:g3-toolkit-prior',
    priorMechanism: 'prior-g3-toolkit-mechanism', mechanism: 'toolkit-validation',
    attemptState: { attemptCount: 4, attemptLimit: 5, productCorrectionAttempts: 2, productCorrectionLimit: 3, budgetConsumed: 7, budgetLimit: 10 },
    effectToken: 'g3-toolkit-7', pathToken: 'g3-toolkit-7',
    permittedEffect: 'CONTINUE_IDENTITY_PRESERVING_EVIDENCE'
  },
  PARENT_OWNED_LIGHT_HARNESS: {
    episodeKind: 'PARENT_OWNED_LIGHT', primaryOwner: 'HARNESS', episodeId: 'episode:light-harness-3',
    authorityReference: 'authority:parent-light:harness-3', webAuthorityIdentity: 'web-authority:parent-light-harness',
    webAuthorityRevision: 'revision:parent-light-3', webAuthorityContent: 'parent-owned light operation authority',
    rootFamilyId: 'root:light-harness', acceptedContractId: 'contract:g2:light-harness',
    trustModelId: 'trust:light-harness', scopeId: 'scope:light-harness', assuranceFloorId: 'floor:light-harness',
    evidenceBoundaryId: 'boundary:light-harness', runId: 'run:light-harness-3', lockId: 'lock:light-harness-3',
    parentOwnershipReadback: { source: 'CURRENT_PARENT_OWNER_LIGHT_READBACK', repository: 'weijunswj/ai-agent-toolkit', parentId: 'programme:421', operationId: 'light:harness-3', owner: 'HARNESS', current: true, readBack: true },
    candidateCommit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    candidateTree: 'ffffffffffffffffffffffffffffffffffffffff',
    parentCommit: '1111111111111111111111111111111111111111',
    baseCommit: '2222222222222222222222222222222222222222',
    evidenceId: 'evidence:light-harness-3', priorRunId: 'run:light-harness-prior',
    priorWorkerId: 'worker:light-harness-prior', priorBranch: 'branch:light-harness-prior',
    priorMechanism: 'prior-light-harness-mechanism', mechanism: 'harness-validation',
    attemptState: { attemptCount: 2, attemptLimit: 4, productCorrectionAttempts: 0, productCorrectionLimit: 1, budgetConsumed: 2, budgetLimit: 6 },
    effectToken: 'light-harness-3', pathToken: 'light-harness-3',
    permittedEffect: 'CONTINUE_PARENT_OWNED_LIGHT_EVIDENCE'
  },
  OTHER_WEB_BOUNDED_EVIDENCE_EPISODE_TOOLKIT: {
    episodeKind: 'OTHER_WEB_BOUNDED_EVIDENCE_EPISODE', primaryOwner: 'TOOLKIT', episodeId: 'episode:web-evidence-toolkit-2',
    authorityReference: 'authority:web:evidence-toolkit-2', webAuthorityIdentity: 'web-authority:evidence-toolkit',
    webAuthorityRevision: 'revision:evidence-toolkit-2', webAuthorityContent: 'other accepted web-bounded evidence authority',
    rootFamilyId: 'root:evidence-toolkit', acceptedContractId: 'contract:g2:evidence-toolkit',
    trustModelId: 'trust:evidence-toolkit', scopeId: 'scope:evidence-toolkit', assuranceFloorId: 'floor:evidence-toolkit',
    evidenceBoundaryId: 'boundary:evidence-toolkit', runId: 'run:evidence-toolkit-2', lockId: 'lock:evidence-toolkit-2',
    candidateCommit: '3333333333333333333333333333333333333333',
    candidateTree: '4444444444444444444444444444444444444444',
    parentCommit: '5555555555555555555555555555555555555555',
    baseCommit: '6666666666666666666666666666666666666666',
    evidenceId: 'evidence:web-evidence-toolkit-2', priorRunId: 'run:evidence-toolkit-prior',
    priorWorkerId: 'worker:evidence-toolkit-prior', priorBranch: 'branch:evidence-toolkit-prior',
    priorMechanism: 'prior-evidence-toolkit-mechanism', mechanism: 'toolkit-evidence-readback',
    attemptState: { attemptCount: 1, attemptLimit: 3, productCorrectionAttempts: 1, productCorrectionLimit: 2, budgetConsumed: 3, budgetLimit: 7 },
    effectToken: 'evidence-toolkit-2', pathToken: 'evidence-toolkit-2',
    permittedEffect: 'CONTINUE_ACCEPTED_WEB_BOUNDED_EVIDENCE'
  },
  G3_RUN_LOCK_HARNESS: {
    episodeKind: 'G3_RUN_LOCK', primaryOwner: 'HARNESS', episodeId: 'episode:g3-harness-5',
    authorityReference: 'authority:web:g3-harness-5', webAuthorityIdentity: 'web-authority:g3-harness',
    webAuthorityRevision: 'revision:g3-harness-5', webAuthorityContent: 'accepted g3 harness evidence authority',
    rootFamilyId: 'root:g3-harness', acceptedContractId: 'contract:g2:g3-harness',
    trustModelId: 'trust:g3-harness', scopeId: 'scope:g3-harness', assuranceFloorId: 'floor:g3-harness',
    evidenceBoundaryId: 'boundary:g3-harness', runId: 'run:g3-harness-5', lockId: 'lock:g3-harness-5',
    candidateCommit: '7777777777777777777777777777777777777777',
    candidateTree: '8888888888888888888888888888888888888888',
    parentCommit: '9999999999999999999999999999999999999999',
    baseCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
    evidenceId: 'evidence:g3-harness-5', priorRunId: 'run:g3-harness-prior',
    priorWorkerId: 'worker:g3-harness-prior', priorBranch: 'branch:g3-harness-prior',
    priorMechanism: 'prior-g3-harness-mechanism', mechanism: 'harness-validation',
    attemptState: { attemptCount: 3, attemptLimit: 5, productCorrectionAttempts: 1, productCorrectionLimit: 2, budgetConsumed: 4, budgetLimit: 8 },
    effectToken: 'g3-harness-5', pathToken: 'g3-harness-5',
    permittedEffect: 'CONTINUE_G3_HARNESS_EVIDENCE'
  },
  G3_RUN_LOCK_ENVIRONMENT: {
    episodeKind: 'G3_RUN_LOCK', primaryOwner: 'ENVIRONMENT', episodeId: 'episode:g3-environment-6',
    authorityReference: 'authority:web:g3-environment-6', webAuthorityIdentity: 'web-authority:g3-environment',
    webAuthorityRevision: 'revision:g3-environment-6', webAuthorityContent: 'accepted g3 environment evidence authority',
    rootFamilyId: 'root:g3-environment', acceptedContractId: 'contract:g2:g3-environment',
    trustModelId: 'trust:g3-environment', scopeId: 'scope:g3-environment', assuranceFloorId: 'floor:g3-environment',
    evidenceBoundaryId: 'boundary:g3-environment', runId: 'run:g3-environment-6', lockId: 'lock:g3-environment-6',
    candidateCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    candidateTree: 'cccccccccccccccccccccccccccccccccccccccc',
    parentCommit: 'dddddddddddddddddddddddddddddddddddddddd',
    baseCommit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    evidenceId: 'evidence:g3-environment-6', priorRunId: 'run:g3-environment-prior',
    priorWorkerId: 'worker:g3-environment-prior', priorBranch: 'branch:g3-environment-prior',
    priorMechanism: 'prior-g3-environment-mechanism', mechanism: 'environment-validation',
    attemptState: { attemptCount: 2, attemptLimit: 4, productCorrectionAttempts: 1, productCorrectionLimit: 2, budgetConsumed: 5, budgetLimit: 8 },
    effectToken: 'g3-environment-6', pathToken: 'g3-environment-6',
    permittedEffect: 'CONTINUE_G3_ENVIRONMENT_EVIDENCE'
  },
  OWNER_ACCEPTED_CARRIER_EVIDENCE_REPLAY: {
    episodeKind: 'OWNER_ACCEPTED_CARRIER_EVIDENCE_REPLAY', primaryOwner: 'VALIDATION_CARRIER',
    episodeId: 'episode:carrier-validation-4', authorityReference: 'authority:web:carrier-validation-4',
    webAuthorityIdentity: 'web-authority:carrier-validation', webAuthorityRevision: 'revision:carrier-4',
    webAuthorityContent: 'accepted validation carrier evidence authority',
    rootFamilyId: 'root:carrier-validation', acceptedContractId: 'contract:g2:carrier-validation',
    trustModelId: 'trust:carrier-validation', scopeId: 'scope:carrier-validation',
    assuranceFloorId: 'floor:carrier-validation', evidenceBoundaryId: 'boundary:carrier-validation',
    runId: 'run:carrier-validation-4', lockId: 'lock:carrier-validation-4',
    candidateCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbc',
    candidateTree: 'cccccccccccccccccccccccccccccccccccccccd',
    parentCommit: 'ddddddddddddddddddddddddddddddddddddddde',
    baseCommit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeef',
    evidenceId: 'evidence:carrier-validation-4', priorRunId: 'run:carrier-prior',
    priorWorkerId: 'worker:carrier-prior', priorBranch: 'branch:carrier-prior',
    priorMechanism: 'prior-carrier-validation-mechanism', mechanism: 'carrier-readback',
    attemptState: { attemptCount: 1, attemptLimit: 4, productCorrectionAttempts: 0, productCorrectionLimit: 2, budgetConsumed: 3, budgetLimit: 9 },
    effectToken: 'carrier-validation-4', pathToken: 'carrier-validation-4',
    permittedEffect: 'CONTINUE_VALIDATION_CARRIER_EVIDENCE'
  },
  WEB_BOUNDED_TRANSPORT: {
    episodeKind: 'OTHER_WEB_BOUNDED_EVIDENCE_EPISODE', primaryOwner: 'TRANSPORT',
    episodeId: 'episode:web-transport-8', authorityReference: 'authority:web:transport-8',
    webAuthorityIdentity: 'web-authority:transport', webAuthorityRevision: 'revision:transport-8',
    webAuthorityContent: 'accepted web-bounded transport evidence authority',
    rootFamilyId: 'root:transport', acceptedContractId: 'contract:g2:transport',
    trustModelId: 'trust:transport', scopeId: 'scope:transport', assuranceFloorId: 'floor:transport',
    evidenceBoundaryId: 'boundary:transport', runId: 'run:transport-8', lockId: 'lock:transport-8',
    candidateCommit: 'ffffffffffffffffffffffffffffffffffffffff',
    candidateTree: '0000000000000000000000000000000000000000',
    parentCommit: '1111111111111111111111111111111111111111',
    baseCommit: '2222222222222222222222222222222222222222',
    evidenceId: 'evidence:transport-8', priorRunId: 'run:transport-prior',
    priorWorkerId: 'worker:transport-prior', priorBranch: 'branch:transport-prior',
    priorMechanism: 'prior-transport-mechanism', mechanism: 'transport-validation',
    attemptState: { attemptCount: 2, attemptLimit: 3, productCorrectionAttempts: 0, productCorrectionLimit: 1, budgetConsumed: 1, budgetLimit: 5 },
    effectToken: 'transport-8', pathToken: 'transport-8',
    permittedEffect: 'CONTINUE_WEB_BOUNDED_TRANSPORT_EVIDENCE'
  }
});
function s1aMakeAcceptedContinuationEpisodeAuthority(spec) {
  return s1aSignedReadback({
    repository: S1A_ORACLE_CONTINUATION_REPOSITORY,
    webAuthorityIdentity: spec.webAuthorityIdentity,
    webAuthorityRevision: spec.webAuthorityRevision,
    webAuthorityContent: spec.webAuthorityContent,
    episodeId: spec.episodeId,
    episodeKind: spec.episodeKind,
    runId: spec.runId,
    lockId: spec.lockId,
    authorityReference: spec.authorityReference,
    primaryOwner: spec.primaryOwner,
    source: S1A_ORACLE_CONTINUATION_AUTHORITY_SOURCE,
    authoritative: true, current: true, readBack: true, explicitWebBound: true,
    rootFamilyId: spec.rootFamilyId, acceptedContractId: spec.acceptedContractId,
    trustModelId: spec.trustModelId, scopeId: spec.scopeId,
    assuranceFloorId: spec.assuranceFloorId, evidenceBoundaryId: spec.evidenceBoundaryId
  });
}
function s1aBuildContinuationScenario(key, spec) {
  const episodeAuthority = s1aMakeAcceptedContinuationEpisodeAuthority(spec);
  const candidateIdentity = { commit: spec.candidateCommit, tree: spec.candidateTree };
  const evidenceIdentity = {
    evidenceId: spec.evidenceId, digest: 'evidence-digest:' + spec.evidenceId,
    candidateIdentity
  };
  const acceptedBoundary = s1aSignedReadback({
    source: 'CURRENT_ACCEPTED_G2_BOUNDARY_READBACK', authoritative: true, current: true, readBack: true,
    repository: S1A_ORACLE_CONTINUATION_REPOSITORY,
    webAuthorityIdentity: spec.webAuthorityIdentity, webAuthorityRevision: spec.webAuthorityRevision,
    webAuthorityContent: spec.webAuthorityContent, episodeId: spec.episodeId,
    episodeKind: spec.episodeKind, runId: spec.runId, lockId: spec.lockId,
    authorityReference: spec.authorityReference, rootFamilyId: spec.rootFamilyId,
    acceptedContractId: spec.acceptedContractId, trustModelId: spec.trustModelId,
    scopeId: spec.scopeId, assuranceFloorId: spec.assuranceFloorId, evidenceBoundaryId: spec.evidenceBoundaryId
  });
  const currentFailureSignature = {
    rootFamilyId: spec.rootFamilyId,
    unresolvedBlockerIds: ['blocker:' + spec.pathToken],
    primaryOwner: spec.primaryOwner, failedMechanism: spec.mechanism,
    effectClass: 'NO_PRODUCT_EFFECT', evidenceBoundaryId: spec.evidenceBoundaryId,
    runId: spec.runId, workerId: 'worker:' + spec.pathToken, branch: 'branch:' + spec.pathToken,
    candidateIdentity, episodeId: spec.episodeId
  };
  const history = [{
    outcome: 'PROGRESSED',
    signature: {
      ...currentFailureSignature, failedMechanism: spec.priorMechanism,
      runId: spec.priorRunId, workerId: spec.priorWorkerId, branch: spec.priorBranch,
      candidateIdentity: { commit: spec.parentCommit, tree: spec.baseCommit },
      episodeId: 'episode:prior:' + spec.pathToken
    }
  }];
  const effectReconciliation = s1aCanonicalContinuationEffects({
    source: S1A_ORACLE_CONTINUATION_EFFECT_SOURCE,
    authoritative: true, current: true, complete: true, readBack: true,
    effects: [
      { effectId: 'effect:' + spec.effectToken + ':run', state: 'RECONCILED', evidenceRef: 'effect-evidence:' + spec.effectToken + ':run' },
      { effectId: 'effect:' + spec.effectToken + ':owner', state: 'RECONCILED', evidenceRef: 'effect-evidence:' + spec.effectToken + ':owner' }
    ]
  });
  const faithfulPathInventory = s1aSignedReadback({
    source: S1A_ORACLE_CONTINUATION_PATH_SOURCE,
    authoritative: true, current: true, complete: true, readBack: true,
    paths: [{
      pathId: 'path:' + spec.pathToken, faithful: true, available: true,
      actualPath: 'accepted-validation-path/' + spec.pathToken,
      evidenceRef: 'path-evidence:' + spec.pathToken,
      evidenceBoundaryId: spec.evidenceBoundaryId, candidateIdentity
    }]
  });
  const currentStateReadback = s1aSignedReadback({
    source: 'CURRENT_ACCEPTED_G2_CONTINUATION_STATE_READBACK',
    authoritative: true, current: true, complete: true, readBack: true,
    episodeId: spec.episodeId, acceptedEpisodeAuthority: episodeAuthority,
    candidateIdentity, evidenceIdentity, attemptState: spec.attemptState,
    currentFailureSignature, history, effectReconciliation,
    faithfulPathInventoryDigest: faithfulPathInventory.digest
  });
  const attributionReadback = s1aSignedReadback({
    source: 'CURRENT_CAUSAL_ATTRIBUTION_READBACK',
    repository: S1A_ORACLE_CONTINUATION_REPOSITORY,
    episodeId: spec.episodeId, candidateIdentity, evidenceIdentity,
    primaryOwner: spec.primaryOwner, correctionMechanism: spec.mechanism,
    productSemanticsProvenBad: 'NO', authoritative: true, current: true, complete: true, readBack: true
  });
  const currentAuthority = s1aSignedReadback({
    source: 'CURRENT_WEB_AUTHORITY_AND_EPISODE_READBACK',
    authoritative: true, current: true, complete: true, readBack: true,
    repository: S1A_ORACLE_CONTINUATION_REPOSITORY,
    webAuthorityIdentity: spec.webAuthorityIdentity, webAuthorityRevision: spec.webAuthorityRevision,
    webAuthorityContent: spec.webAuthorityContent, episodeAuthority,
    runId: spec.runId, lockId: spec.lockId, replacementPermission: null,
    eligibleOwner: spec.primaryOwner, correctionMechanism: spec.mechanism,
    predecessorCandidate: null, replacementCandidate: null,
    pathEffectCeiling: { paths: ['accepted-validation-path/' + spec.pathToken], effects: [spec.permittedEffect] },
    revalidationBoundary: spec.evidenceBoundaryId,
    lifetime: { notBefore: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', observedAt: '2026-09-29T00:00:00Z' },
    currentness: { current: true, revoked: false, superseded: false },
    permissionConsumption: { state: 'NOT_GRANTED', usesRemaining: 0 },
    permittedEffect: spec.permittedEffect
  });
  const candidateReadback = s1aSignedReadback({
    source: 'POLICY_TEST_MODEL_INDEPENDENT_CANDIDATE_READBACK',
    authoritative: true, current: true, complete: true, readBack: true,
    repository: S1A_ORACLE_CONTINUATION_REPOSITORY, kind: 'HOSTED', objectFormat: 'sha1',
    identity: candidateIdentity, commit: candidateIdentity.commit, head: candidateIdentity.commit,
    tree: candidateIdentity.tree, orderedParents: [spec.parentCommit], baseCommit: spec.baseCommit,
    commitTreeReadback: {
      source: 'POLICY_TEST_MODEL_GIT_READBACK', repository: S1A_ORACLE_CONTINUATION_REPOSITORY,
      objectFormat: 'sha1', commit: candidateIdentity.commit, tree: candidateIdentity.tree,
      orderedParents: [spec.parentCommit], readBack: true
    },
    lineage: {
      repository: S1A_ORACLE_CONTINUATION_REPOSITORY, episodeId: spec.episodeId,
      runId: spec.runId, lockId: spec.lockId, predecessorCommit: spec.parentCommit,
      baseCommit: spec.baseCommit, orderedParents: [spec.parentCommit]
    },
    hostedBinding: {
      repository: S1A_ORACLE_CONTINUATION_REPOSITORY, prNumber: 495,
      branch: 'codex/s1a-increment1-web-law-shipping', headSha: candidateIdentity.commit,
      baseCommit: spec.baseCommit, readBack: true
    },
    localCustodyBinding: null,
    observedMutationScope: { paths: ['accepted-validation-path/' + spec.pathToken], effects: [spec.permittedEffect] },
    predecessorPreservation: { retained: true, candidateIdentity: { commit: spec.parentCommit, tree: spec.baseCommit } },
    revalidationLinkage: { episodeId: spec.episodeId, evidenceBoundaryId: spec.evidenceBoundaryId, candidateIdentity },
    digest: ''
  });
  candidateReadback.digest = s1aHashWithoutField(candidateReadback, 'digest');
  const evidenceReadback = s1aSignedReadback({
    source: 'POLICY_TEST_MODEL_INDEPENDENT_EVIDENCE_READBACK',
    authoritative: true, current: true, complete: true, readBack: true,
    repository: S1A_ORACLE_CONTINUATION_REPOSITORY, identity: evidenceIdentity,
    candidateIdentity, evidenceId: spec.evidenceId, evidenceDigest: evidenceIdentity.digest,
    evidenceBoundaryId: spec.evidenceBoundaryId, acceptedContractId: spec.acceptedContractId,
    revalidationBoundaryId: spec.evidenceBoundaryId
  });
  const trustedContext = s1aDeepFreeze({
    currentAuthority, candidateReadback, evidenceReadback, attributionReadback,
    acceptedBoundaryReadback: acceptedBoundary, currentStateReadback,
    effectReconciliation, faithfulPathInventory, permittedEffect: spec.permittedEffect,
    parentOwnershipReadback: spec.parentOwnershipReadback || null
  });
  return s1aDeepFreeze({
    key, spec, episodeAuthority, acceptedBoundary, candidateIdentity, evidenceIdentity,
    attemptState: spec.attemptState, currentFailureSignature, history,
    effectReconciliation, faithfulPathInventory, currentStateReadback, attributionReadback,
    currentAuthority, candidateReadback, evidenceReadback, trustedContext
  });
}
const S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS = s1aDeepFreeze(Object.fromEntries(
  Object.entries(S1A_ORACLE_CONTINUATION_SCENARIO_SPECS).map(([key, spec]) =>
    [key, s1aBuildContinuationScenario(key, spec)])));
function s1aExpectedContinuationStateReadback(scenarioKey = 'G3_RUN_LOCK_TOOLKIT') {
  const scenario = S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS[scenarioKey];
  return scenario ? s1aClone(scenario.currentStateReadback) : null;
}
function s1aExpectedContinuationEpisodeAuthority(scenarioKey = 'G3_RUN_LOCK_TOOLKIT') {
  const scenario = S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS[scenarioKey];
  return scenario ? s1aClone(scenario.episodeAuthority) : null;
}
function s1aExpectedContinuationTrustedContext(scenarioKey = 'G3_RUN_LOCK_TOOLKIT') {
  const scenario = S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS[scenarioKey];
  return scenario ? s1aClone(scenario.trustedContext) : null;
}
const S1A_ORACLE_REPLACEMENT_REPOSITORY = S1A_ORACLE_CONTINUATION_REPOSITORY;
const S1A_ORACLE_REPLACEMENT_SCENARIO =
  S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS.G3_RUN_LOCK_TOOLKIT;
const S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE =
  s1aClone(S1A_ORACLE_REPLACEMENT_SCENARIO.candidateIdentity);
const S1A_ORACLE_REPLACEMENT_PREDECESSOR_EVIDENCE =
  s1aClone(S1A_ORACLE_REPLACEMENT_SCENARIO.evidenceIdentity);
const S1A_ORACLE_REPLACEMENT_COMMIT = '7777777777777777777777777777777777777777';
const S1A_ORACLE_REPLACEMENT_TREE = '8888888888888888888888888888888888888888';
const S1A_ORACLE_REPLACEMENT_BASE = S1A_ORACLE_REPLACEMENT_SCENARIO.spec.baseCommit;
const S1A_ORACLE_REPLACEMENT_BOUNDARY = 'boundary:g3-toolkit-revalidation-8';
const S1A_ORACLE_REPLACEMENT_PATH = 'repo/tests/controller-policy-separation.test.cjs';
const S1A_ORACLE_REPLACEMENT_EFFECT = 'CREATE_DISTINCT_WEB_AUTHORISED_REPLACEMENT';
const S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY = s1aDeepFreeze({
  repository: S1A_ORACLE_REPLACEMENT_REPOSITORY, kind: 'HOSTED', objectFormat: 'sha1',
  commit: S1A_ORACLE_REPLACEMENT_COMMIT, head: S1A_ORACLE_REPLACEMENT_COMMIT,
  tree: S1A_ORACLE_REPLACEMENT_TREE,
  orderedParents: [S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE.commit],
  baseCommit: S1A_ORACLE_REPLACEMENT_BASE,
  hostedBinding: {
    repository: S1A_ORACLE_REPLACEMENT_REPOSITORY, prNumber: 495,
    branch: 'codex/s1a-increment1-web-law-shipping',
    headSha: S1A_ORACLE_REPLACEMENT_COMMIT, baseCommit: S1A_ORACLE_REPLACEMENT_BASE,
    readBack: true
  }
});
const S1A_ORACLE_REPLACEMENT_CANDIDATE_READBACK = s1aDeepFreeze(s1aSignedReadback({
  source: 'POLICY_TEST_MODEL_INDEPENDENT_CANDIDATE_READBACK',
  authoritative: true, current: true, complete: true, readBack: true,
  repository: S1A_ORACLE_REPLACEMENT_REPOSITORY, kind: 'HOSTED', objectFormat: 'sha1',
  commit: S1A_ORACLE_REPLACEMENT_COMMIT, head: S1A_ORACLE_REPLACEMENT_COMMIT,
  tree: S1A_ORACLE_REPLACEMENT_TREE,
  orderedParents: [S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE.commit],
  baseCommit: S1A_ORACLE_REPLACEMENT_BASE,
  identity: S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY,
  commitTreeReadback: {
    source: 'POLICY_TEST_MODEL_GIT_READBACK', repository: S1A_ORACLE_REPLACEMENT_REPOSITORY,
    objectFormat: 'sha1', commit: S1A_ORACLE_REPLACEMENT_COMMIT, tree: S1A_ORACLE_REPLACEMENT_TREE,
    orderedParents: [S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE.commit], readBack: true
  },
  lineage: {
    repository: S1A_ORACLE_REPLACEMENT_REPOSITORY,
    episodeId: S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority.episodeId,
    runId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.runId,
    lockId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.lockId,
    predecessorCandidateIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE,
    baseCommit: S1A_ORACLE_REPLACEMENT_BASE,
    orderedParents: [S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE.commit]
  },
  hostedBinding: S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY.hostedBinding,
  localCustodyBinding: null,
  observedMutationScope: {
    paths: [S1A_ORACLE_REPLACEMENT_PATH], effects: [S1A_ORACLE_REPLACEMENT_EFFECT]
  },
  predecessorPreservation: {
    source: 'POLICY_TEST_MODEL_PREDECESSOR_READBACK',
    retained: true, immutable: true,
    candidateIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE,
    evidenceIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_EVIDENCE
  },
  revalidationLinkage: {
    authorityIdentity: 'web-authority:g3-toolkit-replacement',
    authorityRevision: 'revision:g3-toolkit-replacement-8',
    episodeId: S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority.episodeId,
    runId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.runId,
    lockId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.lockId,
    revalidationBoundary: S1A_ORACLE_REPLACEMENT_BOUNDARY,
    predecessorCandidateIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE,
    predecessorEvidenceIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_EVIDENCE,
    replacementCandidateIdentity: S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY
  }
}));
const S1A_ORACLE_REPLACEMENT_EVIDENCE_READBACK = s1aDeepFreeze(s1aSignedReadback({
  source: 'POLICY_TEST_MODEL_INDEPENDENT_EVIDENCE_READBACK',
  authoritative: true, current: true, complete: true, readBack: true,
  repository: S1A_ORACLE_REPLACEMENT_REPOSITORY,
  evidenceId: 'evidence:g3-toolkit-revalidation-8',
  evidenceDigest: 'sha256:modelled-revalidation-evidence-8',
  candidateIdentity: S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY,
  predecessorCandidateIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE,
  predecessorEvidenceIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_EVIDENCE,
  authorityIdentity: 'web-authority:g3-toolkit-replacement',
  authorityRevision: 'revision:g3-toolkit-replacement-8',
  episodeId: S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority.episodeId,
  runId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.runId,
  lockId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.lockId,
  revalidationBoundary: S1A_ORACLE_REPLACEMENT_BOUNDARY,
  evidenceBoundaryId: S1A_ORACLE_REPLACEMENT_BOUNDARY
}));
const S1A_ORACLE_REPLACEMENT_PATH_EFFECT_CEILING = s1aDeepFreeze({
  paths: [S1A_ORACLE_REPLACEMENT_PATH], effects: [S1A_ORACLE_REPLACEMENT_EFFECT]
});
const S1A_ORACLE_REPLACEMENT_CURRENT_AUTHORITY = s1aDeepFreeze(s1aSignedReadback({
  source: 'CURRENT_WEB_HOSTED_REPLACEMENT_AUTHORITY_READBACK',
  authoritative: true, current: true, complete: true, readBack: true,
  repository: S1A_ORACLE_REPLACEMENT_REPOSITORY,
  webAuthorityIdentity: 'web-authority:g3-toolkit-replacement',
  webAuthorityRevision: 'revision:g3-toolkit-replacement-8',
  webAuthorityContent: 'current hosted non-product replacement permission for g3 toolkit',
  episode: {
    episodeId: S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority.episodeId,
    episodeKind: 'G3_RUN_LOCK',
    authorityReference: S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority.authorityReference
  },
  run: { runId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.runId },
  lock: { lockId: S1A_ORACLE_REPLACEMENT_SCENARIO.spec.lockId },
  episodeAuthority: S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority,
  replacementPermission: {
    permissionId: 'permission:g3-toolkit-replacement-8',
    action: S1A_ORACLE_REPLACEMENT_EFFECT,
    state: 'AVAILABLE', usesRemaining: 1, candidateKind: 'HOSTED',
    baseCommit: S1A_ORACLE_REPLACEMENT_BASE,
    eligibleOwner: 'TOOLKIT', correctionMechanism: 'TOOLKIT_VALIDATION',
    productSemanticsProvenBad: 'NO',
    predecessorCandidateIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE,
    predecessorEvidenceIdentity: S1A_ORACLE_REPLACEMENT_PREDECESSOR_EVIDENCE,
    replacementCandidateIdentity: S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY,
    candidateReadbackDigest: S1A_ORACLE_REPLACEMENT_CANDIDATE_READBACK.digest,
    evidenceReadbackDigest: S1A_ORACLE_REPLACEMENT_EVIDENCE_READBACK.digest,
    pathEffectCeiling: S1A_ORACLE_REPLACEMENT_PATH_EFFECT_CEILING,
    revalidationBoundary: S1A_ORACLE_REPLACEMENT_BOUNDARY
  },
  eligibleOwner: 'TOOLKIT', correctionMechanism: 'TOOLKIT_VALIDATION',
  predecessorCandidate: S1A_ORACLE_REPLACEMENT_PREDECESSOR_CANDIDATE,
  replacementCandidate: S1A_ORACLE_REPLACEMENT_CANDIDATE_IDENTITY,
  pathEffectCeiling: S1A_ORACLE_REPLACEMENT_PATH_EFFECT_CEILING,
  revalidationBoundary: S1A_ORACLE_REPLACEMENT_BOUNDARY,
  lifetime: {
    notBefore: '2026-09-28T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z',
    observedAt: '2026-09-29T00:00:00Z'
  },
  currentness: { current: true, revoked: false, superseded: false },
  permissionConsumption: {
    permissionId: 'permission:g3-toolkit-replacement-8',
    state: 'AVAILABLE', usesRemaining: 1, readBack: true
  }
}));
const S1A_ORACLE_HOSTED_REPLACEMENT_TRUSTED_CONTEXT = s1aDeepFreeze({
  ...S1A_ORACLE_REPLACEMENT_SCENARIO.trustedContext,
  currentAuthority: S1A_ORACLE_REPLACEMENT_CURRENT_AUTHORITY,
  candidateReadback: S1A_ORACLE_REPLACEMENT_CANDIDATE_READBACK,
  evidenceReadback: S1A_ORACLE_REPLACEMENT_EVIDENCE_READBACK,
  permittedEffect: S1A_ORACLE_REPLACEMENT_EFFECT
});
function s1aFixedContinuationContext(trustedContext) {
  for (const [key, scenario] of Object.entries(S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS)) {
    if (s1aSame(trustedContext, scenario.trustedContext)) return { key, scenario, replacement: false };
  }
  if (s1aSame(trustedContext, S1A_ORACLE_HOSTED_REPLACEMENT_TRUSTED_CONTEXT)) {
    return {
      key: 'G3_RUN_LOCK_TOOLKIT', scenario: S1A_ORACLE_REPLACEMENT_SCENARIO, replacement: true
    };
  }
  return null;
}

const S1A_ORACLE_CONTINUATION_RELATIONS = Object.freeze({
  OWNER_PRODUCT: 'CONTINUATION_OWNER_PRODUCT_BOUNDARY',
  EPISODE_SCOPE: 'CONTINUATION_EPISODE_SCOPE_AUTHORITY',
  AUTHORITY_READBACK: 'CONTINUATION_ACCEPTED_AUTHORITY_READBACK',
  LIMITS: 'CONTINUATION_ATTEMPT_LIMITS',
  PATH_USABILITY: 'CONTINUATION_FAITHFUL_PATH_USABILITY',
  EFFECTS: 'CONTINUATION_EFFECT_RECONCILIATION',
  PATH_PROGRESS: 'CONTINUATION_FAITHFUL_PATH_PROGRESS',
  CURRENT_STATE: 'CONTINUATION_CURRENT_STATE_READBACK',
  IDENTITY_BUDGET: 'CONTINUATION_IDENTITY_BUDGET_PRESERVATION',
  REPLACEMENT: 'CONTINUATION_REPLACEMENT_AUTHORITY',
  REPLACEMENT_CANDIDATE_VALIDITY: 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY'
});

function s1aSignedReadback(core) {
  return { ...core, digest: s1aHashRecord(core) };
}

function makeS1aContinuationFixture(options = {}) {
  const scenarioKey = options.scenario || 'G3_RUN_LOCK_TOOLKIT';
  const oracle = S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS[scenarioKey];
  if (!oracle) throw new Error('unknown fixed continuation oracle scenario');
  const currentStateReadback = s1aClone(oracle.currentStateReadback);
  const acceptedAuthority = s1aClone(oracle.episodeAuthority);
  const owner = options.owner || acceptedAuthority.primaryOwner;
  const episodeAuthority = s1aClone(acceptedAuthority);
  if (options.episodeKind) {
    episodeAuthority.episodeKind = options.episodeKind;
    episodeAuthority.digest = s1aHashWithoutField(episodeAuthority, 'digest');
  }
  const currentFailureSignature = s1aClone(currentStateReadback.currentFailureSignature);
  const attemptState = currentStateReadback.attemptState;
  const candidateIdentity = s1aClone(oracle.candidateIdentity);
  const evidenceIdentity = s1aClone(oracle.evidenceIdentity);
  return {
    mode: 'IDENTITY_PRESERVING', primaryOwner: owner, PRODUCT_SEMANTICS_PROVEN_BAD: 'NO',
    episodeAuthority,
    acceptedBoundary: s1aClone(oracle.acceptedBoundary),
    requestedBoundary: Object.fromEntries(S1A_ORACLE_CONTINUATION_BOUNDARY_FIELDS.map((field) =>
      [field, episodeAuthority[field]])),
    currentStateReadback,
    effectReconciliation: s1aClone(oracle.effectReconciliation),
    faithfulPathInventory: s1aClone(oracle.faithfulPathInventory),
    currentFailureSignature,
    history: s1aClone(currentStateReadback.history),
    candidateBefore: s1aClone(candidateIdentity), candidateAfter: s1aClone(candidateIdentity),
    evidenceBefore: s1aClone(evidenceIdentity), evidenceAfter: s1aClone(evidenceIdentity),
    attempts: {
      attemptCountBefore: attemptState.attemptCount, attemptCountAfter: attemptState.attemptCount,
      attemptLimitBefore: attemptState.attemptLimit, attemptLimitAfter: attemptState.attemptLimit,
      productCorrectionAttemptsBefore: attemptState.productCorrectionAttempts,
      productCorrectionAttemptsAfter: attemptState.productCorrectionAttempts,
      productCorrectionLimitBefore: attemptState.productCorrectionLimit,
      productCorrectionLimitAfter: attemptState.productCorrectionLimit,
      budgetConsumedBefore: attemptState.budgetConsumed, budgetConsumedAfter: attemptState.budgetConsumed,
      budgetLimitBefore: attemptState.budgetLimit, budgetLimitAfter: attemptState.budgetLimit,
      reset: false
    },
    replacementAuthorityClaim: null,
    durableFailedCandidates: []
  };
}
function s1aContinuationTrustedContext(scenarioKey = 'G3_RUN_LOCK_TOOLKIT') {
  const context = s1aExpectedContinuationTrustedContext(scenarioKey);
  if (!context) throw new Error('unknown fixed trusted continuation context');
  return context;
}
function s1aContinuationPolicyViolations(policy) {
  const rule = policy && policy.boundedContinuation ? policy.boundedContinuation : {};
  const oracle = S1A_ORACLE_BOUNDED_CONTINUATION_POLICY;
  const failures = [];
  const push = (id) => { if (!failures.includes(id)) failures.push(id); };
  const requiredConditions = Array.isArray(rule.requiredConditions) ? rule.requiredConditions : [];
  if (!s1aSame(rule.eligiblePrimaryOwners, oracle.eligiblePrimaryOwners) ||
      !s1aSame(rule.excludedAutonomousOwners, oracle.excludedAutonomousOwners) ||
      rule.productSemanticsRequired !== oracle.productSemanticsRequired) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.OWNER_PRODUCT);
  }
  if (!s1aSame(rule.episodeAuthority, oracle.episodeAuthority) ||
      !s1aSame(rule.acceptedBoundaryBinding, oracle.acceptedBoundaryBinding) ||
      !requiredConditions.includes('SAME_ROOT_TRUST_AUTHORITY_SCOPE') ||
      !requiredConditions.includes('SAME_ASSURANCE_FLOOR_AND_EVIDENCE_BOUNDARY')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.EPISODE_SCOPE);
  }
  if (!s1aSame(rule.acceptedAuthorityBinding, oracle.acceptedAuthorityBinding) ||
      !requiredConditions.includes('ACCEPTED_EPISODE_AUTHORITY_READBACK')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.AUTHORITY_READBACK);
  }
  if (!s1aSame(rule.currentStateReadback, oracle.currentStateReadback) ||
      !requiredConditions.includes('AUTHORITATIVE_CURRENT_STATE_READBACK')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.CURRENT_STATE);
  }
  if (!s1aSame(rule.effectReconciliation, oracle.effectReconciliation) ||
      !requiredConditions.includes('RECONCILED_EFFECTS')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.EFFECTS);
  }
  const pathProgressPolicy = {
    requiredFields: rule.faithfulPathInventory && rule.faithfulPathInventory.requiredFields,
    requiresRemainingFaithfulPath: rule.faithfulPathInventory && rule.faithfulPathInventory.requiresRemainingFaithfulPath
  };
  const oraclePathProgressPolicy = {
    requiredFields: oracle.faithfulPathInventory.requiredFields,
    requiresRemainingFaithfulPath: oracle.faithfulPathInventory.requiresRemainingFaithfulPath
  };
  if (!s1aSame(pathProgressPolicy, oraclePathProgressPolicy) ||
      !s1aSame(rule.equivalenceFields, oracle.equivalenceFields) ||
      !s1aSame(rule.equivalenceIgnoresLabels, oracle.equivalenceIgnoresLabels) ||
      !requiredConditions.includes('FAITHFUL_PATH_REMAINS') ||
      !requiredConditions.includes('NO_EQUIVALENT_NO_PROGRESS_REPEAT')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.PATH_PROGRESS);
  }
  const pathUsabilityPolicy = {
    pathFields: rule.faithfulPathInventory && rule.faithfulPathInventory.pathFields,
    pathInventoryDigestBoundToCurrentState: rule.faithfulPathInventory &&
      rule.faithfulPathInventory.pathInventoryDigestBoundToCurrentState
  };
  const oraclePathUsabilityPolicy = {
    pathFields: oracle.faithfulPathInventory.pathFields,
    pathInventoryDigestBoundToCurrentState: oracle.faithfulPathInventory.pathInventoryDigestBoundToCurrentState
  };
  if (!s1aSame(pathUsabilityPolicy, oraclePathUsabilityPolicy) ||
      !requiredConditions.includes('FAITHFUL_PATH_HAS_BOUND_EVIDENCE')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.PATH_USABILITY);
  }
  const attemptCore = { ...(rule.attemptAndBudget || {}) };
  const oracleAttemptCore = { ...oracle.attemptAndBudget };
  const limitKeys = ['attemptCountMayExceedLimit', 'productCorrectionsMayExceedLimit',
    'budgetConsumedMayExceedLimit', 'overLimitResult'];
  for (const key of limitKeys) {
    delete attemptCore[key];
    delete oracleAttemptCore[key];
  }
  if (rule.candidateTransition !== oracle.candidateTransition ||
      rule.evidenceTransition !== oracle.evidenceTransition ||
      !s1aSame(attemptCore, oracleAttemptCore) ||
      !requiredConditions.includes('EXACT_CANDIDATE_AND_EVIDENCE_IDENTITY') ||
      !requiredConditions.includes('NO_ATTEMPT_OR_BUDGET_RESET')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.IDENTITY_BUDGET);
  }
  const attemptLimitPolicy = Object.fromEntries(limitKeys.map((key) => [key,
    rule.attemptAndBudget && rule.attemptAndBudget[key]]));
  const oracleAttemptLimitPolicy = Object.fromEntries(limitKeys.map((key) => [key,
    oracle.attemptAndBudget[key]]));
  if (!s1aSame(attemptLimitPolicy, oracleAttemptLimitPolicy) ||
      !requiredConditions.includes('CONSUMPTION_WITHIN_ACCEPTED_LIMITS')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.LIMITS);
  }
  if (!s1aSame(rule.replacementAuthority, oracle.replacementAuthority)) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.REPLACEMENT);
  }
  if (!s1aSame(rule.replacementCandidateValidity, oracle.replacementCandidateValidity) ||
      !s1aSame(rule.replacementRejection, oracle.replacementRejection) ||
      !oracle.resultFields.includes('mutationEffects')) {
    push(S1A_ORACLE_CONTINUATION_RELATIONS.REPLACEMENT_CANDIDATE_VALIDITY);
  }
  return failures;
}
function s1aEquivalentContinuationFailure(left, right, equivalenceFields) {
  return equivalenceFields.every((field) => s1aSame(left && left[field], right && right[field]));
}

function s1aNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function s1aObjectIdHasFormat(value, objectFormat) {
  const length = objectFormat === 'sha1' ? 40 : objectFormat === 'sha256' ? 64 : 0;
  return length > 0 && typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$', 'i').test(value);
}
function s1aRequestReadbackIsIndependent(request, readback) {
  if (!request || typeof request !== 'object' || !readback || typeof readback !== 'object') return false;
  const requestReferences = s1aObjectReferences(request);
  return ![...s1aObjectReferences(readback)].some((reference) => requestReferences.has(reference));
}
function s1aMutationScopeWithinCeiling(scope, ceiling) {
  return s1aHasExactKeys(scope, ['paths', 'effects']) &&
    s1aHasExactKeys(ceiling, ['paths', 'effects']) &&
    Array.isArray(scope.paths) && scope.paths.length > 0 &&
    Array.isArray(scope.effects) && scope.effects.length > 0 &&
    Array.isArray(ceiling.paths) && ceiling.paths.length > 0 &&
    Array.isArray(ceiling.effects) && ceiling.effects.length > 0 &&
    ceiling.paths.every(s1aNonBlankString) && ceiling.effects.every(s1aNonBlankString) &&
    scope.paths.every((value) => s1aNonBlankString(value) && ceiling.paths.includes(value)) &&
    scope.effects.every((value) => s1aNonBlankString(value) && ceiling.effects.includes(value));
}
function s1aReplacementAuthorityIsValid(request, trustedContext) {
  const authority = trustedContext && trustedContext.currentAuthority;
  const permission = authority && authority.replacementPermission;
  const authorityIsIndependent = s1aRequestReadbackIsIndependent(request, authority);
  const expected = S1A_ORACLE_REPLACEMENT_CURRENT_AUTHORITY;
  const authorityFields = [
    'source', 'authoritative', 'current', 'complete', 'readBack', 'repository',
    'webAuthorityIdentity', 'webAuthorityRevision', 'webAuthorityContent', 'episode',
    'run', 'lock', 'episodeAuthority', 'replacementPermission', 'eligibleOwner',
    'correctionMechanism', 'predecessorCandidate', 'replacementCandidate',
    'pathEffectCeiling', 'revalidationBoundary', 'lifetime', 'currentness',
    'permissionConsumption', 'digest'
  ];
  const permissionFields = [
    'permissionId', 'action', 'state', 'usesRemaining', 'candidateKind', 'baseCommit',
    'eligibleOwner', 'correctionMechanism', 'productSemanticsProvenBad',
    'predecessorCandidateIdentity', 'predecessorEvidenceIdentity',
    'replacementCandidateIdentity', 'candidateReadbackDigest', 'evidenceReadbackDigest',
    'pathEffectCeiling', 'revalidationBoundary'
  ];
  const lifetime = authority && authority.lifetime;
  const currentness = authority && authority.currentness;
  const consumption = authority && authority.permissionConsumption;
  const observedAt = lifetime && Date.parse(lifetime.observedAt);
  const notBefore = lifetime && Date.parse(lifetime.notBefore);
  const expiresAt = lifetime && Date.parse(lifetime.expiresAt);
  const permissionCurrent = Boolean(authority) &&
    authority.source === expected.source && authority.authoritative === true &&
    authority.current === true && authority.complete === true && authority.readBack === true &&
    authority.repository === S1A_ORACLE_REPLACEMENT_REPOSITORY &&
    authority.webAuthorityIdentity === expected.webAuthorityIdentity &&
    authority.webAuthorityRevision === expected.webAuthorityRevision &&
    authority.webAuthorityContent === expected.webAuthorityContent &&
    authority.episode && authority.run && authority.lock &&
    authority.episode.episodeKind === 'G3_RUN_LOCK' &&
    s1aSame(authority.episodeAuthority, S1A_ORACLE_REPLACEMENT_SCENARIO.episodeAuthority) &&
    authority.eligibleOwner === request.primaryOwner &&
    S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.replacementAuthority.eligiblePrimaryOwners.includes(authority.eligibleOwner) &&
    authority.correctionMechanism === request.correctionMechanism &&
    S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.replacementAuthority.eligibleCorrectionMechanisms.includes(authority.correctionMechanism) &&
    authority.episode.episodeId === (request.episodeAuthority && request.episodeAuthority.episodeId) &&
    authority.run.runId === (request.episodeAuthority && request.episodeAuthority.runId) &&
    authority.lock.lockId === (request.episodeAuthority && request.episodeAuthority.lockId) &&
    s1aSame(authority.predecessorCandidate, request.candidateBefore) &&
    authority.replacementPermission &&
    authority.replacementPermission.state === 'AVAILABLE' &&
    authority.replacementPermission.usesRemaining === 1 &&
    authority.replacementPermission.candidateKind === 'HOSTED' &&
    authority.replacementPermission.eligibleOwner === request.primaryOwner &&
    authority.replacementPermission.correctionMechanism === request.correctionMechanism &&
    authority.replacementPermission.productSemanticsProvenBad === 'NO' &&
    authority.permissionConsumption && authority.permissionConsumption.state === 'AVAILABLE' &&
    authority.permissionConsumption.permissionId === authority.replacementPermission.permissionId &&
    authority.permissionConsumption.usesRemaining === 1 &&
    authority.currentness && authority.currentness.current === true &&
    authority.currentness.revoked === false && authority.currentness.superseded === false &&
    Number.isFinite(observedAt) && Number.isFinite(notBefore) && Number.isFinite(expiresAt) &&
    observedAt >= notBefore && observedAt < expiresAt &&
    s1aMutationScopeWithinCeiling(request.requestedMutationScope, authority.pathEffectCeiling) &&
    request.PRODUCT_SEMANTICS_PROVEN_BAD === 'NO' &&
    s1aSame(request.replacementAuthorityClaim, authority) &&
    s1aSame(authority, expected);
  const exactAuthorityShape = s1aHasExactKeys(authority, authorityFields) &&
    s1aHasExactKeys(permission, permissionFields) &&
    authority.digest === s1aHashWithoutField(authority, 'digest');
  const valid = permissionCurrent && exactAuthorityShape && authorityIsIndependent;
  return { ok: valid, failures: valid ? [] : ['CONTINUATION_REPLACEMENT_AUTHORITY'] };
}
function s1aReplacementCandidateIsValid(request, trustedContext) {
  const candidate = trustedContext && trustedContext.candidateReadback;
  const evidence = trustedContext && trustedContext.evidenceReadback;
  const authority = trustedContext && trustedContext.currentAuthority;
  const permission = authority && authority.replacementPermission;
  const candidateIsIndependent = s1aRequestReadbackIsIndependent(request, candidate);
  const evidenceIsIndependent = s1aRequestReadbackIsIndependent(request, evidence);
  const policy = S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.replacementCandidateValidity;
  const requiredReadbackKeys = [
    'source', 'authoritative', 'current', 'complete', 'readBack', ...policy.requiredFields,
    'identity', 'digest'
  ];
  const candidateShape = candidate && requiredReadbackKeys.every((field) =>
    Object.prototype.hasOwnProperty.call(candidate, field));
  const supportedKind = candidate && policy.supportedKinds.includes(candidate.kind);
  const validObjectFormat = candidate && policy.supportedObjectFormats.includes(candidate.objectFormat);
  const idsValid = Boolean(candidate && validObjectFormat) &&
    ['commit', 'head', 'tree', 'baseCommit'].every((field) =>
      s1aObjectIdHasFormat(candidate[field], candidate.objectFormat)) &&
    candidate.head === candidate.commit && candidate.identity &&
    candidate.identity.head === candidate.identity.commit &&
    Array.isArray(candidate.orderedParents) && candidate.orderedParents.length > 0 &&
    candidate.orderedParents.every((value) => s1aObjectIdHasFormat(value, candidate.objectFormat));
  const identityMatchesReadback = Boolean(candidate && s1aSame(request.candidateAfter, candidate.identity) &&
    candidate.identity && candidate.identity.commit === candidate.commit &&
    candidate.identity.head === candidate.head && candidate.identity.tree === candidate.tree &&
    candidate.identity.baseCommit === candidate.baseCommit &&
    s1aSame(candidate.identity.orderedParents, candidate.orderedParents) &&
    candidate.identity.repository === candidate.repository &&
    candidate.identity.kind === candidate.kind &&
    candidate.identity.objectFormat === candidate.objectFormat);
  const commitTree = candidate && candidate.commitTreeReadback;
  const commitTreeValid = s1aHasExactKeys(commitTree,
    ['source', 'repository', 'objectFormat', 'commit', 'tree', 'orderedParents', 'readBack']) &&
    commitTree.source === 'POLICY_TEST_MODEL_GIT_READBACK' &&
    commitTree.repository === candidate.repository &&
    commitTree.objectFormat === candidate.objectFormat && commitTree.commit === candidate.commit &&
    commitTree.tree === candidate.tree && s1aSame(commitTree.orderedParents, candidate.orderedParents) &&
    commitTree.readBack === true;
  const episode = authority && authority.episode;
  const run = authority && authority.run;
  const lock = authority && authority.lock;
  const lineage = candidate && candidate.lineage;
  const lineageValid = s1aHasExactKeys(lineage, [
    'repository', 'episodeId', 'runId', 'lockId', 'predecessorCandidateIdentity',
    'baseCommit', 'orderedParents'
  ]) && lineage.repository === candidate.repository &&
    lineage.episodeId === (episode && episode.episodeId) &&
    lineage.runId === (run && run.runId) && lineage.lockId === (lock && lock.lockId) &&
    s1aSame(lineage.predecessorCandidateIdentity, request.candidateBefore) &&
    lineage.baseCommit === candidate.baseCommit &&
    s1aSame(lineage.orderedParents, candidate.orderedParents);
  const hosted = candidate && candidate.kind === 'HOSTED' && candidate.hostedBinding;
  const hostedValid = candidate && candidate.kind === 'HOSTED'
    ? s1aHasExactKeys(hosted, S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.replacementCandidateValidity.hostedBindingFields) &&
      hosted.repository === candidate.repository && Number.isSafeInteger(hosted.prNumber) &&
      s1aNonBlankString(hosted.branch) && hosted.headSha === candidate.head &&
      hosted.baseCommit === candidate.baseCommit && hosted.readBack === true &&
      s1aSame(hosted, candidate.identity && candidate.identity.hostedBinding) &&
      candidate.localCustodyBinding === null
    : false;
  const localCustody = candidate && candidate.localCustodyBinding;
  const localValid = candidate && candidate.kind === 'LOCAL'
    ? s1aHasExactKeys(localCustody, S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.replacementCandidateValidity.localCustodyBindingFields) &&
      localCustody.repository === candidate.repository &&
      s1aNonBlankString(localCustody.custodyId) && s1aNonBlankString(localCustody.worktreeId) &&
      localCustody.commit === candidate.commit && localCustody.tree === candidate.tree &&
      localCustody.readBack === true && candidate.hostedBinding === null &&
      s1aSame(localCustody, candidate.identity && candidate.identity.localCustodyBinding)
    : false;
  const kindBindingValid = candidate && candidate.kind === (permission && permission.candidateKind) &&
    (candidate.kind === 'HOSTED' ? hostedValid : localValid);
  const scope = candidate && candidate.observedMutationScope;
  const scopeWithinCeiling = Boolean(permission) &&
    s1aMutationScopeWithinCeiling(scope, permission.pathEffectCeiling) &&
    s1aMutationScopeWithinCeiling(request.requestedMutationScope, permission.pathEffectCeiling);
  const predecessor = candidate && candidate.predecessorPreservation;
  const predecessorPreserved = s1aHasExactKeys(predecessor, [
    'source', 'retained', 'immutable', 'candidateIdentity', 'evidenceIdentity'
  ]) && predecessor.source === 'POLICY_TEST_MODEL_PREDECESSOR_READBACK' &&
    predecessor.retained === true && predecessor.immutable === true &&
    s1aSame(predecessor.candidateIdentity, request.candidateBefore) &&
    s1aSame(predecessor.evidenceIdentity, request.evidenceBefore) &&
    Array.isArray(request.durableFailedCandidates) &&
    request.durableFailedCandidates.some((row) => row && row.immutable === true &&
      row.preserved === true && s1aSame(row.candidateIdentity, request.candidateBefore) &&
      s1aSame(row.evidenceIdentity, request.evidenceBefore));
  const revalidation = candidate && candidate.revalidationLinkage;
  const revalidationValid = s1aHasExactKeys(revalidation, [
    'authorityIdentity', 'authorityRevision', 'episodeId', 'runId', 'lockId',
    'revalidationBoundary', 'predecessorCandidateIdentity', 'predecessorEvidenceIdentity',
    'replacementCandidateIdentity'
  ]) && revalidation.authorityIdentity === (authority && authority.webAuthorityIdentity) &&
    revalidation.authorityRevision === (authority && authority.webAuthorityRevision) &&
    revalidation.episodeId === (episode && episode.episodeId) &&
    revalidation.runId === (run && run.runId) && revalidation.lockId === (lock && lock.lockId) &&
    revalidation.revalidationBoundary === (authority && authority.revalidationBoundary) &&
    s1aSame(revalidation.predecessorCandidateIdentity, request.candidateBefore) &&
    s1aSame(revalidation.predecessorEvidenceIdentity, request.evidenceBefore) &&
    s1aSame(revalidation.replacementCandidateIdentity, candidate && candidate.identity);
  const evidenceValid = s1aHasExactKeys(evidence, [
    'source', 'authoritative', 'current', 'complete', 'readBack', 'repository', 'evidenceId',
    'evidenceDigest', 'candidateIdentity', 'predecessorCandidateIdentity',
    'predecessorEvidenceIdentity', 'authorityIdentity', 'authorityRevision', 'episodeId',
    'runId', 'lockId', 'revalidationBoundary', 'evidenceBoundaryId', 'digest'
  ]) && evidence.source === 'POLICY_TEST_MODEL_INDEPENDENT_EVIDENCE_READBACK' &&
    evidence.authoritative === true && evidence.current === true && evidence.complete === true &&
    evidence.readBack === true && candidate && evidence.repository === candidate.repository &&
    s1aNonBlankString(evidence.evidenceId) && evidence.evidenceId !==
      (request.evidenceBefore && request.evidenceBefore.evidenceId) &&
    s1aNonBlankString(evidence.evidenceDigest) &&
    s1aSame(evidence.candidateIdentity, candidate && candidate.identity) &&
    s1aSame(evidence.predecessorCandidateIdentity, request.candidateBefore) &&
    s1aSame(evidence.predecessorEvidenceIdentity, request.evidenceBefore) &&
    evidence.authorityIdentity === (authority && authority.webAuthorityIdentity) &&
    evidence.authorityRevision === (authority && authority.webAuthorityRevision) &&
    evidence.episodeId === (episode && episode.episodeId) &&
    evidence.runId === (run && run.runId) && evidence.lockId === (lock && lock.lockId) &&
    evidence.revalidationBoundary === (authority && authority.revalidationBoundary) &&
    evidence.evidenceBoundaryId === (authority && authority.revalidationBoundary) &&
    evidence.digest === s1aHashWithoutField(evidence, 'digest') &&
    permission && permission.evidenceReadbackDigest === evidence.digest &&
    request.replacementCandidateImmutable === true &&
    request.evidenceAfter && request.evidenceAfter.evidenceId === evidence.evidenceId &&
    request.evidenceAfter.digest === evidence.evidenceDigest &&
    s1aSame(request.evidenceAfter.candidateIdentity, evidence.candidateIdentity) &&
    request.evidenceAfter.revalidationBoundaryId === evidence.revalidationBoundary;
  const authorityCandidateBound = Boolean(permission) &&
    s1aSame(permission.replacementCandidateIdentity, candidate && candidate.identity) &&
    permission.candidateReadbackDigest === (candidate && candidate.digest) &&
    permission.evidenceReadbackDigest === (evidence && evidence.digest) &&
    permission.baseCommit === (candidate && candidate.baseCommit) &&
    s1aSame(authority.predecessorCandidate, request.candidateBefore) &&
    s1aSame(authority.replacementCandidate, candidate && candidate.identity);
  const readbacksAreFixed = s1aSame(candidate, S1A_ORACLE_REPLACEMENT_CANDIDATE_READBACK) &&
    s1aSame(evidence, S1A_ORACLE_REPLACEMENT_EVIDENCE_READBACK);
  const valid = Boolean(candidateShape && supportedKind && idsValid && identityMatchesReadback &&
    commitTreeValid && lineageValid && kindBindingValid && scopeWithinCeiling &&
    predecessorPreserved && revalidationValid && evidenceValid && authorityCandidateBound &&
    readbacksAreFixed && candidateIsIndependent && evidenceIsIndependent);
  return { ok: valid, failures: valid ? [] : ['CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY'] };
}

function evaluateS1aContinuation(policy, request, trustedContext) {
  const failures = s1aContinuationPolicyViolations(policy);
  const push = (id) => { if (!failures.includes(id)) failures.push(id); };
  const rule = S1A_ORACLE_BOUNDED_CONTINUATION_POLICY;
  const contextMatch = s1aFixedContinuationContext(trustedContext);
  const scenario = contextMatch && contextMatch.scenario;
  const input = request;
  const episode = input && input.episodeAuthority;
  const requestedBoundary = input && input.requestedBoundary;
  const acceptedBoundary = input && input.acceptedBoundary;
  const owner = input && input.primaryOwner;
  if (!contextMatch) push('CONTINUATION_ACCEPTED_AUTHORITY_READBACK');
  if (!rule.eligiblePrimaryOwners.includes(owner) || rule.excludedAutonomousOwners.includes(owner)) {
    push('CONTINUATION_PRIMARY_OWNER_NOT_ELIGIBLE');
  }
  if (!input || input.PRODUCT_SEMANTICS_PROVEN_BAD !== 'NO') {
    push('CONTINUATION_PRODUCT_CORRECTION_NOT_AUTHORISED');
  }
  const independentlyAcceptedAuthority = scenario && scenario.episodeAuthority;
  const acceptedState = scenario && scenario.currentStateReadback;
  const expectedTrustedContext = contextMatch && contextMatch.replacement
    ? S1A_ORACLE_HOSTED_REPLACEMENT_TRUSTED_CONTEXT
    : scenario && scenario.trustedContext;
  if (!expectedTrustedContext || !s1aSame(trustedContext, expectedTrustedContext)) {
    push('CONTINUATION_ACCEPTED_AUTHORITY_READBACK');
  }
  const attribution = trustedContext && trustedContext.attributionReadback;
  if (!scenario || !s1aSame(attribution, scenario.attributionReadback) ||
      !attribution || attribution.primaryOwner !== owner ||
      attribution.productSemanticsProvenBad !== 'NO' ||
      !attribution.authoritative || !attribution.current || !attribution.readBack) {
    push('CONTINUATION_ACCEPTED_AUTHORITY_READBACK');
  }
  const episodeKindAccepted = episode && typeof episode.episodeKind === 'string' &&
    episode.episodeKind.trim().length > 0 && episode.explicitWebBound === true &&
    Boolean(independentlyAcceptedAuthority);
  const episodeValid = s1aHasExactKeys(episode, S1A_ORACLE_CONTINUATION_EPISODE_FIELDS) &&
    episode.source === S1A_ORACLE_CONTINUATION_AUTHORITY_SOURCE &&
    episode.authoritative === true && episode.current === true && episode.readBack === true &&
    episodeKindAccepted && episode.primaryOwner === owner &&
    s1aSame(episode, independentlyAcceptedAuthority) &&
    s1aNonBlankString(episode.episodeId) && s1aNonBlankString(episode.authorityReference) &&
    s1aNonBlankString(episode.runId) && s1aNonBlankString(episode.lockId) &&
    episode.digest === s1aHashWithoutField(episode, 'digest');
  const acceptedBoundaryFields = rule.acceptedBoundaryBinding.requiredFields;
  const acceptedBoundaryBound = Boolean(scenario) &&
    s1aHasExactKeys(acceptedBoundary, acceptedBoundaryFields) &&
    s1aSame(acceptedBoundary, scenario.acceptedBoundary) &&
    rule.acceptedBoundaryBinding.episodeFields.every((field) =>
      s1aSame(acceptedBoundary && acceptedBoundary[field], episode && episode[field]));
  if (!episodeValid || !acceptedBoundaryBound ||
      !s1aHasExactKeys(requestedBoundary, S1A_ORACLE_CONTINUATION_BOUNDARY_FIELDS) ||
      !S1A_ORACLE_CONTINUATION_BOUNDARY_FIELDS.every((field) =>
        s1aSame(requestedBoundary && requestedBoundary[field], episode && episode[field]))) {
    push('CONTINUATION_AUTHORITY_SCOPE_BOUNDARY');
  }
  const stateRule = rule.currentStateReadback;
  const stateReadback = input && input[stateRule.inputField];
  const acceptedAuthorityReadback = stateReadback && stateReadback.acceptedEpisodeAuthority;
  if (!independentlyAcceptedAuthority ||
      !s1aSame(episode, independentlyAcceptedAuthority) ||
      !s1aSame(acceptedAuthorityReadback, independentlyAcceptedAuthority) ||
      owner !== independentlyAcceptedAuthority.primaryOwner) {
    push('CONTINUATION_ACCEPTED_AUTHORITY_READBACK');
  }
  const stateReadbackValid = Boolean(acceptedState) &&
    s1aHasExactKeys(stateReadback, stateRule.requiredFields) &&
    stateReadback.source === stateRule.source && stateReadback.authoritative === true &&
    stateReadback.current === true && stateReadback.complete === true && stateReadback.readBack === true &&
    stateReadback.digest === s1aHashWithoutField(stateReadback, 'digest') &&
    s1aSame(stateReadback, acceptedState) &&
    s1aSame(trustedContext && trustedContext.currentStateReadback, acceptedState);
  if (!stateReadbackValid) push('CONTINUATION_CURRENT_STATE_READBACK');
  const historyComplete = Boolean(acceptedState) && Array.isArray(input && input.history) &&
    input.history.length > 0 && Array.isArray(stateReadback && stateReadback.history) &&
    s1aSame(input.history, stateReadback.history) &&
    s1aSame(stateReadback.history, acceptedState.history);
  if (!historyComplete) push('CONTINUATION_HISTORY_INCOMPLETE');
  const identityBeforeMatches = Boolean(acceptedState) &&
    s1aSame(input && input.candidateBefore, acceptedState.candidateIdentity) &&
    s1aSame(input && input.evidenceBefore, acceptedState.evidenceIdentity) &&
    s1aSame(input && input.evidenceBefore && input.evidenceBefore.candidateIdentity,
      acceptedState.candidateIdentity) &&
    s1aSame(input && input.currentFailureSignature, acceptedState.currentFailureSignature) &&
    s1aSame(episode && episode.episodeId, acceptedState.episodeId);
  if (!identityBeforeMatches) push('CONTINUATION_CANDIDATE_EVIDENCE_IDENTITY');
  const attempts = input && input.attempts;
  const attemptStateMatches = Boolean(acceptedState) && stateRule.attemptFields.every((field) =>
    attempts && Number.isSafeInteger(attempts[field + 'Before']) &&
    attempts[field + 'Before'] === acceptedState.attemptState[field]);
  if (!attemptStateMatches) push('CONTINUATION_ATTEMPT_BUDGET_RESET');
  const effects = input && input.effectReconciliation;
  const effectFields = rule.effectReconciliation.requiredFields;
  if (!s1aHasExactKeys(effects, effectFields) ||
      effects.source !== S1A_ORACLE_CONTINUATION_EFFECT_SOURCE ||
      effects.authoritative !== true || effects.current !== true || effects.complete !== true ||
      effects.readBack !== true || !Array.isArray(effects.effects) ||
      effects.effects.some((effect) => !effect || typeof effect.effectId !== 'string' ||
        effect.state !== rule.effectReconciliation.acceptedEffectState ||
        typeof effect.evidenceRef !== 'string' || effect.evidenceRef.length === 0) ||
      effects.digest !== s1aCanonicalContinuationEffects(effects).digest ||
      !acceptedState || !s1aSame(s1aCanonicalContinuationEffects(effects),
        acceptedState[rule.effectReconciliation.independentReadbackField]) ||
      !scenario || !s1aSame(s1aCanonicalContinuationEffects(effects), scenario.effectReconciliation) ||
      !s1aSame(s1aCanonicalContinuationEffects(trustedContext && trustedContext.effectReconciliation),
        scenario.effectReconciliation)) {
    push('CONTINUATION_EFFECTS_UNRECONCILED');
  }
  const paths = input && input.faithfulPathInventory;
  const pathFields = rule.faithfulPathInventory.requiredFields;
  const pathRecordFields = rule.faithfulPathInventory.pathFields;
  const pathHasBoundIdentityEvidence = paths && Array.isArray(paths.paths) && paths.paths.some((path) =>
    s1aHasExactKeys(path, pathRecordFields) &&
    s1aNonBlankString(path.pathId) && s1aNonBlankString(path.actualPath) &&
    s1aNonBlankString(path.evidenceRef) &&
    path.evidenceBoundaryId === (episode && episode.evidenceBoundaryId) &&
    s1aSame(path.candidateIdentity, input.candidateBefore));
  const pathRemains = pathHasBoundIdentityEvidence && paths.paths.some((path) =>
    path.faithful === true && path.available === true);
  const inventoryDigestBound = Boolean(acceptedState) && paths &&
    paths.digest === acceptedState.faithfulPathInventoryDigest &&
    scenario && s1aSame(paths, scenario.faithfulPathInventory) &&
    s1aSame(trustedContext && trustedContext.faithfulPathInventory, scenario.faithfulPathInventory);
  if (!pathHasBoundIdentityEvidence || !inventoryDigestBound) {
    push('CONTINUATION_FAITHFUL_PATH_USABILITY');
  }
  if (!s1aHasExactKeys(paths, pathFields) ||
      paths.source !== S1A_ORACLE_CONTINUATION_PATH_SOURCE ||
      paths.authoritative !== true || paths.current !== true || paths.complete !== true ||
      paths.readBack !== true || !pathRemains || !inventoryDigestBound ||
      paths.digest !== s1aHashWithoutField(paths, 'digest')) {
    push('CONTINUATION_FAITHFUL_PATH_EXHAUSTED');
  }
  const currentSignature = input && input.currentFailureSignature;
  const equivalentNoProgress = Array.isArray(input && input.history) && input.history.some((entry) =>
    entry && entry.outcome === 'NO_PROGRESS' &&
    s1aEquivalentContinuationFailure(currentSignature, entry.signature, rule.equivalenceFields));
  if (!currentSignature || equivalentNoProgress) push('CONTINUATION_EQUIVALENT_NO_PROGRESS');
  if (!episode || !currentSignature ||
      currentSignature.rootFamilyId !== episode.rootFamilyId || currentSignature.primaryOwner !== owner ||
      currentSignature.evidenceBoundaryId !== episode.evidenceBoundaryId) {
    push('CONTINUATION_ROOT_TRUST_SCOPE_MISMATCH');
  }
  const candidateAndEvidenceSame = input && input.mode === 'IDENTITY_PRESERVING' &&
    s1aSame(input.candidateBefore, input.candidateAfter) &&
    s1aSame(input.evidenceBefore, input.evidenceAfter) &&
    s1aSame(input.evidenceBefore && input.evidenceBefore.candidateIdentity, input.candidateBefore) &&
    identityBeforeMatches && !contextMatch?.replacement &&
    scenario && s1aSame(trustedContext.candidateReadback, scenario.candidateReadback) &&
    s1aSame(trustedContext.evidenceReadback, scenario.evidenceReadback) &&
    trustedContext.permittedEffect === scenario.spec.permittedEffect;
  let replacementValid = false;
  if (input && input.mode === 'HOSTED_VALIDATION_RECLOSURE') {
    const authorityResult = s1aReplacementAuthorityIsValid(input, trustedContext);
    const candidateResult = s1aReplacementCandidateIsValid(input, trustedContext);
    if (!authorityResult.ok) push(S1A_ORACLE_CONTINUATION_RELATIONS.REPLACEMENT);
    if (!candidateResult.ok) push(S1A_ORACLE_CONTINUATION_RELATIONS.REPLACEMENT_CANDIDATE_VALIDITY);
    replacementValid = authorityResult.ok && candidateResult.ok && Boolean(contextMatch?.replacement);
  } else if (!candidateAndEvidenceSame) {
    push('CONTINUATION_CANDIDATE_EVIDENCE_IDENTITY');
    if (input && input.replacementAuthorityClaim !== null) {
      push(S1A_ORACLE_CONTINUATION_RELATIONS.REPLACEMENT);
    }
  }
  const counterFields = [
    'attemptCountBefore', 'attemptCountAfter', 'attemptLimitBefore', 'attemptLimitAfter',
    'productCorrectionAttemptsBefore', 'productCorrectionAttemptsAfter',
    'productCorrectionLimitBefore', 'productCorrectionLimitAfter',
    'budgetConsumedBefore', 'budgetConsumedAfter', 'budgetLimitBefore', 'budgetLimitAfter'
  ];
  const counters = attempts && counterFields.every((key) =>
    Number.isSafeInteger(attempts[key]) && attempts[key] >= 0);
  const withinAcceptedLimits = counters &&
    attempts.attemptCountAfter <= attempts.attemptLimitAfter &&
    attempts.productCorrectionAttemptsAfter <= attempts.productCorrectionLimitAfter &&
    attempts.budgetConsumedAfter <= attempts.budgetLimitAfter;
  if (!withinAcceptedLimits) push('CONTINUATION_ATTEMPT_LIMIT_EXCEEDED');
  const noReset = counters && withinAcceptedLimits && attempts.reset === false &&
    attempts.attemptCountAfter >= attempts.attemptCountBefore &&
    attempts.attemptLimitAfter <= attempts.attemptLimitBefore &&
    attempts.productCorrectionAttemptsAfter === attempts.productCorrectionAttemptsBefore &&
    attempts.productCorrectionLimitAfter <= attempts.productCorrectionLimitBefore &&
    attempts.budgetConsumedAfter >= attempts.budgetConsumedBefore &&
    attempts.budgetLimitAfter <= attempts.budgetLimitBefore &&
    (input.mode !== 'HOSTED_VALIDATION_RECLOSURE' ||
      attempts.productCorrectionAttemptsAfter === attempts.productCorrectionAttemptsBefore);
  if (!noReset) push('CONTINUATION_ATTEMPT_BUDGET_RESET');
  const attemptEffects = counters ? {
    attemptsConsumedBefore: attempts.attemptCountBefore,
    attemptsConsumedAfter: attempts.attemptCountAfter,
    productCorrectionsBefore: attempts.productCorrectionAttemptsBefore,
    productCorrectionsAfter: attempts.productCorrectionAttemptsAfter
  } : null;
  const budgetEffects = counters ? {
    budgetConsumedBefore: attempts.budgetConsumedBefore,
    budgetConsumedAfter: attempts.budgetConsumedAfter,
    budgetLimitBefore: attempts.budgetLimitBefore,
    budgetLimitAfter: attempts.budgetLimitAfter
  } : null;
  const accepted = failures.length === 0;
  return {
    admission: accepted ? 'ADMIT_BOUNDED_CONTINUATION' : 'RETURN_TO_WEB',
    ok: accepted, violatedObligationIds: failures,
    candidateTransition: !accepted ? 'NO_ACCEPTED_TRANSITION' :
      (replacementValid ? 'CREATE_DISTINCT_WEB_AUTHORISED_REPLACEMENT' : 'PRESERVE_EXACT_IDENTITY'),
    evidenceTransition: !accepted ? 'NO_ACCEPTED_TRANSITION' :
      (replacementValid ? 'PRESERVE_FAILED_EVIDENCE_AND_BIND_NEW_REVALIDATION' : 'PRESERVE_EXACT_IDENTITY'),
    attemptEffects, budgetEffects,
    mutationEffects: accepted ? [replacementValid ?
      S1A_ORACLE_REPLACEMENT_EFFECT : scenario.spec.permittedEffect] : []
  };
}
function observeS1aContinuationSource(source, request, trustedContext, claimedDigest = s1aGovernedHumanPolicyDigest(source)) {
  const policy = s1aInterpretPolicyContract(source);
  const result = evaluateS1aContinuation(policy, request, trustedContext);
  result.governedProseDigest = claimedDigest;
  for (const id of s1aContinuationProseViolations(source)) {
    if (!result.violatedObligationIds.includes(id)) result.violatedObligationIds.push(id);
  }
  result.ok = result.violatedObligationIds.length === 0;
  result.admission = result.ok ? 'ADMIT_BOUNDED_CONTINUATION' : 'RETURN_TO_WEB';
  if (!result.ok) {
    result.candidateTransition = 'NO_ACCEPTED_TRANSITION';
    result.evidenceTransition = 'NO_ACCEPTED_TRANSITION';
    result.mutationEffects = [];
  }
  return result;
}
test('S1-A post-child checkpoint requires canonical identity, current inputs, and terminal blind reports', () => {
  const policy = parseS1aPolicyContract(architecture);
  const valid = makeS1aReviewFixture();
  const result = evaluateS1aPostChildReview(policy, valid);
  assert.equal(result.ok, true, result.failures.join(','));
  assert.equal(result.frontierEffect, 'DEPENDENT_NEXT_CHILD');
  assert.ok(valid.trace.indexOf('MERGE_TRIGGERED_CI_STARTED') < valid.trace.indexOf('REVIEW_A_STARTED'));
  assert.ok(valid.trace.indexOf('REVIEW_B_STARTED') < valid.trace.indexOf('APPLICABLE_CHECKS_TERMINAL'),
    'reviews can launch while merge CI checks remain pending');
  for (const event of ['REPORT_A_TERMINAL', 'REPORT_B_TERMINAL', 'TERMINAL_RECEIPTS_TERMINAL',
    'APPLICABLE_CHECKS_TERMINAL']) {
    assert.ok(valid.trace.indexOf(event) < valid.trace.indexOf('WEB_ADJUDICATION'), event);
  }

  const completedChild = s1aClone(valid);
  completedChild.childState.lifecycle = 'COMPLETED';
  completedChild.childState.revision = 'child:revision-13';
  completedChild.childState.stateDigest =
    s1aHashWithoutField(completedChild.childState, 'stateDigest');
  completedChild.reviews.forEach((review) => {
    review.childStateRevision = completedChild.childState.revision;
    review.childStateDigest = completedChild.childState.stateDigest;
  });
  assert.equal(evaluateS1aPostChildReview(policy, completedChild).ok, true,
    'a fixed completed child-state readback remains admissible');

  const missingParentReadback = s1aClone(valid);
  delete missingParentReadback.parentContract.readBack;
  assert.equal(evaluateS1aPostChildReview(policy, missingParentReadback).ok, false);

  const wrongParent = s1aClone(valid);
  wrongParent.parentContract.body = 'stale parent contract';
  wrongParent.parentContract.bodyDigest = s1aHashText(wrongParent.parentContract.body);
  assert.equal(evaluateS1aPostChildReview(policy, wrongParent).ok, false);

  const retiredChild = s1aClone(valid);
  retiredChild.childState.lifecycle = 'RETIRED';
  retiredChild.childState.stateDigest = s1aHashWithoutField(retiredChild.childState, 'stateDigest');
  assert.equal(evaluateS1aPostChildReview(policy, retiredChild).ok, false);

  const wrongChild = s1aClone(valid);
  wrongChild.childState.childId = 'child:another';
  wrongChild.childState.stateDigest = s1aHashWithoutField(wrongChild.childState, 'stateDigest');
  assert.equal(evaluateS1aPostChildReview(policy, wrongChild).ok, false);

  const coMutatedIdentityAndChild = s1aClone(valid);
  coMutatedIdentityAndChild.identity.deliveryChildId = 'child:another';
  coMutatedIdentityAndChild.integratedIdentityReadback.deliveryChildId = 'child:another';
  coMutatedIdentityAndChild.integratedIdentityReadback.digest =
    s1aHashWithoutField(coMutatedIdentityAndChild.integratedIdentityReadback, 'digest');
  coMutatedIdentityAndChild.childState.childId = 'child:another';
  coMutatedIdentityAndChild.childState.stateDigest =
    s1aHashWithoutField(coMutatedIdentityAndChild.childState, 'stateDigest');
  assert.equal(evaluateS1aPostChildReview(policy, coMutatedIdentityAndChild).ok, false);

  const sameRouteDifferentLabels = s1aClone(valid);
  sameRouteDifferentLabels.reviews[1].reviewerId = 'reviewer:separate';
  sameRouteDifferentLabels.reviews[1].contextId = 'context:separate';
  for (const field of ['provider', 'model', 'reasoning']) {
    sameRouteDifferentLabels.reviews[1][field] = sameRouteDifferentLabels.reviews[0][field];
  }
  assert.equal(evaluateS1aPostChildReview(policy, sameRouteDifferentLabels).ok, false);

  const coMutatedRouteAuthority = s1aClone(valid);
  coMutatedRouteAuthority.reviewRouteAuthority.routes[1] =
    s1aClone(coMutatedRouteAuthority.reviewRouteAuthority.routes[0]);
  coMutatedRouteAuthority.reviewRouteAuthority.digest =
    s1aHashWithoutField(coMutatedRouteAuthority.reviewRouteAuthority, 'digest');
  assert.equal(evaluateS1aPostChildReview(policy, coMutatedRouteAuthority).ok, false);

  const noReceipt = s1aClone(valid);
  noReceipt.receipts.pop();
  assert.equal(evaluateS1aPostChildReview(policy, noReceipt).ok, false);

  const pendingCheck = s1aClone(valid);
  pendingCheck.checks[0].terminal = false;
  assert.equal(evaluateS1aPostChildReview(policy, pendingCheck).ok, false);

  const oneReport = s1aClone(valid);
  oneReport.reviews.pop();
  oneReport.trace = oneReport.trace.filter((event) =>
    event !== 'REVIEW_B_STARTED' && event !== 'REPORT_B_TERMINAL');
  assert.equal(evaluateS1aPostChildReview(policy, oneReport).ok, false);

  const earlyAdjudication = s1aClone(valid);
  const webIndex = earlyAdjudication.trace.indexOf('WEB_ADJUDICATION');
  earlyAdjudication.trace.splice(webIndex, 1);
  const checksIndex = earlyAdjudication.trace.indexOf('APPLICABLE_CHECKS_TERMINAL');
  earlyAdjudication.trace.splice(checksIndex, 0, 'WEB_ADJUDICATION');
  assert.equal(evaluateS1aPostChildReview(policy, earlyAdjudication).ok, false);

  const earlyPeerVisibility = s1aClone(valid);
  const reportIndex = earlyPeerVisibility.trace.indexOf('REPORT_A_TERMINAL');
  earlyPeerVisibility.trace.splice(reportIndex + 1, 0, 'REPORT_A_VISIBLE_TO_B');
  assert.equal(evaluateS1aPostChildReview(policy, earlyPeerVisibility).ok, false);

  const staleCurrentReadback = s1aClone(valid);
  staleCurrentReadback.childState.current = false;
  staleCurrentReadback.childState.revision = 'child:old-revision';
  staleCurrentReadback.childState.stateDigest =
    s1aHashWithoutField(staleCurrentReadback.childState, 'stateDigest');
  staleCurrentReadback.reviews.forEach((review) => {
    review.childStateRevision = staleCurrentReadback.childState.revision;
    review.childStateDigest = staleCurrentReadback.childState.stateDigest;
  });
  assert.equal(evaluateS1aPostChildReview(policy, staleCurrentReadback).ok, false,
    'non-current canonical child state is rejected after reports are coherently rebound');

  const staleRevisionRebound = s1aClone(valid);
  staleRevisionRebound.childState.revision = 'child:old-revision';
  staleRevisionRebound.childState.stateDigest =
    s1aHashWithoutField(staleRevisionRebound.childState, 'stateDigest');
  staleRevisionRebound.reviews.forEach((review) => {
    review.childStateRevision = staleRevisionRebound.childState.revision;
    review.childStateDigest = staleRevisionRebound.childState.stateDigest;
  });
  assert.equal(evaluateS1aPostChildReview(policy, staleRevisionRebound).ok, false,
    'caller-rehashed old child state cannot replace the fixed current readback');

  for (const fieldValue of [false, 0, [], {}]) {
    const malformedReviewer = s1aClone(valid);
    malformedReviewer.reviews[0].reviewerId = fieldValue;
    malformedReviewer.reviews[0].contextId = fieldValue;
    assert.equal(evaluateS1aPostChildReview(policy, malformedReviewer).ok, false,
      'reviewer and context identities must be nonempty strings');
  }
});

test('S1-A post-child fixed oracle rejects every declared identity and snapshot mutation', () => {
  const results = observeS1aPostChildOracle(parseS1aPolicyContract(architecture));
  assert.deepEqual(results.filter((item) => item.expected !== item.observed).map((item) => item.id), []);
  assert.equal(results.find((item) => item.id === 'post-child-complete-positive').observed, true);
  for (const field of S1A_ORACLE_REVIEW_SNAPSHOT_FIELDS) {
    assert.equal(results.find((item) => item.id === 'post-child-snapshot-' + field).observed, false);
  }
});

test('S1-A policy source sensitivity rejects weakened blocker effects', () => {
  const weakened = rewriteS1aPolicy(architecture, (policy) => {
    policy.blocker.allowedEffects = policy.blocker.allowedEffects.filter((effect) =>
      effect !== 'MATERIALLY_UNSAFE');
  });
  assert.throws(() => parseS1aPolicyContract(weakened),
    /blocker effect set is incomplete/);
});
test('S1-A source prose rejects polarity, appended contradiction, and coherent machine weakening', () => {
  const failClosed = 'If any field is missing or contradictory, do not admit this disposition; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.';
  const equivalentFailClosed = 'If any field is missing or contradictory, this disposition must fail closed; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.';
  const equivalentConstruction = architecture.replace(failClosed, equivalentFailClosed);
  assert.notEqual(equivalentConstruction, architecture);
  assert.equal(s1aGovernedHumanPolicyDigest(equivalentConstruction), S1A_ORACLE_GOVERNED_PROSE_SHA256);
  assert.doesNotThrow(() => parseS1aPolicyContract(equivalentConstruction));

  const blockerPolarity = architecture.replace(failClosed,
    failClosed.replace('do not admit this disposition', 'admit this disposition'));
  assert.throws(() => parseS1aPolicyContract(blockerPolarity), /blocker prose must fail closed/);

  const blockerContradiction = architecture.replace(failClosed,
    failClosed + ' Contradiction: admit a blocker even if a required field is missing.');
  assert.throws(() => parseS1aPolicyContract(blockerContradiction), /blocker prose must fail closed/);

  const coherentBlockerWeakening = rewriteS1aPolicy(architecture, (policy) => {
    policy.blocker.typedPaths['SHIP_NOW_CONSEQUENCE.description'] = 'PRESENT_VALUE';
  }).replace(
    '| SHIP_NOW_CONSEQUENCE | Concrete, evidence-backed consequence of shipping the current candidate against that criterion or floor. |',
    '| SHIP_NOW_CONSEQUENCE | A present value describing shipping consequences. |'
  );
  assert.throws(() => parseS1aPolicyContract(coherentBlockerWeakening),
    /blocker value types or authoritative admission readback are incomplete/);

  const postChildTerminal = 'Both reports, terminal receipts and all applicable checks must be terminal before Web adjudication.';
  const postChildPolarity = architecture.replace(postChildTerminal,
    'Web may adjudicate before both reports, terminal receipts and applicable checks are terminal.');
  assert.throws(() => parseS1aPolicyContract(postChildPolarity),
    /post-child prose must bind current inputs/);

  const postChildContradiction = architecture.replace(
    '### Bounded non-product continuation',
    'Contradiction: the parent programme contract is optional and Web may adjudicate before both reports.\n\n### Bounded non-product continuation'
  );
  assert.throws(() => parseS1aPolicyContract(postChildContradiction),
    /post-child prose must bind current inputs/);

  const appendedChildSummary = architecture.replace(
    '### Bounded non-product continuation',
    'A completed child state may be accepted from a child-local summary without a current canonical readback.\n\n### Bounded non-product continuation'
  );
  assert.throws(() => parseS1aPolicyContract(appendedChildSummary),
    /post-child prose must bind current inputs/);

  const waivedBlockerField = architecture.replace(
    '### Current-frontier effect and examples',
    'A missing or contradictory blocker field may be waived by the reviewer when the evidence seems persuasive.\n\n### Current-frontier effect and examples'
  );
  assert.throws(() => parseS1aPolicyContract(waivedBlockerField),
    /blocker prose must fail closed/);
  const paraphrasedChildSummary = architecture.replace(
    '### Bounded non-product continuation',
    'For a terminal child, a child-local summary suffices even if canonical state was never read back.\n\n### Bounded non-product continuation'
  );
  assert.throws(() => parseS1aPolicyContract(paraphrasedChildSummary),
    /fixed semantic oracle/);

  const paraphrasedBlockerWaiver = architecture.replace(
    '### Current-frontier effect and examples',
    'Web may classify a blocker with an omitted proof field after a manual waiver.\n\n### Current-frontier effect and examples'
  );
  assert.throws(() => parseS1aPolicyContract(paraphrasedBlockerWaiver),
    /fixed semantic oracle/);
  const faithfulClause = 'A carrier is faithful only when independently bound read-back evidence contains a terminal execution receipt from an actual invocation of the selected carrier path and accepted production path, and binds that exact carrier identity, accepted criterion, immutable candidate and enforcement boundary to its ordered run events and execution-evidence digest.';
  const carrierPolarity = architecture.replace(faithfulClause,
    'A carrier is faithful when its shape is equivalent without a terminal execution receipt.');
  assert.throws(() => parseS1aPolicyContract(carrierPolarity),
    /carrier prose must preserve inventory, execution, exposure, DNS\/domain and privacy semantics/);

  const carrierContradiction = architecture.replace(
    '### G1 re-convergence',
    'Contradiction: faithful by shape equivalence without a terminal execution receipt.\n\n### G1 re-convergence'
  );
  assert.throws(() => parseS1aPolicyContract(carrierContradiction),
    /carrier prose must preserve inventory, execution, exposure, DNS\/domain and privacy semantics/);
});
test('S1-A current-law review names current semantics and retains technical schema versions', () => {
  const section = s1aSection(architecture, '### Post-child integrated dual review');
  assert.match(section, /final integrated programme review occurs at the final Delivery Child checkpoint for this lifecycle/);
  assert.match(section, /does not replace pre-merge G4 or a separately required Final Audit/);
  assert.doesNotMatch(section, /\bV2\b|super-audit/i);
  assert.match(controller, /stack-registry-v2\.json/);
  assert.equal(registry.schema, 'toolkit.controller.stack-registry.v2');
});

function rewriteS1aPolicyForObserver(source, mutate) {
  const match=/~~~s1a-policy-contract-v1\r?\n([\s\S]*?)\r?\n~~~/.exec(source);
  if(!match)throw new Error('missing observer policy');
  const policy=JSON.parse(match[1]);mutate(policy);
  return source.replace(match[0],'~~~s1a-policy-contract-v1\n'+JSON.stringify(policy,null,2)+'\n~~~');
}
function appendS1aContradiction(source,heading,text) {
  const start=source.indexOf(heading),end=source.indexOf('\n',start);
  if(start<0||end<0)throw new Error('missing contradiction heading '+heading);
  return source.slice(0,end+1)+'\n'+text+'\n'+source.slice(end+1);
}
function replaceS1aSourceClause(source,from,to) {
  if(!source.includes(from))throw new Error('missing source clause '+from);
  return source.replace(from,to);
}
function observeS1aContinuation(source, request, trustedContext = s1aContinuationTrustedContext()) {
  return observeS1aContinuationSource(source, request, trustedContext);
}
function observeS1aOtherAcceptedWebContinuation(source, request) {
  return observeS1aContinuationSource(source, request,
    s1aContinuationTrustedContext('OTHER_WEB_BOUNDED_EVIDENCE_EPISODE_TOOLKIT'));
}
function observeS1aCarrierAcceptedWebContinuation(source, request) {
  return observeS1aContinuationSource(source, request,
    s1aContinuationTrustedContext('OWNER_ACCEPTED_CARRIER_EVIDENCE_REPLAY'));
}
function observeS1aCarrier(source,input) {
  return observeS1aCarrierSource(source,input,s1aGovernedHumanPolicyDigest(source));
}
function s1aObservedViolations(result) { return result.violatedObligationIds||result.failures||[]; }
function assertS1aSixControlClasses(relation,positive,controls) {
  const check=(name,result,expected,obligation)=>{
    assert.equal(result.ok,expected,relation+'/'+name+' outcome');
    const ids=s1aObservedViolations(result);
    if(expected)assert.deepEqual(ids,[],relation+'/'+name+' stays green');
    else {
      assert.ok(ids.includes(obligation),relation+'/'+name+' missed '+obligation+': '+ids.join(','));
      assert.doesNotMatch(ids.join('|'),/PARSER|HASH|DIGEST/i,relation+'/'+name+' used unrelated failure');
      if(name==='coherent') {
        assert.equal(typeof result.governedProseDigest,'string',relation+'/coherent must report the rebound prose digest');
        assert.notEqual(result.governedProseDigest,S1A_ORACLE_GOVERNED_PROSE_SHA256,
          relation+'/coherent must independently rebind changed prose');
      }
    }
  };
  check('positive',positive(),true);
  assert.deepEqual(Object.keys(controls).sort(),['coherent','contradiction','equivalent','polarity','removal'].sort());
  for(const name of ['removal','polarity','contradiction','equivalent','coherent']) {
    const item=controls[name];check(name,item.run(),item.ok,item.obligation);
  }
}
function s1aAssertReplacementRejected(name, expectedObligations, relation, mutate, preservedPaths = null) {
  const fixture = makeS1aHostedReplacementContinuationFixture('TOOLKIT');
  const baselineRequest = s1aClone(fixture.request);
  const baselineContext = s1aClone(fixture.trustedContext);
  const baseline = observeS1aContinuationSource(architecture, baselineRequest, baselineContext);
  assert.equal(baseline.ok, true, name + ' baseline must pass: ' + s1aObservedViolations(baseline));
  const caseValue = {
    source: architecture,
    request: s1aClone(baselineRequest),
    trustedContext: s1aClone(baselineContext)
  };
  mutate(caseValue);
  assert.notEqual(s1aCanonical({
    source: caseValue.source, request: caseValue.request, trustedContext: caseValue.trustedContext
  }), s1aCanonical({
    source: architecture, request: baselineRequest, trustedContext: baselineContext
  }), name + ' mutation must change the tested state');
  const commonRequest = [
    'request.episodeAuthority', 'request.acceptedBoundary', 'request.requestedBoundary',
    'request.currentStateReadback', 'request.history', 'request.currentFailureSignature',
    'request.candidateBefore', 'request.evidenceBefore', 'request.attempts',
    'request.effectReconciliation', 'request.faithfulPathInventory'
  ];
  const defaults = relation === 'REPLACEMENT_AUTHORITY'
    ? ['trustedContext.candidateReadback', 'trustedContext.evidenceReadback', ...commonRequest]
    : ['trustedContext.currentAuthority', ...commonRequest];
  const valueAt = (root, keyPath) => keyPath.split('.').reduce((value, key) =>
    value == null ? undefined : value[key], root);
  for (const keyPath of preservedPaths || defaults) {
    assert.deepEqual(valueAt(caseValue, keyPath), valueAt({
      request: baselineRequest, trustedContext: baselineContext
    }, keyPath), name + ' preserves unrelated prerequisite ' + keyPath);
  }
  const result = observeS1aContinuationSource(
    caseValue.source, caseValue.request, caseValue.trustedContext,
    s1aGovernedHumanPolicyDigest(caseValue.source));
  assert.equal(result.ok, false, name + ' must be rejected');
  for (const obligation of Array.isArray(expectedObligations) ? expectedObligations : [expectedObligations]) {
    assert.ok(s1aObservedViolations(result).includes(obligation),
      name + ' must fail intended obligation ' + obligation + ': ' + s1aObservedViolations(result));
  }
  assert.doesNotMatch(s1aObservedViolations(result).join('|'), /PARSER|HASH|DIGEST/i,
    name + ' must not use parser/hash-only detection');
  assert.deepEqual(result.mutationEffects, [], name + ' rejection must have no mutation effect');
  assert.equal(result.candidateTransition, 'NO_ACCEPTED_TRANSITION',
    name + ' rejection must have no accepted candidate transition');
  assert.equal(result.evidenceTransition, 'NO_ACCEPTED_TRANSITION',
    name + ' rejection must have no accepted evidence transition');
  return result;
}
function s1aReplacementEquivalentContext(source = architecture) {
  const fixture = makeS1aHostedReplacementContinuationFixture('TOOLKIT');
  const reordered = Object.fromEntries(Object.entries(fixture.trustedContext).reverse());
  reordered.currentAuthority = Object.fromEntries(Object.entries(reordered.currentAuthority).reverse());
  reordered.currentAuthority.replacementPermission =
    Object.fromEntries(Object.entries(reordered.currentAuthority.replacementPermission).reverse());
  reordered.candidateReadback = Object.fromEntries(Object.entries(reordered.candidateReadback).reverse());
  reordered.evidenceReadback = Object.fromEntries(Object.entries(reordered.evidenceReadback).reverse());
  assert.notEqual(reordered, fixture.trustedContext, 'equivalent context is independently constructed');
  assert.equal(s1aCanonical(reordered), s1aCanonical(fixture.trustedContext),
    'equivalent context preserves every trusted value');
  return observeS1aContinuationSource(source, fixture.request, reordered);
}
function makeS1aHostedReplacementContinuationFixture(owner='TOOLKIT') {
  const trustedContext = s1aClone(S1A_ORACLE_HOSTED_REPLACEMENT_TRUSTED_CONTEXT);
  const input = makeS1aContinuationFixture({ owner });
  input.mode = 'HOSTED_VALIDATION_RECLOSURE';
  input.correctionMechanism = 'TOOLKIT_VALIDATION';
  input.replacementAuthorityClaim = s1aClone(trustedContext.currentAuthority);
  input.candidateAfter = s1aClone(trustedContext.candidateReadback.identity);
  input.evidenceAfter = {
    evidenceId: trustedContext.evidenceReadback.evidenceId,
    digest: trustedContext.evidenceReadback.evidenceDigest,
    candidateIdentity: s1aClone(trustedContext.evidenceReadback.candidateIdentity),
    revalidationBoundaryId: trustedContext.evidenceReadback.revalidationBoundary
  };
  input.requestedMutationScope = s1aClone(trustedContext.candidateReadback.observedMutationScope);
  input.replacementCandidateImmutable = true;
  input.durableFailedCandidates = [{
    immutable: true, preserved: true,
    candidateIdentity: s1aClone(input.candidateBefore),
    evidenceIdentity: s1aClone(input.evidenceBefore)
  }];
  return { request: input, trustedContext };
}

test('S1-A continuation owner/product boundary six-control matrix',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_OWNER_PRODUCT_BOUNDARY',
    ()=>observeS1aContinuation(architecture,s1aClone(f)),{
      removal:{ok:false,obligation:'CONTINUATION_OWNER_PRODUCT_BOUNDARY',run:()=>observeS1aContinuation(
        rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.eligiblePrimaryOwners=
          p.boundedContinuation.eligiblePrimaryOwners.filter(x=>x!=='TRANSPORT')),s1aClone(f))},
      polarity:{ok:false,obligation:'CONTINUATION_PRODUCT_CORRECTION_NOT_AUTHORISED',run:()=>{const i=s1aClone(f);
        i.PRODUCT_SEMANTICS_PROVEN_BAD='YES';return observeS1aContinuation(architecture,i);}},
      contradiction:{ok:false,obligation:'CONTINUATION_OWNER_PRODUCT_BOUNDARY',run:()=>observeS1aContinuation(
        appendS1aContradiction(architecture,'### Bounded non-product continuation',
          'Contradiction: PRODUCT or UNKNOWN may continue autonomously.'),s1aClone(f))},
      equivalent:{ok:false,obligation:'CONTINUATION_PRIMARY_OWNER_NOT_ELIGIBLE',run:()=>observeS1aContinuation(
        architecture,makeS1aContinuationFixture({owner:'UNKNOWN'}))},
      coherent:{ok:false,obligation:'CONTINUATION_OWNER_PRODUCT_BOUNDARY',run:()=>{
        let s=rewriteS1aPolicyForObserver(architecture,p=>{p.boundedContinuation.eligiblePrimaryOwners.push('PRODUCT');
          p.boundedContinuation.excludedAutonomousOwners=['UNKNOWN'];});
        s=replaceS1aSourceClause(s,'PRODUCT or UNKNOWN never grants autonomous continuation',
          'PRODUCT may continue autonomously and UNKNOWN remains excluded.');
        return observeS1aContinuation(s,s1aClone(f));}}
    });
  for(const owner of ['PRODUCT','UNKNOWN'])assert.ok(observeS1aContinuation(architecture,
    makeS1aContinuationFixture({owner})).violatedObligationIds.includes('CONTINUATION_PRIMARY_OWNER_NOT_ELIGIBLE'));
});

test('S1-A continuation episode/scope six-control matrix and general Web-bounded episodes',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_EPISODE_SCOPE_AUTHORITY',
    ()=>observeS1aContinuation(architecture,s1aClone(f)),{
      removal:{ok:false,obligation:'CONTINUATION_EPISODE_SCOPE_AUTHORITY',run:()=>observeS1aContinuation(
        rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.acceptedBoundaryBinding.episodeFields=
          p.boundedContinuation.acceptedBoundaryBinding.episodeFields.filter(x=>x!=='scopeId')),s1aClone(f))},
      polarity:{ok:false,obligation:'CONTINUATION_AUTHORITY_SCOPE_BOUNDARY',run:()=>{
        const i=s1aClone(f);i.acceptedBoundary.scopeId='scope:expanded';
        i.acceptedBoundary.digest=s1aHashWithoutField(i.acceptedBoundary,'digest');
        i.episodeAuthority.scopeId='scope:expanded';i.episodeAuthority.digest=s1aHashWithoutField(i.episodeAuthority,'digest');
        i.requestedBoundary.scopeId='scope:expanded';return observeS1aContinuation(architecture,i);}},
      contradiction:{ok:false,obligation:'CONTINUATION_EPISODE_SCOPE_AUTHORITY',run:()=>observeS1aContinuation(
        appendS1aContradiction(architecture,'### Bounded non-product continuation',
          'Contradiction: the episode may widen root, trust, scope, floor, or evidence boundary.'),s1aClone(f))},
      equivalent:{ok:true,run:()=>{const generic=makeS1aContinuationFixture({scenario:'OTHER_WEB_BOUNDED_EVIDENCE_EPISODE_TOOLKIT'});
        return observeS1aOtherAcceptedWebContinuation(architecture,generic);}},
      coherent:{ok:false,obligation:'CONTINUATION_EPISODE_SCOPE_AUTHORITY',run:()=>{
        let s=rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.acceptedBoundaryBinding.mustRemainExact=false);
        s=replaceS1aSourceClause(s,'The current episode authority, primary owner, semantics, root, trust model, scope, assurance floor and accepted evidence boundary remain exact.',
          'The current episode may expand its root, trust, scope, floor and evidence boundary.');
        return observeS1aContinuation(s,s1aClone(f));}}
    });
  assert.equal(S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.episodeAuthority.kindBinding,
    'EXACT_CURRENT_INDEPENDENT_WEB_READBACK');
  assert.equal(S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.episodeAuthority.anyExplicitWebBoundKindAllowedWhenIndependentlyAccepted,true);
  const genericEpisode=makeS1aContinuationFixture({scenario:'OTHER_WEB_BOUNDED_EVIDENCE_EPISODE_TOOLKIT'});
  assert.equal(observeS1aOtherAcceptedWebContinuation(architecture,genericEpisode).ok,true,'generic accepted Web-bounded episode');
  const independentlyAcceptedCarrierEpisode=makeS1aContinuationFixture({scenario:'OWNER_ACCEPTED_CARRIER_EVIDENCE_REPLAY'});
  assert.equal(observeS1aCarrierAcceptedWebContinuation(architecture,independentlyAcceptedCarrierEpisode).ok,true,
    'previously unlisted Web-accepted episode and VALIDATION_CARRIER owner');
  const reboundKnownKind=s1aClone(f);
  reboundKnownKind.episodeAuthority.episodeKind='OTHER_WEB_BOUNDED_EVIDENCE_EPISODE';
  reboundKnownKind.episodeAuthority.digest=s1aHashWithoutField(reboundKnownKind.episodeAuthority,'digest');
  assert.ok(observeS1aContinuation(architecture,reboundKnownKind).violatedObligationIds
    .includes('CONTINUATION_ACCEPTED_AUTHORITY_READBACK'));
  for(const field of ['rootFamilyId','acceptedContractId','trustModelId','scopeId','assuranceFloorId','evidenceBoundaryId']){
    const i=s1aClone(f);i.acceptedBoundary[field]='expanded:'+field;
    i.acceptedBoundary.digest=s1aHashWithoutField(i.acceptedBoundary,'digest');
    i.episodeAuthority[field]='expanded:'+field;i.episodeAuthority.digest=s1aHashWithoutField(i.episodeAuthority,'digest');
    i.requestedBoundary[field]=i.episodeAuthority[field];
    assert.ok(observeS1aContinuation(architecture,i).violatedObligationIds.includes('CONTINUATION_AUTHORITY_SCOPE_BOUNDARY'),field);
  }
});

test('S1-A continuation accepted-authority readback six-control matrix',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_ACCEPTED_AUTHORITY_READBACK',
    ()=>observeS1aContinuation(architecture,s1aClone(f)),{
      removal:{ok:false,obligation:'CONTINUATION_ACCEPTED_AUTHORITY_READBACK',run:()=>observeS1aContinuation(
        rewriteS1aPolicyForObserver(architecture,p=>delete p.boundedContinuation.acceptedAuthorityBinding),
        s1aClone(f))},
      polarity:{ok:false,obligation:'CONTINUATION_ACCEPTED_AUTHORITY_READBACK',run:()=>{
        const i=s1aClone(f);i.primaryOwner='HARNESS';i.episodeAuthority.primaryOwner='HARNESS';
        i.episodeAuthority.digest=s1aHashWithoutField(i.episodeAuthority,'digest');
        return observeS1aContinuation(architecture,i);}},
      contradiction:{ok:false,obligation:'CONTINUATION_ACCEPTED_AUTHORITY_READBACK',run:()=>observeS1aContinuation(
        appendS1aContradiction(architecture,'### Bounded non-product continuation',
          'Contradiction: caller-rebound episode authority or owner may replace the accepted Web readback.'),s1aClone(f))},
      equivalent:{ok:true,run:()=>{const generic=makeS1aContinuationFixture({scenario:'OTHER_WEB_BOUNDED_EVIDENCE_EPISODE_TOOLKIT'});
        return observeS1aOtherAcceptedWebContinuation(architecture,generic);}},
      coherent:{ok:false,obligation:'CONTINUATION_ACCEPTED_AUTHORITY_READBACK',run:()=>{
        let s=rewriteS1aPolicyForObserver(architecture,p=>
          p.boundedContinuation.acceptedAuthorityBinding.mustMatchIndependentAcceptedReadback=false);
        s=replaceS1aSourceClause(s,
          'The episode kind and primary owner must match the independently accepted current Web authority readback.',
          'The episode kind and primary owner may be caller-rebound in the current Web authority readback.');
        const reboundDigest=s1aGovernedHumanPolicyDigest(s);
        const result=observeS1aContinuationSource(s,s1aClone(f),s1aContinuationTrustedContext(),reboundDigest);
        assert.equal(result.governedProseDigest,reboundDigest);
        assert.notEqual(reboundDigest,S1A_ORACLE_GOVERNED_PROSE_SHA256);
        return result;
      }}
    });
  assert.deepEqual(S1A_ORACLE_BOUNDED_CONTINUATION_POLICY.eligiblePrimaryOwners,
    ['HARNESS','TOOLKIT','ENVIRONMENT','VALIDATION_CARRIER','TRANSPORT']);
  const reboundOwner=s1aClone(f);reboundOwner.primaryOwner='HARNESS';
  reboundOwner.episodeAuthority.primaryOwner='HARNESS';
  reboundOwner.episodeAuthority.digest=s1aHashWithoutField(reboundOwner.episodeAuthority,'digest');
  assert.ok(observeS1aContinuation(architecture,reboundOwner).violatedObligationIds
    .includes('CONTINUATION_ACCEPTED_AUTHORITY_READBACK'));
  const unrecorded=makeS1aContinuationFixture({episodeKind:'UNRECORDED_WEB_EPISODE'});
  assert.ok(observeS1aContinuation(architecture,unrecorded).violatedObligationIds
    .includes('CONTINUATION_ACCEPTED_AUTHORITY_READBACK'));
});
test('S1-A continuation effects and faithful-path/progress six-control matrices',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_EFFECT_RECONCILIATION',()=>observeS1aContinuation(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CONTINUATION_EFFECTS_UNRECONCILED',run:()=>{const i=s1aClone(f);
      delete i.effectReconciliation.complete;i.effectReconciliation.digest=s1aHashWithoutField(i.effectReconciliation,'digest');
      return observeS1aContinuation(architecture,i);}},
    polarity:{ok:false,obligation:'CONTINUATION_EFFECTS_UNRECONCILED',run:()=>{const i=s1aClone(f);
      i.effectReconciliation.effects[0].state='UNRECONCILED';
      i.effectReconciliation.digest=s1aHashWithoutField(i.effectReconciliation,'digest');return observeS1aContinuation(architecture,i);}},
    contradiction:{ok:false,obligation:'CONTINUATION_EFFECT_RECONCILIATION',run:()=>observeS1aContinuation(
      appendS1aContradiction(architecture,'### Bounded non-product continuation','Contradiction: unreconciled effects may be ignored.'),s1aClone(f))},
    equivalent:{ok:true,run:()=>{const i=s1aClone(f);i.effectReconciliation.effects.reverse();
      i.effectReconciliation.digest=s1aCanonicalContinuationEffects(i.effectReconciliation).digest;
      return observeS1aContinuation(architecture,i);}},
    coherent:{ok:false,obligation:'CONTINUATION_EFFECT_RECONCILIATION',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.effectReconciliation.acceptedEffectState='IGNORED');
      s=replaceS1aSourceClause(s,'Independently reconcile effects and faithful-path inventory; an unreconciled effect or exhausted faithful path returns to Web.',
        'Effects may be ignored even when their authoritative readback is incomplete.');return observeS1aContinuation(s,s1aClone(f));}}
  });
  assertS1aSixControlClasses('CONTINUATION_FAITHFUL_PATH_PROGRESS',()=>observeS1aContinuation(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_PROGRESS',run:()=>observeS1aContinuation(
      rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.faithfulPathInventory.requiresRemainingFaithfulPath=false),s1aClone(f))},
    polarity:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_EXHAUSTED',run:()=>{const i=s1aClone(f);
      i.faithfulPathInventory.paths[0].available=false;
      i.faithfulPathInventory.digest=s1aHashWithoutField(i.faithfulPathInventory,'digest');return observeS1aContinuation(architecture,i);}},
    contradiction:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_PROGRESS',run:()=>observeS1aContinuation(
      appendS1aContradiction(architecture,'### Bounded non-product continuation','Contradiction: renamed no-progress history is new progress.'),s1aClone(f))},
    equivalent:{ok:false,obligation:'CONTINUATION_EQUIVALENT_NO_PROGRESS',run:()=>{const i=s1aClone(f);
      i.history.push({outcome:'NO_PROGRESS',signature:{...i.currentFailureSignature,runId:'renamed-run',workerId:'renamed-worker',
        branch:'renamed-branch',candidateIdentity:{commit:'renamed-commit',tree:'renamed-tree'},episodeId:'renamed-episode'}});
      return observeS1aContinuation(architecture,i);}},
    coherent:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_PROGRESS',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>{p.boundedContinuation.equivalenceIgnoresLabels=[];
        p.boundedContinuation.equivalenceFields=p.boundedContinuation.equivalenceFields.filter(x=>x!=='failedMechanism');});
      s=replaceS1aSourceClause(s,'Repeated materially equivalent no-progress history returns to Web even when run, worker, branch or candidate labels change.',
        'A no-progress result repeats only when run, worker, branch and candidate labels also stay equal.');return observeS1aContinuation(s,s1aClone(f));}}
  });
  const exhausted=s1aClone(f);exhausted.faithfulPathInventory.paths=[];
  exhausted.faithfulPathInventory.digest=s1aHashWithoutField(exhausted.faithfulPathInventory,'digest');
  assert.ok(observeS1aContinuation(architecture,exhausted).violatedObligationIds.includes('CONTINUATION_FAITHFUL_PATH_EXHAUSTED'));
});

test('S1-A continuation faithful-path usability six-control matrix',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_FAITHFUL_PATH_USABILITY',
    ()=>observeS1aContinuation(architecture,s1aClone(f)),{
      removal:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_USABILITY',run:()=>observeS1aContinuation(
        rewriteS1aPolicyForObserver(architecture,p=>{
          p.boundedContinuation.faithfulPathInventory.pathFields=
            p.boundedContinuation.faithfulPathInventory.pathFields.filter(field=>field!=='actualPath');
          p.boundedContinuation.faithfulPathInventory.pathInventoryDigestBoundToCurrentState=false;
        }),s1aClone(f))},
      polarity:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_USABILITY',run:()=>{
        const i=s1aClone(f);delete i.faithfulPathInventory.paths[0].actualPath;
        i.faithfulPathInventory.digest=s1aHashWithoutField(i.faithfulPathInventory,'digest');
        return observeS1aContinuation(architecture,i);}},
      contradiction:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_USABILITY',run:()=>observeS1aContinuation(
        appendS1aContradiction(architecture,'### Bounded non-product continuation',
          'Contradiction: a path without an actual path or evidence reference may continue.'),s1aClone(f))},
      equivalent:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_USABILITY',run:()=>{
        const i=s1aClone(f);i.faithfulPathInventory.paths[0].pathId='renamed-but-unproved-path';
        i.faithfulPathInventory.paths[0].actualPath='renamed-but-unproved-path';delete i.faithfulPathInventory.paths[0].evidenceRef;
        i.faithfulPathInventory.digest=s1aHashWithoutField(i.faithfulPathInventory,'digest');
        return observeS1aContinuation(architecture,i);}},
      coherent:{ok:false,obligation:'CONTINUATION_FAITHFUL_PATH_USABILITY',run:()=>{
        let s=rewriteS1aPolicyForObserver(architecture,p=>{
          p.boundedContinuation.faithfulPathInventory.pathFields=
            p.boundedContinuation.faithfulPathInventory.pathFields.filter(field=>!['actualPath','evidenceRef'].includes(field));
          p.boundedContinuation.faithfulPathInventory.pathInventoryDigestBoundToCurrentState=false;
        });
        s=replaceS1aSourceClause(s,
          'A remaining faithful path must have an exact non-empty path identity, actual path and evidence reference bound to the accepted candidate, evidence boundary and independent accepted-state inventory digest; missing or caller-rebound path evidence returns to Web.',
          'A remaining faithful path may use caller-supplied labels without actual-path evidence or accepted-state inventory binding.');
        const i=s1aClone(f);delete i.faithfulPathInventory.paths[0].actualPath;
        delete i.faithfulPathInventory.paths[0].evidenceRef;
        i.faithfulPathInventory.digest=s1aHashWithoutField(i.faithfulPathInventory,'digest');
        const reboundDigest=s1aGovernedHumanPolicyDigest(s);
        const result=observeS1aContinuationSource(s,i,s1aContinuationTrustedContext(),reboundDigest);
        assert.equal(result.governedProseDigest,reboundDigest);
        assert.notEqual(reboundDigest,S1A_ORACLE_GOVERNED_PROSE_SHA256);
        return result;
      }}
    });
});
test('S1-A continuation identity/budget and replacement six-control matrices',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_IDENTITY_BUDGET_PRESERVATION',()=>observeS1aContinuation(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CONTINUATION_IDENTITY_BUDGET_PRESERVATION',run:()=>observeS1aContinuation(
      rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.requiredConditions=
        p.boundedContinuation.requiredConditions.filter(x=>x!=='NO_ATTEMPT_OR_BUDGET_RESET')),s1aClone(f))},
    polarity:{ok:false,obligation:'CONTINUATION_ATTEMPT_BUDGET_RESET',run:()=>{const i=s1aClone(f);i.attempts.budgetConsumedAfter=6;
      return observeS1aContinuation(architecture,i);}},
    contradiction:{ok:false,obligation:'CONTINUATION_IDENTITY_BUDGET_PRESERVATION',run:()=>observeS1aContinuation(
      appendS1aContradiction(architecture,'### Bounded non-product continuation',
        'Contradiction: candidate, evidence, attempts, or consumed budgets may be reset.'),s1aClone(f))},
    equivalent:{ok:true,run:()=>{const i=s1aClone(f);i.candidateAfter={tree:i.candidateBefore.tree,commit:i.candidateBefore.commit};
      i.evidenceAfter={evidenceId:i.evidenceBefore.evidenceId,digest:i.evidenceBefore.digest,
        candidateIdentity:{tree:i.candidateBefore.tree,commit:i.candidateBefore.commit}};return observeS1aContinuation(architecture,i);}},
    coherent:{ok:false,obligation:'CONTINUATION_IDENTITY_BUDGET_PRESERVATION',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>p.boundedContinuation.attemptAndBudget.budgetSpentMayDecrease=true);
      s=replaceS1aSourceClause(s,'grant a new continuation, reset a budget','grant a new continuation, reset budgets when attempts are reissued');
      return observeS1aContinuation(s,s1aClone(f));}}
  });
  const changed=s1aClone(f);changed.candidateAfter.tree='substituted-tree';
  assert.ok(observeS1aContinuation(architecture,changed).violatedObligationIds.includes('CONTINUATION_CANDIDATE_EVIDENCE_IDENTITY'));

  const replacementPositive = () => {
    const fixture = makeS1aHostedReplacementContinuationFixture('TOOLKIT');
    return observeS1aContinuationSource(architecture, fixture.request, fixture.trustedContext);
  };
  assertS1aSixControlClasses('CONTINUATION_REPLACEMENT_AUTHORITY', replacementPositive, {
    removal: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_AUTHORITY',
      run: () => s1aAssertReplacementRejected('replacement authority removal',
        'CONTINUATION_REPLACEMENT_AUTHORITY', 'REPLACEMENT_AUTHORITY', value => {
          value.source = rewriteS1aPolicyForObserver(value.source, policy => {
            policy.boundedContinuation.replacementAuthority.requiresExactCurrentReadback = false;
          });
        })
    },
    polarity: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_AUTHORITY',
      run: () => s1aAssertReplacementRejected('transport owner polarity',
        'CONTINUATION_REPLACEMENT_AUTHORITY', 'REPLACEMENT_AUTHORITY', value => {
          value.request.primaryOwner = 'TRANSPORT';
          value.request.correctionMechanism = 'transport-validation';
        })
    },
    contradiction: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_AUTHORITY',
      run: () => s1aAssertReplacementRejected('caller-recomputed authority contradiction',
        'CONTINUATION_REPLACEMENT_AUTHORITY', 'REPLACEMENT_AUTHORITY', value => {
          value.source = appendS1aContradiction(value.source, '### Bounded non-product continuation',
            'Contradiction: caller-selected labels or caller-recomputed hashes or digests may select or establish authority.');
        })
    },
    equivalent: {
      ok: true, run: () => s1aReplacementEquivalentContext(architecture)
    },
    coherent: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_AUTHORITY',
      run: () => s1aAssertReplacementRejected('coherent authority weakening',
        'CONTINUATION_REPLACEMENT_AUTHORITY', 'REPLACEMENT_AUTHORITY', value => {
          value.source = rewriteS1aPolicyForObserver(value.source, policy => {
            policy.boundedContinuation.replacementAuthority.mustNotBeSelectedByCallerLabelsOrDigests = false;
          });
          value.source = replaceS1aSourceClause(value.source,
            'Caller-selected labels and caller-recomputed hashes or digests are equality assertions only; they never select or establish authority.',
            'Caller-selected labels and caller-recomputed hashes may establish authority when internally consistent.');
        })
    }
  });
  assertS1aSixControlClasses('CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', replacementPositive, {
    removal: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY',
      run: () => s1aAssertReplacementRejected('replacement candidate field removal',
        'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
          value.source = rewriteS1aPolicyForObserver(value.source, policy => {
            policy.boundedContinuation.replacementCandidateValidity.requiredFields =
              policy.boundedContinuation.replacementCandidateValidity.requiredFields
                .filter(field => field !== 'commitTreeReadback');
          });
        })
    },
    polarity: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY',
      run: () => s1aAssertReplacementRejected('candidate request identity polarity',
        'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
          value.request.candidateAfter.tree = '9999999999999999999999999999999999999999';
        })
    },
    contradiction: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY',
      run: () => s1aAssertReplacementRejected('hosted-local substitution contradiction',
        'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
          value.source = appendS1aContradiction(value.source, '### Bounded non-product continuation',
            'Contradiction: HOSTED and LOCAL bindings may be substituted for each other.');
        })
    },
    equivalent: {
      ok: true, run: () => s1aReplacementEquivalentContext(architecture)
    },
    coherent: {
      ok: false, obligation: 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY',
      run: () => s1aAssertReplacementRejected('coherent candidate validity weakening',
        'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
          value.source = rewriteS1aPolicyForObserver(value.source, policy => {
            const rule = policy.boundedContinuation.replacementCandidateValidity;
            rule.requiredFields = rule.requiredFields.filter(field =>
              !['commitTreeReadback', 'hostedBinding', 'localCustodyBinding',
                'predecessorPreservation', 'revalidationLinkage'].includes(field));
            rule.headMustMatchCommit = false;
            rule.commitTreeReadbackMustMatch = false;
            rule.observedMutationScopeMustFitAuthorityCeiling = false;
            rule.callerHashesAreEqualityAssertionsOnly = false;
          });
          value.source = replaceS1aSourceClause(value.source,
            'The independent candidate readback binds repository, HOSTED or LOCAL kind, object format, non-empty commit/head/tree identities, ordered parents, base commit, exact commit-to-tree readback, predecessor/base/parent lineage, kind-specific hosted PR/branch/head or local custody, observed mutation/effect scope, predecessor preservation and exact revalidation linkage.',
            'Caller-supplied labels and rehashed evidence may establish replacement identity, lineage, scope, predecessor preservation and revalidation.');
        })
    }
  });
  assert.equal(replacementPositive().ok, true, 'the fixed authorized replacement remains positive');
  assert.deepEqual(replacementPositive().mutationEffects, [S1A_ORACLE_REPLACEMENT_EFFECT],
    'the authorized replacement has only its explicit bounded effect');
  assert.ok(observeS1aContinuation(architecture,makeS1aHostedReplacementContinuationFixture('TRANSPORT').request,
    makeS1aHostedReplacementContinuationFixture('TRANSPORT').trustedContext)
    .violatedObligationIds.includes('CONTINUATION_REPLACEMENT_AUTHORITY'));
});

test('S1-A continuation independently binds seven positive Web-bounded episode readbacks', () => {
  const keys = [
    'G3_RUN_LOCK_TOOLKIT',
    'PARENT_OWNED_LIGHT_HARNESS',
    'OTHER_WEB_BOUNDED_EVIDENCE_EPISODE_TOOLKIT',
    'G3_RUN_LOCK_HARNESS',
    'G3_RUN_LOCK_ENVIRONMENT',
    'OWNER_ACCEPTED_CARRIER_EVIDENCE_REPLAY',
    'WEB_BOUNDED_TRANSPORT'
  ];
  const dimensions = {
    authority: [], episode: [], attribution: [], history: [], candidate: [],
    evidence: [], attempts: [], effect: [], context: []
  };
  for (const key of keys) {
    const scenario = S1A_ORACLE_CONTINUATION_READBACK_SCENARIOS[key];
    const request = makeS1aContinuationFixture({ scenario: key });
    const trustedContext = s1aContinuationTrustedContext(key);
    const result = observeS1aContinuationSource(architecture, request, trustedContext);
    assert.equal(result.ok, true, key + ' independently authorized positive: ' + s1aObservedViolations(result));
    assert.deepEqual(result.mutationEffects, [scenario.spec.permittedEffect], key + ' exact permitted effect');
    assert.equal(result.candidateTransition, 'PRESERVE_EXACT_IDENTITY', key + ' preserves its candidate');
    assert.equal(result.evidenceTransition, 'PRESERVE_EXACT_IDENTITY', key + ' preserves its evidence');
    const negativeRequest = s1aClone(request);
    const negativeContext = s1aClone(trustedContext);
    const reboundOwner = scenario.spec.primaryOwner === 'TOOLKIT' ? 'HARNESS' : 'TOOLKIT';
    negativeRequest.primaryOwner = reboundOwner;
    negativeContext.attributionReadback.primaryOwner = reboundOwner;
    negativeContext.attributionReadback.digest =
      s1aHashWithoutField(negativeContext.attributionReadback, 'digest');
    const negative = observeS1aContinuationSource(architecture, negativeRequest, negativeContext);
    assert.equal(negative.ok, false, key + ' same-boundary coordinated owner/readback rebind is rejected');
    assert.ok(s1aObservedViolations(negative).includes('CONTINUATION_ACCEPTED_AUTHORITY_READBACK'),
      key + ' rejects owner/readback rebind on accepted-authority relation: ' + s1aObservedViolations(negative));
    assert.deepEqual(negative.mutationEffects, [], key + ' rejected continuation has no mutation effects');
    assert.equal(negative.candidateTransition, 'NO_ACCEPTED_TRANSITION', key + ' rejected continuation has no candidate transition');
    assert.equal(negative.evidenceTransition, 'NO_ACCEPTED_TRANSITION', key + ' rejected continuation has no evidence transition');
    if (key === 'PARENT_OWNED_LIGHT_HARNESS') {
      assert.deepEqual(trustedContext.parentOwnershipReadback, scenario.spec.parentOwnershipReadback,
        'LIGHT authority independently includes its parent-owned operation readback');
    } else {
      assert.equal(trustedContext.parentOwnershipReadback, null, key + ' has no borrowed parent ownership');
    }
    dimensions.authority.push(s1aCanonical([
      trustedContext.currentAuthority.webAuthorityIdentity,
      trustedContext.currentAuthority.webAuthorityRevision,
      trustedContext.currentAuthority.webAuthorityContent
    ]));
    dimensions.episode.push(s1aCanonical(trustedContext.currentAuthority.episodeAuthority));
    dimensions.attribution.push(s1aCanonical(trustedContext.attributionReadback));
    dimensions.history.push(s1aCanonical(request.history));
    dimensions.candidate.push(s1aCanonical(scenario.candidateIdentity));
    dimensions.evidence.push(s1aCanonical(scenario.evidenceIdentity));
    dimensions.attempts.push(s1aCanonical(scenario.attemptState));
    dimensions.effect.push(s1aCanonical([scenario.spec.permittedEffect]));
    dimensions.context.push(s1aCanonical(trustedContext));
  }
  for (const [dimension, values] of Object.entries(dimensions)) {
    assert.equal(new Set(values).size, keys.length,
      'accepted positive scenarios independently bind distinct ' + dimension);
  }
});


test('S1-A replacement readbacks reject rehashed, stale, replayed, and mismatched candidates', () => {
  const commonPreserved = [
    'request.episodeAuthority', 'request.acceptedBoundary', 'request.requestedBoundary',
    'request.currentStateReadback', 'request.history', 'request.currentFailureSignature',
    'request.candidateBefore', 'request.evidenceBefore', 'request.attempts',
    'request.effectReconciliation', 'request.faithfulPathInventory'
  ];
  const authorityCase = (name, mutate, syncClaim = true) =>
    s1aAssertReplacementRejected(name, 'CONTINUATION_REPLACEMENT_AUTHORITY',
      'REPLACEMENT_AUTHORITY', value => {
        mutate(value);
        if (syncClaim) {
          value.trustedContext.currentAuthority.digest =
            s1aHashWithoutField(value.trustedContext.currentAuthority, 'digest');
          value.request.replacementAuthorityClaim =
            s1aClone(value.trustedContext.currentAuthority);
        }
      });
  const candidateCase = (name, mutate, expected = 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY',
    preserved = null) => s1aAssertReplacementRejected(name, expected,
      'REPLACEMENT_CANDIDATE_VALIDITY', value => {
        mutate(value);
        const candidate = value.trustedContext.candidateReadback;
        candidate.digest = s1aHashWithoutField(candidate, 'digest');
        if (candidate.identity) value.request.candidateAfter = s1aClone(candidate.identity);
      }, preserved || undefined);
  const evidenceCase = (name, mutate) => s1aAssertReplacementRejected(name,
    'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
      mutate(value);
      const evidence = value.trustedContext.evidenceReadback;
      evidence.digest = s1aHashWithoutField(evidence, 'digest');
      value.request.evidenceAfter = {
        evidenceId: evidence.evidenceId,
        digest: evidence.evidenceDigest,
        candidateIdentity: s1aClone(evidence.candidateIdentity),
        revalidationBoundaryId: evidence.revalidationBoundary
      };
    });
  const auth = value => value.trustedContext.currentAuthority;
  const candidate = value => value.trustedContext.candidateReadback;
  const evidence = value => value.trustedContext.evidenceReadback;
  const refreshCandidate = value => {
    candidate(value).digest = s1aHashWithoutField(candidate(value), 'digest');
    value.request.candidateAfter = s1aClone(candidate(value).identity);
  };
  const refreshEvidence = value => {
    evidence(value).digest = s1aHashWithoutField(evidence(value), 'digest');
    value.request.evidenceAfter = {
      evidenceId: evidence(value).evidenceId,
      digest: evidence(value).evidenceDigest,
      candidateIdentity: s1aClone(evidence(value).candidateIdentity),
      revalidationBoundaryId: evidence(value).revalidationBoundary
    };
  };
  const refreshAuthorityAndClaim = value => {
    auth(value).digest = s1aHashWithoutField(auth(value), 'digest');
    value.request.replacementAuthorityClaim = s1aClone(auth(value));
  };
  const otherObject = '9999999999999999999999999999999999999999';

  const detachedFixture = makeS1aHostedReplacementContinuationFixture('TOOLKIT');
  const detachedContextBefore = s1aClone(detachedFixture.trustedContext);
  detachedFixture.request.replacementAuthorityClaim.webAuthorityRevision = 'revision:caller-mutation';
  detachedFixture.request.candidateAfter.tree = otherObject;
  detachedFixture.request.evidenceAfter.digest = 'sha256:caller-mutation';
  assert.deepEqual(detachedFixture.trustedContext, detachedContextBefore,
    'request mutation cannot mutate independently supplied authority, candidate, or evidence context');

  const aliasAttacks = [
    ['request claim aliases authority', 'CONTINUATION_REPLACEMENT_AUTHORITY', fixture => {
      const before = fixture.request.replacementAuthorityClaim;
      fixture.request.replacementAuthorityClaim = fixture.trustedContext.currentAuthority;
      return [before, fixture.request.replacementAuthorityClaim];
    }],
    ['request candidate aliases candidate readback', 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', fixture => {
      const before = fixture.request.candidateAfter;
      fixture.request.candidateAfter = fixture.trustedContext.candidateReadback.identity;
      return [before, fixture.request.candidateAfter];
    }],
    ['request evidence aliases evidence readback', 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', fixture => {
      const before = fixture.request.evidenceAfter.candidateIdentity;
      fixture.request.evidenceAfter.candidateIdentity = fixture.trustedContext.evidenceReadback.candidateIdentity;
      return [before, fixture.request.evidenceAfter.candidateIdentity];
    }]
  ];
  for (const [name, obligation, createAlias] of aliasAttacks) {
    const fixture = makeS1aHostedReplacementContinuationFixture('TOOLKIT');
    const [before, after] = createAlias(fixture);
    assert.notStrictEqual(before, after, name + ' changes object identity');
    const result = observeS1aContinuationSource(architecture, fixture.request, fixture.trustedContext);
    assert.equal(result.ok, false, name + ' is rejected');
    assert.ok(s1aObservedViolations(result).includes(obligation),
      name + ' fails its intended semantic obligation: ' + s1aObservedViolations(result));
    assert.doesNotMatch(s1aObservedViolations(result).join('|'), /PARSER|HASH|DIGEST/i,
      name + ' is not rejected by parser/hash-only failure');
    assert.deepEqual(result.mutationEffects, [], name + ' has no replacement effect');
    assert.equal(result.candidateTransition, 'NO_ACCEPTED_TRANSITION');
    assert.equal(result.evidenceTransition, 'NO_ACCEPTED_TRANSITION');
  }

  s1aAssertReplacementRejected('missing current replacement authority readback',
    'CONTINUATION_REPLACEMENT_AUTHORITY', 'REPLACEMENT_AUTHORITY', value => {
      delete value.trustedContext.currentAuthority;
    });
  authorityCase('caller self-rehashed Web identity', value => {
    auth(value).webAuthorityIdentity = 'web-authority:caller-rebound';
    auth(value).webAuthorityRevision = 'revision:caller-rebound';
    auth(value).webAuthorityContent = 'caller supplied matching text';
  });
  authorityCase('stale replacement authority', value => {
    auth(value).current = false;
    auth(value).currentness.current = false;
  });
  authorityCase('revoked replacement authority', value => {
    auth(value).currentness.revoked = true;
  });
  authorityCase('superseded replacement authority', value => {
    auth(value).currentness.superseded = true;
  });
  authorityCase('missing current RUN binding', value => { delete auth(value).run; });
  authorityCase('missing replacement path ceiling', value => { delete auth(value).pathEffectCeiling; });
  authorityCase('expired replacement authority', value => {
    auth(value).lifetime.observedAt = '2027-01-02T00:00:00Z';
  });
  authorityCase('wrong authority repository', value => {
    auth(value).repository = 'attacker/other-repo';
  });
  authorityCase('wrong authority episode', value => {
    auth(value).episode.episodeId = 'episode:other';
  });
  authorityCase('wrong authority RUN', value => {
    auth(value).run.runId = 'run:other';
  });
  authorityCase('wrong authority Lock', value => {
    auth(value).lock.lockId = 'lock:other';
  });
  authorityCase('wrong authority owner and mechanism', value => {
    auth(value).eligibleOwner = 'ENVIRONMENT';
    auth(value).correctionMechanism = 'ENVIRONMENT_VALIDATION';
    auth(value).replacementPermission.eligibleOwner = 'ENVIRONMENT';
    auth(value).replacementPermission.correctionMechanism = 'ENVIRONMENT_VALIDATION';
  });
  authorityCase('consumed permission replay', value => {
    auth(value).replacementPermission.state = 'CONSUMED';
    auth(value).replacementPermission.usesRemaining = 0;
    auth(value).permissionConsumption.state = 'CONSUMED';
    auth(value).permissionConsumption.usesRemaining = 0;
  });
  authorityCase('caller self-asserted authority claim', value => {
    value.request.replacementAuthorityClaim.webAuthorityRevision = 'revision:caller-selected';
    value.request.replacementAuthorityClaim.digest =
      s1aHashWithoutField(value.request.replacementAuthorityClaim, 'digest');
  }, false);
  authorityCase('requested effect outside authority ceiling', value => {
    value.request.requestedMutationScope.effects = ['UNAUTHORISED_EXTERNAL_WRITE'];
  });

  s1aAssertReplacementRejected('missing independent candidate readback',
    'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
      delete value.trustedContext.candidateReadback;
    });
  s1aAssertReplacementRejected('missing independent evidence readback',
    'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
      delete value.trustedContext.evidenceReadback;
    });
  candidateCase('blank candidate head', value => {
    candidate(value).head = '';
    candidate(value).identity.head = '';
    candidate(value).hostedBinding.headSha = '';
  });
  candidateCase('blank candidate tree', value => {
    candidate(value).tree = '';
    candidate(value).identity.tree = '';
    candidate(value).commitTreeReadback.tree = '';
  });
  candidateCase('valid head with mismatched tree readback', value => {
    candidate(value).tree = otherObject;
    candidate(value).identity.tree = otherObject;
  });
  candidateCase('wrong replacement predecessor lineage', value => {
    candidate(value).lineage.predecessorCandidateIdentity.commit = otherObject;
  });
  candidateCase('wrong replacement base lineage', value => {
    candidate(value).baseCommit = otherObject;
    candidate(value).identity.baseCommit = otherObject;
    candidate(value).hostedBinding.baseCommit = otherObject;
    candidate(value).lineage.baseCommit = otherObject;
  });
  candidateCase('wrong replacement parent lineage', value => {
    candidate(value).orderedParents = [otherObject];
    candidate(value).identity.orderedParents = [otherObject];
    candidate(value).commitTreeReadback.orderedParents = [otherObject];
    candidate(value).lineage.orderedParents = [otherObject];
    candidate(value).lineage.predecessorCandidateIdentity.commit = otherObject;
  });
  candidateCase('hosted PR binding rebound from candidate identity', value => {
    candidate(value).hostedBinding.prNumber = 494;
  });
  candidateCase('hosted branch binding rebound from candidate identity', value => {
    candidate(value).hostedBinding.branch = 'codex/other-branch';
  });
  candidateCase('hosted head binding rebound from candidate identity', value => {
    candidate(value).hostedBinding.headSha = otherObject;
  });
  candidateCase('unsupported candidate object format', value => {
    candidate(value).objectFormat = 'sha512';
    candidate(value).identity.objectFormat = 'sha512';
    candidate(value).commitTreeReadback.objectFormat = 'sha512';
  });
  candidateCase('wrong candidate repository', value => {
    candidate(value).repository = 'attacker/other-repo';
    candidate(value).identity.repository = 'attacker/other-repo';
    candidate(value).commitTreeReadback.repository = 'attacker/other-repo';
    candidate(value).lineage.repository = 'attacker/other-repo';
    candidate(value).hostedBinding.repository = 'attacker/other-repo';
  });
  for (const [name, field] of [
    ['wrong candidate episode', 'episodeId'],
    ['wrong candidate RUN', 'runId'],
    ['wrong candidate Lock', 'lockId']
  ]) {
    candidateCase(name, value => {
      candidate(value).lineage[field] = name + ':rebound';
    });
  }
  candidateCase('candidate mutation outside ceiling', value => {
    candidate(value).observedMutationScope.paths = ['repo/AGENTS.md'];
  });
  candidateCase('LOCAL candidate presented with HOSTED binding', value => {
    const record = candidate(value);
    record.kind = 'LOCAL';
    record.identity.kind = 'LOCAL';
    record.localCustodyBinding = {
      repository: record.repository, custodyId: 'custody:model', worktreeId: 'worktree:model',
      commit: record.commit, tree: record.tree, readBack: true
    };
  });
  candidateCase('HOSTED candidate presented with LOCAL custody', value => {
    const record = candidate(value);
    record.hostedBinding = null;
    record.localCustodyBinding = {
      repository: record.repository, custodyId: 'custody:model', worktreeId: 'worktree:model',
      commit: record.commit, tree: record.tree, readBack: true
    };
  });
  s1aAssertReplacementRejected('candidate request rebound to another tree',
    'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
      value.request.candidateAfter.tree = otherObject;
    });
  evidenceCase('copied predecessor evidence replay', value => {
    evidence(value).evidenceId = value.request.evidenceBefore.evidenceId;
    evidence(value).evidenceDigest = value.request.evidenceBefore.digest;
    evidence(value).candidateIdentity = s1aClone(value.request.candidateBefore);
  });
  evidenceCase('missing replacement revalidation evidence', value => {
    delete evidence(value).revalidationBoundary;
  });
  evidenceCase('swapped replacement revalidation evidence', value => {
    evidence(value).authorityIdentity = 'web-authority:other';
    evidence(value).authorityRevision = 'revision:other';
    evidence(value).revalidationBoundary = 'boundary:other';
    evidence(value).evidenceBoundaryId = 'boundary:other';
  });
  s1aAssertReplacementRejected('caller rebound evidence after readback',
    'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY', 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
      value.request.evidenceAfter.candidateIdentity = s1aClone(value.request.candidateBefore);
    });
  candidateCase('lost failed predecessor preservation', value => {
    candidate(value).predecessorPreservation.retained = false;
  });

  s1aAssertReplacementRejected('changed candidate plus rehashed caller authority and evidence', [
    'CONTINUATION_REPLACEMENT_AUTHORITY', 'CONTINUATION_REPLACEMENT_CANDIDATE_VALIDITY'
  ], 'REPLACEMENT_CANDIDATE_VALIDITY', value => {
    const record = candidate(value);
    record.commit = '6666666666666666666666666666666666666666';
    record.head = record.commit;
    record.tree = '5555555555555555555555555555555555555555';
    record.identity.commit = record.commit;
    record.identity.head = record.head;
    record.identity.tree = record.tree;
    record.commitTreeReadback.commit = record.commit;
    record.commitTreeReadback.tree = record.tree;
    record.hostedBinding.headSha = record.head;
    record.revalidationLinkage.replacementCandidateIdentity = s1aClone(record.identity);
    record.digest = s1aHashWithoutField(record, 'digest');
    evidence(value).candidateIdentity = s1aClone(record.identity);
    evidence(value).digest = s1aHashWithoutField(evidence(value), 'digest');
    auth(value).replacementCandidate = s1aClone(record.identity);
    auth(value).replacementPermission.replacementCandidateIdentity = s1aClone(record.identity);
    auth(value).replacementPermission.candidateReadbackDigest = record.digest;
    auth(value).replacementPermission.evidenceReadbackDigest = evidence(value).digest;
    refreshAuthorityAndClaim(value);
    value.request.candidateAfter = s1aClone(record.identity);
    refreshEvidence(value);
  }, commonPreserved);

  s1aAssertReplacementRejected('valid helper plus unrelated over-budget rejection',
    'CONTINUATION_ATTEMPT_LIMIT_EXCEEDED', 'REPLACEMENT_AUTHORITY', value => {
      assert.equal(s1aReplacementAuthorityIsValid(value.request, value.trustedContext).ok, true,
        'replacement authority helper remains valid before unrelated rejection');
      assert.equal(s1aReplacementCandidateIsValid(value.request, value.trustedContext).ok, true,
        'replacement candidate helper remains valid before unrelated rejection');
      value.request.attempts.attemptCountAfter = value.request.attempts.attemptLimitAfter + 1;
    }, commonPreserved.filter(field => field !== 'request.attempts'));
  const rejectedWithValidReplacement = (() => {
    const fixture = makeS1aHostedReplacementContinuationFixture('TOOLKIT');
    fixture.request.attempts.attemptCountAfter = fixture.request.attempts.attemptLimitAfter + 1;
    return observeS1aContinuationSource(architecture, fixture.request, fixture.trustedContext);
  })();
  assert.equal(rejectedWithValidReplacement.admission, 'RETURN_TO_WEB');
  assert.deepEqual(rejectedWithValidReplacement.mutationEffects, [],
    'unrelated rejection cannot retain a replacement mutation effect');
  assert.equal(rejectedWithValidReplacement.candidateTransition, 'NO_ACCEPTED_TRANSITION');
  assert.equal(rejectedWithValidReplacement.evidenceTransition, 'NO_ACCEPTED_TRANSITION');
});

test('S1-A continuation attempt and budget limits six-control matrix',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_ATTEMPT_LIMITS',
    ()=>observeS1aContinuation(architecture,s1aClone(f)),{
      removal:{ok:false,obligation:'CONTINUATION_ATTEMPT_LIMITS',run:()=>observeS1aContinuation(
        rewriteS1aPolicyForObserver(architecture,p=>
          p.boundedContinuation.attemptAndBudget.budgetConsumedMayExceedLimit=true),s1aClone(f))},
      polarity:{ok:false,obligation:'CONTINUATION_ATTEMPT_LIMIT_EXCEEDED',run:()=>{
        const i=s1aClone(f);i.attempts.attemptCountAfter=6;i.attempts.budgetConsumedAfter=11;
        return observeS1aContinuation(architecture,i);}},
      contradiction:{ok:false,obligation:'CONTINUATION_ATTEMPT_LIMITS',run:()=>observeS1aContinuation(
        appendS1aContradiction(architecture,'### Bounded non-product continuation',
          'Contradiction: attempt, product-correction or consumed-budget counts may exceed their accepted limits and continue.'),s1aClone(f))},
      equivalent:{ok:false,obligation:'CONTINUATION_ATTEMPT_LIMIT_EXCEEDED',run:()=>{
        const i=s1aClone(f);i.attempts.productCorrectionAttemptsAfter=4;
        return observeS1aContinuation(architecture,i);}},
      coherent:{ok:false,obligation:'CONTINUATION_ATTEMPT_LIMITS',run:()=>{
        let s=rewriteS1aPolicyForObserver(architecture,p=>{
          p.boundedContinuation.attemptAndBudget.attemptCountMayExceedLimit=true;
          p.boundedContinuation.attemptAndBudget.productCorrectionsMayExceedLimit=true;
          p.boundedContinuation.attemptAndBudget.budgetConsumedMayExceedLimit=true;
          p.boundedContinuation.attemptAndBudget.overLimitResult='ADMIT_BOUNDED_CONTINUATION';
        });
        s=replaceS1aSourceClause(s,
          'Attempt, product-correction and consumed-budget counts may not exceed their accepted limits; any over-limit count returns to Web.',
          'Attempt, product-correction and consumed-budget counts may exceed their accepted limits and continue.');
        const i=s1aClone(f);i.attempts.attemptCountAfter=6;i.attempts.budgetConsumedAfter=11;
        const reboundDigest=s1aGovernedHumanPolicyDigest(s);
        const result=observeS1aContinuationSource(s,i,s1aContinuationTrustedContext(),reboundDigest);
        assert.equal(result.governedProseDigest,reboundDigest);
        assert.notEqual(reboundDigest,S1A_ORACLE_GOVERNED_PROSE_SHA256);
        return result;
      }}
    });
  const atLimit=s1aClone(f);atLimit.attempts.attemptCountAfter=5;
  atLimit.attempts.budgetConsumedAfter=10;
  assert.equal(observeS1aContinuation(architecture,atLimit).ok,true,
    'consumption at, but not above, an accepted limit remains within the bound');
});
test('S1-A continuation current accepted-state readback six-control matrix',()=>{
  const f=makeS1aContinuationFixture();
  assertS1aSixControlClasses('CONTINUATION_CURRENT_STATE_READBACK',()=>observeS1aContinuation(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CONTINUATION_CURRENT_STATE_READBACK',run:()=>{const i=s1aClone(f);
      delete i.currentStateReadback;return observeS1aContinuation(architecture,i);}},
    polarity:{ok:false,obligation:'CONTINUATION_HISTORY_INCOMPLETE',run:()=>{const i=s1aClone(f);
      i.history=[];return observeS1aContinuation(architecture,i);}},
    contradiction:{ok:false,obligation:'CONTINUATION_CURRENT_STATE_READBACK',run:()=>observeS1aContinuation(
      appendS1aContradiction(architecture,'### Bounded non-product continuation',
        'Contradiction: partial caller history may replace the authoritative readback.'),s1aClone(f))},
    equivalent:{ok:false,obligation:'CONTINUATION_EQUIVALENT_NO_PROGRESS',run:()=>{const i=s1aClone(f);
      i.history.push({outcome:'NO_PROGRESS',signature:{...i.currentFailureSignature,runId:'rebound-run',
        workerId:'rebound-worker',branch:'rebound-branch',candidateIdentity:{commit:'rebound-commit',tree:'rebound-tree'},
        episodeId:'rebound-episode'}});return observeS1aContinuation(architecture,i);}},
    coherent:{ok:false,obligation:'CONTINUATION_CURRENT_STATE_READBACK',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>{
        p.boundedContinuation.currentStateReadback.requiredFields=
          p.boundedContinuation.currentStateReadback.requiredFields.filter(field=>field!=='history');
        p.boundedContinuation.currentStateReadback.historyMustMatchExactly=false;
      });
      s=replaceS1aSourceClause(s,
        'Omitted, stale, partial or caller-rebound authority, history, identities, counters or limits return to Web.',
        'A caller-provided partial history may replace the accepted state readback.');
      const reboundDigest=s1aGovernedHumanPolicyDigest(s);
      const result=observeS1aContinuationSource(s,s1aClone(f),s1aContinuationTrustedContext(),reboundDigest);
      assert.equal(result.governedProseDigest,reboundDigest);
      assert.notEqual(reboundDigest,S1A_ORACLE_GOVERNED_PROSE_SHA256);
      return result;
    }}
  });

  const omittedHistory=s1aClone(f);delete omittedHistory.history;
  assert.ok(observeS1aContinuation(architecture,omittedHistory).violatedObligationIds
    .includes('CONTINUATION_HISTORY_INCOMPLETE'));

  const reboundIdentity=s1aClone(f);
  reboundIdentity.candidateBefore={commit:'rebound-candidate',tree:'rebound-tree'};
  reboundIdentity.candidateAfter=s1aClone(reboundIdentity.candidateBefore);
  reboundIdentity.evidenceBefore={evidenceId:'rebound-evidence',digest:'rebound-evidence-digest',
    candidateIdentity:s1aClone(reboundIdentity.candidateBefore)};
  reboundIdentity.evidenceAfter=s1aClone(reboundIdentity.evidenceBefore);
  reboundIdentity.faithfulPathInventory.paths[0].candidateIdentity=s1aClone(reboundIdentity.candidateBefore);
  reboundIdentity.faithfulPathInventory.digest=s1aHashWithoutField(reboundIdentity.faithfulPathInventory,'digest');
  const identityResult=observeS1aContinuation(architecture,reboundIdentity);
  assert.ok(identityResult.violatedObligationIds.includes('CONTINUATION_CANDIDATE_EVIDENCE_IDENTITY'));

  const resetCounters=s1aClone(f);
  for(const field of ['attemptCount','productCorrectionAttempts','budgetConsumed']){
    resetCounters.attempts[field+'Before']=0;resetCounters.attempts[field+'After']=0;
  }
  const resetResult=observeS1aContinuation(architecture,resetCounters);
  assert.ok(resetResult.violatedObligationIds.includes('CONTINUATION_ATTEMPT_BUDGET_RESET'));

  const reboundReadback=s1aClone(f);
  reboundReadback.currentStateReadback.candidateIdentity={commit:'rebound-candidate',tree:'rebound-tree'};
  reboundReadback.currentStateReadback.evidenceIdentity={evidenceId:'rebound-evidence',
    digest:'rebound-evidence-digest',candidateIdentity:s1aClone(reboundReadback.currentStateReadback.candidateIdentity)};
  reboundReadback.currentStateReadback.currentFailureSignature.candidateIdentity=
    s1aClone(reboundReadback.currentStateReadback.candidateIdentity);
  reboundReadback.currentStateReadback.digest=s1aHashWithoutField(reboundReadback.currentStateReadback,'digest');
  const readbackResult=observeS1aContinuation(architecture,reboundReadback);
  assert.ok(readbackResult.violatedObligationIds.includes('CONTINUATION_CURRENT_STATE_READBACK'));
});
test('S1-A carrier inventory/order six-control matrix uses authoritative readback, not app-per-repository',()=>{
  const f=makeS1aCarrierFixture();
  assertS1aSixControlClasses('CARRIER_AUTHORITATIVE_INVENTORY_ORDER',()=>observeS1aCarrier(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CARRIER_AUTHORITATIVE_INVENTORY_READBACK',run:()=>{const i=s1aClone(f);
      i.authoritativeInventory.complete=false;i.authoritativeInventory.digest=s1aHashWithoutField(i.authoritativeInventory,'digest');
      return observeS1aCarrier(architecture,i);}},
    polarity:{ok:false,obligation:'CARRIER_AUTHORITATIVE_INVENTORY_ORDER',run:()=>observeS1aCarrier(
      rewriteS1aPolicyForObserver(architecture,p=>p.faithfulCarrier.selectionOrder=['AUTHORIZED_EXISTING_OWNER','LOCAL_DEV','NEW_OWNER_PROVISIONED']),s1aClone(f))},
    contradiction:{ok:false,obligation:'CARRIER_AUTHORITATIVE_INVENTORY_ORDER',run:()=>observeS1aCarrier(
      appendS1aContradiction(architecture,'### Faithful validation carrier','Contradiction: caller-supplied availability is authoritative.'),s1aClone(f))},
    equivalent:{ok:true,run:()=>{const i=makeS1aCarrierFixture('provisioned');
      i.options.LOCAL_DEV={available:true,authorized:true,claimedEquivalent:true};
      i.options.AUTHORIZED_EXISTING_OWNER={available:true,authorized:true,claimedEquivalent:true};
      return observeS1aCarrier(architecture,i);}},
    coherent:{ok:false,obligation:'CARRIER_AUTHORITATIVE_INVENTORY_ORDER',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>{p.faithfulCarrier.inventory.localFirstWhenFaithful=false;
        p.faithfulCarrier.inventory.reconcileExistingBeforeProvisioning=false;});
      s=replaceS1aSourceClause(s,'Select faithful local/dev first, then reconcile suitable existing Owner-authorised execution infrastructure, and provision or expand only after that reconciliation proves necessity.',
        'Select existing Owner-authorised infrastructure first, then consider local/dev, and provision when convenient.');
      return observeS1aCarrier(s,s1aClone(f));}}
  });
  assert.equal(observeS1aCarrier(architecture,s1aClone(f)).selected,'LOCAL_DEV');
  assert.equal(observeS1aCarrier(architecture,makeS1aCarrierFixture('existing')).selected,'AUTHORIZED_EXISTING_OWNER');
  const provisioned=makeS1aCarrierFixture('provisioned');
  provisioned.options.LOCAL_DEV={available:true,authorized:true,claimedEquivalent:true};
  assert.equal(observeS1aCarrier(architecture,provisioned).selected,'NEW_OWNER_PROVISIONED');
  assert.match(architecture,/A carrier is an execution substrate, not one dedicated test application per repository/);
});

test('S1-A carrier execution-evidence six-control matrix binds candidate/path/enforcement readback',()=>{
  const f=makeS1aCarrierFixture();
  assertS1aSixControlClasses('CARRIER_EXECUTION_EVIDENCE_BINDING',()=>observeS1aCarrier(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CARRIER_EXECUTION_EVIDENCE_BINDING',run:()=>{const i=s1aClone(f);
      delete i.acceptedBoundaryEvidence;return observeS1aCarrier(architecture,i);}},
    polarity:{ok:false,obligation:'CARRIER_EXECUTION_EVIDENCE_BINDING',run:()=>{const i=s1aClone(f);
      i.acceptedBoundaryEvidence.receipt.enforcementBoundary='OTHER_BOUNDARY';
      i.acceptedBoundaryEvidence.receipt.receiptDigest=s1aHashWithoutField(i.acceptedBoundaryEvidence.receipt,'receiptDigest');
      i.acceptedBoundaryEvidence.digest=s1aHashWithoutField(i.acceptedBoundaryEvidence,'digest');
      return observeS1aCarrier(architecture,i);}},
    contradiction:{ok:false,obligation:'CARRIER_EXECUTION_EVIDENCE_BINDING',run:()=>observeS1aCarrier(
      appendS1aContradiction(architecture,'### Faithful validation carrier','Contradiction: equivalent shape alone proves boundary exercise.'),s1aClone(f))},
    equivalent:{ok:false,obligation:'CARRIER_EXECUTION_EVIDENCE_BINDING',run:()=>{const i=s1aClone(f);
      delete i.acceptedBoundaryEvidence;i.options.LOCAL_DEV.exercisedBoundaryId='ACCEPTED_PRODUCTION_BOUNDARY';
      i.options.LOCAL_DEV.boundaryEvidence=['self-asserted:equivalent'];return observeS1aCarrier(architecture,i);}},
    coherent:{ok:false,obligation:'CARRIER_EXECUTION_EVIDENCE_BINDING',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>p.faithfulCarrier.boundaryExercise.requiredFields=
        p.faithfulCarrier.boundaryExercise.requiredFields.filter(x=>x!=='enforcementBoundary'));
      s=replaceS1aSourceClause(s,
        'A carrier is faithful only when independently bound read-back evidence contains a terminal execution receipt from an actual invocation of the selected carrier path and accepted production path, and binds that exact carrier identity, accepted criterion, immutable candidate and enforcement boundary to its ordered run events and execution-evidence digest.',
        'A carrier may be faithful when a receipt names its identity, criterion, candidate and ordered run events.');
      return observeS1aCarrier(s,s1aClone(f));}}
  });
});

test('S1-A carrier public-authority six-control matrix matches exact request fields',()=>{
  const f=makeS1aAuthorizedPublicCarrierFixture();
  assertS1aSixControlClasses('CARRIER_PUBLIC_AUTHORITY_MATCH',()=>observeS1aCarrier(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CARRIER_PUBLIC_AUTHORITY_MATCH',run:()=>{const i=s1aClone(f);
      delete i.exposureAuthority.cleanup;return observeS1aCarrier(architecture,i);}},
    polarity:{ok:false,obligation:'CARRIER_PUBLIC_AUTHORITY_MATCH',run:()=>{const i=s1aClone(f);
      i.publicExposureRequest.path='/unapproved';return observeS1aCarrier(architecture,i);}},
    contradiction:{ok:false,obligation:'CARRIER_PUBLIC_AUTHORITY_MATCH',run:()=>observeS1aCarrier(
      appendS1aContradiction(architecture,'### Faithful validation carrier','Contradiction: public request details need not match Owner authority.'),s1aClone(f))},
    equivalent:{ok:false,obligation:'CARRIER_PUBLIC_AUTHORITY_MATCH',run:()=>{const i=s1aClone(f);
      i.publicExposureRequest.consumer='renamed-consumer';i.exposureAuthority.consumer='renamed-consumer';
      i.exposureAuthority.digest=s1aHashWithoutField(i.exposureAuthority,'digest');return observeS1aCarrier(architecture,i);}},
    coherent:{ok:false,obligation:'CARRIER_PUBLIC_AUTHORITY_MATCH',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>{p.faithfulCarrier.publicExposureRequires=
        p.faithfulCarrier.publicExposureRequires.filter(x=>x!=='PATH');
        p.faithfulCarrier.publicExposureAuthority.requiredFields=p.faithfulCarrier.publicExposureAuthority.requiredFields.filter(x=>x!=='path');});
      s=replaceS1aSourceClause(s,
        'Public ingress is admissible only when a specific accepted validation criterion requires it and a current authoritative Owner/Web readback binds the exact exposure and public request, including consumer, protocol, path, hostname requirement and hostname, accepted criterion, necessity, audience, boundary, lifetime and cleanup.',
        'Public ingress is admissible when a criterion requires it and current authority binds exposure, audience, boundary, lifetime and cleanup.');
      return observeS1aCarrier(s,s1aClone(f));}}
  });
});

test('S1-A carrier domain/DNS six-control matrix requires separate operation authority',()=>{
  const f=makeS1aAuthorizedPublicCarrierFixture();
  assertS1aSixControlClasses('CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY',()=>observeS1aCarrier(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY',run:()=>{const i=s1aClone(f);
      delete i.dnsAuthority;return observeS1aCarrier(architecture,i);}},
    polarity:{ok:false,obligation:'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY',run:()=>{const i=s1aClone(f);
      i.dnsAuthority.authorityReference=i.domainAuthority.authorityReference;
      i.dnsAuthority.digest=s1aHashWithoutField(i.dnsAuthority,'digest');return observeS1aCarrier(architecture,i);}},
    contradiction:{ok:false,obligation:'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY',run:()=>observeS1aCarrier(
      appendS1aContradiction(architecture,'### Faithful validation carrier','Contradiction: one combined domain and DNS grant is sufficient.'),s1aClone(f))},
    equivalent:{ok:false,obligation:'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY',run:()=>{const i=s1aClone(f);
      i.dnsAuthority=s1aClone(i.domainAuthority);return observeS1aCarrier(architecture,i);}},
    coherent:{ok:false,obligation:'CARRIER_DOMAIN_DNS_SEPARATE_AUTHORITY',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>{p.faithfulCarrier.domainDnsRequiresSeparateAuthority=false;
        p.faithfulCarrier.domainDnsAuthority.referencesMustDiffer=false;
        p.faithfulCarrier.domainDnsAuthority.eachReferenceMustDifferFromExposure=false;});
      s=replaceS1aSourceClause(s,
        'If domain registration or DNS is required, each operation needs its own current authoritative Owner/Web readback bound to that exposure with a distinct authority reference; one combined grant is insufficient.',
        'Domain registration and DNS may share one current authority readback and reference.');
      return observeS1aCarrier(s,s1aClone(f));}}
  });
});

test('S1-A carrier private-persistence six-control matrix keeps stored data private',()=>{
  const f=makeS1aCarrierFixture();
  assertS1aSixControlClasses('CARRIER_PRIVATE_PERSISTENCE',()=>observeS1aCarrier(architecture,s1aClone(f)),{
    removal:{ok:false,obligation:'CARRIER_PRIVATE_PERSISTENCE',run:()=>observeS1aCarrier(
      rewriteS1aPolicyForObserver(architecture,p=>delete p.faithfulCarrier.defaultExposure),s1aClone(f))},
    polarity:{ok:false,obligation:'CARRIER_PRIVATE_PERSISTENCE',run:()=>observeS1aCarrier(
      rewriteS1aPolicyForObserver(architecture,p=>p.faithfulCarrier.persistenceImpliesExposure=true),s1aClone(f))},
    contradiction:{ok:false,obligation:'CARRIER_PRIVATE_PERSISTENCE',run:()=>observeS1aCarrier(
      appendS1aContradiction(architecture,'### Faithful validation carrier','Contradiction: persistence implies public exposure.'),s1aClone(f))},
    equivalent:{ok:true,run:()=>{const i=makeS1aCarrierFixture();i.persistent=true;
      i.persistedArtifact='private:validation-receipt';return observeS1aCarrier(architecture,i);}},
    coherent:{ok:false,obligation:'CARRIER_PRIVATE_PERSISTENCE',run:()=>{
      let s=rewriteS1aPolicyForObserver(architecture,p=>p.faithfulCarrier.persistenceImpliesExposure=true);
      s=replaceS1aSourceClause(s,'Persistence does not imply exposure.','Persistence implies public exposure.');
      return observeS1aCarrier(s,s1aClone(f));}}
  });
  const persisted=observeS1aCarrier(architecture,makeS1aCarrierFixture());
  assert.equal(persisted.ok,true);assert.equal(persisted.exposure,'PRIVATE_NONPUBLIC');
});
