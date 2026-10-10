'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const controller = fs.readFileSync(path.join(repoRoot, 'repo', 'CONTROLLER.md'), 'utf8');
const architecture = fs.readFileSync(path.join(repoRoot, 'repo', 'ARCHITECTURE.md'), 'utf8');
const programmeDiscoveryBaseline = fs.readFileSync(path.join(repoRoot, 'repo', 'docs', 'PROGRAMME-DISCOVERY-BASELINE.md'), 'utf8');
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

// Source-policy assertion only; this regression does not exercise runtime enforcement.
test('operational handoff source policy keeps packets, custody, portability and recovery bounded', () => {
  const handoffMatch = controller.match(/^- \*\*Operational handoff completeness:\*\*[\s\S]*?This adds no gate, fallback or retry allowance\.$/m);
  assert.ok(handoffMatch, 'complete operational handoff policy paragraph is present');
  const handoff = handoffMatch[0];

  const currentContext = controller.indexOf('**CURRENT-first bounded worker context:**');
  const handoffHeading = controller.indexOf('**Operational handoff completeness:**');
  const publicProjection = controller.indexOf('Human/controller GitHub bodies may project compact CURRENT', currentContext);
  assert.ok(currentContext < handoffHeading && handoffHeading < publicProjection,
    'operational handoff follows bounded CURRENT worker context and preserves adjacent body-projection law');

  assert.match(handoff, /compile the current bounded packet for the actual consumer\/carrier/);
  assert.match(handoff, /Completeness is relative to the next admitted action: derive a compact delta from CURRENT, carrying only current authority\/candidate, unresolved blockers, the next action and its necessary setup/);
  assert.match(handoff, /Keep unchanged contracts and detailed evidence at exact accessible references and retrieve only decision-relevant sections; do not replay chronology, entire prior contracts or logs, or defeat CURRENT-first narrow-to-deep takeover/);
  assert.match(handoff, /Bind the exact candidate\/checkpoint, execution-context\/runtime\/path mapping, necessary dependency\/build prerequisites and validation commands, evidence custody\/retrieval\/retention/);
  assert.match(handoff, /already-authorised recovery paths with consumed bounds and return conditions/);
  assert.match(handoff, /Carry forward still-applicable action-critical setup from verified current state and controlling receipts directly into the packet; do not make the receiver rediscover it in earlier comments or sessions/);
  assert.match(handoff, /A sanitised public CURRENT\/GitHub projection is not the complete operational packet/);
  assert.match(handoff, /Necessary nonpublic execution details use existing authorised private delivery\/custody under applicable privacy and secret-handling rules; this grants no new channel, disclosure or access permission/);
  assert.match(handoff, /verified retrieval of exact applicable contents by the intended consumer/);
  assert.match(handoff, /Stage completion alone is not disposal authority.*before checkout\/fixture teardown, verifying durable custody and consumer retrieval/);
  assert.match(handoff, /public projections carry safe custody\/retention references and status, not private paths or values/);
  assert.match(handoff, /private mapping from those references to actual retrieval instructions must itself survive the old session\/workspace and be accessible to the authorised consumer/);
  assert.match(handoff, /Across device or workspace changes, verify authorised consumer-local materialisation and identity readback from the retained package; do not assume paths, credentials, installed tools or live process\/resource identity transfer/);
  assert.match(handoff, /Requalify carrier-specific evidence where required; unavailable sole custody or a nonportable live-state obligation uses the existing HOLD/);
  assert.match(handoff, /Verify required input access and execution-context applicability before dependent work, reusing valid qualification/);
  assert.match(handoff, /Inside admitted G3, perform already-authorised bounded recovery without repeated generic continuation requests/);
  assert.match(handoff, /Missing facts or authority, unknown consequential outcomes, exhausted recovery or equivalent no-progress repetition return the applicable existing typed HOLD with the exact blocker, evidence, responsible boundary and smallest next action/);
  assert.match(handoff, /Preserve RUN\/Lock, candidate, scope and consumed budgets; block only dependent work/);
  assert.match(handoff, /This adds no gate, fallback or retry allowance\./);
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

test('Claude and OpenAI stacks preserve the current owner-selected route classes without leaking model names into policy', () => {
  const claude = registry.stacks['owner-claude'];
  assert.deepEqual(claude.routes, {
    G_FRAME: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
    G0: {
      provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh',
      subagent: { provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh' }
    },
    G1: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
    G1_RECONVERGENCE: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
    G2: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
    G3: {
      provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh',
      subagent: { provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh' },
      adversarial_subagent: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' }
    },
    G4: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'xhigh' },
    FINAL_AUDIT: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'max' },
    BROWSER: { provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh' }
  });
  const openai = registry.stacks['owner-openai-default'];
  for (const [role, route] of Object.entries(openai.routes)) {
    if (route.model === 'gpt-6.1-sol') assert.equal(route.reasoning, 'high', `OpenAI Sol route must be high: ${role}`);
    assert.notEqual(route.model, 'gpt-6-sol', `obsolete OpenAI Sol route must not remain current: ${role}`);
  }
  assert.equal(registry.stacks['owner-openai-default'].routes.G1.reasoning, 'high');
  assert.equal(registry.stacks['owner-openai-default'].routes.G2.reasoning, 'high');
});

test('mixed Claude/GPT stack uses Claude for G0/G1/G2 and Codex for G3/G4 with Opus final audit', () => {
  const mixed = registry.stacks['owner-mixed-claude-gpt'];
  assert.ok(mixed);

  assert.deepEqual(mixed.routes.G_FRAME, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(mixed.routes.G0, {
    provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh',
    subagent: { provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh' }
  });
  assert.deepEqual(mixed.routes.G1, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(mixed.routes.G1_RECONVERGENCE, mixed.routes.G1);
  assert.deepEqual(mixed.routes.G2, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(mixed.routes.G3, {
    provider: 'openai', model: 'gpt-6-luna', reasoning: 'max',
    subagent: { provider: 'openai', model: 'gpt-6-luna', reasoning: 'max' },
    adversarial_subagent: { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' }
  });
  assert.deepEqual(mixed.routes.G4, { provider: 'openai', model: 'gpt-6-astra', reasoning: 'high' });
  assert.deepEqual(mixed.routes.FINAL_AUDIT, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'max' });
  assert.deepEqual(mixed.routes.BROWSER, { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' });
});

test('v2 stack registry contains no Anthropic Opus Medium tuple', () => {
  function visit(value, slot) {
    if (!value || typeof value !== 'object') return;
    assert.equal(
      value.provider === 'anthropic' && value.model === 'opus-5.5' && value.reasoning === 'medium',
      false,
      `obsolete Anthropic Opus Medium tuple: ${slot}`
    );
    for (const [key, child] of Object.entries(value)) visit(child, `${slot}.${key}`);
  }
  visit(registry, 'registry');
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
  assert.match(controller, /next explicitly agreed complete usable milestone: outcome, audience, supported environment, minimum safety floor and acceptance criteria/);
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
  assert.deepEqual(openai, { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' });
  const claude = registry.stacks['owner-claude'].routes.G3.adversarial_subagent;
  assert.deepEqual(claude, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  const mixed = registry.stacks['owner-mixed-claude-gpt'].routes.G3.adversarial_subagent;
  assert.deepEqual(mixed, { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' });
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

// These document-contract assertions do not prove host execution or runtime enforcement.
test('interim document notes are dated, prominent and routed to canonical sections', () => {
  for (const source of [controller, architecture]) {
    assert.match(source, /^# [^\r\n]+\r?\n\r?\n\*\*Interim delivery-first operation - 6 October 2026:\*\*/);
    assert.match(source, /At the next safe controller admission\/reconciliation/);
    assert.match(source, /Preserve all accepted safety, assurance, authority and consumed history/);
  }
  assert.match(controller, /\[Shipping-first scope and repair decisions\]\(#shipping-first-scope-and-repair-decisions\)/);
  assert.match(architecture, /\[Child sizing and splitting\]\(#child-sizing-and-splitting\)/);
  assert.match(architecture, /\[Bounded non-product continuation\]\(#bounded-non-product-continuation\)/);
});

test('interim recovery is finite, faithful and retains real return boundaries', () => {
  const recovery = controller.split('\n').find(line => line.startsWith('- **Executor anti-bounce is not child lifecycle:**'));
  assert.ok(recovery);
  assert.match(recovery, /existing bounded continuation contract: finite faithful paths, exact effects, prerequisites, consumed counters\/limits and return conditions/);
  assert.match(recovery, /Qualify the actual producer bytes and receiver\/execution context, not only regenerated approximations/);
  assert.match(recovery, /Reconcile interrupted execution and ambiguous effects before resuming; reuse completed evidence only with valid exact applicability/);
  assert.match(recovery, /Covered mechanics do not require a fresh continuation request per command/);
  assert.match(recovery, /Web may optionally invoke one read-only `G1_RECONVERGENCE` synthesis when materially useful; that synthesis grants no authority, budget reset or child lifecycle change/);
  assert.match(recovery, /changed failure may continue only when an independently accepted current state proves a remaining authorised faithful path and material progress/);
  assert.match(recovery, /Missing authority, exhausted limits, unresolved effects, unknown\/product attribution, changed semantics or materially equivalent no-progress returns to Owner\/Web/);
  assert.match(architecture, /Covered mechanics continue without per-command re-admission while exact applicability, material progress, effects and remaining limits are established/);
  assert.match(architecture, /Web may optionally invoke one read-only Re-convergence synthesis; that synthesis grants no authority, lifecycle change or budget expansion/);
  for (const source of [controller, architecture]) {
    assert.doesNotMatch(source, /After one focused diagnosis\/recovery/);
  }
});

test('interim adoption preserves original evidence, consumed limits and in-flight contracts', () => {
  assert.match(controller, /current independently read-back authority identity\/revision and its bounded packet rather than superseded prompts or historical grants/);
  assert.match(controller, /Preserve original admitted gate outcomes, candidate evidence and consumed history/);
  assert.match(controller, /A current packet cannot manufacture authority or silently rewrite an in-flight contract/);
  assert.match(controller, /Whole-episode budget exhaustion holds the affected objective for User\/Web rather than silently continuing/);
  assert.match(architecture, /Attempt, product-correction and consumed-budget counts may not exceed their accepted limits; any over-limit count returns to Web/);
});

test('interim adoption is manual and keeps implementation ownership and authority fences', () => {
  const adoption = controller.split('\n').find(line => line.startsWith('- Apply these compatible operating rules immediately'));
  assert.ok(adoption);
  assert.match(adoption, /exact CURRENT\/parent\/child readback; do not wait for unfinished Toolkit runtime code/);
  assert.match(adoption, /release an otherwise unsupported blanket Toolkit wait only after recording that no genuine local safety, evidence, authority or code dependency requires it/);
  assert.match(adoption, /C2 owns deterministic state, frontier and packet mechanisation; H owns host qualification/);
  assert.match(adoption, /controller application is interim manual enforcement, not a claim of automated interception or supervision/);
  assert.match(adoption, /Keep named real holds, active-worker protections and all existing permissions\/budgets/);
  assert.match(adoption, /Preserve active-worker contracts and consumed budgets/);
  assert.match(adoption, /This grants no new source, publication, merge, deployment, security or credential authority/);
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
        /complete canonical common finding record.*admitted outcome.*timing, trigger.*closure criterion and exact evidence.*owner role\/readback/);
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
      assert.match(fieldByName.get('CANDIDATE_IDENTITY'), /own nonblank string commit and tree fields/);
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
    const withoutClause = architecture.split(/\r?\n/).filter((line) => line !== row).join(String.fromCharCode(10));
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
  assert.ok(section.includes('Only a current canonical merge/event and child-state readback identifying the final Delivery Child merge triggers deterministic reconciliation; a caller label cannot suppress it'));
  assert.match(section, /exact integrated commit\/tree and merge receipt/);
  assert.match(section, /supporting or incremental PRs do not trigger/i);
  assert.match(section, /route for each `DUAL_MAX` review is supplied by current Owner\/Web authority/);
  assert.match(section, /not an authoritative default or permanent Architecture route law/);
  assert.match(section, /exact provider\/model\/reasoning bindings from that current readback/);
  assert.match(section, /When `DUAL_MAX` is selected, start both independent whole-programme reviews alongside merge-triggered CI/);
  assert.match(section, /Each reviewer receives.*neither sees the other's report/);
  assert.match(section, /only a dependent next-child frontier/);
  assert.match(section, /final integrated programme review/);
  assert.match(section, /CURRENT canonical parent programme contract is an authoritative input to both reviews/);
  assert.match(section, /relevant current or terminal child state/);
  assert.match(section, /complete terminal object-receipt inventory from its canonical ledger/);
  assert.match(section, /complete applicable integration-check inventory from its canonical source/);
  assert.match(section, /same immutable post-merge snapshot/);
  assert.match(section, /When `DUAL_MAX` is selected, both reports, terminal receipts and all applicable checks must be terminal before Web adjudication/);
  assert.match(section, /neither sees the other's report before both reports are returned to Web/);
  assert.match(section, /only a dependent next-child frontier/);
  assert.match(section, /final integrated programme review occurs at the final Delivery Child checkpoint for this lifecycle/);
  assert.match(controller, /`DUAL_MAX` requires both independent read-only reviews on one immutable snapshot/);
  assert.match(section, /For `DUAL_MAX`, after both reports return, read back the complete terminal object-receipt inventory from its canonical ledger/);
  assert.match(section, /Before mode selection, read back the complete required receipt IDs and applicable integration-check membership/);
  assert.match(controller, /Post-child binary checkpoint.*does not replace pre-merge G4/);
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
const S1A_ORACLE_GOVERNED_PROSE_SHA256 = 'd96e82c0c6685928e808a89f3d9208db9f51bc4ea4787b1b562d0f7b6c89fe58';
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
    'webAdmittedRevision', 'findingRevision', 'candidateIdentity', 'acceptedDecisionId', 'admittedCurrentOutcome', 'programmeId',
    'childId', 'frontierId', 'timing', 'triggerOrReason', 'closureCriterion', 'exactEvidence', 'controllerId',
    'acceptedContractId', 'subjectId', 'attribution', 'observedBehavior', 'requiredBehavior',
    'primaryOwner', 'adjudication', 'disposition', 'lifecycle', 'ownerRole', 'owner', 'resolution', 'revision', 'digest'
  ]),
  recordBindings: Object.freeze([
    Object.freeze({ readback: 'repository', record: 'REPOSITORY' }),
    Object.freeze({ readback: 'packetIdentity', record: 'PACKET_IDENTITY' }),
    Object.freeze({ readback: 'findingId', record: 'FINDING_ID' }),
    Object.freeze({ readback: 'webAdmittedRevision', record: 'WEB_ADMITTED_REVISION' }),
    Object.freeze({ readback: 'findingRevision', record: 'FINDING_REVISION' }),
    Object.freeze({ readback: 'candidateIdentity', record: 'CANDIDATE_IDENTITY' }),
    Object.freeze({ readback: 'acceptedDecisionId', record: 'ACCEPTED_DECISION_ID' }),
    Object.freeze({ readback: 'admittedCurrentOutcome', record: 'ADMITTED_CURRENT_OUTCOME' }),
    Object.freeze({ readback: 'programmeId', record: 'PROGRAMME_ID' }),
    Object.freeze({ readback: 'childId', record: 'CHILD_ID' }),
    Object.freeze({ readback: 'frontierId', record: 'FRONTIER_ID' }),
    Object.freeze({ readback: 'timing', record: 'TIMING' }),
    Object.freeze({ readback: 'triggerOrReason', record: 'TRIGGER_OR_REASON' }),
    Object.freeze({ readback: 'closureCriterion', record: 'CLOSURE_CRITERION' }),
    Object.freeze({ readback: 'exactEvidence', record: 'EXACT_EVIDENCE' }),
    Object.freeze({ readback: 'controllerId', record: 'CONTROLLER_ID' }),
    Object.freeze({ readback: 'acceptedContractId', record: 'ACCEPTED_CONTRACT_ID' }),
    Object.freeze({ readback: 'subjectId', record: 'SUBJECT_ID' }),
    Object.freeze({ readback: 'attribution', record: 'ATTRIBUTION' }),
    Object.freeze({ readback: 'observedBehavior', record: 'OBSERVED_BEHAVIOR' }),
    Object.freeze({ readback: 'requiredBehavior', record: 'REQUIRED_BEHAVIOR' }),
    Object.freeze({ readback: 'primaryOwner', record: 'PRIMARY_OWNER' }),
    Object.freeze({ readback: 'adjudication', record: 'ADJUDICATION' }),
    Object.freeze({ readback: 'disposition', record: 'DISPOSITION' }),
    Object.freeze({ readback: 'lifecycle', record: 'LIFECYCLE' }),
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
  'SUBJECT_ID', 'OBSERVED_BEHAVIOR', 'REQUIRED_BEHAVIOR', 'PRIMARY_OWNER', 'ATTRIBUTION', 'ADJUDICATION',
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
  'SUBJECT_ID', 'OBSERVED_BEHAVIOR', 'REQUIRED_BEHAVIOR', 'PRIMARY_OWNER', 'ATTRIBUTION', 'ADJUDICATION',
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
  PRIMARY_OWNER: 'NONEMPTY_STRING', ATTRIBUTION: 'NONEMPTY_STRING',
  ADJUDICATION: 'NONEMPTY_STRING', OWNER_ROLE: 'NONEMPTY_STRING',
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
  RESOLUTION: 'NONEMPTY_STRING',
  ATTRIBUTION: 'NONEMPTY_STRING'
});
const S1A_ORACLE_COMMON_RECORD_FIELDS = Object.freeze([
  'FINDING_ID', 'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_REVISION',
  'WEB_ADMITTED_REVISION', 'ACCEPTED_DECISION_ID', 'ADMITTED_CURRENT_OUTCOME',
  'PROGRAMME_ID', 'CHILD_ID', 'FRONTIER_ID', 'TIMING', 'TRIGGER_OR_REASON',
  'CLOSURE_CRITERION', 'EXACT_EVIDENCE', 'CONTROLLER_ID', 'ACCEPTED_CONTRACT_ID',
  'SUBJECT_ID', 'CANDIDATE_IDENTITY', 'ATTRIBUTION', 'PRIMARY_OWNER', 'ADJUDICATION',
  'OBSERVED_BEHAVIOR', 'REQUIRED_BEHAVIOR', 'DISPOSITION', 'LIFECYCLE',
  'VERIFIED_OWNER', 'OWNER_ROLE', 'OWNER_READBACK', 'RESOLUTION'
]);
const S1A_ORACLE_COMMON_RECORD_TYPED_FIELDS = Object.freeze({
  FINDING_ID: 'NONEMPTY_STRING',
  REPOSITORY: 'NONEMPTY_STRING',
  PACKET_IDENTITY: 'NONEMPTY_OBJECT',
  FINDING_REVISION: 'NONEMPTY_STRING',
  WEB_ADMITTED_REVISION: 'NONEMPTY_STRING',
  ACCEPTED_DECISION_ID: 'NONEMPTY_STRING',
  ADMITTED_CURRENT_OUTCOME: 'NONEMPTY_OBJECT',
  PROGRAMME_ID: 'NONEMPTY_STRING',
  CHILD_ID: 'NONEMPTY_STRING',
  FRONTIER_ID: 'NONEMPTY_STRING',
  TIMING: 'NONEMPTY_STRING',
  TRIGGER_OR_REASON: 'NONEMPTY_STRING',
  CLOSURE_CRITERION: 'NONEMPTY_STRING',
  EXACT_EVIDENCE: 'NONEMPTY_EVIDENCE_REFERENCES',
  CONTROLLER_ID: 'NONEMPTY_STRING',
  ACCEPTED_CONTRACT_ID: 'NONEMPTY_STRING',
  SUBJECT_ID: 'NONEMPTY_STRING',
  CANDIDATE_IDENTITY: 'NONEMPTY_OBJECT',
  ATTRIBUTION: 'NONEMPTY_STRING',
  PRIMARY_OWNER: 'NONEMPTY_STRING',
  ADJUDICATION: 'NONEMPTY_STRING',
  OBSERVED_BEHAVIOR: 'NONEMPTY_STRING',
  REQUIRED_BEHAVIOR: 'NONEMPTY_STRING',
  DISPOSITION: 'NONEMPTY_STRING',
  LIFECYCLE: 'NONEMPTY_STRING',
  VERIFIED_OWNER: 'NONEMPTY_STRING',
  OWNER_ROLE: 'NONEMPTY_STRING',
  OWNER_READBACK: 'NONEMPTY_OBJECT',
  RESOLUTION: 'NONEMPTY_STRING'
});
const S1A_ORACLE_COMMON_RECORD_NESTED_FIELDS = Object.freeze([
  Object.freeze({ record: 'PACKET_IDENTITY',
    fields: Object.freeze(['repository', 'packetId', 'packetRevision']) }),
  Object.freeze({ record: 'CANDIDATE_IDENTITY',
    fields: Object.freeze(['commit', 'tree']) }),
  Object.freeze({ record: 'ADMITTED_CURRENT_OUTCOME',
    fields: Object.freeze(['id', 'milestone', 'audience', 'environment']) })
]);
const S1A_ORACLE_COMMON_RECORD_NESTED_BINDINGS = Object.freeze([
  Object.freeze({ left: 'PACKET_IDENTITY.repository', right: 'REPOSITORY' })
]);
const S1A_ORACLE_REJECTED_REQUEST_STATE = Object.freeze({
  ok: false,
  transition: null,
  mutationEffects: Object.freeze([]),
  dispositionField: 'DISPOSITION',
  lifecycleField: 'LIFECYCLE',
  requestValuesMaySelectState: false
});
const S1A_ORACLE_COMMON_RECORD_CONTRACT = Object.freeze({
  requiredFields: S1A_ORACLE_COMMON_RECORD_FIELDS,
  typedFields: S1A_ORACLE_COMMON_RECORD_TYPED_FIELDS,
  nestedRequiredFields: S1A_ORACLE_COMMON_RECORD_NESTED_FIELDS,
  nestedBindings: S1A_ORACLE_COMMON_RECORD_NESTED_BINDINGS,
  rejectedRequestState: S1A_ORACLE_REJECTED_REQUEST_STATE,
  transitionBindings: Object.freeze([
    Object.freeze({ transition: 'disposition', record: 'DISPOSITION' }),
    Object.freeze({ transition: 'sourceLifecycle', record: 'LIFECYCLE' })
  ]),
  canonicalRecordAuthoritative: true,
  adjudicationMustMatchDisposition: true,
  resolutionLifecycleBindings: Object.freeze([
    Object.freeze({ lifecycle: 'UNRESOLVED', resolution: 'NOT_RESOLVED' }),
    Object.freeze({ lifecycle: 'RESOLVED', resolution: 'RESOLVED' })
  ]),
  completenessObligation: 'F2_COMMON_RECORD_COMPANION_COMPLETENESS',
  transitionConsistencyObligation: 'F1_RECORD_TRANSITION_CONSISTENCY'
});
const S1A_ORACLE_ADMITTED_CURRENT_OUTCOME = Object.freeze({
  id: 'outcome:alpha', milestone: 'alpha', audience: 'internal',
  environment: 'staging'
});
const S1A_ORACLE_PACKET_IDENTITY = Object.freeze({
  repository: 'weijunswj/ai-agent-toolkit',
  packetId: 'packet:s1a-increment-1',
  packetRevision: 'packet:revision-7'
});
function makeS1aCommonFindingFields(identity) {
  const fields = {
    FINDING_ID: 'finding:common-record',
    REPOSITORY: 'weijunswj/ai-agent-toolkit',
    PACKET_IDENTITY: s1aClone(S1A_ORACLE_PACKET_IDENTITY),
    FINDING_REVISION: 'finding-revision:7',
    WEB_ADMITTED_REVISION: 'web:revision-7',
    ACCEPTED_DECISION_ID: 'decision:web:7',
    ADMITTED_CURRENT_OUTCOME: s1aClone(S1A_ORACLE_ADMITTED_CURRENT_OUTCOME),
    PROGRAMME_ID: 'programme:s1a',
    CHILD_ID: 'child:s1a-increment-1',
    FRONTIER_ID: 'frontier:increment-1',
    TIMING: 'future-release',
    TRIGGER_OR_REASON: 'reassess on accepted evidence',
    CLOSURE_CRITERION: 'criterion:future-close',
    EXACT_EVIDENCE: ['evidence:common-record'],
    CONTROLLER_ID: 'controller:web-459',
    ACCEPTED_CONTRACT_ID: 'contract:s1a-i1-25',
    SUBJECT_ID: 'subject:current-candidate',
    CANDIDATE_IDENTITY: { commit: 'commit:7', tree: 'tree:7' },
    ATTRIBUTION: 'TOOLKIT',
    PRIMARY_OWNER: 'TOOLKIT',
    ADJUDICATION: 'FUTURE_OWNED',
    OBSERVED_BEHAVIOR: 'Observed behavior remains within the accepted future scope.',
    REQUIRED_BEHAVIOR: 'The verified owner closes the accepted criterion by its trigger.',
    DISPOSITION: 'FUTURE_OWNED',
    LIFECYCLE: 'UNRESOLVED',
    VERIFIED_OWNER: 'owner:verified',
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
    admittedCurrentOutcome: s1aClone(fields.ADMITTED_CURRENT_OUTCOME),
    programmeId: fields.PROGRAMME_ID,
    childId: fields.CHILD_ID,
    frontierId: fields.FRONTIER_ID,
    timing: fields.TIMING,
    triggerOrReason: fields.TRIGGER_OR_REASON,
    closureCriterion: fields.CLOSURE_CRITERION,
    exactEvidence: s1aClone(fields.EXACT_EVIDENCE),
    controllerId: fields.CONTROLLER_ID,
    acceptedContractId: fields.ACCEPTED_CONTRACT_ID,
    subjectId: fields.SUBJECT_ID,
    attribution: fields.ATTRIBUTION,
    observedBehavior: fields.OBSERVED_BEHAVIOR,
    requiredBehavior: fields.REQUIRED_BEHAVIOR,
    primaryOwner: fields.PRIMARY_OWNER,
    adjudication: fields.ADJUDICATION,
    disposition: fields.DISPOSITION,
    lifecycle: fields.LIFECYCLE,
    ownerRole: fields.OWNER_ROLE,
    owner: fields.VERIFIED_OWNER,
    resolution: fields.RESOLUTION,
    webAdmittedRevision: fields.WEB_ADMITTED_REVISION,
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
const S1A_ORACLE_COMPANION_TYPED_FIELDS = S1A_ORACLE_COMMON_RECORD_TYPED_FIELDS;
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
  commonRecordField: 'commonRecord',
  commonRecordMode: 'EXACT_CANONICAL_TRANSITION_SOURCE_RECORD',
  commonRecordFieldsFrom: 'commonRecord.requiredFields',
  requiredFields: Object.freeze([
    'source', 'authoritative', 'current', 'readBack', 'repository', 'revision',
    'findingId', 'webAdmittedRevision', 'disposition', 'fromLifecycle', 'toLifecycle',
    'closureCriterion', 'exactEvidence', 'candidateIdentity', 'commonRecord', 'body', 'bodyDigest'
  ]),
  bodyFields: Object.freeze([
    'repository', 'findingId', 'webAdmittedRevision', 'disposition',
    'fromLifecycle', 'toLifecycle', 'closureCriterion', 'exactEvidence', 'candidateIdentity', 'commonRecord'
  ]),
  digestMode: 'SHA256_EXACT_READBACK_BODY',
  resolvesOnlyAfterVerifiedReadback: true,
  retainsAdmittedDisposition: true
});
const S1A_ORACLE_CLOSURE_COMMON_RECORD_SOURCE = makeS1aCommonFindingFields({
  FINDING_ID: 'finding:closure',
  WEB_ADMITTED_REVISION: 'web:revision-7',
  DISPOSITION: 'FUTURE_OWNED',
  ADJUDICATION: 'FUTURE_OWNED',
  LIFECYCLE: 'UNRESOLVED',
  CLOSURE_CRITERION: 'criterion:close',
  EXACT_EVIDENCE: ['evidence:verified'],
  CANDIDATE_IDENTITY: { commit: 'commit:7', tree: 'tree:7' }
});
const S1A_ORACLE_CLOSURE_COMMON_RECORD = Object.freeze(Object.fromEntries(
  S1A_ORACLE_COMMON_RECORD_FIELDS.map((field) => [field,
    s1aClone(S1A_ORACLE_CLOSURE_COMMON_RECORD_SOURCE[field])])
));
const S1A_ORACLE_CLOSURE_BODY = Object.freeze({
  repository: 'weijunswj/ai-agent-toolkit',
  findingId: 'finding:closure',
  webAdmittedRevision: 'web:revision-7',
  disposition: 'FUTURE_OWNED',
  fromLifecycle: 'UNRESOLVED',
  toLifecycle: 'RESOLVED',
  closureCriterion: 'criterion:close',
  exactEvidence: Object.freeze(['evidence:verified']),
  candidateIdentity: Object.freeze({ commit: 'commit:7', tree: 'tree:7' }),
  commonRecord: S1A_ORACLE_CLOSURE_COMMON_RECORD
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
  commonRecord: S1A_ORACLE_CLOSURE_BODY.commonRecord,
  body: S1A_ORACLE_CLOSURE_BODY_TEXT,
  bodyDigest: s1aHashText(S1A_ORACLE_CLOSURE_BODY_TEXT)
});
const S1A_ORACLE_HISTORY_IDENTITY_FIELDS = Object.freeze(['FINDING_ID', 'WEB_ADMITTED_REVISION', 'CANDIDATE_IDENTITY']);
const S1A_ORACLE_COMPANION_IDENTITY_FIELDS = Object.freeze([
  'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_ID', 'WEB_ADMITTED_REVISION', 'CANDIDATE_IDENTITY'
]);
const S1A_ORACLE_COMPANION_PROJECTION_FIELDS = Object.freeze([
  'REPOSITORY', 'PACKET_IDENTITY', 'FINDING_ID', 'FINDING_REVISION',
  'WEB_ADMITTED_REVISION', 'DISPOSITION', 'LIFECYCLE', 'CANDIDATE_IDENTITY', 'ACCEPTED_DECISION_ID',
  'ADMITTED_CURRENT_OUTCOME', 'ATTRIBUTION'
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
  'CANDIDATE_IDENTITY', 'ADMITTED_CURRENT_OUTCOME', 'REPOSITORY', 'PACKET_IDENTITY',
  'FINDING_REVISION', 'ACCEPTED_DECISION_ID', 'PROGRAMME_ID', 'CHILD_ID', 'FRONTIER_ID',
  'CONTROLLER_ID', 'ACCEPTED_CONTRACT_ID', 'SUBJECT_ID', 'OBSERVED_BEHAVIOR',
  'REQUIRED_BEHAVIOR', 'PRIMARY_OWNER', 'ATTRIBUTION', 'ADJUDICATION', 'OWNER_ROLE',
  'OWNER_READBACK', 'RESOLUTION'
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
  const canonicalReconcilePrerequisite =
    'Selecting `RECONCILE_ONLY` never bypasses a missing or stale shared prerequisite.';
  const acceptedEquivalentReconcilePrerequisite =
    'Once all shared prerequisites pass, `RECONCILE_ONLY` may omit only reviewer work.';
  // G1 re-convergence is separate policy. Normalize line endings; the machine contract is independently interpreted below.
  const governedHumanPolicy = governedSection.slice(0, g1Start)
    .replace(/~~~s1a-policy-contract-v1\r?\n[\s\S]*?\r?\n~~~/,
      '~~~s1a-policy-contract-v1\n[fixed-machine-contract]\n~~~')
    .replace(/\r\n?/g, '\n')
    .replace(acceptedEquivalentFailClosed, canonicalFailClosed)
    .replace(acceptedEquivalentReconcilePrerequisite, canonicalReconcilePrerequisite);
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
    'schema', 'dispositions', 'lifecycles', 'evidenceOnly', 'commonRecord', 'projectionRows', 'blocker', 'companion',
    'lifecycleTransitions', 'closureVerification', 'postChildReview', 'faithfulCarrier', 'boundedContinuation'
  ], 'root');
  s1aRequire(policy.schema === 'toolkit.s1a.policy-contract.v1', 'unknown S1-A policy schema');
  s1aRequire(s1aSame(policy.commonRecord, S1A_ORACLE_COMMON_RECORD_CONTRACT),
    'common record fields, transition bindings, or composition obligations are incomplete');
  s1aRequire(policyLawProse.includes('Nested identity composition is exact: PACKET_IDENTITY is an object with own nonblank string repository, packetId and packetRevision fields; its repository equals common REPOSITORY.') &&
    policyLawProse.includes('CANDIDATE_IDENTITY is an object with own nonblank string commit and tree fields.') &&
    policyLawProse.includes('Hashes and digests bind bytes but never establish authority.') &&
    policyLawProse.includes("For every rejected transition request, including early validation returns, return ok=false, transition=null, mutationEffects=[], and the canonical record's DISPOSITION and LIFECYCLE; request values never select the resulting state."),
    'human policy must preserve nested identity and rejection noninterference');
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
    'trigger', 'scope', 'readOnly', 'assuranceModes', 'forbiddenModes', 'sharedPrerequisites',
    'modeSelection', 'checkMembership', 'dualMaxReview', 'parentContractMode', 'parentContractBodyField',
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
  s1aRequire(s1aSame(review.assuranceModes, ['RECONCILE_ONLY', 'DUAL_MAX']) &&
    s1aSame(review.forbiddenModes, ['SINGLE_MAX']) &&
    s1aSame(review.sharedPrerequisites, [
      'EXACT_INTEGRATED_IDENTITY', 'CURRENT_PARENT_STATE', 'CURRENT_CHILD_STATE',
      'RECEIPT_MEMBERSHIP', 'CHECK_MEMBERSHIP', 'FINALITY_AND_DEPENDENCY_STATE'
    ]) && review.modeSelection.selectionRequiresSharedPrerequisites === true &&
    review.modeSelection.treeEqualityIsSufficientByItself === false &&
    review.modeSelection.controllerOrArchitectureTouchAloneTriggersDual === false &&
    s1aSame(review.modeSelection.reconcileOnlyRequiredPredicates, [
      'MERGE_TREE_EQUALS_ASSURED_CHILD_TREE',
      'NO_UNASSURED_CONCURRENT_OR_MULTI_CHILD_COMPOSITION',
      'NO_CONFLICT_RESOLUTION_SEMANTIC_DELTA',
      'CHILD_TERMINAL_FINALITY_COHERENT',
      'PARENT_CURRENT_FRONTIER_DEPENDENCIES_COHERENT',
      'NO_UNRESOLVED_MATERIAL_DEPENDENT_FINDING',
      'COMPLETE_APPLICABLE_MERGE_CHECK_MEMBERSHIP',
      'ALL_APPLICABLE_MERGE_CHECKS_TERMINAL_GREEN',
      'NO_EXPLICIT_DUAL_REQUIREMENT',
      'NOT_FINAL_DELIVERY_CHILD'
    ]) && s1aSame(review.modeSelection.dualMaxTriggers, [
      'INTEGRATION_TREE_DELTA',
      'CONCURRENT_OR_MULTI_CHILD_COMPOSITION',
      'MATERIAL_ROOT_TRUST_AUTHORITY_INTEGRATION_OUTSIDE_ASSURED_TREE',
      'UNRESOLVED_INTEGRATION_UNCERTAINTY',
      'EXPLICIT_OWNER_WEB_G4_REQUIREMENT',
      'FINAL_DELIVERY_CHILD'
    ]), 'post-child modes and triggers must match the binary contract');
  s1aExactKeys(review.checkMembership, [
    'deriveBeforeResults', 'includeAllApplicableFirstPartyChecks', 'binds', 'authorityReadbacks', 'membershipIdentityFields', 'terminalReadbackFields',
    'emptyMembershipValidWhenProven', 'falseGreenRejections'
  ], 'checkMembership');
  s1aExactKeys(review.checkMembership.authorityReadbacks, [
    'configuration', 'terminalRuns', 'allIdentityFieldsRequired', 'bindExpectedMembershipTo',
    'emptyMembershipRequiresCompleteAuthoritativeReadback'
  ], 'checkMembership.authorityReadbacks');
  s1aRequire(s1aSame(review.checkMembership.authorityReadbacks, {
      configuration: 'CURRENT_CANONICAL_CHECK_CONFIGURATION_READBACK',
      terminalRuns: 'CURRENT_CANONICAL_LATEST_RUN_READBACK',
      allIdentityFieldsRequired: true,
      bindExpectedMembershipTo: ['EVENT_TRIGGER_HEAD', 'CANONICAL_CHILD_INVENTORY', 'TERMINAL_RESULT_INVENTORY', 'REVIEW_SNAPSHOT'],
      emptyMembershipRequiresCompleteAuthoritativeReadback: true
    }) && s1aSame(review.checkMembership.binds, [
      'AUTHORITATIVE_CHECK_CONFIGURATION', 'EVENT_BRANCH_PATH_CONDITIONS', 'CHILD_REQUIRED_CHECKS',
      'ALL_APPLICABLE_FIRST_PARTY_MERGE_TRIGGERED_CHECKS', 'EXPECTED_MERGE_CHECK_MEMBERSHIP', 'MEMBERSHIP_FREEZE_POINT', 'TERMINAL_READBACK_RULE',
      'PREMERGE_ONLY_VS_MERGE_TRIGGERED_RULE', 'MISSING_EXPECTED_CHECK_RULE', 'NOT_APPLICABLE_RULE'
    ]) && review.checkMembership.deriveBeforeResults === true && review.checkMembership.includeAllApplicableFirstPartyChecks === true &&
    s1aSame(review.checkMembership.membershipIdentityFields, [
      'producerId', 'workflowId', 'workflowRevision', 'checkId', 'matrixLeg', 'eventIdentity', 'triggerId', 'headSha'
    ]) && s1aSame(review.checkMembership.terminalReadbackFields, [
      'producerId', 'workflowId', 'workflowRevision', 'runId', 'checkId', 'matrixLeg', 'eventIdentity',
      'triggerId', 'headSha', 'terminalReadback', 'terminal', 'conclusion'
    ]) &&
    review.checkMembership.emptyMembershipValidWhenProven === true &&
    s1aSame(review.checkMembership.falseGreenRejections, [
      'GREENS_ONLY_MEMBERSHIP', 'CO_OMITTED_EXPECTED_CHECK', 'WRONG_PRODUCER_SAME_DISPLAY_NAME',
      'SKIPPED_CANCELLED_FAILED_DEPENDENCY_AS_NOT_APPLICABLE', 'AMBIGUOUS_DYNAMIC_MATRIX_EXPANSION',
      'STALE_SUCCESSFUL_RERUN_OR_PREDECESSOR', 'NEW_APPLICABLE_CONFIGURATION_AFTER_FREEZE'
    ]) && review.dualMaxReview.bothSlotsRequired === true &&
    review.dualMaxReview.readOnly === true && review.dualMaxReview.sameImmutableSnapshot === true &&
    review.dualMaxReview.mutuallyBlindUntil === 'BOTH_REPORTS_TERMINAL' &&
    review.dualMaxReview.unavailableReviewerOutcome === 'HOLD' &&
    review.dualMaxReview.singleReviewFallback === false &&
    review.dualMaxReview.finalDeliveryChildRequiresDual === true,
    'post-child check membership and dual review requirements are incomplete');
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
  s1aRequire(blockerProse.includes('Resolution changes only lifecycle to RESOLVED after an authoritative, current Web closure readback binds the complete canonical common record, including the admitted outcome, milestone, audience and environment, and verifies the exact finding, admitted disposition, closure criterion, evidence references, candidate identity and transition; a caller-supplied criterion, evidence label or recomputed digest alone cannot resolve work.') &&
    !/caller[- ]supplied (?:criterion|evidence label) alone can resolve/i.test(blockerProse),
    'closure prose must require current authoritative verification');
  const postChildStart = source.indexOf('### Post-child integrated dual review');
  const postChildEnd = source.indexOf('### Bounded non-product continuation', postChildStart);
  const postChildProse = postChildStart >= 0 && postChildEnd > postChildStart
    ? source.slice(postChildStart, postChildEnd) : '';
  s1aRequire(postChildProse.includes('Only a current canonical merge/event and child-state readback identifying the final Delivery Child merge triggers deterministic reconciliation; a caller label cannot suppress it.') &&
    postChildProse.includes('The only assurance modes are `RECONCILE_ONLY` and `DUAL_MAX`; `SINGLE_MAX` does not exist.') &&
    (postChildProse.includes('Selecting `RECONCILE_ONLY` never bypasses a missing or stale shared prerequisite.') ||
      postChildProse.includes('Once all shared prerequisites pass, `RECONCILE_ONLY` may omit only reviewer work.')) &&
    postChildProse.includes('Both reviews are independent, read-only whole-programme reviews.') &&
    postChildProse.includes('When `DUAL_MAX` is selected, both reports, terminal receipts and all applicable checks must be terminal before Web adjudication.') &&
    postChildProse.includes('A provably empty expected membership is valid only when the complete authoritative configuration readback and those inventories agree that it is empty.') &&
    postChildProse.includes('Do not copy programme-wide parent law into every child.') &&
    !/(?:completed|terminal|current) child state.{0,120}(?:may be accepted|is accepted|suffices).{0,120}(?:child[- ]local summary|summary).{0,120}without.{0,80}(?:current )?canonical readback/i.test(policyLawProse) &&
    !/parent programme contract (?:is|may be) optional|adjudicat(?:e|ion) before both reports|reviewers? may see the other report before both reports are terminal/i.test(postChildProse) &&
    !/RECONCILE_ONLY.{0,100}(?:may|can|is allowed to)\s+(?:bypass|skip).{0,80}(?:shared|prerequisite|readback)/i.test(postChildProse),
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
      readback.resolution !== record.RESOLUTION) return false;
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

function s1aIdentityBoundaryComplete(policy, identityField, value) {
  const requirement = policy.commonRecord.nestedRequiredFields.find((row) =>
    row.record === identityField);
  return Boolean(requirement && s1aHasExactKeys(value, requirement.fields) &&
    requirement.fields.every((field) => s1aTypeMatches(value[field], 'NONEMPTY_STRING')));
}

function s1aCommonRecordNestedIdentitiesComplete(policy, record) {
  const identities = policy.commonRecord.nestedRequiredFields.filter((nested) =>
    nested.record === 'PACKET_IDENTITY' || nested.record === 'CANDIDATE_IDENTITY');
  return Boolean(record && typeof record === 'object' && !Array.isArray(record) &&
    identities.length === 2 && identities.every((nested) =>
      s1aIdentityBoundaryComplete(policy, nested.record, record[nested.record])));
}

function s1aOwnershipReadbackIdentityComplete(policy, readback) {
  return Boolean(readback && typeof readback === 'object' && !Array.isArray(readback) &&
    s1aTypeMatches(readback.repository, 'NONEMPTY_STRING') &&
    s1aIdentityBoundaryComplete(policy, 'PACKET_IDENTITY', readback.packetIdentity) &&
    s1aIdentityBoundaryComplete(policy, 'CANDIDATE_IDENTITY', readback.candidateIdentity));
}

function s1aValidateCommonFindingRecord(policy, record) {
  const failures = [];
  const rule = policy.commonRecord;
  for (const field of rule.requiredFields) {
    if (!s1aPresent(record && record[field])) failures.push(rule.completenessObligation);
    if (!s1aTypeMatches(record && record[field], rule.typedFields[field])) {
      failures.push(rule.completenessObligation);
    }
  }
  for (const nested of rule.nestedRequiredFields) {
    const value = record && record[nested.record];
    if (!s1aHasExactKeys(value, nested.fields) ||
        nested.fields.some((field) => !s1aTypeMatches(value && value[field], 'NONEMPTY_STRING'))) {
      failures.push(rule.completenessObligation);
    }
  }
  for (const binding of rule.nestedBindings) {
    const left = s1aPath(record, binding.left);
    const right = s1aPath(record, binding.right);
    if (!s1aTypeMatches(left, 'NONEMPTY_STRING') ||
        !s1aTypeMatches(right, 'NONEMPTY_STRING')) {
      failures.push(rule.completenessObligation);
    } else if (!s1aSame(left, right)) {
      failures.push('COMMON_RECORD_NESTED_IDENTITY_BINDING:' + binding.left);
    }
  }
  if (record && S1A_ORACLE_DISPOSITIONS.includes(record.DISPOSITION) &&
      S1A_ORACLE_LIFECYCLES.includes(record.LIFECYCLE)) {
    const resolution = rule.resolutionLifecycleBindings.find((row) =>
      row.lifecycle === record.LIFECYCLE);
    if (!resolution || record.RESOLUTION !== resolution.resolution ||
        (rule.adjudicationMustMatchDisposition && record.ADJUDICATION !== record.DISPOSITION)) {
      failures.push(rule.transitionConsistencyObligation);
    }
  } else {
    failures.push(rule.completenessObligation);
  }
  if (!s1aOwnershipReadbackIdentityComplete(policy, record && record.OWNER_READBACK)) {
    failures.push(rule.completenessObligation);
  }
  if (!s1aOwnershipReadbackMatches(record)) {
    failures.push('COMMON_RECORD_OWNER_READBACK_BINDING');
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
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
  const commonRecord = s1aValidateCommonFindingRecord(policy, record);
  if (!commonRecord.ok) failures.push(...commonRecord.failures);
  if (!s1aOwnershipReadbackMatches(record)) failures.push('BLOCKER_OWNER_READBACK');
  for (const nested of policy.commonRecord.nestedRequiredFields.filter((row) =>
    row.record === 'PACKET_IDENTITY' || row.record === 'CANDIDATE_IDENTITY')) {
    const decisionField = nested.record === 'PACKET_IDENTITY'
      ? 'packetIdentity' : 'candidateIdentity';
    if (!s1aIdentityBoundaryComplete(policy, nested.record,
      decision && decision[decisionField])) {
      failures.push(policy.commonRecord.completenessObligation);
    }
  }
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
    companionEntries: [{ ref: detailRef, record: s1aClone(proofRecord) }],
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

function s1aSnapshot(value, references = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (references.has(value)) return references.get(value);
  const copy = Array.isArray(value) ? [] : {};
  references.set(value, copy);
  for (const [key, child] of Object.entries(value)) copy[key] = s1aSnapshot(child, references);
  return copy;
}

function s1aReadbackInputs(inputs) {
  const readbacks = [];
  const active = new Set();
  const visit = (value, path, segments, insideReadback = false) => {
    if (!value || typeof value !== 'object' || active.has(value)) return;
    active.add(value);
    if (insideReadback) {
      readbacks.push({ path, segments, live: value, snapshot: s1aSnapshot(value) });
    }
    for (const [field, child] of Object.entries(value)) {
      const childPath = path + '.' + field;
      const childSegments = [...segments, field];
      visit(child, childPath, childSegments,
        insideReadback || /readback/i.test(field));
    }
    active.delete(value);
  };
  inputs.forEach((input, index) => visit(input, 'input' + index, [index]));
  return readbacks;
}

function s1aInputValueAtPath(inputs, segments) {
  return segments.reduce((value, segment) =>
    value === null || value === undefined ? undefined : value[segment], inputs);
}

function s1aInputObjectReferences(inputs) {
  const references = [];
  const active = new Set();
  const visit = (value, path, segments) => {
    if (!value || typeof value !== 'object') return;
    references.push({ path, segments, live: value });
    if (active.has(value)) return;
    active.add(value);
    for (const [field, child] of Object.entries(value)) {
      visit(child, path + '.' + field, [...segments, field]);
    }
    active.delete(value);
  };
  inputs.forEach((input, index) => visit(input, 'input' + index, [index]));
  return references;
}

function s1aObserveInputPreservation(inputs, evaluate) {
  const snapshots = inputs.map((input) => s1aSnapshot(input));
  const readbacks = s1aReadbackInputs(inputs);
  const objectReferences = s1aInputObjectReferences(inputs);
  const result = evaluate();
  const inputChecks = inputs.map((live, index) => ({
    index,
    unchanged: s1aSame(live, snapshots[index])
  }));
  const readbackChecks = readbacks.map((readback) => ({
    path: readback.path,
    unchanged: s1aSame(readback.live, readback.snapshot),
    referenceUnchanged: s1aInputValueAtPath(inputs, readback.segments) === readback.live
  }));
  const referenceChecks = objectReferences.map((reference) => ({
    path: reference.path,
    unchanged: s1aInputValueAtPath(inputs, reference.segments) === reference.live
  }));
  return {
    result,
    snapshots,
    readbacks,
    inputChecks,
    readbackChecks,
    referenceChecks,
    inputsUnchanged: inputChecks.every((check) => check.unchanged) &&
      readbackChecks.every((check) => check.unchanged && check.referenceUnchanged) &&
      referenceChecks.every((check) => check.unchanged)
  };
}

function s1aObserveTransitionRejection(policy, request, canonicalRecord, trustedContext, evaluator) {
  const inputObservation = s1aObserveInputPreservation(
    [policy, request, canonicalRecord, trustedContext],
    () => evaluator ? evaluator(policy, request, canonicalRecord, trustedContext)
      : evaluateS1aTransition(policy, request.disposition, request.lifecycle,
        request.event, canonicalRecord, trustedContext));
  const canonicalSnapshot = inputObservation.snapshots[2];
  const expectedCanonicalState = {
    disposition: canonicalSnapshot && canonicalSnapshot.DISPOSITION,
    lifecycle: canonicalSnapshot && canonicalSnapshot.LIFECYCLE
  };
  const returnedCanonicalState = {
    disposition: inputObservation.result && inputObservation.result.disposition,
    lifecycle: inputObservation.result && inputObservation.result.lifecycle
  };
  const observerFailures = [];
  if (!inputObservation.inputsUnchanged) observerFailures.push('EVALUATOR_MUTATED_INPUT');
  if (!s1aSame(returnedCanonicalState, expectedCanonicalState)) {
    observerFailures.push('RETURNED_STATE_DIFFERS_FROM_PRE_CALL_CANONICAL');
  }
  if (!inputObservation.result || inputObservation.result.ok !== false) {
    observerFailures.push('EXPECTED_REJECTION');
  }
  if (!inputObservation.result || inputObservation.result.transition !== null) {
    observerFailures.push('REJECTION_TRANSITION_NOT_NULL');
  }
  if (!inputObservation.result || !Array.isArray(inputObservation.result.mutationEffects) ||
      inputObservation.result.mutationEffects.length !== 0) {
    observerFailures.push('REJECTION_HAS_MUTATION_EFFECTS');
  }
  return {
    ...inputObservation,
    canonicalSnapshot,
    expectedCanonicalState,
    returnedCanonicalState,
    observerFailures,
    observerPassed: observerFailures.length === 0
  };
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
    ADMITTED_CURRENT_OUTCOME: { id: 'outcome:alpha', milestone: 'alpha', audience: 'internal', environment: 'staging' },
    DISPOSITION: 'CURRENT_SHIP_BLOCKER', LIFECYCLE: 'UNRESOLVED',
    TIMING: 'current-shipment', TRIGGER_OR_REASON: 'current candidate violates an accepted criterion',
    CLOSURE_CRITERION: 'closure:alpha', EXACT_EVIDENCE: ['evidence:impact', 'evidence:deferral', 'evidence:closure'],
    ATTRIBUTION: 'PRODUCT', VERIFIED_OWNER: 'owner:current-outcome', PRIMARY_OWNER: 'PRODUCT',
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
  ...makeS1aCommonFindingFields({
    FINDING_ID: 'finding:one', WEB_ADMITTED_REVISION: 'web:revision-6',
    FINDING_REVISION: 'finding-revision:one-6', ACCEPTED_DECISION_ID: 'decision:web:one-6',
    DISPOSITION: 'FUTURE_OWNED', LIFECYCLE: 'UNRESOLVED', TIMING: 'future-release',
    VERIFIED_OWNER: 'team:one', TRIGGER_OR_REASON: 'accepted prior owner and trigger',
    CLOSURE_CRITERION: 'closure:one', EXACT_EVIDENCE: ['evidence:one-prior'],
    CANDIDATE_IDENTITY: { commit: 'commit:6', tree: 'tree:6' }, ATTRIBUTION: 'TOOLKIT',
    ADJUDICATION: 'FUTURE_OWNED', PRIMARY_OWNER: 'TOOLKIT', OWNER_ROLE: 'TOOLKIT_OWNER'
  })
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
    Object.freeze({ slot: 'A', provider: 'openai', model: 'gpt-6-astra', reasoning: 'max' }),
    Object.freeze({ slot: 'B', provider: 'anthropic', model: 'opus-5.5', reasoning: 'max' })
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
      ADMITTED_CURRENT_OUTCOME: s1aClone(S1A_ORACLE_ADMITTED_CURRENT_OUTCOME),
      DISPOSITION: 'FUTURE_OWNED', LIFECYCLE: 'UNRESOLVED', TIMING: 'future-release',
      TRIGGER_OR_REASON: 'new acceptance evidence', CLOSURE_CRITERION: 'closure:one',
      EXACT_EVIDENCE: ['evidence:one'], ATTRIBUTION: 'TOOLKIT',
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
      ADMITTED_CURRENT_OUTCOME: s1aClone(S1A_ORACLE_ADMITTED_CURRENT_OUTCOME),
      DISPOSITION: 'EVIDENCE_ONLY', LIFECYCLE: 'UNRESOLVED', TIMING: 'before-next-review',
      TRIGGER_OR_REASON: 'required evidence acquisition', CLOSURE_CRITERION: 'closure:two',
      EXACT_EVIDENCE: ['evidence:two'], ATTRIBUTION: 'HARNESS',
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
    packetIdentity: records[0].PACKET_IDENTITY === undefined
      ? null : s1aClone(records[0].PACKET_IDENTITY),
    acceptedDecisionIds: [...new Set(records.map((record) => record.ACCEPTED_DECISION_ID))].sort(),
    candidateIdentities: records.map((record) => record.CANDIDATE_IDENTITY === undefined
      ? null : s1aClone(record.CANDIDATE_IDENTITY)),
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
  const historyRecordFailures = Array.isArray(historyLedger && historyLedger.records)
    ? historyLedger.records.flatMap((item) => {
      const validation = s1aValidateCommonFindingRecord(policy, item && item.record);
      return validation.ok ? [] : validation.failures;
    }) : [];
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
    return { ok: false, failures: [...new Set([...historyRecordFailures, 'COMPANION_HISTORY_READBACK'])] };
  }
  const packetIdentityFields = policy.commonRecord.nestedRequiredFields
    .find((row) => row.record === 'PACKET_IDENTITY').fields;
  const candidateIdentityFields = policy.commonRecord.nestedRequiredFields
    .find((row) => row.record === 'CANDIDATE_IDENTITY').fields;
  const inventoryPacketIdentity = currentInventory && currentInventory.packetIdentity;
  const inventoryCandidateIdentities = currentInventory && currentInventory.candidateIdentities;
  const inventoryNestedIdentitiesComplete =
    s1aHasExactKeys(inventoryPacketIdentity, packetIdentityFields) &&
    packetIdentityFields.every((field) =>
      s1aTypeMatches(inventoryPacketIdentity[field], 'NONEMPTY_STRING')) &&
    Array.isArray(inventoryCandidateIdentities) &&
    inventoryCandidateIdentities.every((identity) =>
      s1aHasExactKeys(identity, candidateIdentityFields) &&
      candidateIdentityFields.every((field) =>
        s1aTypeMatches(identity[field], 'NONEMPTY_STRING')));
  if (!inventoryNestedIdentitiesComplete) {
    failures.push(policy.commonRecord.completenessObligation);
  }
  if (currentInventory.records.some((entry) =>
    !s1aCommonRecordNestedIdentitiesComplete(policy, entry && entry.record))) {
    failures.push(policy.commonRecord.completenessObligation);
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
    const commonResult = s1aValidateCommonFindingRecord(policy, entry && entry.record);
    if (!commonResult.ok) failures.push(...commonResult.failures);
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
    const commonResult = s1aValidateCommonFindingRecord(policy, item && item.record);
    if (!commonResult.ok) failures.push(...commonResult.failures);
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
    if (!s1aIdentityBoundaryComplete(policy, 'PACKET_IDENTITY',
      projection && projection.PACKET_IDENTITY) ||
        !s1aIdentityBoundaryComplete(policy, 'CANDIDATE_IDENTITY',
          projection && projection.CANDIDATE_IDENTITY)) {
      failures.push(policy.commonRecord.completenessObligation);
    }
    const ref = projection[refField];
    const matches = entries.filter((entry) => entry[recordRefField] === ref);
    if (!s1aPresent(ref) || matches.length !== 1) {
      failures.push('COMPANION_REFERENCE_MEMBERSHIP');
      continue;
    }
    const record = matches[0].record;
    const acceptedRecord = [...S1A_ORACLE_CURRENT_COMPANION_RECORDS, S1A_ORACLE_BLOCKER_PROOF_RECORD]
      .find((candidate) => candidate.FINDING_ID === record.FINDING_ID);
    if (!acceptedRecord || !S1A_ORACLE_COMMON_RECORD_FIELDS.every((field) =>
      s1aSame(record[field], acceptedRecord[field]))) {
      failures.push('COMPANION_SEMANTIC_CONTEXT_BINDING');
    }
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
        if (['REPOSITORY', 'PACKET_IDENTITY', 'FINDING_ID', 'FINDING_REVISION',
          'WEB_ADMITTED_REVISION', 'CANDIDATE_IDENTITY', 'ACCEPTED_DECISION_ID',
          'ADMITTED_CURRENT_OUTCOME', 'ATTRIBUTION'].includes(field)) {
          failures.push('COMPANION_SEMANTIC_CONTEXT_BINDING');
        }
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
    S1A_ORACLE_BLOCKER_NESTED_FIELDS.reduce((count, row) => count + row.fields.length, 0));
   assert.equal(results.find((item) => item.id === 'blocker-complete-current-record').observed, true);
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
    assert.equal(result.lifecycle, undefined);
    assert.equal(result.disposition, undefined);
  }
  const deferredFalse = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED', 'DEFER', {
    VERIFIED_OWNER: 'owner:verified', TIMING: 'future-release',
    TRIGGER_OR_REASON: false
  });
  assert.equal(deferredFalse.ok, false);
  assert.equal(deferredFalse.lifecycle, undefined);
  assert.equal(deferredFalse.disposition, undefined);

  const verified = makeS1aCommonFindingFields({
    FINDING_ID: S1A_ORACLE_CLOSURE_BODY.findingId,
    WEB_ADMITTED_REVISION: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
    DISPOSITION: S1A_ORACLE_CLOSURE_BODY.disposition,
    LIFECYCLE: S1A_ORACLE_CLOSURE_BODY.fromLifecycle,
    CLOSURE_CRITERION: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
    EXACT_EVIDENCE: [...S1A_ORACLE_CLOSURE_BODY.exactEvidence],
    CANDIDATE_IDENTITY: s1aClone(S1A_ORACLE_CLOSURE_BODY.candidateIdentity),
    ADJUDICATION: S1A_ORACLE_CLOSURE_BODY.disposition
  });
  verified.closureReadback = s1aClone(S1A_ORACLE_CLOSURE_READBACK);
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
test('S1-A F1 rejects transition contradictions before effects, including valid objects composed across contexts', () => {
  const policy = parseS1aPolicyContract(architecture);
  const assertRejected = (result, canonicalRecord, label, obligation = 'F1_RECORD_TRANSITION_CONSISTENCY') => {
    assert.equal(result.ok, false, label + ' must reject');
    assert.ok(result.failures.includes(obligation), label + ' must fail on ' + obligation);
    assert.equal(result.transition, null, label + ' must create no transition');
    assert.deepEqual(result.mutationEffects, [], label + ' must create no effect');
    assert.equal(result.disposition, canonicalRecord.DISPOSITION, label + ' must return canonical disposition');
    assert.equal(result.lifecycle, canonicalRecord.LIFECYCLE, label + ' must return canonical lifecycle');
  };

  const rebindLifecycleReadback = (record, lifecycle, resolution) => {
    record.LIFECYCLE = lifecycle;
    record.RESOLUTION = resolution;
    record.OWNER_READBACK.lifecycle = lifecycle;
    record.OWNER_READBACK.resolution = resolution;
    const { digest, ...core } = record.OWNER_READBACK;
    record.OWNER_READBACK.digest = s1aHashRecord(core);
  };
  const companionFixture = makeS1aCompanionFixture();
  const companionBaseline = evaluateS1aCompanions(policy, companionFixture.projections,
    companionFixture.entries, companionFixture.historyLedger, companionFixture.currentInventory);
  assert.equal(companionBaseline.ok, true, 'complete companion context must pass on its own');
  const futureRecord = companionFixture.entries[0].record;
  assert.equal(futureRecord.DISPOSITION, 'FUTURE_OWNED');
  assert.equal(futureRecord.LIFECYCLE, 'UNRESOLVED');
  assert.equal(s1aValidateCommonFindingRecord(policy, futureRecord).ok, true,
    'complete canonical record must pass on its own');
  const matchingDefer = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
    'DEFER', futureRecord);
  assert.equal(matchingDefer.ok, true, 'matching FUTURE_OWNED/UNRESOLVED defer must pass');
  assert.deepEqual(matchingDefer.transition,
    { event: 'DEFER', disposition: 'FUTURE_OWNED', from: 'UNRESOLVED', to: 'UNRESOLVED' });
  for (const field of S1A_ORACLE_COMMON_RECORD_FIELDS) {
    const record = makeS1aCommonFindingFields({ FINDING_ID: 'finding:missing-common:' + field });
    const baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'DEFER', record);
    assert.equal(baseline.ok, true, 'missing ' + field + ' control must start from a passing baseline');
    delete record[field];
    assert.equal(Object.prototype.hasOwnProperty.call(record, field), false,
      'common field mutation must be present: ' + field);
    const result = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED', 'DEFER', record);
    assertRejected(result, record, 'missing common field ' + field,
      'F2_COMMON_RECORD_COMPANION_COMPLETENESS');
  }
  for (const field of ['id', 'milestone', 'audience', 'environment']) {
    const record = makeS1aCommonFindingFields({ FINDING_ID: 'finding:missing-outcome:' + field });
    const baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'DEFER', record);
    assert.equal(baseline.ok, true, 'missing outcome ' + field + ' must start from a passing baseline');
    delete record.ADMITTED_CURRENT_OUTCOME[field];
    assert.equal(Object.prototype.hasOwnProperty.call(record.ADMITTED_CURRENT_OUTCOME, field), false,
      'nested outcome field mutation must be present: ' + field);
    const result = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED', 'DEFER', record);
    assertRejected(result, record, 'missing outcome field ' + field,
      'F2_COMMON_RECORD_COMPANION_COMPLETENESS');
  }

  const blockerRecord = makeS1aCommonFindingFields({
    FINDING_ID: 'finding:composition-blocker',
    DISPOSITION: 'CURRENT_SHIP_BLOCKER',
    ADJUDICATION: 'CURRENT_SHIP_BLOCKER'
  });
  assert.equal(s1aValidateCommonFindingRecord(policy, blockerRecord).ok, true,
    'complete blocker record must pass in its matching context');
  const blockerTransition = evaluateS1aTransition(policy, 'CURRENT_SHIP_BLOCKER',
    'UNRESOLVED', 'DEFER', blockerRecord);
  assert.equal(blockerTransition.ok, true,
    'the blocker transition request must pass with its own matching record');
  const composedContradiction = evaluateS1aTransition(policy, 'CURRENT_SHIP_BLOCKER',
    'UNRESOLVED', 'DEFER', futureRecord);
  assertRejected(composedContradiction, futureRecord,
    'separately valid future record, companion, and blocker transition composed together');
  assert.equal(evaluateS1aCompanions(policy, companionFixture.projections,
    companionFixture.entries, companionFixture.historyLedger, companionFixture.currentInventory).ok,
  true, 'the companion remains valid while the contradictory transition is rejected');

  const sameRecordWrongDisposition = evaluateS1aTransition(policy, 'CURRENT_SHIP_BLOCKER',
    'UNRESOLVED', 'DEFER', futureRecord);
  assertRejected(sameRecordWrongDisposition, futureRecord,
    'FUTURE_OWNED/UNRESOLVED record with CURRENT_SHIP_BLOCKER/UNRESOLVED arguments');

  const resolvedRecord = s1aClone(futureRecord);
  const resolvedRecordBefore = s1aClone(resolvedRecord);
  rebindLifecycleReadback(resolvedRecord, 'RESOLVED', 'RESOLVED');
  assert.notDeepEqual(resolvedRecord, resolvedRecordBefore,
    'canonical lifecycle mutation must be present');
  assert.equal(s1aValidateCommonFindingRecord(policy, resolvedRecord).ok, true,
    'RESOLVED record with matching resolution/readback must be valid on its own');
  const resolvedRecordUnresolvedSource = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'DEFER', resolvedRecord);
  assertRejected(resolvedRecordUnresolvedSource, resolvedRecord,
    'canonical RESOLVED record with UNRESOLVED source lifecycle mutated from a passing defer');

  const closureBaselineRecord = makeS1aCommonFindingFields({
    FINDING_ID: S1A_ORACLE_CLOSURE_BODY.findingId,
    WEB_ADMITTED_REVISION: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
    DISPOSITION: S1A_ORACLE_CLOSURE_BODY.disposition,
    ADJUDICATION: S1A_ORACLE_CLOSURE_BODY.disposition,
    LIFECYCLE: 'UNRESOLVED',
    CLOSURE_CRITERION: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
    EXACT_EVIDENCE: [...S1A_ORACLE_CLOSURE_BODY.exactEvidence],
    CANDIDATE_IDENTITY: s1aClone(S1A_ORACLE_CLOSURE_BODY.candidateIdentity)
  });
  closureBaselineRecord.closureReadback = s1aClone(S1A_ORACLE_CLOSURE_READBACK);
  const verifiedClosureBaseline = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', closureBaselineRecord);
  assert.equal(verifiedClosureBaseline.ok, true,
    'verified closure and unresolved canonical record must pass together');
  const foreignClosureOutcome = s1aClone(closureBaselineRecord);
  foreignClosureOutcome.ADMITTED_CURRENT_OUTCOME = {
    id: 'outcome:foreign', milestone: 'milestone:foreign',
    audience: 'external:foreign', environment: 'production:foreign'
  };
  foreignClosureOutcome.OWNER_READBACK.admittedCurrentOutcome =
    s1aClone(foreignClosureOutcome.ADMITTED_CURRENT_OUTCOME);
  const { digest: oldOwnerDigest, ...foreignOwnerReadbackCore } = foreignClosureOutcome.OWNER_READBACK;
  void oldOwnerDigest;
  foreignClosureOutcome.OWNER_READBACK.digest = s1aHashRecord(foreignOwnerReadbackCore);
  assert.equal(s1aValidateCommonFindingRecord(policy, foreignClosureOutcome).ok, true,
    'foreign outcome with coherently rebound owner readback must remain a complete record on its own');
  const foreignClosureResult = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', foreignClosureOutcome);
  assertRejected(foreignClosureResult, foreignClosureOutcome,
    'complete foreign outcome composed with an unchanged accepted closure readback');

  const resolvedClosureRecord = s1aClone(closureBaselineRecord);
  rebindLifecycleReadback(resolvedClosureRecord, 'RESOLVED', 'RESOLVED');
  assert.equal(s1aValidateCommonFindingRecord(policy, resolvedClosureRecord).ok, true,
    'mutated canonical closure record must remain internally complete');
  const closureSourceMismatch = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', resolvedClosureRecord);
  assertRejected(closureSourceMismatch, resolvedClosureRecord,
    'verified closure readback source lifecycle that conflicts with the canonical record');
  const incompleteClosureRecord = s1aClone(closureBaselineRecord);
  delete incompleteClosureRecord.ADMITTED_CURRENT_OUTCOME;
  assert.equal(Object.prototype.hasOwnProperty.call(incompleteClosureRecord, 'ADMITTED_CURRENT_OUTCOME'), false,
    'closure common-field mutation must be present');
  const missingClosureCommonField = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', incompleteClosureRecord);
  assertRejected(missingClosureCommonField, incompleteClosureRecord,
    'verified closure with missing admitted outcome', 'F2_COMMON_RECORD_COMPANION_COMPLETENESS');
  const incompleteClosureReadback = s1aClone(closureBaselineRecord);
  delete incompleteClosureReadback.closureReadback.commonRecord.ADMITTED_CURRENT_OUTCOME;
  const missingClosureReadbackField = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', incompleteClosureReadback);
  assertRejected(missingClosureReadbackField, incompleteClosureReadback,
    'verified closure readback with incomplete canonical common record',
    'F2_COMMON_RECORD_COMPANION_COMPLETENESS');
  const incompleteClosureOutcome = s1aClone(closureBaselineRecord);
  delete incompleteClosureOutcome.closureReadback.commonRecord.ADMITTED_CURRENT_OUTCOME.environment;
  const missingNestedClosureOutcome = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'VERIFIED_CLOSURE', incompleteClosureOutcome);
  assertRejected(missingNestedClosureOutcome, incompleteClosureOutcome,
    'verified closure readback with missing admitted outcome environment',
    'F2_COMMON_RECORD_COMPANION_COMPLETENESS');

  const trustedContext = Object.freeze({ currentOwnershipReadback:
    s1aDeepFreeze(s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK)) });
  const transferRecord = makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY);
  const validTransfer = evaluateS1aTransition(policy, 'FUTURE_OWNED', 'UNRESOLVED',
    'TRANSFER', transferRecord, trustedContext);
  assert.equal(validTransfer.ok, true, 'complete transfer record and readback must pass on their own');
  const contradictoryTransfer = evaluateS1aTransition(policy, 'CURRENT_SHIP_BLOCKER',
    'UNRESOLVED', 'TRANSFER', transferRecord, trustedContext);
  assertRejected(contradictoryTransfer, transferRecord,
    'valid FUTURE_OWNED transfer record with contradictory blocker arguments');

  const incompleteTransfer = s1aClone(transferRecord);
  delete incompleteTransfer.ADMITTED_CURRENT_OUTCOME;
  const incompleteTransferResult = evaluateS1aTransition(policy, 'FUTURE_OWNED',
    'UNRESOLVED', 'TRANSFER', incompleteTransfer, trustedContext);
  assertRejected(incompleteTransferResult, incompleteTransfer,
    'transfer with a missing admitted outcome', 'F2_COMMON_RECORD_COMPANION_COMPLETENESS');
});

test('S1-A companion context binds outcome fields and rejects coherent foreign rebinds', () => {
  const policy = parseS1aPolicyContract(architecture);
  const evaluate = (fixture) => evaluateS1aCompanions(policy, fixture.projections,
    fixture.entries, fixture.historyLedger, fixture.currentInventory);
  const baseline = makeS1aCompanionFixture();
  assert.equal(evaluate(baseline).ok, true, 'complete matching companion baseline must pass');

  for (const [field, foreignValue] of [
    ['id', 'outcome:foreign'],
    ['milestone', 'milestone:foreign'],
    ['audience', 'external:foreign'],
    ['environment', 'production:foreign']
  ]) {
    const fixture = makeS1aCompanionFixture();
    assert.equal(evaluate(fixture).ok, true, 'foreign ' + field + ' case must start from a passing baseline');
    const before = s1aClone(fixture.projections[0].ADMITTED_CURRENT_OUTCOME[field]);
    fixture.projections[0].ADMITTED_CURRENT_OUTCOME[field] = foreignValue;
    assert.notEqual(fixture.projections[0].ADMITTED_CURRENT_OUTCOME[field], before,
      field + ' mutation must be present');
    const result = evaluate(fixture);
    assert.equal(result.ok, false, 'foreign ' + field + ' projection must reject');
    assert.ok(result.failures.includes('COMPANION_SEMANTIC_CONTEXT_BINDING'),
      'foreign ' + field + ' must fail on semantic context binding');
    assert.ok(result.failures.includes('COMPANION_IDENTITY_BINDING:ADMITTED_CURRENT_OUTCOME'));
    assert.equal(result.failures.some((failure) => /PARSER|DIGEST|EXACT_CONTENT_BINDING/.test(failure)),
      false, 'foreign ' + field + ' must not rely on parsing or content-hash failure');
  }

  const foreignContextFixture = makeS1aCompanionFixture();
  assert.equal(evaluate(foreignContextFixture).ok, true, 'coherent-rebind attack must start from a passing baseline');
  const foreignRecords = foreignContextFixture.entries.map((entry) => s1aClone(entry.record));
  const foreignRecord = foreignRecords[0];
  foreignRecord.ADMITTED_CURRENT_OUTCOME = {
    id: 'outcome:foreign', milestone: 'milestone:foreign',
    audience: 'external:foreign', environment: 'production:foreign'
  };
  foreignRecord.OWNER_READBACK.admittedCurrentOutcome =
    s1aClone(foreignRecord.ADMITTED_CURRENT_OUTCOME);
  const { digest: oldReadbackDigest, ...readbackCore } = foreignRecord.OWNER_READBACK;
  foreignRecord.OWNER_READBACK.digest = s1aHashRecord(readbackCore);
  foreignContextFixture.currentInventory = makeS1aCurrentCompanionInventory(foreignRecords,
    'web:inventory-revision-foreign-context');
  foreignContextFixture.entries = s1aClone(foreignContextFixture.currentInventory.records);
  foreignContextFixture.projections = foreignContextFixture.entries.map((entry) => {
    const record = entry.record;
    const mapping = S1A_ORACLE_PROJECTION_ROWS.find((row) =>
      row.disposition === record.DISPOSITION && row.lifecycle === record.LIFECYCLE);
    return makeS1aCompanionProjection(record, entry.ref, {
      TWO_WAY: mapping.twoWay, V1: mapping.v1
    });
  });
  assert.notEqual(oldReadbackDigest, foreignRecord.OWNER_READBACK.digest,
    'foreign readback must be coherently rehashed');
  assert.equal(s1aValidateCommonFindingRecord(policy, foreignRecord).ok, true,
    'foreign common record and ownership readback must remain structurally valid');
  assert.deepEqual(foreignContextFixture.projections[0].ADMITTED_CURRENT_OUTCOME,
    foreignContextFixture.entries[0].record.ADMITTED_CURRENT_OUTCOME,
    'projection must be rebound to the same foreign record context');
  assert.equal(foreignContextFixture.entries[0].ref,
    s1aHashRecord(foreignContextFixture.entries[0].record), 'companion content hash must match');
  assert.equal(foreignContextFixture.projections[0].DETAIL_REF,
    foreignContextFixture.entries[0].ref, 'projection reference must be rebound');
  assert.equal(foreignContextFixture.currentInventory.digest,
    s1aHashWithoutField(foreignContextFixture.currentInventory, 'digest'),
    'complete inventory digest must match its coherently rebound bytes');
  const foreignContextResult = evaluate(foreignContextFixture);
  assert.equal(foreignContextResult.ok, false);
  assert.ok(foreignContextResult.failures.includes('COMPANION_SEMANTIC_CONTEXT_BINDING'),
    'collectively self-consistent foreign record/readback/projection must reject against accepted context');
  assert.equal(foreignContextResult.failures.includes('COMPANION_EXACT_CONTENT_BINDING'), false,
    'coherent foreign context must not reject because of a content hash mismatch');

  const incompleteFixture = makeS1aCompanionFixture();
  const incompleteBaseline = evaluate(incompleteFixture);
  assert.equal(incompleteBaseline.ok, true, 'F2 attack must start from passing companions');
  const incompleteRecords = incompleteFixture.entries.map((entry) => s1aClone(entry.record));
  delete incompleteRecords[0].ADMITTED_CURRENT_OUTCOME;
  assert.equal(Object.prototype.hasOwnProperty.call(incompleteRecords[0], 'ADMITTED_CURRENT_OUTCOME'), false,
    'missing common field mutation must be present');
  incompleteFixture.currentInventory = makeS1aCurrentCompanionInventory(incompleteRecords,
    'web:inventory-revision-incomplete-common-record');
  incompleteFixture.entries = s1aClone(incompleteFixture.currentInventory.records);
  incompleteFixture.projections = incompleteFixture.entries.map((entry) => {
    const record = entry.record;
    const mapping = S1A_ORACLE_PROJECTION_ROWS.find((row) =>
      row.disposition === record.DISPOSITION && row.lifecycle === record.LIFECYCLE);
    return makeS1aCompanionProjection(record, entry.ref, {
      TWO_WAY: mapping.twoWay, V1: mapping.v1
    });
  });
  const incompleteResult = evaluate(incompleteFixture);
  assert.equal(incompleteResult.ok, false);
  assert.ok(incompleteResult.failures.includes('F2_COMMON_RECORD_COMPANION_COMPLETENESS'),
    'missing common companion field must reject on the named F2 obligation');
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

  const incompleteClosureBinding = rewriteS1aPolicy(architecture, (policy) => {
    policy.closureVerification.commonRecordMode = 'CALLER_REBOUND_COMMON_RECORD';
  });
  assert.throws(() => parseS1aPolicyContract(incompleteClosureBinding),
    /verified closure must use the complete current Web closure readback/);

  const closureRule = rewriteS1aPolicy(architecture, (policy) => {
    policy.closureVerification.resolvesOnlyAfterVerifiedReadback = false;
  });
  const correctClosureSentence = 'Resolution changes only lifecycle to RESOLVED after an authoritative, current Web closure readback binds the complete canonical common record, including the admitted outcome, milestone, audience and environment, and verifies the exact finding, admitted disposition, closure criterion, evidence references, candidate identity and transition; a caller-supplied criterion, evidence label or recomputed digest alone cannot resolve work.';
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
  const safeDetail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const rejected = (failures) => ({
    ok: S1A_ORACLE_REJECTED_REQUEST_STATE.ok,
    disposition: safeDetail[S1A_ORACLE_REJECTED_REQUEST_STATE.dispositionField],
    lifecycle: safeDetail[S1A_ORACLE_REJECTED_REQUEST_STATE.lifecycleField],
    transition: S1A_ORACLE_REJECTED_REQUEST_STATE.transition,
    mutationEffects: [...S1A_ORACLE_REJECTED_REQUEST_STATE.mutationEffects],
    failures
  });
  if (!s1aSame(policy.lifecycleTransitions, S1A_ORACLE_LIFECYCLE_TRANSITIONS) ||
      !s1aSame(policy.closureVerification, S1A_ORACLE_CLOSURE_VERIFICATION)) {
    return rejected(['LIFECYCLE_POLICY_NOT_FIXED']);
  }
  if (!S1A_ORACLE_DISPOSITIONS.includes(disposition)) {
    return rejected(['LIFECYCLE_DISPOSITION_UNKNOWN']);
  }
  const matches = policy.lifecycleTransitions.filter((row) => row.event === event);
  if (matches.length !== 1) return rejected(['LIFECYCLE_TRANSITION_MISSING_OR_AMBIGUOUS']);
  const rule = matches[0];
  const failures = [];
  const commonRecord = s1aValidateCommonFindingRecord(policy, safeDetail);
  if (!commonRecord.ok) failures.push(...commonRecord.failures);
  if ((s1aPresent(safeDetail.DISPOSITION) && safeDetail.DISPOSITION !== disposition) ||
      (s1aPresent(safeDetail.LIFECYCLE) && safeDetail.LIFECYCLE !== lifecycle)) {
    failures.push(policy.commonRecord.transitionConsistencyObligation);
  }
  if (lifecycle !== rule.from) failures.push('LIFECYCLE_SOURCE_MISMATCH');
  for (const field of rule.requires) {
    if (!s1aPresent(safeDetail[field])) failures.push('LIFECYCLE_PROOF_MISSING:' + field);
    if (!s1aTypeMatches(safeDetail[field], rule.requiredValueTypes[field])) {
      failures.push('LIFECYCLE_VALUE_TYPE:' + field);
    }
  }
  const safeTrustedContext = trustedContext && typeof trustedContext === 'object' &&
    !Array.isArray(trustedContext) ? trustedContext : {};
  if (event === 'TRANSFER') {
    if (!s1aOwnershipReadbackIdentityComplete(policy,
      safeTrustedContext.currentOwnershipReadback)) {
      failures.push(policy.commonRecord.completenessObligation);
    }
    if (!s1aOwnershipTransferReadbackMatches(safeDetail,
      safeTrustedContext.currentOwnershipReadback)) {
      failures.push('LIFECYCLE_OWNER_TRANSFER_READBACK');
    }
  }
  if (event === 'VERIFIED_CLOSURE') {
    const closure = safeDetail.closureReadback;
    if (!s1aIdentityBoundaryComplete(policy, 'CANDIDATE_IDENTITY',
      closure && closure.candidateIdentity)) {
      failures.push(policy.commonRecord.completenessObligation);
    }
    if (closure && s1aPresent(closure.fromLifecycle) &&
        s1aPresent(safeDetail.LIFECYCLE) && closure.fromLifecycle !== safeDetail.LIFECYCLE) {
      failures.push(policy.commonRecord.transitionConsistencyObligation);
    }
    const body = closure && Object.fromEntries(policy.closureVerification.bodyFields
      .map((field) => [field, closure[field]]));
    const closureCommonRecord = closure && closure[policy.closureVerification.commonRecordField];
    const canonicalCommonRecord = Object.fromEntries(policy.commonRecord.requiredFields
      .map((field) => [field, safeDetail[field]]));
    const closureCommonRecordValidation = s1aValidateCommonFindingRecord(policy, closureCommonRecord);
    const closureCommonRecordComplete = s1aHasExactKeys(closureCommonRecord,
      policy.commonRecord.requiredFields) &&
      !closureCommonRecordValidation.failures.includes(policy.commonRecord.completenessObligation);
    if (!closureCommonRecordComplete) {
      failures.push(policy.commonRecord.completenessObligation);
    } else if (!s1aSame(canonicalCommonRecord, closureCommonRecord)) {
      failures.push(policy.commonRecord.transitionConsistencyObligation);
    }
    const boundToTransition = closure &&
      safeDetail.REPOSITORY === closure.repository &&
      safeDetail.FINDING_ID === closure.findingId &&
      safeDetail.WEB_ADMITTED_REVISION === closure.webAdmittedRevision &&
      safeDetail.DISPOSITION === disposition && closure.disposition === safeDetail.DISPOSITION &&
      safeDetail.CLOSURE_CRITERION === closure.closureCriterion &&
      s1aSame(safeDetail.EXACT_EVIDENCE, closure.exactEvidence) &&
      s1aSame(safeDetail.CANDIDATE_IDENTITY, closure.candidateIdentity) &&
      s1aSame(canonicalCommonRecord, closureCommonRecord) &&
      safeDetail.LIFECYCLE === closure.fromLifecycle &&
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
  const uniqueFailures = [...new Set(failures)];
  const ok = uniqueFailures.length === 0;
  return {
    ok,
    disposition: safeDetail.DISPOSITION,
    lifecycle: ok ? rule.to : safeDetail.LIFECYCLE,
    transition: ok ? { event, disposition: safeDetail.DISPOSITION, from: lifecycle, to: rule.to } : null,
    mutationEffects: [],
    failures: uniqueFailures
  };
}

const S1A_TARGET_IDENTITY_LEAVES = Object.freeze([
  Object.freeze({ identity: 'PACKET_IDENTITY', field: 'repository' }),
  Object.freeze({ identity: 'PACKET_IDENTITY', field: 'packetId' }),
  Object.freeze({ identity: 'PACKET_IDENTITY', field: 'packetRevision' }),
  Object.freeze({ identity: 'CANDIDATE_IDENTITY', field: 'commit' }),
  Object.freeze({ identity: 'CANDIDATE_IDENTITY', field: 'tree' })
]);
const S1A_TARGET_LEAF_MUTATIONS = Object.freeze([
  Object.freeze({ id: 'missing', apply: (parent, identity, field) => { delete parent[identity][field]; } }),
  Object.freeze({ id: 'blank', apply: (parent, identity, field) => { parent[identity][field] = '  '; } }),
  Object.freeze({ id: 'wrong-type', apply: (parent, identity, field) => { parent[identity][field] = 7; } })
]);
const S1A_TARGET_BAD_IDENTITY_SHAPES = Object.freeze([
  Object.freeze({ id: 'null', value: null }),
  Object.freeze({ id: 'boolean', value: false }),
  Object.freeze({ id: 'array', value: Object.freeze([]) }),
  Object.freeze({ id: 'string', value: 'identity' }),
  Object.freeze({ id: 'empty-object', value: Object.freeze({}) })
]);
const S1A_RESIDUAL_NESTED_IDENTITY_MUTATIONS = Object.freeze([
  Object.freeze({ id: 'omitted' }),
  Object.freeze({ id: 'empty-string', value: '' }),
  Object.freeze({ id: 'whitespace', value: '   ' }),
  Object.freeze({ id: 'null', value: null }),
  Object.freeze({ id: 'numeric', value: 17 }),
  Object.freeze({ id: 'array', value: Object.freeze([]) })
]);
const S1A_RESIDUAL_NESTED_IDENTITY_BOUNDARIES = Object.freeze([
  'blocker-admission',
  'inventory-embedded-record'
]);

const S1A_TARGET_F2_SURFACES = Object.freeze([
  'common-defer',
  'owner-readback',
  'companion-current-record',
  'companion-projection',
  'companion-history-record',
  'inventory-header',
  'transfer-record',
  'transfer-trusted-readback',
  'closure-source-record',
  'closure-common-record',
  'closure-top-level',
  'blocker-record',
  'blocker-companion-record'
]);

function s1aRefreshCommonOwnerReadback(record) {
  const readback = record && record.OWNER_READBACK;
  const rule = S1A_ORACLE_OWNERSHIP_READBACK_RULE;
  if (!readback || typeof readback !== 'object' || Array.isArray(readback)) return;
  for (const binding of rule.recordBindings) {
    if (!Object.prototype.hasOwnProperty.call(record, binding.record) ||
        record[binding.record] === undefined) {
      delete readback[binding.readback];
    } else {
      readback[binding.readback] = s1aClone(record[binding.record]);
    }
  }
  const core = Object.fromEntries(rule.requiredFields.filter((field) => field !== 'digest')
    .map((field) => [field, readback[field]]));
  readback.digest = s1aHashRecord(core);
}

function s1aRefreshReadbackDigest(readback) {
  const core = Object.fromEntries(Object.keys(readback || {})
    .filter((field) => field !== 'digest').map((field) => [field, readback[field]]));
  readback.digest = s1aHashRecord(core);
}

function s1aRefreshClosureReadback(readback) {
  const body = Object.fromEntries(S1A_ORACLE_CLOSURE_VERIFICATION.bodyFields
    .map((field) => [field, readback[field]]));
  readback.body = s1aCanonical(body);
  readback.bodyDigest = s1aHashText(readback.body);
}

function s1aRefreshCurrentCompanionFixture(fixture, revision) {
  const records = fixture.entries.map((entry) => entry.record);
  fixture.currentInventory = makeS1aCurrentCompanionInventory(records, revision);
  fixture.entries = s1aClone(fixture.currentInventory.records);
  fixture.projections = fixture.entries.map((entry) => {
    const mapping = S1A_ORACLE_PROJECTION_ROWS.find((row) =>
      row.disposition === entry.record.DISPOSITION &&
      row.lifecycle === entry.record.LIFECYCLE);
    return makeS1aCompanionProjection(entry.record, entry.ref, {
      TWO_WAY: mapping && mapping.twoWay, V1: mapping && mapping.v1
    });
  });
}

function s1aRefreshIsolatedCurrentCompanionRecord(fixture, index, revision) {
  const entry = fixture.entries[index];
  entry.ref = s1aHashRecord(entry.record);
  fixture.projections[index].DETAIL_REF = entry.ref;
  fixture.currentInventory.revision = revision;
  fixture.currentInventory.records = s1aClone(fixture.entries);
  fixture.currentInventory.digest = s1aHashWithoutField(
    fixture.currentInventory, 'digest');
}

function s1aRefreshHistoryFixture(historyLedger) {
  for (const entry of historyLedger.records) entry.ref = s1aHashRecord(entry.record);
  const core = {
    source: historyLedger.source,
    authoritative: historyLedger.authoritative,
    complete: historyLedger.complete,
    records: historyLedger.records
  };
  historyLedger.digest = s1aHashRecord(core);
  const parent = historyLedger.parentContractReadback;
  const body = JSON.parse(parent.body);
  body.companionHistoryDigest = historyLedger.digest;
  parent.body = s1aCanonical(body);
  parent.bodyDigest = s1aHashText(parent.body);
}

function s1aMatrixClosureRecord() {
  const record = makeS1aCommonFindingFields({
    FINDING_ID: S1A_ORACLE_CLOSURE_BODY.findingId,
    WEB_ADMITTED_REVISION: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
    DISPOSITION: S1A_ORACLE_CLOSURE_BODY.disposition,
    ADJUDICATION: S1A_ORACLE_CLOSURE_BODY.disposition,
    LIFECYCLE: S1A_ORACLE_CLOSURE_BODY.fromLifecycle,
    CLOSURE_CRITERION: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
    EXACT_EVIDENCE: [...S1A_ORACLE_CLOSURE_BODY.exactEvidence],
    CANDIDATE_IDENTITY: s1aClone(S1A_ORACLE_CLOSURE_BODY.candidateIdentity)
  });
  record.closureReadback = s1aClone(S1A_ORACLE_CLOSURE_READBACK);
  return record;
}

function s1aMatrixTransitionContext(event) {
  return event === 'TRANSFER' ? {
    currentOwnershipReadback: s1aDeepFreeze(s1aClone(
      S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK))
  } : undefined;
}

function s1aAcceptedTransitionBaseline(policy, record, event) {
  return evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
    event, record, s1aMatrixTransitionContext(event));
}

function s1aMatrixRecordForEvent(event, disposition = 'FUTURE_OWNED', lifecycle = 'UNRESOLVED') {
  let record;
  if (event === 'TRANSFER') {
    record = makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY);
  } else if (event === 'VERIFIED_CLOSURE') {
    record = s1aMatrixClosureRecord();
  } else {
    record = makeS1aCommonFindingFields({});
  }
  record.DISPOSITION = disposition;
  record.ADJUDICATION = disposition;
  record.LIFECYCLE = lifecycle;
  record.RESOLUTION = lifecycle === 'RESOLVED' ? 'RESOLVED' : 'NOT_RESOLVED';
  s1aRefreshCommonOwnerReadback(record);
  return record;
}

function s1aMatrixCompanionResult(policy, fixture) {
  return {
    ...evaluateS1aCompanions(policy, fixture.projections, fixture.entries,
      fixture.historyLedger, fixture.currentInventory),
    transition: null,
    mutationEffects: []
  };
}

function s1aMatrixBlockerResult(policy, fixture) {
  const result = evaluateS1aBlocker(policy, fixture.record, fixture.decision,
    fixture.companionProjection, fixture.companionEntries, fixture.currentInventory);
  return { ...result, ok: result.admitted, transition: null, mutationEffects: [] };
}

function s1aApplyTargetIdentityEdit(parent, identity, edit) {
  const alias = identity === 'PACKET_IDENTITY' ? 'packetIdentity' : 'candidateIdentity';
  const field = Object.prototype.hasOwnProperty.call(parent, identity) ? identity : alias;
  const before = s1aSnapshot(parent[field]);
  edit(parent, field);
  if (s1aSame(before, parent[field])) {
    throw new Error('identity mutation did not occur for ' + identity);
  }
}

function s1aApplyTargetLeafMutation(parent, identity, field, mutation) {
  const value = parent && parent[identity];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('identity parent is not a record for ' + identity);
  }
  mutation.apply(parent, identity, field);
}

function s1aTargetIdentitiesForSurface(surface) {
  return surface === 'closure-top-level'
    ? ['CANDIDATE_IDENTITY'] : ['PACKET_IDENTITY', 'CANDIDATE_IDENTITY'];
}

function s1aRunF2IdentitySurface(policy, surface, identity, edit) {
  let baseline;
  let result;
  let observation;
  if (surface === 'common-defer' || surface === 'owner-readback' ||
      surface === 'transfer-record' || surface === 'closure-source-record') {
    const event = surface === 'transfer-record' ? 'TRANSFER'
      : surface === 'closure-source-record' ? 'VERIFIED_CLOSURE' : 'DEFER';
    const record = surface === 'transfer-record'
      ? makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY)
      : surface === 'closure-source-record' ? s1aMatrixClosureRecord()
        : makeS1aCommonFindingFields({});
    const trusted = s1aMatrixTransitionContext(event);
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      event, record, trusted);
    const parent = surface === 'owner-readback' ? record.OWNER_READBACK : record;
    s1aApplyTargetIdentityEdit(parent, identity, edit);
    if (surface === 'owner-readback') s1aRefreshReadbackDigest(record.OWNER_READBACK);
    observation = s1aObserveTransitionRejection(policy, {
      disposition: record.DISPOSITION, lifecycle: record.LIFECYCLE, event
    }, record, trusted);
    result = observation.result;
  } else if (surface === 'transfer-trusted-readback') {
    const record = makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY);
    const trusted = { currentOwnershipReadback:
      s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK) };
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'TRANSFER', record, trusted);
    s1aApplyTargetIdentityEdit(trusted.currentOwnershipReadback, identity, edit);
    s1aRefreshReadbackDigest(trusted.currentOwnershipReadback);
    observation = s1aObserveTransitionRejection(policy, {
      disposition: record.DISPOSITION, lifecycle: record.LIFECYCLE, event: 'TRANSFER'
    }, record, trusted);
    result = observation.result;
  } else if (surface === 'companion-current-record' ||
      surface === 'inventory-header' || surface === 'companion-history-record') {
    const fixture = makeS1aCompanionFixture();
    baseline = s1aMatrixCompanionResult(policy, fixture);
    if (surface === 'inventory-header') {
      let parent;
      if (identity === 'PACKET_IDENTITY') {
        parent = fixture.currentInventory;
        s1aApplyTargetIdentityEdit(parent, identity, edit);
      } else {
        parent = { CANDIDATE_IDENTITY: fixture.currentInventory.candidateIdentities[0] };
        s1aApplyTargetIdentityEdit(parent, identity, edit);
        fixture.currentInventory.candidateIdentities[0] = parent.CANDIDATE_IDENTITY;
      }
      fixture.currentInventory.digest = s1aHashWithoutField(
        fixture.currentInventory, 'digest');
    } else if (surface === 'companion-history-record') {
      const record = fixture.historyLedger.records[0].record;
      s1aApplyTargetIdentityEdit(record, identity, edit);
      s1aRefreshHistoryFixture(fixture.historyLedger);
    } else {
      const record = fixture.entries[0].record;
      s1aApplyTargetIdentityEdit(record, identity, edit);
      s1aRefreshIsolatedCurrentCompanionRecord(fixture, 0,
        'web:inventory-revision-target-f2');
    }
    observation = s1aObserveInputPreservation(
      [policy, fixture.projections, fixture.entries, fixture.historyLedger, fixture.currentInventory],
      () => s1aMatrixCompanionResult(policy, fixture));
    result = observation.result;
  } else if (surface === 'companion-projection') {
    const fixture = makeS1aCompanionFixture();
    baseline = s1aMatrixCompanionResult(policy, fixture);
    s1aApplyTargetIdentityEdit(fixture.projections[0], identity, edit);
    observation = s1aObserveInputPreservation(
      [policy, fixture.projections, fixture.entries, fixture.historyLedger, fixture.currentInventory],
      () => s1aMatrixCompanionResult(policy, fixture));
    result = observation.result;
  } else if (surface === 'closure-common-record') {
    const record = s1aMatrixClosureRecord();
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'VERIFIED_CLOSURE', record);
    const commonRecord = record.closureReadback.commonRecord;
    s1aApplyTargetIdentityEdit(commonRecord, identity, edit);
    s1aRefreshClosureReadback(record.closureReadback);
    observation = s1aObserveTransitionRejection(policy, {
      disposition: record.DISPOSITION, lifecycle: record.LIFECYCLE, event: 'VERIFIED_CLOSURE'
    }, record);
    result = observation.result;
  } else if (surface === 'closure-top-level') {
    const record = s1aMatrixClosureRecord();
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'VERIFIED_CLOSURE', record);
    s1aApplyTargetIdentityEdit(record.closureReadback, identity, edit);
    s1aRefreshClosureReadback(record.closureReadback);
    observation = s1aObserveTransitionRejection(policy, {
      disposition: record.DISPOSITION, lifecycle: record.LIFECYCLE, event: 'VERIFIED_CLOSURE'
    }, record);
    result = observation.result;
  } else if (surface === 'blocker-record') {
    const fixture = makeS1aBlockerFixture();
    baseline = s1aMatrixBlockerResult(policy, fixture);
    s1aApplyTargetIdentityEdit(fixture.record, identity, edit);
    const detailRef = fixture.companionEntries[0].ref;
    fixture.record.DETAIL_REF = detailRef;
    fixture.decision.detailRef = detailRef;
    s1aRefreshWebAdmissionReadback(fixture.decision);
    observation = s1aObserveInputPreservation(
      [policy, fixture.record, fixture.decision, fixture.companionProjection,
        fixture.companionEntries, fixture.currentInventory],
      () => s1aMatrixBlockerResult(policy, fixture));
    result = observation.result;
  } else if (surface === 'blocker-companion-record') {
    const fixture = makeS1aBlockerFixture();
    baseline = s1aMatrixBlockerResult(policy, fixture);
    const primaryIdentitySnapshot = s1aSnapshot({
      PACKET_IDENTITY: fixture.record.PACKET_IDENTITY,
      CANDIDATE_IDENTITY: fixture.record.CANDIDATE_IDENTITY
    });
    const record = fixture.companionEntries[0].record;
    s1aApplyTargetIdentityEdit(record, identity, edit);
    const ref = s1aHashRecord(record);
    fixture.companionEntries = [{ ref, record: s1aClone(record) }];
    fixture.companionProjection.DETAIL_REF = ref;
    fixture.currentInventory.revision = 'web:inventory-revision-target-blocker-f2';
    fixture.currentInventory.records = s1aClone(fixture.companionEntries);
    fixture.currentInventory.digest = s1aHashWithoutField(
      fixture.currentInventory, 'digest');
    fixture.record.DETAIL_REF = ref;
    fixture.decision.detailRef = ref;
    s1aRefreshWebAdmissionReadback(fixture.decision);
    if (!s1aSame(primaryIdentitySnapshot, {
      PACKET_IDENTITY: fixture.record.PACKET_IDENTITY,
      CANDIDATE_IDENTITY: fixture.record.CANDIDATE_IDENTITY
    })) {
      throw new Error('blocker companion mutation aliased the primary proof record');
    }
    observation = s1aObserveInputPreservation(
      [policy, fixture.record, fixture.decision, fixture.companionProjection,
        fixture.companionEntries, fixture.currentInventory],
      () => s1aMatrixBlockerResult(policy, fixture));
    result = observation.result;
  } else {
    throw new Error('unknown F2 surface: ' + surface);
  }
  return { baseline, result, observation, mutationProven: true };
}

function s1aApplyResidualNestedIdentityMutation(identityRecord, field, mutation) {
  const before = s1aSnapshot(identityRecord);
  if (mutation.id === 'omitted') {
    delete identityRecord[field];
  } else {
    identityRecord[field] = s1aClone(mutation.value);
  }
  const hasField = Object.prototype.hasOwnProperty.call(identityRecord, field);
  const intendedShapeProven = mutation.id === 'omitted'
    ? !hasField
    : hasField && s1aSame(identityRecord[field], mutation.value);
  return !s1aSame(before, identityRecord) && intendedShapeProven;
}

function s1aRunResidualNestedIdentitySurface(policy, boundary, identity, field, mutation) {
  if (boundary === 'blocker-admission') {
    const fixture = makeS1aBlockerFixture();
    const baseline = s1aMatrixBlockerResult(policy, fixture);
    const authoritativeBefore = s1aSnapshot({
      record: fixture.record,
      companionProjection: fixture.companionProjection,
      companionEntries: fixture.companionEntries,
      currentInventory: fixture.currentInventory
    });
    const decisionField = identity === 'PACKET_IDENTITY'
      ? 'packetIdentity' : 'candidateIdentity';
    const mutationProven = s1aApplyResidualNestedIdentityMutation(
      fixture.decision[decisionField], field, mutation);
    s1aRefreshWebAdmissionReadback(fixture.decision);
    const readback = fixture.decision.admissionReadback;
    const callerBindingsRefreshed = readback.revision === fixture.decision.webRevision &&
      readback.body === s1aWebAdmissionBody(fixture.decision) &&
      readback.bodyDigest === s1aHashText(readback.body);
    const observation = s1aObserveInputPreservation(
      [policy, fixture.record, fixture.decision, fixture.companionProjection,
        fixture.companionEntries, fixture.currentInventory],
      () => s1aMatrixBlockerResult(policy, fixture));
    const independentAuthorityPreserved = s1aSame(authoritativeBefore, {
      record: fixture.record,
      companionProjection: fixture.companionProjection,
      companionEntries: fixture.companionEntries,
      currentInventory: fixture.currentInventory
    });
    return {
      baseline,
      result: observation.result,
      observation,
      mutationProven,
      callerBindingsRefreshed,
      independentAuthorityPreserved,
      requiredFailures: [
        'BLOCKER_BINDING_MISMATCH:' + identity,
        'BLOCKER_CURRENT_WEB_ADMISSION_READBACK'
      ]
    };
  }

  if (boundary === 'inventory-embedded-record') {
    const fixture = makeS1aCompanionFixture();
    const baseline = s1aMatrixCompanionResult(policy, fixture);
    const independentAuthorityBefore = s1aSnapshot({
      projections: fixture.projections,
      entries: fixture.entries,
      historyLedger: fixture.historyLedger
    });
    const inventoryEntry = fixture.currentInventory.records[0];
    const mutationProven = s1aApplyResidualNestedIdentityMutation(
      inventoryEntry.record[identity], field, mutation);
    s1aRefreshCommonOwnerReadback(inventoryEntry.record);
    inventoryEntry.ref = s1aHashRecord(inventoryEntry.record);
    fixture.currentInventory.digest = s1aHashWithoutField(
      fixture.currentInventory, 'digest');
    const callerBindingsRefreshed =
      s1aOwnershipReadbackMatches(inventoryEntry.record) &&
      inventoryEntry.ref === s1aHashRecord(inventoryEntry.record) &&
      fixture.currentInventory.digest === s1aHashWithoutField(
        fixture.currentInventory, 'digest');
    const observation = s1aObserveInputPreservation(
      [policy, fixture.projections, fixture.entries, fixture.historyLedger,
        fixture.currentInventory],
      () => s1aMatrixCompanionResult(policy, fixture));
    const independentAuthorityPreserved = s1aSame(independentAuthorityBefore, {
      projections: fixture.projections,
      entries: fixture.entries,
      historyLedger: fixture.historyLedger
    });
    return {
      baseline,
      result: observation.result,
      observation,
      mutationProven,
      callerBindingsRefreshed,
      independentAuthorityPreserved,
      requiredFailures: ['COMPANION_CURRENT_INVENTORY_READBACK']
    };
  }

  throw new Error('unknown residual nested identity boundary: ' + boundary);
}

function s1aBuildResidualNestedIdentityRows(policy) {
  const rows = [];
  for (const boundary of S1A_RESIDUAL_NESTED_IDENTITY_BOUNDARIES) {
    for (const item of S1A_TARGET_IDENTITY_LEAVES) {
      for (const mutation of S1A_RESIDUAL_NESTED_IDENTITY_MUTATIONS) {
        rows.push({
          id: 'F2/residual/' + boundary + '/' + item.identity + '.' + item.field +
            '/' + mutation.id,
          category: 'F2',
          residualNestedIdentity: true,
          run: () => s1aRunResidualNestedIdentitySurface(policy, boundary,
            item.identity, item.field, mutation)
        });
      }
    }
  }
  return rows;
}

function s1aBuildF2IdentityRows(policy) {
  const rows = [];
  for (const surface of S1A_TARGET_F2_SURFACES) {
    for (const identity of s1aTargetIdentitiesForSurface(surface)) {
      for (const item of S1A_TARGET_IDENTITY_LEAVES.filter((row) => row.identity === identity)) {
        for (const mutation of S1A_TARGET_LEAF_MUTATIONS) {
          rows.push({
            id: 'F2/' + surface + '/' + item.identity + '.' + item.field + '/' + mutation.id,
            category: 'F2',
            run: () => s1aRunF2IdentitySurface(policy, surface, item.identity,
              (parent, identityField) =>
                s1aApplyTargetLeafMutation(parent, identityField, item.field, mutation))
          });
        }
      }
    }
  }
  for (const surface of S1A_TARGET_F2_SURFACES) {
    for (const identity of s1aTargetIdentitiesForSurface(surface)) {
      rows.push({
        id: 'F2/' + surface + '/' + identity + '/missing-object',
        category: 'F2',
        run: () => s1aRunF2IdentitySurface(policy, surface, identity,
          (parent, field) => { delete parent[field]; })
      });
    }
  }
  for (const surface of [
    'common-defer', 'companion-current-record', 'blocker-record',
    'transfer-trusted-readback', 'companion-projection', 'closure-top-level'
  ]) {
    for (const identity of s1aTargetIdentitiesForSurface(surface)) {
      for (const shape of S1A_TARGET_BAD_IDENTITY_SHAPES) {
        rows.push({
          id: 'F2/' + surface + '/' + identity + '/shape-' + shape.id,
          category: 'F2',
          run: () => s1aRunF2IdentitySurface(policy, surface, identity,
            (parent, field) => { parent[field] = s1aClone(shape.value); })
        });
      }
    }
  }
  for (const [surface, identity, extraField] of [
    ['common-defer', 'PACKET_IDENTITY', 'callerField'],
    ['companion-current-record', 'CANDIDATE_IDENTITY', 'callerField'],
    ['blocker-record', 'PACKET_IDENTITY', 'callerField'],
    ['transfer-trusted-readback', 'PACKET_IDENTITY', 'callerField'],
    ['companion-projection', 'CANDIDATE_IDENTITY', 'callerField'],
    ['closure-top-level', 'CANDIDATE_IDENTITY', 'callerField']
  ]) {
    rows.push({
      id: 'F2/' + surface + '/' + identity + '/extra-own-field',
      category: 'F2',
      run: () => s1aRunF2IdentitySurface(policy, surface, identity, (parent, field) => {
        if (!parent[field] || typeof parent[field] !== 'object' || Array.isArray(parent[field])) {
          throw new Error('identity object is not mutable');
        }
        parent[field][extraField] = 'unaccepted';
      })
    });
  }
  rows.push(...s1aBuildResidualNestedIdentityRows(policy));
  return rows;
}

function s1aRunBindingCopySurface(policy, surface, identity, field, coherent) {
  const changed = 'caller-copy:' + field;
  let baseline;
  let result;
  let observation;
  let mutationProven = false;
  const mutate = (target, update) => {
    const before = s1aSnapshot(target);
    update();
    if (s1aSame(before, target)) throw new Error('binding-copy mutation did not occur');
    mutationProven = true;
  };
  const observeTransition = (event, record, trustedContext) =>
    s1aObserveTransitionRejection(policy, {
      disposition: record.DISPOSITION, lifecycle: record.LIFECYCLE, event
    }, record, trustedContext);
  const observeCompanions = (fixture) => s1aObserveInputPreservation(
    [policy, fixture.projections, fixture.entries, fixture.historyLedger, fixture.currentInventory],
    () => s1aMatrixCompanionResult(policy, fixture));
  const observeBlocker = (fixture) => s1aObserveInputPreservation(
    [policy, fixture.record, fixture.decision, fixture.companionProjection,
      fixture.companionEntries, fixture.currentInventory],
    () => s1aMatrixBlockerResult(policy, fixture));
  if (surface === 'owner-readback') {
    const record = makeS1aCommonFindingFields({});
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'DEFER', record);
    const identityRecord = record.OWNER_READBACK[
      identity === 'PACKET_IDENTITY' ? 'packetIdentity' : 'candidateIdentity'];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) s1aRefreshReadbackDigest(record.OWNER_READBACK);
    observation = observeTransition('DEFER', record);
    result = observation.result;
  } else if (surface === 'companion-projection') {
    const fixture = makeS1aCompanionFixture();
    baseline = s1aMatrixCompanionResult(policy, fixture);
    if (coherent) {
      const identityRecord = fixture.entries[0].record[identity];
      mutate(identityRecord, () => { identityRecord[field] = changed; });
      s1aRefreshCommonOwnerReadback(fixture.entries[0].record);
      s1aRefreshCurrentCompanionFixture(fixture, 'web:inventory-revision-binding-copy');
    } else {
      const identityRecord = fixture.projections[0][identity];
      mutate(identityRecord, () => { identityRecord[field] = changed; });
    }
    observation = observeCompanions(fixture);
    result = observation.result;
  } else if (surface === 'inventory-header') {
    const fixture = makeS1aCompanionFixture();
    baseline = s1aMatrixCompanionResult(policy, fixture);
    const identityRecord = identity === 'PACKET_IDENTITY'
      ? fixture.currentInventory.packetIdentity
      : fixture.currentInventory.candidateIdentities[0];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) fixture.currentInventory.digest =
      s1aHashWithoutField(fixture.currentInventory, 'digest');
    observation = observeCompanions(fixture);
    result = observation.result;
  } else if (surface === 'transfer-owner-readback') {
    const record = makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY);
    const trusted = s1aMatrixTransitionContext('TRANSFER');
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'TRANSFER', record, trusted);
    const identityRecord = record.OWNER_READBACK[
      identity === 'PACKET_IDENTITY' ? 'packetIdentity' : 'candidateIdentity'];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) s1aRefreshReadbackDigest(record.OWNER_READBACK);
    observation = observeTransition('TRANSFER', record, trusted);
    result = observation.result;
  } else if (surface === 'transfer-trusted-readback') {
    const record = makeS1aCommonFindingFields(S1A_ORACLE_TRANSFER_FINDING_IDENTITY);
    const context = { currentOwnershipReadback: s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK) };
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'TRANSFER', record, context);
    const identityRecord = context.currentOwnershipReadback[
      identity === 'PACKET_IDENTITY' ? 'packetIdentity' : 'candidateIdentity'];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) s1aRefreshReadbackDigest(context.currentOwnershipReadback);
    observation = observeTransition('TRANSFER', record, context);
    result = observation.result;
  } else if (surface === 'closure-top-level') {
    const record = s1aMatrixClosureRecord();
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'VERIFIED_CLOSURE', record);
    const closure = record.closureReadback;
    if (identity === 'PACKET_IDENTITY') {
      mutate(closure, () => { closure.repository = changed; });
    } else {
      const identityRecord = closure.candidateIdentity;
      mutate(identityRecord, () => { identityRecord[field] = changed; });
    }
    if (coherent) s1aRefreshClosureReadback(closure);
    observation = observeTransition('VERIFIED_CLOSURE', record);
    result = observation.result;
  } else if (surface === 'closure-common-record') {
    const record = s1aMatrixClosureRecord();
    baseline = evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      'VERIFIED_CLOSURE', record);
    const commonRecord = record.closureReadback.commonRecord;
    const identityRecord = commonRecord[identity];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) {
      s1aRefreshCommonOwnerReadback(commonRecord);
      s1aRefreshClosureReadback(record.closureReadback);
    }
    observation = observeTransition('VERIFIED_CLOSURE', record);
    result = observation.result;
  } else if (surface === 'admission-decision') {
    const fixture = makeS1aBlockerFixture();
    baseline = s1aMatrixBlockerResult(policy, fixture);
    const decisionField = identity === 'PACKET_IDENTITY' ? 'packetIdentity' : 'candidateIdentity';
    const identityRecord = fixture.decision[decisionField];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) s1aRefreshWebAdmissionReadback(fixture.decision);
    observation = observeBlocker(fixture);
    result = observation.result;
  } else if (surface === 'blocker-record') {
    const fixture = makeS1aBlockerFixture();
    baseline = s1aMatrixBlockerResult(policy, fixture);
    const identityRecord = fixture.record[identity];
    mutate(identityRecord, () => { identityRecord[field] = changed; });
    if (coherent) {
      s1aRefreshCommonOwnerReadback(fixture.record);
      const decisionField = identity === 'PACKET_IDENTITY' ? 'packetIdentity' : 'candidateIdentity';
      fixture.decision[decisionField] = s1aClone(fixture.record[identity]);
      refreshS1aBlockerFixture(fixture, true);
    }
    observation = observeBlocker(fixture);
    result = observation.result;
  } else {
    throw new Error('unknown binding/copy surface: ' + surface);
  }
  return { baseline, result, observation, mutationProven };
}

function s1aBuildBindingCopyRows(policy) {
  const rows = [];
  const surfaces = [
    'owner-readback',
    'companion-projection',
    'inventory-header',
    'transfer-owner-readback',
    'transfer-trusted-readback',
    'closure-common-record',
    'admission-decision',
    'blocker-record'
  ];
  for (const surface of surfaces) {
    for (const item of S1A_TARGET_IDENTITY_LEAVES) {
      for (const coherent of [false, true]) {
        rows.push({
          id: 'BIND/' + surface + '/' + item.identity + '.' + item.field +
            (coherent ? '/rehash' : '/copy-mismatch'),
          category: 'BINDING_COPY',
          run: () => s1aRunBindingCopySurface(policy, surface,
            item.identity, item.field, coherent)
        });
      }
    }
  }
  for (const item of [
    { identity: 'PACKET_IDENTITY', field: 'repository' },
    { identity: 'CANDIDATE_IDENTITY', field: 'commit' },
    { identity: 'CANDIDATE_IDENTITY', field: 'tree' }
  ]) {
    for (const coherent of [false, true]) {
      rows.push({
        id: 'BIND/closure-top-level/' + item.identity + '.' + item.field +
          (coherent ? '/rehash' : '/copy-mismatch'),
        category: 'BINDING_COPY',
        run: () => s1aRunBindingCopySurface(policy, 'closure-top-level',
          item.identity, item.field, coherent)
      });
    }
  }
  return rows;
}

function s1aMakeF1Rows(policy) {
  const rows = [];
  const addObservedRow = (spec) => {
    const event = spec.event || spec.request.event;
    const trustedContext = s1aMatrixTransitionContext(event);
    const observation = s1aObserveTransitionRejection(spec.effectivePolicy || policy,
      spec.request, spec.record, trustedContext);
    rows.push({
      ...spec,
      category: 'F1',
      canonicalRecord: observation.canonicalSnapshot,
      observation,
      result: observation.result
    });
  };
  for (const event of ['DEFER', 'TRANSFER', 'VERIFIED_CLOSURE']) {
    for (const lifecycle of ['UNRESOLVED', 'RESOLVED']) {
      if (event === 'VERIFIED_CLOSURE' && lifecycle === 'RESOLVED') continue;
      const record = s1aMatrixRecordForEvent(event, 'FUTURE_OWNED', 'UNRESOLVED');
      const baseline = s1aAcceptedTransitionBaseline(policy, record, event);
      if (lifecycle === 'RESOLVED') {
        record.LIFECYCLE = 'RESOLVED';
        record.RESOLUTION = 'RESOLVED';
        s1aRefreshCommonOwnerReadback(record);
      }
      const requestedLifecycle = lifecycle === 'UNRESOLVED' ? 'RESOLVED' : 'UNRESOLVED';
      addObservedRow({
        id: 'F1/' + event + '/lifecycle-' + lifecycle + '-request-' + requestedLifecycle +
          '/FUTURE_OWNED',
        record,
        request: { disposition: 'FUTURE_OWNED', lifecycle: requestedLifecycle, event },
        baseline
      });
    }
  }
  for (const event of ['DEFER', 'TRANSFER', 'VERIFIED_CLOSURE']) {
    const record = s1aMatrixRecordForEvent(event, 'FUTURE_OWNED', 'UNRESOLVED');
    const baseline = s1aAcceptedTransitionBaseline(policy, record, event);
    addObservedRow({
      id: 'F1/' + event + '/disposition-FUTURE_OWNED-request-CURRENT_SHIP_BLOCKER',
      record,
      request: { disposition: 'CURRENT_SHIP_BLOCKER', lifecycle: 'UNRESOLVED', event },
      baseline
    });
  }
  for (const event of ['DEFER', 'TRANSFER']) {
    const record = s1aMatrixRecordForEvent(event);
    const baseline = s1aAcceptedTransitionBaseline(policy, record, event);
    record.DISPOSITION = 'OBSERVE';
    record.ADJUDICATION = 'OBSERVE';
    s1aRefreshCommonOwnerReadback(record);
    addObservedRow({
      id: 'F1/' + event + '/coherently-rehashed-disposition-request',
      record,
      request: { disposition: 'FUTURE_OWNED', lifecycle: 'UNRESOLVED', event },
      baseline
    });
  }
  const conflictingState = (record) => ({
    disposition: record.DISPOSITION === 'FUTURE_OWNED' ? 'OBSERVE' : 'FUTURE_OWNED',
    lifecycle: record.LIFECYCLE === 'UNRESOLVED' ? 'RESOLVED' : 'UNRESOLVED'
  });
  for (const event of ['DEFER', 'TRANSFER', 'VERIFIED_CLOSURE']) {
    for (const early of [
      { id: 'policy', expected: 'LIFECYCLE_POLICY_NOT_FIXED',
        request: (record) => ({ policy: Object.assign(JSON.parse(JSON.stringify(policy)), {
          lifecycleTransitions: [{ event: 'UNDECLARED', from: 'UNRESOLVED', to: 'RESOLVED',
            requires: [], requiredValueTypes: {} }]
        }), ...conflictingState(record), event }) },
      { id: 'disposition', expected: 'LIFECYCLE_DISPOSITION_UNKNOWN',
        request: (record) => ({ policy, disposition: 'REQUEST_ONLY_UNKNOWN', lifecycle: conflictingState(record).lifecycle, event }) },
      { id: 'event', expected: 'LIFECYCLE_TRANSITION_MISSING_OR_AMBIGUOUS',
        request: (record) => ({ policy, ...conflictingState(record), event: 'EARLY_REJECTED_EVENT' }) }
    ]) {
      const record = s1aMatrixRecordForEvent(event);
      const trustedContext = s1aMatrixTransitionContext(event);
      const baseline = evaluateS1aTransition(policy, record.DISPOSITION,
        record.LIFECYCLE, event, record, trustedContext);
      const requestValues = early.request(record);
      const request = {
        disposition: requestValues.disposition,
        lifecycle: requestValues.lifecycle,
        event: requestValues.event
      };
      const observation = s1aObserveTransitionRejection(requestValues.policy, request,
        record, s1aMatrixTransitionContext(event));
      const requestSnapshot = observation.snapshots[1];
      rows.push({
        id: 'F1/' + event + '/early-' + early.id,
        category: 'F1',
        earlyFailure: early.expected,
        canonicalRecord: observation.canonicalSnapshot,
        baseline,
        requestStateContradiction: requestSnapshot.disposition !== observation.canonicalSnapshot.DISPOSITION &&
          requestSnapshot.lifecycle !== observation.canonicalSnapshot.LIFECYCLE,
        observation,
        result: observation.result
      });
    }
  }
  for (const event of ['DEFER', 'TRANSFER', 'VERIFIED_CLOSURE']) {
    for (const inconsistency of ['adjudication', 'resolution']) {
      const record = s1aMatrixRecordForEvent(event);
      const baseline = s1aAcceptedTransitionBaseline(policy, record, event);
      if (inconsistency === 'adjudication') {
        record.ADJUDICATION = 'OBSERVE';
      } else {
        record.RESOLUTION = 'RESOLVED';
      }
      s1aRefreshCommonOwnerReadback(record);
      addObservedRow({
        id: 'F1/' + event + '/final-canonical-' + inconsistency + '-mismatch',
        record,
        request: { disposition: record.DISPOSITION, lifecycle: record.LIFECYCLE, event },
        baseline
      });
    }
  }
  const closureRecord = s1aMatrixRecordForEvent('VERIFIED_CLOSURE');
  const closureBaseline = s1aAcceptedTransitionBaseline(policy, closureRecord,
    'VERIFIED_CLOSURE');
  closureRecord.closureReadback.commonRecord.PACKET_IDENTITY.packetId =
    'packet:coherently-rebound-closure';
  s1aRefreshCommonOwnerReadback(closureRecord.closureReadback.commonRecord);
  s1aRefreshClosureReadback(closureRecord.closureReadback);
  addObservedRow({
    id: 'F1/VERIFIED_CLOSURE/final-coherently-rehashed-common-record',
    record: closureRecord,
    request: { disposition: closureRecord.DISPOSITION,
      lifecycle: closureRecord.LIFECYCLE, event: 'VERIFIED_CLOSURE' },
    baseline: closureBaseline
  });
  return rows;
}

test('S1-A F1 observer snapshots canonical, request, and authoritative readbacks independently', () => {
  const policy = parseS1aPolicyContract(architecture);
  const makePassingTransfer = () => {
    const canonicalRecord = s1aMatrixRecordForEvent('TRANSFER');
    const trustedContext = { currentOwnershipReadback:
      s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK) };
    const baseline = evaluateS1aTransition(policy, canonicalRecord.DISPOSITION,
      canonicalRecord.LIFECYCLE, 'TRANSFER', canonicalRecord, trustedContext);
    assert.equal(baseline.ok, true, 'each observer mutation control starts from passing TRANSFER');
    return { canonicalRecord, trustedContext };
  };
  const request = { disposition: 'OBSERVE', lifecycle: 'RESOLVED', event: 'TRANSFER' };
  const rejectedF1 = (canonicalRecord) => ({
    ok: false,
    disposition: canonicalRecord.DISPOSITION,
    lifecycle: canonicalRecord.LIFECYCLE,
    transition: null,
    mutationEffects: [],
    failures: ['F1_RECORD_TRANSITION_CONSISTENCY']
  });

  const canonicalCase = makePassingTransfer();
  const canonicalMutant = (inputPolicy, inputRequest, canonicalRecord) => {
    canonicalRecord.DISPOSITION = inputRequest.disposition;
    canonicalRecord.LIFECYCLE = inputRequest.lifecycle;
    return rejectedF1(canonicalRecord);
  };
  const canonicalObservation = s1aObserveTransitionRejection(policy, { ...request },
    canonicalCase.canonicalRecord, canonicalCase.trustedContext, canonicalMutant);
  assert.equal(canonicalObservation.result.ok, false,
    'the exact G4 mutant still returns rejected F1');
  assert.deepEqual(canonicalObservation.expectedCanonicalState,
    { disposition: 'FUTURE_OWNED', lifecycle: 'UNRESOLVED' },
    'expected state comes from the independent pre-call canonical snapshot');
  assert.equal(canonicalCase.canonicalRecord.DISPOSITION, 'OBSERVE',
    'the canonical mutation is present');
  assert.equal(canonicalCase.canonicalRecord.LIFECYCLE, 'RESOLVED',
    'the lifecycle mutation is present');
  assert.equal(canonicalObservation.inputChecks[2].unchanged, false,
    'the observer detects mutation of the live canonical object');
  assert.ok(canonicalObservation.observerFailures.includes(
    'RETURNED_STATE_DIFFERS_FROM_PRE_CALL_CANONICAL'),
  'the mutated rejection state differs from the independent pre-call state');
  assert.equal(canonicalObservation.observerPassed, false,
    'the observer fails the exact G4 mutant');

  const requestCase = makePassingTransfer();
  const mutableRequest = { ...request };
  const requestMutant = (inputPolicy, inputRequest, canonicalRecord) => {
    inputRequest.event = 'DEFER';
    return rejectedF1(canonicalRecord);
  };
  const requestObservation = s1aObserveTransitionRejection(policy, mutableRequest,
    requestCase.canonicalRecord, requestCase.trustedContext, requestMutant);
  assert.equal(mutableRequest.event, 'DEFER', 'the request mutation is present');
  assert.equal(requestObservation.inputChecks[1].unchanged, false,
    'the observer detects mutation of the request object');
  assert.equal(requestObservation.observerPassed, false);

  const aliasCase = makePassingTransfer();
  assert.notStrictEqual(aliasCase.trustedContext.currentOwnershipReadback,
    aliasCase.canonicalRecord.OWNER_READBACK,
  'passing ownership readback and canonical owner readback are distinct objects');
  assert.deepEqual(aliasCase.trustedContext.currentOwnershipReadback,
    aliasCase.canonicalRecord.OWNER_READBACK,
  'the independent ownership readbacks have equal canonical values');
  const aliasMutant = (inputPolicy, inputRequest, canonicalRecord, trustedContext) => {
    trustedContext.currentOwnershipReadback = canonicalRecord.OWNER_READBACK;
    return rejectedF1(canonicalRecord);
  };
  const aliasObservation = s1aObserveTransitionRejection(policy, { ...request },
    aliasCase.canonicalRecord, aliasCase.trustedContext, aliasMutant);
  assert.equal(aliasObservation.inputChecks[3].unchanged, true,
    'deep value comparison alone misses the equal-valued alias replacement');
  assert.equal(aliasObservation.readbackChecks.some((check) =>
    check.path === 'input3.currentOwnershipReadback' && !check.referenceUnchanged), true,
  'the observer detects replacement of the trusted readback reference');
  assert.equal(aliasObservation.inputsUnchanged, false);
  assert.ok(aliasObservation.observerFailures.includes('EVALUATOR_MUTATED_INPUT'));
  assert.equal(aliasObservation.observerPassed, false,
    'equal-valued readback aliasing cannot pass the rejection observer');

  const reverseAliasCase = makePassingTransfer();
  assert.notStrictEqual(reverseAliasCase.canonicalRecord.PACKET_IDENTITY,
    reverseAliasCase.trustedContext.currentOwnershipReadback.packetIdentity,
  'passing canonical packet and trusted packet identities are distinct objects');
  assert.deepEqual(reverseAliasCase.canonicalRecord.PACKET_IDENTITY,
    reverseAliasCase.trustedContext.currentOwnershipReadback.packetIdentity,
  'the independent packet identities have equal canonical values');
  const reverseAliasMutant = (inputPolicy, inputRequest, canonicalRecord, trustedContext) => {
    canonicalRecord.PACKET_IDENTITY = trustedContext.currentOwnershipReadback.packetIdentity;
    return rejectedF1(canonicalRecord);
  };
  const reverseAliasObservation = s1aObserveTransitionRejection(policy, { ...request },
    reverseAliasCase.canonicalRecord, reverseAliasCase.trustedContext, reverseAliasMutant);
  assert.equal(reverseAliasObservation.inputChecks[2].unchanged, true,
    'deep value comparison alone misses the canonical-side alias replacement');
  assert.equal(reverseAliasObservation.referenceChecks.some((check) =>
    check.path === 'input2.PACKET_IDENTITY' && !check.unchanged), true,
  'the observer detects an aliased canonical identity reference');
  assert.equal(reverseAliasObservation.inputsUnchanged, false);
  assert.equal(reverseAliasObservation.observerPassed, false,
    'canonical-side aliasing cannot pass the rejection observer');

  const readbackCase = makePassingTransfer();
  const readbackMutant = (inputPolicy, inputRequest, canonicalRecord, trustedContext) => {
    trustedContext.currentOwnershipReadback.current = false;
    return rejectedF1(canonicalRecord);
  };
  const readbackObservation = s1aObserveTransitionRejection(policy, { ...request },
    readbackCase.canonicalRecord, readbackCase.trustedContext, readbackMutant);
  assert.equal(readbackCase.trustedContext.currentOwnershipReadback.current, false,
    'the authoritative readback mutation is present');
  assert.equal(readbackObservation.readbackChecks.some((check) => !check.unchanged), true,
    'the observer detects mutation of the authoritative readback input');
  assert.equal(readbackObservation.inputChecks[3].unchanged, false,
    'the observer also detects mutation of the containing trusted context');
  assert.equal(readbackObservation.observerPassed, false);
});

test('S1-A F2 consumer completeness survives coherent transfer, companion, and closure readbacks', () => {
  const policy = parseS1aPolicyContract(architecture);
  const transferCases = [
    ['packetId', 'packetIdentity'],
    ['packetRevision', 'packetIdentity'],
    ['repository', 'packetIdentity'],
    ['commit', 'candidateIdentity'],
    ['tree', 'candidateIdentity']
  ];
  for (const [field, identity] of transferCases) {
    const canonicalRecord = s1aMatrixRecordForEvent('TRANSFER');
    const trustedContext = { currentOwnershipReadback:
      s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK) };
    const baseline = evaluateS1aTransition(policy, canonicalRecord.DISPOSITION,
      canonicalRecord.LIFECYCLE, 'TRANSFER', canonicalRecord, trustedContext);
    assert.equal(baseline.ok, true, 'TRANSFER baseline passes before omitting ' + identity + '.' + field);
    delete trustedContext.currentOwnershipReadback[identity][field];
    assert.equal(Object.prototype.hasOwnProperty.call(
      trustedContext.currentOwnershipReadback[identity], field), false,
    'transfer nested identity omission is present: ' + identity + '.' + field);
    s1aRefreshReadbackDigest(trustedContext.currentOwnershipReadback);
    assert.equal(trustedContext.currentOwnershipReadback.digest,
      s1aHashWithoutField(trustedContext.currentOwnershipReadback, 'digest'),
    'transfer readback digest is coherently recomputed');
    const request = { disposition: canonicalRecord.DISPOSITION,
      lifecycle: canonicalRecord.LIFECYCLE, event: 'TRANSFER' };
    const observation = s1aObserveTransitionRejection(policy, request,
      canonicalRecord, trustedContext);
    assert.equal(observation.result.ok, false, 'incomplete trusted readback rejects');
    assert.ok(observation.result.failures.includes('F2_COMMON_RECORD_COMPANION_COMPLETENESS'),
      'incomplete trusted readback includes F2');
    assert.ok(observation.result.failures.includes('LIFECYCLE_OWNER_TRANSFER_READBACK'),
      'independent ownership readback rejection remains');
    assert.deepEqual(observation.returnedCanonicalState,
      { disposition: 'FUTURE_OWNED', lifecycle: 'UNRESOLVED' },
    'canonical transfer state is preserved');
    assert.equal(observation.result.transition, null);
    assert.deepEqual(observation.result.mutationEffects, []);
    assert.equal(observation.inputsUnchanged, true,
      'all live inputs match independent pre-call snapshots');
  }

  const companionFixture = makeS1aCompanionFixture();
  const companionBaseline = s1aMatrixCompanionResult(policy, companionFixture);
  assert.equal(companionBaseline.ok, true, 'companion omission starts from a passing fixture');
  const historyBefore = s1aClone(companionFixture.historyLedger);
  const companionRecord = companionFixture.entries[0].record;
  delete companionRecord.CANDIDATE_IDENTITY.tree;
  assert.equal(Object.prototype.hasOwnProperty.call(
    companionRecord.CANDIDATE_IDENTITY, 'tree'), false, 'companion omission is present');
  s1aRefreshIsolatedCurrentCompanionRecord(companionFixture, 0,
    'web:inventory-revision-coherent-incomplete-identity');
  assert.equal(companionFixture.historyLedger.digest, historyBefore.digest,
    'unrelated history authority remains unchanged');
  assert.equal(companionFixture.currentInventory.digest,
    s1aHashWithoutField(companionFixture.currentInventory, 'digest'),
  'inventory digest is coherently recomputed');
  assert.equal(companionFixture.entries[0].ref,
    s1aHashRecord(companionFixture.entries[0].record), 'companion record ref is recomputed');
  assert.equal(companionFixture.currentInventory.records[0].ref,
    companionFixture.entries[0].ref, 'inventory entry rebinds to the changed record');
  assert.equal(companionFixture.projections[0].DETAIL_REF,
    companionFixture.entries[0].ref, 'projection rebinds to the changed record');
  assert.equal(s1aIdentityBoundaryComplete(policy, 'PACKET_IDENTITY',
    companionFixture.currentInventory.packetIdentity), true,
  'inventory packet identity remains structurally complete');
  assert.equal(companionFixture.currentInventory.candidateIdentities.every((identity) =>
    s1aIdentityBoundaryComplete(policy, 'CANDIDATE_IDENTITY', identity)), true,
  'inventory candidate identities remain structurally complete');
  assert.equal(s1aIdentityBoundaryComplete(policy, 'PACKET_IDENTITY',
    companionFixture.projections[0].PACKET_IDENTITY), true,
  'projection packet identity remains structurally complete');
  assert.equal(s1aIdentityBoundaryComplete(policy, 'CANDIDATE_IDENTITY',
    companionFixture.projections[0].CANDIDATE_IDENTITY), true,
  'projection candidate identity remains structurally complete');
  const directCommonValidation = s1aValidateCommonFindingRecord(policy, companionRecord);
  assert.ok(directCommonValidation.failures.includes(
    'F2_COMMON_RECORD_COMPANION_COMPLETENESS'),
  'the mutated current record boundary independently reports F2');
  const companionObservation = s1aObserveInputPreservation(
    [policy, companionFixture.projections, companionFixture.entries,
      companionFixture.historyLedger, companionFixture.currentInventory],
    () => s1aMatrixCompanionResult(policy, companionFixture));
  assert.equal(companionObservation.result.ok, false);
  assert.ok(companionObservation.result.failures.includes('F2_COMMON_RECORD_COMPANION_COMPLETENESS'),
    'coherently rebound companion omission includes F2 from its common record');
  assert.equal(companionObservation.result.transition, null);
  assert.deepEqual(companionObservation.result.mutationEffects, []);
  assert.equal(companionObservation.inputsUnchanged, true,
    'companion evaluator preserves every independently snapshotted input');

  const closureRecord = s1aMatrixClosureRecord();
  const closureBaseline = evaluateS1aTransition(policy, closureRecord.DISPOSITION,
    closureRecord.LIFECYCLE, 'VERIFIED_CLOSURE', closureRecord);
  assert.equal(closureBaseline.ok, true, 'closure omission starts from a passing fixture');
  delete closureRecord.closureReadback.candidateIdentity.commit;
  assert.equal(Object.prototype.hasOwnProperty.call(
    closureRecord.closureReadback.candidateIdentity, 'commit'), false,
  'outer closure candidate omission is present');
  s1aRefreshClosureReadback(closureRecord.closureReadback);
  assert.equal(closureRecord.closureReadback.bodyDigest,
    s1aHashText(closureRecord.closureReadback.body),
  'closure body digest is coherently recomputed');
  const closureObservation = s1aObserveTransitionRejection(policy, {
    disposition: closureRecord.DISPOSITION,
    lifecycle: closureRecord.LIFECYCLE,
    event: 'VERIFIED_CLOSURE'
  }, closureRecord);
  assert.equal(closureObservation.result.ok, false);
  assert.ok(closureObservation.result.failures.includes('F2_COMMON_RECORD_COMPANION_COMPLETENESS'),
    'outer closure omission includes F2');
  assert.ok(closureObservation.result.failures.includes('LIFECYCLE_CLOSURE_NOT_VERIFIED'),
    'existing closure readback rejection remains');
  assert.deepEqual(closureObservation.returnedCanonicalState,
    { disposition: 'FUTURE_OWNED', lifecycle: 'UNRESOLVED' },
  'closure canonical state is preserved');
  assert.equal(closureObservation.result.transition, null);
  assert.deepEqual(closureObservation.result.mutationEffects, []);
  assert.equal(closureObservation.inputsUnchanged, true);

  const foreignRecord = s1aMatrixRecordForEvent('TRANSFER');
  const foreignContext = { currentOwnershipReadback:
    s1aClone(S1A_ORACLE_TRANSFER_TRUSTED_OWNERSHIP_READBACK) };
  const foreignBaseline = evaluateS1aTransition(policy, foreignRecord.DISPOSITION,
    foreignRecord.LIFECYCLE, 'TRANSFER', foreignRecord, foreignContext);
  assert.equal(foreignBaseline.ok, true, 'foreign identity control starts from a passing transfer');
  foreignContext.currentOwnershipReadback.packetIdentity.packetId = 'packet:complete-foreign';
  s1aRefreshReadbackDigest(foreignContext.currentOwnershipReadback);
  assert.equal(s1aOwnershipReadbackIdentityComplete(policy,
    foreignContext.currentOwnershipReadback), true,
  'foreign identity remains structurally complete');
  const foreignObservation = s1aObserveTransitionRejection(policy, {
    disposition: foreignRecord.DISPOSITION,
    lifecycle: foreignRecord.LIFECYCLE,
    event: 'TRANSFER'
  }, foreignRecord, foreignContext);
  assert.equal(foreignObservation.result.ok, false);
  assert.ok(foreignObservation.result.failures.includes('LIFECYCLE_OWNER_TRANSFER_READBACK'),
    'complete foreign identity fails the authoritative readback binding');
  assert.equal(foreignObservation.result.failures.includes('F2_COMMON_RECORD_COMPANION_COMPLETENESS'),
    false, 'complete foreign identity is not structural incompleteness');
  assert.equal(foreignObservation.inputsUnchanged, true);
});

test('S1-A residual nested identity complete-foreign controls remain binding failures', () => {
  const policy = parseS1aPolicyContract(architecture);

  const blocker = makeS1aBlockerFixture();
  assert.equal(s1aMatrixBlockerResult(policy, blocker).ok, true,
    'blocker foreign-identity control starts from a passing fixture');
  blocker.decision.packetIdentity.packetId = 'packet:complete-foreign';
  s1aRefreshWebAdmissionReadback(blocker.decision);
  const blockerObservation = s1aObserveInputPreservation(
    [policy, blocker.record, blocker.decision, blocker.companionProjection,
      blocker.companionEntries, blocker.currentInventory],
    () => s1aMatrixBlockerResult(policy, blocker));
  assert.equal(blockerObservation.result.ok, false);
  assert.ok(blockerObservation.result.failures.includes(
    'BLOCKER_BINDING_MISMATCH:PACKET_IDENTITY'));
  assert.ok(blockerObservation.result.failures.includes(
    'BLOCKER_CURRENT_WEB_ADMISSION_READBACK'));
  assert.equal(blockerObservation.result.failures.includes(
    'F2_COMMON_RECORD_COMPANION_COMPLETENESS'), false,
  'complete foreign blocker identity is not structural incompleteness');
  assert.equal(blockerObservation.inputsUnchanged, true);

  const companion = makeS1aCompanionFixture();
  assert.equal(s1aMatrixCompanionResult(policy, companion).ok, true,
    'inventory foreign-identity control starts from a passing fixture');
  const inventoryEntry = companion.currentInventory.records[0];
  inventoryEntry.record.CANDIDATE_IDENTITY.tree = 'tree:complete-foreign';
  s1aRefreshCommonOwnerReadback(inventoryEntry.record);
  inventoryEntry.ref = s1aHashRecord(inventoryEntry.record);
  companion.currentInventory.digest = s1aHashWithoutField(
    companion.currentInventory, 'digest');
  assert.equal(s1aCommonRecordNestedIdentitiesComplete(policy, inventoryEntry.record), true,
    'complete foreign embedded identity remains structurally complete');
  const companionObservation = s1aObserveInputPreservation(
    [policy, companion.projections, companion.entries, companion.historyLedger,
      companion.currentInventory],
    () => s1aMatrixCompanionResult(policy, companion));
  assert.equal(companionObservation.result.ok, false);
  assert.ok(companionObservation.result.failures.includes(
    'COMPANION_CURRENT_INVENTORY_READBACK'));
  assert.equal(companionObservation.result.failures.includes(
    'F2_COMMON_RECORD_COMPANION_COMPLETENESS'), false,
  'complete foreign embedded identity is not structural incompleteness');
  assert.equal(companionObservation.inputsUnchanged, true);
});

test('S1-A final common-record identity and rejection matrix', (t) => {
  const policy = parseS1aPolicyContract(architecture);
  const positiveRows = S1A_ORACLE_PROJECTION_ROWS.map((expected) => ({
    id: 'POSITIVE/projection/' + expected.disposition + '/' + expected.lifecycle,
    category: 'POSITIVE',
    baseline: { ok: true },
    result: {
      ok: s1aSame(policy.projectionRows.find((row) =>
        row.disposition === expected.disposition && row.lifecycle === expected.lifecycle), expected),
      failures: []
    }
  }));
  const positiveTransitions = [
    ['DEFER', s1aMatrixRecordForEvent('DEFER')],
    ['TRANSFER', s1aMatrixRecordForEvent('TRANSFER')],
    ['VERIFIED_CLOSURE', s1aMatrixRecordForEvent('VERIFIED_CLOSURE')],
    ['EVIDENCE_ACQUIRED', (() => {
      const record = makeS1aCommonFindingFields({
        DISPOSITION: 'EVIDENCE_ONLY', ADJUDICATION: 'EVIDENCE_ONLY',
        LIFECYCLE: 'UNRESOLVED', RESOLUTION: 'NOT_RESOLVED',
        EXACT_EVIDENCE: ['evidence:target-matrix']
      });
      return record;
    })()]
  ].map(([event, record]) => ({
    id: 'POSITIVE/transition/' + event,
    category: 'POSITIVE',
    baseline: { ok: true },
    result: evaluateS1aTransition(policy, record.DISPOSITION, record.LIFECYCLE,
      event, record, s1aMatrixTransitionContext(event))
  }));
  const blockerPositive = makeS1aBlockerFixture();
  positiveTransitions.push({
    id: 'POSITIVE/blocker-admission',
    category: 'POSITIVE',
    baseline: s1aMatrixBlockerResult(policy, blockerPositive),
    result: s1aMatrixBlockerResult(policy, blockerPositive)
  });
  const positive = [...positiveRows, ...positiveTransitions];
  const binding = s1aBuildBindingCopyRows(policy).map((row) => ({
    ...row, ...row.run()
  }));
  const f2Rows = s1aBuildF2IdentityRows(policy);
  assert.equal(f2Rows.filter((row) => row.residualNestedIdentity).length, 60,
    'the residual matrix has exactly 2 boundaries x 5 fields x 6 malformed forms');
  const f2 = f2Rows.map((row) => ({
    ...row, ...row.run()
  }));
  const f1 = s1aMakeF1Rows(policy);
  const rows = [
    ...positive,
    ...binding,
    ...f2,
    ...f1
  ];
  const counts = {
    total: rows.length,
    positive: rows.filter((row) => row.category === 'POSITIVE').length,
    bindingCopy: rows.filter((row) => row.category === 'BINDING_COPY').length,
    f2: rows.filter((row) => row.category === 'F2').length,
    f1: rows.filter((row) => row.category === 'F1').length
  };
  const errors = [];
  for (const row of rows) {
    try {
      if (!row.baseline || row.baseline.ok !== true) {
        throw new Error('control did not start from a passing baseline');
      }
      if (row.earlyFailure && row.requestStateContradiction !== true) {
        throw new Error('early rejection did not contradict both request state fields');
      }
      const result = row.result;
      if (row.category === 'POSITIVE') {
        if (result.ok !== true) throw new Error('positive/state control rejected');
      } else {
        if (result.ok !== false) throw new Error('expected rejection passed');
        if (result.transition !== null) throw new Error('rejection returned a transition');
        if (!Array.isArray(result.mutationEffects) || result.mutationEffects.length !== 0) {
          throw new Error('rejection returned mutation effects');
        }
        if (!row.observation || row.observation.inputsUnchanged !== true) {
          throw new Error('evaluator mutated an input or readback');
        }
        if ((row.category === 'F2' || row.category === 'BINDING_COPY') &&
            row.mutationProven !== true) {
          throw new Error('identity mutation was not proved');
        }
        if (row.category === 'F1' && row.observation.observerPassed !== true) {
          throw new Error('F1 snapshot observer failed: ' +
            (row.observation.observerFailures || []).join(','));
        }
        if (row.category === 'BINDING_COPY' && result.failures &&
            result.failures.some((failure) => failure === 'F2_COMMON_RECORD_COMPANION_COMPLETENESS' ||
              failure.endsWith('_F2_COMMON_RECORD_COMPANION_COMPLETENESS'))) {
          throw new Error('complete foreign identity was misclassified as F2 completeness');
        }
        if (row.category === 'F2' &&
            !result.failures.some((failure) => failure === 'F2_COMMON_RECORD_COMPANION_COMPLETENESS' ||
              failure.endsWith('_F2_COMMON_RECORD_COMPANION_COMPLETENESS'))) {
          throw new Error('missing named F2 completeness failure');
        }
        for (const failure of row.requiredFailures || []) {
          if (!result.failures.includes(failure)) {
            throw new Error('missing independently applicable failure: ' + failure);
          }
        }
        if (row.residualNestedIdentity) {
          if (row.callerBindingsRefreshed !== true) {
            throw new Error('caller-controlled digest, reference, body, or readback copy was not refreshed');
          }
          if (row.independentAuthorityPreserved !== true) {
            throw new Error('independent authoritative companion inputs were changed');
          }
        }
        if (row.category === 'F1') {
          if (result.disposition !== row.canonicalRecord.DISPOSITION) {
            throw new Error('rejected disposition echoed request instead of canonical record');
          }
          if (result.lifecycle !== row.canonicalRecord.LIFECYCLE) {
            throw new Error('rejected lifecycle echoed request instead of canonical record');
          }
          if (row.earlyFailure) {
            if (!result.failures.includes(row.earlyFailure)) {
              throw new Error('wrong early rejection reason');
            }
          } else if (!result.failures.includes('F1_RECORD_TRANSITION_CONSISTENCY')) {
            throw new Error('missing named F1 transition-consistency failure');
          }
        }
      }
    } catch (error) {
      errors.push(row.id + ': ' + (error && error.message ? error.message : String(error)));
    }
  }
  assert.deepEqual(counts, {
    total: 459, positive: 15, bindingCopy: 86, f2: 332, f1: 26
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  t.diagnostic('459 rows: 15 positive/state, 86 binding/copy, 332 F2, 26 F1, 0 control/execution errors');
});
function observeS1aLifecycleOracle(policy) {
  const detail = makeS1aCommonFindingFields({
    FINDING_ID: S1A_ORACLE_CLOSURE_BODY.findingId,
    WEB_ADMITTED_REVISION: S1A_ORACLE_CLOSURE_BODY.webAdmittedRevision,
    DISPOSITION: S1A_ORACLE_CLOSURE_BODY.disposition,
    LIFECYCLE: S1A_ORACLE_CLOSURE_BODY.fromLifecycle,
    TIMING: 'future-release',
    TRIGGER_OR_REASON: 'reassess on accepted evidence',
    CLOSURE_CRITERION: S1A_ORACLE_CLOSURE_BODY.closureCriterion,
    EXACT_EVIDENCE: [...S1A_ORACLE_CLOSURE_BODY.exactEvidence],
    CANDIDATE_IDENTITY: s1aClone(S1A_ORACLE_CLOSURE_BODY.candidateIdentity),
    ADJUDICATION: S1A_ORACLE_CLOSURE_BODY.disposition
  });
  detail.closureReadback = s1aClone(S1A_ORACLE_CLOSURE_READBACK);
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
  const canonicalRecord = makeS1aCommonFindingFields({
    FINDING_ID: 'finding:evidence-only',
    WEB_ADMITTED_REVISION: 'web:evidence-only-7',
    DISPOSITION: 'EVIDENCE_ONLY',
    ADJUDICATION: 'EVIDENCE_ONLY',
    LIFECYCLE: input.lifecycle,
    RESOLUTION: input.lifecycle === 'RESOLVED' ? 'RESOLVED' : 'NOT_RESOLVED',
    EXACT_EVIDENCE: input.evidence
  });
  const transition = evaluateS1aTransition(policy, input.disposition, input.lifecycle,
    'EVIDENCE_ACQUIRED', canonicalRecord);
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

const D1_ORACLE_VERIFIED_POST_CHILD_MEMBERSHIP_PROOFS = new WeakMap();
function evaluateS1aPostChildReview(policy, input) {
  const rule = policy.postChildReview;
  const failures = [];
  const assuranceMode = input.assuranceMode || 'DUAL_MAX';
  if (!rule.assuranceModes.includes(assuranceMode)) failures.push('POST_CHILD_ASSURANCE_MODE');
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
  const d1CheckMembershipProof = input.d1CheckMembershipProof || null;
  const d1VerifiedProof = d1CheckMembershipProof &&
    D1_ORACLE_VERIFIED_POST_CHILD_MEMBERSHIP_PROOFS.get(d1CheckMembershipProof);
  const d1ExpectedCheckIds = d1VerifiedProof ? d1VerifiedProof.expectedCheckIds : [];
  const d1CheckProofValid = Boolean(d1VerifiedProof) && d1VerifiedProof.status === 'GREEN' &&
    s1aSame(d1VerifiedProof.identity, identity) && s1aSame(d1VerifiedProof.childState, child) &&
    s1aSame(d1VerifiedProof.checkInventory, input.checkInventory) &&
    s1aSame(d1VerifiedProof.checks, input.checks) &&
    s1aSame(d1VerifiedProof.reviewSnapshot, input.reviewSnapshot) &&
    new Set(d1ExpectedCheckIds).size === d1ExpectedCheckIds.length &&
    s1aSame(d1ExpectedCheckIds, Array.isArray(child.applicableIntegratedCheckIds)
      ? child.applicableIntegratedCheckIds.slice().sort() : []);
  if (child.source !== 'CANONICAL_CHILD' || child.authoritative !== true ||
      child.repository !== identity.repository || child[rule.deliveryChildStateIdentityField] !== identity.deliveryChildId ||
      child[rule.childStateCurrentField] !== rule.childStateMustBeCurrent ||
      child.readBack !== true || !s1aPresent(child.revision) || !s1aPresent(child.stateDigest) ||
      !rule.acceptedChildStates.includes(child.lifecycle) ||
      child.stateDigest !== s1aHashWithoutField(child, 'stateDigest') ||
      (!S1A_ORACLE_POST_CHILD_STATES.some((oracle) => s1aSame(child, oracle)) && !d1CheckProofValid)) {
    failures.push('POST_CHILD_RELEVANT_CHILD_STATE');
  }
  const reviewRouteAuthority = input[rule.reviewRouteAuthorityField] || {};
  if (assuranceMode === 'DUAL_MAX') {
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
  const requiredPolicyCheckIds = d1CheckProofValid ? d1ExpectedCheckIds : S1A_ORACLE_POST_CHILD_CHECK_IDS;
  const requiredCheckIds = child[rule.checkInventoryField];
  const actualCheckIds = Array.isArray(input.checks) ? input.checks.map((check) => check.id) : [];
  const inventoryCheckIds = Array.isArray(checkInventory.items)
    ? checkInventory.items.map((check) => check.id) : [];
  if (checkInventory.source !== rule.inventorySources.checks ||
      checkInventory.authoritative !== true || checkInventory.complete !== true ||
      !s1aSame(checkInventory.identity, identity) ||
      !Array.isArray(requiredCheckIds) || !Array.isArray(input.checks) ||
      !Array.isArray(checkInventory.items) ||
      !s1aSame(requiredCheckIds, requiredPolicyCheckIds) ||
      !s1aSame(inventoryCheckIds, requiredPolicyCheckIds) ||
      !s1aSame(actualCheckIds, inventoryCheckIds) ||
      !s1aSame(input.checks, checkInventory.items) ||
      checkInventory.digest !== s1aHashWithoutField(checkInventory, 'digest') ||
      input.checks.some((check) => check.applicable !== true || check.terminal !== true ||
        check.readBack !== true || !s1aSame(check.identity, identity))) {
    failures.push('POST_CHILD_APPLICABLE_CHECK_INVENTORY');
  }
  if (assuranceMode === 'DUAL_MAX') {
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
    reviewSnapshot: s1aClone(snapshot),
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

  const postChildTerminal = 'When `DUAL_MAX` is selected, both reports, terminal receipts and all applicable checks must be terminal before Web adjudication.';
  const postChildPolarity = architecture.replace('### Bounded non-product continuation',
    'Web may adjudicate before both reports, terminal receipts and applicable checks are terminal.\n\n### Bounded non-product continuation');
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

const D1_DISCOVERY_STATUS_VALUES = Object.freeze([
  'OBSERVED', 'DOCUMENTED_NOT_DEMONSTRATED', 'INFERRED', 'PROPOSED', 'UNKNOWN', 'ACCEPTED'
]);
const D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DISCOVERY_CONSUMER_SCOPE_READBACK',
  authoritative: true, current: true, readBack: true,
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4
});
const D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_READBACK = Object.freeze({
  ...D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_CORE,
  digest: s1aHashRecord(D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_CORE)
});
const D1_ORACLE_ADOPTED_EVIDENCE_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DISCOVERY_EVIDENCE_READBACK',
  authoritative: true,
  current: true,
  readBack: true,
  sourceIdentity: Object.freeze({ repository: 'repo:example/discovery', path: 'docs/investigation.md', revision: 'source:rev-7' }),
  evidenceId: 'evidence:exact-investigation-7',
  safeReverificationReference: 'repo:example/discovery/docs/investigation.md@source:rev-7#finding-7',
  sanitised: true
});
const D1_ORACLE_ADOPTED_EVIDENCE_READBACK = Object.freeze({
  ...D1_ORACLE_ADOPTED_EVIDENCE_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_ADOPTED_EVIDENCE_READBACK_CORE)
});
const D1_ORACLE_ADOPTED_APPLICABILITY_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_ADOPTED_EVIDENCE_APPLICABILITY_READBACK',
  authoritative: true, current: true, readBack: true,
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  sourceIdentity: D1_ORACLE_ADOPTED_EVIDENCE_READBACK.sourceIdentity,
  evidenceId: D1_ORACLE_ADOPTED_EVIDENCE_READBACK.evidenceId,
  findingIds: Object.freeze(['F-LOGIN-CONTRACT-01']),
  coveredMaterialFacts: Object.freeze([]), applicability: 'ADEQUATE_FOR_CONSUMER'
});
const D1_ORACLE_ADOPTED_APPLICABILITY_READBACK = Object.freeze({
  ...D1_ORACLE_ADOPTED_APPLICABILITY_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_ADOPTED_APPLICABILITY_READBACK_CORE)
});
const D1_ORACLE_ADOPTED_PORTAL_APPLICABILITY_READBACK_CORE = Object.freeze({
  ...D1_ORACLE_ADOPTED_APPLICABILITY_READBACK_CORE,
  findingIds: Object.freeze(['F-PORTAL']),
  coveredMaterialFacts: Object.freeze(['portal:submit']),
  digest: undefined
});
const D1_ORACLE_ADOPTED_PORTAL_APPLICABILITY_READBACK = Object.freeze({
  ...D1_ORACLE_ADOPTED_PORTAL_APPLICABILITY_READBACK_CORE,
  digest: s1aHashWithoutField(D1_ORACLE_ADOPTED_PORTAL_APPLICABILITY_READBACK_CORE, 'digest')
});
const D1_ORACLE_G1_WEB_DECISION_BODY = Object.freeze({
  schema: 'toolkit.g1.web-decision.v1',
  decisionId: 'decision:accepted-8',
  repository: 'repo:example/product',
  programmeId: 'programme:discovery-1',
  childId: 'child:settings-1',
  childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01',
  baselineRevision: 4,
  findingIds: Object.freeze(['F-LOGIN-CONTRACT-01']),
  evidenceIds: Object.freeze(['evidence:exact-investigation-7']),
  outcome: 'ACCEPTED'
});
const D1_ORACLE_G1_WEB_DECISION_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_G1_WEB_DECISION_READBACK',
  authoritative: true,
  current: true,
  readBack: true,
  repository: 'repo:example/product',
  programmeId: 'programme:discovery-1',
  childId: 'child:settings-1',
  childRevision: 'child:settings-rev-11',
  revision: 'web-decision:rev-8',
  body: D1_ORACLE_G1_WEB_DECISION_BODY,
  bodyDigest: s1aHashRecord(D1_ORACLE_G1_WEB_DECISION_BODY)
});
const D1_ORACLE_G1_WEB_DECISION_READBACK = Object.freeze({
  ...D1_ORACLE_G1_WEB_DECISION_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_G1_WEB_DECISION_READBACK_CORE)
});
const D1_ORACLE_X3_WEB_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_X3_WEB_OPERATION_AUTHORITY_READBACK',
  authoritative: true,
  current: true,
  readBack: true,
  repository: 'repo:example/product',
  programmeId: 'programme:discovery-1', childId: 'child:settings-1',
  childRevision: 'child:settings-rev-11', baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  operation: 'EFFECTFUL_DISCOVERY_PROBE',
  scope: 'programme:discovery-1/child:settings-1',
  authorityId: 'x3-authority:probe-4'
});
const D1_ORACLE_X3_WEB_AUTHORITY = Object.freeze({
  ...D1_ORACLE_X3_WEB_AUTHORITY_CORE,
  digest: s1aHashRecord(D1_ORACLE_X3_WEB_AUTHORITY_CORE)
});
const D1_ORACLE_PRIVATE_CUSTODY_READBACK_CORE = Object.freeze({
  source: 'CURRENT_AUTHORISED_PRIVATE_CUSTODY_READBACK',
  authoritative: true,
  current: true,
  readBack: true,
  custodyReceiptId: 'custody:receipt-7',
  reference: 'owner-custody:opaque-ref-07',
  consumer: 'programme:discovery-1/child:settings-1',
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  recoverable: true
});
const D1_ORACLE_PRIVATE_CUSTODY_READBACK = Object.freeze({
  ...D1_ORACLE_PRIVATE_CUSTODY_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_PRIVATE_CUSTODY_READBACK_CORE)
});
const D1_ORACLE_REUSE_APPLICABILITY_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DISCOVERY_APPLICABILITY_READBACK',
  authoritative: true, current: true, readBack: true,
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  reusedFindingIds: Object.freeze(['F-LOGIN-CONTRACT-01']),
  checkedDependencyIdentities: Object.freeze(['auth:contract', 'ui:header']),
  checkedInvalidationTriggers: Object.freeze(['auth:contract-change', 'ui:header-change']),
  result: 'UNCHANGED_APPLICABLE', dedicatedDiscovery: 'NONE'
});
const D1_ORACLE_REUSE_APPLICABILITY_READBACK = Object.freeze({
  ...D1_ORACLE_REUSE_APPLICABILITY_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_REUSE_APPLICABILITY_READBACK_CORE)
});
const D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DISCOVERY_DEPENDENCY_READBACK',
  authoritative: true, current: true, readBack: true, complete: true,
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  findings: Object.freeze([
    Object.freeze({ FINDING_ID: 'F-UI', DEPENDENT_IDENTITIES: Object.freeze(['ui:settings-panel']),
      INVALIDATION_TRIGGERS: Object.freeze(['ui:settings-panel-redesign']) }),
    Object.freeze({ FINDING_ID: 'F-AUTH', DEPENDENT_IDENTITIES: Object.freeze(['auth:contract']),
      INVALIDATION_TRIGGERS: Object.freeze(['auth:contract-change']) }),
    Object.freeze({ FINDING_ID: 'F-STALE', DEPENDENT_IDENTITIES: Object.freeze(['route:v1']),
      INVALIDATION_TRIGGERS: Object.freeze(['route:v2']) }),
    Object.freeze({ FINDING_ID: 'F-PORTAL', DEPENDENT_IDENTITIES: Object.freeze(['portal:submit']),
      INVALIDATION_TRIGGERS: Object.freeze(['portal:submit-contract']) }),
    Object.freeze({ FINDING_ID: 'F-PRIVATE', DEPENDENT_IDENTITIES: Object.freeze(['private:claim']),
      INVALIDATION_TRIGGERS: Object.freeze(['private:claim-change']) }),
    Object.freeze({ FINDING_ID: 'F-EXTERNAL', DEPENDENT_IDENTITIES: Object.freeze(['external:submit']),
      INVALIDATION_TRIGGERS: Object.freeze(['external:submit-change']) })
  ])
});
const D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK = Object.freeze({
  ...D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK_CORE)
});
const D1_ORACLE_DISCOVERY_ENACTMENT_RECEIPT_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DISCOVERY_ENACTMENT_RECEIPT_READBACK',
  authoritative: true, current: true, readBack: true, terminal: true,
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  operationAuthorityId: D1_ORACLE_X3_WEB_AUTHORITY.authorityId,
  operation: 'EFFECTFUL_DISCOVERY_PROBE', status: 'COMPLETED', effectReconciled: true,
  evidenceId: 'evidence:portal-enactment-9',
  safeEvidenceOrReverifyReference: 'repo:example/product/docs/evidence/portal-enactment-9.md@source:rev-12#event-9'
});
const D1_ORACLE_DISCOVERY_ENACTMENT_RECEIPT = Object.freeze({
  ...D1_ORACLE_DISCOVERY_ENACTMENT_RECEIPT_CORE,
  digest: s1aHashRecord(D1_ORACLE_DISCOVERY_ENACTMENT_RECEIPT_CORE)
});
const D1_ORACLE_DISCOVERY_OBSERVATION_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DISCOVERY_OBSERVATION_READBACK',
  authoritative: true, current: true, readBack: true,
  repository: 'repo:example/product', programmeId: 'programme:discovery-1',
  childId: 'child:settings-1', childRevision: 'child:settings-rev-11',
  baselineId: 'BASELINE-EXAMPLE-01', baselineRevision: 4,
  findingIds: Object.freeze(['F-PORTAL']),
  changedMaterialFacts: Object.freeze(['portal:submit']),
  status: 'OBSERVED', representativeEnactment: true,
  evidenceId: 'evidence:portal-enactment-9',
  safeEvidenceOrReverifyReference:
    'repo:example/product/docs/evidence/portal-enactment-9.md@source:rev-12#event-9',
  enactmentReceiptId: 'enactment:portal-9',
  enactmentReceiptReadback: D1_ORACLE_DISCOVERY_ENACTMENT_RECEIPT,
  observationContext: 'authorised representative portal workflow completed and recovered',
  operationAuthorityId: D1_ORACLE_X3_WEB_AUTHORITY.authorityId
});
const D1_ORACLE_DISCOVERY_OBSERVATION_READBACK = Object.freeze({
  ...D1_ORACLE_DISCOVERY_OBSERVATION_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_DISCOVERY_OBSERVATION_READBACK_CORE)
});
function d1ExactCurrentReadback(actual, expected) {
  return actual !== null && typeof actual === 'object' &&
    s1aSame(actual, expected) && actual.authoritative === true &&
    actual.current === true && actual.readBack === true &&
    actual.digest === s1aHashWithoutField(actual, 'digest');
}
function d1DiscoveryScopeMatches(input) {
  const scope = input.consumerScopeReadback || {};
  return d1ExactCurrentReadback(scope, D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_READBACK) &&
    input.repository === scope.repository && input.programmeId === scope.programmeId &&
    input.childId === scope.childId && input.childRevision === scope.childRevision &&
    input.baselineId === scope.baselineId && input.baselineRevision === scope.baselineRevision;
}
function d1MakeDiscoveryInput(input = {}) {
  const scope = D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_CORE;
  const findings = D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK.findings;
  return {
    repository: scope.repository, programmeId: scope.programmeId, childId: scope.childId,
    childRevision: scope.childRevision, baselineId: scope.baselineId, baselineRevision: scope.baselineRevision,
    consumerScopeReadback: D1_ORACLE_DISCOVERY_CONSUMER_SCOPE_READBACK,
    reuseApplicabilityReadback: D1_ORACLE_REUSE_APPLICABILITY_READBACK,
    reusedFindingIds: ['F-LOGIN-CONTRACT-01'],
    reusedDependencyIdentities: ['auth:contract', 'ui:header'],
    reusedInvalidationTriggers: ['auth:contract-change', 'ui:header-change'],
    currentDependencyFindingInventory: s1aClone(findings),
    currentFindingIds: findings.map((finding) => finding.FINDING_ID).sort(),
    adoptedFindingIds: ['F-LOGIN-CONTRACT-01'],
    ...input
  };
}
function evaluateD1DiscoveryBasis(input) {
  const scopeMatches = d1DiscoveryScopeMatches(input);
  const changedFactsProvided = Object.prototype.hasOwnProperty.call(input, 'changedMaterialFacts');
  const changedFactsValid = !changedFactsProvided || (Array.isArray(input.changedMaterialFacts) &&
    input.changedMaterialFacts.every((fact) => typeof fact === 'string' && s1aPresent(fact)) &&
    new Set(input.changedMaterialFacts).size === input.changedMaterialFacts.length);
  const changedFacts = changedFactsProvided && changedFactsValid ? input.changedMaterialFacts : [];
  const changedIdentities = new Set(changedFacts);
  const adoptionApplicability = input.adoptedApplicabilityReadback || {};
  const adoptionApplicabilityValid = scopeMatches &&
    [D1_ORACLE_ADOPTED_APPLICABILITY_READBACK, D1_ORACLE_ADOPTED_PORTAL_APPLICABILITY_READBACK].some((expected) =>
      d1ExactCurrentReadback(adoptionApplicability, expected) &&
      adoptionApplicability.repository === input.repository &&
      adoptionApplicability.programmeId === input.programmeId &&
      adoptionApplicability.childId === input.childId &&
      adoptionApplicability.childRevision === input.childRevision &&
      adoptionApplicability.baselineId === input.baselineId &&
      adoptionApplicability.baselineRevision === input.baselineRevision &&
      s1aSame(adoptionApplicability.sourceIdentity, input.adoptedEvidenceReadback && input.adoptedEvidenceReadback.sourceIdentity) &&
      adoptionApplicability.evidenceId === (input.adoptedEvidenceReadback && input.adoptedEvidenceReadback.evidenceId) &&
      s1aSame(input.adoptedFindingIds, adoptionApplicability.findingIds) &&
      changedFacts.every((fact) => adoptionApplicability.coveredMaterialFacts.includes(fact)) &&
      adoptionApplicability.applicability === 'ADEQUATE_FOR_CONSUMER');
  const adoptedEvidenceValid = scopeMatches &&
    d1ExactCurrentReadback(input.adoptedEvidenceReadback, D1_ORACLE_ADOPTED_EVIDENCE_READBACK) &&
    input.adoptedEvidenceReadback.evidenceId === D1_ORACLE_ADOPTED_EVIDENCE_READBACK.evidenceId &&
    input.adoptedEvidenceReadback.safeReverificationReference ===
      D1_ORACLE_ADOPTED_EVIDENCE_READBACK.safeReverificationReference &&
    adoptionApplicabilityValid;
  let basis = 'REUSE';
  if (input.materialUnknown === true && input.requiresProgrammeScopeInvestigation === true) {
    if (adoptedEvidenceValid) basis = 'ADOPTED_EQUIVALENT';
    else if (input.safeToInvestigate === true) basis = 'FULL';
    else if (changedFacts.length > 0) basis = 'DELTA';
  } else if (input.adoptExisting === true && adoptedEvidenceValid) {
    basis = 'ADOPTED_EQUIVALENT';
  } else if (changedFacts.length > 0) {
    basis = 'DELTA';
  }
  const reuse = input.reuseApplicabilityReadback || {};
  const reuseApplicabilityValid = basis !== 'REUSE' || (scopeMatches &&
    d1ExactCurrentReadback(reuse, D1_ORACLE_REUSE_APPLICABILITY_READBACK) &&
    reuse.repository === input.repository && reuse.programmeId === input.programmeId &&
    reuse.childId === input.childId && reuse.childRevision === input.childRevision && reuse.baselineId === input.baselineId &&
    reuse.baselineRevision === input.baselineRevision &&
    s1aSame(input.reusedFindingIds, reuse.reusedFindingIds) &&
    s1aSame(input.reusedDependencyIdentities, reuse.checkedDependencyIdentities) &&
    s1aSame(input.reusedInvalidationTriggers, reuse.checkedInvalidationTriggers));
  const dependency = input.discoveryDependencyReadback || {};
  const currentFindingIds = Array.isArray(input.currentDependencyFindingInventory)
    ? input.currentDependencyFindingInventory.map((finding) => finding.FINDING_ID).sort() : [];
  const dependencyReadbackValid = basis !== 'DELTA' || (scopeMatches &&
    d1ExactCurrentReadback(dependency, D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK) &&
    dependency.repository === input.repository && dependency.programmeId === input.programmeId &&
    dependency.childId === input.childId && dependency.childRevision === input.childRevision && dependency.baselineId === input.baselineId &&
    dependency.baselineRevision === input.baselineRevision && dependency.complete === true &&
    s1aSame(input.currentDependencyFindingInventory, dependency.findings) &&
    s1aSame(input.currentFindingIds, currentFindingIds) &&
    changedFacts.length > 0 && new Set(changedFacts).size === changedFacts.length &&
    s1aSame([...(input.changedDependencyIdentities || [])].sort(), [...changedFacts].sort()) &&
    changedFacts.every((identity) => dependency.findings.some((finding) =>
      finding.DEPENDENT_IDENTITIES.includes(identity) || finding.INVALIDATION_TRIGGERS.includes(identity))));
  const invalidatedFindingIds = dependencyReadbackValid && basis === 'DELTA' ?
    dependency.findings.filter((finding) =>
      (finding.DEPENDENT_IDENTITIES || []).some((identity) => changedIdentities.has(identity)) ||
      (finding.INVALIDATION_TRIGGERS || []).some((trigger) => changedIdentities.has(trigger)))
      .map((finding) => finding.FINDING_ID) : [];
  let status = input.requestedStatus || 'PROPOSED';
  let disposition = input.disposition || null;
  if (!D1_DISCOVERY_STATUS_VALUES.includes(status)) {
    status = 'UNKNOWN';
    disposition = disposition || 'UNKNOWN_STATUS_REQUIRES_OWNER_WEB';
  }
  const unsafeInvestigation = input.materialUnknown === true &&
    input.requiresProgrammeScopeInvestigation === true && input.safeToInvestigate !== true && !adoptedEvidenceValid;
  const unsafeEvidence = input.unsafeRepresentativeEnactment === true || unsafeInvestigation;
  if (unsafeEvidence) {
    status = input.documentedPartialEvidence === true ? 'DOCUMENTED_NOT_DEMONSTRATED' : 'UNKNOWN';
    disposition = disposition || 'OWNER_WEB_DECISION_REQUIRED';
  }
  let unsupportedObservation = false;
  if (status === 'OBSERVED') {
    const observation = input.observationReadback;
    const observationValid = !unsafeEvidence && scopeMatches &&
      d1ExactCurrentReadback(observation, D1_ORACLE_DISCOVERY_OBSERVATION_READBACK) &&
      observation.repository === input.repository && observation.programmeId === input.programmeId &&
      observation.childId === input.childId && observation.childRevision === input.childRevision &&
      observation.baselineId === input.baselineId && observation.baselineRevision === input.baselineRevision &&
      s1aSame(input.observationFindingIds, observation.findingIds) &&
      s1aSame(changedFacts, observation.changedMaterialFacts) &&
      observation.representativeEnactment === true &&
      observation.enactmentReceiptId === 'enactment:portal-9' &&
      d1ExactCurrentReadback(observation.enactmentReceiptReadback, D1_ORACLE_DISCOVERY_ENACTMENT_RECEIPT) &&
      observation.enactmentReceiptReadback.operationAuthorityId === observation.operationAuthorityId &&
      observation.enactmentReceiptReadback.evidenceId === observation.evidenceId &&
      observation.safeEvidenceOrReverifyReference === observation.enactmentReceiptReadback.safeEvidenceOrReverifyReference &&
      input.safeToInvestigate === true;
    if (!observationValid) {
      status = input.documentedPartialEvidence === true ? 'DOCUMENTED_NOT_DEMONSTRATED' : 'UNKNOWN';
      disposition = disposition || 'CURRENT_OBSERVATION_READBACK_REQUIRED';
      unsupportedObservation = true;
    }
  }
  let unsupportedAcceptance = false;
  if (status === 'ACCEPTED') {
    const decision = input.g1WebDecisionReadback;
    const scopeMatchesDecision = scopeMatches && d1ExactCurrentReadback(decision, D1_ORACLE_G1_WEB_DECISION_READBACK) &&
      input.exactG1WebDecisionId === decision.body.decisionId &&
      input.repository === decision.repository && input.programmeId === decision.programmeId &&
      input.childId === decision.childId && input.childRevision === decision.childRevision &&
      input.childRevision === decision.body.childRevision && input.baselineId === decision.body.baselineId &&
      input.baselineRevision === decision.body.baselineRevision &&
      s1aSame(input.consumingFindingIds, decision.body.findingIds) &&
      s1aSame(input.evidenceIds, decision.body.evidenceIds);
    if (!scopeMatchesDecision) {
      status = input.documentedPartialEvidence === true ? 'DOCUMENTED_NOT_DEMONSTRATED' : 'UNKNOWN';
      disposition = disposition || 'EXACT_CURRENT_G1_WEB_DECISION_READBACK_REQUIRED';
      unsupportedAcceptance = true;
    }
  }
  const rawPrivateMaterialIncluded = input.rawPrivateMaterialIncluded === true;
  const privateEvidencePresent = input.privateEvidencePresent === true ||
    input.privateEvidenceReference !== undefined || rawPrivateMaterialIncluded;
  const custody = input.privateCustodyReadback;
  const privateReferenceValid = scopeMatches && !rawPrivateMaterialIncluded && (!privateEvidencePresent ||
    (input.privateEvidenceReference === D1_ORACLE_PRIVATE_CUSTODY_READBACK.reference &&
      d1ExactCurrentReadback(custody, D1_ORACLE_PRIVATE_CUSTODY_READBACK) &&
      custody.reference === input.privateEvidenceReference && custody.recoverable === true &&
      custody.repository === input.repository && custody.programmeId === input.programmeId &&
      custody.childId === input.childId && custody.childRevision === input.childRevision && custody.baselineId === input.baselineId &&
      custody.baselineRevision === input.baselineRevision));
  const effectfulProbe = input.effectfulProbe === true;
  const x3 = input.x3WebAuthorityReadback;
  const effectAuthorized = effectfulProbe && scopeMatches &&
    d1ExactCurrentReadback(x3, D1_ORACLE_X3_WEB_AUTHORITY) &&
    x3.repository === input.repository && x3.programmeId === input.programmeId &&
    x3.childId === input.childId && x3.childRevision === input.childRevision && x3.baselineId === input.baselineId &&
    x3.baselineRevision === input.baselineRevision && x3.operation === 'EFFECTFUL_DISCOVERY_PROBE';
  const outcome = !scopeMatches || !changedFactsValid || !reuseApplicabilityValid || !dependencyReadbackValid ||
    (effectfulProbe && !effectAuthorized) || unsafeEvidence || unsupportedObservation ||
    unsupportedAcceptance || rawPrivateMaterialIncluded || (privateEvidencePresent && !privateReferenceValid)
    ? 'HOLD' : 'PASS';
  return {
    basis, outcome, status, disposition, invalidatedFindingIds,
    dedicatedDiscovery: basis === 'DELTA' || basis === 'FULL',
    createsGate: false, createsRole: false, createsLocalG2: false, createsLocalG3: false, createsLocalG4: false,
    g0ReadOnly: true, effectPerformedByG0: false, effectAuthorized,
    privateReferenceValid, rawPrivateMaterialIncluded
  };
}function d1RootRecord(rootId, causalFamilyId, attemptIds, options = {}) {
  const uniqueAttemptIds = [...new Set(attemptIds)];
  return {
    ROOT_ID: rootId,
    ACCEPTED_G2_OBLIGATION: options.obligation || 'obligation:accepted-g2-1',
    CAUSAL_MECHANISM_OR_BOUNDARY: options.causalBoundary || 'boundary:' + causalFamilyId,
    AFFECTED_SURFACE: options.surface || 'surface:settings',
    MUTATION_SCOPE: options.mutationScope || ['repo/CONTROLLER.md'],
    DEPENDENCIES: options.dependencies || ['dependency:current'],
    ATTEMPT_IDS: attemptIds,
    ATTEMPTS_CONSUMED: options.declaredAttempts === undefined ? uniqueAttemptIds.length : options.declaredAttempts,
    STATE: options.state || 'OPEN',
    NEW_ROOT_DISCOVERED: options.newlyDiscovered === true
  };
}
const D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY = JSON.stringify(['obligation:accepted-g2-1', 'boundary:attempt-family-1']);
const D1_ORACLE_CROSS_ROOT_FAMILY_KEY = JSON.stringify(['obligation:accepted-g2-1', 'boundary:attempt-family-2']);
const D1_ORACLE_RELABELED_ROOT_FAMILY_KEY = JSON.stringify(['obligation:accepted-g2-1', 'boundary:cause:new-label']);
const D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_G3_PRIOR_ATTRIBUTION_AUDIT_READBACK',
  authoritative: true,
  current: true,
  readBack: true,
  complete: true,
  repository: 'weijunswj/ai-agent-toolkit',
  programmeId: '421',
  deliveryChildId: '461',
  runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
  lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
  revision: 'root-ledger:revision-9',
  rootFamilyKey: JSON.stringify(['obligation:accepted-g2-1', 'boundary:cause:new']),
  historicalEpisodeAttemptIds: Object.freeze(['A1', 'A2', 'A3']),
  previouslyAddressedFamilies: Object.freeze(['["obligation:accepted-g2-1","boundary:cause:prior"]']),
  verifiedUntouched: true
});
const D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT = Object.freeze({
  ...D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT_CORE,
  digest: s1aHashRecord(D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT_CORE)
});function d1StableRootFamilyKey(record) {
  return JSON.stringify([record.ACCEPTED_G2_OBLIGATION, record.CAUSAL_MECHANISM_OR_BOUNDARY]);
}
const D1_ORACLE_TRUSTED_ROOT_LEDGER_READBACKS = new WeakMap();
function makeD1RootLedgerAuthority(records, options = {}) {
  const inferredPriorAttemptAttributionByFamily = {};
  for (const record of records) {
    if (Array.isArray(record.ATTEMPT_IDS) && record.ATTEMPT_IDS.length > 0 && record.NEW_ROOT_DISCOVERED !== true) {
      const familyKey = d1StableRootFamilyKey(record);
      inferredPriorAttemptAttributionByFamily[familyKey] = [...new Set([
        ...(inferredPriorAttemptAttributionByFamily[familyKey] || []), ...record.ATTEMPT_IDS
      ])];
    }
  }
  const priorAttemptAttributionByFamily = options.priorAttemptAttributionByFamily === undefined ?
    inferredPriorAttemptAttributionByFamily : options.priorAttemptAttributionByFamily;
  const previouslyAddressedFamilies = options.previouslyAddressedFamilies === undefined ?
    Object.keys(inferredPriorAttemptAttributionByFamily) : options.previouslyAddressedFamilies;
  const core = {
    source: 'CURRENT_CANONICAL_G3_ROOT_LEDGER_READBACK',
    authoritative: true,
    current: true,
    readBack: true,
    complete: true,
    repository: 'weijunswj/ai-agent-toolkit',
    programmeId: '421',
    deliveryChildId: '461',
    runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
    lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
    revision: 'root-ledger:revision-9',
    currentRecords: s1aClone(records),
    historicalEpisodeAttemptIds: [...new Set(options.historicalEpisodeAttemptIds || records.flatMap((record) => record.ATTEMPT_IDS))],
    attemptHistory: {
      ordinaryAttemptIds: [...(options.ordinaryAttemptIds || options.historicalEpisodeAttemptIds || records.flatMap((record) => record.ATTEMPT_IDS))],
      wdcAttemptIds: [...(options.wdcAttemptIds || [])],
      reconvergedAttemptIds: [...(options.reconvergedAttemptIds || [])]
    },
    priorAttemptAttributionByFamily: s1aClone(priorAttemptAttributionByFamily),
    previouslyAddressedFamilies: [...previouslyAddressedFamilies],
    verifiedUntouchedRootFamilies: [...(options.verifiedUntouchedRootFamilies || [])],
    narrowingProgressByFamily: s1aClone(options.narrowingProgressByFamily || {}),
    narrowingProgressReadbacksByFamily: s1aClone(options.narrowingProgressReadbacksByFamily || {}),
    attributionAuditComplete: options.attributionAuditComplete === true,
    zeroRootPriorAttributionAuditReadback: options.includeUntouchedRootAudit === true ?
      D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT : null
  };
  const rootLedgerReadback = { ...core, digest: s1aHashRecord(core) };
  const trustedRootLedgerSnapshot = s1aClone(core);
  D1_ORACLE_TRUSTED_ROOT_LEDGER_READBACKS.set(rootLedgerReadback, trustedRootLedgerSnapshot);
  return { rootLedgerReadback, trustedRootLedgerSnapshot };
}
function makeD1AttemptLedger(options = {}) {
  const ordinaryAttemptIds = [...(options.ordinaryAttemptIds || [])];
  const wdcAttemptIds = [...(options.wdcAttemptIds || [])];
  const reconvergedAttemptIds = [...(options.reconvergedAttemptIds || [])];
  const historicalEpisodeAttemptIds = [...new Set([...ordinaryAttemptIds, ...wdcAttemptIds, ...reconvergedAttemptIds])];
  const root = d1RootRecord('root:attempt-family-1', 'attempt-family-1', ordinaryAttemptIds,
    { causalBoundary: 'boundary:attempt-family-1' });
  return makeD1RootLedgerAuthority([root], {
    historicalEpisodeAttemptIds, ordinaryAttemptIds, wdcAttemptIds, reconvergedAttemptIds,
    narrowingProgressByFamily: options.narrowingProgressByFamily || {},
    narrowingProgressReadbacksByFamily: options.narrowingProgressReadbacksByFamily || {}
  });
}function evaluateD1RootLedger(records, context = {}) {
  const failures = [];
  const requiredReadbackKeys = [
    'source', 'authoritative', 'current', 'readBack', 'complete', 'repository', 'programmeId',
    'runId', 'lockId', 'deliveryChildId', 'revision', 'currentRecords', 'historicalEpisodeAttemptIds', 'attemptHistory',
    'priorAttemptAttributionByFamily', 'previouslyAddressedFamilies', 'verifiedUntouchedRootFamilies',
    'narrowingProgressByFamily', 'narrowingProgressReadbacksByFamily', 'attributionAuditComplete', 'zeroRootPriorAttributionAuditReadback', 'digest'
  ];
  const readback = context.rootLedgerReadback || {};
  const trusted = D1_ORACLE_TRUSTED_ROOT_LEDGER_READBACKS.get(readback) || {};
  const readbackCore = { ...readback };
  delete readbackCore.digest;
  if (!s1aHasExactKeys(readback, requiredReadbackKeys) ||
      !s1aSame(records, readback.currentRecords) ||
      !s1aSame(readbackCore, trusted) ||
      readback.digest !== s1aHashRecord(readbackCore) ||
      readback.source !== 'CURRENT_CANONICAL_G3_ROOT_LEDGER_READBACK' ||
      readback.authoritative !== true || readback.current !== true || readback.readBack !== true ||
      readback.complete !== true || readback.repository !== 'weijunswj/ai-agent-toolkit' ||
      readback.programmeId !== '421' || readback.deliveryChildId !== '461' ||
      readback.runId !== 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001' ||
      readback.lockId !== 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001' || !s1aPresent(readback.revision) ||
      !Array.isArray(readback.historicalEpisodeAttemptIds) ||
      new Set(readback.historicalEpisodeAttemptIds).size !== readback.historicalEpisodeAttemptIds.length ||
      !Array.isArray(readback.previouslyAddressedFamilies) ||
      !Array.isArray(readback.verifiedUntouchedRootFamilies) ||
      typeof readback.attributionAuditComplete !== 'boolean') {
    failures.push('ROOT_LEDGER_CURRENT_AUTHORITATIVE_READBACK');
  }
  const episodeHistory = readback.attemptHistory || {};
  const historyFields = ['ordinaryAttemptIds', 'wdcAttemptIds', 'reconvergedAttemptIds'];
  const historyLists = historyFields.map((field) => episodeHistory[field]);
  const historyIds = new Set(historyLists.flatMap((ids) => Array.isArray(ids) ? ids : []));
  if (!s1aHasExactKeys(episodeHistory, historyFields) ||
      !historyLists.every(d1AttemptIdList) || historyIds.size !== historyLists.flatMap((ids) => ids).length ||
      !s1aSame([...historyIds].sort(), [...(readback.historicalEpisodeAttemptIds || [])].sort()) ||
      !readback.narrowingProgressReadbacksByFamily || typeof readback.narrowingProgressReadbacksByFamily !== 'object') {
    failures.push('ROOT_EPISODE_ATTEMPT_HISTORY_READBACK');
  }
  const requiredRecordFields = [
    'ROOT_ID', 'ACCEPTED_G2_OBLIGATION', 'CAUSAL_MECHANISM_OR_BOUNDARY', 'AFFECTED_SURFACE',
    'MUTATION_SCOPE', 'DEPENDENCIES', 'ATTEMPT_IDS', 'ATTEMPTS_CONSUMED', 'STATE', 'NEW_ROOT_DISCOVERED'
  ];
  const groups = new Map();
  const seenRootIds = new Map();
  const historicalIds = new Set(readback.historicalEpisodeAttemptIds || []);
  for (const record of records) {
    if (requiredRecordFields.some((field) => !Object.hasOwn(record, field)) ||
        !s1aPresent(record.ROOT_ID) || !s1aPresent(record.ACCEPTED_G2_OBLIGATION) ||
        !s1aPresent(record.CAUSAL_MECHANISM_OR_BOUNDARY) || !s1aPresent(record.AFFECTED_SURFACE) ||
        !Array.isArray(record.MUTATION_SCOPE) || record.MUTATION_SCOPE.length === 0 ||
        !record.MUTATION_SCOPE.every(s1aPresent) || !Array.isArray(record.DEPENDENCIES) ||
        !record.DEPENDENCIES.every(s1aPresent) || !Array.isArray(record.ATTEMPT_IDS) ||
        !record.ATTEMPT_IDS.every(s1aPresent) || new Set(record.ATTEMPT_IDS).size !== record.ATTEMPT_IDS.length ||
        !Number.isInteger(record.ATTEMPTS_CONSUMED) || record.ATTEMPTS_CONSUMED !== record.ATTEMPT_IDS.length ||
        !['OPEN', 'CLOSED', 'HOLD', 'NONCONVERGED'].includes(record.STATE) ||
        typeof record.NEW_ROOT_DISCOVERED !== 'boolean') {
      failures.push('ROOT_RECORD_OR_ATTEMPT_BINDING');
      continue;
    }
    const key = d1StableRootFamilyKey(record);
    if (seenRootIds.has(record.ROOT_ID) && seenRootIds.get(record.ROOT_ID) !== key) {
      failures.push('ROOT_ID_REBOUND_TO_DIFFERENT_CAUSAL_FAMILY');
    }
    seenRootIds.set(record.ROOT_ID, key);
    const group = groups.get(key) || { familyKey: key, rootIds: [], attemptIds: new Set(), states: new Set(), newRootDiscovered: false };
    group.rootIds.push(record.ROOT_ID);
    group.states.add(record.STATE);
    group.newRootDiscovered = group.newRootDiscovered || record.NEW_ROOT_DISCOVERED;
    for (const attemptId of record.ATTEMPT_IDS) {
      group.attemptIds.add(attemptId);
      if (!historicalIds.has(attemptId)) failures.push('CURRENT_ATTEMPT_MISSING_FROM_EPISODE_HISTORY:' + attemptId);
    }
    groups.set(key, group);
  }
  const priorMap = readback.priorAttemptAttributionByFamily || {};
  for (const [key, ids] of Object.entries(priorMap)) {
    if (!Array.isArray(ids) || !ids.every(s1aPresent) || new Set(ids).size !== ids.length) {
      failures.push('PRIOR_ROOT_ATTRIBUTION_READBACK_INVALID:' + key);
      continue;
    }
    for (const attemptId of ids) {
      if (!historicalIds.has(attemptId)) failures.push('ATTRIBUTED_ATTEMPT_MISSING_FROM_EPISODE_HISTORY:' + attemptId);
    }
  }
  const ordinaryHistoryIds = new Set(episodeHistory.ordinaryAttemptIds || []);
  const rootAttributedAttemptIds = new Set([
    ...records.flatMap((record) => Array.isArray(record.ATTEMPT_IDS) ? record.ATTEMPT_IDS : []),
    ...Object.values(priorMap).flatMap((ids) => Array.isArray(ids) ? ids : [])
  ]);
  for (const attemptId of ordinaryHistoryIds) {
    if (!rootAttributedAttemptIds.has(attemptId)) {
      failures.push('ORDINARY_EPISODE_ATTEMPT_MISSING_STABLE_ROOT_ATTRIBUTION:' + attemptId);
    }
  }
  for (const attemptId of rootAttributedAttemptIds) {
    if (!ordinaryHistoryIds.has(attemptId)) {
      failures.push('ROOT_ATTEMPT_NOT_CLASSIFIED_AS_ORDINARY_HISTORY:' + attemptId);
    }
  }
  for (const [key, group] of groups) {
    for (const attemptId of priorMap[key] || []) group.attemptIds.add(attemptId);
    if (group.states.size > 1) failures.push('EQUIVALENT_ROOT_STATE_CONFLICT:' + key);
    const priorFamilyAttemptIds = priorMap[key] || [];
    const familyHasPriorAttemptAttribution = priorFamilyAttemptIds.length > 0;
    if (group.attemptIds.size === 0 || group.newRootDiscovered || !familyHasPriorAttemptAttribution) {
      const audit = readback.zeroRootPriorAttributionAuditReadback;
      const auditBindsWholeHistory = d1ExactCurrentReadback(audit, D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT) &&
        audit.rootFamilyKey === key && audit.repository === readback.repository &&
        audit.programmeId === readback.programmeId && audit.deliveryChildId === readback.deliveryChildId &&
        audit.runId === readback.runId &&
        audit.lockId === readback.lockId && audit.revision === readback.revision &&
        s1aSame(audit.historicalEpisodeAttemptIds, readback.historicalEpisodeAttemptIds) &&
        s1aSame(audit.previouslyAddressedFamilies, readback.previouslyAddressedFamilies);
      if (!readback.attributionAuditComplete || !group.newRootDiscovered || !auditBindsWholeHistory ||
          !readback.verifiedUntouchedRootFamilies.includes(key) ||
          readback.previouslyAddressedFamilies.includes(key) || priorFamilyAttemptIds.length > 0) {
        failures.push('NEW_ROOT_WITHOUT_BOUND_UNTOUCHED_ATTRIBUTION_AUDIT');
      }
    }
    if (group.attemptIds.size > 5) failures.push('SAME_ROOT_ABSOLUTE_ATTEMPT_CEILING_EXCEEDED:' + key);
    for (let requiredAttemptNumber = 4; requiredAttemptNumber <= Math.min(group.attemptIds.size, 5); requiredAttemptNumber += 1) {
      const familyProgressReadbacks = (readback.narrowingProgressReadbacksByFamily || {})[key] || {};
      if (!d1ProgressReadbackValid({
        narrowingProgressReadback: familyProgressReadbacks[requiredAttemptNumber]
      }, key, requiredAttemptNumber, readback)) {
        failures.push('LATE_ROOT_ATTEMPTS_REQUIRE_BOUND_NARROWING_PROGRESS:' + key + ':' + requiredAttemptNumber);
      }
    }
  }
  const rootGroups = [...groups.values()].map((group) => ({
    rootIds: group.rootIds,
    attemptIds: [...group.attemptIds].sort(),
    attemptsConsumed: group.attemptIds.size,
    state: group.states.size === 1 ? [...group.states][0] : 'HOLD'
  }));
  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    rootGroups,
    historicalAttemptCount: historicalIds.size
  };
}
function d1EvaluateRootRecords(records, options = {}) {
  return evaluateD1RootLedger(records, makeD1RootLedgerAuthority(records, options));
}
function evaluateD1NextRootAttempt(attemptNumber, narrowingProgress) {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) return false;
  if (attemptNumber <= 3) return true;
  return attemptNumber <= 5 && narrowingProgress === true;
}
const D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES = Object.freeze([
  { classification: 'EXISTING_ROOT', repeatedCrossRootReopening: false, findingId: 'finding:existing-root', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze([]) },
  { classification: 'NEW_ROOT_DISCOVERED', repeatedCrossRootReopening: false, findingId: 'finding:new-root', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze([]) },
  { classification: 'CROSS_ROOT_INTERACTION', repeatedCrossRootReopening: false, findingId: 'finding:cross-root-single', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, D1_ORACLE_CROSS_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze(['A1']) },
  { classification: 'CROSS_ROOT_INTERACTION', repeatedCrossRootReopening: true, findingId: 'finding:cross-root-reopen', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, D1_ORACLE_CROSS_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze(['A1', 'A2']) },
  { classification: 'EXISTING_ROOT', repeatedCrossRootReopening: false, findingId: 'finding:relabelled-current', stableRootFamilyKeys: Object.freeze([D1_ORACLE_RELABELED_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze([]) },
  { classification: 'G2_CONTRACT_GAP', repeatedCrossRootReopening: false, findingId: 'finding:g2-gap', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze([]) },
  { classification: 'G1_ROOT_TRUST_CHANGE', repeatedCrossRootReopening: false, findingId: 'finding:g1-trust', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze([]) },
  { classification: 'NON_PRODUCT_BLOCKER', repeatedCrossRootReopening: false, findingId: 'finding:non-product', stableRootFamilyKeys: Object.freeze([D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY]), reopeningAttemptIds: Object.freeze([]) }
].map((item) => Object.freeze({
  source: 'CURRENT_CANONICAL_G3_FINDING_CLASSIFICATION_READBACK',
  authoritative: true, current: true, readBack: true,
  repository: 'weijunswj/ai-agent-toolkit', programmeId: '421', deliveryChildId: '461',
  runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
  lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
  rootLedgerRevision: 'root-ledger:revision-9',
  ...item, digest: s1aHashRecord({
    source: 'CURRENT_CANONICAL_G3_FINDING_CLASSIFICATION_READBACK',
    authoritative: true, current: true, readBack: true,
    repository: 'weijunswj/ai-agent-toolkit', programmeId: '421', deliveryChildId: '461',
    runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
    lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
    rootLedgerRevision: 'root-ledger:revision-9', ...item
  })
})))
function evaluateD1RootClassification(classification, classificationReadback) {
  const readbackValid = D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.some((expected) =>
    s1aSame(classificationReadback, expected) && classificationReadback.classification === classification &&
    d1ExactCurrentReadback(classificationReadback, expected));
  if (!readbackValid) return { disposition: 'HOLD_MISSING_CURRENT_CLASSIFICATION_READBACK', createsBudget: false };
  const routes = {
    EXISTING_ROOT: 'CONTINUE_EXISTING_ROOT_ACCOUNTING',
    NEW_ROOT_DISCOVERED: 'OPEN_ONLY_AFTER_UNTOUCHED_ROOT_AUDIT',
    CROSS_ROOT_INTERACTION: classificationReadback.repeatedCrossRootReopening ? 'RETURN_TO_WEB' : 'CONTINUE_EXISTING_ROOT_ACCOUNTING',
    G2_CONTRACT_GAP: 'TARGETED_G2_REENTRY',
    G1_ROOT_TRUST_CHANGE: 'G1_RECONVERGENCE',
    NON_PRODUCT_BLOCKER: 'NON_PRODUCT_HOLD'
  };
  if (!Object.hasOwn(routes, classification)) return { disposition: 'HOLD_UNKNOWN_CLASSIFICATION', createsBudget: false };
  return { disposition: routes[classification], createsBudget: false };
}function d1AttemptIdList(values) {
  return Array.isArray(values) && values.every(s1aPresent) && new Set(values).size === values.length;
}
function d1RootProgressReadback(rootFamilyKey, attemptNumber) {
  const core = { source: 'CURRENT_G3_ROOT_PROGRESS_READBACK', authoritative: true, current: true,
    readBack: true, rootFamilyKey, attemptNumber, narrowingOrProgress: true };
  return { ...core, digest: s1aHashRecord(core) };
}
function d1ProgressReadbackValid(event, rootFamilyKey, nextNumber, rootLedgerReadback) {
  if (nextNumber <= 3) return true;
  const progress = event.narrowingProgressReadback || {};
  const familyReadbacks = (rootLedgerReadback.narrowingProgressReadbacksByFamily || {})[rootFamilyKey] || {};
  const trusted = familyReadbacks[nextNumber] || {};
  return (rootLedgerReadback.narrowingProgressByFamily || {})[rootFamilyKey] === true &&
    d1ExactCurrentReadback(progress, trusted) && progress.source === 'CURRENT_G3_ROOT_PROGRESS_READBACK' &&
    progress.authoritative === true && progress.current === true && progress.readBack === true &&
    progress.rootFamilyKey === rootFamilyKey && progress.attemptNumber === nextNumber &&
    progress.narrowingOrProgress === true;
}
const D1_ORACLE_EXCEPTIONAL_ROOT_AUTHORITY_SCOPE = Object.freeze([
  'repo/CONTROLLER.md', 'repo/ARCHITECTURE.md',
  'repo/docs/PROGRAMME-DISCOVERY-BASELINE.md', 'repo/tests/controller-policy-separation.test.cjs'
]);
const D1_ORACLE_WDC_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_WEB_DIRECTED_CONTINUATION_READBACK', authoritative: true, current: true, readBack: true,
  authorityId: '#461:5891401359', repository: 'weijunswj/ai-agent-toolkit', programmeId: '421', deliveryChildId: '461',
  runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
  lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
  rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, attemptId: 'WDC-1',
  scope: D1_ORACLE_EXCEPTIONAL_ROOT_AUTHORITY_SCOPE, operation: 'WEB_DIRECTED_CONTINUATION'
});
const D1_ORACLE_WDC_AUTHORITY = Object.freeze({
  ...D1_ORACLE_WDC_AUTHORITY_CORE, digest: s1aHashRecord(D1_ORACLE_WDC_AUTHORITY_CORE)
});
const D1_ORACLE_RECONVERGED_AUTHORITY_CORE = Object.freeze({
  source: 'CURRENT_RECONVERGED_CORRECTION_AUTHORITY_READBACK', authoritative: true, current: true, readBack: true,
  authorityId: 'reconverged-authority:461-1', repository: 'weijunswj/ai-agent-toolkit', programmeId: '421',
  deliveryChildId: '461', runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
  lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
  rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, attemptId: 'RC-1',
  scope: D1_ORACLE_EXCEPTIONAL_ROOT_AUTHORITY_SCOPE, operation: 'RECONVERGED_CORRECTION'
});
const D1_ORACLE_RECONVERGED_AUTHORITY = Object.freeze({
  ...D1_ORACLE_RECONVERGED_AUTHORITY_CORE, digest: s1aHashRecord(D1_ORACLE_RECONVERGED_AUTHORITY_CORE)
});
const D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_G3_CANDIDATE_READBACK', authoritative: true, current: true, readBack: true,
  repository: 'weijunswj/ai-agent-toolkit', programmeId: '421', deliveryChildId: '461',
  runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
  lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
  rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, candidateId: 'candidate:d1-validation-1',
  commit: 'candidate:commit-1', tree: 'candidate:tree-1', parentCommit: 'candidate:parent-1',
  byteDigest: 'sha256:d1-candidate-byte-content-1'
});
const D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK = Object.freeze({
  ...D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK_CORE,
  digest: s1aHashRecord(D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK_CORE)
});
const D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS = Object.freeze([
  {
    source: 'CURRENT_CANONICAL_G3_ATTEMPT_CLASSIFICATION_READBACK', authoritative: true, current: true, readBack: true,
    repository: 'weijunswj/ai-agent-toolkit', programmeId: '421', deliveryChildId: '461',
    runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
    lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
    rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, attemptId: 'HOLD-1',
    eventKind: 'NON_PRODUCT_HOLD_RECOVERY', classification: 'NON_PRODUCT_BLOCKER',
    primaryOwner: 'TOOLKIT', productSemanticsProvenBad: 'NO', candidateBytesChanged: false,
    byteComparison: 'UNCHANGED', candidateByteDigest: 'sha256:d1-candidate-byte-content-1',
    priorCandidateByteDigest: 'sha256:d1-candidate-byte-content-1', effectReconciled: true,
    candidateReadbackDigest: D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK.digest
  },
  {
    source: 'CURRENT_CANONICAL_G3_ATTEMPT_CLASSIFICATION_READBACK', authoritative: true, current: true, readBack: true,
    repository: 'weijunswj/ai-agent-toolkit', programmeId: '421', deliveryChildId: '461',
    runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
    lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
    rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, attemptId: 'REVIEW-1',
    eventKind: 'UNCHANGED_BYTE_REVIEWER_SUPPLEMENTATION', classification: 'EVIDENCE_ONLY',
    primaryOwner: 'TOOLKIT', productSemanticsProvenBad: 'NO', candidateBytesChanged: false,
    byteComparison: 'UNCHANGED', candidateByteDigest: 'sha256:d1-candidate-byte-content-1',
    priorCandidateByteDigest: 'sha256:d1-candidate-byte-content-1', effectReconciled: true,
    candidateReadbackDigest: D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK.digest
  }
].map((core) => Object.freeze({ ...core, digest: s1aHashRecord(core) })))
function evaluateD1AttemptEvent(event, history = {}) {
  const ledgerReadback = history.rootLedgerReadback;
  if (!ledgerReadback || !Array.isArray(ledgerReadback.currentRecords)) {
    return { hold: true, productAttempt: false, reason: 'CURRENT_ROOT_LEDGER_READBACK_REQUIRED' };
  }
  const ledger = evaluateD1RootLedger(ledgerReadback.currentRecords, { rootLedgerReadback: ledgerReadback });
  if (!ledger.ok) return { hold: true, productAttempt: false, reason: 'CURRENT_ROOT_LEDGER_INVALID', failures: ledger.failures };
  const attemptHistory = ledgerReadback.attemptHistory;
  const ordinary = [...attemptHistory.ordinaryAttemptIds];
  const wdc = [...attemptHistory.wdcAttemptIds];
  const reconverged = [...attemptHistory.reconvergedAttemptIds];
  const allIds = new Set([...ordinary, ...wdc, ...reconverged]);
  const rootFamilyKey = event && (event.rootFamilyKey || history.rootFamilyKey);
  const familyRecords = ledgerReadback.currentRecords.filter((record) => d1StableRootFamilyKey(record) === rootFamilyKey);
  if (!event || !s1aPresent(event.attemptId) || !s1aPresent(rootFamilyKey) || familyRecords.length === 0) {
    return { hold: true, productAttempt: false, reason: 'ATTEMPT_EVENT_OR_ROOT_MISSING' };
  }
  if (allIds.has(event.attemptId)) {
    return { hold: true, productAttempt: false, reason: 'ATTEMPT_ID_MISSING_OR_REPLAYED' };
  }
  const rootAttemptIds = new Set([
    ...familyRecords.flatMap((record) => record.ATTEMPT_IDS),
    ...(ledgerReadback.priorAttemptAttributionByFamily[rootFamilyKey] || [])
  ]);
  if (event.kind === 'NON_PRODUCT_HOLD_RECOVERY' || event.kind === 'UNCHANGED_BYTE_REVIEWER_SUPPLEMENTATION') {
    const expected = D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS.find((readback) =>
      readback.eventKind === event.kind && readback.attemptId === event.attemptId);
    if (!expected || !d1ExactCurrentReadback(event.candidateReadback, D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK) ||
        !d1ExactCurrentReadback(event.attemptClassificationReadback, expected) ||
        expected.rootFamilyKey !== rootFamilyKey ||
        event.attemptClassificationReadback.candidateReadbackDigest !== event.candidateReadback.digest ||
        event.attemptClassificationReadback.byteComparison !== 'UNCHANGED' ||
        event.attemptClassificationReadback.candidateBytesChanged !== false ||
        event.attemptClassificationReadback.candidateByteDigest !== event.candidateReadback.byteDigest ||
        event.attemptClassificationReadback.priorCandidateByteDigest !== event.candidateReadback.byteDigest) {
      return { hold: true, productAttempt: false, reason: 'NON_PRODUCT_CURRENT_CANDIDATE_AND_CLASSIFICATION_READBACK_REQUIRED' };
    }
    return { productAttempt: false, ordinaryAttemptIds: ordinary, wdcAttemptIds: wdc,
      reconvergedAttemptIds: reconverged, totalHistoricalAttempts: allIds.size };
  }
  if (event.kind === 'WDC') {
    const authority = event.authorityReadback;
    if (!d1ExactCurrentReadback(authority, D1_ORACLE_WDC_AUTHORITY) ||
        authority.attemptId !== event.attemptId || authority.rootFamilyKey !== rootFamilyKey ||
        authority.repository !== ledgerReadback.repository || authority.runId !== ledgerReadback.runId ||
        authority.lockId !== ledgerReadback.lockId) {
      return { hold: true, productAttempt: false, reason: 'WDC_CURRENT_AUTHORITY_READBACK_REQUIRED' };
    }
    wdc.push(event.attemptId);
    return { productAttempt: true, ordinaryBudgetReset: false, ordinaryAttemptIds: ordinary,
      wdcAttemptIds: wdc, reconvergedAttemptIds: reconverged,
      totalHistoricalAttempts: new Set([...ordinary, ...wdc, ...reconverged]).size };
  }
  if (event.kind === 'RECONVERGED_CORRECTION') {
    const authority = event.authorityReadback;
    if (!d1ExactCurrentReadback(authority, D1_ORACLE_RECONVERGED_AUTHORITY) ||
        authority.attemptId !== event.attemptId || authority.rootFamilyKey !== rootFamilyKey ||
        authority.repository !== ledgerReadback.repository || authority.runId !== ledgerReadback.runId ||
        authority.lockId !== ledgerReadback.lockId) {
      return { hold: true, productAttempt: false, reason: 'RECONVERGED_CURRENT_AUTHORITY_READBACK_REQUIRED' };
    }
    reconverged.push(event.attemptId);
    return { productAttempt: true, ordinaryBudgetReset: false, ordinaryAttemptIds: ordinary,
      wdcAttemptIds: wdc, reconvergedAttemptIds: reconverged,
      totalHistoricalAttempts: new Set([...ordinary, ...wdc, ...reconverged]).size };
  }
  if (event.kind !== 'G3_PRODUCT_CORRECTION') return { hold: true, productAttempt: false, reason: 'UNKNOWN_ATTEMPT_EVENT_KIND' };
  const classificationReadback = event.classificationReadback;
  const classificationResult = evaluateD1RootClassification(
    classificationReadback && classificationReadback.classification, classificationReadback);
  const currentStableRootFamilies = [...new Set(ledgerReadback.currentRecords.map(d1StableRootFamilyKey))].sort();
  if (!s1aPresent(event.findingId) || !classificationReadback ||
      classificationReadback.findingId !== event.findingId ||
      classificationReadback.rootLedgerRevision !== ledgerReadback.revision ||
      !Array.isArray(classificationReadback.stableRootFamilyKeys) ||
      !s1aSame([...classificationReadback.stableRootFamilyKeys].sort(), currentStableRootFamilies) ||
      !currentStableRootFamilies.includes(rootFamilyKey)) {
    return { hold: true, productAttempt: false, reason: 'CURRENT_ROOT_CLASSIFICATION_REQUIRED' };
  }
  if (!['CONTINUE_EXISTING_ROOT_ACCOUNTING', 'OPEN_ONLY_AFTER_UNTOUCHED_ROOT_AUDIT'].includes(classificationResult.disposition)) {
    return { hold: true, productAttempt: false, reason: 'ROOT_CLASSIFICATION_REQUIRES_REENTRY', disposition: classificationResult.disposition };
  }
  if (classificationResult.disposition === 'OPEN_ONLY_AFTER_UNTOUCHED_ROOT_AUDIT' &&
      !familyRecords.some((record) => record.NEW_ROOT_DISCOVERED === true)) {
    return { hold: true, productAttempt: false, reason: 'NEW_ROOT_CLASSIFICATION_MISSING_ROOT_AUDIT_STATE' };
  }
  if (!familyRecords.some((record) => record.STATE === 'OPEN')) {
    return { hold: true, productAttempt: false, reason: 'PRODUCT_CORRECTION_ROOT_NOT_OPEN' };
  }
  const ordinaryForRoot = ordinary.filter((attemptId) => rootAttemptIds.has(attemptId));
  const nextAttempt = ordinaryForRoot.length + 1;
  if (!evaluateD1NextRootAttempt(nextAttempt, ledgerReadback.narrowingProgressByFamily[rootFamilyKey] === true) ||
      !d1ProgressReadbackValid(event, rootFamilyKey, nextAttempt, ledgerReadback)) {
    return { hold: true, productAttempt: false, reason: 'ROOT_ATTEMPT_BUDGET_OR_PROGRESS' };
  }
  ordinary.push(event.attemptId);
  return { productAttempt: true, ordinaryBudgetReset: false, ordinaryAttemptIds: ordinary,
    wdcAttemptIds: wdc, reconvergedAttemptIds: reconverged,
    totalHistoricalAttempts: new Set([...ordinary, ...wdc, ...reconverged]).size };
}const D1_ORACLE_MERGE_EVENT = Object.freeze({
  event: 'merge_group', branch: 'main', eventIdentity: 'event:merge-8', triggerId: 'delivery:merge-8',
  headSha: S1A_ORACLE_INTEGRATED_IDENTITY.commit
});
function d1IsFirstPartyCheck(check) {
  return check.producerAuthority === 'FIRST_PARTY';
}const D1_CHECK_IDENTITY_FIELDS = Object.freeze([
  'producerId', 'workflowId', 'workflowRevision', 'checkId', 'matrixLeg', 'eventIdentity', 'triggerId', 'headSha'
]);
function d1CheckIdentity(check) {
  if (!check || typeof check !== 'object' || D1_CHECK_IDENTITY_FIELDS.some((field) => !s1aPresent(check[field]))) return null;
  return JSON.stringify(D1_CHECK_IDENTITY_FIELDS.map((field) => check[field]));
}
function d1CheckPathApplies(patterns, changedPaths) {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => pattern === '*' ||
    (pattern.endsWith('/**') && changedPaths.some((file) => file.startsWith(pattern.slice(0, -2)))) ||
    changedPaths.includes(pattern));
}
const D1_ORACLE_TRUSTED_CHECK_MEMBERSHIP_INPUTS = new WeakMap();
function d1CurrentAuthorityReadback(readback, trustedCore, source, coreFields) {
  const core = { ...readback };
  delete core.digest;
  return s1aHasExactKeys(readback, [...coreFields, 'digest']) &&
    s1aSame(core, trustedCore) && readback.source === source && readback.authoritative === true &&
    readback.current === true && readback.readBack === true && readback.digest === s1aHashRecord(core);
}
function d1CheckAuthorityCore(configuration, revision, eventContext, childRequiredChecks,
  childInventoryCheckIds, checkInventoryIds, reviewSnapshotCheckIds) {
  return {
    source: 'CURRENT_CANONICAL_CHECK_CONFIGURATION_READBACK', authoritative: true, current: true,
    readBack: true, complete: true, configurationRevision: revision,
    integratedCommit: S1A_ORACLE_INTEGRATED_IDENTITY.commit,
    configuration: s1aClone(configuration), eventContext: s1aClone(eventContext),
    childRequiredChecks: s1aClone(childRequiredChecks), childInventoryCheckIds: s1aClone(childInventoryCheckIds),
    checkInventoryIds: s1aClone(checkInventoryIds), reviewSnapshotCheckIds: s1aClone(reviewSnapshotCheckIds)
  };
}
function d1LatestRunAuthorityCore(results, revision, eventContext) {
  return {
    source: 'CURRENT_CANONICAL_LATEST_RUN_READBACK', authoritative: true, current: true,
    readBack: true, complete: true, configurationRevision: revision,
    eventContext: s1aClone(eventContext), results: s1aClone(results)
  };
}
function evaluateD1MergeCheckMembership(input) {
  const failures = [];
  const trustedFixture = D1_ORACLE_TRUSTED_CHECK_MEMBERSHIP_INPUTS.get(input);
  if (!trustedFixture) failures.push('CHECK_MEMBERSHIP_NO_INDEPENDENT_SOURCE_FIXTURE');
  const configurationFields = ['source', 'authoritative', 'current', 'readBack', 'complete', 'configurationRevision',
    'integratedCommit', 'configuration', 'eventContext', 'childRequiredChecks', 'childInventoryCheckIds', 'checkInventoryIds',
    'reviewSnapshotCheckIds'];
  const runFields = ['source', 'authoritative', 'current', 'readBack', 'complete', 'configurationRevision',
    'eventContext', 'results'];
  if (input.configurationComplete !== true || input.membershipFreezePoint !== 'BEFORE_RESULT_ADJUDICATION' ||
      input.configurationRevision !== input.frozenConfigurationRevision ||
      (input.configurationChangesAfterFreeze || []).length > 0) {
    failures.push('CHECK_MEMBERSHIP_CONFIGURATION_NOT_FROZEN');
  }
  if (input.ambiguousMatrixExpansion === true) failures.push('AMBIGUOUS_DYNAMIC_MATRIX_EXPANSION');
  if (!Array.isArray(input.configuration) || !Array.isArray(input.childRequiredChecks) ||
      !Array.isArray(input.results) || !Array.isArray(input.childInventoryCheckIds) ||
      !Array.isArray(input.checkInventoryIds) || !Array.isArray(input.reviewSnapshotCheckIds)) {
    failures.push('CHECK_MEMBERSHIP_INPUT_INCOMPLETE');
  }
  const event = input.eventContext || {};
  if (!s1aPresent(event.event) || !s1aPresent(event.branch) || !Array.isArray(event.changedPaths) ||
      !s1aPresent(event.eventIdentity) || !s1aPresent(event.triggerId) || !s1aPresent(event.headSha) ||
      event.event !== D1_ORACLE_MERGE_EVENT.event || event.branch !== D1_ORACLE_MERGE_EVENT.branch ||
      event.eventIdentity !== D1_ORACLE_MERGE_EVENT.eventIdentity ||
      event.triggerId !== D1_ORACLE_MERGE_EVENT.triggerId ||
      event.headSha !== D1_ORACLE_MERGE_EVENT.headSha) {
    failures.push('CHECK_MEMBERSHIP_EVENT_IDENTITY_INCOMPLETE');
  }
  const configurationCore = input.configurationReadback || {};
  const trustedConfiguration = trustedFixture ? trustedFixture.configuration : {};
  if (!d1CurrentAuthorityReadback(configurationCore, trustedConfiguration,
      'CURRENT_CANONICAL_CHECK_CONFIGURATION_READBACK', configurationFields) ||
      !s1aSame(configurationCore.configuration, input.configuration) ||
      configurationCore.configurationRevision !== input.configurationRevision ||
      configurationCore.integratedCommit !== D1_ORACLE_MERGE_EVENT.headSha ||
      !s1aSame(configurationCore.eventContext, input.eventContext) ||
      !s1aSame(configurationCore.childRequiredChecks, input.childRequiredChecks) ||
      !s1aSame(configurationCore.childInventoryCheckIds, input.childInventoryCheckIds) ||
      !s1aSame(configurationCore.checkInventoryIds, input.checkInventoryIds) ||
      !s1aSame(configurationCore.reviewSnapshotCheckIds, input.reviewSnapshotCheckIds)) {
    failures.push('CHECK_CONFIGURATION_AUTHORITATIVE_READBACK');
  }
  const latestReadback = input.latestRunReadback || {};
  const trustedLatest = trustedFixture ? trustedFixture.latestRuns : {};
  if (!d1CurrentAuthorityReadback(latestReadback, trustedLatest,
      'CURRENT_CANONICAL_LATEST_RUN_READBACK', runFields) ||
      !s1aSame(latestReadback.results, input.results) ||
      latestReadback.configurationRevision !== input.configurationRevision ||
      !s1aSame(latestReadback.eventContext, input.eventContext)) {
    failures.push('CHECK_LATEST_RUN_AUTHORITATIVE_READBACK');
  }
  if (failures.length > 0) return { status: 'HOLD', failures, expected: [] };
  const configuration = input.configuration;
  if (configuration.some((check) => d1CheckIdentity(check) === null)) {
    failures.push('CHECK_CONFIGURATION_IDENTITY_INCOMPLETE');
  }
  if (configuration.some((check) => !['FIRST_PARTY', 'EXTERNAL'].includes(check.producerAuthority))) {
    failures.push('CHECK_PRODUCER_AUTHORITY_CLASSIFICATION_INCOMPLETE');
  }
  for (const requiredId of input.childRequiredChecks) {
    if (!configuration.some((check) => check.requirementId === requiredId)) {
      failures.push('CHILD_REQUIRED_CHECK_HAS_NO_CONFIGURATION:' + requiredId);
    }
  }
  const expectedChecks = configuration.filter((check) => {
    if (check.phase === 'PREMERGE_ONLY') return false;
    if (check.phase !== 'MERGE_TRIGGERED') {
      failures.push('UNKNOWN_CHECK_PHASE:' + check.checkId);
      return false;
    }
    const childRequired = input.childRequiredChecks.includes(check.requirementId);
    const requiredByConfiguration = check.requiredAtMerge === true || childRequired;
    const isRequired = requiredByConfiguration || d1IsFirstPartyCheck(check);
    if (requiredByConfiguration && check.enabled !== true) {
      failures.push('REQUIRED_MERGE_CHECK_DISABLED:' + check.checkId);
      return false;
    }
    const eventApplies = Array.isArray(check.events) && check.events.includes(event.event);
    const branchApplies = !check.branches || check.branches.includes(event.branch);
    const pathApplies = d1CheckPathApplies(check.pathConditions, event.changedPaths);
    if (check.enabled !== true || !isRequired || !eventApplies || !branchApplies || !pathApplies) return false;
    const exactEventIdentity = check.eventIdentity === event.eventIdentity &&
      check.triggerId === event.triggerId && check.headSha === event.headSha;
    if (!exactEventIdentity) {
      failures.push('CHECK_CONFIGURATION_EVENT_IDENTITY_MISMATCH:' + check.checkId);
      return false;
    }
    return true;
  });
  const expectedKeys = expectedChecks.map(d1CheckIdentity).sort();
  const expectedIds = expectedChecks.map((check) => check.checkId).sort();
  if (expectedKeys.includes(null) || new Set(expectedKeys).size !== expectedKeys.length) failures.push('DUPLICATE_OR_INCOMPLETE_EXPECTED_CHECK_IDENTITY');
  if (input.claimedExpectedMembership &&
      JSON.stringify([...input.claimedExpectedMembership].sort()) !== JSON.stringify(expectedKeys)) {
    failures.push('CLAIMED_MEMBERSHIP_DIFFERS_FROM_CONFIGURATION');
  }
  const latestRunIds = input.latestRunReadback.results.map((result) => result.checkId).sort();
  if (input.latestRunReadback.results.some((result) => !s1aPresent(result.runId))) {
    failures.push('CHECK_LATEST_RUN_ID_MISSING');
  }
  if (new Set(latestRunIds).size !== latestRunIds.length ||
      !s1aSame(expectedIds, input.childInventoryCheckIds.slice().sort()) ||
      !s1aSame(expectedIds, input.checkInventoryIds.slice().sort()) ||
      !s1aSame(expectedIds, latestRunIds) ||
      !s1aSame(expectedIds, input.reviewSnapshotCheckIds.slice().sort())) {
    failures.push('EXPECTED_MEMBERSHIP_DIFFERS_FROM_CANONICAL_INVENTORIES');
  }
  if (failures.length > 0) return { status: 'HOLD', failures, expected: expectedChecks };
  const blockers = [];
  const missing = [];
  for (const check of expectedChecks) {
    const identity = d1CheckIdentity(check);
    const matches = input.latestRunReadback.results.filter((result) => d1CheckIdentity(result) === identity);
    if (matches.length === 0) {
      missing.push('MISSING_EXPECTED_CHECK:' + check.checkId);
      continue;
    }
    if (matches.length !== 1) {
      failures.push('AMBIGUOUS_TERMINAL_CHECK_READBACK:' + check.checkId);
      continue;
    }
    const result = matches[0];
    if (!s1aPresent(result.runId) || result.terminalReadback !== true || result.terminal !== true ||
        result.conclusion !== 'SUCCESS') {
      blockers.push('APPLICABLE_CHECK_NOT_TERMINAL_GREEN:' + check.checkId);
    }
  }
  if (failures.length > 0) return { status: 'HOLD', failures, expected: expectedChecks };
  if (missing.length > 0) return { status: 'HOLD', failures: missing, expected: expectedChecks };
  if (blockers.length > 0) return { status: 'BLOCKED', failures: blockers, expected: expectedChecks };
  return { status: 'GREEN', failures: [], expected: expectedChecks };
}
function makeD1CheckMembership(options = {}) {
  const eventIdentity = options.eventIdentity || D1_ORACLE_MERGE_EVENT.eventIdentity;
  const triggerId = options.triggerId || D1_ORACLE_MERGE_EVENT.triggerId;
  const headSha = options.headSha || D1_ORACLE_MERGE_EVENT.headSha;
  const eventContext = { event: D1_ORACLE_MERGE_EVENT.event, branch: D1_ORACLE_MERGE_EVENT.branch,
    changedPaths: options.changedPaths || ['repo/CONTROLLER.md'], eventIdentity, triggerId, headSha };
  const shared = {
    workflowRevision: 'workflow-revision-3', matrixLeg: 'linux-x64',
    events: ['merge_group'], branches: ['main'], pathConditions: ['repo/**'],
    phase: 'MERGE_TRIGGERED', enabled: true, requiredAtMerge: true,
    producerAuthority: 'FIRST_PARTY', eventIdentity, triggerId, headSha
  };
  const configuration = options.emptyMembership ? [] : [
    { ...shared, producerId: 'actions/validator', workflowId: '.github/workflows/validate.yml',
      requirementId: 'integration', checkId: 'check:integration', displayName: 'Validate' },
    { ...shared, producerId: 'toolkit/policy', workflowId: '.github/workflows/policy.yml',
      requirementId: 'policy', checkId: 'check:policy', displayName: 'Validate' }
  ];
  if (options.includePremergeCodeql) configuration.push({
    ...shared, producerId: 'actions/codeql', workflowId: '.github/workflows/codeql.yml',
    workflowRevision: 'workflow-revision-2', requirementId: 'codeql', checkId: 'check:codeql',
    displayName: 'CodeQL', events: ['pull_request'], phase: 'PREMERGE_ONLY'
  });
  if (options.includeOptionalFirstPartyCheck) configuration.push({
    ...shared, producerId: 'actions/optional-first-party', workflowId: '.github/workflows/optional.yml',
    requirementId: 'optional-first-party', checkId: 'check:optional-first-party',
    displayName: 'Optional first-party', requiredAtMerge: false
  });
  if (options.includeNewFirstPartyCheck) configuration.push({
    ...shared, producerId: 'actions/new-first-party', workflowId: '.github/workflows/new-first-party.yml',
    requirementId: 'new-first-party', checkId: 'check:new-first-party',
    displayName: 'New first-party', requiredAtMerge: false
  });
  const staleEventCheck = configuration.find((check) => check.checkId === options.staleEventIdentityCheckId);
  if (staleEventCheck) staleEventCheck.eventIdentity = options.staleEventIdentity || 'event:previous-merge';
  const disabledCheck = configuration.find((check) => check.checkId === options.disabledCheckId);
  if (disabledCheck) disabledCheck.enabled = false;
  const nonApplicableEventCheck = configuration.find((check) => check.checkId === options.nonApplicableEventCheckId);
  if (nonApplicableEventCheck) nonApplicableEventCheck.events = ['pull_request'];
  const inventoryConfiguration = configuration.filter((check) => check.checkId !== options.omitCheckIdFromInventories);
  const results = inventoryConfiguration.filter((check) => check.phase === 'MERGE_TRIGGERED').map((check) => ({
    ...check, runId: 'run:merge:' + check.checkId,
    terminalReadback: true, terminal: true, conclusion: 'SUCCESS'
  }));
  if (options.omitCheckId) {
    const index = results.findIndex((result) => result.checkId === options.omitCheckId);
    if (index >= 0) results.splice(index, 1);
  }
  if (options.resultConclusion) results[0].conclusion = options.resultConclusion;
  if (options.resultTerminal === false) results[0].terminal = false;
  if (options.markNotApplicable === true) results[0].notApplicable = true;
  const required = options.childRequiredChecks || (options.emptyMembership ? [] : ['integration', 'policy']);
  const canonicalIds = inventoryConfiguration.filter((check) => check.phase === 'MERGE_TRIGGERED')
    .map((check) => check.checkId).sort();
  const revision = options.configurationRevision || 'configuration:9';
  const configurationCore = d1CheckAuthorityCore(configuration, revision, eventContext, required,
    canonicalIds, canonicalIds, canonicalIds);
  const latestCore = d1LatestRunAuthorityCore(results, revision, eventContext);
  const fixture = {
    configurationComplete: true, configurationRevision: revision,
    frozenConfigurationRevision: options.frozenConfigurationRevision || revision,
    configurationChangesAfterFreeze: options.configurationChangesAfterFreeze || [],
    membershipFreezePoint: 'BEFORE_RESULT_ADJUDICATION',
    ambiguousMatrixExpansion: options.ambiguousMatrixExpansion === true,
    configuration, childRequiredChecks: required, eventContext, results,
    childInventoryCheckIds: canonicalIds, checkInventoryIds: canonicalIds, reviewSnapshotCheckIds: canonicalIds,
    configurationReadback: { ...configurationCore, digest: s1aHashRecord(configurationCore) },
    trustedConfigurationSnapshot: s1aClone(configurationCore),
    latestRunReadback: { ...latestCore, digest: s1aHashRecord(latestCore) },
    trustedLatestRunSnapshot: s1aClone(latestCore)
  };
  D1_ORACLE_TRUSTED_CHECK_MEMBERSHIP_INPUTS.set(fixture, Object.freeze({
    configuration: s1aClone(configurationCore), latestRuns: s1aClone(latestCore)
  }));
  return fixture;
}
function makeD1FinalityDependencyReadback(input, overrides = {}) {
  const core = {
    source: 'CURRENT_PARENT_CHILD_FRONTIER_READBACK', authoritative: true, current: true, readBack: true,
    programmeId: '421', runId: 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001',
    lockId: 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001',
    repository: S1A_ORACLE_INTEGRATED_IDENTITY.repository,
    deliveryChildId: S1A_ORACLE_INTEGRATED_IDENTITY.deliveryChildId,
    integratedCommit: S1A_ORACLE_INTEGRATED_IDENTITY.commit,
    integratedTree: S1A_ORACLE_INTEGRATED_IDENTITY.tree,
    parentRevision: input.parentContract.revision, childRevision: input.childState.revision,
    checkpointKind: input.checkpointKind,
    mergeReceiptId: input.checkpointKind === 'FINAL_DELIVERY_CHILD_MERGE' ? 'receipt:merge' : null,
    childTerminalCoherent: true, parentCurrent: true, frontierCurrent: true, dependenciesCurrent: true,
    unresolvedMaterialDependentFinding: false, finalDeliveryChild: false, explicitDualRequirement: false,
    ...overrides
  };
  return { ...core, digest: s1aHashRecord(core) };
}
const D1_ORACLE_TRUSTED_POST_CHILD_INPUTS = new WeakMap();
function validateD1FinalityDependencyReadback(input) {
  const readback = input.finalityDependencyReadback || {};
  const fields = [
    'source', 'authoritative', 'current', 'readBack', 'repository', 'programmeId', 'deliveryChildId',
    'runId', 'lockId', 'integratedCommit', 'integratedTree', 'parentRevision', 'childRevision',
    'checkpointKind', 'mergeReceiptId', 'childTerminalCoherent', 'parentCurrent', 'frontierCurrent',
    'dependenciesCurrent', 'unresolvedMaterialDependentFinding', 'finalDeliveryChild', 'explicitDualRequirement', 'digest'
  ];
  const trustedFixture = D1_ORACLE_TRUSTED_POST_CHILD_INPUTS.get(input);
  if (!trustedFixture) return false;
  const trusted = trustedFixture.finalityDependencySnapshot;
  const finalMergeEvent = d1ExactCurrentReadback(input.mergeEventReadback, D1_ORACLE_FINAL_CHILD_MERGE_EVENT_READBACK);
  const supportingEvent = d1ExactCurrentReadback(input.mergeEventReadback, D1_ORACLE_SUPPORTING_PR_EVENT_READBACK);
  const knownFinalityState = D1_ORACLE_FINALITY_READBACKS.some((expected) => s1aSame(readback, expected));
  const canonicalChildState = S1A_ORACLE_POST_CHILD_STATES.some((expected) => s1aSame(input.childState, expected)) ||
    s1aSame(input.childState, D1_ORACLE_EMPTY_CHILD_STATE);
  const currentFinality = d1CurrentAuthorityReadback(readback, trusted,
    'CURRENT_PARENT_CHILD_FRONTIER_READBACK', fields.slice(0, -1));
  if (!currentFinality || !knownFinalityState || !canonicalChildState ||
      !s1aHasExactKeys(readback, fields) || readback.repository !== input.identity.repository ||
      readback.deliveryChildId !== input.identity.deliveryChildId || readback.runId !== 'D1_G3_GOVERNANCE_FOUNDATION_INCREMENT_1_001' ||
      readback.lockId !== 'DL-D1-G3-GOVERNANCE-FOUNDATION-INCREMENT-1-001' ||
      readback.programmeId !== '421' || readback.integratedCommit !== input.identity.commit ||
      readback.integratedTree !== input.identity.tree || readback.parentRevision !== input.parentContract.revision ||
      readback.childRevision !== input.childState.revision || input.checkpointKind !== readback.checkpointKind ||
      !['FINAL_DELIVERY_CHILD_MERGE', 'SUPPORTING_PR'].includes(readback.checkpointKind) ||
      typeof readback.unresolvedMaterialDependentFinding !== 'boolean' ||
      typeof readback.finalDeliveryChild !== 'boolean' || typeof readback.explicitDualRequirement !== 'boolean') {
    return false;
  }
  if (finalMergeEvent) {
    return readback.checkpointKind === 'FINAL_DELIVERY_CHILD_MERGE' &&
      readback.mergeReceiptId === input.mergeEventReadback.mergeReceiptId &&
      input.trigger === 'FINAL_DELIVERY_CHILD_MERGE' &&
      d1ExactCurrentReadback(input.integratedIdentityReadback, D1_ORACLE_FINAL_MERGED_IDENTITY_READBACK);
  }
  if (supportingEvent) {
    return readback.checkpointKind === 'SUPPORTING_PR' && readback.mergeReceiptId === null &&
      readback.finalDeliveryChild === false && input.trigger === 'SUPPORTING_PR' &&
      d1ExactCurrentReadback(input.integratedIdentityReadback, D1_ORACLE_SUPPORTING_PR_IDENTITY_READBACK);
  }
  return false;
}
function makeD1IntegrationPredicateReadback(input) {
  const core = {
    source: 'CURRENT_CANONICAL_INTEGRATION_PREDICATE_READBACK', authoritative: true, current: true, readBack: true,
    repository: input.identity.repository, deliveryChildId: input.identity.deliveryChildId,
    commit: input.identity.commit, tree: input.identity.tree,
    parentRevision: input.parentContract.revision, childRevision: input.childState.revision,
    assuredChildTree: input.assuredChildTree,
    unassuredConcurrentOrMultiChildComposition: input.unassuredConcurrentOrMultiChildComposition,
    conflictResolutionSemanticDelta: input.conflictResolutionSemanticDelta,
    materialRootTrustAuthorityIntegrationOutsideAssuredTree: input.materialRootTrustAuthorityIntegrationOutsideAssuredTree,
    materialIntegrationUncertainty: input.materialIntegrationUncertainty,
    dualSnapshotBindable: input.dualSnapshotBindable,
    reviewerAvailability: s1aClone(input.reviewerAvailability)
  };
  return { ...core, digest: s1aHashRecord(core) };
}
function validateD1IntegrationPredicateReadback(input) {
  const readback = input.integrationPredicateReadback || {};
  const fields = [
    'source', 'authoritative', 'current', 'readBack', 'repository', 'deliveryChildId', 'commit', 'tree',
    'parentRevision', 'childRevision', 'assuredChildTree', 'unassuredConcurrentOrMultiChildComposition',
    'conflictResolutionSemanticDelta', 'materialRootTrustAuthorityIntegrationOutsideAssuredTree',
    'materialIntegrationUncertainty', 'dualSnapshotBindable', 'reviewerAvailability', 'digest'
  ];
  const trustedFixture = D1_ORACLE_TRUSTED_POST_CHILD_INPUTS.get(input);
  if (!trustedFixture) return false;
  const trusted = trustedFixture.integrationPredicateSnapshot;
  const acceptedByCanonicalSource = D1_ORACLE_INTEGRATION_PREDICATE_READBACKS.some((expected) =>
    s1aSame(readback, expected));
  return acceptedByCanonicalSource && d1CurrentAuthorityReadback(readback, trusted,
    'CURRENT_CANONICAL_INTEGRATION_PREDICATE_READBACK', fields.slice(0, -1)) &&
    readback.repository === input.identity.repository && readback.deliveryChildId === input.identity.deliveryChildId &&
    readback.commit === input.identity.commit && readback.tree === input.identity.tree &&
    readback.parentRevision === input.parentContract.revision && readback.childRevision === input.childState.revision &&
    readback.assuredChildTree === input.assuredChildTree &&
    readback.unassuredConcurrentOrMultiChildComposition === input.unassuredConcurrentOrMultiChildComposition &&
    readback.conflictResolutionSemanticDelta === input.conflictResolutionSemanticDelta &&
    readback.materialRootTrustAuthorityIntegrationOutsideAssuredTree === input.materialRootTrustAuthorityIntegrationOutsideAssuredTree &&
    readback.materialIntegrationUncertainty === input.materialIntegrationUncertainty &&
    readback.dualSnapshotBindable === input.dualSnapshotBindable &&
    s1aSame(readback.reviewerAvailability, input.reviewerAvailability) &&
    ['unassuredConcurrentOrMultiChildComposition', 'conflictResolutionSemanticDelta',
      'materialRootTrustAuthorityIntegrationOutsideAssuredTree', 'materialIntegrationUncertainty', 'dualSnapshotBindable']
      .every((field) => typeof readback[field] === 'boolean') &&
    readback.reviewerAvailability && typeof readback.reviewerAvailability.A === 'boolean' &&
    typeof readback.reviewerAvailability.B === 'boolean';
}
function evaluateD1PostChildAssurance(policy, input) {
  if (!input || typeof input !== 'object' || !input.checkMembership || typeof input.checkMembership !== 'object') {
    return { outcome: 'HOLD', mode: null, failures: ['POST_CHILD_CHECK_MEMBERSHIP_READBACK_MISSING'] };
  }
  if (!validateD1FinalityDependencyReadback(input)) {
    return { outcome: 'HOLD', mode: null, failures: ['POST_CHILD_FINALITY_DEPENDENCY_READBACK'] };
  }
  if (!validateD1IntegrationPredicateReadback(input)) {
    return { outcome: 'HOLD', mode: null, failures: ['POST_CHILD_INTEGRATION_PREDICATE_READBACK'] };
  }
  const state = input.finalityDependencyReadback;
  if (input.mergeEventReadback.checkpointKind === 'SUPPORTING_PR') {
    return { outcome: 'NO_CHECKPOINT', mode: null, failures: [] };
  }
  if (input.mergeEventReadback.checkpointKind !== 'FINAL_DELIVERY_CHILD_MERGE') {
    return { outcome: 'HOLD', mode: null, failures: ['UNKNOWN_CHECKPOINT_KIND'] };
  }
  const membership = evaluateD1MergeCheckMembership(input.checkMembership);
  const expectedCheckIds = membership.expected.map((check) => check.checkId).sort();
  const childCheckIds = input.childState && input.childState.applicableIntegratedCheckIds;
  const inventoryItems = input.checkInventory && input.checkInventory.items;
  const reviewCheckIds = input.reviewSnapshot && input.reviewSnapshot.applicableIntegratedCheckIds;
  if (membership.status === 'GREEN' &&
      (!Array.isArray(childCheckIds) || !Array.isArray(inventoryItems) ||
       !inventoryItems.every((item) => item && s1aPresent(item.id)) || !Array.isArray(reviewCheckIds))) {
    return { outcome: 'HOLD', mode: null, failures: ['POST_CHILD_BOUND_MEMBERSHIP_INVENTORY_MISSING_OR_MALFORMED'], membership };
  }
  if (membership.status === 'GREEN' &&
      (!s1aSame(expectedCheckIds, childCheckIds.slice().sort()) ||
       !s1aSame(expectedCheckIds, inventoryItems.map((item) => item.id).sort()) ||
       !s1aSame(expectedCheckIds, reviewCheckIds.slice().sort()))) {
    return { outcome: 'HOLD', mode: null, failures: ['POST_CHILD_MEMBERSHIP_DIFFERS_FROM_BOUND_CHILD_INVENTORIES'], membership };
  }
  if (membership.status !== 'GREEN') {
    return { outcome: membership.status, mode: null, failures: membership.failures, membership };
  }
  const verifiedMembershipProof = Object.freeze({});
  D1_ORACLE_VERIFIED_POST_CHILD_MEMBERSHIP_PROOFS.set(verifiedMembershipProof, {
    status: membership.status, expectedCheckIds,
    identity: s1aClone(input.identity), childState: s1aClone(input.childState),
    checkInventory: s1aClone(input.checkInventory), checks: s1aClone(input.checks),
    reviewSnapshot: s1aClone(input.reviewSnapshot),
    checkMembershipInput: s1aClone(input.checkMembership),
    expectedIdentities: membership.expected.map(d1CheckIdentity).sort()
  });
  const shared = evaluateS1aPostChildReview(policy, {
    ...input, assuranceMode: 'RECONCILE_ONLY', d1CheckMembershipProof: verifiedMembershipProof
  });
  if (!shared.ok) return { outcome: 'HOLD', mode: null, failures: shared.failures };
  const predicate = input.integrationPredicateReadback;
  const treeDelta = input.identity.tree !== predicate.assuredChildTree || predicate.conflictResolutionSemanticDelta === true;
  const triggers = [];
  if (treeDelta) triggers.push('INTEGRATION_TREE_DELTA');
  if (predicate.unassuredConcurrentOrMultiChildComposition === true) triggers.push('CONCURRENT_OR_MULTI_CHILD_COMPOSITION');
  if (predicate.materialRootTrustAuthorityIntegrationOutsideAssuredTree === true) {
    triggers.push('MATERIAL_ROOT_TRUST_AUTHORITY_INTEGRATION_OUTSIDE_ASSURED_TREE');
  }
  if (predicate.materialIntegrationUncertainty === true || state.unresolvedMaterialDependentFinding === true) {
    triggers.push('UNRESOLVED_INTEGRATION_UNCERTAINTY');
  }
  if (state.explicitDualRequirement === true) triggers.push('EXPLICIT_OWNER_WEB_G4_REQUIREMENT');
  if (state.finalDeliveryChild === true) triggers.push('FINAL_DELIVERY_CHILD');
  const mode = triggers.length > 0 ? 'DUAL_MAX' : 'RECONCILE_ONLY';
  if (input.requestedMode && input.requestedMode !== mode) {
    return { outcome: 'HOLD', mode, failures: ['POST_CHILD_MODE_DOES_NOT_MATCH_CURRENT_PREDICATES'], triggers };
  }
  if (mode === 'RECONCILE_ONLY') return { outcome: 'PASS', mode, failures: [], triggers, membership };
  if (predicate.dualSnapshotBindable !== true) {
    return { outcome: 'HOLD', mode, failures: ['DUAL_MAX_SNAPSHOT_UNBINDABLE'], triggers };
  }
  if (predicate.reviewerAvailability.A !== true || predicate.reviewerAvailability.B !== true) {
    return { outcome: 'HOLD', mode, failures: ['DUAL_MAX_REVIEWER_UNAVAILABLE'], triggers };
  }
  const dual = evaluateS1aPostChildReview(policy, {
    ...input, assuranceMode: 'DUAL_MAX', d1CheckMembershipProof: verifiedMembershipProof
  });
  if (!dual.ok) return { outcome: 'HOLD', mode, failures: dual.failures, triggers };
  return { outcome: 'PASS', mode, failures: [], triggers, membership };
}
function makeD1PostChildScenario(overrides = {}) {
  const input = makeS1aReviewFixture();
  input.checkpointKind = 'FINAL_DELIVERY_CHILD_MERGE';
  input.assuredChildTree = S1A_ORACLE_INTEGRATED_IDENTITY.tree;
  input.unassuredConcurrentOrMultiChildComposition = false;
  input.conflictResolutionSemanticDelta = false;
  input.materialRootTrustAuthorityIntegrationOutsideAssuredTree = false;
  input.materialIntegrationUncertainty = false;
  input.mergeCheckMembershipComplete = true;
  input.allApplicableMergeChecksTerminalGreen = true;
  input.dualSnapshotBindable = true;
  input.reviewerAvailability = { A: true, B: true };
  input.checkMembership = makeD1CheckMembership();
  let finalityOverrides = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'finalityOverrides') {
      finalityOverrides = value;
    } else if (key === 'checkMembershipOptions') {
      input.checkMembership = makeD1CheckMembership(value);
    } else if (key === 'emptyMergeCheckMembership') {
      input.checkMembership = makeD1CheckMembership({ emptyMembership: true });
    } else {
      input[key] = value;
    }
  }
  if (input.checkpointKind === 'SUPPORTING_PR') {
    input.trigger = 'SUPPORTING_PR';
    input.mergeEventReadback = D1_ORACLE_SUPPORTING_PR_EVENT_READBACK;
    input.integratedIdentityReadback = D1_ORACLE_SUPPORTING_PR_IDENTITY_READBACK;
  } else {
    input.checkpointKind = 'FINAL_DELIVERY_CHILD_MERGE';
    input.trigger = 'FINAL_DELIVERY_CHILD_MERGE';
    input.mergeEventReadback = D1_ORACLE_FINAL_CHILD_MERGE_EVENT_READBACK;
  }
  if (overrides.emptyMergeCheckMembership === true) {
    input.childState = s1aClone(D1_ORACLE_EMPTY_CHILD_STATE);
    input.checkInventory = makeS1aInventory('CANONICAL_APPLICABLE_INTEGRATED_CHECK_READBACK',
      input.identity, []);
    input.checks = [];
    input.reviewSnapshot.applicableIntegratedCheckIds = [];
  }
  input.finalityDependencyReadback = makeD1FinalityDependencyReadback(input, finalityOverrides);
  const finalityCore = { ...input.finalityDependencyReadback };
  delete finalityCore.digest;
  input.trustedFinalityDependencySnapshot = s1aClone(finalityCore);
  input.integrationPredicateReadback = makeD1IntegrationPredicateReadback(input);
  const integrationPredicateCore = { ...input.integrationPredicateReadback };
  delete integrationPredicateCore.digest;
  input.trustedIntegrationPredicateSnapshot = s1aClone(integrationPredicateCore);
  D1_ORACLE_TRUSTED_POST_CHILD_INPUTS.set(input, Object.freeze({
    finalityDependencySnapshot: s1aClone(finalityCore),
    integrationPredicateSnapshot: s1aClone(integrationPredicateCore)
  }));
  return input;
}

const D1_ORACLE_EMPTY_CHILD_STATE_CORE = Object.freeze({
  ...S1A_ORACLE_POST_CHILD_STATE_CORE,
  applicableIntegratedCheckIds: Object.freeze([])
});
const D1_ORACLE_EMPTY_CHILD_STATE = Object.freeze({
  ...D1_ORACLE_EMPTY_CHILD_STATE_CORE,
  stateDigest: s1aHashRecord(D1_ORACLE_EMPTY_CHILD_STATE_CORE)
});const D1_ORACLE_FINAL_CHILD_MERGE_EVENT_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DELIVERY_CHILD_EVENT_READBACK', authoritative: true, current: true, readBack: true,
  repository: S1A_ORACLE_INTEGRATED_IDENTITY.repository, deliveryChildId: S1A_ORACLE_INTEGRATED_IDENTITY.deliveryChildId,
  commit: S1A_ORACLE_INTEGRATED_IDENTITY.commit, tree: S1A_ORACLE_INTEGRATED_IDENTITY.tree,
  checkpointKind: 'FINAL_DELIVERY_CHILD_MERGE', eventIdentity: 'delivery-child-merge:event-41', mergeReceiptId: 'receipt:merge'
});
const D1_ORACLE_FINAL_CHILD_MERGE_EVENT_READBACK = Object.freeze({
  ...D1_ORACLE_FINAL_CHILD_MERGE_EVENT_CORE, digest: s1aHashRecord(D1_ORACLE_FINAL_CHILD_MERGE_EVENT_CORE)
});
const D1_ORACLE_SUPPORTING_PR_EVENT_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_DELIVERY_CHILD_EVENT_READBACK', authoritative: true, current: true, readBack: true,
  repository: S1A_ORACLE_INTEGRATED_IDENTITY.repository, deliveryChildId: S1A_ORACLE_INTEGRATED_IDENTITY.deliveryChildId,
  commit: S1A_ORACLE_INTEGRATED_IDENTITY.commit, tree: S1A_ORACLE_INTEGRATED_IDENTITY.tree,
  checkpointKind: 'SUPPORTING_PR', eventIdentity: 'supporting-pr:event-12', mergeReceiptId: null
});
const D1_ORACLE_SUPPORTING_PR_EVENT_READBACK = Object.freeze({
  ...D1_ORACLE_SUPPORTING_PR_EVENT_CORE, digest: s1aHashRecord(D1_ORACLE_SUPPORTING_PR_EVENT_CORE)
});
const D1_ORACLE_FINAL_MERGED_IDENTITY_READBACK = Object.freeze(
  s1aClone(makeS1aReviewFixture().integratedIdentityReadback));
const D1_ORACLE_SUPPORTING_PR_IDENTITY_CORE = Object.freeze({
  source: 'CURRENT_CANONICAL_SUPPORTING_PR_READBACK', authoritative: true, current: true, readBack: true,
  ...S1A_ORACLE_INTEGRATED_IDENTITY, mergeReceiptId: null, pullRequestId: 'pr:supporting-12'
});
const D1_ORACLE_SUPPORTING_PR_IDENTITY_READBACK = Object.freeze({
  ...D1_ORACLE_SUPPORTING_PR_IDENTITY_CORE,
  digest: s1aHashRecord(D1_ORACLE_SUPPORTING_PR_IDENTITY_CORE)
});
function d1OracleFinalityReadback(overrides = {}, checkpointKind = 'FINAL_DELIVERY_CHILD_MERGE') {
  const fixture = makeS1aReviewFixture();
  fixture.checkpointKind = checkpointKind;
  const core = makeD1FinalityDependencyReadback(fixture, overrides);
  return core;
}
const D1_ORACLE_FINALITY_READBACKS = Object.freeze([
  d1OracleFinalityReadback(),
  d1OracleFinalityReadback({ finalDeliveryChild: true }),
  d1OracleFinalityReadback({ explicitDualRequirement: true }),
  d1OracleFinalityReadback({}, 'SUPPORTING_PR')
]);
function d1OracleIntegrationPredicateReadback(overrides = {}) {
  const fixture = makeS1aReviewFixture();
  return makeD1IntegrationPredicateReadback({
    ...fixture,
    assuredChildTree: S1A_ORACLE_INTEGRATED_IDENTITY.tree,
    unassuredConcurrentOrMultiChildComposition: false,
    conflictResolutionSemanticDelta: false,
    materialRootTrustAuthorityIntegrationOutsideAssuredTree: false,
    materialIntegrationUncertainty: false,
    dualSnapshotBindable: true,
    reviewerAvailability: { A: true, B: true },
    ...overrides
  });
}
const D1_ORACLE_INTEGRATION_PREDICATE_READBACKS = Object.freeze([
  d1OracleIntegrationPredicateReadback(),
  d1OracleIntegrationPredicateReadback({ assuredChildTree: 'assured:prior-tree' }),
  d1OracleIntegrationPredicateReadback({ unassuredConcurrentOrMultiChildComposition: true }),
  d1OracleIntegrationPredicateReadback({ conflictResolutionSemanticDelta: true }),
  d1OracleIntegrationPredicateReadback({ materialRootTrustAuthorityIntegrationOutsideAssuredTree: true }),
  d1OracleIntegrationPredicateReadback({ materialIntegrationUncertainty: true, dualSnapshotBindable: false }),
  d1OracleIntegrationPredicateReadback({ materialIntegrationUncertainty: true, reviewerAvailability: { A: true, B: false } })
]);
const D1_ORACLE_GOVERNED_SOURCE_SHA256 = '3adbd64ef930af84b9c5a84f7ca8261fbc966aa9dede0abbe49ec27749a43e08';
function d1GovernedSourceSegments(sources) {
  const controllerSource = sources.controller.replace(/\r\n?/g, '\n');
  const architectureSource = sources.architecture.replace(/\r\n?/g, '\n');
  const baselineSource = (sources.baseline || '').replace(/\r\n?/g, '\n');
  const controllerLaw = s1aProseRange(controllerSource,
    '## Discovery, root, and final-merge law', '\n## Shipping-first scope and repair decisions');
  const architectureDiscovery = s1aProseRange(architectureSource,
    '### Programme discovery basis', '\n### G1 — Root convergence, architecture and authority');
  const architectureRoot = s1aProseRange(architectureSource,
    '### Stable-root G3 convergence accounting', '\n### Increment 1 ownership fences');
  const architectureOwners = s1aProseRange(architectureSource,
    '### Increment 1 ownership fences', '\n### G4 — Child-final independent assurance');
  const architecturePostChild = s1aProseRange(architectureSource,
    '### Post-child integrated dual review', '\n### Bounded non-product continuation');
  const baseline = baselineSource;
  const segments = { controllerLaw, architectureDiscovery, architectureRoot, architectureOwners, architecturePostChild, baseline };
  const expectedOwnerRows = [
    '| A1 | Route registration/resolution, including concrete `G0.discovery`. |',
    '| C2 | CURRENT, packets, discovery-basis receipts, durable root ledger, post-child checkpoint runtime. |',
    '| H | Host/browser/computer/native qualification. |',
    '| X1 | Secret References and Private Custody. |',
    '| X2 | Sensitive-File Access Guard. |',
    '| X3 | External Operation Authority and effectful probes. |',
    '| X4 | Privacy-Safe Operational Evidence. |',
    '| W2 | Temporary workspace lifecycle. |',
    '| D1 | Semantics and deterministic policy oracles only. |'
  ];
  const actualOwnerRows = architectureOwners.split(/\r?\n/).filter((line) =>
    /^\| (?:A1|C2|H|X1|X2|X3|X4|W2|D1) \|/.test(line));
  s1aRequire(s1aSame(actualOwnerRows, expectedOwnerRows),
    'D1 architecture owner-fence table missing, duplicated, or contradictory');
  for (const [name, value] of Object.entries(segments)) {
    s1aRequire(value.length > 0, 'D1 governed source section missing: ' + name);
  }
  const requiredClauses = {
    controllerLaw: [
      'binds adequate existing investigation to exact source, revision and recoverable evidence identity.',
      'Every receipt and X3/Web authority is bound to the exact consuming repository, programme, child identity/revision and baseline identity/revision.',
      'caller history arrays cannot reset them.',
      'Every ordinary episode attempt must be attributed to at least one stable root family before the ledger can pass',
      'current candidate bytes, an exact byte-comparison readback',
      'the complete stable root-family set',
      'unknown classification holds for Web.',
      'attempt 5 is absolute.',
      'missing or contradictory shared evidence is', 'never defaults false.',
      'An otherwise-applicable required check with stale event/trigger/head identity, or a disabled check declared child-required or required-at-merge, causes HOLD rather than silent omission.'
    ],
    architectureDiscovery: [
      'requires an authoritative current source readback binding exact repository/path/revision and recoverable evidence identity',
      'requires a current authoritative G1/Web decision readback binding the exact repository, programme, child, baseline revision, finding IDs, evidence identities, outcome, decision body and body digest',
      'is admitted only by a current applicability readback bound to the consuming repository, programme, child revision, baseline revision, finding IDs and every material fact covered',
      'a current authoritative observation readback bound to the exact consuming repository, programme, child revision, baseline revision, finding IDs and changed facts, plus a safe evidence/reverification reference and current terminal enactment receipt',
      'a receipt cannot be replayed across consumers',
      'X3/Web authority bound to the exact consuming repository, programme, child, baseline revision and operation',
      'Raw private material is never admitted into a baseline.'
    ],
    architectureRoot: [
      'unknown or ambiguous class is a Web HOLD.', 'Caller root names, hashes or booleans cannot establish a new family, separability or prior-attribution audit.',
      'attempt 5 is the same-root absolute ceiling, and a sixth ordinary attempt is rejected.',
      'Attempt-event observers reject unknown event kinds and enforce the same-root ceiling.',
      'Ordinary, WDC, reconverged and episode-history membership comes only from the complete current canonical episode-ledger readback',
      'exact current candidate bytes, unchanged-byte comparison and non-product classification readbacks bind the same repository, child, RUN/Lock and root family',
      'Every ordinary episode attempt must be attributed to at least one stable root family in the current records or prior-attribution map'
    ],
    architectureOwners: [
      'The D1 deterministic post-child membership oracle treats an otherwise-applicable required merge check with stale event/trigger/head identity, or a disabled child-required or required-at-merge merge check, as HOLD; event, branch and path non-applicability is evaluated before exact identity matching.'
    ],
    architecturePostChild: [
      'Only a current canonical merge/event and child-state readback identifying the final Delivery Child merge triggers deterministic reconciliation; a caller label cannot suppress it.',
      'Every trigger and reconciliation predicate must have explicit current proof;', 'never false.',
      'Validate the child, check and review inventory shapes before dereferencing them; a missing or malformed inventory is',
      'Bind the same expected check identities across configuration, canonical child inventory, terminal result inventory and review snapshot.',
      'A provably empty expected membership is valid only when the complete authoritative configuration readback and those inventories agree that it is empty.',
      'every enabled applicable first-party merge-triggered check',



      'First-party ownership comes from the current authoritative configuration metadata, not a finite local producer allowlist.'
    ],
    baseline: [
      'Raw private material always invalidates repository admission, even if a custody reference is also present.',
      'A digest by itself is not a recoverable private-evidence reference.',
      'requires a current applicability receipt bound to the exact consuming repository, programme, child identity/revision and baseline identity/revision',
      'requires a current authoritative observation readback bound to the exact consuming repository, programme, child revision, baseline revision, finding IDs and changed facts, plus a safe evidence/reverification reference and current terminal enactment receipt',
      'Adoption requires a current applicability readback bound to the exact consuming repository, programme, child revision, baseline revision, finding IDs and covered material facts',
      'X3/Web authority bound to the exact consuming repository, programme, child, baseline revision and operation',
      'ADOPTED_EQUIVALENT', 'G1/Web decision readback'
    ]
  };
  for (const [name, clauses] of Object.entries(requiredClauses)) {
    for (const clause of clauses) {
      s1aRequire(segments[name].includes(clause), 'D1 governed source clause missing or weakened: ' + name + ':' + clause);
    }
  }
  return Object.fromEntries(Object.entries(segments).map(([name, value]) => [name, value.replace(/\r\n?/g, '\n')]));
}
function d1GovernedSourceDigest(sources) {
  const segments = d1GovernedSourceSegments(sources);
  return crypto.createHash('sha256').update(JSON.stringify(segments), 'utf8').digest('hex');
}

const D1_G3_FINDING_CLASSIFICATIONS = Object.freeze([
  'EXISTING_ROOT', 'NEW_ROOT_DISCOVERED', 'CROSS_ROOT_INTERACTION',
  'G2_CONTRACT_GAP', 'G1_ROOT_TRUST_CHANGE', 'NON_PRODUCT_BLOCKER'
]);

test('D1 governed source oracle covers controller, architecture and discovery baseline', () => {
  const sources = { controller, architecture, baseline: programmeDiscoveryBaseline };
  assert.equal(d1GovernedSourceDigest(sources), D1_ORACLE_GOVERNED_SOURCE_SHA256,
    'D1 governed prose and complete baseline match the fixed source oracle');
  const weakenings = [
    { ...sources, architecture: architecture.replace('requires an authoritative current source readback', 'may use caller-supplied material') },
    { ...sources, architecture: architecture.replace('attempt 5 is the same-root absolute ceiling, and a sixth ordinary attempt is rejected.', 'attempts have no fixed ceiling.') },
    { ...sources, baseline: programmeDiscoveryBaseline.replace('Raw private material always invalidates repository admission, even if a custody reference is also present.', 'Private material may be admitted with a custody reference.') },


    { ...sources, architecture: architecture.replace('The D1 deterministic post-child membership oracle treats', 'The D1 deterministic post-child membership oracle may ignore') },
    { ...sources, architecture: architecture.replace('Every trigger and reconciliation predicate must have explicit current proof;', 'Missing predicates are false;') }
  ];
  for (const weakened of weakenings) {
    assert.throws(() => d1GovernedSourceDigest(weakened), /D1 governed source clause missing or weakened/,
      'recomputed source digests cannot bless a weakened D1 policy clause');
  }
  const duplicatedOwnerRow = { ...sources, architecture: architecture.replace(
    '| D1 | Semantics and deterministic policy oracles only. |',
    '| D1 | Semantics and deterministic policy oracles only. |\n| D1 | Runtime authority. |') };
  assert.throws(() => d1GovernedSourceDigest(duplicatedOwnerRow), /owner-fence table missing, duplicated, or contradictory/,
    'the complete exact owner-fence table rejects a duplicate or conflicting D1 row');
});

test('D1 Discovery Basis deterministic scenarios D01-D10 reject forbidden shortcuts', () => {
  assert.deepEqual(D1_DISCOVERY_STATUS_VALUES,
    ['OBSERVED', 'DOCUMENTED_NOT_DEMONSTRATED', 'INFERRED', 'PROPOSED', 'UNKNOWN', 'ACCEPTED']);
  const cases = [
    { id: 'D01', input: { stableBugfix: true, changedMaterialFacts: [], reuseApplicabilityReadback: D1_ORACLE_REUSE_APPLICABILITY_READBACK }, basis: 'REUSE' },
    { id: 'D02', input: { newChat: true, newDay: true, newWorker: true, takeover: true, daysElapsed: 400, changedMaterialFacts: [], reuseApplicabilityReadback: D1_ORACLE_REUSE_APPLICABILITY_READBACK }, basis: 'REUSE' },
    { id: 'D03', input: { materialUnknown: true, requiresProgrammeScopeInvestigation: true, safeToInvestigate: true,
      unknownPortal: true, modalities: ['desktop', 'native'] }, basis: 'FULL' },
    { id: 'D04', input: { materialUnknown: true, requiresProgrammeScopeInvestigation: true,
      adequateExistingInvestigation: true, adoptExisting: true,
      adoptedEvidenceReadback: D1_ORACLE_ADOPTED_EVIDENCE_READBACK,
      adoptedFindingIds: ['F-LOGIN-CONTRACT-01'],
      adoptedApplicabilityReadback: D1_ORACLE_ADOPTED_APPLICABILITY_READBACK }, basis: 'ADOPTED_EQUIVALENT' },
    { id: 'D05', input: { changedMaterialFacts: ['ui:settings-panel'], changedDependencyIdentities: ['ui:settings-panel'], discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK,
      findings: [
        { FINDING_ID: 'F-UI', DEPENDENT_IDENTITIES: ['ui:settings-panel'], INVALIDATION_TRIGGERS: [] },
        { FINDING_ID: 'F-AUTH', DEPENDENT_IDENTITIES: ['auth:contract'], INVALIDATION_TRIGGERS: [] }
      ] }, basis: 'DELTA' },
    { id: 'D06', input: { changedMaterialFacts: ['route:v2'], changedDependencyIdentities: ['route:v2'], discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK,
      findings: [
        { FINDING_ID: 'F-STALE', DEPENDENT_IDENTITIES: [], INVALIDATION_TRIGGERS: ['route:v2'] },
        { FINDING_ID: 'F-UNCHANGED', DEPENDENT_IDENTITIES: ['ui:header'], INVALIDATION_TRIGGERS: [] }
      ] }, basis: 'DELTA' },
    { id: 'D07', input: { changedMaterialFacts: ['portal:submit'], changedDependencyIdentities: ['portal:submit'], discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK, unsafeRepresentativeEnactment: true,
      documentedPartialEvidence: true, disposition: 'OWNER_WEB_DECISION_REQUIRED' }, basis: 'DELTA', outcome: 'HOLD' },
    { id: 'D08', input: { changedMaterialFacts: ['private:claim'], changedDependencyIdentities: ['private:claim'], discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK, privateEvidencePresent: true,
      privateEvidenceReference: 'owner-custody:opaque-ref-07', privateCustodyReadback: D1_ORACLE_PRIVATE_CUSTODY_READBACK,
      rawPrivateMaterialIncluded: false }, basis: 'DELTA' },
    { id: 'D09', input: { changedMaterialFacts: [], unchangedReuse: true, reuseApplicabilityReadback: D1_ORACLE_REUSE_APPLICABILITY_READBACK }, basis: 'REUSE' },
    { id: 'D10', input: { changedMaterialFacts: ['external:submit'], changedDependencyIdentities: ['external:submit'], discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK, effectfulProbe: true,
      currentX3WebAuthority: false }, basis: 'DELTA', outcome: 'HOLD' }
  ];
  for (const scenario of cases) {
    const result = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(scenario.input));
    assert.equal(result.basis, scenario.basis, scenario.id + ' basis');
    assert.equal(result.outcome, scenario.outcome || 'PASS', scenario.id + ' outcome');
    assert.equal(result.createsGate, false, scenario.id + ' cannot make Discovery Basis a gate');
    assert.equal(result.createsRole, false, scenario.id + ' cannot make Discovery Basis a role');
    assert.equal(result.createsLocalG2, false, scenario.id + ' cannot create local G2');
    assert.equal(result.createsLocalG3, false, scenario.id + ' cannot create local G3');
    assert.equal(result.createsLocalG4, false, scenario.id + ' cannot create local G4');
    assert.equal(result.g0ReadOnly, true, scenario.id + ' keeps G0 read-only');
    assert.equal(result.effectPerformedByG0, false, scenario.id + ' G0 has no effect execution');
  }
  for (const malformedFacts of ['portal:submit', [{}], [' '], ['portal:submit', 'portal:submit']]) {
    const malformed = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({
      changedMaterialFacts: malformedFacts,
      reuseApplicabilityReadback: D1_ORACLE_REUSE_APPLICABILITY_READBACK
    }));
    assert.equal(malformed.outcome, 'HOLD',
      'malformed, blank, or duplicate changed material facts fail closed');
  }
  assert.deepEqual(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[1].input)).invalidatedFindingIds, [],
    'new chat/day/worker or baseline age alone cannot expire evidence');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[2].input)).basis, 'FULL',
    'material safely investigable unknown portal behaviour takes programme-scope FULL');
  assert.deepEqual(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[4].input)).invalidatedFindingIds, ['F-UI'],
    'UI drift invalidates only findings dependent on that surface');
  assert.deepEqual(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[5].input)).invalidatedFindingIds, ['F-STALE'],
    'one stale finding invalidates locally');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[3].input)).basis, 'ADOPTED_EQUIVALENT',
    'D04 requires exact source/revision/evidence readback');
  const forgedAdopted = s1aClone(cases[3].input);
  forgedAdopted.adoptedEvidenceReadback.revision = 'source:attacker-revision';
  forgedAdopted.adoptedEvidenceReadback.digest = s1aHashWithoutField(forgedAdopted.adoptedEvidenceReadback, 'digest');
  assert.notEqual(evaluateD1DiscoveryBasis(forgedAdopted).basis, 'ADOPTED_EQUIVALENT',
    'a rehashed caller revision cannot replace the exact authoritative evidence readback');
  const unsafe = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[6].input));
  assert.equal(unsafe.status, 'DOCUMENTED_NOT_DEMONSTRATED');
  assert.equal(unsafe.disposition, 'OWNER_WEB_DECISION_REQUIRED');
  assert.notEqual(unsafe.status, 'OBSERVED', 'unsafe enactment cannot be presented as observed behaviour');
  const privateEvidence = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[7].input));
  assert.equal(privateEvidence.privateReferenceValid, true);
  assert.equal(privateEvidence.rawPrivateMaterialIncluded, false);
  const staleCustody = s1aClone(D1_ORACLE_PRIVATE_CUSTODY_READBACK);
  staleCustody.childRevision = 'child:settings-rev-10';
  staleCustody.digest = s1aHashWithoutField(staleCustody, 'digest');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ ...cases[7].input,
    privateCustodyReadback: staleCustody })).outcome, 'HOLD',
    'private custody receipt from an earlier child revision cannot pass');
  const rawPrivate = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ privateEvidencePresent: true,
    privateEvidenceReference: 'owner-custody:opaque-ref-07', privateCustodyReadback: D1_ORACLE_PRIVATE_CUSTODY_READBACK,
    rawPrivateMaterialIncluded: true }));
  assert.equal(rawPrivate.outcome, 'HOLD', 'raw private material is rejected even with a custody receipt');
  assert.equal(evaluateD1DiscoveryBasis({ privateEvidencePresent: true, rawPrivateMaterialIncluded: false }).outcome,
    'HOLD', 'a bare private reference cannot pass without an exact consumer-resolvable custody readback');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[8].input)).dedicatedDiscovery, false,
    'unchanged REUSE does no dedicated discovery work');
  const foreignReuse = d1MakeDiscoveryInput({ ...cases[0].input, childId: 'child:foreign' });
  assert.equal(evaluateD1DiscoveryBasis(foreignReuse).outcome, 'HOLD', 'REUSE receipts cannot cross consuming children');
  const staleReuse = s1aClone(D1_ORACLE_REUSE_APPLICABILITY_READBACK);
  staleReuse.childRevision = 'child:settings-rev-10';
  staleReuse.digest = s1aHashWithoutField(staleReuse, 'digest');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ reuseApplicabilityReadback: staleReuse })).outcome, 'HOLD',
    'a REUSE receipt from an earlier child revision cannot be replayed');
  const staleDelta = s1aClone(D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK);
  staleDelta.childRevision = 'child:settings-rev-10';
  staleDelta.digest = s1aHashWithoutField(staleDelta, 'digest');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ changedMaterialFacts: ['portal:submit'],
    changedDependencyIdentities: ['portal:submit'], discoveryDependencyReadback: staleDelta })).outcome, 'HOLD',
    'a DELTA inventory from an earlier child revision cannot be replayed');
  const foreignDelta = d1MakeDiscoveryInput({ ...cases[4].input, repository: 'repo:foreign' });
  assert.equal(evaluateD1DiscoveryBasis(foreignDelta).outcome, 'HOLD', 'DELTA inventory cannot cross repositories');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ ...cases[0].input,
    reusedFindingIds: ['F-ATTACK'] })).outcome, 'HOLD', 'REUSE must bind the exact finding set');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ ...cases[4].input,
    currentFindingIds: ['F-ATTACK'] })).outcome, 'HOLD', 'DELTA must bind the complete current finding inventory');
  const foreignAdoption = d1MakeDiscoveryInput({ ...cases[3].input, programmeId: 'programme:foreign' });
  assert.notEqual(evaluateD1DiscoveryBasis(foreignAdoption).basis, 'ADOPTED_EQUIVALENT',
    'adopted evidence cannot establish another consuming programme');
  const adoptedCoveredFact = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({
    materialUnknown: true, requiresProgrammeScopeInvestigation: true, safeToInvestigate: false,
    adequateExistingInvestigation: true, adoptExisting: true,
    adoptedEvidenceReadback: D1_ORACLE_ADOPTED_EVIDENCE_READBACK,
    adoptedFindingIds: ['F-PORTAL'], changedMaterialFacts: ['portal:submit'],
    adoptedApplicabilityReadback: D1_ORACLE_ADOPTED_PORTAL_APPLICABILITY_READBACK
  }));
  assert.equal(adoptedCoveredFact.basis, 'ADOPTED_EQUIVALENT');
  assert.equal(adoptedCoveredFact.outcome, 'PASS',
    'adoption passes only when a current consumer receipt covers the exact finding and material fact');
  const unmappedAdoption = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({
    materialUnknown: true, requiresProgrammeScopeInvestigation: true, safeToInvestigate: false,
    adequateExistingInvestigation: true, adoptExisting: true,
    adoptedEvidenceReadback: D1_ORACLE_ADOPTED_EVIDENCE_READBACK,
    adoptedApplicabilityReadback: D1_ORACLE_ADOPTED_APPLICABILITY_READBACK,
    changedMaterialFacts: ['unmapped:new-workflow-fact']
  }));
  assert.notEqual(unmappedAdoption.basis, 'ADOPTED_EQUIVALENT',
    'source identity and caller adequacy cannot adopt an uncovered material fact');
  assert.equal(unmappedAdoption.outcome, 'HOLD');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ effectfulProbe: true, safeToInvestigate: true,
    x3WebAuthorityReadback: D1_ORACLE_X3_WEB_AUTHORITY, childId: 'child:foreign' })).outcome, 'HOLD',
    'X3 authority cannot cross consuming children');
  const staleX3 = s1aClone(D1_ORACLE_X3_WEB_AUTHORITY);
  staleX3.childRevision = 'child:settings-rev-10';
  staleX3.digest = s1aHashWithoutField(staleX3, 'digest');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ effectfulProbe: true, safeToInvestigate: true,
    x3WebAuthorityReadback: staleX3 })).outcome, 'HOLD',
    'X3 authority from an earlier child revision cannot authorize a current probe');
  const unprovenObservation = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({
    requestedStatus: 'OBSERVED', materialUnknown: true, requiresProgrammeScopeInvestigation: true,
    safeToInvestigate: false, reuseApplicabilityReadback: D1_ORACLE_REUSE_APPLICABILITY_READBACK
  }));
  assert.notEqual(unprovenObservation.status, 'OBSERVED', 'caller status cannot claim an unproven observation');
  assert.equal(unprovenObservation.outcome, 'HOLD', 'unsafe unknown behaviour remains held without observation evidence');
  const observed = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({
    changedMaterialFacts: ['portal:submit'], changedDependencyIdentities: ['portal:submit'],
    discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK,
    requestedStatus: 'OBSERVED', observationFindingIds: ['F-PORTAL'], safeToInvestigate: true,
    observationReadback: D1_ORACLE_DISCOVERY_OBSERVATION_READBACK
  }));
  assert.equal(observed.outcome, 'PASS');
  assert.equal(observed.status, 'OBSERVED', 'observed status requires current evidence for the exact child and changed fact');
  const unrecoverableObservation = s1aClone(D1_ORACLE_DISCOVERY_OBSERVATION_READBACK);
  delete unrecoverableObservation.safeEvidenceOrReverifyReference;
  unrecoverableObservation.digest = s1aHashWithoutField(unrecoverableObservation, 'digest');
  const missingObservationEvidence = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({
    changedMaterialFacts: ['portal:submit'], changedDependencyIdentities: ['portal:submit'],
    discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK,
    requestedStatus: 'OBSERVED', observationFindingIds: ['F-PORTAL'], safeToInvestigate: true,
    observationReadback: unrecoverableObservation
  }));
  assert.equal(missingObservationEvidence.outcome, 'HOLD',
    'an opaque evidence ID without a recoverable reference cannot establish OBSERVED');
  assert.notEqual(missingObservationEvidence.status, 'OBSERVED');
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(cases[9].input)).effectAuthorized, false,
    'effectful probes require current X3/Web authority');
  const authorisedProbe = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ effectfulProbe: true,
    safeToInvestigate: true, x3WebAuthorityReadback: D1_ORACLE_X3_WEB_AUTHORITY }));
  assert.equal(authorisedProbe.effectAuthorized, true, 'a current exact X3/Web operation readback may authorise the probe');
  assert.equal(authorisedProbe.g0ReadOnly, true, 'X3 authority does not make G0 effectful');
  assert.equal(evaluateD1DiscoveryBasis({ materialUnknown: true, requiresProgrammeScopeInvestigation: true, safeToInvestigate: false }).outcome, 'HOLD', 'an unsafe unresolved programme unknown cannot pass as REUSE without an exact applicability receipt');
  assert.equal(evaluateD1DiscoveryBasis({ changedMaterialFacts: ['ui:settings-panel'], changedDependencyIdentities: [] }).outcome, 'HOLD', 'DELTA without a complete current changed-fact dependency map cannot pass');
  assert.equal(evaluateD1DiscoveryBasis({ changedMaterialFacts: ['unmapped:change'], changedDependencyIdentities: ['unmapped:change'], discoveryDependencyReadback: D1_ORACLE_DISCOVERY_DEPENDENCY_READBACK }).outcome, 'HOLD', 'a changed fact outside the authoritative dependency inventory cannot pass');
  const unaccepted = evaluateD1DiscoveryBasis({ requestedStatus: 'ACCEPTED' });
  assert.notEqual(unaccepted.status, 'ACCEPTED', 'ACCEPTED requires an exact G1/Web decision');
  const unsupportedAcceptance = evaluateD1DiscoveryBasis(d1MakeDiscoveryInput({ requestedStatus: 'ACCEPTED' }));
  assert.equal(unsupportedAcceptance.outcome, 'HOLD',
    'an invalid acceptance readback is a HOLD rather than a green discovery outcome');
  const acceptedInput = {
    requestedStatus: 'ACCEPTED', exactG1WebDecisionId: D1_ORACLE_G1_WEB_DECISION_BODY.decisionId,
    repository: D1_ORACLE_G1_WEB_DECISION_BODY.repository, programmeId: D1_ORACLE_G1_WEB_DECISION_BODY.programmeId,
    childId: D1_ORACLE_G1_WEB_DECISION_BODY.childId, baselineId: D1_ORACLE_G1_WEB_DECISION_BODY.baselineId,
    baselineRevision: D1_ORACLE_G1_WEB_DECISION_BODY.baselineRevision,
    consumingFindingIds: D1_ORACLE_G1_WEB_DECISION_BODY.findingIds,
    evidenceIds: D1_ORACLE_G1_WEB_DECISION_BODY.evidenceIds,
    g1WebDecisionReadback: D1_ORACLE_G1_WEB_DECISION_READBACK
  };
  assert.equal(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(acceptedInput)).status, 'ACCEPTED',
    'an exact current G1/Web decision readback bound to the consuming baseline and evidence may be accepted');
  const staleDecision = s1aClone(acceptedInput);
  staleDecision.g1WebDecisionReadback.current = false;
  staleDecision.g1WebDecisionReadback.digest = s1aHashWithoutField(staleDecision.g1WebDecisionReadback, 'digest');
  assert.notEqual(evaluateD1DiscoveryBasis(d1MakeDiscoveryInput(staleDecision)).status, 'ACCEPTED',
    'stale current-source decision readback cannot accept a finding');
});

test('D1 stable causal root accounting scenarios R01-R12 preserve unique attempt history', () => {
  assert.deepEqual(D1_G3_FINDING_CLASSIFICATIONS, [
    'EXISTING_ROOT', 'NEW_ROOT_DISCOVERED', 'CROSS_ROOT_INTERACTION',
    'G2_CONTRACT_GAP', 'G1_ROOT_TRUST_CHANGE', 'NON_PRODUCT_BLOCKER'
  ]);
  const independent = d1EvaluateRootRecords([
    d1RootRecord('root:A', 'cause:A', ['A1']), d1RootRecord('root:B', 'cause:B', ['A2']),
    d1RootRecord('root:C', 'cause:C', ['A3'])
  ], { historicalEpisodeAttemptIds: ['A1', 'A2', 'A3'] });
  assert.equal(independent.ok, true, 'R01 independent roots are valid');
  assert.deepEqual(independent.rootGroups.map((root) => root.attemptsConsumed), [1, 1, 1]);
  assert.equal(independent.historicalAttemptCount, 3, 'R01 chronology retains three attempts');

  const renamed = d1EvaluateRootRecords([
    d1RootRecord('root:parser-original', 'cause:parser', ['A1']),
    d1RootRecord('root:parser-renamed', 'cause:parser', ['A2']),
    d1RootRecord('root:parser-new-label', 'cause:parser', ['A3'])
  ], { historicalEpisodeAttemptIds: ['A1', 'A2', 'A3'] });
  assert.equal(renamed.rootGroups.length, 1, 'R02 renaming remains one causal root');
  assert.equal(renamed.rootGroups[0].attemptsConsumed, 3);

  const sharedAttempt = d1EvaluateRootRecords([
    d1RootRecord('root:A', 'cause:A', ['A1']), d1RootRecord('root:B', 'cause:B', ['A1'])
  ], { historicalEpisodeAttemptIds: ['A1'] });
  assert.deepEqual(sharedAttempt.rootGroups.map((root) => root.attemptIds), [['A1'], ['A1']]);
  assert.equal(sharedAttempt.historicalAttemptCount, 1, 'R03 shared attribution does not inflate chronology');

  const equivalent = evaluateD1RootLedger([
    d1RootRecord('root:equiv-A', 'cause:shared', ['A1', 'A2']),
    d1RootRecord('root:equiv-B', 'cause:shared', ['A2', 'A3'])
  ], makeD1RootLedgerAuthority([], { historicalEpisodeAttemptIds: ['A1', 'A2', 'A3'] }));
  assert.equal(equivalent.ok, false, 'R04 record/readback disagreement fails closed');
  const equivalentRecords = [
    d1RootRecord('root:equiv-A', 'cause:shared', ['A1', 'A2']),
    d1RootRecord('root:equiv-B', 'cause:shared', ['A2', 'A3'])
  ];
  const equivalentLedger = d1EvaluateRootRecords(equivalentRecords, { historicalEpisodeAttemptIds: ['A1', 'A2', 'A3'] });
  assert.equal(equivalentLedger.rootGroups.length, 1, 'R04 equivalent roots merge');
  assert.deepEqual(equivalentLedger.rootGroups[0].attemptIds, ['A1', 'A2', 'A3']);

  const priorRoot = d1RootRecord('root:prior', 'cause:prior', ['A1', 'A2', 'A3'], { state: 'CLOSED' });
  const untouched = d1RootRecord('root:new', 'cause:new', [], { newlyDiscovered: true });
  const newRoot = d1EvaluateRootRecords([priorRoot, untouched], {
    historicalEpisodeAttemptIds: ['A1', 'A2', 'A3'], previouslyAddressedFamilies: [d1StableRootFamilyKey(priorRoot)],
    verifiedUntouchedRootFamilies: [d1StableRootFamilyKey(untouched)], attributionAuditComplete: true,
    includeUntouchedRootAudit: true
  });
  assert.equal(newRoot.rootGroups.find((root) => root.attemptsConsumed === 0).state, 'OPEN',
    'R05 independently audited untouched root starts at zero');
  const unprovenNewRoot = d1EvaluateRootRecords([priorRoot, untouched], {
    historicalEpisodeAttemptIds: ['A1', 'A2', 'A3'], previouslyAddressedFamilies: [d1StableRootFamilyKey(priorRoot)],
    verifiedUntouchedRootFamilies: [d1StableRootFamilyKey(untouched)], attributionAuditComplete: true
  });
  assert.equal(unprovenNewRoot.ok, false, 'R05 zero requires a completed prior-attribution audit');

  const repeatedReadback = D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
    item.classification === 'CROSS_ROOT_INTERACTION' && item.repeatedCrossRootReopening);
  const singleReadback = D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
    item.classification === 'CROSS_ROOT_INTERACTION' && !item.repeatedCrossRootReopening);
  assert.equal(evaluateD1RootClassification('CROSS_ROOT_INTERACTION').disposition,
    'HOLD_MISSING_CURRENT_CLASSIFICATION_READBACK', 'R06 missing reopening history cannot default to continue');
  assert.equal(evaluateD1RootClassification('CROSS_ROOT_INTERACTION', true).disposition,
    'HOLD_MISSING_CURRENT_CLASSIFICATION_READBACK', 'caller booleans cannot prove repeated reopening');
  assert.equal(evaluateD1RootClassification('CROSS_ROOT_INTERACTION', singleReadback).disposition,
    'CONTINUE_EXISTING_ROOT_ACCOUNTING');
  const reopened = evaluateD1RootClassification('CROSS_ROOT_INTERACTION', repeatedReadback);
  assert.equal(reopened.disposition, 'RETURN_TO_WEB', 'R06 repeated A/B reopening returns to Web');
  assert.equal(reopened.createsBudget, false, 'R06 cross-root interaction creates no automatic budget');
  const repeatedCrossRootLedger = makeD1RootLedgerAuthority([
    d1RootRecord('root:attempt-family-1', 'attempt-family-1', ['A1', 'A2'], { causalBoundary: 'boundary:attempt-family-1' }),
    d1RootRecord('root:attempt-family-2', 'attempt-family-2', ['A1'], { causalBoundary: 'boundary:attempt-family-2' })
  ], { historicalEpisodeAttemptIds: ['A1', 'A2'] });
  const blockedRepeatedCrossRootAttempt = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION',
    attemptId: 'A3', rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, findingId: 'finding:cross-root-reopen',
    classificationReadback: repeatedReadback }, { rootLedgerReadback: repeatedCrossRootLedger.rootLedgerReadback });
  assert.equal(blockedRepeatedCrossRootAttempt.hold, true);
  assert.equal(blockedRepeatedCrossRootAttempt.disposition, 'RETURN_TO_WEB',
    'attempt admission consumes repeated cross-root classification and returns to Web');
  const forgedReopening = s1aClone(repeatedReadback);
  forgedReopening.repeatedCrossRootReopening = false;
  forgedReopening.digest = s1aHashWithoutField(forgedReopening, 'digest');
  assert.equal(evaluateD1RootClassification('CROSS_ROOT_INTERACTION', forgedReopening).disposition,
    'HOLD_MISSING_CURRENT_CLASSIFICATION_READBACK', 'rehashing cannot erase canonical repeated reopening');

  const symptoms = ['symptom-1', 'symptom-2', 'symptom-3', 'symptom-4', 'symptom-5']
    .map((symptom) => d1RootRecord('root:' + symptom, 'cause:one-mechanism', ['A1']));
  const symptomLedger = d1EvaluateRootRecords(symptoms, { historicalEpisodeAttemptIds: ['A1'] });
  assert.equal(symptomLedger.rootGroups.length, 1, 'R07 five symptoms share one root absent separability proof');
  assert.equal(symptomLedger.rootGroups[0].attemptsConsumed, 1);

  assert.equal(evaluateD1NextRootAttempt(4, false), false, 'R08 attempt 4 requires narrowing/progress');
  assert.equal(evaluateD1NextRootAttempt(4, true), true);
  assert.equal(evaluateD1NextRootAttempt(5, false), false, 'R08 attempt 5 requires narrowing/progress');
  assert.equal(evaluateD1NextRootAttempt(5, true), true);
  assert.equal(evaluateD1NextRootAttempt(6, true), false, 'R08 attempt 5 is absolute');
  const rootFamilyKey = D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY;
  const threeAttemptLedger = makeD1AttemptLedger({ ordinaryAttemptIds: ['A1', 'A2', 'A3'] });
  assert.equal(evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A6', rootFamilyKey },
    { ordinaryAttemptIds: [] }).hold, true, 'attempt-event observer requires the canonical current ledger');
  assert.equal(evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A4', rootFamilyKey },
    { rootLedgerReadback: threeAttemptLedger.rootLedgerReadback }).hold, true,
    'attempt 4 holds without independently bound narrowing/progress evidence');
  const progressReadback = d1RootProgressReadback(rootFamilyKey, 4);
  const progressLedger = makeD1AttemptLedger({ ordinaryAttemptIds: ['A1', 'A2', 'A3'],
    narrowingProgressByFamily: { [rootFamilyKey]: true },
    narrowingProgressReadbacksByFamily: { [rootFamilyKey]: { 4: progressReadback } } });
  const fourAttemptRecord = d1RootRecord('root:attempt-family-1', 'attempt-family-1',
    ['A1', 'A2', 'A3', 'A4'], { causalBoundary: 'boundary:attempt-family-1' });
  const fourWithoutProgressReceipt = d1EvaluateRootRecords([fourAttemptRecord], {
    historicalEpisodeAttemptIds: ['A1', 'A2', 'A3', 'A4'],
    narrowingProgressByFamily: { [rootFamilyKey]: true }
  });
  assert.equal(fourWithoutProgressReceipt.ok, false,
    'recorded attempt 4 cannot pass from a bare progress boolean without its bound receipt');
  const fourWithProgressReceipt = d1EvaluateRootRecords([fourAttemptRecord], {
    historicalEpisodeAttemptIds: ['A1', 'A2', 'A3', 'A4'],
    narrowingProgressByFamily: { [rootFamilyKey]: true },
    narrowingProgressReadbacksByFamily: { [rootFamilyKey]: { 4: progressReadback } }
  });
  assert.equal(fourWithProgressReceipt.ok, true,
    'recorded attempt 4 passes with the exact current family/attempt progress receipt');
  const existingRootClassification = D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
    item.classification === 'EXISTING_ROOT');
  const fourthWithoutClassification = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A4', rootFamilyKey,
    findingId: 'finding:existing-root', narrowingProgressReadback: progressReadback },
  { rootLedgerReadback: progressLedger.rootLedgerReadback });
  assert.equal(fourthWithoutClassification.hold, true,
    'ordinary attempt admission requires its current finding classification readback');
  const fourth = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A4', rootFamilyKey,
    findingId: 'finding:existing-root', classificationReadback: existingRootClassification,
    narrowingProgressReadback: progressReadback }, { rootLedgerReadback: progressLedger.rootLedgerReadback });
  assert.equal(fourth.productAttempt, true, 'attempt 4 can proceed with ledger-bound current progress evidence');

  const nonProductLedger = makeD1AttemptLedger({ ordinaryAttemptIds: ['A1'] });
  const nonProductEvent = { kind: 'NON_PRODUCT_HOLD_RECOVERY', attemptId: 'HOLD-1', rootFamilyKey,
    candidateReadback: D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK,
    attemptClassificationReadback: D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS[0] };
  const nonProduct = evaluateD1AttemptEvent(nonProductEvent, { rootLedgerReadback: nonProductLedger.rootLedgerReadback });
  assert.equal(nonProduct.productAttempt, false, 'R09 sourced non-product HOLD recovery is not a product attempt');
  assert.deepEqual(nonProduct.ordinaryAttemptIds, ['A1']);
  const unprovenNonProduct = evaluateD1AttemptEvent({ kind: 'NON_PRODUCT_HOLD_RECOVERY', attemptId: 'HOLD-1', rootFamilyKey },
    { rootLedgerReadback: nonProductLedger.rootLedgerReadback });
  assert.equal(unprovenNonProduct.hold, true, 'a caller label cannot exempt a product correction');
  const changedCandidate = s1aClone(D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK);
  changedCandidate.tree = 'candidate:product-changing-tree';
  changedCandidate.digest = s1aHashWithoutField(changedCandidate, 'digest');
  const changedClassification = s1aClone(D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS[0]);
  changedClassification.candidateReadbackDigest = changedCandidate.digest;
  changedClassification.digest = s1aHashWithoutField(changedClassification, 'digest');
  assert.equal(evaluateD1AttemptEvent({ ...nonProductEvent, candidateReadback: changedCandidate,
    attemptClassificationReadback: changedClassification }, { rootLedgerReadback: nonProductLedger.rootLedgerReadback }).hold, true,
    'candidate change cannot be relabelled as non-product even after caller rehash');
  const unchanged = evaluateD1AttemptEvent({ kind: 'UNCHANGED_BYTE_REVIEWER_SUPPLEMENTATION', attemptId: 'REVIEW-1',
    rootFamilyKey, candidateReadback: D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK,
    attemptClassificationReadback: D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS[1] },
  { rootLedgerReadback: nonProductLedger.rootLedgerReadback });
  assert.equal(unchanged.productAttempt, false, 'R10 exact unchanged-byte reviewer supplementation is not a product attempt');
  assert.equal(unchanged.totalHistoricalAttempts, 1);
  assert.equal(evaluateD1AttemptEvent({ kind: 'UNCHANGED_BYTE_REVIEWER_SUPPLEMENTATION', attemptId: 'REVIEW-1',
    rootFamilyKey }, { rootLedgerReadback: nonProductLedger.rootLedgerReadback }).hold, true,
    'an unchanged-byte caller label without candidate/classification proof holds');
  const changedBytesForSupplement = s1aClone(D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK);
  changedBytesForSupplement.byteDigest = 'sha256:changed-candidate-byte-content';
  changedBytesForSupplement.digest = s1aHashWithoutField(changedBytesForSupplement, 'digest');
  const forgedSupplementClassification = s1aClone(D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS[1]);
  forgedSupplementClassification.candidateByteDigest = changedBytesForSupplement.byteDigest;
  forgedSupplementClassification.priorCandidateByteDigest = changedBytesForSupplement.byteDigest;
  forgedSupplementClassification.candidateReadbackDigest = changedBytesForSupplement.digest;
  forgedSupplementClassification.digest = s1aHashWithoutField(forgedSupplementClassification, 'digest');
  assert.equal(evaluateD1AttemptEvent({ kind: 'UNCHANGED_BYTE_REVIEWER_SUPPLEMENTATION', attemptId: 'REVIEW-1',
    rootFamilyKey, candidateReadback: changedBytesForSupplement,
    attemptClassificationReadback: forgedSupplementClassification },
  { rootLedgerReadback: nonProductLedger.rootLedgerReadback }).hold, true,
  'a coherently rehashed candidate byte change cannot be relabelled unchanged');

  const wdcLedger = makeD1AttemptLedger({ ordinaryAttemptIds: ['A1', 'A2', 'A3'] });
  const wdc = evaluateD1AttemptEvent({ kind: 'WDC', attemptId: 'WDC-1', rootFamilyKey,
    authorityReadback: D1_ORACLE_WDC_AUTHORITY }, { rootLedgerReadback: wdcLedger.rootLedgerReadback });
  assert.equal(wdc.ordinaryBudgetReset, false, 'R11 WDC retains exhausted ordinary history');
  assert.deepEqual(wdc.ordinaryAttemptIds, ['A1', 'A2', 'A3']);
  assert.deepEqual(wdc.wdcAttemptIds, ['WDC-1']);
  assert.equal(wdc.totalHistoricalAttempts, 4, 'R11 chronology includes separately classified WDC');
  const reconvergedLedger = makeD1AttemptLedger({ ordinaryAttemptIds: ['A1', 'A2', 'A3'], wdcAttemptIds: ['WDC-1'] });
  const reconverged = evaluateD1AttemptEvent({ kind: 'RECONVERGED_CORRECTION', attemptId: 'RC-1', rootFamilyKey,
    authorityReadback: D1_ORACLE_RECONVERGED_AUTHORITY }, { rootLedgerReadback: reconvergedLedger.rootLedgerReadback });
  assert.equal(reconverged.ordinaryBudgetReset, false, 'R12 reconverged correction does not reset ordinary history');
  assert.deepEqual(reconverged.ordinaryAttemptIds, ['A1', 'A2', 'A3']);
  assert.deepEqual(reconverged.wdcAttemptIds, ['WDC-1']);
  assert.deepEqual(reconverged.reconvergedAttemptIds, ['RC-1']);
  assert.equal(evaluateD1AttemptEvent({ kind: 'RECONVERGED_CORRECTION', attemptId: 'RC-2', rootFamilyKey,
    authority: 'EXPLICIT_RECONVERGED_AUTHORITY' }, { rootLedgerReadback: reconvergedLedger.rootLedgerReadback }).hold, true,
    'R12 exceptional history requires an exact current authority readback');
  const forgedWdc = s1aClone(D1_ORACLE_WDC_AUTHORITY);
  forgedWdc.rootFamilyKey = 'family:renamed';
  forgedWdc.digest = s1aHashWithoutField(forgedWdc, 'digest');
  assert.equal(evaluateD1AttemptEvent({ kind: 'WDC', attemptId: 'WDC-1', rootFamilyKey: 'family:renamed',
    authorityReadback: forgedWdc }, { rootLedgerReadback: wdcLedger.rootLedgerReadback }).hold, true,
    'R11 a rehashed authority for another root cannot reset history');
});
test('D1 root-accounting false-green controls reject rename/split/merge and history resets', () => {
  const prior = ['A1', 'A2', 'A3'];
  const priorFive = ['A1', 'A2', 'A3', 'A4', 'A5'];
  const renamedRecord = d1RootRecord('root:renamed-zero', 'cause:known', []);
  const stableFamily = d1StableRootFamilyKey(renamedRecord);
  const renamedFiveProgressReadback = d1RootProgressReadback(stableFamily, 5);
  const renamedFourProgressReadback = d1RootProgressReadback(stableFamily, 4);
  const renamedZero = d1EvaluateRootRecords([renamedRecord], {
    previouslyAddressedFamilies: [stableFamily],
    priorAttemptAttributionByFamily: { [stableFamily]: priorFive },
    historicalEpisodeAttemptIds: priorFive,
    narrowingProgressByFamily: { [stableFamily]: true },
    narrowingProgressReadbacksByFamily: { [stableFamily]: {
      4: renamedFourProgressReadback, 5: renamedFiveProgressReadback
    } }
  });
  assert.equal(renamedZero.rootGroups[0].attemptsConsumed, 5, 'renaming a family with five historical attempts cannot return it to zero');
  assert.equal(renamedZero.ok, true, 'all five attempts remain valid only with bound progress evidence');
  const oldCausalFamily = d1RootRecord('root:known-closed', 'cause:known', priorFive, { state: 'CLOSED' });
  const renamedFamily = d1RootRecord('root:renamed-family', 'cause:new', [], { newlyDiscovered: true });
  const renamedFamilyKey = d1StableRootFamilyKey(renamedFamily);
  const oldCausalFamilyKey = d1StableRootFamilyKey(oldCausalFamily);
  const orphanedOrdinaryHistory = makeD1RootLedgerAuthority([
    d1RootRecord('root:relabelled-one-attempt', 'cause:new-label', ['A1'])
  ], { historicalEpisodeAttemptIds: priorFive });
  assert.equal(evaluateD1RootLedger(orphanedOrdinaryHistory.rootLedgerReadback.currentRecords,
    { rootLedgerReadback: orphanedOrdinaryHistory.rootLedgerReadback }).ok, false,
    'ordinary episode attempts cannot become orphaned when a root is relabelled');
  assert.equal(evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A6',
    rootFamilyKey: d1StableRootFamilyKey(d1RootRecord('root:relabelled-one-attempt', 'cause:new-label', [])) },
  { rootLedgerReadback: orphanedOrdinaryHistory.rootLedgerReadback }).hold, true,
  'an A6 correction holds when the authoritative ledger does not attribute A1-A5 to stable root families');

  const relabelledCurrentRecord = d1RootRecord('root:relabelled-current', 'cause:new-label', ['A6'], { newlyDiscovered: true });
  const relabelledCurrentLedger = makeD1RootLedgerAuthority([relabelledCurrentRecord], {
    historicalEpisodeAttemptIds: [...priorFive, 'A6'], previouslyAddressedFamilies: [oldCausalFamilyKey],
    priorAttemptAttributionByFamily: { [oldCausalFamilyKey]: priorFive }
  });
  assert.equal(evaluateD1RootLedger(relabelledCurrentLedger.rootLedgerReadback.currentRecords,
    { rootLedgerReadback: relabelledCurrentLedger.rootLedgerReadback }).ok, false,
    'a new causal label with A6 already attributed still requires the prior-attribution audit');
  const relabelledA7 = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A7',
    rootFamilyKey: D1_ORACLE_RELABELED_ROOT_FAMILY_KEY, findingId: 'finding:relabelled-current',
    classificationReadback: D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
      item.findingId === 'finding:relabelled-current') },
  { rootLedgerReadback: relabelledCurrentLedger.rootLedgerReadback });
  assert.equal(relabelledA7.hold, true, 'a relabelled A1-A5 family cannot admit A7 as attempt 2');

  const relabelledFalseFlagRecord = d1RootRecord('root:relabelled-current', 'cause:new-label', ['A6']);
  const relabelledFalseFlagLedger = makeD1RootLedgerAuthority([relabelledFalseFlagRecord], {
    historicalEpisodeAttemptIds: [...priorFive, 'A6'], previouslyAddressedFamilies: [oldCausalFamilyKey],
    priorAttemptAttributionByFamily: { [oldCausalFamilyKey]: priorFive }
  });
  assert.equal(evaluateD1RootLedger(relabelledFalseFlagLedger.rootLedgerReadback.currentRecords,
    { rootLedgerReadback: relabelledFalseFlagLedger.rootLedgerReadback }).ok, false,
    'a family missing from complete prior attribution cannot use EXISTING_ROOT when NEW_ROOT_DISCOVERED is false');
  const relabelledFalseFlagA7 = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A7',
    rootFamilyKey: D1_ORACLE_RELABELED_ROOT_FAMILY_KEY, findingId: 'finding:relabelled-current',
    classificationReadback: D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
      item.findingId === 'finding:relabelled-current') },
  { rootLedgerReadback: relabelledFalseFlagLedger.rootLedgerReadback });
  assert.equal(relabelledFalseFlagA7.hold, true);
  assert.equal(relabelledFalseFlagA7.productAttempt, false,
    'an unrecorded causal family with the new-root flag false cannot admit A7 after A1-A6');
  const relabelledListedFalseFlagLedger = makeD1RootLedgerAuthority([relabelledFalseFlagRecord], {
    historicalEpisodeAttemptIds: [...priorFive, 'A6'],
    previouslyAddressedFamilies: [oldCausalFamilyKey, D1_ORACLE_RELABELED_ROOT_FAMILY_KEY],
    priorAttemptAttributionByFamily: { [oldCausalFamilyKey]: priorFive }
  });
  assert.equal(evaluateD1RootLedger(relabelledListedFalseFlagLedger.rootLedgerReadback.currentRecords,
    { rootLedgerReadback: relabelledListedFalseFlagLedger.rootLedgerReadback }).ok, false,
    'previouslyAddressedFamilies membership alone cannot establish exact prior attempt debt for a relabelled family');
  const relabelledListedFalseFlagA7 = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A7',
    rootFamilyKey: D1_ORACLE_RELABELED_ROOT_FAMILY_KEY, findingId: 'finding:relabelled-current',
    classificationReadback: D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
      item.findingId === 'finding:relabelled-current') },
  { rootLedgerReadback: relabelledListedFalseFlagLedger.rootLedgerReadback });
  assert.equal(relabelledListedFalseFlagA7.hold, true);
  assert.equal(relabelledListedFalseFlagA7.productAttempt, false);

  const forgedLedger = makeD1RootLedgerAuthority([oldCausalFamily, renamedFamily], {
    attributionAuditComplete: true, includeUntouchedRootAudit: true, historicalEpisodeAttemptIds: priorFive,
    previouslyAddressedFamilies: [oldCausalFamilyKey], verifiedUntouchedRootFamilies: [renamedFamilyKey],
    priorAttemptAttributionByFamily: { [oldCausalFamilyKey]: priorFive },
    narrowingProgressByFamily: { [oldCausalFamilyKey]: true }
  });
  const forgedAuditCore = {
    ...D1_ORACLE_ZERO_ROOT_PRIOR_ATTRIBUTION_AUDIT_CORE,
    rootFamilyKey: renamedFamilyKey,
    historicalEpisodeAttemptIds: priorFive,
    previouslyAddressedFamilies: [oldCausalFamilyKey]
  };
  forgedLedger.rootLedgerReadback.zeroRootPriorAttributionAuditReadback = {
    ...forgedAuditCore, digest: s1aHashRecord(forgedAuditCore)
  };
  const forgedLedgerCore = { ...forgedLedger.rootLedgerReadback };
  delete forgedLedgerCore.digest;
  forgedLedger.rootLedgerReadback.digest = s1aHashRecord(forgedLedgerCore);
  forgedLedger.trustedRootLedgerSnapshot = s1aClone(forgedLedgerCore);
  assert.equal(evaluateD1RootLedger([oldCausalFamily, renamedFamily], forgedLedger).ok, false,
    'a caller-built, rehashed untouched claim cannot reset a previously attempted causal family under a renamed boundary');
  assert.equal(d1EvaluateRootRecords([renamedRecord]).ok, false, 'missing authoritative root-ledger readback is not a green');
  assert.equal(evaluateD1RootLedger([renamedRecord], {
    priorAttributionAuditComplete: true, previouslyAddressedFamilies: ['cause:known'],
    priorAttemptAttributionByFamily: { 'cause:known': priorFive }, historicalEpisodeAttemptIds: priorFive
  }).ok, false, 'legacy caller booleans and renamed-family labels cannot substitute for the current source readback');
  const boundRecord = d1RootRecord('root:bound', 'cause:bound', ['A1']);
  const boundAuthority = makeD1RootLedgerAuthority([boundRecord], { historicalEpisodeAttemptIds: ['A1'] });
  boundAuthority.rootLedgerReadback.historicalEpisodeAttemptIds.push('A2');
  boundAuthority.rootLedgerReadback.digest = s1aHashWithoutField(boundAuthority.rootLedgerReadback, 'digest');
  assert.equal(evaluateD1RootLedger([boundRecord], boundAuthority).ok, false,
    'a self-consistent rehash cannot replace the separately trusted current episode ledger');

  const split = d1EvaluateRootRecords([
    d1RootRecord('root:split-1', 'cause:one', ['A1']),
    d1RootRecord('root:split-2', 'cause:one', ['A2', 'A3'])
  ], { historicalEpisodeAttemptIds: prior });
  assert.equal(split.rootGroups.length, 1, 'R08 root splitting cannot create fresh budgets');
  assert.equal(split.rootGroups[0].attemptsConsumed, 3);

  const duplicateIds = d1EvaluateRootRecords([
    d1RootRecord('root:duplicate', 'cause:duplicate', ['A1', 'A1'], { declaredAttempts: 2 })
  ]);
  assert.equal(duplicateIds.ok, false, 'duplicate attempt IDs cannot inflate or satisfy a root count');
  const repeatedReadback = D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
    item.classification === 'CROSS_ROOT_INTERACTION' && item.repeatedCrossRootReopening);
  const automaticInteraction = evaluateD1RootClassification('CROSS_ROOT_INTERACTION', repeatedReadback);
  assert.equal(automaticInteraction.createsBudget, false, 'cross-root interaction cannot mint automatic budget');
  const routeFor = (classification) => D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
    item.classification === classification);
  assert.equal(evaluateD1RootClassification('G1_ROOT_TRUST_CHANGE', routeFor('G1_ROOT_TRUST_CHANGE')).disposition, 'G1_RECONVERGENCE');
  assert.equal(evaluateD1RootClassification('G2_CONTRACT_GAP', routeFor('G2_CONTRACT_GAP')).disposition, 'TARGETED_G2_REENTRY');
  assert.equal(evaluateD1RootClassification('NON_PRODUCT_BLOCKER', routeFor('NON_PRODUCT_BLOCKER')).disposition, 'NON_PRODUCT_HOLD');
  assert.equal(evaluateD1RootClassification('UNKNOWN').disposition, 'HOLD_MISSING_CURRENT_CLASSIFICATION_READBACK');

  const mixedLedger = makeD1AttemptLedger({ ordinaryAttemptIds: prior, wdcAttemptIds: ['WDC-1'], reconvergedAttemptIds: ['RC-1'] });
  const nonProduct = evaluateD1AttemptEvent({ kind: 'NON_PRODUCT_HOLD_RECOVERY', attemptId: 'HOLD-1',
    rootFamilyKey: D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY, candidateReadback: D1_ORACLE_NON_PRODUCT_CANDIDATE_READBACK,
    attemptClassificationReadback: D1_ORACLE_NON_PRODUCT_ATTEMPT_READBACKS[0] },
  { rootLedgerReadback: mixedLedger.rootLedgerReadback });
  assert.deepEqual(nonProduct.ordinaryAttemptIds, prior);
  assert.deepEqual(nonProduct.wdcAttemptIds, ['WDC-1']);
  assert.deepEqual(nonProduct.reconvergedAttemptIds, ['RC-1'], 'non-product recovery cannot reset WDC/reconverged history');
  assert.equal(nonProduct.productAttempt, false);
  const sixth = d1EvaluateRootRecords([d1RootRecord('root:ceiling', 'cause:ceiling',
    ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])], { historicalEpisodeAttemptIds: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
    narrowingProgressByFamily: { [d1StableRootFamilyKey(d1RootRecord('root:ceiling', 'cause:ceiling', []))]: true } });
  assert.equal(sixth.ok, false, 'root ledger rejects a sixth ordinary attempt');
  const rootFamilyKey = D1_ORACLE_ATTEMPT_ROOT_FAMILY_KEY;
  const progressFourForFiveLedger = d1RootProgressReadback(rootFamilyKey, 4);
  const progressFive = d1RootProgressReadback(rootFamilyKey, 5);
  const fiveAttemptLedgerA5Only = d1EvaluateRootRecords([
    d1RootRecord('root:attempt-family-1', 'attempt-family-1', ['A1', 'A2', 'A3', 'A4', 'A5'],
      { causalBoundary: 'boundary:attempt-family-1' })
  ], {
    historicalEpisodeAttemptIds: ['A1', 'A2', 'A3', 'A4', 'A5'],
    narrowingProgressByFamily: { [rootFamilyKey]: true },
    narrowingProgressReadbacksByFamily: { [rootFamilyKey]: { 5: progressFive } }
  });
  assert.equal(fiveAttemptLedgerA5Only.ok, false,
    'an A5 receipt cannot substitute for the separately required A4 receipt');
  const fiveAttemptLedgerA4Only = d1EvaluateRootRecords([
    d1RootRecord('root:attempt-family-1', 'attempt-family-1', ['A1', 'A2', 'A3', 'A4', 'A5'],
      { causalBoundary: 'boundary:attempt-family-1' })
  ], {
    historicalEpisodeAttemptIds: ['A1', 'A2', 'A3', 'A4', 'A5'],
    narrowingProgressByFamily: { [rootFamilyKey]: true },
    narrowingProgressReadbacksByFamily: { [rootFamilyKey]: { 4: progressFourForFiveLedger } }
  });
  assert.equal(fiveAttemptLedgerA4Only.ok, false,
    'an A4 receipt cannot substitute for the separately required A5 receipt');
  const fiveAttemptLedger = makeD1AttemptLedger({ ordinaryAttemptIds: ['A1', 'A2', 'A3', 'A4', 'A5'],
    narrowingProgressByFamily: { [rootFamilyKey]: true },
    narrowingProgressReadbacksByFamily: { [rootFamilyKey]: { 4: progressFourForFiveLedger, 5: progressFive } } });
  const existingRootClassification = D1_ORACLE_ROOT_CLASSIFICATION_READBACK_CORES.find((item) =>
    item.classification === 'EXISTING_ROOT');
  assert.equal(evaluateD1RootLedger(fiveAttemptLedger.rootLedgerReadback.currentRecords,
    { rootLedgerReadback: fiveAttemptLedger.rootLedgerReadback }).ok, true,
    'recorded attempt 5 retains its exact bound progress receipt');
  const sixthEvent = evaluateD1AttemptEvent({ kind: 'G3_PRODUCT_CORRECTION', attemptId: 'A6', rootFamilyKey,
    findingId: 'finding:existing-root', classificationReadback: existingRootClassification },
    { ordinaryAttemptIds: [], rootLedgerReadback: fiveAttemptLedger.rootLedgerReadback });
  assert.equal(sixthEvent.hold, true, 'event observer derives five prior attempts from the current ledger even when caller arrays are empty');
  assert.equal(evaluateD1AttemptEvent({ kind: 'UNRECOGNISED', attemptId: 'X1', rootFamilyKey },
    { rootLedgerReadback: fiveAttemptLedger.rootLedgerReadback }).hold, true, 'unknown attempt event kinds hold');
});

test('D1 binary post-child assurance scenarios P01-P16 require reconciliation or both reviews', () => {
  const policy = parseS1aPolicyContract(architecture);
  const p01 = makeD1PostChildScenario();
  p01.reviews = [];
  p01.trace = [];
  delete p01.reviewRouteAuthority;
  p01.requestedMode = 'RECONCILE_ONLY';
  const p02 = makeD1PostChildScenario({ checkMembershipOptions: {
    changedPaths: ['repo/CONTROLLER.md', 'repo/ARCHITECTURE.md']
  } });
  p02.reviews = [];
  p02.trace = [];
  delete p02.reviewRouteAuthority;
  const p03 = makeD1PostChildScenario({ historyShape: ['many commits', 'reordered labels', 'old worker retries'] });
  p03.reviews = [];
  p03.trace = [];
  delete p03.reviewRouteAuthority;
  const p04 = makeD1PostChildScenario({ assuredChildTree: 'assured:prior-tree' });
  const p05 = makeD1PostChildScenario({ unassuredConcurrentOrMultiChildComposition: true });
  const p06 = makeD1PostChildScenario({ conflictResolutionSemanticDelta: true });
  const p07 = makeD1PostChildScenario({ materialIntegrationUncertainty: true, dualSnapshotBindable: false });
  const p08 = makeD1PostChildScenario({ materialRootTrustAuthorityIntegrationOutsideAssuredTree: true });
  const p09 = makeD1PostChildScenario({ finalityOverrides: { finalDeliveryChild: true } });
  const p10 = makeD1PostChildScenario({ materialIntegrationUncertainty: true, reviewerAvailability: { A: true, B: false } });
  const p11 = makeD1PostChildScenario({ checkpointKind: 'SUPPORTING_PR' });
  const p12 = makeD1PostChildScenario({
    checkMembershipOptions: { includePremergeCodeql: true, childRequiredChecks: ['integration', 'policy', 'codeql'] }
  });
  const p13 = makeD1PostChildScenario({ checkMembershipOptions: { omitCheckId: 'check:policy' } });
  const p14 = makeD1PostChildScenario({ checkMembershipOptions: { resultConclusion: 'PENDING' } });
  const p15 = makeD1PostChildScenario({ emptyMergeCheckMembership: true });
  const p16Missing = makeD1PostChildScenario();
  delete p16Missing.conflictResolutionSemanticDelta;
  const cases = [
    ['P01', p01, 'PASS', 'RECONCILE_ONLY'], ['P02', p02, 'PASS', 'RECONCILE_ONLY'],
    ['P03', p03, 'PASS', 'RECONCILE_ONLY'], ['P04', p04, 'PASS', 'DUAL_MAX'],
    ['P05', p05, 'PASS', 'DUAL_MAX'], ['P06', p06, 'PASS', 'DUAL_MAX'],
    ['P07', p07, 'HOLD', 'DUAL_MAX'], ['P08', p08, 'PASS', 'DUAL_MAX'],
    ['P09', p09, 'PASS', 'DUAL_MAX'], ['P10', p10, 'HOLD', 'DUAL_MAX'],
    ['P11', p11, 'NO_CHECKPOINT', null], ['P12', p12, 'PASS', 'RECONCILE_ONLY'],
    ['P13', p13, 'HOLD', null], ['P14', p14, 'BLOCKED', null],
    ['P15', p15, 'PASS', 'RECONCILE_ONLY'], ['P16', p16Missing, 'HOLD', null]
  ];
  for (const [id, scenario, expectedOutcome, expectedMode] of cases) {
    const result = evaluateD1PostChildAssurance(policy, scenario);
    assert.equal(result.outcome, expectedOutcome, id + ' outcome: ' + result.failures.join(','));
    if (expectedMode) assert.equal(result.mode, expectedMode, id + ' mode');
  }
  assert.equal(p12.checkMembership.configuration.some((check) => check.checkId === 'check:codeql' && check.phase === 'PREMERGE_ONLY'),
    true, 'P12 retains the premerge-only CodeQL configuration fact');
  assert.equal(evaluateD1MergeCheckMembership(p12.checkMembership).expected.some((check) => check.checkId === 'check:codeql'),
    false, 'P12 does not fabricate a missing merge-triggered CodeQL check');
  const missingReceipt = makeD1PostChildScenario();
  missingReceipt.receiptInventory.complete = false;
  assert.equal(evaluateD1PostChildAssurance(policy, missingReceipt).outcome, 'HOLD',
    'RECONCILE_ONLY cannot bypass missing shared receipt membership');
  const missingFinality = makeD1PostChildScenario();
  delete missingFinality.finalityDependencyReadback;
  assert.equal(evaluateD1PostChildAssurance(policy, missingFinality).outcome, 'HOLD',
    'RECONCILE_ONLY cannot bypass missing finality/dependency readback');
  const contradictoryPredicate = makeD1PostChildScenario();
  contradictoryPredicate.conflictResolutionSemanticDelta = true;
  assert.equal(evaluateD1PostChildAssurance(policy, contradictoryPredicate).outcome, 'HOLD',
    'caller predicate cannot change reconciliation mode without a matching independent readback');
  const missingPredicateReadback = makeD1PostChildScenario();
  delete missingPredicateReadback.integrationPredicateReadback;
  assert.equal(evaluateD1PostChildAssurance(policy, p15).outcome, 'PASS',
    'a full checkpoint accepts provably empty merge-check membership without inventing a check');
  const directEmptyChild = makeD1PostChildScenario({ emptyMergeCheckMembership: true });
  directEmptyChild.assuranceMode = 'RECONCILE_ONLY';
  directEmptyChild.reviews = [];
  directEmptyChild.trace = [];
  delete directEmptyChild.reviewRouteAuthority;
  directEmptyChild.d1CheckMembershipProof = { status: 'GREEN', expected: [] };
  assert.equal(evaluateS1aPostChildReview(policy, directEmptyChild).ok, false,
    'a caller-created D1 proof cannot bypass the fixed S1-A child/check inventory');
  directEmptyChild.d1CheckMembershipProof = evaluateD1MergeCheckMembership(
    makeD1CheckMembership({ emptyMembership: true }));
  assert.equal(evaluateS1aPostChildReview(policy, directEmptyChild).ok, false,
    'a standalone membership result is not the wrapper-only S1-A proof');
  assert.equal(evaluateD1PostChildAssurance(policy, missingPredicateReadback).outcome, 'HOLD',
    'missing composition/conflict/root-trust/uncertainty predicates never default false');
  const forgedSupporting = makeD1PostChildScenario();
  forgedSupporting.checkpointKind = 'SUPPORTING_PR';
  forgedSupporting.trigger = 'SUPPORTING_PR';
  forgedSupporting.finalityDependencyReadback.checkpointKind = 'SUPPORTING_PR';
  forgedSupporting.finalityDependencyReadback.mergeReceiptId = null;
  forgedSupporting.finalityDependencyReadback.digest = s1aHashWithoutField(forgedSupporting.finalityDependencyReadback, 'digest');
  const forgedSupportingFinalityCore = { ...forgedSupporting.finalityDependencyReadback };
  delete forgedSupportingFinalityCore.digest;
  forgedSupporting.trustedFinalityDependencySnapshot = s1aClone(forgedSupportingFinalityCore);
  assert.equal(evaluateD1PostChildAssurance(policy, forgedSupporting).outcome, 'HOLD',
    'a final merge cannot be relabelled SUPPORTING_PR by changing caller and finality labels while its canonical event remains final');
  const forgedComposition = makeD1PostChildScenario({ unassuredConcurrentOrMultiChildComposition: true });
  forgedComposition.unassuredConcurrentOrMultiChildComposition = false;
  forgedComposition.integrationPredicateReadback.unassuredConcurrentOrMultiChildComposition = false;
  forgedComposition.integrationPredicateReadback.digest = s1aHashWithoutField(forgedComposition.integrationPredicateReadback, 'digest');
  forgedComposition.trustedIntegrationPredicateSnapshot.unassuredConcurrentOrMultiChildComposition = false;
  assert.equal(evaluateD1PostChildAssurance(policy, forgedComposition).outcome, 'HOLD',
    'coherently rehashed caller and trusted snapshots cannot erase unassured composition');
});
test('D1 merge-check membership is configuration-derived and rejects false-green controls', () => {
  const base = makeD1CheckMembership();
  const expected = base.configuration.map(d1CheckIdentity).sort();
  const greensOnly = { ...base, claimedExpectedMembership: [d1CheckIdentity(base.results[0])] };
  assert.equal(evaluateD1MergeCheckMembership(greensOnly).status, 'HOLD',
    'greens-only membership cannot omit the configured expected check');
  const coOmitted = { ...base, claimedExpectedMembership: [expected[0]], results: [base.results[0]] };
  assert.equal(evaluateD1MergeCheckMembership(coOmitted).status, 'HOLD',
    'a check cannot be co-omitted from membership and results');
  const wrongProducer = s1aClone(base);
  wrongProducer.results[0].producerId = 'untrusted/other-producer';
  assert.equal(evaluateD1MergeCheckMembership(wrongProducer).status, 'HOLD',
    'same display name from the wrong producer is not a substitute');
  for (const conclusion of ['SKIPPED', 'CANCELLED', 'FAILURE']) {
    const dependency = makeD1CheckMembership({ resultConclusion: conclusion, markNotApplicable: true });
    assert.equal(evaluateD1MergeCheckMembership(dependency).status, 'BLOCKED',
      conclusion + ' dependency cannot be treated as not applicable');
  }
  const ambiguousMatrix = { ...base, ambiguousMatrixExpansion: true };
  assert.equal(evaluateD1MergeCheckMembership(ambiguousMatrix).status, 'HOLD');
  const stalePredecessor = s1aClone(base);
  stalePredecessor.results[0].eventIdentity = 'event:predecessor';
  assert.equal(evaluateD1MergeCheckMembership(stalePredecessor).status, 'HOLD',
    'a stale successful predecessor is not the current event result');
  const missingIdentity = s1aClone(base);
  delete missingIdentity.configuration[0].workflowRevision;
  assert.equal(evaluateD1MergeCheckMembership(missingIdentity).status, 'HOLD',
    'every producer/workflow/revision/check/matrix/event/trigger/head identity is required');
  assert.equal(evaluateD1MergeCheckMembership(makeD1CheckMembership({ headSha: 'head:foreign' })).status, 'HOLD',
    'check membership head must match the exact integrated child commit');
  assert.equal(evaluateD1MergeCheckMembership(makeD1CheckMembership({ triggerId: 'delivery:predecessor' })).status, 'HOLD',
    'a predecessor trigger cannot supply current terminal checks');
  const oldRunId = s1aClone(base);
  oldRunId.results[0].runId = 'run:old-success';
  oldRunId.latestRunReadback.results[0].runId = 'run:old-success';
  oldRunId.latestRunReadback.digest = s1aHashWithoutField(oldRunId.latestRunReadback, 'digest');
  assert.equal(evaluateD1MergeCheckMembership(oldRunId).status, 'HOLD',
    'a rehashed same-event predecessor cannot replace the current canonical latest run');
  const optionalFirstParty = makeD1CheckMembership({ includeOptionalFirstPartyCheck: true,
    omitCheckId: 'check:optional-first-party' });
  assert.equal(evaluateD1MergeCheckMembership(optionalFirstParty).status, 'HOLD',
    'an enabled triggered first-party check remains expected even when requiredAtMerge is false');
  const newProducer = makeD1CheckMembership({ includeNewFirstPartyCheck: true,
    omitCheckId: 'check:new-first-party' });
  const newProducerResult = evaluateD1MergeCheckMembership(newProducer);
  assert.equal(newProducerResult.status, 'HOLD',
    'an enabled first-party producer is derived from current configuration metadata, not a fixed producer allowlist');
  assert.ok(newProducerResult.expected.some((check) => check.checkId === 'check:new-first-party'),
    'a newly configured first-party producer is part of expected membership even when its result is omitted');
  const greenNewProducer = evaluateD1MergeCheckMembership(makeD1CheckMembership({ includeNewFirstPartyCheck: true }));
  assert.equal(greenNewProducer.status, 'GREEN',
    'a newly configured first-party producer passes when its independently read-back terminal result is green');
  const staleEventCoOmitted = makeD1CheckMembership({
    includeNewFirstPartyCheck: true,
    staleEventIdentityCheckId: 'check:new-first-party',
    omitCheckIdFromInventories: 'check:new-first-party'
  });
  const staleEventResult = evaluateD1MergeCheckMembership(staleEventCoOmitted);
  assert.equal(staleEventResult.status, 'HOLD',
    'an otherwise-applicable enabled check with stale event identity cannot be co-omitted from inventories and results');
  assert.ok(staleEventResult.failures.includes('CHECK_CONFIGURATION_EVENT_IDENTITY_MISMATCH:check:new-first-party'));
  const staleIdentityOnNonApplicableEvent = makeD1CheckMembership({
    includeNewFirstPartyCheck: true,
    staleEventIdentityCheckId: 'check:new-first-party',
    nonApplicableEventCheckId: 'check:new-first-party',
    omitCheckIdFromInventories: 'check:new-first-party'
  });
  const nonApplicableEventResult = evaluateD1MergeCheckMembership(staleIdentityOnNonApplicableEvent);
  assert.equal(nonApplicableEventResult.status, 'GREEN',
    'a check outside current event applicability is not made expected by a stale identity');
  assert.equal(nonApplicableEventResult.expected.some((check) => check.checkId === 'check:new-first-party'), false);
  const disabledChildRequired = makeD1CheckMembership({
    disabledCheckId: 'check:policy',
    omitCheckIdFromInventories: 'check:policy'
  });
  const disabledChildRequiredResult = evaluateD1MergeCheckMembership(disabledChildRequired);
  assert.equal(disabledChildRequiredResult.status, 'HOLD',
    'a disabled child-required merge check cannot disappear from membership');
  assert.ok(disabledChildRequiredResult.failures.includes('REQUIRED_MERGE_CHECK_DISABLED:check:policy'));
  const staleConfigSnapshot = s1aClone(base);
  staleConfigSnapshot.configurationReadback.configuration[0].workflowRevision = 'workflow:attacker';
  staleConfigSnapshot.configurationReadback.digest = s1aHashWithoutField(staleConfigSnapshot.configurationReadback, 'digest');
  assert.equal(evaluateD1MergeCheckMembership(staleConfigSnapshot).status, 'HOLD',
    'rehashing a caller-mutated configuration cannot replace the trusted current snapshot');
  const changedAfterFreeze = makeD1CheckMembership({ configurationRevision: 'configuration:10',
    frozenConfigurationRevision: 'configuration:9', configurationChangesAfterFreeze: ['new:applicable-check'] });
  assert.equal(evaluateD1MergeCheckMembership(changedAfterFreeze).status, 'HOLD',
    'a newly applicable configuration after freeze invalidates membership');
  const bareEmpty = evaluateD1MergeCheckMembership({
    configurationComplete: true, configurationRevision: 'configuration:empty',
    frozenConfigurationRevision: 'configuration:empty', configurationChangesAfterFreeze: [],
    membershipFreezePoint: 'BEFORE_RESULT_ADJUDICATION', ambiguousMatrixExpansion: false,
    configuration: [], childRequiredChecks: [], results: [], claimedExpectedMembership: []
  });
  assert.equal(bareEmpty.status, 'HOLD', 'caller-supplied empty arrays are not authoritative proof');
  const provenEmpty = evaluateD1MergeCheckMembership(makeD1CheckMembership({ emptyMembership: true }));
  assert.equal(provenEmpty.status, 'GREEN', 'empty membership is valid only with complete authoritative readbacks and matching inventories');
  assert.deepEqual(provenEmpty.expected, [], 'empty membership does not invent checks');
});

test('D1 post-child law retains the six-control source-sensitivity pattern', () => {
  const policy = parseS1aPolicyContract(architecture);
  const positive = makeD1PostChildScenario();
  const missingMembershipReadback = makeD1PostChildScenario();
  delete missingMembershipReadback.checkMembership;
  assert.equal(evaluateD1PostChildAssurance(policy, missingMembershipReadback).outcome, 'HOLD',
    'missing check-membership readback holds without throwing');
  positive.assuranceMode = 'RECONCILE_ONLY';
  positive.reviews = [];
  positive.trace = [];
  delete positive.reviewRouteAuthority;
  assert.equal(evaluateD1PostChildAssurance(policy, positive).outcome, 'PASS', 'positive exact reconciliation');
  const missingBoundInventory = makeD1PostChildScenario();
  delete missingBoundInventory.checkInventory;
  assert.equal(evaluateD1PostChildAssurance(policy, missingBoundInventory).outcome, 'HOLD',
    'missing check inventory returns HOLD before any property dereference');
  const missingReviewMembership = makeD1PostChildScenario();
  delete missingReviewMembership.reviewSnapshot.applicableIntegratedCheckIds;
  assert.equal(evaluateD1PostChildAssurance(policy, missingReviewMembership).outcome, 'HOLD',
    'missing review-snapshot inventory returns HOLD');

  const invalid = makeD1PostChildScenario({ assuredChildTree: 'assured:prior-tree', requestedMode: 'RECONCILE_ONLY' });
  assert.equal(evaluateD1PostChildAssurance(policy, invalid).outcome, 'HOLD',
    'invalid forced reconcile mode is rejected when the tree differs');

  const machineWeakening = rewriteS1aPolicy(architecture, (next) => {
    next.postChildReview.modeSelection.reconcileOnlyRequiredPredicates =
      next.postChildReview.modeSelection.reconcileOnlyRequiredPredicates.filter((item) => item !== 'NOT_FINAL_DELIVERY_CHILD');
  });
  assert.throws(() => parseS1aPolicyContract(machineWeakening), /post-child modes and triggers/,
    'machine weakening is rejected by the fixed oracle');

  const canonicalClause = 'Selecting `RECONCILE_ONLY` never bypasses a missing or stale shared prerequisite.';
  const weakenedClause = '`RECONCILE_ONLY` may bypass shared readbacks when trees match.';
  const proseWeakening = architecture.replace(canonicalClause, weakenedClause);
  assert.throws(() => parseS1aPolicyContract(proseWeakening), /post-child prose/,
    'prose polarity weakening is rejected');

  const contradiction = architecture.replace('### Bounded non-product continuation',
    'Contradiction: `RECONCILE_ONLY` may bypass shared readbacks when trees match.\n\n### Bounded non-product continuation');
  assert.throws(() => parseS1aPolicyContract(contradiction), /post-child prose/,
    'appended contradictory prose is rejected');

  const equivalentClause = 'Once all shared prerequisites pass, `RECONCILE_ONLY` may omit only reviewer work.';
  const equivalent = architecture.replace(canonicalClause, equivalentClause);
  assert.notEqual(equivalent, architecture);
  assert.equal(s1aGovernedHumanPolicyDigest(equivalent), S1A_ORACLE_GOVERNED_PROSE_SHA256,
    'semantics-preserving wording normalizes to the same governed digest');
  assert.doesNotThrow(() => parseS1aPolicyContract(equivalent));

  const coherentWeakening = rewriteS1aPolicy(architecture, (next) => {
    next.postChildReview.modeSelection.treeEqualityIsSufficientByItself = true;
  }).replace(canonicalClause, weakenedClause);
  const reboundDigest = s1aGovernedHumanPolicyDigest(coherentWeakening);
  assert.notEqual(reboundDigest, S1A_ORACLE_GOVERNED_PROSE_SHA256,
    'coherent weakening changes the governed prose digest');
  assert.throws(() => parseS1aPolicyContract(coherentWeakening), /post-child modes and triggers/,
    'recomputing/rebinding a digest does not make machine or semantic weakening pass');
});

test('D1 owner fences keep discovery/runtime and effect authority with their accepted owners', () => {
  for (const [owner, boundary] of [
    ['A1', 'Route registration/resolution, including concrete `G0.discovery`.'],
    ['C2', 'CURRENT, packets, discovery-basis receipts, durable root ledger, post-child checkpoint runtime.'],
    ['H', 'Host/browser/computer/native qualification.'],
    ['X1', 'Secret References and Private Custody.'],
    ['X2', 'Sensitive-File Access Guard.'],
    ['X3', 'External Operation Authority and effectful probes.'],
    ['X4', 'Privacy-Safe Operational Evidence.'],
    ['W2', 'Temporary workspace lifecycle.'],
    ['D1', 'Semantics and deterministic policy oracles only.']
  ]) {
    assert.ok(architecture.includes('| ' + owner + ' | ' + boundary + ' |'), owner + ' fence');
  }
});
