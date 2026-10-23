'use strict';

// Copies skill folders from a Toolkit source folder into apps' skills folders. Toolkit records each
// folder it created in a ledger under ~/.ai-agent-toolkit and only ever updates or removes those. A
// folder of the same name that Toolkit did not create (a hand copy) is reported and never changed.
// Only skill files are copied; nothing runs.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const normalized = (buffer) => buffer.toString('utf8').replace(/\r\n/g, '\n');
const SKILL_FOLDER = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

// A ledger entry Toolkit may act on: a plain skill-folder name inside an absolute `skills` folder.
function safeEntry(target, name) {
  return typeof target === 'string' && path.isAbsolute(target) && path.basename(target) === 'skills' && typeof name === 'string' && SKILL_FOLDER.test(name);
}

function listFiles(root, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(relative, entry.name);
    const info = fs.lstatSync(path.join(root, rel));
    if (info.isSymbolicLink()) throw new Error(`The skills copy found a symbolic link and stopped: ${rel}`);
    if (info.isDirectory()) files.push(...listFiles(root, rel));
    else if (info.isFile()) files.push(rel);
  }
  return files;
}

class ManagedSkillCopies {
  #sourceRoot; #ledgerPath; #ledgerSchema; #targets; #include;

  // targets: () => the folders to copy into. include: (name) => whether a source folder is copied.
  constructor({ sourceRoot, ledgerPath, ledgerSchema, targets, include = () => true }) {
    this.#sourceRoot = sourceRoot;
    this.#ledgerPath = ledgerPath;
    this.#ledgerSchema = ledgerSchema;
    this.#targets = targets;
    this.#include = include;
  }

  targets() { return this.#targets(); }

  skillNames() {
    return fs.readdirSync(this.#sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && this.#include(entry.name)).map((entry) => entry.name).sort();
  }

  #readLedger() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#ledgerPath, 'utf8'));
      if (parsed?.schema === this.#ledgerSchema && parsed.targets && typeof parsed.targets === 'object') {
        // Entries that are not a plain skill folder inside a skills folder are dropped, never acted on.
        return Object.fromEntries(Object.entries(parsed.targets)
          .map(([target, names]) => [target, Array.isArray(names) ? names.filter((name) => safeEntry(target, name)) : []])
          .filter(([target, names]) => safeEntry(target, 'x') && names.length));
      }
    } catch { /* absent or unreadable reads as empty */ }
    return {};
  }

  #saveLedger(targets) {
    const live = Object.fromEntries(Object.entries(targets).filter(([, names]) => names.length));
    if (!Object.keys(live).length) { fs.rmSync(this.#ledgerPath, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.#ledgerPath), { recursive: true });
    const temp = `${this.#ledgerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ schema: this.#ledgerSchema, targets: live }, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temp, this.#ledgerPath);
  }

  // Whether a Toolkit-owned folder matches the source (CRLF and LF count as the same text).
  #current(sourceDir, targetDir) {
    if (!fs.existsSync(targetDir)) return false;
    const sourceFiles = listFiles(sourceDir);
    const targetFiles = listFiles(targetDir);
    if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) return false;
    return sourceFiles.every((rel) => normalized(fs.readFileSync(path.join(sourceDir, rel))) === normalized(fs.readFileSync(path.join(targetDir, rel))));
  }

  // Whether Toolkit has copies recorded.
  hasCopies() { return Object.values(this.#readLedger()).some((names) => names.length); }

  // { target, skill, state: 'current' | 'stale' | 'missing' | 'hand-copy' } for every skill and target.
  inspect() {
    const ledger = this.#readLedger();
    const rows = [];
    for (const target of this.targets()) {
      const owned = new Set(ledger[target] || []);
      for (const skill of this.skillNames()) {
        const targetDir = path.join(target, skill);
        let state = 'missing';
        if (fs.existsSync(targetDir)) state = !owned.has(skill) ? 'hand-copy' : (this.#current(path.join(this.#sourceRoot, skill), targetDir) ? 'current' : 'stale');
        rows.push({ target, skill, state });
      }
    }
    return rows;
  }

  // Copies missing and stale Toolkit-owned folders and removes Toolkit's copies of skills that are no
  // longer in the source; hand copies stay as they are.
  install() {
    const ledger = this.#readLedger();
    const result = { copied: [], current: [], handCopies: [], pruned: [] };
    const names = new Set(this.skillNames());
    for (const target of this.targets()) {
      const stale = (ledger[target] || []).filter((name) => !names.has(name));
      for (const name of stale) { fs.rmSync(path.join(target, name), { recursive: true, force: true }); result.pruned.push({ target, skill: name }); }
      if (stale.length) { ledger[target] = ledger[target].filter((name) => names.has(name)); this.#saveLedger(ledger); }
    }
    for (const row of this.inspect()) {
      if (row.state === 'hand-copy') { result.handCopies.push(row); continue; }
      if (row.state === 'current') { result.current.push(row); continue; }
      const targetDir = path.join(row.target, row.skill);
      // Record first, so an interrupted copy is still Toolkit's to finish or remove.
      ledger[row.target] = [...new Set([...(ledger[row.target] || []), row.skill])].sort();
      this.#saveLedger(ledger);
      fs.rmSync(targetDir, { recursive: true, force: true });
      const sourceDir = path.join(this.#sourceRoot, row.skill);
      for (const rel of listFiles(sourceDir)) {
        fs.mkdirSync(path.dirname(path.join(targetDir, rel)), { recursive: true });
        fs.copyFileSync(path.join(sourceDir, rel), path.join(targetDir, rel));
      }
      result.copied.push(row);
    }
    return result;
  }

  // Removes only the folders Toolkit recorded (in one target, when given).
  remove(onlyTarget = null) {
    const ledger = this.#readLedger();
    const removed = [];
    for (const [target, names] of Object.entries(ledger)) {
      if (onlyTarget && target !== onlyTarget) continue;
      for (const skill of names) {
        fs.rmSync(path.join(target, skill), { recursive: true, force: true });
        removed.push({ target, skill });
      }
      delete ledger[target];
    }
    this.#saveLedger(ledger);
    return removed;
  }
}

// One line for setup's summary; names only, no private paths.
function copySummary(result) {
  const parts = [];
  if (result.copied.length) parts.push(`${result.copied.length} folder copies updated`);
  if (result.current.length) parts.push(`${result.current.length} already current`);
  if (result.pruned?.length) parts.push(`removed ${result.pruned.length} retired skill cop${result.pruned.length === 1 ? 'y' : 'ies'}`);
  if (result.handCopies.length) {
    const names = [...new Set(result.handCopies.map((row) => row.skill))].join(', ');
    parts.push(`kept your own copies of ${names} (Toolkit never changes them; delete them yourself to let Toolkit manage them)`);
  }
  return parts;
}

module.exports = Object.freeze({ ManagedSkillCopies, copySummary });
