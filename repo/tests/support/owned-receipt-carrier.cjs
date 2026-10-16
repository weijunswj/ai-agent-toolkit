'use strict';

// Task-owned test fixture roots shared by the receipt, authority and lifecycle tests.
// A root supplied through its environment key (plus TOOLKIT_TEST_INVOCATION_ID and
// TOOLKIT_TEST_OWNER_PID) is verified but never created, repaired or removed; this is
// how a spawned successor process joins its parent's fixture. Without one, a fresh
// root owned by this process is provisioned, bound by an ownership marker, published
// to the environment for child processes, and removed only by its own creator.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const MARKER = 'toolkit-fixture-owner.json';
const SCHEMA = 'toolkit.test-fixture-ownership.v1';

class TaskOwnedFixtureRoot {
  #envKey;
  #parent;
  #prefix;
  #repositoryRoot;
  #guard;
  #root = null;
  #provisioned = false;

  constructor({ envKey, parent, prefix, repositoryRoot, guard = () => {} }) {
    if (!/^TOOLKIT_[A-Z0-9_]+$/.test(envKey || '')) throw new Error('TASK_OWNED_ROOT_ENV_KEY_REQUIRED');
    if (!path.isAbsolute(parent || '')) throw new Error('TASK_OWNED_ROOT_PARENT_REQUIRED');
    if (!path.isAbsolute(repositoryRoot || '')) throw new Error('TASK_OWNED_ROOT_REPOSITORY_ROOT_REQUIRED');
    if (typeof guard !== 'function') throw new Error('TASK_OWNED_ROOT_GUARD_REQUIRED');
    this.#envKey = envKey;
    this.#parent = parent;
    this.#prefix = prefix;
    this.#repositoryRoot = path.resolve(repositoryRoot);
    this.#guard = guard;
  }

  get provisioned() { return this.#provisioned; }

  // Returns the verified root, provisioning a task-owned one at most once.
  root() {
    if (this.#root) return this.#root;
    const supplied = process.env[this.#envKey];
    this.#root = supplied ? this.#verifySupplied(supplied) : this.#provision();
    return this.#root;
  }

  // Removes only a root this instance created and whose marker still binds it.
  release() {
    if (!this.#provisioned || !this.#root) return false;
    const marker = TaskOwnedFixtureRoot.readMarker(this.#root);
    if (!marker || marker.owner_pid !== process.pid || marker.root !== this.#root) return false;
    fs.rmSync(this.#root, { recursive: true, force: true });
    if (process.env[this.#envKey] === this.#root) delete process.env[this.#envKey];
    this.#root = null;
    this.#provisioned = false;
    return true;
  }

  static readMarker(root) {
    try { return JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8')); } catch { return null; }
  }

  static #invocation() {
    if (!process.env.TOOLKIT_TEST_INVOCATION_ID) {
      process.env.TOOLKIT_TEST_INVOCATION_ID = `owned-${crypto.randomUUID()}`;
      process.env.TOOLKIT_TEST_OWNER_PID = String(process.pid);
    }
    return { invocation: process.env.TOOLKIT_TEST_INVOCATION_ID, ownerPid: Number(process.env.TOOLKIT_TEST_OWNER_PID) };
  }

  #verifySupplied(supplied) {
    const invocation = process.env.TOOLKIT_TEST_INVOCATION_ID;
    const ownerPid = Number(process.env.TOOLKIT_TEST_OWNER_PID);
    if (!path.isAbsolute(supplied) || !invocation || !Number.isSafeInteger(ownerPid) || ownerPid < 1) {
      throw new Error('OWNED_RECEIPT_FIXTURE_CARRIER_REQUIRED');
    }
    const root = path.resolve(supplied);
    this.#guard(root);
    const marker = TaskOwnedFixtureRoot.readMarker(root);
    if (!marker || marker.schema !== SCHEMA || marker.invocation_id !== invocation
      || marker.owner_pid !== ownerPid || marker.root !== root || marker.env_key !== this.#envKey
      || marker.repository_root !== this.#repositoryRoot) {
      throw new Error('OWNED_RECEIPT_FIXTURE_CARRIER_MISMATCH');
    }
    return root;
  }

  #provision() {
    const { invocation, ownerPid } = TaskOwnedFixtureRoot.#invocation();
    if (ownerPid !== process.pid) throw new Error('TASK_OWNED_ROOT_FOREIGN_INVOCATION');
    fs.mkdirSync(this.#parent, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(this.#parent, 0o700);
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(this.#parent, this.#prefix)));
    if (process.platform === 'win32') TaskOwnedFixtureRoot.restrictWindowsAcl(root);
    else fs.chmodSync(root, 0o700);
    const marker = {
      schema: SCHEMA, invocation_id: invocation, owner_pid: process.pid, root, env_key: this.#envKey,
      repository_root: this.#repositoryRoot, created_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(root, MARKER), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    this.#guard(root);
    process.env[this.#envKey] = root;
    this.#provisioned = true;
    process.once('exit', () => { try { this.release(); } catch { /* best-effort exit cleanup of an owned fixture */ } });
    return root;
  }

  // Restrict a newly created, task-owned directory to the current user, SYSTEM and
  // Administrators. Never applied to a supplied or pre-existing directory.
  static restrictWindowsAcl(root) {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = [
      '$ErrorActionPreference="Stop"',
      '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      '$icacls=Join-Path $env:SystemRoot "System32\\icacls.exe"',
      '& $icacls $env:GPR_TEST_ROOT "/inheritance:r" "/grant:r" ("*${sid}:(OI)(CI)F") "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null',
      'if ($LASTEXITCODE -ne 0) { throw "icacls-failed" }',
    ].join(';');
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, GPR_TEST_ROOT: root },
    });
    if (result.status !== 0) throw new Error(`TASK_OWNED_ROOT_ACL_FAILED: ${result.stderr}`);
  }
}

// Receipt-store carrier: must sit under the production state anchor, outside temp.
class OwnedReceiptCarrier {
  #root;
  constructor({ repositoryRoot, guard }) {
    if (typeof guard !== 'function') throw new Error('OWNED_RECEIPT_CARRIER_GUARD_REQUIRED');
    this.#root = new TaskOwnedFixtureRoot({
      envKey: 'TOOLKIT_RECEIPT_TEST_CARRIER', prefix: 'carrier-', repositoryRoot, guard,
      parent: path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'github-program-receipt', 'tests'),
    });
  }
  carrier() { return this.#root.root(); }
  release() { return this.#root.release(); }
}

// Lifecycle Git/filesystem fixture root: a disposable directory under the OS temp root.
function lifecycleFixtureRoot(repositoryRoot) {
  return new TaskOwnedFixtureRoot({
    envKey: 'TOOLKIT_LIFECYCLE_FIXTURE_ROOT', prefix: 'toolkit-lifecycle-', repositoryRoot,
    parent: fs.realpathSync.native(os.tmpdir()),
  });
}

module.exports = { TaskOwnedFixtureRoot, OwnedReceiptCarrier, lifecycleFixtureRoot, MARKER, SCHEMA };
