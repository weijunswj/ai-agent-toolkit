'use strict';

// One refresh pull request per governed repository: `toolkit-cloud-workflows.cjs --repo <dir>
// --refresh-pr`. A controller chat runs it, that session and without asking, when its session start
// says the repository's Toolkit copies are stale (or the cloud sweep raised CLOUD_LAYOUT_STALE). It uses
// the person's own `gh` login and never the governance App, so no Toolkit commit can rewrite a governed
// repository's workflows by itself.
//
// It changes only Toolkit-made files: the default cloud workflows (toolkit-cloud-workflows.cjs; a missing
// one is added, an edited or outdated one brought back), the vendored plain-text check when it is
// outdated, and a plain-text baseline still in the old format (migrated as --migrate-baseline does).
// Everything else in the repository stays as it is.
//
//   - Governed repositories only: the merged binding must say ENABLED, read in the last 24 hours. Any
//     other repository (off, undecided, an evidence store, the Toolkit itself) gets one note and
//     nothing is written.
//   - Built on the default branch head on GitHub, from any checkout of the repository (a feature branch
//     or a worktree included): the files it compares are read from that commit's git objects into a
//     scratch folder (git fetch first when the checkout lacks the commit), never from the working tree,
//     so local branches and changes play no part.
//   - The commit message and the body name the full Toolkit commit the copies were rendered from on one
//     line, `Toolkit commit: <40 hex>` (TOOLKIT_COMMIT_LINE). When the branch moves, every copy on it is
//     that commit's render; a branch that does not move keeps the commit its open pull request names.
//   - Never rolls a copy back: a copy rendered by a Toolkit commit this checkout does not contain
//     stops it.
//   - Fixed branch toolkit/refresh-cloud-workflows. The tree and commit are made first and the branch
//     is created or moved last (fast-forward, or a merge commit when an older refresh branch is
//     there), so a failure leaves no partial pull request. An open refresh pull request is updated,
//     never doubled, and a rerun with nothing new changes nothing, even from a newer Toolkit commit.
//   - The pull request is read back (head commit, branch and changed files) and never merged.
//
// Exit codes: 0 opened, updated, unchanged or nothing to do (a note says which), 2 no pull request
// made (one line says why).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRANCH = 'toolkit/refresh-cloud-workflows';
const TITLE = 'Refresh the Toolkit copies';
const GITHUB_LIMIT = 16 * 1024 * 1024;
const { COPIED_FILES, GUARD_CONFIG, SWEEP_WORKFLOW, copiedState } = require('./toolkit-cloud-workflows-copied.cjs');
const COPIED = Object.values(COPIED_FILES).flat();
const PLAIN_TEXT = Object.freeze({ file: '.github/scripts/plain-text-check.cjs', source: 'skills/secure-ci-cd/scripts/plain-text-check.cjs' });
// The one line naming the Toolkit commit a refresh was rendered from, in its commit message and body.
const TOOLKIT_COMMIT_LINE = commit => `Toolkit commit: ${commit}`;
const TOOLKIT_COMMIT_PATTERN = /^Toolkit commit: [0-9a-f]{40}$/m;
// The folder a refresh compares, read from the default branch head's git objects.
const SNAPSHOT_FOLDER = '.github';

class RefreshError extends Error {
  constructor(message) { super(message); this.name = 'RefreshError'; }
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: GITHUB_LIMIT });
  return { ok: !result.error && result.status === 0, stdout: String(result.stdout || '') };
}

// `gh api` with the person's own login: (endpoint, { method, input }) gives the parsed reply, or null
// for a 404 when `missing` is set.
function ghApi(endpoint, { method = null, input = undefined, missing = false } = {}) {
  const { resolvePathExecutable } = require('./claude-process-launch.cjs');
  const args = ['api', endpoint, ...(method ? ['--method', method] : []), ...(input === undefined ? [] : ['--input', '-'])];
  const result = spawnSync(resolvePathExecutable('gh'), args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: GITHUB_LIMIT });
  if (result.error) throw new RefreshError(`gh could not run (${result.error.code || 'error'}); sign in with gh auth login and try again.`);
  if (result.status !== 0) {
    if (missing && /HTTP 404/.test(String(result.stderr || ''))) return null;
    const status = /HTTP (\d{3})/.exec(String(result.stderr || ''));
    throw new RefreshError(`GitHub refused ${method || 'GET'} ${endpoint.split('?')[0]}${status ? ` (HTTP ${status[1]})` : ''}.`);
  }
  return String(result.stdout || '').trim() ? JSON.parse(result.stdout) : null;
}

// The vendored plain-text check in the files at `target`, against the check at Toolkit `commit`:
// { file, state, text } (text: what a refresh writes), or null when the repository has none or that
// commit has no check. A missing check is installed by the plain-text installer, not by a refresh.
function vendoredCheck({ target, root, commit }) {
  const absolute = path.join(target, ...PLAIN_TEXT.file.split('/'));
  if (!fs.existsSync(absolute)) return null;
  const shown = git(root, ['show', `${commit}:${PLAIN_TEXT.source}`]);
  if (!shown.ok) return null;
  const installer = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
  return { file: PLAIN_TEXT.file, state: installer.vendoredState(fs.readFileSync(absolute, 'utf8'), shown.stdout).state, text: installer.vendoredText(shown.stdout) };
}

// Every Toolkit copy a refresh from `commit` would change in the files at `target` (a checkout, or the
// refresh's snapshot of the default branch head), in the order the refresh lists them, without writing
// or refusing anything: { rows: [{ file, text, state, kind, toolkit, pinned, why }], unmanaged, notes }.
// `unmanaged` is a rendered copy's path holding someone else's file, which stops a refresh. The session
// start (through the governance check), the cloud sweep and the refresh read the same rows, so they
// always name the same files. `workflows` is the cloud workflows installer.
function pending({ target, root, commit, ci = null, ciShards, defaultBranch = null, workflows = require('./toolkit-cloud-workflows.cjs') }) {
  const result = workflows.plan({ repo: target, root, commit, ...(ci ? { ci } : {}), ...(ciShards !== undefined ? { ciShards } : {}), ...(defaultBranch ? { defaultBranch } : {}) });
  const unmanaged = result.rows.find(row => row.kind !== 'copied' && row.state === 'unmanaged') || null;
  const notes = workflows.leftOutNotes(result);
  const rows = result.rows.filter(workflows.refreshable).map(row => ({ file: row.file, text: row.expected, state: row.state, kind: row.kind, toolkit: row.toolkit || null, pinned: Boolean(row.pinned),
    why: row.state === 'missing' ? 'added' : row.state === 'edited' ? 'edited by hand, rewritten' : row.pinned ? 'pinned to one Toolkit commit, now follows Toolkit main' : row.kind === 'copied' ? row.why || 'Toolkit copy updated' : 'layout changed' }));
  // Nothing sweeps what is already here after this pull request, as a turn-on's finish does.
  if (rows.some(entry => entry.file === SWEEP_WORKFLOW && entry.why === 'added')) notes.push(`The personal data guard checks new work only; to list what is already here, start ${SWEEP_WORKFLOW} once by hand after the merge (Actions, Personal data sweep, Run workflow). It changes and posts nothing; on a public repository anyone can read its list.`);
  const vendored = vendoredCheck({ target, root, commit });
  if (vendored?.state === 'outdated') rows.push({ file: vendored.file, text: vendored.text, state: 'outdated', kind: 'vendored', toolkit: null, pinned: false, why: 'vendored check updated' });
  else if (vendored && vendored.state !== 'current') notes.push(`${PLAIN_TEXT.file} is ${vendored.state === 'edited' ? 'edited by hand' : 'not a Toolkit copy'}, so it is left as it is.`);
  return { rows, unmanaged, notes };
}

// The Toolkit-made files this run changes, and what they become: [{ file, text, why }], plus notes
// for Toolkit files it leaves alone. It stops on someone else's file in a rendered copy's place and on
// a copy it would roll back.
function changes({ target, root, commit, ci, ciShards, defaultBranch, workflows }) {
  const { rows, unmanaged, notes } = pending({ target, root, commit, ci, ciShards, defaultBranch, workflows });
  if (unmanaged) throw new RefreshError(`${unmanaged.file} exists and is not a Toolkit copy; move it aside in a pull request first.`);
  for (const row of rows) {
    // A copy rendered by a newer Toolkit than this checkout would be rolled back.
    if (row.toolkit && !git(root, ['merge-base', '--is-ancestor', row.toolkit, commit]).ok) {
      // A shallow clone (cloud sessions clone 50 commits deep) may just not reach an older commit.
      if (git(root, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') throw new RefreshError(`${row.file} was made by Toolkit commit ${row.toolkit.slice(0, 7)}, which this shallow Toolkit checkout (${commit.slice(0, 7)}) cannot reach; run git fetch --unshallow origin in the Toolkit checkout, then run this again.`);
      throw new RefreshError(`${row.file} was made by Toolkit commit ${row.toolkit.slice(0, 7)}, which this Toolkit checkout (${commit.slice(0, 7)}) does not contain; update the Toolkit checkout to the latest main first.`);
    }
  }
  const out = rows.map(({ file, text, why }) => ({ file, text, why }));
  const baseline = migratedBaseline(target, root, commit);
  if (baseline) out.push(baseline);
  return { files: out, notes };
}

// The default branch head's files a refresh reads (the .github folder, and the plain-text baseline
// where its settings put it elsewhere), copied out of the checkout's git objects into a scratch folder,
// so the refresh never depends on the branch the checkout is on or on its local changes. The caller
// removes the folder. Only regular files and links are written; a link is written as a file holding
// its target, as git checks links out where it cannot make them.
class BranchSnapshot {
  #target;
  #commit;
  #branch;
  constructor(target, commit, branch) { this.#target = target; this.#commit = commit; this.#branch = branch; }

  // The folder holding the commit's files. The commit is fetched from origin's default branch first
  // when the checkout does not have it; a fetch only adds objects and moves no local branch.
  write() {
    this.#ensureCommit();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-refresh-snapshot-'));
    try {
      this.#copy(folder, [SNAPSHOT_FOLDER]);
      const baseline = baselineFile(folder);
      if (baseline && !baseline.startsWith(`${SNAPSHOT_FOLDER}/`)) this.#copy(folder, [baseline]);
      return folder;
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }

  #ensureCommit() {
    const have = () => git(this.#target, ['cat-file', '-e', `${this.#commit}^{commit}`]).ok;
    if (have()) return;
    const fetched = spawnSync('git', ['fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${this.#branch}`], { cwd: this.#target, encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (!fetched.error && fetched.status === 0 && have()) return;
    throw new RefreshError(`${this.#branch}'s head ${this.#commit.slice(0, 7)} on GitHub is not in this checkout, and fetching ${this.#branch} from origin did not bring it; run git fetch origin in the checkout, then run this again.`);
  }

  #copy(folder, paths) {
    const listed = spawnSync('git', ['ls-tree', '-r', '-z', '--full-tree', this.#commit, '--', ...paths], { cwd: this.#target, windowsHide: true, shell: false, maxBuffer: GITHUB_LIMIT });
    if (listed.error || listed.status !== 0) throw new RefreshError(`the files of ${this.#commit.slice(0, 7)} could not be read from this checkout's git objects.`);
    const entries = listed.stdout.toString('utf8').split('\0').map(line => /^(100644|100755|120000) blob ([0-9a-f]{40,64})\t(.+)$/s.exec(line)).filter(Boolean)
      .map(([, , sha, file]) => ({ sha, file }));
    if (!entries.length) return;
    // git never stores a path with an empty, `.` or `..` part, so this only guards a broken listing.
    if (entries.some(({ file }) => file.split('/').some(part => !part || part === '.' || part === '..'))) throw new RefreshError(`the files of ${this.#commit.slice(0, 7)} could not be read from this checkout's git objects.`);
    const batch = spawnSync('git', ['cat-file', '--batch'], { cwd: this.#target, input: entries.map(entry => `${entry.sha}\n`).join(''), windowsHide: true, shell: false, maxBuffer: 4 * GITHUB_LIMIT });
    if (batch.error || batch.status !== 0) throw new RefreshError(`the files of ${this.#commit.slice(0, 7)} could not be read from this checkout's git objects.`);
    let at = 0;
    for (const entry of entries) {
      const end = batch.stdout.indexOf(10, at);
      const header = /^[0-9a-f]+ blob (\d+)$/.exec(batch.stdout.subarray(at, end).toString('utf8'));
      if (!header) throw new RefreshError(`the files of ${this.#commit.slice(0, 7)} could not be read from this checkout's git objects.`);
      const size = Number(header[1]);
      const absolute = path.join(folder, ...entry.file.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, batch.stdout.subarray(end + 1, end + 1 + size));
      at = end + 1 + size + 1;
    }
  }
}

// Where the plain-text settings in `folder` keep their baseline, as a path inside the repository, or
// null (no settings, or a baseline outside the repository, which a refresh never migrates).
function baselineFile(folder) {
  const check = require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs');
  let file;
  try { file = path.posix.normalize(String(check.readConfigFile(path.join(folder, check.DEFAULT_CONFIG)).baseline).split(path.sep).join('/')); } catch { return null; }
  return file === '.' || file.startsWith('../') || file === '..' || path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) ? null : file;
}

// The plain-text baseline in the new format, when the repository's baseline still stores matched
// text: { file, text, why } or null. It runs the Toolkit's own --migrate-baseline on a scratch copy,
// so it keeps the same allowances and never scans or raises anything.
function migratedBaseline(target, root, commit) {
  const check = require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs');
  let config;
  try { config = check.readConfigFile(path.join(target, check.DEFAULT_CONFIG)); } catch { return null; }
  const file = String(config.baseline).split(path.sep).join('/');
  let baseline;
  try { baseline = check.readBaseline(target, config); } catch { return null; }
  if (baseline.missing || baseline.schema !== check.LEGACY_BASELINE_SCHEMA) return null;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-refresh-baseline-'));
  try {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    fs.copyFileSync(path.join(target, ...file.split('/')), path.join(scratch, ...file.split('/')));
    check.migrateBaseline(scratch, config);
    return { file, text: fs.readFileSync(path.join(scratch, ...file.split('/')), 'utf8'), why: 'plain-text baseline moved to the fingerprint format (--migrate-baseline)' };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

function bodyText(files, commit, notes) {
  return [
    'Owner: please merge this pull request. It brings this repository\'s Toolkit copies up to date; no agent merges it.',
    '',
    'Changed files:',
    ...files.map(entry => `- \`${entry.file}\`: ${entry.why}`),
    ...(notes.length ? ['', 'Notes:', ...notes.map(note => `- ${note}`)] : []),
    '',
    'Made by `toolkit-cloud-workflows.cjs --refresh-pr`. It changes only Toolkit-made files. The workflow copies run Toolkit main; to hold this repository on one Toolkit commit, set its TOOLKIT_REF variable to that commit.',
    '',
    TOOLKIT_COMMIT_LINE(commit),
  ].join('\n');
}

// The merged binding's ci_shards answer for the checkout at `target`, or null when none can be read.
function mergedCiShards(target) {
  try { return require('./toolkit-governance-state.cjs').mergedBinding(target)?.ci_shards?.answer || null; } catch { return null; }
}

// The governed-only and Toolkit commit checks, then the files, compared on a snapshot of the default
// branch head. { note } when there is nothing to do, else { repository, base, branch, files, notes,
// commit }. Governance comes before the Toolkit commit, so a repository that is not governed gets its
// one note whatever the Toolkit checkout's state.
function prepare({ target, root, commit, ci, ciShards, workflows, governance, github }) {
  if (workflows.isToolkitCheckout(target)) return { note: 'This is a Toolkit source checkout, which runs its own workflow files; there is nothing to refresh.' };
  const state = governance(target);
  if (state.state !== 'ENABLED') {
    const why = state.rule === 'S1' ? 'it is an evidence store' : state.state === 'UNDECIDED' ? 'its governance is not decided' : state.state === 'ERROR' ? 'its programme binding cannot be used' : 'its governance is off';
    return { note: `No refresh pull request: ${why}, and only governed repositories carry Toolkit copies.` };
  }
  if (state.governed_effects_hold || state.notes?.includes('could-not-check-governance')) throw new RefreshError('the merged programme binding could not be read in the last 24 hours; run refresh governance online first.');
  const at = commit || workflows.toolkitCommit(root);
  const repository = state.repository;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) throw new RefreshError('the governed repository\'s name could not be read.');
  const repo = github(`repos/${repository}`);
  const branch = repo.default_branch;
  const base = github(`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`).object.sha;
  if (!/^[0-9a-f]{40}$/.test(String(base || '')) || !/^[A-Za-z0-9_][A-Za-z0-9._\/-]{0,199}$/.test(String(branch || ''))) throw new RefreshError('the default branch and its head could not be read from GitHub.');
  const snapshot = new BranchSnapshot(target, base, branch).write();
  try {
    const { files, notes } = changes({ target: snapshot, root, commit: at, ci, ciShards: ciShards !== undefined ? ciShards : mergedCiShards(target), defaultBranch: branch, workflows });
    if (!files.length) return { note: `The Toolkit copies in ${repository} are current; no refresh pull request is needed.${notes.length ? ` ${notes.join(' ')}` : ''}` };
    return { repository, base, branch, files, notes, commit: at };
  } finally {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
}

// The body without the Toolkit commit it names, so a rerun from a newer commit with the same files
// leaves the pull request as it is.
const sansCommit = body => String(body || '').replace(TOOLKIT_COMMIT_PATTERN, '');

// Makes or updates the refresh pull request on GitHub and reads it back.
function publish({ repository, base, branch, files, notes, commit, github, workflows }) {
  const owner = repository.split('/')[0];
  const existing = github(`repos/${repository}/git/ref/heads/${BRANCH}`, { missing: true })?.object?.sha || null;
  const allowed = new Set(files.map(entry => entry.file));
  if (existing && existing !== base) {
    // An older refresh branch may hold only Toolkit-made files; anything else is someone's work: another
    // path, a file at a copied workflow's path that Toolkit did not write, or guard settings this run
    // would not carry on.
    const compared = github(`repos/${repository}/compare/${base}...${existing}`);
    const foreign = (compared.files || []).map(entry => entry.filename).filter(name => {
      if (name === GUARD_CONFIG) return !allowed.has(name);
      if (!allowed.has(name) && !isToolkitFile(name, workflows)) return true;
      if (!COPIED.includes(name)) return false;
      const held = github(`repos/${repository}/contents/${name.split('/').map(encodeURIComponent).join('/')}?ref=${existing}`, { missing: true });
      return Boolean(held) && (held.encoding !== 'base64' || copiedState(name, Buffer.from(held.content, 'base64').toString('utf8')) === 'unmanaged');
    });
    if (foreign.length) throw new RefreshError(`branch ${BRANCH} also changes ${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ' and more' : ''}; land or remove that work first.`);
  }
  const open = github(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${BRANCH}`)}&per_page=10`) || [];
  // The Toolkit commit the open pull request already names, which its branch's copies were rendered from.
  const named = existing && open.length ? (TOOLKIT_COMMIT_PATTERN.exec(String(open[0].body || ''))?.[0].slice('Toolkit commit: '.length) || null) : null;
  // A workflow copy the refresh branch already holds with this layout and body stays as it is: only
  // its header's Toolkit commit would change, which is no reason for a new commit and CI run. That is
  // only done while the open pull request names the commit those copies came from, so the commit line
  // stays true. The guard's settings the branch holds always stay: they may be the owner's.
  const held = new Map();
  const heldText = file => {
    if (!held.has(file)) {
      const found = github(`repos/${repository}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${existing}`, { missing: true });
      held.set(file, found?.encoding === 'base64' ? Buffer.from(found.content, 'base64').toString('utf8') : null);
    }
    return held.get(file);
  };
  const textsFor = keepCopies => files.map(entry => {
    if (!existing || (entry.file !== GUARD_CONFIG && (!keepCopies || workflows.MARKER.exec(entry.text)?.index !== 0))) return entry.text;
    const text = heldText(entry.file);
    if (text === null) return entry.text;
    if (entry.file === GUARD_CONFIG) return require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs').currentConfigText(text);
    return workflows.copyState(text, entry.text).state === 'current' ? text : entry.text;
  });
  const baseCommit = github(`repos/${repository}/git/commits/${base}`);
  const treeOf = texts => github(`repos/${repository}/git/trees`, { method: 'POST', input: { base_tree: baseCommit.tree.sha, tree: files.map((entry, index) => ({ path: entry.file, mode: '100644', type: 'blob', content: texts[index] })) } });
  let tree = treeOf(textsFor(Boolean(named)));
  let headSha = existing;
  let moved = false;
  const branchTree = existing ? github(`repos/${repository}/git/commits/${existing}`).tree.sha : null;
  if (branchTree !== tree.sha) {
    // A new commit names one Toolkit commit, so every copy in it is that commit's own render: a copy
    // kept from the branch (an older header) would make the named commit untrue.
    if (named) tree = treeOf(textsFor(false));
    // Behind or level with the default branch: a plain commit on it. Otherwise a merge commit, so the
    // branch only ever moves forward.
    const behind = existing && ['behind', 'identical'].includes(github(`repos/${repository}/compare/${base}...${existing}`).status);
    const parents = !existing || behind ? [base] : [existing, base];
    headSha = github(`repos/${repository}/git/commits`, { method: 'POST', input: { message: `${TITLE}\n\n${TOOLKIT_COMMIT_LINE(commit)}`, tree: tree.sha, parents } }).sha;
    if (existing) github(`repos/${repository}/git/refs/heads/${BRANCH}`, { method: 'PATCH', input: { sha: headSha, force: false } });
    else github(`repos/${repository}/git/refs`, { method: 'POST', input: { ref: `refs/heads/${BRANCH}`, sha: headSha } });
    moved = true;
  }
  // Unmoved, the branch still holds what the open pull request's named commit rendered.
  const body = bodyText(files, !moved && named ? named : commit, notes);
  let number;
  let outcome;
  if (open.length) {
    number = open[0].number;
    if (moved || sansCommit(open[0].body) !== sansCommit(body)) github(`repos/${repository}/pulls/${number}`, { method: 'PATCH', input: { title: TITLE, body } });
    outcome = moved ? 'updated' : 'unchanged';
  } else {
    number = github(`repos/${repository}/pulls`, { method: 'POST', input: { title: TITLE, head: BRANCH, base: branch, body } }).number;
    outcome = 'opened';
  }
  // Read back: the pull request is open on the refresh branch at the commit made here and changes
  // only the files this run chose.
  const pr = github(`repos/${repository}/pulls/${number}`);
  const changed = (github(`repos/${repository}/pulls/${number}/files?per_page=100`) || []).map(entry => entry.filename);
  if (pr.state !== 'open' || pr.head?.ref !== BRANCH || pr.head?.sha !== headSha || pr.base?.ref !== branch
    || files.some(entry => !changed.includes(entry.file)) || changed.some(name => !allowed.has(name))) {
    throw new RefreshError(`pull request ${number} did not read back as made (branch, head commit or changed files differ); check it before anyone merges it.`);
  }
  return { outcome, number, url: pr.html_url, head: headSha };
}

// The files a refresh may ever change, by path: the default cloud workflows' files, the vendored
// plain-text check and the default baseline (a renamed test shards copy or baseline is allowed only when this run
// chose it).
function isToolkitFile(name, workflows) {
  return workflows.DEFAULT_FILES.includes(name) || name === PLAIN_TEXT.file || name === '.github/plain-text-baseline.json';
}

// Runs the whole refresh: { code, line }. Every failure is one line and no pull request change.
function refreshPr({ repo, ci = null, root, commit, ciShards, workflows = require('./toolkit-cloud-workflows.cjs'), governance = target => require('./toolkit-governance-state.cjs').governanceState(target), github = ghApi }) {
  try {
    const target = path.resolve(repo);
    if (!fs.existsSync(path.join(target, '.git'))) throw new RefreshError(`${target} is not a git checkout.`);
    const ready = prepare({ target, root, commit, ci, ciShards, workflows, governance, github });
    if (ready.note) return { code: 0, line: ready.note };
    const result = publish({ ...ready, github, workflows });
    const verb = { opened: 'Opened', updated: 'Updated', unchanged: 'Unchanged' }[result.outcome];
    return { code: 0, line: `${verb} refresh pull request ${result.url} (${ready.files.length} file${ready.files.length === 1 ? '' : 's'}: ${ready.files.map(entry => entry.file).join(', ')}). Ask the owner to merge it; nothing merges it automatically.`, result };
  } catch (error) {
    if (error instanceof RefreshError || error?.name === 'InstallError') return { code: 2, line: `No refresh pull request: ${error.message}` };
    throw error;
  }
}

module.exports = Object.freeze({ BRANCH, TITLE, RefreshError, refreshPr, isToolkitFile, pending, vendoredCheck });
