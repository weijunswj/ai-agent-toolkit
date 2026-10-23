'use strict';

// The store behind `toolkit env`: Windows Credential Manager generic credentials, target
// ai-agent-toolkit/env/<NAME>, kept on this PC (local-machine persistence), written through the Win32
// credential API from the built-in Windows PowerShell. Toolkit supports Windows computers only, so there
// is no other store and no fallback. Values travel only on stdin and stdout, never in arguments, and no
// store method logs or reports a value. The store's methods: backend, list(), readAll(names), read(name),
// writeAll(entries), remove(name).

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_VALUE_BYTES = 2560;
const STORE_PREFIX = 'ai-agent-toolkit/env';
const NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}$/;
const MAX_NAME_LENGTH = 128;

class EnvStoreError extends Error {
  constructor(message, code = 'store-failed') {
    super(message);
    this.code = code;
  }
}

// <PROVIDER>_<SOLUTION>[_<PROJECT>][_<ENVIRONMENT>]_<PURPOSE>: upper case letters, digits and
// underscores, at least three parts, never CODEX_ (Codex reserves that prefix).
function nameProblem(name) {
  const value = String(name || '');
  if (!value) return 'no key name was given';
  if (value.length > MAX_NAME_LENGTH) return `key names are at most ${MAX_NAME_LENGTH} characters`;
  if (value.startsWith('CODEX_')) return 'names starting with CODEX_ are reserved by Codex';
  if (!NAME_PATTERN.test(value)) return 'key names look like PROVIDER_SOLUTION_PURPOSE: upper case letters, digits and underscores, at least three parts';
  return '';
}

function assertName(name) {
  const problem = nameProblem(name);
  // Text that is not a valid name may be a value typed in the wrong place, so it is never repeated.
  if (problem) throw new EnvStoreError(`That is not a valid key name: ${problem}.`, 'bad-name');
  return name;
}

function assertValue(name, value) {
  if (typeof value !== 'string' || value === '') throw new EnvStoreError(`${name}: the value is empty.`, 'empty-value');
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) throw new EnvStoreError(`${name}: value too long (max ${MAX_VALUE_BYTES} bytes).`, 'value-too-long');
  return value;
}

function sortedNames(names) {
  return [...new Set(names)].sort();
}

// The Win32 credential calls, compiled by the built-in Windows PowerShell on each run. The request
// arrives on stdin as JSON ({ ops: [...] }, values base64) and the answers leave on stdout as JSON.
// The first line limits command lookup to PowerShell's own modules: with a cold module cache (as
// under the few variables Codex passes a header helper), looking up Add-Type otherwise scans every
// module installed on the computer, which took 27 s on a CI host.
const WINDOWS_SCRIPT = String.raw`
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ToolkitEnvCredentials {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredEnumerate(string filter, uint flags, out uint count, out IntPtr credentials);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32.dll", EntryPoint = "CredFree")]
  private static extern void CredFree(IntPtr buffer);
  private const uint GENERIC = 1;
  private const uint LOCAL_MACHINE = 2;
  public static int Write(string target, string user, byte[] value) {
    var credential = new CREDENTIAL();
    credential.Type = GENERIC; credential.TargetName = target; credential.UserName = user;
    credential.Persist = LOCAL_MACHINE; credential.CredentialBlobSize = (uint)value.Length;
    credential.CredentialBlob = Marshal.AllocHGlobal(Math.Max(value.Length, 1));
    try {
      Marshal.Copy(value, 0, credential.CredentialBlob, value.Length);
      return CredWrite(ref credential, 0) ? 0 : Marshal.GetLastWin32Error();
    } finally {
      Marshal.Copy(new byte[Math.Max(value.Length, 1)], 0, credential.CredentialBlob, Math.Max(value.Length, 1));
      Marshal.FreeHGlobal(credential.CredentialBlob);
    }
  }
  public static byte[] Read(string target, out int error) {
    IntPtr pointer;
    if (!CredRead(target, GENERIC, 0, out pointer)) { error = Marshal.GetLastWin32Error(); return null; }
    try {
      var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      var value = new byte[credential.CredentialBlobSize];
      if (value.Length > 0) Marshal.Copy(credential.CredentialBlob, value, 0, value.Length);
      error = 0; return value;
    } finally { CredFree(pointer); }
  }
  public static string[] List(string filter, out int error) {
    uint count; IntPtr pointer;
    if (!CredEnumerate(filter, 0, out count, out pointer)) {
      error = Marshal.GetLastWin32Error();
      return new string[0];
    }
    try {
      var targets = new List<string>();
      for (int index = 0; index < count; index++) {
        var item = Marshal.ReadIntPtr(pointer, index * IntPtr.Size);
        var credential = (CREDENTIAL)Marshal.PtrToStructure(item, typeof(CREDENTIAL));
        if (credential.Type == GENERIC) targets.Add(credential.TargetName);
      }
      error = 0; return targets.ToArray();
    } finally { CredFree(pointer); }
  }
  public static int Delete(string target) {
    return CredDelete(target, GENERIC, 0) ? 0 : Marshal.GetLastWin32Error();
  }
}
'@
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $answers = @()
  foreach ($op in $request.ops) {
    $code = 0
    if ($op.op -eq 'write') {
      $code = [ToolkitEnvCredentials]::Write($op.target, $op.user, [Convert]::FromBase64String($op.value))
      $answers += @{ code = $code }
    } elseif ($op.op -eq 'read') {
      $bytes = [ToolkitEnvCredentials]::Read($op.target, [ref]$code)
      if ($code -eq 0) { $answers += @{ code = 0; value = [Convert]::ToBase64String($bytes) } } else { $answers += @{ code = $code } }
    } elseif ($op.op -eq 'list') {
      $targets = [ToolkitEnvCredentials]::List($op.filter, [ref]$code)
      $answers += @{ code = $code; targets = @($targets) }
    } elseif ($op.op -eq 'delete') {
      $code = [ToolkitEnvCredentials]::Delete($op.target)
      $answers += @{ code = $code }
    } else {
      $answers += @{ code = -1 }
    }
  }
  [Console]::Out.Write((ConvertTo-Json -Compress -Depth 4 -InputObject @{ ok = $true; answers = @($answers) }))
} catch {
  [Console]::Out.Write('{"ok":false}')
  exit 3
}
`;

const WIN32_NOT_FOUND = 1168;
const WIN32_TOO_LONG = 1783;

class WindowsCredentialStore {
  #powershell; #prefix; #user; #spawn; #environment;

  // prefix: the target prefix (tests use their own, never the real one).
  constructor({ prefix = STORE_PREFIX, environment = process.env, spawn = spawnSync } = {}) {
    this.#prefix = prefix;
    this.#user = 'ai-agent-toolkit';
    this.#spawn = spawn;
    this.#environment = environment;
    const root = environment.SystemRoot || environment.SYSTEMROOT || environment.windir || 'C:\\Windows';
    this.#powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }

  get backend() { return 'Windows Credential Manager'; }

  #target(name) { return `${this.#prefix}/${name}`; }

  #run(ops) {
    const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
    const result = this.#spawn(this.#powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      input: JSON.stringify({ ops }),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      env: this.#environment,
    });
    if (result.error && result.error.code === 'ENOENT') {
      throw new EnvStoreError('Windows PowerShell was not found, so Windows Credential Manager cannot be reached.', 'backend-unavailable');
    }
    let parsed = null;
    try { parsed = JSON.parse(String(result.stdout || '').trim()); } catch {}
    if (!parsed || parsed.ok !== true || !Array.isArray(parsed.answers) || parsed.answers.length !== ops.length) {
      throw new EnvStoreError('Windows Credential Manager did not answer.', 'backend-failed');
    }
    return parsed.answers;
  }

  list() {
    const [answer] = this.#run([{ op: 'list', filter: `${this.#prefix}/*` }]);
    if (answer.code !== 0 && answer.code !== WIN32_NOT_FOUND) throw new EnvStoreError(`Windows Credential Manager could not list keys (error ${answer.code}).`, 'backend-failed');
    const start = `${this.#prefix}/`;
    return sortedNames((answer.targets || []).filter((target) => typeof target === 'string' && target.startsWith(start))
      .map((target) => target.slice(start.length)).filter((name) => !nameProblem(name)));
  }

  readAll(names) {
    const wanted = names.map(assertName);
    const values = new Map();
    if (!wanted.length) return values;
    const answers = this.#run(wanted.map((name) => ({ op: 'read', target: this.#target(name) })));
    answers.forEach((answer, index) => {
      if (answer.code === 0) values.set(wanted[index], Buffer.from(answer.value || '', 'base64').toString('utf8'));
      else if (answer.code !== WIN32_NOT_FOUND) throw new EnvStoreError(`Windows Credential Manager could not read ${wanted[index]} (error ${answer.code}).`, 'backend-failed');
    });
    return values;
  }

  read(name) { return this.readAll([name]).get(name); }

  writeAll(entries) {
    const list = [...entries].map(([name, value]) => [assertName(name), assertValue(name, value)]);
    if (!list.length) return;
    const answers = this.#run(list.map(([name, value]) => ({ op: 'write', target: this.#target(name), user: this.#user, value: Buffer.from(value, 'utf8').toString('base64') })));
    answers.forEach((answer, index) => {
      if (answer.code === WIN32_TOO_LONG) throw new EnvStoreError(`${list[index][0]}: value too long (max ${MAX_VALUE_BYTES} bytes).`, 'value-too-long');
      if (answer.code !== 0) throw new EnvStoreError(`Windows Credential Manager could not save ${list[index][0]} (error ${answer.code}).`, 'backend-failed');
    });
  }

  // true when the key existed.
  remove(name) {
    const [answer] = this.#run([{ op: 'delete', target: this.#target(assertName(name)) }]);
    if (answer.code === WIN32_NOT_FOUND) return false;
    if (answer.code !== 0) throw new EnvStoreError(`Windows Credential Manager could not remove ${name} (error ${answer.code}).`, 'backend-failed');
    return true;
  }
}

// The store for this computer: Windows only, with no fallback.
function storeForPlatform(platform = process.platform, options = {}) {
  if (platform === 'win32') return new WindowsCredentialStore(options);
  throw new EnvStoreError(`Toolkit env supports Windows only; this computer runs ${platform}.`, 'backend-unavailable');
}

// The platform store, built on first use, so reading the install check or the manifest never needs a
// key store; available() says whether this computer has one.
class PlatformStore {
  #platform; #options; #store = null;

  constructor({ platform = process.platform, options = {} } = {}) {
    this.#platform = platform;
    this.#options = options;
  }

  available() { return this.#platform === 'win32'; }
  #get() { this.#store ||= storeForPlatform(this.#platform, this.#options); return this.#store; }
  get backend() { return this.#get().backend; }
  list() { return this.#get().list(); }
  readAll(names) { return this.#get().readAll(names); }
  read(name) { return this.#get().read(name); }
  writeAll(entries) { return this.#get().writeAll(entries); }
  remove(name) { return this.#get().remove(name); }
}

// A short reference that ties a printed error to nothing private.
function supportReference() {
  return `ENV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = Object.freeze({
  EnvStoreError,
  PlatformStore,
  MAX_VALUE_BYTES,
  STORE_PREFIX,
  WindowsCredentialStore,
  assertName,
  assertValue,
  nameProblem,
  storeForPlatform,
  supportReference,
});
