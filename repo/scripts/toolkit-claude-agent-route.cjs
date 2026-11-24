'use strict';

// The route (model and effort) a Claude Code Agent/Task launch would run on, and the agent hook's
// cost check outside Toolkit gate runs. The failure it prevents: on 23 Nov 2026 a read-only check
// launched as `general-purpose` with no `model` ran on the parent's Opus instead of a cheap helper,
// because the cost rule was written only.
//
// Outside a gate run a main-session launch is refused until the caller has loaded the
// agent-cost-control skill since its last compaction (the Toolkit helper presets excepted). It runs
// with no prompt only when it is strictly cheaper than the caller: a lower model family at any
// effort short of max, or the same family at a lower effort. Everything else gets Claude Code's
// permission prompt (`ask`): equal or costlier, any max effort, a fork, or a route this module
// cannot work out. Families come from repo/contracts/claude-model-ladder.json; the caller's route
// is the one its transcript last served on.
//
// Model order, first wins (sub-agents docs, "Choose a model", read 2026-11-23): a forced
// CLAUDE_CODE_SUBAGENT_MODEL (CLAUDE_CODE_SUBAGENT_MODEL_FORCE), the call's `model`, the
// definition's `model` (`inherit` means the caller's), CLAUDE_CODE_SUBAGENT_MODEL, then the
// caller's. A fork always runs on the caller's route. Effort: the call's `effort` or
// CLAUDE_CODE_EFFORT_LEVEL (the higher when both are set, since the docs do not say which wins),
// then the definition's `effort`, then the caller's own effort on the caller's model, then
// CLAUDE_CODE_SUBAGENT_EFFORT, else the model's default (never max).
//
// Definitions are read from disk in Claude Code's precedence: the managed `.claude/agents`, every
// project `.claude/agents` from the working directory up to the git root (closest first), then the
// user agents folder. Plugin agents (`<plugin>:<agent>`) are looked up best-effort under the user's
// plugins folder. Accepted gaps (written in the bridge doc): session `--agents` and SDK definitions
// are not on disk, and a plugin copy found may not be the enabled version.
//
// Cannot check means ask: a launch or caller route this module cannot read gets the prompt with a
// "could not check" reason, never a silent pass, and the hook asks the same way when this throws.

const fs = require('node:fs');
const path = require('node:path');
const { HELPER_ROLES, OFF_VALUES, managedAgentsDirectory } = require('./toolkit-claude-helper-policy.cjs');
const { claudeUserAgentsDirectory } = require('./toolkit-claude-helper-spec.cjs');
const { GovernedRepoPredicate } = require('./toolkit-governed-repo.cjs');
const { registryModel } = require('./toolkit-gate-route.cjs');
const { readTail, servedRoute, skillLoadedSinceCompaction } = require('./toolkit-transcript-tail.cjs');
const LADDER = require('../contracts/claude-model-ladder.json');

const EFFORT_RANK = Object.freeze(Object.fromEntries(LADDER.efforts.map((level, index) => [level, index])));
const SKILL = 'agent-cost-control';
// The transcript slice read for the skill and the caller's route. A skill read longer ago than
// this counts as not read, so the agent reads it again.
const TAIL_BYTES = 8 * 1024 * 1024;

// Built-in agents and their model (sub-agents docs, read 2026-11-23; recheck at each hook review).
// `general-purpose`, `claude` and a launch with no type follow the model order. `Explore` and
// `Plan` run on the caller's model even with CLAUDE_CODE_SUBAGENT_MODEL, unless it is forced.
const FOLLOWS_MODEL_ORDER = new Set(['general-purpose', 'claude']);
const ALWAYS_PARENT = new Set(['Explore', 'Plan']);
const OWN_MODEL = Object.freeze({ 'claude-code-guide': 'haiku', 'statusline-setup': 'sonnet', 'web-fetch': 'haiku' });

// Reader limits: definitions are short, so anything past these is treated as unreadable.
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_PER_FOLDER = 1000;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PLAIN_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;
// Line breaks other than LF and CRLF, and control characters, make a YAML reading uncertain.
const UNCERTAIN = /[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/;

const SKILL_REASON = 'Toolkit: read the agent-cost-control skill before starting a subagent (it checks the subagent is worth it and picks the cheapest route), then retry.';
const NOT_CHEAPER_REASON = (type, target, caller) => `Toolkit: this ${type} would run on ${target}, not cheaper than this agent's ${caller}. Allow only if the cost is worth it; otherwise deny and the agent retries on a cheaper model.`;
const MAX_REASON = type => `Toolkit: this ${type} would run at max effort, which spends tokens without regard to cost. Allow only if it is worth it.`;
const COULD_NOT_CHECK = "Toolkit could not tell this launch's route or this agent's own, so it cannot show the launch is cheaper. Allow only if you expect it to be.";

const decide = permissionDecision => reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason } });
const deny = decide('deny');
const ask = decide('ask');

const switchOn = value => { const text = String(value ?? '').trim(); return Boolean(text) && !OFF_VALUES.has(text.toLowerCase()); };
const setValue = value => typeof value === 'string' && value.trim() !== '';

// One scalar value of a front-matter key: { value } (null for an empty or null value), or
// { unreadable: true } for anything but a plain or simply quoted scalar.
function scalar(raw) {
  let text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return { value: null };
  const quoted = /^(["'])([^"'\\]*)\1(?:\s+#.*)?$/.exec(text);
  if (quoted) text = quoted[2];
  else text = text.replace(/\s+#.*$/, '');
  return PLAIN_VALUE.test(text) ? { value: text } : { unreadable: true };
}

// Reads `name`, `model` and `effort` from a definition's leading front matter. Returns
// { name, model, effort } (model and effort null when absent or empty), or null when the text has no front matter or any part this subset
// does not read for certain: an unusual line break or control character, a repeated key, a value
// that is not a plain scalar, or a key whose value continues on the next line.
function readFrontMatter(text) {
  if (typeof text !== 'string') return null;
  let body = text.startsWith('\ufeff') ? text.slice(1) : text;
  body = body.replace(/\r\n/g, '\n');
  if (!body.startsWith('---\n')) return null;
  const end = body.indexOf('\n---', 3);
  if (end < 0) return null;
  const after = body.slice(end + 4);
  if (after !== '' && !/^[ \t]*(?:\n|$)/.test(after)) return null;
  const block = body.slice(4, end);
  if (UNCERTAIN.test(block)) return null;
  const lines = block.split('\n');
  const found = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(name|model|effort)[ \t]*:(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, key, raw] = match;
    if (Object.hasOwn(found, key)) return null;
    const read = scalar(raw);
    if (read.unreadable) return null;
    if (read.value === null && /^[ \t]+\S/.test(lines[index + 1] || '')) return null;
    found[key] = read.value;
  }
  if (!found.name) return null;
  return { name: found.name, model: found.model ?? null, effort: found.effort ?? null };
}

// The first definition in `dir` whose front-matter name is `name`, in file-name order, or null.
function definitionIn(dir, name) {
  let entries;
  try { entries = fs.readdirSync(dir).filter(file => file.endsWith('.md')).sort().slice(0, MAX_FILES_PER_FOLDER); }
  catch { return null; }
  for (const file of entries) {
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const read = readFrontMatter(fs.readFileSync(full, 'utf8'));
      if (read && read.name === name) return { file: full, model: read.model, effort: read.effort };
    } catch { /* unreadable files count as not found */ }
  }
  return null;
}

// Agent folders Claude Code reads from disk, highest precedence first.
function agentDirectories(cwd, environment, managed) {
  const dirs = [];
  if (managed) dirs.push(managed);
  if (typeof cwd === 'string' && cwd) {
    let current = path.resolve(cwd);
    const root = GovernedRepoPredicate.gitRoot(current);
    for (;;) {
      dirs.push(path.join(current, '.claude', 'agents'));
      const parent = path.dirname(current);
      if (!root || current === root || parent === current) break;
      current = parent;
    }
  }
  dirs.push(claudeUserAgentsDirectory(environment));
  return [...new Set(dirs)];
}

const sortedDirs = dir => { try { return fs.readdirSync(dir).filter(name => SEGMENT.test(name)).sort().reverse(); } catch { return []; } };

// Agent folders of one plugin under the user's plugins folder: installed copies first, then
// marketplace copies. `sub` holds the subfolder names a nested plugin agent's name carries.
function pluginAgentDirectories(plugin, sub, environment) {
  const plugins = path.join(path.dirname(claudeUserAgentsDirectory(environment)), 'plugins');
  const dirs = [];
  const cache = path.join(plugins, 'cache');
  for (const marketplace of sortedDirs(cache)) {
    for (const version of sortedDirs(path.join(cache, marketplace, plugin))) dirs.push(path.join(cache, marketplace, plugin, version, 'agents', ...sub));
  }
  const marketplaces = path.join(plugins, 'marketplaces');
  for (const marketplace of sortedDirs(marketplaces)) dirs.push(path.join(marketplaces, marketplace, 'plugins', plugin, 'agents', ...sub));
  return dirs;
}

function firstDefinition(dirs, name) {
  for (const dir of dirs) { const found = definitionIn(dir, name); if (found) return found; }
  return null;
}

// The requested name as the refusal shows it.
function shownType(type) {
  if (type === null) return 'default (general-purpose)';
  return type.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(type) ? type : 'agent';
}

const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const effortLevel = value => typeof value === 'string' && Object.hasOwn(EFFORT_RANK, value.trim().toLowerCase()) ? value.trim().toLowerCase() : null;
const higherEffort = (a, b) => !a ? b : !b ? a : EFFORT_RANK[a] >= EFFORT_RANK[b] ? a : b;
const isInherit = value => typeof value === 'string' && value.trim().toLowerCase() === 'inherit';

// A model in the stack registry's spelling (`opus-5.5`) from a host model id or a launch alias, or
// null for an empty value.
function modelName(value) {
  if (!setValue(value)) return null;
  const id = value.trim().toLowerCase();
  return registryModel(Object.hasOwn(LADDER.aliases, id) ? LADDER.aliases[id] : id);
}

// The model's family rank on the ladder (0 cheapest), or null for a model the ladder does not list.
function familyRank(model) {
  const rank = typeof model === 'string' ? LADDER.families.indexOf(model.split('-')[0]) : -1;
  return rank < 0 ? null : rank;
}

// The definition Claude Code would load for this agent type, or null.
function definitionFor(type, cwd, environment, managed) {
  if (type === null) return null;
  if (!type.includes(':')) return firstDefinition(agentDirectories(cwd, environment, managed), type);
  const segments = type.split(':');
  if (segments.length < 2 || !segments.every(segment => SEGMENT.test(segment))) return null;
  return firstDefinition(pluginAgentDirectories(segments[0], segments.slice(1, -1), environment), segments[segments.length - 1]);
}

// The route a launch would run on: { model, effort, source, fork }. `model` is in registry spelling,
// or null when it cannot be worked out; `effort` is a level, `default` (the model's own default,
// never max) or null. `caller` is the launching agent's { model, effort } as the host names them.
// `options.managedAgentsDirectory` replaces the platform's managed folder (tests).
function targetRoute(input, { environment = process.env, managedAgentsDirectory: managed = managedAgentsDirectory(), caller = {} } = {}) {
  const args = input && input.tool_input;
  const requested = isPlain(args) ? args.subagent_type : 0;
  if (!isPlain(args) || (requested !== undefined && requested !== null && typeof requested !== 'string')) return { model: null, effort: null, source: 'unreadable', fork: false };
  const env = environment || {};
  const type = typeof requested === 'string' && requested !== '' ? requested : null;
  const callerModel = modelName(caller.model);
  if (type === 'fork') return { model: callerModel, effort: effortLevel(caller.effort), source: 'fork', fork: true };
  const definition = definitionFor(type, input.cwd, env, managed);
  const variable = modelName(env.CLAUDE_CODE_SUBAGENT_MODEL);
  let model = null, source = 'unknown agent';
  if (variable && switchOn(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)) [model, source] = [variable, 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE'];
  else if (setValue(args.model) && !isInherit(args.model)) [model, source] = [modelName(args.model), 'call'];
  else if (definition) [model, source] = definition.model !== null && !isInherit(definition.model) ? [modelName(definition.model), 'definition']
    : definition.model === null && variable ? [variable, 'CLAUDE_CODE_SUBAGENT_MODEL'] : [callerModel, 'inherits'];
  else if (type === null || FOLLOWS_MODEL_ORDER.has(type)) [model, source] = variable ? [variable, 'CLAUDE_CODE_SUBAGENT_MODEL'] : [callerModel, 'inherits'];
  else if (ALWAYS_PARENT.has(type)) [model, source] = [callerModel, 'inherits'];
  else if (Object.hasOwn(OWN_MODEL, type)) [model, source] = [modelName(OWN_MODEL[type]), 'built-in'];
  const sameModel = Boolean(model) && model === callerModel;
  let effort = higherEffort(effortLevel(args.effort), effortLevel(env.CLAUDE_CODE_EFFORT_LEVEL));
  if (!effort && definition) effort = effortLevel(definition.effort);
  if (!effort && sameModel) effort = effortLevel(caller.effort);
  if (!effort) effort = effortLevel(env.CLAUDE_CODE_SUBAGENT_EFFORT);
  if (!effort && model && !sameModel) effort = 'default';
  return { model, effort, source, fork: false };
}

const routeText = route => route.effort === 'default' ? `${route.model} at its default effort` : `${route.model}/${route.effort}`;

// The hook output for a main-session launch outside a gate run: {} (no decision), a refusal until
// the skill is read, or Claude Code's permission prompt. `options.tail` supplies the transcript
// slice ({ entries, complete }, or null when it cannot be read) instead of reading it.
function costDecision(input, { environment = process.env, managedAgentsDirectory: managed = managedAgentsDirectory(), tail } = {}) {
  const args = input && input.tool_input;
  if (!isPlain(args)) return ask(COULD_NOT_CHECK);
  const env = environment || {};
  const type = typeof args.subagent_type === 'string' && args.subagent_type !== '' ? args.subagent_type : null;
  const transcript = tail !== undefined ? tail : readTail(input.transcript_path, TAIL_BYTES);
  if (!transcript) return ask(COULD_NOT_CHECK);
  // The Toolkit helper presets pin a cheap route in their own files; the cost test below still runs.
  if (!(type !== null && Object.hasOwn(HELPER_ROLES, type)) && !skillLoadedSinceCompaction(transcript, SKILL)) return deny(SKILL_REASON);
  const served = servedRoute(transcript.entries);
  const level = isPlain(input.effort) ? effortLevel(input.effort.level) : null;
  const caller = { model: served.model, effort: level || effortLevel(env.CLAUDE_EFFORT) || served.effort };
  const target = targetRoute(input, { environment: env, managedAgentsDirectory: managed, caller });
  const ranks = { caller: familyRank(modelName(caller.model)), target: familyRank(target.model) };
  if (ranks.caller === null || ranks.target === null || target.effort === null) return ask(COULD_NOT_CHECK);
  const shown = target.fork ? 'fork' : shownType(type);
  if (target.effort === 'max') return ask(MAX_REASON(shown));
  if (ranks.target < ranks.caller) return {};
  const callerEffort = effortLevel(caller.effort);
  if (ranks.target === ranks.caller && callerEffort && target.effort !== 'default' && EFFORT_RANK[target.effort] < EFFORT_RANK[callerEffort]) return {};
  return ask(NOT_CHEAPER_REASON(shown, routeText(target), routeText({ model: modelName(caller.model), effort: callerEffort || 'unknown effort' })));
}

module.exports = Object.freeze({ costDecision, targetRoute, readFrontMatter, modelName, familyRank, routeText, shownType,
  SKILL_REASON, NOT_CHEAPER_REASON, MAX_REASON, COULD_NOT_CHECK });
