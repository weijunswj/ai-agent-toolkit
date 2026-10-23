'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Never print config/read's result or arbitrary stderr: both can contain private values.
function screenedHostError(error) {
  const message = String(error?.message || error || '');
  const limit = message.match(/(?:agents|features\.multi_agent_v2)\.max_concurrent_threads_per_session must be at least 1/);
  if (limit) return limit[0];
  const variant = message.match(/unknown variant [`'"](?:api)[`'"]/);
  if (variant) return variant[0];
  if (/TOML|toml|parse|deserialize/i.test(message)) return 'Codex reported a configuration parse error (private details omitted).';
  return 'Codex could not read the effective configuration (private details omitted).';
}

// Synchronous callers share the existing bounded async app-server client through a small
// Node subprocess. Only a verdict leaves that subprocess, never effective configuration.
const UNVERIFIED = 'Codex config check: not verified, because Codex could not be started or did not answer in time.';
const CONFIG_REFUSAL = /config\/read failed|must be at least 1|unknown variant|unknown field|invalid type|missing field|TOML|toml|parse error|deserializ/;

class CodexConfigLoadCheck {
  #options;
  constructor(options = {}) { this.#options = options; }

  probe(configPath) {
    if (this.#options.probe) return this.#options.probe(configPath);
    const result = spawnSync(process.execPath, [__filename, '--probe', path.dirname(configPath), this.#options.codexCommand || ''], {
      env: this.#options.environment || process.env,
      cwd: path.dirname(configPath), encoding: 'utf8', windowsHide: true, timeout: 45000,
      maxBuffer: 16384,
    });
    // A check that did not finish proves nothing either way: say so and keep the write.
    if (result.error || result.status !== 0) return { status: 'unverified', detail: UNVERIFIED };
    try {
      const verdict = JSON.parse(result.stdout);
      if (!['verified', 'unverified', 'rejected'].includes(verdict.status)) throw new Error();
      return verdict;
    } catch { return { status: 'unverified', detail: UNVERIFIED }; }
  }

  verify({ configPath, snapshot, backupPath, replacementBytes }) {
    const verdict = this.probe(configPath);
    if (verdict.status !== 'rejected') return verdict;
    const { captureCodexConfigSnapshot, assertSnapshotCurrent, writeRegularFileAtomically } = require('./codex-delegation-backup.cjs');
    try {
      const current = captureCodexConfigSnapshot(configPath);
      if (replacementBytes === null ? current.existed : !current.existed || !current.bytes.equals(Buffer.from(replacementBytes))) {
        throw new Error('config.toml changed again after setup wrote it; the concurrent edit was kept.');
      }
      if (snapshot.existed) {
        const bytes = fs.readFileSync(backupPath);
        if (!bytes.equals(snapshot.bytes)) throw new Error('The backup failed integrity verification.');
        writeRegularFileAtomically(configPath, bytes, snapshot.mode, { expectedSnapshot: current });
        if (!fs.readFileSync(configPath).equals(bytes)) throw new Error('Restored bytes did not match the backup.');
      } else {
        assertSnapshotCurrent(configPath, current);
        if (current.existed) fs.unlinkSync(configPath);
        if (fs.existsSync(configPath)) throw new Error('The setup-created file could not be removed.');
      }
    } catch (error) {
      const failure = new Error(`Codex rejected config.toml: ${screenedHostError(verdict.detail)} Automatic rollback failed: ${error.message} Backup: ${backupPath || 'previously absent file'}.`);
      failure.code = 'CODEX_CONFIG_ROLLBACK_FAILED';
      throw failure;
    }
    const failure = new Error(`Codex rejected config.toml: ${screenedHostError(verdict.detail)} ${snapshot.existed ? 'The previous file was restored exactly.' : 'The setup-created file was removed; config.toml was previously absent.'} Backup: ${backupPath || 'previously absent file'}.`);
    failure.code = 'CODEX_CONFIG_LOAD_FAILED';
    failure.configRestored = true;
    throw failure;
  }
}

function probeErrorVerdict(error) {
  return CONFIG_REFUSAL.test(String(error?.message || error || '')) ? { status: 'rejected', detail: screenedHostError(error) } : { status: 'unverified', detail: UNVERIFIED };
}

async function probeAppServer(codexHome, explicit) {
  const { appServerCandidates, runAppServerRequest } = require('./codex-app-server.cjs');
  for (const command of appServerCandidates(explicit, codexHome)) {
    try {
      const result = await runAppServerRequest(command, codexHome, {
        method: 'config/read', params: { includeLayers: false },
      }, { cwd: codexHome, timeoutMs: 20000, closeTimeoutMs: 1000, forceExitTimeoutMs: 1000 });
      if (!result || typeof result.config !== 'object' || result.config === null) {
        return { status: 'unverified', detail: UNVERIFIED };
      }
      return { status: 'verified', detail: 'Codex config check: Codex loaded config.toml.' };
    } catch (error) {
      // Try another resolved command only when this executable does not exist.
      if (error.code === 'ENOENT') continue;
      if (['EACCES', 'EPERM', 'ENOEXEC'].includes(error.code)) return { status: 'unverified', detail: UNVERIFIED };
      // Only Codex refusing the file is a rejection; a slow start or stuck shutdown proves nothing.
      // Rejected means Codex refused the file: a config/read error reply, or a start-up error that
      // names a configuration problem. Anything else (a slow start, an initialize failure, an
      // unrelated exit) proves nothing, so the write stays and the check says it is not verified.
      return probeErrorVerdict(error);
    }
  }
  return { status: 'unverified', detail: UNVERIFIED };
}

if (require.main === module && process.argv[2] === '--probe') {
  probeAppServer(process.argv[3], process.argv[4]).then(
    result => process.stdout.write(JSON.stringify(result)),
    () => process.stdout.write(JSON.stringify({ status: 'rejected', detail: 'Codex configuration load check failed.' })),
  );
}

module.exports = { CodexConfigLoadCheck, probeErrorVerdict, screenedHostError };
