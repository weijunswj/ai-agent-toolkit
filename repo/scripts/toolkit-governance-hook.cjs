#!/usr/bin/env node
'use strict';

// Claude Code's governance hook: one script for four events, named by --event.
//   UserPromptSubmit  in an undecided repository, attaches the governance question once per session
//                     (toolkit-governance-gate.cjs) and lets the message through. It also
//                     keeps each "merge N" the user types, for the merge hold, and adds one
//                     context line for a typed Toolkit command (toolkit-commands.cjs).
//   PreToolUse        refuses an agent's own answer to that question, everywhere; and in every
//                     folder refuses a merge the user has not typed "merge N" for (toolkit-merge-hold.cjs),
//                     and a gate session off its pinned route or a wrong route stamp (toolkit-gate-route.cjs);
//                     points an agent's own merge question (AskUserQuestion) at the merge card.
//   PostToolUse       records the answer tapped on the governance card or on the merge card
//                     (AskUserQuestion).
//   SessionStart      runs as a reader of the Toolkit checkout (toolkit-update-marker.cjs): it
//                     waits (up to 15 s) for a move the bridge hook is making, and no move starts
//                     until it is done. It adds context stating the effective
//                     governance state, after a line from the local default-branch catch-up
//                     (toolkit-repo-catchup.cjs) when it moved or could not move, exports the session's
//                     id to its shell commands (CLAUDE_ENV_FILE), so a session an agent starts from
//                     one of them is known not to be the user typing, and records the run's session
//                     mark, so a later process that resumes the session cannot answer. When the
//                     check crashes, it still blocks nothing but gives one line inside a repository
//                     naming the governed rules file (toolkit-governance-unavailable.cjs).
// The gate module loads inside the guarded path, so a missing or broken module still holds in a
// repository instead of crashing; hooks.json also sets onFailure: "block" for prompts and for the
// state-changing tools (STATE_CHANGING_TOOLS below).
//
// Cloud sessions (CLAUDE_CODE_REMOTE=true) run the merge hold too, but are not asked the governance
// question. Their session start reads the start folder's repository or, outside one, each repository
// cloned directly under it (a Claude Projects thread), and gives the governed rules for ENABLED ones. Proven unsafe issue closures are refused everywhere; an unknown closure check is advisory in
// the cloud. Governance still comes from
// the repository default branch.

const fs = require('node:fs');

const EVENTS = Object.freeze(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart']);

function readInput(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

const CLOUD_LINE = "Toolkit governance (cloud session): the merge hold runs as on a computer; the governance question is not asked (a cloud session cannot keep the owner's answer). The programme file on origin's default branch decides governance here too. Task auto-merge is the repository's merged switch (task_prs.auto_merge); in a Claude Projects thread, a project line `- Task auto-merge: Off` in the session context that opens its transcript forces it Off; a merge card tap at that head counts as the owner's approval. Issue closures the cloud check cannot prove unsafe are advisory. Required CI checks remain the backstop.";

function cloudSession(environment) { return Boolean(environment) && environment.CLAUDE_CODE_REMOTE === 'true'; }

// Appends `export TOOLKIT_HOST_SESSION=<id>` to the file Claude Code runs before each shell command of
// this session (the last line wins after /clear). Optional: any failure is ignored.
function exportHostSession(input, environment, gate) {
  const file = environment && environment.CLAUDE_ENV_FILE;
  const id = input && input.session_id;
  if (typeof file !== 'string' || file === '' || typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return false;
  if (!gate || typeof gate.HOST_SESSION_VARIABLE !== 'string') return false;
  try { fs.appendFileSync(file, `export ${gate.HOST_SESSION_VARIABLE}=${id}\n`); return true; } catch { return false; }
}

// The hook's stdout for one event. Never throws.
function respond(event, input, options = {}) {
  options = { ...options, deadline: options.deadline ?? require('node:perf_hooks').performance.now() + 7500 };

  // Cloud sessions run the merge hold as local ones do (local Toolkit is the base). Differences: a
  // Claude Projects thread's task auto-merge switch is read at merge time from the host's session
  // context, the opening record of its session transcript (toolkit-projects-cloud.cjs); an issue
  // closure the cloud check cannot prove unsafe is advisory, since gh there may not be signed in;
  // and the governance question is not asked, since a cloud container cannot keep the owner's
  // answer (a Projects override).
  const cloud = cloudSession(options.environment || process.env);
  if (cloud) options = { ...options, cloud: true };
  // The merge hold runs first and on its own, so an error in the governance check never skips it.
  if (event === 'PreToolUse') {
    options = { ...options, evidenceResponses: new Map() };
    const merge = mergeDecision(input, { ...options, consume: false });
    if (merge) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: merge.deny } };
    // A gate session off its stack-registry pin, or a verdict or G1 body with the wrong route stamp.
    const route = gateRouteDecision(input, options);
    if (route) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: route } };
  }
  // The bridge hook may be fast-forwarding the Toolkit checkout this hook runs from at this same
  // session start: the whole session-start read runs as a reader, so no move runs during it.
  if (event === 'SessionStart' && !cloud) {
    const read = whileReading(options.environment || process.env, () => respondSteady(event, input, options));
    return read.steady ? read.value : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: TREE_MOVING } };
  }
  return respondSteady(event, input, options);
}

function respondSteady(event, input, options) {
  const cloud = options.cloud === true;
  let gate;
  try {
    gate = options.gate || require('./toolkit-governance-gate.cjs');
    if (event === 'UserPromptSubmit') {
      // Recording explicit merge authority is independent of answering governance. Only this live
      // prompt is ingested, never context Toolkit attaches to it.
      let approvalNote = '';
      try {
        const count = (options.mergeHold || mergeHold()).recordPrompt(input, { environment: options.environment || process.env, registryOptions: options.registryOptions, now: options.now });
        if (count) approvalNote = `Toolkit recorded ${count} explicit merge approval(s).`;
      } catch { approvalNote = 'Toolkit could not record merge approvals from this message. A later merge still needs an unused recorded approval.'; }
      // Cloud override (Projects base-overrides list): the governance question is not asked in
      // cloud sessions, which cannot keep the owner's answer; nothing is held either way.
      const decision = cloud ? { action: 'pass' } : new gate.PromptHold({ ...options, picker: true }).decide({ cwd: input.cwd, prompt: input.prompt, sessionId: gate.sessionIdOf(input) });
      if (decision.action === 'block') return { decision: 'block', reason: [decision.reason, approvalNote].filter(Boolean).join('\n') };
      const text = [decision.context, approvalNote, decision.question ? '' : typedCommandNote(gate, input.prompt)].filter(Boolean).join('\n');
      const context = text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : {};
      return decision.notice ? { systemMessage: decision.notice, ...context } : context;
    }
    if (event === 'PreToolUse') {
      const decision = cloud ? null : new gate.ToolGate(options).decide(input);
      if (decision) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.deny } };
      if (input.tool_name === 'AskUserQuestion') {
        const cardOptions = { environment: options.environment || process.env, registryOptions: options.registryOptions, now: options.now };
        // An agent's own merge question is pointed at the merge card; a reader failure shows it.
        let redirect = null;
        try { redirect = (options.mergeHold || mergeHold()).cardRedirect(input, cardOptions); } catch { /* shown: at worst a second tap */ }
        if (redirect) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: redirect.deny } };
        // Notes an exact merge card so its answer can count; it refuses nothing.
        try { (options.mergeHold || mergeHold()).cardAsked(input, cardOptions); } catch { /* an unnoted card records nothing */ }
      }
      const closure = closureDecision(input, options);
      if (closure.hookSpecificOutput) return closure;
      const merge = mergeDecision(input, options);
      // A cloud closure advisory (closure.systemMessage) shows only when nothing refuses the call.
      return merge ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: merge.deny } } : closure;
    }
    if (event === 'PostToolUse') {
      if (input.tool_name !== 'AskUserQuestion') return {};
      const picked = new gate.PromptHold(options).picked({ cwd: input.cwd, sessionId: gate.sessionIdOf(input), toolUseId: input.tool_use_id, toolResponse: input.tool_response });
      if (picked) return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: picked.context } };
      const card = (options.mergeHold || mergeHold()).cardAnswered(input, { environment: options.environment || process.env, registryOptions: options.registryOptions, now: options.now });
      return card ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: card.context } } : {};
    }
    exportHostSession(input, options.environment || process.env, gate);
    let fresh = null;
    gate.startSession(input, { ...options, host: 'claude-code', onRefresh: read => { fresh = read; } });
    let text;
    if (cloud) {
      // The start folder's repository, or each repository cloned directly under it (a Projects
      // thread starts in /home/user); the governed rules come once for the ENABLED ones.
      // The whole text, this cloud line included, stays within the host's session-start limit.
      const limit = gate.SESSION_TEXT_LIMIT - Buffer.byteLength(`${CLOUD_LINE}\n\n`, 'utf8');
      const repositories = gate.cloudSessionText(input.cwd, { registryOptions: options.registryOptions, refreshBinding: options.refreshBinding, limit, refresh: fresh, programmeDeps: options.programmeDeps });
      text = repositories ? `${CLOUD_LINE}\n\n${repositories}` : '';
    } else {
      // The catch-up moves the checkout first, so the governance line reads the moved tree.
      const caughtUp = catchUpLine(fresh, options);
      text = [caughtUp, gate.sessionLine(input.cwd, { ...options, sessionId: gate.sessionIdOf(input), refresh: fresh })].filter(Boolean).join('\n');
    }
    return text ?{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } } : {};
  } catch (error) {
    // A failed governance check outside a repository may still allow a merge there. Consume its
    // approval only if that failure path actually allows the call.
    const failure = failed(event, input, gate, error);
    if (event === 'PreToolUse' && !failure.hookSpecificOutput) {
      const merge = mergeDecision(input, options);
      if (merge) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: merge.deny } };
    }
    return failure;
  }
}

const mergeHold = () => require('./toolkit-merge-hold.cjs');

// The session-start catch-up's one line (toolkit-repo-catchup.cjs), from this start's fresh read of
// origin's default branch. Local sessions only: a cloud container starts from a fresh clone. Any
// failure drops only this line.
function catchUpLine(fresh, options) {
  try { return (options.repoCatchUp || require('./toolkit-repo-catchup.cjs')).catchUp(fresh, { environment: options.environment || process.env }); } catch { return null; }
}

// Runs fn as a reader of the Toolkit checkout (toolkit-update-marker.cjs): no move starts while it
// reads, and it waits (bounded) for a move already running. A broken marker module never stops the
// session start. This script file and the marker module load before the guard.
function whileReading(environment, fn) {
  let marker;
  try { marker = require('./toolkit-update-marker.cjs'); } catch { return { steady: true, value: fn() }; }
  return marker.whileReading(marker.defaultControlRoot(environment), fn);
}
const TREE_MOVING = "Toolkit: an update was still writing Toolkit's files after 15 seconds, so this session start could not read the governance state safely. Continue with the global rules; no governance effects or standing task auto-merge until the next session start.";

// The gate route check (toolkit-gate-route.cjs). It refuses only in a gate session or on a verdict
// or G1 body write; when the module cannot load, only a launcher-marked gate session is refused.
function gateRouteDecision(input, options) {
  const environment = options.environment || process.env;
  try { return (options.gateRoute || require('./toolkit-gate-route.cjs')).preToolUse(input, { environment, registry: options.stackRegistry }); } catch {
    return ['G0', 'G1', 'G2'].includes(environment.TOOLKIT_GATE_ROLE) && STATE_CHANGING_TOOLS.test(String(input && input.tool_name || ''))
      ? 'Toolkit gate route check: the check is unavailable, so this gate session\'s tools are refused. Run setup toolkit to repair the plugin.' : null;
  }
}

// One advisory context line when the user's own message is exactly a typed Toolkit command
// (toolkit-commands.cjs). It never blocks: any failure adds nothing, and the turn that carries
// the governance question gets no line (the question comes first; the command works from the
// next message).
function typedCommandNote(gate, prompt) {
  try { return require('./toolkit-commands.cjs').phraseContext(gate.ownerReply(prompt)); } catch { return ''; }
}

function closureDecision(input, options) {
  let closure;
  try { closure = require('./toolkit-issue-closure.cjs').issueClosureDecision(input, options); }
  catch {
    try { if (require('./toolkit-shell-call.cjs').closureWriteCandidate(input)) closure = { status: 'unknown', deny: 'Toolkit: the issue closure check is unavailable, so this GitHub write is refused. Run setup toolkit to repair the plugin, then retry.' }; }
    catch { closure = { status: 'unknown', deny: 'Toolkit: executable command reader is unavailable. Run setup toolkit to repair the plugin.' }; }
  }
  if (options.cloud && closure?.status !== 'refused') return closure ? { systemMessage: 'Toolkit advisory: ' + closure.deny.replace(/^Toolkit: /, '') + ' Required CI must verify closure safety.' } : {};
  return closure ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: closure.deny } } : {};
}

// The merge hold's decision (toolkit-merge-hold.cjs), failing closed for a call that may merge
// when the module cannot run.
function mergeDecision(input, options = {}) {
  try { return (options.mergeHold || mergeHold()).decide(input, { registryOptions: options.registryOptions, now: options.now, environment: options.environment || process.env, host: 'claude', consume: options.consume !== false, readEvidenceGitHub: options.readEvidenceGitHub, evidenceResponses: options.evidenceResponses, closureGuard: options.closureGuard, transport: options.transport, deadline: options.deadline }); } catch {
    let mayMerge = true;
    try { mayMerge = (options.mergeHold || mergeHold()).mayMerge(input); } catch { mayMerge = STATE_CHANGING_TOOLS.test(String(input && input.tool_name || '')) && /merge|push/i.test(JSON.stringify(input || {})); }
    return mayMerge ? { deny: MERGE_CHECK_FAILED } : null;
  }
}
const MERGE_CHECK_FAILED = 'Toolkit: the merge check failed, so this merge or push is refused. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.';

// The gate's never-act line, spelled out here because the gate module may be what failed to load.
const NEVER_OWNER = 'Never act as the user: do not answer the governance question yourself, start a session or script to answer it, or click a confirmation through a UI or computer use.';

// The tools that change something. A failed check holds them inside a repository; every other tool
// (read-only ones, and the card, whose answer then counts for nothing without the tool gate's note)
// is let through, as it was before the hook saw it. hooks.json matches the same split, with
// onFailure: "block" only on this list, so a hook that cannot even start holds only these too.
const STATE_CHANGING_TOOLS = /^(?:Bash|PowerShell|Monitor|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|TaskStop|EnterWorktree|CronCreate|CronDelete|RemoteTrigger|SendMessage|Workflow|mcp__.*)$/;

// The session-start context after a crashed check: one plain line inside a repository, nothing
// elsewhere, and nothing when even the notice module cannot load.
function sessionStartFailure(input, error) {
  let text = '';
  try { text = require('./toolkit-governance-unavailable.cjs').sessionStartLine(input && input.cwd, error); } catch { text = ''; }
  return text ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } } : {};
}

function failed(event, input, gate, error) {
  // A failed session start blocks nothing, but says so: the governed rules arrive only through this
  // check, so it names their file inside a repository (toolkit-governance-unavailable.cjs).
  if (event === 'SessionStart') return sessionStartFailure(input, error);
  // A failed PostToolUse records nothing, which leaves the repository waiting.
  if (event === 'PostToolUse') return {};
  if (event === 'PreToolUse' && !STATE_CHANGING_TOOLS.test(String(input && input.tool_name || ''))) return {};
  let inside = true;
  try { inside = (gate || require('./toolkit-governance-gate.cjs')).insideRepository(input.cwd); } catch { inside = true; }
  if (!inside) return {};
  if (event === 'UserPromptSubmit') return { decision: 'block', reason: `Toolkit: the governance check failed, so your message was held and not sent. If this keeps happening, open Claude Code in a folder outside any git repository and say \`setup toolkit\` to repair the installed hooks. ${NEVER_OWNER}` };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Toolkit: the governance check failed, so nothing runs in this repository until it works again. ${NEVER_OWNER}` } };
}

function main(argv = process.argv.slice(2), stdin = () => fs.readFileSync(0, 'utf8')) {
  const index = argv.indexOf('--event');
  const event = index >= 0 ? argv[index + 1] : null;
  let input = {};
  try { input = readInput(stdin()); } catch { input = {}; }
  // An unknown event name is a broken install: hold as a prompt would be held.
  const output = EVENTS.includes(event) ? respond(event, input) : failed('UserPromptSubmit', input, null);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ EVENTS, CLOUD_LINE, NEVER_OWNER, STATE_CHANGING_TOOLS, TREE_MOVING, exportHostSession, respond, main });
