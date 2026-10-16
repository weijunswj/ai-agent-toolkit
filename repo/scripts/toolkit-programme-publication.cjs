'use strict';

// Conflict-protected publication of programme state.
//
// Canonical programme state is one JSON document in the agreed private store,
// written only with GitHub's conditional contents update (the expected blob SHA
// must still match, otherwise GitHub rejects the write). Parent and child issue
// bodies are projections rendered from one verified canonical revision.
//
// GitHub offers no conditional issue-body update, so projections use an enforced
// alternative rather than read-write-readback alone: the managed block is rewritten
// only when the live body still matches the base the renderer saw, and after the
// write GitHub's own edit history must show that the edit immediately preceding
// ours is exactly that base. If anything intervened, the foreign edit is still
// retrievable from that history, and the target is held for reconciliation instead
// of being overwritten again. Concurrency is therefore constrained to one writer
// per target with detected, recoverable conflicts; this module claims no
// multi-writer atomicity it cannot prove.

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }
const ISSUE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Thin adapter over the authenticated `gh` CLI. Every call names the exact
// repository; nothing here chooses an account, token or alternate transport.
class GhTransport {
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

  readIssue(repository, number) {
    const [owner, name] = repository.split('/');
    const r = this.#api(['graphql', '-f', `query=query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){id body updatedAt userContentEdits(first:2){nodes{diff editedAt}}}}}`,
      '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `i=${number}`]);
    if (!r.ok) fail('PUBLICATION_READ_FAILED', { stderr: r.stderr });
    const issue = r.value.data.repository.issue;
    if (!issue) fail('PUBLICATION_TARGET_MISSING');
    return { body: issue.body, updated_at: issue.updatedAt, edits: issue.userContentEdits.nodes.map(n => ({ body: n.diff, edited_at: n.editedAt })) };
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

  static splice(body, marker, block) {
    const { begin, end } = IssueProjectionPublisher.markers(marker);
    const text = String(body || '');
    const start = text.indexOf(begin), stop = text.indexOf(end);
    const managed = `${begin}\n${block.trim()}\n${end}`;
    if (start === -1 && stop === -1) return `${managed}\n\n${text}`.trimEnd() + '\n';
    if (start === -1 || stop < start || text.indexOf(begin, start + 1) !== -1) fail('PUBLICATION_MARKER_CORRUPT');
    return text.slice(0, start) + managed + text.slice(stop + end.length);
  }

  // Publishes `block` into `marker` when the live body still equals the body the
  // caller rendered against (`base_digest`). Returns NOOP when already published.
  publish({ repository, issue, marker, block, base_digest }) {
    if (!ISSUE.test(repository || '') || !Number.isSafeInteger(issue) || issue < 1) fail('PUBLICATION_TARGET_INVALID');
    const live = this.#transport.readIssue(repository, issue);
    const target = IssueProjectionPublisher.splice(live.body, marker, block);
    if (live.body === target) return { state: 'NOOP', body_digest: sha256(target) };
    if (base_digest !== sha256(live.body)) {
      return { state: 'HOLD', reason: 'FOREIGN_EDIT_BEFORE_WRITE', observed_digest: sha256(live.body), expected_digest: base_digest };
    }
    const written = this.#transport.writeIssueBody(repository, issue, target);
    if (written.state !== 'APPLIED') return { state: 'UNKNOWN', reason: 'WRITE_OUTCOME_UNKNOWN', target_digest: sha256(target) };
    const after = this.#transport.readIssue(repository, issue);
    const [ours, previous] = after.edits;
    if (after.body !== target || !ours || ours.body !== target) {
      return { state: 'HOLD', reason: 'POST_WRITE_BODY_DIVERGED', observed_digest: sha256(after.body), target_digest: sha256(target) };
    }
    // GitHub records an edit entry for the prior body only once a body has been edited;
    // the first edit of an original body has no predecessor entry to compare.
    if (previous && previous.body !== live.body) {
      return { state: 'HOLD', reason: 'INTERVENING_EDIT_PRESERVED_IN_HISTORY', intervening_digest: sha256(previous.body),
        target_digest: sha256(target) };
    }
    return { state: 'APPLIED', body_digest: sha256(target), base_digest };
  }

  bodyDigest(repository, issue) { return sha256(this.#transport.readIssue(repository, issue).body); }
}

// Publishes the parent and every child projection from one canonical revision and
// resumes partial publication: applied targets become NOOP on retry, held or
// unknown targets stay pending with their reason, and nothing is reported current
// until every target is applied or already equal.
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
      const base = bases[target.issue] ?? this.#publisher.bodyDigest(repository, target.issue);
      results.push({ issue: target.issue, role: target.role,
        ...this.#publisher.publish({ repository, issue: target.issue, marker: target.marker, block, base_digest: base }) });
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
