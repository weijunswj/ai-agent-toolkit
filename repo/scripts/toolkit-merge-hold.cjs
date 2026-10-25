'use strict';

// The merge hold (global rules: never merge without the owner's OK). Shared by the Claude Code
// governance hook and the Codex helper hook.
//
// What an approval is: the user's own typed message (UserPromptSubmit) in which the whole message,
// or one line of it, is "merge N" ("merge 618", "merge #618", "merge owner/name#618", "merge 601,
// 605 and 609", "yes merge 618", "merge 618 at 62405eb"). Anything else on that line ("don't",
// "if CI is green", "later", a question) means it is not one. It is recorded only in a session the
// user started: not one another session or a Toolkit launcher started, and not a resumed or forked
// run (the governance gate's session marks). It is for the repository the session is in, or the
// one the message names; a bare number typed outside a GitHub repository records nothing.
//
// What one approval allows: one merge, of that pull request in that repository, within a day, by any
// session on this computer. A typed SHA pins the head commit; without one the merge must still name
// the head it expects, so a push after that read makes GitHub refuse it. The approval is used when
// the hook lets the call through, even if a later prompt or the merge itself fails.
//
// What is held (decide, PreToolUse):
//   - needs an approval: `gh pr merge` (any flags, --auto included), `gh api` to a pull request's
//     merge endpoint, and the GitHub connector's merge and auto-merge tools;
//   - always refused: GraphQL merges (the number cannot be read), the merge queue, branch merges,
//     writes to the default branch's ref, `gh repo sync`, gh aliases that mention merge, a `git push`
//     to the remote's default branch (evidence stores excepted), and a merge whose target is moved
//     by cd, pushd, Set-Location or GH_REPO without naming --repo or a URL;
//   - refused so an agent cannot make an approval itself: a command that starts a Claude or Codex
//     session and mentions merge, or that sets or clears TOOLKIT_HOST_SESSION, names Toolkit's user-state folder,
//     or the hook scripts together with what would feed them a prompt.
//
// Not covered: scripts or programs that call git or the GitHub API themselves, curl and other HTTP
// clients, git and shell aliases, commands inside files, a fresh session started with a cleaned
// environment and a prompt read from a file (the hold stops an agent acting on its own initiative;
// it is not a sandbox), cloud sessions (the governance hook skips them) and stale plugin copies.

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

const SHELL_TOOLS = /^(?:Bash|PowerShell|Monitor|exec_command|shell|local_shell)$/;
const CONNECTOR_MERGE = /^mcp__.*github.*?_(merge_pull_request|enable_pr_auto_merge)$/i;
const SLUG = '[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+';
const ITEM = `(?:${SLUG}#)?#?\\d{1,6}`;
// One line that is a merge instruction and nothing else.
const APPROVAL_LINE = new RegExp(`^\\s*(?:[-*\\u2022]\\s*|\\d{1,3}[.):]\\s*)?(?:(?:yes|ok|okay)[,!.:]?\\s+)?merge\\s+(${ITEM}(?:\\s*(?:,|&|\\band\\b)\\s*${ITEM}|\\s+${ITEM})*)(?:\\s+(?:at\\s+|@\\s*)([0-9a-f]{7,40})|\\s+([0-9a-f]{7,40}))?\\s*[.!]?\\s*$`, 'i');
const ITEMS = new RegExp(`(?:(${SLUG})#)?#?(\\d{1,6})`, 'g');

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

const ASK_TEXT = 'Ask the user to type "merge N" on its own line in their own chat, in a session opened in that repository\'s folder (or "merge owner/name#N"), after reading the merge summary. Never type it yourself, start a session or script to type it, or touch Toolkit\'s user-state files.';

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
function normalise(text) {
  return String(text || '').replace(/[‘’ʼ′]/g, "'").replace(/[“”]/g, '"');
}

// The approvals in one typed message: [{ repository|null, pr, sha|null }].
function approvalsIn(prompt) {
  const found = [];
  for (const line of normalise(prompt).slice(0, MAX_PROMPT_CHARS).split(/\r?\n/)) {
    const match = APPROVAL_LINE.exec(line);
    if (!match) continue;
    const loose = match[3] || null;
    // A trailing number without "at" is another pull request, not a SHA.
    if (loose && !/[a-f]/i.test(loose)) continue;
    const items = [...match[1].matchAll(ITEMS)].map(item => ({ repository: item[1] || null, pr: Number(item[2]) }));
    const sha = items.length === 1 ? (match[2] || loose || '').toLowerCase() || null : null;
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
  return hitsDefault ? `this command pushes to the default branch \`${target.default}\`. Changes reach the default branch only through a pull request the user merges; push to another branch and open one.` : '';
}

// ---- requested merges -------------------------------------------------------------------------

// The default branch name for ref-write checks from this folder.
function defaultBranchOf(cwd) { return pushTarget(cwd, 'origin')?.default || 'main'; }

// Every merge a shell command asks for: [{ repository, pr, sha, auto, explicit }], or a refusal.
function shellMerges(text, cwd, environment = {}) {
  const merges = [];
  const here = () => (typeof environment.GH_REPO === 'string' && environment.GH_REPO ? environment.GH_REPO : repositoryOf(cwd));
  for (const match of text.matchAll(GH_PR_MERGE)) {
    const before = wordsOf(match[1]);
    const words = wordsOf(match[2]);
    const target = words.find((word, index) => !word.startsWith('-') && !VALUE_FLAGS.has(words[index - 1]));
    const url = target ? PR_URL.exec(target) : null;
    const pr = url ? Number(url[2]) : target && /^#?\d+$/.test(target) ? Number(target.replace('#', '')) : null;
    const named = url ? url[1] : flagValue(words, ['--repo', '-R']) || flagValue(before, ['--repo', '-R']);
    merges.push({ repository: named || here(), pr, sha: flagValue(words, ['--match-head-commit']), auto: words.includes('--auto'), explicit: Boolean(named) });
  }
  for (const match of text.matchAll(GH_API)) {
    const rest = match[1];
    const pull = PULL_MERGE_PATH.exec(rest);
    if (!pull) continue;
    const placeholder = /^(?:\{owner\}|:owner)$/.test(pull[1]) || /^(?:\{repo\}|:repo)$/.test(pull[2]);
    const words = wordsOf(rest);
    const shaField = words.map((word, index) => (['-f', '-F', '--field', '--raw-field'].includes(words[index - 1]) ? word : null)).find(word => word && word.startsWith('sha='));
    merges.push({ repository: placeholder ? here() : `${pull[1]}/${pull[2]}`, pr: Number(pull[3]), sha: shaField ? shaField.slice(4) : null, auto: false, explicit: !placeholder });
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
  if (typeof merge.repository !== 'string') return { refusal: deny(`Toolkit cannot tell which repository pull request #${merge.pr} is in, so the merge is refused. Name it with --repo owner/name.`) };
  const name = `${merge.repository}#${merge.pr}`;
  const approval = approvals.find(merge.repository, merge.pr);
  if (!approval) return { refusal: deny(`the user has not approved a merge of ${name} in the last day, so this merge is refused.`) };
  // A connector auto-merge call cannot name a commit; every other merge must.
  const needsSha = !(merge.connector && merge.auto);
  if (needsSha && !(typeof merge.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(merge.sha))) {
    return { refusal: refuse(`name the head commit this merge expects, so GitHub refuses it if the branch moves: add --match-head-commit <sha> (gh), sha= (API) or expectedHeadSha (connector) and retry.${approval.sha ? ` The user approved ${approval.sha}.` : ''}`) };
  }
  if (approval.sha && needsSha && !merge.sha.toLowerCase().startsWith(approval.sha) && !approval.sha.startsWith(merge.sha.toLowerCase())) {
    return { refusal: deny(`the user approved ${name} at ${approval.sha}, but this merge names ${merge.sha}, so it is refused.`) };
  }
  return { approval };
}

// A refusal for a shell command that could make an approval without the user, or merges outside
// what an approval can allow; '' when there is none.
function shellRefusal(text, cwd) {
  if (STATE_WORDS.test(text)) return refuse('Toolkit\'s user-state files (merge approvals and governance decisions) and its session variable are read and changed only by Toolkit itself. Never act as the user.');
  if (HOOK_FEED.test(text) && FEED_WORDS.test(text)) return refuse('only the user\'s own typed message can approve a merge, so commands that load Toolkit\'s hook scripts or feed them a prompt are refused.');
  const parts = segments(text);
  for (const words of parts) {
    let index = 0;
    while (index < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]) || /^(?:env|npx|bunx|pnpm|dlx|exec|nohup|start)$/i.test(words[index]) || (words[index].startsWith('-') && index > 0))) index += 1;
    if (words.slice(0, index + 1).some(word => HOST_WORD.test(path.basename(word))) && /\bmerge\b/i.test(text)) {
      return refuse('a session started from a command cannot approve a merge, so starting Claude or Codex with a prompt that mentions merging is refused. Put the instruction in a file the session reads instead, or ask the user.');
    }
  }
  if (GH_ALIAS_MERGE.test(text)) return refuse('a gh alias would hide a merge from Toolkit\'s check, so it is refused.');
  if (GH_REPO_SYNC.test(text)) return refuse('`gh repo sync` writes to a default branch without a pull request, so it is refused. Ask the user to run it themselves.');
  for (const match of text.matchAll(GH_API)) {
    const rest = match[1];
    const branch = defaultBranchOf(cwd);
    if (ALWAYS_REFUSED_API.test(rest) || new RegExp(`\\bgit\\/refs\\/heads\\/(?:${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|main|master)\\b`).test(rest)) {
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
  else if (SHELL_TOOLS.test(tool)) {
    const args = input && (input.tool_input || input.toolInput) || {};
    const text = String(args.command || '');
    if (text.length > MAX_COMMAND_CHARS) return /merge|push/i.test(text.slice(0, MAX_COMMAND_CHARS)) ? refuse('this command is too long to check for a merge or push, so it is refused. Split it.') : null;
    const cwd = input && input.cwd ? path.resolve(String(input.cwd)) : process.cwd();
    const refusal = shellRefusal(text, cwd);
    if (refusal) return refusal;
    merges = shellMerges(text, cwd, environment || {});
    if (merges.some(merge => !merge.explicit) && MOVES_TARGET.test(text)) {
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
  const text = String((input.tool_input || input.toolInput || {}).command || '');
  return /\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i.test(text) || /\bgit\b[\s\S]*\bpush\b/i.test(text) || STATE_WORDS.test(text) || HOOK_FEED.test(text) || /\b(?:claude|codex)\b/i.test(text);
}

const CHECK_FAILED = 'Toolkit: the merge check failed, so this merge or push is refused. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.';

module.exports = Object.freeze({
  APPROVALS_BASENAME, APPROVALS_SCHEMA, CHECK_FAILED, MAX_AGE_MS, MergeApprovals, MergeHoldError,
  approvalsIn, decide, mayMerge, recordPrompt, shellMerges,
});
