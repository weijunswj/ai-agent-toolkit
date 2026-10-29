'use strict';

// Which hosts on this computer run Toolkit's hooks, for `toolkit governance status`: one
// `Hooks: <host> <state>` line per host it can see. Read only: plugin registries, settings and the
// synced Projects skill. Hook trust is not readable on either host, so a present hook is never
// reported as trusted. A missing hook refuses nothing; the line names the portable path instead.
//
//   Claude Code     present (trust not checkable), from a local plugin install or the desktop app's
//                   claude.ai account copy | disabled (settings turn hooks off) | plugin absent
//   Codex           present, trust unknown | plugin absent
//   Claude Projects no local hooks (a skill synced from claude.ai runs in the cloud)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORTABLE_PATH = 'Without hooks, run programme.cjs refresh and programme.cjs attention by hand at session start and before each gate.';
const CODEX_PLUGIN_ID = 'ai-agent-toolkit@ai-agent-toolkit-local';

function isDir(folder) { try { return fs.statSync(folder).isDirectory(); } catch { return false; } }

// The Claude Code line, or null when Claude Code is not on this computer.
function claudeCodeHooks({ environment, homeDir, registry = null, blockers = null, accountCopy = null }) {
  const configDir = environment.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
  if (environment.CLAUDE_CODE_REMOTE === 'true') return { host: 'Claude Code', state: 'no local hooks (cloud session)' };
  if (!isDir(configDir)) return null;
  let install;
  try {
    const { ClaudePluginRegistry } = require('./toolkit-claude-plugin-registry.cjs');
    install = (registry || new ClaudePluginRegistry({ environment, homeDir })).toolkitInstall();
  } catch { install = { installed: false }; }
  // The Claude desktop app runs the Toolkit copy from the user's claude.ai account instead of a
  // local plugin install; its declared hooks run the same way.
  const account = install.installed ? null : (accountCopy || accountHookCopy)(environment);
  if (!install.installed && !account) return { host: 'Claude Code', state: 'plugin absent' };
  const root = install.installed ? install.runningRoot : account;
  if (!fs.existsSync(path.join(root, '.claude-plugin', 'hooks', 'hooks.json'))) return { host: 'Claude Code', state: 'plugin present, no hooks declared' };
  let reasons = [];
  try { reasons = (blockers || require('./setup-claude-toolkit-plugin.cjs').hookBlockers)({ env: { ...environment, USERPROFILE: environment.USERPROFILE || homeDir } }); }
  catch { reasons = ['the settings that can turn hooks off could not be read']; }
  if (reasons.length) return { host: 'Claude Code', state: 'disabled', detail: reasons.join(' ') };
  return { host: 'Claude Code', state: account ? 'present (claude.ai account copy; trust not checkable)' : 'present (trust not checkable)' };
}

// The folder of a Toolkit copy the Claude desktop app keeps from the user's claude.ai account, or
// null. Read only, from the app's plugin manifests (see toolkit-install-health.cjs).
function accountHookCopy(environment) {
  let folders = [];
  try { folders = require('./toolkit-install-health.cjs').claudeAccountPluginFolders(environment); } catch { return null; }
  // Each folder on its own: one without a readable manifest never hides a later one.
  for (const folder of folders) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); } catch { continue; }
    for (const plugin of Array.isArray(manifest?.plugins) ? manifest.plugins : []) {
      if (plugin?.name === 'ai-agent-toolkit' && typeof plugin.id === 'string' && /^[A-Za-z0-9_-]+$/.test(plugin.id)) return path.join(folder, plugin.id);
    }
  }
  return null;
}

// The Codex line, or null when Codex is not on this computer.
function codexHooks({ environment, homeDir, inspect = null }) {
  const codexHome = environment.CODEX_HOME || path.join(homeDir, '.codex');
  if (!isDir(codexHome)) return null;
  let status = 'unprovable';
  try { status = (inspect || require('./setup-codex-toolkit-plugin.cjs').inspectCodexConfiguredPluginState)({ codexHome, identity: CODEX_PLUGIN_ID }).status; }
  catch { status = 'unprovable'; }
  // A /hooks review Codex may still be waiting for is never reported as ok.
  return { host: 'Codex', state: status === 'enabled' ? 'present, trust unknown' : 'plugin absent' };
}

// The Projects line, when a controller skill is synced from claude.ai.
function projectsHooks({ environment, homeDir }) {
  const synced = path.join(environment.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude'), 'skills', 'synced');
  let names = [];
  try { names = fs.readdirSync(synced); } catch { return null; }
  const found = names.some(name => fs.existsSync(path.join(synced, name, 'web-controller-projects', 'SKILL.md')));
  return found ? { host: 'Claude Projects', state: 'no local hooks' } : null;
}

// [{ host, state, detail? }] and whether the portable path applies.
function hookCapability({ environment = process.env, homeDir = os.homedir(), readers = {} } = {}) {
  const hosts = [
    claudeCodeHooks({ environment, homeDir, registry: readers.claudeRegistry, blockers: readers.claudeBlockers, accountCopy: readers.claudeAccountCopy }),
    codexHooks({ environment, homeDir, inspect: readers.codexInspect }),
    projectsHooks({ environment, homeDir }),
  ].filter(Boolean);
  if (!hosts.length) hosts.push({ host: 'Toolkit', state: 'plugin absent' });
  return { hosts, portable: hosts.some(entry => !/^present/.test(entry.state)) };
}

function describeHooks(result) {
  const lines = result.hosts.map(entry => `Hooks: ${entry.host} ${entry.state}${entry.detail ? ` (${entry.detail})` : ''}`);
  if (result.portable) lines.push(PORTABLE_PATH);
  return lines;
}

module.exports = Object.freeze({ PORTABLE_PATH, hookCapability, describeHooks, accountHookCopy });
