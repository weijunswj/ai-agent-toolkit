import { canonicalDigest, exactKeys, sha256Digest } from './canonical-json.mjs';
import { CHECK_CONTEXTS, externalId } from './check-publisher.mjs';
import { verifyProducerInventory } from './producer-inventory.mjs';

export const TERMINAL_SCHEMA = 'tk.security.required-check-terminal-receipt/v1';
export const PUBLICATION_SCHEMA = 'tk.security.required-check-publication/v1';

const TERMINAL_KEYS = [
  'schema', 'context_id', 'context_name', 'repository', 'repository_id', 'pr_number', 'head_sha',
  'head_tree', 'base_sha', 'base_generation', 'authority_commit', 'authority_tree', 'workflow_path',
  'workflow_digest', 'run_id', 'run_attempt', 'attempt_generation', 'job_id', 'github_job_id',
  'correlation_id', 'nonce',
  'producer_inventory_digest', 'mandatory_prerequisites', 'oidc_attestation_id', 'report_state', 'status',
  'failure_codes', 'receipt_digest'
];

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function inflateBounded(compressed, maximum) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error('TK023_ARTIFACT_ENTRY_INVALID');
    }
    chunks.push(value);
  }
  const plain = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    plain.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return plain;
}

export async function extractSingleJsonArtifact(response, expectedName = 'terminal-receipt.json') {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 98 || bytes.length > 2 * 1024 * 1024) throw new Error('TK023_ARTIFACT_SIZE_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('TK023_ARTIFACT_ZIP_INVALID');
  const commentLength = view.getUint16(eocdOffset + 20, true);
  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntries = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (
    eocdOffset + 22 + commentLength !== bytes.length ||
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== 1 ||
    totalEntries !== 1 ||
    centralOffset + centralSize !== eocdOffset ||
    centralSize < 46 ||
    view.getUint32(centralOffset, true) !== 0x02014b50
  ) throw new Error('TK023_ARTIFACT_ZIP_INVALID');

  const centralFlags = view.getUint16(centralOffset + 8, true);
  const madeBy = view.getUint16(centralOffset + 4, true);
  const method = view.getUint16(centralOffset + 10, true);
  const expectedCrc = view.getUint32(centralOffset + 16, true);
  const compressedSize = view.getUint32(centralOffset + 20, true);
  const uncompressedSize = view.getUint32(centralOffset + 24, true);
  const centralNameLength = view.getUint16(centralOffset + 28, true);
  const centralExtraLength = view.getUint16(centralOffset + 30, true);
  const centralCommentLength = view.getUint16(centralOffset + 32, true);
  const startDisk = view.getUint16(centralOffset + 34, true);
  const externalAttributes = view.getUint32(centralOffset + 38, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  const centralEnd = centralOffset + 46 + centralNameLength + centralExtraLength + centralCommentLength;
  if (
    centralEnd !== eocdOffset ||
    localOffset !== 0 ||
    startDisk !== 0 ||
    (centralFlags & 0x0009) !== 0 ||
    compressedSize === 0xffffffff ||
    uncompressedSize === 0xffffffff ||
    uncompressedSize > 1024 * 1024
  ) throw new Error('TK023_ARTIFACT_ENTRY_INVALID');
  const unixMode = madeBy >>> 8 === 3 ? externalAttributes >>> 16 : 0;
  if (unixMode && (unixMode & 0xf000) !== 0x8000) throw new Error('TK023_ARTIFACT_ENTRY_INVALID');
  let centralName;
  try {
    centralName = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.slice(centralOffset + 46, centralOffset + 46 + centralNameLength)
    );
  } catch {
    throw new Error('TK023_ARTIFACT_ENTRY_INVALID');
  }
  if (
    centralName !== expectedName ||
    centralName.includes('/') ||
    centralName.includes('\\') ||
    centralName.includes('\0')
  ) throw new Error('TK023_ARTIFACT_ENTRY_INVALID');

  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('TK023_ARTIFACT_ZIP_INVALID');
  const localFlags = view.getUint16(localOffset + 6, true);
  const localMethod = view.getUint16(localOffset + 8, true);
  const localCrc = view.getUint32(localOffset + 14, true);
  const localCompressedSize = view.getUint32(localOffset + 18, true);
  const localUncompressedSize = view.getUint32(localOffset + 22, true);
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const localNameStart = localOffset + 30;
  const localNameEnd = localNameStart + localNameLength;
  const start = localNameEnd + localExtraLength;
  const end = start + compressedSize;
  let localName;
  try {
    localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(localNameStart, localNameEnd));
  } catch {
    throw new Error('TK023_ARTIFACT_ENTRY_INVALID');
  }
  if (
    localName !== centralName ||
    localFlags !== centralFlags ||
    localMethod !== method ||
    localCrc !== expectedCrc ||
    localCompressedSize !== compressedSize ||
    localUncompressedSize !== uncompressedSize ||
    end !== centralOffset
  ) throw new Error('TK023_ARTIFACT_ZIP_INVALID');
  const compressed = bytes.slice(start, end);
  let plain;
  if (method === 0) plain = compressed;
  else if (method === 8) plain = await inflateBounded(compressed, 1024 * 1024);
  else throw new Error('TK023_ARTIFACT_COMPRESSION_UNSUPPORTED');
  if (plain.length !== uncompressedSize || crc32(plain) !== expectedCrc) {
    throw new Error('TK023_ARTIFACT_LENGTH_MISMATCH');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new Error('TK023_ARTIFACT_JSON_INVALID');
  }
}

export async function verifyTerminalReceipt(document, expected) {
  const failures = [];
  if (!exactKeys(document, TERMINAL_KEYS)) failures.push('TK023_TERMINAL_FIELDS_INVALID');
  if (document?.schema !== TERMINAL_SCHEMA) failures.push('TK023_TERMINAL_SCHEMA_INVALID');
  for (const key of [
    'context_id', 'context_name', 'repository', 'repository_id', 'pr_number', 'head_sha', 'head_tree',
    'base_sha', 'base_generation', 'authority_commit', 'authority_tree', 'workflow_path', 'workflow_digest',
    'run_id', 'run_attempt', 'attempt_generation', 'job_id', 'github_job_id', 'correlation_id', 'nonce',
    'producer_inventory_digest', 'report_state'
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
    attempt_generation: input.attempt_generation,
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
