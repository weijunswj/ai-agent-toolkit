'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const support = require('./toolkit-authority-packet-supplemental-support.cjs');

function expectCode(callback, pattern) {
  assert.throws(callback, (error) => error && pattern.test(error.code || error.message));
}

function mutateCase(ir, id, fn) {
  const cloned = structuredClone(ir);
  for (const requirement of cloned.requirements) {
    const item = requirement.cases.find((candidate) => candidate.id === id);
    if (item) return fn(cloned, item);
  }
  throw new Error(`case not found: ${id}`);
}

function fixtureBlobSha1() {
  const filename = path.join(__dirname, 'fixtures', 'authority-packet-durability-g2-v1.json');
  const bytes = fs.readFileSync(filename);
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
}

test('supplemental fixture is declared and compiled before registration', () => {
  assert.equal(fixtureBlobSha1(), '70997368cd0d8e2b148f57d7d0537966a8827d71');
  const compiled = support.compileSupplementalFixture();
  const summary = support.compiledSummary(compiled);
  assert.equal(summary.state, 'DECLARED_COMPILED');
  assert.equal(summary.case_count, 4);
  assert.deepEqual(summary.case_ids, [...support.REQUIRED_CASE_IDS]);
  assert.equal(support.registeredSummary(compiled), null);
});

test('declaration rejects missing and duplicate identities before compilation', () => {
  const base = support.loadFixture();
  const missing = structuredClone(base);
  missing.requirements[1].cases.pop();
  expectCode(() => support.compileSupplementalFixture(missing), /SUPPLEMENTAL_DECLARATION_SET_MISMATCH/);

  const duplicate = structuredClone(base);
  duplicate.requirements[1].cases.push(structuredClone(duplicate.requirements[0].cases[0]));
  expectCode(() => support.compileSupplementalFixture(duplicate), /SUPPLEMENTAL_DECLARATION_DUPLICATE/);
});

test('registration rejects missing, duplicate, unknown, substituted, and cross-case recipes', () => {
  const compiled = support.compileSupplementalFixture();
  const base = support.registrationCandidates(compiled);

  expectCode(() => support.registerSupplementalCases(compiled, base.slice(1)), /SUPPLEMENTAL_REGISTRATION_MISSING/);
  expectCode(() => support.registerSupplementalCases(compiled, [...base, structuredClone(base[0])]), /SUPPLEMENTAL_REGISTRATION_DUPLICATE/);

  const unknown = structuredClone(base);
  unknown[0].case_identity = 'R090-UNKNOWN\u0000missing\u0000none\u0000validateAuthorityPacket';
  expectCode(() => support.registerSupplementalCases(compiled, unknown), /SUPPLEMENTAL_REGISTRATION_UNKNOWN/);

  const substitutions = [
    (rows) => { rows[2].recipe_variant = 'missing-decision'; },
    (rows) => { rows[2].clean_seed = 'r090-substituted-seed'; },
    (rows) => { rows[2].target = 'different-runtime'; },
    (rows) => { rows[2].method = 'different-method'; },
    (rows) => { rows[2].recipe_variant = rows[0].recipe_variant; },
    (rows) => { rows[2].expected = structuredClone(rows[1].expected); },
  ];
  for (const mutate of substitutions) {
    const rows = structuredClone(base);
    mutate(rows);
    expectCode(() => support.registerSupplementalCases(compiled, rows), /SUPPLEMENTAL_REGISTRATION_SUBSTITUTED/);
  }

  const adversarial = structuredClone(base);
  adversarial[2].recipe_variant = 'missing-decision';
  expectCode(() => support.registerSupplementalCases(compiled, adversarial), /SUPPLEMENTAL_REGISTRATION_SUBSTITUTED/);
});

test('all registered cases execute the awaited production boundary and close with a private receipt', async () => {
  const compiled = support.compileSupplementalFixture();
  const registered = support.registerSupplementalCases(compiled);
  assert.equal(support.registeredSummary(registered).state, 'REGISTERED');
  const completion = await support.executeSupplementalOracle(registered);
  const result = support.verifySupplementalCompletion(completion);
  assert.equal(result.state, 'ACTUALLY_EXECUTED');
  assert.equal(result.registered_count, 4);
  assert.equal(result.executed_count, 4);
  assert.equal(result.attempts.length, 4);
  assert.deepEqual(result.attempts.map((item) => item.sequence), [1, 2, 3, 4]);
  assert.deepEqual(result.attempts.map((item) => item.role), ['required', 'required', 'required', 'required']);
  assert.deepEqual(result.cases.map((item) => item.outcome), ['REJECT', 'ACCEPT', 'REJECT', 'ACCEPT']);
  assert.deepEqual(result.cases.map((item) => item.reason_code), ['GPR_PACKET_VALUE_INVALID', null, 'GPR_PACKET_VALUE_INVALID', null]);
  assert.equal(result.positive_controls, 2);
  assert.ok(result.cases.every((item) => item.target_id === 'toolkit-github-program-receipt'));
  assert.ok(result.cases.every((item) => item.method_name === 'validateAuthorityPacket'));
  assert.ok(result.cases.every((item) => item.value_observed || item.exception_observed));
  assert.ok(result.cases.every((item) => item.binding_hook_counts.getters === 0
    && item.binding_hook_counts.proxy_traps === 0 && item.binding_hook_counts.toJSON === 0));
  assert.equal(support.verifySupplementalCompletion({ ...result }), null);
  assert.equal(support.verifySupplementalCompletion(4), null);
});

test('a registered but uninvoked case cannot produce a completion receipt', async () => {
  const compiled = support.compileSupplementalFixture();
  const registered = support.registerSupplementalCases(compiled);
  const identity = support.compiledSummary(compiled).identities.at(-1);
  await assert.rejects(
    support.executeSupplementalOracle(registered, { skip_case_identity: identity }),
    /SUPPLEMENTAL_CASE_UNEXECUTED/
  );
});

test('completion waits for the boundary observation and cannot be certified by a count', async () => {
  const compiled = support.compileSupplementalFixture();
  const registered = support.registerSupplementalCases(compiled);
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const waiting = new Promise((resolve) => { entered = resolve; });
  const pending = support.executeSupplementalOracle(registered, {
    afterProduction: async (observation) => {
      if (observation.case_id === support.REQUIRED_CASE_IDS[0]) {
        entered();
        await gate;
      }
    },
  });
  await waiting;
  assert.equal(support.verifySupplementalCompletion(pending), null);
  assert.equal(support.verifySupplementalCompletion({ executed_count: 4 }), null);
  release();
  const completion = await pending;
  assert.equal(support.verifySupplementalCompletion(completion).executed_count, 4);
});

test('waiter-first completion remains unissued after a later observation failure', async () => {
  const compiled = support.compileSupplementalFixture();
  const registered = support.registerSupplementalCases(compiled);
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const waiting = new Promise((resolve) => { entered = resolve; });
  const pending = support.executeSupplementalOracle(registered, {
    afterProduction: async (observation) => {
      if (observation.case_id === support.REQUIRED_CASE_IDS[0]) {
        entered();
        await gate;
        throw new Error('late-observation-failure');
      }
    },
  });
  await waiting;
  assert.equal(support.verifySupplementalCompletion(pending), null);
  assert.equal(support.verifySupplementalCompletion({ executed_count: 4 }), null);
  release();
  await assert.rejects(pending, /late-observation-failure/);
  assert.equal(support.verifySupplementalCompletion(pending), null);
});

test('one non-zero Proxy trap counter prevents supplemental completion', async () => {
  const compiled = support.compileSupplementalFixture();
  const registered = support.registerSupplementalCases(compiled);
  await assert.rejects(
    support.executeSupplementalOracle(registered, { inject_nonzero_hook_case_id: support.REQUIRED_CASE_IDS[0] }),
    /SUPPLEMENTAL_RECIPE_HOOK_EXECUTED/,
  );
  assert.equal(support.verifySupplementalCompletion(null), null);
});
