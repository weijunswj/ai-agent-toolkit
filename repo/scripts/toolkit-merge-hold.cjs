'use strict';

const STOP_PARSING = /(^|\s)--%(?=\s|$)/g;

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
// 62405eb". A line that is only one inline code span ("`merge 618`", the way hosts show a suggested
// reply) is read without its backticks. A line does not count when it has a quote (backticks
// anywhere else included), a question, or one of a fixed list of words
// for a no, a doubt, a condition, a delay, a report or another kind of merge ("don't", "not yet",
// "if CI is green", "later", "should we ...?", "merge main into 618", "merge conflicts in 618"),
// nor does any line inside a fenced code block (``` or ~~~).
// Plain text may put other prose on separate lines, including comparisons such as "Tests took < 2
// seconds" or non-tag entities such as "&lt; 2". An entity drops its own line as unclear; a stray
// angle bracket drops only its own line under the quote rule. Element tags (including unfinished
// tags), encoded tags, and embedded or malformed
// wakes refuse the whole plain prompt; keep approval lines free of host or agent frame markup.
// Other wording may still count, so the list leans towards not counting. Bare text is recorded only
// in a session the user started, not one another session or a Toolkit launcher started, and not a
// resumed or forked run (the governance gate's session marks). A whole Projects wake may instead
// supply one fresh human/principal trigger message, including in launched or resumed sessions. That
// exception is for the verified message only, still needs a session mark, and never changes standing
// auto-merge. Relays, citations, notes, notifications, attachments and malformed frames grant nothing.
// Delivery ids are hashed and remembered for a day; expired deliveries cannot rearm approval after
// their marker expires. No raw prompt text is stored. A valid explicit approval is kept at arrival
// even on the message that carries the governance question; governance is not answered by it.
// It is for the repository the session is in, or the one the message names; a bare number typed
// outside a GitHub repository records nothing.
//
// The owner's app-local standing answer instead of a typed approval: On, with an enabled
// governance binding merged on the default branch (read from this computer's cache, under a day
// old), a merge with no typed approval passes only in a session whose fresh startup recorded
// user-started origin. Claude reconnects keep standing on the same ID without an inherited
// host-session variable. Codex and unknown-host reconnects need a typed merge because they cannot
// distinguish a user reconnect from an agent resume. A resume carrying the variable revokes standing
// for this id, even after later starts without it. Repeated starts never raise origin or clear restrictions.
// Forks and unknown or automation origins have no standing; launcher and host-session checks must
// still pass. The merge must run in that repository's own folder, for that repository, as a plain
// merge commit pinned to the full 40
// character head SHA: `gh pr merge N --merge --match-head-commit <sha>`, or a connector merge tool
// call with merge_method "merge" and the head SHA field, and only when the merge-scope check
// (toolkit-auto-merge-eligible.cjs), run here on that head against this folder's copy of the
// remote's default branch, finds nothing on the merge-authority list. A head this computer does not
// have, or a scope it cannot read, needs a typed approval. --auto, --admin, --squash, --rebase,
// --delete-branch, the API endpoint, connector auto-merge and any other repository still need a typed
// approval. The other gate conditions (review, CI, testing) are the controller's to check before it
// merges; this hold cannot read them.
// `node repo/scripts/toolkit-merge-hold.cjs check` reports the standing checks through the hook's
// native session context. The hook stops that shell call after reporting; it writes nothing and
// consumes no approval. Outside a hook, the command has no native session context.
//
// Closure safety runs once in the final pass before any approval is consumed; the non-consuming
// pre-pass skips it. Origin, evidence and closure work share the host invocation deadline.
// Evidence-store merges instead use the existing standing custody permission, independently of
// task auto-merge and session origin. A fresh validated merged parent binding must name the exact
// separate store. Bounded authenticated metadata reads must show a private writable repository,
// its default branch as the bound branch and PR base, and the command's full head SHA. Only the
// plain merge-commit CLI and connector shapes above qualify, from the store's own folder or an
// explicitly named target from its parent. A name prefix or governance-off state grants nothing.
// A cloud session (CLAUDE_CODE_REMOTE=true) usually starts in the folder that holds the project's
// clones, so session start caches no parent binding: there, when no fresh cached binding names the
// store, the hold reads the clones' merged bindings on demand (the same bounded read session start
// uses), and an explicitly named store merge from that folder counts as from the parent when the
// parent's clone is one of its subfolders. A session working inside the store's own clone reads the
// clones beside it in that shared folder the same way.
//
// The merge card (Claude Code on this computer): a tap in place of the typed line. When a merge that
// names its repository, number and full head SHA is refused for want of an approval, in a session
// that could record a typed one, the refusal carries one exact AskUserQuestion input: "Merge
// owner/name#N at <7 characters>?" with the options Merge (its description names the full SHA) and
// Not now. cardAsked (PreToolUse) notes that exact call for the session's run; cardAnswered
// (PostToolUse) records an approval for that pull request at that full SHA when the answer the host
// reports is a plain Merge, and removes any unused approval for it when the answer is Not now.
// Nothing is refused for the card's sake: a card with other wording, options or keys, a card asked
// with an answer already filled in, a call that was not noted, a typed "Other" answer, an answer the
// host marks as idle, follow-up, free text or noted, any field the reader does not know, and a card
// in a launched, resumed or unmarked session all record nothing. Any exact card counts, whether or
// not a refusal came first: the user still taps and the SHA is pinned.
// Shell feeds: the host starts its tool hooks with its own environment, and only a session's shell
// commands carry TOOLKIT_HOST_SESSION, so a card event whose environment holds that variable at all
// (matching, different or empty) is a shell feed and is neither noted nor counted. The typed route
// cannot use this test, because a typed line may arrive where the variable matches. The tripwire
// below refuses two command-line shapes, read from the text alone (see the refused list). This is
// a tripwire, not a lock: any command or script that starts a hook script without the variable can
// still feed a card event in the user's own chat, as it can feed a typed line, so the card adds no
// route the typed line lacks.
// It prevents no new failure; the failure it must not cause is an approval the owner did not give,
// so it trusts only what the typed route already trusts (the session's start marks) plus the host's
// own report of the tap. Accepted gaps, where the host itself reports an answer nobody tapped:
//   - a permission answer that carries the answers: an SDK canUseTool callback, a PermissionRequest
//     hook (from any plugin or from the user's or a project's settings), a permission-prompt tool,
//     or a launcher's answer. These reach a
//     session a program started. Such a session counts as user-started only where the typed route
//     already has that limit: one launched from a Codex shell or from anywhere else without the
//     host-session variable. A PermissionRequest hook installed on this computer reaches every chat;
//   - a background session, where a reply sent by a connected client answers the open question;
//   - a host that auto-resolves the card without marking it (the marked idle path records nothing);
//   - any shell feed outside the two refused shapes: a wrapper before env (timeout, nice, nohup and
//     the like), other env option spellings (combined, after an option with an argument, long
//     prefixes, -C dir), the variable cleared another way (unset or Remove-Item by pattern, exec -c,
//     Start-Process -UseNewEnvironment), a node one-liner that starts the hook, a saved script, a
//     session whose shell export failed, and the wrapped feeds the typed route also lists.
// Never click a card through a UI or computer use. Codex has no card and keeps the typed line. This
// card records nothing in a cloud session; a Claude Projects thread uses its own posted decision card
// instead (cloudCard below, read by toolkit-projects-cloud.cjs).
//
// What one approval allows: one merge, of that pull request in that repository, within a day, by any
// session on this computer. A typed SHA pins the head commit; without one the merge must still name
// the head it expects, so a push after that read makes GitHub refuse it. Connector auto-merge cannot
// name one, so it is refused. The approval is used when
// the hook lets the call through, even if a later prompt or the merge itself fails.
//
// What is held (decide, PreToolUse), with line continuations joined first:
//   - needs an approval and the expected head commit: `gh pr merge` (any flags, --auto included),
//     `gh api` to a pull request's merge endpoint (found anywhere in the command), and any
//     connector's merge tool (an mcp__ tool named merge_pull_request, merge-pull-request or
//     mergePullRequest, whatever its server is called). Its call names the pull request with
//     repository_full_name or owner and repo, pr_number, pull_number, pullNumber,
//     pull_request_number or number, and the head commit with expected_head_sha or expectedHeadSha
//     (a sha field is not read); a call whose fields are missing, not readable or disagree is refused;
//   - refused when written directly: any connector's auto-merge tool, GraphQL merges (the number cannot be read), the merge queue, branch merges,
//     writes to the default branch's ref, `gh repo sync`, gh aliases that mention merge, a `git push`
//     to the remote's default branch, in the repository that -C, --git-dir or a GIT_DIR= prefix names;
//     a GIT_DIR set by an earlier segment (export, $env:, set, declare) is judged beside the folder's own (evidence stores excepted, by name; a refused push whose remote is an
//     evidence store bound on this computer shows the store-command message instead), a merge whose target is
//     moved by cd, pushd, Set-Location, Push-Location or GH_REPO, a push after a `cd -` whose folder this command cannot show, and a bare number in a folder with more than one
//     remote or a gh default repository other than its own, unless --repo or a URL names it. A push
//     run through another shell or expression runner (bash -c, pwsh -Command, cmd /c, eval) is
//     refused whatever branch it names; encoded PowerShell commands are refused unread;
//   - refused, as a tripwire against an agent approving for itself: a command that starts a Claude
//     or Codex session and mentions merge (branch upkeep wording aside: `git merge`, merge commits,
//     merge conflicts and merge-base; the approval reader skips, by the same definition, a line
//     whose only merge wording is upkeep, such as "git merge 5" or "update #5 with a merge commit";
//     that only ever removes a line), or that sets or clears TOOLKIT_HOST_SESSION (assignment,
//     unset, env -u, Remove-Item Env:\, export -n, declare +x, SetEnvironmentVariable, or an empty
//     environment on a host launch through env -i, --ignore-environment or a bare -), names
//     Toolkit's user-state folder or runs where it could reach it (ToolkitFolders: anything inside
//     user-state, anything in Toolkit's own folder but a closed set of plain commands, and a path that
//     could lead back up from deeper in it through `..`, a wildcard or a variable; also read with
//     quotes, escapes, `$'...'` and braces undone and line continuations joined as the shell joins
//     them), or the hook scripts together with what would feed them a prompt,
//     a SessionStart event, or a tool event (PreToolUse, PostToolUse or the card functions) when
//     any command in the text runs node, bun or deno and the word after it is not --test or test;
//     also text that names the hook scripts with a command that starts env whose leading words
//     (dash options or NAME=value) include -i, --ignore-environment or a bare - as its own word. Both read the whole text, so a search, diff
//     or commit message about the hooks in the same text as a node run, or after such an env, is
//     refused too; run it as a separate command.
//
// Not covered: a fresh `codex exec` launch from a running Codex shell still keeps standing as it
// did before, wrapped or nested host launches (bash -lc, timeout, Start-Process and the like),
// launch text the shell reshapes before the new session reads it (variables, substitutions or
// split quotes that spell merge wording, or turn upkeep wording into it, only after expansion),
// pushes wrapped in a program that is not a shell (timeout, Start-Process, xargs and the like), a
// prompt file fed to a hook script, other hook-feed wrappers or Node flags (including node -e
// loading toolkit-governance-gate.cjs, direct toolkit-codex-session-start.ps1, env FOO=1 node,
// timeout 5s node, bash -l -c, pwsh -c, cmd /c and node x.cjs<feed.json), racing session-mark writes without a lock, a startup forged
// for an unmarked or pruned id, and Claude reconnect launches outside the process tree (scheduled
// tasks or desktop wakes). Also a resume whose host-session variable was cleared indirectly
// (including unset -v, quoted unset, Remove-Item Env:/ and typeset +x; the listed direct forms
// are refused), a fully forged top-level Projects wake with the right labels,
// plain text containing an approval line, scripts or programs
// that call git or the GitHub API themselves, curl and other HTTP clients, a sha= field put in a
// comment or an echo on purpose, git and shell aliases,
// commands inside files, pushes through a second remote or a non-shell wrapper, GH_REPO set outside the command
// (an env file, a profile or a long-lived shell), direct commits to the default branch through the
// Contents API, GraphQL createCommitOnBranch or the connector's file-write tools (push_files,
// create_or_update_file; a repository rule that requires a pull request refuses these), cloud
// sessions (the governance hook skips them) and stale plugin copies.

const crypto = require('node:crypto');
const { currentReceipts, deliveryReceipt } = require('./toolkit-projects-delivery.cjs');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const gate = require('./toolkit-governance-gate.cjs');
const mergeScope = require('./toolkit-auto-merge-eligible.cjs');
const projectsCloud = require('./toolkit-projects-cloud.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const { validateRemoteIdentity, repositoryIdForCanonicalRemote } = require('./toolkit-repository-identity.cjs');
const { GitHubTransport, IssueClosureGuard } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { resolveExecutable } = require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs');

const APPROVALS_BASENAME = 'merge-approvals.v1.json';
const APPROVALS_SCHEMA = 'toolkit.merge-approvals.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVALS = 100;
const MAX_PROMPT_CHARS = 8000;
const MAX_COMMAND_CHARS = 1024 * 1024;

const { STORE_PUSH_MESSAGE, githubSlug, SHELLS, SHELL_TOOLS, ShellCall, MOVES_TARGET, connectorTarget, argvText, assignVariable, assignmentOf, absoluteShellPath, folderWord, plainGitLine, scriptCommands, scriptContext, wordText, stdinText, fileIsGenerated, ghCommand, shellCommands, shellOf, shellPath, shellReadings } = require('./toolkit-shell-call.cjs');
// A connector's merge or auto-merge tool, whatever its server is called (a claude.ai connector's
// server name is a UUID): the tool name ends in one of these after a _ or -.
const AUTO_MERGE_NAME = 'enable[_-]?(?:pr[_-]?|pull[_-]?request[_-]?)?auto[_-]?merge';
const CONNECTOR_MERGE = new RegExp(`^mcp__.+?[_-](?:merge[_-]?pull[_-]?request|${AUTO_MERGE_NAME})$`, 'i');
const CONNECTOR_AUTO_MERGE = new RegExp(`[_-]${AUTO_MERGE_NAME}$`, 'i');
// The fields a connector's merge tool names its target with. Official GitHub server: owner, repo,
// pullNumber, expectedHeadSha. Codex's GitHub app: repository_full_name, pr_number,
// expected_head_sha. Older servers use pull_number; a `sha` field is not read as the head, since
// no server is known to pass it on to GitHub (one that drops it would merge whatever head is there),
// so their merges are refused for want of a head commit.
const REPOSITORY_FIELDS = Object.freeze(['repository_full_name', 'owner', 'repo']);
const NUMBER_FIELDS = Object.freeze(['pr_number', 'pull_number', 'pullNumber', 'pull_request_number', 'number']);
const SHA_FIELDS = Object.freeze(['expected_head_sha', 'expectedHeadSha']);
// The head SHA field that goes with each number field, for the refusal's hint; a shape with none
// (pull_number) is told to use gh instead.
const SHA_FIELD_FOR = Object.freeze({ pr_number: 'expected_head_sha', pullNumber: 'expectedHeadSha' });
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
const DIGIT_SHA = /\bat\s+(\d{7,40})\b/gi;
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
// Toolkit's user-state files, and any setting or clearing of the session variable that tells a
// session another one started it. Searching for its bare name is fine; PowerShell variable and
// environment-provider references are refused too, including reads.
const STATE_WORDS = /merge-approvals|[\\/]\.ai-agent-toolkit[\\/]user-state\b|\bTOOLKIT_HOST_SESSION\s*=|(?:\bunset|-u|--unset(?:=|\s+)|\benv:\\?|\$env:|\bexport\s+-n\s+|\bdeclare\s+\+x\s+)\s*TOOLKIT_HOST_SESSION\b|\bSetEnvironmentVariable\s*\(\s*['"]TOOLKIT_HOST_SESSION['"]/i;
// The user-state folder named by path (STATE_WORDS) or reached through a folder change: the
// Toolkit folder and `user-state` anywhere in one command, read as two linear checks.
function stateWords(text) { return STATE_WORDS.test(text) || (/\.ai-agent-toolkit\b/i.test(text) && /\buser-state\b/i.test(text)); }

const STATE_FOLDER_MESSAGE = 'this command runs in Toolkit\'s own folder or its user-state folder and could reach Toolkit\'s user-state files (merge approvals, GitHub observations and pending proposals), which only Toolkit itself reads and changes. In Toolkit\'s own folder only listing, reading, changing folder, read-only git and running a script file with node are allowed, with no wildcards, variables, substitutions, quotes, escapes, redirections or `..`; nothing runs in the user-state folder. Run the command from another folder, and never act as the user.';
// What may run with Toolkit's own folder (the one that holds user-state) as its working folder.
const HOME_PROGRAMS = /^(?:ls|dir|gci|get-childitem|pwd|get-location|gl|echo|write-output|write-host|cat|type|get-content|gc|head|tail|test-path|stat|wc|cd|chdir|pushd|popd|set-location|sl|push-location|pop-location)$/i;
const HOME_GIT = /^(?:status|log|diff|show|rev-parse|remote|branch|describe|ls-files)$/;
const HOME_LISTING = /^(?:ls|dir|gci|get-childitem)$/i;
// A listing that walks into subfolders (ls -R, --recursive, PowerShell's -Recurse and -Depth, cmd's
// dir /s) reaches user-state, and in PowerShell can feed its files to Get-Content down a pipe.
const recursive = word => /^-[A-Za-z]*R[A-Za-z]*$/.test(word) || /^--recursive$|^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?(?::.*)?$|^-dep|^\/s$/i.test(word);
// Node options that run code from the command line or another file than the script.
const NODE_CODE = /^(?:-e|--eval|-p|--print|-r|--require|--import|--loader|--experimental-loader|--input-type)(?:=|$)/;
// Shell text the reader cannot follow safely: wildcards, braces, variables, substitutions, `..`.
const UNREADABLE_PATH = /[*?[\]{}$`%]|(?:^|[\\/=])\.\.(?:[\\/]|$)/;
const CLIMBS = /(?:^|[\\/=])\.\.(?:[\\/]|$)/;

// `folder` through its links (symlinks, junctions, 8.3 short names) as far as it exists, with the
// rest appended; the plain resolved path when no part of it can be read.
function realFolder(folder) {
  const rest = [];
  let head = path.resolve(folder);
  for (;;) {
    try { return path.join(fs.realpathSync.native(head), ...rest); } catch { /* not there: try its parent */ }
    const parent = path.dirname(head);
    if (parent === head) return path.resolve(folder);
    rest.unshift(path.basename(head));
    head = parent;
  }
}

// Whether `folder` is `base` or inside it (case-insensitively on Windows, as path.relative compares).
function within(folder, base) {
  const relative = path.relative(base, folder);
  return relative === '' || !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

// Toolkit's own folder and its user-state folder, resolved once from the same place the user-state
// module reads (so a test home works), each by its real path. It judges whether a shell command
// started in a folder could reach the user-state files: from inside user-state anything could; from
// Toolkit's own folder only a closed set of plain commands is read as safe (default-deny); deeper in
// Toolkit's folder only a word naming user-state or a `..` path back up to Toolkit's folder (or
// above it) could.
class ToolkitFolders {
  #home;
  #state;
  // Real paths already read for this command, by folder.
  #real = new Map();

  constructor(registryOptions = {}) {
    const state = governance.userStateDirectory(registryOptions);
    this.#state = realFolder(state);
    this.#home = realFolder(path.dirname(state));
  }

  // Whether `folder` is Toolkit's own folder or inside it.
  holds(folder) { return typeof folder === 'string' && within(realFolder(folder), this.#home); }

  // Whether one command segment's words, run in folder `root` (null: a folder this command cannot
  // show), could reach the user-state files. `raw` is the segment as written, quotes included, and
  // `shell` the shell reading it (null when the host does not say).
  reaches(words, root, raw = words.join(' '), shell = null) {
    if (words.length === 0) return false;
    const names = words.some(word => /\buser-state\b/i.test(word)) || /\buser-state\b/i.test(unescaped(raw));
    if (root === null) return names;
    if (!this.#real.has(root)) this.#real.set(root, realFolder(root));
    const here = this.#real.get(root);
    if (within(here, this.#state)) return true;
    if (!within(here, this.#home)) return false;
    if (names) return true;
    // In Toolkit's own folder quotes, escapes and redirections are unreadable too: they can spell a
    // name the words do not show, or write a file. A backslash is an escape only where the shell
    // makes it one (bash; a shell not named, except on Windows, where it is PowerShell's path
    // separator); the reading with escapes undone is judged as well.
    if (within(this.#home, here)) return (backslashEscapes(shell) ? /['"`\\<>]/ : /['"`<>]/).test(raw) || !homeCommand(words);
    return words.some(word => this.#climbs(word, here));
  }

  // A path word that could lead back up to Toolkit's own folder or above it, or into user-state:
  // read part by part from its literal start, with braces expanded, a wildcard taken as any name it
  // could match on the way to user-state, and an expansion ($x, ${...}, $(...), backticks, %x%) as any
  // text. A word starting with an expansion starts in an unknown folder, from which a later part that
  // could match `user-state` is enough. A plain word without `..` only goes deeper, so it is skipped.
  #climbs(word, here) {
    const values = word.includes('=') ? [word, word.slice(word.indexOf('=') + 1)] : [word];
    return values.some(value => {
      if (!CLIMBS.test(value) && !/[*?[\]{}$`%]/.test(value)) return false;
      const expanded = braceWords(value);
      return expanded === null || expanded.some(one => this.#walk(one, here));
    });
  }

  #walk(value, here) {
    const parts = value.replace(EXPANSION, '\0').split(/[\\/]/);
    const open = part => /[\0*?[\]]/.test(part);
    let first = parts.findIndex(open);
    if (first < 0) first = parts.length;
    let at = first === 0 && parts[0].includes('\0') ? null : realFolder(shellPath(here, parts.slice(0, first).join('/') || '.'));
    for (const part of parts.slice(at === null ? 1 : first)) {
      if (part === '' || part === '.') continue;
      if (at === null) { if (couldName(part, 'user-state')) return true; continue; }
      if (within(at, this.#state)) return true;
      if (part === '..') { at = realFolder(path.dirname(at)); continue; }
      if (!open(part)) { at = realFolder(path.join(at, part)); continue; }
      // A wildcard or expansion here could be the next folder on the way to user-state.
      const next = within(this.#state, at) ? path.relative(at, this.#state).split(path.sep)[0] : null;
      at = next !== null && couldName(part, next) ? realFolder(path.join(at, next)) : path.join(at, '\u0001');
    }
    return at !== null && (within(this.#home, at) || within(at, this.#state));
  }
}

// Expansions a path word can hold, read as any text: $name, ${...}, $(...), backticks, cmd's %name%.
const EXPANSION = /\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]|%[A-Za-z_][A-Za-z0-9_]*%/g;

// Whether a path part with wildcards (and \0 for an expansion) could be `name`.
function couldName(part, name) {
  const source = part.replace(/\[[^\]]*\]|[\0*?]|[^\0*?[]+|\[/g, piece => (piece === '\0' || piece === '*' ? '.*' : piece === '?' || (piece.startsWith('[') && piece.length > 1) ? '.' : piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'is' : 's').test(name);
}

// A word with bash's brace expansion done (`.{.,}` is `..` and `.`), or null when it makes more than
// 64 words. Braces after `$` are a parameter expansion, not a list.
function braceWords(word, limit = 64) {
  let words = [word];
  for (let pass = 0; pass < 32; pass += 1) {
    let changed = false;
    words = words.flatMap(one => {
      const list = braceList(one);
      if (list) changed = true;
      return list || [one];
    });
    if (words.length > limit) return null;
    if (!changed) return words;
  }
  return null;
}

function braceList(word) {
  for (let open = word.indexOf('{'); open >= 0; open = word.indexOf('{', open + 1)) {
    if (word[open - 1] === '$') continue;
    let depth = 0;
    const commas = [];
    for (let at = open; at < word.length; at += 1) {
      if (word[at] === '{') depth += 1;
      else if (word[at] === ',' && depth === 1) commas.push(at);
      else if (word[at] === '}' && --depth === 0) {
        if (!commas.length) break;
        const parts = [];
        let start = open + 1;
        for (const end of [...commas, at]) { parts.push(word.slice(start, end)); start = end + 1; }
        return parts.map(part => word.slice(0, open) + part + word.slice(at + 1));
      }
    }
  }
  return null;
}

// Whether a backslash escapes the next character in `shell`: in bash, and in a shell the host does
// not name except on Windows, where Codex runs PowerShell and a backslash separates folders.
function backslashEscapes(shell) { return shell === 'posix' || (shell !== 'powershell' && process.platform !== 'win32'); }

// Whether a segment is one of the plain commands allowed in Toolkit's own folder.
function homeCommand(words) {
  if (words.some(word => UNREADABLE_PATH.test(word))) return false;
  let at = 0;
  while (at < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at])) at += 1;
  const program = path.basename(words[at] || '').replace(/\.exe$/i, '');
  const rest = words.slice(at + 1);
  if (HOME_LISTING.test(program)) return !rest.some(recursive);
  if (HOME_PROGRAMS.test(program)) return true;
  if (/^git$/i.test(program)) {
    let index = 0;
    while (index < rest.length && rest[index].startsWith('-')) index += GIT_VALUE_OPTIONS.has(rest[index]) ? 2 : 1;
    // `git diff --no-index` compares plain folders, so it could read user-state.
    return HOME_GIT.test(rest[index] || '') && !rest.includes('--no-index');
  }
  if (/^node$/i.test(program)) {
    if (rest.some(word => NODE_CODE.test(word))) return false;
    return rest.some(word => !word.startsWith('-')) || (rest.length > 0 && rest.every(word => /^(?:-v|--version|-h|--help)$/.test(word)));
  }
  return false;
}
const PROMPT_HOOK_FEED = /toolkit-(?:merge-hold|governance-hook|codex-helper-hook)/i;
const HOOK_FEED = /toolkit-(?:merge-hold|governance-hook|codex-helper-hook|codex-session-start)/i;
const FEED_WORDS = /\brequire\b|\brecordPrompt\b|\bUserPromptSubmit\b|\bimport\b/;
// Tool-event words count only in a command that runs a script runtime (not its test runner), so a
// search, a diff or a commit message that names a hook script and an event is not a feed.
const TOOL_FEED_WORDS = /\bPreToolUse\b|\bPostToolUse\b|\bcardAsked\b|\bcardAnswered\b/;
const HOST_WORD = /^(?:claude|codex)(?:-code)?(?:\.exe|\.cmd|\.ps1)?$|claude-code|@openai\/codex/i;
// gh pr merge flags that take a value, so the value is not read as the pull request.
const VALUE_FLAGS = new Set(['--repo', '-R', '--match-head-commit', '--subject', '-t', '--body', '-b', '--body-file', '-F', '--author-email', '-A']);
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path']);

const MERGE_ROUTES = 'in a new chat on this computer, as a direct Projects message to the lane, or by the Merge button on GitHub';
const ASK_TEXT = `Ask the user to type, as plain text and not in quotes, a line with the word merge and the pull request number, such as merge owner/name#N, after reading the merge summary. Approval works here in a fresh eligible chat, ${MERGE_ROUTES}. A fully named target works from any folder; merge N needs that repository's folder. Typing in a reconnected or revoked chat records no approval. Never type it yourself, start a session or script to type it, or touch Toolkit's user-state files.`;

class MergeHoldError extends Error {
  constructor(code) { super(code); this.name = 'MergeHoldError'; this.code = code; }
}

// The user-typed approvals, kept in this computer's private operational state.
class MergeApprovals {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(governance.userStateDirectory(registryOptions), APPROVALS_BASENAME);
    this.#now = now;
  }

  // A store that cannot be read refuses every merge (fail closed); a damaged one counts as empty.
  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { approvals: [], deliveries: [] };
      throw new MergeHoldError('MERGE_APPROVALS_UNREADABLE');
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!parsed || parsed.schema !== APPROVALS_SCHEMA || !Array.isArray(parsed.approvals)) return { approvals: [], deliveries: [] };
    const oldest = this.#now().getTime() - MAX_AGE_MS;
    return {
      approvals: parsed.approvals.filter(entry => entry && Number.isInteger(entry.pr) && typeof entry.repository === 'string' && Date.parse(entry.at) >= oldest),
      // Older stores have no deliveries. Message bodies and raw ids are never kept here.
      deliveries: currentReceipts(Array.isArray(parsed.deliveries) ? parsed.deliveries : [], this.#now()),
    };
  }

  #write({ approvals, deliveries }) {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: APPROVALS_SCHEMA, approvals: approvals.slice(-MAX_APPROVALS), deliveries }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally { fs.rmSync(temp, { force: true }); }
  }

  add(entries, delivery = null) {
    if (entries.length === 0) return 0;
    const at = this.#now().toISOString();
    const state = this.#read();
    if (delivery) {
      // Expired messages cannot rearm approval after their replay marker ages out. At capacity,
      // refuse new deliveries rather than discard a live replay marker.
      const receipt = deliveryReceipt(delivery, state.deliveries, this.#now());
      if (!receipt) return 0;
      state.deliveries.push(receipt);
    }
    state.approvals.push(...entries.map(entry => ({ ...entry, at })));
    this.#write(state);
    return entries.length;
  }

  // The newest unused approval for exactly this repository ("owner/name", case-insensitive) and number.
  find(repository, pr) {
    if (typeof repository !== 'string') return null;
    const wanted = repository.toLowerCase();
    return this.#read().approvals.reverse().find(entry => entry.pr === pr && entry.repository.toLowerCase() === wanted) || null;
  }

  use(approval) {
    const state = this.#read();
    state.approvals = state.approvals.filter(entry => !(entry.pr === approval.pr && entry.at === approval.at && entry.repository === approval.repository));
    this.#write(state);
  }

  // Removes every unused approval for this repository and number; returns how many went.
  drop(repository, pr) {
    const wanted = String(repository).toLowerCase();
    const state = this.#read();
    const kept = state.approvals.filter(entry => !(entry.pr === pr && entry.repository.toLowerCase() === wanted));
    const dropped = state.approvals.length - kept.length;
    if (dropped > 0) this.#write({ ...state, approvals: kept });
    return dropped;
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

// Branch upkeep, not a pull request merge: the `git merge` command (a branch merged in locally),
// merge commits, merge conflicts and merge-base. A phrase never spans a line break (only spaces,
// tabs or one hyphen join its words), so reading a text whole or line by line sets the same
// phrases aside.
const UPKEEP_MERGE = /\bgit[ \t]+merge(?:-base)?\b|\bmerge[- ](?:commits?|conflicts?|base)\b/gi;
function withoutUpkeep(text) { return normalise(text).replace(UPKEEP_MERGE, ' '); }
// The one definition of "this text talks about merging" for the launch rule and the approval
// reader. The launch rule refuses a launch whose text has it. The reader reads every line exactly
// as it did before this definition existed and then drops a line that lacks it, so the definition
// can only take approvals away, never add one. Invariant: a launch the hold lets through carries
// no text the reader counts, because none of its lines has merge wording.
function mergeWording(text) { return /\bmerge\b/i.test(withoutUpkeep(text)); }
const PROMPT_LINES = /\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/;

// A fenced code block's opening or closing line (``` or ~~~, after any indent or list marker); a
// backtick fence never has a backtick after its run, so ```merge 618``` is a code span, not a fence.
const FENCE = /^(`{3,})[^`]*$|^(~{3,})/;
// A line that is one inline code span and nothing else: the same run of 1 to 3 backticks on each
// side and none inside.
const CODE_SPAN = /^(`{1,3})([^`]+)\1$/;

// The approvals in one typed message: [{ repository|null, pr, sha|null }].
function approvalsIn(prompt) {
  const found = [];
  // The fence that opened the code block the reading is in, or null. Lines inside one never count,
  // so pasted output in a fence carries no approval; one left open runs to the end of the message.
  let fence = null;
  const whole = normalise(prompt);
  // Each line as typed, before the length limit cuts the text: the upkeep test below reads these,
  // so a cut can never turn upkeep wording ("merge commit", "merged") into the bare word.
  const typed = whole.split(PROMPT_LINES);
  for (let [index, raw] of whole.slice(0, MAX_PROMPT_CHARS).split(PROMPT_LINES).entries()) {
    let line = raw;
    for (let strip = 0; strip < 5 && LIST_MARKER.test(line); strip += 1) line = line.replace(LIST_MARKER, '');
    // A fence is looked for under every list marker, however many.
    let fenceText = line;
    for (let strip = 0; strip < MAX_APPROVAL_LINE && LIST_MARKER.test(fenceText); strip += 1) fenceText = fenceText.replace(LIST_MARKER, '');
    // Zero-width characters do not hide a fence.
    fenceText = fenceText.replace(/[\u200b-\u200d\u2060]/g, '').trim();
    if (fence) {
      // Closed only by a line of the same fence character, at least as long.
      if (fenceText.length >= fence.length && fenceText === fence[0].repeat(fenceText.length)) fence = null;
      continue;
    }
    const marker = FENCE.exec(fenceText);
    if (marker) { fence = marker[1] || marker[2]; continue; }
    // Entities left after the Projects reader's single decoding pass are unclear. In particular,
    // the #38 in &#38; must never become a pull request. Other lines still count.
    if (/&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i.test(raw)) continue;
    // More nested markers than that make the line unclear.
    if (LIST_MARKER.test(line)) continue;
    line = line.trim();
    // A line that is only a code span ("`merge 618`", the way hosts show a suggested reply) is read
    // once without its backticks, and every rule below still applies to what is inside.
    const span = CODE_SPAN.exec(line);
    if (span) {
      const at = raw.lastIndexOf(line);
      raw = `${raw.slice(0, at)}${span[2]}${raw.slice(at + line.length)}`;
      line = span[2].trim();
    }
    // Words in a link or a repository name ("ai-agent-toolkit") are not read as hold words. A link
    // reads as a number, so "merge <link> green" is held like "merge 618 green", but not as a
    // time, so "at <link>" is not a delay.
    // Hold words are read on the whole line, list marker included, so "17:00 merge 618" is a delay.
    const words = raw.replace(APPROVAL_LINK, ' x0 ').replace(SLUG_NAME, ' ');
    // A line whose only merge wording is branch upkeep is not an approval. This is one more reason
    // to skip a line, tested where the other reasons are, so fences, hold words, the quote rule
    // and the targets all read the line as typed and nothing that was held before counts now.
    if (line.length > MAX_APPROVAL_LINE || !/\bmerge\b/i.test(words) || !mergeWording(typed[index]) || HOLD_WORDS.test(words) || QUESTION.test(line) || QUOTED.test(raw.trim()) || QUOTED.test(line)) continue;
    const items = [...line.matchAll(APPROVAL_URL)].map(match => ({ repository: match[1], pr: Number(match[2]) }));
    let rest = line.replace(APPROVAL_URL, ' # ');
    // Repository identifiers may contain dates, digits and SHA-like words. Remove the complete
    // named targets before looking for separately typed head pins or unexplained long numbers.
    for (const match of rest.matchAll(NAMED)) items.push({ repository: match[1] || null, pr: Number(match[2]) });
    rest = rest.replace(NAMED, ' # ');
    const shas = [...rest.matchAll(APPROVAL_SHA)].map(match => match[0].toLowerCase());
    rest = rest.replace(APPROVAL_SHA, ' ');
    // A short SHA can be all digits ("at 7384901"); right after "at" it is read as one, since a pull
    // request number has at most six digits. Anywhere else such a number still makes the line unclear.
    for (const match of rest.matchAll(DIGIT_SHA)) shas.push(match[1]);
    rest = rest.replace(DIGIT_SHA, ' ');
    // A longer bare number is neither a pull request nor a SHA, so the line is unclear.
    if (/\d{7,}/.test(rest) || shas.length > 1) continue;
    const bare = rest;
    for (const match of bare.matchAll(AFTER_MERGE)) for (const number of match[1].match(/\d+/g)) items.push({ repository: null, pr: Number(number) });
    for (const match of bare.matchAll(BEFORE_MERGE)) items.push({ repository: null, pr: Number(match[1]) });
    const sha = items.length === 1 ? shas[0] || null : null;
    for (const item of items) found.push({ ...item, sha });
  }
  return found;
}

function sessionChecks(sessionId, environment, registryOptions, now, nativeHost = null) {
  const host = environment[gate.HOST_SESSION_VARIABLE];
  const epochs = new gate.SessionEpochs({ registryOptions, now });
  return {
    nativeSessionContext: typeof sessionId === 'string' && sessionId !== '',
    sessionMarked: epochs.get(sessionId) !== null,
    launcherMarker: gate.LAUNCHER_MARKERS.some(name => typeof environment[name] === 'string' && environment[name] !== ''),
    hostSessionMatches: !(typeof host === 'string' && host !== '' && host !== sessionId),
    resumed: epochs.resumed(sessionId),
    resumeHostSessionPresent: epochs.resumeHostSessionPresent(sessionId),
    resumedFromSessionShell: epochs.resumedFromSessionShell(sessionId),
    resumeNeedsTypedMerge: epochs.resumeNeedsTypedMerge(sessionId) || (epochs.resumed(sessionId) && gate.normaliseHost(nativeHost) !== 'claude-code'),
    userStartedOrigin: epochs.origin(sessionId) === 'user-started',
    forked: epochs.forked(sessionId),
  };
}

// Bare prompt approvals keep the original fresh-run rule. Only standing merges use recorded
// origin to accept a resume; neither Projects delivery nor prompt text can establish origin.
function startedByUser(checks, standing = false) {
  return checks.sessionMarked && !checks.launcherMarker && checks.hostSessionMatches
    && (standing ? checks.userStartedOrigin && !checks.forked && !checks.resumedFromSessionShell && !checks.resumeNeedsTypedMerge : !checks.resumed);
}

// Keeps the approvals a typed message carries; returns how many were kept.
function recordPrompt(input, { environment = process.env, registryOptions = {}, now } = {}) {
  // A Projects merge card tap (toolkit-projects-cloud.cjs) counts like a typed `merge N at <sha>`
  // from the same thread, once, under the same session-mark rule as a wrapped typed message.
  const tap = projectsCloud.mergeCardTap(input && input.prompt);
  if (tap) {
    const sessionId = input && typeof input.session_id === 'string' ? input.session_id : null;
    if (!new gate.SessionEpochs({ registryOptions, now }).get(sessionId)) return 0;
    return new MergeApprovals({ registryOptions, now }).add([{ repository: tap.repository, pr: tap.pr, sha: tap.sha, session: sessionId }], { id: tap.id, sentAt: tap.sentAt });
  }
  const message = gate.ownerMessage(input && input.prompt);
  if (message.wrapped ? !message.approvalEligible : message.markup || gate.hasFrameMarkup(message.text)) return 0;
  const found = approvalsIn(message.text);
  if (found.length === 0) return 0;
  const sessionId = input && typeof input.session_id === 'string' ? input.session_id : null;
  // A direct Projects human trigger attests this message only. The standing-answer route still
  // requires recorded user origin and all standing checks. Even an attested message needs this host's session-start mark.
  if (message.wrapped) {
    if (!new gate.SessionEpochs({ registryOptions, now }).get(sessionId)) return 0;
  } else if (!startedByUser(sessionChecks(sessionId, environment || {}, registryOptions, now))) return 0;
  const here = repositoryOf(input && input.cwd);
  const entries = found.map(entry => ({ repository: entry.repository || here, pr: entry.pr, sha: entry.sha, session: sessionId }))
    .filter(entry => typeof entry.repository === 'string');
  return new MergeApprovals({ registryOptions, now }).add(entries, message.wrapped ? message : null);
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

// { gitDir, common } for a repository's git folder `dotGit` (a folder, or a file pointing at one),
// common being a worktree's shared folder; null when it cannot be read.
function gitDirsAt(dotGit) {
  let gitDir = dotGit;
  try {
    if (fs.statSync(dotGit).isFile()) {
      const line = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (!line) return null;
      gitDir = path.resolve(path.dirname(dotGit), line[1].trim());
    }
  } catch { return null; }
  let common = gitDir;
  try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { /* not a worktree */ }
  return { gitDir, common };
}

function gitDirs(root) { return gitDirsAt(path.join(root, '.git')); }

function hasRef(common, ref) {
  if (fs.existsSync(path.join(common, ...ref.split('/')))) return true;
  try { return fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n').some(line => line.endsWith(` ${ref}`)); } catch { return false; }
}

// { default, current, store } for a push from `cwd` to `remote`, or null outside a repository. A store
// is an evidence store: by its remote's name (TRANSPORT-*), or, for a push to origin, a repository the
// governance state names one (rule S1). `gitDir` (from --git-dir or GIT_DIR) names the repository's
// git folder itself, in place of the one `cwd` is in.
function pushTarget(cwd, remote, registryOptions = {}, gitDir = null) {
  let root = null;
  let dirs;
  if (gitDir) {
    dirs = gitDirsAt(gitDir);
    if (dirs && path.basename(dirs.common) === '.git') root = path.dirname(dirs.common);
  } else {
    try { root = governance.findGitRoot(cwd); } catch { root = null; }
    if (!root) return null;
    dirs = gitDirs(root);
  }
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
  const named = /TRANSPORT-[^/\s]*?(?:\.git)?\/?$/i.test(String(url || ''));
  return { default: defaultBranch, current, url, store: named || (remoteName === 'origin' && root !== null && evidenceStoreAt(root, registryOptions)) };
}

// Whether the governance state names the repository at `root` an evidence store (rule S1). A state
// that cannot be read is not one.
function evidenceStoreAt(root, registryOptions = {}) {
  try { return governance.governanceState(root, registryOptions).rule === 'S1'; } catch { return false; }
}

// Whether a remote URL is an evidence store an enabled binding cached on this computer names, at
// any freshness (the attribution guard's reading). A cache that cannot be read names none.
function boundStore(url, registryOptions = {}) {
  const slug = githubSlug(url);
  if (!slug) return false;
  try { return governance.evidenceStoreRepositories(registryOptions).stores.has(slug); } catch { return false; }
}

const UNKNOWN_FOLDER_PUSH = 'this command pushes after `cd -`, `Set-Location -` or `pushd +N`/`-N` returns to a folder Toolkit cannot see from this command alone, so it is refused. Name the folder with `cd <path>` or `git -C <path>` and retry.';

// What a cd, chdir, pushd, Set-Location, sl or Push-Location segment moves to: { word } for a
// folder, { back: true } for `-` (also after `--` or as -Path's value, and `+` outside bash,
// PowerShell's step forward), { unknown: true } for pushd's stack rotation (`+N`, `-N`), or
// { none: true } when it names no folder. Switches such as -PassThru, -L or cmd's /d are skipped
// wherever they stand; -StackName skips its value; -Path, -LiteralPath and -PSPath (also as
// -Path:value) take theirs, and only -Path reads `-` as a step back (-LiteralPath is literal).
const LOCATION_PATH = /^-(?:path|literalpath|lp|pspath)$/i;
const LOCATION_VALUE = /^-st(?:a(?:c(?:k(?:n(?:a(?:m(?:e)?)?)?)?)?)?)?$/i;
function locationTarget(words, shell) {
  const pushd = /^pushd$/i.test(words[0]);
  const named = (option, value) => (value === '-' && !/^-(?:literalpath|lp)$/i.test(option) ? { back: true } : { word: value });
  for (let at = 1; at < words.length; at += 1) {
    const word = words[at];
    if (word === '--') return at + 1 < words.length ? (words[at + 1] === '-' ? { back: true } : { word: words[at + 1] }) : { none: true };
    if (word === '-' || (word === '+' && shell !== 'posix' && !pushd)) return { back: true };
    if (pushd && /^[+-]\d+$/.test(word)) return { unknown: true };
    const inline = /^(-(?:path|literalpath|lp|pspath)):(.+)$/is.exec(word);
    if (inline) return named(inline[1], inline[2]);
    if (LOCATION_PATH.test(word)) return at + 1 < words.length ? named(word, words[at + 1]) : { none: true };
    if (LOCATION_VALUE.test(word)) { at += 1; continue; }
    if (/^-[A-Za-z@]/.test(word) || /^\/d$/i.test(word)) continue;
    return { word };
  }
  return { none: true };
}

const PUSH_VALUE_OPTIONS = new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option', '--signed']);

// The refusal for a git push in one segment, or ''. `variables` holds what earlier segments of the
// same command assigned (assignmentOf), and `gitDir` a GIT_DIR an earlier segment set (gitDirSetting).
// A GIT_DIR= prefix, --git-dir <path> or --git-dir=<path> names the repository's git folder itself,
// so the push is judged against that repository, not the one the folder is in.
function pushRefusal(words, cwd, { registryOptions = {}, variables = new Map(), shell = null, gitDir = null } = {}) {
  let index = 0;
  let root = cwd;
  let named = gitDir;
  // A prefix in another letter case reaches git only where names ignore case (Windows), so it is
  // judged beside the repository git would otherwise use, never in its place.
  const also = [];
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
    if (/^GIT_DIR=/.test(words[index])) named = unquoted(words[index].slice(8));
    else if (/^GIT_DIR=/i.test(words[index])) also.push(unquoted(words[index].slice(8)));
    index += 1;
  }
  if (!/^git(?:\.exe)?$/i.test(path.basename(words[index] || ''))) return '';
  index += 1;
  while (index < words.length && words[index].startsWith('-')) {
    const option = words[index];
    if (option === '-C' && index + 1 < words.length) {
      const folder = folderWord(words[index + 1], variables, shell);
      root = root === null && !absoluteShellPath(folder) ? null : shellPath(root || process.cwd(), folder);
    } else if (option === '--git-dir' && index + 1 < words.length) named = words[index + 1];
    else if (option.startsWith('--git-dir=')) named = unquoted(option.slice(10));
    index += GIT_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  if (words[index] !== 'push') return '';
  // git reads a relative git folder from the folder it ends up in after every -C.
  for (const value of [named, ...also]) {
    const folder = value ? folderWord(value, variables, shell) : '';
    if (root === null && !(folder && absoluteShellPath(folder))) return UNKNOWN_FOLDER_PUSH;
    const reason = defaultPushRefusal(words.slice(index + 1), root, folder ? shellPath(root || process.cwd(), folder) : null, registryOptions);
    if (reason) return reason;
  }
  return '';
}

// The refusal for push arguments `args` run from folder `root`, or in the git folder `repository`
// when one is named, or ''.
function defaultPushRefusal(args, root, repository, registryOptions) {
  const positional = [];
  let mirror = false;
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at];
    if (word === '--all' || word === '--mirror' || word === '--branches') mirror = true;
    if (PUSH_VALUE_OPTIONS.has(word)) { at += 1; continue; }
    if (!word.startsWith('-')) positional.push(word);
  }
  const remote = positional[0] || 'origin';
  const target = pushTarget(root, remote, registryOptions, repository);
  if (!target || target.store || !target.default) return '';
  const refspecs = positional.slice(1);
  const branchOf = (name) => {
    const plain = name.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    return plain === 'HEAD' || plain === '@' ? target.current : plain;
  };
  const hitsDefault = mirror
    || (refspecs.length === 0 && target.current === target.default)
    || refspecs.some(spec => branchOf(spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec) === target.default);
  if (!hitsDefault) return '';
  // A push to an evidence store this computer has bound stays refused, but with the store-command
  // message: a pull request is the wrong advice for a store, whose default branch is written
  // directly by toolkit-store.cjs under standing permission.
  if (boundStore(target.url, registryOptions)) return STORE_PUSH_MESSAGE;
  return `this command pushes to the default branch \`${target.default}\`. Changes must reach the default branch through a pull request the user merges; push to another branch and open one.`;
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
    merges.push({ repository: named || here(), pr, sha: flagValue(words, ['--match-head-commit']), auto: words.includes('--auto'), explicit: Boolean(named), kind: 'gh', flags: words.filter(word => word.startsWith('-')) });
  }
  // Searched across the whole command, so a quoted value with a newline, ; & or | before it does
  // not hide the path. With more than one, no sha= field is trusted.
  if (/\bgh(?:\.exe)?\s+api\b/i.test(text)) {
    const pulls = [...text.matchAll(new RegExp(PULL_MERGE_PATH.source, 'g'))];
    const shas = [...text.matchAll(/(?:^|\s)(?:-f|-F|--field|--raw-field)(?:\s+|=)["']?sha=([0-9a-f]{7,40})\b/gi)].map(match => match[1]);
    for (const pull of pulls) {
      const placeholder = /^(?:\{owner\}|:owner)$/.test(pull[1]) || /^(?:\{repo\}|:repo)$/.test(pull[2]);
      merges.push({ repository: placeholder ? here() : `${pull[1]}/${pull[2]}`, pr: Number(pull[3]), sha: pulls.length === 1 && shas.length === 1 ? shas[0] : null, auto: false, explicit: !placeholder, kind: 'api' });
    }
  }
  return merges;
}

// What a connector's merge tool call names, read from its arguments by field name, default deny:
// { repository, pr, sha, badSha, auto, connector, explicit, fields, unclear, shaField, unreadSha }. A field that is
// given but has no usable value leaves its part null; two fields for the same part that disagree
// set `unclear` to that part ('pull request', 'repository' or 'head commit'). `fields` lists the
// known fields the call gave, for refusal text (names only, never values).
function connectorMergeArgs(tool, args) {
  const given = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const has = name => Object.prototype.hasOwnProperty.call(given, name) && given[name] !== undefined;
  const fields = [...REPOSITORY_FIELDS, ...NUMBER_FIELDS, ...SHA_FIELDS, 'sha'].filter(has);
  let unclear = null;
  const disagree = part => { unclear = unclear || part; };

  const { repository, pr, unclear: targetUnclear } = connectorTarget(given);
  if (targetUnclear) disagree(targetUnclear);

  // The head commit: 7 to 40 hex; every SHA field given must agree.
  const shas = SHA_FIELDS.filter(has).map(field => (typeof given[field] === 'string' && /^[0-9a-f]{7,40}$/i.test(given[field]) ? given[field].toLowerCase() : null));
  let sha = shas.length > 0 && shas.every(value => value !== null) ? shas[0] : null;
  // A sha field is never the pin, but one that names another commit makes the call unclear.
  const other = typeof given.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(given.sha) ? given.sha.toLowerCase() : null;
  if (sha !== null && (shas.some(value => value !== sha) || (other !== null && other !== sha))) { disagree('head commit'); sha = null; }
  const badSha = shas.some(value => value === null);

  const numberField = NUMBER_FIELDS.find(has);
  const shaField = numberField === 'pull_number' ? null : SHA_FIELD_FOR[numberField] || (has('repository_full_name') ? 'expected_head_sha' : 'expected_head_sha or expectedHeadSha');
  const method = ['merge_method', 'mergeMethod'].filter(has).map(field => given[field]);
  return { repository, pr, sha, badSha, auto: CONNECTOR_AUTO_MERGE.test(tool), connector: true, explicit: true, fields, unclear, shaField, unreadSha: has('sha'), method: method.length > 0 && method.every(value => value === 'merge') ? 'merge' : null };
}

function connectorMerge(tool, input) {
  return connectorMergeArgs(tool, input && (input.tool_input || input.toolInput));
}

// "found a, b and c", or "found none of the fields Toolkit reads".
function foundText(fields) {
  if (fields.length === 0) return 'found none of the fields Toolkit reads';
  return `found ${fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}`}`;
}

// "has a, b and c", for the missing head SHA refusal.
function hasText(fields) { return foundText(fields).replace(/^found /, 'has '); }

// The refusal for a connector merge whose target cannot be read, or null.
function connectorRefusal(merge) {
  const found = foundText(merge.fields);
  if (merge.unclear) return refuse(`this merge tool call names more than one ${merge.unclear} (${found}, and they disagree), so it is unclear and refused. Give each once.`);
  if (merge.pr === null) {
    const numbers = NUMBER_FIELDS.filter(field => merge.fields.includes(field));
    const why = numbers.length === 0 ? 'no pull request number field' : numbers.length === 1 ? `${numbers[0]} is not a positive whole number` : `${numbers.join(' and ')} must each be a positive whole number`;
    return refuse(`this merge tool call names a pull request Toolkit cannot identify (${found}; ${why}), so it is refused. Retry with the pull request's number.`);
  }
  if (typeof merge.repository !== 'string') {
    return refuse(`Toolkit cannot tell which repository this merge tool call for pull request #${merge.pr} is in (${found}; it needs repository_full_name as owner/name, or owner and repo), so it is refused.`);
  }
  if (merge.badSha) return refuse(`this merge tool call names a head commit Toolkit cannot read (${found}; a head SHA is 7 to 40 hex characters), so it is refused.`);
  return null;
}

function deny(reason) { return { deny: `Toolkit: ${reason} ${ASK_TEXT}` }; }
function refuse(reason) { return { deny: `Toolkit: ${reason}` }; }

// gh pr merge flags a standing-answer merge may carry: the merge commit, the head pin and the
// repository. Anything else (--auto, --admin, --squash, --rebase, --delete-branch, a subject or body)
// needs a typed approval.
const STANDING_FLAGS = /^(?:--merge|-m|--match-head-commit(?:=.*)?|--repo(?:=.*)?|-R)$/;

// Why a merge with no typed approval does not fit the owner's standing answer, or '' when it does.
function standingProblem(merge, standing) {
  if (typeof merge.repository !== 'string' || merge.repository.toLowerCase() !== standing.repository.toLowerCase()) return `is for another repository than this folder's (${standing.repository})`;
  if (!(typeof merge.sha === 'string' && /^[0-9a-f]{40}$/i.test(merge.sha))) return 'does not name the full 40 character head SHA it expects';
  if (merge.connector) {
    if (merge.auto) return 'uses connector auto-merge, which cannot be pinned';
    if (merge.method !== 'merge') return 'does not set merge_method to "merge"';
    return '';
  }
  if (merge.kind !== 'gh') return 'uses the API merge endpoint';
  if (!merge.flags.some(flag => flag === '--merge' || flag === '-m')) return 'does not ask for a merge commit with --merge';
  const other = merge.flags.filter(flag => !STANDING_FLAGS.test(flag));
  if (other.length > 0) return `adds ${other.join(', ')}`;
  return '';
}

// ---- merge card -------------------------------------------------------------------------------

const CARD_TOOL = 'AskUserQuestion';
const CARD_HEADER = 'Merge';
const CARD_KEYS = Object.freeze(['questions', 'metadata']);
// After the tap the host hands back what it asked plus what it collected.
const CARD_ANSWERED_KEYS = Object.freeze([...CARD_KEYS, 'answers', 'annotations']);
const CARD_RESPONSE_KEYS = Object.freeze(['questions', 'answers', 'annotations']);
const CARD_QUESTION = new RegExp(`^Merge (${SLUG})#([1-9]\\d{0,5}) at ([0-9a-f]{7})\\?$`);
const CARD_MERGE = /^Merge it at commit ([0-9a-f]{40})\. Nothing else is approved\.$/;
const CARD_NOT_NOW = 'Leave it open. Nothing is merged.';
const CARD_LABELS = Object.freeze(['Merge', 'Not now']);
const CARD_UNCOUNTED = `Toolkit: no merge approval was recorded from that card. It counts only as Toolkit's exact merge card, in a chat the user started, answered by the user's own plain tap on Merge with no note, typed text or follow-up. ${ASK_TEXT}`;

// The one AskUserQuestion input that is the merge card for a pull request at a full head SHA.
function mergeCard(repository, pr, sha) {
  return { questions: [{ question: `Merge ${repository}#${pr} at ${sha.slice(0, 7)}?`, header: CARD_HEADER, multiSelect: false, options: [
    { label: CARD_LABELS[0], description: `Merge it at commit ${sha}. Nothing else is approved.` },
    { label: CARD_LABELS[1], description: CARD_NOT_NOW },
  ] }] };
}

function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

// What an exact merge card asks, { repository, pr, sha, question }, or null for anything else: other
// keys, more questions, other options or wording, or a short and a full SHA that disagree. The
// host's own `kind: "choice"` on the question is the only addition read as the same card. As asked
// (PreToolUse) an answers field is another key; `answered` reads the input the host hands back
// after the tap, which also carries answers and annotations.
function cardOf(toolInput, answered = false) {
  if (!plainObject(toolInput)) return null;
  if (Object.keys(toolInput).some(key => !(answered ? CARD_ANSWERED_KEYS : CARD_KEYS).includes(key))) return null;
  const questions = toolInput.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return null;
  const [question] = questions;
  if (!plainObject(question) || typeof question.question !== 'string' || question.question.length > MAX_APPROVAL_LINE) return null;
  if (Object.keys(question).some(key => !['question', 'header', 'multiSelect', 'options', 'kind'].includes(key))) return null;
  if (question.header !== CARD_HEADER || (question.multiSelect !== undefined && question.multiSelect !== false)) return null;
  if (Object.hasOwn(question, 'kind') && question.kind !== 'choice') return null;
  const asked = CARD_QUESTION.exec(question.question);
  const options = question.options;
  if (!asked || !Array.isArray(options) || options.length !== 2) return null;
  if (!options.every((option, index) => plainObject(option)
    && Object.keys(option).every(key => ['label', 'description'].includes(key)) && option.label === CARD_LABELS[index] && typeof option.description === 'string')) return null;
  const full = CARD_MERGE.exec(options[0].description);
  if (!full || options[1].description !== CARD_NOT_NOW || !full[1].startsWith(asked[3])) return null;
  return { repository: asked[1], pr: Number(asked[2]), sha: full[1], question: question.question };
}

// What a card's note must say for its answer to count: this card, for this pull request and SHA.
function cardMark(card) { return `merge-card ${card.repository.toLowerCase()}#${card.pr} ${card.sha}`; }

// Whether this run of the session may take an approval the way a typed line does. A card event
// also needs an environment with no host-session variable at all: the host's own hook process has
// none, and a command run from a session's shell has one.
function cardSession(input, environment, registryOptions, now) {
  const sessionId = input && typeof input.session_id === 'string' ? input.session_id : null;
  if ((environment || {})[gate.HOST_SESSION_VARIABLE] !== undefined) return null;
  // A cloud session runs this hold too, but its taps go through the Projects merge card, never this one.
  if ((environment || {}).CLAUDE_CODE_REMOTE === 'true') return null;
  if (!startedByUser(sessionChecks(sessionId, environment || {}, registryOptions, now))) return null;
  const mark = new gate.SessionEpochs({ registryOptions, now }).get(sessionId);
  return mark === null ? null : { sessionId, mark };
}

// PreToolUse: notes an exact merge card shown by a session that may take an approval, so the answer
// that comes back is known to come from that call. Decides nothing and refuses nothing.
function cardAsked(input, { environment = process.env, registryOptions = {}, now } = {}) {
  if (String(input && input.tool_name || '') !== CARD_TOOL) return false;
  const card = cardOf(input.tool_input);
  const session = card && cardSession(input, environment, registryOptions, now);
  if (!session) return false;
  try {
    new gate.PickerNotes({ registryOptions, now }).note(input.tool_use_id, { session_id: session.sessionId, session: session.mark, repository: cardMark(card) });
    return true;
  } catch { return false; }
}

// The one label the host reports for the card, or null. Default-deny: every field must be one the
// reader knows, the answers must hold this question alone, and annotations must be empty.
function cardLabel(holder, card, keys) {
  if (!plainObject(holder) || Object.keys(holder).some(key => !keys.includes(key))) return null;
  if (Object.hasOwn(holder, 'annotations') && !(plainObject(holder.annotations) && Object.keys(holder.annotations).length === 0)) return null;
  const answers = holder.answers;
  if (!plainObject(answers) || Object.keys(answers).length !== 1 || !Object.hasOwn(answers, card.question)) return null;
  return CARD_LABELS.includes(answers[card.question]) ? answers[card.question] : null;
}

// PostToolUse: the card's answer. null when the call was not a merge card; else { context } for
// the agent, after recording the approval (Merge) or removing unused ones (Not now).
function cardAnswered(input, { environment = process.env, registryOptions = {}, now } = {}) {
  if (String(input && input.tool_name || '') !== CARD_TOOL) return null;
  // A cloud session says nothing here: its merge approvals come from the Projects merge card.
  if ((environment || {}).CLAUDE_CODE_REMOTE === 'true') return null;
  const response = plainObject(input.tool_response) ? input.tool_response : {};
  const questions = Array.isArray(response.questions) ? response.questions : [];
  if (!questions.some(question => question && typeof question.question === 'string' && question.question.length <= MAX_APPROVAL_LINE && CARD_QUESTION.test(question.question))) return null;
  // Taken whatever follows, so one note answers one call.
  const noted = new gate.PickerNotes({ registryOptions, now }).take(input.tool_use_id);
  // The card shown must still be exactly Toolkit's: changed options make the tap mean something else.
  const shown = cardOf({ questions });
  // Where the host also hands back the input, that must be the same exact card, and any answer it
  // carries must be the one the host reports.
  const asked = input.tool_input === undefined ? shown : cardOf(input.tool_input, true);
  const card = shown && asked && cardMark(shown) === cardMark(asked) ? shown : null;
  const session = card && cardSession(input, environment, registryOptions, now);
  let label = card ? cardLabel(response, card, CARD_RESPONSE_KEYS) : null;
  if (label !== null && plainObject(input.tool_input) && (Object.hasOwn(input.tool_input, 'answers') || Object.hasOwn(input.tool_input, 'annotations'))
    && cardLabel(input.tool_input, card, CARD_ANSWERED_KEYS) !== label) label = null;
  // Not now withdraws whatever else the answer carries: it only ever removes.
  if (label === null && card && plainObject(response.answers) && response.answers[card.question] === CARD_LABELS[1]) label = CARD_LABELS[1];
  if (!session || noted === null || noted.session_id !== session.sessionId || noted.session !== session.mark || noted.repository !== cardMark(card) || label === null) return { context: CARD_UNCOUNTED };
  const name = `${card.repository}#${card.pr}`;
  const approvals = new MergeApprovals({ registryOptions, now });
  if (label === CARD_LABELS[1]) {
    approvals.drop(card.repository, card.pr);
    return { context: `Toolkit: the user tapped Not now for ${name}, so no merge approval is recorded and any unused one for it is removed. Do not merge it, and do not show the card again for this commit unless the user asks.` };
  }
  approvals.add([{ repository: card.repository, pr: card.pr, sha: card.sha, session: session.sessionId, card: true }]);
  return { context: `Toolkit recorded the user's tap on Merge as one approval for ${name} at ${card.sha}. Run the same merge again, naming that head commit. A new head needs a new card.` };
}

// The merge card offer added to a refusal that asks for the user's approval, when this session
// could record one and the merge names everything the card needs; '' otherwise.
function cardOffer(merge, input, { environment, registryOptions, now, host }) {
  if (host !== 'claude' || !merge || merge.pr === null || typeof merge.repository !== 'string' || !new RegExp(`^${SLUG}$`).test(merge.repository)) return '';
  if (!cardSession(input, environment, registryOptions, now)) return '';
  if (!(typeof merge.sha === 'string' && /^[0-9a-f]{40}$/i.test(merge.sha))) return ' To offer the user a tap card instead of typing, retry this merge naming its full 40 character head SHA.';
  return ` In this chat the user may tap instead of typing: after the merge summary, call ${CARD_TOOL} once with exactly this input, adding no answers field, and retry this merge only after Toolkit says the tap was recorded: ${JSON.stringify(mergeCard(merge.repository, merge.pr, merge.sha.toLowerCase()))}`;
}

// The refusal for one requested merge, or the approval it uses. `standing` is the owner's standing
// answer evaluation for this folder's repository, including a safe reason when unavailable.
function judge(merge, approvals, standing = null, evidence = null) {
  const unreadable = merge.connector ? connectorRefusal(merge) : null;
  if (unreadable) return { refusal: unreadable };
  if (merge.pr === null) return { refusal: deny('this command merges a pull request Toolkit cannot identify, so it is refused. Name the pull request by number.') };
  if (typeof merge.repository !== 'string') return { refusal: deny(`Toolkit cannot tell which repository pull request #${merge.pr} is in, so the merge is refused. Name it with --repo owner/name or a pull request URL.`) };
  const name = `${merge.repository}#${merge.pr}`;
  const approval = approvals.find(merge.repository, merge.pr);
  if (!approval) {
    const verified = evidence?.check(merge);
    if (verified?.eligible) return { evidence: true };
    if (verified?.recovery) return { refusal: refuse(`Evidence-store verification failed: ${verified.reason}. ${verified.recovery}`) };
    const evidenceReason = verified?.reason ? ` Evidence-store verification failed: ${verified.reason}.` : '';
    if (!standing?.eligible) return { refusal: { deny: `Toolkit has no unused approval recorded for ${name} from the last day, so this merge is refused. Standing task auto-merge is unavailable: ${standingReason(standing?.reason)}.${evidenceReason} ${ASK_TEXT}` } };
    const problem = standingProblem(merge, standing);
    if (problem) return { refusal: deny(`task auto-merge is on for ${standing.repository}, but this merge of ${name} ${problem}, so it needs the user's typed approval. A merge without one must be exactly \`gh pr merge ${merge.pr} --merge --match-head-commit <full head sha>\` from this repository's folder, or the connector's merge tool with merge_method "merge" and its head SHA field, once the gate rules' task auto-merge conditions hold.`) };
    const scope = standing.scope(merge.sha);
    if (!scope) return { refusal: deny(`task auto-merge is on for ${standing.repository}, but Toolkit cannot read the changes of ${name} at ${merge.sha} on this computer (fetch the pull request's head and the default branch first), so its merge scope is unknown and it waits for the user's typed merge.`) };
    if (!scope.eligible) return { refusal: deny(`${name} changes the merge rules (${scope.reasons.map(entry => `${entry.path}: ${entry.why}`).join('; ')}), so it waits for the user's typed merge whatever the task auto-merge answer says.`) };
    return { standing: true };
  }
  // Connector auto-merge cannot name a head commit, so it is refused; gh can.
  if (merge.connector && merge.auto) {
    return { refusal: refuse(`the connector's auto-merge cannot name the head commit it expects, so it is refused. After the user approves, use \`gh pr merge ${merge.pr} --auto --match-head-commit <sha>\` or the connector's merge tool with its head SHA field.`) };
  }
  if (!(typeof merge.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(merge.sha))) {
    const approved = approval.sha ? ` The user approved ${approval.sha}.` : '';
    if (merge.connector) {
      // A sha field is not read: a server that drops it would merge whatever head is there.
      const unread = merge.unreadSha ? ' (its sha field is not read, since not every server passes it to GitHub)' : '';
      const next = merge.shaField ? `Add ${merge.shaField} and retry.` : `This tool has no head SHA field Toolkit reads, so use \`gh pr merge ${merge.pr} --match-head-commit <sha>\` instead.`;
      return { refusal: refuse(`name the head commit this merge expects, so GitHub refuses it if the branch moves: this merge tool call ${hasText(merge.fields)} but no head SHA field${unread}. ${next}${approved}`) };
    }
    return { refusal: refuse(`name the head commit this merge expects, so GitHub refuses it if the branch moves: add --match-head-commit <sha> (gh) or sha= (API) and retry.${approved}`) };
  }
  if (approval.sha && !merge.sha.toLowerCase().startsWith(approval.sha) && !approval.sha.startsWith(merge.sha.toLowerCase())) {
    return { refusal: deny(`the user approved ${name} at ${approval.sha}, but this merge names ${merge.sha}, so it is refused.`) };
  }
  return { approval };
}

// A refusal for a shell command that could make an approval without the user, or merges outside
// what an approval can allow; '' when there is none.
function shellRefusal(text, cwd, registryOptions = {}, shell = null) {
  if (stateWords(text) || stateWords(unescaped(text))) return refuse('Toolkit\'s user-state files (merge approvals, GitHub observations and pending proposals) and its session variable must be read and changed only by Toolkit itself. Never act as the user.');
  if (clearedHostEnvironment(text)) return refuse('starting another coding-agent session with an empty environment hides the running session, so this launch is refused.');
  // Search arguments and test files are not hook invocations. Read the common command wrappers
  // and Node's harmless warning flag; Codex's start script writes a mark without any event flag.
  const sessionStartFeed = hookStartFeed(text);
  if (HOOK_FEED.test(text) && clearedEnvironment(text)) return refuse('merge authority must come from the user, so a command that names Toolkit\'s hook scripts and starts with an empty environment is refused.');
  if (HOOK_FEED.test(text) && ((PROMPT_HOOK_FEED.test(text) && (FEED_WORDS.test(text) || (TOOL_FEED_WORDS.test(text) && runsScript(text)))) || sessionStartFeed)) return refuse('merge authority must come from the user, so commands that load Toolkit\'s hook scripts or feed them a prompt, tool or session-start event are refused.');
  const parts = segments(text);
  for (const words of parts) {
    let index = 0;
    while (index < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]) || /^(?:env|npx|bunx|pnpm|dlx|exec|nohup|start)$/i.test(words[index]) || (words[index].startsWith('-') && index > 0))) index += 1;
    if (words.slice(0, index + 1).some(word => HOST_WORD.test(path.basename(word))) && mergeWording(text)) {
      return refuse('a session an agent starts must not approve a merge, so starting another coding-agent session with a command that mentions merging is refused. Ask the user.');
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
  // Every refused push is named, each reason once: a command that pushes both a default branch and
  // a bound store gets the pull request advice and the store-command message.
  const reasons = [];
  // The command is walked as written and again with its quotes and escapes undone (unescaped), so
  // `'user'-state`, `user\-state` or `.\.` cannot hide a folder or a name from either reading. Pushes
  // are judged in the reading as written only: a backslash is a path separator on Windows, so the
  // undone reading would move a quoted `C:\...` folder somewhere else and judge the push there.
  const folders = new ToolkitFolders(registryOptions);
  const undone = [...new Set(shell === 'powershell' ? [unescaped(text, 'powershell')] : shell === 'posix' ? [unescaped(text)] : [unescaped(text), unescaped(text, 'powershell')])].filter(reading => reading !== text);
  for (const [reading, pushes] of [[text, true], ...undone.map(reading => [reading, false])]) {
    const refusal = walkFolders(reading, cwd, { registryOptions, shell, folders, reasons, pushes });
    if (refusal) return refusal;
  }
  return reasons.length ? refuse(reasons.join(' Also: ')) : '';
}

// The text with quotes and escapes undone as `shell` reads it. Bash decodes `$'...'` (ANSI-C) strings,
// drops backslash escapes, quotes and backticks, and expands braces, so `"user"-state`, `user\-state`,
// `.\.`, `$'user\x2dstate'` and `.{.,}` read plainly. PowerShell keeps backslashes (a folder
// separator there) and drops its backtick escapes and quotes.
function unescaped(text, shell = 'posix') {
  const value = String(text);
  if (shell === 'powershell') return value.replace(/`(.)/gs, '$1').replace(/['"]/g, '');
  const plain = value.replace(/\$'((?:[^'\\]|\\.)*)'/gs, (_, body) => ansiC(body)).replace(/\$"/g, '"').replace(/\\(.)/gs, '$1').replace(/['"`]/g, '');
  return plain.split(/(\s+)/).map(part => (/\s/.test(part) ? part : (braceWords(part) || [part]).join(' '))).join('');
}

// The text of a bash `$'...'` string.
function ansiC(body) {
  const named = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  return body.replace(/\\(?:x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8})|([0-7]{1,3})|c(.)|(.))/gs, (_, hex, u4, u8, octal, control, other) => {
    const code = hex ? parseInt(hex, 16) : u4 ? parseInt(u4, 16) : u8 ? parseInt(u8, 16) : octal ? parseInt(octal, 8) : control ? control.charCodeAt(0) & 31 : null;
    if (code !== null) return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    return named[other] ?? other;
  });
}

// Walks one reading of a command segment by segment, tracking the folders it could be in, and returns
// a refusal for a segment that could reach Toolkit's user-state files; with `pushes`, push refusals
// go to `reasons`.
function walkFolders(text, cwd, { registryOptions, shell, folders, reasons, pushes }) {
  const variables = new Map();
  const parts = segments(text);
  const raws = rawSegments(text);
  // The folders the command could be in at each point: usually one, more after a `cd -` whose
  // target depends on the shell, and null for a folder Toolkit cannot see from this command alone
  // (a push judged there is refused). pushd and Push-Location save the folders they leave; popd and
  // Pop-Location go back to the last one saved. With none saved here the shell's own stack is
  // unknown: a real shell stays put on an empty stack, so the folder is left where it is (never reset
  // to the starting folder).
  let roots = [cwd || process.cwd()];
  // `cd -` in bash goes to OLDPWD, the folder before the last move (unknown before the first one).
  // PowerShell's `Set-Location -` (and `+`) walks a history that steps further back on each repeat,
  // so there it may be any folder this command has been in, and an unknown one once the steps back
  // outnumber the moves. A reading whose shell is not known takes both.
  let previous = null;
  const visited = [...roots];
  let moves = 0;
  let backs = 0;
  const saved = [];
  const move = next => { previous = roots; roots = [...new Set(next)]; visited.push(...roots); moves += 1; };
  // Every folder the command could be in is judged for Toolkit's user-state files (ToolkitFolders).
  // A line break other than LF (a lone CR, NEL, LS or PS) may end a command in one shell and not in
  // another, so the segments here may not be the ones that run: none runs in Toolkit's folder.
  const oddBreaks = /\r(?!\n)|[\u0085\u2028\u2029]/.test(text);
  // The GIT_DIR values a push could run with. The folder's own repository (null) always stays: a
  // setting may never reach git (bash's `set`, `declare` without -x, a name in another case, a later
  // unset), so a GIT_DIR an earlier segment sets only adds a repository to judge (gitDirSetting).
  let gitDirValues = [null];
  for (const [at, words] of parts.entries()) {
    if (roots.some(root => folders.reaches(words, root, raws[at], shell) || (oddBreaks && root !== null && folders.holds(root)))) return refuse(STATE_FOLDER_MESSAGE);
    const setting = gitDirSetting(words);
    if (setting) gitDirValues = [...new Set([...gitDirValues, setting])];
    const assigned = assignmentOf(words);
    if (assigned) { assignVariable(variables, assigned); continue; }
    if (/^(?:popd|pop-location)$/i.test(words[0])) { if (saved.length) move(saved.pop()); continue; }
    if (/^(?:cd|pushd|chdir|set-location|sl|push-location)$/i.test(words[0])) {
      const target = locationTarget(words, shell);
      if (/^(?:pushd|push-location)$/i.test(words[0])) saved.push(roots);
      if (target.none) {
        // No folder named: bash's cd goes home and its pushd swaps the top two saved folders (from a
        // stack this command may not show, so unknown). PowerShell 7's Set-Location also goes home,
        // Windows PowerShell's and cmd's stay put, and Push-Location saves the folder and stays; a
        // reading whose shell is not bash takes both.
        const home = roots.map(root => shellPath(root || process.cwd(), '~'));
        if (/^pushd$/i.test(words[0])) move([null]);
        else if (/^(?:cd|chdir|set-location|sl)$/i.test(words[0])) move(shell === 'posix' ? home : [...roots, ...home]);
        continue;
      }
      if (target.unknown) move([null]);
      else if (target.back) {
        backs += 1;
        const bash = previous || [null];
        const history = backs <= moves ? visited : [...visited, null];
        const back = shell === 'posix' ? bash : shell === 'powershell' ? history : [...bash, ...history];
        moves -= 1;
        move(back);
      } else {
        const word = folderWord(target.word, variables, shell);
        move(roots.map(root => (root === null && !absoluteShellPath(word) ? null : shellPath(root || process.cwd(), word))));
      }
      continue;
    }
    for (const root of pushes ? roots : []) {
      for (const gitDir of gitDirValues) {
        const reason = pushRefusal(words, root, { registryOptions, variables, shell, gitDir });
        if (reason && !reasons.includes(reason)) reasons.push(reason);
      }
    }
  }
  return '';
}

// The raw text of each segment segments() reads, in the same order.
function rawSegments(text) {
  return String(text).split(/\r?\n|;|&&|\|\||\||&/).filter(part => wordsOf(part).length > 0);
}

// A GIT_DIR value a segment may set for the commands after it, or null: export, declare, typeset,
// cmd's set, PowerShell's $env:GIT_DIR, or a plain GIT_DIR=value, in any letter case. Each only
// adds a repository to judge, since some never reach git.
function gitDirSetting(words) {
  const [first = '', ...rest] = words;
  // `$env:GIT_DIR = x`, `$env:GIT_DIR=x`, `$env:GIT_DIR= x` and `$env:GIT_DIR =x`.
  const power = /^\$env:GIT_DIR(=.*)?$/is.exec(first);
  if (power) {
    const after = power[1] ? [power[1].slice(1), ...rest] : rest[0] === '=' ? rest.slice(1) : rest[0]?.startsWith('=') ? [rest[0].slice(1)] : [];
    return unquoted(after.find(Boolean) || '') || null;
  }
  if (/^(?:export|declare|typeset|set)$/i.test(first)) {
    const word = rest.find(item => /^GIT_DIR=/i.test(item));
    return word && word.length > 8 ? unquoted(word.slice(8)) : null;
  }
  return words.length === 1 && /^GIT_DIR=./i.test(first) ? unquoted(first.slice(8)) : null;
}

// A value with the quotes around it removed (`'x'` and `"x"` read as x).
function unquoted(value) { return String(value).replace(/^(['"])(.*)\1$/s, '$2'); }

// Read command position with shell quoting intact: an env launch inside a message is just text.
// Reuse the host-launch pattern and common wrappers above, within this command only.
// Whether any command in the text starts env with an emptied environment (-i, --ignore-environment
// or a bare -), and, when `host` is set, goes on to start Claude or Codex.
function clearedEnvironment(text, host = false) {
  return shellCommands(text).some(({ words }) => {
    let index = words[0] === '&' ? 1 : 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
    if (!/^env$/i.test(path.basename(words[index] || ''))) return false;
    let cleared = false;
    index += 1;
    while (index < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]) || words[index].startsWith('-') || /^(?:npx|bunx|pnpm|dlx|exec|nohup|start)$/i.test(words[index]))) {
      if (['-i', '--ignore-environment', '-'].includes(words[index])) cleared = true;
      index += 1;
    }
    return cleared && (!host || HOST_WORD.test(path.basename(words[index] || '')));
  });
}

function clearedHostEnvironment(text) { return clearedEnvironment(text, true); }

// Whether a command in the text runs a script runtime (node, bun or deno) other than its test runner.
function runsScript(text) {
  return shellCommands(text).some(({ words }) => words.some((word, index) => {
    if (!/^(?:node|node\.exe|bun|bun\.exe|deno|deno\.exe)$/i.test(path.basename(word))) return false;
    let next = index + 1;
    while (words[next] === '--no-warnings') next += 1;
    return !['--test', 'test'].includes(words[next]);
  }));
}

function hookStartFeed(text, depth = 0) {
  if (depth > 3) return false;
  return shellCommands(text).some(({ words }) => {
    let index = words[0] === '&' ? 1 : 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
    if (words[index] === 'env') index += 1;
    if (words[index] === 'timeout' && /^\d+$/.test(words[index + 1] || '')) index += 2;
    const command = path.basename(words[index] || '').toLowerCase();
    if (['bash', 'sh'].includes(command) && /^-[lc]+$/.test(words[index + 1] || '')) return hookStartFeed(words[index + 2] || '', depth + 1);
    if (!/^(?:node|node\.exe)$/.test(command)) return false;
    index += 1;
    while (words[index] === '--no-warnings') index += 1;
    const script = path.basename(words[index] || '');
    return /^toolkit-codex-session-start\.cjs$/i.test(script)
      || (/^toolkit-(?:governance-hook|codex-helper-hook|merge-hold)\.cjs$/i.test(script) && words.slice(index + 1).includes('SessionStart'));
  });
}

// Ignore runner names in quoted prose, but keep whole quoted runner paths and executable
// substitutions, including those inside double quotes. This is not command-position detection.
// Option readers retain quoted argument words too; shellCommands keeps prose as one word.
function runnerText(text, quotedArguments = false) {
  const parts = [];
  const frames = [{ end: '', depth: 0, quote: '', start: 0, visible: [] }];
  for (let index = 0; index < text.length; index += 1) {
    const frame = frames[frames.length - 1];
    const visible = frame.visible;
    const char = text[index];
    const next = text[index + 1];
    if (frame.quote === "'") {
      if (char === "'") {
        if (next === "'") index += 1;
        else {
          if (quotedArguments || SHELLS.test(text.slice(frame.start, index))) visible.push(text.slice(frame.start - 1, index + 1));
          frame.quote = '';
        }
      }
      continue;
    }
    if (char === '\\' && next && (frame.quote ? '"\\$`'.includes(next) : /[\s"'\\$`]/.test(next))) {
      if (!frame.quote) visible.push(char, next);
      index += 1;
      continue;
    }
    if (char === '$' && next === '(') {
      visible.push(' ');
      frames.push({ end: ')', depth: 0, quote: '', start: 0, visible: [] });
      index += 1;
      continue;
    }
    if (char === '`') {
      if (frame.end === '`' && !frame.quote) {
        frames.pop();
        parts.push(visible.join(''));
        continue;
      }
      if (text.indexOf('`', index + 1) !== -1) {
        frames.push({ end: '`', depth: 0, quote: '', start: 0, visible: [] });
        visible.push(' ');
        continue;
      }
    }
    if (frame.quote === '"') {
      if (char === '"') {
        if (quotedArguments || SHELLS.test(text.slice(frame.start, index))) visible.push(text.slice(frame.start - 1, index + 1));
        frame.quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      frame.quote = char;
      frame.start = index + 1;
      visible.push(' ');
    } else if (frame.end === ')' && char === ')' && frame.depth === 0) {
      frames.pop();
      parts.push(visible.join(''));
    } else {
      if (char === '(') frame.depth += 1;
      else if (char === ')') frame.depth -= 1;
      visible.push(char);
    }
  }
  // A substitution's options belong to its own command; keep the outer command intact.
  return [...parts, ...frames.map(frame => frame.visible.join(''))].join('; ');
}

function mentionsRunner(text) {
  return /\b(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|eval|iex|invoke-expression)(?:\.exe)?\b/i.test(runnerText(text));
}

function encodedPowerShell(text) {
  // Keep each quoted argument as one shell word: prose is not a runner word, while a
  // quoted encoded option after a real runner is still an option PowerShell reads.
  for (const { words } of shellCommands(runnerText(text, true))) {
    const start = words.findIndex(word => /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(word));
    if (start < 0) continue;
    for (const word of words.slice(start + 1)) {
      // After -Command or -File, options belong to the script, not to PowerShell itself.
      if (/^-(?:c|co|com|comm|comma|comman|command|f|fi|fil|file)$/i.test(word)) break;
      // PowerShell accepts every prefix of -EncodedCommand from -e onward, plus -ec.
      if (/^-[a-z]+$/i.test(word) && ('encodedcommand'.startsWith(word.slice(1).toLowerCase()) || /^-ec$/i.test(word))) return true;
    }
  }
  // A runner's quoted script is executable text. Read it with the same quoting rule,
  // rather than treating every quoted argument or commit message as another script.
  for (const { words } of shellCommands(text)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!SHELLS.test(words[index])) continue;
      const program = words[index].split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
      const args = words.slice(index);
      const expression = /^(?:eval|iex|invoke-expression)$/.test(program);
      // The shared argument-list reader recognises POSIX option bundles ending in c.
      // Here c can also precede other flags, as in bash -ce.
      const normalized = /^(?:bash|sh|zsh|dash|ksh)$/.test(program)
        ? args.map(word => /^-[a-z]*c[a-z]*$/i.test(word) ? '-c' : word) : args;
      const script = expression ? args.slice(1).join(' ') : argvText(normalized);
      if (!expression && script === normalized.join(' ')) continue;
      if (script.length < text.length && encodedPowerShell(script)) return true;
    }
  }
  return false;
}

// A non-plain line mentioning a runner outside quoted prose and a git push is refused as a family.
// Plain git commands keep the default-branch check; encoded PowerShell stays unread.
function nestedRefusal(text) {
  if (plainGitLine(text)) return '';
  const message = 'this command could run a git push through another shell (bash, pwsh, cmd or eval), so Toolkit cannot read where it pushes and refused it. Run the push as its own plain git command.';
  if (encodedPowerShell(text)) return refuse(message);
  // cmd also spells its script's first word /cgit or /kgit, without a separating space.
  const mentionsPush = /(?:\b|\/[ck])git\b/i.test(text) && /\bpush\b/i.test(text);
  return mentionsPush && mentionsRunner(text) ? refuse(message) : '';
}

// The owner's standing answer for the repository of folder `cwd`: { repository, scope } when the
// repository's merged binding switches task auto-merge on, the app is a known one and the user
// started this session;
// otherwise a structured failure. `scope(head)` is the merge-scope verdict against this folder's copy of
// the remote's default branch, or null when git cannot read it.
function standingAnswer(input, cwd, { environment = process.env, registryOptions = {}, now, host = null } = {}) {
  const repository = typeof cwd === 'string' && cwd ? repositoryOf(cwd) : null;
  let root;
  try { root = repository ? governance.findGitRoot(cwd) : null; } catch { root = null; }
  const answer = root ? governance.taskAutoMerge(root, { ...registryOptions, host, ...(now ? { now } : {}) }) : null;
  const sessionId = input && typeof input.session_id === 'string' ? input.session_id : null;
  // A Claude Projects cloud thread reads the same repository switch. Its project line can only force
  // Off (toolkit-projects-cloud.cjs), and the one named merge thread stands in for a session the
  // owner started (gate rules, Task auto-merge), so no origin check applies.
  const cloud = Boolean(environment) && environment.CLAUDE_CODE_REMOTE === 'true';
  let forcedOff = false;
  if (cloud) { try { forcedOff = new projectsCloud.ProjectsSwitch({ directory: governance.userStateDirectory(registryOptions), now }).forcedOff(sessionId); } catch { forcedOff = true; } }
  const checks = {
    repositoryValid: Boolean(repository && root),
    knownHost: governance.normaliseHost(host) !== null,
    autoMergeOn: answer?.auto_merge === 'after-gates' && !forcedOff,
    bindingFresh: answer?.fresh === true,
    ...sessionChecks(sessionId, environment || {}, registryOptions, now, host),
  };
  const reason = !checks.nativeSessionContext ? 'no-native-session-context'
    : !checks.repositoryValid ? 'no-repository'
    : !checks.bindingFresh ? 'binding-not-fresh'
    : !checks.autoMergeOn ? 'auto-merge-off'
    : !checks.knownHost ? 'unknown-host'
    : !checks.sessionMarked ? 'no-session-mark'
    : checks.launcherMarker ? 'launcher-marker'
    : !checks.hostSessionMatches ? 'host-session-mismatch'
    : checks.resumedFromSessionShell ? 'resume-from-session-shell'
    : checks.forked ? 'fork'
    : checks.resumeNeedsTypedMerge ? 'resume-needs-typed-merge'
    : cloud ? null
    : !startedByUser(checks, true) ? (checks.resumed ? 'resumed-without-user-started-origin' : 'user-started-origin-required') : null;
  if (reason) return { eligible: false, reason, checks };
  const scope = head => {
    const branch = pushTarget(root, 'origin', registryOptions)?.default;
    const base = branch ? mergeScope.commitOf(root, `refs/remotes/origin/${branch}`) : null;
    return base ? mergeScope.eligibilityOf(root, base, head) : null;
  };
  return { eligible: true, reason: null, checks, repository, scope };
}

function standingReason(reason) {
  return {
    'no-native-session-context': "this terminal has no native session context; run the check in the session with Toolkit's hook",
    'no-repository': 'this folder has no usable GitHub repository',
    'unknown-host': 'this app is not one Toolkit knows, so it never merges on a standing answer',
    'auto-merge-off': "this repository's merged governance binding does not set task_prs.auto_merge to after-gates (refresh governance shows or changes it), or, in a Claude Projects thread, the project line `- Task auto-merge: Off` (or unclear or unread project instructions) forces it Off",
    'binding-not-fresh': 'the enabled merged governance binding is missing, invalid or not fresh',
    'no-session-mark': 'this session has no readable session-start mark',
    'launcher-marker': 'a Toolkit launcher marker is present',
    'host-session-mismatch': 'the host session does not match this session',
    'resume-from-session-shell': `a resume carried the host-session variable from a running session, so standing authority is revoked for this session; approve ${MERGE_ROUTES}; typing in this revoked chat records no approval`,
    'fork': 'this session is a fork',
    'resume-needs-typed-merge': `Codex and unknown-host reconnects need a typed merge because they have no reliable signal to distinguish a user reconnect from an agent resume; approve ${MERGE_ROUTES}; typing in this reconnected chat records no approval`,
    'resumed-without-user-started-origin': 'this resumed session has no recorded user-started origin',
    'user-started-origin-required': 'this session has no recorded user-started origin',
  }[reason] || 'the standing answer is unavailable';
}

// Standing evidence custody comes from a fresh merged parent binding, never a store's name or
// governance-off state. This call owns its read budget and metadata; nothing is persisted. Claude
// checks twice (before and after governance), with at most four seconds of evidence I/O per pass,
// capped by the shared invocation deadline. Successful reads
// are reused only between those two passes in the same hook invocation; local guards run again.
class EvidenceStoreMerges {
  constructor(cwd, { registryOptions = {}, now, environment = process.env, readEvidenceGitHub, refreshEvidenceBinding, evidenceResponses = new Map(), deadline } = {}) {
    this.cwd = cwd;
    this.registryOptions = registryOptions;
    this.now = now || (() => new Date());
    this.environment = environment;
    this.read = readEvidenceGitHub;
    this.shared = deadline ?? Infinity;
    this.deadline = Math.min(this.shared, globalThis.performance.now() + 4000);
    this.responses = evidenceResponses;
    this.cloud = Boolean(environment) && environment.CLAUDE_CODE_REMOTE === 'true';
    this.refreshBinding = refreshEvidenceBinding || ((folder, budget) => governance.refreshMergedBinding(folder, this.registryOptions, { ...budget, environment: this.environment }));
  }

  // Cloud only: the GitHub repositories this session can read a parent binding from, as
  // [{ folder, slug }]. The session folder's own repository, or, when the session folder is not
  // inside a repository (a cloud container clones each project repository into its own subfolder),
  // up to eight of its immediate subfolders. When the session folder is inside the store's own clone
  // (a thread archiving evidence works there), the clones beside it in the same shared folder, with
  // the same cap. The store itself is never a candidate.
  cloudCandidates(target) {
    if (!this.cloud || !this.cwd) return [];
    const own = repositoryOf(this.cwd);
    if (!own) return this.clonesIn(this.cwd, target);
    if (own.toLowerCase() !== target) return [{ folder: this.cwd, slug: own.toLowerCase(), child: false }];
    let root;
    try { root = governance.findGitRoot(this.cwd); } catch { root = null; }
    return root ? this.clonesIn(path.dirname(root), target).filter(entry => path.resolve(entry.folder) !== path.resolve(root)) : [];
  }

  // Up to eight immediate subfolders of `folder` that are real git clones (not symlinks or
  // worktrees) of a GitHub repository other than `target`.
  clonesIn(folder, target) {
    let names;
    try { names = fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort().slice(0, 8); } catch { return []; }
    return names.map(name => path.join(folder, name))
      .filter(clone => { try { return fs.lstatSync(path.join(clone, '.git')).isDirectory(); } catch { return false; } })
      .map(clone => ({ folder: clone, slug: (repositoryOf(clone) || '').toLowerCase(), child: true }))
      .filter(entry => entry.slug && entry.slug !== target);
  }

  // A cloud container starts with no cached parent binding: its session-start refresh reads only
  // the folder the session starts in, which is usually not a repository. When no fresh cached
  // binding names this store, read the candidates' merged bindings now, with the same bounded git
  // read session start and `toolkit governance status` use, then let the usual checks run on the
  // result. This adds no authority: only a fresh merged binding on a parent's default branch counts.
  // Whether the target is a store is only known after the read, so any cloud merge without a typed
  // approval may pay for it: a store merge's read is cached; a merge of a repository no binding
  // names repeats the read and is then refused as before. It
  // fetches into the clones' tracking refs and writes the binding cache exactly as session start
  // does. Clones beyond the folder cap are never read, which refuses rather than allows.
  refreshCloudParents(target, candidates) {
    const budgetMs = Math.min(this.shared - 2500, globalThis.performance.now() + 4500) - globalThis.performance.now();
    if (candidates.length === 0 || !(budgetMs > 0)) return false;
    // A whole-millisecond deadline: the git read hands what is left of it to spawnSync as a timeout.
    const deadline = Date.now() + Math.floor(budgetMs);
    let refreshed = false;
    for (const candidate of candidates) {
      if (Date.now() >= deadline) break;
      try { refreshed = this.refreshBinding(candidate.folder, { deadline }).refreshed === true || refreshed; } catch { /* the cached read stays */ }
    }
    this.deadline = Math.min(this.shared, globalThis.performance.now() + 4000);
    return refreshed;
  }

  request(apiPath) {
    if (this.responses.has(apiPath)) return this.responses.get(apiPath);
    const timeoutMs = this.deadline - globalThis.performance.now();
    if (timeoutMs <= 0) throw new Error('lookup budget exhausted');
    const response = this.read ? this.read(apiPath, { timeoutMs })
      : new GitHubTransport({ ghPath: resolveExecutable('gh', { environment: this.environment, cwd: this.cwd || process.cwd() }), timeoutMs }).request('GET', apiPath);
    if (globalThis.performance.now() > this.deadline || response?.status !== 200 || !response.json) throw new Error('lookup unavailable');
    this.responses.set(apiPath, response.json);
    return response.json;
  }

  check(merge) {
    // Parsing, connector field agreement and generic shell refusals have already run. Reuse the
    // supported standing-merge shape, but not the task preference or the session's origin.
    const target = merge.repository.toLowerCase();
    const here = repositoryOf(this.cwd)?.toLowerCase();
    const readBindings = () => {
      const stateDirectory = governance.userStateDirectory(this.registryOptions);
      const all = bindingCache.readAllBindingCaches(stateDirectory).map(({ entry, identity }) =>
        governance.judgeMerged(entry, identity, this.now()));
      // Read the exact target separately: the bounded scan may not include its own binding.
      const remote = validateRemoteIdentity(`https://github.com/${target}.git`);
      const identity = { remote, repository_id: repositoryIdForCanonicalRemote(remote.canonical) };
      return { all, own: governance.judgeMerged(bindingCache.readBindingCache(identity, stateDirectory), identity, this.now()) };
    };
    // A naming binding at any freshness supplies recovery text only, never merge authority.
    const namingOf = all => all.filter(judged => judged.status === 'enabled'
      && judged.binding.store?.kind === 'github' && judged.binding.store.repository.toLowerCase() === target
      && judged.binding.repository.toLowerCase() !== target);
    let bindings;
    let ownBinding;
    try { ({ all: bindings, own: ownBinding } = readBindings()); } catch { return null; }
    let naming = namingOf(bindings);
    const candidates = this.cloudCandidates(target);
    if (!naming.some(judged => judged.fresh) && this.refreshCloudParents(target, candidates)) {
      try { ({ all: bindings, own: ownBinding } = readBindings()); } catch { return null; }
      naming = namingOf(bindings);
    }
    if (naming.length === 0) return null;
    const failed = (reason, recovery = null) => ({ eligible: false, reason, recovery });
    if (ownBinding.status === 'enabled') {
      return failed('the target has its own enabled governance binding');
    }
    const sameOwner = naming.filter(judged => judged.binding.repository.split('/')[0].toLowerCase() === target.split('/')[0]);
    if (sameOwner.length === 0) return failed('the parent repository and store do not share an owner');
    // In a cloud container the session folder may hold the project's clones side by side: an
    // explicitly named store merge from there counts as from the parent when the parent's own
    // clone is one of those subfolders.
    const cloned = new Set(candidates.filter(entry => entry.child).map(entry => entry.slug));
    const inFolder = sameOwner.filter(judged => here === target
      || (merge.explicit && here === judged.binding.repository.toLowerCase())
      || (merge.explicit && !here && cloned.has(judged.binding.repository.toLowerCase())));
    const bound = inFolder.find(judged => judged.fresh) || inFolder[0] || sameOwner[0];
    const problem = standingProblem(merge, { repository: merge.repository });
    if (problem) {
      const sha = /^[0-9a-f]{40}$/i.test(merge.sha || '') ? merge.sha : '<full head sha>';
      return failed(problem, `Retry with exactly \`gh pr merge ${merge.pr} --repo ${merge.repository} --merge --match-head-commit ${sha}\`, using the pull request's current full head SHA.`);
    }
    if (inFolder.length === 0) return failed('this is neither the store folder nor its explicitly targeted parent',
      `Run from the ${merge.repository} store folder, or name --repo ${merge.repository} from the parent ${bound.binding.repository} folder.`);
    if (!bound.fresh) return failed('the parent binding is not fresh',
      `Run \`toolkit governance status\` in the parent ${bound.binding.repository} folder, then retry.`);
    try {
      const repo = this.request(`repos/${merge.repository}`);
      if (typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== target) return failed('the repository identity does not match');
      if (repo.private !== true) return failed('the store is not verified private');
      if (repo.permissions?.push !== true) return failed('write access is not verified');
      if (typeof repo.default_branch !== 'string' || repo.default_branch.length === 0) return failed('the default branch is unknown');
      if (repo.default_branch !== bound.binding.store.branch) return failed('the bound store branch is not the default branch');
      const pr = this.request(`repos/${merge.repository}/pulls/${merge.pr}`);
      if (pr.number !== merge.pr || typeof pr.base?.repo?.full_name !== 'string' || pr.base.repo.full_name.toLowerCase() !== target) return failed('the pull request target does not match');
      if (pr.base.ref !== repo.default_branch) return failed('the pull request base is not the default branch');
      if (typeof pr.head?.sha !== 'string' || pr.head.sha.toLowerCase() !== merge.sha.toLowerCase()) return failed('the pull request head has changed');
      return { eligible: true };
    } catch { return failed('GitHub metadata could not be read within the hook budget; check access and retry'); }
  }
}

function check(input, cwd, options = {}) {
  const { eligible, reason, checks } = standingAnswer(input, cwd, options);
  return { eligible, reason, explanation: eligible ? 'the standing session and repository checks pass; merge scope and gate conditions still apply' : standingReason(reason), ...checks };
}

function checkText(input, cwd, options) {
  return `Toolkit standing merge check (read-only; no approval consumed):\n${JSON.stringify(check(input, cwd, options), null, 2)}`;
}

// Exact command only: no flags, chaining or supplied session identity. The hook supplies its own
// native event, so a shell cannot substitute another session's id for this diagnostic.
function isCheckCommand(text, cwd) {
  const words = wordsOf(text.trim());
  return words.length === 3 && /^(?:node|node\.exe)$/i.test(path.basename(words[0]))
    && (words[1].replace(/\\/g, '/') === 'repo/scripts/toolkit-merge-hold.cjs'
      || path.resolve(cwd || process.cwd(), words[1]) === __filename) && words[2] === 'check'
    && !/[\r\n;&|`$<>]/.test(text);
}

// The PreToolUse decision: { deny } or null.
// `host` is the hook's own host ('claude' or 'codex'), set by the entry point, never read from the payload.
function readClosureFile(file) {
  if (!file || /[$`\r\n]/.test(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024) throw new Error('Unreadable merge content.');
  return fs.readFileSync(file, 'utf8');
}

function decide(input, { registryOptions = {}, now, environment = process.env, host = null, consume = true, readEvidenceGitHub, refreshEvidenceBinding, evidenceResponses, closureGuard, transport, deadline, timeoutMs = 30000, deadlineMs = 120000, maxRequests = 500 } = {}) {
  deadline ??= globalThis.performance.now() + (host === 'claude' ? 7500 : host === 'codex' ? 50000 : deadlineMs);
  const tool = String(input && (input.tool_name || input.toolName) || '');
  let merges;
  let cwd = input && typeof input.cwd === 'string' ? input.cwd : null;
  if (CONNECTOR_MERGE.test(tool)) merges = [connectorMerge(tool, input)];
  else if (ShellCall.isShellTool(tool)) {
    // The shared reader: command, cmd or a list of words, and the folder the command runs in
    // (Codex's workdir before the session folder). A line continuation (\, a PowerShell backtick or
    // a cmd caret before a line break) joins the next line. Bash and cmd join it with nothing between
    // (`user\` and `-state` on the next line is `user-state`), so outside PowerShell the command is
    // also judged joined that way (tight).
    const call = ShellCall.from(input);
    const text = call.text.replace(/[\\`^]\r?\n/g, ' ').replace(STOP_PARSING, '$1');
    const tight = call.text.replace(/[\\^]\r?\n/g, '').replace(/`\r?\n/g, ' ').replace(STOP_PARSING, '$1');
    cwd = call.folder;
    if (text.length > MAX_COMMAND_CHARS) {
      const guarded = /merge|push|\.ai-agent-toolkit\b/i.test(text) || [text, tight].some(reading => stateWords(reading) || stateWords(unescaped(reading))) || MOVES_TARGET.test(text) || new ToolkitFolders(registryOptions).holds(cwd);
      return guarded ? refuse('this command is too long to check for a merge, a push or Toolkit\'s user-state files, so it is refused. Split it.') : null;
    }
    // The host's shell wrapper is already unwrapped; only a runner inside its script is nested.
    const nested = nestedRefusal(call.text);
    if (nested) return nested;
    // An argument list is read both ways, as its words quoted and joined unquoted (as before the
    // shared reader), so a quoted program path such as `C:\Program Files\GitHub CLI\gh.exe` cannot
    // hide a merge. A merge both readings find counts once.
    const joined = call.joinedWords && call.joinedWords !== call.text ? call.joinedWords.replace(/[\\`^]\r?\n/g, ' ').replace(STOP_PARSING, '$1') : '';
    // An unknown shell is judged under each reading (shellReadings); the first refusal stands.
    const refusal = shellReadings(shellOf(input, host)).flatMap(shell => [...new Set(shell === 'powershell' ? [text] : [text, tight])].map(reading => shellRefusal(joined ? `${reading}\n${joined}` : reading, cwd, registryOptions, shell))).find(Boolean);
    if (refusal) return refusal;
    if (isCheckCommand(text, cwd)) return { deny: checkText(input, cwd, { environment, registryOptions, now, host }) };
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
  const standing = standingAnswer(input, cwd, { environment: environment || {}, registryOptions, now, host });
  const evidence = new EvidenceStoreMerges(cwd, { registryOptions, now, environment: environment || {}, readEvidenceGitHub, refreshEvidenceBinding, evidenceResponses, deadline });
  const used = [];
  for (const merge of merges) {
    // Preserve specific authority refusals; closure safety still precedes approval consumption.
    const { refusal, approval } = judge(merge, approvals, standing, evidence);
    if (refusal) {
      // A Projects cloud thread gets its posted merge card; elsewhere Claude Code may offer the tap card.
      const cloud = cloudCard(refusal, merge, environment);
      if (cloud !== refusal) return cloud;
      return refusal.deny.endsWith(ASK_TEXT) ? { deny: refusal.deny + cardOffer(merge, input, { environment: environment || {}, registryOptions, now, host }) } : refusal;
    }
    if (!consume) continue;
    const call = ShellCall.from(input);
    let mergeTexts = [];
    try {
      if (call.isShell) {
        const commands = scriptCommands(call.text, scriptContext(input));
        const unresolved = () => Object.assign(new Error('Generated merge text.'), { code: 'MERGE_TEXT_UNRESOLVED' });
        const matched = commands.filter(command => {
          const gh = ghCommand(command.words);
          return gh && !command.hidden && (gh.noun === 'pr' && gh.verb === 'merge' || gh.noun === 'api' && command.words.some(word => PULL_MERGE_PATH.test(word)));
        }).length;
        if (matched < merges.length) throw Object.assign(unresolved(), { unmatched: true });
        for (const [commandIndex, command] of commands.entries()) {
          const gh = ghCommand(command.words);
          if (command.hidden || !gh || (merge.kind === 'api' ? gh.noun !== 'api' : gh.noun !== 'pr' || gh.verb !== 'merge')) continue;
          const read = file => {
            if (file === '-') return stdinText(command);
            if (fileIsGenerated(file, command, commands, commandIndex)) throw unresolved();
            return readClosureFile(shellPath(cwd, file));
          };
          for (let i = 0; i < command.words.length; i += 1) {
            const word = command.words[i];
            const literal = (index, slice = 0) => {
              const value = command.words[index]?.slice(slice);
              const result = wordText({ ...command, words: [value], expanding: [command.expanding[index]] }, 0);
              if (result.unresolved) throw unresolved();
              return result.value;
            };
            if (merge.kind === 'api') {
              if (word === '--input' || word.startsWith('--input=')) {
                if (commandIndex > 0) throw unresolved();
                const body = JSON.parse(read(word === '--input' ? command.words[++i] : word.slice(8)));
                for (const key of ['commit_title', 'commit_message']) if (body[key] !== undefined) mergeTexts.push(body[key]);
              } else if (['-f', '-F', '--field', '--raw-field'].includes(word) || /^(?:-[fF].+|--(?:field|raw-field)=)/.test(word)) {
                const field = ['-f', '-F', '--field', '--raw-field'].includes(word) ? command.words[++i] : word.startsWith('--') ? word.slice(word.indexOf('=') + 1) : word.slice(word[2] === '=' ? 3 : 2);
                if (/^commit_(?:title|message)=/.test(field || '')) {
                  const value = field.slice(field.indexOf('=') + 1);
                  const result = wordText({ ...command, words: [value], expanding: [command.expanding[i]] }, 0);
                  if (result.unresolved) throw unresolved();
                  mergeTexts.push((word === '-F' || word === '--field' || /^-F|^--field=/.test(word)) && value.startsWith('@') ? read(value.slice(1)) : result.value);
                }
              }
              continue;
            }
            if (['--subject', '-t', '--body', '-b'].includes(word)) mergeTexts.push(literal(++i));
            else if (word === '--body-file' || word === '-F') mergeTexts.push(read(command.words[++i]));
            else if (/^--body-file=/.test(word) || /^-F.+/.test(word)) mergeTexts.push(read(word.startsWith('--') ? word.slice(12) : word.slice(word[2] === '=' ? 3 : 2)));
            else if (/^--(?:subject|body)=/.test(word)) mergeTexts.push(literal(i, word.indexOf('=') + 1));
            else if (/^-[tb].+/.test(word)) mergeTexts.push(literal(i, word[2] === '=' ? 3 : 2));
          }
        }
      } else {
        const args = input.tool_input || {};
        mergeTexts = ['commit_title', 'commit_message', 'commitTitle', 'commitMessage'].filter(key => args[key] !== undefined).map(key => args[key]);
      }
    } catch (error) { return refuse(error.unmatched ? 'this merge sits inside an assignment, script block or wrapper Toolkit does not read, or a quoted mention sits beside it, so its merge text stays generated or unresolved and it was refused. The approval is kept. Run the merge as its own command.' : error.code === 'MERGE_TEXT_UNRESOLVED' ? 'merge-message content is generated or unresolved. Provide literal text, or write the body file in a separate command before retrying.' : 'the merge-message file could not be read. Provide a readable body file or literal heredoc.'); }
    try {
      const guard = closureGuard || new IssueClosureGuard({ repository: merge.repository, deadlineMs, deadline, maxRequests,
        transport: transport || new GitHubTransport({ ghPath: resolveExecutable('gh', { cwd: cwd || process.cwd(), environment }), timeoutMs }) });
      const result = guard.checkPullRequest(merge.pr, { head: merge.sha, mergeTexts });
      if (result.status !== 'allowed') return refuse(result.reason);
    } catch { return refuse('gh is unavailable for issue closure safety. Run setup toolkit and gh auth login, then retry.'); }
    if (approval) used.push(approval);
  }
  if (consume) for (const approval of used) approvals.use(approval);
  return null;
}

// In a cloud session, a refusal for want of an approval also names the exact Projects merge card
// that would count (toolkit-projects-cloud.cjs), so the merge thread asks with the right wording.
function cloudCard(refusal, merge, environment) {
  if (!environment || environment.CLAUDE_CODE_REMOTE !== 'true' || !refusal || typeof refusal.deny !== 'string') return refusal;
  if (typeof merge.repository !== 'string' || !Number.isInteger(merge.pr) || !(typeof merge.sha === 'string' && /^[0-9a-f]{40}$/i.test(merge.sha))) return refusal;
  if (!/no unused approval|waits for the user's typed merge|needs the user's typed approval|approved .* but this merge names/.test(refusal.deny)) return refusal;
  return { ...refusal, deny: `${refusal.deny} In a Claude Projects thread, post the merge card yourself with exactly the question "${projectsCloud.mergeCardQuestion(merge.repository, merge.pr, merge.sha)}", first option Merge and second Not now; the owner's tap on Merge counts for that head, once.` };
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
  if (/\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i.test(text) || /\bgit\b[\s\S]*\bpush\b/i.test(text) || stateWords(text) || stateWords(unescaped(text)) || HOOK_FEED.test(text) || /\b(?:claude|codex)\b/i.test(text)) return true;
  // A command in Toolkit's own folder is guarded too (ToolkitFolders); a folder that cannot be read
  // here is not, as before.
  try { return new ToolkitFolders().holds(ShellCall.from(input).folder); } catch { return false; }
}

const CHECK_FAILED = 'Toolkit: the merge check failed, so this merge or push is refused. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.';

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== 'check') {
    process.stderr.write('Usage: node repo/scripts/toolkit-merge-hold.cjs check\n');
    return 1;
  }
  process.stdout.write(`${checkText({}, process.cwd(), {})}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({
  APPROVALS_BASENAME, APPROVALS_SCHEMA, CHECK_FAILED, CONNECTOR_MERGE, MAX_AGE_MS, MAX_COMMAND_CHARS, MergeApprovals, MergeHoldError,
  approvalsIn, cardAnswered, cardAsked, cardOf, check, connectorMergeArgs, decide, main, mergeCard, mayMerge, mergeWording, recordPrompt, shellMerges, standingAnswer,
});
