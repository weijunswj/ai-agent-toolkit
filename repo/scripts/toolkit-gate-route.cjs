#!/usr/bin/env node
'use strict';

// Gate route check. The failure it prevents: a Toolkit gate session (G0, G1, G2 or a design
// challenge) runs on a model or effort other than its stack-registry pin, and its plan, build or
// verdict counts anyway (15 November 2026: G2 reviews ran at medium effort against an xhigh pin, and
// their PASS verdicts boarded merge trains).
//
// A session is a gate when a Toolkit launcher set TOOLKIT_GATE_ROLE, or its brief (the session's
// first prompt; inside a Claude Projects spawn relay, only the relay's note) has a line
// `Gate: G0|G1|G2|G2 recheck|delta review|design challenge|none` (another value declares nothing, and
// outside a spawn relay the Route line below must be there too). A brief-declared gate also needs
//   Route: <profile> <member> <model>/<effort>
// naming its stack-registry pin (member: a role name in any case, DISCOVERY, BUILDER,
// DESIGN_CHALLENGE or REVIEWER for the profile's one reviewer, or a reviewer id; stamps name the
// registry's own member). Every gate runs on its pin: the old `Route override:` brief line is
// retired, so a brief that still carries one is refused and an old ` override=` stamp reads off-pin
// (a stale brief must not run off-pin on a citation checked only for shape). A G2 of a
// wording-only docs pull request may add `Review class: wording-only` and run at high on the pinned
// model; its stamp boards only a pull request whose every file is a LIGHT `.md` file.
//
// Proof, strongest first; a model's own answer about itself never counts:
//   host-verified      the host's record shows both: effort from the hook input's effort level or
//                      CLAUDE_EFFORT, model from the newest assistant entry the CLI wrote to the
//                      session transcript;
//   launcher-attested  the host shows at most one of them (the one it shows still has to match), so
//                      the brief's Route line, written from the model and effort the launch call
//                      passed, stands in;
//   UNVERIFIED         no proof from either side: a gate with no Route line, or a session that is not
//                      a declared gate.
//
// The stamp is one line: `Route: <proof> <model>/<effort> pin=<profile>/<member>` (plus
// `, self-check unavailable` when launcher-attested), or `Route: UNVERIFIED`.
// G0 plans, G1 reports and PR bodies, and G2 verdicts (the line after `Toolkit-G2:`) carry it. The
// governance hook refuses a declared gate's state-changing tools while it is off its pin (messaging
// tools stay open so it can report), refuses a verdict or a G1 pull request body whose stamp is not
// the session's own, and the merge train finder reads the stamps (stampStatus). A verdict is read
// only where the finder counts one, the first line of a published comment, so reads and quotes of
// verdict lines pass. A helper's call (agent_id) is not checked against the gate's pin: the agent hook
// checked its route when it started (it must be cheaper than the lead).
//
// Accepted gaps, written down as the hook design playbook asks: the brief is the launcher's text, so
// a brief that names no gate is not checked (the Projects skill requires the Gate line); a stamp is
// text, so a session the hook does not run in, or a body the hook cannot read (a shell variable, a
// file written in the same command), can carry any stamp (the finder trusts only the line, and RISKY
// pull requests need a verified or attested one); after /clear the transcript starts again without the brief; until the
// transcript has its first assistant entry only effort is checked.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const transcriptHead = require('./toolkit-transcript-head.cjs');
const transcriptTail = require('./toolkit-transcript-tail.cjs');

const REGISTRY_PATH = path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v3.json');
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const ROLE_MEMBER = Object.freeze({ G0: 'DISCOVERY', G1: 'BUILDER', DESIGN_CHALLENGE: 'DESIGN_CHALLENGE' });
// The effort a G2 brief with `Review class: wording-only` may run at on the reviewer's pinned model;
// the merge train finder accepts its stamp only when every changed file is a LIGHT `.md` file.
const WORDING_EFFORT = 'high';
const TAIL_BYTES = 1024 * 1024;

// The stamp line. Groups: proof, model, effort, profile, member, retired override, self-check. The
// retired ` override=<ref>` tail is still read so an old stamp carrying it reads off-pin; dropping it
// from the pattern would read that stamp as missing, which a NORMAL pull request may board with.
const STAMP = /^Route: (host-verified|launcher-attested|UNVERIFIED)(?: ([A-Za-z0-9._-]+)\/(low|medium|high|xhigh|max) pin=([a-z0-9-]+)\/([A-Za-z0-9_-]+)( override=\S+?)?)?(, self-check unavailable)?[ \t]*$/;
const VERDICT = /Toolkit-G2: (?:PASS|FAIL) [0-9a-f]{40} tier=(?:LIGHT|NORMAL|RISKY)/;

function loadRegistry(file = REGISTRY_PATH) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// Registry spelling of a host model id: `claude-opus-5-5[1m]` -> `opus-5.5`.
function registryModel(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  return id.trim().toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d+)-(\d+)$/, '-$1.$2');
}

const profileOf = (registry, profile) => registry && registry.profiles && Object.hasOwn(registry.profiles, profile) ? registry.profiles[profile] : null;

// A brief's member, as the registry names it: a role name in any case (DISCOVERY, BUILDER,
// DESIGN_CHALLENGE, or REVIEWER for the profile's one reviewer) or a reviewer id. { member } or
// { problem } when REVIEWER names more than one reviewer.
function resolveMember(registry, profile, member) {
  const role = member.toUpperCase();
  const stack = profileOf(registry, profile);
  if (role !== 'REVIEWER') return { member: Object.values(ROLE_MEMBER).includes(role) ? role : member };
  const ids = ((stack && stack.reviewers) || []).map(entry => entry.reviewer_id);
  if (ids.length > 1) return { problem: `${profile} has ${ids.length} reviewers (${ids.join(', ')}), so REVIEWER names none of them. Name the reviewer id this G2 is, such as \`Route: ${profile} ${ids[0]} ...\`.` };
  return { member: ids.length === 1 ? ids[0] : member };
}

// The members a profile's Route line can name, for a refusal.
function membersOf(registry, profile) {
  const stack = profileOf(registry, profile);
  if (!stack) return '';
  const ids = (stack.reviewers || []).map(entry => entry.reviewer_id);
  const roles = Object.keys(stack.routes || {}).filter(name => !name.endsWith('_HELPER'));
  return ` Its members: ${[...roles, ...(ids.length ? [`REVIEWER (${ids.join(', ')})`] : [])].join(', ')}.`;
}

// The pinned route of one member of a profile: { model, effort, reviewer } or null.
function pinFor(registry, profile, member) {
  const stack = profileOf(registry, profile);
  if (!stack) return null;
  if (Object.hasOwn(stack.routes || {}, member)) return { model: stack.routes[member].model, effort: stack.routes[member].reasoning, reviewer: false };
  const reviewer = (stack.reviewers || []).find(entry => entry.reviewer_id === member);
  return reviewer ? { model: reviewer.model, effort: reviewer.reasoning, reviewer: true } : null;
}

const LINE = name => new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?(?:\\*\\*)?${name}:(?:\\*\\*)?[ \\t]*(.*?)[ \\t]*$`, 'i');

// The Gate, Route and Assignment lines of a brief, and the retired Route override line's text (kept
// only so the check can refuse it). Each is the first such line; the Assignment line is kept as
// written, for the launch check.
function parseBrief(text) {
  const out = { gate: null, route: null, override: null, assignment: null, wording: false, relay: false };
  if (typeof text !== 'string') return out;
  const spawn = /<relay\b[^>]*\breason="spawn"[^>]*>[\s\S]*?<note>([\s\S]*?)<\/note>/.exec(text);
  out.relay = Boolean(spawn);
  const lines = (spawn ? spawn[1] : text).split(/\r?\n/);
  const first = name => { for (const line of lines) { const match = LINE(name).exec(line); if (match) return match[1]; } return null; };
  const gate = first('Gate');
  if (gate !== null) {
    const value = gate.toLowerCase().replace(/[`*]/g, '').trim();
    const match = /^(g0|g1|g2 recheck|g2|delta review|delta g2|recheck|design challenge|none)\b/.exec(value);
    out.gate = !match ? { unknown: gate } : match[1] === 'g0' ? 'G0' : match[1] === 'g1' ? 'G1' : match[1] === 'design challenge' ? 'DESIGN_CHALLENGE' : match[1] === 'none' ? 'none' : 'G2';
  }
  const route = first('Route');
  if (route !== null) {
    const match = /^`?([a-z0-9-]+) ([A-Za-z0-9_-]+) ([A-Za-z0-9._-]+)\/(low|medium|high|xhigh|max)`?$/.exec(route);
    out.route = match ? { profile: match[1], member: match[2], model: match[3], effort: match[4] } : { malformed: route };
  }
  const reviewClass = first('Review class');
  out.wording = reviewClass !== null && reviewClass.toLowerCase().replace(/[`*]/g, '').trim() === 'wording-only';
  out.override = first('Route override');
  out.assignment = first('Assignment');
  return out;
}

// The gate a parsed brief declares (G0, G1, G2 or DESIGN_CHALLENGE), or null.
function declaredGate(brief) {
  // A Gate line that names no gate (an owner's "Gate: please check" in a first message) declares
  // nothing: refusing it would stop every tool of an ordinary session. Its verdicts stamp UNVERIFIED.
  if (!brief.gate || brief.gate === 'none' || brief.gate.unknown !== undefined) return null;
  // Outside a Projects spawn relay, a first prompt declares a gate only with both lines, so an
  // owner's own first message that happens to start a line with "Gate:" stops nothing.
  return brief.relay || brief.route ? brief.gate : null;
}

function entryText(entry) {
  const content = entry && entry.message && entry.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some(part => part && part.type === 'tool_result')) return null;
  const text = content.filter(part => part && part.type === 'text').map(part => part.text).join('\n');
  return text || null;
}

// { brief, model, effort } from a transcript: the first prompt's text, and the model and effort the
// CLI wrote on the newest assistant entry. Missing parts are null, never guessed. `parts` skips a
// part a caller does not need yet.
function readTranscript(file, parts = { brief: true, served: true }) {
  const out = { brief: null, model: null, effort: null };
  try { fs.statSync(file); } catch { return out; }
  if (parts.brief) out.brief = entryText(transcriptHead.firstUserEntry(file, entry => entryText(entry) !== null));
  if (!parts.served) return out;
  return { ...out, ...transcriptTail.servedRoute(transcriptTail.readTail(file, TAIL_BYTES)?.entries) };
}

const refuse = (gate, reason) => ({ gate, deny: `Toolkit gate route check: ${reason}` });

// A gate brief's Route line read against the stack registry: { problem } saying what is wrong and the
// fix, or { pin: { profile, member, model, effort }, registry } for the route the gate must run on.
// The session's own route check (evaluate) and the Claude Code launch check
// (toolkit-claude-gate-launch-hook.cjs) both call it, so a brief refused at launch is the brief the
// started session would refuse. The registry loads only once the lines are well formed.
function checkBriefRoute(registry, gate, brief) {
  if (brief.override !== null) return { problem: `the brief's Route override line "${brief.override}" is retired: every gate runs on its stack-registry pin. Launch it again without that line, on the pin.` };
  if (!brief.route) return { problem: `this ${gate} brief has no Route line, so nothing says which pin to check. Launch it again with one line \`Route: <profile> <member> <model>/<effort>\` copied from the stack registry, with model and effort pinned in the launch call.` };
  if (brief.route.malformed !== undefined) return { problem: `the brief's Route line "${brief.route.malformed}" is not \`Route: <profile> <member> <model>/<effort>\`. Launch it again with that line.` };
  registry = registry || loadRegistry();
  const { profile } = brief.route;
  const named = resolveMember(registry, profile, brief.route.member);
  if (named.problem) return { problem: named.problem };
  const { member } = named;
  const pinned = pinFor(registry, profile, member);
  if (!pinned) return { problem: `the stack registry has no route ${profile}/${brief.route.member}.${membersOf(registry, profile)} Launch again with \`Route: <profile> <member> <model>/<effort>\` naming one of them.` };
  if (gate === 'G2' ? !pinned.reviewer : pinned.reviewer || ROLE_MEMBER[gate] !== member) return { problem: `${profile}/${member} is not the ${gate} route${gate === 'G2' ? ' (a G2 names a reviewer id)' : ` (${ROLE_MEMBER[gate]})`}. Launch it again on the right route.` };
  if (gate === 'G2' && brief.wording && brief.route.model === pinned.model && brief.route.effort === WORDING_EFFORT) {
    return { pin: { profile, member, model: pinned.model, effort: WORDING_EFFORT }, registry };
  }
  if (brief.route.model !== pinned.model || brief.route.effort !== pinned.effort) {
    return { problem: `the brief's Route line asks for ${brief.route.model}/${brief.route.effort}, but the ${profile}/${member} pin is ${pinned.model}/${pinned.effort}. Launch it again on the pin.` };
  }
  return { pin: { profile, member, model: pinned.model, effort: pinned.effort }, registry };
}

// The session's route decision: { gate: null, stamp: 'Route: UNVERIFIED' } for a session that is not
// a gate; { gate, deny } for one that must not run; { gate, stamp, proof, pin } for one on its route.
function evaluate({ input = {}, environment = process.env, registry, transcript } = {}) {
  const file = typeof input.transcript_path === 'string' && input.transcript_path ? input.transcript_path : null;
  // The brief first; the served route only once the session is a gate.
  let read = transcript || (file ? readTranscript(file, { brief: true, served: false }) : { brief: null, model: null, effort: null });
  const brief = parseBrief(read.brief);
  const marked = ['G0', 'G1', 'G2'].includes(environment.TOOLKIT_GATE_ROLE) ? environment.TOOLKIT_GATE_ROLE : null;
  let gate = declaredGate(brief);
  if (marked && gate && marked !== gate) return refuse(marked, `the launcher marked this session ${marked} but its brief says Gate: ${gate}. Launch it again with one role.`);
  gate = marked || gate;
  if (!gate) return { gate: null, stamp: 'Route: UNVERIFIED' };
  if (brief.override === null && !brief.route && marked && !brief.gate) return { gate, stamp: 'Route: UNVERIFIED' };
  const checked = checkBriefRoute(registry, gate, brief);
  if (checked.problem) return refuse(gate, checked.problem);
  registry = checked.registry;
  const { profile, member } = checked.pin;
  const pin = { model: checked.pin.model, effort: checked.pin.effort };
  const level = input.effort && typeof input.effort === 'object' ? input.effort.level : null;
  // A helper's call (the host sets agent_id inside a subagent) carries the gate's transcript but runs
  // on the helper's own route, which the agent hook checked when it started (cheaper than the lead;
  // owner decision on #1466), so it is never held to the gate's pin. The gate could start one only
  // while on its own pin, since an off-pin gate's Agent call is refused.
  if (typeof input.agent_id === 'string' && input.agent_id) return { gate, helper: true, stamp: null };
  if (!transcript && file) read = { ...read, ...readTranscript(file, { brief: false, served: true }), brief: read.brief };
  const effort = [level, environment.CLAUDE_EFFORT, read.effort].find(value => EFFORTS.includes(value)) || null;
  const model = read.model ? registryModel(read.model) : (typeof input.model === 'string' ? registryModel(input.model) : null);
  const wrong = [effort && effort !== pin.effort ? `effort ${effort}` : null, model && model !== registryModel(pin.model) ? `model ${model}` : null].filter(Boolean);
  if (wrong.length) return refuse(gate, `this ${gate} runs on ${wrong.join(' and ')}, but its route is ${pin.model}/${pin.effort} (${profile}/${member}). Stop here and ask for a fresh launch with model and effort set explicitly; you may still report this.`);
  const proof = effort && model ? 'host-verified' : 'launcher-attested';
  const stamp = `Route: ${proof} ${pin.model}/${pin.effort} pin=${profile}/${member}${proof === 'launcher-attested' ? ', self-check unavailable' : ''}`;
  return { gate, stamp, proof, pin: { profile, member, model: pin.model, effort: pin.effort } };
}

// ---- Stamps in what a session writes ----

// Tools that stay open to an off-pin gate: it must still be able to say why it stopped, and nothing
// more (no device session, connector or card).
const REPORT_TOOLS = /^(?:mcp__hearthbot__(?:post_message|edit_message|react|unreact|update_progress_checklist|request_decision|close_decision|message_coordinator|message_thread|no_reply_needed|read_thread|read_messages_by_id|read_project_chat|list_threads|rename_thread|show_helpline_card|stop_remote_control)|mcp__claude-code-remote__get_session)$/;
const STATE_CHANGING = /^(?:Bash|PowerShell|Monitor|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|TaskStop|EnterWorktree|CronCreate|CronDelete|RemoteTrigger|ScheduleWakeup|SendMessage|Workflow|mcp__.*)$/;
const { SHELL_TOOLS: SHELL } = require('./toolkit-shell-call.cjs');
// A verdict where the train finder counts one: the first line of a published comment.
const VERDICT_FIRST = /^[ \t\r\n]*Toolkit-G2: (?:PASS|FAIL) [0-9a-f]{40} tier=(?:LIGHT|NORMAL|RISKY)/;

const readText = (file, cwd) => { try { return fs.readFileSync(path.resolve(cwd || process.cwd(), file), 'utf8'); } catch { return null; } };
const FILE_VALUE = /^[ \t]*(?:=|[ \t]+)?(?:"([^"]+)"|'([^']+)'|([^\s"';|&)]+))/;

// The start of an inline body value: past its quote, a `body=` field name and a `$(cat <<'EOF'` or
// `$(cat file)` opener (that file is read). The body runs on to the end of the command; only its first
// two lines matter here.
function inlineBody(rest, cwd) {
  let text = rest.replace(/^[ \t]*(?:=|[ \t]+)?/, '').replace(/^\$?["']/, '').replace(/^body=/, '').replace(/^\$?["']/, '');
  const heredoc = /^\$\([ \t]*cat[ \t]+<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n/.exec(text);
  if (heredoc) return text.slice(heredoc[0].length);
  const cat = /^\$\([ \t]*cat[ \t]+(?:"([^"]+)"|'([^']+)'|([^\s"')]+))[ \t]*\)/.exec(text);
  if (cat) return readText(cat[1] || cat[2] || cat[3], cwd) ?? '';
  return text;
}

// One gh command's published body texts: { comment, body, files }, where comment is true for a
// comment post (gh pr|issue comment, or gh api with a body field), body for a pull request body
// write. Reads (gh api with GET or no body field, gh pr view) publish nothing.
function ghBodies(segment, cwd) {
  const kind = /^gh\s+(?:(pr|issue)\s+(comment|create|edit)|(api))\b/.exec(segment);
  if (!kind) return null;
  const api = Boolean(kind[3]);
  if (api && /(?:^|\s)(?:-X|--method)(?:=|\s+)["']?GET\b/i.test(segment)) return null;
  const texts = [];
  const files = [];
  const inline = api ? /(?:^|\s)(?:-f|--raw-field|-F|--field)(?=[ \t=])(?=[ \t=]*["']?body=)/g : /(?:^|\s)(?:--body|-b)(?=[ \t=])/g;
  for (const match of segment.matchAll(inline)) {
    const rest = segment.slice(match.index + match[0].length);
    const at = api && /^[ \t=]*["']?body=@/.exec(rest);
    if (at && /-F|--field/.test(match[0])) { const file = FILE_VALUE.exec(rest.slice(at[0].length)); if (file) files.push(file[1] || file[2] || file[3]); continue; }
    texts.push(inlineBody(rest, cwd));
  }
  for (const match of segment.matchAll(api ? /(?:^|\s)--input(?=[ \t=])/g : /(?:^|\s)(?:--body-file|-F)(?=[ \t=])/g)) {
    const file = FILE_VALUE.exec(segment.slice(match.index + match[0].length));
    if (file) files.push(file[1] || file[2] || file[3]);
  }
  for (const file of files) {
    if (file === '-') continue;
    let text = readText(file, cwd);
    if (text === null) continue;
    if (api && /--input/.test(segment)) { try { const parsed = JSON.parse(text); if (parsed && typeof parsed.body === 'string') text = parsed.body; } catch { /* not JSON: read as it is */ } }
    texts.push(text);
  }
  if (!texts.length) return null;
  return { comment: api || kind[2] === 'comment', body: kind[1] === 'pr' && kind[2] !== 'comment', texts, segment };
}

// The texts a call would publish: { verdict: [comment bodies], body: [pull request body texts] }.
function publishedTexts(input, cwd) {
  const name = String(input && input.tool_name || '');
  const tool = (input && input.tool_input) || {};
  const out = { verdict: [], body: [] };
  if (/github/i.test(name) && typeof tool.body === 'string') {
    if (/(?:add_issue_comment|update_issue_comment|add_reply_to_pull_request_comment)$/.test(name)) out.verdict.push(tool.body);
    if (/(?:create_pull_request|update_pull_request)$/.test(name)) out.body.push(tool.body);
    return out;
  }
  if (!SHELL.test(name) || typeof tool.command !== 'string') return out;
  // Each gh command in the line, up to the next one.
  const starts = [...tool.command.matchAll(/(?:^|[\s;&|(])(gh\s)/g)].map(match => match.index + match[0].length - match[1].length);
  starts.forEach((start, index) => {
    const found = ghBodies(tool.command.slice(start, starts[index + 1] ?? tool.command.length), cwd);
    if (!found) return;
    if (found.comment) out.verdict.push(...found.texts);
    // The command and the body file it names are one write: their stamp lines count together.
    if (found.body) out.body.push(found.segment, ...found.texts.filter(text => !found.segment.includes(text)));
  });
  return out;
}

// The stamp lines in a text, read as lines (also across literal \n in a one-line shell string).
function stampLines(text) {
  return String(text).split(/\r?\n|\\n/).map(line => line.replace(/^[\s"'$]+/, '').replace(/["'\s]+$/, '')).filter(line => /^Route: (?:host-verified|launcher-attested|UNVERIFIED)\b/.test(line));
}

// The line right after a verdict that opens the text, or null when the text does not open with one.
function lineAfterVerdict(text) {
  const match = VERDICT_FIRST.exec(String(text));
  if (!match) return null;
  const rest = String(text).slice(match[0].length);
  const next = /^[ \t]*(?:\r?\n|\\n)([^\r\n]*?)(?:\\n|\r?\n|$)/.exec(rest);
  return next ? next[1].replace(/["'\s]+$/, '') : '';
}

// Why this call's published text carries the wrong stamp for this session, or null.
function stampProblem(input, decision) {
  const texts = publishedTexts(input, input && input.cwd);
  const expected = decision.stamp;
  for (const text of texts.verdict) {
    const after = lineAfterVerdict(text);
    if (after === null) continue;
    if (decision.helper) return `a helper does not post a Toolkit-G2 verdict. Its ${decision.gate} session posts its own.`;
    if (decision.gate && decision.gate !== 'G2') return `a ${decision.gate} session does not post a Toolkit-G2 verdict. A G2 session on the reviewer route does.`;
    if (decision.gate === 'G2' && after !== expected) return `the line after the Toolkit-G2 verdict line must be this session's route stamp, exactly:\n${expected}`;
    if (!decision.gate && !/^Route: UNVERIFIED\b/.test(after)) return `this session is not a declared G2 (no \`Gate: G2\` brief line or launcher mark), so its verdict's next line must be \`Route: UNVERIFIED\`. Only a hooked gate session on its pin can stamp a verified route.`;
  }
  if (decision.gate === 'G1' && texts.body.length) {
    if (decision.helper) return 'a helper does not write the pull request body. The G1 session writes it with its own route stamp.';
    const lines = texts.body.flatMap(stampLines);
    if (lines.length !== 1 || lines[0] !== expected) return `a G1 pull request body carries exactly one route stamp line, this session's own:\n${expected}`;
  }
  return null;
}

// The governance hook's PreToolUse answer: a refusal reason, or null. A declared gate whose check
// fails refuses its state-changing tools; anything else that fails lets the call through.
function preToolUse(input, { environment = process.env, registry } = {}) {
  const name = String(input && input.tool_name || '');
  if (!STATE_CHANGING.test(name) || REPORT_TOOLS.test(name)) return null;
  let decision;
  try { decision = evaluate({ input, environment, registry }); } catch (error) {
    const marked = ['G0', 'G1', 'G2'].includes(environment.TOOLKIT_GATE_ROLE);
    return marked ? `Toolkit gate route check: the check failed (${error.message}), so this gate's tools are refused until it works. Run setup toolkit to repair the plugin.` : null;
  }
  if (decision.deny) return decision.deny;
  try { const problem = stampProblem(input, decision); return problem ? `Toolkit gate route check: ${problem}` : null; } catch { return decision.gate ? 'Toolkit gate route check: this write could not be read for its route stamp, so it is refused. Retry it with the body inline.' : null; }
}

// ---- Train acceptance ----

// One stamp line read against the registry: { status, stamp } where status is on-pin, off-pin,
// unverified or missing; a stamp carrying the retired ` override=` tail is off-pin. `want` is
// 'reviewer' (a G2 verdict) or 'BUILDER' (a G1 body). `options.effort` is one more effort a reviewer
// stamp may carry on the pinned model (the finder passes the wording-only effort for a pull request
// of LIGHT `.md` files only).
function stampStatus(line, want, registry, options = {}) {
  const match = typeof line === 'string' ? STAMP.exec(line.trim()) : null;
  if (!match) return { status: 'missing', stamp: null };
  const [, proof, model, effort, profile, member, retired, attested] = match;
  if (proof === 'UNVERIFIED') return { status: 'unverified', stamp: match[0] };
  if (!model || (proof === 'launcher-attested') !== Boolean(attested)) return { status: 'missing', stamp: null };
  const pinned = pinFor(registry || loadRegistry(), profile, member);
  const rightMember = pinned && (want === 'reviewer' ? pinned.reviewer : !pinned.reviewer && member === want);
  if (!rightMember || retired) return { status: 'off-pin', stamp: match[0] };
  const efforts = [pinned.effort, ...(pinned.reviewer && options.effort ? [options.effort] : [])];
  return { status: model === pinned.model && efforts.includes(effort) ? 'on-pin' : 'off-pin', stamp: match[0] };
}

// ---- Command line ----

function transcriptFor(environment) {
  const id = environment.CLAUDE_CODE_SESSION_ID || environment.TOOLKIT_HOST_SESSION;
  if (!id || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return null;
  const projects = path.join(environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let folders = [];
  try { folders = fs.readdirSync(projects); } catch { return null; }
  for (const folder of folders) {
    const file = path.join(projects, folder, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// `stamp [--transcript <file>]`: prints this session's route stamp line, or why it is off its route.
function main(argv = process.argv.slice(2), environment = process.env, write = text => process.stdout.write(text)) {
  if (argv[0] !== 'stamp') { write('Usage: node repo/scripts/toolkit-gate-route.cjs stamp [--transcript <file>]\n'); return 2; }
  const at = argv.indexOf('--transcript');
  const file = at >= 0 ? argv[at + 1] : transcriptFor(environment);
  const decision = evaluate({ input: { transcript_path: file || '' }, environment });
  if (decision.deny) { write(`${decision.deny}\n`); return 1; }
  write(`${decision.stamp}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ EFFORTS, ROLE_MEMBER, WORDING_EFFORT, checkBriefRoute, declaredGate, evaluate, loadRegistry, main, membersOf, parseBrief, pinFor, preToolUse, readTranscript, registryModel, stampLines, stampStatus });
