import { canonicalDigest } from './canonical-json.mjs';

const MAX_ACTIVE = 128;
const MAX_DELIVERIES = 2048;
const MAX_NONCES = 512;
const MAX_ATTESTATIONS = 512;
const MAX_PUBLICATION_SETS = 512;
const MIN_TERMINAL_HISTORY = 256;
const MAX_TERMINAL_HISTORY = 2048;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ATTESTATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_BUCKET_RETENTION_DAYS = 400;
const TERMINAL_STATES = new Set(['completed', 'failed', 'superseded']);
const ACTIVE_STATES = new Set(['dispatch_intent', 'dispatch_unknown', 'dispatched', 'publishing']);
const TRANSITIONS = Object.freeze({
  dispatch_intent: new Set(['dispatch_unknown', 'dispatched', 'publishing', 'failed', 'superseded']),
  dispatch_unknown: new Set(['dispatch_unknown', 'dispatched', 'publishing', 'failed', 'superseded']),
  dispatched: new Set(['publishing', 'completed', 'failed', 'superseded']),
  publishing: new Set(['publishing', 'completed', 'failed', 'superseded'])
});
const IDENTITY_KEYS = [
  'repository_id', 'installation_id', 'repository', 'candidate_repository', 'candidate_repository_id',
  'pr_number', 'head_sha', 'base_sha', 'base_generation', 'authority_sha', 'nonce', 'delivery_id',
  'envelope_digest', 'attempt_generation'
];

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function timestamp(record) {
  const parsed = Date.parse(record?.updated_at || record?.created_at || record?.stored_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function headIdentityKey(record) {
  return `${record.repository_id}/${record.pr_number}/${record.head_sha}`;
}

function activeCorrelationCount(correlations) {
  return [...correlations.values()].filter((record) => ACTIVE_STATES.has(record.state)).length;
}

async function digestRecord(record) {
  return canonicalDigest(record);
}

export class MemoryRunState {
  constructor(seed = {}) {
    this.data = {
      checks: new Map(seed.checks || []),
      correlations: new Map(seed.correlations || []),
      deliveries: new Map(seed.deliveries || []),
      nonces: new Map(seed.nonces || []),
      attestations: new Map(seed.attestations || []),
      heads: new Map(seed.heads || []),
      publicationSets: new Map(seed.publicationSets || []),
      audit: new Map(seed.audit || [])
    };
  }

  async archive(kind, key, record, now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10);
    const bucketKey = `${day}/${kind}`;
    const current = this.data.audit.get(bucketKey) || {
      day,
      kind,
      count: 0,
      chain_digest: `sha256:${'0'.repeat(64)}`
    };
    current.chain_digest = await canonicalDigest({
      previous: current.chain_digest,
      key,
      record_digest: await digestRecord(record)
    });
    current.count += 1;
    this.data.audit.set(bucketKey, current);
  }

  async compact(now = Date.now()) {
    const terminal = [...this.data.correlations.entries()]
      .filter(([, record]) => TERMINAL_STATES.has(record.state))
      .sort((left, right) => timestamp(right[1]) - timestamp(left[1]));
    const terminalKeep = new Set(terminal.slice(0, MIN_TERMINAL_HISTORY).map(([key]) => key));
    let retainedTerminal = terminal.length;
    for (const [key, record] of terminal.slice().reverse()) {
      const old = timestamp(record) < now - TERMINAL_RETENTION_MS;
      const aboveHardBound = retainedTerminal > MAX_TERMINAL_HISTORY;
      if (!terminalKeep.has(key) && (old || aboveHardBound)) {
        await this.archive('correlation', key, record, now);
        const publication = this.data.publicationSets.get(key);
        if (publication) await this.archive('publication', key, publication, now);
        this.data.correlations.delete(key);
        this.data.publicationSets.delete(key);
        retainedTerminal -= 1;
      }
    }
    for (const [key, record] of [...this.data.heads.entries()]) {
      if (!this.data.correlations.has(record.current_correlation_id)) {
        await this.archive('head', key, record, now);
        this.data.heads.delete(key);
      }
    }

    const liveHeads = new Set(
      [...this.data.correlations.values()]
        .filter((record) => ACTIVE_STATES.has(record.state))
        .map(headIdentityKey)
    );
    for (const [key, record] of [...this.data.checks.entries()]) {
      if (
        record.state === 'completed' &&
        !liveHeads.has(key.split('/').slice(0, 3).join('/')) &&
        timestamp(record) < now - TERMINAL_RETENTION_MS
      ) {
        await this.archive('check', key, record, now);
        this.data.checks.delete(key);
      }
    }

    const deliveryEntries = [...this.data.deliveries.entries()]
      .sort((left, right) => timestamp(right[1]) - timestamp(left[1]));
    for (const [index, [key, record]] of deliveryEntries.entries()) {
      const old = timestamp(record) < now - DELIVERY_RETENTION_MS;
      if (index >= 512 && (old || index >= MAX_DELIVERIES - 1)) {
        await this.archive('delivery', key, record, now);
        this.data.deliveries.delete(key);
      }
    }
    for (const [key, record] of [...this.data.nonces.entries()]) {
      if (Date.parse(record.expiresAt) < now) this.data.nonces.delete(key);
    }
    const attestations = [...this.data.attestations.entries()]
      .sort((left, right) => timestamp(right[1]) - timestamp(left[1]));
    for (const [index, [key, record]] of attestations.entries()) {
      if (index >= 256 && (timestamp(record) < now - ATTESTATION_RETENTION_MS || index >= MAX_ATTESTATIONS - 1)) {
        await this.archive('attestation', key, record, now);
        this.data.attestations.delete(key);
      }
    }
    const publicationSets = [...this.data.publicationSets.entries()]
      .sort((left, right) => timestamp(right[1]) - timestamp(left[1]));
    for (const [index, [key, record]] of publicationSets.entries()) {
      if (
        record.state === 'published' &&
        index >= MIN_TERMINAL_HISTORY &&
        (timestamp(record) < now - TERMINAL_RETENTION_MS || index >= MAX_PUBLICATION_SETS)
      ) {
        await this.archive('publication', key, record, now);
        this.data.publicationSets.delete(key);
      }
    }

    const oldestAuditDay = new Date(now - AUDIT_BUCKET_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const expiredAudit = [...this.data.audit.entries()]
      .filter(([key]) => key !== 'anchor' && key.slice(0, 10) < oldestAuditDay)
      .sort(([left], [right]) => left.localeCompare(right));
    if (expiredAudit.length) {
      const anchor = this.data.audit.get('anchor') || {
        through: null,
        count: 0,
        chain_digest: `sha256:${'0'.repeat(64)}`
      };
      for (const [key, record] of expiredAudit) {
        anchor.chain_digest = await canonicalDigest({
          previous: anchor.chain_digest,
          bucket: key,
          bucket_digest: await digestRecord(record)
        });
        anchor.count += record.count;
        anchor.through = key.slice(0, 10);
        this.data.audit.delete(key);
      }
      this.data.audit.set('anchor', anchor);
    }
    return { ok: true };
  }

  async acceptDelivery(deliveryId, digest, now = Date.now()) {
    await this.compact(now);
    const existing = this.data.deliveries.get(deliveryId);
    const existingDigest = typeof existing === 'string' ? existing : existing?.digest;
    if (existingDigest && existingDigest !== digest) return { ok: false, code: 'TK023_DELIVERY_CONFLICT' };
    if (existingDigest) return { ok: true, duplicate: true };
    if (this.data.deliveries.size >= MAX_DELIVERIES) return { ok: false, code: 'TK023_DELIVERY_STATE_LIMIT' };
    this.data.deliveries.set(deliveryId, { digest, created_at: nowIso(now) });
    return { ok: true, duplicate: false };
  }

  async acceptNonce(nonce, correlationId, expiresAt, now = Date.now()) {
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry < now || expiry > now + 11 * 60 * 1000) {
      return { ok: false, code: 'TK023_NONCE_EXPIRY_INVALID' };
    }
    await this.compact(now);
    const existing = this.data.nonces.get(nonce);
    if (existing && existing.correlationId !== correlationId) return { ok: false, code: 'TK023_NONCE_REPLAY' };
    if (existing) return { ok: true, duplicate: true };
    if (this.data.nonces.size >= MAX_NONCES) return { ok: false, code: 'TK023_NONCE_STATE_LIMIT' };
    this.data.nonces.set(nonce, { correlationId, expiresAt });
    return { ok: true, duplicate: false };
  }

  async beginAttempt(headKey, correlationId, record, now = Date.now()) {
    await this.compact(now);
    const existingCorrelation = this.data.correlations.get(correlationId);
    if (existingCorrelation) {
      const comparable = { ...record, attempt_generation: existingCorrelation.attempt_generation };
      for (const key of Object.keys(record)) {
        if (existingCorrelation[key] !== comparable[key]) return { ok: false, code: 'TK023_ATTEMPT_CONFLICT' };
      }
      return { ok: true, duplicate: true, generation: existingCorrelation.attempt_generation, existing: existingCorrelation };
    }
    const head = this.data.heads.get(headKey) || { generation: 0, current_correlation_id: null };
    const previousCorrelation = head.current_correlation_id
      ? this.data.correlations.get(head.current_correlation_id)
      : null;
    const effectiveActive = activeCorrelationCount(this.data.correlations) -
      (previousCorrelation && ACTIVE_STATES.has(previousCorrelation.state) ? 1 : 0);
    if (effectiveActive >= MAX_ACTIVE) return { ok: false, code: 'TK023_CORRELATION_STATE_LIMIT' };
    const generation = head.generation + 1;
    if (previousCorrelation && ACTIVE_STATES.has(previousCorrelation.state)) {
      previousCorrelation.state = 'superseded';
      previousCorrelation.failure_code = 'TK023_NEWER_ATTEMPT_ISSUED';
      previousCorrelation.updated_at = nowIso(now);
    }
    const stored = {
      ...record,
      attempt_generation: generation,
      state: 'dispatch_intent',
      created_at: nowIso(now),
      updated_at: nowIso(now)
    };
    this.data.correlations.set(correlationId, stored);
    this.data.heads.set(headKey, {
      generation,
      current_correlation_id: correlationId,
      updated_at: nowIso(now)
    });
    return { ok: true, duplicate: false, generation, existing: stored };
  }

  async getCurrentAttempt(headKey) {
    const head = this.data.heads.get(headKey);
    if (!head) return null;
    return {
      generation: head.generation,
      correlation_id: head.current_correlation_id,
      record: this.data.correlations.get(head.current_correlation_id) || null
    };
  }

  async findCorrelationByDelivery(deliveryId) {
    const matches = [...this.data.correlations.entries()]
      .filter(([, record]) => record.delivery_id === deliveryId)
      .map(([id, record]) => ({ id, record }));
    if (matches.length > 1) return { ok: false, code: 'TK023_DELIVERY_CORRELATION_AMBIGUOUS' };
    return { ok: true, correlation: matches[0] || null };
  }

  async reserveCheck(key, record, attempt = null, now = Date.now()) {
    if (attempt) {
      const head = this.data.heads.get(key.split('/').slice(0, 3).join('/'));
      if (
        head &&
        (head.generation !== attempt.generation || head.current_correlation_id !== attempt.correlationId)
      ) return { ok: false, code: 'TK023_STALE_ATTEMPT' };
    }
    const existing = this.data.checks.get(key);
    if (existing) {
      const incomingDigest = await canonicalDigest(record);
      const existingDigest = await canonicalDigest(existing.record);
      if (incomingDigest !== existingDigest) return { ok: false, code: 'TK023_CHECK_CONFLICT', existing };
      if (attempt) {
        if (attempt.generation < (existing.current_generation || 0)) {
          return { ok: false, code: 'TK023_STALE_ATTEMPT', existing };
        }
        if (
          attempt.generation === existing.current_generation &&
          existing.current_correlation_id &&
          existing.current_correlation_id !== attempt.correlationId
        ) return { ok: false, code: 'TK023_ATTEMPT_CONFLICT', existing };
        if (attempt.generation > (existing.current_generation || 0)) {
          existing.current_generation = attempt.generation;
          existing.current_correlation_id = attempt.correlationId;
          existing.state = 'reserved';
          existing.terminalDigest = null;
          existing.conclusion = null;
          existing.updated_at = nowIso(now);
        }
      }
      return { ok: true, duplicate: true, existing };
    }
    this.data.checks.set(key, {
      record,
      state: 'reserved',
      checkRunId: null,
      terminalDigest: null,
      conclusion: null,
      current_generation: attempt?.generation || 0,
      current_correlation_id: attempt?.correlationId || null,
      created_at: nowIso(now),
      updated_at: nowIso(now)
    });
    return { ok: true, duplicate: false };
  }

  async bindCheckRun(key, checkRunId, generation = null, now = Date.now()) {
    const current = this.data.checks.get(key);
    if (
      !current ||
      (current.checkRunId && current.checkRunId !== checkRunId) ||
      (generation !== null && current.current_generation !== generation)
    ) return { ok: false, code: generation !== null ? 'TK023_STALE_ATTEMPT' : 'TK023_CHECK_RUN_CONFLICT' };
    current.checkRunId = checkRunId;
    if (current.state !== 'completed') current.state = 'in_progress';
    current.updated_at = nowIso(now);
    return { ok: true };
  }

  async completeCheck(key, terminalDigest, conclusion, attempt = null, now = Date.now()) {
    const current = this.data.checks.get(key);
    if (!current) return { ok: false, code: 'TK023_CHECK_STATE_MISSING' };
    if (attempt) {
      if (
        current.current_generation !== attempt.generation ||
        current.current_correlation_id !== attempt.correlationId
      ) return { ok: false, code: 'TK023_STALE_ATTEMPT' };
    }
    if (current.terminalDigest && current.terminalDigest !== terminalDigest) {
      return { ok: false, code: 'TK023_TERMINAL_CONFLICT' };
    }
    if (current.state === 'completed' && current.conclusion !== conclusion) {
      return { ok: false, code: 'TK023_COMPLETION_CONFLICT' };
    }
    const duplicate = current.state === 'completed';
    current.terminalDigest = terminalDigest;
    current.conclusion = conclusion;
    current.state = 'completed';
    current.updated_at = nowIso(now);
    return { ok: true, duplicate };
  }

  async putCorrelation(correlationId, record, now = Date.now()) {
    await this.compact(now);
    const existing = this.data.correlations.get(correlationId);
    if (existing) {
      const merged = { ...existing, ...record, updated_at: existing.updated_at };
      for (const key of ['attempt_generation', 'created_at', 'state']) {
        if (existing[key] !== undefined && record[key] !== undefined && existing[key] !== record[key]) {
          return { ok: false, code: 'TK023_CORRELATION_CONFLICT' };
        }
      }
      this.data.correlations.set(correlationId, merged);
      return { ok: true, duplicate: true };
    }
    if (activeCorrelationCount(this.data.correlations) >= MAX_ACTIVE) {
      return { ok: false, code: 'TK023_CORRELATION_STATE_LIMIT' };
    }
    this.data.correlations.set(correlationId, {
      ...record,
      created_at: record.created_at || nowIso(now),
      updated_at: record.updated_at || nowIso(now)
    });
    return { ok: true, duplicate: false };
  }

  async transitionCorrelation(correlationId, expectedState, record, now = Date.now()) {
    const current = this.data.correlations.get(correlationId);
    if (!current) return { ok: false, code: 'TK023_CORRELATION_STATE_MISSING' };
    const expected = Array.isArray(expectedState) ? expectedState : [expectedState];
    if (!expected.includes(current.state)) return { ok: false, code: 'TK023_CORRELATION_STATE_CONFLICT' };
    for (const key of IDENTITY_KEYS) {
      if (current[key] !== record[key]) return { ok: false, code: 'TK023_CORRELATION_IDENTITY_CONFLICT' };
    }
    if (current.state !== record.state && !TRANSITIONS[current.state]?.has(record.state)) {
      return { ok: false, code: 'TK023_CORRELATION_TRANSITION_INVALID' };
    }
    const next = {
      ...record,
      created_at: current.created_at,
      updated_at: nowIso(now)
    };
    if (current.state === record.state && await digestRecord(current) === await digestRecord(next)) {
      return { ok: true, duplicate: true };
    }
    this.data.correlations.set(correlationId, next);
    return { ok: true, duplicate: false };
  }

  async listCorrelations() {
    return [...this.data.correlations.entries()]
      .map(([id, record]) => ({ id, record }))
      .sort((left, right) => timestamp(right.record) - timestamp(left.record))
      .slice(0, MAX_ACTIVE + MAX_TERMINAL_HISTORY);
  }

  async sealPublicationSet(correlationId, record, now = Date.now()) {
    const correlation = this.data.correlations.get(correlationId);
    if (!correlation) return { ok: false, code: 'TK023_CORRELATION_STATE_MISSING' };
    if (correlation.attempt_generation !== record.attempt_generation) {
      return { ok: false, code: 'TK023_STALE_ATTEMPT' };
    }
    const head = this.data.heads.get(headIdentityKey(correlation));
    if (
      head &&
      (head.generation !== record.attempt_generation || head.current_correlation_id !== correlationId)
    ) return { ok: false, code: 'TK023_STALE_ATTEMPT' };
    const contextIds = Object.keys(record.contexts || {}).sort();
    if (JSON.stringify(contextIds) !== JSON.stringify([
      'repository-security-gate', 'validate', 'validate-toolkit'
    ])) return { ok: false, code: 'TK023_PUBLICATION_SET_INCOMPLETE' };
    const sealedDigest = await canonicalDigest({
      attempt_generation: record.attempt_generation,
      correlation_id: correlationId,
      contexts: record.contexts
    });
    const existing = this.data.publicationSets.get(correlationId);
    if (existing) {
      if (existing.sealed_digest !== sealedDigest) return { ok: false, code: 'TK023_PUBLICATION_SET_CONFLICT' };
      return { ok: true, duplicate: true, publication: existing };
    }
    const publication = {
      attempt_generation: record.attempt_generation,
      correlation_id: correlationId,
      contexts: record.contexts,
      progress: Object.fromEntries(contextIds.map((contextId) => [contextId, 'pending'])),
      sealed_digest: sealedDigest,
      state: 'sealed',
      created_at: nowIso(now),
      updated_at: nowIso(now)
    };
    this.data.publicationSets.set(correlationId, publication);
    return { ok: true, duplicate: false, publication };
  }

  async getPublicationSet(correlationId) {
    return this.data.publicationSets.get(correlationId) || null;
  }

  async markPublicationContext(correlationId, contextId, publicationDigest, now = Date.now()) {
    const publication = this.data.publicationSets.get(correlationId);
    if (!publication || !Object.hasOwn(publication.contexts, contextId)) {
      return { ok: false, code: 'TK023_PUBLICATION_SET_MISSING' };
    }
    const expectedDigest = publication.contexts[contextId].terminalDigest;
    if (expectedDigest !== publicationDigest) return { ok: false, code: 'TK023_PUBLICATION_PROGRESS_CONFLICT' };
    if (publication.progress[contextId] === 'published') return { ok: true, duplicate: true };
    publication.progress[contextId] = 'published';
    publication.updated_at = nowIso(now);
    if (Object.values(publication.progress).every((value) => value === 'published')) publication.state = 'published';
    return { ok: true, duplicate: false, complete: publication.state === 'published' };
  }

  async putAttestation(attestationId, record, now = Date.now()) {
    await this.compact(now);
    const existing = this.data.attestations.get(attestationId);
    const stored = { ...record, stored_at: record.stored_at || nowIso(now) };
    if (existing) {
      const incoming = { ...stored, stored_at: existing.stored_at };
      if (await canonicalDigest(existing) !== await canonicalDigest(incoming)) {
        return { ok: false, code: 'TK023_ATTESTATION_CONFLICT' };
      }
      return { ok: true, duplicate: true };
    }
    if (!existing && this.data.attestations.size >= MAX_ATTESTATIONS) {
      return { ok: false, code: 'TK023_ATTESTATION_STATE_LIMIT' };
    }
    this.data.attestations.set(attestationId, stored);
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

async function loadStore(storage) {
  return new MemoryRunState({
    checks: await storageMap(storage, 'checks'),
    correlations: await storageMap(storage, 'correlations'),
    deliveries: await storageMap(storage, 'deliveries'),
    nonces: await storageMap(storage, 'nonces'),
    attestations: await storageMap(storage, 'attestations'),
    heads: await storageMap(storage, 'heads'),
    publicationSets: await storageMap(storage, 'publicationSets'),
    audit: await storageMap(storage, 'audit')
  });
}

async function persistStore(storage, store) {
  for (const [name, map] of Object.entries(store.data)) {
    const prefix = `${name}:`;
    const existing = await storage.list({ prefix });
    const desired = new Set([...map.keys()].map((key) => `${prefix}${key}`));
    const deleted = [...existing.keys()].filter((key) => !desired.has(key));
    if (deleted.length) await storage.delete(deleted);
    for (const [key, value] of map.entries()) await storage.put(`${prefix}${key}`, value);
  }
}

async function route(store, url, body) {
  if (url.pathname === '/deliveries/accept') return store.acceptDelivery(body.delivery_id, body.digest);
  if (url.pathname === '/nonces/accept') return store.acceptNonce(body.nonce, body.correlation_id, body.expires_at);
  if (url.pathname === '/attempts/begin') {
    return store.beginAttempt(body.head_key, body.correlation_id, body.record);
  }
  if (url.pathname === '/attempts/current') return {
    ok: true,
    attempt: await store.getCurrentAttempt(body.head_key)
  };
  if (url.pathname === '/correlations/by-delivery') return store.findCorrelationByDelivery(body.delivery_id);
  if (url.pathname === '/checks/reserve') return store.reserveCheck(body.key, body.record, body.attempt);
  if (url.pathname === '/checks/bind') {
    return store.bindCheckRun(body.key, body.check_run_id, body.attempt_generation ?? null);
  }
  if (url.pathname === '/checks/complete') {
    return store.completeCheck(body.key, body.terminal_digest, body.conclusion, body.attempt);
  }
  if (url.pathname === '/correlations/put') return store.putCorrelation(body.correlation_id, body.record);
  if (url.pathname === '/correlations/transition') {
    return store.transitionCorrelation(body.correlation_id, body.expected_state, body.record);
  }
  if (url.pathname === '/correlations/list') return { ok: true, correlations: await store.listCorrelations() };
  if (url.pathname === '/publications/seal') {
    return store.sealPublicationSet(body.correlation_id, body.record);
  }
  if (url.pathname === '/publications/get') return {
    ok: true,
    publication: await store.getPublicationSet(body.correlation_id)
  };
  if (url.pathname === '/publications/mark') {
    return store.markPublicationContext(
      body.correlation_id,
      body.context_id,
      body.publication_digest
    );
  }
  if (url.pathname === '/attestations/put') return store.putAttestation(body.attestation_id, body.record);
  if (url.pathname === '/attestations/get') return {
    ok: true,
    attestation: await store.getAttestation(body.attestation_id)
  };
  if (url.pathname === '/compact') return store.compact();
  return { ok: false, code: 'TK023_STATE_ROUTE_UNKNOWN' };
}

export class GateRunState {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : {};
    let result;
    const execute = async (storage) => {
      const store = await loadStore(storage);
      const routed = await route(store, url, body);
      if (routed.ok) {
        await store.compact();
        await persistStore(storage, store);
      }
      return routed;
    };
    if (typeof this.state.storage.transaction === 'function') {
      result = await this.state.storage.transaction(execute);
    } else {
      result = await execute(this.state.storage);
    }
    if (!result.ok) return Response.json(result, { status: 409 });
    return Response.json(result);
  }
}
