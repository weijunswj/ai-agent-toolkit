'use strict';

// Checks what a `git push` or a new pull request (`gh pr create`) would send, before it leaves the
// computer, because a pushed credential cannot be taken back: a credential on a line any sent commit
// adds (the shared formats in skills/secure-ci-cd/scripts/secret-patterns.cjs: fixed prefixes and
// exact lengths only, placeholders skipped, `secret-scan: allow <reason>` for a reviewed exception).
// Every commit is read, so a credential added and removed again within one push is still found.
// Plain-text findings are left to CI's plain-text check: they leak nothing.
// A refusal names the file, line and rule only: never any part of the matched text.
//
// What is sent: for a push, the commits of each pushed source (the refspec's local side, else HEAD)
// that the target remote does not already have (its remote-tracking refs; every remote's when no
// remote or a URL is named, or the named remote has none yet). A name that is no configured remote
// sends nothing. For a pull request, the commits of --head (else HEAD) not on the
// base branch (--base, else origin's default branch, else origin/main or origin/master). A folder that
// is not a repository is not checked; a folder that cannot be found is refused.
//
// The check runs before the whole shell command. When a `git commit` comes earlier in the same
// command and repository, what it could commit is checked too, marked "not committed yet": the staged
// and unstaged tracked changes and, after a `git add` there, the untracked files git does not ignore.
// That is a superset of the real commit. A `git merge`, `cherry-pick`, `revert`, `am` or `rebase`
// earlier in the same command and repository refuses the push, since what it adds cannot be foreseen.
//
// A Codex call that names no folder (no `workdir`, and no `cd` or `git -C` to a full path) gives only
// the chat's folder, and the command may run in another working tree of the same repository. Then
// (`folderConfirmed: false`) a folder that is not a repository is refused (FOLDER_UNCONFIRMED). With
// more than one working tree reachable from it (the one holding it and any nested below it), so is a
// source the chat's folder cannot find; a push or pull request of HEAD is checked in every one of
// those working trees and goes only when each passes, unless an earlier step of the same command
// could move HEAD or a relative `cd` moved the unknown folder, which is refused; when the same command commits first, what it could commit is
// read in the working tree that has the pushed branch checked out, and any other source is refused.
// With one working tree, the check runs as for a named folder.
//
// It fails open: when git is not found or cannot run, the check takes longer than 30 seconds for one
// shell command, or a setting cannot be read, the command runs and one note is returned for the user. A broken check must
// never stop every push; it moves feedback earlier and does not replace CI or GitHub push protection.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUDGET_MS = 30000;
const MAX_LISTED = 10;
const MAX_PENDING_FILE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const NOTE = 'Toolkit could not check this push for credentials, so it was let through';
const REV_OPTIONS = new Set(['--branches', '--tags']);

class CheckSkipped extends Error {}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function isFolder(folder) {
  try { return typeof folder === 'string' && fs.statSync(folder).isDirectory(); } catch { return false; }
}

const FOLDER_MISSING = 'Toolkit could not find the folder this push or pull request runs in, so it could not check what would be sent and refused it. If the same command creates that folder first (`git clone`, `mkdir`, `git worktree add`), run that step as its own command, then the push. Otherwise check the folder in `cd` or `git -C` (`~/...`, and on Windows `C:/...` and Git Bash `/c/...`, all work).';
const FOLDER_UNREADABLE = 'Toolkit could not read the folder this push or pull request runs in, because it is written with a variable or a command the same command line does not set (such as `$(...)` or `$REPO`), so it could not check what would be sent and refused it. Write the folder out (`~/...` works), or run the command from inside that folder.';
const SOURCE_UNKNOWN = 'This command changes branches or commits before the push in the same command, and the branch it pushes does not exist yet, so Toolkit cannot tell what the push would send. Run the push as its own command after this finishes.';
const FOLDER_UNCONFIRMED = 'Codex did not say which folder this command runs in, and Toolkit could not tell from the chat\'s folder what this push or pull request would send, so it refused it. Run the commit and the push as separate commands and name the branch (`git push <remote> <branch>`), or name the folder first with `git -C <full path>` or `cd <full path>`.';

// An environment value by name, ignoring case on Windows as Windows does.
function environmentValue(environment, name, windows) {
  if (!windows) return environment[name];
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : environment[key];
}

// The git program by absolute path, or '' when there is none. A bare `git` would make the operating
// system search for it, and on Windows that search also looks in the folder the check runs git in, so
// a git.exe inside the repository being pushed could run. In order: TOOLKIT_GIT_PATH (absolute, a
// file), each absolute PATH entry other than that folder, then the usual install locations.
function resolveGit(folder, { environment = process.env, platform = process.platform, exists = isFile } = {}) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const name = windows ? 'git.exe' : 'git';
  const same = (left, right) => (windows ? left.toLowerCase() === right.toLowerCase() : left === right);
  const own = folder ? paths.resolve(folder) : '';
  const candidates = [];
  const configured = environmentValue(environment, 'TOOLKIT_GIT_PATH', windows);
  if (configured && paths.isAbsolute(configured)) candidates.push(configured);
  for (const entry of String(environmentValue(environment, 'PATH', windows) || '').split(windows ? ';' : ':')) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (directory && paths.isAbsolute(directory) && !same(paths.resolve(directory), own)) candidates.push(paths.join(directory, name));
  }
  if (windows) {
    for (const root of [environmentValue(environment, 'ProgramFiles', true), environmentValue(environment, 'ProgramW6432', true)]) {
      if (root && paths.isAbsolute(root)) candidates.push(paths.join(root, 'Git', 'cmd', name), paths.join(root, 'Git', 'bin', name));
    }
    const local = environmentValue(environment, 'LOCALAPPDATA', true);
    if (local && paths.isAbsolute(local)) candidates.push(paths.join(local, 'Programs', 'Git', 'cmd', name));
  } else candidates.push('/usr/bin/git', '/usr/local/bin/git');
  return candidates.find((candidate) => exists(candidate)) || '';
}

function runGit(folder, args, deadline, spawn, { input, encoding = 'utf8' } = {}) {
  const left = deadline - Date.now();
  if (left <= 0) throw new CheckSkipped('it took longer than 30 seconds');
  const result = spawn('git', ['--no-optional-locks', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args], { cwd: folder, encoding, windowsHide: true, timeout: left, maxBuffer: MAX_OUTPUT_BYTES, input });
  // Output over the limit also ends with a signal and no status, so it is told apart first.
  if (result.error?.code === 'ENOBUFS') throw new CheckSkipped('git wrote more than 64 MB, more than the check reads');
  if (result.error?.code === 'ETIMEDOUT' || (result.signal && result.status === null)) throw new CheckSkipped('it took longer than 30 seconds');
  if (result.error) throw new CheckSkipped(`git could not run (${result.error.code || 'error'})`);
  return result;
}

const shortSha = (sha) => sha.slice(0, 7);
const lines = (text) => String(text).split('\n').map((line) => line.replace(/\r$/, '')).filter(Boolean);
const looksLikeUrl = (remote) => /[:/\\]/.test(remote);

// A path as git prints it in a diff header: C-style quotes undone, and the tab git adds after a name
// with spaces dropped.
function diffPath(text) {
  const value = text.replace(/\t$/, '');
  if (!value.startsWith('"')) return value;
  try { return JSON.parse(value); } catch { return value.slice(1, -1); }
}

// Added lines per commit and file from `git log -p -U0 --format=%x00%H`:
// [{ commit, file, lines: [{ line, text }] }]. Hunk sizes are followed, so an added line that itself
// starts with "+++" is never read as a file header.
function addedLines(patch) {
  const changes = [];
  let commit = ''; let current = null; let line = 0; let oldLeft = 0; let newLeft = 0;
  for (const raw of patch.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith('+')) { if (current) current.lines.push({ line, text: text.slice(1) }); line += 1; newLeft -= 1; }
      else if (text.startsWith('-')) oldLeft -= 1;
      else if (text.startsWith(' ')) { line += 1; oldLeft -= 1; newLeft -= 1; }
      continue;
    }
    if (text.startsWith('\0')) { commit = text.slice(1).trim(); current = null; continue; }
    if (text.startsWith('+++ ')) {
      const name = diffPath(text.slice(4));
      current = name === '/dev/null' ? null : { commit, file: name.replace(/^b\//, ''), lines: [] };
      if (current) changes.push(current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      line = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return changes;
}

function secretFindings(changes, patterns) {
  const findings = [];
  for (const { commit, file, lines: added, pending } of changes) {
    for (const finding of patterns.scanLines(added)) findings.push(`${file}:${finding.line} (${pending ? 'not committed yet' : `commit ${shortSha(commit)}`}): ${finding.label}`);
  }
  return findings;
}

// Two folders are one, ignoring case on Windows as Windows does.
function samePath(left, right) {
  const [a, b] = [path.resolve(left), path.resolve(right)];
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// git commands that make commits Toolkit cannot foresee when they run before a push in the same
// shell command. `git pull` is not one: what it brings in is already on a remote.
const UNFORESEEN = new Set(['merge', 'cherry-pick', 'revert', 'am', 'rebase']);
const DIFF_OPTIONS = ['-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-filter=d', '--src-prefix=a/', '--dst-prefix=b/'];

// What earlier git commands of the same shell command did in this repository: { add, commit,
// unforeseen, created, steps } from `preceding` ([{ folder, sub }] in command order), each folder
// matched to the repository by its own top folder. `created` maps each branch a step creates
// (`sub: 'create'`, with `name` and `start`) to its start point; `steps` counts every step.
function precedingIn(root, preceding, deadline, spawn) {
  const tops = new Map();
  const same = (folder) => {
    const resolved = path.resolve(folder);
    if (!tops.has(resolved)) {
      const probe = samePath(resolved, root) ? { status: 0, stdout: root } : runGit(resolved, ['rev-parse', '--show-toplevel'], deadline, spawn);
      tops.set(resolved, probe.status === 0 && samePath(lines(probe.stdout)[0] || '', root));
    }
    return tops.get(resolved);
  };
  const found = { add: false, commit: false, unforeseen: '', created: new Map(), steps: 0 };
  for (const { folder, sub, name, start } of preceding) {
    if (!same(folder)) continue;
    found.steps += 1;
    if (sub === 'create' && name && start) found.created.set(name, start);
    else if (sub === 'add' || sub === 'stage') found.add = true;
    else if (sub === 'commit') found.commit = true;
    else if (UNFORESEEN.has(sub) && !found.unforeseen) found.unforeseen = sub;
  }
  return found;
}

// The working trees of the repository at `root`, from `git worktree list --porcelain -z`:
// [{ folder, branch }], `branch` the checked-out ref or '' when detached. A bare entry is left out.
function workingTrees(root, deadline, spawn) {
  const listed = runGit(root, ['worktree', 'list', '--porcelain', '-z'], deadline, spawn);
  if (listed.status !== 0) throw new CheckSkipped('git could not list the working trees');
  const trees = [];
  let current = null;
  for (const field of String(listed.stdout).split('\0')) {
    if (field.startsWith('worktree ')) trees.push(current = { folder: path.resolve(field.slice(9)), branch: '', bare: false });
    else if (current && field.startsWith('branch ')) current.branch = field.slice(7);
    else if (current && field === 'bare') current.bare = true;
  }
  return trees.filter((tree) => !tree.bare).map(({ folder, branch }) => ({ folder, branch }));
}

// A source that names the current branch rather than a branch of its own: HEAD or @, and what
// follows from them (HEAD~1, @{u}).
const followsHead = (source) => /^(?:HEAD|@)(?:$|[~^@{])/i.test(source);

// Whether `inner` is `outer` or a folder below it.
function within(inner, outer) {
  const relative = path.relative(path.resolve(outer), path.resolve(inner));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// The working trees a Codex call from the chat's folder can run in: the one holding that folder and
// any nested below it. Codex Desktop refuses a workdir outside the chat's folder (Windows error 267,
// invalid directory), so a working tree elsewhere, such as a sibling worktree of the same
// repository, is not where the command runs.
function reachableTrees(trees, chatFolder) {
  return trees.filter((tree) => within(chatFolder, tree.folder) || within(tree.folder, chatFolder));
}

// For a target whose folder Codex did not name (`folderConfirmed: false`), the working trees whose
// changes the push can carry: { root }, { roots } or { refusal }. It matters only when the same
// command commits first or the source is HEAD, and only when more than one working tree is reachable
// from the chat's folder (reachableTrees); otherwise the chat's folder is the one. With several, a
// HEAD source is checked in every one of them (each working tree has its own HEAD) only when the
// whole line is a single plain git command (`plainGit`); every other line is refused. After a commit
// in the same command, each source must be a branch exactly one working tree has checked out, and
// that working tree is read. Otherwise the commit's folder cannot be told and the push is refused: a
// branch none has checked out (a `git checkout` or `git tag` earlier in the same command could put
// the commit on it wherever the command runs), `--all` or `--tags`, and sources held in more than one
// working tree.
function unconfirmedFolder(root, target, sources, deadline, spawn) {
  const head = sources.some(followsHead);
  if (!head && !target.preceding?.length) return { root };
  const trees = reachableTrees(workingTrees(root, deadline, spawn), target.folder);
  if (trees.length <= 1) return { root };
  // A working tree whose folder is gone (one `git worktree prune` would drop) is not where it runs.
  if (head) return target.preceding?.length || !target.plainGit ? { refusal: FOLDER_UNCONFIRMED } : { roots: trees.map((tree) => tree.folder).filter(isFolder) };
  const folders = [];
  for (const source of sources) {
    if (REV_OPTIONS.has(source)) return { refusal: FOLDER_UNCONFIRMED };
    const ref = source.startsWith('refs/') ? source : `refs/heads/${source}`;
    const holders = trees.filter((tree) => tree.branch === ref);
    if (!holders.length) return { refusal: FOLDER_UNCONFIRMED };
    for (const tree of holders) if (!folders.some((known) => samePath(known, tree.folder))) folders.push(tree.folder);
  }
  return folders.length === 1 ? { root: folders[0] } : { refusal: FOLDER_UNCONFIRMED };
}

// Whether the folder is in a repository with a single working tree reachable from it
// (reachableTrees). Not a repository: false.
function singleWorkingTree(folder, deadline, spawn) {
  const top = runGit(folder, ['rev-parse', '--show-toplevel'], deadline, spawn);
  return top.status === 0 && reachableTrees(workingTrees(path.resolve(lines(top.stdout)[0]), deadline, spawn), folder).length <= 1;
}

// The working-tree file a pending change reads, or '' when it is missing, too big or binary.
function workingText(root, file) {
  try {
    const full = path.join(root, file);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > MAX_PENDING_FILE_BYTES) return '';
    const text = fs.readFileSync(full, 'utf8');
    return text.includes('\0') ? '' : text;
  } catch { return ''; }
}

// What a `git commit` earlier in the same shell command could add: a superset of the real commit,
// read before it runs. The staged and the unstaged tracked changes, and, after a `git add` in the
// same command, the untracked files git does not ignore (text files up to 1 MB). Each change is
// marked pending.
function pendingChanges(root, { add }, deadline, spawn) {
  const changes = [];
  for (const args of [['diff', '--cached', ...DIFF_OPTIONS, '--'], ['diff', ...DIFF_OPTIONS, '--']]) {
    const diff = runGit(root, args, deadline, spawn);
    if (diff.status !== 0) throw new CheckSkipped('git could not read the changes about to be committed');
    for (const change of addedLines(diff.stdout)) changes.push({ ...change, pending: true });
  }
  if (add) {
    const listed = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], deadline, spawn);
    if (listed.status !== 0) throw new CheckSkipped('git could not list the files about to be added');
    for (const file of String(listed.stdout).split('\0').filter(Boolean)) {
      if (Date.now() >= deadline) throw new CheckSkipped('it took longer than 30 seconds');
      const text = workingText(root, file);
      if (text) changes.push({ commit: '', file, pending: true, lines: text.split('\n').map((value, index) => ({ line: index + 1, text: value.replace(/\r$/, '') })) });
    }
  }
  return changes;
}

function refusalText(secrets, action, pending = false) {
  const items = secrets;
  const listed = items.slice(0, MAX_LISTED).map((item) => `  ${item}`);
  if (items.length > MAX_LISTED) listed.push(`  ...and ${items.length - MAX_LISTED} more.`);
  const advice = ['Credentials: take each one out of the commits being sent (each item names its commit), and treat it as exposed if it was real. For a reviewed false positive, add `secret-scan: allow <reason>` on that line.'];
  if (pending) advice.push('This command commits before it sends, so Toolkit also checked the changes about to be committed (marked "not committed yet"). If that file will not be in this commit, run the commit and the push as separate commands.');
  return [`Toolkit checked what this ${action} would send and found ${items.length} item(s) to fix first:`, ...listed, ...advice, `Then ${action === 'push' ? 'push' : 'open the pull request'} again.`].join('\n');
}

function why(error) {
  return error instanceof CheckSkipped ? error.message : `the check failed (${error?.code || error?.name || 'error'})`;
}

// { refusal, note } for one outgoing change set. target is
//   { folder, remote?, sources?: [rev...] }               for a push, or
//   { folder, pullRequest: true, base?, sources?: [rev] } for a pull request.
// A missing or empty `sources` means HEAD.
// `deadline` (a Date.now() time) shares one budget across every target of one shell call; without
// it the budget starts now. `git` finds the git program (tests replace it).
function checkOutgoing(target, {
  spawn: spawnProgram = spawnSync,
  patterns = () => require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs'),
  budgetMs = BUDGET_MS,
  deadline = Date.now() + budgetMs,
  git = resolveGit
} = {}) {
  let sources = target.sources?.length ? target.sources : ['HEAD'];
  // A source git would read as an option is never passed on.
  if (sources.some((source) => source.startsWith('-') && !REV_OPTIONS.has(source))) return {};
  // A folder Toolkit cannot find is refused rather than let through unchecked: either it does not
  // exist yet (made earlier in the same command, so the push can run as its own command after it),
  // or it is written in a form the check cannot read (a variable or a command substitution).
  if (!isFolder(target.folder)) return { refusal: /[$%`]/.test(String(target.folder)) ? FOLDER_UNREADABLE : FOLDER_MISSING };
  try {
    const program = git(target.folder);
    if (!program) throw new CheckSkipped('git was not found');
    // Every git call below runs this absolute path, never a name the system looks up.
    const spawn = (_name, args, options) => spawnProgram(program, args, options);
    // One call for the repository folder and the pushed commits.
    const revsOf = (list) => list.map((source) => (REV_OPTIONS.has(source) ? source : `${source}^{commit}`));
    let probe = runGit(target.folder, ['rev-parse', '--show-toplevel', ...revsOf(sources)], deadline, spawn);
    // A source that is not a commit yet. A branch an earlier step of the same shell command creates
    // (`checkout -b`, `switch -c`, `branch`, `worktree add -b`) is read at its start point, since that
    // is what the push will send. With a commit earlier in the same shell command (a first commit in
    // a new repository, say) only what it could commit is checked. After any other earlier git step
    // in this repository the push is refused, since that step could make the branch; with none, the
    // push fails on its own. Not a repository: nothing to check. When Codex did not name the folder,
    // the chat's folder may simply be the wrong one, so either is refused instead, unless the chat's
    // folder is in a repository with one working tree, which is then the one.
    let committed = true;
    if (probe.status !== 0) {
      if (target.folderConfirmed === false && !singleWorkingTree(target.folder, deadline, spawn)) return { refusal: FOLDER_UNCONFIRMED };
      if (!target.preceding?.length) return {};
      const top = runGit(target.folder, ['rev-parse', '--show-toplevel'], deadline, spawn);
      if (top.status !== 0) return {};
      const here = path.resolve(lines(top.stdout)[0]);
      const steps = (target.preceding || []).map((entry) => (entry.folderConfirmed === false ? { ...entry, folder: here } : entry));
      const before = steps.length ? precedingIn(here, steps, deadline, spawn) : { steps: 0, created: new Map() };
      const started = sources.map((source) => before.created.get(source) || source);
      if (started.some((source, index) => source !== sources[index])) {
        const again = runGit(target.folder, ['rev-parse', '--show-toplevel', ...revsOf(started)], deadline, spawn);
        if (again.status === 0) { probe = again; sources = started; }
      }
      if (probe.status !== 0) {
        if (before.commit) { probe = top; committed = false; }
        else if (before.steps) return { refusal: SOURCE_UNKNOWN };
        else return {};
      }
    }
    const out = lines(probe.stdout);
    let root = path.resolve(out[0]);
    if (target.folderConfirmed === false) {
      const found = unconfirmedFolder(root, target, sources, deadline, spawn);
      if (found.refusal) return { refusal: found.refusal };
      // The command may run in any of these working trees, so each one is checked within the same
      // budget, and the push goes only when every one passes: a refusal wins, then a note.
      if (found.roots) {
        const results = [];
        for (const folder of found.roots) {
          const result = checkOutgoing({ ...target, folder, folderConfirmed: true, sources }, { spawn: spawnProgram, patterns, deadline, git });
          if (result.refusal) return result;
          results.push(result);
        }
        return results.find((result) => result.note) || {};
      }
      root = found.root;
    }
    // Earlier git commands in the same shell command, in this repository: a commit Toolkit cannot
    // foresee refuses the push; a plain commit adds what it could commit to what is checked. A step
    // whose folder Codex did not name counts as this repository's.
    const preceding = (target.preceding || []).map((entry) => (entry.folderConfirmed === false ? { ...entry, folder: root } : entry));
    const earlier = preceding.length ? precedingIn(root, preceding, deadline, spawn) : {};
    const action = target.pullRequest ? 'pull request' : 'push';
    if (earlier.unforeseen) {
      return { refusal: `This command runs \`git ${earlier.unforeseen}\` before the ${action} in the same command, so Toolkit cannot tell what the ${action} would send. Run the ${action === 'push' ? 'push' : '`gh pr create`'} as its own command after this finishes.` };
    }
    let range = null;
    if (committed && target.pullRequest) {
      const candidates = [target.base && `refs/remotes/origin/${target.base}`, 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master'].filter(Boolean);
      const found = new Set(lines(runGit(root, ['for-each-ref', '--format=%(refname)', ...candidates], deadline, spawn).stdout));
      const base = candidates.find((ref) => found.has(ref));
      if (!base) return { note: `${NOTE}: no base branch was found on origin.` };
      range = [...sources, '--not', base];
    } else if (committed) {
      // What the named remote already has; for no remote, a URL or a configured remote with no
      // remote-tracking refs yet (new or empty), what any remote has, so history another remote
      // already holds is not read again. A name that is no configured remote sends nothing: git
      // refuses the push on its own.
      const named = target.remote && !looksLikeUrl(target.remote);
      let remotes = '--remotes';
      if (named) {
        const configured = runGit(root, ['remote'], deadline, spawn);
        if (configured.status !== 0) throw new CheckSkipped('git could not list the remotes');
        if (!lines(configured.stdout).includes(target.remote)) return {};
        const tracked = runGit(root, ['for-each-ref', '--count=1', '--format=%(refname)', `refs/remotes/${target.remote}/`], deadline, spawn);
        if (lines(tracked.stdout).length) remotes = `--remotes=${target.remote}`;
      }
      range = [...sources, '--not', remotes];
    }
    let sent = [];
    if (range) {
      const log = runGit(root, ['log', '-p', '-U0', '--format=%x00%H', ...DIFF_OPTIONS.slice(1), ...range, '--'], deadline, spawn);
      if (log.status !== 0) throw new CheckSkipped('git could not read the commits being sent');
      sent = addedLines(log.stdout);
    }
    const pending = earlier.commit ? pendingChanges(root, earlier, deadline, spawn) : [];
    const changes = [...sent, ...pending];
    if (!changes.length) return {};
    const secrets = secretFindings(changes, patterns());
    return secrets.length ? { refusal: refusalText(secrets, action, pending.length > 0) } : {};
  } catch (error) {
    return { note: `${NOTE}: ${why(error)}.` };
  }
}

module.exports = Object.freeze({ BUDGET_MS, FOLDER_MISSING, FOLDER_UNCONFIRMED, FOLDER_UNREADABLE, MAX_LISTED, addedLines, checkOutgoing, diffPath, resolveGit });
