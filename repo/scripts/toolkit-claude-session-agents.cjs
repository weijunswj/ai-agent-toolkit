#!/usr/bin/env node
'use strict';

// Launcher-side check for Claude Code's `--agents` flag. A session started with its own `--agents`
// definition of a Toolkit helper name runs that definition: session definitions outrank project and
// user agent files, and no hook can see them, so the Toolkit agent hook cannot enforce the helper's
// route there. A launcher calls this check before it starts Claude Code and refuses the launch when
// a Toolkit helper name is redefined off its pinned route (model and effort from the selected stack)
// or without the leaf rule (Agent and Task disallowed). Other agent names pass unchanged.
//
// Usage: node repo/scripts/toolkit-claude-session-agents.cjs --stack <id> -- <claude arguments...>
// Exit 0: nothing to refuse. Exit 2: refused, with the reason on stderr. Exit 1: usage error.

const fs = require('node:fs');
const path = require('node:path');
const { ROLES } = require('./toolkit-claude-helper-spec.cjs');

const HELPER_ROLES = Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([role, spec]) => [spec.name, role])));
const LEAF_TOOLS = Object.freeze(['Agent', 'Task']);
const AGENTS_FILE_LIMIT = 1024 * 1024;

// The model and effort a rendered helper definition pins, read from its front matter.
function pinnedRoutes(stack, toolkitRoot = path.resolve(__dirname, '..', '..')) {
  const { ClaudeHelperAgentRenderer } = require('./toolkit-claude-helper-agents.cjs');
  const renderer = ClaudeHelperAgentRenderer.fromRepository(stack, toolkitRoot);
  return Object.fromEntries(Object.keys(ROLES).map(role => {
    const text = renderer.render(role).text;
    const field = name => new RegExp(`^${name}: (\\S+)$`, 'm').exec(text)?.[1] || null;
    return [role, { model: field('model'), effort: field('effort') }];
  }));
}

function listOf(value) {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
}

// One plain reason per Toolkit helper name that `agents` redefines off its route; empty when none.
function helperRedefinitions(agents, routes) {
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return ['the --agents value is not a JSON object of agent definitions.'];
  const reasons = [];
  for (const [name, definition] of Object.entries(agents)) {
    if (!Object.hasOwn(HELPER_ROLES, name)) continue;
    const pin = routes[HELPER_ROLES[name]];
    const problems = [];
    if (!definition || typeof definition !== 'object') problems.push('it is not an agent definition');
    else {
      if (definition.model !== pin.model) problems.push(`its model is ${definition.model ?? 'not set'}, not ${pin.model}`);
      if (definition.effort !== pin.effort) problems.push(`its effort is ${definition.effort ?? 'not set'}, not ${pin.effort}`);
      const disallowed = listOf(definition.disallowedTools);
      const missing = LEAF_TOOLS.filter(tool => !disallowed.includes(tool));
      if (missing.length) problems.push(`it does not disallow ${missing.join(' and ')}`);
    }
    if (problems.length) reasons.push(`--agents redefines the Toolkit helper ${name}: ${problems.join('; ')}.`);
  }
  return reasons;
}

// Reads an --agents value the way Claude Code accepts it: inline JSON, or a path to a JSON file.
function readAgentsValue(value, cwd) {
  const text = String(value ?? '').trim();
  try {
    if (text.startsWith('{')) return JSON.parse(text);
    const file = path.resolve(cwd, text);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > AGENTS_FILE_LIMIT) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return undefined; }
}

// Checks every --agents value in a Claude Code argument list. Returns { refused, reasons }.
function checkClaudeArguments(argv, { stack, toolkitRoot, cwd = process.cwd(), routes } = {}) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === '--') break;
    if (arg === '--agents') values.push(argv[i + 1]);
    else if (arg.startsWith('--agents=')) values.push(arg.slice('--agents='.length));
  }
  if (!values.length) return { refused: false, reasons: [] };
  const pins = routes || pinnedRoutes(stack, toolkitRoot);
  const reasons = values.flatMap(value => {
    const agents = readAgentsValue(value, cwd);
    return agents === undefined ? ['an --agents value could not be read as JSON, so Toolkit cannot check it for its helper names.'] : helperRedefinitions(agents, pins);
  });
  return { refused: reasons.length > 0, reasons };
}

function main(argv = process.argv.slice(2)) {
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  const stackAt = own.indexOf('--stack');
  const stack = stackAt === -1 ? null : own[stackAt + 1];
  if (!stack || split === -1) {
    process.stderr.write('Usage: toolkit-claude-session-agents.cjs --stack <id> -- <claude arguments...>\n');
    return 1;
  }
  const result = checkClaudeArguments(argv.slice(split + 1), { stack });
  if (!result.refused) return 0;
  for (const reason of result.reasons) process.stderr.write(`Toolkit: ${reason}\n`);
  process.stderr.write('Toolkit: remove those definitions or render them from the selected stack; the launch was not started.\n');
  return 2;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`Toolkit: ${error.code || error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ checkClaudeArguments, helperRedefinitions, pinnedRoutes, readAgentsValue, main });
