'use strict';

// The compiler keeps the JSON utility and controller-decision slice that the hook path and the
// controller-decision tests use. Its G3 gate-contract half was removed in R3.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');

test('the compiler exports only the utility and controller-decision slice', () => {
  for (const name of ['compileGateContract', 'renderG3ExecutionPacket', 'validateG3ExecutionPacket', 'SUPPORTED_MACROS', 'MACRO_NAMES', 'validateJsonCompatible']) {
    assert.equal(Object.hasOwn(compiler, name), false, name);
  }
  assert.throws(() => compiler.contractSchema('gate-contract-ir-v2.schema.json'), (error) => error.code === 'GATE_CONTRACT_IR_INVALID');
  assert.throws(() => compiler.contractSchema('controller-decision-v1.schema.json'), (error) => error.code === 'GATE_CONTRACT_IR_INVALID');
});

test('canonical hashing is stable across key order and does not mutate its input', () => {
  const input = { b: [1, { d: null, c: false }], a: 'x' };
  const before = structuredClone(input);
  assert.equal(compiler.hashCanonical(input), compiler.hashCanonical({ a: 'x', b: [1, { c: false, d: null }] }));
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(compiler.canonicalize(input)), ['a', 'b']);
});

test('trusted copies and the canonicalizer reject Proxies before observing their traps', () => {
  const counters = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const handler = {
    get(target, key, receiver) { counters.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { counters.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { counters.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { counters.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  };
  const makeCrossRealm = vm.runInNewContext('(target, traps) => new Proxy(target, traps)');
  const hostile = makeCrossRealm({ nested: { value: 1 } }, handler);
  for (const run of [() => compiler.canonicalize(hostile), () => compiler.trustedJsonCopy(hostile), () => compiler.trustedJsonCopy({ inner: hostile })]) {
    assert.throws(run, (error) => error && error.code === 'GATE_CONTRACT_IR_INVALID');
  }
  assert.deepEqual(counters, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
});
