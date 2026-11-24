#!/usr/bin/env node
'use strict';

// Controller settings: the stack profile, the number of live lanes and where gates run, as one small
// file the controller keeps in the evidence store, read by every controller type. The project lines
// and the GATE ROUTE memory line are rendered from it, so they are never kept as prose that drifts
// (a Projects instructions file once carried a stack line, a lanes line and a "gates on my computer"
// line that each said something different from the others and from the controller's memory).
//
//   node repo/scripts/toolkit-controller-settings.cjs show   --file <settings.json> [--json]
//   node repo/scripts/toolkit-controller-settings.cjs render --file <settings.json> [--json]
//   node repo/scripts/toolkit-controller-settings.cjs set    --file <settings.json> --owner-said "<the owner's words>"
//          [--repository <owner/name>] [--stack-profile <id>] [--live-lanes <1-9>]
//          [--placement <remote_control|cloud|any>[,G0=<place>][,G1=<place>][,G2=<place>]]
//          [--device <name> | --device none] [--folder <path> | --folder none] [--json]
//
// Who may do what (the controller flow model): only a controller session writes, and only on the
// owner's word, which it passes as --owner-said and which is kept with the change; a Toolkit gate
// session (TOOLKIT_GATE_ROLE set) is refused. Helpers never run it (a written rule: a helper process
// cannot be told apart from its lead's). `show` and `render` only read. Every write is read back.
//
// The file lives in the evidence store at state/<owner>/<repo>/controller-settings.json and is
// saved there with `toolkit-store.cjs save`, as `set` prints; nothing here pushes. The reader is
// default-deny: any key, type or character outside the stated forms makes the whole file unreadable,
// and nothing is rendered from it.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'toolkit.controller-settings.v1';
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const PLACES = Object.freeze(['remote_control', 'cloud', 'any']);
const GATES = Object.freeze(['G0', 'G1', 'G2']);
const MAX_LANES = 9;
const MAX_CHANGES = 20;
const KEYS = Object.freeze(['schema', 'repository', 'stack_profile', 'live_lanes', 'placement', 'changes']);
const PLACEMENT_KEYS = Object.freeze(['default', 'gates', 'device', 'folder']);
const CHANGE_KEYS = Object.freeze(['at', 'keys', 'owner_said']);
// Plain ASCII forms only, so a line break, an invisible or look-alike character never reaches a
// rendered line.
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DEVICE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const FOLDER = /^[A-Za-z0-9._:\\/~-][A-Za-z0-9 ._:\\/~-]{0,198}[A-Za-z0-9._:\\/~-]$/;
const SAID = /^[\x20-\x7e]{1,500}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class SettingsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const onlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

// The settings as stored, checked key by key; throws SettingsError SETTINGS_INVALID on anything else.
// `profiles` are the stack registry's profile ids.
function readSettings(text, profiles) {
  let value;
  try { value = JSON.parse(String(text)); } catch { throw new SettingsError('SETTINGS_INVALID', 'The controller settings file is not JSON.'); }
  const bad = what => { throw new SettingsError('SETTINGS_INVALID', `The controller settings file has ${what}.`); };
  if (!plainObject(value) || !onlyKeys(value, KEYS)) bad('a key Toolkit does not know');
  if (value.schema !== SCHEMA) bad('another schema');
  if (typeof value.repository !== 'string' || !REPOSITORY.test(value.repository)) bad('no readable repository');
  if (typeof value.stack_profile !== 'string' || !PROFILE.test(value.stack_profile) || !profiles.includes(value.stack_profile)) bad('a stack profile the stack registry does not have');
  if (!Number.isInteger(value.live_lanes) || value.live_lanes < 1 || value.live_lanes > MAX_LANES) bad(`a live lanes count outside 1 to ${MAX_LANES}`);
  const placement = value.placement;
  if (!plainObject(placement) || !onlyKeys(placement, PLACEMENT_KEYS) || !PLACES.includes(placement.default)) bad('no readable placement');
  if (placement.gates !== undefined && (!plainObject(placement.gates) || !Object.entries(placement.gates).every(([gate, place]) => GATES.includes(gate) && PLACES.includes(place)))) bad('a per-gate placement Toolkit does not know');
  if (placement.device !== undefined && (typeof placement.device !== 'string' || !DEVICE.test(placement.device))) bad('an unreadable device name');
  if (placement.folder !== undefined && (typeof placement.folder !== 'string' || !FOLDER.test(placement.folder))) bad('an unreadable folder');
  if (!Array.isArray(value.changes) || value.changes.length > MAX_CHANGES || !value.changes.every(change => plainObject(change) && onlyKeys(change, CHANGE_KEYS)
    && typeof change.at === 'string' && AT.test(change.at) && Array.isArray(change.keys) && change.keys.length > 0 && change.keys.every(key => ['stack_profile', 'live_lanes', 'placement', 'repository'].includes(key))
    && typeof change.owner_said === 'string' && SAID.test(change.owner_said))) bad('an unreadable change record');
  return value;
}

// "remote_control,G2=cloud" -> { default, gates? }, or throws.
function parsePlacement(text) {
  const parts = String(text || '').split(',').map(part => part.trim());
  const [first, ...rest] = parts;
  if (!PLACES.includes(first)) throw new SettingsError('SETTINGS_ARGUMENTS', `--placement starts with one of ${PLACES.join(', ')}.`);
  const gates = {};
  for (const part of rest) {
    const match = /^(G[012])=(remote_control|cloud|any)$/.exec(part);
    if (!match || Object.hasOwn(gates, match[1])) throw new SettingsError('SETTINGS_ARGUMENTS', '--placement takes per-gate entries such as G2=cloud, each gate once.');
    if (match[2] !== first) gates[match[1]] = match[2];
  }
  return Object.keys(gates).length ? { default: first, gates } : { default: first };
}

// The lines rendered from the settings: the project instructions' lines and the GATE ROUTE memory
// line. `since` is the date (YYYY-MM-DD) the live lanes count was last set.
function renderLines(settings) {
  const placement = settings.placement;
  const gates = Object.entries(placement.gates || {}).sort(([a], [b]) => a.localeCompare(b));
  const words = { remote_control: 'on this device by Remote Control', cloud: 'in cloud threads', any: 'wherever the controller starts them' };
  const lanesSet = [...settings.changes].reverse().find(change => change.keys.includes('live_lanes'));
  const since = (lanesSet || settings.changes.at(-1))?.at.slice(0, 10) || null;
  const where = [`Gates run ${words[placement.default]}`, ...gates.map(([gate, place]) => `${gate} ${words[place]}`)].join('; ');
  const on = placement.device || placement.folder ? ` (${[placement.device, placement.folder].filter(Boolean).join(', ')})` : '';
  const route = ['GATE ROUTE:', 'profile', settings.stack_profile, 'lanes', String(settings.live_lanes), 'placement', placement.default,
    ...gates.map(([gate, place]) => `${gate}=${place}`), ...(placement.folder ? ['folder', placement.folder] : [])].join(' ');
  return {
    project_lines: [
      `- Lanes: ${settings.live_lanes} working lane${settings.live_lanes === 1 ? '' : 's'} (owner${since ? `, ${since}` : ''})`,
      `- Stack profile: ${settings.stack_profile}`,
      `- ${where}${on}.`,
    ],
    gate_route: route,
  };
}

// The path in the evidence store this repository's settings are saved at.
function storePath(repository) {
  const [owner, name] = repository.split('/');
  return `state/${owner}/${name}/controller-settings.json`;
}

class ControllerSettings {
  #file; #readFile; #writeFile; #now; #environment; #profiles;

  constructor({ file, root = path.resolve(__dirname, '..', '..'), readFile = fs.readFileSync, writeFile = null, now = () => new Date(), environment = process.env, profiles = null } = {}) {
    if (typeof file !== 'string' || !file) throw new SettingsError('SETTINGS_ARGUMENTS', 'Name the settings file with --file.');
    this.#file = path.resolve(file);
    this.#readFile = readFile;
    this.#writeFile = writeFile || ((target, text) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      try { fs.writeFileSync(temp, text); fs.renameSync(temp, target); } finally { fs.rmSync(temp, { force: true }); }
    });
    this.#now = now;
    this.#environment = environment;
    this.#profiles = profiles || Object.keys(JSON.parse(readFile(path.join(root, REGISTRY_REL), 'utf8')).profiles || {});
  }

  // The stored settings, or null when the file does not exist yet.
  read() {
    let text;
    try { text = this.#readFile(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw new SettingsError('SETTINGS_UNREADABLE', 'The controller settings file could not be read.');
    }
    return readSettings(text, this.#profiles);
  }

  render() {
    const settings = this.read();
    if (!settings) throw new SettingsError('SETTINGS_MISSING', 'There are no controller settings yet: set them on the owner\'s word first.');
    return { settings, ...renderLines(settings) };
  }

  // Applies the owner's changes ({ repository?, stack_profile?, live_lanes?, placement?, device?,
  // folder? }, device or folder null to remove) with their words, writes once and reads back.
  set(changes, { ownerSaid }) {
    const role = this.#environment.TOOLKIT_GATE_ROLE;
    if (role) throw new SettingsError('SETTINGS_ROLE', `A ${GATES.includes(role) ? role : 'gate'} session cannot change controller settings: only the controller does, on the owner's word.`);
    if (typeof ownerSaid !== 'string' || !SAID.test(ownerSaid.trim())) throw new SettingsError('SETTINGS_ARGUMENTS', 'Pass the owner\'s own words with --owner-said (plain text, up to 500 characters): settings change only on the owner\'s word.');
    const before = this.read();
    const next = before ? JSON.parse(JSON.stringify(before)) : { schema: SCHEMA, repository: null, stack_profile: null, live_lanes: 1, placement: { default: 'remote_control' }, changes: [] };
    const changed = [];
    const take = (key, value) => { if (JSON.stringify(next[key]) !== JSON.stringify(value)) { next[key] = value; changed.push(key); } };
    if (changes.repository !== undefined) take('repository', changes.repository);
    if (changes.stack_profile !== undefined) take('stack_profile', changes.stack_profile);
    if (changes.live_lanes !== undefined) take('live_lanes', changes.live_lanes);
    if (changes.placement !== undefined || changes.device !== undefined || changes.folder !== undefined) {
      const placement = { ...(changes.placement || { default: next.placement.default, ...(next.placement.gates ? { gates: next.placement.gates } : {}) }) };
      for (const key of ['device', 'folder']) {
        const value = changes[key] === undefined ? next.placement[key] : changes[key];
        if (value !== null && value !== undefined) placement[key] = value;
      }
      take('placement', placement);
    }
    if (!changed.length) return { changed: [], settings: before, ...renderLines(before) };
    next.changes = [...next.changes, { at: this.#now().toISOString(), keys: changed, owner_said: ownerSaid.trim() }].slice(-MAX_CHANGES);
    const text = `${JSON.stringify(next, null, 2)}\n`;
    // The same checks as a read, before anything is written.
    readSettings(text, this.#profiles);
    this.#writeFile(this.#file, text);
    let readBack;
    try { readBack = this.#readFile(this.#file, 'utf8'); } catch { readBack = null; }
    if (readBack !== text) throw new SettingsError('SETTINGS_READBACK', 'The controller settings were written but did not read back the same; check the file before using it.');
    return { changed, settings: next, ...renderLines(next) };
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['show', 'render', 'set'].includes(command)) throw new SettingsError('SETTINGS_ARGUMENTS', USAGE);
  const options = { command, json: false, changes: {} };
  const value = (flag, index) => {
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) throw new SettingsError('SETTINGS_ARGUMENTS', `${flag} needs a value.`);
    return next;
  };
  const once = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--json') { options.json = true; continue; }
    if (once.has(flag)) throw new SettingsError('SETTINGS_ARGUMENTS', `${flag} is given twice.`);
    once.add(flag);
    const text = value(flag, index);
    index += 1;
    if (flag === '--file') options.file = text;
    else if (command !== 'set') throw new SettingsError('SETTINGS_ARGUMENTS', `${command} takes only --file and --json.`);
    else if (flag === '--owner-said') options.ownerSaid = text;
    else if (flag === '--repository') {
      if (!REPOSITORY.test(text)) throw new SettingsError('SETTINGS_ARGUMENTS', '--repository is owner/name.');
      options.changes.repository = text;
    } else if (flag === '--stack-profile') options.changes.stack_profile = text;
    else if (flag === '--live-lanes') {
      if (!/^[1-9]$/.test(text)) throw new SettingsError('SETTINGS_ARGUMENTS', `--live-lanes is a whole number from 1 to ${MAX_LANES}.`);
      options.changes.live_lanes = Number(text);
    } else if (flag === '--placement') options.changes.placement = parsePlacement(text);
    else if (flag === '--device') options.changes.device = text === 'none' ? null : text;
    else if (flag === '--folder') options.changes.folder = text === 'none' ? null : text;
    else throw new SettingsError('SETTINGS_ARGUMENTS', `Unknown flag ${flag}.`);
  }
  if (!options.file) throw new SettingsError('SETTINGS_ARGUMENTS', 'Name the settings file with --file.');
  if (command === 'set' && !Object.keys(options.changes).length) throw new SettingsError('SETTINGS_ARGUMENTS', 'set needs at least one setting to change.');
  return options;
}

const USAGE = 'Usage: toolkit-controller-settings.cjs show|render|set --file <settings.json> [set: --owner-said "<words>" and --repository, --stack-profile, --live-lanes, --placement, --device or --folder] [--json]';

function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, environment = process.env, now } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { stderr.write(`${error.message}\n`); return 2; }
  try {
    const settings = new ControllerSettings({ file: options.file, environment, ...(now ? { now } : {}) });
    if (options.command === 'show') {
      const value = settings.read();
      stdout.write(options.json ? `${JSON.stringify({ settings: value })}\n` : `${value ? JSON.stringify(value, null, 2) : 'No controller settings yet.'}\n`);
      return 0;
    }
    if (options.command === 'render') {
      const rendered = settings.render();
      stdout.write(options.json ? `${JSON.stringify({ project_lines: rendered.project_lines, gate_route: rendered.gate_route })}\n`
        : `${['Project lines:', ...rendered.project_lines, '', 'Project memory line:', rendered.gate_route].join('\n')}\n`);
      return 0;
    }
    const result = settings.set(options.changes, { ownerSaid: options.ownerSaid });
    if (options.json) { stdout.write(`${JSON.stringify({ changed: result.changed, project_lines: result.project_lines, gate_route: result.gate_route })}\n`); return 0; }
    stdout.write(`${[result.changed.length ? `Changed and read back: ${result.changed.join(', ')}.` : 'Nothing changed: the settings already say that.',
      '', 'Project lines:', ...result.project_lines, '', 'Project memory line:', result.gate_route,
      ...(result.changed.length ? ['', `Save it to the evidence store at ${storePath(result.settings.repository)} with toolkit-store.cjs save, then update the lines above where they are kept.`] : [])].join('\n')}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof SettingsError)) { stderr.write(`Controller settings stopped on an unexpected problem (${error?.code || error?.name || 'Error'}). Nothing was changed that did not read back.\n`); return 2; }
    stderr.write(`${error.message}\n`);
    return error.code === 'SETTINGS_ARGUMENTS' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ SCHEMA, ControllerSettings, SettingsError, readSettings, renderLines, parsePlacement, storePath, main });
