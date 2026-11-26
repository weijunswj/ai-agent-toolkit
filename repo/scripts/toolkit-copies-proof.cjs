'use strict';

// The copy proof: whether a pull request in a governed repository is a Toolkit refresh whose every
// changed file is byte for byte what `toolkit-cloud-workflows.cjs --refresh-pr` writes from the Toolkit
// commit its head commit names, with that commit on Toolkit main. Such a pull request only puts
// Toolkit main's own reviewed text in place, so it may land under the repository's task auto-merge
// switch with a notice after, instead of waiting for the owner's typed merge as every other change to
// a CI workflow does (scopeWithProof below, read by the merge hold, and `--land-refresh`). The failure it prevents: a pull request that rewrites a governed repository's CI
// (its checks, the guard, what dependency updates may merge) landing with no owner's eyes on it
// because it looks like a refresh. Anything the proof cannot show exactly fails it, with the reason,
// and the pull request waits for the owner's typed merge as before.
//
// It reads only local git: the repository's checkout (the pull request's head and its merge base with
// origin's default branch must be fetched there) and this computer's Toolkit checkout (the managed one
// for a plugin copy). No network read, nothing written outside one scratch folder it removes.
//
// The proof holds only when all of these do:
//   - the repository is governed (ENABLED, its merged binding read in the last 24 hours) and is not the
//     Toolkit itself, whose copies are its own source;
//   - the head commit's message is exactly the refresh's own two lines (commitLine), naming one full
//     Toolkit commit, and that commit is in this computer's Toolkit checkout and on its origin/main;
//   - every changed path is one the refresh renders at that commit for this repository's default
//     branch as it was at the merge base, and its bytes at the head are that render, with git's plain
//     file mode; a deleted or renamed path, any other path, or a single differing byte fails it;
//   - the personal data guard's settings file is changed only where the merge base had none (it is the
//     owner's once there).
// What it does not check, because the controller does before it merges (gate rules, Task auto-merge;
// `--land-refresh` reads them): the task auto-merge switch, the repository's TOOLKIT_REF pin, green
// required checks and the owner's `hold N`.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;
const LIMIT = 64 * 1024 * 1024;

// The Toolkit commit a refresh commit's message names, or null. Default-deny: the message must be
// exactly the title line, one empty line and `Toolkit commit: <40 lower-case hex>`, with at most one
// final line feed; a carriage return, a byte order mark, any other break, space, character or line
// refuses. The refresh writes exactly this (toolkit-cloud-workflows-refresh.cjs), for a plain commit
// and for the merge commit it makes when the branch is behind.
function commitLine(message, title) {
  if (typeof message !== 'string' || typeof title !== 'string' || !title) return null;
  const match = /^([^\n]*)\n\nToolkit commit: ([0-9a-f]{40})\n?$/.exec(message);
  return match && match[1] === title ? match[2] : null;
}

function git(cwd, args, { buffer = false } = {}) {
  const result = spawnSync('git', args, { cwd, windowsHide: true, shell: false, maxBuffer: LIMIT, ...(buffer ? {} : { encoding: 'utf8' }) });
  return { ok: !result.error && result.status === 0, stdout: buffer ? result.stdout : String(result.stdout || '') };
}

// The message of a commit exactly as stored, or null: the text after the header's first empty line.
function messageOf(root, commit) {
  const raw = git(root, ['cat-file', 'commit', commit], { buffer: true });
  if (!raw.ok) return null;
  const at = raw.stdout.indexOf('\n\n');
  return at < 0 ? null : raw.stdout.subarray(at + 2).toString('latin1');
}

class RefreshProof {
  #root;
  #toolkitRoot;
  #workflows;
  #refresh;
  #governance;
  #ciShards;

  // `root` is the governed repository's checkout. `toolkitRoot` is a Toolkit git checkout (default:
  // this copy's, or the managed checkout for a plugin copy); `workflows` its installer.
  // `governance(root)` gives the repository's governance state; `ciShards` the merged ci_shards answer.
  constructor({ root, toolkitRoot = null, workflows = null, governance = null, ciShards = undefined }) {
    const installer = require('./toolkit-cloud-workflows.cjs');
    this.#root = root;
    this.#toolkitRoot = toolkitRoot || installer.sourceRoot();
    this.#workflows = workflows || installer.installerAt(this.#toolkitRoot);
    this.#refresh = require('./toolkit-cloud-workflows-refresh.cjs');
    this.#governance = governance || (target => require('./toolkit-governance-state.cjs').governanceState(target));
    this.#ciShards = ciShards;
  }

  // { proved: true, commit, files } or { proved: false, reason, hold } (hold: try again later). `base` is origin's default branch
  // head and `head` the pull request's head, both full commits in the repository's checkout.
  prove(base, head) {
    // `hold`: a later read may prove it (something is not fetched or read yet), so no typed merge yet.
    const no = (reason, hold = false) => ({ proved: false, reason, hold });
    if (!SHA.test(String(base)) || !SHA.test(String(head))) return no('the base and head must be full commits');
    if (this.#workflows.isToolkitCheckout(this.#root)) return no('this is the Toolkit repository, whose copies are its own source');
    let state;
    try { state = this.#governance(this.#root); } catch { state = null; }
    if (state?.state !== 'ENABLED') return no('the repository is not governed here');
    if (state.governed_effects_hold || state.notes?.includes('could-not-check-governance')) return no('the merged programme binding was not read in the last 24 hours', true);
    const branch = state.merged?.default_branch;
    if (!BRANCH.test(String(branch || ''))) return no('the default branch is not known on this computer; run toolkit-governance.cjs status online', true);
    const message = messageOf(this.#root, head);
    if (message === null) return no(`the head ${head.slice(0, 7)} is not in this checkout; fetch the pull request first`, true);
    const commit = commitLine(message, this.#refresh.TITLE);
    if (!commit) return no(`the head commit's message is not exactly the refresh's ("${this.#refresh.TITLE}" and one "Toolkit commit: <full commit>" line)`);
    if (!git(this.#toolkitRoot, ['cat-file', '-e', `${commit}^{commit}`]).ok) return no(`Toolkit commit ${commit.slice(0, 7)} is not in this computer's Toolkit checkout; update it, then try again`, true);
    if (!git(this.#toolkitRoot, ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']).ok) return no(`Toolkit commit ${commit.slice(0, 7)} is not on Toolkit main as this computer's Toolkit checkout last fetched it`);
    const from = git(this.#root, ['merge-base', base, head]).stdout.trim();
    if (!SHA.test(from)) return no('the pull request\'s merge base with the default branch could not be read here', true);
    const listed = git(this.#root, ['diff', '--raw', '--no-renames', '-z', '--no-abbrev', from, head]);
    if (!listed.ok) return no('the pull request\'s changes could not be read here');
    const changed = rawEntries(listed.stdout);
    if (!changed || !changed.length) return no('the pull request\'s changes could not be read here, or it changes nothing');
    let snapshot;
    try { snapshot = new this.#refresh.BranchSnapshot(this.#root, from, branch, { fetch: false }).write(); } catch (error) {
      return no(error?.name === 'RefreshError' ? error.message : 'the merge base\'s files could not be read');
    }
    try {
      let expected;
      try {
        expected = this.#refresh.changes({ target: snapshot, root: this.#toolkitRoot, commit, ciShards: this.#ciShardsAnswer(), defaultBranch: branch, workflows: this.#workflows }).files;
      } catch (error) {
        if (error?.name === 'RefreshError' || error?.name === 'InstallError') return no(`a refresh at ${commit.slice(0, 7)} would not run here: ${error.message}`);
        throw error;
      }
      const texts = new Map(expected.map(entry => [entry.file, entry.text]));
      const guardConfig = this.#refresh.GUARD_CONFIG;
      for (const entry of changed) {
        if (entry.status !== 'A' && entry.status !== 'M') return no(`${entry.file} is ${entry.status === 'D' ? 'deleted' : 'changed in a way a refresh never makes'}`);
        if (entry.mode !== '100644') return no(`${entry.file} has file mode ${entry.mode}, not the plain mode a refresh writes`);
        if (entry.file === guardConfig && fs.existsSync(path.join(snapshot, ...guardConfig.split('/')))) return no(`${guardConfig} already existed, so it is the owner's settings file`);
        if (!texts.has(entry.file)) return no(`${entry.file} is not a file a refresh at ${commit.slice(0, 7)} writes here`);
        const bytes = git(this.#root, ['cat-file', 'blob', entry.blob], { buffer: true });
        if (!bytes.ok || !Buffer.from(texts.get(entry.file), 'utf8').equals(bytes.stdout)) return no(`${entry.file} differs from Toolkit commit ${commit.slice(0, 7)}'s render`);
      }
      return { proved: true, commit, files: changed.map(entry => entry.file) };
    } finally {
      fs.rmSync(snapshot, { recursive: true, force: true });
    }
  }

  #ciShardsAnswer() {
    if (this.#ciShards !== undefined) return this.#ciShards;
    try { return require('./toolkit-governance-state.cjs').mergedBinding(this.#root)?.ci_shards?.answer || null; } catch { return null; }
  }
}

// The merge scope (toolkit-auto-merge-eligible.cjs eligibilityOf, which loads only Node's own modules)
// with the copy proof, for the merge hold's standing route: a Toolkit refresh whose every changed file
// is Toolkit main's own render at the commit it names is in scope though it changes CI workflows. Only
// `a CI workflow` reasons on files the proof covers are lifted; any other reason keeps the typed merge.
// The proof is tried only when the head commit's message has a `Toolkit commit:` line, as every refresh
// commit does, so other pull requests read exactly as before. Returns the scope, with
// `proved_refresh: { toolkit_commit, files }` when lifted or `proof: <why not>` when the proof was tried
// and failed; null when git cannot read the scope. `registryOptions` pass to the governance read.
function scopeWithProof(cwd, base, head, { prove = null, registryOptions = {} } = {}) {
  const scope = require('./toolkit-auto-merge-eligible.cjs').eligibilityOf(cwd, base, head);
  if (!scope || scope.eligible || !scope.reasons.every(entry => entry.why === 'a CI workflow')) return scope;
  if (!/^Toolkit commit: /m.test(git(cwd, ['log', '-1', '--format=%B', head]).stdout)) return scope;
  let proof;
  try {
    proof = prove ? prove(base, head) : new RefreshProof({ root: cwd, governance: target => require('./toolkit-governance-state.cjs').governanceState(target, registryOptions) }).prove(base, head);
  } catch { proof = { proved: false, reason: 'the copy proof could not run' }; }
  if (!proof?.proved) return { ...scope, proof: proof?.reason || 'the copy proof did not hold' };
  if (!scope.reasons.every(entry => proof.files.includes(entry.path))) return { ...scope, proof: 'the proof does not cover every changed workflow' };
  return { ...scope, eligible: true, reasons: [], proved_refresh: { toolkit_commit: proof.commit, files: proof.files } };
}

// `git diff --raw -z` entries: [{ status, mode, blob, file }], or null when the listing does not read.
function rawEntries(text) {
  const parts = String(text).split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  const out = [];
  for (let index = 0; index < parts.length; index += 2) {
    const head = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/.exec(parts[index]);
    const file = parts[index + 1];
    if (!head || typeof file !== 'string' || !file) return null;
    out.push({ status: head[5], mode: head[2], blob: head[4], file });
  }
  return out;
}

module.exports = Object.freeze({ RefreshProof, commitLine, scopeWithProof });
