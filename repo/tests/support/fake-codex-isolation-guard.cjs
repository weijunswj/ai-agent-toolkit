'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isolatedEnv, npmShim } = require('./fake-codex-config.cjs');

// Register in each useFakeConfigReader consumer so its normal CI shard covers both paths.
function configReaderIsolationGuards(test) {
  for (const action of ['runtime detection', 'config check']) {
    test('config reader isolation: unknown ' + action + ' never starts logging PATH Codex', t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-reader-isolation-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const home = path.join(root, 'home');
      fs.mkdirSync(home);
      const configPath = path.join(home, 'config.toml');
      fs.writeFileSync(configPath, '# fixture config\n');
      const marker = path.join(root, 'started.log');
      const reader = require.resolve('./fake-codex-config-reader.cjs');
      const logger = path.join(root, 'logger.cjs');
      const loggingCode = 'require("node:fs").appendFileSync(' + JSON.stringify(marker) + ', "started\\n");\n' + fs.readFileSync(reader, 'utf8');
      fs.writeFileSync(logger, loggingCode);
      const shim = npmShim(root, logger);
      const bin = path.dirname(shim);
      fs.writeFileSync(shim, '@echo off\r\necho cmd-started>>"' + marker + '"\r\n"%_prog%" "%dp0%\\codex.cjs" %*\r\n');
      fs.writeFileSync(path.join(bin, 'codex'), '#!' + process.execPath + '\n' + loggingCode, { mode: 0o755 });
      const invalid = path.join(root, 'unknown.cjs');
      // Runtime reaches the reader's unsupported method, then tries the remaining candidates.
      fs.writeFileSync(invalid, `
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const r = JSON.parse(line);
  if (r.id === undefined) return;
  const error = r.method !== 'initialize';
  process.stdout.write(JSON.stringify({id:r.id,...(error ? {error:{code:-32601,message:'Unknown fixture request'}} : {result:{}})}) + '\\n');
});
`);
      const env = isolatedEnv(home, bin);
      // The initializer must replace both inherited candidates as well as scrub PATH.
      env.CODEX_TOOLKIT_CODEX_CLI = logger;
      env.CODEX_CLI_PATH = logger;
      env.PATHEXT = '.cmd;.exe';
      const modulePath = action === 'runtime detection'
        ? require.resolve('../../scripts/codex-delegation-config.cjs')
        : require.resolve('../../scripts/codex-config-load-check.cjs');
      const missing = path.join(root, 'absent.cjs');
      const operation = action === 'runtime detection'
        ? 'await require(' + JSON.stringify(modulePath) + ').inspectCodexMultiAgentRuntime({codexHome:process.env.CODEX_HOME,codexCommand:' + JSON.stringify(invalid) + ',timeoutMs:500})'
        : 'new (require(' + JSON.stringify(modulePath) + ').CodexConfigLoadCheck)({codexCommand:' + JSON.stringify(missing) + '}).verify({configPath:' + JSON.stringify(configPath) + '})';
      // Simulate an unavailable named fixture for the unknown config check. This must exhaust
      // the real candidate loop, including bare PATH lookup, rather than stop at an error reply.
      const unavailable = action === 'config check'
        ? 'process.env.CODEX_TOOLKIT_CODEX_CLI=' + JSON.stringify(missing) + ';process.env.CODEX_CLI_PATH=' + JSON.stringify(missing) + ';'
        : '';
      const harness = 'require(' + JSON.stringify(reader) + ').useFakeConfigReader();' +
        '(async()=>{const candidates=[process.env.CODEX_TOOLKIT_CODEX_CLI,process.env.CODEX_CLI_PATH];' + unavailable + 'const result=' + operation + ';' +
        'process.env.CODEX_TOOLKIT_CODEX_CLI=candidates[0];process.env.CODEX_CLI_PATH=candidates[1];' +
        'const control=new (require(' + JSON.stringify(require.resolve('../../scripts/codex-config-load-check.cjs')) + ').CodexConfigLoadCheck)().verify({configPath:' + JSON.stringify(configPath) + '});' +
        'console.log(JSON.stringify({result,control,candidates}));})().catch(e=>{console.error(e);process.exitCode=1})';
      const result = spawnSync(process.execPath, ['-e', harness], { env, cwd: home, encoding: 'utf8', timeout: 10000, windowsHide: true });
      assert.equal(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '', '', 'unknown ' + action + ' must not start logging PATH or inherited Codex');
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const answer = JSON.parse(result.stdout);
      if (action === 'runtime detection') assert.equal(answer.result.runtime, 'unknown', answer.result.detail);
      else assert.equal(answer.result.status, 'unverified', answer.result.detail);
      assert.equal(answer.control.status, 'verified', 'the supported config/read control must still answer');
      assert.deepEqual(answer.candidates, [reader, reader], 'both fixture candidates must be named');
    });
  }
}

module.exports = { configReaderIsolationGuards };
