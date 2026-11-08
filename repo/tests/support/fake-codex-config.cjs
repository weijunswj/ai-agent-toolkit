'use strict';

// Isolated app-server/CLI fixture. Orphans keep inherited pipes open for at most 10 seconds;
// stop-fakes.cjs stops only logged processes that have not already recorded their exit.
const fs = require('node:fs');
const path = require('node:path');

function npmShim(root, script) {
  const bin = path.join(root, 'npm & %PATH% (x86) bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(script, path.join(bin, 'codex.cjs'));
  const shim = path.join(bin, 'codex.cmd');
  fs.writeFileSync(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\codex.cjs" %*\r\n');
  return shim;
}

function isolatedEnv(home, bin) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(path|codex_home|codex_cli_path|codex_toolkit_codex_cli|localappdata)$/i.test(key))),
  PATH: bin, CODEX_HOME: home, LOCALAPPDATA: home };
}

if (require.main === module) {
  const { spawn } = require('node:child_process');
  const home = process.env.CODEX_HOME;
  const fixtureHome = process.env.FAKE_CONFIG_HOME || home;
  const spec = JSON.parse(fs.readFileSync(path.join(fixtureHome, 'fake-config.json'), 'utf8'));
  const log = line => fs.appendFileSync(path.join(fixtureHome, 'fake-config.log'), line + '\n');
  process.chdir(path.dirname(process.execPath));
  log(`pid ${process.pid}`);
  process.on('exit', () => log(`exit ${process.pid}`));
  const args = process.argv.slice(2);
  log(`argv ${args.join(' ')}`);
  if (args[0] === 'plugin') {
    process.stdout.write(args[1] === '--help' ? 'Manage Codex plugins\n' : '{"marketplaces":[],"plugins":[]}\n');
  } else {
    if (spec.mode === 'timeout') setTimeout(() => process.exit(0), 15000).unref();
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      log(`method ${request.method}`);
      if (spec.mode === 'exit') { process.stderr.write(spec.stderr || 'unrelated failure', () => process.exit(3)); return; }
      if (spec.mode === 'timeout') return;
      if (request.method === 'initialized') return;
      const initialize = request.method === 'initialize';
      const error = initialize ? spec.initializeError : spec.requestError;
      let result = initialize ? {} : request.method === 'config/read' ? { config: {} }
        : { data: [{ name: 'multi_agent', enabled: true }, { name: 'multi_agent_v2', enabled: false }] };
      if (request.method === 'config/batchWrite') {
        const file = path.join(home, 'config.toml');
        fs.appendFileSync(file, '\n[agents]\nmax_threads = 1\nmax_depth = 1\n');
        result = {};
      }
      const answer = { id: request.id, ...(error ? { error: { message: error } } : spec.mode === 'no-result' && !initialize ? {} : { result }) };
      process.stdout.write(JSON.stringify(answer) + '\n', () => {
        if (!initialize && spec.mode === 'answer-orphan') {
          const keeper = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 10000)'], {
            detached: true, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
          });
          log(`keeper ${keeper.pid}`);
          keeper.unref();
          process.exit(0);
        }
      });
    });
  }
}

module.exports = { npmShim, isolatedEnv };
