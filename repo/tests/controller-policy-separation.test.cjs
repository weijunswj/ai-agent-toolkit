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

const requiredRoutes = ['G0-A', 'G0-B', 'G1', 'G2', 'G2_ESCALATED', 'G3', 'G4', 'LOOP', 'RECONVERGENCE', 'FINAL_AUDIT', 'BROWSER'];

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
    }
    for (const route of Object.values(stack.subagents)) {
      if (route) {
        assert.equal(controller.includes(route.model), false, `subagent model leaked into Controller law: ${route.model}`);
        assert.equal(architecture.includes(route.model), false, `subagent model leaked into Architecture law: ${route.model}`);
      }
    }
  }
});

test('stack registry has explicit complete symbolic routes and only G0-B/G3 subagent bindings', () => {
  assert.equal(registry.schema, 'toolkit.controller.stack-registry.v2');
  assert.equal(registry.version, 2);
  for (const [stackId, stack] of Object.entries(registry.stacks)) {
    assert.deepEqual(Object.keys(stack.routes).sort(), [...requiredRoutes].sort(), stackId);
    assert.deepEqual(Object.keys(stack.subagents).sort(), ['G0-B', 'G3'], stackId);
    for (const route of Object.values(stack.routes)) {
      assert.equal(typeof route.provider, 'string');
      assert.ok(route.provider.length > 0);
      assert.equal(typeof route.model, 'string');
      assert.ok(route.model.length > 0);
      assert.equal(typeof route.reasoning, 'string');
      assert.ok(route.reasoning.length > 0);
    }
  }
});

test('named stacks support explicit cross-harness selection without harness authority', () => {
  for (const stackId of ['owner-openai-default', 'owner-claude']) {
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

test('root workers never self-verify model identity while G0-B/G3 parents configure child routes before launch', () => {
  assert.match(controller, /Root execution threads are bound.*out of band by User\/Web\/controller\/harness before launch or adoption/s);
  assert.match(controller, /root semantic worker must never resolve, inspect, verify, attest, compare, reject, or HOLD on its own provider\/model\/reasoning identity/i);
  assert.match(controller, /regardless of whether the harness exposes model metadata/i);
  assert.match(controller, /inability to introspect its own model can never create either HOLD/i);
  assert.doesNotMatch(controller, /current harness cannot launch and verify it/i);
  assert.match(controller, /Only `G0-B` and `G3` may resolve semantic subagent routes/);
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
  assert.equal(claude.routes['G0-A'].reasoning, 'high');
  assert.equal(claude.routes['G0-B'].reasoning, 'medium');
  assert.equal(claude.routes.G1.reasoning, 'high');
  const openai = registry.stacks['owner-openai-default'];
  for (const [role, route] of Object.entries(openai.routes)) {
    if (route.model === 'gpt-6-sol') assert.equal(route.reasoning, 'xhigh', `OpenAI Sol route must be xhigh: ${role}`);
  }
  assert.equal(registry.stacks['owner-openai-default'].routes.G1.reasoning, 'xhigh');
  assert.equal(registry.stacks['owner-openai-default'].routes.G2.reasoning, 'medium');
  assert.equal(registry.stacks['owner-openai-default'].routes.G2_ESCALATED.reasoning, 'high');
  assert.equal(claude.routes.G2.reasoning, 'high');
  assert.equal(claude.routes.G2_ESCALATED.reasoning, 'xhigh');
  assert.equal(claude.routes.G3.reasoning, 'medium');
  assert.equal(claude.routes.G4.reasoning, 'xhigh');
  assert.equal(claude.routes.LOOP.reasoning, 'medium');
  assert.equal(claude.routes.RECONVERGENCE.reasoning, 'high');
  assert.equal(claude.routes.FINAL_AUDIT.reasoning, 'max');
  assert.equal(claude.routes.BROWSER.reasoning, 'high');
  assert.equal(claude.subagents['G0-B'].reasoning, 'medium');
  assert.equal(claude.subagents.G3.reasoning, 'medium');
});

test('G2 escalation is a stronger route category, not a new gate', () => {
  assert.match(controller, /`G2_ESCALATED` is a stronger route category for the same semantic `G2` gate/);
  assert.match(controller, /fresh G4 has classified a material blocker as `G2_CONTRACT_COVERAGE_MISS`/);
  assert.match(controller, /normal G2 route returned HOLD.*remaining blocker is adversarial executable-contract closure/s);
  assert.match(controller, /once for the same G2 root\/contract/);
  assert.match(controller, /does not authorise mutation or bypass missing evidence/);
  assert.match(controller, /Do not auto-escalate merely because.*G3 implementation failed/s);
});

test('delegation capability is stage law, not model law', () => {
  assert.match(controller, /G0-B.*G3.*only subagent-capable stages\/roles/s);
  assert.match(controller, /Concrete parent\/child provider\/model\/reasoning bindings come from the explicitly selected stack registry/);
  assert.match(architecture, /Only G0-B and G3 may use semantic depth-1 subagents/);
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
    for (const route of [...Object.values(stack.routes), ...Object.values(stack.subagents)]) {
      if (route) assert.equal(Object.hasOwn(route, 'tier'), false);
    }
  }
});

test('convergence-first roles are represented without widening delegation', () => {
  assert.match(controller, /G0-A.*problem framing/s);
  assert.match(controller, /G2.*adversarial executable-contract closure/s);
  assert.match(controller, /RECONVERGENCE.*read-only.*not a gate/s);
  assert.match(architecture, /Reconverged correction exception/);
  assert.match(architecture, /Web-directed continuation after autonomous exhaustion/);
  assert.match(controller, /WEB_DIRECTED_CONTINUATION/);
  assert.match(controller, /does not automatically spend a higher-model `RECONVERGENCE` call/);
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
  assert.match(controller, /`G2_CONTRACT_COVERAGE_MISS` requires targeted G2 re-entry and may use `G2_ESCALATED`/);
  assert.match(controller, /standard G2 route normally applies/);
  assert.match(controller, /Narrow G2-reuse exception/);
  assert.match(controller, /every exact material G4 counterexample.*executable G2 invariant.*regression plus positive-control obligation.*production-boundary evidence requirement.*validation criterion/s);
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
  assert.match(controller, /Known-good vs production differential evidence/);
  assert.match(controller, /G0-A first inventories the material differences/);
  assert.match(controller, /known-good upper-bound positive control/);
  assert.match(controller, /real production entry point/);
  assert.match(controller, /G0-B then prefers one bounded differential experiment/);
  assert.match(controller, /Serial one-delta evidence episodes are allowed only when an earlier boundary genuinely prevents deeper observation/);
  assert.match(controller, /unrelated environment\/check\/transport failure does not redefine the causal question/);
  assert.match(architecture, /known-good qualified path succeeds while the real production path fails/);
});

test('active legacy lineages adopt current governance only at safe boundaries without resetting history', () => {
  assert.match(controller, /still-required active lineage admitted under older governance.*next safe terminal\/reconciliation boundary/s);
  assert.match(controller, /never by silently rewriting an in-flight worker contract/);
  assert.match(controller, /Preserve Delivery Child\/root\/continuation identity, all consumed budgets\/attempts, historical findings\/evidence\/candidates and original gate outcomes/);
  assert.match(controller, /Newer governance alone does not reopen accepted architecture\/contract or reset history/);
  assert.match(architecture, /compatible stricter current governance is adopted prospectively/);
});

test('later-required candidates and evidence survive disposable execution teardown', () => {
  assert.match(controller, /Before tearing down a disposable worktree, sandbox, worker\/session or temporary evidence surface/);
  assert.match(controller, /preserve every later-required exact candidate and non-repository evidence artifact/);
  assert.match(controller, /verify the intended later consumer can recover it/);
  assert.match(controller, /Temporary path, chat memory, digest-only evidence or disappearing uncommitted state is insufficient/);
  assert.match(controller, /Publication authority is not implied/);
  assert.match(architecture, /Before a disposable execution surface is destroyed/);
});

test('ordinary coding path keeps exception mechanics exceptional', () => {
  assert.match(controller, /ordinary coding path is `G1 -> G2 -> G3 in-gate convergence -> G4 -> Web finality`/);
  assert.match(controller, /G0, targeted re-entry, RECONVERGENCE, HOLD recovery and Web-directed continuation are exception mechanics/);
  assert.match(controller, /Repeated exception use without material blocker\/root reduction returns to the responsible root\/Owner boundary/);
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
  assert.match(controller, /G0-B.*G3.*only subagent-capable stages\/roles/s);
  assert.match(controller, /Concrete parent\/child provider\/model\/reasoning bindings come from the explicitly selected stack registry/);
  assert.match(architecture, /Only G0-B and G3 may use semantic depth-1 subagents/);
});
