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

// Codex reads the user-level AGENTS.md and the repository's AGENTS.md files only up to
// project_doc_max_bytes in total (32 KiB by default), so the global block can push repository
// rules past the limit. Toolkit raises that top-level key in config.toml to 65536 when the
// effective value is lower, inside its own comment markers that keep the previous value, and puts
// that value back on removal. Nothing else in config.toml changes.
const DOC_LIMIT_KEY = 'project_doc_max_bytes';
const DOC_LIMIT_DEFAULT = 32768;
const DOC_LIMIT_TARGET = 65536;
const DOC_LIMIT_BEGIN = /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=(\d+|none)\r?$/m;
const DOC_LIMIT_END = /^# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\r?$/m;
const TOML_TABLE = /^[ \t]*\[/m;
const TOP_LEVEL_KEY = /^[ \t]*project_doc_max_bytes[ \t]*=[ \t]*(\d+)[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/m;

class CodexDocLimit {
  #file; #backupDir;
  constructor({ file, backupDir }) { this.#file = file; this.#backupDir = backupDir; }

  get file() { return this.#file; }

  // The text before the first [table]: only there is a key top-level.
  static #topEnd(text) { const match = TOML_TABLE.exec(text); return match ? match.index : text.length; }

  // state: managed | sufficient | low | not-utf8 | broken; limit: the value Codex uses.
  assess() {
    const read = readUserFile(this.#file);
    if (read === null) return { state: 'low', limit: DOC_LIMIT_DEFAULT, previous: null };
    if (read.text === null) return { state: 'not-utf8', limit: null, previous: null };
    const text = read.text;
    const begin = DOC_LIMIT_BEGIN.exec(text);
    const end = DOC_LIMIT_END.exec(text);
    if (Boolean(begin) !== Boolean(end) || (begin && end.index < begin.index)) return { state: 'broken', limit: null, previous: null };
    if (begin) return { state: 'managed', limit: DOC_LIMIT_TARGET, previous: begin[1] };
    const key = TOP_LEVEL_KEY.exec(text.slice(0, CodexDocLimit.#topEnd(text)));
    const limit = key ? Number(key[1]) : DOC_LIMIT_DEFAULT;
    return { state: limit >= DOC_LIMIT_TARGET ? 'sufficient' : 'low', limit, previous: key ? key[1] : 'none' };
  }

  #write(original, updated) {
    let backup = null;
    if (original) {
      fs.mkdirSync(this.#backupDir, { recursive: true });
      backup = path.join(this.#backupDir, 'codex-config.toml');
      fs.writeFileSync(backup, original.bytes);
    }
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    writeFileAtomically(this.#file, updated);
    if (readIfExists(this.#file) !== updated) fail('GLOBAL_RULES_READBACK_MISMATCH', `${this.#file} did not read back as written.`);
    return backup;
  }

  // Raises the limit when it is lower than the target. Returns { action, limit, previous, backup }.
  ensure() {
    const before = this.assess();
    if (before.state !== 'low') return { ...before, action: ['managed', 'sufficient'].includes(before.state) ? 'unchanged' : 'held' };
    const original = readUserFile(this.#file);
    let text = original ? original.text : '';
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const key = TOP_LEVEL_KEY.exec(text.slice(0, CodexDocLimit.#topEnd(text)));
    // The block takes the old key's place, or goes just before the first [table].
    if (key) text = text.slice(0, key.index) + text.slice(key.index + key[0].length);
    const block = [`# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=${before.previous || 'none'}`,
      `${DOC_LIMIT_KEY} = ${DOC_LIMIT_TARGET}`, '# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES', ''].join(eol);
    const at = key ? key.index : CodexDocLimit.#topEnd(text);
    const head = text.slice(0, at);
    const separator = head && !/\r?\n$/.test(head) ? eol : '';
    const updated = `${head}${separator}${block}${text.slice(at)}`;
    const backup = this.#write(original, updated);
    return { state: 'managed', limit: DOC_LIMIT_TARGET, previous: before.previous || 'none', action: 'raised', backup };
  }

  // Puts the previous value back (or no key at all) and removes Toolkit's markers.
  restore() {
    const before = this.assess();
    if (before.state !== 'managed') return { ...before, action: before.state === 'broken' || before.state === 'not-utf8' ? 'held' : 'unchanged' };
    const original = readUserFile(this.#file);
    const text = original.text;
    const begin = DOC_LIMIT_BEGIN.exec(text);
    const end = DOC_LIMIT_END.exec(text);
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const afterEnd = end.index + end[0].length;
    const stop = afterEnd + (/^\r?\n/.exec(text.slice(afterEnd))?.[0].length || 0);
    const replacement = before.previous === 'none' ? '' : `${DOC_LIMIT_KEY} = ${before.previous}${eol}`;
    const updated = text.slice(0, begin.index) + replacement + text.slice(stop);
    const backup = this.#write(original, updated);
    const limit = before.previous === 'none' ? DOC_LIMIT_DEFAULT : Number(before.previous);
    return { state: limit >= DOC_LIMIT_TARGET ? 'sufficient' : 'low', limit, previous: before.previous, action: 'restored-previous', backup };
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
  #files; #home; #backupRoot; #retentionDays; #now; #backupDir; #respectRemoval; #manageDocLimit; #docLimit = null; #repoAgents = null;
  // respectRemoval: true for session starts, which leave a file the owner removed the block from
  // alone; false for setup and --write, which reinstall and clear that removal.
  constructor({ environment = process.env, toolkitRoot = TOOLKIT_ROOT, harnesses = ['claude-code', 'codex'],
    backupRoot, ledgerFile, retentionDays = 7, now = () => new Date(), respectRemoval = false, repoAgentsFile = null,
    manageCodexDocLimit = true } = {}) {
    this.#respectRemoval = respectRemoval === true;
    // Setup never changes ~/.codex/config.toml outside its approved question bank, so it only reports
    // the Codex limit; the Codex session-start hook and --write raise it.
    this.#manageDocLimit = manageCodexDocLimit !== false;
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
      this.#docLimit = new CodexDocLimit({ file: path.join(path.dirname(harnessFile('codex', env)), 'config.toml'), backupDir: this.#backupDir });
      // The repository whose rules share Codex's budget: the git root of the working folder, else this Toolkit checkout.
      const gitRoot = nearestGitRoot(process.cwd());
      this.#repoAgents = repoAgentsFile || (gitRoot && fs.existsSync(path.join(gitRoot, 'AGENTS.md')) ? path.join(gitRoot, 'AGENTS.md') : path.join(toolkitRoot, 'AGENTS.md'));
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

  // Installs or refreshes each block, and raises Codex's instruction limit unless the owner removed the Codex block.
  refresh() {
    return this.#withPrune(() => {
      const files = this.#files.map(file => file.install({ respectRemoval: this.#respectRemoval }));
      const codex = files.find(file => file.harness === 'codex');
      const limit = !this.#docLimit ? null : this.#manageDocLimit && codex && !['opted-out', 'held'].includes(codex.action)
        ? this.#docLimit.ensure() : { ...this.#docLimit.assess(), action: 'reported' };
      return [files, limit];
    });
  }

  remove() {
    return this.#withPrune(() => [this.#files.map(file => file.remove()),
      this.#docLimit ? (this.#manageDocLimit ? this.#docLimit.restore() : { ...this.#docLimit.assess(), action: 'reported' }) : null]);
  }

  #withPrune(run) {
    const result = this.#summary(...run());
    this.#pruneBackups();
    return result;
  }

  // status: current (nothing to do), updated (written this run), stale (check only) or held.
  #summary(files, docLimit = null) {
    const held = files.filter(file => file.state === 'broken' || file.state === 'not-utf8');
    const limitHeld = docLimit && ['broken', 'not-utf8'].includes(docLimit.state);
    const changed = [...files, ...(docLimit ? [docLimit] : [])].filter(file => !['unchanged', 'checked', 'reported', 'absent', 'held', 'opted-out'].includes(file.action));
    const stale = files.filter(file => file.action === 'checked' && file.state !== 'current');
    const status = held.length || limitHeld ? 'held' : changed.length ? 'updated' : stale.length ? 'stale' : 'current';
    const backups = [...new Set([...files, ...(docLimit ? [docLimit] : [])].map(file => file.backup).filter(Boolean).map(file => path.dirname(file)))];
    const covered = files.flatMap(file => file.covered.map(title => ({ file: file.file, display: this.#display(file.file), title })));
    const shown = files.map(file => ({ ...file, display: this.#display(file.file) }));
    // run_id names this run (its backup folder), so every write gets its own update-report entry.
    return { status, run_id: path.basename(this.#backupDir), files: shown, backup_dir: backups[0] || null,
      backup_display: backups[0] ? this.#display(backups[0]) : null, covered,
      doc_limit: docLimit ? { ...docLimit, display: this.#display(this.#docLimit.file) } : null, codex_budget: this.#codexBudget(docLimit),
      detail: [...held.map(file => `${this.#display(file.file)}: ${file.detail}`), ...(limitHeld ? [`${this.#display(this.#docLimit.file)}: ${docLimit.state}`] : [])].join('; ') };
  }

  // Codex counts the user-level AGENTS.md and the repository's AGENTS.md against one limit.
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
  if (limit) {
    const where = `Codex ${DOC_LIMIT_KEY} (${limit.display})`;
    if (limit.state === 'broken') lines.push(`${where}: held, the Toolkit markers are broken. Fix or remove them, then run setup toolkit.`);
    else if (limit.state === 'not-utf8') lines.push(`${where}: held, the file is not UTF-8 text, so Toolkit will not rewrite it.`);
    else if (limit.action === 'raised') lines.push(`${where}: raised to ${DOC_LIMIT_TARGET} (was ${limit.previous === 'none' ? `the default ${DOC_LIMIT_DEFAULT}` : limit.previous})`);
    else if (limit.action === 'restored-previous') lines.push(`${where}: put back to ${limit.previous === 'none' ? `the default ${DOC_LIMIT_DEFAULT}` : limit.previous}`);
  }
  const budget = result.codex_budget;
  if (budget) {
    const sizes = `${budget.user_display} ${budget.user} B + ${budget.repo_display} ${budget.repo} B = ${budget.total} B of ${budget.limit} B`;
    lines.push(budget.over
      ? `Codex instructions: ${sizes}; over the limit, so Codex cuts off the end of the repository's rules until ${DOC_LIMIT_KEY} is raised (the next Codex session start does it, or run toolkit-global-rules.cjs --write --harness codex).`
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
  const rules = new GlobalRules({ harnesses: args.harnesses || GlobalRules.setupHarnesses() });
  const result = args.mode === 'check' ? rules.check() : args.mode === 'write' ? rules.refresh() : rules.remove();
  for (const line of describeResult(result)) console.log(line);
  return result.status === 'held' || (args.mode === 'check' && result.status === 'stale') ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}

module.exports = Object.freeze({ BLOCK_NAME, SOURCE, HARNESSES, GlobalRules, GlobalRulesFile, globalRulesBlock, harnessFile, describeResult, main });
