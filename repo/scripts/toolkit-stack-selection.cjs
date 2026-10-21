'use strict';

const crypto = require('node:crypto');
const roles = Object.freeze(['DISCOVERY', 'DISCOVERY_HELPER', 'BUILDER', 'BUILDER_HELPER', 'DESIGN_CHALLENGE']);
function reject(code) { throw Object.assign(new Error(code), { code }); }
function compiler() { return require('./toolkit-gate-contract-compiler.cjs'); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function copy(value) { return compiler().trustedJsonCopy(value); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Owns one captured source revision, not a mutable global choice table.
class StackRegistrySnapshot {
  #reference;
  #registry;
  #digest;
  constructor({ reference, content_base64 }) {
    const ref = copy(reference);
    if (!ref || Object.keys(ref).sort().join('|') !== ['id','repository','revision','path','content_sha256','blob_sha1'].sort().join('|')
      || !ref.id || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(ref.repository || '') || !ref.revision || !ref.path
      || !/^[a-f0-9]{64}$/.test(ref.content_sha256 || '') || ref.blob_sha1 !== null && !/^[a-f0-9]{40}$/.test(ref.blob_sha1 || '')) reject('STACK_REGISTRY_REFERENCE_INVALID');
    if (typeof content_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content_base64)) reject('STACK_REGISTRY_BYTES_INVALID');
    const bytes = Buffer.from(content_base64, 'base64');
    if (!bytes.length || bytes.length > 256 * 1024 || bytes.toString('base64') !== content_base64
      || digest(bytes) !== ref.content_sha256) reject('STACK_REGISTRY_SOURCE_DRIFT');
    // SHA-1 is required for Git blob object-ID compatibility;
    // SHA-256 independently verifies content integrity.
    // codeql[js/weak-cryptographic-algorithm]
    const blob = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (ref.blob_sha1 !== null && blob !== ref.blob_sha1) reject('STACK_REGISTRY_BLOB_DRIFT');
    let registry;
    try { registry = JSON.parse(bytes); } catch { reject('STACK_REGISTRY_BYTES_INVALID'); }
    // Only the current registry shape is accepted; a superseded registry is rejected here.
    compiler().checkCoreSchema(registry, compiler().contractSchema('stack-registry-v3.schema.json'));
    for (const profile of Object.values(registry.profiles)) {
      const ids = new Set();
      for (const member of profile.reviewers) {
        if (ids.has(member.reviewer_id)) reject('STACK_REVIEWER_ID_DUPLICATE');
        ids.add(member.reviewer_id);
      }
    }
    this.#reference = freeze(ref); this.#registry = freeze(registry);
    this.#digest = digest(bytes);
  }
  get reference() { return this.#reference; }
  get sourceDigest() { return this.#digest; }
  get profileIds() { return Object.freeze(Object.keys(this.#registry.profiles)); }
  resolve(profileId) {
    if (typeof profileId !== 'string' || !profileId || profileId.trim() !== profileId) reject('STACK_SELECTION_REQUIRED');
    if (!Object.hasOwn(this.#registry.profiles, profileId)) reject('STACK_SELECTION_UNKNOWN');
    const profile = this.#registry.profiles[profileId];
    return freeze({ schema: 'toolkit.stack-selection.v1',
      profile_id: profileId, requested_profile_id: profileId, registry_version: this.#registry.version,
      registry_reference: copy(this.#reference), registry_digest: this.#digest,
      routes: copy(profile.routes), reviewers: copy(profile.reviewers) });
  }
  assertSelection(selection) {
    const value = copy(selection), expected = this.resolve(value.requested_profile_id);
    if (compiler().hashCanonical(expected) !== compiler().hashCanonical(value)) reject('STACK_SELECTION_BINDING_DRIFT');
    return expected;
  }
  role(selection, role, reviewerId = null) {
    const value = this.assertSelection(selection);
    if (role === 'REVIEW') {
      if (typeof reviewerId !== 'string' || !reviewerId) reject('STACK_REVIEWER_REQUIRED');
      const member = value.reviewers.find(item => item.reviewer_id === reviewerId);
      if (!member) reject('STACK_REVIEWER_UNADMITTED');
      const { reviewer_id, ...route } = member;
      return freeze({ role, reviewer_id, route, registry_reference: value.registry_reference, registry_digest: value.registry_digest });
    }
    if (reviewerId !== null || !Object.hasOwn(value.routes, role) || !roles.includes(role)) reject('STACK_ROLE_UNADMITTED');
    return freeze({ role, reviewer_id: null, route: copy(value.routes[role]), registry_reference: value.registry_reference, registry_digest: value.registry_digest });
  }
}

// Source-pinned serialized bindings cross hook/plugin process boundaries. Each
// receiver verifies actual registry bytes before using the selected routes.
class CapturedStackBinding {
  #snapshot;
  #selection;
  constructor({ source_capture, selection }) {
    this.#snapshot = new StackRegistrySnapshot(copy(source_capture));
    this.#selection = this.#snapshot.assertSelection(selection);
  }
  get selection() { return this.#selection; }
  get sourceDigest() { return this.#snapshot.sourceDigest; }
  role(role, reviewerId = null) { return this.#snapshot.role(this.#selection, role, reviewerId); }
}

module.exports = Object.freeze({ StackRegistrySnapshot, CapturedStackBinding });
