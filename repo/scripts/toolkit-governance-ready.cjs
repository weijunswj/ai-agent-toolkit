'use strict';

// Whether a governed repository's setup is complete here, so governance may act (INT-TK421-1386 and
// 1387). The failure it prevents: a repository with governance "on" but a part gone (no Governance
// App, an evidence store that cannot be used, or Toolkit permissions never set up on this computer)
// keeps writing programme records and landing task pull requests as if it were working, while every
// session start says "nothing waits on it".
//
// Only parts that are gone hold: the Governance App (its variable or its secret missing), the evidence
// store (missing, not private or read-only for this computer's sign-in) and Toolkit permissions never
// set up on this computer for this app. Later drift (a new Toolkit permission line, a setting changed
// on GitHub) keeps its own nag and holds nothing. A part that could not be read is unknown and never
// holds. GitHub Free plan limits (branch rules on a private repository) are complete, not missing.
//
// The hold applies only where the merged programme file's min_toolkit is HOLD_FROM or later (the
// guided setup writes its own version there; older governed repositories, whose files name an older
// min_toolkit or none, keep warnings only until their own refresh). No Toolkit writes HOLD_FROM or
// later except a setup that knows this hold; it is no later than this release, so a copy that reads
// such a file can always run it.
// While held: programme state writes refuse, gate checkpoints queue, standing task auto-merge and
// merge trains refuse. Evidence store saves, programme reads, the owner's own merges, setup and its
// finishers, and ordinary coding never hold.
//
// Local files only (the merged-binding cache, the parts cache of toolkit-governance-parts.cjs and this
// app's permission files), so every check is instant and works offline. Any failure reads as unknown.

const HOLD_FROM = '3.199.0';
const PARTS = Object.freeze(['app', 'store', 'permissions']);

// What each action does while not ready: 'refuse', 'queue' or nothing (null). The cloud sweep runs
// programme writes because it has no computer parts and runs only with the App and the store.
const HOLDS = Object.freeze({
  'programme-write': 'refuse',
  checkpoint: 'queue',
  'task-auto-merge': 'refuse',
  'merge-train': 'refuse',
  'owner-merge': null,
  'evidence-save': null,
  setup: null,
  'programme-read': null,
  coding: null,
});

const HELD = 'Governance is on but held until setup is complete: programme records, gate records and task auto-merge wait; evidence saves still work.';

function versionAtLeast(value, floor) {
  try { return require('./toolkit-version.cjs').compareVersions(value, floor) >= 0; } catch { return false; }
}

// The merged programme file's min_toolkit, from this computer's binding cache, or null.
function mergedMinToolkit(state, registryOptions = {}) {
  try {
    const binding = require('./toolkit-governance-state.cjs').mergedBinding(state.root, registryOptions);
    return binding && typeof binding.min_toolkit === 'string' ? binding.min_toolkit : null;
  } catch { return null; }
}

// Whether the hold applies to this repository at all: governance ENABLED with programme records in
// force, and a merged programme file asking for HOLD_FROM or later. `deps.minToolkit` is for tests.
function holdApplies(state, registryOptions = {}, deps = {}) {
  if (!state || state.state !== 'ENABLED' || state.programme_records_bind !== true) return false;
  const wanted = deps.minToolkit !== undefined ? deps.minToolkit : mergedMinToolkit(state, registryOptions);
  return typeof wanted === 'string' && versionAtLeast(wanted, HOLD_FROM);
}

function appPart(app, slug) {
  if (!app) return { state: 'unknown' };
  if (app.variable === 'unverified' || app.secret === 'unverified') return { state: 'unknown' };
  if (app.variable === 'found' && app.secret === 'found') return { state: 'complete' };
  const none = app.variable === 'missing' && app.secret === 'missing';
  return {
    state: 'missing',
    name: 'Governance App',
    detail: none ? `not set up on ${slug} (GitHub lists neither its variable nor its secret)` : `only partly set up on ${slug} (variable ${app.variable}, secret ${app.secret})`,
    step: none ? 'say `toolkit governance` for the one line that sets it up' : 'say `toolkit governance` to finish it',
  };
}

function storePart(saved, store) {
  const parts = require('./toolkit-governance-parts.cjs');
  if (!saved || typeof store !== 'string' || saved.repository !== store) return { state: 'unknown' };
  if (saved.state === 'usable') return { state: 'complete' };
  const why = parts.STORE_WHY[saved.state];
  if (!why) return { state: 'unknown' };
  return { state: 'missing', name: 'Evidence store', detail: `${store} ${why}`, step: parts.STORE_STEP[saved.state] };
}

// Never set up on this computer: no Toolkit line of this app's is there, new or old. Some missing
// beside lines that are there is drift (its own nag), not a hold.
function permissionsPart(found) {
  if (!found || found.checked !== true || !Number.isInteger(found.wanted) || !Number.isInteger(found.missing) || !Number.isInteger(found.stale)) return { state: 'unknown' };
  if (found.wanted > 0 && found.missing >= found.wanted && found.stale === 0) {
    return { state: 'missing', name: `Toolkit permissions (${found.app || 'this app'}, this computer)`, detail: 'not set up', step: 'say `toolkit permissions` for the one command' };
  }
  return { state: 'complete' };
}

// { applies, ready, missing: [{ part, name, detail, step }], unknown: [part], parts: { part: state } }.
// `deps`: `parts` (the saved parts entry), `store` (the store the merged programme file names),
// `permissions(root, host)`, `host` and `environment`, each read from this computer when not given.
function readiness(state, registryOptions = {}, deps = {}) {
  const applies = holdApplies(state, registryOptions, deps);
  const result = { applies, ready: true, missing: [], unknown: [], parts: {} };
  // Where the hold does not apply nothing is read: the existing lines stay warnings.
  if (!applies) return result;
  const environment = deps.environment || process.env;
  const read = (part, fn) => { try { return fn(); } catch { return { state: 'unknown' }; } };
  const saved = deps.parts !== undefined ? deps.parts : read('parts', () => require('./toolkit-governance-parts.cjs').saved(registryOptions, state.repository_id));
  const store = deps.store !== undefined ? deps.store : read('store', () => require('./toolkit-governance-state.cjs').bindingStoreRepository(state.root, registryOptions));
  const slug = state.repository || 'this repository';
  const found = {
    app: read('app', () => appPart(saved && saved.app, slug)),
    store: read('store', () => storePart(saved && saved.store, store)),
    // A cloud session has no computer of its own, so this computer's permissions are not its part.
    permissions: read('permissions', () => (require('./toolkit-governance-binding.cjs').cloudSession(environment) ? { state: 'complete' }
      : permissionsPart((deps.permissions || ((root, host) => require('./toolkit-permissions.cjs').permissionsState(root, host ? { host } : {})))(state.root, deps.host || null)))),
  };
  for (const part of PARTS) {
    const value = found[part] && typeof found[part] === 'object' ? found[part] : { state: 'unknown' };
    result.parts[part] = value.state;
    if (value.state === 'missing') result.missing.push({ part, name: value.name, detail: value.detail, step: value.step });
    else if (value.state !== 'complete') result.unknown.push(part);
  }
  result.ready = !applies || result.missing.length === 0;
  return result;
}

// The state of the closure matrix (PLAN 4.2): U undecided or not bound, D disabled, N not ready, K
// a part unknown and none missing, R ready, L an older binding (warnings only).
function matrixState(state, result) {
  if (!state || state.state === 'DISABLED') return 'D';
  if (state.state !== 'ENABLED' || state.programme_records_bind !== true) return 'U';
  if (!result.applies) return 'L';
  if (result.missing.length) return 'N';
  return result.unknown.length ? 'K' : 'R';
}

// What `action` does for this result: 'refuse', 'queue' or null (it runs). `role` 'cloud-sweep' runs
// programme writes: it has no computer parts and runs only with the App and the store in place.
function holdFor(action, result, { role = null } = {}) {
  if (!Object.hasOwn(HOLDS, action)) throw new Error(`unknown action ${action}`);
  if (!result || result.ready !== false) return null;
  if (role === 'cloud-sweep' && action === 'programme-write') return null;
  return HOLDS[action];
}

// One line for a refusal: what waits, each missing part with its one step, and that nothing changed.
function heldLine(result, what = 'this governance step') {
  const parts = (result && result.missing) || [];
  const steps = parts.map(item => `${item.name}: ${item.detail}; ${item.step}`).join('. ');
  return `Toolkit governance is on but held until setup is complete, so ${what} waits. ${steps ? `${steps}. ` : ''}Programme records, gate records and task auto-merge wait until then; evidence saves still work. Nothing changed.`;
}

// The owner's lines for each missing part, for the session-start block.
function partLines(result) {
  return ((result && result.missing) || []).map(item => `${item.name}: ${item.detail[0].toUpperCase()}${item.detail.slice(1)}. ${item.step[0].toUpperCase()}${item.step.slice(1)}.`);
}

// The readiness of the repository checked out at `root`, read with this computer's governance state.
function readinessAt(root, registryOptions = {}, deps = {}) {
  try {
    const state = deps.governanceState ? deps.governanceState(root) : require('./toolkit-governance-state.cjs').governanceState(root, registryOptions);
    return { state, result: readiness(state, registryOptions, deps) };
  } catch { return { state: null, result: { applies: false, ready: true, missing: [], unknown: PARTS.slice(), parts: {} } }; }
}

module.exports = Object.freeze({ HELD, HOLD_FROM, HOLDS, PARTS, heldLine, holdApplies, holdFor, matrixState, partLines, readiness, readinessAt });
