'use strict';

// Outside a Toolkit gate run, refuses a main-session Claude Code Agent/Task launch that would run on
// the session's own model, and names the cheaper route. The failure it prevents: on 23 Nov 2026 a
// read-only check launched as `general-purpose` with no `model` ran on the parent's Opus instead of
// a Haiku Toolkit helper, because the cost rule was written only.
//
// Claude Code picks a subagent's model in this order, first wins (sub-agents docs, "Choose a
// model", https://code.claude.com/docs/en/sub-agents.md, read 2026-11-23): the call's `model`, the
// definition's `model` (`inherit` means the parent's), CLAUDE_CODE_SUBAGENT_MODEL, then the parent
// conversation's model. CLAUDE_CODE_SUBAGENT_MODEL_FORCE puts the variable on every subagent except
// a fork, which always runs on the parent's model. No hook field carries the parent's model, so a
// Haiku or Sonnet session is refused too; the fix is one retry with `model`.
//
// Definitions are read from disk in Claude Code's precedence: the managed `.claude/agents`, every
// project `.claude/agents` from the working directory up to the git root (closest first), then the
// user agents folder. Plugin agents (`<plugin>:<agent>`) are looked up best-effort under the user's
// plugins folder. Accepted gaps (written in the bridge doc): session `--agents` and SDK definitions
// are not on disk, a plugin copy found may not be the enabled version, a plugin installed elsewhere
// passes, and unknown names pass.
//
// Fail open: an advisory cost check, not an irreversible effect. Anything this module cannot read
// counts as not found, and a throw leaves the hook's existing fail-open result outside gate runs.

const fs = require('node:fs');
const path = require('node:path');
const { HELPER_ROLES, OFF_VALUES, managedAgentsDirectory } = require('./toolkit-claude-helper-policy.cjs');
const { claudeUserAgentsDirectory } = require('./toolkit-claude-helper-spec.cjs');
const { GovernedRepoPredicate } = require('./toolkit-governed-repo.cjs');

// Built-in agents and their model (sub-agents docs, read 2026-11-23; recheck at each hook review).
// `general-purpose` and `claude` follow the model order, so CLAUDE_CODE_SUBAGENT_MODEL applies.
// `Explore` and `Plan` run on the parent's model even with that variable, unless it is forced.
const FOLLOWS_MODEL_ORDER = new Set(['general-purpose', 'claude']);
const ALWAYS_PARENT = new Set(['Explore', 'Plan']);
const OWN_MODEL = new Set(['claude-code-guide', 'statusline-setup', 'web-fetch']);

// Reader limits: definitions are short, so anything past these is treated as unreadable.
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_PER_FOLDER = 1000;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PLAIN_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;
// Line breaks other than LF and CRLF, and control characters, make a YAML reading uncertain.
const UNCERTAIN = /[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/;

const INHERITED_REASON = type => `Toolkit: this ${type} launch names no model, so it would run on this session's model. Use toolkit-g0-helper for read-only evidence (prefetch GitHub data first), toolkit-g1-helper for bounded checks, or pass a cheaper model, such as model: "haiku".`;
const FORK_REASON = "Toolkit: a fork always runs on this session's model and ignores a model setting. Brief toolkit-g0-helper or toolkit-g1-helper instead, or start a non-fork agent with a cheaper model.";

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

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

// Reads `name` and `model` from a definition's leading front matter. Returns { name, model } (model
// null when absent or empty), or null when the text has no front matter or any part this subset
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
    const match = /^(name|model)[ \t]*:(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, key, raw] = match;
    if (Object.hasOwn(found, key)) return null;
    const read = scalar(raw);
    if (read.unreadable) return null;
    if (read.value === null && /^[ \t]+\S/.test(lines[index + 1] || '')) return null;
    found[key] = read.value;
  }
  if (!found.name) return null;
  return { name: found.name, model: found.model ?? null };
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
      if (read && read.name === name) return { file: full, model: read.model };
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

// The hook output for a main-session launch outside a gate run: {} (no decision) or a refusal.
// `options.managedAgentsDirectory` replaces the platform's managed folder (tests).
function inheritedModelDecision(input, { environment = process.env, managedAgentsDirectory: managed = managedAgentsDirectory() } = {}) {
  const args = input?.tool_input;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const requested = args.subagent_type;
  if (requested !== undefined && requested !== null && typeof requested !== 'string') return {};
  const type = typeof requested === 'string' && requested !== '' ? requested : null;
  const env = environment || {};
  const refuse = () => deny(INHERITED_REASON(shownType(type)));
  if (type === 'fork') return deny(FORK_REASON);
  if (setValue(args.model) && args.model.trim().toLowerCase() !== 'inherit') return {};
  const defaultModel = setValue(env.CLAUDE_CODE_SUBAGENT_MODEL);
  if (defaultModel && switchOn(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)) return {};
  if (type !== null && Object.hasOwn(HELPER_ROLES, type)) return {};
  // A definition on disk outranks a built-in of the same name.
  const verdict = definition => {
    if (definition.model !== null && definition.model.toLowerCase() !== 'inherit') return {};
    return definition.model === null && defaultModel ? {} : refuse();
  };
  if (type !== null && !type.includes(':')) {
    const definition = firstDefinition(agentDirectories(input.cwd, env, managed), type);
    if (definition) return verdict(definition);
  }
  if (type === null || FOLLOWS_MODEL_ORDER.has(type)) return defaultModel ? {} : refuse();
  if (ALWAYS_PARENT.has(type)) return refuse();
  if (OWN_MODEL.has(type)) return {};
  if (type.includes(':')) {
    const segments = type.split(':');
    if (segments.length >= 2 && segments.every(segment => SEGMENT.test(segment))) {
      const definition = firstDefinition(pluginAgentDirectories(segments[0], segments.slice(1, -1), env), segments[segments.length - 1]);
      if (definition) return verdict(definition);
    }
  }
  return {};
}

module.exports = Object.freeze({ inheritedModelDecision, readFrontMatter, INHERITED_REASON, FORK_REASON });
