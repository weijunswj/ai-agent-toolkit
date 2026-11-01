'use strict';

// Owns the Claude Code user settings Toolkit recommends, each as one exact value in the Claude Code user
// settings file (~/.claude/settings.json):
//   attribution: false                      no Co-Authored-By trailers, PR footers or session links
//   crossSessionInbound: "accept"           messages from your other sessions (a Projects coordinator) wake this one
//   switchModelsOnFlag: true / false        on (Claude Code's default) switches models without asking when a
//                                           request is flagged; off pauses and asks first
//   pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles: "claude-md-and-agents-md"
//                                           read AGENTS.md as well as CLAUDE.md
// Toolkit records, per setting and per settings file, that it wrote the value. A value the owner set by hand
// (any value Toolkit did not record) is reported, with whether it matches the on value. Turning a setting on
// sets its on value, replacing a different one; turning it off removes that one key whoever set it, or, for a
// setting with an offValue, writes that value. Parent objects and the file itself are removed only when they
// end up empty and Toolkit's record says Toolkit created them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { HostJsonConfigWrite } = require('./host-json-config-write.cjs');
const { canonicalPath } = require('./toolkit-canonical-path.cjs');

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Claude Code also takes attribution as an object; empty commit and pr strings with sessionUrl false hide
// everything false hides, so that full form counts as Toolkit's pick. A partial object still adds something.
const hidesAllAttribution = (value) => value === false
  || (isObject(value) && value.commit === '' && value.pr === '' && value.sessionUrl === false);

// Existing Toolkit projections below are not a claim of host acceptance.
// JSON read-back checks integrity; host schema/behaviour still requires restart/turn UAT.
// value is the on value. equivalent, when present, says which owner values do what it does; others compare
// exactly. offValue, when present, is written by Turn off instead of removing the key, and defaultOn says a
// missing key already behaves as on. recommend is the choice offered while none of these settings is set.
const SETTINGS = Object.freeze([
  Object.freeze({ id: 'attribution', keyPath: ['attribution'], value: false, equivalent: hidesAllAttribution, label: 'No AI attribution in commits and pull requests' }),
  Object.freeze({ id: 'cross-session-inbound', keyPath: ['crossSessionInbound'], value: 'accept', label: 'Messages from your other Claude sessions wake this one' }),
  Object.freeze({ id: 'switch-models-on-flag', keyPath: ['switchModelsOnFlag'], value: true, offValue: false, defaultOn: true, recommend: 'disable', label: 'Switch models without asking when a request is flagged' }),
  Object.freeze({ id: 'agents-md', keyPath: ['pluginConfigs', 'cc-plugin-agents-md@builtin', 'options', 'instructionFiles'], value: 'claude-md-and-agents-md', label: 'Read AGENTS.md as well as CLAUDE.md' })
]);
const RECORD_SCHEMA = 'ai-agent-toolkit.claude-user-settings.v1';
const STATES = Object.freeze({ TOOLKIT: 'toolkit-value', OWNER: 'owner-value', OFF: 'off-value', DEFAULT: 'claude-default', UNREADABLE: 'unreadable' });


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
  #settingsPath; #recordPath; #settingsWriter;

  constructor({ environment = process.env, controlRoot, settingsWriteOptions } = {}) {
    const configDir = environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const root = controlRoot || environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control');
    this.#settingsPath = path.resolve(configDir, 'settings.json');
    this.#settingsWriter = new HostJsonConfigWrite(this.#settingsPath, path.join(path.resolve(root), 'backups', 'claude-settings'), settingsWriteOptions);
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
    if (settings === null) { this.#settingsWriter.run(read.text, null); return; }
    const indent = read.text?.match(/^﻿?\{\r?\n(\s+)"/)?.[1] || 2;
    const bom = read.text?.startsWith('﻿') ? '﻿' : '';
    let body = `${JSON.stringify(settings, null, indent)}\n`;
    if (read.text?.includes('\r\n')) body = body.replace(/\n/g, '\r\n');
    fs.mkdirSync(path.dirname(this.#settingsPath), { recursive: true });
    this.#settingsWriter.run(read.text, bom + body);
  }

  #entryKey(spec) { return `${spec.id}|${canonicalPath(this.#settingsPath)}`; }

  #stateOf(read, spec, entry) {
    if (read.error) return { id: spec.id, label: spec.label, state: STATES.UNREADABLE, detail: read.error };
    const found = lookup(read.settings, spec.keyPath);
    if (found.blocked) return { id: spec.id, label: spec.label, state: STATES.OWNER, value: null, matches: false, blocked: true, detail: 'a parent entry is not an object' };
    if (!found.found) return { id: spec.id, label: spec.label, state: STATES.DEFAULT };
    // toolkit says whether setup wrote the off value; either way it is off.
    if (Object.hasOwn(spec, 'offValue') && same(found.value, spec.offValue)) return { id: spec.id, label: spec.label, state: STATES.OFF, value: found.value, toolkit: Boolean(entry) && same(entry.value, found.value) };
    if (entry && same(entry.value, found.value) && same(found.value, spec.value)) return { id: spec.id, label: spec.label, state: STATES.TOOLKIT, value: found.value };
    // matches tells an owner value equal to Toolkit's pick (on already) apart from a different one.
    return { id: spec.id, label: spec.label, state: STATES.OWNER, value: found.value, matches: spec.equivalent ? spec.equivalent(found.value) : same(found.value, spec.value) };
  }

  inspect() {
    const read = this.#readSettings();
    const entries = this.#readRecord();
    return SETTINGS.map((spec) => this.#stateOf(read, spec, entries[this.#entryKey(spec)]));
  }

  // choices: enable | disable | keep for every managed setting, or { <setting id>: enable | disable | keep }
  // where a setting left out is kept. Settings apply in order and each settles on its own: an unreadable file
  // or a parent entry that is not an object holds that setting, and the record keeps only live Toolkit values.
  apply(choices) {
    const byId = typeof choices === 'string' ? Object.fromEntries(SETTINGS.map((spec) => [spec.id, choices])) : choices;
    if (!isObject(byId)) throw new Error('Unsupported Claude settings choices.');
    for (const [id, choice] of Object.entries(byId)) {
      if (!SETTINGS.some((spec) => spec.id === id)) throw new Error(`Unknown Claude setting: ${id}`);
      if (!['enable', 'disable', 'keep'].includes(choice)) throw new Error(`Unsupported Claude settings choice: ${choice}`);
    }
    return SETTINGS.map((spec) => this.#applyOne(spec, byId[spec.id] || 'keep'));
  }

  #applyOne(spec, choice) {
    const read = this.#readSettings();
    const entries = this.#readRecord();
    const key = this.#entryKey(spec);
    const before = this.#stateOf(read, spec, entries[key]);
    // Re-reads the record, so an entry saved earlier in this call is removed too.
    const forget = () => { const now = this.#readRecord(); if (Object.hasOwn(now, key)) { delete now[key]; this.#saveRecord(now); } };
    if (before.state === STATES.UNREADABLE) return { status: 'held', changed: false, ...before };
    if (choice === 'keep') {
      if (before.state !== STATES.TOOLKIT && !before.toolkit) forget();
      return { status: 'kept', changed: false, ...before };
    }
    // Replacing or removing under a parent that is not an object would discard more than this one setting.
    if (before.blocked) { forget(); return { status: 'held', changed: false, ...before }; }
    // The file counts as Toolkit-created for every setting once any of them created it, so the last
    // setting turned off removes a file that holds nothing else.
    const pathSuffix = key.slice(spec.id.length);
    const fileCreated = Object.entries(entries).some(([other, value]) => other.endsWith(pathSuffix) && value?.created_file === true);
    // Writes value and records it; a value replacing another keeps its existing parents, so created stays empty.
    const write = (value) => {
      const { settings, created } = withValue(read.settings, spec.keyPath, value);
      this.#saveRecord({ ...entries, [key]: { settings_path: this.#settingsPath, value, created_parents: created, created_file: read.text === null || fileCreated } });
      try { this.#writeSettings(read, settings); }
      catch (error) {
        try { forget(); } catch { /* the settings error is what the caller needs */ }
        throw error;
      }
    };
    if (choice === 'enable') {
      if (before.state === STATES.TOOLKIT) return { status: 'set', changed: false, ...before };
      // An owner value that already does what the on value does, or a missing key that defaults to on, is on
      // already, so nothing is written.
      if ((before.state === STATES.OWNER && before.matches === true) || (before.state === STATES.DEFAULT && spec.defaultOn)) {
        forget();
        return { status: 'set', changed: false, ...before };
      }
      write(spec.value);
      return { status: 'set', changed: true, id: spec.id, label: spec.label, state: STATES.TOOLKIT, value: spec.value };
    }
    if (Object.hasOwn(spec, 'offValue')) {
      // Off is an explicit value here: a missing key would mean on.
      if (before.state === STATES.OFF) return { status: 'off', changed: false, ...before };
      write(spec.offValue);
      return { status: 'off', changed: true, id: spec.id, label: spec.label, state: STATES.OFF, value: spec.offValue, toolkit: true };
    }
    if (before.state === STATES.DEFAULT) { forget(); return { status: 'claude-default', changed: false, ...before }; }
    // Off removes the key whoever set it; only a live Toolkit value's record names parents Toolkit created.
    const entry = before.state === STATES.TOOLKIT ? entries[key] : null;
    const settings = withoutValue(read.settings, spec.keyPath, Array.isArray(entry?.created_parents) ? entry.created_parents : []);
    this.#writeSettings(read, fileCreated && Object.keys(settings).length === 0 ? null : settings);
    forget();
    return { status: 'claude-default', changed: true, id: spec.id, label: spec.label, state: STATES.DEFAULT };
  }
}

module.exports = Object.freeze({ ClaudeUserSettings, SETTINGS, STATES });
