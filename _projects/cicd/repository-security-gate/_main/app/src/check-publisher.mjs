import { canonicalDigest, canonicalJson } from './canonical-json.mjs';

export const CHECK_CONTEXTS = Object.freeze({
  'repository-security-gate': 'Repository security gate',
  validate: 'Validate',
  'validate-toolkit': 'Validate Toolkit'
});

export function durableCheckKey(repositoryId, prNumber, headSha, contextId) {
  if (!Number.isInteger(repositoryId) || repositoryId < 1 || !Number.isInteger(prNumber) || prNumber < 1) {
    throw new TypeError('Repository and PR identities must be positive integers');
  }
  if (!/^[0-9a-f]{40}$/.test(headSha) || !Object.hasOwn(CHECK_CONTEXTS, contextId)) throw new TypeError('Required-check identity is invalid');
  return `${repositoryId}/${prNumber}/${headSha}/${contextId}`;
}

export function externalId(repositoryId, prNumber, headSha, contextId) {
  return `tk023/${durableCheckKey(repositoryId, prNumber, headSha, contextId)}`;
}

async function listCheckRuns(github, owner, repo, ref, checkName) {
  if (typeof github.request === 'function') {
    const document = await github.request(
      `/repos/${owner}/${repo}/commits/${ref}/check-runs?check_name=${encodeURIComponent(checkName)}&per_page=100`
    );
    return document.check_runs || [];
  }
  return github.listCheckRuns({ owner, repo, ref, checkName });
}

function createCheckRun(github, owner, repo, payload) {
  if (typeof github.request === 'function') {
    return github.request(`/repos/${owner}/${repo}/check-runs`, {
      method: 'POST',
      body: canonicalJson(payload)
    });
  }
  return github.createCheckRun({ owner, repo, payload });
}

function updateCheckRun(github, owner, repo, checkRunId, payload) {
  if (typeof github.request === 'function') {
    return github.request(`/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
      method: 'PATCH',
      body: canonicalJson(payload)
    });
  }
  return github.updateCheckRun({ owner, repo, checkRunId, payload });
}

export async function publishRequiredCheck(options) {
  const {
    github, state, integrationId, repositoryId, owner, repo, prNumber, headSha,
    contextId, status, conclusion = null, summary, terminalDigest = null,
    attemptGeneration = null, correlationId = null
  } = options;
  if (!Number.isInteger(integrationId) || integrationId < 1) throw new Error('TK023_APP_INTEGRATION_ID_REQUIRED');
  if (!Object.hasOwn(CHECK_CONTEXTS, contextId)) throw new Error('TK023_CHECK_CONTEXT_FORBIDDEN');
  if (!['in_progress', 'completed'].includes(status)) throw new Error('TK023_CHECK_STATUS_INVALID');
  if (status === 'completed' && !['success', 'failure', 'timed_out', 'cancelled'].includes(conclusion)) {
    throw new Error('TK023_CHECK_CONCLUSION_INVALID');
  }
  const attempt = attemptGeneration === null && correlationId === null
    ? null
    : { generation: Number(attemptGeneration), correlationId };
  if (
    attempt &&
    (!Number.isInteger(attempt.generation) || attempt.generation < 1 ||
      typeof attempt.correlationId !== 'string' || attempt.correlationId.length < 1)
  ) throw new Error('TK023_CHECK_ATTEMPT_INVALID');
  const key = durableCheckKey(repositoryId, prNumber, headSha, contextId);
  const name = CHECK_CONTEXTS[contextId];
  const existingRuns = await listCheckRuns(github, owner, repo, headSha, name);
  const foreign = existingRuns.filter((run) => Number(run.app?.id) !== integrationId);
  if (foreign.length > 0) throw new Error('TK023_FOREIGN_SAME_NAME_CHECK');
  const own = existingRuns.filter((run) => Number(run.app?.id) === integrationId);
  if (own.length > 1) throw new Error('TK023_DUPLICATE_APP_CHECK');
  const reservation = await state.reserveCheck(key, {
    repositoryId, prNumber, headSha, contextId, name, externalId: externalId(repositoryId, prNumber, headSha, contextId)
  }, attempt);
  if (!reservation.ok) throw new Error(reservation.code);
  let checkRun = own[0] || (
    reservation.existing?.checkRunId
      ? {
          id: reservation.existing.checkRunId,
          external_id: externalId(repositoryId, prNumber, headSha, contextId),
          app: { id: integrationId }
        }
      : null
  );
  const payload = {
    name,
    head_sha: headSha,
    external_id: externalId(repositoryId, prNumber, headSha, contextId),
    status,
    output: {
      title: name,
      summary: String(summary || '').slice(0, 1000)
    }
  };
  if (checkRun) {
    const bound = await state.bindCheckRun(key, checkRun.id, attempt?.generation ?? null);
    if (!bound.ok) throw new Error(bound.code);
  }
  if (status === 'completed') {
    if (!terminalDigest) throw new Error('TK023_TERMINAL_EVIDENCE_REQUIRED');
    const completed = await state.completeCheck(key, terminalDigest, conclusion, attempt);
    if (!completed.ok) throw new Error(completed.code);
    payload.conclusion = conclusion;
    payload.completed_at = new Date().toISOString();
  }
  if (!checkRun) {
    checkRun = await createCheckRun(github, owner, repo, payload);
    await state.bindCheckRun(key, checkRun.id, attempt?.generation ?? null);
  } else {
    if (checkRun.external_id !== payload.external_id) throw new Error('TK023_CHECK_EXTERNAL_ID_CONFLICT');
    checkRun = await updateCheckRun(github, owner, repo, checkRun.id, payload);
  }
  return {
    key,
    check_run_id: checkRun.id,
    external_id: payload.external_id,
    context_id: contextId,
    context_name: name,
    status,
    conclusion,
    publication_input_digest: await canonicalDigest(payload)
  };
}
