#!/usr/bin/env node
'use strict';

// Owns the Toolkit global rules block in each harness's user-level instruction file:
//   Claude Code  $CLAUDE_CONFIG_DIR/CLAUDE.md, else ~/.claude/CLAUDE.md
//   Codex        $CODEX_HOME/AGENTS.md, else ~/.codex/AGENTS.md
//   Antigravity  ~/.gemini/GEMINI.md, only when enabled or already carrying the block
// The block is rendered from repo/contracts/agent-rules/global-rules.md plus the n8n adapter,
// inside versioned, hashed Toolkit markers (toolkit-managed-block.cjs). Toolkit writes only
// between its markers: the rest of the file keeps its exact bytes and line endings. Every
// change is backed up first; a block edited by hand is restored and reported. Removal deletes
// the block, and deletes the file only when Toolkit created it and nothing else remains; it is
// recorded, so session starts leave that file alone until setup (or --write) installs again.
// Hand-written sections the block now covers are reported, never edited.
//
// Usage: node repo/scripts/toolkit-global-rules.cjs --check|--write|--remove
//          [--harness claude-code,codex,antigravity]

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { blockState, findBlocks, removeBlock, upsertBlock } = require('./toolkit-managed-block.cjs');
const { parseTomlDocument } = require('./codex-delegation-common.cjs');

const SOURCE = 'repo/contracts/agent-rules/global-rules.md';
const N8N_SOURCE = 'repo/contracts/agent-rules/n8n-safety-router-adapter.md';
const BLOCK_NAME = 'GLOBAL-RULES';
const HARNESSES = Object.freeze(['claude-code', 'codex', 'antigravity']);
const HARNESS_LABELS = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' });
// Hand-written sections whose content now lives in the global block.
const COVERED_SECTIONS = Object.freeze(['Toolkit Controller Bootstrap']);
const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_NAME = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

function fail(code, message) { throw Object.assign(new Error(message || code), { code }); }

function homeOf(environment) {
  const first = process.platform === 'win32' ? environment.USERPROFILE || environment.HOME : environment.HOME || environment.USERPROFILE;
  return first || os.homedir();
}

function harnessFile(harness, environment = process.env) {
  const home = homeOf(environment);
  if (harness === 'claude-code') return path.join(environment.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'CLAUDE.md');
  if (harness === 'codex') return path.join(environment.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md');
  if (harness === 'antigravity') return path.join(home, '.gemini', 'GEMINI.md');
  return fail('GLOBAL_RULES_HARNESS_UNKNOWN', `Unknown harness: ${harness}`);
}

// The expected block for the Toolkit checkout at toolkitRoot.
function globalRulesBlock(toolkitRoot = TOOLKIT_ROOT) {
  const read = rel => fs.readFileSync(path.join(toolkitRoot, rel), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const version = JSON.parse(fs.readFileSync(path.join(toolkitRoot, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), 'utf8')).version;
  return Object.freeze({ source: SOURCE, name: BLOCK_NAME, version, body: `${read(SOURCE)}\n\n${read(N8N_SOURCE)}` });
}

function readIfExists(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// A user-level file as its exact bytes and, when they are valid UTF-8, its text (a BOM is kept as
// U+FEFF, so writing the text back reproduces the bytes). Text is null for any other encoding,
// such as UTF-16 from Windows PowerShell: Toolkit then never rewrites the file.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function readUserFile(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return { bytes, text: STRICT_UTF8.decode(bytes) }; }
  catch { return { bytes, text: null }; }
}

function writeFileAtomically(file, text) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Section headings outside the Toolkit markers that repeat what the block covers.
function coveredSections(text) {
  const { blocks } = findBlocks(text);
  let outside = text;
  for (const block of [...blocks].reverse()) outside = outside.slice(0, block.start) + outside.slice(block.end);
  return COVERED_SECTIONS.filter(title => new RegExp(`^#{1,6}\\s*${title.replace(/ /g, '\\s+')}\\s*$`, 'mi').test(outside));
}

// Toolkit-owned state beside the hub (never inside the user's rules files): which files Toolkit
// created, so removal deletes only those, and which files the owner removed the block from, so
// session starts leave them alone until setup installs again.
class GlobalRulesLedger {
  #file;
  constructor(file) { this.#file = file; }
  #read() {
    const text = readIfExists(this.#file);
    const value = text ? JSON.parse(text) : null;
    const map = key => (value && value[key] && typeof value[key] === 'object' ? value[key] : {});
    return { created: map('created'), removed: map('removed') };
  }
  #has(kind, target) { return Object.hasOwn(this.#read()[kind], path.resolve(target)); }
  #set(kind, target, on) {
    const entries = this.#read();
    if (on) entries[kind][path.resolve(target)] = new Date().toISOString();
    else delete entries[kind][path.resolve(target)];
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    writeFileAtomically(this.#file, `${JSON.stringify({ schema_version: 1, ...entries }, null, 2)}\n`);
  }
  created(target) { return this.#has('created', target); }
  setCreated(target, on) { this.#set('created', target, on); }
  removed(target) { return this.#has('removed', target); }
  setRemoved(target, on) { if (this.removed(target) !== on) this.#set('removed', target, on); }
}

// One harness's user-level file.
class GlobalRulesFile {
  #harness; #file; #expected; #backupDir; #ledger;
  // expected: returns the expected block; read on first use, so a missing source is reported by the call that needs it.
  constructor({ harness, file, expected, backupDir, ledger }) {
    this.#harness = harness; this.#file = file; this.#expected = expected; this.#backupDir = backupDir; this.#ledger = ledger;
  }

  get harness() { return this.#harness; }
  get file() { return this.#file; }

  // state: missing-file | absent | current | stale | tampered | broken | not-utf8
  assess() {
    const read = readUserFile(this.#file);
    const base = { harness: this.#harness, file: this.#file };
    if (read === null) return { ...base, state: 'missing-file', covered: [] };
    if (read.text === null) return { ...base, state: 'not-utf8', detail: 'the file is not UTF-8 text (for example UTF-16), so Toolkit will not rewrite it', covered: [] };
    const { blocks, errors } = findBlocks(read.text);
    if (errors.length) return { ...base, state: 'broken', detail: errors[0], covered: [] };
    const found = blocks.find(block => block.name === BLOCK_NAME);
    return { ...base, state: blockState(found, this.#expected()), covered: coveredSections(read.text) };
  }

  // Copies the exact current bytes into this run's backup folder.
  #backup(bytes) {
    fs.mkdirSync(this.#backupDir, { recursive: true });
    const backup = path.join(this.#backupDir, `${this.#harness}-${path.basename(this.#file)}`);
    fs.writeFileSync(backup, bytes);
    return backup;
  }

  // Writes only when the block is not current. Returns the assessment plus the action taken.
  // respectRemoval (session starts): a file the owner removed the block from is left alone.
  // Otherwise (setup, --write) installing clears that removal.
  install({ respectRemoval = false } = {}) {
    if (this.#ledger.removed(this.#file)) {
      if (respectRemoval) return { harness: this.#harness, file: this.#file, state: 'removed-by-owner', covered: [], action: 'opted-out' };
      this.#ledger.setRemoved(this.#file, false);
    }
    const before = this.assess();
    if (before.state === 'current') return { ...before, action: 'unchanged' };
    if (before.state === 'broken' || before.state === 'not-utf8') return { ...before, action: 'held' };
    const original = readUserFile(this.#file);
    const updated = upsertBlock(original ? original.text : '', this.#expected(), { position: 'bottom' });
    const backup = original ? this.#backup(original.bytes) : null;
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const now = readUserFile(this.#file);
    const unchanged = original === null ? now === null : now !== null && now.bytes.equals(original.bytes);
    if (!unchanged) {
      fail('GLOBAL_RULES_CHANGED_DURING_WRITE', `${this.#file} changed while Toolkit was updating it. Run setup toolkit again.`);
    }
    writeFileAtomically(this.#file, updated);
    if (readIfExists(this.#file) !== updated) fail('GLOBAL_RULES_READBACK_MISMATCH', `${this.#file} did not read back as written.`);
    if (original === null) this.#ledger.setCreated(this.#file, true);
    const action = original === null ? 'created' : before.state === 'absent' ? 'added' : before.state === 'tampered' ? 'restored' : 'refreshed';
    return { ...this.assess(), action, backup };
  }

  // Removes the block and records the owner's removal, so session starts do not put it back.
  remove() {
    const before = this.assess();
    if (before.state === 'broken' || before.state === 'not-utf8') return { ...before, action: 'held' };
    this.#ledger.setRemoved(this.#file, true);
    if (before.state === 'missing-file' || before.state === 'absent') return { ...before, action: 'absent' };
    const original = readUserFile(this.#file);
    const backup = this.#backup(original.bytes);
    const remaining = removeBlock(original.text, BLOCK_NAME);
    if (!remaining.trim() && this.#ledger.created(this.#file)) {
      fs.rmSync(this.#file);
      this.#ledger.setCreated(this.#file, false);
      return { harness: this.#harness, file: this.#file, state: 'missing-file', covered: [], action: 'deleted-file', backup };
    }
    writeFileAtomically(this.#file, remaining);
    return { ...this.assess(), action: 'removed', backup };
  }
}

// Codex reads the repository's AGENTS.md files only up to project_doc_max_bytes (32 KiB by
// default). Open-source Codex does not count the user-level AGENTS.md toward it, but Codex desktop
// 26.1016 cut the repository rules off where the user file plus the repository file reached 32 KiB
// (owner UAT, 22 October 2026), and raising the limit fixed it. With the owner's setup answer,
// Toolkit raises the top-level key in config.toml to 65536 inside its own comment markers, and
// puts the exact previous bytes back on removal.
//
// config.toml is only ever judged by a real TOML parser (Python tomllib). Toolkit edits it only in
// two shapes: the key absent everywhere (the block goes at the very top of the file, which is
// always top-level), or one plain top-level decimal line it can replace whole. Any other shape is
// left for the owner. Every candidate is parsed before writing: the key must read 65536 and every
// other value must be unchanged, or nothing is written.
// Host field: https://learn.chatgpt.com/docs/config-file/config-reference (2026-10-23).
// The reference documents bytes, but no numeric upper limit; Codex load-checks each write.
const { CodexConfigLoadCheck } = require('./codex-config-load-check.cjs');
const { captureCodexConfigSnapshot } = require('./codex-delegation-backup.cjs');
const DOC_LIMIT_KEY = 'project_doc_max_bytes';
const DOC_LIMIT_MODES = Object.freeze(['raise', 'restore', 'report', 'none']);
const DOC_LIMIT_DEFAULT = 32768;
const DOC_LIMIT_TARGET = 65536;
const DOC_LIMIT_BEGIN = /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=(\d+|none)(?: line=([A-Za-z0-9+/]+=*))?( created=yes)?(\r?\n|$)/gm;
const DOC_LIMIT_END = /^# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES(\r?\n|$)/gm;
const DOC_LIMIT_MARKER = /AI-AGENT-TOOLKIT:global-rules:(?:BEGIN|END) PROJECT-DOC-MAX-BYTES/g;
const PLAIN_KEY_LINE = /^[ \t]*project_doc_max_bytes[ \t]*=[ \t]*([1-9]\d*|0)[ \t]*(?:#[^\r\n]*)?(\r?\n|$)/gm;
const VALUE_LINE = `${DOC_LIMIT_KEY} = ${DOC_LIMIT_TARGET}`;
const HELD_LIMIT_STATES = Object.freeze(['broken', 'not-utf8', 'invalid', 'ineffective']);

// Every path below the top level where the key appears (tables, profiles, arrays of tables).
function nestedKeyPaths(node, trail = []) {
  if (node.t === 'table') {
    return Object.entries(node.v).flatMap(([key, child]) => [
      ...(trail.length && key === DOC_LIMIT_KEY ? [trail.join('.')] : []),
      ...nestedKeyPaths(child, [...trail, key])]);
  }
  if (node.t === 'array') return node.v.flatMap((child, index) => nestedKeyPaths(child, [...trail, String(index)]));
  return [];
}

// The parsed document without the top-level key, for comparing two parses.
function withoutKey(doc) {
  const { [DOC_LIMIT_KEY]: _ignored, ...rest } = doc.v;
  return JSON.stringify(rest);
}

class CodexDocLimit {
  #file; #backupDir; #loadCheck; #lastLoadCheck;
  constructor({ file, backupDir, loadCheckOptions }) { this.#file = file; this.#backupDir = backupDir; this.#loadCheck = new CodexConfigLoadCheck(loadCheckOptions); }

  get file() { return this.#file; }

  // Toolkit's marked block, when present and well formed: its span, the bytes it replaced and
  // whether Toolkit created the file. { error } when the markers are not one intact block.
  static #block(text) {
    const begins = [...text.matchAll(DOC_LIMIT_BEGIN)];
    const ends = [...text.matchAll(DOC_LIMIT_END)];
    const markers = (text.match(DOC_LIMIT_MARKER) || []).length;
    if (!markers) return null;
    if (begins.length !== 1 || ends.length !== 1 || markers !== 2) return { error: 'the Toolkit markers are not one intact pair' };
    const [begin] = begins; const [end] = ends;
    const inner = text.slice(begin.index + begin[0].length, end.index);
    if (end.index < begin.index || inner.replace(/\r?\n$/, '') !== VALUE_LINE) {
      return { error: `the lines between the Toolkit markers are not exactly "${VALUE_LINE}"` };
    }
    // A replaced value is only restorable from its recorded line; never guess one.
    if (begin[1] !== 'none' && !begin[2]) return { error: 'the Toolkit marker does not record the line it replaced' };
    return { start: begin.index, end: end.index + end[0].length, previous: begin[1],
      original: begin[2] ? Buffer.from(begin[2], 'base64').toString('utf8') : '', created: Boolean(begin[3]) };
  }

  // state:
  //   managed     Toolkit raised it and 65536 is in effect
  //   sufficient  65536 or more, set by the owner
  //   off         0: the owner turned project docs off in Codex
  //   low         below 65536 in a shape Toolkit can raise
  //   manual      below 65536 (or unknown) in a shape Toolkit does not edit
  //   invalid     config.toml does not parse as TOML
  //   ineffective Toolkit's markers are there but 65536 is not what Codex reads
  //   broken      Toolkit's markers are damaged
  //   not-utf8    not UTF-8 text
  //   unverified  no Python 3.11+ with tomllib to read config.toml
  // limit: the value Codex uses at the top level, when known.
  assess() {
    const { doc, line, shape, ...result } = this.#inspect();
    return result;
  }

  #inspect() {
    const read = readUserFile(this.#file);
    if (read === null) return { state: 'low', limit: DOC_LIMIT_DEFAULT, previous: 'none', shape: 'absent-file' };
    if (read.text === null) return { state: 'not-utf8', limit: null, detail: 'the file is not UTF-8 text' };
    const block = CodexDocLimit.#block(read.text);
    if (block?.error) return { state: 'broken', limit: null, detail: block.error };
    const parsed = parseTomlDocument(read.bytes);
    if (!parsed.ok) {
      return parsed.kind === 'parser-unavailable'
        ? { state: 'unverified', limit: null, detail: 'no Python 3.11 or later with tomllib to read config.toml safely' }
        : { state: 'invalid', limit: null, detail: `config.toml does not parse as TOML (${parsed.detail})` };
    }
    const nested = nestedKeyPaths(parsed.doc);
    const top = parsed.doc.v[DOC_LIMIT_KEY];
    const limit = top?.t === 'int' ? Number(top.v) : top ? null : DOC_LIMIT_DEFAULT;
    if (block) {
      if (top?.t !== 'int' || limit !== DOC_LIMIT_TARGET || nested.length) {
        return { state: 'ineffective', limit, detail: nested.length ? `${DOC_LIMIT_KEY} is also set under ${nested.join(', ')}` : `the top-level ${DOC_LIMIT_KEY} does not read ${DOC_LIMIT_TARGET}` };
      }
      return { state: 'managed', limit, previous: block.previous, doc: parsed.doc };
    }
    if (nested.length) return { state: 'manual', limit, detail: `${DOC_LIMIT_KEY} is set under ${nested.join(', ')}` };
    if (top && top.t !== 'int') return { state: 'manual', limit: null, detail: `${DOC_LIMIT_KEY} is not a whole number` };
    if (limit === 0) return { state: 'off', limit: 0 };
    if (limit >= DOC_LIMIT_TARGET) return { state: 'sufficient', limit };
    if (!top) return { state: 'low', limit, previous: 'none', shape: 'insert', doc: parsed.doc };
    const lines = [...read.text.matchAll(PLAIN_KEY_LINE)].filter(match => Number(match[1]) === limit);
    if (lines.length !== 1) return { state: 'manual', limit, detail: `${DOC_LIMIT_KEY} is not written as one plain decimal line` };
    return { state: 'low', limit, previous: String(limit), shape: 'replace', line: lines[0], doc: parsed.doc };
  }

  // What a run that changes nothing reports: a problem Toolkit cannot fix is held; a shape it does
  // not edit, or an unreadable config, is skipped and left to the owner.
  static #idleAction(state) {
    if (HELD_LIMIT_STATES.includes(state)) return 'held';
    return ['manual', 'unverified'].includes(state) ? 'skipped' : 'unchanged';
  }

  // Copies the exact bytes into this run's backup folder, then writes only if the file still holds
  // what was read.
  #write(original, updated) {
    const snapshot = captureCodexConfigSnapshot(this.#file);
    let backup = null;
    if (original) {
      fs.mkdirSync(this.#backupDir, { recursive: true });
      backup = path.join(this.#backupDir, 'codex-config.toml');
      fs.writeFileSync(backup, original.bytes);
    }
    const now = readUserFile(this.#file);
    const unchanged = original === null ? now === null : now !== null && now.bytes.equals(original.bytes);
    if (!unchanged) fail('GLOBAL_RULES_CHANGED_DURING_WRITE', `${this.#file} changed while Toolkit was updating it. Run setup toolkit again.`);
    if (updated === null) fs.rmSync(this.#file);
    else {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      writeFileAtomically(this.#file, updated);
      if (readIfExists(this.#file) !== updated) fail('GLOBAL_RULES_READBACK_MISMATCH', `${this.#file} did not read back as written.`);
    }
    this.#lastLoadCheck = this.#loadCheck.verify({ configPath: this.#file, snapshot, backupPath: backup, replacementBytes: updated === null ? null : Buffer.from(updated) });
    return backup;
  }

  // Raises a low limit. Leaves 0, 65536 and above, and every shape it does not edit alone.
  ensure() {
    const before = this.#inspect();
    if (before.state !== 'low') {
      const { doc, ...result } = before;
      return { ...result, action: CodexDocLimit.#idleAction(before.state) };
    }
    const original = readUserFile(this.#file);
    const text = original ? original.text : '';
    const marker = (span) => [
      `# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=${before.previous}`
        + `${span ? ` line=${Buffer.from(span, 'utf8').toString('base64')}` : ''}${original ? '' : ' created=yes'}`,
      VALUE_LINE, '# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES'];
    let updated;
    if (before.shape === 'replace') {
      const { line } = before;
      const ending = line[2];
      updated = text.slice(0, line.index) + marker(line[0]).join(ending || (/\r\n/.test(text) ? '\r\n' : '\n')) + ending + text.slice(line.index + line[0].length);
    } else {
      const eol = /\r?\n/.exec(text)?.[0] || '\n';
      updated = `${marker('').join(eol)}${eol}${text}`;
    }
    // Only a candidate that parses, reads 65536 and leaves every other value alone is written.
    const after = parseTomlDocument(Buffer.from(updated, 'utf8'));
    const top = after.ok ? after.doc.v[DOC_LIMIT_KEY] : null;
    const same = after.ok && (before.doc ? withoutKey(before.doc) : '{}') === withoutKey(after.doc);
    if (!after.ok || top?.t !== 'int' || Number(top.v) !== DOC_LIMIT_TARGET || nestedKeyPaths(after.doc).length || !same) {
      return { state: 'manual', limit: before.limit, detail: 'a raised config.toml would not read back exactly as intended', action: 'skipped' };
    }
    const backup = this.#write(original, updated);
    return { state: 'managed', limit: DOC_LIMIT_TARGET, previous: before.previous, action: 'raised', backup, load_check: this.#lastLoadCheck };
  }

  // Puts back the exact bytes Toolkit replaced (or nothing), and deletes the file when Toolkit
  // created it and nothing else is left.
  restore() {
    const read = readUserFile(this.#file);
    if (read === null || read.text === null) return { ...this.assess(), action: 'reported' };
    const block = CodexDocLimit.#block(read.text);
    if (!block) return { ...this.assess(), action: 'reported' };
    if (block.error) return { state: 'broken', limit: null, detail: block.error, action: 'held' };
    const updated = read.text.slice(0, block.start) + block.original + read.text.slice(block.end);
    const deleteFile = block.created && updated === '';
    const backup = this.#write(read, deleteFile ? null : updated);
    const limit = block.previous === 'none' ? DOC_LIMIT_DEFAULT : Number(block.previous);
    return { state: limit >= DOC_LIMIT_TARGET ? 'sufficient' : limit === 0 ? 'off' : 'low', limit, previous: block.previous,
      action: deleteFile ? 'deleted-file' : 'restored-previous', backup, load_check: this.#lastLoadCheck };
  }
}

function nearestGitRoot(start) {
  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// The set of harness files for one run, with shared backups, ledger and backup pruning.
class GlobalRules {
  #files; #home; #backupRoot; #retentionDays; #now; #backupDir; #respectRemoval; #docLimitMode; #docLimit = null; #repoAgents = null;
  // respectRemoval: true for session starts, which leave a file the owner removed the block from
  // alone; false for setup and --write, which reinstall and clear that removal.
  // codexDocLimit: what refresh does with Codex's project_doc_max_bytes. 'raise' only with the
  // owner's yes (the setup answer, or an explicit --write); 'restore' after the owner's no; 'report'
  // (the default) changes nothing; 'none' (a session start without a yes) does not read config.toml
  // at all. --remove always puts the previous value back.
  constructor({ environment = process.env, toolkitRoot = TOOLKIT_ROOT, harnesses = ['claude-code', 'codex'],
    backupRoot, ledgerFile, retentionDays = 7, now = () => new Date(), respectRemoval = false, repoAgentsFile = null,
    codexDocLimit = 'report', loadCheckOptions, workingFolder = process.cwd() } = {}) {
    this.#respectRemoval = respectRemoval === true;
    if (!DOC_LIMIT_MODES.includes(codexDocLimit)) fail('GLOBAL_RULES_ARGUMENT', 'Unknown Codex limit mode: ' + codexDocLimit);
    this.#docLimitMode = codexDocLimit;
    const env = environment || {};
    this.#home = homeOf(env);
    const toolkitHome = path.join(this.#home, '.ai-agent-toolkit');
    this.#backupRoot = backupRoot || path.join(toolkitHome, 'backups', 'global-rules');
    this.#retentionDays = retentionDays;
    this.#now = now;
    this.#backupDir = path.join(this.#backupRoot, now().toISOString().replace(/[:.]/g, '-'));
    const ledger = new GlobalRulesLedger(ledgerFile || path.join(toolkitHome, 'global-rules.json'));
    let block = null;
    const expected = () => (block ??= globalRulesBlock(toolkitRoot));
    for (const harness of harnesses) if (!HARNESSES.includes(harness)) fail('GLOBAL_RULES_HARNESS_UNKNOWN', `Unknown harness: ${harness}`);
    this.#files = [...new Set(harnesses)].map(harness => new GlobalRulesFile({ harness, file: harnessFile(harness, env), expected, backupDir: this.#backupDir, ledger }));
    if (harnesses.includes('codex')) {
      this.#docLimit = new CodexDocLimit({ file: path.join(path.dirname(harnessFile('codex', env)), 'config.toml'), backupDir: this.#backupDir, loadCheckOptions: loadCheckOptions || { environment: { ...process.env, ...env } } });
      // The rules that share Codex's budget: the AGENTS.md at the git root of the working folder, else in
      // the folder itself; a repository without one counts 0 bytes, never another repository's file.
      this.#repoAgents = repoAgentsFile || path.join(nearestGitRoot(workingFolder) || path.resolve(workingFolder), 'AGENTS.md');
    }
  }

  // The harnesses setup manages: Claude Code and Codex always; Antigravity when enabled or
  // when its file already carries the block.
  static setupHarnesses({ environment = process.env, antigravity = false } = {}) {
    const harnesses = ['claude-code', 'codex'];
    if (antigravity) return [...harnesses, 'antigravity'];
    const text = readIfExists(harnessFile('antigravity', environment || {}));
    const carries = text !== null && findBlocks(text).blocks.some(block => block.name === BLOCK_NAME);
    return carries ? [...harnesses, 'antigravity'] : harnesses;
  }

  check() {
    const files = this.#files.map(file => ({ ...file.assess(), action: 'checked' }));
    return this.#summary(files, this.#docLimit ? { ...this.#docLimit.assess(), action: 'checked' } : null);
  }

  // Installs or refreshes each block, then applies the Codex limit mode. The limit is raised only
  // while the Codex block is installed.
  refresh() {
    return this.#withPrune(() => {
      const files = this.#files.map(file => file.install({ respectRemoval: this.#respectRemoval }));
      const codex = files.find(file => file.harness === 'codex');
      let limit = null;
      if (this.#docLimit && this.#docLimitMode !== 'none') {
        if (this.#docLimitMode === 'raise' && codex && !['opted-out', 'held'].includes(codex.action)) limit = this.#docLimit.ensure();
        else if (this.#docLimitMode === 'restore') limit = this.#docLimit.restore();
        else limit = { ...this.#docLimit.assess(), action: 'reported' };
      }
      return [files, limit];
    });
  }

  remove() {
    return this.#withPrune(() => [this.#files.map(file => file.remove()), this.#docLimit ? this.#docLimit.restore() : null]);
  }

  #withPrune(run) {
    const result = this.#summary(...run());
    this.#pruneBackups();
    return result;
  }

  // status: current (nothing to do), updated (written this run), stale (check only) or held.
  #summary(files, docLimit = null) {
    const held = files.filter(file => file.state === 'broken' || file.state === 'not-utf8');
    // A damaged, unparseable or ineffective config.toml holds a run that tried to change it, and fails --check.
    const limitHeld = docLimit && (docLimit.action === 'held' || (docLimit.action === 'checked' && HELD_LIMIT_STATES.includes(docLimit.state)));
    const changed = [...files, ...(docLimit ? [docLimit] : [])].filter(file => !['unchanged', 'checked', 'reported', 'skipped', 'absent', 'held', 'opted-out'].includes(file.action));
    const stale = files.filter(file => file.action === 'checked' && file.state !== 'current');
    const status = held.length || limitHeld ? 'held' : changed.length ? 'updated' : stale.length ? 'stale' : 'current';
    const backups = [...new Set([...files, ...(docLimit ? [docLimit] : [])].map(file => file.backup).filter(Boolean).map(file => path.dirname(file)))];
    const covered = files.flatMap(file => file.covered.map(title => ({ file: file.file, display: this.#display(file.file), title })));
    const shown = files.map(file => ({ ...file, display: this.#display(file.file) }));
    // run_id names this run (its backup folder), so every write gets its own update-report entry.
    return { status, run_id: path.basename(this.#backupDir), files: shown, backup_dir: backups[0] || null,
      backup_display: backups[0] ? this.#display(backups[0]) : null, covered,
      doc_limit: docLimit ? { ...docLimit, display: this.#display(this.#docLimit.file) } : null, codex_budget: this.#codexBudget(docLimit),
      detail: [...held.map(file => `${this.#display(file.file)}: ${file.detail}`), ...(limitHeld ? [`${this.#display(this.#docLimit.file)}: ${docLimit.detail || docLimit.state}`] : [])].join('; ') };
  }

  // The user-level AGENTS.md plus the repository's AGENTS.md, against the limit (see CodexDocLimit).
  #codexBudget(docLimit) {
    if (!this.#docLimit || !docLimit || docLimit.limit === null) return null;
    const size = file => { try { return fs.statSync(file).size; } catch { return 0; } };
    const codexFile = this.#files.find(file => file.harness === 'codex').file;
    const user = size(codexFile);
    const repo = size(this.#repoAgents);
    return { user, user_display: this.#display(codexFile), repo, repo_display: this.#display(this.#repoAgents), total: user + repo, limit: docLimit.limit, over: user + repo > docLimit.limit };
  }

  // Paths under the home folder are shown as ~/..., so output never carries a private absolute path.
  #display(file) {
    const relative = path.relative(this.#home, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `~/${relative.split(path.sep).join('/')}` : file;
  }

  // Deletes only timestamp-named backup folders older than the retention window.
  #pruneBackups() {
    let entries;
    try { entries = fs.readdirSync(this.#backupRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const cutoff = this.#now().getTime() - this.#retentionDays * DAY_MS;
    for (const entry of entries) {
      const target = path.join(this.#backupRoot, entry.name);
      if (!entry.isDirectory() || !BACKUP_NAME.test(entry.name) || target === this.#backupDir) continue;
      if (Date.parse(entry.name.replace(BACKUP_NAME, '$1:$2:$3.$4Z')) < cutoff) fs.rmSync(target, { recursive: true, force: true });
    }
  }
}

function harnessLabel(harness) { return HARNESS_LABELS[harness] || harness; }

// One line per file for setup and the install check.
function describeResult(result) {
  const lines = result.files.map(file => {
    const where = `${harnessLabel(file.harness)} (${file.display || file.file})`;
    if (file.state === 'broken') return `${where}: held, the Toolkit markers are broken (${file.detail}). Fix or remove them, then run setup toolkit.`;
    if (file.state === 'not-utf8') return `${where}: held, ${file.detail}. Save it as UTF-8, then run setup toolkit.`;
    if (file.action === 'opted-out') return `${where}: removed by you; run setup toolkit to reinstall`;
    if (file.action === 'restored') return `${where}: restored; an edit inside the Toolkit block was replaced, and the edited copy is in the backup below`;
    if (file.action === 'checked') return `${where}: ${file.state}`;
    return `${where}: ${file.action === 'unchanged' ? 'current' : file.action}`;
  });
  for (const { file, display, title } of result.covered) {
    lines.push(`Your hand-written "${title}" section in ${display || file} repeats the Toolkit global rules; remove it when convenient. Toolkit does not edit it.`);
  }
  const limit = result.doc_limit;
  if (result.doc_limit?.load_check) lines.push(result.doc_limit.load_check.detail);
  const manual = `set ${DOC_LIMIT_KEY} = ${DOC_LIMIT_TARGET} at the top of ~/.codex/config.toml yourself`;
  if (limit) {
    const where = `Codex ${DOC_LIMIT_KEY} (${limit.display})`;
    const was = limit.previous === 'none' ? `the default ${DOC_LIMIT_DEFAULT}` : limit.previous;
    if (limit.action === 'raised') lines.push(`${where}: raised to ${DOC_LIMIT_TARGET} (was ${was}); --remove puts it back`);
    else if (limit.action === 'restored-previous') lines.push(`${where}: put back to ${was}`);
    else if (limit.action === 'deleted-file') lines.push(`${where}: put back; Toolkit had created config.toml for it, so the file is deleted`);
    else if (limit.state === 'broken') lines.push(`${where}: held, ${limit.detail}. Fix or remove the Toolkit lines, then run setup toolkit.`);
    else if (limit.state === 'not-utf8') lines.push(`${where}: held, the file is not UTF-8 text, so Toolkit will not rewrite it.`);
    else if (limit.state === 'invalid') lines.push(`${where}: held, ${limit.detail}. Toolkit changed nothing; fix config.toml so Codex can read it.`);
    else if (limit.state === 'ineffective') lines.push(`${where}: held, the Toolkit-marked ${DOC_LIMIT_TARGET} is not in effect (${limit.detail}). Fix config.toml by hand.`);
    else if (limit.state === 'manual') lines.push(`${where}: not changed, ${limit.detail}; ${manual} if Codex cuts off repository rules.`);
    else if (limit.state === 'unverified') lines.push(`${where}: not checked, ${limit.detail}.`);
    else if (limit.state === 'off') lines.push(`${where}: 0, so Codex reads no repository AGENTS.md; Toolkit leaves your choice alone.`);
  }
  const budget = result.codex_budget;
  if (budget && budget.limit !== 0) {
    const sizes = `${budget.user_display} ${budget.user} B + ${budget.repo_display} ${budget.repo} B = ${budget.total} B of ${budget.limit} B`;
    lines.push(budget.over
      ? `Codex instructions: ${sizes}; over the limit, so Codex may cut off the end of the repository's rules. Answer yes to "Raise Codex's instruction limit" in setup toolkit, or ${manual}.`
      : `Codex instructions: ${sizes}`);
  }
  if (result.backup_dir) lines.push(`Backup: ${result.backup_display || result.backup_dir}`);
  return lines;
}

function parseArgs(argv) {
  const args = { mode: null, harnesses: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (['--check', '--write', '--remove'].includes(argv[i])) {
      if (args.mode) fail('GLOBAL_RULES_ARGUMENT', 'Choose one of --check, --write or --remove.');
      args.mode = argv[i].slice(2);
    } else if (argv[i] === '--harness') args.harnesses = String(argv[++i] || '').split(',').filter(Boolean);
    else fail('GLOBAL_RULES_ARGUMENT', `Unknown argument: ${argv[i]}`);
  }
  if (!args.mode) fail('GLOBAL_RULES_ARGUMENT', 'Usage: node repo/scripts/toolkit-global-rules.cjs --check|--write|--remove [--harness claude-code,codex,antigravity]');
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  // An explicit --write is the owner's own request, so it also raises Codex's limit.
  const rules = new GlobalRules({ harnesses: args.harnesses || GlobalRules.setupHarnesses(), codexDocLimit: args.mode === 'write' ? 'raise' : 'report' });
  const result = args.mode === 'check' ? rules.check() : args.mode === 'write' ? rules.refresh() : rules.remove();
  for (const line of describeResult(result)) console.log(line);
  return result.status === 'held' || (args.mode === 'check' && result.status === 'stale') ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}

module.exports = Object.freeze({ BLOCK_NAME, SOURCE, HARNESSES, DOC_LIMIT_TARGET, GlobalRules, CodexDocLimit, GlobalRulesFile, globalRulesBlock, harnessFile, describeResult, main });
