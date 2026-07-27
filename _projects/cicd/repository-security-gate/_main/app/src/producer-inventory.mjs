import { ambiguityKey, canonicalDigest, exactKeys } from './canonical-json.mjs';

export const INVENTORY_SCHEMA = 'tk.security.required-check-producer-inventory/v1';
export const REQUIRED_CONTEXTS = Object.freeze([
  Object.freeze({ id: 'repository-security-gate', name: 'Repository security gate', terminalJobId: 'repository-security-terminal' }),
  Object.freeze({ id: 'validate', name: 'Validate', terminalJobId: 'validate-terminal' }),
  Object.freeze({ id: 'validate-toolkit', name: 'Validate Toolkit', terminalJobId: 'validate-toolkit-terminal' })
]);

const ROOT_KEYS = [
  'schema', 'repository', 'candidate_head', 'candidate_tree', 'authority_commit', 'authority_tree',
  'workflow_files', 'jobs', 'edges', 'produced_names', 'required_contexts', 'case_ambiguities', 'producer_records',
  'files', 'inventory_digest', 'status'
];

export async function verifyProducerInventory(document, expected) {
  const failures = [];
  if (!exactKeys(document, ROOT_KEYS)) failures.push('TK023_INVENTORY_FIELDS_INVALID');
  if (document?.schema !== INVENTORY_SCHEMA) failures.push('TK023_INVENTORY_SCHEMA_INVALID');
  if (document?.status !== 'PASS') failures.push('TK023_INVENTORY_NOT_PASS');
  for (const key of ['repository', 'candidate_head', 'candidate_tree', 'authority_commit', 'authority_tree']) {
    if (document?.[key] !== expected[key]) failures.push(`TK023_INVENTORY_${key.toUpperCase()}_MISMATCH`);
  }
  const contexts = Array.isArray(document?.required_contexts) ? document.required_contexts : [];
  if (contexts.length !== REQUIRED_CONTEXTS.length) failures.push('TK023_INVENTORY_CONTEXT_SET_INVALID');
  for (const required of REQUIRED_CONTEXTS) {
    const item = contexts.find((candidate) => candidate.id === required.id);
    if (
      !item ||
      item.name !== required.name ||
      item.publisher_declarations !== 1 ||
      item.terminal_jobs !== 1 ||
      item.github_actions_name_collisions !== 0
    ) failures.push(`TK023_INVENTORY_CONTEXT_${required.id.toUpperCase().replaceAll('-', '_')}_INVALID`);
  }
  if (
    !Number.isInteger(document?.workflow_files) || document.workflow_files > 256 ||
    !Number.isInteger(document?.jobs) || document.jobs > 1024 ||
    !Number.isInteger(document?.edges) || document.edges > 1024 ||
    !Number.isInteger(document?.produced_names) || document.produced_names > 4096
  ) failures.push('TK023_INVENTORY_BOUND_INVALID');
  for (const ambiguity of document?.case_ambiguities || []) {
    if (!Array.isArray(ambiguity.exact_names) || new Set(ambiguity.exact_names.map(ambiguityKey)).size !== 1) {
      failures.push('TK023_INVENTORY_AMBIGUITY_INVALID');
    }
  }
  const unsigned = { ...document };
  delete unsigned.inventory_digest;
  if (await canonicalDigest(unsigned) !== document?.inventory_digest) failures.push('TK023_INVENTORY_DIGEST_MISMATCH');
  return { ok: failures.length === 0, failures: [...new Set(failures)].sort() };
}
