'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
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
  #historical;
  constructor({ reference, content_base64, historical = false }) {
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
    compiler().checkCoreSchema(registry, compiler().contractSchema('stack-registry-v3.schema.json'));
    const current = Object.hasOwn(registry.profiles, 'owner-gpt');
    if (!current && historical !== true) reject('STACK_REGISTRY_HISTORICAL_READ_ONLY');
    if (current && historical === true) reject('STACK_REGISTRY_NOT_HISTORICAL');
    for (const profile of Object.values(registry.profiles)) {
      if (!current) continue;
      const ids = new Set();
      for (const member of profile.reviewers) {
        if (ids.has(member.reviewer_id)) reject('STACK_REVIEWER_ID_DUPLICATE');
        ids.add(member.reviewer_id);
      }
    }
    this.#reference = freeze(ref); this.#registry = freeze(registry);
    this.#digest = digest(bytes); this.#historical = !current;
  }
  get reference() { return this.#reference; }
  get sourceDigest() { return this.#digest; }
  get historical() { return this.#historical; }
  get profileIds() { return Object.freeze(Object.keys(this.#registry.profiles)); }
  resolve(profileId, { historical = false } = {}) {
    if (typeof profileId !== 'string' || !profileId || profileId.trim() !== profileId) reject('STACK_SELECTION_REQUIRED');
    if (this.#historical !== historical) reject('STACK_SELECTION_MODE_MISMATCH');
    let id = profileId;
    if (historical && !Object.hasOwn(this.#registry.profiles, id)) id = this.#registry.aliases[id];
    if (!id || !Object.hasOwn(this.#registry.profiles, id)) reject('STACK_SELECTION_UNKNOWN_OR_ALIAS');
    const profile = this.#registry.profiles[id];
    return freeze({ schema: historical ? 'toolkit.stack-selection.historical.v1' : 'toolkit.stack-selection.v1',
      profile_id: id, requested_profile_id: profileId, registry_version: this.#registry.version,
      registry_reference: copy(this.#reference), registry_digest: this.#digest,
      routes: copy(profile.routes), reviewers: historical ? null : copy(profile.reviewers) });
  }
  assertSelection(selection) {
    const value = copy(selection), expected = this.resolve(value.requested_profile_id, { historical: this.#historical });
    if (compiler().hashCanonical(expected) !== compiler().hashCanonical(value)) reject('STACK_SELECTION_BINDING_DRIFT');
    return expected;
  }
  role(selection, role, reviewerId = null) {
    const value = this.assertSelection(selection);
    if (role === 'REVIEW' && !this.#historical) {
      if (typeof reviewerId !== 'string' || !reviewerId) reject('STACK_REVIEWER_REQUIRED');
      const member = value.reviewers.find(item => item.reviewer_id === reviewerId);
      if (!member) reject('STACK_REVIEWER_UNADMITTED');
      const { reviewer_id, ...route } = member;
      return freeze({ role, reviewer_id, route, registry_reference: value.registry_reference, registry_digest: value.registry_digest });
    }
    if (reviewerId !== null || !Object.hasOwn(value.routes, role) || !this.#historical && !roles.includes(role)) reject('STACK_ROLE_UNADMITTED');
    const route = value.routes[role];
    if (route === null) reject('STACK_ROUTE_UNAVAILABLE');
    return freeze({ role, reviewer_id: null, route: copy(route), registry_reference: value.registry_reference, registry_digest: value.registry_digest });
  }
}

// Composes with the existing controller question/CURRENT storage supplied by the
// caller. This object owns no filesystem ledger or alternate decision store.
class StackSelectionAdmission {
  #snapshot;
  #readQuestion;
  #writeQuestion;
  #presentQuestion;
  #capability;
  #repository;
  constructor({ snapshot, repository, read_question, write_question, present_question, check_capability }) {
    if (!(snapshot instanceof StackRegistrySnapshot) || snapshot.historical || !repository
      || [read_question, write_question, present_question, check_capability].some(fn => typeof fn !== 'function' || types.isProxy(fn))) reject('STACK_ADMISSION_DEPENDENCIES_REQUIRED');
    this.#snapshot = snapshot; this.#repository = repository; this.#readQuestion = read_question;
    this.#writeQuestion = write_question; this.#presentQuestion = present_question; this.#capability = check_capability;
  }
  evaluate({ profile_id, role, reviewer_id = null, event }) {
    if (!['startup','resume','compaction','prompt','admission'].includes(event)) reject('STACK_ADMISSION_EVENT_INVALID');
    const identity = compiler().hashCanonical({ repository: this.#repository, registry_reference: this.#snapshot.reference, kind: 'STACK_SELECTION' });
    if (typeof profile_id !== 'string' || !profile_id || profile_id.trim() !== profile_id) {
      let question = this.#readQuestion(identity);
      if (question && question.state === 'ANSWERED') return freeze({ state: 'HOLD', code: 'STACK_SELECTION_ANSWER_NOT_BOUND', question_id: identity, dependent_dispatch: false });
      if (!question) {
        question = freeze({ schema: 'toolkit.controller.stack-question.v1', question_id: identity, state: 'PENDING',
          repository: this.#repository, registry_reference: copy(this.#snapshot.reference), choices: [...this.#snapshot.profileIds] });
        this.#writeQuestion(question);
      }
      if (question.question_id !== identity || question.state !== 'PENDING'
        || compiler().hashCanonical(question.registry_reference) !== compiler().hashCanonical(this.#snapshot.reference)) reject('STACK_QUESTION_BINDING_DRIFT');
      let surfaced = false;
      try { surfaced = this.#presentQuestion(question) === true; } catch { /* Presentation never releases the admission hold. */ }
      return freeze({ state: 'ASK_AND_HOLD', code: 'STACK_SELECTION_REQUIRED', question_id: identity,
        question_presented: surfaced, dependent_dispatch: false, independent_authorised_work: true });
    }
    const prior=this.#readQuestion(identity);
    if(prior && (prior.question_id!==identity || !['PENDING','ANSWERED'].includes(prior.state)
      || compiler().hashCanonical(prior.registry_reference)!==compiler().hashCanonical(this.#snapshot.reference))) reject('STACK_QUESTION_BINDING_DRIFT');
    if(prior?.state==='ANSWERED' && prior.selected_profile_id!==profile_id)reject('STACK_SELECTION_REQUIRES_NEW_ADOPTION');
    const selection = this.#snapshot.resolve(profile_id), binding = this.#snapshot.role(selection, role, reviewer_id);
    const capability = copy(this.#capability(binding));
    if (!capability || capability.state !== 'QUALIFIED'
      || compiler().hashCanonical(capability.route) !== compiler().hashCanonical(binding.route)) return freeze({ state: 'HOLD', code: 'STACK_ROUTE_CAPABILITY_UNQUALIFIED', dependent_dispatch: false });
    const old = this.#readQuestion(identity);
    if (old && old.state === 'PENDING') this.#writeQuestion(freeze({ ...copy(old), state: 'ANSWERED', selected_profile_id: profile_id }));
    if (old && old.state === 'ANSWERED' && old.selected_profile_id !== profile_id) reject('STACK_SELECTION_REQUIRES_NEW_ADOPTION');
    return freeze({ state: 'ADMITTED_SELECTION', selection, binding, dependent_dispatch: true, inference_authority: 'NONE' });
  }
}

// CURRENT owns both the selected pin and the one pending question. This
// session owns only authenticated storage handles and captured dependencies.
const CURRENT_SELECTION_SESSIONS = new WeakSet();
function assertCurrentStackSelectionSession(session) {
  if (!session || !CURRENT_SELECTION_SESSIONS.has(session)) reject('STACK_CURRENT_SESSION_REQUIRED');
  return session;
}
class CurrentStackSelectionSession {
  #store; #intent; #snapshot; #sourceCapture; #presentation; #capability;
  #role; #reviewerId;
  constructor({ store, consumer_intent, source_capture, role, reviewer_id=null, present_question, check_capability }) {
    require('./toolkit-github-program-receipt.cjs').assertAuthenticAuthorityPacketStore(store);
    if ([present_question,check_capability].some(fn=>typeof fn!=='function'||types.isProxy(fn))) reject('STACK_ADMISSION_DEPENDENCIES_REQUIRED');
    this.#sourceCapture=freeze(copy(source_capture));this.#snapshot=new StackRegistrySnapshot(this.#sourceCapture);
    if(![...roles,'REVIEW'].includes(role) || role==='REVIEW' && !reviewer_id || role!=='REVIEW' && reviewer_id!==null)reject('STACK_ROLE_UNADMITTED');
    this.#role=role;this.#reviewerId=reviewer_id;
    this.#store=store;this.#intent=freeze(copy(consumer_intent));this.#presentation=present_question;this.#capability=check_capability;
    CURRENT_SELECTION_SESSIONS.add(this);
    Object.defineProperty(this, 'evaluate', {value:input=>this.#evaluate(input),enumerable:true});
    Object.freeze(this);
  }
  #evaluate(input) {
    const value=copy(input);
    if(!value || Object.keys(value).some(key=>!['event','selected_profile_id'].includes(key)))reject('STACK_ADMISSION_EVENT_INVALID');
    const {event,selected_profile_id}=value,role=this.#role,reviewer_id=this.#reviewerId;
    const state=this.#store.readStackSelectionCurrent(this.#intent,this.#sourceCapture);
    const profile=selected_profile_id===undefined?state.stack_selection?.profile_id:selected_profile_id;
    if(state.stack_selection?.profile_id!==null && state.stack_selection?.profile_id!==undefined && profile!==state.stack_selection.profile_id)reject('STACK_SELECTION_REQUIRES_NEW_ADOPTION');
    const owner=new StackSelectionAdmission({snapshot:this.#snapshot,repository:this.#intent.repository,
      read_question:identity=>{
        const value=this.#store.readStackSelectionCurrent(this.#intent,this.#sourceCapture).stack_selection;
        if(value?.question && value.question.question_id!==identity)reject('STACK_QUESTION_BINDING_DRIFT');return value?.question || null;
      },
      write_question:question=>this.#store.writeStackSelectionCurrent(this.#intent,this.#sourceCapture,{question,
        profile_id:question.state==='ANSWERED'?question.selected_profile_id:null}),
      present_question:this.#presentation,check_capability:this.#capability});
    return owner.evaluate({event,role,reviewer_id,profile_id:profile});
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

module.exports = Object.freeze({ StackRegistrySnapshot, StackSelectionAdmission, CurrentStackSelectionSession, assertCurrentStackSelectionSession, CapturedStackBinding });
