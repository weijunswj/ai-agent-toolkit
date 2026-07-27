import { canonicalDigest, exactKeys } from './canonical-json.mjs';

const MAX_ACTIVE = 128;
const MAX_DELIVERIES = 2048;
const MAX_NONCES = 512;
const MAX_ATTESTATIONS = 512;

export class MemoryRunState {
  constructor(seed = {}) {
    this.data = {
      checks: new Map(seed.checks || []),
      correlations: new Map(seed.correlations || []),
      deliveries: new Map(seed.deliveries || []),
      nonces: new Map(seed.nonces || []),
      attestations: new Map(seed.attestations || [])
    };
  }

  async acceptDelivery(deliveryId, digest) {
    const existing = this.data.deliveries.get(deliveryId);
    if (existing && existing !== digest) return { ok: false, code: 'TK023_DELIVERY_CONFLICT' };
    if (existing) return { ok: true, duplicate: true };
    if (this.data.deliveries.size >= MAX_DELIVERIES) return { ok: false, code: 'TK023_DELIVERY_STATE_LIMIT' };
    this.data.deliveries.set(deliveryId, digest);
    return { ok: true, duplicate: false };
  }

  async acceptNonce(nonce, correlationId, expiresAt) {
    const now = Date.now();
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry < now || expiry > now + 11 * 60 * 1000) {
      return { ok: false, code: 'TK023_NONCE_EXPIRY_INVALID' };
    }
    for (const [key, record] of this.data.nonces.entries()) {
      if (Date.parse(record.expiresAt) < now) this.data.nonces.delete(key);
    }
    const existing = this.data.nonces.get(nonce);
    if (existing && existing.correlationId !== correlationId) return { ok: false, code: 'TK023_NONCE_REPLAY' };
    if (existing) return { ok: true, duplicate: true };
    if (this.data.nonces.size >= MAX_NONCES) return { ok: false, code: 'TK023_NONCE_STATE_LIMIT' };
    this.data.nonces.set(nonce, { correlationId, expiresAt });
    return { ok: true, duplicate: false };
  }

  async reserveCheck(key, record) {
    const existing = this.data.checks.get(key);
    if (existing) {
      const incomingDigest = await canonicalDigest(record);
      const existingDigest = await canonicalDigest(existing.record);
      if (incomingDigest !== existingDigest) return { ok: false, code: 'TK023_CHECK_CONFLICT', existing };
      return { ok: true, duplicate: true, existing };
    }
    this.data.checks.set(key, { record, state: 'reserved', checkRunId: null, terminalDigest: null });
    return { ok: true, duplicate: false };
  }

  async bindCheckRun(key, checkRunId) {
    const current = this.data.checks.get(key);
    if (!current || (current.checkRunId && current.checkRunId !== checkRunId)) return { ok: false, code: 'TK023_CHECK_RUN_CONFLICT' };
    current.checkRunId = checkRunId;
    current.state = 'in_progress';
    return { ok: true };
  }

  async completeCheck(key, terminalDigest, conclusion) {
    const current = this.data.checks.get(key);
    if (!current) return { ok: false, code: 'TK023_CHECK_STATE_MISSING' };
    if (current.terminalDigest && current.terminalDigest !== terminalDigest) return { ok: false, code: 'TK023_TERMINAL_CONFLICT' };
    if (current.state === 'completed' && current.conclusion !== conclusion) return { ok: false, code: 'TK023_COMPLETION_CONFLICT' };
    const duplicate = current.state === 'completed';
    current.terminalDigest = terminalDigest;
    current.conclusion = conclusion;
    current.state = 'completed';
    return { ok: true, duplicate };
  }

  async putCorrelation(correlationId, record) {
    if (this.data.correlations.size >= MAX_ACTIVE && !this.data.correlations.has(correlationId)) {
      return { ok: false, code: 'TK023_CORRELATION_STATE_LIMIT' };
    }
    const existing = this.data.correlations.get(correlationId);
    if (existing && await canonicalDigest(existing) !== await canonicalDigest(record)) return { ok: false, code: 'TK023_CORRELATION_CONFLICT' };
    this.data.correlations.set(correlationId, record);
    return { ok: true, duplicate: Boolean(existing) };
  }

  async transitionCorrelation(correlationId, expectedState, record) {
    const current = this.data.correlations.get(correlationId);
    if (!current) return { ok: false, code: 'TK023_CORRELATION_STATE_MISSING' };
    if (current.state !== expectedState) return { ok: false, code: 'TK023_CORRELATION_STATE_CONFLICT' };
    for (const key of [
      'repository_id', 'installation_id', 'repository', 'candidate_repository', 'candidate_repository_id',
      'pr_number', 'head_sha', 'base_sha', 'base_generation', 'authority_sha', 'nonce', 'delivery_id',
      'envelope_digest'
    ]) {
      if (current[key] !== record[key]) return { ok: false, code: 'TK023_CORRELATION_IDENTITY_CONFLICT' };
    }
    if (!['completed', 'failed', 'superseded'].includes(record.state)) {
      return { ok: false, code: 'TK023_CORRELATION_TRANSITION_INVALID' };
    }
    this.data.correlations.set(correlationId, record);
    return { ok: true };
  }

  async listCorrelations() {
    return [...this.data.correlations.entries()].map(([id, record]) => ({ id, record })).slice(0, MAX_ACTIVE);
  }

  async putAttestation(attestationId, record) {
    const existing = this.data.attestations.get(attestationId);
    if (existing && await canonicalDigest(existing) !== await canonicalDigest(record)) return { ok: false, code: 'TK023_ATTESTATION_CONFLICT' };
    if (!existing && this.data.attestations.size >= MAX_ATTESTATIONS) return { ok: false, code: 'TK023_ATTESTATION_STATE_LIMIT' };
    this.data.attestations.set(attestationId, record);
    return { ok: true };
  }

  async getAttestation(attestationId) {
    return this.data.attestations.get(attestationId) || null;
  }
}

async function storageMap(storage, name) {
  return new Map(await storage.list({ prefix: `${name}:` }).then((entries) =>
    [...entries].map(([key, value]) => [key.slice(name.length + 1), value])
  ));
}

export class GateRunState {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : {};
    const store = new MemoryRunState({
      checks: await storageMap(this.state.storage, 'checks'),
      correlations: await storageMap(this.state.storage, 'correlations'),
      deliveries: await storageMap(this.state.storage, 'deliveries'),
      nonces: await storageMap(this.state.storage, 'nonces'),
      attestations: await storageMap(this.state.storage, 'attestations')
    });
    let result;
    if (url.pathname === '/deliveries/accept') result = await store.acceptDelivery(body.delivery_id, body.digest);
    else if (url.pathname === '/nonces/accept') result = await store.acceptNonce(body.nonce, body.correlation_id, body.expires_at);
    else if (url.pathname === '/checks/reserve') result = await store.reserveCheck(body.key, body.record);
    else if (url.pathname === '/checks/bind') result = await store.bindCheckRun(body.key, body.check_run_id);
    else if (url.pathname === '/checks/complete') result = await store.completeCheck(body.key, body.terminal_digest, body.conclusion);
    else if (url.pathname === '/correlations/put') result = await store.putCorrelation(body.correlation_id, body.record);
    else if (url.pathname === '/correlations/transition') {
      result = await store.transitionCorrelation(body.correlation_id, body.expected_state, body.record);
    }
    else if (url.pathname === '/correlations/list') result = { ok: true, correlations: await store.listCorrelations() };
    else if (url.pathname === '/attestations/put') result = await store.putAttestation(body.attestation_id, body.record);
    else if (url.pathname === '/attestations/get') result = { ok: true, attestation: await store.getAttestation(body.attestation_id) };
    else result = { ok: false, code: 'TK023_STATE_ROUTE_UNKNOWN' };
    if (!result.ok) return Response.json(result, { status: 409 });
    for (const [name, map] of Object.entries(store.data)) {
      for (const [key, value] of map.entries()) await this.state.storage.put(`${name}:${key}`, value);
    }
    return Response.json(result);
  }
}
