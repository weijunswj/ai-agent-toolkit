'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { RetainedResourceRegister } = require('../scripts/toolkit-custody-retention-v3.cjs');

const h = s => crypto.createHash('sha256').update(s).digest('hex');
const code = c => e => e.code === c;
const T0 = '2026-10-16T00:00:00.000Z', T1 = '2026-10-17T00:00:00.000Z', T2 = '2026-10-20T00:00:00.000Z';
function entry(over = {}) {
  return { resource_id: 'scratch-dir', kind: 'DIRECTORY', purpose: 'Local copy of uploaded evidence', owner: 'g1-session',
    need: 'PRESERVED', release_condition: 'custody-verified-and-retrieved',
    reassess: { trigger: 'SCHEDULE', next_review_at: T1 }, created_at: T0, created_by: 'g1-session', ...over };
}
const obs = (over = {}) => ({ observed_at: T0, release_condition_met: false, custody_verified: false, ...over });

test('a resource is registered at creation with purpose, owner, need, release condition and reassessment trigger', () => {
  const reg = new RetainedResourceRegister().register(entry());
  const r = reg.resource('scratch-dir');
  assert.equal(r.state, 'RETAINED'); assert.equal(r.need, 'PRESERVED'); assert.deepEqual(r.holds, []);
  for (const missing of ['purpose', 'owner', 'release_condition', 'reassess']) {
    const bad = entry(); delete bad[missing];
    assert.throws(() => new RetainedResourceRegister().register(bad), code('RESOURCE_REGISTRATION_INVALID'));
  }
  assert.throws(() => reg.register(entry()), code('RESOURCE_REGISTER_DUPLICATE'));
});

test('a due review triggers reassessment only and never an effect', () => {
  const reg = new RetainedResourceRegister().register(entry());
  const before = reg.digest;
  const due = reg.reassess('scratch-dir', obs({ observed_at: T2 }));
  assert.equal(due.review_due, true);
  assert.equal(due.disposition, 'REASSESSED_STILL_REQUIRED');
  assert.equal(due.effect_authority, false);
  assert.equal(reg.digest, before, 'reassessment does not mutate the register');
  const next = reg.scheduleReview('scratch-dir', { next_review_at: '2026-10-27T00:00:00.000Z', at: T2 });
  assert.equal(next.reassess('scratch-dir', obs({ observed_at: T2 })).review_due, false);
});

test('eligible control: release condition met with verified custody permits the owner cleanup path', () => {
  const reg = new RetainedResourceRegister().register(entry());
  const d = reg.reassess('scratch-dir', obs({ release_condition_met: true, custody_verified: true }));
  assert.equal(d.disposition, 'RELEASE_ELIGIBLE'); assert.equal(d.effect_authority, false);
  const released = reg.release('scratch-dir', { at: T1, readback_digest: h('absent') });
  assert.equal(released.resource('scratch-dir').state, 'RELEASED');
  assert.equal(released.reassess('scratch-dir', obs({ release_condition_met: true, custody_verified: true })).disposition, 'ALREADY_RELEASED');
});

test('held controls: active use, UAT, sole copy and permission holds keep the resource protected', () => {
  const base = new RetainedResourceRegister().register(entry());
  for (const hold of ['ACTIVE_USE', 'UAT', 'SOLE_COPY', 'PERMISSION', 'REVIEW', 'RECOVERY']) {
    const reg = base.setHolds('scratch-dir', [hold], { at: T0, reason: 'newly-observed' });
    const d = reg.reassess('scratch-dir', obs({ release_condition_met: true, custody_verified: true }));
    assert.equal(d.disposition, 'HOLD', hold); assert.deepEqual(d.holds, [hold]);
    assert.throws(() => reg.release('scratch-dir', { at: T1, readback_digest: h('x') }), code('RESOURCE_RELEASE_REFUSED'));
  }
  // Without verified custody the local copy is the sole copy and stays held.
  assert.deepEqual(base.reassess('scratch-dir', obs({ release_condition_met: true, custody_verified: false })).holds, ['SOLE_COPY']);
});

test('an idle process kept only for preservation is stopped, while its preserved state stays retained', () => {
  const reg = new RetainedResourceRegister().register(entry({ resource_id: 'dev-server', kind: 'PROCESS', need: 'PRESERVED',
    reassess: { trigger: 'EVENT', event: 'uat-accepted' } }));
  assert.equal(reg.reassess('dev-server', obs({ process_active: true })).disposition, 'STOP_PROCESS_KEEP_PRESERVED');
  const running = new RetainedResourceRegister().register(entry({ resource_id: 'uat-server', kind: 'PROCESS', need: 'RUNNING',
    reassess: { trigger: 'EVENT', event: 'uat-accepted' } })).setHolds('uat-server', ['UAT'], { at: T0, reason: 'owner-uat' });
  assert.equal(running.reassess('uat-server', obs({ process_active: true })).disposition, 'HOLD');
  assert.throws(() => reg.reassess('dev-server', obs()), code('RESOURCE_OBSERVATION_INVALID'));
});

test('ownership transfers to a verified successor across handoff without dropping the record', () => {
  const reg = new RetainedResourceRegister().register(entry());
  const moved = reg.transfer('scratch-dir', { owner: 'g1-successor', at: T1, evidence_digest: h('handoff') });
  const r = moved.resource('scratch-dir');
  assert.equal(r.owner, 'g1-successor'); assert.equal(r.history[0].from, 'g1-session');
  const restored = new RetainedResourceRegister(moved.value);
  assert.equal(restored.digest, moved.digest);
  assert.throws(() => moved.transfer('scratch-dir', { owner: 'g1-successor', at: T1, evidence_digest: h('again') }), code('RESOURCE_TRANSFER_INVALID'));
});
