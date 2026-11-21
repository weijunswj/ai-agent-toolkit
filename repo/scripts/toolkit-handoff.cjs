'use strict';

// The controller handoff snapshot: a copy of the controller's memory and named working files that a
// successor reads when no project memory is reachable. `toolkit-store.cjs handoff` writes and saves it;
// the controller health check (`toolkit-controller-check.cjs`, check `handoff`) compares it read-only.
//
// Layout, under a store checkout or any folder: evidence/handoff/<owner>/<repo>/
//   manifest.json  the current file set (path, sha256, source, modified) and the stamp (taken_at, toolkit
//                  version, the repository's default-branch commit); the stamp is outside the compare
//   README.md      what the folder is (fixed text)
//   MEMORY.md      the memory folder's index; memory/ its other files
//   files/         the saved instructions (instructions.<ext>) and each named working file
// A file not listed in manifest.json is an older copy: nothing here deletes a file.
// Every source is secret-scanned before anything is written; one finding refuses the whole run.
//
// A manual run copies every reachable source as this computer holds it. A run the after-tool hook
// starts (`newer`) writes only what is newer, so a session holding an older copy (a memory folder
// synced when it started) never overwrites rows another session wrote later:
//   - a changed file is written when its modified time is after its row's (a row with none counts as
//     the snapshot's taken_at); a file the snapshot lacks, when it is after every row of its source;
//   - a row whose file is gone here is dropped only when this session saw the file and deleted it, or
//     when its source's newest file here is after the row (so this copy is newer than the row);
//   - where a source's modified times are not real (several files, all within a minute: a plain
//     copy), only the session baseline counts: files changed or deleted since the session first looked.

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const path = require('node:path');
const { scanText } = require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs');

const SCHEMA = 'toolkit.handoff-snapshot.v1';
const ROOT = 'evidence/handoff';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 2000;
// Several files whose modified times all fall within this span were copied at one moment.
const COPY_SPAN_MS = 60 * 1000;
// ignoreBOM keeps a byte-order mark in the copy, so the copy's sha256 is the one its manifest row records.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const README = repository => `# Controller handoff snapshot: ${repository}\n\n`
  + 'Written by `toolkit-store.cjs handoff`; never edit it by hand.\n\n'
  + '- `manifest.json`: the current file set, each with its sha256 and source, and the stamp: when it was taken (`taken_at`), the Toolkit version and the repository\'s default-branch commit. A file it does not list is an older copy.\n'
  + '- `MEMORY.md` and `memory/`: the controller\'s memory index and topic files.\n'
  + '- `files/`: the saved instructions and the named working files.\n\n'
  + 'Evidence, not authority: where it differs from current state, current state wins.\n';

class HandoffError extends Error {
  constructor(stopped, next) { super(`Stopped: ${stopped} Next: ${next}`); this.stopped = stopped; this.next = next; }
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// evidence/handoff/<owner>/<repo>, or null for a name that is not a plain owner/repo pair.
function snapshotFolder(repository) {
  const parts = String(repository || '').split('/');
  return parts.length === 2 && parts.every(part => NAME.test(part)) ? `${ROOT}/${parts[0]}/${parts[1]}` : null;
}

// The sources a run names on its command line, as full paths on this computer.
function normaliseSources({ memory = null, instructions = null, files = [] } = {}, cwd = process.cwd()) {
  const full = value => (typeof value === 'string' && value ? path.resolve(cwd, value) : null);
  return { memory: full(memory), instructions: full(instructions), files: [...new Set((files || []).map(full).filter(Boolean))] };
}
const hasSources = sources => Boolean(sources && (sources.memory || sources.instructions || sources.files.length));

// Whether a saved path is a full path on this computer. A path another operating system saved (a
// Windows drive path read on Linux, a Linux path read on Windows) is not, so it counts as unreachable.
function fullPathHere(value, platform = process.platform) {
  if (typeof value !== 'string' || !value) return false;
  return platform === 'win32' ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(value) : value.startsWith('/');
}

// A saved path's last part and its parent folder's name, with either separator, so every computer
// gives a working file the same name under files/.
const parts = file => String(file).split(/[\\/]+/).filter(Boolean);
const leaf = file => parts(file).pop() || '';
const parentLeaf = file => parts(file).slice(-2, -1)[0] || '';

// The sources a run copies: each kind the run names (memory folder, instructions, working files)
// replaces that kind, and every kind it does not name keeps what the last manifest remembered,
// exactly as saved, so a run that adds one working file never drops the memory folder and a
// computer never rewrites another computer's paths.
function chooseSources(sources, previous) {
  const saved = previous?.sources || {};
  const text = value => (typeof value === 'string' && value ? value : null);
  const remembered = { memory: text(saved.memory), instructions: text(saved.instructions), files: [...new Set((Array.isArray(saved.files) ? saved.files : []).map(text).filter(Boolean))] };
  const named = sources || { memory: null, instructions: null, files: [] };
  return { memory: named.memory || remembered.memory, instructions: named.instructions || remembered.instructions, files: named.files.length ? named.files : remembered.files };
}

// Each working file's name under files/: its own name, or <parent folder>-<name> when two share one.
function fileNames(files) {
  const counts = new Map();
  for (const file of files) counts.set(leaf(file), (counts.get(leaf(file)) || 0) + 1);
  const names = files.map(file => (counts.get(leaf(file)) > 1 ? `${parentLeaf(file)}-${leaf(file)}` : leaf(file)));
  const clash = names.find((name, index) => names.indexOf(name) !== index || name.startsWith('instructions.'));
  if (clash) throw new HandoffError(`two sources would both be saved as files/${clash}.`, 'rename one, or name only one of them.');
  return names;
}

function readText(fs, file) {
  let bytes;
  let modified;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_BYTES) throw new HandoffError(`${file} is over 5 MB.`, 'leave it out of the snapshot.');
    bytes = fs.readFileSync(file);
    modified = Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : null;
  } catch (error) { if (error instanceof HandoffError) throw error; return null; }
  try { return { text: UTF8.decode(bytes), sha256: sha256(bytes), modified }; } catch { throw new HandoffError(`${file} is not UTF-8 text.`, 'leave it out of the snapshot.'); }
}

// Every plain file under a memory folder (links and dot-names skipped), as paths relative to it.
function memoryFiles(fs, dir) {
  const out = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || !NAME.test(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child);
      if (out.length > MAX_FILES) throw new HandoffError(`the memory folder holds over ${MAX_FILES} files.`, 'name a smaller folder.');
    }
  };
  walk('');
  return out;
}

// Reads and scans every reachable source. A source that is not reachable here (missing, or a path
// that is not a full path on this computer) is returned in `kept`, unread, so the last copy and its
// manifest rows stay as they were.
function readSources(sources, { fs = nodeFs, platform = process.platform, scan = true } = {}) {
  const entries = [];
  const kept = [];
  const add = (dest, source, read) => entries.push({ path: dest, source, ...read });
  if (sources.memory) {
    let names = null;
    if (fullPathHere(sources.memory, platform)) {
      try { if (fs.statSync(sources.memory).isDirectory()) names = memoryFiles(fs, sources.memory); } catch (error) { if (error instanceof HandoffError) throw error; }
    }
    if (!names) kept.push(sources.memory);
    else for (const name of names) {
      const read = readText(fs, path.join(sources.memory, name));
      if (read) add(name === 'MEMORY.md' ? 'MEMORY.md' : `memory/${name}`, sources.memory, read);
    }
  }
  const single = [...(sources.instructions ? [[sources.instructions, `files/instructions${path.extname(leaf(sources.instructions)) || '.md'}`]] : []),
    ...(() => { const names = fileNames(sources.files); return sources.files.map((file, index) => [file, `files/${names[index]}`]); })()];
  for (const [file, dest] of single) {
    const read = fullPathHere(file, platform) ? readText(fs, file) : null;
    if (read) add(dest, file, read); else kept.push(file);
  }
  const findings = !scan ? [] : entries.flatMap(entry => scanText(entry.text).map(found => `${entry.source === sources.memory ? path.join(sources.memory, entry.path.replace(/^memory\//, '')) : entry.source}:${found.line} (${found.rule})`));
  if (findings.length) throw new HandoffError(`secret scan found ${findings.length} match(es): ${findings.slice(0, 5).join(', ')}. Nothing was written.`, 'remove the value from the source, then run handoff again.');
  return { entries, kept };
}

function readManifest(base, folder, { fs = nodeFs } = {}) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(base, folder, 'manifest.json'), 'utf8'));
    return manifest && manifest.schema === SCHEMA && Array.isArray(manifest.files) ? manifest : null;
  } catch { return null; }
}

// The file set a run would record: every reachable source as read now, plus the last manifest's rows
// for sources not reachable here. Sorted by path, so the compare is stable.
const rowOf = ({ path: dest, sha256: hash, source, modified }) => ({ path: dest, sha256: hash, source, ...(modified ? { modified } : {}) });
const byPath = (a, b) => a.path.localeCompare(b.path);

function fileSet({ entries, kept }, previous) {
  const rows = entries.map(rowOf);
  const carried = (previous?.files || []).filter(row => kept.includes(row.source) && !rows.some(item => item.path === row.path));
  return [...rows, ...carried].sort(byPath);
}

// The newer-only file set (see the top of this file). `baseline` is the session's rows from when it
// first looked (null: none recorded).
function newerSet({ entries, kept }, previous, baseline) {
  const prev = new Map((previous?.files || []).map(row => [row.path, row]));
  const seen = Array.isArray(baseline) ? new Map(baseline.filter(row => row && typeof row.path === 'string').map(row => [row.path, row.sha256])) : null;
  const takenAt = Date.parse(previous?.stamp?.taken_at || '');
  const rowTime = row => { const time = Date.parse(row.modified || ''); return Number.isNaN(time) ? (Number.isNaN(takenAt) ? -Infinity : takenAt) : time; };
  const time = entry => Date.parse(entry.modified || '');
  const sourceTimes = new Map();
  for (const entry of entries) sourceTimes.set(entry.source, [...(sourceTimes.get(entry.source) || []), time(entry)]);
  const real = source => { const times = sourceTimes.get(source) || []; return times.every(Number.isFinite) && (times.length < 2 || Math.max(...times) - Math.min(...times) > COPY_SPAN_MS); };
  const newest = source => Math.max(-Infinity, ...(sourceTimes.get(source) || []).filter(Number.isFinite));
  const rowsNewest = source => Math.max(-Infinity, ...[...prev.values()].filter(row => row.source === source).map(rowTime));
  const changedHere = entry => Boolean(seen) && seen.get(entry.path) !== entry.sha256;
  const out = [];
  const writes = [];
  for (const entry of entries) {
    const row = prev.get(entry.path);
    if (row && row.sha256 === entry.sha256) { out.push(row.modified ? row : rowOf(entry)); continue; }
    const take = real(entry.source) ? time(entry) > (row ? rowTime(row) : rowsNewest(entry.source)) : changedHere(entry);
    if (take) { out.push(rowOf(entry)); writes.push(entry); } else if (row) out.push(row);
  }
  const live = new Set(entries.map(entry => entry.path));
  for (const row of prev.values()) {
    if (live.has(row.path)) continue;
    const gone = !kept.includes(row.source) && ((seen && seen.has(row.path)) || (real(row.source) && newest(row.source) > rowTime(row)));
    if (!gone) out.push(row);
  }
  return { files: out.sort(byPath), writes };
}

const sameFiles = (a, b) => JSON.stringify((a || []).map(row => [row.path, row.sha256])) === JSON.stringify((b || []).map(row => [row.path, row.sha256]));

// Works out one run: the folder, the new manifest, what to write, and whether anything changed.
function plan({ base, repository, sources, stamp, fs = nodeFs, platform = process.platform, newer = null, scan = true }) {
  const folder = snapshotFolder(repository);
  if (!folder) throw new HandoffError(`${JSON.stringify(repository)} is not a plain owner/repo name.`, 'run it from a checkout of the controlled repository, or name one with --repo-root.');
  const previous = readManifest(base, folder, { fs });
  const chosen = chooseSources(sources, previous);
  if (!hasSources(chosen)) throw new HandoffError('no sources were named and no earlier snapshot remembers any.', 'name --memory <folder>, --instructions <file> or --file <path> once; later runs remember them.');
  const read = readSources(chosen, { fs, platform, scan });
  const picked = newer ? newerSet(read, previous, newer.baseline) : { files: fileSet(read, previous), writes: read.entries };
  const unchanged = Boolean(previous) && sameFiles(previous.files, picked.files);
  const manifest = { schema: SCHEMA, stamp, sources: chosen, files: picked.files };
  return { folder, previous, manifest, unchanged, kept: read.kept, writes: picked.writes, seen: read.entries.map(({ path: dest, sha256: hash }) => ({ path: dest, sha256: hash })) };
}

// Writes the snapshot and returns an undo that puts every file it touched back as it was (a file it
// created is removed), for a save that stops before it commits.
function write(base, { folder, manifest, writes }, repository, { fs = nodeFs } = {}) {
  const before = [];
  const put = (rel, text) => {
    const target = path.join(base, folder, ...rel.split('/'));
    let old = null;
    try { old = fs.readFileSync(target); } catch { old = null; }
    before.push([target, old]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  try {
    for (const entry of writes) put(entry.path, entry.text);
    put('README.md', README(repository));
    put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) { undo(); throw error; }
  function undo() {
    for (const [target, old] of before.reverse()) {
      try { if (old === null) fs.rmSync(target, { force: true }); else fs.writeFileSync(target, old); } catch { /* best effort; the next run rebuilds it */ }
    }
  }
  return undo;
}

// The session baseline: each reachable source file's snapshot path and sha256 as this session holds
// it now. Read-only, no secret scan (nothing is written from it).
function sessionRows(sources, { fs = nodeFs, platform = process.platform } = {}) {
  return readSources(sources, { fs, platform, scan: false }).entries.map(({ path: dest, sha256: hash }) => ({ path: dest, sha256: hash }));
}

// Read-only: is the snapshot current with its live sources? STALE names what changed; a source not
// reachable here is not counted as a change.
function check({ base, repository, sources = null, now = new Date(), fs = nodeFs, platform = process.platform }) {
  const folder = snapshotFolder(repository);
  if (!folder) throw new HandoffError(`${JSON.stringify(repository)} is not a plain owner/repo name.`, 'name the controlled repository\'s checkout with --repo-root.');
  const previous = readManifest(base, folder, { fs });
  if (!previous) return { state: 'MISSING', folder };
  const chosen = chooseSources(sources, previous);
  const read = readSources(chosen, { fs, platform });
  const files = fileSet(read, previous);
  const before = new Map(previous.files.map(row => [row.path, row.sha256]));
  const after = new Map(files.map(row => [row.path, row.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key)).sort();
  const takenAt = previous.stamp?.taken_at || null;
  const hours = takenAt && !Number.isNaN(Date.parse(takenAt)) ? Math.max(0, Math.round((now.getTime() - Date.parse(takenAt)) / 360000) / 10) : null;
  return { state: changed.length ? 'STALE' : 'CURRENT', folder, taken_at: takenAt, age_hours: hours, changed, kept: read.kept };
}

module.exports = Object.freeze({ SCHEMA, ROOT, HandoffError, snapshotFolder, fullPathHere, normaliseSources, hasSources, readSources, readManifest, plan, write, check, sessionRows });
