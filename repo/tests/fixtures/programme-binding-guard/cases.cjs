'use strict';

// Inputs for the binding guard: the exports the governance and checkpoint hooks load from
// programme-state.cjs must answer every one of these exactly as main did before the public state
// branch was added. `evaluate(state)` runs them against a loaded programme-state.cjs; `generate.cjs`
// records the answers of any copy (run it against the bound main to check the recorded file).
// Every name is a reserved example.

const SLUG = 'example-owner/example-repo';
const STORE = { kind: 'github', repository: 'example-owner/TRANSPORT-example-repo', branch: 'main', path: 'state/example-owner/example-repo/' };
const STATE = { kind: 'branch', branch: 'DO-NOT-DELETE-IF-TOOLKIT-GOVERNANCE-IS-ENABLED', path: 'state/' };

const v1 = (overrides = {}) => ({ schema: 'toolkit.programme-binding.v1', repository: SLUG, parent_issue: 7, record_prefix: 'INT-ER7-', writer_prefix: 'INT-ER7-', store: STORE, required_checks: ['validate'], ...overrides });
const v2 = (overrides = {}) => ({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', parents: [{ issue: 7, record_prefix: 'INT-ER7-' }], store: STORE, required_checks: ['validate'], ...overrides });
const without = (binding, key) => { const copy = { ...binding }; delete copy[key]; return copy; };

// `state_exception: true` marks the only bindings whose answer may change: invalid on main, valid
// now, because their one new key is a well-formed `state` block and they carry a valid store.
const BINDINGS = [
  { name: 'v1 basic', binding: v1() },
  { name: 'v1 with a state key (v1 ignores unknown keys)', binding: v1({ state: STATE }) },
  { name: 'v1 with projection and paid_security', binding: v1({ projection: { after_section: 'CURRENT' }, paid_security: 'off' }) },
  { name: 'v1 with a broken state key', binding: v1({ state: { kind: 'branch', branch: 'main', path: 'x/' } }) },
  { name: 'v2 enabled basic', binding: v2() },
  { name: 'v2 enabled with schedule_folder', binding: v2({ schedule_folder: 'TOOLKIT' }) },
  { name: 'v2 enabled with projection', binding: v2({ projection: { after_section: 'CURRENT', replace_section: 'Programme index' } }) },
  { name: 'v2 enabled with dependency_updates', binding: v2({ dependency_updates: { auto_merge: 'patch-minor', github_actions: 'owner' } }) },
  { name: 'v2 enabled with paid_security', binding: v2({ paid_security: 'on' }) },
  { name: 'v2 enabled with every optional key', binding: v2({ schedule_folder: 'TOOLKIT', projection: { after_section: 'CURRENT' }, dependency_updates: { auto_merge: 'off' }, paid_security: 'off' }) },
  { name: 'v2 enabled with two parents and a writer prefix', binding: v2({ parents: [{ issue: 7, record_prefix: 'INT-ER7-', writer_prefix: 'INT-ERW-' }, { issue: 9, record_prefix: 'INT-ER9-' }] }) },
  { name: 'v2 disabled minimal', binding: { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' } },
  { name: 'v2 disabled with store and parents', binding: v2({ governance: 'disabled' }) },
  { name: 'v2 enabled with state and a valid store', binding: v2({ state: STATE }), state_exception: true },
  { name: 'v2 disabled with state and a valid store', binding: v2({ governance: 'disabled', state: STATE }), state_exception: true },
  { name: 'v2 enabled with state and every optional key', binding: v2({ state: STATE, schedule_folder: 'TOOLKIT', projection: { after_section: 'CURRENT' } }), state_exception: true },
  { name: 'v2 enabled with state and no store', binding: without(v2({ state: STATE }), 'store') },
  { name: 'v2 disabled with state and no store', binding: { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled', state: STATE } },
  { name: 'v2 enabled with state on another branch', binding: v2({ state: { ...STATE, branch: 'main' } }) },
  { name: 'v2 enabled with state outside state/', binding: v2({ state: { ...STATE, path: 'other/' } }) },
  { name: 'v2 enabled with state below state/', binding: v2({ state: { ...STATE, path: 'state/x/' } }) },
  { name: 'v2 enabled with state of another kind', binding: v2({ state: { ...STATE, kind: 'github' } }) },
  { name: 'v2 enabled with an extra state key', binding: v2({ state: { ...STATE, repository: 'example-owner/other' } }) },
  { name: 'v2 enabled with state as text', binding: v2({ state: 'branch' }) },
  { name: 'v2 enabled with store kind branch', binding: v2({ store: { ...STORE, kind: 'branch' } }) },
  { name: 'v2 enabled with an unknown key', binding: v2({ extra: true }) },
  { name: 'v2 enabled with no parents', binding: v2({ parents: [] }) },
  { name: 'v2 enabled with the store in the same repository', binding: v2({ store: { ...STORE, repository: SLUG } }) },
  { name: 'v2 enabled with no store', binding: without(v2(), 'store') },
  { name: 'v2 with a v1 field', binding: v2({ parent_issue: 7 }) },
  { name: 'v2 with a bad schedule_folder', binding: v2({ schedule_folder: 'lower' }) },
  { name: 'v2 with a secret-shaped value', binding: v2({ projection: { after_section: `ghp_${'a'.repeat(36)}` } }) },
  { name: 'v1 missing writer_prefix', binding: without(v1(), 'writer_prefix') },
  { name: 'v1 with governance', binding: v1({ governance: 'enabled' }) },
  { name: 'not an object', binding: 'binding' },
];

const JOURNAL = {
  schema: 'toolkit.programme-journal.v1', repository: SLUG, issue: 12, assignment: 'g1-a1', session_hash: '0123456789abcdef', completion_mode: 'native',
  route: { model: 'example-model', effort: 'high', read_back: true }, seq: 1,
  checkpoint: { branch: 'feature', head: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false, ahead: 1, behind: 0 },
  returns: [{ return_id: 'r1', verdict_requested: 'ACCEPT', at_head: 'a'.repeat(40), next_action: 'Controller: review', blockers: [] }],
  last_error: null, volatile: { written_at: '2026-10-30T00:00:00.000Z' },
};

const JOURNALS = [
  { name: 'valid', doc: JOURNAL },
  { name: 'unknown field', doc: { ...JOURNAL, extra: 1 } },
  { name: 'bad session hash', doc: { ...JOURNAL, session_hash: 'xyz' } },
  { name: 'blockers text', doc: { ...JOURNAL, returns: [{ ...JOURNAL.returns[0], blockers: ['waiting on the owner'] }] } },
  { name: 'secret in next action', doc: { ...JOURNAL, returns: [{ ...JOURNAL.returns[0], next_action: `sk-ant-${'a'.repeat(30)}` }] } },
  { name: 'not an object', doc: [] },
];

const CANONICAL = [{ b: 1, a: [{ d: 2, c: 3 }], e: null }, [3, { z: 1, y: { x: 0 } }], 'text', 7, null];

const HOSTS = ['github.com', 'GitHub.com', 'api.github.com', 'github', 'github-enterprise', 'ghe.example.com', 'gitlab.com', '', null];

const TRANSPORT_OUTPUTS = [
  'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"a":1}',
  'HTTP/2.0 100 Continue\n\nHTTP/2.0 201 Created\nX: y\n\n{"b":[1,2]}',
  'HTTP/2.0 404 Not Found\n\nnot json',
  'HTTP/1.1 204 No Content\r\n\r\n',
];

const TRANSPORT_RUNS = [
  { name: 'ok', result: { status: 0, stdout: 'HTTP/2.0 200 OK\n\n{"ok":true}', stderr: '' } },
  { name: 'signed out', result: { status: 4, stdout: '', stderr: 'gh auth login' } },
  { name: 'exit 4 with a status', result: { status: 4, stdout: 'HTTP/2.0 401 Unauthorized\n\n{}', stderr: '' } },
  { name: 'spawn error', result: { error: new Error('spawn failed'), status: null, stdout: '', stderr: '' } },
  { name: 'no status', result: { status: 1, stdout: '', stderr: 'network down' } },
];

const slashes = text => String(text).replace(/\\/g, '/');

function outcome(fn) {
  try { return { ok: true, value: fn() }; }
  // Paths print with the platform's separator; the answers are recorded with forward slashes.
  catch (error) { return { ok: false, code: error.code || null, message: slashes(error.message), errors: error.details?.errors?.map(slashes) || null }; }
}

function evaluate(state) {
  return {
    schema_journal: state.SCHEMA.journal,
    bindings: BINDINGS.map(({ name, binding }) => {
      const validated = outcome(() => state.validateBinding(binding));
      return { name, validate: validated, enabled: validated.ok ? state.bindingEnabled(validated.value) : null };
    }),
    journals: JOURNALS.map(({ name, doc }) => ({ name, errors: state.validateJournal(doc) })),
    canonical: CANONICAL.map(value => ({ value: JSON.stringify(state.canonical(value)), text: Array.isArray(value) || (value && typeof value === 'object') ? state.canonicalText(value) : null })),
    hosts: HOSTS.map(host => ({ host, github: state.isGitHubHost(host) })),
    transport_parse: TRANSPORT_OUTPUTS.map(text => outcome(() => state.GitHubTransport.parse(text, 'stderr text'))),
    transport_request: TRANSPORT_RUNS.map(({ name, result }) => {
      const seen = [];
      const transport = new state.GitHubTransport({ ghPath: 'gh-example', run: (file, args, options) => { seen.push({ file, args, input: options.input ?? null }); return result; } });
      return { name, result: outcome(() => transport.request('PUT', 'repos/example-owner/example-repo/contents/a.json', { message: 'm' })), seen };
    }),
  };
}

module.exports = { BINDINGS, JOURNALS, evaluate, STATE, STORE, SLUG };
