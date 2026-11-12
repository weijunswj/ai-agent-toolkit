#!/usr/bin/env node
'use strict';

// `toolkit store`: every evidence store step in one command that checks itself, so one permission
// line per host can let it run without asking.
//
//   node repo/scripts/toolkit-store.cjs status               --store <folder> [--repo-root <checkout>] [--json]
//   node repo/scripts/toolkit-store.cjs sync                 --store <folder> [--repo-root <checkout>] [--json]
//   node repo/scripts/toolkit-store.cjs save                 --store <folder> --path <store path>... --message <text> [--repo-root <checkout>] [--json]
//   node repo/scripts/toolkit-store.cjs move                 --store <folder> --from <store path> --to <store path> --message <text> [--repo-root <checkout>] [--json]
//   node repo/scripts/toolkit-store.cjs merge-branch         --store <folder> --branch <name> --message <text> [--repo-root <checkout>] [--json]
//   node repo/scripts/toolkit-store.cjs delete-merged-branch --store <folder> --branch <name> [--repo-root <checkout>] [--json]
//
// Every subcommand first runs the same pre-flight and writes nothing when any part fails:
//   - the governed repository (--repo-root, default the current folder) has a fresh, enabled merged
//     binding on this computer that names a GitHub evidence store and its branch;
//   - --store is the top of a Git checkout whose origin fetch and push addresses are all that store;
//   - the checkout's own config (local and worktree) holds only plain keys from a short list, so no
//     push rule, mirror, URL rewrite, proxy, credential helper, filter or program setting of its own
//     can change what a step does, and the user's global or system config holds no setting that
//     widens a push (remote.origin.* beyond its URLs, push.followTags and the like);
//   - Git is found by its full path on PATH (never inside the store) and runs with no GIT_*
//     environment variable except the ssh ones, with hooks pointed at an empty folder this run owns,
//     pathspec magic off, and no grafts, replace refs or commit-graph file, so every ancestry answer
//     comes from real commits;
//   - the checkout is a full (not shallow) clone on the bound branch;
//   - GitHub says the store is private, writable, and its default branch is the bound branch.
//
// status   read-only: the checks above, clean or not, ahead or behind the last fetch.
// sync     fetches the bound branch and fast-forwards only.
// save     stages only the named paths (adds and changes, never deletions) inside the binding's store
//          path, archives/ or evidence/, secret-scans exactly the staged content, commits, pushes the
//          bound branch with a plain push and reads it back with one fetch. A file the text scan
//          cannot read (over 5 MB, binary, not UTF-8) is refused. Before each push the tip GitHub
//          serves must be in the pushed commit, and after it GitHub must show that old tip inside
//          the new one.
// move     reorganises with `git mv` only, so content is kept; the target is inside the same folders.
// merge-branch          merges a store branch into the bound branch with a merge commit, refusing a
//                       merge that deletes or changes away any file or writes outside the same
//                       folders, and scanning every blob in every commit it brings in.
// delete-merged-branch  deletes a remote store branch only when GitHub shows its tip already in the
//                       bound branch, never the bound branch (in any letter case); the delete holds
//                       only while the tip is unchanged, and GitHub is asked again afterwards.
//
// It never force-pushes, mirrors, rebases or resets anything on the remote, never pushes a branch but
// the bound one (except the checked branch delete), never deletes a file, never touches another
// repository and never runs a program the caller names. A secret finding names file, line and rule
// only, never the text.
//
// Exit codes: 0 done, 1 stopped (nothing pushed unless the line says so), 2 usage.

const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { githubSlug } = require('./toolkit-permissions.cjs');
const governanceState = require('./toolkit-governance-state.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const { scanText } = require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs');
const { resolveGit } = require('../../skills/secure-ci-cd/scripts/local-security-scan.cjs');

class StoreError extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); this.exitCode = exitCode; this.stopped = stopped; this.next = next; }
}

const COMMANDS = Object.freeze(['status', 'sync', 'save', 'move', 'merge-branch', 'delete-merged-branch']);
// Every flag each subcommand takes. A test pins this table, so a new flag fails until someone
// decides whether the store permission line may still cover it.
const VALUE_FLAGS = Object.freeze({
  status: ['--store', '--repo-root'],
  sync: ['--store', '--repo-root'],
  save: ['--store', '--repo-root', '--path', '--message'],
  move: ['--store', '--repo-root', '--from', '--to', '--message'],
  'merge-branch': ['--store', '--repo-root', '--branch', '--message'],
  'delete-merged-branch': ['--store', '--repo-root', '--branch'],
});

const BRANCH = /^(?![-/.])[A-Za-z0-9._/-]{1,200}(?<![/.])$/;
const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const MESSAGE = /^[^\0-\x1f\x7f]{1,200}$/;
// The only keys the store checkout's own config may hold (git lowercases section and key names).
const PLAIN_CONFIG = /^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|symlinks|ignorecase|precomposeunicode|autocrlf|safecrlf|eol|longpaths|checkstat|trustctime)|extensions\.(?:objectformat|worktreeconfig)|remote\.origin\.(?:url|pushurl|fetch)|branch\..+\.(?:remote|merge)|user\.(?:name|email)|gc\.auto)$/;
// The GIT_* variables kept from the caller's environment: the user's own ssh setup. Every other one
// (GIT_DIR, GIT_CONFIG_*, GIT_EXEC_PATH and the rest) could point Git at other data or programs.
const KEPT_GIT_ENVIRONMENT = new Set(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT']);
// Keys in the user's global or system config that would widen what a push sends or where. The rest
// of the user's own config (credential helper, ssh command, signing) is the user's and is trusted.
const WIDENING_CONFIG = /^(?:remote\.origin\.(?!(?:url|pushurl|fetch)$)[^.]+|remote\.pushdefault|push\.(?:followtags|recursesubmodules|pushoption))$/;
// Pinned on every call: the commit-graph file is ignored (grafts are pinned by environment and
// replace refs by GIT_NO_REPLACE_OBJECTS), so ancestry and the fast-forward test read real commits.
const PINNED_CONFIG = Object.freeze(['core.fsmonitor=false', 'core.commitGraph=false', 'push.followTags=false', 'push.recurseSubmodules=no', 'fetch.recurseSubmodules=false', 'gc.auto=0', 'maintenance.auto=false']);
// Another branch is fetched into this private namespace, never beside the bound branch's tracking
// ref, so a name that differs only by case cannot land on it on a case-insensitive disk.
const OTHER_REFS = 'refs/toolkit-store';
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// A store path as typed: relative, forward slashes, plain characters, no `.` or `..` part, no `.git`
// part in any spelling. Null when refused.
function storePath(text) {
  if (typeof text !== 'string' || !text || text.length > 300) return null;
  const clean = text.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9 _.\-/]+$/.test(clean) || clean.startsWith('/') || clean.startsWith('-') || /\/\//.test(clean)) return null;
  if (clean.split('/').some(part => part === '' || part === '.' || part === '..' || part.toLowerCase() === '.git' || /^\s|\s$/.test(part))) return null;
  return clean;
}

// The binding the merged default branch holds for the repository at `repoRoot`, from this
// computer's cache; never the working tree, which any agent can edit.
function mergedStoreBinding(repoRoot, { stateOptions = {}, now = new Date() } = {}) {
  let identity;
  try { identity = governanceState.readIdentity(repoRoot); } catch { identity = null; }
  if (!identity || !identity.valid) return { ok: false, reason: 'that folder is not a GitHub repository checkout with one origin' };
  let judged;
  try { judged = governanceState.judgeMerged(bindingCache.readBindingCache(identity, governanceState.userStateDirectory(stateOptions)), identity, now); } catch { judged = { status: 'unknown' }; }
  if (judged.status !== 'enabled') return { ok: false, reason: 'this computer has no enabled merged Toolkit binding for that repository' };
  if (!judged.fresh) return { ok: false, reason: 'the merged binding was not read in the last day' };
  return { ok: true, store: judged.binding.store };
}

function defaultReadGitHub(apiPath, { environment = process.env, cwd = process.cwd() } = {}) {
  const { GitHubTransport } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const { resolveExecutable } = require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs');
  const response = new GitHubTransport({ ghPath: resolveExecutable('gh', { environment, cwd }), timeoutMs: 30000 }).request('GET', apiPath);
  if (response?.status !== 200 || !response.json) throw new Error('unreadable');
  return response.json;
}

class EvidenceStore {
  #fs; #run; #environment; #cwd; #readBinding; #readGitHub; #tmpdir; #platform; #findGit;
  #dir = null; #hooks = null; #gitPath = null; #repository = null; #store = null; #branch = null; #allowed = [];

  constructor({ fs = nodeFs, run = spawnSync, environment = process.env, cwd = process.cwd(), readBinding = mergedStoreBinding, readGitHub = defaultReadGitHub, tmpdir = os.tmpdir(), platform = process.platform, findGit = resolveGit } = {}) {
    this.#fs = fs; this.#run = run; this.#environment = environment; this.#cwd = cwd;
    this.#readBinding = readBinding; this.#readGitHub = readGitHub; this.#tmpdir = tmpdir; this.#platform = platform; this.#findGit = findGit;
  }

  #gitEnvironment() {
    const kept = {};
    for (const [key, value] of Object.entries(this.#environment)) if (!/^GIT_/i.test(key) || KEPT_GIT_ENVIRONMENT.has(key.toUpperCase())) kept[key] = value;
    // A graft file that never exists: `.git/info/grafts` could otherwise make unrelated commits look related.
    return { ...kept, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: path.join(this.#hooks, '..', `${path.basename(this.#hooks)}-no-grafts`) };
  }

  // Every Git call: git by its full path, pathspec magic off, hooks pointed at this run's empty
  // folder, the settings in PINNED_CONFIG. `buffer` returns the raw bytes; `input` is written to stdin.
  #git(args, { timeout = 60000, buffer = false, input } = {}) {
    const pinned = ['--literal-pathspecs', '-c', `core.hooksPath=${this.#hooks}`, ...PINNED_CONFIG.flatMap(setting => ['-c', setting]), '-C', this.#dir];
    const result = this.#run(this.#gitPath, [...pinned, ...args], { encoding: buffer ? 'buffer' : 'utf8', input, env: this.#gitEnvironment(), timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const ok = Boolean(result) && !result.error && result.status === 0;
    return { ok, out: buffer ? result?.stdout || Buffer.alloc(0) : String(result?.stdout || ''), err: String(result?.stderr || '') };
  }

  // GitHub's own answer to "how does `to` relate to `from`": identical, ahead, behind or diverged.
  // The checkout's commit graph never decides whether a branch is merged or a push keeps history.
  #compare(from, to) {
    let answer;
    try { answer = this.#readGitHub(`repos/${this.#repository}/compare/${from}...${to}`); } catch { answer = null; }
    if (!answer || !['identical', 'ahead', 'behind', 'diverged'].includes(answer.status)) throw new StoreError('GitHub could not compare the store commits, so nothing was changed on trust.', 'check gh auth status and the network, then retry.');
    return answer.status;
  }

  // The tip GitHub serves for a store branch, or null when the branch does not exist.
  #remoteTip(branch) {
    const listed = this.#must(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 'the store branches could not be listed.', 'check the network, then retry.', { timeout: 120000 }).trim();
    const line = listed.split(/\r?\n/).map(entry => entry.split('\t')).find(([sha, ref]) => ref === `refs/heads/${branch}` && /^[0-9a-f]{40,64}$/.test(sha));
    return line ? line[0] : null;
  }

  #must(args, stopped, next, options) {
    const result = this.#git(args, options);
    if (!result.ok) throw new StoreError(stopped, next);
    return result.out;
  }

  #same(a, b) { return this.#platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }

  // ---- pre-flight -----------------------------------------------------------------------------

  open({ store, repoRoot = null }) {
    const bound = this.#readBinding(path.resolve(this.#cwd, repoRoot || '.'));
    if (!bound.ok) throw new StoreError(`no bound evidence store: ${bound.reason}.`, 'run toolkit governance status in the governed repository, or name it with --repo-root.');
    const wanted = bound.store?.kind === 'github' && typeof bound.store.repository === 'string' ? bound.store.repository.toLowerCase() : '';
    if (!wanted) throw new StoreError('the merged binding names no GitHub evidence store.', 'bind a store in the programme file first.');
    if (typeof bound.store.branch !== 'string' || !BRANCH.test(bound.store.branch) || bound.store.branch.includes('..')) throw new StoreError('the bound store branch is not a plain branch name.', 'fix the store branch in the programme file.');
    this.#store = wanted;
    this.#branch = bound.store.branch;
    const bindingPath = typeof bound.store.path === 'string' ? storePath(bound.store.path) : null;
    this.#allowed = [...new Set([...(bindingPath ? [`${bindingPath}/`] : []), 'archives/', 'evidence/'])];

    if (!store) throw new StoreError('no evidence store folder was named.', 'add --store <the store checkout folder>.', 2);
    let dir;
    try { dir = this.#fs.realpathSync.native(path.resolve(this.#cwd, store)); } catch { throw new StoreError('the --store folder does not exist.', 'clone the evidence store and name that folder.'); }
    this.#dir = dir;
    this.#hooks = this.#fs.mkdtempSync(path.join(this.#tmpdir, 'ai-agent-toolkit-store-hooks-'));
    this.#repository = bound.store.repository;
    try { this.#gitPath = this.#findGit({ env: this.#environment, platform: this.#platform, exclude: dir }); } catch { this.#gitPath = null; }
    if (!this.#gitPath) throw new StoreError('git was not found in an absolute PATH folder outside the store.', 'install Git, then retry.');

    const top = this.#git(['rev-parse', '--show-toplevel']);
    let real = '';
    try { real = top.ok ? this.#fs.realpathSync.native(top.out.trim()) : ''; } catch { real = ''; }
    if (!real || !this.#same(real, dir)) throw new StoreError('the --store folder is not the top of a Git checkout.', 'name the store checkout\'s top folder.');
    if (githubSlug(this.#git(['remote', 'get-url', 'origin']).out) !== wanted) throw new StoreError('that folder is not a checkout of the bound evidence store (its origin differs).', `name a checkout of ${bound.store.repository}.`);
    const pushTo = this.#git(['remote', 'get-url', '--push', '--all', 'origin']).out.split(/\r?\n/).filter(Boolean);
    if (!pushTo.length || pushTo.some(url => githubSlug(url) !== wanted)) throw new StoreError('that folder pushes somewhere other than the evidence store (its push address differs).', 'remove the extra push address from the store checkout.');
    const config = this.#git(['config', '--list', '--show-scope', '--includes']);
    if (!config.ok) throw new StoreError('the store checkout\'s config could not be read.', 'check the store checkout with git status.');
    const entries = config.out.split(/\r?\n/).map(line => line.split('\t')).filter(([, setting]) => setting).map(([scope, setting]) => [scope, setting.split('=')[0].toLowerCase()]);
    const odd = entries.filter(([scope, key]) => ['local', 'worktree'].includes(scope) && !PLAIN_CONFIG.test(key)).map(([, key]) => key);
    if (odd.length) throw new StoreError(`the store checkout has its own config that could change a step (${[...new Set(odd)].slice(0, 5).join(', ')}).`, 'remove those settings from the store checkout, or use a fresh clone.');
    const widening = entries.filter(([scope, key]) => ['global', 'system'].includes(scope) && WIDENING_CONFIG.test(key)).map(([, key]) => key);
    if (widening.length) throw new StoreError(`this computer's Git config has a setting that could widen a store push (${[...new Set(widening)].slice(0, 5).join(', ')}).`, 'remove it from your global Git config, then retry.');
    if (this.#git(['rev-parse', '--is-shallow-repository']).out.trim() !== 'false') throw new StoreError('the store checkout is shallow (or its history could not be read), so its history cannot be checked.', 'use a full clone of the store.');
    const head = this.#git(['symbolic-ref', '-q', 'HEAD']).out.trim();
    if (head !== `refs/heads/${this.#branch}`) throw new StoreError(`the store checkout is not on the bound branch ${this.#branch}.`, `switch the store checkout to ${this.#branch}.`);

    let repo;
    try { repo = this.#readGitHub(`repos/${bound.store.repository}`); } catch { repo = null; }
    if (!repo) throw new StoreError('GitHub could not be read, so the store was not checked as private and writable.', 'check gh auth status and the network, then retry.');
    if (typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== wanted) throw new StoreError('GitHub names a different repository for the store.', 'check the store binding.');
    if (repo.private !== true) throw new StoreError('the evidence store is not private.', 'make the store private before any upload.');
    if (repo.permissions?.push !== true) throw new StoreError('this account cannot write to the evidence store.', 'sign gh in with an account that can write to it.');
    if (repo.default_branch !== this.#branch) throw new StoreError('the bound store branch is not the store\'s default branch.', 'fix the store branch in the programme file.');
    return this;
  }

  close() {
    if (this.#hooks) { try { this.#fs.rmSync(this.#hooks, { recursive: true, force: true }); } catch { /* an empty temp folder */ } }
    this.#hooks = null;
  }

  // ---- shared steps ---------------------------------------------------------------------------

  get #tracking() { return `refs/remotes/origin/${this.#branch}`; }

  #fetch(branch = this.#branch) {
    const into = branch === this.#branch ? this.#tracking : `${OTHER_REFS}/${branch}`;
    this.#must(['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', 'origin', `+refs/heads/${branch}:${into}`],
      `the store branch ${branch} could not be fetched.`, 'check the network and gh auth status, then retry.', { timeout: 120000 });
  }

  #position() {
    const counts = this.#git(['rev-list', '--left-right', '--count', `HEAD...${this.#tracking}`]);
    const [ahead, behind] = counts.ok ? counts.out.trim().split(/\s+/).map(Number) : [NaN, NaN];
    return { ahead, behind };
  }

  // Nothing staged and no local commit the remote lacks, so a step commits and pushes only its own work.
  #ready({ cleanTree = false } = {}) {
    const { ahead, behind } = this.#position();
    if (!Number.isInteger(ahead)) throw new StoreError('the store branch has no fetched remote copy to compare with.', 'run sync first.');
    if (ahead > 0) throw new StoreError(`the store checkout has ${ahead} commit(s) the remote lacks, and they were never scanned here.`, 'look at them with git log; push them yourself or start from a fresh clone.');
    if (!this.#git(['diff', '--cached', '--quiet']).ok) throw new StoreError('the store checkout already has staged changes.', 'unstage them (git restore --staged) so only the named paths are committed.');
    if (cleanTree && !this.#git(['diff', '--quiet']).ok) throw new StoreError('the store checkout has changed tracked files.', 'save or restore them first.');
    if (behind > 0) this.#must(['merge', '--ff-only', '--quiet', this.#tracking], 'the store checkout could not fast-forward to the remote (a local change is in the way).', 'move the conflicting local files aside, run sync, then retry.');
  }

  #inside(file) { return this.#allowed.some(prefix => file.startsWith(prefix)); }

  // The staged change against HEAD: [{ status, score, mode, sha, file }], renames found only when exact.
  #staged() {
    const raw = this.#must(['diff', '--cached', '--raw', '-z', '--no-abbrev', '-M100%', 'HEAD'], 'the staged change could not be read.', 'retry.');
    const parts = raw.split('\0');
    const entries = [];
    for (let index = 0; index < parts.length - 1;) {
      const head = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/.exec(parts[index]);
      if (!head) break;
      const renamed = head[5] === 'R' || head[5] === 'C';
      entries.push({ status: head[5], score: head[6] ? Number(head[6]) : null, mode: head[2], sha: head[4], from: renamed ? parts[index + 1] : null, file: parts[index + (renamed ? 2 : 1)] });
      index += renamed ? 3 : 2;
    }
    return entries;
  }

  // Refuses links, submodules and deletions; scans each new or changed blob as staged.
  #check(entries, { prefixes = true } = {}) {
    if (!entries.length) throw new StoreError('nothing would change in the store.', 'name a path with new or changed files.');
    const findings = [];
    const unread = [];
    for (const entry of entries) {
      if (entry.status === 'D' || (entry.status === 'R' && entry.score !== 100)) throw new StoreError(`${entry.from || entry.file} would be deleted or changed away; the store never loses a file this way.`, 'leave it in place.');
      if (!/^(?:A|M|R|C)$/.test(entry.status)) throw new StoreError(`${entry.file} has a change of type ${entry.status} the store command does not make.`, 'commit it by hand.');
      if (!/^1006(?:44|55)$/.test(entry.mode)) throw new StoreError(`${entry.file} is a link or a nested repository, which the store command never commits.`, 'copy the real file in instead.');
      if (prefixes && !this.#inside(entry.file)) throw new StoreError(`${entry.file} is outside the store folders this command writes (${this.#allowed.join(', ')}).`, 'write the file under one of those folders.');
      if (entry.status === 'R') continue; // the same blob already in the store, at a new name
      this.#scanBlob(entry.sha, entry.file, findings, unread);
    }
    return { stop: this.#scanStop(findings, unread) };
  }

  // Scans one blob as stored. A blob over 5 MB, with a NUL byte or not valid UTF-8 (a compressed
  // file, UTF-16 text) cannot be read by the text scan, so it counts as unread and is refused.
  #scanBlob(sha, file, findings, unread) {
    const size = Number(this.#git(['cat-file', '-s', sha]).out.trim());
    if (!Number.isFinite(size) || size > MAX_BLOB_BYTES) { unread.push(file); return; }
    const blob = this.#git(['cat-file', 'blob', sha], { buffer: true });
    let text = null;
    try { text = blob.ok && !blob.out.includes(0) ? UTF8.decode(blob.out) : null; } catch { text = null; }
    if (text === null) { unread.push(file); return; }
    for (const hit of scanText(text)) findings.push(`${file}:${hit.line} (${hit.rule})`);
  }

  #scanStop(findings, unread) {
    if (findings.length) return new StoreError(`the secret scan found ${findings.length} match(es): ${[...new Set(findings)].slice(0, 10).join(', ')}.`, 'remove the secret (from every commit that holds it), or mark a reviewed false match with "secret-scan: allow <reason>" on its line, then retry.');
    if (unread.length) return new StoreError(`these files could not be scanned (over 5 MB, binary or not UTF-8): ${[...new Set(unread)].slice(0, 10).join(', ')}.`, 'store them as plain UTF-8 text under 5 MB, then retry.');
    return null;
  }

  // Every blob the commits in `range` bring in, from every commit (not only the final tree), so a
  // secret added and removed again inside a branch is still found.
  #scanHistory(range) {
    const listed = this.#must(['rev-list', '--objects', range], 'the branch history could not be listed.', 'retry.').split(/\r?\n/).filter(Boolean);
    const named = new Map(listed.map(line => [line.slice(0, line.indexOf(' ') === -1 ? line.length : line.indexOf(' ')), line.includes(' ') ? line.slice(line.indexOf(' ') + 1) : '']));
    const types = this.#must(['cat-file', '--batch-check=%(objecttype) %(objectname)'], 'the branch objects could not be read.', 'retry.', { input: `${[...named.keys()].join('\n')}\n` });
    const findings = [];
    const unread = [];
    for (const line of types.split(/\r?\n/)) {
      const [type, sha] = line.split(' ');
      if (type === 'blob') this.#scanBlob(sha, named.get(sha) || sha, findings, unread);
    }
    return this.#scanStop(findings, unread);
  }

  // A plain push of the bound branch; on a race, one merge of the remote and one more push. Before
  // each push, the tip GitHub serves must be in the commit being pushed (real commits only), and
  // after it GitHub must show that old tip inside the new one: history is only ever added to.
  #push() {
    const push = () => {
      const before = this.#remoteTip(this.#branch);
      if (!before || !this.#git(['merge-base', '--is-ancestor', before, 'HEAD']).ok) return { ok: false, before };
      return { ok: this.#git(['push', '--quiet', 'origin', `refs/heads/${this.#branch}:refs/heads/${this.#branch}`], { timeout: 180000 }).ok, before };
    };
    let pushed = push();
    if (!pushed.ok) {
      this.#fetch();
      this.#must(['merge', '--no-ff', '--no-edit', '--quiet', this.#tracking], 'the store moved while saving and the merge with it conflicted; your commit is kept locally, not pushed.', 'resolve the merge in the store checkout, then push it.');
      pushed = push();
      if (!pushed.ok) throw new StoreError('the push to the store was refused twice; your commit is kept locally, not pushed.', 'run status, then retry.');
    }
    return pushed.before;
  }

  #readBack(commit, before = null) {
    this.#fetch();
    const tip = this.#remoteTip(this.#branch);
    if (tip !== commit && !this.#git(['merge-base', '--is-ancestor', commit, this.#tracking]).ok) throw new StoreError(`the read-back did not find commit ${commit.slice(0, 7)} on the store branch.`, 'run status and check the store on GitHub before relying on it.');
    if (before && !['ahead', 'identical'].includes(this.#compare(before, tip))) throw new StoreError(`GitHub no longer shows the old store tip ${before.slice(0, 7)} inside ${this.#branch}: history was replaced.`, 'tell the owner now; the old commits may still be recoverable on GitHub.');
  }

  #commit(message) {
    this.#must(['commit', '--quiet', '--no-edit', '-m', message], 'the commit failed.', 'check git config user.name and user.email, then retry.');
    return this.#must(['rev-parse', 'HEAD'], 'the new commit could not be read.', 'retry.').trim();
  }

  #finish(commit, extra = {}) {
    const before = this.#push();
    const head = this.#must(['rev-parse', 'HEAD'], 'the pushed commit could not be read.', 'run status.').trim();
    this.#readBack(head, before);
    return { store: this.#store, branch: this.#branch, commit: head, ...(head !== commit ? { merged_remote: true } : {}), read_back: true, ...extra };
  }

  // ---- subcommands ----------------------------------------------------------------------------

  status() {
    const { ahead, behind } = this.#position();
    const changes = this.#git(['status', '--porcelain', '--untracked-files=all']).out.split(/\r?\n/).filter(Boolean).length;
    return { store: this.#store, branch: this.#branch, folder: this.#dir, ahead: Number.isInteger(ahead) ? ahead : null, behind: Number.isInteger(behind) ? behind : null, changes, checked: true };
  }

  sync() {
    this.#fetch();
    this.#ready();
    return { store: this.#store, branch: this.#branch, commit: this.#must(['rev-parse', 'HEAD'], 'HEAD could not be read.', 'retry.').trim() };
  }

  save({ paths, message }) {
    const files = paths.map(storePath);
    if (!files.length || files.some(file => !file)) throw new StoreError('a --path is not a plain path inside the store.', 'name each path relative to the store top, with no .. or .git part.', 2);
    for (const file of files) {
      if (!this.#inside(`${file}/`) && !this.#inside(file)) throw new StoreError(`${file} is outside the store folders this command writes (${this.#allowed.join(', ')}).`, 'write the file under one of those folders.');
      const real = this.#realInside(file);
      if (!real) throw new StoreError(`${file} does not exist in the store checkout or leads out of it through a link.`, 'write the file inside the store checkout first.');
    }
    this.#fetch();
    this.#ready();
    this.#must(['add', '--ignore-removal', '--', ...files], 'git add refused the paths (an ignored or missing file?).', 'check the paths, then retry.');
    let scan;
    try { scan = this.#check(this.#staged()).stop; } catch (error) { this.#git(['reset', '--quiet']); throw error; }
    if (scan) { this.#git(['reset', '--quiet']); throw scan; }
    const commit = this.#commit(message);
    return this.#finish(commit, { files: files.length });
  }

  move({ from, to, message }) {
    const source = storePath(from);
    const target = storePath(to);
    if (!source || !target) throw new StoreError('--from and --to must be plain paths inside the store.', 'name them relative to the store top, with no .. or .git part.', 2);
    if (!this.#inside(`${target}/`)) throw new StoreError(`${target} is outside the store folders this command writes (${this.#allowed.join(', ')}).`, 'move it under one of those folders.');
    if (!this.#realInside(source)) throw new StoreError(`${source} does not exist in the store checkout or leads out of it through a link.`, 'name a tracked file or folder.');
    if (this.#exists(target)) throw new StoreError(`${target} already exists.`, 'pick a new target path.');
    this.#fetch();
    this.#ready({ cleanTree: true });
    // git mv needs the target's folder; create it inside the checkout (a link on the way is refused).
    const parent = path.posix.dirname(target);
    if (parent !== '.') {
      let existing = parent;
      while (existing !== '.' && !this.#exists(existing)) existing = path.posix.dirname(existing);
      if (existing !== '.' && !this.#realInside(existing)) throw new StoreError(`${existing} leads out of the store checkout through a link.`, 'pick another target path.');
      this.#fs.mkdirSync(path.join(this.#dir, ...parent.split('/')), { recursive: true });
    }
    this.#must(['mv', '--', source, target], `git mv refused to move ${source} (untracked or not clean?).`, 'commit it with save first, then move it.');
    // A pure rename brings no new content, so the check refuses only a link, a nested repository or
    // a target outside the folders; the move is then undone the same way it was made.
    let scan;
    try { scan = this.#check(this.#staged()).stop; } catch (error) { scan = error; }
    if (scan) { this.#git(['mv', '--', target, source]); throw scan; }
    const commit = this.#commit(message);
    return this.#finish(commit, { from: source, to: target });
  }

  mergeBranch({ branch, message }) {
    this.#checkBranch(branch);
    this.#fetch();
    this.#fetch(branch);
    this.#ready({ cleanTree: true });
    const other = `${OTHER_REFS}/${branch}`;
    if (this.#git(['merge-base', '--is-ancestor', other, 'HEAD']).ok) return { store: this.#store, branch: this.#branch, merged: branch, nothing_to_merge: true };
    const history = this.#scanHistory(`HEAD..${other}`);
    if (history) throw history;
    if (!this.#git(['merge', '--no-ff', '--no-commit', '--quiet', other]).ok) {
      this.#git(['merge', '--abort']);
      throw new StoreError(`${branch} does not merge cleanly into ${this.#branch}.`, 'update that branch from the store branch first.');
    }
    let scan;
    try { scan = this.#check(this.#staged()).stop; } catch (error) { this.#git(['merge', '--abort']); throw error; }
    if (scan) { this.#git(['merge', '--abort']); throw scan; }
    const commit = this.#commit(message);
    return this.#finish(commit, { merged: branch });
  }

  deleteMergedBranch({ branch }) {
    this.#checkBranch(branch);
    const bound = this.#remoteTip(this.#branch);
    const tip = this.#remoteTip(branch);
    if (!tip) throw new StoreError(`the store has no branch ${branch}.`, 'nothing to delete.');
    // GitHub decides "already merged": the branch tip must be the bound tip or behind it.
    if (!bound || !['identical', 'behind'].includes(this.#compare(bound, tip))) throw new StoreError(`${branch} has commits that are not in ${this.#branch}, so deleting it could lose the only copy.`, `merge it first with merge-branch --branch ${branch}.`);
    // The lease makes the delete hold only while the branch tip is still the one checked above; it
    // never forces an update.
    this.#must(['push', '--quiet', `--force-with-lease=refs/heads/${branch}:${tip}`, 'origin', '--delete', `refs/heads/${branch}`], `the store refused to delete ${branch} (it may have moved).`, 'run delete-merged-branch again.', { timeout: 120000 });
    if (this.#remoteTip(branch)) throw new StoreError(`the read-back still lists ${branch} on the store.`, 'check the store on GitHub.');
    const after = this.#remoteTip(this.#branch);
    if (!after || !['identical', 'behind'].includes(this.#compare(after, tip))) throw new StoreError(`the read-back on GitHub does not show ${tip.slice(0, 7)} inside ${this.#branch}.`, 'tell the owner now; GitHub may still hold the commit.');
    return { store: this.#store, branch: this.#branch, deleted: branch, tip, read_back: true };
  }

  #checkBranch(branch) {
    if (typeof branch !== 'string' || !BRANCH.test(branch) || branch.includes('..') || branch.endsWith('.lock')) throw new StoreError('--branch is not a plain branch name.', 'name the store branch.', 2);
    if (branch.toLowerCase() === this.#branch.toLowerCase()) throw new StoreError(`${branch} is the bound store branch itself.`, 'name another store branch.');
  }

  #exists(file) {
    try { this.#fs.lstatSync(path.join(this.#dir, ...file.split('/'))); return true; } catch { return false; }
  }

  // Whether the path exists and its real path stays inside the store checkout (no link leads out).
  #realInside(file) {
    try {
      const real = this.#fs.realpathSync.native(path.join(this.#dir, ...file.split('/')));
      const relative = path.relative(this.#dir, real);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    } catch { return false; }
  }
}

// ---- command line --------------------------------------------------------------------------------

const USAGE = `Usage: node repo/scripts/toolkit-store.cjs <${COMMANDS.join('|')}> --store <folder> [options] [--json]\n`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new StoreError(`unknown command ${JSON.stringify(command || '')}.`, 'see the usage line.', 2);
  const options = { command, json: false, paths: [] };
  const names = { '--store': 'store', '--repo-root': 'repoRoot', '--path': 'paths', '--message': 'message', '--from': 'from', '--to': 'to', '--branch': 'branch' };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') { options.json = true; continue; }
    const value = rest[index += 1];
    if (!VALUE_FLAGS[command].includes(arg) || value === undefined || value.startsWith('--')) throw new StoreError(`unknown or incomplete argument ${JSON.stringify(arg)} for ${command}.`, 'see the usage line.', 2);
    if (arg === '--path') options.paths.push(value);
    else if (options[names[arg]] !== undefined) throw new StoreError(`${arg} was given twice.`, 'give it once.', 2);
    else options[names[arg]] = value;
  }
  if (['save', 'move', 'merge-branch'].includes(command) && !MESSAGE.test(options.message || '')) throw new StoreError('--message is missing or not one plain line of at most 200 characters.', 'add --message "<what this saves>".', 2);
  if (command === 'save' && !options.paths.length) throw new StoreError('save needs at least one --path.', 'add --path <store path>.', 2);
  if (command === 'move' && (!options.from || !options.to)) throw new StoreError('move needs --from and --to.', 'add both.', 2);
  if (['merge-branch', 'delete-merged-branch'].includes(command) && !options.branch) throw new StoreError(`${command} needs --branch.`, 'add --branch <store branch>.', 2);
  return options;
}

function run(options, deps = {}) {
  const store = new EvidenceStore(deps);
  try {
    store.open({ store: options.store, repoRoot: options.repoRoot });
    switch (options.command) {
      case 'status': return store.status();
      case 'sync': return store.sync();
      case 'save': return store.save({ paths: options.paths, message: options.message });
      case 'move': return store.move({ from: options.from, to: options.to, message: options.message });
      case 'merge-branch': return store.mergeBranch({ branch: options.branch, message: options.message });
      default: return store.deleteMergedBranch({ branch: options.branch });
    }
  } finally { store.close(); }
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  let options;
  try { options = parseArgs(argv); } catch (error) { err(`${error.message}\n${USAGE}`); return 2; }
  try {
    const result = run(options, deps);
    out(options.json ? `${JSON.stringify({ command: options.command, ok: true, ...result }, null, 2)}\n`
      : `Done: ${options.command} ${Object.entries(result).map(([key, value]) => `${key}=${value}`).join(' ')}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    if (options.json) out(`${JSON.stringify({ command: options.command, ok: false, stopped: error.stopped, next: error.next }, null, 2)}\n`);
    else err(`${error.message}\n`);
    return error.exitCode;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ COMMANDS, VALUE_FLAGS, PLAIN_CONFIG, EvidenceStore, StoreError, mergedStoreBinding, parseArgs, storePath, main });
