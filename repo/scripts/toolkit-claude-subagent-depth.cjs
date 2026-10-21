'use strict';

// Owns the one Claude Code user setting Toolkit may write for subagent nesting:
// `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"` in the Claude Code user settings file.
// At 1 the main session may start subagents and a subagent may not start another.
// Toolkit records that it wrote the value. Turning the choice off removes the key only
// while it still holds the value Toolkit recorded for that same settings file; a value
// the owner set by hand is never changed or removed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SETTING = 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH';
const ONE_LAYER = '1';
const RECORD_SCHEMA = 'ai-agent-toolkit.claude-subagent-depth.v1';
const STATES = Object.freeze({ TOOLKIT: 'toolkit-one-layer', OWNER: 'owner-value', DEFAULT: 'claude-default', UNREADABLE: 'unreadable' });

class ClaudeSubagentDepthSetting {
  #settingsPath; #recordPath;

  constructor({ environment = process.env, controlRoot } = {}) {
    const configDir = environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const root = controlRoot || environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control');
    this.#settingsPath = path.resolve(configDir, 'settings.json');
    this.#recordPath = path.join(path.resolve(root), 'claude-subagent-depth.json');
  }

  // The settings file as raw text and parsed object; null text when the file is absent.
  #readSettings() {
    let text;
    try { text = fs.readFileSync(this.#settingsPath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { text: null, settings: {} };
      return { error: 'The Claude Code user settings file could not be read.' };
    }
    let settings;
    try { settings = JSON.parse(text.replace(/^﻿/, '')); }
    catch { return { error: 'The Claude Code user settings file is not valid JSON.' }; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { error: 'The Claude Code user settings file is not a JSON object.' };
    const env = settings.env;
    if (env !== undefined && (!env || typeof env !== 'object' || Array.isArray(env))) return { error: 'The Claude Code user settings `env` entry is not an object.' };
    return { text, settings };
  }

  #readRecord() {
    try {
      const record = JSON.parse(fs.readFileSync(this.#recordPath, 'utf8'));
      return record?.schema === RECORD_SCHEMA && record.settings_path === this.#settingsPath ? record : null;
    } catch { return null; }
  }

  #writeRecord(record) {
    fs.mkdirSync(path.dirname(this.#recordPath), { recursive: true });
    this.#atomicWrite(this.#recordPath, `${JSON.stringify(record, null, 2)}\n`);
  }

  #removeRecord() { fs.rmSync(this.#recordPath, { force: true }); }

  #atomicWrite(file, text) {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(temp, file); }
    catch (error) { fs.rmSync(temp, { force: true }); throw error; }
  }

  // Writes the settings only when the file still holds the bytes this run read, so a
  // concurrent edit by Claude Code or the owner is never overwritten.
  #writeSettings(read, settings) {
    const current = fs.existsSync(this.#settingsPath) ? fs.readFileSync(this.#settingsPath, 'utf8') : null;
    if (current !== read.text) throw new Error('The Claude Code user settings file changed while setup was running; run setup again.');
    if (settings === null) { fs.rmSync(this.#settingsPath, { force: true }); return; }
    const indent = read.text?.match(/^\{\r?\n(\s+)"/)?.[1] || 2;
    fs.mkdirSync(path.dirname(this.#settingsPath), { recursive: true });
    this.#atomicWrite(this.#settingsPath, `${JSON.stringify(settings, null, indent)}\n`);
  }

  #stateOf(read, record) {
    if (read.error) return { state: STATES.UNREADABLE, detail: read.error };
    const env = read.settings.env;
    if (!env || !Object.hasOwn(env, SETTING)) return { state: STATES.DEFAULT };
    const value = String(env[SETTING]);
    return record && record.value === value ? { state: STATES.TOOLKIT, value } : { state: STATES.OWNER, value };
  }

  inspect() {
    return this.#stateOf(this.#readSettings(), this.#readRecord());
  }

  // choice: enable | disable | keep. Returns { status, changed, state, value?, detail? }.
  apply(choice) {
    const read = this.#readSettings();
    const record = this.#readRecord();
    const before = this.#stateOf(read, record);
    if (choice === 'keep') return { status: 'kept', changed: false, ...before };
    if (!['enable', 'disable'].includes(choice)) throw new Error(`Unsupported Claude subagent depth choice: ${choice}`);
    if (before.state === STATES.UNREADABLE) return { status: 'held', changed: false, ...before };
    // A value the owner set by hand stays exactly as it is; any stale Toolkit record goes.
    if (before.state === STATES.OWNER) {
      if (record) this.#removeRecord();
      return { status: 'owner-value-kept', changed: false, ...before };
    }
    if (choice === 'enable') {
      if (before.state === STATES.TOOLKIT) return { status: 'one-layer', changed: false, ...before };
      const createdFile = read.text === null;
      const createdEnv = read.settings.env === undefined;
      const settings = { ...read.settings, env: { ...(read.settings.env || {}), [SETTING]: ONE_LAYER } };
      this.#writeSettings(read, settings);
      this.#writeRecord({ schema: RECORD_SCHEMA, settings_path: this.#settingsPath, value: ONE_LAYER, created_env: createdEnv, created_file: createdFile });
      return { status: 'one-layer', changed: true, state: STATES.TOOLKIT, value: ONE_LAYER };
    }
    if (before.state === STATES.DEFAULT) {
      if (record) this.#removeRecord();
      return { status: 'claude-default', changed: false, ...before };
    }
    // Toolkit-owned: remove exactly the key, plus the env object and file only if Toolkit created them.
    const env = { ...read.settings.env };
    delete env[SETTING];
    const settings = { ...read.settings, env };
    if (record.created_env === true && Object.keys(env).length === 0) delete settings.env;
    this.#writeSettings(read, record.created_file === true && Object.keys(settings).length === 0 ? null : settings);
    this.#removeRecord();
    return { status: 'claude-default', changed: true, state: STATES.DEFAULT };
  }
}

module.exports = Object.freeze({ ClaudeSubagentDepthSetting, SETTING, ONE_LAYER, STATES });
