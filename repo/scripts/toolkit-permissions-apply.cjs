#!/usr/bin/env node
'use strict';

// `toolkit permissions --apply` and `--remove`: the owner's own one command that sets Toolkit's
// permission lines up to date, removes the lines the owner picked from the review, or takes Toolkit's
// lines out.
//
//   node repo/scripts/toolkit-permissions.cjs --apply [--host claude|codex] [--repo-root <checkout>] [--drop <ids> --preview <code>]
//   node repo/scripts/toolkit-permissions.cjs --remove [--host claude|codex] [--repo-root <checkout>]
//
// The owner types this in their own terminal. It shows what would change in plain short lines, waits
// for a fresh Enter (owner-terminal.cjs), backs every file it will write up into one folder outside
// every checkout (~/.ai-agent-toolkit/backups/permissions/<UTC time>/, with list.txt saying where each
// file goes back), reads that folder back, writes each file, reads each back, and on any write or
// read-back failure puts every file it wrote back from that folder and says so (host-config-writes
// rule 2). Agents never run it. The only hard block is the app's own: the computer block holds an ask
// line (Claude Code) and a prompt rule (Codex) for this exact command, and `--apply` must be the first
// argument so the Codex rule matches. The two checks below are speed bumps, not locks:
//   - it refuses in a shell a coding agent started (the exact markers `toolkit env show` refuses on);
//   - it needs a terminal on stdin and stdout and a fresh Enter; a pipe, a file or a pasted blank line never answers.
//
// Claude Code (toolkit-permissions-review.cjs reads the files): --apply adds Toolkit's missing lines to
// the computer file and the governed repository's local file and takes out old Toolkit lines there.
// With --drop it also removes the review lines the owner named, from every file in scope that holds
// them (worktree copies included; Toolkit lines are never added to a copy), and only when --preview
// matches the list the owner saw: a file, a line or a pick that changed since gives another code and
// nothing is written. Without --drop every line that is not Toolkit's stays ("keep everything"). The
// shared settings file in Git is never written. Every other key (deny, autoMode, env, ...) is kept.
// Apply records which Toolkit lines it added, per file, in Toolkit's user state
// (permission-lines.json); --remove takes out only those lines plus old Toolkit lines, in every
// recorded file. In a file with no record yet, Toolkit's current lines count as Toolkit's.
// Codex: Toolkit's own rules file, replaced whole, or deleted by --remove (its backup stays).
//
// Exit codes: 0 written or already current, 1 stopped (nothing written, or written files put back), 2 usage.

const nodeFs = require('node:fs');
const path = require('node:path');
const ownerTerminal = require('./owner-terminal.cjs');
const permissions = require('./toolkit-permissions.cjs');
const review = require('./toolkit-permissions-review.cjs');

const { AGENT_MARKERS } = ownerTerminal;
const APPS = Object.freeze({ claude: 'Claude Code', codex: 'Codex' });
const RECORD_SCHEMA = 'toolkit.permission-lines.v1';

class ApplyStop extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); Object.assign(this, { stopped, next, exitCode }); }
}

function parseApplyArgs(argv, mode = 'apply') {
  const options = { hosts: ['claude', 'codex'], repoRoot: null, mode, drop: null, preview: null };
  const takes = mode === 'apply' ? ['--repo-root', '--drop', '--preview'] : ['--repo-root'];
  const keys = { '--repo-root': 'repoRoot', '--drop': 'drop', '--preview': 'preview' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--host' && ['claude', 'codex'].includes(value)) { options.hosts = [value]; index += 1; continue; }
    if (takes.includes(arg) && options[keys[arg]] === null && typeof value === 'string' && value && !value.startsWith('--')) { options[keys[arg]] = value; index += 1; continue; }
    throw new ApplyStop(`--${mode} takes only --host claude|codex and --repo-root <checkout>${mode === 'apply' ? ', and --drop <ids> --preview <code> from the review' : ''}, not ${JSON.stringify(arg)}.`, 'see the usage line.', 2);
  }
  if ((options.drop === null) !== (options.preview === null)) throw new ApplyStop('--drop and --preview go together, as the review printed them.', 'ask for the list again and run the command it prints. Nothing was written.', 2);
  if (options.drop !== null && !/^[0-9a-f]{8}$/.test(options.preview)) throw new ApplyStop('--preview takes the 8-character code the review printed.', 'ask for the list again and run the command it prints. Nothing was written.', 2);
  if (options.drop !== null && options.hosts.includes('codex') && options.hosts.length === 1) throw new ApplyStop('--drop picks Claude Code lines; it cannot go with --host codex.', 'run the command the review printed. Nothing was written.', 2);
  return options;
}


// Parses a Claude Code settings file Toolkit may merge into, or stops.
function settingsOf(target, before) {
  if (before === null) return {};
  let settings;
  try { settings = JSON.parse(before.replace(/^﻿/, '')); } catch { settings = null; }
  const permissions = settings && settings.permissions;
  const listOk = key => permissions === undefined || permissions[key] === undefined || (Array.isArray(permissions[key]) && permissions[key].every(item => typeof item === 'string'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)))
    || !listOk('allow') || !listOk('ask')) {
    throw new ApplyStop(`${target} is not a settings file Toolkit can merge into safely (it must be a JSON object whose permission lists hold only text).`, 'fix that file, or paste the block by hand. Nothing was written.');
  }
  return settings;
}

// The file's new text: `remove` lines taken out of their lists, `add` lines put at the end; every
// other key and line kept, and the file's own indent, line endings and byte order mark.
// Toolkit's auto mode rule goes in autoMode.allow. Claude Code reads that list as prose rules, and a
// list without the literal "$defaults" replaces its built-in rules
// (https://code.claude.com/docs/en/auto-mode-config, read 26 Nov 2026): a list Toolkit creates starts
// with "$defaults", and --remove takes "$defaults" out again only when Toolkit put it there and nothing
// else is left.
function merged(target, before, add, remove) {
  const settings = settingsOf(target, before);
  const permissions = settings.permissions || {};
  const next = { ...settings };
  for (const key of ['allow', 'ask']) {
    if (!add[key].length && !remove[key].length) continue;
    next.permissions = { ...permissions, ...(next.permissions || {}) };
    next.permissions[key] = [...(permissions[key] || []).filter(line => !remove[key].includes(line)), ...add[key].filter(line => !(permissions[key] || []).includes(line))];
  }
  const autoAdd = add.autoMode || [];
  const autoRemove = remove.autoMode || [];
  if (autoAdd.length || autoRemove.length) {
    const auto = autoModeOf(target, settings);
    let rules = auto.allow === undefined ? ['$defaults'] : [...auto.allow];
    rules = [...rules.filter(rule => !autoRemove.includes(rule)), ...autoAdd.filter(rule => !rules.includes(rule))];
    const nextAuto = { ...auto, allow: rules };
    if (remove.dropDefaults && rules.length === 1 && rules[0] === '$defaults') delete nextAuto.allow;
    if (Object.keys(nextAuto).length) next.autoMode = nextAuto;
    else delete next.autoMode;
  }
  const shape = before && /^﻿?\{\r?\n([ \t]+)\S/.exec(before);
  const eol = before && before.includes('\r\n') ? '\r\n' : '\n';
  return `${before && before.startsWith('﻿') ? '﻿' : ''}${JSON.stringify(next, null, shape ? shape[1] : 2).replace(/\n/g, eol)}${eol}`;
}

// The file's autoMode object, or stops when it is not one Toolkit can merge into.
function autoModeOf(target, settings) {
  const auto = settings.autoMode === undefined ? {} : settings.autoMode;
  if (!auto || typeof auto !== 'object' || Array.isArray(auto) || (auto.allow !== undefined && !(Array.isArray(auto.allow) && auto.allow.every(rule => typeof rule === 'string')))) {
    throw new ApplyStop(`${target} has an autoMode setting Toolkit cannot merge into safely (its allow list must hold only text).`, 'fix that setting, then run it again. Nothing was written.');
  }
  return auto;
}

const listOf = (text, key) => {
  const settings = JSON.parse(String(text).replace(/^﻿/, ''));
  if (key === 'autoMode') return Array.isArray(settings.autoMode?.allow) ? settings.autoMode.allow : [];
  return Array.isArray(settings.permissions?.[key]) ? settings.permissions[key] : [];
};

class PermissionsApply {
  #fs; #environment; #home; #now; #pid; #platform;

  constructor({ fs = nodeFs, environment = process.env, home = require('node:os').homedir(), now = () => new Date(), pid = process.pid, platform = process.platform } = {}) {
    this.#fs = fs; this.#environment = environment; this.#home = home; this.#now = now; this.#pid = pid; this.#platform = platform;
  }

  // A link whose target is missing would be swapped for a plain file, so it stops instead.
  #danglingLink(file) {
    try { return this.#fs.lstatSync(file).isSymbolicLink() && !this.#fs.existsSync(file); } catch { return false; }
  }

  read(file) {
    try { return this.#fs.readFileSync(file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') {
        if (this.#danglingLink(file)) throw new ApplyStop(`${file} is a link to a file that does not exist.`, 'fix or remove the link, then run it again. Nothing was written.');
        return null;
      }
      throw new ApplyStop(`${file} could not be read (${error && error.code ? error.code : 'error'}).`, 'fix the file or paste the block by hand. Nothing was written.');
    }
  }

  // One Claude Code file's change: { host, target, before, after, add, remove, current }.
  planClaude(target, add, remove, extra = {}) {
    const before = this.read(target);
    const settings = settingsOf(target, before);
    const present = key => (key === 'autoMode' ? (Array.isArray(settings.autoMode?.allow) ? settings.autoMode.allow : [])
      : Array.isArray(settings.permissions?.[key]) ? settings.permissions[key] : []);
    const keys = ['allow', 'ask', 'autoMode'];
    const realAdd = Object.fromEntries(keys.map(key => [key, (add[key] || []).filter(line => !present(key).includes(line))]));
    const realRemove = Object.fromEntries(keys.map(key => [key, (remove[key] || []).filter(line => present(key).includes(line))]));
    realRemove.dropDefaults = remove.dropDefaults === true;
    // Toolkit puts "$defaults" first in an autoMode list it creates; the record notes it.
    const autoCreated = realAdd.autoMode.length > 0 && !(settings.autoMode && Array.isArray(settings.autoMode.allow));
    const current = keys.every(key => !realAdd[key].length && !realRemove[key].length);
    return { host: 'claude', target, before, after: current ? before : merged(target, before, realAdd, realRemove), add: realAdd, remove: realRemove, current, autoCreated, ...extra };
  }

  // Toolkit's Codex rules file: replaced whole by --apply, deleted by --remove.
  planCodex(block, mode) {
    const before = this.read(block.target);
    const codexHome = this.#environment.CODEX_HOME || path.join(this.#home, '.codex');
    if (!this.#fs.existsSync(codexHome)) return { host: 'codex', target: block.target, skip: `Codex has no settings folder on this computer (${codexHome}).` };
    const old = permissions.ruleKeys(before);
    if (mode === 'remove') return { host: 'codex', target: block.target, before, after: null, current: before === null, added: [], removed: old, deleted: before !== null };
    const same = before !== null && before.replace(/\r\n/g, '\n') === block.text;
    const next = permissions.ruleKeys(block.text);
    return { host: 'codex', target: block.target, before, after: block.text, current: same, added: next.filter(key => !old.includes(key)), removed: old.filter(key => !next.includes(key)), replaced: before !== null && !same };
  }

  #stamp() { return this.#now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

  // One backup folder for the run, outside every checkout: the exact previous bytes of every file to
  // be written, plus list.txt (where each goes back). Made and read back before the first write.
  backup(plans) {
    const fs = this.#fs;
    const parent = path.join(this.#home, '.ai-agent-toolkit', 'backups', 'permissions');
    fs.mkdirSync(parent, { recursive: true });
    let folder = null;
    for (let attempt = 1; attempt <= 50 && !folder; attempt += 1) {
      const name = path.join(parent, `${this.#stamp()}${attempt > 1 ? `-${attempt}` : ''}`);
      try { fs.mkdirSync(name); folder = name; } catch (error) { if (!error || error.code !== 'EEXIST') throw error; }
    }
    if (!folder) throw new ApplyStop('no free backup folder name.', 'run it again in a moment. Nothing was written.');
    const list = [];
    plans.forEach((plan, index) => {
      if (plan.before === null) { list.push(`(new file) ${plan.target}  <- delete it to undo`); plan.saved = null; return; }
      const name = `${index + 1}-${path.basename(plan.target)}`;
      fs.writeFileSync(path.join(folder, name), plan.before, { flag: 'wx' });
      list.push(`${name}  ->  ${plan.target}`);
      plan.saved = path.join(folder, name);
    });
    fs.writeFileSync(path.join(folder, 'list.txt'), `${list.join('\n')}\n`, { flag: 'wx' });
    for (const plan of plans) if (plan.saved && fs.readFileSync(plan.saved, 'utf8') !== plan.before) throw new ApplyStop(`the backup of ${plan.target} did not read back.`, `check the disk, then run it again. Nothing was written. Backup folder: ${folder}`);
    return folder;
  }

  // Writes one planned change: temp file, rename (the old file's mode kept), read back.
  write(plan) {
    const fs = this.#fs;
    if (this.read(plan.target) !== plan.before) throw Object.assign(new Error('changed'), { code: 'CHANGED' });
    const real = plan.before !== null ? fs.realpathSync(plan.target) : plan.target;
    const temp = `${real}.toolkit-tmp-${this.#pid}`;
    try {
      const mode = plan.before !== null ? fs.statSync(real).mode & 0o777 : null;
      if (plan.before === null) fs.mkdirSync(path.dirname(real), { recursive: true });
      if (plan.after === null) fs.rmSync(real);
      else {
        fs.writeFileSync(temp, plan.after, { flag: 'wx', ...(mode !== null ? { mode } : {}) });
        if (mode !== null && this.#platform !== 'win32') fs.chmodSync(temp, mode);
        fs.renameSync(temp, real);
      }
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch { /* the temp file may not exist */ }
      throw error;
    }
    if (this.read(plan.target) !== plan.after) throw Object.assign(new Error('read-back'), { code: 'READBACK' });
  }

  // Puts every written file back from the backup folder (a new file is deleted), then reads each back.
  restore(written) {
    const failed = [];
    for (const plan of written) {
      try {
        if (plan.before === null) this.#fs.rmSync(plan.target, { force: true });
        else this.#fs.writeFileSync(plan.target, this.#fs.readFileSync(plan.saved, 'utf8'));
        if (this.read(plan.target) !== plan.before) failed.push(plan.target);
      } catch { failed.push(plan.target); }
    }
    return failed;
  }

  // Toolkit's record of the lines it added, per Claude Code file.
  recordFile() { return path.join(this.#home, '.ai-agent-toolkit', 'user-state', 'permission-lines.json'); }

  readRecord() {
    const text = this.read(this.recordFile());
    if (text === null) return { schema: RECORD_SCHEMA, files: {} };
    let record = null;
    try { record = JSON.parse(text); } catch { record = null; }
    if (!record || record.schema !== RECORD_SCHEMA || !record.files || typeof record.files !== 'object' || Array.isArray(record.files)
      || !Object.values(record.files).every(entry => entry && ['allow', 'ask'].every(key => Array.isArray(entry[key]) && entry[key].every(line => typeof line === 'string'))
        && (entry.autoMode === undefined || (Array.isArray(entry.autoMode) && entry.autoMode.every(rule => typeof rule === 'string')))
        && (entry.defaults_added === undefined || typeof entry.defaults_added === 'boolean'))) {
      throw new ApplyStop(`Toolkit's record of the permission lines it added (${this.recordFile()}) cannot be read.`, 'move that file aside, then run it again; without it, Toolkit treats its current lines as its own. Nothing was written.');
    }
    return record;
  }

  writeRecord(record) {
    const file = this.recordFile();
    this.#fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.toolkit-tmp-${this.#pid}`;
    this.#fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    this.#fs.renameSync(temp, file);
  }
}

const sameKey = file => path.resolve(file);
// A path under the home folder, shown from ~ with forward slashes.
function homeShort(file, home) {
  const target = String(file).replace(/\\/g, '/');
  const root = String(home).replace(/\\/g, '/').replace(/\/$/, '');
  return target.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? `~${target.slice(root.length)}` : target;
}
const none = () => ({ allow: [], ask: [], autoMode: [] });
const count = lists => lists.allow.length + lists.ask.length + (lists.autoMode || []).length;

// Claude Code plans for --apply: Toolkit's missing and old lines in the main files, and the picked
// lines wherever they are. Returns { model, plans, picked }.
function claudeApplyPlans(model, applier, picked) {
  const plans = [];
  for (const file of model.files) {
    if (!file.writable) continue;
    const add = file.main ? { allow: [...file.missing.allow], ask: [...file.missing.ask], autoMode: [...file.auto.add] } : none();
    const remove = { allow: [...file.old.allow], ask: [...file.old.ask], autoMode: [...file.auto.remove] };
    const pickedHere = picked.filter(item => item.files.includes(file.index));
    for (const item of pickedHere) remove[item.list].push(item.line);
    const plan = applier.planClaude(file.target, add, remove, { file, scope: file.kind, picked: pickedHere });
    if (plan.before !== file.before) throw new ApplyStop(`${file.target} changed while the list was being read.`, 'run it again. Nothing was written.');
    plans.push(plan);
  }
  return plans;
}

// The removals of one plan for the screen: old Toolkit lines first, then the owner's picks.
function screenEntries(plan) {
  const picked = new Set(plan.picked ? plan.picked.map(item => `${item.list}\u0000${item.line}`) : []);
  const entries = [];
  for (const key of ['allow', 'ask', 'autoMode']) for (const line of plan.remove[key] || []) if (!picked.has(`${key}\u0000${line}`)) entries.push({ id: null, list: key, line });
  for (const item of plan.picked || []) entries.push({ id: item.id, list: item.list, line: item.line, item });
  return entries;
}

function codexScreen(plan) {
  if (plan.skip) return [`Codex rules  skipped: ${plan.skip}`];
  if (plan.deleted) return [`Codex rules  ${plan.target}`, '  delete  Toolkit\'s own rules file'];
  return [`Codex rules  ${plan.target}`, `  replace Toolkit's own rules file whole (${plan.added.length} added, ${plan.removed.length} removed)`];
}

async function main(argv, deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  const environment = deps.environment || process.env;
  const look = { stream: deps.stdout ? null : process.stdout, environment };
  try {
    const options = parseApplyArgs(argv, deps.mode || 'apply');
    const flag = `--${options.mode}`;
    const marker = AGENT_MARKERS.find(name => Boolean(environment[name]));
    if (marker) throw new ApplyStop(`this shell was started by a coding agent (${marker}). Agents never run ${flag}.`, 'the owner runs this in their own PowerShell or terminal, outside any agent. Nothing was written.');
    const tty = (deps.tty || (() => ({ stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) })))();
    if (!tty.stdin || !tty.stdout) throw new ApplyStop(`${flag} needs a terminal you type into; it does not read answers from a pipe or print into a file.`, 'run it yourself in PowerShell or a terminal window. Nothing was written.');

    const blocks = new permissions.PermissionBlocks(deps);
    const applier = new PermissionsApply(deps);
    const lister = new review.PermissionReview({ blocks, rows: permissions.ROWS, never: permissions.NEVER, safePath: permissions.safePath, cwd: deps.cwd, fs: deps.fs, home: deps.home || require('node:os').homedir(), platform: deps.platform || process.platform, environment, run: deps.run || require('node:child_process').spawnSync });
    const notes = [];
    let model = null;
    let picked = [];
    let claudePlans = [];
    const codexPlans = [];
    const record = options.hosts.includes('claude') ? applier.readRecord() : null;

    if (options.hosts.includes('claude')) {
      if (options.mode === 'apply') {
        try { model = lister.collect({ repoRoot: options.repoRoot }); } catch (error) {
          if (error instanceof review.ReviewStop) throw new ApplyStop(error.stopped, error.next);
          throw error;
        }
        if (model.note) notes.push(model.repoName ? `${model.note.replace(/; its lines are listed for you to keep or pick$/, '')}.` : `Repo block: none here (${model.note.replace(/\.$/, '')}). Run it from a governed repository, or add --repo-root <checkout>, to add that repository's block too.`);
        if (options.drop !== null) {
          const picks = review.readDrop(options.drop, model);
          if (!picks.ok) throw new ApplyStop(picks.reason, 'ask for the list again and run the command it prints. Nothing was written.');
          if (review.previewCode(model, picks.ids) !== options.preview) throw new ApplyStop(`the settings files changed after the list you saw (preview ${options.preview}).`, 'ask for the list again. Nothing was written.');
          picked = picks.ids.map(id => model.items.find(item => item.id === id));
        }
        claudePlans = claudeApplyPlans(model, applier, picked);
      } else claudePlans = claudeRemovePlans({ blocks, applier, record, repoRoot: options.repoRoot, deps, notes });
    }
    for (const host of options.hosts.filter(name => name === 'codex')) {
      const built = blocks.build({ host, scope: 'computer' });
      codexPlans.push(...built.blocks.map(block => ({ ...applier.planCodex(block, options.mode), scope: 'computer' })));
    }

    const pending = [...claudePlans.filter(plan => !plan.current), ...codexPlans.filter(plan => !plan.skip && !plan.current)];
    const codexEntries = codexPlans.filter(plan => plan.skip || !plan.current).map(plan => ({ lines: codexScreen(plan), writes: !plan.skip }));
    const screen = options.mode === 'apply' && model
      ? review.terminalScreen(model, claudePlans.filter(plan => !plan.current).map(plan => ({ file: plan.file, add: plan.add, remove: screenEntries(plan) })), { picked, codex: codexEntries, notes })
      : otherScreen(options.mode, claudePlans, codexEntries, notes, deps.home || require('node:os').homedir());
    const lines = [ownerTerminal.title(screen.text.split('\n')[0], look), ...screen.text.split('\n').slice(1)];
    if (!pending.length) {
      const codexOnly = codexPlans.filter(plan => plan.skip).map(codexScreen).flat();
      out(`${[ownerTerminal.title(options.mode === 'remove' ? 'Toolkit permissions: take Toolkit\'s lines out' : 'Toolkit permissions: bring Toolkit\'s lines up to date', look), ...codexOnly, ...notes, `Nothing to change: ${options.mode === 'remove' ? 'no Toolkit lines found' : 'Toolkit\'s lines are up to date'}. Nothing was written.`].join('\n')}\n`);
      return 0;
    }
    out(`${lines.join('\n')}\n\n`);
    const confirmed = await (deps.confirm || (effect => ownerTerminal.pressEnter(effect, { output: process.stdout, environment })))(screen.effect);
    if (confirmed !== true) { out('Stopped. Nothing was written.\n'); return 1; }

    // Each file must still be what the screen showed.
    for (const plan of pending) if (applier.read(plan.target) !== plan.before) throw new ApplyStop(`${plan.target} changed after the screen above.`, 'ask for the list again. Nothing was written.');
    const folder = applier.backup(pending);
    const written = [];
    for (const plan of pending) {
      try { applier.write(plan); written.push(plan); verify(plan); } catch (error) {
        if (!written.includes(plan) && error && error.code !== 'CHANGED') written.push(plan);
        const failed = applier.restore(written.filter(item => !(error && error.code === 'CHANGED' && item === plan)));
        const what = error && error.code === 'CHANGED' ? 'changed while Toolkit was writing' : error instanceof ApplyStop ? 'did not hold the expected lines after the write' : `could not be written (${error && error.code ? error.code : 'error'})`;
        throw new ApplyStop(`${plan.target} ${what}. ${failed.length ? `Toolkit could not put back ${failed.join(', ')}; copy them from the backup folder by hand.` : `Every file Toolkit wrote is back as it was.`} Backup folder: ${folder}`, 'check the file and its folder, then run it again.');
      }
    }
    let recordNote = '';
    if (record) {
      try { applier.writeRecord(nextRecord(record, claudePlans.filter(plan => !plan.current), options.mode)); } catch (error) {
        recordNote = `Toolkit could not save which lines it added (${error && error.code ? error.code : 'error'}); a later remove treats Toolkit's current lines as its own.`;
      }
    }
    const added = pending.reduce((sum, plan) => sum + (plan.host === 'claude' ? count(plan.add) : (plan.added || []).length), 0);
    const removed = pending.reduce((sum, plan) => sum + (plan.host === 'claude' ? count(plan.remove) : (plan.removed || []).length), 0);
    const apps = [...new Set(pending.map(plan => APPS[plan.host]))];
    out(`${[ownerTerminal.ok(`Done: ${pending.length === 1 ? '1 file' : `${pending.length} files`} written, ${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed.`, look),
      `  Backup: ${homeShort(folder, deps.home || require('node:os').homedir())}`,
      '  Undo  : copy the files in that folder back; its list.txt says where each goes.',
      ...(recordNote ? [`  Note  : ${recordNote}`] : []),
      `Restart ${apps.join(' and ')} so ${apps.length === 1 ? 'it reads' : 'they read'} the new lines.`].join('\n')}\n`);
    return recordNote ? 1 : 0;
  } catch (error) {
    if (!(error instanceof ApplyStop)) throw error;
    err(`${ownerTerminal.stop(error.stopped, error.next, { stream: deps.stderr ? null : process.stderr, environment })}\n`);
    return error.exitCode;
  }
}

// After a write, a Claude Code file must parse, hold every added line, none of the removed ones, and
// every other line it held before.
function verify(plan) {
  if (plan.host !== 'claude') return;
  for (const key of ['allow', 'ask', 'autoMode']) {
    const after = listOf(plan.after, key);
    const before = plan.before === null ? [] : listOf(plan.before, key);
    const kept = before.filter(line => !(plan.remove[key] || []).includes(line) && !(key === 'autoMode' && line === '$defaults' && plan.remove.dropDefaults));
    if ((plan.add[key] || []).some(line => !after.includes(line)) || (plan.remove[key] || []).some(line => after.includes(line)) || kept.some(line => !after.includes(line))) {
      throw new ApplyStop(`${plan.target} did not hold the expected lines after the write.`, 'run it again.');
    }
  }
}

// The record after a write: per main file, the Toolkit lines it holds that Toolkit added (or that were
// there before any record, which count as Toolkit's), less the lines taken out.
function nextRecord(record, plans, mode) {
  const files = { ...record.files };
  for (const plan of plans) {
    const key = sameKey(plan.target);
    if (mode === 'remove') { delete files[key]; continue; }
    if (!plan.file || !plan.file.main) continue;
    const was = list => (plan.before === null ? [] : listOf(plan.before, list));
    const had = files[key] || { allow: plan.file.block.allow.filter(line => was('allow').includes(line)), ask: plan.file.block.ask.filter(line => was('ask').includes(line)), autoMode: (plan.file.block.autoMode || []).filter(rule => was('autoMode').includes(rule)) };
    const entry = Object.fromEntries(['allow', 'ask', 'autoMode'].map(list => [list, [...new Set([...(had[list] || []), ...(plan.add[list] || [])])].filter(line => !(plan.remove[list] || []).includes(line))]));
    if (had.defaults_added || plan.autoCreated) entry.defaults_added = true;
    files[key] = entry;
  }
  return { schema: RECORD_SCHEMA, files };
}

// --remove for Claude Code: in the computer file, the repository's local file and every file the
// record names, the recorded lines (or, with no record for that file, Toolkit's current lines) plus
// old Toolkit lines. A line the owner had before Toolkit's record said so stays. The managed checkout
// may be gone: the lines are built from the recorded Toolkit folder without reading it.
function claudeRemovePlans({ blocks, applier, record, repoRoot, deps, notes, repo: withRepo = true }) {
  const shipped = review.shippedScripts(permissions.ROWS);
  let built = null;
  try { built = blocks.build({ host: 'claude', scope: withRepo ? 'all' : 'computer', repoRoot, requireScripts: false }); } catch (error) {
    if (!(error instanceof permissions.PermissionsError)) throw error;
    built = null;
  }
  if (built && repoRoot && built.stops.length) throw new ApplyStop(built.stops[0].stopped, `${built.stops[0].next} Nothing was written.`);
  if (built) for (const stop of built.stops) notes.push(`Repo block: none here (${stop.stopped.replace(/^no repo block: /, '').replace(/\.$/, '')}).`);
  const targets = new Map();
  const computerTarget = built ? built.blocks.find(block => block.scope === 'computer').target : path.join((deps.environment || process.env).CLAUDE_CONFIG_DIR || path.join(deps.home || require('node:os').homedir(), '.claude'), 'settings.json');
  targets.set(sameKey(computerTarget), { target: computerTarget, block: built ? built.blocks.find(block => block.scope === 'computer') : null, scope: 'computer' });
  const repo = built && built.blocks.find(block => block.scope === 'repo');
  if (repo) targets.set(sameKey(repo.target), { target: repo.target, block: repo, scope: 'repo' });
  for (const file of Object.keys(record.files)) if (!targets.has(sameKey(file))) targets.set(sameKey(file), { target: file, block: null, scope: 'recorded' });
  const plans = [];
  for (const [key, entry] of targets) {
    const before = applier.read(entry.target);
    if (before === null) continue;
    const settings = settingsOf(entry.target, before);
    const have = list => (Array.isArray(settings.permissions?.[list]) ? settings.permissions[list] : []);
    const owned = record.files[key] || (entry.block ? { allow: entry.block.allow, ask: entry.block.ask, autoMode: entry.block.autoMode || [] } : none());
    // Every auto mode rule carrying Toolkit's mark is Toolkit's, today's or an old one.
    const rules = Array.isArray(settings.autoMode?.allow) ? settings.autoMode.allow.filter(rule => typeof rule === 'string') : [];
    const autoMode = rules.filter(rule => (owned.autoMode || []).includes(rule) || rule.startsWith(permissions.AUTO_MODE_MARK));
    const remove = Object.fromEntries(['allow', 'ask'].map(list => [list, have(list).filter(line => owned[list].includes(line)
      || (review.oldToolkitLine(line, shipped) && !(entry.block && entry.block[list].includes(line))))]));
    Object.assign(remove, { autoMode, dropDefaults: record.files[key]?.defaults_added === true });
    plans.push(applier.planClaude(entry.target, none(), remove, { scope: entry.scope }));
  }
  return plans;
}

// The owner's screen for --remove, and for --apply with Codex only: plain short lines.
function otherScreen(mode, claudePlans, codexEntries, notes, home) {
  const lines = [mode === 'remove' ? 'Toolkit permissions: take Toolkit\'s lines out' : 'Toolkit permissions: bring Toolkit\'s lines up to date', ...notes, ''];
  for (const plan of claudePlans.filter(item => !item.current)) {
    lines.push(`${plan.scope === 'computer' ? 'Computer settings' : 'Settings'}  ${homeShort(plan.target, home)}`, ...review.toolkitRows([...plan.remove.allow, ...plan.remove.ask], 'remove '),
      ...(plan.remove.autoMode.length ? [`  remove  Toolkit's ${review.AUTO_WORDS}`] : []));
  }
  for (const entry of codexEntries) lines.push(...entry.lines);
  const files = claudePlans.filter(plan => !plan.current).length + codexEntries.filter(entry => entry.writes).length;
  lines.push('', mode === 'remove' ? 'Every line that is not Toolkit\'s stays, and every other setting.' : 'Every other setting stays.', `Backup first: one folder for ${review.backupWords(files)}.`);
  return { text: lines.join('\n'), effect: `back up and write ${files === 1 ? '1 file' : `${files} files`}` };
}

// Read-only: what --remove would take out on this computer, for `remove toolkit`'s list.
// [{ host: 'claude'|'codex', target, toolkit: lines that go, other: lines that stay }]. It writes nothing.
function removalPreview(deps = {}) {
  const blocks = new permissions.PermissionBlocks(deps);
  const applier = new PermissionsApply(deps);
  const found = [];
  // The computer file and every recorded file; not whatever repository the shell is in.
  const plans = claudeRemovePlans({ blocks, applier, record: applier.readRecord(), repoRoot: null, deps, notes: [], repo: false });
  for (const plan of plans.filter(item => !item.current)) {
    const settings = settingsOf(plan.target, plan.before);
    const held = ['allow', 'ask'].reduce((sum, key) => sum + (Array.isArray(settings.permissions?.[key]) ? settings.permissions[key].length : 0), 0);
    found.push({ host: 'claude', target: plan.target, toolkit: count(plan.remove), other: held - plan.remove.allow.length - plan.remove.ask.length });
  }
  let built = null;
  try { built = blocks.build({ host: 'codex', scope: 'computer', requireScripts: false }); } catch (error) { if (!(error instanceof permissions.PermissionsError)) throw error; }
  for (const block of built ? built.blocks : []) {
    const plan = applier.planCodex(block, 'remove');
    if (!plan.skip && !plan.current) found.push({ host: 'codex', target: plan.target, toolkit: plan.removed.length, other: 0 });
  }
  return found;
}

module.exports = Object.freeze({ PermissionsApply, ApplyStop, AGENT_MARKERS, RECORD_SCHEMA, parseApplyArgs, nextRecord, removalPreview, main });
