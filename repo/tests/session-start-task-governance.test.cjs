'use strict';

// Runtime companion to the unchanged setup-intent graph test. Actual host entry processes must
// deliver the task line without loading the scheduler, programme CLI or interactive setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const support = require('./toolkit-governed-fixture-support.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const pack = require('../scripts/toolkit-hook-pack.cjs');
const ROOT = path.resolve(__dirname, '../..');
const LINE = 'Toolkit tasks: recorded Windows tasks do not match confirmed governance. Read fresh governance status, then run toolkit-windows-tasks.cjs plan --repo-root <repo> from the managed Toolkit checkout. Apply only when existing approval covers that plan; otherwise ask the owner. Preserve owner stops and held keep answers.';

test('both SessionStart entries retain advisory context with runtime load denials across all start sources', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-load-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), work = path.join(dir, 'work'), plugin = path.join(dir, 'plugin');
  fs.mkdirSync(home, { recursive: true });
  support.makeGoverned(work, 'advisory-load', { home, enable: false });
  support.recordMerged(work, { home, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'toolkit-test-fixture/advisory-load', governance: 'disabled' }) });
  tasks.writeRegistry(home, [{ id: 'fixture-p', job: 'programme-sweep', host: 'windows', folder: 'FIXTURE', name: 'PROGRAMME SWEEP',
    repository: 'toolkit-test-fixture/advisory-load', purpose: 'fixture', schedule: 'hourly', created: new Date().toISOString(), created_by: 'fixture', model: null, effort: null }]);
  for (const rel of ['repo/scripts/toolkit-codex-session-start.ps1', 'repo/scripts/toolkit-codex-session-start.cjs']) {
    const dest = path.join(plugin, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  fs.mkdirSync(path.join(plugin, '.codex-plugin'));
  fs.writeFileSync(path.join(plugin, '.codex-plugin/session-start-runtime.json'), JSON.stringify({ schema: 1, node_path: process.execPath }));
  const denied = path.join(dir,'denied.txt'), preload = path.join(dir,'preload.cjs');
  fs.writeFileSync(preload, `
const Module = require('node:module'), fs = require('node:fs'), path = require('node:path');
const load = Module._load;
Module._load = function(request, parent, main) {
  const name = path.basename(request);
  if (/^(?:toolkit-windows-tasks|programme|setup-toolkit(?:-core)?)\\.cjs$/.test(name)) {
    fs.appendFileSync(${JSON.stringify(denied)}, name + '\\n'); throw new Error('forbidden runtime load');
  }
  // Optional bridge maintenance is outside this load-boundary test. The full pack runs it.
  if (name === 'toolkit-local-bridge.cjs') return { run: () => ({ status: 0 }) };
  if (name === 'toolkit-governance-gate.cjs') {
    const gate = load.call(this, ${JSON.stringify(path.join(ROOT,'repo/scripts/toolkit-governance-gate.cjs'))}, parent, main);
    return { ...gate, sessionLine: (cwd, opts) => gate.sessionLine(cwd, { ...opts, programmeDeps: { environment: {}, ...(process.platform === 'win32' ? {} : { platform: 'win32' }) } }) };
  }
  return load.call(this,request,parent,main);
};
`);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TOOLKIT_GOVERNANCE_OFFLINE: '1', NODE_OPTIONS: `--require="${preload.replace(/\\/g, '/')}"` };
  for (const host of ['claude','codex']) for (const source of ['startup','resume','clear','compact']) {
    const input = JSON.stringify({ cwd: work, session_id: `load-${host}-${source}`, source });
    const windowsLauncher = host === 'codex' && process.platform === 'win32';
    const file = windowsLauncher ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : process.execPath;
    const args = windowsLauncher ? ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(plugin,'repo/scripts/toolkit-codex-session-start.ps1')]
      : host === 'claude' ? [path.join(ROOT,'repo/scripts/toolkit-governance-hook.cjs'),'--event','SessionStart']
        : [path.join(plugin,'repo/scripts/toolkit-codex-session-start.cjs'),'--hook','--sync-enabled','--write','--sync-source','codex-plugin'];
    const result = spawnSync(file,args,{ input, env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, `${host}/${source}: ${result.stderr}`);
    const context = pack.hookContext(host,'SessionStart',result);
    assert.equal(context.split(LINE).length, 2, `${host}/${source}: ${context}`);
    assert.match(context, /Toolkit governance: DISABLED for this repository/);
    assert.equal(fs.existsSync(denied), false, 'no forbidden module was even attempted');
  }
});
