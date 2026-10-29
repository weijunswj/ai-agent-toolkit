'use strict';

// The merge hold (global rules: never merge without the owner's OK). Shared by the Claude Code
// governance hook and the Codex helper hook.
//
// It is a tripwire, not a lock. It catches an agent that merges, or pushes to the default branch, on
// its own initiative or by mistake. It reads command text, and text can be reshaped (wrappers, nested
// sessions, scripts, files), so it cannot stop an agent set on getting past it. Agents also act as
// the user on GitHub, so GitHub cannot tell an agent's merge from the user's either. Where the
// repository has them (`toolkit governance check` reports them), its own GitHub rules are the hard
// limit: a pull request for every change to the default branch, no force-push, no deletion.
//
// What an approval is: one line of the user's own typed message (UserPromptSubmit) that says "merge"
// next to a pull request number, or names one with # or a link: "merge 618", "618 merge", "ok to
// merge #618", "can merge 618", "merge owner/name#618", "merge 601, 605 and 609", "merge 618 at
// 62405eb". A line does not count when it has a quote, a question, or one of a fixed list of words
// for a no, a doubt, a condition, a delay, a report or another kind of merge ("don't", "not yet",
// "if CI is green", "later", "should we ...?", "merge main into 618", "merge conflicts in 618").
// Other wording may still count, so the list leans towards not counting. It is recorded only in a session the user started: not one another session or a
// Toolkit launcher started, and not a resumed or forked run (the governance gate's session marks).
// It is for the repository the session is in, or the one the message names; a bare number typed
// outside a GitHub repository records nothing.
//
// What one approval allows: one merge, of that pull request in that repository, within a day, by any
// session on this computer. A typed SHA pins the head commit; without one the merge must still name
// the head it expects, so a push after that read makes GitHub refuse it. Connector auto-merge cannot
// name one, so it is refused. The approval is used when
// the hook lets the call through, even if a later prompt or the merge itself fails.
//
// What is held (decide, PreToolUse), with line continuations joined first:
//   - needs an approval and the expected head commit: `gh pr merge` (any flags, --auto included),
//     `gh api` to a pull request's merge endpoint (found anywhere in the command), and the GitHub
//     connector's merge tool;
//   - refused when written directly: the connector's auto-merge tool, GraphQL merges (the number cannot be read), the merge queue, branch merges,
//     writes to the default branch's ref, `gh repo sync`, gh aliases that mention merge, a `git push`
//     to the remote's default branch (evidence stores excepted, by name), a merge whose target is
//     moved by cd, pushd, Set-Location or GH_REPO, and a bare number in a folder with more than one
//     remote or a gh default repository other than its own, unless --repo or a URL names it;
//   - refused, as a tripwire against an agent approving for itself: a command that starts a Claude
//     or Codex session and mentions merge, or that sets or clears TOOLKIT_HOST_SESSION, names
//     Toolkit's user-state folder, or the hook scripts together with what would feed them a prompt.
//
// Not covered: wrapped or nested host launches (bash -lc, timeout, Start-Process and the like), a
// prompt file fed to a hook script, pasted text that has a plain approval line, scripts or programs
// that call git or the GitHub API themselves, curl and other HTTP clients, a sha= field put in a
// comment or an echo on purpose, git and shell aliases,
// commands inside files, pushes through a second remote or a wrapper, GH_REPO set outside the command
// (an env file, a profile or a long-lived shell), direct commits to the default branch through the
// Contents API, GraphQL createCommitOnBranch or the connector's file-write tools (push_files,
// create_or_update_file; a repository rule that requires a pull request refuses these), cloud
// sessions (the governance hook skips them) and stale plugin copies.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const gate = require('./toolkit-governance-gate.cjs');

const APPROVALS_BASENAME = 'merge-approvals.v1.json';
const APPROVALS_SCHEMA = 'toolkit.merge-approvals.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVALS = 100;
const MAX_PROMPT_CHARS = 8000;
const MAX_COMMAND_CHARS = 1024 * 1024;

const { SHELL_TOOLS, ShellCall } = require('./toolkit-shell-call.cjs');
const CONNECTOR_MERGE = /^mcp__.*github.*?_(merge_pull_request|enable_pr_auto_merge)$/i;
const SLUG = '[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+';
const MAX_APPROVAL_LINE = 200;
// A no, a doubt, a condition, a delay, a hand-off, a report or another kind of merge (a branch name
// such as "main" means merging a branch, not the pull request): the line is not an approval.
const HOLD_WORDS = /n't\b|\b(?:not|no|nope|never|dont|wont|cant|cannot|wait\w*|hold\w*|paus\w*|postpon\w*|delay\w*|defer\w*|halt\w*|veto\w*|undo\w*|nobody|none|neither|nor|later|until|till|unless|if|after|before|once|when|whenever|cancel\w*|stop\w*|without|given|providing|presum\w*|should|subject|contingent|barring|iff|days?|noon|midnight|cob|end|eventually|sometime|morning|afternoon|evening|tomorrow|tonight|minutes?|mins?|hours?|hrs?|maybe|perhaps|probably|possibly|might|guess|think|unsure|idk|dunno|hmm+|or|myself|into|conflicts?|revert\w*|reject\w*|refus\w*|block\w*|skip\w*|abort\w*|den(?:y|ied)|declin\w*|provided|assuming|pending|long|soon|bit|while|moment|secs?|seconds?|next|then|eod|tmrw?|weeks?|weekends?|months?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|wants?|ready|step|will|plan|todo|option|agent|main|mainline|master|trunk|develop|development|dev|staging|release|prod|production|stable|default|upstream|origin|base|broke|broken|clos\w*|fix\w*|resolv\w*|i'll|we'll|you'll|says?|said|reply|type|wrote|summary|merged|merging)\b|\d\s*(?:am|pm|[ap]\.m)\b|(?<!\d)\d{1,2}[:h]\d{2}\b|\b(?:on|upon|at)\s+(?:\w+\s+)?green\b|\d\s+(?:\w+\s+)?green\s*[.!]?\s*$|\bat\s+\d{1,4}\b|\b\d{1,4}[.,]\d{1,4}\b/i;
// A question: a question mark, "can we" or "may I" anywhere, or a line that opens like one.
const QUESTION = /\?|\b(?:can|may|could|shall)\s+(?:we|i)\b|^(?:should|shall|could(?!\s+you\b)|would(?!\s+you\b)|why|what|how|is|are|did|does|do\s+(?:we|you|i)|will|have|has|was|were)\b/i;
// One list marker: a bullet, a checkbox, (1), 1. 1) 1: (not the start of a time such as 17:00), or a
// letter marker such as a) or b. Up to five nested markers ("- 1. [x]") are stripped one at a time.
const LIST_MARKER = /^\s*(?:[-*+\u2022]|\[[ x]?\]|\(\d{1,4}\)|\d{1,4}[.):](?!\d)|[a-z][.)](?!\d+\s))\s*/i;
const APPROVAL_URL = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/(?:pull|issues)\/(\d{1,6})\S*/gi;
// The link with its path or fragment ("/files", "#top"), without the rest of its word, so a hold
// word glued to it ("…/622,later") is read.
const APPROVAL_LINK = new RegExp(`${APPROVAL_URL.source.slice(0, -3)}(?:[/#][\\w./#-]*)?`, 'gi');
// A quote: a line opened with ">", double quotes, backticks, angle or corner brackets, an ellipsis,
// or a single quote at a word edge (apostrophes inside words, as in "622's", are fine).
const QUOTED = /^>|["`<>「」『』…]|\.\.\.|(?:^|\s)'|'(?=\s|$|[.,!;:])/;
const APPROVAL_SHA = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi;
// Named pull requests: owner/name#N or #N anywhere, and bare numbers right before or after "merge"
// (a list such as "601, 605 and 609" included). Other numbers on the line are not read as pull
// requests, nor is a number before "merge" that a word follows ("3 merge issues") or one after it
// that a count word follows ("merge 2 branches"); a count in another form may still be.
const SLUG_NAME = new RegExp(`${SLUG}(?=#\\d)`, 'g');
const NAMED = new RegExp(`(?:(${SLUG})#|#)(\\d{1,6})\\b`, 'g');
// A later number followed by a word ("622, 3 files") is a count, not a pull request.
const LIST_TAIL = '(?:(?:\\s*(?:,|&|\\band\\b)\\s*|\\s+)\\d{1,6}\\b(?!\\s*(?!and\\b|at\\b)[A-Za-z]))*';
const COUNT_WORD = '(?!\\s*(?:commits?|branch(?:es)?|prs?|pull requests?|files?|issues?|changes?|conflicts?|lines?|times?|ways?|steps?)\\b)';
const AFTER_MERGE = new RegExp(`\\bmerge\\s+(?:pr\\s+|pull request\\s+)?(\\d{1,6}\\b${COUNT_WORD}${LIST_TAIL})`, 'gi');
const BEFORE_MERGE = new RegExp(`(?<![.:])\\b(\\d{1,6})\\s+merge\\b(?!\\s*[A-Za-z0-9#])`, 'gi');

const GH_PR_MERGE = /\bgh(?:\.exe)?\s+pr\s+((?:(?:-R|--repo)(?:=|\s+)\S+\s+)*)merge\b([^\n;&|]*)/gi;
const GH_API = /\bgh(?:\.exe)?\s+api\b([^\n;&|]*)/gi;
const PULL_MERGE_PATH = /\brepos\/([A-Za-z0-9._-]+|\{owner\}|:owner)\/([A-Za-z0-9._-]+|\{repo\}|:repo)\/pulls\/(\d+)\/merge\b/;
const ALWAYS_REFUSED_API = /\b(?:mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeBranch|updateRefs?)\b|\brepos\/[^\s/]+\/[^\s/]+\/merges\b/;
const PR_URL = /github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)/i;
const GH_REPO_SYNC = /\bgh(?:\.exe)?\s+repo\s+sync\b/i;
const GH_ALIAS_MERGE = /\bgh(?:\.exe)?\s+alias\s+(?:set|import)\b[^\n;&|]*merge/i;
const MOVES_TARGET = /(?:^|[\s;&|({])(?:cd|pushd|chdir|set-location|sl)\s|\bGH_REPO\s*=/i;
// Toolkit's user-state files, and any setting or clearing of the session variable that tells a
// session another one started it (reading or searching for its name is fine).
const STATE_WORDS = /merge-approvals|[\\/]\.ai-agent-toolkit[\\/]user-state\b|\bTOOLKIT_HOST_SESSION\s*=|(?:\bunset|-u|--unset(?:=|\s+)|\benv:|\$env:)\s*TOOLKIT_HOST_SESSION\b/i;
const HOOK_FEED = /toolkit-(?:merge-hold|governance-hook|codex-helper-hook)/i;
const FEED_WORDS = /\brequire\b|\brecordPrompt\b|\bUserPromptSubmit\b|\bimport\b/;
const HOST_WORD = /^(?:claude|codex)(?:-code)?(?:\.exe|\.cmd|\.ps1)?$|claude-code|@openai\/codex/i;
// gh pr merge flags that take a value, so the value is not read as the pull request.
const VALUE_FLAGS = new Set(['--repo', '-R', '--match-head-commit', '--subject', '-t', '--body', '-b', '--body-file', '-F', '--author-email', '-A']);
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path']);

const ASK_TEXT = 'Ask the user to type a line with "merge" and the pull request number (such as "merge N", or "merge owner/name#N") in their own chat, in a session opened in that repository\'s folder, after reading the merge summary. Never type it yourself, start a session or script to type it, or touch Toolkit\'s user-state files.';

class MergeHoldError extends Error {
  constructor(code) { super(code); this.name = 'MergeHoldError'; this.code = code; }
}

// The user-typed approvals, kept next to the governance decisions on this computer.
class MergeApprovals {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(path.dirname(governance.registryPathFor(registryOptions)), APPROVALS_BASENAME);
    this.#now = now;
  }

  // A store that cannot be read refuses every merge (fail closed); a damaged one counts as empty.
  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw new MergeHoldError('MERGE_APPROVALS_UNREADABLE');
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!parsed || parsed.schema !== APPROVALS_SCHEMA || !Array.isArray(parsed.approvals)) return [];
    const oldest = this.#now().getTime() - MAX_AGE_MS;
    return parsed.approvals.filter(entry => entry && Number.isInteger(entry.pr) && typeof entry.repository === 'string' && Date.parse(entry.at) >= oldest);
  }

  #write(approvals) {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: APPROVALS_SCHEMA, approvals: approvals.slice(-MAX_APPROVALS) }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally { fs.rmSync(temp, { force: true }); }
  }

  add(entries) {
    if (entries.length === 0) return;
    const at = this.#now().toISOString();
    this.#write([...this.#read(), ...entries.map(entry => ({ ...entry, at }))]);
  }

  // The newest unused approval for exactly this repository ("owner/name", case-insensitive) and number.
  find(repository, pr) {
    if (typeof repository !== 'string') return null;
    const wanted = repository.toLowerCase();
    return this.#read().reverse().find(entry => entry.pr === pr && entry.repository.toLowerCase() === wanted) || null;
  }

  use(approval) {
    this.#write(this.#read().filter(entry => !(entry.pr === approval.pr && entry.at === approval.at && entry.repository === approval.repository)));
  }
}

// "owner/name" of the GitHub repository a folder belongs to, or null.
function repositoryOf(cwd) {
  try {
    const identity = governance.readIdentity(cwd);
    return identity.valid && identity.remote.host === 'github.com' ? governance.remoteSlug(identity.remote) : null;
  } catch { return null; }
}

// Curly quotes become straight ones, so "don't" typed with smart punctuation still reads as "don't".
// Guillemets and a full-width ">" read as quotes too.
function normalise(text) {
  return String(text || '').replace(/[‘’ʼ′]/g, "'").replace(/[“”«»‹›＂]/g, '"').replace(/＞/g, '>').replace(/：/g, ':');
}

// The approvals in one typed message: [{ repository|null, pr, sha|null }].
function approvalsIn(prompt) {
  const found = [];
  for (const raw of normalise(prompt).slice(0, MAX_PROMPT_CHARS).split(/\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/)) {
    let line = raw;
    for (let strip = 0; strip < 5 && LIST_MARKER.test(line); strip += 1) line = line.replace(LIST_MARKER, '');
    // More nested markers than that make the line unclear.
    if (LIST_MARKER.test(line)) continue;
    line = line.trim();
    // Words in a link or a repository name ("ai-agent-toolkit") are not read as hold words. A link
    // reads as a number, so "merge <link> green" is held like "merge 618 green", but not as a
    // time, so "at <link>" is not a delay.
    // Hold words are read on the whole line, list marker included, so "17:00 merge 618" is a delay.
    const words = raw.replace(APPROVAL_LINK, ' x0 ').replace(SLUG_NAME, ' ');
    if (line.length > MAX_APPROVAL_LINE || !/\bmerge\b/i.test(words) || HOLD_WORDS.test(words) || QUESTION.test(line) || QUOTED.test(raw.trim()) || QUOTED.test(line)) continue;
    const items = [...line.matchAll(APPROVAL_URL)].map(match => ({ repository: match[1], pr: Number(match[2]) }));
    let rest = line.replace(APPROVAL_URL, ' # ');
    const shas = [...rest.matchAll(APPROVAL_SHA)].map(match => match[0].toLowerCase());
    rest = rest.replace(APPROVAL_SHA, ' ');
    // A longer bare number is neither a pull request nor a SHA, so the line is unclear.
    if (/\d{7,}/.test(rest) || shas.length > 1) continue;
    for (const match of rest.matchAll(NAMED)) items.push({ repository: match[1] || null, pr: Number(match[2]) });
    const bare = rest.replace(NAMED, ' # ');
    for (const match of bare.matchAll(AFTER_MERGE)) for (const number of match[1].match(/\d+/g)) items.push({ repository: null, pr: Number(number) });
    for (const match of bare.matchAll(BEFORE_MERGE)) items.push({ repository: null, pr: Number(match[1]) });
    const sha = items.length === 1 ? shas[0] || null : null;
    for (const item of items) found.push({ ...item, sha });
  }
  return found;
}

// Whether this session was started by the user: not by another session or a Toolkit launcher, and
// with a session-start mark from a run that was not resumed or forked.
function startedByUser(sessionId, environment, registryOptions, now) {
  if (typeof sessionId !== 'string' || sessionId === '') return false;
  if (gate.LAUNCHER_MARKERS.some(name => typeof environment[name] === 'string' && environment[name] !== '')) return false;
  const host = environment[gate.HOST_SESSION_VARIABLE];
  if (typeof host === 'string' && host !== '' && host !== sessionId) return false;
  const epochs = new gate.SessionEpochs({ registryOptions, now });
  return epochs.get(sessionId) !== null && !epochs.resumed(sessionId);
}

// Keeps the approvals a typed message carries; returns how many were kept.
function recordPrompt(input, { environment = process.env, registryOptions = {}, now } = {}) {
  const found = approvalsIn(input && input.prompt);
  if (found.length === 0) return 0;
  const sessionId = input && typeof input.session_id === 'string' ? input.session_id : null;
  if (!startedByUser(sessionId, environment || {}, registryOptions, now)) return 0;
  const here = repositoryOf(input && input.cwd);
  const entries = found.map(entry => ({ repository: entry.repository || here, pr: entry.pr, sha: entry.sha, session: sessionId }))
    .filter(entry => typeof entry.repository === 'string');
  new MergeApprovals({ registryOptions, now }).add(entries);
  return entries.length;
}

function wordsOf(text) {
  return [...String(text).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3]);
}

// The value of a flag in a command's words ("--repo x", "--repo=x", "-R x").
function flagValue(words, names) {
  for (let index = 0; index < words.length; index += 1) {
    for (const name of names) {
      if (words[index] === name && index + 1 < words.length) return words[index + 1];
      if (words[index].startsWith(`${name}=`)) return words[index].slice(name.length + 1);
    }
  }
  return null;
}

// The shell segments of a command line, each as words.
function segments(text) {
  return String(text).split(/\r?\n|;|&&|\|\||\||&/).map(part => wordsOf(part)).filter(words => words.length > 0);
}

// ---- git push to the default branch -----------------------------------------------------------

function gitDirs(root) {
  const dotGit = path.join(root, '.git');
  let gitDir = dotGit;
  try {
    if (fs.statSync(dotGit).isFile()) {
      const line = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (!line) return null;
      gitDir = path.resolve(root, line[1].trim());
    }
  } catch { return null; }
  let common = gitDir;
  try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { /* not a worktree */ }
  return { gitDir, common };
}

function hasRef(common, ref) {
  if (fs.existsSync(path.join(common, ...ref.split('/')))) return true;
  try { return fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n').some(line => line.endsWith(` ${ref}`)); } catch { return false; }
}

// { default, current, store } for a push from `cwd` to `remote`, or null outside a repository.
function pushTarget(cwd, remote) {
  let root;
  try { root = governance.findGitRoot(cwd); } catch { root = null; }
  if (!root) return null;
  const dirs = gitDirs(root);
  if (!dirs) return null;
  let current = null;
  try { current = (/^ref:\s*refs\/heads\/(.+)$/m.exec(fs.readFileSync(path.join(dirs.gitDir, 'HEAD'), 'utf8')) || [])[1] || null; } catch { current = null; }
  const remoteName = /^[A-Za-z0-9._-]+$/.test(remote) ? remote : null;
  let url = remoteName ? null : remote;
  if (remoteName) {
    try { url = governance.gitConfigValues(fs.readFileSync(path.join(dirs.common, 'config'), 'utf8'), 'remote', remoteName, 'url')[0] || null; } catch { url = null; }
  }
  let defaultBranch = null;
  if (remoteName) {
    try { defaultBranch = (/^ref:\s*refs\/remotes\/[^/]+\/(.+)$/m.exec(fs.readFileSync(path.join(dirs.common, 'refs', 'remotes', remoteName, 'HEAD'), 'utf8')) || [])[1] || null; } catch { defaultBranch = null; }
    if (!defaultBranch) defaultBranch = ['main', 'master'].find(name => hasRef(dirs.common, `refs/remotes/${remoteName}/${name}`)) || null;
  } else defaultBranch = ['main', 'master'].find(name => hasRef(dirs.common, `refs/remotes/origin/${name}`)) || null;
  return { default: defaultBranch, current, store: /TRANSPORT-[^/\s]*?(?:\.git)?\/?$/i.test(String(url || '')) };
}

const PUSH_VALUE_OPTIONS = new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option', '--signed']);

// The refusal for a git push in one segment, or ''.
function pushRefusal(words, cwd) {
  let index = 0;
  let root = cwd;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index += 1;
  if (!/^git(?:\.exe)?$/i.test(path.basename(words[index] || ''))) return '';
  index += 1;
  while (index < words.length && words[index].startsWith('-')) {
    const option = words[index];
    if (option === '-C' && index + 1 < words.length) root = path.resolve(root, words[index + 1]);
    index += GIT_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  if (words[index] !== 'push') return '';
  const args = words.slice(index + 1);
  const positional = [];
  let mirror = false;
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at];
    if (word === '--all' || word === '--mirror' || word === '--branches') mirror = true;
    if (PUSH_VALUE_OPTIONS.has(word)) { at += 1; continue; }
    if (!word.startsWith('-')) positional.push(word);
  }
  const remote = positional[0] || 'origin';
  const target = pushTarget(root, remote);
  if (!target || target.store || !target.default) return '';
  const refspecs = positional.slice(1);
  const branchOf = (name) => {
    const plain = name.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    return plain === 'HEAD' || plain === '@' ? target.current : plain;
  };
  const hitsDefault = mirror
    || (refspecs.length === 0 && target.current === target.default)
    || refspecs.some(spec => branchOf(spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec) === target.default);
  return hitsDefault ? `this command pushes to the default branch \`${target.default}\`. Changes must reach the default branch through a pull request the user merges; push to another branch and open one.` : '';
}

// ---- requested merges -------------------------------------------------------------------------

// Whether gh may target a repository other than origin's: more than one remote, or a gh default
// repository (`gh repo set-default` writes remote.<name>.gh-resolved) other than its own.
function ambiguousTarget(cwd) {
  try {
    const root = governance.findGitRoot(cwd);
    const dirs = root ? gitDirs(root) : null;
    if (!dirs) return false;
    const config = fs.readFileSync(path.join(dirs.common, 'config'), 'utf8');
    const remotes = new Set([...config.matchAll(/^\s*\[remote\s+"([^"]+)"\]/gm)].map(match => match[1]));
    return remotes.size > 1 || [...config.matchAll(/^\s*gh-resolved\s*=\s*(\S+)/gim)].some(match => match[1].toLowerCase() !== 'base');
  } catch { return false; }
}

// The default branch name for ref-write checks from this folder.
function defaultBranchOf(cwd) { return pushTarget(cwd, 'origin')?.default || 'main'; }

// Every merge a shell command asks for: [{ repository, pr, sha, auto, explicit }], or a refusal.
function shellMerges(text, cwd, environment = {}) {
  const merges = [];
  const here = () => (typeof environment.GH_REPO === 'string' && environment.GH_REPO ? environment.GH_REPO : ambiguousTarget(cwd) ? null : repositoryOf(cwd));
  for (const match of text.matchAll(GH_PR_MERGE)) {
    const before = wordsOf(match[1]);
    const words = wordsOf(match[2]);
    const target = words.find((word, index) => !word.startsWith('-') && !VALUE_FLAGS.has(words[index - 1]));
    const url = target ? PR_URL.exec(target) : null;
    const pr = url ? Number(url[2]) : target && /^#?\d+$/.test(target) ? Number(target.replace('#', '')) : null;
    const named = url ? url[1] : flagValue(words, ['--repo', '-R']) || flagValue(before, ['--repo', '-R']);
    merges.push({ repository: named || here(), pr, sha: flagValue(words, ['--match-head-commit']), auto: words.includes('--auto'), explicit: Boolean(named) });
  }
  // Searched across the whole command, so a quoted value with a newline, ; & or | before it does
  // not hide the path. With more than one, no sha= field is trusted.
  if (/\bgh(?:\.exe)?\s+api\b/i.test(text)) {
    const pulls = [...text.matchAll(new RegExp(PULL_MERGE_PATH.source, 'g'))];
    const shas = [...text.matchAll(/(?:^|\s)(?:-f|-F|--field|--raw-field)(?:\s+|=)["']?sha=([0-9a-f]{7,40})\b/gi)].map(match => match[1]);
    for (const pull of pulls) {
      const placeholder = /^(?:\{owner\}|:owner)$/.test(pull[1]) || /^(?:\{repo\}|:repo)$/.test(pull[2]);
      merges.push({ repository: placeholder ? here() : `${pull[1]}/${pull[2]}`, pr: Number(pull[3]), sha: pulls.length === 1 && shas.length === 1 ? shas[0] : null, auto: false, explicit: !placeholder });
    }
  }
  return merges;
}

function connectorMerge(tool, input) {
  const args = input && (input.tool_input || input.toolInput) || {};
  const auto = /enable_pr_auto_merge$/i.test(tool);
  const repository = typeof args.owner === 'string' && typeof args.repo === 'string' ? `${args.owner}/${args.repo}` : null;
  const pr = args.pullNumber !== undefined && Number.isInteger(Number(args.pullNumber)) ? Number(args.pullNumber) : null;
  return { repository, pr, sha: typeof args.expectedHeadSha === 'string' ? args.expectedHeadSha : null, auto, connector: true, explicit: true };
}

function deny(reason) { return { deny: `Toolkit: ${reason} ${ASK_TEXT}` }; }
function refuse(reason) { return { deny: `Toolkit: ${reason}` }; }

// The refusal for one requested merge, or the approval it uses.
function judge(merge, approvals) {
  if (merge.pr === null) return { refusal: deny('this command merges a pull request Toolkit cannot identify, so it is refused. Name the pull request by number.') };
  if (typeof merge.repository !== 'string') return { refusal: deny(`Toolkit cannot tell which repository pull request #${merge.pr} is in, so the merge is refused. Name it with --repo owner/name or a pull request URL.`) };
  const name = `${merge.repository}#${merge.pr}`;
  const approval = approvals.find(merge.repository, merge.pr);
  if (!approval) return { refusal: deny(`the user has not approved a merge of ${name} in the last day, so this merge is refused.`) };
  // Connector auto-merge cannot name a head commit, so it is refused; gh can.
  if (merge.connector && merge.auto) {
    return { refusal: refuse(`the connector's auto-merge cannot name the head commit it expects, so it is refused. After the user approves, use \`gh pr merge ${merge.pr} --auto --match-head-commit <sha>\` or the connector's merge tool with expectedHeadSha.`) };
  }
  if (!(typeof merge.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(merge.sha))) {
    return { refusal: refuse(`name the head commit this merge expects, so GitHub refuses it if the branch moves: add --match-head-commit <sha> (gh), sha= (API) or expectedHeadSha (connector) and retry.${approval.sha ? ` The user approved ${approval.sha}.` : ''}`) };
  }
  if (approval.sha && !merge.sha.toLowerCase().startsWith(approval.sha) && !approval.sha.startsWith(merge.sha.toLowerCase())) {
    return { refusal: deny(`the user approved ${name} at ${approval.sha}, but this merge names ${merge.sha}, so it is refused.`) };
  }
  return { approval };
}

// A refusal for a shell command that could make an approval without the user, or merges outside
// what an approval can allow; '' when there is none.
function shellRefusal(text, cwd) {
  if (STATE_WORDS.test(text)) return refuse('Toolkit\'s user-state files (merge approvals and governance decisions) and its session variable must be read and changed only by Toolkit itself. Never act as the user.');
  if (HOOK_FEED.test(text) && FEED_WORDS.test(text)) return refuse('a merge approval must come from the user\'s own typed message, so commands that load Toolkit\'s hook scripts or feed them a prompt are refused.');
  const parts = segments(text);
  for (const words of parts) {
    let index = 0;
    while (index < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]) || /^(?:env|npx|bunx|pnpm|dlx|exec|nohup|start)$/i.test(words[index]) || (words[index].startsWith('-') && index > 0))) index += 1;
    if (words.slice(0, index + 1).some(word => HOST_WORD.test(path.basename(word))) && /\bmerge\b/i.test(text)) {
      return refuse('a session an agent starts must not approve a merge, so starting Claude or Codex with a command that mentions merging is refused. Ask the user.');
    }
  }
  if (GH_ALIAS_MERGE.test(text)) return refuse('a gh alias would hide a merge from Toolkit\'s check, so it is refused.');
  if (GH_REPO_SYNC.test(text)) return refuse('`gh repo sync` writes to a default branch without a pull request, so it is refused. Ask the user to run it themselves.');
  // Checked across the whole command, so a GraphQL query or path on a later line still counts.
  if (/\bgh(?:\.exe)?\s+api\b/i.test(text)) {
    const branch = defaultBranchOf(cwd);
    if (ALWAYS_REFUSED_API.test(text) || new RegExp(`\\bgit\\/refs\\/heads\\/(?:${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|main|master)\\b`).test(text)) {
      return refuse('this API call merges or moves a branch in a way an approval cannot cover (GraphQL merges, the merge queue, branch merges or a ref write to the default branch), so it is refused. Use `gh pr merge <number> --match-head-commit <sha>` after the user approves, or ask the user to do it.');
    }
  }
  let root = cwd;
  for (const words of parts) {
    if (/^(?:cd|pushd|chdir|set-location|sl)$/i.test(words[0]) && words.length >= 2) { root = path.resolve(root || '.', words[words.length - 1]); continue; }
    const reason = pushRefusal(words, root || process.cwd());
    if (reason) return refuse(reason);
  }
  return '';
}

// The PreToolUse decision: { deny } or null.
function decide(input, { registryOptions = {}, now, environment = process.env } = {}) {
  const tool = String(input && (input.tool_name || input.toolName) || '');
  let merges;
  if (CONNECTOR_MERGE.test(tool)) merges = [connectorMerge(tool, input)];
  else if (ShellCall.isShellTool(tool)) {
    // The shared reader: command, cmd or a list of words, and the folder the command runs in
    // (Codex's workdir before the session folder). A line continuation (\, a PowerShell backtick or
    // a cmd caret before a line break) joins the next line.
    const call = ShellCall.from(input);
    const text = call.text.replace(/[\\`^]\r?\n/g, ' ');
    if (text.length > MAX_COMMAND_CHARS) return /merge|push/i.test(text) ? refuse('this command is too long to check for a merge or push, so it is refused. Split it.') : null;
    const cwd = call.folder;
    // An argument list is read both ways, as its words quoted and joined unquoted (as before the
    // shared reader), so a quoted program path such as `C:\Program Files\GitHub CLI\gh.exe` cannot
    // hide a merge. A merge both readings find counts once.
    const joined = call.joinedWords && call.joinedWords !== call.text ? call.joinedWords.replace(/[\\`^]\r?\n/g, ' ') : '';
    const refusal = shellRefusal(joined ? `${text}\n${joined}` : text, cwd);
    if (refusal) return refusal;
    merges = shellMerges(text, cwd, environment || {});
    if (joined) {
      const key = merge => JSON.stringify([merge.repository, merge.pr, merge.sha, merge.auto, merge.explicit]);
      const left = new Map();
      for (const merge of merges) left.set(key(merge), (left.get(key(merge)) || 0) + 1);
      for (const merge of shellMerges(joined, cwd, environment || {})) {
        const count = left.get(key(merge)) || 0;
        if (count > 0) left.set(key(merge), count - 1); else merges.push(merge);
      }
    }
    if (merges.some(merge => !merge.explicit) && MOVES_TARGET.test(joined ? `${text}\n${joined}` : text)) {
      return deny('this merge command changes folder or GH_REPO first, so Toolkit cannot tell which repository it merges in and it is refused. Name the repository with --repo owner/name or a pull request URL.');
    }
  } else return null;
  if (merges.length === 0) return null;
  const approvals = new MergeApprovals({ registryOptions, now });
  const used = [];
  for (const merge of merges) {
    const { refusal, approval } = judge(merge, approvals);
    if (refusal) return refusal;
    used.push(approval);
  }
  for (const approval of used) approvals.use(approval);
  return null;
}

// Whether a tool call may be a merge or a push, for the hooks' failure path.
function mayMerge(input) {
  const tool = String(input && (input.tool_name || input.toolName) || '');
  if (CONNECTOR_MERGE.test(tool)) return true;
  if (!SHELL_TOOLS.test(tool)) return false;
  // The whole raw input: this runs when the merge check failed, possibly while reading it.
  const args = input.tool_input || input.toolInput || {};
  let text;
  try { text = JSON.stringify(args); } catch { text = String(args); }
  return /\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i.test(text) || /\bgit\b[\s\S]*\bpush\b/i.test(text) || STATE_WORDS.test(text) || HOOK_FEED.test(text) || /\b(?:claude|codex)\b/i.test(text);
}

const CHECK_FAILED = 'Toolkit: the merge check failed, so this merge or push is refused. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.';

module.exports = Object.freeze({
  APPROVALS_BASENAME, APPROVALS_SCHEMA, CHECK_FAILED, MAX_AGE_MS, MAX_COMMAND_CHARS, MergeApprovals, MergeHoldError,
  approvalsIn, decide, mayMerge, recordPrompt, shellMerges,
});
