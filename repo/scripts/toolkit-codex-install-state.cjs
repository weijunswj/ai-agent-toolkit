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
// reviewed yet, which Codex skips. `trusted_content_hash` must also match the whole plugin bundle.
// A changed bundle stops hooks until the owner approves them again in /hooks. A missing or unreadable
// bundle fingerprint is unverified, never on. This reader never writes approval or a cache.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('./setup-codex-toolkit-plugin.cjs');

const SEMVER = /^\d+\.\d+\.\d+$/;
const HOOKS_REL = '.codex-plugin/hooks/hooks.json';
const DOC_LIMIT_KEY = /^[ \t]*project_doc_max_bytes[ \t]*=[ \t]*(\d+)[ \t]*(?:#.*)?$/;
const DOC_LIMIT_BEGIN = /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES\b/;
const DOC_LIMIT_END = /^# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\b/;
const SECTION = /^\s*\[/;

// Codex's codex-plugin-bundle-v1 encoding (rust-v0.166.0 plugin_fingerprint.rs).
// Native relative path separators and platform filename ordering are part of that encoding.
function pluginBundleFingerprint(root) {
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Plugin root is not a directory');
  const hash = crypto.createHash('sha256').update('codex-plugin-bundle-v1');
  const size = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); hash.update(bytes); };
  const pending = [root];
  const buffer = Buffer.alloc(64 * 1024);
  while (pending.length) {
    const file = pending.pop();
    const relative = path.relative(root, file);
    const name = path.basename(relative);
    if (['__pycache__', '.venv'].includes(name) || name.endsWith('.pyc') || name.endsWith('.egg-info')) continue;
    const encoded = Buffer.from(relative, 'utf8');
    size(encoded.length); hash.update(encoded);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      hash.update('directory');
      const names = fs.readdirSync(file).sort(process.platform === 'win32' ? undefined : (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      pending.push(...names.reverse().map(entry => path.join(file, entry)));
    } else if (stat.isFile()) {
      hash.update('file'); size(stat.size);
      const fd = fs.openSync(file, 'r');
      let read = 0;
      try {
        while (read <= stat.size) {
          const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size + 1 - read), null);
          if (!count) break;
          read += count; hash.update(buffer.subarray(0, count));
        }
      } finally { fs.closeSync(fd); }
      if (read !== stat.size) throw new Error('Plugin file changed while fingerprinting');
    } else throw new Error('Unsupported plugin entry type');
  }
  return `sha256:${hash.digest('hex')}`;
}

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

// Each expected hook's approval and bundle state: on, off, not-reviewed, changed or unverified.
// { status: 'read' | 'no-hooks-file' | 'unreadable', entries }.
function readToolkitHookStates(configText, cacheRoot) {
  if (configText === null || configText === undefined) return { status: 'unreadable', entries: [] };
  const expected = cacheRoot ? expectedToolkitHooks(cacheRoot) : null;
  if (!expected) return { status: 'no-hooks-file', entries: [] };
  let fingerprint;
  try { fingerprint = pluginBundleFingerprint(cacheRoot); } catch { /* Unknown must not become on. */ }
  const entries = expected.map((hook) => {
    const key = escapeRegex(hook.key);
    const section = plugin.findTomlSection(configText, new RegExp(`^hooks\\.state\\.(?:"${key}"|'${key}')$`));
    const values = section === null ? {} : plugin.parseTomlSectionValues(section);
    const state = String(values.enabled || '').toLowerCase() === 'false' ? 'off'
      : !values.trusted_hash ? 'not-reviewed'
        : !fingerprint || !/^sha256:[a-f0-9]{64}$/.test(values.trusted_content_hash || '') ? 'unverified'
          : values.trusted_content_hash !== fingerprint ? 'changed' : 'on';
    return { ...hook, state };
  });
  return { status: 'read', entries };
}

const joinNames = (names) => names.join(', ');

// Every hook whose approval or execution cannot be treated as on, by name.
function hookGaps(hooks) {
  const off = hooks.entries.filter((entry) => entry.state === 'off').map((entry) => entry.name);
  const notReviewed = hooks.entries.filter((entry) => entry.state === 'not-reviewed').map((entry) => entry.name);
  const changed = hooks.entries.filter((entry) => entry.state === 'changed').map((entry) => entry.name);
  const unverified = hooks.entries.filter((entry) => entry.state === 'unverified').map((entry) => entry.name);
  return { off, notReviewed, changed, unverified, total: hooks.entries.length };
}

// Setup's plugin-helper summary of the hook state: status, message and what runs.
function describeHookStates(hooks) {
  if (hooks.status === 'unreadable') {
    return { status: 'unreadable', message: 'Codex config.toml could not be read, so the Toolkit hook state is unknown. Open `/hooks` in Codex and check that the Toolkit hooks are on.', execution: 'unknown' };
  }
  if (hooks.status !== 'read' || !hooks.entries.length) {
    return { status: 'no-hooks-file', message: 'The installed Toolkit plugin has no readable hooks file, so the hook state is unknown.', execution: 'unknown' };
  }
  const { off, notReviewed, changed, unverified, total } = hookGaps(hooks);
  if (!off.length && !notReviewed.length && !changed.length && !unverified.length) return { status: 'on', message: `All ${total} Toolkit hooks are on in Codex.`, execution: 'running' };
  if (changed.length || unverified.length) return {
    status: changed.length ? 'changed' : 'unverified',
    message: `${hookGapText(hookGaps(hooks))}. Open \`/hooks\` in Codex, review and approve the updated Toolkit hooks, and check that they are on. Hold Codex gate launches until the check passes.`,
    execution: changed.length ? 'skipped: plugin contents changed' : 'unknown',
  };
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
  const gaps = state.hooks?.status === 'read' ? hookGaps(state.hooks) : { off: [], notReviewed: [], changed: [], unverified: [], total: 0 };
  if (gaps.changed.length || gaps.unverified.length) return `Codex: ${describeHookStates(state.hooks).message}`;
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
function hookGapText({ off, notReviewed, changed = [], unverified = [], total }) {
  if (off.length === total && total) return `all ${total} Toolkit hooks are off`;
  if (notReviewed.length === total && total) return `all ${total} Toolkit hooks are not reviewed`;
  const parts = [];
  if (off.length) parts.push(`off (${joinNames(off)})`);
  if (notReviewed.length) parts.push(`not reviewed (${joinNames(notReviewed)})`);
  if (changed.length) parts.push(`changed since approval (${joinNames(changed)})`);
  if (unverified.length) parts.push(`unverified (${joinNames(unverified)})`);
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
  pluginBundleFingerprint,
});

// Named failure: a gate launched after a plugin update with Codex's guards silently skipped.
if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check') {
    console.error('Usage: node toolkit-codex-install-state.cjs --check');
    process.exitCode = 2;
  } else {
    const state = new CodexToolkitInstall().read();
    const summary = describeHookStates(state.hooks || { status: 'unreadable', entries: [] });
    const on = state.config === 'read' && state.plugin === 'on' && state.versions?.length === 1 && summary.status === 'on';
    const recovery = [state.plugin !== 'on' ? 'Turn on the Toolkit plugin in Codex.' : '',
      state.versions?.length > 1 ? 'Repair the multiple installed Toolkit versions with setup toolkit.' : '',
      summary.status !== 'on' ? summary.message : ''].filter(Boolean).join(' ');
    console.log(on ? summary.message : `Codex gate launch held. ${recovery}`);
    process.exitCode = on ? 0 : 1;
  }
}
