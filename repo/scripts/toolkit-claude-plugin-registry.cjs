'use strict';

// Reads Claude Code's plugin registry files to find the Toolkit copy Claude Code runs.
//
// Measured on Claude Code 2.1.304 and 2.1.306 (21 Oct 2026, isolated probe): a plugin
// from a local directory marketplace runs in place from that marketplace folder. Both the
// SessionStart and PreToolUse hooks receive CLAUDE_PLUGIN_ROOT set to that folder. The
// cache folder that `claude plugin install` writes is never executed.
// CLAUDE_CODE_PLUGIN_CACHE_DIR, when set, replaces the whole `<config>/plugins` folder.
//
// Toolkit's marketplace is always the managed checkout added as a `directory` source, so
// the copy Claude runs is that marketplace folder, provided the plugin is recorded as
// installed. Any other source type is not a Toolkit-managed install.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { samePath } = require('./toolkit-canonical-path.cjs');

const TOOLKIT_PLUGIN_NAME = 'ai-agent-toolkit';
const TOOLKIT_MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const TOOLKIT_PLUGIN_ID = `${TOOLKIT_PLUGIN_NAME}@${TOOLKIT_MARKETPLACE_NAME}`;

function readJsonIfExists(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return JSON.parse(text.replace(/^﻿/, ''));
}

class ClaudePluginRegistry {
  #environment; #homeDir; #state;

  // `state` ({ knownMarketplaces, installedPlugins }) replaces the file read, for callers
  // that already hold the parsed registry.
  constructor({ environment = process.env, homeDir = os.homedir(), state } = {}) {
    this.#environment = environment || {};
    this.#homeDir = homeDir;
    this.#state = state || null;
  }

  get configDir() {
    return path.resolve(this.#environment.CLAUDE_CONFIG_DIR || path.join(this.#homeDir, '.claude'));
  }

  get pluginsDir() {
    return path.resolve(this.#environment.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(this.configDir, 'plugins'));
  }

  #read() {
    if (!this.#state) {
      this.#state = {
        knownMarketplaces: readJsonIfExists(path.join(this.pluginsDir, 'known_marketplaces.json')),
        installedPlugins: readJsonIfExists(path.join(this.pluginsDir, 'installed_plugins.json')),
      };
    }
    return this.#state;
  }

  // { installed, records, runningRoot, reason }. `runningRoot` is the marketplace folder
  // Claude Code runs Toolkit from; `installed` needs both that folder and an install record.
  toolkitInstall() {
    let state;
    try { state = this.#read(); }
    catch { return { installed: false, records: [], runningRoot: '', reason: 'The Claude Code plugin registry files could not be read.' }; }
    const raw = state.installedPlugins?.plugins?.[TOOLKIT_PLUGIN_ID];
    const records = Array.isArray(raw) ? raw.filter((entry) => entry && typeof entry === 'object') : [];
    const source = state.knownMarketplaces?.[TOOLKIT_MARKETPLACE_NAME]?.source;
    const runningRoot = source?.source === 'directory' && typeof source.path === 'string' && source.path
      ? path.resolve(source.path)
      : '';
    if (!records.length) return { installed: false, records, runningRoot, reason: `${TOOLKIT_PLUGIN_ID} is not installed in Claude Code.` };
    if (!runningRoot) return { installed: false, records, runningRoot, reason: `The ${TOOLKIT_MARKETPLACE_NAME} marketplace is not a local folder Claude Code runs Toolkit from.` };
    return { installed: true, records, runningRoot, reason: '' };
  }

  // True only when `root` is the installed Toolkit copy Claude Code runs.
  isRunningCopy(root) {
    const install = this.toolkitInstall();
    return install.installed && samePath(root, install.runningRoot);
  }
}

module.exports = Object.freeze({
  ClaudePluginRegistry,
  TOOLKIT_PLUGIN_NAME,
  TOOLKIT_MARKETPLACE_NAME,
  TOOLKIT_PLUGIN_ID,
});
