'use strict';
// Copied intact to user-state so a removed managed checkout can still report a
// failure. Only its exact enrolled task may disable itself; it never deletes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const MISSING_EXIT = 78;
const MISSING_LINE = 'Toolkit missing: run setup toolkit or remove toolkit';
const DISABLED_DESCRIPTION = 'Disabled: Toolkit removed. Delete this task or re-run setup toolkit.';
// Same file and wire format as the task owner's programme-pass lock. This copy
// must survive removal of Toolkit, so it uses built-ins only. A draft + hard link
// prevents another reader seeing a partial lock. Never displace a live writer.
function registryLock(state) {
  const crypto = require('node:crypto'), file = path.join(state, 'tasks/apply-registry.lock');
  const token = crypto.randomBytes(16).toString('hex'), until = performance.now() + 30000;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify({ schema: 'toolkit.programme-pass-lock.v1', token, pid: process.pid, host: os.hostname(), uptime: os.uptime(), at: new Date().toISOString() });
  const owns = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).token === token; } catch { return false; } };
  do {
    const draft = `${file}.${token}.draft`;
    fs.writeFileSync(draft, bytes, { mode: 0o600 });
    try { fs.linkSync(draft, file); return { release() { if (owns()) fs.unlinkSync(file); } }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { fs.unlinkSync(draft); }
    try {
      const before = fs.readFileSync(file, 'utf8'), held = JSON.parse(before);
      if (held.schema === 'toolkit.programme-pass-lock.v1' && held.host === os.hostname() && Number.isInteger(held.pid) && held.pid > 0) {
        let gone = false;
        try { process.kill(held.pid, 0); } catch (error) { gone = error.code === 'ESRCH'; }
        if (gone) {
          const aside = `${file}.${token}.stale`;
          fs.renameSync(file, aside);
          if (fs.readFileSync(aside, 'utf8') !== before) { if (!fs.existsSync(file)) fs.renameSync(aside, file); throw new Error('Task registry lock changed'); }
          fs.unlinkSync(aside);
          continue;
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  } while (performance.now() < until);
  throw new Error('Task registry busy; self-disable held');
}
class TaskLauncher {
  constructor(deps = {}) { this.deps = deps; }
  run(argv) {
    const deps = this.deps;
    const [root, ...args] = argv, id = args[args.indexOf('--task-id') + 1];
    const home = deps.home || os.homedir(), state = path.join(home, '.ai-agent-toolkit', 'user-state');
    if (!root || !path.isAbsolute(root) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id || '') || !['programme-sweep', 'footer-sweep', 'shard-timings', 'task-health'].includes(args[0])) throw new Error('Invalid task launcher arguments');
    const file = path.join(state, 'tasks', id, 'missing.json');
    const runner = path.join(root, 'repo', 'scripts', 'toolkit-scheduled-job.cjs');
    const write = value => { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 }); fs.renameSync(temp, file); };
    if (fs.existsSync(runner)) {
      write({ misses: 0 });
      const result = (deps.run || spawnSync)(process.execPath, [runner, ...args], { windowsHide: true, stdio: 'inherit' });
      return result.error ? 1 : result.status ?? 1;
    }
    (deps.stderr || (text => process.stderr.write(text)))(MISSING_LINE + '\n');
    let previous;
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const misses = (Number.isSafeInteger(previous?.misses) && previous.misses > 0 ? previous.misses : 0) + 1;
    write({ misses });
    const at = new Date().toISOString(), lastFile = path.join(state, 'tasks', id, 'last-run.json');
    let history = {};
    try { history = JSON.parse(fs.readFileSync(lastFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const receipt = { ...history, schema: 'toolkit.task-last-run.v1', id, job: args[0], started: at, finished: at, status: 'failed', exit: MISSING_EXIT, summary: [MISSING_LINE] };
    delete receipt.reason;
    const lastTemp = `${lastFile}.${process.pid}.tmp`; fs.writeFileSync(lastTemp, JSON.stringify(receipt) + '\n', { mode: 0o600 }); fs.renameSync(lastTemp, lastFile);
    if (misses >= 3) {
      const lock = registryLock(state);
      try {
        const registryFile = path.join(state, 'tasks.json');
        const before = fs.readFileSync(registryFile, 'utf8'), registry = JSON.parse(before);
        const entry = registry.tasks?.find(row => row.id === id && row.host === 'windows' && !row.adopted && !row.stopped_by_owner);
        if (!entry?.enrolled || entry.toolkit_root !== root) return MISSING_EXIT;
        const disable = deps.disable || ((entry) => {
          // Task Scheduler's Set-ScheduledTask changes the definition without deleting
          // it. Compare the exported XML immediately before the write; owner edits win.
          const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p=$env:TK_MISSING | ConvertFrom-Json; $t=Get-ScheduledTask -TaskPath ('\\'+$p.folder+'\\') -TaskName $p.name; if ((Export-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName) -cne $p.xml) { throw 'Task changed; left alone' }; $t.Settings.Enabled=$false; $t.Description=$p.description; Set-ScheduledTask -InputObject $t | Out-Null; $t=Get-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName; if ($t.Settings.Enabled -or $t.Description -cne $p.description) { throw 'Disable readback failed' }; ConvertTo-Json -InputObject @{xml=(Export-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName)} -Compress`;
          if (!entry.enrolled.definition_xml) throw new Error('No exact task XML; self-disable held');
          const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, TK_MISSING: JSON.stringify({ folder: entry.folder, name: entry.name, xml: entry.enrolled.definition_xml, description: DISABLED_DESCRIPTION }) } });
          if (result.error || result.status !== 0) throw new Error('Task self-disable failed; inspect toolkit tasks');
          const readback = JSON.parse(result.stdout);
          if (typeof readback.xml !== 'string' || !readback.xml) throw new Error('Task XML readback failed');
          return readback.xml;
        });
        if (previous?.disabled) return MISSING_EXIT;
        const xml = disable(entry);
        // Retain the exact disabled snapshot for setup's guarded repair. It is not an
        // owner stop. No restore/removal authority is inferred from a missing checkout.
        if (fs.readFileSync(registryFile, 'utf8') !== before) throw new Error('Registry changed during self-disable; inspect task');
        entry.toolkit_missing = true;
        entry.enrolled = { ...entry.enrolled, description: DISABLED_DESCRIPTION, enabled: false, definition_xml: xml,
          ...(entry.enrolled.settings ? { settings: { ...entry.enrolled.settings, enabled: false } } : {}) };
        const temp = `${registryFile}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(registry) + '\n', { mode: 0o600 }); fs.renameSync(temp, registryFile);
        if (fs.readFileSync(registryFile, 'utf8') !== JSON.stringify(registry) + '\n') throw new Error('Registry readback failed');
        write({ misses, disabled: true });
      } finally { lock.release(); }
    }
    return MISSING_EXIT;
}
}
function launch(argv, deps) { return new TaskLauncher(deps).run(argv); }
module.exports = { TaskLauncher, launch, MISSING_EXIT, MISSING_LINE, DISABLED_DESCRIPTION };
if (require.main === module) {
  try { process.exitCode = launch(process.argv.slice(2)); }
  catch { process.stderr.write('Task launcher failed; inspect toolkit tasks.\n'); process.exitCode = 1; }
}
