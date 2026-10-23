#!/usr/bin/env node
'use strict';

// Copies the official n8n skills (pinned exact copy under repo/contracts/third-party/n8n-io-skills/skills)
// into an app's own skills folder: Claude Code ~/.claude/skills, Codex ~/.agents/skills, and Antigravity
// ~/.gemini/config/skills when Antigravity is installed. Only skill files are copied; nothing runs.
// Toolkit records each folder it created in ~/.ai-agent-toolkit/n8n-official-skills.json and only ever
// updates or removes those. A folder of the same name that Toolkit did not create (a hand copy) is
// reported and never changed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCE_REL = path.join('repo', 'contracts', 'third-party', 'n8n-io-skills', 'skills');
const LEDGER_SCHEMA = 'ai-agent-toolkit.n8n-official-skills.v1';
const HOST_TARGETS = Object.freeze({
  'claude-code': ['.claude', 'skills'],
  codex: ['.agents', 'skills']
});
const ANTIGRAVITY_TARGET = ['.gemini', 'config', 'skills'];
// Antigravity's IDE also reads this older global folder; Toolkit never writes there.
const ANTIGRAVITY_OLDER = ['.gemini', 'antigravity', 'skills'];

const normalized = (buffer) => buffer.toString('utf8').replace(/\r\n/g, '\n');

function listFiles(root, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(relative, entry.name);
    const info = fs.lstatSync(path.join(root, rel));
    if (info.isSymbolicLink()) throw new Error(`The n8n skills copy found a symbolic link and stopped: ${rel}`);
    if (info.isDirectory()) files.push(...listFiles(root, rel));
    else if (info.isFile()) files.push(rel);
  }
  return files;
}

class OfficialN8nSkills {
  #sourceRoot; #homeDir; #host; #ledgerPath;

  constructor({ toolkitRoot, host, homeDir = os.homedir(), controlRoot } = {}) {
    if (!Object.hasOwn(HOST_TARGETS, host)) throw new Error(`Unsupported host for the n8n skills copy: ${host}`);
    this.#sourceRoot = path.join(toolkitRoot, SOURCE_REL);
    this.#homeDir = homeDir;
    this.#host = host;
    this.#ledgerPath = path.join(controlRoot || path.join(homeDir, '.ai-agent-toolkit'), 'n8n-official-skills.json');
  }

  // This app's skills folder, plus Antigravity's when Antigravity is installed (~/.gemini exists).
  targets() {
    const targets = [path.join(this.#homeDir, ...HOST_TARGETS[this.#host])];
    if (fs.existsSync(path.join(this.#homeDir, '.gemini'))) targets.push(path.join(this.#homeDir, ...ANTIGRAVITY_TARGET));
    return targets;
  }

  skillNames() {
    return fs.readdirSync(this.#sourceRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }

  #readLedger() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#ledgerPath, 'utf8'));
      if (parsed?.schema === LEDGER_SCHEMA && parsed.targets && typeof parsed.targets === 'object') return parsed.targets;
    } catch { /* absent or unreadable reads as empty */ }
    return {};
  }

  #saveLedger(targets) {
    const live = Object.fromEntries(Object.entries(targets).filter(([, names]) => names.length));
    if (!Object.keys(live).length) { fs.rmSync(this.#ledgerPath, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.#ledgerPath), { recursive: true });
    const temp = `${this.#ledgerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ schema: LEDGER_SCHEMA, targets: live }, null, 2)}\n`, { flag: 'wx' });
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

  // Copies missing and stale Toolkit-owned folders; hand copies stay as they are.
  install() {
    const ledger = this.#readLedger();
    const result = { copied: [], current: [], handCopies: [], loadTwice: [] };
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
    result.loadTwice = this.#loadTwice();
    return result;
  }

  // The user's own copies that load next to Toolkit's: an older release's name (without "-official")
  // in a folder Toolkit copies to, and either name in Antigravity's older global folder. Never touched.
  #loadTwice() {
    const folders = [...this.targets()];
    const antigravity = path.join(this.#homeDir, ...ANTIGRAVITY_TARGET);
    const older = path.join(this.#homeDir, ...ANTIGRAVITY_OLDER);
    if (folders.includes(antigravity)) folders.push(older);
    const found = new Set();
    for (const folder of folders) {
      for (const skill of this.skillNames()) {
        const oldName = skill.replace(/-official$/, '');
        const names = folder === older ? [skill, oldName] : [oldName].filter((name) => name !== skill);
        for (const name of names) if (fs.existsSync(path.join(folder, name))) found.add(path.join(folder, name));
      }
    }
    return [...found].map((dir) => `${path.basename(dir)} in ${path.relative(this.#homeDir, path.dirname(dir)).replace(/\\/g, '/')}`);
  }

  // Removes only the folders Toolkit recorded.
  remove() {
    const ledger = this.#readLedger();
    const removed = [];
    for (const [target, names] of Object.entries(ledger)) {
      for (const skill of names) {
        fs.rmSync(path.join(target, skill), { recursive: true, force: true });
        removed.push({ target, skill });
      }
    }
    this.#saveLedger({});
    return removed;
  }
}

// One line for setup's summary; names only, no private paths.
function installSummary(result) {
  const parts = [];
  if (result.copied.length) parts.push(`${result.copied.length} folder copies updated`);
  if (result.current.length) parts.push(`${result.current.length} already current`);
  if (result.handCopies.length) {
    const names = [...new Set(result.handCopies.map((row) => row.skill))].join(', ');
    parts.push(`kept your own copies of ${names} (Toolkit never changes them; delete them yourself to let Toolkit manage them)`);
  }
  if (result.loadTwice?.length) {
    const byFolder = new Map();
    for (const entry of result.loadTwice) {
      const [name, folder] = entry.split(' in ');
      byFolder.set(folder, [...(byFolder.get(folder) || []), name]);
    }
    const listed = [...byFolder].map(([folder, names]) => `${names.join(', ')} in ~/${folder}`).join('; ');
    parts.push(`your own older copies also load (${listed}); delete them yourself so the skills do not load twice`);
  }
  return parts.join('; ') || 'nothing to copy';
}

function main(argv = process.argv.slice(2)) {
  const host = argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : 'claude-code';
  const owner = new OfficialN8nSkills({ toolkitRoot: path.resolve(__dirname, '..', '..'), host });
  if (argv.includes('--remove')) {
    const removed = owner.remove();
    console.log(`Removed ${removed.length} Toolkit copies of the official n8n skills.`);
    return 0;
  }
  if (argv.includes('--write')) {
    console.log(`Official n8n skills: ${installSummary(owner.install())}.`);
    return 0;
  }
  for (const row of owner.inspect()) console.log(`${row.state}\t${row.skill}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ OfficialN8nSkills, installSummary, HOST_TARGETS });
