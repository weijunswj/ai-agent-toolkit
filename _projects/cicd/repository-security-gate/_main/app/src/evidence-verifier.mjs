import { canonicalDigest, exactKeys, sha256Digest } from './canonical-json.mjs';
import { CHECK_CONTEXTS, externalId } from './check-publisher.mjs';
import { verifyProducerInventory } from './producer-inventory.mjs';

export const TERMINAL_SCHEMA = 'tk.security.required-check-terminal-receipt/v1';
export const PUBLICATION_SCHEMA = 'tk.security.required-check-publication/v1';

const TERMINAL_KEYS = [
  'schema', 'context_id', 'context_name', 'repository', 'repository_id', 'pr_number', 'head_sha',
  'head_tree', 'base_sha', 'base_generation', 'authority_commit', 'authority_tree', 'workflow_path',
  'workflow_digest', 'run_id', 'run_attempt', 'job_id', 'github_job_id', 'correlation_id', 'nonce',
  'producer_inventory_digest', 'mandatory_prerequisites', 'oidc_attestation_id', 'report_state', 'status',
  'failure_codes', 'receipt_digest'
];

export async function extractSingleJsonArtifact(response, expectedName = 'terminal-receipt.json') {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 30 || bytes.length > 2 * 1024 * 1024) throw new Error('TK023_ARTIFACT_SIZE_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error('TK023_ARTIFACT_ZIP_INVALID');
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const uncompressedSize = view.getUint32(22, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
  if (name !== expectedName || uncompressedSize > 1024 * 1024) throw new Error('TK023_ARTIFACT_ENTRY_INVALID');
  const start = 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + compressedSize);
  let plain;
  if (method === 0) plain = compressed;
  else if (method === 8) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    plain = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error('TK023_ARTIFACT_COMPRESSION_UNSUPPORTED');
  if (plain.length !== uncompressedSize) throw new Error('TK023_ARTIFACT_LENGTH_MISMATCH');
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function verifyTerminalReceipt(document, expected) {
  const failures = [];
  if (!exactKeys(document, TERMINAL_KEYS)) failures.push('TK023_TERMINAL_FIELDS_INVALID');
  if (document?.schema !== TERMINAL_SCHEMA) failures.push('TK023_TERMINAL_SCHEMA_INVALID');
  for (const key of [
    'context_id', 'context_name', 'repository', 'repository_id', 'pr_number', 'head_sha', 'head_tree',
    'base_sha', 'base_generation', 'authority_commit', 'authority_tree', 'workflow_path', 'workflow_digest',
    'run_id', 'run_attempt', 'job_id', 'github_job_id', 'correlation_id', 'nonce', 'producer_inventory_digest',
    'report_state'
  ]) {
    if (document?.[key] !== expected[key]) failures.push(`TK023_TERMINAL_${key.toUpperCase()}_MISMATCH`);
  }
  if (document?.status !== 'PASS' || document?.failure_codes?.length !== 0) failures.push('TK023_TERMINAL_NOT_PASS');
  const expectedNeeds = [...expected.mandatory_prerequisites].sort();
  const actualNeeds = (document?.mandatory_prerequisites || []).map((item) => item.job_id).sort();
  if (JSON.stringify(actualNeeds) !== JSON.stringify(expectedNeeds)) failures.push('TK023_TERMINAL_NEEDS_SET_MISMATCH');
  if ((document?.mandatory_prerequisites || []).some((item) => item.result !== 'success')) failures.push('TK023_TERMINAL_NEEDS_NOT_SUCCESS');
  const unsigned = { ...document };
  delete unsigned.receipt_digest;
  if (await canonicalDigest(unsigned) !== document?.receipt_digest) failures.push('TK023_TERMINAL_DIGEST_MISMATCH');
  return { ok: failures.length === 0, failures: [...new Set(failures)].sort() };
}

export function conclusionForEvidence(reportState, verificationOk) {
  if (!verificationOk) return 'failure';
  if (reportState === 'SECURITY_PASS' || reportState === 'VALIDATION_PASS') return 'success';
  if (reportState === 'DISPATCH_TIMEOUT') return 'timed_out';
  if (reportState === 'STALE_HEAD' || reportState === 'SUPERSEDED') return 'cancelled';
  return 'failure';
}

export async function buildPublicationReceipt(input) {
  const contextName = CHECK_CONTEXTS[input.context_id];
  if (!contextName || contextName !== input.context_name) throw new Error('TK023_PUBLICATION_CONTEXT_INVALID');
  const unsigned = {
    schema: PUBLICATION_SCHEMA,
    context_id: input.context_id,
    context_name: input.context_name,
    repository_id: input.repository_id,
    pr_number: input.pr_number,
    head_sha: input.head_sha,
    base_sha: input.base_sha,
    authority_commit: input.authority_commit,
    workflow_run_id: input.workflow_run_id,
    workflow_run_attempt: input.workflow_run_attempt,
    terminal_job_id: input.terminal_job_id,
    github_job_id: input.github_job_id,
    artifact_id: input.artifact_id,
    artifact_digest: input.artifact_digest,
    terminal_receipt_digest: input.terminal_receipt_digest,
    producer_inventory_digest: input.producer_inventory_digest,
    generated_surface_digest: input.generated_surface_digest,
    security_report_digest: input.security_report_digest,
    integration_id: input.integration_id,
    external_id: externalId(input.repository_id, input.pr_number, input.head_sha, input.context_id),
    correlation_id: input.correlation_id,
    nonce: input.nonce,
    report_state: input.report_state,
    check_conclusion: input.check_conclusion,
    publication_status: input.publication_status,
    failure_codes: [...new Set(input.failure_codes || [])].sort()
  };
  return { ...unsigned, publication_digest: await canonicalDigest(unsigned) };
}

export async function verifyEvidenceBundle(bundle, expected) {
  const failures = [];
  const inventory = await verifyProducerInventory(bundle.inventory, expected.inventory);
  failures.push(...inventory.failures);
  const terminal = await verifyTerminalReceipt(bundle.terminal, expected.terminal);
  failures.push(...terminal.failures);
  if (bundle.artifact_digest !== expected.artifact_digest) failures.push('TK023_ARTIFACT_DIGEST_MISMATCH');
  if (bundle.workflow_run?.event !== 'workflow_dispatch') failures.push('TK023_WORKFLOW_EVENT_INVALID');
  if (bundle.workflow_run?.head_sha !== expected.authority_commit) failures.push('TK023_WORKFLOW_AUTHORITY_REF_INVALID');
  if (bundle.workflow_run?.run_attempt !== expected.run_attempt) failures.push('TK023_WORKFLOW_ATTEMPT_INVALID');
  if (bundle.current_pr?.state !== 'open' || bundle.current_pr?.head_sha !== expected.head_sha) failures.push('TK023_PR_HEAD_STALE');
  if (
    !bundle.oidc_attestation ||
    bundle.oidc_attestation.job_id !== expected.terminal.job_id ||
    bundle.oidc_attestation.github_job_id !== expected.github_job_id
  ) failures.push('TK023_OIDC_ATTESTATION_INVALID');
  return { ok: failures.length === 0, failures: [...new Set(failures)].sort() };
}
