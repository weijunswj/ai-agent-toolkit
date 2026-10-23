'use strict';

// Feeders connect each coding app to the Toolkit env store. They all keep one contract:
//   plan(binding)            what connecting this MCP entry would change, by key name, or why it cannot
//   project(binding, opts)   back up the entry, then point it at `toolkit env header <NAME>`
//   status(bindings)         per entry: current, needs update or missing, by name only
//   revoke(binding)          put the entry back as it was before Toolkit connected it, from the backup
// An entry reads its value at use time through the helper, so a changed value needs no rewrite;
// the core still calls each feeder after every change to report what is current.
//
// Claude Code: the user MCP entry's headersHelper, changed only through the `claude mcp` CLI
// (Claude rewrites ~/.claude.json itself, so Toolkit only reads that file).
// Codex: [mcp_servers.<name>] gets http_headers_helper, and bearer_token_env_var or the matching
// env_http_headers entry is removed (an explicit bearer token wins over the helper). The edit is
// made by Codex's own config/batchWrite on a copy, checked key by key, backed up, then swapped in.
// OpenCode: a reserved slot with no code path yet.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const processLaunch = require('./claude-process-launch.cjs');
const { parseTomlDocument } = require('./codex-delegation-common.cjs');
const { captureCodexConfigSnapshot, createCodexConfigBackup, writeRegularFileAtomically } = require('./codex-delegation-backup.cjs');

const { CodexConfigLoadCheck } = require('./codex-config-load-check.cjs');

const HARNESSES = Object.freeze({ CLAUDE: 'claude-code', CODEX: 'codex', OPENCODE: 'opencode' });
const STATES = Object.freeze({ CURRENT: 'current', NEEDS_UPDATE: 'needs update', MISSING: 'entry missing', UNREADABLE: 'could not be checked' });
const SERVER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEADER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const RESERVED_HEADERS = new Set(['host', 'content-type', 'content-length', 'accept', 'connection', 'transfer-encoding', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']);
const INTERIM_HELPER = 'codex-env-bearer.cjs';

class FeederError extends Error {
  constructor(message) { super(message); this.code = 'feeder-held'; }
}

function slash(value) { return String(value).replace(/\\/g, '/'); }

function assertServer(server) {
  if (!SERVER_PATTERN.test(String(server || ''))) throw new FeederError('MCP entry names may use letters, digits, - and _ only.');
  return server;
}

function assertHeader(header) {
  if (!HEADER_PATTERN.test(String(header || ''))) throw new FeederError('That is not a valid header name.');
  if (RESERVED_HEADERS.has(String(header).toLowerCase())) throw new FeederError(`${header} cannot be set by a header helper.`);
  return header;
}

// The command both apps run to get the header: absolute node, absolute script, then arguments that
// are all plain words, so it means the same under cmd.exe /C, sh -c and Git Bash.
function helperCommand({ nodePath, scriptPath, name, header = 'Authorization', scheme = 'Bearer' }) {
  const words = [`"${slash(nodePath)}"`, `"${slash(scriptPath)}"`, 'header', name];
  if (header !== 'Authorization') words.push('--header', header);
  if (scheme !== 'Bearer') words.push('--scheme', scheme);
  return words.join(' ');
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

class ClaudeCodeFeeder {
  #claudeJson; #claudeCommand; #spawn; #commandFor;

  // commandFor(binding) gives the helper command; claudeCommand is the `claude` CLI to run.
  constructor({ claudeJson, claudeCommand = processLaunch.resolveClaudeCommandInput(), spawn = spawnSync, commandFor }) {
    this.#claudeJson = claudeJson;
    this.#claudeCommand = claudeCommand;
    this.#spawn = spawn;
    this.#commandFor = commandFor;
  }

  get id() { return HARNESSES.CLAUDE; }
  get label() { return 'Claude Code'; }

  // The user-scope MCP entries, read only.
  #entries() {
    let text;
    try { text = fs.readFileSync(this.#claudeJson, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new FeederError('The Claude Code settings file could not be read.'); }
    let parsed;
    try { parsed = JSON.parse(text.replace(/^﻿/, '')); }
    catch { throw new FeederError('The Claude Code settings file is not valid JSON.'); }
    return parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers ? parsed.mcpServers : {};
  }

  entry(server) {
    const entries = this.#entries();
    return Object.prototype.hasOwnProperty.call(entries, server) ? entries[server] : null;
  }

  // Entries that still run the interim helper which read ~/.codex/.env.
  interimHelperEntries() {
    return Object.entries(this.#entries())
      .filter(([, entry]) => typeof entry?.headersHelper === 'string' && entry.headersHelper.includes(INTERIM_HELPER))
      .map(([server]) => server).sort();
  }

  plan(binding) {
    assertServer(binding.server);
    const entry = this.entry(binding.server);
    if (!entry) return { ok: false, hold: 'Claude Code has no user MCP entry with that name.' };
    if (!['http', 'sse'].includes(entry.type) || typeof entry.url !== 'string') {
      return { ok: false, hold: `Claude Code's ${binding.server} entry is not an HTTP entry; connect local (stdio) servers with toolkit env run instead.` };
    }
    if (entry.headers && Object.keys(entry.headers).length) {
      return { ok: false, hold: `Claude Code's ${binding.server} entry has fixed headers. Remove them in Claude Code first (claude mcp remove, then add it back without headers), so no copy of a value stays in its settings.` };
    }
    const command = this.#commandFor(binding);
    if (entry.headersHelper === command) return { ok: true, current: true, changes: [] };
    return { ok: true, current: false, changes: [`Claude Code ${binding.server}: headersHelper reads ${binding.name} from the Toolkit env store${entry.headersHelper ? ' (replaces its current helper)' : ''}`] };
  }

  #claude(args) {
    const parts = processLaunch.directSpawnParts(this.#claudeCommand, args, { label: 'The claude command' });
    const result = this.#spawn(parts.command, parts.args, { encoding: 'utf8', windowsHide: true, shell: false, timeout: 60000 });
    if (result.error || result.status !== 0) throw new FeederError(`The claude command failed (${args.slice(0, 2).join(' ')}).`);
  }

  #replace(server, entry) {
    this.#claude(['mcp', 'remove', server, '--scope', 'user']);
    this.#claude(['mcp', 'add-json', server, JSON.stringify(entry), '--scope', 'user']);
  }

  #requireCli() {
    try { processLaunch.assertExecutableAvailable(this.#claudeCommand); }
    catch { throw new FeederError('The claude command was not found, so Toolkit cannot change Claude Code MCP entries. Install Claude Code\'s command-line tool, then try again.'); }
  }

  project(binding, { backupDir }) {
    const plan = this.plan(binding);
    if (!plan.ok) throw new FeederError(plan.hold);
    if (plan.current) return { changed: false };
    this.#requireCli();
    const previous = this.entry(binding.server);
    const backup = path.join(backupDir, `claude-code-${binding.server}.json`);
    writePrivateJson(backup, { server: binding.server, entry: previous });
    const desired = { ...previous, headersHelper: this.#commandFor(binding) };
    try { this.#replace(binding.server, desired); }
    catch (error) {
      try { this.#replace(binding.server, previous); } catch {}
      throw error;
    }
    if (this.entry(binding.server)?.headersHelper !== desired.headersHelper) throw new FeederError(`Claude Code's ${binding.server} entry did not change as expected.`);
    return { changed: true, backup };
  }

  status(bindings) {
    return bindings.map((binding) => {
      try {
        const entry = this.entry(binding.server);
        if (!entry) return { binding, state: STATES.MISSING };
        return { binding, state: entry.headersHelper === (binding.command || this.#commandFor(binding)) ? STATES.CURRENT : STATES.NEEDS_UPDATE };
      } catch {
        return { binding, state: STATES.UNREADABLE };
      }
    });
  }

  revoke(binding) {
    const file = path.join(binding.backup, `claude-code-${binding.server}.json`);
    let saved;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new FeederError(`The backup of Claude Code's ${binding.server} entry is missing.`); }
    this.#requireCli();
    if (saved.entry) this.#replace(binding.server, saved.entry);
    else if (this.entry(binding.server)) this.#claude(['mcp', 'remove', binding.server, '--scope', 'user']);
    return { restored: true };
  }
}

function plainToml(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.t === 'table') return Object.fromEntries(Object.entries(value.v).map(([key, inner]) => [key, plainToml(inner)]));
  if (value.t === 'array') return value.v.map(plainToml);
  return value.v;
}

class CodexFeeder {
  #configPath; #codexHome; #editor; #parse; #commandFor; #loadCheck;

  // editor(bytes, { edits }) returns { bytes } with Codex's own edit applied to a copy.
  constructor({ codexHome, editor, parse = parseTomlDocument, commandFor, loadCheckOptions }) {
    this.#loadCheck = new CodexConfigLoadCheck(loadCheckOptions);
    this.#codexHome = codexHome;
    this.#configPath = path.join(codexHome, 'config.toml');
    this.#editor = editor || ((bytes, options) => require('./codex-delegation-config.cjs').editWithCodexAppServer(bytes, { codexHome, ...options }));
    this.#parse = parse;
    this.#commandFor = commandFor;
  }

  get id() { return HARNESSES.CODEX; }
  get label() { return 'Codex'; }

  #document(bytes) {
    if (!bytes.length) return {};
    const parsed = this.#parse(bytes);
    if (!parsed.ok) throw new FeederError(parsed.kind === 'parser-unavailable' ? 'Python 3.11 or later is needed to read the Codex config safely.' : 'The Codex config is not valid TOML.');
    return plainToml(parsed.doc) || {};
  }

  #servers(bytes) {
    const servers = this.#document(bytes).mcp_servers;
    return servers && typeof servers === 'object' ? servers : {};
  }

  #read() {
    const snapshot = captureCodexConfigSnapshot(this.#configPath);
    return { snapshot, servers: this.#servers(snapshot.bytes) };
  }

  // Names Codex reads from its process environment for MCP entries (bearer_token_env_var and
  // env_http_headers), so ~/.codex/.env is still needed for them.
  environmentReferences() {
    const references = [];
    for (const [server, table] of Object.entries(this.#read().servers)) {
      if (typeof table?.bearer_token_env_var === 'string') references.push({ server, name: table.bearer_token_env_var });
      for (const name of Object.values(table?.env_http_headers || {})) if (typeof name === 'string') references.push({ server, name });
    }
    return references;
  }

  // The batchWrite edits that connect this entry, or why it cannot be connected.
  #edits(binding, table, command = this.#commandFor(binding)) {
    if (!table) return { hold: 'Codex has no MCP entry with that name.' };
    if (typeof table.url !== 'string') return { hold: `Codex's ${binding.server} entry is not an HTTP entry; connect local (stdio) servers with toolkit env run instead.` };
    if (table.bearer_token !== undefined) return { hold: `Codex's ${binding.server} entry has a fixed bearer token. Remove it from the Codex config first, so no copy of the value stays there.` };
    const fixed = Object.keys(table.http_headers || {}).find((header) => header.toLowerCase() === binding.header.toLowerCase());
    if (fixed) return { hold: `Codex's ${binding.server} entry has a fixed ${fixed} header. Remove it from the Codex config first, so no copy of the value stays there.` };
    const base = `mcp_servers.${binding.server}`;
    const edits = [];
    const changes = [];
    if (binding.header.toLowerCase() === 'authorization' && table.bearer_token_env_var !== undefined) {
      edits.push({ keyPath: `${base}.bearer_token_env_var`, value: null, mergeStrategy: 'replace' });
      changes.push(`Codex ${binding.server}: remove bearer_token_env_var (${table.bearer_token_env_var})`);
    }
    for (const [header, name] of Object.entries(table.env_http_headers || {})) {
      if (header.toLowerCase() !== binding.header.toLowerCase()) continue;
      edits.push({ keyPath: `${base}.env_http_headers.${header}`, value: null, mergeStrategy: 'replace' });
      changes.push(`Codex ${binding.server}: remove env_http_headers ${header} (${name})`);
    }
    if (table.http_headers_helper !== command) {
      edits.push({ keyPath: `${base}.http_headers_helper`, value: command, mergeStrategy: 'upsert' });
      changes.push(`Codex ${binding.server}: http_headers_helper reads ${binding.name} from the Toolkit env store`);
    }
    return { edits, changes };
  }

  plan(binding) {
    assertServer(binding.server);
    assertHeader(binding.header);
    const { servers } = this.#read();
    const planned = this.#edits(binding, servers[binding.server]);
    if (planned.hold) return { ok: false, hold: planned.hold };
    return { ok: true, current: planned.edits.length === 0, changes: planned.changes };
  }

  // Host field types: https://learn.chatgpt.com/docs/config-file/config-reference (2026-10-23),
  // mcp_servers.<id>.http_headers_helper is a command string; no command-length limit is documented.
  // Apply edits through Codex's editor, check that only the named keys of this entry changed, back
  // up the config, then swap it in unless the file changed meanwhile.
  async #write(server, edits, expected, backupRoot) {
    const { snapshot } = this.#read();
    const edited = await this.#editor(snapshot.bytes, { edits });
    const before = this.#document(snapshot.bytes);
    const after = this.#document(edited.bytes);
    const touched = new Set(edits.map((edit) => edit.keyPath.split('.').slice(2).join('.')));
    const strip = (doc) => {
      const copy = JSON.parse(JSON.stringify(doc));
      const table = copy.mcp_servers?.[server] || {};
      for (const key of touched) {
        const [first, second] = key.split('.');
        if (second === undefined) delete table[first];
        else if (table[first]) { delete table[first][second]; if (!Object.keys(table[first]).length) delete table[first]; }
      }
      return copy;
    };
    if (JSON.stringify(strip(before)) !== JSON.stringify(strip(after))) throw new FeederError('Codex\'s editor changed more than the planned keys, so Toolkit did not save it.');
    const table = after.mcp_servers?.[server] || {};
    for (const [key, value] of Object.entries(expected)) {
      const [first, second] = key.split('.');
      const actual = second === undefined ? table[first] : table[first]?.[second];
      if (actual !== value) throw new FeederError('Codex\'s editor did not make the planned change, so Toolkit did not save it.');
    }
    const backup = createCodexConfigBackup(this.#configPath, { snapshot, backupRoot, replacementBytes: edited.bytes });
    writeRegularFileAtomically(this.#configPath, edited.bytes, snapshot.mode, { expectedSnapshot: snapshot });
    const loadCheck = this.#loadCheck.verify({ configPath: this.#configPath, snapshot, backupPath: backup.backup_path, replacementBytes: edited.bytes });
    return { ...backup, load_check: loadCheck };
  }

  async project(binding, { backupDir }) {
    const plan = this.plan(binding);
    if (!plan.ok) throw new FeederError(plan.hold);
    if (plan.current) return { changed: false };
    const { servers } = this.#read();
    const { edits } = this.#edits(binding, servers[binding.server]);
    const expected = Object.fromEntries(edits.map((edit) => [edit.keyPath.split('.').slice(2).join('.'), edit.value === null ? undefined : edit.value]));
    const backup = await this.#write(binding.server, edits, expected, path.join(backupDir, 'codex'));
    return { changed: true, backup: backup.metadata_path, restart: true, load_check: backup.load_check };
  }

  status(bindings) {
    let servers;
    try { servers = this.#read().servers; }
    catch { return bindings.map((binding) => ({ binding, state: STATES.UNREADABLE })); }
    return bindings.map((binding) => {
      const planned = servers[binding.server] ? this.#edits(binding, servers[binding.server], binding.command || this.#commandFor(binding)) : null;
      if (!planned) return { binding, state: STATES.MISSING };
      if (planned.hold || planned.edits.length) return { binding, state: STATES.NEEDS_UPDATE };
      return { binding, state: STATES.CURRENT };
    });
  }

  // Restore this entry's helper and environment keys to what the backup taken at connect time holds.
  async revoke(binding) {
    const codexBackup = path.join(binding.backup, 'codex');
    let generation = null;
    try { generation = fs.readdirSync(codexBackup).sort()[0] || null; } catch {}
    const original = generation ? path.join(codexBackup, generation, 'config.toml.original') : '';
    if (!original || !fs.existsSync(original)) throw new FeederError(`The backup of Codex's ${binding.server} entry is missing.`);
    const previous = this.#servers(fs.readFileSync(original))[binding.server] || {};
    const { servers } = this.#read();
    const current = servers[binding.server];
    if (!current) throw new FeederError(`Codex has no MCP entry named ${binding.server} any more.`);
    const base = `mcp_servers.${binding.server}`;
    const edits = [];
    const expected = {};
    const restore = (key, before, now) => {
      if (before === now) return;
      edits.push({ keyPath: `${base}.${key}`, value: before === undefined ? null : before, mergeStrategy: before === undefined ? 'replace' : 'upsert' });
      expected[key] = before;
    };
    restore('http_headers_helper', previous.http_headers_helper, current.http_headers_helper);
    restore('bearer_token_env_var', previous.bearer_token_env_var, current.bearer_token_env_var);
    const headers = new Set([...Object.keys(previous.env_http_headers || {}), ...Object.keys(current.env_http_headers || {})]);
    for (const header of headers) restore(`env_http_headers.${header}`, previous.env_http_headers?.[header], current.env_http_headers?.[header]);
    if (!edits.length) return { restored: false };
    const backup = await this.#write(binding.server, edits, expected, path.join(binding.backup, 'codex-revoke'));
    return { restored: true, restart: true, load_check: backup.load_check };
  }
}

// OpenCode gets its own feeder under the same contract later; it is listed so status names it.
const OPENCODE_SLOT = Object.freeze({ id: HARNESSES.OPENCODE, label: 'OpenCode', enabled: false });

module.exports = Object.freeze({
  ClaudeCodeFeeder,
  CodexFeeder,
  FeederError,
  HARNESSES,
  INTERIM_HELPER,
  OPENCODE_SLOT,
  STATES,
  assertHeader,
  assertServer,
  helperCommand,
});
