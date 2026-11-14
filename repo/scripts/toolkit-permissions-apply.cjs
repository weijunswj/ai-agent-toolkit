#!/usr/bin/env node
'use strict';

// `toolkit permissions --apply`: the owner's own one-command paste of the permission blocks.
//
//   node repo/scripts/toolkit-permissions.cjs --apply [--host claude|codex] [--repo-root <checkout>]
//
// The owner types this in their own terminal. It shows what would change, waits for the typed word
// `apply`, backs each file up, merges the computer block into it, reads it back and lists what
// changed. Agents never run it. The only hard block is the app's own: the computer block holds an
// ask line (Claude Code) and a prompt rule (Codex) for this exact command, and `--apply` must be the
// first argument so the Codex rule matches. A command written another way (another interpreter
// form, or a script that loads this file) matches neither. The two checks below are speed bumps,
// not locks: a process that clears the markers and fakes a terminal gets past both.
//   - it refuses in a shell a coding agent started (the exact markers `toolkit env show` refuses on);
//   - it needs a terminal on stdin and stdout and the typed word; a pipe or file never answers.
//
// Claude Code: the user settings file. Missing lines are added; every other key and line is kept;
// stale Toolkit lines are reported, never removed. Codex: Toolkit's own rules file, replaced whole.
// Claude Code also gets the repo block, merged the same way into the governed repository's
// `.claude/settings.local.json`: the repository of --repo-root, or the current folder. Without a
// governed repository it says so and merges the computer blocks only; with --repo-root it stops.
// The Codex repo block holds only prompt rules, so it is still pasted by hand.
//
// Exit codes: 0 written or already current, 1 stopped (nothing written), 2 usage.

const nodeFs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { AGENT_HOST_MARKER_NAMES } = require('./agent-host-markers.cjs');

const AGENT_MARKERS = Object.freeze([...AGENT_HOST_MARKER_NAMES, 'AI_AGENT']);
const CONFIRM = 'apply';
const APPS = Object.freeze({ claude: 'Claude Code', codex: 'Codex' });

class ApplyStop extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); this.exitCode = exitCode; }
}

function parseApplyArgs(argv) {
  const options = { hosts: ['claude', 'codex'], repoRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--host' && ['claude', 'codex'].includes(value)) { options.hosts = [value]; index += 1; continue; }
    if (arg === '--repo-root' && options.repoRoot === null && typeof value === 'string' && value && !value.startsWith('--')) { options.repoRoot = value; index += 1; continue; }
    throw new ApplyStop(`--apply takes only --host claude|codex and --repo-root <checkout>, not ${JSON.stringify(arg)}.`, 'see the usage line.', 2);
  }
  return options;
}

// One question on the owner's terminal.
function terminalAsk(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;
    // The answer resolves before close does: close (Ctrl+C, Ctrl+D or end of input) means no answer.
    rl.question(question, (answer) => { answered = true; resolve(answer); rl.close(); });
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}

const ruleKeys = text => [...String(text || '').matchAll(/pattern = (\[[^\n]+\]),\n {4}decision = "(\w+)"/g)].map(match => `${match[2]} ${JSON.parse(match[1]).join(' ')}`);

class PermissionsApply {
  #fs; #environment; #home; #now; #pid; #platform;

  constructor({ fs = nodeFs, environment = process.env, home = require('node:os').homedir(), now = () => new Date(), pid = process.pid, platform = process.platform } = {}) {
    this.#fs = fs; this.#environment = environment; this.#home = home; this.#now = now; this.#pid = pid; this.#platform = platform;
  }

  // A link whose target is missing would be swapped for a plain file, so it stops instead.
  #danglingLink(file) {
    try { return this.#fs.lstatSync(file).isSymbolicLink() && !this.#fs.existsSync(file); } catch { return false; }
  }

  #read(file) {
    try { return this.#fs.readFileSync(file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw new ApplyStop(`${file} could not be read (${error && error.code ? error.code : 'error'}).`, 'fix the file or paste the block by hand. Nothing was written.');
    }
  }

  // What one block would change. Reads only.
  plan(block, check) {
    const before = this.#read(block.target);
    if (before === null && this.#danglingLink(block.target)) throw new ApplyStop(`${block.target} is a link to a file that does not exist.`, 'fix or remove the link, then run it again. Nothing was written.');
    if (block.host === 'codex') {
      const codexHome = this.#environment.CODEX_HOME || path.join(this.#home, '.codex');
      if (!this.#fs.existsSync(codexHome)) return { host: 'codex', target: block.target, skip: `Codex has no settings folder on this computer (${codexHome}).` };
      const same = before !== null && before.replace(/\r\n/g, '\n') === block.text;
      const old = ruleKeys(before);
      const next = ruleKeys(block.text);
      return { host: 'codex', target: block.target, before, after: block.text, current: same,
        added: next.filter(key => !old.includes(key)), removed: old.filter(key => !next.includes(key)), replaced: before !== null && !same };
    }
    let settings = {};
    if (before !== null) {
      try { settings = JSON.parse(before.replace(/^﻿/, '')); } catch { settings = null; }
      const permissions = settings && settings.permissions;
      const listOk = key => permissions === undefined || permissions[key] === undefined || (Array.isArray(permissions[key]) && permissions[key].every(item => typeof item === 'string'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)
        || (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)))
        || !listOk('allow') || !listOk('ask')) {
        throw new ApplyStop(`${block.target} is not a settings file Toolkit can merge into safely (it must be a JSON object whose permission lists hold only text).`, 'fix that file, or paste the block by hand. Nothing was written.');
      }
    }
    const permissions = settings.permissions || {};
    const missing = { allow: block.allow.filter(line => !(permissions.allow || []).includes(line)), ask: block.ask.filter(line => !(permissions.ask || []).includes(line)) };
    const merged = { ...settings, permissions: { ...permissions } };
    for (const key of ['allow', 'ask']) if (missing[key].length) merged.permissions[key] = [...(permissions[key] || []), ...missing[key]];
    const current = !missing.allow.length && !missing.ask.length;
    // Keep the file's own layout: its indent, line endings and byte order mark.
    const indent = (before && /^\uFEFF?\{\r?\n([ \t]+)\S/.exec(before)) ? /^\uFEFF?\{\r?\n([ \t]+)\S/.exec(before)[1] : 2;
    const eol = before && before.includes('\r\n') ? '\r\n' : '\n';
    const after = `${before && before.startsWith('\uFEFF') ? '\uFEFF' : ''}${JSON.stringify(merged, null, indent).replace(/\n/g, eol)}${eol}`;
    return { host: 'claude', target: block.target, before, after, current, missing, stale: before !== null ? check(block.target) : [] };
  }

  #stamp() { return this.#now().toISOString().replace(/[-:]/g, '').replace(/\./, ''); }

  // A new backup next to the file; never overwrites an older one.
  #backup(real) {
    const stamp = this.#stamp();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const name = `${real}.toolkit-backup-${stamp}${attempt > 1 ? `-${attempt}` : ''}`;
      try { this.#fs.copyFileSync(real, name, this.#fs.constants.COPYFILE_EXCL); return name; } catch (error) { if (!error || error.code !== 'EEXIST') throw error; }
    }
    throw Object.assign(new Error('no free backup name'), { code: 'EEXIST' });
  }

  // Writes one planned change: backup, temp file, rename, read back.
  write(plan) {
    const fs = this.#fs;
    const now = this.#read(plan.target);
    if (now !== plan.before) throw new ApplyStop(`${plan.target} changed after the preview.`, 'run toolkit permissions --apply again. Nothing more was written.');
    const real = plan.before !== null ? fs.realpathSync(plan.target) : plan.target;
    let backup = null;
    const temp = `${real}.toolkit-tmp-${this.#pid}`;
    try {
      // The new file keeps the old one's permission bits (a 0600 settings file stays 0600).
      const mode = plan.before !== null ? fs.statSync(real).mode & 0o777 : null;
      if (plan.before !== null) backup = this.#backup(real);
      else fs.mkdirSync(path.dirname(real), { recursive: true });
      fs.writeFileSync(temp, plan.after, { flag: 'wx', ...(mode !== null ? { mode } : {}) });
      if (mode !== null && this.#platform !== 'win32') fs.chmodSync(temp, mode);
      fs.renameSync(temp, real);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch { /* the temp file may not exist */ }
      throw new ApplyStop(`${plan.target} could not be written (${error && error.code ? error.code : 'error'}).${backup ? ` Your backup is ${backup}.` : ''}`, 'check the folder\'s permissions and run it again.');
    }
    if (this.#read(plan.target) !== plan.after) throw new ApplyStop(`${plan.target} did not read back as written.${backup ? ` Your backup is ${backup}.` : ''}`, 'restore the backup if the app misbehaves, then paste the block by hand.');
    return backup;
  }
}

function describePlan(plan) {
  const app = plan.scope === 'repo' ? `${APPS[plan.host]} repo block` : APPS[plan.host];
  if (plan.skip) return [`${app}: skipped. ${plan.skip}`];
  if (plan.current) return [`${app}: ${plan.target} already holds the block. Nothing to change.`];
  if (plan.host === 'claude') {
    return [
      `${app}: ${plan.target}${plan.before === null ? ' (new file)' : ''}`,
      ...plan.missing.allow.map(line => `  + allow ${line}`),
      ...plan.missing.ask.map(line => `  + ask   ${line}`),
      ...plan.stale.map(line => `  ! stale, kept: ${line}`),
      '  Every other line and setting in the file stays.',
    ];
  }
  return [
    `${app}: ${plan.target}${plan.before === null ? ' (new file)' : ' (Toolkit\'s own rules file, replaced whole)'}`,
    ...plan.added.map(key => `  + ${key}`),
    ...plan.removed.map(key => `  - ${key}`),
    ...(plan.replaced && !plan.added.length && !plan.removed.length ? ['  Same rules; wording or order changes only.'] : []),
  ];
}

async function main(argv, deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  const environment = deps.environment || process.env;
  try {
    const options = parseApplyArgs(argv);
    const marker = AGENT_MARKERS.find(name => Boolean(environment[name]));
    if (marker) throw new ApplyStop(`this shell was started by a coding agent (${marker}). Agents never run --apply.`, 'the owner runs this in their own PowerShell or terminal, outside any agent. Nothing was written.');
    const tty = (deps.tty || (() => ({ stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) })))();
    if (!tty.stdin || !tty.stdout) throw new ApplyStop('--apply needs a terminal you type into; it does not read answers from a pipe or print into a file.', 'run it yourself in PowerShell or a terminal window. Nothing was written.');

    const PermissionBlocks = deps.PermissionBlocks || require('./toolkit-permissions.cjs').PermissionBlocks;
    const blocks = new PermissionBlocks(deps);
    const applier = new PermissionsApply(deps);
    const notes = [];
    const plans = options.hosts.flatMap((host) => {
      // Claude Code also takes the repo block; the Codex repo block holds only prompt rules.
      const built = blocks.build({ host, scope: host === 'claude' ? 'all' : 'computer', repoRoot: options.repoRoot });
      for (const stop of built.stops) {
        if (options.repoRoot) throw new ApplyStop(`${stop.stopped}`, `${stop.next} Nothing was written.`);
        notes.push(`Repo block: none here (${stop.stopped.replace(/^no repo block: /, '').replace(/\.$/, '')}). Run it from a governed repository, or add --repo-root <checkout>, to add that repository's block too.`);
      }
      return built.blocks.map(block => ({ ...applier.plan(block, file => blocks.check(file, { blocks: [block] })[0].stale), scope: block.scope, block }));
    });

    out(`${['Toolkit permissions --apply: merges the Toolkit permission blocks into this computer\'s app settings.', '', ...plans.flatMap(describePlan), ...notes, ''].join('\n')}\n`);
    const pending = plans.filter(plan => !plan.skip && !plan.current);
    if (!pending.length) { out('Nothing to change. Nothing was written.\n'); return 0; }

    const answer = await (deps.ask || terminalAsk)(`Type ${CONFIRM} to back up and write ${pending.length === 1 ? 'this file' : 'these files'}; anything else stops: `);
    if (String(answer || '').trim().toLowerCase() !== CONFIRM) { out('Stopped. Nothing was written.\n'); return 1; }

    for (const plan of pending) {
      const backup = applier.write(plan);
      const count = plan.host === 'claude' ? `added ${plan.missing.allow.length} allow and ${plan.missing.ask.length} ask lines` : `wrote ${ruleKeys(plan.after).length} rules`;
      out(`${APPS[plan.host]}${plan.scope === 'repo' ? ' repo block' : ''}: ${count} to ${plan.target}. ${backup ? `Backup: ${backup}` : 'New file, so no backup.'}\n`);
    }
    // Read back each Claude Code file written, against the block it was given.
    for (const plan of pending.filter(item => item.host === 'claude')) {
      const report = blocks.check(plan.target, { blocks: [plan.block] })[0];
      if (report.missing.length) throw new ApplyStop(`${plan.target} is still missing ${report.missing.length} lines after the write.`, 'restore the backup and paste the block by hand.');
    }
    out('Done. Restart Claude Code and Codex so they read the new lines. To undo, copy the backup file back over the settings file.\n');
    return 0;
  } catch (error) {
    if (!(error instanceof ApplyStop)) throw error;
    err(`${error.message}\n`);
    return error.exitCode;
  }
}

module.exports = Object.freeze({ PermissionsApply, ApplyStop, AGENT_MARKERS, CONFIRM, parseApplyArgs, main });
