#!/usr/bin/env node
'use strict';

// Memory tidy: the controller of any repository compares that repository's Claude Code memory notes
// with the installed Toolkit release and, only on the owner's yes to an exact preview, removes,
// rewrites or retires the notes the owner picked. It prevents notes that restate a Toolkit default,
// contradict a newer one or work around a fixed bug from winning over Toolkit in later chats, and
// keeps rules that only one repository's memory carries from staying hidden from every other user.
//
//   node toolkit-memory-tidy.cjs find    [--repo-root <checkout>]
//   node toolkit-memory-tidy.cjs check   --out <worksheet.json> [--include <memory folder>]... [--repo-root <checkout>]
//   node toolkit-memory-tidy.cjs verify  --worksheet <worksheet.json> [--repo-root <checkout>]
//   node toolkit-memory-tidy.cjs preview --worksheet <worksheet.json> --plan <code> --pick <n,n,...> [--repo-root <checkout>]
//   node toolkit-memory-tidy.cjs keep-all --worksheet <worksheet.json>
//   node toolkit-memory-tidy.cjs apply   --worksheet <worksheet.json> --pick <n,n,...> --preview <code> [--repo-root <checkout>]
//   node toolkit-memory-tidy.cjs restore --backup <folder> [--repo-root <checkout>]
//
// Flow: find lists the folders; check writes a worksheet (one row per note and per index problem)
// outside any tracked tree; the agent fills one verdict per note; verify checks every verdict against
// this release's own text and prints the owner's list and a plan code; the owner answers "keep
// everything" (keep-all) or picks numbers; preview shows exactly what would change, note by note,
// and a preview code; only after the owner's yes to that preview, apply backs up each touched folder
// whole and makes exactly those changes; restore puts a backup back.
//
// Verdicts: default (already a Toolkit default: goes), outdated (out of date or against Toolkit: goes
// or is rewritten), repo-fact (this repository's own fact: stays, or goes once its new home in the
// repository holds it), owner-preference (the owner's own preference: stays, or goes once the
// owner's own instructions hold it), gap (a Toolkit gap: stays until Toolkit fixes it), keep (kept as
// memory, with why). A note goes only with a quote this release holds verbatim in its rules, docs,
// skills or hooks (or, for outdated, a Toolkit path the note names that this release lacks).
//
// Scope: only the memory folders of the repository it runs for (by Git identity), never another
// repository's, a parent folder's, Projects or Codex. It writes no file outside those memory folders
// except the worksheet and its store summary at the path the agent names, and its backups beside the
// memory folder (`<memory folder>-tidy-backups/<preview code>/`, never inside it, so no chat loads
// them). It never writes AGENTS.md, the owner's instructions or Toolkit's own folders: a moved note
// goes only once its new home already holds its line. apply and restore refuse gate and helper sessions.
//
// Host facts, from the Claude Code memory docs (https://code.claude.com/docs/en/memory, sections
// "Auto memory", "How it works" and "Storage location", read 26 Nov 2026): each git repository has
// one memory folder, <config dir>/projects/<project>/memory, shared by all its worktrees and
// subfolders; `autoMemoryDirectory` (any settings scope; an absolute path or one starting with ~/)
// moves it; `CLAUDE_CODE_PROJECT_DIR_NAME` beside `CLAUDE_CONFIG_DIR` names <project>; the first 200
// lines or 25 KB of MEMORY.md, whichever comes first, load at session start and topic notes are read
// on demand; memory files are plain markdown the user may edit or delete; memory is per machine.
// Not in the docs: how <project> is spelled from a path. find therefore also reads the working folder
// recorded in each project folder's chat transcripts. A policy or --settings `autoMemoryDirectory`
// is not visible to this tool, and find says so.
//
// Exit codes: 0 done, 1 refused or held (the message says why and what to do), 2 could not run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { findBlocks } = require('./toolkit-managed-block.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA = 'toolkit-memory-tidy/1';
const MANIFEST_SCHEMA = 'toolkit-memory-tidy-backup/1';
const INDEX = 'MEMORY.md';
const START_LINES = 200;
const START_BYTES = 25 * 1024;
const MAX_WORKSHEET = 5 * 1024 * 1024;
const MAX_NOTE = 256 * 1024;
const TRANSCRIPT_HEAD = 64 * 1024;
const TRANSCRIPTS_READ = 20;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const CODE = /^[0-9a-f]{16}$/;
const WIN = process.platform === 'win32';

const VERDICTS = Object.freeze({
  default: 'Already a Toolkit default',
  outdated: 'Out of date or against Toolkit',
  'repo-fact': "This repository's own fact",
  'owner-preference': "The owner's own preference",
  gap: 'Toolkit gap',
  keep: 'Kept as memory, with why',
});
const VERDICT_ORDER = Object.keys(VERDICTS);
const FOLDER_KINDS = Object.freeze({ main: 'main folder', worktree: 'old worktree folder', clone: 'another clone', setting: 'folder set by autoMemoryDirectory', named: 'folder named by CLAUDE_CODE_PROJECT_DIR_NAME', included: 'unresolved folder, included' });

// Where a removal's quote may come from: the release's current rules, docs, skills and hooks. History,
// audits and third-party text never stand in for a current rule.
const EVIDENCE_ROOTS = ['repo/contracts/', 'repo/docs/', 'skills/'];
const EVIDENCE_EXCLUDED = ['repo/contracts/third-party/', 'repo/docs/CHANGELOG.md', 'repo/docs/changelog.d/', 'repo/docs/audits/'];
const HOOK_SCRIPT = /^repo\/scripts\/[A-Za-z0-9._-]*(?:hook|guard)[A-Za-z0-9._-]*\.(?:cjs|js|ps1)$/;
const RELATIVE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const TOOLKIT_PATH = /^(?:repo|skills|\.claude-plugin|\.codex-plugin)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const ROUTE = /^(?:#[1-9][0-9]{0,6}|new)$/;
// Control and format characters (zero-width, direction and byte-order marks), line and paragraph
// separators, surrogates and private-use characters.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}]/u;

class TidyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- Small pure helpers ----

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const code16 = value => sha(JSON.stringify(value)).slice(0, 16);
const fold = text => String(text).replace(/\s+/g, ' ').trim();
const plain = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\r\n\t]/.test(value) && !INVISIBLE.test(value);
const wordCount = text => (fold(text).match(/\S+/g) || []).length;
const canon = file => { let full = path.resolve(file); try { full = fs.realpathSync.native(full); } catch { /* not there */ } return WIN ? full.toLowerCase() : full; };
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel)); };
const projectName = folder => folder.replace(/[^A-Za-z0-9]/g, '-');
const folderId = folder => `f${sha(canon(folder)).slice(0, 8)}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
const quoteBlock = text => String(text).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');

function normOrigin(url) {
  if (!url) return null;
  let value = url.trim().toLowerCase().replace(/\.git\/?$/, '').replace(/\/+$/, '');
  value = value.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/, '').replace(/^[^@/]+@([^:/]+):/, '$1/');
  return value || null;
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

// The Git identity of the checkout at `folder`: { common, main, origin() }, or null outside Git.
function repositoryAt(folder) {
  if (!fs.existsSync(folder)) return null;
  const out = git(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel']);
  if (!out) return null;
  const [common, top] = out.split(/\r?\n/);
  const main = path.basename(common) === '.git' ? path.dirname(path.resolve(common)) : path.resolve(top);
  let origin;
  return { common: canon(common), main, origin: () => (origin === undefined ? (origin = normOrigin(git(folder, ['config', '--get', 'remote.origin.url']))) : origin) };
}

// The working folders recorded in a project folder's chat transcripts (the first lines of each).
function transcriptFolders(projectFolder) {
  const found = new Set();
  let names = [];
  try { names = fs.readdirSync(projectFolder).filter(name => name.endsWith('.jsonl')); } catch { return []; }
  for (const name of names.slice(0, TRANSCRIPTS_READ)) {
    let text = '';
    try {
      const handle = fs.openSync(path.join(projectFolder, name), 'r');
      try { const buffer = Buffer.alloc(TRANSCRIPT_HEAD); text = buffer.subarray(0, fs.readSync(handle, buffer, 0, buffer.length, 0)).toString('utf8'); } finally { fs.closeSync(handle); }
    } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"cwd"')) continue;
      try { const cwd = JSON.parse(line).cwd; if (typeof cwd === 'string' && cwd) { found.add(cwd); break; } } catch { /* a cut line */ }
    }
  }
  return [...found];
}

// A note's frontmatter fields, or null when it has none.
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields = {};
  let section = null;
  const unquote = value => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  for (const raw of match[1].split(/\r?\n/)) {
    const top = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(raw);
    const nested = /^[ \t]+([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(raw);
    if (top) { section = top[2].trim() === '' ? top[1] : null; if (!section) fields[top[1]] = unquote(top[2]); } else if (nested && section) fields[`${section}.${nested[1]}`] = unquote(nested[2]);
  }
  return { name: fields.name || null, description: fields.description || null, type: fields.type || fields['metadata.type'] || null };
}

// MEMORY.md as lines, each with the local notes it links.
function indexLines(text) {
  return text.split('\n').map((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const targets = [...line.matchAll(/\]\(<?([^()<>\s]+?\.md)>?\)/g)].map(match => match[1]).filter(target => RELATIVE_PATH.test(target) && !target.includes('/'));
    return { line: index + 1, text: line, targets: [...new Set(targets)] };
  });
}

// What is wrong with a folder's index: duplicate and missing links (fixable when the line links
// nothing else that stays), notes with no line, no index, and an index past the start-load limit.
function indexProblems(index, notes) {
  const rows = [];
  const names = new Set(notes.map(note => note.file));
  if (!index) {
    if (notes.length) rows.push({ kind: 'no-index', line: null, target: null, line_sha256: null, fixable: false });
    return rows;
  }
  const lines = indexLines(index.text);
  const seen = new Map();
  for (const entry of lines) {
    for (const target of entry.targets) {
      if (!names.has(target)) rows.push({ kind: 'missing', line: entry.line, target, line_sha256: sha(entry.text), fixable: entry.targets.every(other => !names.has(other)) });
      else if (seen.has(target)) rows.push({ kind: 'duplicate', line: entry.line, target, line_sha256: sha(entry.text), fixable: entry.targets.every(other => seen.has(other) || !names.has(other)) });
    }
    for (const target of entry.targets) if (!seen.has(target)) seen.set(target, entry.line);
  }
  for (const note of notes) if (!seen.has(note.file)) rows.push({ kind: 'unindexed', line: null, target: note.file, line_sha256: null, fixable: false });
  const count = index.text.replace(/\r?\n$/, '').split('\n').length;
  if (count > START_LINES || index.bytes.length > START_BYTES) rows.push({ kind: 'over-limit', line: null, target: null, line_sha256: null, fixable: false });
  return rows;
}

// Every regular file in a folder, recursively, as { rel (forward slashes), full }. A link refuses.
function filesIn(folder) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new TidyError('TIDY_LINK', `The memory folder holds a link (${rel}), so this tool does not change it. Look at it by hand.`);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.push({ rel, full });
    }
  };
  walk(folder, '');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

// One memory folder as read now: its index and notes (top-level .md files other than MEMORY.md).
function readFolder(folder) {
  const notes = [];
  let index = null;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = path.join(folder, entry.name);
    const bytes = fs.readFileSync(full);
    if (bytes.length > MAX_NOTE) throw new TidyError('TIDY_UNREADABLE', `${entry.name} in ${folder} is over 256 KB, so this tool does not read the folder. Look at it by hand.`);
    let text;
    try { text = STRICT_UTF8.decode(bytes); } catch { throw new TidyError('TIDY_UNREADABLE', `${entry.name} in ${folder} is not valid UTF-8, so this tool does not read the folder. Look at it by hand.`); }
    if (entry.name === INDEX) index = { bytes, text };
    else notes.push({ file: entry.name, bytes, text, front: frontmatter(text) });
  }
  notes.sort((a, b) => (a.file < b.file ? -1 : 1));
  const linkName = note => (note.front && note.front.name) || note.file.replace(/\.md$/, '');
  const links = new Map(notes.map(note => [note.file, [...new Set([...note.text.matchAll(/\[\[([^\]\n]{1,120})\]\]/g)].map(match => match[1].trim()))]]));
  return {
    index,
    notes: notes.map(note => ({
      ...note,
      links_out: links.get(note.file),
      links_in: notes.filter(other => other !== note && links.get(other.file).includes(linkName(note))).map(other => other.file),
      link_name: linkName(note),
    })),
  };
}

// ---- The worksheet reader: default-deny over the fixed schema ----

const NOTE_KEYS = ['n', 'folder', 'file', 'sha256', 'bytes', 'name', 'description', 'type', 'indexed', 'links_in', 'links_out', 'verdict', 'gist', 'why', 'evidence', 'gap', 'move', 'rewrite'];
const NOTE_FACTS = NOTE_KEYS.slice(0, 11);
const INDEX_KEYS = ['n', 'folder', 'kind', 'line', 'target', 'line_sha256', 'fixable', 'verdict'];
const INDEX_FACTS = INDEX_KEYS.slice(0, 7);
const FOLDER_KEYS = ['id', 'path', 'kind', 'index_sha256'];
const TOP_KEYS = ['schema', 'run', 'release', 'repository', 'folders', 'notes', 'index'];
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function readWorksheetFile(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (error) { throw new TidyError('TIDY_WORKSHEET', `The worksheet could not be read (${error.code || error.name}).`); }
  if (bytes.length > MAX_WORKSHEET) throw new TidyError('TIDY_WORKSHEET', 'The worksheet is over 5 MB.');
  let sheet;
  try { sheet = JSON.parse(STRICT_UTF8.decode(bytes)); } catch { throw new TidyError('TIDY_WORKSHEET', 'The worksheet is not valid UTF-8 JSON.'); }
  if (!exactKeys(sheet, TOP_KEYS) || sheet.schema !== SCHEMA || typeof sheet.run !== 'string' || !CODE.test(sheet.run)) throw new TidyError('TIDY_WORKSHEET', 'The worksheet is not one this tool wrote (schema, run id or top-level fields differ). Run check again.');
  if (![sheet.folders, sheet.notes, sheet.index].every(Array.isArray)) throw new TidyError('TIDY_WORKSHEET', 'The worksheet lists are missing.');
  return sheet;
}

// ---- The owner object ----

class MemoryTidy {
  #root; #repoRoot; #environment; #home; #configDir; #now; #files; #refused;

  // `files` holds the file operations apply and restore write with (write, remove); `refused` says
  // which sessions may not write (toolkit-controller-settings.cjs refusedSession by default).
  constructor({ root = ROOT, repoRoot = process.cwd(), environment = process.env, now = () => new Date(), files = null, refused = null } = {}) {
    this.#root = root;
    this.#repoRoot = repoRoot;
    this.#environment = environment;
    this.#home = (WIN ? environment.USERPROFILE : environment.HOME) || environment.HOME || os.homedir();
    this.#configDir = environment.CLAUDE_CONFIG_DIR || path.join(this.#home, '.claude');
    this.#now = now;
    this.#files = files || {
      write: (file, before, next) => require('./toolkit-controller-settings.cjs').replaceFile(file, before, next),
      remove: file => fs.unlinkSync(file),
    };
    this.#refused = refused || (env => require('./toolkit-controller-settings.cjs').refusedSession(env));
  }

  // ---- find ----

  #repository() {
    const repository = repositoryAt(this.#repoRoot);
    if (!repository) throw new TidyError('TIDY_NOT_GIT', 'This folder is in no Git repository, so there is no repository memory to tidy. Run it from the repository\'s folder or name it with --repo-root.');
    return repository;
  }

  // The memory folder `autoMemoryDirectory` names, and the settings file it came from, or null.
  // Precedence follows Claude Code's settings order: local over project over user.
  #settingFolder(repository) {
    const files = [path.join(repository.main, '.claude', 'settings.local.json'), path.join(repository.main, '.claude', 'settings.json'), path.join(this.#configDir, 'settings.json')];
    for (const file of files) {
      let value;
      try { value = JSON.parse(fs.readFileSync(file, 'utf8')).autoMemoryDirectory; } catch { continue; }
      if (typeof value !== 'string' || !value) continue;
      const folder = value.startsWith('~/') ? path.join(this.#home, value.slice(2)) : value;
      if (path.isAbsolute(folder)) return { folder: path.resolve(folder), from: file };
    }
    return null;
  }

  // The repository's memory folders on this computer: { repository, included, unresolved, empty, others }.
  find() {
    const repository = this.#repository();
    const projects = path.join(this.#configDir, 'projects');
    const included = [];
    const unresolved = [];
    const add = (list, folder, kind, extra = {}) => { if (![...included, ...unresolved].some(entry => canon(entry.path) === canon(folder))) list.push({ id: folderId(folder), path: folder, kind, ...extra }); };
    const setting = this.#settingFolder(repository);
    if (setting) add(included, setting.folder, 'setting', { from: setting.from });
    const named = this.#environment.CLAUDE_CODE_PROJECT_DIR_NAME && this.#environment.CLAUDE_CONFIG_DIR ? this.#environment.CLAUDE_CODE_PROJECT_DIR_NAME : null;
    if (named && RELATIVE_PATH.test(named) && !named.includes('/')) add(included, path.join(projects, named, 'memory'), 'named');
    const mainName = projectName(repository.main);
    let empty = 0;
    let others = 0;
    let entries = [];
    try { entries = fs.readdirSync(projects, { withFileTypes: true }).filter(entry => entry.isDirectory()); } catch { /* no projects yet */ }
    const repositories = new Map();
    const identity = folder => { if (!repositories.has(folder)) repositories.set(folder, repositoryAt(folder)); return repositories.get(folder); };
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const project = path.join(projects, entry.name);
      const memory = path.join(project, 'memory');
      let hasNotes = false;
      try { hasNotes = fs.readdirSync(memory).some(name => name.endsWith('.md')); } catch { continue; }
      const mine = entry.name === mainName || entry.name.startsWith(`${mainName}-`);
      if (!hasNotes) { if (mine) empty += 1; continue; }
      const cwds = transcriptFolders(project);
      const live = cwds.filter(cwd => fs.existsSync(cwd));
      const ids = live.map(identity).filter(Boolean);
      if (ids.some(id => id.common === repository.common)) { add(included, memory, entry.name === mainName ? 'main' : 'worktree'); continue; }
      if (repository.origin() && ids.some(id => !inside(canon(id.main), canon(repository.main)) && id.origin() === repository.origin())) { add(included, memory, 'clone'); continue; }
      if (entry.name === mainName && !ids.length) { add(included, memory, 'main'); continue; }
      const gone = cwds.filter(cwd => !fs.existsSync(cwd));
      if (!live.length && (gone.some(cwd => inside(canon(cwd), canon(repository.main))) || (mine && !cwds.length))) { add(unresolved, memory, 'unresolved'); continue; }
      if (mine) others += 1;
    }
    return { repository, included, unresolved, empty, others, setting };
  }

  // Each folder's counts and index health, for find's list (no note text).
  #describe(folder) {
    const { index, notes } = readFolder(folder.path);
    const problems = indexProblems(index, notes);
    const lines = index ? index.text.replace(/\r?\n$/, '').split('\n').length : 0;
    return { ...folder, notes: notes.length, index_lines: lines, index_bytes: index ? index.bytes.length : 0, problems };
  }

  findReport() {
    const found = this.find();
    const label = repoLabel(found.repository);
    const out = [`**Memory folders of ${label}** (Claude Code, this computer)`, ''];
    const describe = (folder, title) => {
      const info = this.#describe(folder);
      const health = summariseProblems(info.problems);
      out.push(`- **${title}** \`${folder.path}\`: ${plural(info.notes, 'note')}; ${INDEX} ${plural(info.index_lines, 'line')}, ${kb(info.index_bytes)} (up to ${START_LINES} lines or ${START_BYTES / 1024} KB load at start); index: ${health}.`);
    };
    for (const folder of found.included) describe(folder, capital(FOLDER_KINDS[folder.kind]) + (folder.from ? ` (from ${folder.from})` : ''));
    for (const folder of found.unresolved) describe(folder, 'Unresolved (its chat folder no longer exists; left out unless check gets --include with this path)');
    if (!found.included.length && !found.unresolved.length) out.push('- **No memory notes** for this repository on this computer.');
    out.push(`- **Empty memory folders:** ${found.empty} (left alone).`);
    if (found.others) out.push(`- **Folders of other repositories with a similar name:** ${found.others} (left alone).`);
    out.push('- **Not visible here:** a memory folder set by a policy or --settings `autoMemoryDirectory`.');
    return out.join('\n');
  }

  // ---- check ----

  // The release this checkout is and the one the user's Claude Code global rules came from.
  #release() {
    const version = JSON.parse(fs.readFileSync(path.join(this.#root, 'repo/contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
    return { version, commit: git(this.#root, ['rev-parse', 'HEAD']) };
  }

  #requireLoadedRelease() {
    const release = this.#release();
    let text = '';
    try { text = fs.readFileSync(path.join(this.#configDir, 'CLAUDE.md'), 'utf8'); } catch { /* none */ }
    const block = findBlocks(text).blocks.find(found => found.name === 'GLOBAL-RULES');
    if (!block) throw new TidyError('TIDY_RELEASE', 'Your Claude Code CLAUDE.md has no Toolkit global rules block, so there is no installed release to compare the notes with. Run setup toolkit first.');
    if (block.version !== release.version) throw new TidyError('TIDY_RELEASE', `This Toolkit checkout is ${release.version} but your Claude Code global rules came from ${block.version}, so the notes would be judged against a release your chats do not load. Run refresh toolkit, then check again.`);
    return release;
  }

  // The output paths the worksheet and its summary may use: never in a memory folder, and never in a
  // Git working tree unless Git ignores them (note text must not be committed by accident).
  #requireLocalPath(file, label) {
    const full = path.resolve(file);
    if (inside(canon(full), canon(path.join(this.#configDir, 'projects')))) throw new TidyError('TIDY_OUT', `The ${label} may not go inside Claude Code's project folders. Put it in a scratch folder.`);
    let dir = path.dirname(full);
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const top = git(dir, ['rev-parse', '--show-toplevel']);
    if (top && spawnSync('git', ['-C', top, 'check-ignore', '-q', '--', full], { windowsHide: true }).status !== 0) throw new TidyError('TIDY_OUT', `The ${label} would be inside the Git working tree ${path.resolve(top)} and Git does not ignore it, so note text could be committed. Put it in a scratch folder outside any repository, or in an ignored folder such as .tmp/.`);
    return full;
  }

  // The worksheet rows for the folders as they are now.
  #sheetFacts(folders) {
    const notes = [];
    const index = [];
    const folderRows = [];
    for (const folder of folders) {
      const { index: file, notes: read } = readFolder(folder.path);
      folderRows.push({ id: folder.id, path: folder.path, kind: folder.kind, index_sha256: file ? sha(file.bytes) : null });
      for (const note of read) {
        notes.push({ n: 0, folder: folder.id, file: note.file, sha256: sha(note.bytes), bytes: note.bytes.length, name: note.front ? note.front.name : null, description: note.front ? note.front.description : null, type: note.front ? note.front.type : null, indexed: !indexProblems(file, read).some(row => row.kind === 'unindexed' && row.target === note.file), links_in: note.links_in, links_out: note.links_out });
      }
      for (const row of indexProblems(file, read)) index.push({ n: 0, folder: folder.id, ...row });
    }
    notes.forEach((row, at) => { row.n = at + 1; });
    index.forEach((row, at) => { row.n = notes.length + at + 1; });
    return { folders: folderRows, notes, index };
  }

  check({ out, include = [] }) {
    const release = this.#requireLoadedRelease();
    const target = this.#requireLocalPath(out, 'worksheet');
    const found = this.find();
    const folders = [...found.included];
    for (const extra of include) {
      const match = found.unresolved.find(folder => canon(folder.path) === canon(extra));
      if (!match) throw new TidyError('TIDY_INCLUDE', `${extra} is not one of the unresolved folders find lists for this repository, so it is not read.`);
      folders.push({ ...match, kind: 'included' });
    }
    const facts = this.#sheetFacts(folders);
    const sheet = {
      schema: SCHEMA,
      run: crypto.randomBytes(8).toString('hex'),
      release,
      repository: { main: found.repository.main, origin: found.repository.origin() },
      folders: facts.folders,
      notes: facts.notes.map(row => ({ ...row, verdict: null, gist: null, why: null, evidence: null, gap: null, move: null, rewrite: null })),
      index: facts.index.map(row => ({ ...row, verdict: null })),
    };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(sheet, null, 2)}\n`, { flag: 'w' });
    return { file: target, sheet };
  }

  // ---- verify ----

  // The worksheet, checked whole against the memory as it is now and this release: every row's
  // facts unchanged, one valid verdict per note, every removal's evidence found. Returns the checked
  // sheet, its folders as read now and its plan code, or throws with every problem listed.
  #checked(file) {
    const sheet = readWorksheetFile(file);
    const release = this.#release();
    if (!isObject(sheet.release) || sheet.release.version !== release.version || sheet.release.commit !== release.commit) throw new TidyError('TIDY_STALE', 'Toolkit changed since this worksheet was made, so its evidence may no longer hold. Run check again.');
    const found = this.find();
    if (!isObject(sheet.repository) || sheet.repository.main !== found.repository.main) throw new TidyError('TIDY_SCOPE', 'This worksheet is for another repository. Run check in this repository.');
    const allowed = [...found.included, ...found.unresolved.map(folder => ({ ...folder, kind: 'included' }))];
    const folders = sheet.folders.map(row => {
      const match = exactKeys(row, FOLDER_KEYS) && allowed.find(folder => folder.id === row.id && folder.path === row.path && (folder.kind === row.kind));
      if (!match) throw new TidyError('TIDY_SCOPE', 'The worksheet names a memory folder that is not this repository\'s. Run check again.');
      return match;
    });
    const now = this.#sheetFacts(folders);
    const same = (a, b, keys) => keys.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
    const fresh = now.folders.length === sheet.folders.length && now.folders.every((row, at) => same(row, sheet.folders[at], FOLDER_KEYS))
      && now.notes.length === sheet.notes.length && now.notes.every((row, at) => exactKeys(sheet.notes[at], NOTE_KEYS) && same(row, sheet.notes[at], NOTE_FACTS))
      && now.index.length === sheet.index.length && now.index.every((row, at) => exactKeys(sheet.index[at], INDEX_KEYS) && same(row, sheet.index[at], INDEX_FACTS));
    if (!fresh) throw new TidyError('TIDY_STALE', 'The memory changed since this worksheet was made (or the worksheet\'s note facts were edited). Run check again and fill the verdicts again.');
    const problems = [];
    for (const row of sheet.notes) problems.push(...this.#noteProblems(row, folders));
    for (const row of sheet.index) {
      if (row.verdict === 'fix' && !row.fixable) problems.push(`Row ${row.n}: this index row cannot be fixed by the tool; its verdict is keep.`);
      else if (!['fix', 'keep'].includes(row.verdict)) problems.push(`Row ${row.n}: an index row's verdict is fix or keep.`);
    }
    if (problems.length) throw new TidyError('TIDY_VERDICTS', `The worksheet is not ready, so nothing is shown to the owner:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
    return { sheet, folders, plan: code16({ run: sheet.run, release: sheet.release, folders: sheet.folders, notes: sheet.notes, index: sheet.index }) };
  }

  #noteText(row, folders) {
    return fs.readFileSync(path.join(folders.find(folder => folder.id === row.folder).path, row.file), 'utf8');
  }

  // Why a note row's verdict cannot stand, as a list (empty when it stands).
  #noteProblems(row, folders) {
    const at = `Row ${row.n} (${row.file})`;
    const out = [];
    if (!Object.hasOwn(VERDICTS, row.verdict)) return [`${at}: give exactly one verdict: ${VERDICT_ORDER.join(', ')}.`];
    if (!plain(row.gist, 240)) out.push(`${at}: the gist is one line of plain text, up to 240 characters.`);
    const wants = { default: ['evidence'], outdated: ['evidence', 'rewrite'], 'repo-fact': ['move'], 'owner-preference': ['move'], gap: ['gap'], keep: ['why'] }[row.verdict];
    for (const key of ['why', 'evidence', 'gap', 'move', 'rewrite']) if (row[key] !== null && !wants.includes(key)) out.push(`${at}: ${key} does not go with the verdict ${row.verdict}; leave it null.`);
    if (row.verdict === 'keep' && !plain(row.why, 240)) out.push(`${at}: kept as memory needs a one-line why.`);
    if (row.verdict === 'gap') {
      if (!exactKeys(row.gap, ['failure', 'route']) || !plain(row.gap.failure, 240) || typeof row.gap.route !== 'string' || !ROUTE.test(row.gap.route)) out.push(`${at}: a gap needs { failure: the one-line failure it prevents, route: "#<issue>" or "new" }.`);
    }
    if (['default', 'outdated'].includes(row.verdict)) out.push(...this.#evidenceProblems(row, at, folders));
    if (row.verdict === 'outdated' && row.rewrite !== null) {
      const front = typeof row.rewrite === 'string' ? frontmatter(row.rewrite) : null;
      if (typeof row.rewrite !== 'string' || Buffer.byteLength(row.rewrite) > MAX_NOTE || !front || !front.name || !front.description || INVISIBLE.test(row.rewrite.replace(/[\r\n\t]/g, ' '))) out.push(`${at}: a rewrite is the note's whole new text, starting with frontmatter that has a name and a description.`);
    }
    if (row.move !== null) {
      const to = row.verdict === 'repo-fact' ? 'repository' : 'owner';
      const keys = to === 'repository' ? ['to', 'file', 'line'] : ['to', 'line'];
      if (!exactKeys(row.move, keys) || row.move.to !== to || !plain(row.move.line, 500) || wordCount(row.move.line) < 3
        || (to === 'repository' && (typeof row.move.file !== 'string' || !RELATIVE_PATH.test(row.move.file) || row.move.file.split('/').includes('..') || !row.move.file.endsWith('.md')))) {
        out.push(`${at}: a move is ${to === 'repository' ? '{ to: "repository", file: "<path in the repository>.md", line }' : '{ to: "owner", line }'}, with the line its new home must hold (3 words or more).`);
      }
    }
    return out;
  }

  #evidenceProblems(row, at, folders) {
    const evidence = row.evidence;
    if (row.verdict === 'outdated' && exactKeys(evidence, ['missing_path'])) {
      const missing = evidence.missing_path;
      if (typeof missing !== 'string' || !TOOLKIT_PATH.test(missing) || missing.split('/').includes('..')) return [`${at}: missing_path is a Toolkit path such as repo/scripts/<name>.cjs.`];
      if (fs.existsSync(path.join(this.#root, missing))) return [`${at}: ${missing} is still in this release, so it is not missing.`];
      if (!this.#noteText(row, folders).includes(missing)) return [`${at}: the note does not name ${missing}, so it does not rely on it.`];
      return [];
    }
    if (!exactKeys(evidence, ['file', 'quote'])) return [`${at}: ${row.verdict === 'outdated' ? 'evidence is { file, quote } or { missing_path }' : 'evidence is { file, quote }'}.`];
    const { file, quote } = evidence;
    if (typeof file !== 'string' || !RELATIVE_PATH.test(file) || file.split('/').includes('..')
      || !(EVIDENCE_ROOTS.some(rootPath => file.startsWith(rootPath)) || HOOK_SCRIPT.test(file)) || EVIDENCE_EXCLUDED.some(excluded => file === excluded || file.startsWith(excluded))) {
      return [`${at}: the evidence file must be a current rule, doc, skill or hook of this release (under ${EVIDENCE_ROOTS.join(', ')} or a repo/scripts hook or guard), not a changelog, audit or third-party file.`];
    }
    if (typeof quote !== 'string' || !quote.trim() || quote.length > 1000 || INVISIBLE.test(quote.replace(/[\r\n\t]/g, ' '))) return [`${at}: the quote is plain text copied from ${file}.`];
    let text;
    try { text = fs.readFileSync(path.join(this.#root, file), 'utf8'); } catch { return [`${at}: ${file} is not in this release.`]; }
    const wanted = fold(quote);
    if (!fold(text).includes(wanted)) return [`${at}: ${file} does not hold that quote word for word.`];
    if (wordCount(wanted) < 8 && !text.split(/\r?\n/).some(line => fold(line.replace(/^\s*(?:[-*+]|\d+[.)]|#+)\s+/, '')) === wanted)) return [`${at}: the quote is under 8 words and is not a whole line of ${file}.`];
    return [];
  }

  verify({ worksheet }) {
    const { sheet, folders, plan } = this.#checked(worksheet);
    const list = ownerList(sheet, folders, plan);
    const summaryFile = this.#requireLocalPath(path.join(path.dirname(path.resolve(worksheet)), 'store-summary.md'), 'store summary');
    const summary = storeSummary(sheet, plan, this.#now());
    const secrets = require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs');
    const found = [...secrets.scanText(list).map(hit => `owner list line ${hit.line} (${hit.label})`), ...secrets.scanText(summary).map(hit => `store summary line ${hit.line} (${hit.label})`)];
    for (const row of sheet.notes) if (row.rewrite && secrets.scanText(row.rewrite).length) found.push(`row ${row.n}'s rewrite`);
    if (found.length) throw new TidyError('TIDY_SECRET', `Something shaped like a secret is in ${found.join(', ')}, so nothing was written or shown. Reword it.`);
    // Answers already recorded here (an earlier keep-all or apply) stay in the record.
    let earlier = '';
    try { earlier = fs.readFileSync(summaryFile, 'utf8').split('\n## Answers\n\n')[1] || ''; } catch { /* first run */ }
    fs.writeFileSync(summaryFile, `${summary}${earlier}`);
    return { plan, list, summaryFile, counts: countsLine(sheet) };
  }

  // ---- preview ----

  // What the picks would change, folder by folder, as read now, and the preview code binding it.
  #changes(checked, picks) {
    const { sheet, folders, plan } = checked;
    const rows = new Map([...sheet.notes, ...sheet.index].map(row => [row.n, row]));
    const bad = picks.filter(n => !rows.has(n) || actionOf(rows.get(n)) === 'keep');
    if (bad.length) throw new TidyError('TIDY_PICK', `Not a row that can change: ${bad.join(', ')}. Pick from the numbers the list says can be picked.`);
    const plans = [];
    for (const folder of folders) {
      const mine = picks.map(n => rows.get(n)).filter(row => row.folder === folder.id);
      if (!mine.length) continue;
      const { index, notes } = readFolder(folder.path);
      const byFile = new Map(notes.map(note => [note.file, note]));
      const change = { folder, index_sha256: index ? sha(index.bytes) : null, removes: [], rewrites: [], held: [], drops: [], links: [] };
      for (const row of mine) {
        if (!Object.hasOwn(row, 'file')) continue;
        const note = byFile.get(row.file);
        const action = actionOf(row);
        if (action === 'rewrite') change.rewrites.push({ row, before: note.text, after: row.rewrite });
        else if (action === 'remove') change.removes.push({ row, text: note.text, why: VERDICTS[row.verdict] });
        else {
          const holds = this.#destinationHolds(row.move);
          if (holds.holds) change.removes.push({ row, text: note.text, why: `${VERDICTS[row.verdict]}, now held by ${holds.label}`, moved: holds });
          else change.held.push({ row, holds });
        }
      }
      const gone = new Set(change.removes.map(entry => entry.row.file));
      if (gone.size && gone.size >= notes.length) throw new TidyError('TIDY_WIPE', `These picks would remove every note in ${folder.path}. A tidy never empties a folder: keep at least one note, or remove them by hand if the owner truly wants that.`);
      const lines = index ? indexLines(index.text) : [];
      for (const entry of lines) {
        const goes = entry.targets.filter(target => gone.has(target));
        if (!goes.length) continue;
        const stays = entry.targets.filter(target => !gone.has(target) && byFile.has(target));
        if (stays.length) throw new TidyError('TIDY_PICK', `${INDEX} line ${entry.line} links ${goes.join(', ')} and also ${stays.join(', ')}, which stays. Edit that line by hand first, or pick those notes too.`);
        change.drops.push({ line: entry.line, text: entry.text, why: `links ${goes.join(', ')}` });
      }
      for (const row of mine.filter(item => !Object.hasOwn(item, 'file'))) {
        const entry = lines.find(line => line.line === row.line);
        if (!entry || sha(entry.text) !== row.line_sha256) throw new TidyError('TIDY_STALE', `${INDEX} changed since check (row ${row.n}). Run check again.`);
        if (!change.drops.some(drop => drop.line === entry.line)) change.drops.push({ line: entry.line, text: entry.text, why: row.kind === 'duplicate' ? `links ${row.target} again` : `links ${row.target}, which is not there` });
      }
      change.drops.sort((a, b) => a.line - b.line);
      for (const note of notes) {
        if (gone.has(note.file)) continue;
        const dangling = change.removes.filter(entry => note.links_out.includes(byFile.get(entry.row.file).link_name)).map(entry => entry.row.file);
        if (dangling.length) change.links.push({ file: note.file, to: dangling });
      }
      plans.push(change);
    }
    const preview = code16({
      plan,
      picks: [...picks].sort((a, b) => a - b),
      folders: plans.map(change => ({
        id: change.folder.id,
        index: change.index_sha256,
        removes: change.removes.map(entry => [entry.row.file, sha(entry.text), entry.moved ? entry.moved.label : null]),
        rewrites: change.rewrites.map(entry => [entry.row.file, sha(entry.before), sha(entry.after)]),
        held: change.held.map(entry => entry.row.file),
        drops: change.drops.map(drop => [drop.line, sha(drop.text)]),
      })),
    });
    return { changes: plans, preview };
  }

  // Whether a move's new home already holds its line. The repository's file is read from the default
  // branch as this clone last fetched it (a merged, reviewed change); the owner's own file outside
  // Toolkit's blocks. This tool never writes either.
  #destinationHolds(move) {
    const wanted = fold(move.line);
    if (move.to === 'owner') {
      const file = path.join(this.#configDir, 'CLAUDE.md');
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch { /* none */ }
      const { blocks, errors } = findBlocks(text);
      let own = text;
      if (!errors.length) for (const block of [...blocks].sort((a, b) => b.start - a.start)) own = own.slice(0, block.start) + own.slice(block.end);
      return { holds: !errors.length && fold(own).includes(wanted), label: 'your own instructions', where: file, line: move.line };
    }
    const { main } = this.#repository();
    const head = git(main, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const label = `${move.file} on ${head || 'the default branch'}`;
    if (!head) return { holds: false, label, where: move.file, line: move.line, why: 'this clone does not know its default branch (run git remote set-head origin --auto)' };
    const text = git(main, ['show', `${head}:${move.file}`]);
    return { holds: text !== null && fold(text).includes(wanted), label, where: move.file, line: move.line };
  }

  previewReport({ worksheet, plan, picks }) {
    const checked = this.#checked(worksheet);
    if (plan !== checked.plan) throw new TidyError('TIDY_STALE', 'That plan code is not the one for this worksheet as it is now. Run verify again and show the owner the new list.');
    const { changes, preview } = this.#changes(checked, picks);
    return { preview, text: previewText(checked.sheet, changes, picks, preview, this.#backupDir.bind(this)), changes };
  }

  #backupDir(folder, preview) {
    return path.join(`${folder.path}-tidy-backups`, preview);
  }

  // ---- keep-all ----

  keepAll({ worksheet }) {
    readWorksheetFile(worksheet);
    const summaryFile = this.#requireLocalPath(path.join(path.dirname(path.resolve(worksheet)), 'store-summary.md'), 'store summary');
    const line = `- ${this.#now().toISOString()}: the owner kept everything; no note changed and no backup was made.\n`;
    fs.appendFileSync(summaryFile, fs.existsSync(summaryFile) ? line : `# Memory tidy record\n\n## Answers\n\n${line}`);
    return { summaryFile };
  }

  // ---- apply ----

  #requireController(what) {
    const refused = this.#refused(this.#environment);
    if (refused) throw new TidyError('TIDY_ROLE', `${refused} cannot ${what}: only the controller does, after the owner's yes.`);
  }

  apply({ worksheet, picks, preview }) {
    this.#requireController('change memory notes');
    if (typeof preview !== 'string' || !CODE.test(preview)) throw new TidyError('TIDY_PREVIEW', 'apply needs --preview with the code of the preview the owner said yes to.');
    const checked = this.#checked(worksheet);
    const { changes, preview: now } = this.#changes(checked, picks);
    if (now !== preview) throw new TidyError('TIDY_PREVIEW', 'That preview code does not match these picks and the memory as it is now, so nothing was changed. Run preview again and show the owner exactly what would change.');
    const done = [];
    for (const change of changes) {
      if (!change.removes.length && !change.rewrites.length && !change.drops.length) { done.push({ change, backup: null }); continue; }
      const backup = this.#backup(change.folder, preview);
      try {
        this.#write(change);
        const after = readFolder(change.folder.path);
        const before = new Set(change.problemsBefore || []);
        const added = indexProblems(after.index, after.notes).filter(row => ['missing', 'unindexed', 'duplicate'].includes(row.kind)).map(row => `${row.kind} ${row.target}`).filter(key => !before.has(key));
        if (added.length) throw new TidyError('TIDY_HEALTH', `the index check after the change found: ${added.join(', ')}`);
      } catch (error) {
        let state;
        try { this.#putBack(backup, change.folder.path); state = 'The folder was put back from the backup and read back.'; } catch (restoreError) { state = `Putting the folder back failed too (${restoreError.message}); restore it by hand from the backup.`; }
        throw new TidyError('TIDY_APPLY', `The change to ${change.folder.path} failed (${error.message || error.code}). ${state} Backup: ${backup}`);
      }
      done.push({ change, backup });
    }
    const summaryFile = path.join(path.dirname(path.resolve(worksheet)), 'store-summary.md');
    if (fs.existsSync(summaryFile)) fs.appendFileSync(summaryFile, applySummary(done, preview, this.#now()));
    return { done, text: appliedText(done, preview) };
  }

  #write(change) {
    const folder = change.folder.path;
    const { index, notes } = readFolder(folder);
    change.problemsBefore = indexProblems(index, notes).filter(row => ['missing', 'unindexed', 'duplicate'].includes(row.kind)).map(row => `${row.kind} ${row.target}`);
    const byFile = new Map(notes.map(note => [note.file, note]));
    for (const entry of change.rewrites) this.#files.write(path.join(folder, entry.row.file), byFile.get(entry.row.file).bytes, Buffer.from(entry.after));
    if (change.drops.length) {
      const dropped = new Set(change.drops.map(drop => drop.line));
      const kept = index.text.split('\n').filter((line, at) => !dropped.has(at + 1));
      this.#files.write(path.join(folder, INDEX), index.bytes, Buffer.from(kept.join('\n')));
    }
    for (const entry of change.removes) {
      const file = path.join(folder, entry.row.file);
      if (!fs.readFileSync(file).equals(byFile.get(entry.row.file).bytes)) throw new TidyError('FILE_CHANGED', `${entry.row.file} changed while this ran`);
      this.#files.remove(file);
    }
  }

  // Copies the whole folder to its backup with a checksum manifest, and reads it all back.
  #backup(folder, preview) {
    const dir = this.#backupDir(folder, preview);
    if (fs.existsSync(dir)) throw new TidyError('TIDY_PREVIEW', `A backup for this preview already exists (${dir}): this preview was applied already. Run check and preview again for any further change.`);
    const files = filesIn(folder.path);
    const manifest = { schema: MANIFEST_SCHEMA, folder: folder.path, preview, made_at: this.#now().toISOString(), files: {} };
    fs.mkdirSync(dir, { recursive: true });
    for (const entry of files) {
      const bytes = fs.readFileSync(entry.full);
      const copy = path.join(dir, 'files', ...entry.rel.split('/'));
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.writeFileSync(copy, bytes, { flag: 'wx' });
      manifest.files[entry.rel] = sha(bytes);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    this.#readBackup(dir, folder.path);
    for (const entry of files) if (sha(fs.readFileSync(entry.full)) !== manifest.files[entry.rel]) throw new TidyError('TIDY_BACKUP', `${entry.rel} changed while it was backed up, so nothing was changed. Run check again.`);
    return dir;
  }

  // The backup's manifest, with every copy checked against it.
  #readBackup(dir, folderPath) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { throw new TidyError('TIDY_BACKUP', `The backup ${dir} has no readable manifest, so it is not used.`); }
    if (!exactKeys(manifest, ['schema', 'folder', 'preview', 'made_at', 'files']) || manifest.schema !== MANIFEST_SCHEMA || canon(manifest.folder) !== canon(folderPath) || !isObject(manifest.files)) throw new TidyError('TIDY_BACKUP', `The backup ${dir} is not a memory tidy backup of ${folderPath}, so it is not used.`);
    for (const [rel, digest] of Object.entries(manifest.files)) {
      if (!RELATIVE_PATH.test(rel) || rel.split('/').includes('..') || typeof digest !== 'string') throw new TidyError('TIDY_BACKUP', `The backup ${dir} names a file it may not (${rel}), so it is not used.`);
      let bytes;
      try { bytes = fs.readFileSync(path.join(dir, 'files', ...rel.split('/'))); } catch { throw new TidyError('TIDY_BACKUP', `The backup ${dir} lacks ${rel}, so it is not used.`); }
      if (sha(bytes) !== digest) throw new TidyError('TIDY_BACKUP', `The backup copy of ${rel} does not match its checksum, so the backup is not used.`);
    }
    return manifest;
  }

  // Writes every backed-up file back where it differs, then reads the folder back. A file made after
  // the backup stays and is listed.
  #putBack(dir, folderPath) {
    const manifest = this.#readBackup(dir, folderPath);
    for (const [rel, digest] of Object.entries(manifest.files)) {
      const target = path.join(folderPath, ...rel.split('/'));
      let stat = null;
      try { stat = fs.lstatSync(target); } catch { /* gone */ }
      if (stat && !stat.isFile()) throw new TidyError('TIDY_RESTORE', `${rel} is no longer a plain file (a folder or link is there now); move it aside by hand, then restore again.`);
      if (stat && sha(fs.readFileSync(target)) === digest) continue;
      const bytes = fs.readFileSync(path.join(dir, 'files', ...rel.split('/')));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.restore-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(temp, bytes, { flag: 'wx' });
      fs.renameSync(temp, target);
    }
    const extra = filesIn(folderPath).map(entry => entry.rel).filter(rel => !Object.hasOwn(manifest.files, rel));
    for (const [rel, digest] of Object.entries(manifest.files)) if (sha(fs.readFileSync(path.join(folderPath, ...rel.split('/')))) !== digest) throw new TidyError('TIDY_RESTORE', `${rel} did not read back the same after the restore.`);
    return { manifest, extra };
  }

  // ---- restore ----

  restore({ backup }) {
    this.#requireController('restore memory notes');
    const dir = path.resolve(backup);
    const match = /^(.*)-tidy-backups$/.exec(path.dirname(dir));
    if (!match || !CODE.test(path.basename(dir))) throw new TidyError('TIDY_BACKUP', 'Name a backup folder as apply printed it: <memory folder>-tidy-backups/<preview code>.');
    const folderPath = match[1];
    const found = this.find();
    if (![...found.included, ...found.unresolved].some(folder => canon(folder.path) === canon(folderPath))) throw new TidyError('TIDY_SCOPE', `${folderPath} is not a memory folder of this repository, so nothing was restored.`);
    const { manifest, extra } = this.#putBack(dir, folderPath);
    return { folder: folderPath, files: Object.keys(manifest.files).length, extra };
  }
}

// ---- What the owner and the store see ----

function actionOf(row) {
  if (!Object.hasOwn(row, 'file')) return row.verdict === 'fix' ? 'fix' : 'keep';
  if (row.verdict === 'default') return 'remove';
  if (row.verdict === 'outdated') return row.rewrite ? 'rewrite' : 'remove';
  if (['repo-fact', 'owner-preference'].includes(row.verdict) && row.move) return 'move';
  return 'keep';
}

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
// The repository's short name: the last two parts of its origin (owner/name), else its folder name.
const repoName = (origin, main) => (origin ? origin.split(/[\\/:]+/).filter(Boolean).slice(-2).join('/') : path.basename(main));
const repoLabel = repository => repoName(repository.origin(), repository.main);

function summariseProblems(problems) {
  if (!problems.length) return 'healthy';
  const counts = {};
  for (const row of problems) counts[row.kind] = (counts[row.kind] || 0) + 1;
  const words = { duplicate: 'duplicate line', missing: 'line to a missing note', unindexed: 'note with no index line', 'no-index': 'no index', 'over-limit': 'index past the start-load limit' };
  return Object.entries(counts).map(([kind, count]) => (kind === 'no-index' || kind === 'over-limit' ? words[kind] : plural(count, words[kind]))).join(', ');
}

function countsLine(sheet) {
  const counts = VERDICT_ORDER.map(verdict => [verdict, sheet.notes.filter(row => row.verdict === verdict).length]).filter(([, count]) => count);
  return `${plural(sheet.notes.length, 'note')} in ${plural(sheet.folders.length, 'folder')}: ${counts.map(([verdict, count]) => `${count} ${VERDICTS[verdict].toLowerCase()}`).join(', ') || 'none'}; ${plural(sheet.index.length, 'index row')}.`;
}

function ownerList(sheet, folders, plan) {
  const many = folders.length > 1;
  const where = row => (many ? ` (${FOLDER_KINDS[folders.find(folder => folder.id === row.folder).kind]})` : '');
  const out = [`**Memory notes of ${repoName(sheet.repository.origin, sheet.repository.main)}** (Toolkit ${sheet.release.version}; ${plural(sheet.notes.length, 'note')} in ${plural(folders.length, 'folder')})`];
  const pickable = [];
  for (const verdict of VERDICT_ORDER) {
    const rows = sheet.notes.filter(row => row.verdict === verdict);
    if (!rows.length) continue;
    out.push('', `**${VERDICTS[verdict]}**`);
    for (const row of rows) {
      const action = actionOf(row);
      if (action !== 'keep') pickable.push(row.n);
      out.push(`- **${row.n}. ${row.file}**${where(row)}: ${row.gist}`);
      if (row.evidence && row.evidence.quote) out.push(`  - **Toolkit already says:** "${fold(row.evidence.quote)}" (\`${row.evidence.file}\`)`);
      if (row.evidence && row.evidence.missing_path) out.push(`  - **Toolkit no longer has:** \`${row.evidence.missing_path}\`, which this note relies on`);
      if (verdict === 'default' || (verdict === 'outdated' && action === 'remove')) out.push('  - **If you pick it:** the note goes');
      if (action === 'rewrite') out.push('  - **If you pick it:** the note is rewritten; you see the new text before anything changes');
      if (verdict === 'repo-fact') out.push(row.move ? `  - **If you pick it:** the note goes once \`${row.move.file}\` on the default branch holds "${row.move.line}" (a normal reviewed change; this tool never writes it)` : '  - **Stays** as memory');
      if (verdict === 'owner-preference') out.push(row.move ? `  - **If you pick it:** the note goes once your own instructions hold "${row.move.line}" (you decide; Toolkit never writes them)` : '  - **Stays:** it is yours, and your own instructions are its home; you decide');
      if (verdict === 'gap') out.push(`  - **Stays until Toolkit fixes it:** ${row.gap.failure} (${row.gap.route === 'new' ? 'a new Toolkit issue' : `Toolkit ${row.gap.route}`})`);
      if (verdict === 'keep') out.push(`  - **Why it stays:** ${row.why}`);
    }
  }
  if (sheet.index.length) {
    out.push('', '**Index fixes**');
    const words = { duplicate: 'again (a line above already links it)', missing: ', which is not there', unindexed: 'has no index line', 'no-index': 'there is no MEMORY.md', 'over-limit': 'MEMORY.md is past the start-load limit (200 lines or 25 KB), so its end is not loaded' };
    for (const row of sheet.index) {
      if (row.verdict === 'fix') pickable.push(row.n);
      const what = row.line ? `${INDEX} line ${row.line}` : row.target || INDEX;
      out.push(`- **${row.n}. ${what}**${where(row)}: ${row.target && row.line ? `links \`${row.target}\`${row.kind === 'duplicate' ? ' ' : ''}` : ''}${words[row.kind]}${row.verdict === 'fix' ? '; **if you pick it:** the line goes' : '; report only, nothing changes'}`);
    }
  }
  out.push('', '**Your answer**', '- **Keep everything:** nothing changes and no backup is made.');
  pickable.sort((a, b) => a - b);
  if (pickable.length) out.push('- **Pick numbers** (for example "' + pickable.slice(0, 3).join(', ') + '"): you then see exactly what would change, note by note, before anything does.', `- **Can be picked:** ${pickable.join(', ')}`);
  else out.push('- **Nothing here can change:** every note stays as it is.');
  out.push('', `Plan code (for the agent): ${plan}`);
  return out.join('\n');
}

function storeSummary(sheet, plan, now) {
  const commit = sheet.release.commit ? ` (${sheet.release.commit.slice(0, 7)})` : '';
  const out = ['# Memory tidy record', '', `- **Run:** ${sheet.run}`, `- **Toolkit:** ${sheet.release.version}${commit}`, `- **Plan code:** ${plan}`, `- **Made:** ${now.toISOString()}`, `- **Counts:** ${countsLine(sheet)}`, '', '## Notes', ''];
  for (const row of sheet.notes) {
    let line = `- \`${row.folder}/${row.file}\`: ${VERDICTS[row.verdict].toLowerCase()}`;
    if (row.evidence && row.evidence.quote) line += `. Toolkit: \`${row.evidence.file}\`, "${fold(row.evidence.quote)}"`;
    if (row.evidence && row.evidence.missing_path) line += `. Toolkit no longer has \`${row.evidence.missing_path}\``;
    if (row.rewrite) line += '; proposed rewrite';
    if (row.move) line += `; moves to ${row.move.to === 'owner' ? "the owner's own instructions" : `the repository's \`${row.move.file}\``} once it holds the line`;
    if (row.gap) line += `; routed to ${row.gap.route === 'new' ? 'a new Toolkit issue' : row.gap.route}`;
    out.push(/[."]$/.test(line) ? line : `${line}.`);
  }
  if (sheet.index.length) {
    out.push('', '## Index', '');
    for (const row of sheet.index) out.push(`- \`${row.folder}/${INDEX}\`${row.line ? ` line ${row.line}` : ''}: ${row.kind}${row.target ? ` \`${row.target}\`` : ''}; ${row.verdict}.`);
  }
  out.push('', '## Answers', '');
  return `${out.join('\n')}\n`;
}

function previewText(sheet, changes, picks, preview, backupDir) {
  const out = [`**What would change** (picks ${[...picks].sort((a, b) => a - b).join(', ')}; nothing has changed yet)`];
  for (const change of changes) {
    for (const entry of change.removes) {
      out.push('', `**Goes: ${entry.row.n}. ${entry.row.file}** (\`${path.join(change.folder.path, entry.row.file)}\`)`, `- **Why:** ${entry.why}`);
      if (entry.moved) out.push(`- **Its new home holds:** "${entry.moved.line}" (${entry.moved.label})`);
      out.push('- **Its full text now:**', '', quoteBlock(entry.text));
    }
    for (const entry of change.rewrites) {
      const before = entry.before.replace(/\r\n/g, '\n').split('\n');
      const after = entry.after.replace(/\r\n/g, '\n').split('\n');
      out.push('', `**Rewritten: ${entry.row.n}. ${entry.row.file}** (\`${path.join(change.folder.path, entry.row.file)}\`)`, `- **Why:** ${VERDICTS[entry.row.verdict]}`, '- **Lines that change:**');
      for (const line of before.filter(text => text.trim() && !after.includes(text))) out.push(`  - **Goes:** ${line}`);
      for (const line of after.filter(text => text.trim() && !before.includes(text))) out.push(`  - **Comes in:** ${line}`);
      out.push('- **Its full text now:**', '', quoteBlock(entry.before), '', '- **Its full text after:**', '', quoteBlock(entry.after));
    }
    for (const entry of change.held) {
      out.push('', `**Held, nothing changes: ${entry.row.n}. ${entry.row.file}**`, `- **Why:** its new home (${entry.holds.label}) does not hold "${entry.holds.line}" yet${entry.holds.why ? `, and ${entry.holds.why}` : ''}`, '- **Next:** once that line is there (a reviewed change for the repository, or your own edit for your instructions), preview again');
    }
    if (change.drops.length) {
      out.push('', `**${INDEX} lines that go** (\`${path.join(change.folder.path, INDEX)}\`)`);
      for (const drop of change.drops) out.push(`- **Line ${drop.line}** (${drop.why}): ${drop.text}`);
    }
    if (change.links.length) {
      out.push('', '**[[links]] that would then point at a removed note** (listed, not edited)');
      for (const link of change.links) out.push(`- **${link.file}:** ${link.to.join(', ')}`);
    }
    if (change.removes.length || change.rewrites.length || change.drops.length) {
      out.push('', '**Before anything changes**', `- **Backup:** the whole folder is copied first to \`${backupDir(change.folder, preview)}\`, with a checksum list, and read back`, '- **Undo:** the agent puts the folder back from that backup on your OK');
    }
  }
  out.push('', '**Your answer**', '- **Keep everything:** nothing changes and no backup is made.', '- **Yes:** make exactly these changes and nothing else.', '', `Preview code (for the agent): ${preview}`);
  return out.join('\n');
}

function appliedText(done, preview) {
  const out = [`**Memory tidy done** (preview ${preview})`];
  for (const { change, backup } of done) {
    out.push('', `**${change.folder.path}**`);
    if (change.removes.length) out.push(`- **Removed:** ${change.removes.map(entry => entry.row.file).join(', ')}`);
    if (change.rewrites.length) out.push(`- **Rewritten:** ${change.rewrites.map(entry => entry.row.file).join(', ')}`);
    if (change.drops.length) out.push(`- **${INDEX} lines removed:** ${change.drops.length}`);
    if (change.held.length) out.push(`- **Held (new home lacks the line):** ${change.held.map(entry => entry.row.file).join(', ')}`);
    if (change.links.length) out.push(`- **[[links]] now pointing at a removed note:** ${change.links.map(link => `${link.file} (${link.to.join(', ')})`).join('; ')}`);
    if (backup) out.push(`- **Backup (read back):** \`${backup}\``, `- **Undo, on the owner's OK:** \`node "${__filename}" restore --backup "${backup}"\``);
    else out.push('- **Nothing changed** in this folder, so no backup was made.');
  }
  return out.join('\n');
}

function applySummary(done, preview, now) {
  const parts = [];
  for (const { change, backup } of done) {
    const bits = [];
    if (change.removes.length) bits.push(`removed ${change.removes.map(entry => entry.row.file).join(', ')}`);
    if (change.rewrites.length) bits.push(`rewrote ${change.rewrites.map(entry => entry.row.file).join(', ')}`);
    if (change.drops.length) bits.push(`removed ${plural(change.drops.length, 'index line')}`);
    if (change.held.length) bits.push(`held ${change.held.map(entry => entry.row.file).join(', ')}`);
    parts.push(`${change.folder.id}: ${bits.join('; ') || 'nothing'}${backup ? `; backup ${change.folder.id}/${preview}` : ''}`);
  }
  return `- ${now.toISOString()}: the owner said yes to preview ${preview}; ${parts.join(' | ')}.\n`;
}

// ---- Command line ----

const USAGE = 'Usage: toolkit-memory-tidy.cjs find | check --out <file> [--include <folder>]... | verify --worksheet <file> | preview --worksheet <file> --plan <code> --pick <n,...> | keep-all --worksheet <file> | apply --worksheet <file> --pick <n,...> --preview <code> | restore --backup <folder>   [--repo-root <checkout>]';
const FLAGS = Object.freeze({
  find: [], check: ['out', 'include'], verify: ['worksheet'], preview: ['worksheet', 'plan', 'pick'],
  'keep-all': ['worksheet'], apply: ['worksheet', 'pick', 'preview'], restore: ['backup'],
});
const REQUIRED = Object.freeze({ check: ['out'], verify: ['worksheet'], preview: ['worksheet', 'plan', 'pick'], 'keep-all': ['worksheet'], apply: ['worksheet', 'pick', 'preview'], restore: ['backup'] });

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(FLAGS, command)) throw new TidyError('TIDY_ARGUMENTS', USAGE);
  const options = { command, include: [] };
  for (let at = 0; at < rest.length; at += 2) {
    const flag = rest[at];
    const value = rest[at + 1];
    const key = typeof flag === 'string' && flag.startsWith('--') ? flag.slice(2) : null;
    if (!key || !(FLAGS[command].includes(key) || key === 'repo-root')) throw new TidyError('TIDY_ARGUMENTS', `Unknown flag ${flag} for ${command}. ${USAGE}`);
    if (value === undefined || value.startsWith('--')) throw new TidyError('TIDY_ARGUMENTS', `${flag} needs a value.`);
    if (key === 'include') { options.include.push(value); continue; }
    if (options[key] !== undefined) throw new TidyError('TIDY_ARGUMENTS', `${flag} is given twice.`);
    options[key] = value;
  }
  for (const key of REQUIRED[command] || []) if (options[key] === undefined) throw new TidyError('TIDY_ARGUMENTS', `${command} needs --${key}. ${USAGE}`);
  if (options.pick !== undefined) {
    const picks = options.pick.split(',').map(part => part.trim());
    if (!picks.length || picks.some(part => !/^[1-9][0-9]{0,5}$/.test(part)) || new Set(picks).size !== picks.length) throw new TidyError('TIDY_ARGUMENTS', '--pick takes the row numbers the owner picked, each once, such as 1,3,10.');
    options.picks = picks.map(Number);
  }
  return options;
}

function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, environment = process.env, root = ROOT, now, files, refused } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { stderr.write(`${error.message}\n`); return 2; }
  const tidy = new MemoryTidy({ root, repoRoot: options['repo-root'] || process.cwd(), environment, now, files, refused });
  try {
    const say = text => stdout.write(`${text}\n`);
    switch (options.command) {
      case 'find': say(tidy.findReport()); return 0;
      case 'check': {
        const { file, sheet } = tidy.check({ out: options.out, include: options.include });
        say(`Worksheet written: ${file}\n${plural(sheet.notes.length, 'note')} and ${plural(sheet.index.length, 'index row')} to judge, against Toolkit ${sheet.release.version}. Fill one verdict per note, then run verify. Compare ${sheet.release.version} with the Toolkit version your session started with; if they differ, refresh first.`);
        return 0;
      }
      case 'verify': {
        const { list, summaryFile, counts } = tidy.verify({ worksheet: options.worksheet });
        say(`${list}\n\nStore summary written (file names, verdicts and cited Toolkit text only): ${summaryFile}\nFor GitHub (counts only): ${counts}`);
        return 0;
      }
      case 'preview': say(tidy.previewReport({ worksheet: options.worksheet, plan: options.plan, picks: options.picks }).text); return 0;
      case 'keep-all': { const { summaryFile } = tidy.keepAll({ worksheet: options.worksheet }); say(`**Kept everything:** no note changed and no backup was made. Recorded in ${summaryFile}.`); return 0; }
      case 'apply': say(tidy.apply({ worksheet: options.worksheet, picks: options.picks, preview: options.preview }).text); return 0;
      case 'restore': {
        const { folder, files: count, extra } = tidy.restore({ backup: options.backup });
        say(`**Restored** ${folder} from the backup: ${plural(count, 'file')} read back.${extra.length ? ` Files made after the backup were left in place: ${extra.join(', ')}.` : ''}`);
        return 0;
      }
      default: return 2;
    }
  } catch (error) {
    const known = /^TIDY_/.test(String(error && error.code));
    stderr.write(known ? `${error.message}\n` : `Memory tidy stopped on an unexpected problem (${(error && (error.code || error.name)) || 'Error'}: ${error && error.message}). Nothing after that point ran.\n`);
    return known && error.code !== 'TIDY_ARGUMENTS' ? 1 : 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ MemoryTidy, VERDICTS, frontmatter, indexLines, indexProblems, normOrigin, projectName, main });
