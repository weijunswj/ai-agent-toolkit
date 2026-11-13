'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
function snapshotTree(root) {
  const entries = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      entries.push([path.relative(root, file), item.isDirectory() ? null : fs.readFileSync(file).toString('base64')]);
      if (item.isDirectory()) visit(file);
    }
  };
  visit(root);
  return entries;
}

// Split by complete test declarations to keep the per-file time budget.
test('restoration accepts only its dedicated forms before invoking the handler, for owners and agents', async (t) => {
  const delegation = require('../scripts/codex-delegation-config.cjs');
  const flag = delegation.RESTORE_FLAG;
  const metadata = path.join(tmpRoot(), 'backup metadata.json');
  const handler = t.mock.method(delegation, 'restoreCodexDelegationBackup', () => ({ status: 'restored' }));
  t.mock.method(console, 'log', () => {});
  const dedicated = [[flag, metadata], [`${flag}=${metadata}`]];
  const mixed = [
    ...['--plan', '--explain', '--explain=1.1', '--execute', '--help', '-h', '--json', '--extra', 'extra', flag, `${flag}=${metadata}`]
      .flatMap(extra => dedicated.flatMap(form => [[extra, ...form], [...form, extra]])),
    [flag], [flag, ''], [`${flag}=`], [flag, '--plan'], [flag, '--help'], [flag, '-h'],
  ];
  for (const environment of [{}, { CODEX_THREAD_ID: 'synthetic-agent' }, { CLAUDECODE: '1' }]) {
    for (const argv of mixed) {
      const before = handler.mock.callCount();
      await assert.rejects(core.main(argv, { environment }), /runs on its own|requires a backup metadata path/, argv.join(' '));
      assert.equal(handler.mock.callCount(), before, 'refuse before the recovery handler');
    }
    for (const argv of dedicated) {
      const before = handler.mock.callCount();
      assert.equal(await core.main(argv, { environment }), 0);
      assert.equal(handler.mock.callCount(), before + 1);
      assert.deepEqual(handler.mock.calls.at(-1).arguments, [metadata]);
    }
  }
});

for (const host of ['codex', 'claude-code']) {
  for (const mode of [['--plan'], ['--plan', '--json'], ['--explain', '1.1']]) {
    for (const state of ['missing', 'current', 'legacy', 'malformed', 'unreadable']) {
      test(`${host} ${mode.join(' ')} with ${state} nested state is observational even with write choices`, () => {
        const root = tmpRoot();
        const env = isolatedHomeEnv(root);
        const config = require('../scripts/codex-delegation-config.cjs');
        const files = {
          '.codex/config.toml': state === 'legacy'
            ? `[agents]\n${config.CODEX_DELEGATION_BEGIN}\nmax_threads = 2\nmax_depth = 1\n${config.CODEX_DELEGATION_END}\n`
            : `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}\n`,
          '.claude/settings.json': JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_DEPTH: '1' } }),
          [`.ai-agent-toolkit/agent-control/profiles/${host}.json`]: JSON.stringify({ schema: 1, host,
            topology: state === 'legacy' ? 'retired' : 'broader-native', capacity_mode: 'root-only', manual_maximum: 0,
            worker_estimate_bytes: 1024, queue_limit: 4, reservation_limit: 4, updated_at: '2026-01-01T00:00:00Z' }),
          '.ai-agent-toolkit/current/state.json': JSON.stringify({ schema_version: 1, architecture_version: 2,
            auto_sync_enabled: true, repo_auto_update_enabled: true, update_report_enabled: true,
            update_report_open_enabled: state === 'legacy',
            ...(state === 'legacy' ? { targets: { retired: { enabled: true } } } : {}) }),
          '.ai-agent-toolkit/current/manifest.json': JSON.stringify({ schema_version: 1, assets: [] }),
          // An older Toolkit's per-app answer: planning reads nothing from it and leaves it alone.
          [`.ai-agent-toolkit/user-state/task-auto-merge.${host}.v1.json`]: JSON.stringify({ schema: 'toolkit.task-auto-merge-preferences.v1', host, value: 'after-gates' }),
        };
        if (state !== 'missing') {
          for (const [rel, text] of Object.entries(files)) writeFile(path.join(root, rel), state === 'malformed' ? '{ malformed' : text);
          writeFile(path.join(root, '.ai-agent-toolkit', 'agent-control', 'backups', 'existing.json'), 'existing backup\n');
        }
        // Exercise real readers, with permission errors injected rather than Windows ACL changes.
        // Only the existing read-only audit, isolated TOML parser and local git inspection may launch.
        const preload = path.join(root, 'plan-guard.cjs');
        writeFile(preload, `
          const fs = require('node:fs');
          const cp = require('node:child_process');
          const path = require('node:path');
          const denied = new Set(${JSON.stringify(Object.keys(files).map(rel => path.join(root, rel)))});
          const read = fs.readFileSync;
          fs.readFileSync = function(file, ...args) {
            if (${state === 'unreadable'} && denied.has(String(file))) throw Object.assign(new Error('synthetic unreadable state'), { code: 'EACCES' });
            return read.call(this, file, ...args);
          };
          for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync', 'copyFileSync', 'chmodSync']) {
            fs[name] = () => { throw new Error('planning attempted a filesystem mutation: ' + name); };
          }
          const spawnSync = cp.spawnSync;
          cp.spawnSync = function(command, args, ...rest) {
            const audit = command === process.execPath && path.basename(args[0] || '') === 'toolkit-local-bridge.cjs' && args.includes('--audit');
            const localGit = /^(git|git.exe)$/i.test(path.basename(command)) && ['rev-parse', 'branch', 'remote', 'status', 'log'].includes(args[0]) && !args.includes('fetch');
            const toml = ['py', 'python3', 'python', process.env.AI_AGENT_TOOLKIT_PYTHON].includes(command)
              && JSON.stringify(args.slice(0, -1)) === JSON.stringify(command === 'py' ? ['-3', '-I', '-c'] : ['-I', '-c'])
              && args.at(-1).includes('tomllib');
            if (!audit && !localGit && !toml) throw new Error('planning attempted an unexpected process: ' + command);
            return spawnSync.call(this, command, args, ...rest);
          };
          cp.spawn = cp.exec = cp.execSync = cp.execFile = cp.execFileSync = () => { throw new Error('planning attempted a host session or task'); };
          for (const name of ['node:net', 'node:tls', 'node:http', 'node:https']) {
            const api = require(name);
            for (const key of ['connect', 'createConnection', 'request', 'get']) if (api[key]) api[key] = () => { throw new Error('planning attempted network'); };
          }
        `);
        const before = snapshotTree(root);
        const quotedPreload = preload.replace(/[\\"]/g, (char) => `\\${char}`);
        const result = run([...mode, '--host', host, '--yes-recommended',
          '--enable-repo-auto-update', '--enable-codex-plugin-auto-refresh', '--claude-settings', 'enable'], {
          env: { ...env, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${quotedPreload}"`].filter(Boolean).join(' ') },
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.doesNotMatch(result.stdout + result.stderr, /planning attempted/);
        assert.deepEqual(snapshotTree(root), before, 'existing bytes and every newly created path');
      });
    }
  }
}

test('drive, spaced, UNC and file URL values remain non-concise in a fresh parser process', () => {
  const specs = specsForAudit(auditFixture());
  for (const value of [
    'C:\\Toolkit Source',
    'C:\\Toolkit Source With Spaces',
    '\\\\server\\share\\Toolkit Source',
    'file:///C:/Toolkit%20Source',
  ]) {
    const parsed = parseConciseInFreshProcess(specs, value);
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.equal(parsed.stdout, 'accepted');
  }
});
