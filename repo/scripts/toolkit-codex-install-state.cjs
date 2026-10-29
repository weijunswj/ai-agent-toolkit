'use strict';

// Reads what Codex itself holds for Toolkit, from files only: config.toml (the Toolkit plugin's
// on/off value, the local marketplace folder, project_doc_max_bytes with its Toolkit markers, and
// each Toolkit hook's `[hooks.state]` entry), the installed plugin cache (each version folder's
// manifest and hooks file) and the Codex setup journal. It never starts Codex, runs git or writes
// anything, so setup's read-only plan and Claude Code's session start can both use it.
//
// Hook state, as Codex records it in `[hooks.state."<plugin>:.codex-plugin/hooks/hooks.json:<event>:<group>:<hook>"]`
// (measured on WJ_Lappy, 29 Oct 2026): `enabled = false` is a hook the owner turned off; a
// `trusted_hash` is a reviewed hook, which runs unless it is turned off (Codex writes trusted
// entries without `enabled` for hooks never switched); no entry, or no `trusted_hash`, is a hook not
// reviewed yet, which Codex skips. Toolkit cannot recompute `trusted_hash` from the hooks file (the
// hash is over Codex's own encoding of each hook), so a hook changed since its review is not reported.

const fs = require('node:fs');
const path = require('node:path');
const plugin = require('./setup-codex-toolkit-plugin.cjs');

const SEMVER = /^\d+\.\d+\.\d+$/;
const HOOKS_REL = '.codex-plugin/hooks/hooks.json';
const DOC_LIMIT_KEY = /^[ \t]*project_doc_max_bytes[ \t]*=[ \t]*(\d+)[ \t]*(?:#.*)?$/;
const DOC_LIMIT_BEGIN = /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES\b/;
const DOC_LIMIT_END = /^# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\b/;
const SECTION = /^\s*\[/;

function readJsonIfExists(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return JSON.parse(text.replace(/^﻿/, ''));
}

function manifestVersion(root) {
  try {
    const manifest = readJsonIfExists(path.join(root, '.codex-plugin', 'plugin.json'));
    return manifest?.name === plugin.TOOLKIT_PLUGIN_NAME && SEMVER.test(manifest.version || '') ? manifest.version : '';
  } catch { return ''; }
}

const snakeCase = (event) => event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// A plain name for each Toolkit hook, from its event and what its matcher covers.
function hookName(event, group) {
  if (event === 'SessionStart') return 'Session start updates';
  if (event === 'UserPromptSubmit') return 'Prompt check';
  if (event === 'PreToolUse') return /apply_patch|Edit|Write/.test(String(group?.matcher || '')) ? 'File edit check' : 'Shell and agent check';
  if (event === 'PostToolUse') return 'Checkpoint after tool use';
  if (event === 'Stop') return 'Checkpoint at stop';
  return event;
}

// The hooks a Toolkit cache folder installs, each with its `[hooks.state]` key and plain name,
// taken from that folder's own hooks file so a later hooks change is picked up. null when the
// file is missing or unreadable.
function expectedToolkitHooks(cacheRoot) {
  let hooks;
  try { hooks = readJsonIfExists(path.join(cacheRoot, ...HOOKS_REL.split('/'))); }
  catch { return null; }
  if (!hooks || typeof hooks.hooks !== 'object') return null;
  const entries = [];
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    (Array.isArray(groups) ? groups : []).forEach((group, groupIndex) => {
      const list = Array.isArray(group?.hooks) ? group.hooks : [];
      list.forEach((_hook, hookIndex) => entries.push({
        event,
        key: `${plugin.pluginId()}:${HOOKS_REL}:${snakeCase(event)}:${groupIndex}:${hookIndex}`,
        name: `${hookName(event, group)}${list.length > 1 ? ` ${hookIndex + 1}` : ''}`,
      }));
    });
  }
  return entries;
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each expected hook's state from config.toml: on, off or not-reviewed.
// { status: 'read' | 'no-hooks-file' | 'unreadable', entries }.
function readToolkitHookStates(configText, cacheRoot) {
  if (configText === null || configText === undefined) return { status: 'unreadable', entries: [] };
  const expected = cacheRoot ? expectedToolkitHooks(cacheRoot) : null;
  if (!expected) return { status: 'no-hooks-file', entries: [] };
  const entries = expected.map((hook) => {
    const key = escapeRegex(hook.key);
    const section = plugin.findTomlSection(configText, new RegExp(`^hooks\\.state\\.(?:"${key}"|'${key}')$`));
    const values = section === null ? {} : plugin.parseTomlSectionValues(section);
    const state = String(values.enabled || '').toLowerCase() === 'false' ? 'off' : values.trusted_hash ? 'on' : 'not-reviewed';
    return { ...hook, state };
  });
  return { status: 'read', entries };
}

const joinNames = (names) => names.join(', ');

// The hooks that are off and not reviewed, by name.
function hookGaps(hooks) {
  const off = hooks.entries.filter((entry) => entry.state === 'off').map((entry) => entry.name);
  const notReviewed = hooks.entries.filter((entry) => entry.state === 'not-reviewed').map((entry) => entry.name);
  return { off, notReviewed, total: hooks.entries.length };
}

// Setup's plugin-helper summary of the hook state: status, message and what runs.
function describeHookStates(hooks) {
  if (hooks.status === 'unreadable') {
    return { status: 'unreadable', message: 'Codex config.toml could not be read, so the Toolkit hook state is unknown. Open `/hooks` in Codex and check that the Toolkit hooks are on.', execution: 'unknown' };
  }
  if (hooks.status !== 'read' || !hooks.entries.length) {
    return { status: 'no-hooks-file', message: 'The installed Toolkit plugin has no readable hooks file, so the hook state is unknown.', execution: 'unknown' };
  }
  const { off, notReviewed, total } = hookGaps(hooks);
  if (!off.length && !notReviewed.length) return { status: 'on', message: `All ${total} Toolkit hooks are on in Codex.`, execution: 'running' };
  const names = joinNames([...off, ...notReviewed]);
  return {
    status: off.length ? 'off' : 'not-reviewed',
    message: `Open \`/hooks\` in Codex and turn on: ${names}. Codex skips a Toolkit hook that is off or not reviewed.`,
    execution: `skipped: ${names}`,
  };
}

// The top-level project_doc_max_bytes, from text (no TOML parser): its value or null when absent,
// and whether it sits inside Toolkit's markers.
function docLimitState(configText) {
  const lines = String(configText).split(/\r?\n/);
  let begin = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SECTION.test(line)) break;
    if (DOC_LIMIT_BEGIN.test(line)) begin = index;
    const match = line.match(DOC_LIMIT_KEY);
    if (match) {
      const toolkit = begin >= 0 && DOC_LIMIT_END.test(lines[index + 1] || '');
      return { value: Number(match[1]), toolkit };
    }
  }
  return { value: null, toolkit: false };
}

class CodexToolkitInstall {
  #codexHome; #managedRoot;

  // managedRoot: the Toolkit copy updates come from, whose `.codex-plugin/plugin.json` is the
  // version this PC has; '' to skip that comparison.
  constructor({ codexHome = plugin.defaultCodexHome(), managedRoot = '' } = {}) {
    this.#codexHome = path.resolve(codexHome);
    this.#managedRoot = managedRoot ? path.resolve(managedRoot) : '';
  }

  get codexHome() { return this.#codexHome; }

  #cacheVersions() {
    const base = path.join(this.#codexHome, 'plugins', 'cache', plugin.TOOLKIT_MARKETPLACE_NAME, plugin.TOOLKIT_PLUGIN_NAME);
    let names = [];
    try { names = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
    catch { return []; }
    return names.map((name) => ({ root: path.join(base, name), version: manifestVersion(path.join(base, name)) }))
      .filter((entry) => entry.version)
      .sort((left, right) => plugin.compareSemver(left.version, right.version));
  }

  // freshness: also compare the installed files with the managed copy (setup only; it hashes the
  // whole plugin tree).
  read({ freshness = false } = {}) {
    let present = false;
    try { present = fs.statSync(this.#codexHome).isDirectory(); } catch { present = false; }
    const sourceVersion = this.#managedRoot ? manifestVersion(this.#managedRoot) : '';
    if (!present) return { present, config: 'missing', sourceVersion };
    let configText = '';
    let config = 'read';
    try { configText = fs.readFileSync(path.join(this.#codexHome, 'config.toml'), 'utf8'); }
    catch (error) {
      config = error.code === 'ENOENT' ? 'missing' : 'unreadable';
    }
    const cache = this.#cacheVersions();
    const newest = cache.at(-1) || null;
    const pluginState = config === 'unreadable' ? 'unknown'
      : { enabled: 'on', disabled: 'off' }[plugin.inspectConfiguredPluginState(configText, plugin.pluginId()).status] || 'unknown';
    const marketplace = config === 'read' ? plugin.localMarketplaceSection(configText) : null;
    const marketplaceValues = marketplace === null ? {} : plugin.parseTomlSectionValues(marketplace);
    let journalPending = false;
    try { journalPending = Boolean(new plugin.CodexSetupJournal(this.#codexHome).unresolved()); } catch { journalPending = true; }
    let cacheFresh = null;
    if (freshness && this.#managedRoot && cache.length === 1) {
      try { cacheFresh = plugin.verifyInstalledCacheFreshness(cache[0].root, this.#managedRoot).length === 0; }
      catch { cacheFresh = false; }
    }
    return {
      present,
      config,
      plugin: pluginState,
      versions: cache.map((entry) => entry.version),
      version: newest?.version || '',
      sourceVersion,
      older: Boolean(newest && sourceVersion && plugin.compareSemver(newest.version, sourceVersion) < 0),
      // Codex writes the folder with the Windows `\\?\` prefix.
      marketplacePath: String(marketplaceValues.path || marketplaceValues.source || '').replace(/^\\\\\?\\/, ''),
      cacheFresh,
      journalPending,
      docLimit: config === 'unreadable' ? null : docLimitState(configText),
      hooks: config === 'unreadable' ? { status: 'unreadable', entries: [] } : readToolkitHookStates(configText, newest?.root || ''),
    };
  }
}

// One line for Claude Code's session start, or '' when there is nothing to say: Codex has the
// Toolkit plugin on and runs an older Toolkit than this PC, or some Toolkit hooks are off or not
// reviewed. Silent when Codex is absent, the plugin is off or config.toml cannot be read.
function codexReminderLine(state) {
  if (!state?.present || state.config !== 'read' || state.plugin !== 'on' || !state.version) return '';
  const older = state.older === true;
  const gaps = state.hooks?.status === 'read' ? hookGaps(state.hooks) : { off: [], notReviewed: [], total: 0 };
  const hooksOff = gaps.off.length || gaps.notReviewed.length;
  if (older) {
    const hooksNote = hooksOff ? `, and ${hookGapText(gaps)}` : '';
    return `Codex runs Toolkit ${state.version}; this PC has ${state.sourceVersion}${hooksNote}. In Codex say "refresh toolkit", then open /hooks and turn the Toolkit hooks on.`;
  }
  if (!hooksOff) return '';
  const text = hookGapText(gaps);
  return `Codex: ${text.charAt(0).toUpperCase()}${text.slice(1)}. Open /hooks in Codex and turn them on.`;
}

// "all 6 Toolkit hooks are off", "Toolkit hooks off (A, B)", "Toolkit hooks not reviewed (C)", or both.
function hookGapText({ off, notReviewed, total }) {
  if (off.length === total && total) return `all ${total} Toolkit hooks are off`;
  if (notReviewed.length === total && total) return `all ${total} Toolkit hooks are not reviewed`;
  const parts = [];
  if (off.length) parts.push(`off (${joinNames(off)})`);
  if (notReviewed.length) parts.push(`not reviewed (${joinNames(notReviewed)})`);
  return `Toolkit hooks ${parts.join(' and ')}`;
}

module.exports = Object.freeze({
  CodexToolkitInstall,
  codexReminderLine,
  describeHookStates,
  docLimitState,
  expectedToolkitHooks,
  hookGaps,
  readToolkitHookStates,
});
