'use strict';

// One refresh pull request per governed repository: `toolkit-cloud-workflows.cjs --repo <dir>
// --refresh-pr`. A controller chat runs it when its session start says the repository's Toolkit copies
// are stale (or the cloud sweep raised CLOUD_LAYOUT_STALE). It uses the person's own `gh` login and
// never the governance App, so no Toolkit commit can rewrite a governed repository's workflows by
// itself.
//
// It changes only Toolkit-made files: the default cloud workflows (toolkit-cloud-workflows.cjs; a missing
// one is added, an edited or outdated one brought back), the vendored plain-text check when it is
// outdated, and a plain-text baseline still in the old format (migrated as --migrate-baseline does).
// Everything else in the repository stays as it is.
//
//   - Governed repositories only: the merged binding must say ENABLED, read in the last 24 hours. Any
//     other repository (off, undecided, an evidence store, the Toolkit itself) gets one note and
//     nothing is written.
//   - Built on the default branch head on GitHub, which the local checkout must match, with no local
//     change under .github, so what it renders is what that branch holds.
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

// The Toolkit-made files this run may change, and what they become: [{ file, text, why }], plus notes
// for Toolkit files it leaves alone. `workflows` is the cloud workflows installer.
function changes({ target, root, commit, ci, ciShards, workflows }) {
  const result = workflows.plan({ repo: target, root, commit, ...(ci ? { ci } : {}), ...(ciShards !== undefined ? { ciShards } : {}) });
  const unmanaged = result.rows.find(row => row.kind !== 'copied' && row.state === 'unmanaged');
  if (unmanaged) throw new RefreshError(`${unmanaged.file} exists and is not a Toolkit copy; move it aside in a pull request first.`);
  const out = [];
  const notes = workflows.leftOutNotes(result);
  for (const row of result.rows.filter(workflows.refreshable)) {
    // A copy rendered by a newer Toolkit than this checkout would be rolled back.
    if (row.toolkit && !git(root, ['merge-base', '--is-ancestor', row.toolkit, commit]).ok) {
      // A shallow clone (cloud sessions clone 50 commits deep) may just not reach an older commit.
      if (git(root, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') throw new RefreshError(`${row.file} was made by Toolkit commit ${row.toolkit.slice(0, 7)}, which this shallow Toolkit checkout (${commit.slice(0, 7)}) cannot reach; run git fetch --unshallow origin in the Toolkit checkout, then run this again.`);
      throw new RefreshError(`${row.file} was made by Toolkit commit ${row.toolkit.slice(0, 7)}, which this Toolkit checkout (${commit.slice(0, 7)}) does not contain; update the Toolkit checkout to the latest main first.`);
    }
    out.push({ file: row.file, text: row.expected, why: row.state === 'missing' ? 'added' : row.state === 'edited' ? 'edited by hand, rewritten' : row.pinned ? 'pinned to one Toolkit commit, now follows Toolkit main' : row.kind === 'copied' ? row.why || 'Toolkit copy updated' : 'layout changed' });
  }
  // Nothing sweeps what is already here after this pull request, as a turn-on's finish does.
  if (out.some(entry => entry.file === SWEEP_WORKFLOW && entry.why === 'added')) notes.push(`The personal data guard checks new work only; to list what is already here, start ${SWEEP_WORKFLOW} once by hand after the merge (Actions, Personal data sweep, Run workflow). It changes and posts nothing; on a public repository anyone can read its list.`);
  const absolute = path.join(target, ...PLAIN_TEXT.file.split('/'));
  const shown = fs.existsSync(absolute) ? git(root, ['show', `${commit}:${PLAIN_TEXT.source}`]) : { ok: false };
  if (shown.ok) {
    const installer = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
    const state = installer.vendoredState(fs.readFileSync(absolute, 'utf8'), shown.stdout).state;
    if (state === 'outdated') out.push({ file: PLAIN_TEXT.file, text: installer.vendoredText(shown.stdout), why: 'vendored check updated' });
    else if (state !== 'current') notes.push(`${PLAIN_TEXT.file} is ${state === 'edited' ? 'edited by hand' : 'not a Toolkit copy'}, so it is left as it is.`);
  }
  const baseline = migratedBaseline(target, root, commit);
  if (baseline) out.push(baseline);
  return { files: out, notes };
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
    `Made by \`toolkit-cloud-workflows.cjs --refresh-pr\` from Toolkit ${commit.slice(0, 7)}. It changes only Toolkit-made files. The workflow copies run Toolkit main; to hold this repository on one Toolkit commit, set its TOOLKIT_REF variable to that commit.`,
  ].join('\n');
}

// The governed-only, Toolkit commit, clean-checkout and same-head checks, then the files. { note } when
// there is nothing to do, else { repository, base, branch, files, notes, commit }. Governance comes
// before the Toolkit commit, so a repository that is not governed gets its one note whatever the
// Toolkit checkout's state.
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
  const head = git(target, ['rev-parse', 'HEAD']).stdout.trim();
  if (head !== base) throw new RefreshError(`the checkout is at ${head.slice(0, 7) || 'no commit'}, not at ${branch}'s head ${base.slice(0, 7)} on GitHub; update it (git fetch, then fast-forward ${branch}) and run this again.`);
  if (git(target, ['status', '--porcelain', '--', '.github']).stdout.trim()) throw new RefreshError('the checkout has local changes under .github; commit or set them aside first.');
  const { files, notes } = changes({ target, root, commit: at, ci, ciShards, workflows });
  if (!files.length) return { note: `The Toolkit copies in ${repository} are current; no refresh pull request is needed.${notes.length ? ` ${notes.join(' ')}` : ''}` };
  return { repository, base, branch, files, notes, commit: at };
}

// The body without the Toolkit commit it names, so a rerun from a newer commit with the same files
// leaves the pull request as it is.
const sansCommit = body => String(body || '').replace(/ from Toolkit [0-9a-f]{7}\. /, ' ');

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
  // A workflow copy the refresh branch already holds with this layout and body stays as it is: only
  // its header's Toolkit commit would change, which is no reason for a new commit and CI run. So do the
  // guard's settings the branch holds: they may be the owner's.
  const texts = files.map(entry => {
    if (!existing || (entry.file !== GUARD_CONFIG && workflows.MARKER.exec(entry.text)?.index !== 0)) return entry.text;
    const held = github(`repos/${repository}/contents/${entry.file.split('/').map(encodeURIComponent).join('/')}?ref=${existing}`, { missing: true });
    const text = held?.encoding === 'base64' ? Buffer.from(held.content, 'base64').toString('utf8') : null;
    if (text === null) return entry.text;
    if (entry.file === GUARD_CONFIG) return require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs').currentConfigText(text);
    return workflows.copyState(text, entry.text).state === 'current' ? text : entry.text;
  });
  const baseCommit = github(`repos/${repository}/git/commits/${base}`);
  const tree = github(`repos/${repository}/git/trees`, { method: 'POST', input: { base_tree: baseCommit.tree.sha, tree: files.map((entry, index) => ({ path: entry.file, mode: '100644', type: 'blob', content: texts[index] })) } });
  let headSha = existing;
  let moved = false;
  const branchTree = existing ? github(`repos/${repository}/git/commits/${existing}`).tree.sha : null;
  if (branchTree !== tree.sha) {
    // Behind or level with the default branch: a plain commit on it. Otherwise a merge commit, so the
    // branch only ever moves forward.
    const behind = existing && ['behind', 'identical'].includes(github(`repos/${repository}/compare/${base}...${existing}`).status);
    const parents = !existing || behind ? [base] : [existing, base];
    headSha = github(`repos/${repository}/git/commits`, { method: 'POST', input: { message: TITLE, tree: tree.sha, parents } }).sha;
    if (existing) github(`repos/${repository}/git/refs/heads/${BRANCH}`, { method: 'PATCH', input: { sha: headSha, force: false } });
    else github(`repos/${repository}/git/refs`, { method: 'POST', input: { ref: `refs/heads/${BRANCH}`, sha: headSha } });
    moved = true;
  }
  const body = bodyText(files, commit, notes);
  const open = github(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${BRANCH}`)}&per_page=10`) || [];
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

module.exports = Object.freeze({ BRANCH, TITLE, RefreshError, refreshPr, isToolkitFile });
