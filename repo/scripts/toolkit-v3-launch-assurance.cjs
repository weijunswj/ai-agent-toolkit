'use strict';

// One launch-assurance contract for every automated Toolkit launch path. Each host keeps its own
// enforcement in its adapter or launcher; this module states the shared pre-inference invariants and
// evaluates the family-closure record that says, per path and invariant, how each one is met, held or
// not applicable, with the code and tests that back the claim. A closed family means every path in the
// frozen profile was inventoried and every invariant dispositioned. It is not native qualification:
// that stays a separate per-path field, and source tests never upgrade it.

const crypto = require('node:crypto');
const compiler = require('./toolkit-gate-contract-compiler.cjs');

function refuse(code, detail = null) { throw Object.assign(new Error(code), { code, detail }); }
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const ident = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,95}$/.test(value);
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 600;
const repoPath = value => typeof value === 'string' && /^(repo|\.codex-plugin|\.claude-plugin|skills)\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes('..');
function closedKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse('LAUNCH_FAMILY_RECORD_INVALID');
  const names = Object.keys(value);
  if (required.some(k => !Object.hasOwn(value, k)) || names.some(k => !required.includes(k) && !optional.includes(k))) {
    refuse('LAUNCH_FAMILY_RECORD_INVALID', { expected: required });
  }
}

// The shared pre-inference invariants. A human's manually launched first layer is outside the family:
// its model and effort choice is advisory.
const INVARIANTS = Object.freeze({
  PINNED_ROUTE: 'An automated G0/G1/G2 worker, successor or permitted helper runs on the exact provider, model and effort of its selected pinned-stack role and member.',
  CALLER_OVERRIDE: 'A caller-supplied provider, model, effort, fallback or agent override that differs from the pinned route is refused.',
  INHERITED_CONFIGURATION: 'Environment, configuration and settings sources the host applies are checked, or the effective route is read back from the host, before inference; a source that cannot be verified holds.',
  ZERO_EFFECT_REFUSAL: 'A refusal or hold starts no native process, inference or dispatch.',
  RESUME_AND_SUCCESSOR: 'Resume, fork and successor launches are checked as a fresh start is, or refused.',
  GUARD_FAILURE: 'A missing, disabled, erroring or timed-out guard fails closed.',
  NO_LEAF_OR_G2_DELEGATION: 'Leaf helpers and G2 reviewers cannot delegate, and a launch without a helper request starts no helper.',
  OBSERVED_ROUTE: 'An observed effective route that differs from the pinned route is not success.'
});
const INVARIANT_IDS = Object.freeze(Object.keys(INVARIANTS));
const PATH_KINDS = Object.freeze(['OWNED_LAUNCHER', 'NATIVE_PRE_DISPATCH_HOOK', 'NO_TOOLKIT_LAUNCHER']);
// ENFORCED: shipped code enforces the invariant on this path. evidence says how it was shown:
// SOURCE_TEST (in-process source tests), PROCESS (the real hook or launcher process with crafted
// input, no host), NATIVE (exercised through the real host) or INSTALLED (through an installed
// consumer). Only NATIVE and INSTALLED are runtime evidence.
const DISPOSITIONS = Object.freeze(['ENFORCED', 'HELD', 'NOT_APPLICABLE']);
const EVIDENCE = Object.freeze(['SOURCE_TEST', 'PROCESS', 'NATIVE', 'INSTALLED']);
const RUNTIME_EVIDENCE = Object.freeze(['NATIVE', 'INSTALLED']);
const QUALIFICATION = Object.freeze(['DEMONSTRATED', 'UNQUALIFIED', 'HELD']);
const SITE_CLASSES = Object.freeze(['LAUNCH_PATH', 'NOT_A_MODEL_LAUNCH']);
// A native hook can fail at layers its own handler never sees. Every hook path accounts for each
// layer: what the host does there, and what, if anything, protects the helper path.
const FAILURE_LAYERS = Object.freeze(['HANDLED_EXCEPTION', 'MODULE_LOAD', 'PROCESS_START_OR_CRASH', 'HOST_TIMEOUT', 'MISSING_OR_DISABLED', 'MATCHER_COVERAGE']);
const LAYER_OUTCOMES = Object.freeze(['DENIED', 'PROCEEDS', 'UNVERIFIED']);
const LAYER_PROTECTIONS = Object.freeze(['GUARD_DENIES', 'HOST_DENY_RULE', 'HELD', 'NONE']);

class LaunchPath {
  #value;
  constructor(input) {
    closedKeys(input, ['id', 'host', 'kind', 'in_profile', 'roles', 'entrypoints', 'invariants', 'native_qualification', 'mutation', 'unqualified']);
    const v = input;
    if (!ident(v.id) || !['claude-code', 'codex', 'opencode', 'dot'].includes(v.host) || !PATH_KINDS.includes(v.kind) || typeof v.in_profile !== 'boolean'
      || !Array.isArray(v.roles) || !v.roles.every(text) || !Array.isArray(v.entrypoints) || !Array.isArray(v.unqualified) || !v.unqualified.every(text)) {
      refuse('LAUNCH_FAMILY_PATH_INVALID', { path: v.id });
    }
    for (const entry of v.entrypoints) {
      closedKeys(entry, ['file', 'contains']);
      if (!repoPath(entry.file) || !text(entry.contains)) refuse('LAUNCH_FAMILY_PATH_INVALID', { path: v.id });
    }
    if (v.kind !== 'NO_TOOLKIT_LAUNCHER' && !v.entrypoints.length) refuse('LAUNCH_FAMILY_ENTRYPOINT_REQUIRED', { path: v.id });
    closedKeys(v.invariants, INVARIANT_IDS);
    for (const id of INVARIANT_IDS) LaunchPath.#checkDisposition(v.id, id, v.invariants[id]);
    LaunchPath.#checkFailureLayers(v);
    closedKeys(v.native_qualification, ['status', 'basis'], ['history']);
    if (!QUALIFICATION.includes(v.native_qualification.status) || !text(v.native_qualification.basis)) refuse('LAUNCH_FAMILY_QUALIFICATION_INVALID', { path: v.id });
    // Superseded claims are kept, not rewritten: each names what superseded it.
    for (const entry of v.native_qualification.history ?? []) {
      closedKeys(entry, ['status', 'basis', 'superseded_by']);
      if (!QUALIFICATION.includes(entry.status) || !text(entry.basis) || !text(entry.superseded_by)) refuse('LAUNCH_FAMILY_QUALIFICATION_INVALID', { path: v.id });
    }
    if (v.native_qualification.history !== undefined && (!Array.isArray(v.native_qualification.history) || !v.native_qualification.history.length)) refuse('LAUNCH_FAMILY_QUALIFICATION_INVALID', { path: v.id });
    // A native claim needs runtime evidence on at least one enforced invariant; source or process tests
    // alone cannot carry it. A host path also needs failure resilience, so a held guard-failure invariant
    // cannot sit under a demonstrated qualification.
    const enforced = INVARIANT_IDS.map(id => v.invariants[id]).filter(d => d.disposition === 'ENFORCED');
    if (v.native_qualification.status === 'DEMONSTRATED' && (!enforced.some(d => RUNTIME_EVIDENCE.includes(d.evidence)) || v.invariants.GUARD_FAILURE.disposition === 'HELD')) {
      refuse('LAUNCH_FAMILY_QUALIFICATION_UNSUPPORTED', { path: v.id });
    }
    if (v.mutation !== null) {
      closedKeys(v.mutation, ['custody', 'baseline', 'mutants_caught']);
      if (!text(v.mutation.custody) || !/^[a-f0-9]{40}$/.test(v.mutation.baseline) || !Number.isSafeInteger(v.mutation.mutants_caught) || v.mutation.mutants_caught < 1) {
        refuse('LAUNCH_FAMILY_MUTATION_INVALID', { path: v.id });
      }
    }
    this.#value = compiler.trustedJsonCopy(v);
  }

  // A hook path's GUARD_FAILURE lists every failure layer once. It may be ENFORCED only when no layer
  // is left to an unprotected host, and the guard cannot be credited where the host never runs it.
  static #checkFailureLayers(v) {
    const d = v.invariants.GUARD_FAILURE, layers = d.failure_layers;
    if (layers === undefined) {
      // A hook path whose whole host route is held (no supported receiver) has no layers to account for.
      if (v.kind === 'NATIVE_PRE_DISPATCH_HOOK' && d.disposition !== 'NOT_APPLICABLE' && v.native_qualification?.status !== 'HELD') refuse('LAUNCH_FAMILY_FAILURE_LAYERS_REQUIRED', { path: v.id });
      return;
    }
    if (!Array.isArray(layers) || layers.map(l => l?.layer).sort().join('|') !== [...FAILURE_LAYERS].sort().join('|')) refuse('LAUNCH_FAMILY_FAILURE_LAYERS_REQUIRED', { path: v.id });
    for (const l of layers) {
      closedKeys(l, ['layer', 'outcome', 'protection', 'basis']);
      if (!LAYER_OUTCOMES.includes(l.outcome) || !LAYER_PROTECTIONS.includes(l.protection) || !text(l.basis)) refuse('LAUNCH_FAMILY_FAILURE_LAYERS_REQUIRED', { path: v.id, layer: l.layer });
      const hostRunsGuard = !['PROCESS_START_OR_CRASH', 'HOST_TIMEOUT', 'MISSING_OR_DISABLED'].includes(l.layer);
      if ((l.protection === 'GUARD_DENIES' && !hostRunsGuard) || (l.outcome === 'DENIED' && ['HELD', 'NONE'].includes(l.protection))) {
        refuse('LAUNCH_FAMILY_GUARD_FAILURE_OVERSTATED', { path: v.id, layer: l.layer });
      }
    }
    if (d.disposition === 'ENFORCED' && layers.some(l => l.outcome !== 'DENIED')) refuse('LAUNCH_FAMILY_GUARD_FAILURE_OVERSTATED', { path: v.id });
  }

  static #checkDisposition(path, invariant, d) {
    if (!d || !DISPOSITIONS.includes(d.disposition)) refuse('LAUNCH_FAMILY_DISPOSITION_INVALID', { path, invariant });
    const optional = invariant === 'GUARD_FAILURE' ? ['failure_layers'] : [];
    if (d.disposition === 'ENFORCED') {
      closedKeys(d, ['disposition', 'evidence', 'code', 'tests'], ['note', ...optional]);
      if (!EVIDENCE.includes(d.evidence) || !Array.isArray(d.code) || !d.code.length || !Array.isArray(d.tests) || !d.tests.length) {
        refuse('LAUNCH_FAMILY_ENFORCEMENT_UNSUPPORTED', { path, invariant });
      }
      for (const c of d.code) { closedKeys(c, ['file', 'contains']); if (!repoPath(c.file) || !text(c.contains)) refuse('LAUNCH_FAMILY_ENFORCEMENT_UNSUPPORTED', { path, invariant }); }
      for (const t of d.tests) { closedKeys(t, ['file', 'title']); if (!repoPath(t.file) || !text(t.title)) refuse('LAUNCH_FAMILY_ENFORCEMENT_UNSUPPORTED', { path, invariant }); }
      if (d.note !== undefined && !text(d.note)) refuse('LAUNCH_FAMILY_DISPOSITION_INVALID', { path, invariant });
    } else if (d.disposition === 'HELD') {
      closedKeys(d, ['disposition', 'hold', 'owner', 'reason'], optional);
      if (!/^[A-Z0-9_]{4,96}$/.test(d.hold) || !text(d.owner) || !text(d.reason)) refuse('LAUNCH_FAMILY_HOLD_INVALID', { path, invariant });
    } else {
      closedKeys(d, ['disposition', 'reason'], optional);
      if (!text(d.reason)) refuse('LAUNCH_FAMILY_DISPOSITION_INVALID', { path, invariant });
    }
  }

  get value() { return this.#value; }
}

// The record for one family: the frozen supported profile, every inventoried launch site and every path.
class LaunchFamilyClosure {
  #record; #paths; #readRepoFile;
  constructor(record, { readRepoFile }) {
    if (typeof readRepoFile !== 'function') refuse('LAUNCH_FAMILY_READER_REQUIRED');
    const value = compiler.trustedJsonCopy(record);
    closedKeys(value, ['schema', 'family_id', 'statement', 'frozen_profile', 'manual_first_layer', 'inventory', 'paths']);
    if (value.schema !== 'toolkit.v3.launch-family-closure.v1' || !ident(value.family_id) || !text(value.statement) || !text(value.manual_first_layer)) {
      refuse('LAUNCH_FAMILY_RECORD_INVALID');
    }
    closedKeys(value.frozen_profile, ['hosts', 'statement']);
    if (!Array.isArray(value.frozen_profile.hosts) || !value.frozen_profile.hosts.every(text) || !text(value.frozen_profile.statement)) refuse('LAUNCH_FAMILY_RECORD_INVALID');
    if (!Array.isArray(value.paths) || !value.paths.length) refuse('LAUNCH_FAMILY_RECORD_INVALID');
    this.#paths = value.paths.map(p => new LaunchPath(p).value);
    const ids = this.#paths.map(p => p.id);
    if (new Set(ids).size !== ids.length) refuse('LAUNCH_FAMILY_PATH_DUPLICATE');
    if (!Array.isArray(value.inventory) || !value.inventory.length) refuse('LAUNCH_FAMILY_INVENTORY_REQUIRED');
    for (const site of value.inventory) {
      closedKeys(site, ['file', 'class', 'detail'], ['path']);
      if (!repoPath(site.file) || !SITE_CLASSES.includes(site.class) || !text(site.detail)) refuse('LAUNCH_FAMILY_INVENTORY_INVALID', { file: site.file });
      if (site.class === 'LAUNCH_PATH' ? !ids.includes(site.path) : site.path !== undefined) refuse('LAUNCH_FAMILY_INVENTORY_INVALID', { file: site.file });
    }
    const files = value.inventory.map(s => s.file);
    if (new Set(files).size !== files.length) refuse('LAUNCH_FAMILY_INVENTORY_INVALID');
    this.#record = value; this.#readRepoFile = readRepoFile;
  }

  get record() { return this.#record; }
  get inventoriedFiles() { return this.#record.inventory.map(s => s.file); }

  #read(file, cache) {
    if (!cache.has(file)) {
      let content;
      try { content = this.#readRepoFile(file); } catch { content = null; }
      cache.set(file, typeof content === 'string' ? content : null);
    }
    return cache.get(file);
  }

  // Verifies every claim against the checked-out bytes and returns the closure state for `candidate`.
  evaluate({ candidate }) {
    if (!text(candidate)) refuse('LAUNCH_FAMILY_CANDIDATE_REQUIRED');
    const cache = new Map(), gaps = [], runtime = [], sourceOnly = [], processOnly = [], held = [], notApplicable = [], unqualified = [], failOpen = [];
    const present = (file, needle) => { const content = this.#read(file, cache); return content !== null && content.includes(needle); };
    for (const path of this.#paths) {
      if (!path.in_profile) continue;
      for (const entry of path.entrypoints) if (!present(entry.file, entry.contains)) gaps.push({ path: path.id, missing: 'ENTRYPOINT', file: entry.file });
      for (const id of INVARIANT_IDS) {
        const d = path.invariants[id], label = `${path.id}:${id}`;
        if (d.disposition === 'ENFORCED') {
          for (const c of d.code) if (!present(c.file, c.contains)) gaps.push({ path: path.id, invariant: id, missing: 'CODE', file: c.file });
          for (const t of d.tests) if (!present(t.file, `test('${t.title}'`)) gaps.push({ path: path.id, invariant: id, missing: 'TEST', file: t.file });
          (RUNTIME_EVIDENCE.includes(d.evidence) ? runtime : d.evidence === 'PROCESS' ? processOnly : sourceOnly).push(label);
        } else if (d.disposition === 'HELD') held.push({ invariant: label, hold: d.hold, owner: d.owner });
        else notApplicable.push(label);
      }
      for (const l of path.invariants.GUARD_FAILURE.failure_layers ?? []) {
        if (l.outcome !== 'DENIED') failOpen.push({ path: path.id, layer: l.layer, outcome: l.outcome, protection: l.protection });
      }
      if (path.native_qualification.status !== 'DEMONSTRATED') unqualified.push({ path: path.id, status: path.native_qualification.status });
      for (const item of path.unqualified) unqualified.push({ path: path.id, residual: item });
    }
    const code_digests = Object.fromEntries([...cache.entries()].filter(([, c]) => c !== null).sort(([a], [b]) => a.localeCompare(b)).map(([f, c]) => [f, sha256(c)]));
    return Object.freeze({
      schema: 'toolkit.v3.launch-family-closure-evaluation.v1', family_id: this.#record.family_id, candidate,
      state: gaps.length ? 'FAMILY_OPEN' : 'FAMILY_CLOSED', record_digest: compiler.hashCanonical(this.#record), code_digests,
      gaps, enforced_native_evidence: runtime, enforced_process_evidence_only: processOnly, enforced_source_tests_only: sourceOnly,
      held, not_applicable: notApplicable, unqualified, guard_failure_layers_not_denied: failOpen,
      outside_profile: this.#paths.filter(p => !p.in_profile).map(p => p.id),
      qualification_performed_by_evaluation: false
    });
  }
}

module.exports = Object.freeze({ INVARIANT_IDS, QUALIFICATION, LaunchFamilyClosure });
