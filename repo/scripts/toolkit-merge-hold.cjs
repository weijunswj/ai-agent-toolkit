'use strict';

// The merge hold (global rules: never merge without the owner's OK). An agent may merge a pull
// request, or turn on its auto-merge, only after the user typed "merge N" for that pull request in
// their own chat. Shared by the Claude Code governance hook and the Codex helper hook:
//
//   - recordPrompt (UserPromptSubmit) keeps each "merge N" the user types, optionally with a head
//     SHA ("merge 618 at 62405eb"), for the repository the session is in. A session that another
//     session or a Toolkit launcher started records nothing: only the user typing counts.
//   - decide (PreToolUse) refuses `gh pr merge` (with or without --auto), a `gh api` call to a pull
//     request's merge endpoint or a merge mutation, and the GitHub connector's merge and auto-merge
//     tools, unless an unused approval for that repository and number exists. A merge must also name
//     the head commit it expects (`--match-head-commit` or `expectedHeadSha`), so a push after the
//     approval makes GitHub refuse it; when the user typed a SHA, the named commit must match it.
//     An allowed merge uses its approval up, and an approval lasts a day.
//   - A command that names the approvals file or Toolkit's user-state folder is refused, so an
//     agent cannot write an approval for itself.
//
// Best effort, like the attribution guard: scripts or programs that call the GitHub API themselves,
// shell aliases and commands nested in files are not seen. Cloud sessions keep no lasting user
// state and are not covered (the governance hook skips them). Approvals stay on this computer.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');

const APPROVALS_BASENAME = 'merge-approvals.v1.json';
const APPROVALS_SCHEMA = 'toolkit.merge-approvals.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVALS = 100;
const MAX_PROMPT_CHARS = 4000;
const MAX_COMMAND_CHARS = 1024 * 1024;
const LAUNCHER_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']);
const HOST_SESSION_VARIABLE = 'TOOLKIT_HOST_SESSION';

const SHELL_TOOLS = /^(?:Bash|PowerShell|Monitor|exec_command|shell|local_shell)$/;
const CONNECTOR_MERGE = /^mcp__.*github.*__(merge_pull_request|enable_pr_auto_merge)$/i;
// "merge 618", "merge #618", "merge 601, 605 and 609", "merge 618 at 62405eb".
const MERGE_WORDS = /\bmerge[ \t]+#?(\d{1,7})((?:[ \t]*(?:,|&|\band\b)[ \t]*#?\d{1,7}|[ \t]+#?\d{1,7}(?![0-9a-f]))*)(?:[ \t]+(?:at[ \t]+|@[ \t]*)?([0-9a-f]{7,40})\b)?/gi;
const GH_PR_MERGE = /\bgh(?:\.exe)?\s+pr\s+merge\b([^\n;&|]*)/gi;
const GH_API = /\bgh(?:\.exe)?\s+api\b([^\n;&|]*)/gi;
const PULL_MERGE_PATH = /\brepos\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pulls\/(\d+)\/merge\b/;
const GRAPHQL_MERGE = /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/;
const PR_URL = /github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)/i;
// gh pr merge flags that take a value, so the value is not read as the pull request.
const VALUE_FLAGS = new Set(['--repo', '-R', '--match-head-commit', '--subject', '-t', '--body', '-b', '--body-file', '-F', '--author-email', '-A']);
// Words just before "merge N" on the same line that make it not an approval ("don't merge 618").
const NOT_APPROVAL = /\b(?:don'?t|do\s+not|not|never|no|hold|wait|stop|before|after|until|if|should|can|could|would|will)\b[^.!\n]{0,24}$/i;
const STATE_WORDS = /merge-approvals|[\\/]\.ai-agent-toolkit[\\/]user-state\b/i;

const ASK_TEXT = 'Ask the user to type "merge N" (optionally with the head SHA) in their own chat after reading the merge summary. Never type it yourself, start a session or script to type it, or write Toolkit\'s user-state files.';

class MergeHoldError extends Error {
  constructor(code) { super(code); this.name = 'MergeHoldError'; this.code = code; }
}

// The user-typed approvals for merges, kept next to the governance decisions on this computer.
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
    return parsed.approvals.filter(entry => entry && Number.isInteger(entry.pr) && Date.parse(entry.at) >= oldest);
  }

  #write(approvals) {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(temp, `${JSON.stringify({ schema: APPROVALS_SCHEMA, approvals: approvals.slice(-MAX_APPROVALS) }, null, 2)}\n`);
    fs.renameSync(temp, this.#file);
  }

  add(entries) {
    if (entries.length === 0) return;
    const at = this.#now().toISOString();
    this.#write([...this.#read(), ...entries.map(entry => ({ ...entry, at }))]);
  }

  // The newest unused approval matching the repository ("owner/name", case-insensitive; an approval
  // typed outside any GitHub repository matches any) and number, or null.
  find(repository, pr) {
    const wanted = typeof repository === 'string' ? repository.toLowerCase() : null;
    return this.#read().reverse().find(entry => entry.pr === pr
      && (entry.repository === null || (wanted !== null && String(entry.repository).toLowerCase() === wanted))) || null;
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

// Whether this session was started by another session or a Toolkit launcher, not by the user.
function launched(sessionId, environment) {
  if (LAUNCHER_MARKERS.some(name => typeof environment[name] === 'string' && environment[name] !== '')) return true;
  const host = environment[HOST_SESSION_VARIABLE];
  return typeof host === 'string' && host !== '' && host !== sessionId;
}

// The "merge N" approvals in one typed message: [{ pr, sha }].
function approvalsIn(prompt) {
  const text = String(prompt || '').slice(0, MAX_PROMPT_CHARS);
  const found = [];
  for (const match of text.matchAll(MERGE_WORDS)) {
    // A question or a "don't merge" is not an approval.
    const before = text.slice(Math.max(0, text.lastIndexOf('\n', match.index) + 1), match.index);
    const after = text.slice(match.index + match[0].length).split(/[.!\n]/)[0];
    if (NOT_APPROVAL.test(before) || after.includes('?')) continue;
    const numbers = [match[1], ...(match[2] || '').match(/\d+/g) || []].map(Number);
    const sha = numbers.length === 1 && match[3] ? match[3].toLowerCase() : null;
    for (const pr of numbers) found.push({ pr, sha });
  }
  return found;
}

function recordPrompt(input, { environment = process.env, registryOptions = {}, now } = {}) {
  const sessionId = input && typeof input.session_id === 'string' ? input.session_id : null;
  if (launched(sessionId, environment || {})) return 0;
  const found = approvalsIn(input && input.prompt);
  if (found.length === 0) return 0;
  const repository = repositoryOf(input && input.cwd);
  new MergeApprovals({ registryOptions, now }).add(found.map(entry => ({ ...entry, repository, session: sessionId })));
  return found.length;
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

function wordsOf(text) {
  return [...String(text).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3]);
}

// Every merge a shell command asks for: [{ repository, pr, sha, auto }]; pr is null when the
// command names no number Toolkit can read.
function shellMerges(text, cwd) {
  const merges = [];
  for (const match of text.matchAll(GH_PR_MERGE)) {
    const words = wordsOf(match[1]);
    const target = words.find((word, index) => !word.startsWith('-') && !VALUE_FLAGS.has(words[index - 1]));
    const url = target ? PR_URL.exec(target) : null;
    const pr = url ? Number(url[2]) : target && /^#?\d+$/.test(target) ? Number(target.replace('#', '')) : null;
    const repository = url ? url[1] : flagValue(words, ['--repo', '-R']) || repositoryOf(cwd);
    merges.push({ repository, pr, sha: flagValue(words, ['--match-head-commit']), auto: words.includes('--auto') });
  }
  for (const match of text.matchAll(GH_API)) {
    const rest = match[1];
    const pull = PULL_MERGE_PATH.exec(rest);
    if (pull) {
      const words = wordsOf(rest);
      const shaField = words.map((word, index) => (['-f', '-F', '--field', '--raw-field'].includes(words[index - 1]) ? word : null)).find(word => word && word.startsWith('sha='));
      merges.push({ repository: pull[1], pr: Number(pull[2]), sha: shaField ? shaField.slice(4) : null, auto: false });
    } else if (GRAPHQL_MERGE.test(rest)) merges.push({ repository: null, pr: null, sha: null, auto: false });
  }
  return merges;
}

function connectorMerge(tool, input) {
  const args = input && (input.tool_input || input.toolInput) || {};
  const auto = /enable_pr_auto_merge$/i.test(tool);
  const repository = typeof args.owner === 'string' && typeof args.repo === 'string' ? `${args.owner}/${args.repo}` : null;
  const pr = Number.isInteger(Number(args.pullNumber)) && args.pullNumber !== undefined ? Number(args.pullNumber) : null;
  return { repository, pr, sha: typeof args.expectedHeadSha === 'string' ? args.expectedHeadSha : null, auto, connector: true };
}

function deny(reason) { return { deny: `Toolkit: ${reason} ${ASK_TEXT}` }; }

// The refusal for one requested merge, or null with the approval it uses.
function judge(merge, approvals) {
  if (merge.pr === null) return { refusal: deny('this command merges a pull request Toolkit cannot identify, so it is refused. Name the pull request by number.') };
  const approval = approvals.find(merge.repository, merge.pr);
  const name = `pull request ${merge.repository ? `${merge.repository}#` : '#'}${merge.pr}`;
  if (!approval) return { refusal: deny(`the user has not typed "merge ${merge.pr}" for ${name} in the last day, so this merge is refused.`) };
  // A connector auto-merge call cannot name a commit; every other merge must.
  const needsSha = !(merge.connector && merge.auto);
  if (needsSha && !(typeof merge.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(merge.sha))) {
    return { refusal: { deny: `Toolkit: name the head commit the user approved, so a later push makes GitHub refuse the merge: add --match-head-commit <sha> (gh) or expectedHeadSha (connector) and retry.` } };
  }
  if (approval.sha && needsSha && !merge.sha.toLowerCase().startsWith(approval.sha) && !approval.sha.startsWith(merge.sha.toLowerCase())) {
    return { refusal: deny(`the user approved ${name} at ${approval.sha}, but this merge names ${merge.sha}, so it is refused.`) };
  }
  return { approval };
}

// The PreToolUse decision: { deny } or null.
function decide(input, { registryOptions = {}, now } = {}) {
  const tool = String(input && (input.tool_name || input.toolName) || '');
  let merges;
  if (CONNECTOR_MERGE.test(tool)) merges = [connectorMerge(tool, input)];
  else if (SHELL_TOOLS.test(tool)) {
    const args = input && (input.tool_input || input.toolInput) || {};
    const text = String(args.command || '');
    if (text.length > MAX_COMMAND_CHARS) return /\bmerge\b/i.test(text.slice(0, MAX_COMMAND_CHARS)) ? deny('this command is too long to check for a merge, so it is refused.') : null;
    if (STATE_WORDS.test(text)) return { deny: 'Toolkit: its user-state files (merge approvals and governance decisions) are changed only by Toolkit itself. Never act as the user.' };
    merges = shellMerges(text, input && input.cwd);
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

// Whether a tool call may be a merge, for the hooks' failure path (the module failed to load or threw).
function mayMerge(input) {
  const tool = String(input && (input.tool_name || input.toolName) || '');
  if (CONNECTOR_MERGE.test(tool)) return true;
  if (!SHELL_TOOLS.test(tool)) return false;
  const text = String((input.tool_input || input.toolInput || {}).command || '');
  return /\bgh\b[\s\S]*\bmerge\b/i.test(text) || GRAPHQL_MERGE.test(text) || STATE_WORDS.test(text);
}

const CHECK_FAILED = 'Toolkit: the merge check failed, so this merge is refused. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.';

module.exports = Object.freeze({
  APPROVALS_BASENAME, APPROVALS_SCHEMA, CHECK_FAILED, MAX_AGE_MS, MergeApprovals, MergeHoldError,
  approvalsIn, decide, mayMerge, recordPrompt, shellMerges,
});
