'use strict';

// The controller handoff snapshot: a mirror of the controller's memory folder plus named working files
// that a successor reads when no project memory is reachable. `toolkit-store.cjs handoff` writes and
// saves it; the controller health check (`toolkit-controller-check.cjs`, check `handoff`) compares it
// read-only.
//
// Layout, under a store checkout or any folder: evidence/handoff/<owner>/<repo>/
//   manifest.json  the current file set (path, sha256, source, modified), the removed rows (memory files
//                  that left the snapshot: path, sha256, modified, removed_at, source) and the stamp
//                  (taken_at, toolkit version, the repository's default-branch commit); the stamp is
//                  outside the compare
//   README.md      what the folder is and how to get a removed file back (fixed text)
//   MEMORY.md      the memory folder's index; memory/ its other files
//   files/         the saved instructions (instructions.<ext>) and each named working file
// Every source is secret-scanned before anything is written; one finding refuses the whole run.
//
// Every run decides file by file, so a session holding an older copy (a memory folder synced when it
// started) never overwrites, drops or brings back what another session decided later:
//   - a file the snapshot lacks is added;
//   - a file whose content differs is written only when this copy of that file is newer than its row
//     (an equal time keeps the row; a row with no time is given a fixed one, see pick), and a memory
//     row only when this computer also held exactly that row's content (its folder record or this
//     session's baseline, as for removals below); otherwise the row stays and is reported as diverged
//     (another computer saved it and this copy may not have synced it), until a manual `reseed` run
//     takes this copy, so a computer that never held a file can add it but never replace or remove it;
//   - a memory row whose file is missing here is removed (a removed row with a time, and its copy
//     deleted) only when this computer held exactly that content in this folder: its folder record
//     (the folder as this computer's last saved run read it) or this session's baseline (the files
//     this session held, from the after-tool hook) has the path with the row's sha256. A newer save
//     made elsewhere changed the row first, so it is never removed by this copy. The memory folder
//     must be reachable here and hold at least one file; a missing file with no such record is
//     unknown, so a fresh container, a partial sync or another computer only adds and updates;
//   - a removed file comes back only from different content whose modified time is more than 5
//     minutes after the removal, from a source whose times are real; the same bytes never come back;
//   - a run that would remove more than max(10, a fifth of the memory rows) removes none and reports
//     them as held; only a manual run with `confirm` applies them;
//   - a copy under the snapshot's memory area that no row lists (left by an older Toolkit copy) is
//     deleted with a removed row, under the same limit;
//   - `replaceMemory` (manual only) makes the folder it names the whole memory set: every memory row
//     that folder lacks is removed, and its copy of every other memory file wins;
//   - a run whose clock is more than 5 minutes behind the snapshot's latest memory time removes and brings
//     back nothing (`clock=behind`);
//   - a non-memory row whose file is missing here stays, unless the session baseline shows this
//     session held that file and deleted it while its source was reachable;
//   - a source whose modified times are not real (most of its files saved within one minute: a plain
//     copy) is judged once, from the baseline when there is one; then a differing file is written only
//     when this session changed it since its baseline.
// A row written before rows carried a time has no real time: its fixed one is the snapshot's time,
// marked `modified_from: "snapshot"`. When this copy differs from such a row and a run keeps the row,
// the order of the two is unknown (this copy may hold a save the snapshot missed, or be older), so
// `check` names the file as unsure and only a run with `reseed` takes this copy for it.
// Ordering edits trusts each machine's clock, so clock skew between machines can misorder saves made
// within the skew; a removal compares content, not clocks. Removed files stay in the store's Git
// history, and removed rows never expire, so a stale copy months later still cannot bring one back.

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const path = require('node:path');
const { scanText } = require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs');

const SCHEMA = 'toolkit.handoff-snapshot.v2';
// The manifests this copy reads; it writes only SCHEMA. An older copy reads a v2 manifest as no snapshot.
const READ_SCHEMAS = Object.freeze(['toolkit.handoff-snapshot.v1', SCHEMA]);
const ROOT = 'evidence/handoff';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 2000;
// Files whose modified times fall within this span were saved at one moment.
const COPY_SPAN_MS = 60 * 1000;
// A removed file comes back only from a save this long after its removal; a clock this far behind the
// snapshot's latest time removes and brings back nothing.
const MARGIN_MS = 5 * 60 * 1000;
// A run removes at most max(HOLD_MIN, a fifth of the memory rows) files unless a manual run confirms.
const HOLD_MIN = 10;
// The per-computer folder records, under the Toolkit user-state folder.
const FOLDER_RECORDS = 'handoff-folders';
// ignoreBOM keeps a byte-order mark in the copy, so the copy's sha256 is the one its manifest row records.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const README = repository => `# Controller handoff snapshot: ${repository}\n\n`
  + 'Written by `toolkit-store.cjs handoff`; never edit it by hand.\n\n'
  + '- `manifest.json`: the current file set, each with its sha256 and source; the removed memory files, each with when it was removed (`removed_at`); and the stamp: when it was taken (`taken_at`), the Toolkit version and the repository\'s default-branch commit.\n'
  + '- `MEMORY.md` and `memory/`: a mirror of the controller\'s memory folder: a memory file deleted there is deleted here.\n'
  + '- `files/`: the saved instructions and the named working files.\n\n'
  + 'A removed file stays in the store\'s Git history. `git log --diff-filter=D -- <this folder>/memory/` lists the removals, and `git show <commit>^:<path>` prints the last copy.\n\n'
  + 'Evidence, not authority: where it differs from current state, current state wins.\n';

class HandoffError extends Error {
  constructor(stopped, next) { super(`Stopped: ${stopped} Next: ${next}`); this.stopped = stopped; this.next = next; }
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// The snapshot's memory area: the index and everything under memory/.
const isMemoryPath = file => file === 'MEMORY.md' || file.startsWith('memory/');
const timeOf = value => { const time = Date.parse(value || ''); return Number.isNaN(time) ? null : time; };

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

// Reads and scans every reachable source. A source that is not reachable here (missing, a path that
// is not a full path on this computer, or a memory folder with no files, as an emptied re-sync or an
// empty mount point leaves it) is returned in `kept`, unread, so the last copy and its manifest rows
// stay as they were. `memory` is the memory folder this run names.
function readSources(sources, { fs = nodeFs, platform = process.platform, scan = true } = {}) {
  const entries = [];
  const kept = [];
  const add = (dest, source, read) => entries.push({ path: dest, source, ...read });
  if (sources.memory) {
    let names = null;
    if (fullPathHere(sources.memory, platform)) {
      try { if (fs.statSync(sources.memory).isDirectory()) names = memoryFiles(fs, sources.memory); } catch (error) { if (error instanceof HandoffError) throw error; }
    }
    if (!names || !names.length) kept.push(sources.memory);
    else for (const name of names) {
      const read = readText(fs, path.join(sources.memory, name));
      if (read) add(name === 'MEMORY.md' ? 'MEMORY.md' : `memory/${name}`, sources.memory, read);
    }
  }
  const single = [...(sources.instructions ? [[sources.instructions, `files/instructions${path.extname(leaf(sources.instructions)) || '.md'}`]] : []),
    ...(() => { const names = fileNames(sources.files); return sources.files.map((file, index) => [file, `files/${names[index]}`]); })()];
  // Which named source each files/ path comes from now.
  const places = Object.fromEntries(single.map(([file, dest]) => [dest, file]));
  for (const [file, dest] of single) {
    const read = fullPathHere(file, platform) ? readText(fs, file) : null;
    if (read) add(dest, file, read); else kept.push(file);
  }
  const findings = !scan ? [] : entries.flatMap(entry => scanText(entry.text).map(found => `${entry.source === sources.memory ? path.join(sources.memory, entry.path.replace(/^memory\//, '')) : entry.source}:${found.line} (${found.rule})`));
  if (findings.length) throw new HandoffError(`secret scan found ${findings.length} match(es): ${findings.slice(0, 5).join(', ')}. Nothing was written.`, 'remove the value from the source, then run handoff again.');
  return { entries, kept, memory: sources.memory || null, places };
}

// A removed row as saved: a memory path, its last sha256 and when it was removed.
const removedRow = row => Boolean(row) && typeof row.path === 'string' && isMemoryPath(row.path) && /^[0-9a-f]{64}$/.test(row.sha256 || '') && timeOf(row.removed_at) !== null;

// The snapshot's manifest (v1 or v2; a v1 one has no removed rows), or null.
function readManifest(base, folder, { fs = nodeFs } = {}) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(base, folder, 'manifest.json'), 'utf8'));
    if (!manifest || !READ_SCHEMAS.includes(manifest.schema) || !Array.isArray(manifest.files)) return null;
    return { ...manifest, removed: Array.isArray(manifest.removed) ? manifest.removed.filter(removedRow) : [] };
  } catch { return null; }
}

// ---- folder records: what this computer last saved from a memory folder ---------------------------

const recordFile = (dir, folder) => path.join(dir, `${sha256(Buffer.from(String(folder), 'utf8')).slice(0, 16)}.json`);

// The folder record for `folder` in `dir`: { at (ms), files: Map path -> sha256 }, or null.
function readFolderRecord(dir, folder, { fs = nodeFs } = {}) {
  if (!dir || !folder) return null;
  try {
    const record = JSON.parse(fs.readFileSync(recordFile(dir, folder), 'utf8'));
    if (!record || record.folder !== folder || !Array.isArray(record.files)) return null;
    const files = new Map(record.files.filter(row => row && typeof row.path === 'string' && typeof row.sha256 === 'string').map(row => [row.path, row.sha256]));
    return { at: timeOf(record.at), files };
  } catch { return null; }
}

// Writes the record a run planned (planned.record), only after its save was read back. Best effort:
// a computer with no record only adds and updates until its next run writes one.
function writeFolderRecord(dir, record, { fs = nodeFs } = {}) {
  if (!dir || !record) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(recordFile(dir, record.folder), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch { return false; }
}

// The file set a run would record: every reachable source as read now, plus the last manifest's rows
// for sources not reachable here. Sorted by path, so the compare is stable.
const rowOf = ({ path: dest, sha256: hash, source, modified }) => ({ path: dest, sha256: hash, source, ...(modified ? { modified } : {}) });
const seenOf = entries => entries.map(({ path: dest, sha256: hash, source, modified }) => ({ path: dest, sha256: hash, source, ...(modified ? { modified } : {}) }));
const byPath = (a, b) => a.path.localeCompare(b.path);

// Whether a source's modified times are real: false when more than half of two or more files were
// saved within one minute of each other (a plain copy, or a clone, gives every file one time).
function realTimes(times) {
  const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length !== times.length) return false;
  if (sorted.length < 2) return true;
  let most = 0;
  for (let start = 0, end = 0; end < sorted.length; end += 1) {
    while (sorted[end] - sorted[start] > COPY_SPAN_MS) start += 1;
    most = Math.max(most, end - start + 1);
  }
  return most * 2 <= sorted.length;
}

// Each source's realness from a set of rows ({ source, modified }).
function realBySource(rows) {
  const times = new Map();
  for (const row of rows) times.set(row.source, [...(times.get(row.source) || []), Date.parse(row.modified || '')]);
  return Object.fromEntries([...times].map(([source, list]) => [source, realTimes(list)]));
}

// The file set a run records (see the top of this file). `session` is the hook's session file:
// { rows: the files this session held when last seen, real: each source's realness when it started },
// or null for a run with no session (realness judged from the files here now).
// Options: `reseed` (a manual run that says this copy is the newest) takes this copy for every unsure
// and diverged file; `record` is this computer's folder record for the memory folder named now; `now` (ms) the run's
// time; `confirm` applies removals over the limit; `replace` removes every memory row the folder lacks;
// `onDisk` lists the snapshot's memory-area copies ({ path, sha256 }); `folderTime(path)` the modified
// time (ms) of the folder that held a removed file, or null.
// Returns the rows, the writes, the removed rows, the copies to delete and what `check` reports:
// `unsure` (this copy differs from a kept row with no real time), `removedNow`, `held` (removals over
// the limit), `clockBehind` and `removedHere` (this copy holds different content for a removed file
// that does not come back) and `diverged` (this copy differs from a memory row this computer never
// held at that content, so the row stays).
function pick({ entries, kept, memory = null, places = {} }, previous, session = null, options = {}) {
  const { reseed = false, record = null, now = Date.now(), confirm = false, replace = false, onDisk = [], folderTime = () => null } = options;
  const prev = new Map((previous?.files || []).map(row => [row.path, row]));
  const removedBefore = new Map((previous?.removed || []).filter(row => !prev.has(row.path)).map(row => [row.path, row]));
  const baseline = Array.isArray(session?.rows) ? session.rows.filter(row => row && typeof row.path === 'string') : null;
  const seen = baseline ? new Map(baseline.map(row => [row.path, row.sha256])) : null;
  const real = session?.real && typeof session.real === 'object' ? session.real : realBySource(baseline || entries);
  // A row with no time (written before rows carried one) gets a fixed time the first time a run
  // keeps it: this copy's own time when its content matches (and its source's times are real), else
  // the time of the snapshot that wrote it, marked as such. It then never moves with later snapshots.
  const takenAt = typeof previous?.stamp?.taken_at === 'string' && !Number.isNaN(Date.parse(previous.stamp.taken_at)) ? new Date(previous.stamp.taken_at).toISOString() : null;
  const timed = (row, entry = null) => {
    if (row.modified) return row;
    const own = entry && entry.sha256 === row.sha256 && real[entry.source] !== false ? entry.modified : null;
    if (own) return { ...row, modified: own };
    return takenAt ? { ...row, modified: takenAt, modified_from: 'snapshot' } : row;
  };
  const noRealTime = row => !row.modified || row.modified_from === 'snapshot';
  const rowTime = row => { const time = Date.parse(row.modified || ''); return Number.isNaN(time) ? -Infinity : time; };
  // This computer's clock behind the snapshot's latest memory time (the times removals and revivals
  // compare with): nothing is removed or brought back.
  const latest = [...prev.values()].filter(row => isMemoryPath(row.path)).map(row => timeOf(row.modified)).concat([...removedBefore.values()].map(row => timeOf(row.removed_at))).filter(time => time !== null);
  const clockBehind = latest.some(time => time > now + MARGIN_MS);
  if (clockBehind && replace) throw new HandoffError('this computer\'s clock is behind the snapshot\'s latest time, so --replace-memory would misdate its removals.', 'set this computer\'s clock right, then run it again.');
  // With replace, the memory folder named now is the whole memory set: its content wins.
  const replaces = entry => replace && isMemoryPath(entry.path) && entry.source === memory;
  const out = [];
  const writes = [];
  const unsure = [];
  const removedHere = [];
  const diverged = [];
  const removed = new Map(removedBefore);
  // Whether this computer held exactly a row's content in the folder named now: its folder record, or
  // the session baseline, which speaks for the folder it was taken from (the one the snapshot remembers).
  const baselineFolder = !previous?.sources?.memory || previous.sources.memory === memory;
  const held = row => (record?.files.get(row.path) === row.sha256) || (baselineFolder && seen?.get(row.path) === row.sha256);
  for (const entry of entries) {
    const gone = removed.get(entry.path);
    if (gone) {
      // A removed file comes back only from different content saved well after its removal.
      const revive = replaces(entry) || !clockBehind && entry.sha256 !== gone.sha256 && real[entry.source] !== false && (timeOf(entry.modified) ?? -Infinity) > timeOf(gone.removed_at) + MARGIN_MS;
      if (revive) { removed.delete(entry.path); out.push(rowOf(entry)); writes.push(entry); } else if (entry.sha256 !== gone.sha256) removedHere.push(entry.path);
      continue;
    }
    const row = prev.get(entry.path) ? timed(prev.get(entry.path), entry) : null;
    let take;
    if (!row) take = true;
    else if (row.sha256 === entry.sha256) take = false;
    else if (isMemoryPath(entry.path) && !replaces(entry) && !held(row)) {
      // A memory row this computer never held at that content: another computer saved it, and this copy
      // may not have synced it yet. Only a manual reseed replaces it.
      if (reseed) { out.push(rowOf(entry)); writes.push(entry); } else { diverged.push(entry.path); out.push(row); }
      continue;
    } else if (real[entry.source] !== false) take = Date.parse(entry.modified || '') > rowTime(row);
    else take = Boolean(seen) && seen.get(entry.path) !== entry.sha256;
    if (!take && row && row.sha256 !== entry.sha256 && replaces(entry)) take = true;
    if (!take && row && row.sha256 !== entry.sha256 && noRealTime(row)) { if (reseed) take = true; else unsure.push(entry.path); }
    if (take) { out.push(rowOf(entry)); writes.push(entry); } else out.push(row);
  }
  // A row whose file is missing here. A memory row is removed only when this computer held exactly
  // its content in the folder named now (see the top of this file); any other row stays, unless this
  // session held that file and deleted it while its source was reachable. A row's source is the one
  // that holds its path now (the memory folder this run names, or the named file saved under that
  // path), not the path it was first written with.
  const here = new Set(entries.map(entry => entry.path));
  const sourceNow = row => (memory && isMemoryPath(row.path) ? memory : places[row.path] || row.source);
  const memoryReachable = Boolean(memory) && !(kept || []).includes(memory);
  const candidates = [];
  for (const row of prev.values()) {
    if (here.has(row.path)) continue;
    if (isMemoryPath(row.path)) {
      if (memoryReachable && (replace || held(row))) candidates.push({ row }); else out.push(timed(row));
      continue;
    }
    if (!(seen && seen.has(row.path) && !(kept || []).includes(sourceNow(row)))) out.push(timed(row));
  }
  // Copies under the memory area that no row lists (an older Toolkit copy never deleted a file).
  const listed = new Set([...out.map(row => row.path), ...writes.map(entry => entry.path), ...candidates.map(candidate => candidate.row.path)]);
  const leftovers = onDisk.filter(file => isMemoryPath(file.path) && !listed.has(file.path));
  const deletes = leftovers.filter(file => removed.has(file.path)).map(file => file.path);
  for (const file of leftovers) if (!removed.has(file.path)) candidates.push({ leftover: file });
  const memoryRows = [...prev.keys()].filter(isMemoryPath).length;
  const limit = Math.max(HOLD_MIN, Math.floor(memoryRows / 5));
  const apply = !clockBehind && (replace || confirm || candidates.length <= limit);
  const removedNow = [];
  const nowIso = new Date(now).toISOString();
  for (const candidate of candidates) {
    if (!apply) { if (candidate.row) out.push(timed(candidate.row)); continue; }
    if (candidate.row) {
      const { row } = candidate;
      // The removal time: the folder's modified time when it lies after the file's last known state,
      // else now (a later time keeps the removal).
      const lower = Math.max(record?.at ?? -Infinity, rowTime(row));
      const folder = folderTime(row.path);
      const at = Number.isFinite(folder) && folder >= lower && folder <= now ? new Date(folder).toISOString() : nowIso;
      removed.set(row.path, { path: row.path, sha256: row.sha256, ...(row.modified ? { modified: row.modified } : {}), removed_at: at, source: row.source });
    } else removed.set(candidate.leftover.path, { path: candidate.leftover.path, sha256: candidate.leftover.sha256, removed_at: nowIso, source: memory || previous?.sources?.memory || null });
    const file = candidate.row ? candidate.row.path : candidate.leftover.path;
    removedNow.push(file);
    if (onDisk.some(copy => copy.path === file)) deletes.push(file);
  }
  return {
    files: out.sort(byPath), writes, real, unsure: unsure.sort(), removed: [...removed.values()].sort(byPath), deletes: deletes.sort(),
    removedNow: removedNow.sort(), held: apply ? 0 : candidates.length, clockBehind, removedHere: removedHere.sort(), diverged: diverged.sort(),
    // Removals this run did not apply keep this computer's evidence for a later one.
    unapplied: apply ? [] : candidates.filter(candidate => candidate.row).map(candidate => candidate.row),
  };
}

const sameFiles = (a, b) => JSON.stringify((a || []).map(row => [row.path, row.sha256])) === JSON.stringify((b || []).map(row => [row.path, row.sha256]));
const sameRemoved = (a, b) => JSON.stringify((a || []).map(row => [row.path, row.sha256, row.removed_at])) === JSON.stringify((b || []).map(row => [row.path, row.sha256, row.removed_at]));

// The snapshot's memory-area copies on disk ({ path, sha256 }), sorted.
function memoryCopies(fs, base, folder) {
  const top = path.join(base, folder);
  const out = [];
  try { const bytes = fs.readFileSync(path.join(top, 'MEMORY.md')); out.push({ path: 'MEMORY.md', sha256: sha256(bytes) }); } catch { /* none */ }
  const walk = rel => {
    let list = [];
    try { list = fs.readdirSync(path.join(top, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
    for (const entry of list) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) { try { out.push({ path: child, sha256: sha256(fs.readFileSync(path.join(top, ...child.split('/')))) }); } catch { /* unreadable: left alone */ } }
    }
  };
  walk('memory');
  return out.sort(byPath);
}

// The modified time (ms) of the folder that held a memory file, or of the nearest folder above it
// inside the memory folder: deleting a file moves its folder's time to the delete.
function folderTimer(fs, memory) {
  return file => {
    if (!memory) return null;
    let rel = file === 'MEMORY.md' ? [] : file.replace(/^memory\//, '').split('/').slice(0, -1);
    for (;;) {
      try { const time = fs.statSync(path.join(memory, ...rel)).mtimeMs; return Number.isFinite(time) ? time : null; } catch { /* gone: look one folder up */ }
      if (!rel.length) return null;
      rel = rel.slice(0, -1);
    }
  };
}

// Reads everything one run decides from and decides it. Shared by plan and check.
function decide({ base, repository, sources, fs = nodeFs, platform = process.platform, session = null, scan = true, reseed = false, records = null, now = new Date(), confirm = false, replace = false }) {
  const folder = snapshotFolder(repository);
  if (!folder) throw new HandoffError(`${JSON.stringify(repository)} is not a plain owner/repo name.`, 'run it from a checkout of the controlled repository, or name one with --repo-root.');
  const previous = readManifest(base, folder, { fs });
  const chosen = chooseSources(sources, previous);
  if (!hasSources(chosen)) throw new HandoffError('no sources were named and no earlier snapshot remembers any.', 'name --memory <folder>, --instructions <file> or --file <path> once; later runs remember them.');
  const read = readSources(chosen, { fs, platform, scan });
  if (replace && (!read.memory || read.kept.includes(read.memory))) throw new HandoffError('the memory folder for --replace-memory is not reachable here or holds no files.', 'name a memory folder on this computer that holds the memory files.');
  const record = read.memory ? readFolderRecord(records, read.memory, { fs }) : null;
  const time = now instanceof Date ? now.getTime() : Number(now);
  const picked = pick(read, previous, session, { reseed, record, now: time, confirm, replace, onDisk: previous ? memoryCopies(fs, base, folder) : [], folderTime: folderTimer(fs, read.memory) });
  return { folder, previous, chosen, read, picked, time, record };
}

// Works out one run: the folder, the new manifest, what to write and delete, whether anything changed,
// and the folder record to keep once the save is read back. `records` is the folder-record folder.
function plan({ base, repository, sources, stamp, fs = nodeFs, platform = process.platform, session = null, scan = true, reseed = false, records = null, now = new Date(), confirm = false, replace = false }) {
  const { folder, previous, chosen, read, picked, time, record: before } = decide({ base, repository, sources, fs, platform, session, scan, reseed, records, now, confirm, replace });
  // A v1 manifest is written as v2 by the first run that changes it (it has no removed rows before).
  const unchanged = Boolean(previous) && sameFiles(previous.files, picked.files) && sameRemoved(previous.removed, picked.removed) && !picked.deletes.length;
  const manifest = { schema: SCHEMA, stamp, sources: chosen, files: picked.files, removed: picked.removed };
  // This computer's record: each memory file as this run read it where the snapshot now holds that
  // content; where the snapshot kept a different row (diverged, unsure or older here), what the record
  // held before, so this copy's own unsaved content never counts as held. Plus the evidence for
  // removals it held.
  const memoryRead = read.memory && !read.kept.includes(read.memory);
  const rows = new Map(picked.files.map(row => [row.path, row.sha256]));
  const recorded = ({ path: dest, sha256: hash, modified }) => {
    if (rows.get(dest) === hash) return { path: dest, sha256: hash, ...(modified ? { modified } : {}) };
    return before?.files.has(dest) ? { path: dest, sha256: before.files.get(dest) } : null;
  };
  const recordRows = memoryRead ? [...read.entries.filter(entry => entry.source === read.memory).map(recorded).filter(Boolean),
    ...picked.unapplied.map(({ path: dest, sha256: hash }) => ({ path: dest, sha256: hash }))].sort(byPath) : null;
  const record = recordRows ? { folder: read.memory, at: new Date(time).toISOString(), files: recordRows } : null;
  return {
    folder, previous, manifest, unchanged, kept: read.kept, writes: picked.writes, deletes: picked.deletes, seen: seenOf(read.entries), real: picked.real, unsure: picked.unsure,
    removed: picked.removedNow, held: picked.held, clockBehind: picked.clockBehind, removedHere: picked.removedHere, diverged: picked.diverged, record,
  };
}

// Writes the snapshot (and deletes the copies the plan removes) and returns an undo that puts every
// file it touched back as it was (a file it created is removed), for a save that stops before it commits.
function write(base, { folder, manifest, writes, deletes = [] }, repository, { fs = nodeFs } = {}) {
  const before = [];
  const target = rel => path.join(base, folder, ...rel.split('/'));
  const keep = file => {
    let old = null;
    try { old = fs.readFileSync(file); } catch { old = null; }
    before.push([file, old]);
  };
  const put = (rel, text) => {
    const file = target(rel);
    keep(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  try {
    for (const entry of writes) put(entry.path, entry.text);
    for (const rel of deletes) { const file = target(rel); keep(file); fs.rmSync(file, { force: true }); }
    put('README.md', README(repository));
    put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) { undo(); throw error; }
  function undo() {
    for (const [file, old] of before.reverse()) {
      try {
        if (old === null) fs.rmSync(file, { force: true });
        else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, old); }
      } catch { /* best effort; the next run rebuilds it */ }
    }
  }
  return undo;
}

// The session baseline: each reachable source file's snapshot path, sha256, source and modified time
// as this session holds it now. Read-only, no secret scan (nothing is written from it).
function sessionRows(sources, { fs = nodeFs, platform = process.platform } = {}) {
  return seenOf(readSources(sources, { fs, platform, scan: false }).entries);
}

// Read-only: would a run change the snapshot? STALE names what it would change (`removed` among it),
// the unsure files (this copy differs from a row with no real time, so a run keeps the row; `reseed`
// takes this copy), removals held over the limit, a clock behind the snapshot, and removed files this
// copy holds with different content, and diverged files (memory rows this computer never held at that
// content, so a run keeps them; `reseed` takes this copy); a source not reachable here is not counted as a change.
function check({ base, repository, sources = null, now = new Date(), fs = nodeFs, platform = process.platform, records = null }) {
  const folder = snapshotFolder(repository);
  if (!folder) throw new HandoffError(`${JSON.stringify(repository)} is not a plain owner/repo name.`, 'name the controlled repository\'s checkout with --repo-root.');
  const previous = readManifest(base, folder, { fs });
  if (!previous) return { state: 'MISSING', folder };
  const { read, picked } = decide({ base, repository, sources, fs, platform, scan: true, records, now });
  const before = new Map(previous.files.map(row => [row.path, row.sha256]));
  const after = new Map(picked.files.map(row => [row.path, row.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys(), ...picked.deletes])].filter(key => before.get(key) !== after.get(key) || picked.deletes.includes(key)).sort();
  const takenAt = previous.stamp?.taken_at || null;
  const time = now instanceof Date ? now.getTime() : Number(now);
  const hours = takenAt && !Number.isNaN(Date.parse(takenAt)) ? Math.max(0, Math.round((time - Date.parse(takenAt)) / 360000) / 10) : null;
  const stale = changed.length || picked.unsure.length || picked.held || picked.clockBehind || picked.removedHere.length || picked.diverged.length;
  return { state: stale ? 'STALE' : 'CURRENT', folder, taken_at: takenAt, age_hours: hours, changed, unsure: picked.unsure, kept: read.kept, removed: picked.removedNow, held: picked.held, clockBehind: picked.clockBehind, removedHere: picked.removedHere, diverged: picked.diverged };
}

module.exports = Object.freeze({ SCHEMA, READ_SCHEMAS, ROOT, FOLDER_RECORDS, MARGIN_MS, HOLD_MIN, HandoffError, snapshotFolder, fullPathHere, normaliseSources, hasSources, readSources, readManifest, readFolderRecord, writeFolderRecord, isMemoryPath, plan, write, check, sessionRows, realBySource });
