#!/usr/bin/env node
'use strict';

// Claude Code gate launch check, on the desktop app's start_session tool. The failure it prevents: a
// controller starts a gate session (G0, G1, G2) whose brief lacks a valid Gate, Route or Assignment
// line, or whose launch call does not pin the route's model and effort, and the gate fails only at its
// first state-changing tool, or runs unchecked (23 November 2026: two G2 launches without Gate and
// Route lines were refused at their first effect and relaunched, and 13 G2 starts needed their effort
// raised by hand).
//
//   PreToolUse   refuses the start, naming the exact fix, when its brief declares a gate and
//                - its Route line is missing, malformed or off the stack-registry pin, read by
//                  checkBriefRoute in toolkit-gate-route.cjs, the same reader the started session's
//                  own route check uses, so a brief that passes here is one that session accepts;
//                - it has no `Assignment: <id>` line (the id `programme.cjs assign` recorded, which
//                  the session binds to) or `Assignment: none` for a gate outside a programme;
//                - it is a fork (a gate starts fresh, and a fork takes no pinned model or effort);
//                - the call's model is missing or not the pin's, or its effort is missing, above the
//                  pin, or below both the pin and this session's own effort.
//                A brief declares a gate with a `Gate:` line naming one, or by a title that starts
//                with G0, G1 or G2 (then a missing or unknown Gate line is refused); `Gate: none`
//                declares none. The brief is read as the started session reads its first prompt: the
//                background, then the prompt.
//   PostToolUse  after a gate start or proposal card, prints the next steps with the session id
//                filled in: when the start runs below the pin, a READY-only first turn, then
//                set_session_effort to the pin, then the go-ahead; and the record step
//                (`programme.cjs assign`) for the brief's assignment. start_session caps an effort
//                above the caller's own without an error, so a start that asks for more runs at the
//                caller's; with the caller's effort unknown, the steps say to read it first. The note
//                ends with one line (WAKE_LINE) on being woken for each gate, not only for the last.
//
// It reads only exact fields: the tool name, the title, the call's context, target, model and effort,
// and the brief's first Gate, Route, Route override, Review class and Assignment lines, never the
// rest of the brief's wording. A failure of the check itself lets the start through with a note
// (fail open): the started gate's own route check still refuses an off-pin session.
//
// Accepted gaps: a start by proposal id alone carries no brief, so it is checked when the card is
// proposed, and an offer card's brief sent with its proposal id has only its lines checked (that call
// may carry no model or effort); a cloud start pins nothing in the call, so only its lines are checked; an assignment id
// is checked for shape, not looked up in the programme state; a brief that names no gate and has an
// ordinary title is not read.

const fs = require('node:fs');

const TOOL = /^mcp__ccd_session__start_session$/;
const TITLE_GATE = /^[ \t]*(?:\*\*)?G([012])\b/i;
const CLAUDE_MODEL = /^(?:opus|sonnet|haiku|fable)-\d/;
const PREFIX = 'Toolkit gate launch check: ';

// The failure it prevents: the app continues a controller's chat only once none of the sessions it
// started is working, so with two gates running the first result waits for the second (25 November 2026:
// 34 minutes). The app's own idle notice is not named: it refuses a session's id, and by its listed name it
// subscribed but no notice came in 13 minutes.
const WAKE_LINE = 'With more than one gate session running, start one background watch on GitHub for this one\'s own result once it is at work (its verdict comment or its pull request): the app continues this chat by itself only once no session it started is working.';

const gateRoute = () => require('./toolkit-gate-route.cjs');
const programmeCommand = args => require('./toolkit-user-state.cjs').programmeCommand(args);
const assignmentId = () => require('../../skills/github-program-reconciler/scripts/programme-state.cjs').ASSIGNMENT_ID;

// The host model id for a registry model: `opus-5.5` -> `claude-opus-5-5`; null for a model Claude
// Code cannot run.
function hostModel(model) {
  return CLAUDE_MODEL.test(model) ? `claude-${model.replace(/\./g, '-')}` : null;
}

// One `Route:` line per profile for a gate, for a refusal that names the fix.
function routeLines(registry, gate, { claudeOnly = false } = {}) {
  const route = gateRoute();
  const lines = [];
  for (const [profile, stack] of Object.entries(registry.profiles || {})) {
    const members = gate === 'G2' ? (stack.reviewers || []).map(entry => entry.reviewer_id) : [route.ROLE_MEMBER[gate]];
    for (const member of members) {
      const pin = route.pinFor(registry, profile, member);
      if (pin && (!claudeOnly || hostModel(pin.model))) lines.push(`\`Route: ${profile} ${member} ${pin.model}/${pin.effort}\``);
    }
  }
  return lines.join(' or ');
}

const rank = effort => gateRoute().EFFORTS.indexOf(effort);
const deny = problem => ({ deny: `${PREFIX}${problem}` });

// The launch decision for one start_session call: { gate: null } for a start that is not a gate
// brief, { deny } for one that must not start, or the gate's pinned launch.
function launchCheck(toolInput, { registry, callerEffort = null } = {}) {
  const route = gateRoute();
  const call = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const prompt = typeof call.prompt === 'string' ? call.prompt : '';
  if (!prompt.trim()) return { gate: null };
  const fork = call.context === 'fork';
  const background = !fork && typeof call.background === 'string' ? call.background : '';
  const brief = route.parseBrief(background ? `${background}\n\n${prompt}` : prompt);
  const titled = TITLE_GATE.exec(typeof call.title === 'string' ? call.title : '');
  if (brief.gate === 'none') return { gate: null };
  registry = registry || route.loadRegistry();
  if (brief.gate && brief.gate.unknown !== undefined) {
    if (!titled) return { gate: null };
    return deny(`the brief's Gate line "${brief.gate.unknown}" names no gate. Use one of \`Gate: G0\`, \`Gate: G1\`, \`Gate: G2\`, \`Gate: G2 recheck\`, \`Gate: delta review\` or \`Gate: design challenge\`, or \`Gate: none\` for a session that is not a gate.`);
  }
  if (!brief.gate) {
    if (!titled) return { gate: null };
    const named = `G${titled[1]}`;
    return deny(`the title names a ${named} but its brief has no \`Gate:\` line, so the started session would run unchecked. Add \`Gate: ${named}\`, its Route line (${routeLines(registry, named, { claudeOnly: true })}) and \`Assignment: <id>\`, or \`Gate: none\` if it is not a gate.`);
  }
  const gate = brief.gate;
  if (fork) return deny(`a ${gate} starts fresh (gate rules: fresh contexts), and a fork takes no pinned model or effort. Start it with context "fresh" and a background.`);
  const checked = route.checkBriefRoute(registry, gate, brief);
  if (checked.problem) return deny(brief.route ? checked.problem : `${checked.problem} For this ${gate}: ${routeLines(registry, gate, { claudeOnly: true })}.`);
  const { pin } = checked;
  const model = hostModel(pin.model);
  if (!model) return deny(`${pin.profile}/${pin.member} runs ${pin.model}, and ${pin.model} is not a Claude model, so a Claude Code session cannot run this ${gate}. Start it where that model runs, or name a Claude route: ${routeLines(registry, gate, { claudeOnly: true })}.`);
  let assignment = null;
  if (brief.assignment === null) return deny(`this ${gate} brief has no \`Assignment:\` line. Add \`Assignment: <id>\` naming the assignment the controller recorded with \`${programmeCommand(`assign --issue <n> --role ${gate} --assignment <id>`)}\` (the session binds to it), or \`Assignment: none\` for a gate outside a programme.`);
  const id = brief.assignment.replace(/[`*]/g, '').trim().split(/\s+/)[0] || '';
  if (id.toLowerCase() !== 'none') {
    if (!assignmentId().test(id)) return deny(`\`Assignment: ${brief.assignment}\` is not an assignment id (letters, digits, dot, dash or underscore, up to 60). Use \`Assignment: <id>\` or \`Assignment: none\`.`);
    assignment = id;
  }
  const caller = route.EFFORTS.includes(callerEffort) ? callerEffort : null;
  const launch = { gate, pin, assignment, effort: null, model, cloud: call.target === 'cloud' };
  // A cloud start takes no model or effort (the app ignores them there).
  if (launch.cloud) return launch;
  // An offer card's brief goes with its proposal id, which may carry no model or effort: its lines
  // are checked, and it starts at this session's effort.
  if (typeof call.proposal_id === 'string' && call.proposal_id) { launch.effort = caller; return launch; }
  const pinned = `${pin.profile}/${pin.member} is ${pin.model}/${pin.effort}`;
  if (typeof call.model !== 'string' || !call.model.trim()) return deny(`pass \`model: "${model}"\` in the launch call: a ${gate} runs on its pinned model (${pinned}), and an inherited model is not pinned.`);
  if (route.registryModel(call.model) !== route.registryModel(pin.model)) return deny(`the launch call asks for ${route.registryModel(call.model)}, but the ${pin.profile}/${pin.member} pin is ${pin.model}. Pass \`model: "${model}"\`.`);
  const want = caller && rank(caller) < rank(pin.effort) ? caller : pin.effort;
  const wantText = want === pin.effort ? `pass \`effort: "${want}"\`` : `pass \`effort: "${want}"\`, the highest this session can give, and raise it after the start`;
  if (!route.EFFORTS.includes(call.effort)) return deny(`${wantText} in the launch call: a ${gate} runs on its pinned effort (${pinned}), and an inherited effort is not pinned.`);
  if (rank(call.effort) > rank(pin.effort)) return deny(`the launch call's effort ${call.effort} is above its pin ${pin.model}/${pin.effort}; ${wantText}.`);
  // With the caller's effort unknown, a start below the pin may be its cap: the steps after it say how to raise it.
  if (caller && rank(call.effort) < rank(want)) return deny(`the launch call's effort ${call.effort} is below the ${pin.profile}/${pin.member} pin ${pin.model}/${pin.effort}; ${wantText}.`);
  // start_session takes an effort at or below this session's own and caps one above it without an
  // error (23 Nov: every G2 started at high with the pin's xhigh needed a raise), so such a start
  // runs at this session's effort.
  launch.effort = caller && rank(call.effort) > rank(caller) ? caller : call.effort;
  return launch;
}

function callerEffortOf(input, environment) {
  const level = input && input.effort && typeof input.effort === 'object' ? input.effort.level : null;
  return [level, environment.CLAUDE_EFFORT].find(value => typeof value === 'string' && value) || null;
}

function preToolUse(input, { environment = process.env, registry } = {}) {
  if (!TOOL.test(String(input && input.tool_name || ''))) return {};
  try {
    const decision = launchCheck(input.tool_input, { registry, callerEffort: callerEffortOf(input, environment) });
    return decision.deny ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.deny } } : {};
  } catch (error) {
    return { systemMessage: `Toolkit gate launch check could not run (${String(error && error.message || error).slice(0, 200)}); the start goes ahead, and the started gate's own route check still applies.` };
  }
}

// The next steps after a gate start or proposal card, or {}.
function postToolUse(input, { environment = process.env, registry } = {}) {
  if (!TOOL.test(String(input && input.tool_name || ''))) return {};
  try {
    const decision = launchCheck(input.tool_input, { registry, callerEffort: callerEffortOf(input, environment) });
    if (!decision.gate || decision.deny) return {};
    const result = JSON.stringify(input.tool_response === undefined ? '' : input.tool_response);
    const session = /session_id: (local_[A-Za-z0-9-]+)/.exec(result);
    const card = session ? null : /task_id: (task_[A-Za-z0-9_-]+)/.exec(result);
    if (!session && !card) return {};
    const id = session ? session[1] : '<its session id>';
    const { gate, pin, assignment } = decision;
    const steps = [];
    if (decision.effort && rank(decision.effort) < rank(pin.effort)) {
      steps.push(`its first turn runs at ${decision.effort}, below its ${pin.model}/${pin.effort} pin (start_session cannot go above this session's own effort), so its route check refuses its tools until the raise: let that first turn end (it should only reply READY), then call mcp__ccd_session_mgmt__set_session_effort with session_id ${id} and effort ${pin.effort}, confirm it with get_session, and only then send it the go-ahead.`);
    } else if (!decision.effort && !decision.cloud) {
      steps.push(`this session's effort is unknown here, so read its effort with get_session; if it is below its ${pin.model}/${pin.effort} pin, let its first turn end (it should only reply READY), call mcp__ccd_session_mgmt__set_session_effort with session_id ${id} and effort ${pin.effort}, and only then send it the go-ahead.`);
    }
    if (assignment && ['G0', 'G1', 'G2'].includes(gate)) {
      steps.push(`it binds to assignment ${assignment}, and bind refuses until that assignment is recorded: if \`${programmeCommand(`assign --issue <n> --role ${gate} --assignment ${assignment}`)}\` has not run yet, run it now.`);
    }
    if (!steps.length) return {};
    const head = session ? `Toolkit gate launch: ${gate} session ${id} started.` : `Toolkit gate launch: ${gate} card ${card[1]} is proposed; once it starts, take its session id from the linked sessions note.`;
    const text = `${head} ${steps.map((step, index) => `${index + 1}) ${step[0].toUpperCase()}${step.slice(1)}`).join(' ')} ${WAKE_LINE}`;
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } };
  } catch { return {}; }
}

function main(argv = process.argv.slice(2), stdin = () => fs.readFileSync(0, 'utf8'), write = text => process.stdout.write(text)) {
  const at = argv.indexOf('--event');
  const event = at >= 0 ? argv[at + 1] : null;
  let input = {};
  try { const parsed = JSON.parse(stdin()); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed; } catch { input = {}; }
  const output = event === 'PreToolUse' ? preToolUse(input) : event === 'PostToolUse' ? postToolUse(input) : {};
  write(`${JSON.stringify(output)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ launchCheck, main, postToolUse, preToolUse });
