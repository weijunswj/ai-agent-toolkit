'use strict';

// Checks what a `git push` or a new pull request (`gh pr create`) would send, before it leaves the
// computer, so an agent hears about a problem in the same turn instead of from CI later:
//   - a credential on a line any sent commit adds (the shared formats in
//     skills/secure-ci-cd/scripts/secret-patterns.cjs: fixed prefixes and exact lengths only,
//     placeholders skipped, `secret-scan: allow <reason>` for a reviewed exception). Every commit is
//     read, so a credential added and removed again within one push is still found;
//   - plain-text findings in the sent version of each changed file, in a repository that runs the
//     plain-text check (.github/plain-text.json, or Toolkit's own settings in the Toolkit source).
// A refusal names the file, line and rule only: never any part of the matched text.
//
// What is sent: for a push, the commits of each pushed source (the refspec's local side, else HEAD)
// that the target remote does not already have (its remote-tracking refs, so a remote with none gets
// the whole history; every remote's when no remote or a URL is named). For a pull request, the commits of --head (else HEAD) not on the
// base branch (--base, else origin's default branch, else origin/main or origin/master). A folder that
// is not a repository is not checked; a folder that does not exist is refused.
//
// The check runs before the whole shell command. When a `git commit` comes earlier in the same
// command and repository, what it could commit is checked too, marked "not committed yet": the staged
// and unstaged tracked changes and, after a `git add` there, the untracked files git does not ignore.
// That is a superset of the real commit. A `git merge`, `cherry-pick`, `revert`, `am` or `rebase`
// earlier in the same command and repository refuses the push, since what it adds cannot be foreseen.
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
const NOTE = 'Toolkit could not check this push for credentials and plain-text findings, so it was let through';
const REV_OPTIONS = new Set(['--branches', '--tags']);

class CheckSkipped extends Error {}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function isFolder(folder) {
  try { return typeof folder === 'string' && fs.statSync(folder).isDirectory(); } catch { return false; }
}

const FOLDER_MISSING = 'Toolkit could not find the folder this push or pull request runs in, so it could not check what would be sent and refused it. Check the folder in `cd` or `git -C` (on Windows, `C:/...` and Git Bash `/c/...` both work), or run the command from inside that folder.';

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
// unforeseen } from `preceding` ([{ folder, sub }] in command order), each folder matched to the
// repository by its own top folder.
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
  const found = { add: false, commit: false, unforeseen: '' };
  for (const { folder, sub } of preceding) {
    if (!same(folder)) continue;
    if (sub === 'add' || sub === 'stage') found.add = true;
    else if (sub === 'commit') found.commit = true;
    else if (UNFORESEEN.has(sub) && !found.unforeseen) found.unforeseen = sub;
  }
  return found;
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

// The plain-text settings this repository runs with, or null when it does not run the check.
function plainTextSettings(top, portable) {
  const own = path.join(top, '.github', 'plain-text.json');
  const toolkit = path.join(top, 'repo', 'contracts', 'plain-references', 'config.json');
  let file = '';
  if (fs.existsSync(own)) file = own;
  else if (fs.existsSync(toolkit) && fs.existsSync(path.join(top, 'repo', 'scripts', 'check-plain-references.cjs'))) file = toolkit;
  if (!file) return null;
  const config = portable.readConfigFile(file);
  return config.off_reason ? null : config;
}

// Files as the pushed commit holds them, from one `git cat-file --batch` call: Map<file, text>.
function sentFiles(root, tip, files, deadline, spawn) {
  const result = runGit(root, ['cat-file', '--batch'], deadline, spawn, { input: Buffer.from(files.map((file) => `${tip}:${file}\n`).join(''), 'utf8'), encoding: 'buffer' });
  if (result.status !== 0) throw new CheckSkipped('git could not read the pushed files');
  const out = result.stdout;
  const texts = new Map();
  let offset = 0;
  for (const file of files) {
    const end = out.indexOf(0x0a, offset);
    if (end === -1) break;
    const header = out.subarray(offset, end).toString('utf8');
    offset = end + 1;
    // "<name> missing" has no content; any other object ("<sha> <type> <size>") is skipped whole, so a
    // path that became a folder never shifts the files after it.
    const object = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!object) continue;
    const size = Number(object[2]);
    if (object[1] === 'blob') texts.set(file, out.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }
  return texts;
}

// Plain-text findings in the sent version of each changed file, beyond the repository's baseline,
// counted as the plain-text check in CI counts them. A file in `pending` (about to be committed by
// the same shell command) is read from the working tree instead.
function plainTextFindings(root, tip, files, deadline, spawn, portable, pending = new Set()) {
  const config = plainTextSettings(root, portable);
  if (!config) return [];
  const scoped = [...new Set(files)].filter((file) => portable.scopeOf(file, config));
  if (!scoped.length) return [];
  const { baseline } = portable.check(root, config, { files: [] });
  const key = (entry) => `${entry.file}\0${entry.rule}\0${entry.text}`;
  const allowed = new Map(baseline.allowed.map((entry) => [key(entry), entry.count]));
  const groups = new Map();
  const committed = scoped.filter((file) => !pending.has(file));
  const texts = committed.length ? sentFiles(root, tip, committed, deadline, spawn) : new Map();
  for (const file of scoped) if (pending.has(file)) texts.set(file, workingText(root, file));
  for (const [file, text] of texts) {
    for (const finding of portable.findInText(text, file, config, portable.scopeOf(file, config))) {
      if (!groups.has(key(finding))) groups.set(key(finding), []);
      groups.get(key(finding)).push(finding);
    }
  }
  const failures = [];
  for (const [id, group] of groups) if (group.length > (allowed.get(id) || 0)) failures.push(...group);
  return failures.map((finding) => portable.describeFailure(finding, config));
}

function refusalText(secrets, plain, action, pending = false) {
  const items = [...secrets, ...plain];
  const listed = items.slice(0, MAX_LISTED).map((item) => `  ${item}`);
  if (items.length > MAX_LISTED) listed.push(`  ...and ${items.length - MAX_LISTED} more.`);
  const advice = [];
  if (secrets.length) advice.push('Credentials: take each one out of the commits being sent (each item names its commit), and treat it as exposed if it was real. For a reviewed false positive, add `secret-scan: allow <reason>` on that line.');
  if (plain.length) advice.push('Plain-text items: rewrite them in plain English.');
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
  portable = () => require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs'),
  budgetMs = BUDGET_MS,
  deadline = Date.now() + budgetMs,
  git = resolveGit
} = {}) {
  const sources = target.sources?.length ? target.sources : ['HEAD'];
  // A source git would read as an option is never passed on.
  if (sources.some((source) => source.startsWith('-') && !REV_OPTIONS.has(source))) return {};
  const allRefs = sources.some((source) => REV_OPTIONS.has(source));
  // A folder that is not there: the push cannot run there either, so nothing is lost by refusing,
  // while letting it through would skip the check whenever the folder was read wrongly.
  if (!isFolder(target.folder)) return { refusal: FOLDER_MISSING };
  try {
    const program = git(target.folder);
    if (!program) throw new CheckSkipped('git was not found');
    // Every git call below runs this absolute path, never a name the system looks up.
    const spawn = (_name, args, options) => spawnProgram(program, args, options);
    // One call for the repository folder and the pushed commits.
    const revs = sources.map((source) => (REV_OPTIONS.has(source) ? source : `${source}^{commit}`));
    let probe = runGit(target.folder, ['rev-parse', '--show-toplevel', ...revs], deadline, spawn);
    // A source that is not a commit yet: with a commit earlier in the same shell command (a first
    // commit in a new repository, say) only what it could commit is checked; otherwise the push
    // fails on its own. Not a repository: nothing to check.
    let committed = true;
    if (probe.status !== 0) {
      if (!target.preceding?.some((entry) => entry.sub === 'commit')) return {};
      probe = runGit(target.folder, ['rev-parse', '--show-toplevel'], deadline, spawn);
      if (probe.status !== 0) return {};
      committed = false;
    }
    const out = lines(probe.stdout);
    const root = path.resolve(out[0]);
    // Earlier git commands in the same shell command, in this repository: a commit Toolkit cannot
    // foresee refuses the push; a plain commit adds what it could commit to what is checked.
    const earlier = target.preceding?.length ? precedingIn(root, target.preceding, deadline, spawn) : {};
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
      // What the named remote already has (a remote with none gets everything); for no remote or a
      // URL, what any remote has.
      const named = target.remote && !looksLikeUrl(target.remote);
      range = [...sources, '--not', named ? `--remotes=${target.remote}` : '--remotes'];
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
    const result = {};
    // The plain-text step has its own fallback, so a broken setting never drops a credential refusal.
    let plain = [];
    if (!allRefs) {
      try { plain = plainTextFindings(root, out[1], changes.map((change) => change.file), deadline, spawn, portable(), new Set(pending.map((change) => change.file))); }
      catch (error) { result.note = `Toolkit could not check this push for plain-text findings: ${why(error)}.`; }
    }
    if (secrets.length || plain.length) result.refusal = refusalText(secrets, plain, action, pending.length > 0);
    return result;
  } catch (error) {
    return { note: `${NOTE}: ${why(error)}.` };
  }
}

module.exports = Object.freeze({ BUDGET_MS, FOLDER_MISSING, MAX_LISTED, addedLines, checkOutgoing, diffPath, resolveGit });
