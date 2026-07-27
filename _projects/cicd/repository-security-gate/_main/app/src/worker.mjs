import { base64url, canonicalDigest, canonicalJson, sha256Digest } from './canonical-json.mjs';
import { CHECK_CONTEXTS, publishRequiredCheck } from './check-publisher.mjs';
import {
  buildPublicationReceipt,
  conclusionForEvidence,
  extractSingleJsonArtifact,
  verifyEvidenceBundle
} from './evidence-verifier.mjs';
import { GateRunState } from './run-state.mjs';

const APP_NAME = 'weijunswj-toolkit-security-gate';
const DISPATCH_SCHEMA = 'tk.security.required-check-dispatch/v1';
const WORKFLOW_PATH = '.github/workflows/repository-security-gate.yml';
const MAX_BODY = 1024 * 1024;
const REQUIRED_PERMISSIONS = Object.freeze({
  actions: 'write',
  checks: 'write',
  statuses: 'write',
  contents: 'read',
  pull_requests: 'read',
  metadata: 'read'
});

function fail(code, status = 400) {
  return Response.json({ ok: false, code }, { status });
}

function requiredInteger(value, code) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

function requiredSha(value, code) {
  if (!/^[0-9a-f]{40}$/.test(String(value || ''))) throw new Error(code);
  return value;
}

function requiredBounded(value, max, code) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new Error(code);
  return value;
}

async function hmacHex(secret, bytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, bytes);
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeTextEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyWebhookSignature(request, secret, body) {
  if (!secret) throw new Error('TK023_WEBHOOK_SECRET_MISSING');
  const header = request.headers.get('x-hub-signature-256');
  if (!/^sha256=[0-9a-f]{64}$/.test(String(header || ''))) return false;
  const expected = `sha256=${await hmacHex(secret, body)}`;
  return timingSafeTextEqual(expected, header);
}

function stateClient(env, repositoryId) {
  if (!env.RUN_STATE) throw new Error('TK023_STATE_STORE_UNAVAILABLE');
  const id = env.RUN_STATE.idFromName(String(repositoryId));
  const stub = env.RUN_STATE.get(id);
  async function call(path, body) {
    const response = await stub.fetch(`https://state.invalid${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: canonicalJson(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.code || 'TK023_STATE_STORE_FAILURE');
    return result;
  }
  return {
    acceptDelivery: (deliveryId, digest) => call('/deliveries/accept', { delivery_id: deliveryId, digest }),
    acceptNonce: (nonce, correlationId, expiresAt) => call('/nonces/accept', {
      nonce,
      correlation_id: correlationId,
      expires_at: expiresAt
    }),
    beginAttempt: (headKey, correlationId, record) => call('/attempts/begin', {
      head_key: headKey,
      correlation_id: correlationId,
      record
    }),
    getCurrentAttempt: async (headKey) => (await call('/attempts/current', { head_key: headKey })).attempt,
    findCorrelationByDelivery: async (deliveryId) => (await call('/correlations/by-delivery', {
      delivery_id: deliveryId
    })).correlation,
    reserveCheck: (key, record, attempt = null) => call('/checks/reserve', { key, record, attempt }),
    bindCheckRun: (key, checkRunId, attemptGeneration = null) => call('/checks/bind', {
      key,
      check_run_id: checkRunId,
      attempt_generation: attemptGeneration
    }),
    completeCheck: (key, terminalDigest, conclusion, attempt = null) => call('/checks/complete', {
      key,
      terminal_digest: terminalDigest,
      conclusion,
      attempt
    }),
    putCorrelation: (correlationId, record) => call('/correlations/put', {
      correlation_id: correlationId,
      record
    }),
    transitionCorrelation: (correlationId, expectedState, record) => call('/correlations/transition', {
      correlation_id: correlationId,
      expected_state: expectedState,
      record
    }),
    listCorrelations: async () => (await call('/correlations/list', {})).correlations,
    sealPublicationSet: (correlationId, record) => call('/publications/seal', {
      correlation_id: correlationId,
      record
    }),
    getPublicationSet: async (correlationId) => (await call('/publications/get', {
      correlation_id: correlationId
    })).publication,
    markPublicationContext: (correlationId, contextId, publicationDigest) => call('/publications/mark', {
      correlation_id: correlationId,
      context_id: contextId,
      publication_digest: publicationDigest
    }),
    putAttestation: (attestationId, record) => call('/attestations/put', {
      attestation_id: attestationId,
      record
    }),
    getAttestation: async (attestationId) => (await call('/attestations/get', {
      attestation_id: attestationId
    })).attestation
  };
}

async function importEd25519PrivateKey(pem) {
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')),
    (character) => character.charCodeAt(0)
  );
  return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

async function signDispatch(document, privateKeyPem) {
  const bytes = new TextEncoder().encode(canonicalJson(document));
  const key = await importEd25519PrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, bytes);
  return { envelope: base64url(bytes), signature: base64url(signature), digest: await sha256Digest(bytes) };
}

function randomId(bytes = 24) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

function randomHex(bytes = 16) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertConfiguredIdentity(env) {
  const integrationId = requiredInteger(env.APP_INTEGRATION_ID, 'TK023_APP_INTEGRATION_ID_REQUIRED');
  requiredBounded(env.APP_ID, 32, 'TK023_APP_ID_REQUIRED');
  requiredBounded(env.APP_PRIVATE_KEY, 20000, 'TK023_APP_PRIVATE_KEY_REQUIRED');
  requiredBounded(env.DISPATCH_SIGNING_PRIVATE_KEY, 20000, 'TK023_DISPATCH_KEY_REQUIRED');
  requiredBounded(env.WEBHOOK_SECRET, 512, 'TK023_WEBHOOK_SECRET_REQUIRED');
  return integrationId;
}

function enrolledRepositoryIds(env) {
  const raw = requiredBounded(env.ENROLLED_REPOSITORY_IDS, 2048, 'TK023_REPOSITORY_ENROLLMENT_REQUIRED');
  const values = raw.split(',').map((value) => value.trim());
  if (
    values.length < 1 ||
    values.length > 128 ||
    new Set(values).size !== values.length ||
    values.some((value) => !/^[1-9][0-9]{0,19}$/.test(value))
  ) throw new Error('TK023_REPOSITORY_ENROLLMENT_INVALID');
  return values;
}

function assertRepositoryEnrollment(env, repositoryId) {
  const values = enrolledRepositoryIds(env);
  if (!values.includes(String(repositoryId))) throw new Error('TK023_REPOSITORY_NOT_ENROLLED');
}

export function auditInstallationPermissions(actual) {
  const failures = [];
  for (const [permission, expected] of Object.entries(REQUIRED_PERMISSIONS)) {
    if (permission === 'metadata') continue;
    if (actual?.[permission] !== expected) failures.push(`TK023_PERMISSION_${permission.toUpperCase()}_INVALID`);
  }
  for (const [permission, granted] of Object.entries(actual || {})) {
    if (!Object.hasOwn(REQUIRED_PERMISSIONS, permission) && granted !== 'none') {
      failures.push(`TK023_PERMISSION_${permission.toUpperCase()}_FORBIDDEN`);
    }
  }
  return [...new Set(failures)].sort();
}

async function githubRequest(token, url, init = {}) {
  if (!token) throw new Error('TK023_INSTALLATION_TOKEN_UNAVAILABLE');
  const response = await fetch(`https://api.github.com${url}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': APP_NAME,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const error = new Error(`TK023_GITHUB_${response.status}`);
    error.githubStatus = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function createAppJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(canonicalJson({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(canonicalJson({ iat: now - 30, exp: now + 540, iss: String(env.APP_ID) })));
  const keyBytes = Uint8Array.from(
    atob(env.APP_PRIVATE_KEY.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')),
    (character) => character.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(signature)}`;
}

async function installationToken(env, installationId) {
  const jwt = await createAppJwt(env);
  const response = await githubRequest(jwt, `/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    body: canonicalJson({
      permissions: {
        actions: 'write',
        checks: 'write',
        statuses: 'write',
        contents: 'read',
        pull_requests: 'read'
      }
    })
  });
  const failures = auditInstallationPermissions(response.permissions);
  if (failures.length) throw new Error(failures[0]);
  return response.token;
}

function githubFacade(token) {
  return {
    request: (route, options = {}) => githubRequest(token, route, options)
  };
}

function attemptHeadKey(record) {
  return `${record.repository_id}/${record.pr_number}/${record.head_sha}`;
}

async function transitionState(state, correlation, expectedState, nextState, patch = {}) {
  const next = { ...correlation.record, ...patch, state: nextState };
  await state.transitionCorrelation(correlation.id, expectedState, next);
  correlation.record = next;
  return correlation;
}

async function sealPublicationSet(state, correlation, contexts) {
  const sealed = await state.sealPublicationSet(correlation.id, {
    attempt_generation: correlation.record.attempt_generation,
    contexts
  });
  return sealed.publication;
}

async function publishSealedSet({
  github,
  state,
  integrationId,
  repositoryId,
  owner,
  repo,
  correlation
}) {
  let publication = await state.getPublicationSet(correlation.id);
  if (!publication) throw new Error('TK023_PUBLICATION_SET_MISSING');
  for (const contextId of Object.keys(CHECK_CONTEXTS)) {
    if (publication.progress[contextId] === 'published') continue;
    const context = publication.contexts[contextId];
    await publishRequiredCheck({
      github,
      state,
      integrationId,
      repositoryId,
      owner,
      repo,
      prNumber: correlation.record.pr_number,
      headSha: correlation.record.head_sha,
      contextId,
      status: 'completed',
      conclusion: context.conclusion,
      summary: context.summary,
      terminalDigest: context.terminalDigest,
      attemptGeneration: correlation.record.attempt_generation,
      correlationId: correlation.id
    });
    await state.markPublicationContext(correlation.id, contextId, context.terminalDigest);
    publication = await state.getPublicationSet(correlation.id);
  }
  return publication;
}

async function sealFailureSet(state, correlation, failureCode, runId = 0) {
  const failureDigest = await canonicalDigest({
    schema: 'tk.security.required-check-failure/v1',
    correlation_id: correlation.id,
    attempt_generation: correlation.record.attempt_generation,
    workflow_run_id: Number(runId || 0),
    failure_code: failureCode
  });
  return sealPublicationSet(state, correlation, Object.fromEntries(
    Object.keys(CHECK_CONTEXTS).map((contextId) => [contextId, {
      conclusion: 'failure',
      summary: 'Protected evidence was missing, malformed, stale, conflicting, or unavailable.',
      terminalDigest: failureDigest
    }])
  ));
}

async function cancelSupersededChecks({ github, state, integrationId, repositoryId, owner, repo, prNumber, currentHead }) {
  const correlations = await state.listCorrelations();
  for (const entry of correlations) {
    const record = entry.record;
    if (
      record.pr_number !== prNumber ||
      record.head_sha === currentHead ||
      !['dispatch_intent', 'dispatch_unknown', 'dispatched', 'publishing'].includes(record.state)
    ) continue;
    const existing = await state.getPublicationSet(entry.id);
    if (!existing) {
      const digest = await canonicalDigest({
        schema: 'tk.security.required-check-superseded/v1',
        correlation_id: entry.id,
        attempt_generation: record.attempt_generation,
        current_head: currentHead
      });
      await sealPublicationSet(state, entry, Object.fromEntries(
        Object.keys(CHECK_CONTEXTS).map((contextId) => [contextId, {
          conclusion: 'cancelled',
          summary: 'Superseded by a newer pull-request head.',
          terminalDigest: digest
        }])
      ));
    }
    if (record.state !== 'publishing') {
      await transitionState(state, entry, record.state, 'publishing', {
        failure_code: 'TK023_HEAD_SUPERSEDED'
      });
    }
    await publishSealedSet({ github, state, integrationId, repositoryId, owner, repo, correlation: entry });
    await transitionState(state, entry, 'publishing', 'superseded', {
      failure_code: 'TK023_HEAD_SUPERSEDED'
    });
  }
}

async function discoverDispatchRun(token, owner, repo, defaultBranch, correlation) {
  const runs = await githubRequest(
    token,
    `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(WORKFLOW_PATH)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(defaultBranch)}&per_page=100`
  );
  const matches = (runs.workflow_runs || []).filter((run) =>
    run.display_title === `TK-023 ${correlation.id}` &&
    run.head_sha === correlation.record.authority_sha &&
    run.event === 'workflow_dispatch'
  );
  if (matches.length > 1) throw new Error('TK023_DISPATCH_RUN_AMBIGUOUS');
  return matches[0] || null;
}

async function terminalizeDispatchFailure({
  github,
  state,
  integrationId,
  repositoryId,
  owner,
  repo,
  correlation,
  failureCode
}) {
  const existing = await state.getPublicationSet(correlation.id);
  if (!existing) await sealFailureSet(state, correlation, failureCode);
  if (correlation.record.state !== 'publishing') {
    await transitionState(
      state,
      correlation,
      ['dispatch_intent', 'dispatch_unknown', 'dispatched'],
      'publishing',
      { failure_code: failureCode }
    );
  }
  await publishSealedSet({ github, state, integrationId, repositoryId, owner, repo, correlation });
  await transitionState(state, correlation, 'publishing', 'failed', { failure_code: failureCode });
}

export async function recoverExpiredDispatches(env, options = {}) {
  const integrationId = assertConfiguredIdentity(env);
  const now = Number(options.now ?? Date.now());
  if (!Number.isFinite(now)) throw new Error('TK023_RECOVERY_TIME_INVALID');
  const stateForRepository = options.stateForRepository ||
    ((repositoryId) => stateClient(env, repositoryId));
  const tokenForInstallation = options.tokenForInstallation ||
    ((installationId) => installationToken(env, installationId));
  const githubForToken = options.githubForToken || githubFacade;
  const discoverRun = options.discoverRun || discoverDispatchRun;
  const tokenCache = new Map();
  const failures = [];
  let reconciled = 0;
  let terminalized = 0;

  for (const repositoryIdValue of enrolledRepositoryIds(env)) {
    const repositoryId = requiredInteger(repositoryIdValue, 'TK023_REPOSITORY_ID_INVALID');
    const state = stateForRepository(repositoryId);
    const correlations = await state.listCorrelations();
    for (const correlation of correlations) {
      const record = correlation.record;
      if (
        record.repository_id !== repositoryId ||
        record.state !== 'dispatch_unknown' ||
        !Number.isFinite(Date.parse(record.expires_at || '')) ||
        Date.parse(record.expires_at) >= now
      ) continue;
      const currentAttempt = await state.getCurrentAttempt(attemptHeadKey(record));
      if (
        !currentAttempt ||
        currentAttempt.generation !== record.attempt_generation ||
        currentAttempt.correlation_id !== correlation.id
      ) continue;
      try {
        const [owner, repo, extra] = String(record.repository || '').split('/');
        if (!owner || !repo || extra) throw new Error('TK023_REPOSITORY_INVALID');
        const installationId = requiredInteger(record.installation_id, 'TK023_INSTALLATION_ID_INVALID');
        if (!tokenCache.has(installationId)) {
          tokenCache.set(installationId, Promise.resolve(tokenForInstallation(installationId)));
        }
        const token = await tokenCache.get(installationId);
        const github = githubForToken(token);
        const discovered = await discoverRun(
          token,
          owner,
          repo,
          requiredBounded(record.default_branch, 255, 'TK023_DEFAULT_BRANCH_INVALID'),
          correlation
        );
        if (discovered) {
          await transitionState(state, correlation, 'dispatch_unknown', 'dispatched', {
            workflow_run_id: discovered.id
          });
          reconciled += 1;
          continue;
        }
        await terminalizeDispatchFailure({
          github,
          state,
          integrationId,
          repositoryId,
          owner,
          repo,
          correlation,
          failureCode: 'TK023_DISPATCH_NOT_OBSERVED'
        });
        terminalized += 1;
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new Error('TK023_SCHEDULED_RECOVERY_INCOMPLETE');
  return { ok: true, reconciled, terminalized };
}

function dispatchEnvelopeFromCorrelation(correlation, integrationId) {
  const record = correlation.record;
  return {
    schema: DISPATCH_SCHEMA,
    repository: record.repository,
    repository_id: record.repository_id,
    candidate_repository: record.candidate_repository,
    candidate_repository_id: record.candidate_repository_id,
    installation_id: record.installation_id,
    pr_number: record.pr_number,
    base_ref: record.base_ref,
    base_sha: record.base_sha,
    base_generation: record.base_generation,
    head_sha: record.head_sha,
    authority_sha: record.authority_sha,
    delivery_id: record.delivery_id,
    nonce: record.nonce,
    correlation_id: correlation.id,
    attempt_generation: record.attempt_generation,
    issued_at: record.issued_at,
    expires_at: record.expires_at,
    app_name: APP_NAME,
    integration_id: integrationId
  };
}

async function sendDispatchIntent({
  token,
  github,
  state,
  integrationId,
  repositoryId,
  owner,
  repo,
  correlation
}) {
  if (correlation.record.state === 'dispatch_intent') {
    await transitionState(state, correlation, 'dispatch_intent', 'dispatch_unknown', {
      dispatch_started_at: new Date().toISOString()
    });
  }
  try {
    await githubRequest(token, `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(WORKFLOW_PATH)}/dispatches`, {
      method: 'POST',
      body: canonicalJson({
        ref: correlation.record.default_branch,
        inputs: {
          dispatch_envelope: correlation.record.signed_envelope,
          dispatch_signature: correlation.record.signed_signature,
          dispatch_correlation: correlation.id
        }
      })
    });
    await transitionState(state, correlation, 'dispatch_unknown', 'dispatched');
  } catch (error) {
    const discovered = await discoverDispatchRun(
      token,
      owner,
      repo,
      correlation.record.default_branch,
      correlation
    );
    if (discovered) {
      await transitionState(state, correlation, 'dispatch_unknown', 'dispatched', {
        workflow_run_id: discovered.id
      });
    } else if (
      Number.isInteger(error.githubStatus) &&
      error.githubStatus >= 400 &&
      error.githubStatus < 500 &&
      ![408, 429].includes(error.githubStatus)
    ) {
      await terminalizeDispatchFailure({
        github,
        state,
        integrationId,
        repositoryId,
        owner,
        repo,
        correlation,
        failureCode: error.message
      });
      throw error;
    } else {
      throw new Error('TK023_DISPATCH_OUTCOME_UNKNOWN');
    }
  }
}

async function dispatchForPullRequest(payload, deliveryId, env) {
  const integrationId = assertConfiguredIdentity(env);
  const repositoryId = requiredInteger(payload.repository?.id, 'TK023_REPOSITORY_ID_INVALID');
  const installationId = requiredInteger(payload.installation?.id, 'TK023_INSTALLATION_ID_INVALID');
  const prNumber = requiredInteger(payload.pull_request?.number, 'TK023_PR_NUMBER_INVALID');
  const repository = requiredBounded(payload.repository?.full_name, 200, 'TK023_REPOSITORY_INVALID');
  const candidateRepository = requiredBounded(payload.pull_request?.head?.repo?.full_name, 200, 'TK023_CANDIDATE_REPOSITORY_INVALID');
  const candidateRepositoryId = requiredInteger(payload.pull_request?.head?.repo?.id, 'TK023_CANDIDATE_REPOSITORY_ID_INVALID');
  const [owner, repo] = repository.split('/');
  if (!owner || !repo || payload.action === 'closed') throw new Error('TK023_PULL_REQUEST_EVENT_INVALID');
  assertRepositoryEnrollment(env, repositoryId);
  if (!['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(payload.action)) {
    return { accepted: false, ignored: true };
  }
  const headSha = requiredSha(payload.pull_request?.head?.sha, 'TK023_HEAD_INVALID');
  const baseSha = requiredSha(payload.pull_request?.base?.sha, 'TK023_BASE_INVALID');
  const token = await installationToken(env, installationId);
  const [livePr, repositoryMetadata] = await Promise.all([
    githubRequest(token, `/repos/${owner}/${repo}/pulls/${prNumber}`),
    githubRequest(token, `/repos/${owner}/${repo}`)
  ]);
  if (
    livePr.state !== 'open' ||
    livePr.head.sha !== headSha ||
    livePr.base.sha !== baseSha ||
    livePr.head.repo.full_name !== candidateRepository ||
    Number(livePr.head.repo.id) !== candidateRepositoryId
  ) throw new Error('TK023_PR_IDENTITY_STALE');
  if (Number(livePr.base.repo.id) !== repositoryId || livePr.base.repo.full_name !== repository) throw new Error('TK023_REPOSITORY_IDENTITY_MISMATCH');
  const defaultBranch = requiredBounded(repositoryMetadata.default_branch, 255, 'TK023_DEFAULT_BRANCH_INVALID');
  if (livePr.base.ref !== defaultBranch) throw new Error('TK023_BASE_IS_NOT_DEFAULT_BRANCH');
  const defaultBranchState = await githubRequest(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`);
  const authoritySha = requiredSha(defaultBranchState.commit?.sha, 'TK023_AUTHORITY_INVALID');
  const state = stateClient(env, repositoryId);
  const github = githubFacade(token);
  await cancelSupersededChecks({ github, state, integrationId, repositoryId, owner, repo, prNumber, currentHead: headSha });
  const previousDelivery = await state.findCorrelationByDelivery(deliveryId);
  if (previousDelivery) {
    const correlation = previousDelivery;
    if (
      correlation.record.repository_id !== repositoryId ||
      correlation.record.pr_number !== prNumber ||
      correlation.record.head_sha !== headSha ||
      correlation.record.base_sha !== baseSha ||
      correlation.record.authority_sha !== authoritySha
    ) throw new Error('TK023_DELIVERY_CORRELATION_CONFLICT');
    if (correlation.record.state === 'publishing') {
      await publishSealedSet({ github, state, integrationId, repositoryId, owner, repo, correlation });
      await transitionState(
        state,
        correlation,
        'publishing',
        correlation.record.failure_code ? 'failed' : 'completed'
      );
      return { accepted: true, duplicate: true, correlation_id: correlation.id };
    }
    if (correlation.record.state === 'dispatch_unknown') {
      const discovered = await discoverDispatchRun(token, owner, repo, defaultBranch, correlation);
      if (discovered) {
        await transitionState(state, correlation, 'dispatch_unknown', 'dispatched', {
          workflow_run_id: discovered.id
        });
        return { accepted: true, reconciled: true, correlation_id: correlation.id };
      }
      if (Date.parse(correlation.record.expires_at || '') < Date.now()) {
        await terminalizeDispatchFailure({
          github,
          state,
          integrationId,
          repositoryId,
          owner,
          repo,
          correlation,
          failureCode: 'TK023_DISPATCH_NOT_OBSERVED'
        });
        return { accepted: false, terminalized: true, correlation_id: correlation.id };
      }
      throw new Error('TK023_DISPATCH_OUTCOME_UNKNOWN');
    }
    if (correlation.record.state === 'dispatch_intent') {
      if (Date.parse(correlation.record.expires_at || '') < Date.now()) {
        await terminalizeDispatchFailure({
          github,
          state,
          integrationId,
          repositoryId,
          owner,
          repo,
          correlation,
          failureCode: 'TK023_DISPATCH_INTENT_EXPIRED'
        });
        return { accepted: false, terminalized: true, correlation_id: correlation.id };
      }
      if (!correlation.record.signed_envelope || !correlation.record.signed_signature) {
        const signed = await signDispatch(
          dispatchEnvelopeFromCorrelation(correlation, integrationId),
          env.DISPATCH_SIGNING_PRIVATE_KEY
        );
        correlation.record = {
          ...correlation.record,
          envelope_digest: signed.digest,
          signed_envelope: signed.envelope,
          signed_signature: signed.signature
        };
        await state.acceptNonce(
          correlation.record.nonce,
          correlation.id,
          correlation.record.expires_at
        );
        await state.putCorrelation(correlation.id, correlation.record);
      }
      for (const contextId of Object.keys(CHECK_CONTEXTS)) {
        await publishRequiredCheck({
          github,
          state,
          integrationId,
          repositoryId,
          owner,
          repo,
          prNumber,
          headSha,
          contextId,
          status: 'in_progress',
          summary: 'Protected repository authority is evaluating this exact pull-request head.',
          attemptGeneration: correlation.record.attempt_generation,
          correlationId: correlation.id
        });
      }
      await sendDispatchIntent({
        token,
        github,
        state,
        integrationId,
        repositoryId,
        owner,
        repo,
        correlation
      });
      return { accepted: true, recovered: true, correlation_id: correlation.id };
    }
    return { accepted: true, duplicate: true, correlation_id: correlation.id };
  }
  const issued = new Date();
  const expires = new Date(issued.getTime() + 10 * 60 * 1000);
  const nonce = randomId();
  const correlationId = `tk023:${repositoryId}:${prNumber}:${headSha}:${randomHex(12)}`;
  const headKey = `${repositoryId}/${prNumber}/${headSha}`;
  const attempt = await state.beginAttempt(headKey, correlationId, {
    repository_id: repositoryId,
    installation_id: installationId,
    repository,
    candidate_repository: candidateRepository,
    candidate_repository_id: candidateRepositoryId,
    pr_number: prNumber,
    head_sha: headSha,
    base_sha: baseSha,
    base_generation: Math.max(1, Math.floor(Date.parse(livePr.updated_at) / 1000)),
    authority_sha: authoritySha,
    nonce,
    delivery_id: deliveryId,
    envelope_digest: null,
    base_ref: livePr.base.ref,
    default_branch: defaultBranch,
    integration_id: integrationId,
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString()
  });
  if (!attempt.ok) throw new Error(attempt.code);
  const envelopeDocument = {
    schema: DISPATCH_SCHEMA,
    repository,
    repository_id: repositoryId,
    candidate_repository: candidateRepository,
    candidate_repository_id: candidateRepositoryId,
    installation_id: installationId,
    pr_number: prNumber,
    base_ref: livePr.base.ref,
    base_sha: baseSha,
    base_generation: Math.max(1, Math.floor(Date.parse(livePr.updated_at) / 1000)),
    head_sha: headSha,
    authority_sha: authoritySha,
    delivery_id: deliveryId,
    nonce,
    correlation_id: correlationId,
    attempt_generation: attempt.generation,
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    app_name: APP_NAME,
    integration_id: integrationId
  };
  const signed = await signDispatch(envelopeDocument, env.DISPATCH_SIGNING_PRIVATE_KEY);
  await state.acceptNonce(nonce, correlationId, envelopeDocument.expires_at);
  const correlation = {
    id: correlationId,
    record: {
      repository_id: repositoryId,
      installation_id: installationId,
      repository,
      candidate_repository: candidateRepository,
      candidate_repository_id: candidateRepositoryId,
      pr_number: prNumber,
      head_sha: headSha,
      base_ref: livePr.base.ref,
      base_sha: baseSha,
      base_generation: envelopeDocument.base_generation,
      authority_sha: authoritySha,
      integration_id: integrationId,
      nonce,
      delivery_id: deliveryId,
      envelope_digest: signed.digest,
      attempt_generation: attempt.generation,
      issued_at: envelopeDocument.issued_at,
      expires_at: envelopeDocument.expires_at,
      signed_envelope: signed.envelope,
      signed_signature: signed.signature,
      default_branch: defaultBranch,
      state: 'dispatch_intent'
    }
  };
  await state.putCorrelation(correlationId, correlation.record);
  for (const contextId of Object.keys(CHECK_CONTEXTS)) {
    await publishRequiredCheck({
      github,
      state,
      integrationId,
      repositoryId,
      owner,
      repo,
      prNumber,
      headSha,
      contextId,
      status: 'in_progress',
      summary: 'Protected repository authority is evaluating this exact pull-request head.',
      attemptGeneration: attempt.generation,
      correlationId
    });
  }
  await sendDispatchIntent({
    token,
    github,
    state,
    integrationId,
    repositoryId,
    owner,
    repo,
    correlation
  });
  return { accepted: true, correlation_id: correlationId };
}

async function acceptOidcAttestation(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token || token.length > 20000) return fail('TK023_OIDC_TOKEN_MISSING', 401);
  const binding = await request.json();
  const repositoryId = requiredInteger(binding.repository_id, 'TK023_REPOSITORY_ID_INVALID');
  assertRepositoryEnrollment(env, repositoryId);
  requiredInteger(binding.run_id, 'TK023_OIDC_RUN_ID_INVALID');
  requiredInteger(binding.run_attempt, 'TK023_OIDC_RUN_ATTEMPT_INVALID');
  requiredInteger(binding.github_job_id, 'TK023_OIDC_JOB_ID_INVALID');
  requiredSha(binding.authority_commit, 'TK023_OIDC_AUTHORITY_INVALID');
  requiredBounded(binding.workflow_ref, 500, 'TK023_OIDC_WORKFLOW_REF_INVALID');
  if (!/^[a-z0-9-]{1,80}$/.test(binding.job_id || '')) return fail('TK023_OIDC_STATIC_JOB_ID_INVALID', 400);
  const state = stateClient(env, repositoryId);
  const claimsResponse = await fetch('https://token.actions.githubusercontent.com/.well-known/openid-configuration');
  if (!claimsResponse.ok) return fail('TK023_OIDC_DISCOVERY_UNAVAILABLE', 503);
  const configuration = await claimsResponse.json();
  const jwksResponse = await fetch(configuration.jwks_uri);
  if (!jwksResponse.ok) return fail('TK023_OIDC_JWKS_UNAVAILABLE', 503);
  const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedClaims || !encodedSignature) return fail('TK023_OIDC_TOKEN_MALFORMED', 401);
  const decodePart = (value) => {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${standard}${'='.repeat((4 - standard.length % 4) % 4)}`;
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  };
  const header = JSON.parse(new TextDecoder().decode(decodePart(encodedHeader)));
  const claims = JSON.parse(new TextDecoder().decode(decodePart(encodedClaims)));
  const keys = await jwksResponse.json();
  const jwk = keys.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.use === 'sig');
  if (!jwk || header.alg !== 'RS256') return fail('TK023_OIDC_KEY_INVALID', 401);
  const verificationKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    verificationKey,
    decodePart(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
  );
  if (!signatureValid) return fail('TK023_OIDC_SIGNATURE_INVALID', 401);
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== 'https://token.actions.githubusercontent.com' ||
    !Number.isInteger(claims.exp) ||
    claims.exp < now ||
    (Number.isInteger(claims.nbf) && claims.nbf > now + 30) ||
    claims.aud !== APP_NAME ||
    claims.repository_id !== String(repositoryId) ||
    claims.event_name !== 'workflow_dispatch' ||
    claims.repository !== binding.workflow_ref.split('/.github/workflows/')[0] ||
    claims.workflow_ref !== binding.workflow_ref ||
    claims.workflow_sha !== binding.authority_commit ||
    claims.sha !== binding.authority_commit ||
    claims.run_id !== String(binding.run_id) ||
    claims.run_attempt !== String(binding.run_attempt) ||
    claims.check_run_id !== String(binding.github_job_id)
  ) return fail('TK023_OIDC_CLAIMS_INVALID', 401);
  const attestationId = await canonicalDigest({
    issuer: claims.iss,
    subject: claims.sub,
    repository_id: claims.repository_id,
    workflow_ref: claims.workflow_ref,
    workflow_sha: claims.workflow_sha,
    run_id: claims.run_id,
    run_attempt: claims.run_attempt,
    check_run_id: claims.check_run_id,
    binding
  });
  await state.putAttestation(attestationId, { claims, binding });
  return Response.json({ ok: true, attestation_id: attestationId });
}

async function processWorkflowRun(payload, env) {
  if (payload.action !== 'completed' || payload.workflow_run?.event !== 'workflow_dispatch') return { accepted: false, ignored: true };
  const repositoryId = requiredInteger(payload.repository?.id, 'TK023_REPOSITORY_ID_INVALID');
  const installationId = requiredInteger(payload.installation?.id, 'TK023_INSTALLATION_ID_INVALID');
  const repository = requiredBounded(payload.repository?.full_name, 200, 'TK023_REPOSITORY_INVALID');
  assertRepositoryEnrollment(env, repositoryId);
  const [owner, repo] = repository.split('/');
  const state = stateClient(env, repositoryId);
  const correlations = await state.listCorrelations();
  const candidates = correlations.filter((entry) =>
    entry.record.repository_id === repositoryId &&
    entry.record.authority_sha === payload.workflow_run.head_sha &&
    payload.workflow_run.display_title === `TK-023 ${entry.id}` &&
    ['dispatch_unknown', 'dispatched', 'publishing', 'completed'].includes(entry.record.state)
  );
  if (candidates.length !== 1) throw new Error('TK023_CORRELATION_AMBIGUOUS');
  const correlation = candidates[0];
  const currentAttempt = await state.getCurrentAttempt(attemptHeadKey(correlation.record));
  if (
    !currentAttempt ||
    currentAttempt.generation !== correlation.record.attempt_generation ||
    currentAttempt.correlation_id !== correlation.id
  ) throw new Error('TK023_STALE_ATTEMPT');
  const integrationId = assertConfiguredIdentity(env);
  const token = await installationToken(env, installationId);
  const github = githubFacade(token);
  if (correlation.record.state === 'publishing') {
    await publishSealedSet({ github, state, integrationId, repositoryId, owner, repo, correlation });
    await transitionState(
      state,
      correlation,
      'publishing',
      correlation.record.failure_code ? 'failed' : 'completed'
    );
    return { accepted: true, reconciled: true };
  }
  if (correlation.record.state === 'completed') return { accepted: true, duplicate: true };
  if (correlation.record.state === 'dispatch_unknown') {
    await transitionState(state, correlation, 'dispatch_unknown', 'dispatched', {
      workflow_run_id: payload.workflow_run.id
    });
  }
  const repositoryMetadata = await githubRequest(token, `/repos/${owner}/${repo}`);
  const livePr = await githubRequest(token, `/repos/${owner}/${repo}/pulls/${correlation.record.pr_number}`);
  if (
    livePr.state !== 'open' ||
    livePr.head.sha !== correlation.record.head_sha ||
    livePr.head.repo.full_name !== correlation.record.candidate_repository ||
    Number(livePr.head.repo.id) !== correlation.record.candidate_repository_id
  ) throw new Error('TK023_PR_HEAD_STALE');
  if (
    payload.workflow_run.path !== WORKFLOW_PATH ||
    payload.workflow_run.head_branch !== repositoryMetadata.default_branch ||
    payload.workflow_run.head_sha !== correlation.record.authority_sha ||
    // Native reruns are ineligible. A retry is a fresh App dispatch with a
    // new correlation and nonce, which creates a new first-attempt run.
    payload.workflow_run.run_attempt !== 1
  ) throw new Error('TK023_WORKFLOW_AUTHORITY_INVALID');
  const authorityCommit = await githubRequest(token, `/repos/${owner}/${repo}/git/commits/${correlation.record.authority_sha}`);
  const [candidateOwner, candidateRepo] = correlation.record.candidate_repository.split('/');
  const candidateCommit = await githubRequest(
    token,
    `/repos/${candidateOwner}/${candidateRepo}/git/commits/${correlation.record.head_sha}`
  );
  const artifacts = await githubRequest(token, `/repos/${owner}/${repo}/actions/runs/${payload.workflow_run.id}/artifacts?per_page=100`);
  const workflowJobs = await githubRequest(
    token,
    `/repos/${owner}/${repo}/actions/runs/${payload.workflow_run.id}/attempts/${payload.workflow_run.run_attempt}/jobs?per_page=100`
  );
  async function readArtifact(name, entryName) {
    const matching = (artifacts.artifacts || []).filter((artifact) => artifact.name === name && !artifact.expired);
    if (matching.length !== 1) throw new Error('TK023_ARTIFACT_COUNT_INVALID');
    const artifact = matching[0];
    if (!/^sha256:[0-9a-f]{64}$/.test(String(artifact.digest || ''))) throw new Error('TK023_ARTIFACT_DIGEST_INVALID');
    const download = await fetch(artifact.archive_download_url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': APP_NAME
      }
    });
    if (!download.ok) throw new Error('TK023_ARTIFACT_DOWNLOAD_FAILED');
    return { artifact, document: await extractSingleJsonArtifact(download, entryName) };
  }
  const inventoryEvidence = await readArtifact(
    `tk023-producer-inventory-${correlation.record.head_sha}`,
    'producer-inventory.json'
  );
  const generatedEvidence = await readArtifact(
    `tk023-generated-surface-${correlation.record.head_sha}`,
    'generated-surface-result.json'
  );
  const securityEvidence = await readArtifact(
    `tk023-security-report-${correlation.record.head_sha}`,
    'security-gate.json'
  );
  const generatedUnsigned = { ...generatedEvidence.document };
  delete generatedUnsigned.result_digest;
  if (await canonicalDigest(generatedUnsigned) !== generatedEvidence.document.result_digest) {
    throw new Error('TK023_GENERATED_SURFACE_DIGEST_INVALID');
  }
  const securityUnsigned = { ...securityEvidence.document };
  delete securityUnsigned.report_digest;
  if (await sha256Digest(`${JSON.stringify(securityUnsigned)}\n`) !== securityEvidence.document.report_digest) {
    throw new Error('TK023_SECURITY_REPORT_DIGEST_INVALID');
  }
  const authorityUnsigned = { ...(securityEvidence.document.trusted_authority || {}) };
  delete authorityUnsigned.manifest_digest;
  if (
    await sha256Digest(JSON.stringify(authorityUnsigned)) !==
    securityEvidence.document.trusted_authority?.manifest_digest
  ) throw new Error('TK023_AUTHORITY_MANIFEST_DIGEST_INVALID');
  if (
    generatedEvidence.document.status !== 'PASS' ||
    generatedEvidence.document.candidate_head !== correlation.record.head_sha ||
    generatedEvidence.document.candidate_tree !== candidateCommit.tree.sha ||
    generatedEvidence.document.authority_commit !== correlation.record.authority_sha ||
    generatedEvidence.document.authority_tree !== authorityCommit.tree.sha ||
    !/^sha256:[0-9a-f]{64}$/.test(generatedEvidence.document.result_digest)
  ) throw new Error('TK023_GENERATED_SURFACE_EVIDENCE_INVALID');
  if (
    securityEvidence.document.state !== 'SECURITY_PASS' ||
    securityEvidence.document.head !== correlation.record.head_sha ||
    securityEvidence.document.base !== correlation.record.base_sha ||
    securityEvidence.document.trusted_authority?.commit !== correlation.record.authority_sha ||
    securityEvidence.document.trusted_authority?.tree !== authorityCommit.tree.sha ||
    !/^sha256:[0-9a-f]{64}$/.test(securityEvidence.document.report_digest)
  ) throw new Error('TK023_SECURITY_REPORT_INVALID');
  const contexts = {};
  for (const [contextId, contextName] of Object.entries(CHECK_CONTEXTS)) {
    const expectedName = `tk023-terminal-${contextId}-${correlation.record.head_sha}`;
    const matching = (artifacts.artifacts || []).filter((artifact) => artifact.name === expectedName && !artifact.expired);
    const failures = [];
    if (matching.length !== 1) failures.push('TK023_ARTIFACT_COUNT_INVALID');
    let terminal = null;
    let artifactDigest = null;
    if (matching.length === 1) {
      const artifact = matching[0];
      artifactDigest = artifact.digest;
      const download = await fetch(artifact.archive_download_url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': APP_NAME
        }
      });
      terminal = await extractSingleJsonArtifact(download);
    }
    const terminalJobName = {
      'repository-security-gate': 'TK-023 authority / repository security terminal',
      validate: 'TK-023 authority / validate terminal',
      'validate-toolkit': 'TK-023 authority / validate toolkit terminal'
    }[contextId];
    const matchingJobs = (workflowJobs.jobs || []).filter((job) => job.name === terminalJobName);
    if (matchingJobs.length !== 1 || matchingJobs[0].conclusion !== 'success') failures.push('TK023_TERMINAL_JOB_INVALID');
    const githubJobId = matchingJobs[0]?.id;
    const expected = {
      inventory: {
        repository,
        candidate_head: correlation.record.head_sha,
        candidate_tree: candidateCommit.tree.sha,
        authority_commit: correlation.record.authority_sha,
        authority_tree: authorityCommit.tree.sha
      },
      terminal: {
        context_id: contextId,
        context_name: contextName,
        repository,
        repository_id: repositoryId,
        pr_number: correlation.record.pr_number,
        head_sha: correlation.record.head_sha,
        head_tree: candidateCommit.tree.sha,
        base_sha: correlation.record.base_sha,
        base_generation: correlation.record.base_generation,
        authority_commit: correlation.record.authority_sha,
        authority_tree: authorityCommit.tree.sha,
        workflow_path: WORKFLOW_PATH,
        workflow_digest: terminal?.workflow_digest,
        run_id: payload.workflow_run.id,
        run_attempt: payload.workflow_run.run_attempt,
        attempt_generation: correlation.record.attempt_generation,
        job_id: `${contextId === 'repository-security-gate' ? 'repository-security' : contextId}-terminal`,
        github_job_id: githubJobId,
        correlation_id: correlation.id,
        nonce: correlation.record.nonce,
        producer_inventory_digest: terminal?.producer_inventory_digest,
        report_state: contextId === 'repository-security-gate' ? 'SECURITY_PASS' : 'VALIDATION_PASS',
        mandatory_prerequisites: terminal?.mandatory_prerequisites?.map((item) => item.job_id) || []
      },
      artifact_digest: artifactDigest,
      authority_commit: correlation.record.authority_sha,
      run_attempt: payload.workflow_run.run_attempt,
      head_sha: correlation.record.head_sha,
      github_job_id: githubJobId
    };
    let verification = { ok: false, failures };
    if (terminal && failures.length === 0) {
      const attestation = await state.getAttestation(terminal.oidc_attestation_id);
      verification = await verifyEvidenceBundle({
        inventory: inventoryEvidence.document,
        terminal,
        artifact_digest: artifactDigest,
        workflow_run: payload.workflow_run,
        current_pr: { state: livePr.state, head_sha: livePr.head.sha },
        oidc_attestation: attestation?.binding
      }, expected);
    }
    const conclusion = conclusionForEvidence(terminal?.report_state, verification.ok);
    const terminalDigest = terminal?.receipt_digest || `sha256:${'0'.repeat(64)}`;
    const publication = await buildPublicationReceipt({
      context_id: contextId,
      context_name: contextName,
      repository_id: repositoryId,
      pr_number: correlation.record.pr_number,
      head_sha: correlation.record.head_sha,
      base_sha: correlation.record.base_sha,
      authority_commit: correlation.record.authority_sha,
      workflow_run_id: payload.workflow_run.id,
      workflow_run_attempt: payload.workflow_run.run_attempt,
      attempt_generation: correlation.record.attempt_generation,
      terminal_job_id: expected.terminal.job_id,
      github_job_id: terminal?.github_job_id || 0,
      artifact_id: matching[0]?.id || 0,
      artifact_digest: artifactDigest || `sha256:${'0'.repeat(64)}`,
      terminal_receipt_digest: terminalDigest,
      producer_inventory_digest: terminal?.producer_inventory_digest || `sha256:${'0'.repeat(64)}`,
      generated_surface_digest: generatedEvidence.document.result_digest,
      security_report_digest: securityEvidence.document.report_digest,
      integration_id: integrationId,
      correlation_id: correlation.id,
      nonce: correlation.record.nonce,
      report_state: terminal?.report_state || 'SECURITY_GATE_UNVERIFIED',
      check_conclusion: conclusion,
      publication_status: verification.ok ? 'PUBLISHED' : 'REJECTED',
      failure_codes: verification.failures
    });
    contexts[contextId] = {
      conclusion,
      summary: verification.ok ? 'Protected terminal evidence verified.' : 'Protected terminal evidence failed closed.',
      terminalDigest: publication.publication_digest
    };
  }
  const finalPr = await githubRequest(token, `/repos/${owner}/${repo}/pulls/${correlation.record.pr_number}`);
  if (
    finalPr.state !== 'open' ||
    finalPr.head.sha !== correlation.record.head_sha ||
    finalPr.head.repo.full_name !== correlation.record.candidate_repository ||
    Number(finalPr.head.repo.id) !== correlation.record.candidate_repository_id
  ) throw new Error('TK023_PR_HEAD_STALE');
  await sealPublicationSet(state, correlation, contexts);
  await transitionState(state, correlation, 'dispatched', 'publishing', {
    workflow_run_id: payload.workflow_run.id
  });
  await publishSealedSet({ github, state, integrationId, repositoryId, owner, repo, correlation });
  await transitionState(state, correlation, 'publishing', 'completed');
  return { accepted: true };
}

async function failWorkflowRunChecks(payload, env, failureCode) {
  const repositoryId = requiredInteger(payload.repository?.id, 'TK023_REPOSITORY_ID_INVALID');
  const installationId = requiredInteger(payload.installation?.id, 'TK023_INSTALLATION_ID_INVALID');
  const repository = requiredBounded(payload.repository?.full_name, 200, 'TK023_REPOSITORY_INVALID');
  assertRepositoryEnrollment(env, repositoryId);
  const [owner, repo] = repository.split('/');
  const state = stateClient(env, repositoryId);
  const correlations = await state.listCorrelations();
  const candidates = correlations.filter((entry) =>
    entry.record.repository_id === repositoryId &&
    entry.record.authority_sha === payload.workflow_run?.head_sha &&
    payload.workflow_run?.display_title === `TK-023 ${entry.id}` &&
    ['dispatch_unknown', 'dispatched', 'publishing', 'completed', 'failed'].includes(entry.record.state)
  );
  if (candidates.length !== 1) return false;
  const correlation = candidates[0];
  const currentAttempt = await state.getCurrentAttempt(attemptHeadKey(correlation.record));
  if (
    !currentAttempt ||
    currentAttempt.generation !== correlation.record.attempt_generation ||
    currentAttempt.correlation_id !== correlation.id
  ) return false;
  const integrationId = assertConfiguredIdentity(env);
  const token = await installationToken(env, installationId);
  const github = githubFacade(token);
  if (correlation.record.state === 'completed' || correlation.record.state === 'failed') return true;
  const existing = await state.getPublicationSet(correlation.id);
  if (!existing) {
    await sealFailureSet(state, correlation, failureCode, payload.workflow_run?.id);
  }
  if (correlation.record.state !== 'publishing') {
    const transitionPatch = { workflow_run_id: Number(payload.workflow_run?.id || 0) };
    if (!existing) transitionPatch.failure_code = failureCode;
    await transitionState(
      state,
      correlation,
      ['dispatch_unknown', 'dispatched'],
      'publishing',
      transitionPatch
    );
  }
  await publishSealedSet({ github, state, integrationId, repositoryId, owner, repo, correlation });
  const publicationFailed = Boolean(correlation.record.failure_code);
  await transitionState(
    state,
    correlation,
    'publishing',
    publicationFailed ? 'failed' : 'completed',
    publicationFailed ? { failure_code: correlation.record.failure_code } : {}
  );
  return true;
}

export async function handleRequest(request, env) {
  let event = null;
  let payload = null;
  try {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ ok: true, app: APP_NAME });
    if (url.pathname === '/workflow/oidc-attest' && request.method === 'POST') return acceptOidcAttestation(request, env);
    if (url.pathname !== '/github/webhook' || request.method !== 'POST') return fail('TK023_ROUTE_NOT_FOUND', 404);
    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BODY) return fail('TK023_WEBHOOK_BODY_TOO_LARGE', 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_BODY) return fail('TK023_WEBHOOK_BODY_TOO_LARGE', 413);
    if (!await verifyWebhookSignature(request, env.WEBHOOK_SECRET, bytes)) return fail('TK023_WEBHOOK_SIGNATURE_INVALID', 401);
    event = request.headers.get('x-github-event');
    const deliveryId = requiredBounded(request.headers.get('x-github-delivery'), 100, 'TK023_DELIVERY_ID_INVALID');
    payload = JSON.parse(new TextDecoder().decode(bytes));
    const repositoryId = requiredInteger(payload.repository?.id, 'TK023_REPOSITORY_ID_INVALID');
    const state = stateClient(env, repositoryId);
    const delivery = await state.acceptDelivery(deliveryId, await sha256Digest(bytes));
    let result;
    if (event === 'pull_request') result = await dispatchForPullRequest(payload, deliveryId, env);
    else if (event === 'workflow_run') result = await processWorkflowRun(payload, env);
    else return fail('TK023_WEBHOOK_EVENT_FORBIDDEN', 400);
    return Response.json({ ok: true, duplicate_delivery: delivery.duplicate, ...result });
  } catch (error) {
    const code = /^TK023_[A-Z0-9_]+$/.test(String(error?.message || '')) ? error.message : 'TK023_APP_INTERNAL_FAILURE';
    if (event === 'workflow_run' && payload) {
      try {
        await failWorkflowRunChecks(payload, env, code);
      } catch {
        // A publication failure cannot be downgraded. Missing successful App
        // evidence remains blocking even when the failure receipt cannot post.
      }
    }
    return fail(code, code === 'TK023_DISPATCH_OUTCOME_UNKNOWN' ? 503 : 500);
  }
}

export { GateRunState };

export default {
  fetch: handleRequest,
  scheduled(controller, env, context) {
    context.waitUntil(recoverExpiredDispatches(env, {
      now: Number(controller?.scheduledTime || Date.now())
    }));
  }
};
