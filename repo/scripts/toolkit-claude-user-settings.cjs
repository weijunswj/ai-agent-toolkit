'use strict';

// Owns the Claude Code user settings Toolkit recommends, each as one exact value in the Claude Code user
// settings file (~/.claude/settings.json):
//   attribution: false                      no Co-Authored-By trailers, PR footers or session links
//   crossSessionInbound: "accept"           messages from your other sessions (a Projects coordinator) wake this one
//   switchModelsOnFlag: false               pause and ask instead of switching models when a request is flagged
//   pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles: "claude-md-and-agents-md"
//                                           read AGENTS.md as well as CLAUDE.md
// Toolkit records, per setting and per settings file, that it wrote the value. A value the owner set by hand
// (any value Toolkit did not record) is reported and never changed or removed. Turning a setting off removes
// it only while it still holds the value Toolkit recorded, along with any parent objects Toolkit created.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalPath } = require('./toolkit-canonical-path.cjs');

const SETTINGS = Object.freeze([
  Object.freeze({ id: 'attribution', keyPath: ['attribution'], value: false, label: 'No AI attribution in commits and pull requests' }),
  Object.freeze({ id: 'cross-session-inbound', keyPath: ['crossSessionInbound'], value: 'accept', label: 'Messages from your other Claude sessions wake this one' }),
  Object.freeze({ id: 'switch-models-on-flag', keyPath: ['switchModelsOnFlag'], value: false, label: 'Ask before switching models when a request is flagged' }),
  Object.freeze({ id: 'agents-md', keyPath: ['pluginConfigs', 'cc-plugin-agents-md@builtin', 'options', 'instructionFiles'], value: 'claude-md-and-agents-md', label: 'Read AGENTS.md as well as CLAUDE.md' })
]);
const RECORD_SCHEMA = 'ai-agent-toolkit.claude-user-settings.v1';
const STATES = Object.freeze({ TOOLKIT: 'toolkit-value', OWNER: 'owner-value', DEFAULT: 'claude-default', UNREADABLE: 'unreadable' });

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Walks keyPath; returns { found, value } or { blocked } when a parent is not an object.
function lookup(settings, keyPath) {
  let node = settings;
  for (const key of keyPath.slice(0, -1)) {
    if (!Object.hasOwn(node, key)) return { found: false };
    if (!isObject(node[key])) return { blocked: true };
    node = node[key];
  }
  const leaf = keyPath[keyPath.length - 1];
  return Object.hasOwn(node, leaf) ? { found: true, value: node[leaf] } : { found: false };
}

// Returns a copy with the value set, plus the parent keys this write created (outermost first).
function withValue(settings, keyPath, value) {
  const result = structuredClone(settings);
  const created = [];
  let node = result;
  keyPath.slice(0, -1).forEach((key, index) => {
    if (!Object.hasOwn(node, key)) { node[key] = {}; created.push(keyPath.slice(0, index + 1)); }
    node = node[key];
  });
  node[keyPath[keyPath.length - 1]] = value;
  return { settings: result, created };
}

// Returns a copy without the value; parents listed in createdParents are removed when they end up empty.
function withoutValue(settings, keyPath, createdParents) {
  const result = structuredClone(settings);
  const parents = [result];
  for (const key of keyPath.slice(0, -1)) parents.push(parents[parents.length - 1][key]);
  delete parents[parents.length - 1][keyPath[keyPath.length - 1]];
  for (let depth = keyPath.length - 1; depth >= 1; depth -= 1) {
    const parentPath = keyPath.slice(0, depth);
    const node = parents[depth];
    if (Object.keys(node).length || !createdParents.some((created) => same(created, parentPath))) break;
    delete parents[depth - 1][parentPath[parentPath.length - 1]];
  }
  return result;
}

class ClaudeUserSettings {
  #settingsPath; #recordPath;

  constructor({ environment = process.env, controlRoot } = {}) {
    const configDir = environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const root = controlRoot || environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control');
    this.#settingsPath = path.resolve(configDir, 'settings.json');
    this.#recordPath = path.join(path.resolve(root), 'claude-user-settings.json');
  }

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
    if (!isObject(settings)) return { error: 'The Claude Code user settings file is not a JSON object.' };
    return { text, settings };
  }

  #readRecord() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#recordPath, 'utf8'));
      if (parsed?.schema === RECORD_SCHEMA && isObject(parsed.entries)) return parsed.entries;
    } catch { /* absent or unreadable reads as empty */ }
    return {};
  }

  #saveRecord(entries) {
    if (Object.keys(entries).length === 0) { fs.rmSync(this.#recordPath, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.#recordPath), { recursive: true });
    this.#atomicWrite(this.#recordPath, `${JSON.stringify({ schema: RECORD_SCHEMA, entries }, null, 2)}\n`);
  }

  #atomicWrite(file, text) {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(temp, file); }
    catch (error) { fs.rmSync(temp, { force: true }); throw error; }
  }

  // Writes only when the file still holds the bytes this run read, keeping a BOM and CRLF line endings.
  #writeSettings(read, settings) {
    const current = fs.existsSync(this.#settingsPath) ? fs.readFileSync(this.#settingsPath, 'utf8') : null;
    if (current !== read.text) throw new Error('The Claude Code user settings file changed while setup was running; run setup again.');
    if (settings === null) { fs.rmSync(this.#settingsPath, { force: true }); return; }
    const indent = read.text?.match(/^﻿?\{\r?\n(\s+)"/)?.[1] || 2;
    const bom = read.text?.startsWith('﻿') ? '﻿' : '';
    let body = `${JSON.stringify(settings, null, indent)}\n`;
    if (read.text?.includes('\r\n')) body = body.replace(/\n/g, '\r\n');
    fs.mkdirSync(path.dirname(this.#settingsPath), { recursive: true });
    this.#atomicWrite(this.#settingsPath, bom + body);
  }

  #entryKey(spec) { return `${spec.id}|${canonicalPath(this.#settingsPath)}`; }

  #stateOf(read, spec, entry) {
    if (read.error) return { id: spec.id, label: spec.label, state: STATES.UNREADABLE, detail: read.error };
    const found = lookup(read.settings, spec.keyPath);
    if (found.blocked) return { id: spec.id, label: spec.label, state: STATES.OWNER, value: null, detail: 'a parent entry is not an object' };
    if (!found.found) return { id: spec.id, label: spec.label, state: STATES.DEFAULT };
    if (entry && same(entry.value, found.value) && same(found.value, spec.value)) return { id: spec.id, label: spec.label, state: STATES.TOOLKIT, value: found.value };
    return { id: spec.id, label: spec.label, state: STATES.OWNER, value: found.value };
  }

  inspect() {
    const read = this.#readSettings();
    const entries = this.#readRecord();
    return SETTINGS.map((spec) => this.#stateOf(read, spec, entries[this.#entryKey(spec)]));
  }

  // choice: enable | disable | keep, applied to every managed setting in order. Each setting settles on its
  // own: owner values stay, an unreadable file holds everything, and the record keeps only live Toolkit values.
  apply(choice) {
    if (!['enable', 'disable', 'keep'].includes(choice)) throw new Error(`Unsupported Claude settings choice: ${choice}`);
    return SETTINGS.map((spec) => this.#applyOne(spec, choice));
  }

  #applyOne(spec, choice) {
    const read = this.#readSettings();
    const entries = this.#readRecord();
    const key = this.#entryKey(spec);
    const before = this.#stateOf(read, spec, entries[key]);
    // Re-reads the record, so an entry saved earlier in this call is removed too.
    const forget = () => { const now = this.#readRecord(); if (Object.hasOwn(now, key)) { delete now[key]; this.#saveRecord(now); } };
    if (before.state === STATES.UNREADABLE) return { status: 'held', changed: false, ...before };
    if (before.state === STATES.OWNER) { forget(); return { status: 'owner-value-kept', changed: false, ...before }; }
    if (choice === 'keep') {
      if (before.state !== STATES.TOOLKIT) forget();
      return { status: 'kept', changed: false, ...before };
    }
    if (choice === 'enable') {
      if (before.state === STATES.TOOLKIT) return { status: 'set', changed: false, ...before };
      const { settings, created } = withValue(read.settings, spec.keyPath, spec.value);
      // The file counts as Toolkit-created for every setting once any of them created it, so the last
      // setting turned off removes a file that holds nothing else.
      const pathSuffix = key.slice(spec.id.length);
      const fileCreated = read.text === null || Object.entries(entries).some(([other, value]) => other.endsWith(pathSuffix) && value?.created_file === true);
      const entry = { settings_path: this.#settingsPath, value: spec.value, created_parents: created, created_file: fileCreated };
      this.#saveRecord({ ...entries, [key]: entry });
      try { this.#writeSettings(read, settings); }
      catch (error) {
        try { forget(); } catch { /* the settings error is what the caller needs */ }
        throw error;
      }
      return { status: 'set', changed: true, id: spec.id, label: spec.label, state: STATES.TOOLKIT, value: spec.value };
    }
    if (before.state === STATES.DEFAULT) { forget(); return { status: 'claude-default', changed: false, ...before }; }
    const entry = entries[key];
    const settings = withoutValue(read.settings, spec.keyPath, Array.isArray(entry.created_parents) ? entry.created_parents : []);
    this.#writeSettings(read, entry.created_file === true && Object.keys(settings).length === 0 ? null : settings);
    forget();
    return { status: 'claude-default', changed: true, id: spec.id, label: spec.label, state: STATES.DEFAULT };
  }
}

module.exports = Object.freeze({ ClaudeUserSettings, SETTINGS, STATES });
