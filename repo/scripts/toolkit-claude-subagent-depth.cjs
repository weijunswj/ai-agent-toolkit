'use strict';

// Owns the one Claude Code user setting Toolkit may write for subagent nesting:
// `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"` in the Claude Code user settings file.
// At 1 the main session may start subagents and a subagent may not start another.
// Toolkit records, per Claude Code user settings file, that it wrote the value. Turning the choice off removes
// the key only while it still holds the value Toolkit recorded for that same settings file; a value the owner
// set by hand is never changed or removed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { HostJsonConfigWrite } = require('./host-json-config-write.cjs');
const { canonicalPath } = require('./toolkit-canonical-path.cjs');

const SETTING = 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH';
// https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents
// (2026-10-23) documents 1 as disabling nested subagents.
const ONE_LAYER = '1';
// Record v2 sits in the control root: { schema, entries: { "<canonical settings path>": { settings_path, value, created_env, created_file } } }.
const RECORD_SCHEMA = 'ai-agent-toolkit.claude-subagent-depth.v2';
const STATES = Object.freeze({ TOOLKIT: 'toolkit-one-layer', OWNER: 'owner-value', DEFAULT: 'claude-default', UNREADABLE: 'unreadable' });
// Two setup runs at once could each read the record and lose the other's entry, so apply holds a
// lock file beside the record. A lock older than this is left over from a run that died.
const LOCK_STALE_MS = 60 * 1000;
const LOCK_WAIT_MS = 5 * 1000;

// Pure helpers over the record's entries; the class decides when they are written.
function entryOf(entries, key) { return Object.hasOwn(entries, key) ? entries[key] : undefined; }
function withoutEntry(entries, key) {
  const rest = { ...entries };
  delete rest[key];
  return rest;
}

class ClaudeSubagentDepthSetting {
  #settingsPath; #recordPath; #settingsWriter; #lockWaitMs;

  constructor({ environment = process.env, controlRoot, settingsWriteOptions, lockWaitMs = LOCK_WAIT_MS } = {}) {
    this.#lockWaitMs = lockWaitMs;
    const configDir = environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const root = controlRoot || environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control');
    this.#settingsPath = path.resolve(configDir, 'settings.json');
    this.#settingsWriter = new HostJsonConfigWrite(this.#settingsPath, path.join(path.resolve(root), 'backups', 'claude-settings'), settingsWriteOptions);
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

  // The ownership record as { entries }. A record in any other schema reads as empty.
  #readRecord() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.#recordPath, 'utf8')); }
    catch { return { entries: {} }; }
    if (parsed?.schema === RECORD_SCHEMA) {
      const entries = parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries) ? parsed.entries : {};
      return { entries };
    }
    return { entries: {} };
  }

  // No entries left means no record file, so an empty record is never left behind.
  #saveRecord(entries) {
    if (Object.keys(entries).length === 0) { fs.rmSync(this.#recordPath, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.#recordPath), { recursive: true });
    this.#atomicWrite(this.#recordPath, `${JSON.stringify({ schema: RECORD_SCHEMA, entries }, null, 2)}\n`);
  }

  // Drops only this settings file's entry; entries for other settings files are never touched.
  #forgetEntry(key, record) {
    if (Object.hasOwn(record.entries, key)) this.#saveRecord(withoutEntry(record.entries, key));
  }

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
    if (settings === null) { this.#settingsWriter.run(read.text, null); return; }
    const indent = read.text?.match(/^\{\r?\n(\s+)"/)?.[1] || 2;
    fs.mkdirSync(path.dirname(this.#settingsPath), { recursive: true });
    this.#settingsWriter.run(read.text, `${JSON.stringify(settings, null, indent)}\n`);
  }

  #stateOf(read, entry) {
    if (read.error) return { state: STATES.UNREADABLE, detail: read.error };
    const env = read.settings.env;
    if (!env || !Object.hasOwn(env, SETTING)) return { state: STATES.DEFAULT };
    const value = String(env[SETTING]);
    return entry?.value === value ? { state: STATES.TOOLKIT, value } : { state: STATES.OWNER, value };
  }

  inspect() {
    return this.#stateOf(this.#readSettings(), entryOf(this.#readRecord().entries, canonicalPath(this.#settingsPath)));
  }

  // choice: enable | disable | keep. Returns { status, changed, state, value?, detail? }.
  // Every choice settles this settings file's entry: it is dropped when the key is absent or the owner changed
  // it, and kept while Toolkit still owns the value.
  apply(choice) {
    if (!['enable', 'disable', 'keep'].includes(choice)) throw new Error(`Unsupported Claude subagent depth choice: ${choice}`);
    return this.#withRecordLock(() => this.#applyLocked(choice));
  }

  // Runs work while holding the record's lock file, created exclusively. Waits briefly for another run,
  // takes over a stale lock, and otherwise fails with a plain reason, changing nothing.
  #withRecordLock(work) {
    const lock = `${this.#recordPath}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const deadline = Date.now() + this.#lockWaitMs;
    for (;;) {
      try { fs.writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let age = 0;
        try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
        if (age > LOCK_STALE_MS) { fs.rmSync(lock, { force: true }); continue; }
        if (Date.now() >= deadline) throw new Error('Another Toolkit setup run is changing the Claude Code depth setting; wait for it to finish, then run setup again.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
    try { return work(); }
    finally { fs.rmSync(lock, { force: true }); }
  }

  #applyLocked(choice) {
    const read = this.#readSettings();
    const key = canonicalPath(this.#settingsPath);
    const record = this.#readRecord();
    const before = this.#stateOf(read, entryOf(record.entries, key));
    if (choice === 'keep') {
      this.#settleKeep(key, record, before.state);
      return { status: 'kept', changed: false, ...before };
    }
    if (before.state === STATES.UNREADABLE) return { status: 'held', changed: false, ...before };
    // A value the owner set by hand stays exactly as it is; any stale entry for this file goes.
    if (before.state === STATES.OWNER) {
      this.#forgetEntry(key, record);
      return { status: 'owner-value-kept', changed: false, ...before };
    }
    if (choice === 'enable') {
      if (before.state === STATES.TOOLKIT) return { status: 'one-layer', changed: false, ...before };
      this.#turnOn(read, key, record);
      return { status: 'one-layer', changed: true, state: STATES.TOOLKIT, value: ONE_LAYER };
    }
    if (before.state === STATES.DEFAULT) {
      this.#forgetEntry(key, record);
      return { status: 'claude-default', changed: false, ...before };
    }
    this.#turnOff(read, key, record);
    return { status: 'claude-default', changed: true, state: STATES.DEFAULT };
  }

  // keep changes no setting. A stale entry is dropped; an unreadable file leaves the entry alone, because the
  // key cannot be judged.
  #settleKeep(key, record, state) {
    if (state !== STATES.TOOLKIT && state !== STATES.UNREADABLE) this.#forgetEntry(key, record);
  }

  // Intent first: the entry is recorded before the setting is written, so a failed record write leaves the
  // settings untouched, and a failed settings write takes the entry back out before the error is rethrown.
  #turnOn(read, key, record) {
    const entry = { settings_path: this.#settingsPath, value: ONE_LAYER, created_env: read.settings.env === undefined, created_file: read.text === null };
    const settings = { ...read.settings, env: { ...(read.settings.env || {}), [SETTING]: ONE_LAYER } };
    this.#saveRecord({ ...record.entries, [key]: entry });
    try { this.#writeSettings(read, settings); }
    catch (error) {
      // The settings error is what the caller needs; if this clean-up also fails, the next apply drops the entry.
      try { this.#saveRecord(withoutEntry(record.entries, key)); } catch { /* reported through the settings error */ }
      throw error;
    }
  }

  // Toolkit-owned: remove exactly the key, plus the env object and file only if Toolkit created them, then the entry.
  #turnOff(read, key, record) {
    const entry = entryOf(record.entries, key);
    const env = { ...read.settings.env };
    delete env[SETTING];
    const settings = { ...read.settings, env };
    if (entry.created_env === true && Object.keys(env).length === 0) delete settings.env;
    this.#writeSettings(read, entry.created_file === true && Object.keys(settings).length === 0 ? null : settings);
    this.#saveRecord(withoutEntry(record.entries, key));
  }
}

module.exports = Object.freeze({ ClaudeSubagentDepthSetting, SETTING, ONE_LAYER, STATES, LOCK_STALE_MS });
