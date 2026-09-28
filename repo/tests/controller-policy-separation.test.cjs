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
  assert.match(controller, /defaults to `FUTURE_OWNED_NONBLOCKING`/);
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
  assert.deepEqual(ids, [
    'WEB_ADMITTED_REVISION',
    'ADMITTED_CURRENT_OUTCOME',
    'LOCKED_CRITERION_OR_FLOOR',
    'SHIP_NOW_CONSEQUENCE',
    'REQUIRED_OUTCOME_EFFECT',
    'SAFE_DEFERRAL_IMPOSSIBLE',
    'SMALLEST_CORRECTION',
    'VERIFIABLE_CLOSURE',
    'EXACT_EVIDENCE',
    'CANDIDATE_IDENTITY',
  ]);
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
      assert.match(dispositionByName.get('EVIDENCE_ONLY'), /without asserting a product defect.*required evidence gates remain independently binding/);
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
      assert.match(fieldByName.get('ADMITTED_CURRENT_OUTCOME'), /outcome\/milestone, intended audience and supported environment/);
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
    const withoutClause = architecture.replace(row + '\n', '');
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
  assert.match(section, /supporting or incremental PRs do not trigger/);
  assert.match(section, /exact pair currently authorized.*Astra Max and Opus 5\.5 Max/);
  assert.match(section, /not an authoritative default or permanent Architecture route law/);
  assert.match(section, /later route change requires explicit current Owner\/Web authority/);
  assert.match(section, /integration CI to that same exact integrated identity/);
  assert.match(section, /Each reviewer receives.*neither sees the other's report/);
  assert.match(section, /only a dependent next-child frontier/);
  assert.match(section, /final integrated programme review/);
  assert.match(section, /does not add a V2-style super-audit/);
  assert.match(controller, /post-child dual review.*does not replace pre-merge G4/);
});

test('S1A increment 1 non-product continuation stays bounded to accepted work', () => {
  const section = s1aSection(architecture, '### Bounded non-product continuation');
  assert.match(section, /HARNESS.*TOOLKIT.*ENVIRONMENT.*TRANSPORT/);
  assert.match(section, /PRODUCT_SEMANTICS_PROVEN_BAD=NO/);
  assert.match(section, /exact accepted G3 RUN\/Lock or parent LIGHT operation/);
  assert.match(section, /Identity-preserving recovery keeps the exact current candidate and its evidence binding.*every candidate remains immutable/);
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
  assert.match(section, /specific accepted validation criterion requires it and current Owner\/Web authority/);
  assert.match(section, /If no such carrier is available.*incomplete evidence or a typed HOLD/);
  assert.match(controller, /PRIVATE\/NONPUBLIC.*no domain registration, DNS or public ingress/);
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
