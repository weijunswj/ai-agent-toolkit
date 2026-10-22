'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const { HOST_ENTRIES, createHelperRouteGuard } = require('../scripts/toolkit-v3-helper-guard.cjs');

const { capturedStack, TEST_PROFILES } = require('./support/captured-stack-fixture.cjs');
const qualification = Object.fromEntries(compiler.CHEAP_QUALIFIERS.map((key) => [key, { status: 'UNKNOWN', source: null }]));
const registry = compiler.contractSchema('stack-registry-v3.json');
const revision = capturedStack('owner-gpt').selection.registry_digest;
const matrix = [
  { id: '01-correct-route-executes', expected: 'ALLOW', explicit: true },
  { id: '02-wrong-provider-or-model-rejects-before-dispatch', expected: 'ROUTE_MISMATCH' },
  { id: '03-wrong-effort-rejects-before-dispatch', expected: 'ROUTE_MISMATCH' },
  { id: '04-wrong-inherited-default-rejects-before-dispatch', expected: 'ROUTE_MISMATCH' },
  { id: '05-correct-pinned-default-executes', expected: 'ALLOW' },
  { id: '06-conflicting-explicit-override-rejects-before-dispatch', expected: 'ROUTE_OVERRIDE_CONFLICT' },
  { id: '07-guard-error-fails-closed', expected: 'HOST_OBSERVATION_ERROR' },
  { id: '08-guard-timeout-fails-closed', expected: 'HOST_OBSERVATION_TIMEOUT' },
  { id: '09-missing-disabled-or-self-certified-hook-is-unavailable', expected: 'HOOK_UNAVAILABLE' },
  { id: '10-malformed-host-configuration-fails-closed', expected: 'MALFORMED_HOST_STATE' },
  { id: '11-post-check-configuration-drift-fails-closed', expected: 'POSTCHECK_CONFIGURATION_DRIFT' },
  { id: '12-fork-resume-or-restore-cannot-bypass', expected: 'RESTORE_OR_ALTERNATE_SESSION' },
  { id: '13-alternative-entry-is-unavailable', expected: 'HOST_ENTRY_MISMATCH' },
  { id: '14-g2-and-leaf-cannot-delegate', expected: 'CALLER_CANNOT_DELEGATE' },
  { id: '15-no-helper-request-does-not-auto-spawn', expected: 'NOOP_NO_HELPER_REQUEST' },
];

const entryCases = [
  { entry_id: 'codex_spawn_agent', caller_role: 'G0' },
  { entry_id: 'codex_agent_alias', caller_role: 'G1' },
  { entry_id: 'claude_parent_agent', caller_role: 'G0' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeFixture(entryCase, options = {}) {
  const callerRoute = entryCase.caller_role === 'G0' ? 'DISCOVERY' : 'BUILDER';
  const helperRole = `${callerRoute}_HELPER`;
  const host = HOST_ENTRIES[entryCase.entry_id].host;
  const profileId = options.selected_profile_id === undefined
    ? TEST_PROFILES[host] : options.selected_profile_id;
  const captured=capturedStack(profileId), resolved = captured.selection;
  const leafRoute = resolved.routes[helperRole];
  let currentState = {
    state: 'ready',
    host_version: 'synthetic-host/1.0 (not native qualification)',
    registration: { ...HOST_ENTRIES[entryCase.entry_id], registered: true, loaded: true, enabled: true },
    session: {
      caller_role: entryCase.caller_role,
      profile_id: profileId,
      registry_revision: revision,
      lifecycle: 'fresh',
    },
    routing: {
      profile_id: profileId,
      registry_revision: revision,
      helper_role: helperRole,
      effective_route: leafRoute,
      native_defaults: leafRoute,
      pinned_defaults: { provider: true, model: true, reasoning: true },
      inherited_route: null,
    },
  };
  let observeCalls = 0;
  let dispatchCalls = 0;
  let observeHostState = () => {
    observeCalls += 1;
    return clone(currentState);
  };
  let controlledDispatch = (request) => {
    dispatchCalls += 1;
    return { interceptor: 'synthetic-controlled-downstream', accepted: true, request };
  };
  const timeoutMs = options.timeout_ms ?? 20;
  const guardOptions = {
    entry_id: entryCase.entry_id,
    observe_host_state: (...args) => observeHostState(...args),
    controlled_dispatch: (...args) => controlledDispatch(...args),
    source_capture: captured.source_capture,
    selection: captured.selection,
    timeout_ms: timeoutMs,
  };
  if (options.selected_profile_id !== undefined) guardOptions.selected_profile_id = options.selected_profile_id;
  const guard = createHelperRouteGuard(guardOptions);
  const invocation = {
    caller_role: entryCase.caller_role,
    profile_id: profileId,
    registry_revision: revision,
    helper_role: helperRole,
    helper_requested: true,
    route_overrides: {},
    session_transition: 'fresh',
  };
  return {
    guard, invocation, leafRoute, helperRole, resolved, profileId,
    get state() { return currentState; },
    set state(value) { currentState = value; },
    set observe(value) { observeHostState = value; },
    get observeCalls() { return observeCalls; },
    get dispatchCalls() { return dispatchCalls; },
    set dispatch(value) { controlledDispatch = value; },
  };
}

function alterCase(fixture, id) {
  const call = clone(fixture.invocation);
  const state = clone(fixture.state);
  if (id === '01-correct-route-executes') {
    call.route_overrides = clone(fixture.leafRoute);
  } else if (id === '02-wrong-provider-or-model-rejects-before-dispatch') {
    state.routing.effective_route.provider = 'unapproved-provider';
  } else if (id === '03-wrong-effort-rejects-before-dispatch') {
    state.routing.effective_route.reasoning = 'low';
  } else if (id === '04-wrong-inherited-default-rejects-before-dispatch') {
    state.routing.inherited_route = { ...fixture.leafRoute, model: 'wrong-inherited-model' };
  } else if (id === '06-conflicting-explicit-override-rejects-before-dispatch') {
    call.route_overrides.model = 'conflicting-model';
  } else if (id === '07-guard-error-fails-closed') {
    fixture.observe = () => ({ state: 'error' });
  } else if (id === '08-guard-timeout-fails-closed') {
    fixture.observe = () => new Promise((resolve) => setTimeout(() => resolve(clone(state)), 80));
  } else if (id === '09-missing-disabled-or-self-certified-hook-is-unavailable') {
    state.registration.registered = false;
  } else if (id === '10-malformed-host-configuration-fails-closed') {
    delete state.routing.pinned_defaults.reasoning;
  } else if (id === '11-post-check-configuration-drift-fails-closed') {
    let count = 0;
    fixture.observe = () => {
      count += 1;
      const observed = clone(state);
      if (count > 1) observed.routing.effective_route.model = 'post-check-drift';
      return observed;
    };
  } else if (id === '12-fork-resume-or-restore-cannot-bypass') {
    call.session_transition = 'resume';
  } else if (id === '13-alternative-entry-is-unavailable') {
    state.registration.entry = 'alternate-unchecked-entry';
  } else if (id === '14-g2-and-leaf-cannot-delegate') {
    call.caller_role = 'G2';
  } else if (id === '15-no-helper-request-does-not-auto-spawn') {
    call.helper_requested = false;
  }
  if (!['07-guard-error-fails-closed', '08-guard-timeout-fails-closed', '11-post-check-configuration-drift-fails-closed'].includes(id)) {
    fixture.state = state;
  }
  return call;
}

test('Toolkit V3 helper guard: all fifteen approved synthetic cases for each exact host entry', async (t) => {
  const records = [];
  for (const entryCase of entryCases) {
    for (const item of matrix) {
      await t.test(`${entryCase.entry_id} / ${item.id}`, async () => {
        const fixture = makeFixture(entryCase, { timeout_ms: item.id === '08-guard-timeout-fails-closed' ? 5 : 20 });
        const invocation = alterCase(fixture, item.id);
        const result = await fixture.guard.invoke(invocation);
        assert.equal(result.decision, item.expected === 'ALLOW' || item.expected === 'NOOP_NO_HELPER_REQUEST' ? item.expected : 'DENY');
        if (item.expected === 'ALLOW') {
          assert.equal(result.code, 'ROUTE_VERIFIED');
          assert.equal(fixture.dispatchCalls, 1);
          assert.deepEqual(result.effective_route, fixture.leafRoute);
          assert.equal(result.host_qualification, 'PREPARATION_ONLY');
        } else if (item.expected === 'NOOP_NO_HELPER_REQUEST') {
          assert.equal(result.code, 'NO_HELPER_REQUEST');
          assert.equal(fixture.observeCalls, 0);
          assert.equal(fixture.dispatchCalls, 0);
        } else {
          assert.equal(result.code, item.expected);
          assert.equal(fixture.dispatchCalls, 0, 'a denied request must not reach the controlled downstream interceptor');
        }
        records.push({
          host: HOST_ENTRIES[entryCase.entry_id].host,
          host_entry: entryCase.entry_id,
          host_version: 'synthetic-host/1.0 (not native qualification)',
          profile_id: fixture.profileId,
          effective_route: fixture.leafRoute,
          input: invocation,
          decision: result.decision,
          code: result.code,
          downstream_result: result.downstream_result || 'NOT_CALLED',
        });

        if (item.id === '02-wrong-provider-or-model-rejects-before-dispatch') {
          const wrongModel = makeFixture(entryCase);
          const wrongModelState = clone(wrongModel.state);
          wrongModelState.routing.effective_route.model = 'unapproved-model';
          wrongModel.state = wrongModelState;
          const wrongModelResult = await wrongModel.guard.invoke(wrongModel.invocation);
          assert.equal(wrongModelResult.code, 'ROUTE_MISMATCH');
          assert.equal(wrongModel.dispatchCalls, 0);
          records.at(-1).supplemental = [{
            input: wrongModel.invocation,
            decision: wrongModelResult.decision,
            code: wrongModelResult.code,
            downstream_result: 'NOT_CALLED',
          }];
        }
        if (item.id === '06-conflicting-explicit-override-rejects-before-dispatch') {
          const wrongProfile = { ...fixture.invocation, profile_id: fixture.profileId === 'owner-gpt' ? 'owner-claude' : 'owner-gpt' };
          const profileResult = await fixture.guard.invoke(wrongProfile);
          assert.equal(profileResult.code, 'PROFILE_NOT_SELECTED');
          const wrongRevision = { ...fixture.invocation, registry_revision: 'wrong-revision' };
          const revisionResult = await fixture.guard.invoke(wrongRevision);
          assert.equal(revisionResult.code, 'REGISTRY_REVISION_MISMATCH');
          const wrongCaller = { ...fixture.invocation, caller_role: entryCase.caller_role === 'G0' ? 'G1' : 'G0' };
          const callerResult = await fixture.guard.invoke(wrongCaller);
          assert.equal(callerResult.code, 'CALLER_BINDING_MISMATCH');
          assert.equal(fixture.dispatchCalls, 0);
          records.at(-1).supplemental = [
            { input: wrongProfile, decision: profileResult.decision, code: profileResult.code, downstream_result: 'NOT_CALLED' },
            { input: wrongRevision, decision: revisionResult.decision, code: revisionResult.code, downstream_result: 'NOT_CALLED' },
            { input: wrongCaller, decision: callerResult.decision, code: callerResult.code, downstream_result: 'NOT_CALLED' },
          ];
        }
        if (item.id === '09-missing-disabled-or-self-certified-hook-is-unavailable') {
          const selfCertified = { ...fixture.invocation, registered: true };
          const selfResult = await fixture.guard.invoke(selfCertified);
          assert.equal(selfResult.code, 'MALFORMED_INPUT');
          assert.equal(fixture.dispatchCalls, 0);
          const disabled = makeFixture(entryCase);
          const disabledState = clone(disabled.state);
          disabledState.registration.enabled = false;
          disabled.state = disabledState;
          const disabledResult = await disabled.guard.invoke(disabled.invocation);
          assert.equal(disabledResult.code, 'HOOK_UNAVAILABLE');
          assert.equal(disabled.dispatchCalls, 0);
          records.at(-1).supplemental = [
            { input: selfCertified, decision: selfResult.decision, code: selfResult.code, downstream_result: 'NOT_CALLED' },
            { input: disabled.invocation, decision: disabledResult.decision, code: disabledResult.code, downstream_result: 'NOT_CALLED' },
          ];
        }
        if (item.id === '14-g2-and-leaf-cannot-delegate') {
          const leaf = makeFixture(entryCase);
          const leafCall = { ...leaf.invocation, caller_role: 'G1_HELPER' };
          const leafResult = await leaf.guard.invoke(leafCall);
          assert.equal(leafResult.code, 'CALLER_CANNOT_DELEGATE');
          assert.equal(leaf.dispatchCalls, 0);
          records.at(-1).supplemental = [
            { input: leafCall, decision: leafResult.decision, code: leafResult.code, downstream_result: 'NOT_CALLED' },
          ];
        }
      });
    }
  }
  assert.equal(records.length, entryCases.length * matrix.length);
  t.diagnostic(`synthetic cases recorded: ${JSON.stringify(records)}`);
  t.diagnostic('Evidence is software preparation only; it does not prove installed hooks, host interception, provider inference blocking, or native qualification.');
});

test('guard requires an explicit host/API generation and constructor-captured callbacks', () => {
  assert.throws(() => createHelperRouteGuard({
    entry_id: 'opencode',
    observe_host_state: () => ({}),
    controlled_dispatch: () => ({}),
  }), /explicit supported host entry/);
  assert.throws(() => createHelperRouteGuard({
    entry_id: 'claude_parent_agent',
    observe_host_state: () => ({}),
  }), /constructor-captured observation and controlled dispatch callbacks/);
});

test('controlled host fixtures explicitly select a pinned stack; another profile needs its own admitted selection', async () => {
  for (const entryCase of entryCases) {
    const fixture = makeFixture(entryCase);
    const expectedProfile = TEST_PROFILES[HOST_ENTRIES[entryCase.entry_id].host];
    assert.equal(fixture.guard.selected_profile_id, expectedProfile);
    assert.equal(fixture.profileId, expectedProfile);
  }

  const claude = makeFixture(entryCases[2]);
  const rejected = await claude.guard.invoke({ ...claude.invocation, profile_id: 'owner-gpt' });
  assert.equal(rejected.code, 'PROFILE_NOT_SELECTED');
  assert.equal(claude.dispatchCalls, 0);

  const allowed = await claude.guard.invoke(claude.invocation);
  assert.equal(claude.guard.selected_profile_id, 'owner-claude');
  assert.equal(allowed.decision, 'ALLOW');
  assert.deepEqual(allowed.effective_route, { provider: 'anthropic', model: 'haiku-5.5', reasoning: 'xhigh' });
  assert.equal(claude.dispatchCalls, 1);
});

test('guard snapshots entry and callbacks; accessor and Proxy options fail without invoking traps', async () => {
  const entryCase = entryCases[0];
  const fixture = makeFixture(entryCase);
  let accessorReads = 0;
  const accessorOptions = {
    entry_id: entryCase.entry_id,
    controlled_dispatch: () => ({ accepted: true }),
  };
  Object.defineProperty(accessorOptions, 'observe_host_state', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return () => clone(fixture.state);
    },
  });
  assert.throws(() => createHelperRouteGuard(accessorOptions), /enumerable data properties/);
  assert.equal(accessorReads, 0, 'constructor must inspect descriptors without invoking accessors');

  let proxyTraps = 0;
  const proxyOptions = new Proxy({
    entry_id: entryCase.entry_id,
    observe_host_state: () => clone(fixture.state),
    controlled_dispatch: () => ({ accepted: true }),
  }, {
    getOwnPropertyDescriptor() {
      proxyTraps += 1;
      throw new Error('proxy trap must not run');
    },
  });
  assert.throws(() => createHelperRouteGuard(proxyOptions), /non-Proxy object/);
  assert.equal(proxyTraps, 0, 'constructor must reject Proxy before inspecting it');

  let capturedObservations = 0;
  let capturedDispatches = 0;
  let replacementObservations = 0;
  let replacementDispatches = 0;
  const captured=capturedStack(fixture.profileId);
  const mutableOptions = {
    entry_id: entryCase.entry_id,
    selected_profile_id: fixture.profileId,
    observe_host_state: () => {
      capturedObservations += 1;
      return clone(fixture.state);
    },
    controlled_dispatch: () => {
      capturedDispatches += 1;
      return { interceptor: 'synthetic-captured-callback', accepted: true };
    },
    source_capture: captured.source_capture,
    selection: captured.selection,
  };
  const guard = createHelperRouteGuard(mutableOptions);
  mutableOptions.entry_id = 'claude_parent_agent';
  mutableOptions.selected_profile_id = 'owner-claude';
  mutableOptions.observe_host_state = () => {
    replacementObservations += 1;
    return { state: 'error' };
  };
  mutableOptions.controlled_dispatch = () => {
    replacementDispatches += 1;
    throw new Error('replacement callback must not run');
  };
  const result = await guard.invoke(fixture.invocation);
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.entry_id, entryCase.entry_id);
  assert.equal(guard.selected_profile_id, fixture.profileId);
  assert.equal(capturedObservations, 2);
  assert.equal(capturedDispatches, 1);
  assert.equal(replacementObservations, 0);
  assert.equal(replacementDispatches, 0);
});

test('dispatcher exception reports called with unknown downstream outcome', async () => {
  const fixture = makeFixture(entryCases[0]);
  let dispatchAttempts = 0;
  fixture.dispatch = () => {
    dispatchAttempts += 1;
    throw new Error('downstream outcome cannot be inferred');
  };
  const result = await fixture.guard.invoke(fixture.invocation);
  assert.equal(fixture.observeCalls, 2, 'both pre-dispatch observations must complete');
  assert.equal(dispatchAttempts, 1, 'dispatcher call counter is independent of observer count');
  assert.equal(result.decision, 'DISPATCH_FAILED');
  assert.equal(result.code, 'DOWNSTREAM_OUTCOME_UNKNOWN');
  assert.equal(result.dispatch, 'CALLED');
  assert.equal(result.downstream_result, 'UNKNOWN');
});
