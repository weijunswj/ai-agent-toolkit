'use strict';

// Conflict-protected publication of programme state.
//
// Canonical programme state is one JSON document in the agreed private store,
// written only with GitHub's conditional contents update (the expected blob SHA
// must still match, otherwise GitHub rejects the write). Parent and child issue
// bodies are projections rendered from one verified canonical revision.
//
// GitHub offers no conditional issue-body update: the REST PATCH and the GraphQL
// mutation both overwrite unconditionally. Projections therefore assume one writer
// per issue and detect, rather than prevent, a conflicting edit:
// - before the write, the live body must equal the base the caller rendered
//   against; otherwise nothing is written (FOREIGN_EDIT_BEFORE_WRITE);
// - an edit landing between that read and the write is overwritten. After the
//   write, the live body must equal the target, and the edit history must show
//   exactly the entries our write adds above the newest entry seen before it. Any
//   extra entry is reported as INTERVENING_EDIT_OVERWRITTEN with its identity.
// The history is matched by entry identity only. `UserContentEdit.diff` is
// documented as a summary of changes, not a body, so it is never read; this module
// therefore cannot retrieve or restore overwritten foreign text. Restoring it from
// GitHub's edit history is an owner action, and the held target must not be
// republished until that is done. The history is bounded (100 entries observed), so
// that restoration cannot wait indefinitely.

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }
const ISSUE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Thin adapter over the authenticated `gh` CLI. Every call names the exact
// repository; nothing here chooses an account, token or alternate transport.
class GhTransport {
  static HISTORY_WINDOW = 10;
  #run;
  constructor({ run = GhTransport.spawn } = {}) { this.#run = run; }

  static spawn(args, input) {
    const result = spawnSync('gh', args, { input, encoding: 'utf8', windowsHide: true, timeout: 60000,
      maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
    if (result.error) fail('PUBLICATION_TRANSPORT_UNAVAILABLE', { message: result.error.message });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  #api(args, body) {
    const result = this.#run(['api', ...args, ...(body === undefined ? [] : ['--input', '-'])],
      body === undefined ? undefined : JSON.stringify(body));
    if (result.status !== 0) {
      const conflict = /HTTP 409|HTTP 422|does not match|is at/.test(result.stderr || '');
      return { ok: false, conflict, stderr: String(result.stderr || '').slice(0, 2000) };
    }
    return { ok: true, value: result.stdout ? JSON.parse(result.stdout) : null };
  }

  readContent(repository, path, ref) {
    const r = this.#api([`repos/${repository}/contents/${encodeURI(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`]);
    if (!r.ok) return /HTTP 404/.test(r.stderr) ? { exists: false } : fail('PUBLICATION_READ_FAILED', { stderr: r.stderr });
    return { exists: true, sha: r.value.sha, text: Buffer.from(r.value.content, 'base64').toString('utf8') };
  }

  writeContent(repository, path, { text, expected_sha, message, branch }) {
    const body = { message, content: Buffer.from(text, 'utf8').toString('base64'), branch };
    if (expected_sha) body.sha = expected_sha;
    const r = this.#api(['-X', 'PUT', `repos/${repository}/contents/${encodeURI(path)}`], body);
    if (!r.ok) return r.conflict ? { state: 'CONFLICT' } : { state: 'UNKNOWN', stderr: r.stderr };
    return { state: 'APPLIED', sha: r.value.content.sha, commit: r.value.commit.sha };
  }

  // Edit entries are returned newest first, as identities only (see the header).
  readIssue(repository, number) {
    const [owner, name] = repository.split('/');
    const r = this.#api(['graphql', '-f', `query=query($o:String!,$n:String!,$i:Int!,$h:Int!){repository(owner:$o,name:$n){issue(number:$i){body userContentEdits(first:$h){nodes{id editedAt editor{login}}}}}}`,
      '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `i=${number}`, '-F', `h=${GhTransport.HISTORY_WINDOW}`]);
    if (!r.ok) fail('PUBLICATION_READ_FAILED', { stderr: r.stderr });
    const issue = r.value.data.repository.issue;
    if (!issue) fail('PUBLICATION_TARGET_MISSING');
    return { body: issue.body, edits: issue.userContentEdits.nodes.map(n => ({ id: n.id, edited_at: n.editedAt, editor: n.editor ? n.editor.login : null })) };
  }

  writeIssueBody(repository, number, body) {
    const r = this.#api(['-X', 'PATCH', `repos/${repository}/issues/${number}`], { body });
    if (!r.ok) return { state: 'UNKNOWN', stderr: r.stderr };
    return { state: 'APPLIED' };
  }
}

// One canonical programme-state document with a conditional write.
class CanonicalStateStore {
  #transport; #repository; #path; #branch;
  constructor({ transport, repository, path, branch = 'main' }) {
    if (!ISSUE.test(repository || '') || typeof path !== 'string' || !path || path.startsWith('/')) fail('PUBLICATION_STORE_INVALID');
    this.#transport = transport; this.#repository = repository; this.#path = path; this.#branch = branch;
  }
  read() {
    const r = this.#transport.readContent(this.#repository, this.#path, this.#branch);
    if (!r.exists) return { exists: false, revision: null, state: null };
    const state = JSON.parse(r.text);
    return { exists: true, revision: r.sha, state, digest: sha256(r.text) };
  }
  // Applies only if the stored revision is still `expectedRevision` (null = must not exist).
  write(state, expectedRevision, message) {
    const text = `${JSON.stringify(state, null, 2)}\n`;
    const result = this.#transport.writeContent(this.#repository, this.#path, { text, expected_sha: expectedRevision, message, branch: this.#branch });
    if (result.state !== 'APPLIED') return result;
    const reread = this.read();
    if (reread.revision !== result.sha || reread.digest !== sha256(text)) return { state: 'UNKNOWN', reason: 'READBACK_MISMATCH' };
    return { state: 'APPLIED', revision: result.sha };
  }
}

// Replaces one marker-delimited managed block in one issue body.
class IssueProjectionPublisher {
  #transport;
  constructor({ transport }) { this.#transport = transport; }

  static markers(marker) {
    if (!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(marker || '')) fail('PUBLICATION_MARKER_INVALID');
    return { begin: `<!-- TOOLKIT-PROJECTION:${marker}:BEGIN -->`, end: `<!-- TOOLKIT-PROJECTION:${marker}:END -->` };
  }

  // `replace_once` places a block that has no markers yet: it must match exactly one
  // span of the body, which the managed block replaces. Without it the block is
  // prepended. Once markers exist, only the marked span is ever replaced.
  static splice(body, marker, block, { replace_once } = {}) {
    const { begin, end } = IssueProjectionPublisher.markers(marker);
    const text = String(body || '');
    const start = text.indexOf(begin), stop = text.indexOf(end);
    const managed = `${begin}\n${block.trim()}\n${end}`;
    if (start === -1 && stop === -1) {
      if (replace_once === undefined) return `${managed}\n\n${text}`.trimEnd() + '\n';
      if (typeof replace_once !== 'string' || !replace_once.trim()) fail('PUBLICATION_PLACEMENT_INVALID');
      const at = text.indexOf(replace_once);
      if (at === -1 || text.indexOf(replace_once, at + 1) !== -1) fail('PUBLICATION_PLACEMENT_NOT_UNIQUE');
      return text.slice(0, at) + managed + text.slice(at + replace_once.length);
    }
    if (start === -1 || stop < start || text.indexOf(begin, start + 1) !== -1) fail('PUBLICATION_MARKER_CORRUPT');
    return text.slice(0, start) + managed + text.slice(stop + end.length);
  }

  // Publishes `block` into `marker` when the live body still equals the body the
  // caller rendered against (`base_digest`). Returns NOOP when already published.
  publish({ repository, issue, marker, block, base_digest, replace_once }) {
    if (!ISSUE.test(repository || '') || !Number.isSafeInteger(issue) || issue < 1) fail('PUBLICATION_TARGET_INVALID');
    if (!/^[0-9a-f]{64}$/.test(base_digest || '')) fail('PUBLICATION_BASE_REQUIRED');
    const live = this.#transport.readIssue(repository, issue);
    const target = IssueProjectionPublisher.splice(live.body, marker, block, { replace_once });
    if (live.body === target) return { state: 'NOOP', body_digest: sha256(target) };
    if (base_digest !== sha256(live.body)) {
      return { state: 'HOLD', reason: 'FOREIGN_EDIT_BEFORE_WRITE', observed_digest: sha256(live.body), expected_digest: base_digest };
    }
    const anchor = live.edits.length ? live.edits[0].id : null;
    const written = this.#transport.writeIssueBody(repository, issue, target);
    if (written.state !== 'APPLIED') return { state: 'UNKNOWN', reason: 'WRITE_OUTCOME_UNKNOWN', target_digest: sha256(target) };
    const after = this.#transport.readIssue(repository, issue);
    const at = anchor === null ? after.edits.length : after.edits.findIndex(e => e.id === anchor);
    const added = at === -1 ? null : after.edits.slice(0, at);
    const evidence = { base_digest, target_digest: sha256(target), anchor_edit: anchor, added_edits: added };
    if (after.body !== target) return { state: 'HOLD', reason: 'POST_WRITE_BODY_DIVERGED', observed_digest: sha256(after.body), ...evidence };
    // A write adds one entry; the first edit of an issue also adds one for its original body.
    const expected = anchor === null ? 2 : 1;
    if (added === null || added.length < expected) return { state: 'HOLD', reason: 'HISTORY_UNVERIFIABLE', ...evidence };
    if (added.length > expected) {
      return { state: 'HOLD', reason: 'INTERVENING_EDIT_OVERWRITTEN', overwritten_edits: added.slice(1, added.length - expected + 1),
        foreign_text: 'NOT_RETRIEVED', ...evidence };
    }
    return { state: 'APPLIED', body_digest: sha256(target), base_digest, edit: added[0].id };
  }

  bodyDigest(repository, issue) { return sha256(this.#transport.readIssue(repository, issue).body); }
}

// Publishes the parent and every child projection from one canonical revision and
// resumes partial publication: applied targets become NOOP on retry, held or
// unknown targets stay pending with their reason, and nothing is reported current
// until every target is applied or already equal. Every target needs the digest of
// the body its block was rendered against; a base read here would protect nothing.
class ProgrammeProjectionReconciler {
  #publisher; #render;
  constructor({ publisher, render }) {
    if (!(publisher instanceof IssueProjectionPublisher) || typeof render !== 'function') fail('PUBLICATION_RECONCILER_INVALID');
    this.#publisher = publisher; this.#render = render;
  }

  reconcile({ repository, canonical, targets, bases = {} }) {
    if (!canonical || !canonical.revision || !Array.isArray(targets) || !targets.length) fail('PUBLICATION_RECONCILER_INVALID');
    const results = [];
    for (const target of targets) {
      const block = this.#render(canonical.state, target);
      if (typeof block !== 'string' || !block.includes(canonical.revision)) fail('PUBLICATION_RENDER_UNBOUND');
      results.push({ issue: target.issue, role: target.role,
        ...this.#publisher.publish({ repository, issue: target.issue, marker: target.marker, block, base_digest: bases[target.issue],
          replace_once: target.replace_once }) });
    }
    const pending = results.filter(r => !['APPLIED', 'NOOP'].includes(r.state));
    return { schema: 'toolkit.programme-publication.v1', canonical_revision: canonical.revision,
      state: pending.length ? 'PARTIAL_PENDING' : 'CURRENT', results, pending };
  }
}

// Observed PR facts are rendered as observations, never as product acceptance.
function renderObservedPullRequest({ number, head, checks }) {
  if (!Number.isSafeInteger(number) || !/^[0-9a-f]{40}$/.test(head || '')) fail('PUBLICATION_RENDER_INVALID');
  return `- Observed PR #${number} at \`${head.slice(0, 12)}\`: checks ${checks}. This is an observation, not product acceptance.`;
}

module.exports = Object.freeze({ GhTransport, CanonicalStateStore, IssueProjectionPublisher, ProgrammeProjectionReconciler,
  renderObservedPullRequest, sha256 });
