#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  EXPECTED_TOOLKIT_VERSION,
  pluginId,
  findInstalledPluginEntries,
  inspectCodexConfiguredPluginState,
  inspectCodexToolkitConfigurationProof,
  inspectCodexToolkitInstalledState,
  inspectCodexPluginList,
  verifyInstalledCacheFreshness,
  cacheFingerprint,
  recoverCodexCache,
  validateRepoPluginSource
} = require('./setup-codex-toolkit-plugin.cjs');
const {
  planN8nSkillsPluginRepair,
  reconcileN8nSkillsPlugin
} = require('./repair-codex-plugin-windows-hooks.cjs');
const {
  auditOwnedStaging,
  lookupExactOwnedGeneration,
  planOwnedGenerationCleanup,
  planOwnedStagingGeneration,
  plannedStateMarker,
  reconcileOwnedStaging
} = require('./toolkit-staging-generations.cjs');

const ARCHITECTURE_VERSION = 2;
const BRIDGE_VERSION = '2.13.0';
const STATE_SCHEMA_VERSION = 1;
const TOOLKIT_NAME = 'ai-agent-toolkit';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const SYNC_SOURCES = ['repo', 'codex-plugin', 'claude-plugin'];
const LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const TARGET_MANIFEST_FILE = '.ai-agent-toolkit-managed.json';
const TARGET_MANIFEST_MARKER = 'ai-agent-toolkit-local-bridge';
const AG2_PROOF_CONTRACT_VERSION = 'toolkit.local-bridge.ag2-skills-projection-proof.v1';
const INVOCATION_AUTHORITY_CONTRACT = 'toolkit.local-bridge.invocation-authority.v1';
const DELEGATED_AUTHORITY_CONTRACT = 'toolkit.local-bridge.delegated-invocation-authority.v1';
const VERIFIED_SOURCE_RECEIPT_CONTRACT = 'toolkit.local-bridge.verified-source-receipt.v1';
const RECEIPT_CHILD_CAPSULE_CONTRACT = 'toolkit.local-bridge.receipt-backed-child-capsule.v1';
const VERIFIED_SOURCE_CHECKPOINTS = Object.freeze([
  'repository-verification',
  'post-verification',
  'refresh-relock',
  'envelope-construction',
  'pre-launch',
  'child-start'
]);
const BRIDGE_ENTRY_RELATIVE_PATH = 'repo/scripts/toolkit-local-bridge.cjs';
const REPORT_CREATE_ATTEMPTS = 20;
const phaseContextState = new WeakMap();
const verifiedSourcePrivate = new WeakMap();
const RECEIPT_CHILD_BOOTSTRAP = String.raw`'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const canonical=(v)=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map((k)=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=(v)=>crypto.createHash('sha256').update(v).digest('hex');
let wrapper;
try{wrapper=JSON.parse(fs.readFileSync(0,'utf8'));}catch(error){throw new Error('receipt-backed child capsule is not valid JSON');}
if(!wrapper||wrapper.contract!=='toolkit.local-bridge.receipt-backed-child-capsule.v1')throw new Error('receipt-backed child capsule has the wrong contract');
const root=path.resolve(wrapper.stage_root);
const manifest=wrapper.receipt&&wrapper.receipt.source_manifest;
if(!Array.isArray(manifest)||hash(canonical(manifest))!==wrapper.receipt.source_manifest_digest)throw new Error('receipt-backed child source manifest digest mismatch');
const buffers=new Map();
for(const item of manifest){
  const file=path.resolve(root,item.relative_path);
  const rel=path.relative(root,file);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('receipt-backed child source path escaped staging');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('receipt-backed child source entry is not an ordinary file');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==item.byte_length||hash(bytes)!==item.sha256)throw new Error('receipt-backed child staged bytes mismatch: '+item.relative_path);
  buffers.set(file,bytes);
}
const entry=path.resolve(root,wrapper.receipt.entry.relative_path);
const entryBytes=buffers.get(entry);
if(!entryBytes||hash(entryBytes)!==wrapper.receipt.entry.sha256)throw new Error('receipt-backed child entry digest mismatch');
const handshake={
  receipt_id:wrapper.receipt.receipt_id,
  commit:wrapper.receipt.commit,
  tree:wrapper.receipt.tree,
  entry_digest:wrapper.receipt.entry.sha256,
  source_manifest_digest:wrapper.receipt.source_manifest_digest
};
if(canonical(handshake)!==canonical(wrapper.delegated_authority.verified_source))throw new Error('receipt-backed child handshake mismatch');
process.stderr.write('__TOOLKIT_RECEIPT_HANDSHAKE__='+hash(canonical(handshake))+'\n');
globalThis.__TOOLKIT_DELEGATED_AUTHORITY_JSON=JSON.stringify(wrapper.delegated_authority);
globalThis.__TOOLKIT_VERIFIED_SOURCE_HANDSHAKE=Object.freeze({...handshake});
globalThis.__TOOLKIT_VERIFIED_SOURCE_STAGE_ROOT=root;
const originalResolve=Module._resolveFilename;
const originalJs=Module._extensions['.js'];
const originalJson=Module._extensions['.json'];
const isLocalRequest=(request)=>typeof request==='string'&&(/^\.{1,2}[\\/]/.test(request)||path.posix.isAbsolute(request)||path.win32.isAbsolute(request));
const localPattern=/require\(\s*['"]([^'"]+)['"]\s*\)/g;
for(const [filename,bytes] of buffers){
  if(!/\.(?:c?js)$/i.test(filename))continue;
  const parent=new Module(filename,null);parent.filename=filename;parent.paths=Module._nodeModulePaths(path.dirname(filename));
  const source=bytes.toString('utf8');
  let match;
  while((match=localPattern.exec(source))){
    const request=match[1];
    if(!isLocalRequest(request))continue;
    let resolved;
    try{resolved=path.resolve(originalResolve.call(Module,request,parent,false));}
    catch(error){throw new Error('receipt-backed child rejected executable relative load outside manifest: '+request);}
    if(!buffers.has(resolved))throw new Error('receipt-backed child rejected executable relative load outside manifest: '+resolved);
  }
}
Module._resolveFilename=function(request,parent,isMain,options){
  const local=isLocalRequest(request);
  let resolved;
  try{resolved=originalResolve.call(this,request,parent,isMain,options);}
  catch(error){if(local)throw new Error('receipt-backed child rejected executable relative load outside manifest: '+request);throw error;}
  if(local){
    const exact=path.resolve(resolved);
    const expected=exact;
    if(!buffers.has(expected)){
      throw new Error('receipt-backed child rejected executable relative load outside manifest: '+resolved);
    }
    try{
      const stat=fs.lstatSync(expected);
      if(!stat.isFile()||stat.isSymbolicLink()||!fs.readFileSync(expected).equals(buffers.get(expected)))throw new Error('changed');
    }catch(error){throw new Error('receipt-backed child rejected changed local resolution target: '+expected);}
    return expected;
  }
  return resolved;
};
const compile=(module,filename)=>{const bytes=buffers.get(path.resolve(filename));if(!bytes)throw new Error('receipt-backed child rejected unverified module');module._compile(bytes.toString('utf8'),filename);};
Module._extensions['.js']=function(module,filename){if(buffers.has(path.resolve(filename)))return compile(module,filename);return originalJs(module,filename);};
Module._extensions['.cjs']=Module._extensions['.js'];
Module._extensions['.json']=function(module,filename){const bytes=buffers.get(path.resolve(filename));if(bytes){module.exports=JSON.parse(bytes.toString('utf8'));return;}return originalJson(module,filename);};
process.argv=[process.execPath,entry,...wrapper.argv];
const main=new Module(entry,null);main.filename=entry;main.paths=Module._nodeModulePaths(path.dirname(entry));process.mainModule=main;main._compile(entryBytes.toString('utf8'),entry);`;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPDATE_REPORT_ROOT = path.join('ai-agent-toolkit', 'update-reports');
const DEFAULT_UPDATE_REPORT_RETENTION_DAYS = 7;
const DEFAULT_UPDATE_REPORT_MAX_FILES = 200;
const FULL_VALIDATION_TEST = path.join('repo', 'tests', 'toolkit-local-bridge.test.cjs');
const HOOK_LIGHT_VALIDATION_TEST = path.join('repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs');
const VALIDATE_TOOLKIT_TIMEOUT_MS = 120000;
const HOOK_LIGHT_VALIDATION_TIMEOUT_MS = 30000;
const NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT = 5;
const THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT = 5;
const GIT_CREDENTIAL_HELPERS = ['manager', 'manager-core'];
const AGENT_RULES_TEMPLATE_DIR = path.join('skills', 'repository-agent-rules', 'repo-local');
const AGENT_RULES_PREFLIGHT_MAX_FINDINGS = 8;
const AGENT_RULES_PREFLIGHT_FILES = {
  'codex-plugin': [
    { target: 'AGENTS.md', template: 'AGENTS.managed.template.md' }
  ],
  'claude-plugin': [
    { target: 'AGENTS.md', template: 'AGENTS.managed.template.md' },
    { target: 'CLAUDE.md', template: 'CLAUDE.shim.template.md' }
  ]
};
const RECONCILIATION_ALLOWED_FLAGS = new Set([
  '--reconcile-staging',
  '--write',
  '--hub',
  '--sync-source',
  '--force-downgrade',
  '--opencode-config-dir',
  '--opencode-target'
]);

function slash(value) {
  return value.split(path.sep).join('/');
}

function timestamp() {
  return new Date().toISOString();
}

function reportTimestampSgt(value) {
  const date = new Date(value || timestamp());
  if (Number.isNaN(date.getTime())) return `${value} (SGT unavailable)`;
  const sgt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (number) => String(number).padStart(2, '0');
  return [
    sgt.getUTCFullYear(),
    '-',
    pad(sgt.getUTCMonth() + 1),
    '-',
    pad(sgt.getUTCDate()),
    ' ',
    pad(sgt.getUTCHours()),
    ':',
    pad(sgt.getUTCMinutes()),
    ':',
    pad(sgt.getUTCSeconds()),
    ' SGT'
  ].join('');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ag2SkillsProjectionProof(input = {}) {
  const discovery = input.discovery && typeof input.discovery === 'object' ? input.discovery : {};
  const contradictory = discovery.plugin_authority === true || discovery.skills_only === false;
  const supported = discovery.supported === true
    && discovery.destination_kind === 'supported-skills-directory'
    && discovery.skills_only === true
    && discovery.plugin_authority === false
    && typeof discovery.target_path === 'string'
    && discovery.target_path.length > 0;
  if (contradictory) {
    return Object.freeze({
      contract_version: AG2_PROOF_CONTRACT_VERSION,
      status: 'CONTRADICTORY',
      destination_kind: 'unknown',
      skills_only: true,
      plugin_authority: false,
      discovery_authority: 'unavailable',
      reason_code: 'AG2_DISCOVERY_CONTRADICTORY'
    });
  }
  if (!supported) {
    return Object.freeze({
      contract_version: AG2_PROOF_CONTRACT_VERSION,
      status: 'AG2_PROOF_UNAVAILABLE',
      destination_kind: 'unknown',
      skills_only: true,
      plugin_authority: false,
      discovery_authority: 'unavailable',
      reason_code: 'AG2_PROOF_UNAVAILABLE'
    });
  }
  return Object.freeze({
    contract_version: AG2_PROOF_CONTRACT_VERSION,
    status: 'PROVEN',
    destination_kind: 'supported-skills-directory',
    skills_only: true,
    plugin_authority: false,
    discovery_authority: 'supported-read-only-evidence',
    reason_code: 'AG2_SKILLS_DESTINATION_PROVEN'
  });
}

function parseListValue(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    argv,
    write: false,
    preferenceOnly: false,
    audit: false,
    hook: false,
    syncEnabled: false,
    forceDowngrade: false,
    enableTargets: [],
    disableTargets: [],
    scopedSyncTargets: [],
    parentScopeDigest: '',
    delegatedAuthority: false,
    enableAutoSync: false,
    disableAutoSync: false,
    enableRepoAutoUpdate: false,
    disableRepoAutoUpdate: false,
    repoPath: '',
    repoBranch: '',
    repoRemote: '',
    repoUpdateNow: false,
    skipRepoAutoUpdate: false,
    openUpdateReport: false,
    enableUpdateReports: false,
    disableUpdateReports: false,
    updateReportRetentionDays: 0,
    updateReportRetentionDaysExplicit: false,
    enableUpdateReportOpen: false,
    disableUpdateReportOpen: false,
    enableCodexPluginAutoRefresh: false,
    disableCodexPluginAutoRefresh: false,
    suppressUpdateReport: false,
    reconcileStaging: '',
    syncSource: 'repo',
    hub: '',
    opencodeConfigDir: '',
    opencodeTarget: '',
    opencodeCommand: 'opencode',
    pythonCommand: '',
    setAg2PythonCommand: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--write') args.write = true;
    else if (arg === '--preference-only') args.preferenceOnly = true;
    else if (arg === '--audit') args.audit = true;
    else if (arg === '--hook') args.hook = true;
    else if (arg === '--sync-enabled') args.syncEnabled = true;
    else if (arg === '--force-downgrade') args.forceDowngrade = true;
    else if (arg === '--enable-auto-sync') args.enableAutoSync = true;
    else if (arg === '--disable-auto-sync') args.disableAutoSync = true;
    else if (arg === '--enable-repo-auto-update') args.enableRepoAutoUpdate = true;
    else if (arg === '--disable-repo-auto-update') args.disableRepoAutoUpdate = true;
    else if (arg === '--repo-path') args.repoPath = next();
    else if (arg.startsWith('--repo-path=')) args.repoPath = arg.slice('--repo-path='.length);
    else if (arg === '--repo-branch') args.repoBranch = next();
    else if (arg.startsWith('--repo-branch=')) args.repoBranch = arg.slice('--repo-branch='.length);
    else if (arg === '--repo-remote') args.repoRemote = next();
    else if (arg.startsWith('--repo-remote=')) args.repoRemote = arg.slice('--repo-remote='.length);
    else if (arg === '--repo-update-now') args.repoUpdateNow = true;
    else if (arg === '--skip-repo-auto-update') args.skipRepoAutoUpdate = true;
    else if (arg === '--open-update-report') args.openUpdateReport = true;
    else if (arg === '--enable-update-reports') args.enableUpdateReports = true;
    else if (arg === '--disable-update-reports') args.disableUpdateReports = true;
    else if (arg === '--update-report-retention-days') {
      args.updateReportRetentionDays = Number(next());
      args.updateReportRetentionDaysExplicit = true;
    }
    else if (arg.startsWith('--update-report-retention-days=')) {
      args.updateReportRetentionDays = Number(arg.slice('--update-report-retention-days='.length));
      args.updateReportRetentionDaysExplicit = true;
    }
    else if (arg === '--enable-update-report-open') args.enableUpdateReportOpen = true;
    else if (arg === '--disable-update-report-open') args.disableUpdateReportOpen = true;
    else if (arg === '--enable-codex-plugin-auto-refresh') args.enableCodexPluginAutoRefresh = true;
    else if (arg === '--disable-codex-plugin-auto-refresh') args.disableCodexPluginAutoRefresh = true;
    else if (arg === '--suppress-update-report') args.suppressUpdateReport = true;
    else if (arg === '--reconcile-staging') args.reconcileStaging = next();
    else if (arg.startsWith('--reconcile-staging=')) args.reconcileStaging = arg.slice('--reconcile-staging='.length);
    else if (arg === '--enable-target') args.enableTargets.push(...parseListValue(next()));
    else if (arg.startsWith('--enable-target=')) args.enableTargets.push(...parseListValue(arg.slice('--enable-target='.length)));
    else if (arg === '--disable-target') args.disableTargets.push(...parseListValue(next()));
    else if (arg.startsWith('--disable-target=')) args.disableTargets.push(...parseListValue(arg.slice('--disable-target='.length)));
    else if (arg === '--scope-target-sync') args.scopedSyncTargets.push(...parseListValue(next()));
    else if (arg.startsWith('--scope-target-sync=')) args.scopedSyncTargets.push(...parseListValue(arg.slice('--scope-target-sync='.length)));
    else if (arg === '--parent-scope-digest') args.parentScopeDigest = next();
    else if (arg.startsWith('--parent-scope-digest=')) args.parentScopeDigest = arg.slice('--parent-scope-digest='.length);
    else if (arg === '--delegated-invocation-authority') args.delegatedAuthority = true;
    else if (arg === '--hub') args.hub = next();
    else if (arg.startsWith('--hub=')) args.hub = arg.slice('--hub='.length);
    else if (arg === '--sync-source') args.syncSource = next();
    else if (arg.startsWith('--sync-source=')) args.syncSource = arg.slice('--sync-source='.length);
    else if (arg === '--opencode-config-dir') args.opencodeConfigDir = next();
    else if (arg.startsWith('--opencode-config-dir=')) args.opencodeConfigDir = arg.slice('--opencode-config-dir='.length);
    else if (arg === '--opencode-target') args.opencodeTarget = next();
    else if (arg.startsWith('--opencode-target=')) args.opencodeTarget = arg.slice('--opencode-target='.length);
    else if (arg === '--opencode-command') args.opencodeCommand = next();
    else if (arg.startsWith('--opencode-command=')) args.opencodeCommand = arg.slice('--opencode-command='.length);
    else if (arg === '--python-command') args.pythonCommand = next();
    else if (arg.startsWith('--python-command=')) args.pythonCommand = arg.slice('--python-command='.length);
    else if (arg === '--set-ag2-python-command') args.setAg2PythonCommand = next();
    else if (arg.startsWith('--set-ag2-python-command=')) args.setAg2PythonCommand = arg.slice('--set-ag2-python-command='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const target of [...args.enableTargets, ...args.disableTargets, ...args.scopedSyncTargets]) {
    if (!SUPPORTED_TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  }
  args.enableTargets = [...new Set(args.enableTargets)];
  args.disableTargets = [...new Set(args.disableTargets)];
  args.scopedSyncTargets = [...new Set(args.scopedSyncTargets)];
  const contradictoryTargets = args.enableTargets.filter((target) => args.disableTargets.includes(target));
  if (contradictoryTargets.length) {
    throw new Error(`Targets cannot be enabled and disabled in one invocation: ${contradictoryTargets.join(', ')}`);
  }
  if (args.parentScopeDigest && !/^[0-9a-f]{64}$/i.test(args.parentScopeDigest)) {
    throw new Error('--parent-scope-digest requires one SHA-256 digest');
  }
  if (args.write && (args.parentScopeDigest || args.scopedSyncTargets.length)) {
    throw new Error('write-mode --parent-scope-digest and --scope-target-sync are retired; delegated writes require --delegated-invocation-authority with the fixed payload on stdin');
  }
  if (!SYNC_SOURCES.includes(args.syncSource)) {
    throw new Error(`--sync-source must be repo, codex-plugin, or claude-plugin: ${args.syncSource}`);
  }
  if (args.enableAutoSync && args.disableAutoSync) {
    throw new Error('--enable-auto-sync and --disable-auto-sync cannot be used together');
  }
  if (args.enableRepoAutoUpdate && args.disableRepoAutoUpdate) {
    throw new Error('--enable-repo-auto-update and --disable-repo-auto-update cannot be used together');
  }
  if (args.enableUpdateReportOpen && args.disableUpdateReportOpen) {
    throw new Error('--enable-update-report-open and --disable-update-report-open cannot be used together');
  }
  if (args.enableUpdateReports && args.disableUpdateReports) {
    throw new Error('--enable-update-reports and --disable-update-reports cannot be used together');
  }
  if (args.updateReportRetentionDays && !args.updateReportRetentionDaysExplicit) args.updateReportRetentionDaysExplicit = true;
  if (args.updateReportRetentionDaysExplicit && (!Number.isInteger(args.updateReportRetentionDays) || args.updateReportRetentionDays <= 0)) {
    throw new Error('--update-report-retention-days requires a positive integer');
  }
  if (args.enableCodexPluginAutoRefresh && args.disableCodexPluginAutoRefresh) {
    throw new Error('--enable-codex-plugin-auto-refresh and --disable-codex-plugin-auto-refresh cannot be used together');
  }
  if (args.reconcileStaging && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.reconcileStaging)) {
    throw new Error('--reconcile-staging requires one exact generation ID from a prior audit');
  }
  return args;
}

function assertReconciliationCommandArgs(args) {
  if (!args.reconcileStaging) return;
  const incompatible = [...new Set(args.argv
    .filter((value) => String(value).startsWith('--'))
    .map((value) => String(value).split('=')[0])
    .filter((flag) => !RECONCILIATION_ALLOWED_FLAGS.has(flag)))];
  if (incompatible.length) {
    throw new Error(`--reconcile-staging cannot be combined with: ${incompatible.join(', ')}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function detachedFrozen(value) {
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function gitBuffer(repoPath, gitArgs, options = {}) {
  const result = spawnSync('git', gitArgs, {
    cwd: repoPath,
    encoding: null,
    timeout: options.timeout || 30000,
    windowsHide: true,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ''),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || ''),
    error: result.error ? result.error.message : ''
  };
}

function requireGitText(repoPath, gitArgs, label) {
  const result = gitBuffer(repoPath, gitArgs);
  if (!result.ok) {
    const detail = `${result.stderr.toString('utf8')}${result.error}`.trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8').trim();
}

function canonicalRepositoryIdentity(remote) {
  const normalized = normalizeRemoteForCompare(remote);
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  return {
    owner: match ? match[1].toLowerCase() : '',
    name: match ? match[2].toLowerCase() : '',
    kind: match ? 'github' : 'local-filesystem',
    normalized_remote: normalized
  };
}

function resolveExecutablePath(command) {
  if (path.isAbsolute(command)) return path.resolve(command);
  const locator = process.platform === 'win32'
    ? spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe'), [command], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    : spawnSync('/usr/bin/which', [command], { encoding: 'utf8', timeout: 5000 });
  if (locator.status !== 0) throw new Error(`could not resolve executable identity: ${command}`);
  const candidate = String(locator.stdout || '').split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  if (!candidate) throw new Error(`could not resolve executable identity: ${command}`);
  return path.resolve(candidate);
}

function executableIdentity(command, versionArgs) {
  const executablePath = resolveExecutablePath(command);
  const stat = fs.lstatSync(executablePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`verified executable is not an ordinary file: ${executablePath}`);
  const versionResult = spawnSync(executablePath, versionArgs, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (versionResult.status !== 0) throw new Error(`could not verify executable version: ${executablePath}`);
  return deepFreeze({
    path: executablePath,
    version: `${versionResult.stdout || ''}${versionResult.stderr || ''}`.trim(),
    sha256: sha256(fs.readFileSync(executablePath))
  });
}

function resolveLocalRequire(fromFile, request) {
  if (!request.startsWith('.')) return '';
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, `${base}.cjs`, `${base}.js`, `${base}.json`, path.join(base, 'index.cjs'), path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      if (fs.lstatSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`verified source closure cannot resolve local require ${request} from ${fromFile}`);
}

function sourceClosurePaths(repoPath, entryRelativePath = BRIDGE_ENTRY_RELATIVE_PATH) {
  const root = path.resolve(repoPath);
  const pending = [path.resolve(root, entryRelativePath)];
  const visited = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (visited.has(current)) continue;
    if (!isInside(root, current)) throw new Error('verified source closure escaped the repository root');
    visited.add(current);
    if (path.extname(current).toLowerCase() === '.json') continue;
    const source = fs.readFileSync(current, 'utf8');
    const pattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let match;
    while ((match = pattern.exec(source))) {
      const resolved = resolveLocalRequire(current, match[1]);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return [...visited].map((filePath) => slash(path.relative(root, filePath))).sort();
}

function gitTreeEntry(repoPath, commit, relativePath) {
  const line = requireGitText(repoPath, ['ls-tree', commit, '--', relativePath], `read Git tree entry for ${relativePath}`);
  const match = line.match(/^(\d{6})\s+\w+\s+([0-9a-f]{40,64})\t(.+)$/);
  if (!match || slash(match[3]) !== slash(relativePath)) throw new Error(`verified source is not tracked at ${relativePath}`);
  return { mode: match[1], blob: match[2] };
}

function gitObjectBytes(repoPath, commit, relativePath) {
  const result = gitBuffer(repoPath, ['show', `${commit}:${slash(relativePath)}`]);
  if (!result.ok) throw new Error(`could not read verified Git object bytes for ${relativePath}`);
  return result.stdout;
}

function createVerifiedSourceReceipt({ repoPath, branch, remote, validation }) {
  const root = path.resolve(repoPath);
  const commit = requireGitText(root, ['rev-parse', 'HEAD'], 'read verified source commit');
  const tree = requireGitText(root, ['rev-parse', 'HEAD^{tree}'], 'read verified source tree');
  const actualBranch = requireGitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 'read verified source branch');
  const actualRemote = requireGitText(root, ['remote', 'get-url', 'origin'], 'read verified source remote');
  const dirty = requireGitText(root, ['status', '--porcelain'], 'verify clean source worktree');
  if (dirty) throw new Error('verified source worktree changed before receipt creation');
  if (actualBranch !== branch) throw new Error('verified source branch changed before receipt creation');
  if (normalizeRemoteForCompare(actualRemote) !== normalizeRemoteForCompare(remote)) throw new Error('verified source remote changed before receipt creation');
  const repository = canonicalRepositoryIdentity(actualRemote);
  if (repository.kind === 'github' && (repository.owner !== 'weijunswj' || repository.name !== 'ai-agent-toolkit')) {
    throw new Error('verified source repository identity is not weijunswj/ai-agent-toolkit');
  }
  if (repository.kind === 'local-filesystem' && !path.isAbsolute(actualRemote)) throw new Error('verified source repository remote identity is unsupported');
  const versionPath = path.join(root, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json');
  const packageVersion = JSON.parse(fs.readFileSync(versionPath, 'utf8')).version;
  if (packageVersion !== BRIDGE_VERSION) throw new Error(`verified source package version mismatch: ${packageVersion} != ${BRIDGE_VERSION}`);
  const relativePaths = sourceClosurePaths(root);
  const buffers = new Map();
  const manifest = relativePaths.map((relativePath) => {
    const workingBytes = fs.readFileSync(path.join(root, relativePath));
    const objectBytes = gitObjectBytes(root, commit, relativePath);
    if (!workingBytes.equals(objectBytes)) throw new Error(`verified source bytes differ from Git object: ${relativePath}`);
    const entry = gitTreeEntry(root, commit, relativePath);
    buffers.set(relativePath, Buffer.from(objectBytes));
    return {
      relative_path: relativePath,
      git_mode: entry.mode,
      git_blob: entry.blob,
      byte_length: objectBytes.length,
      sha256: sha256(objectBytes)
    };
  });
  const manifestDigest = sha256(canonicalJson(manifest));
  const entry = manifest.find((item) => item.relative_path === BRIDGE_ENTRY_RELATIVE_PATH);
  if (!entry) throw new Error('verified source closure omitted the Bridge entry');
  const nativeSetupRelativePath = 'repo/scripts/setup-codex-toolkit-plugin.cjs';
  let nativeSetupEntry = null;
  let nativeSetupBytes = null;
  const nativeSetupPath = path.join(root, nativeSetupRelativePath);
  if (fs.existsSync(nativeSetupPath)) {
    const stat = fs.lstatSync(nativeSetupPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('verified native setup source is not an ordinary file');
    const workingBytes = fs.readFileSync(nativeSetupPath);
    const objectBytes = gitObjectBytes(root, commit, nativeSetupRelativePath);
    if (!workingBytes.equals(objectBytes)) throw new Error(`verified source bytes differ from Git object: ${nativeSetupRelativePath}`);
    const nativeEntry = gitTreeEntry(root, commit, nativeSetupRelativePath);
    nativeSetupBytes = Buffer.from(objectBytes);
    nativeSetupEntry = {
      relative_path: nativeSetupRelativePath,
      git_mode: nativeEntry.mode,
      git_blob: nativeEntry.blob,
      byte_length: objectBytes.length,
      sha256: sha256(objectBytes)
    };
  }
  const nativeCacheFingerprint = nativeSetupEntry ? cacheFingerprint(root, root, {
    normalizeWindowsSessionStart: process.platform === 'win32'
  }) : '';
  if (nativeSetupEntry && !/^[a-f0-9]{64}$/.test(nativeCacheFingerprint)) throw new Error('verified native setup source fingerprint is invalid');
  const node = executableIdentity(process.execPath, ['--version']);
  const git = executableIdentity('git', ['--version']);
  const base = {
    contract: VERIFIED_SOURCE_RECEIPT_CONTRACT,
    repository: { owner: repository.owner, name: repository.name, kind: repository.kind, root },
    remote: { name: 'origin', identity: repository.normalized_remote },
    ref: { branch, semantics: 'exact-clean-branch-head' },
    commit,
    tree,
    clean_worktree: true,
    package_version: packageVersion,
    platform: process.platform,
    arch: process.arch,
    executables: { node, git },
    entry: { relative_path: entry.relative_path, git_blob: entry.git_blob, byte_length: entry.byte_length, sha256: entry.sha256 },
    native_setup: nativeSetupEntry ? {
      entry_relative_path: nativeSetupEntry.relative_path,
      entry_git_blob: nativeSetupEntry.git_blob,
      entry_byte_length: nativeSetupEntry.byte_length,
      entry_sha256: nativeSetupEntry.sha256,
      cache_fingerprint: nativeCacheFingerprint
    } : null,
    source_manifest: manifest,
    source_manifest_digest: manifestDigest,
    validation: detachedFrozen(validation || { status: 'passed', commands: [] }),
    continuity_checkpoints: VERIFIED_SOURCE_CHECKPOINTS
  };
  const receiptId = sha256(canonicalJson(base));
  const receipt = deepFreeze({ ...base, receipt_id: receiptId });
  verifiedSourcePrivate.set(receipt, {
    buffers,
    nativeSetupBytes,
    observations: new Map([['repository-verification', timestamp()]])
  });
  return receipt;
}

function verifySourceReceiptContinuity(receipt, checkpoint) {
  if (!receipt || receipt.contract !== VERIFIED_SOURCE_RECEIPT_CONTRACT || !VERIFIED_SOURCE_CHECKPOINTS.includes(checkpoint)) {
    throw new Error('verified source continuity check received an invalid receipt or checkpoint');
  }
  const privateState = verifiedSourcePrivate.get(receipt);
  if (!privateState) throw new Error('verified source receipt has no immutable source capsule');
  const root = receipt.repository.root;
  if (requireGitText(root, ['rev-parse', 'HEAD'], 'recheck source commit') !== receipt.commit) throw new Error(`verified source continuity failed at ${checkpoint}: commit changed`);
  if (requireGitText(root, ['rev-parse', 'HEAD^{tree}'], 'recheck source tree') !== receipt.tree) throw new Error(`verified source continuity failed at ${checkpoint}: tree changed`);
  if (requireGitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 'recheck source branch') !== receipt.ref.branch) throw new Error(`verified source continuity failed at ${checkpoint}: branch changed`);
  const remote = requireGitText(root, ['remote', 'get-url', receipt.remote.name], 'recheck source remote');
  if (normalizeRemoteForCompare(remote) !== receipt.remote.identity) throw new Error(`verified source continuity failed at ${checkpoint}: remote changed`);
  if (requireGitText(root, ['status', '--porcelain'], 'recheck source worktree')) throw new Error(`verified source continuity failed at ${checkpoint}: worktree changed`);
  for (const item of receipt.source_manifest) {
    const bytes = fs.readFileSync(path.join(root, item.relative_path));
    const admitted = privateState.buffers.get(item.relative_path);
    if (!admitted || !bytes.equals(admitted) || sha256(bytes) !== item.sha256) {
      throw new Error(`verified source continuity failed at ${checkpoint}: ${item.relative_path} changed`);
    }
  }
  if (receipt.native_setup) {
    const nativeSetupPath = path.join(root, receipt.native_setup.entry_relative_path);
    const nativeStat = fs.lstatSync(nativeSetupPath);
    const nativeBytes = fs.readFileSync(nativeSetupPath);
    if (!nativeStat.isFile() || nativeStat.isSymbolicLink() || !privateState.nativeSetupBytes
      || !nativeBytes.equals(privateState.nativeSetupBytes) || sha256(nativeBytes) !== receipt.native_setup.entry_sha256) {
      throw new Error(`verified source continuity failed at ${checkpoint}: native setup source changed`);
    }
    const nativeFingerprint = cacheFingerprint(root, root, {
      normalizeWindowsSessionStart: process.platform === 'win32'
    });
    if (nativeFingerprint !== receipt.native_setup.cache_fingerprint) {
      throw new Error(`verified source continuity failed at ${checkpoint}: native setup source closure changed`);
    }
  }
  privateState.observations.set(checkpoint, timestamp());
  return deepFreeze({ receipt_id: receipt.receipt_id, checkpoint, status: 'passed' });
}

function verifiedSourceEvidence(receipt) {
  const state = verifiedSourcePrivate.get(receipt);
  return detachedFrozen({
    ...receipt,
    observed_checkpoints: VERIFIED_SOURCE_CHECKPOINTS.filter((name) => state?.observations.has(name)).map((name) => ({ name, status: 'passed' }))
  });
}

function admitReceiptBackedEffect({ args, receipt, checkpoint, expectedState, kind, operands }) {
  const phase = validatePhaseContext(args.phaseContext);
  const hook = args.testHooks?.beforeReceiptBackedEffectAdmission;
  if (hook) hook(detachedFrozen({ kind, checkpoint, operands }));
  assertActualMutationInput(args, 'delegated.child.launch', {
    details: {
      path: path.join(receipt.repository.root, BRIDGE_ENTRY_RELATIVE_PATH),
      cwd: receipt.repository.root,
      arguments: ['-e', RECEIPT_CHILD_BOOTSTRAP]
    }
  });
  revalidateBeforeFirstMutation(args);
  validatePhaseContext(args.phaseContext);
  const receiptState = verifiedSourcePrivate.get(receipt);
  if (!receiptState?.observations.has(checkpoint)) verifySourceReceiptContinuity(receipt, checkpoint);
  const currentRawState = readJsonIfExists(path.join(args.executionAuthority.bindings.hub, 'state.json'));
  const expectedBinding = authorityStateBinding(expectedState, args.executionAuthority);
  const actualBinding = authorityStateBinding(currentRawState, args.executionAuthority);
  if (canonicalJson(actualBinding) !== canonicalJson(expectedBinding)) {
    throw new Error(`receipt-backed effect admission rejected durable-state drift: ${kind}`);
  }
  phase.firstMutation = true;
  return detachedFrozen({ kind, operands });
}

function createReceiptSourceStage({ args, receipt, expectedState }) {
  const privateState = verifiedSourcePrivate.get(receipt);
  if (!privateState) throw new Error('verified source receipt has no immutable source capsule');
  const parent = path.dirname(args.executionAuthority.bindings.hub);
  const stageRoot = path.join(parent, `.verified-source-${receipt.receipt_id.slice(0, 20)}-${crypto.randomUUID()}`);
  const created = [];
  try {
    admitReceiptBackedEffect({
    args,
    receipt,
    checkpoint: 'envelope-construction',
    expectedState,
    kind: 'createOwnedGenerationEntry',
    operands: { path: stageRoot, type: 'directory' }
  });
    fs.mkdirSync(stageRoot);
    created.push({ path: stageRoot, type: 'directory', identity: filesystemIdentity(stageRoot, 'directory') });
    const directorySet = new Set();
    for (const item of receipt.source_manifest) {
      let relativeDirectory = slash(path.dirname(item.relative_path));
      while (relativeDirectory && relativeDirectory !== '.') {
        directorySet.add(relativeDirectory);
        const parent = slash(path.dirname(relativeDirectory));
        if (parent === relativeDirectory) break;
        relativeDirectory = parent;
      }
    }
    const directoryPaths = [...directorySet]
      .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
    for (const relativePath of directoryPaths) {
      const target = path.join(stageRoot, relativePath);
      admitReceiptBackedEffect({
        args,
        receipt,
        checkpoint: 'envelope-construction',
        expectedState,
        kind: 'createOwnedGenerationEntry',
        operands: { path: target, type: 'directory' }
      });
      fs.mkdirSync(target);
      created.push({ path: target, type: 'directory', identity: filesystemIdentity(target, 'directory') });
    }
    for (const item of receipt.source_manifest) {
      const target = path.join(stageRoot, item.relative_path);
      const bytes = privateState.buffers.get(item.relative_path);
      if (!bytes || sha256(bytes) !== item.sha256) throw new Error(`immutable source capsule entry is unavailable: ${item.relative_path}`);
      admitReceiptBackedEffect({
        args,
        receipt,
        checkpoint: 'envelope-construction',
        expectedState,
        kind: 'writeTargetManagedFile',
        operands: { path: target, byte_length: bytes.length, sha256: item.sha256 }
      });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      const readback = fs.readFileSync(target);
      if (!readback.equals(bytes)) throw new Error(`receipt-backed staged write readback failed: ${item.relative_path}`);
      created.push({ path: target, type: 'file', identity: filesystemIdentity(target, 'file') });
    }
    return { stageRoot, created };
  } catch (error) {
    try {
      removeReceiptSourceStage({ args, receipt, expectedState, stage: { stageRoot, created } });
    } catch (cleanupError) {
      error.message = `${error.message}; verified source stage cleanup failed: ${cleanupError.message}`;
    }
    throw error;
  }
}

function removeReceiptSourceStage({ args, receipt, expectedState, stage }) {
  const ordered = [...stage.created].sort((left, right) => {
    const leftDepth = left.path.split(path.sep).length;
    const rightDepth = right.path.split(path.sep).length;
    return rightDepth - leftDepth || right.path.localeCompare(left.path);
  });
  for (const entry of ordered) {
    const current = filesystemIdentity(entry.path, entry.type);
    if (!current || canonicalJson(current) !== canonicalJson(entry.identity)) {
      throw new Error(`receipt-backed source cleanup rejected identity drift: ${entry.path}`);
    }
    admitReceiptBackedEffect({
      args,
      receipt,
      checkpoint: 'pre-launch',
      expectedState,
      kind: 'removeOwnedGenerationEntry',
      operands: { path: entry.path, type: entry.type, identity: current }
    });
    if (entry.type === 'file') fs.rmSync(entry.path, { force: false });
    else fs.rmdirSync(entry.path);
  }
}

function launchVerifiedDelegatedChild({ args, receipt, expectedState, delegatedAuthority }) {
  const stage = createReceiptSourceStage({ args, receipt, expectedState });
  if (args.testHooks?.afterReceiptSourceStage) args.testHooks.afterReceiptSourceStage(detachedFrozen({ stageRoot: stage.stageRoot }));
  const wrapper = {
    contract: RECEIPT_CHILD_CAPSULE_CONTRACT,
    stage_root: stage.stageRoot,
    argv: [
      '--write', '--sync-source', 'repo', '--hub', args.executionAuthority.bindings.hub,
      '--skip-repo-auto-update', '--suppress-update-report', '--delegated-invocation-authority', '--audit'
    ],
    receipt: verifiedSourceEvidence(receipt),
    delegated_authority: delegatedAuthority
  };
  const input = `${JSON.stringify(wrapper)}\n`;
  const command = process.execPath;
  const commandArgs = ['-e', RECEIPT_CHILD_BOOTSTRAP];
  const cwd = receipt.repository.root;
  const environment = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, String(value)]));
  assertActualMutationInput(args, 'delegated.child.launch', {
    details: {
      path: path.join(receipt.repository.root, BRIDGE_ENTRY_RELATIVE_PATH),
      cwd,
      arguments: commandArgs,
      payload: delegatedAuthority,
      verifiedCommit: receipt.commit,
      verifiedSourceIdentity: receipt.entry.sha256
    }
  });
  admitReceiptBackedEffect({
    args,
    receipt,
    checkpoint: 'pre-launch',
    expectedState,
    kind: 'launchVerifiedDelegatedChild',
    operands: {
      executable: command,
      executable_sha256: receipt.executables.node.sha256,
      argv_digest: sha256(canonicalJson(commandArgs)),
      cwd,
      env_digest: sha256(canonicalJson(environment)),
      input_digest: sha256(input)
    }
  });
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: environment,
    input,
    maxBuffer: 16 * 1024 * 1024
  });
  const expectedHandshakeDigest = sha256(canonicalJson(delegatedAuthority.verified_source));
  const handshakeLine = `__TOOLKIT_RECEIPT_HANDSHAKE__=${expectedHandshakeDigest}`;
  const rawStderr = String(result.stderr || '');
  const childHandshakeConfirmed = rawStderr.split(/\r?\n/).includes(handshakeLine);
  if (childHandshakeConfirmed) verifiedSourcePrivate.get(receipt).observations.set('child-start', timestamp());
  let cleanupError = null;
  try {
    removeReceiptSourceStage({ args, receipt, expectedState, stage });
  } catch (error) {
    cleanupError = error;
  }
  const evidence = detachedFrozen({
    action: 'launchVerifiedDelegatedChild',
    receipt_id: receipt.receipt_id,
    commit: receipt.commit,
    tree: receipt.tree,
    entry_digest: receipt.entry.sha256,
    source_manifest_digest: receipt.source_manifest_digest,
    executable_sha256: receipt.executables.node.sha256,
    argv_digest: sha256(canonicalJson(commandArgs)),
    cwd,
    env_digest: sha256(canonicalJson(environment)),
    input_digest: sha256(input),
    exit_status: result.status,
    child_start_handshake: childHandshakeConfirmed ? 'verified' : 'missing',
    cleanup: cleanupError ? 'preserved' : 'removed'
  });
  if (cleanupError) {
    cleanupError.message = `${cleanupError.message}; verified source stage preserved at ${stage.stageRoot}`;
    throw cleanupError;
  }
  return { result: {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: rawStderr.split(/\r?\n/).filter((line) => line !== handshakeLine).join('\n'),
    error: result.error ? result.error.message : ''
  }, evidence };
}

function requestedPreferenceFields(args) {
  const fields = [];
  if (args.enableAutoSync || args.disableAutoSync) fields.push('auto_sync_enabled');
  if (args.enableRepoAutoUpdate || args.disableRepoAutoUpdate) {
    fields.push('repo_auto_update_enabled', 'last_repo_update_status', 'last_repo_update_error');
  }
  if (args.repoPath) fields.push('repo_path');
  if (args.repoBranch) fields.push('repo_branch');
  if (args.repoRemote) fields.push('repo_remote');
  if (args.enableUpdateReports || args.disableUpdateReports) fields.push('update_report_enabled');
  if (args.updateReportRetentionDaysExplicit) fields.push('update_report_retention_days');
  if (args.enableUpdateReportOpen || args.disableUpdateReportOpen) {
    fields.push('update_report_open_enabled', 'update_report_open_behavior', 'legacy_update_report_open_migrated');
  }
  if (args.enableCodexPluginAutoRefresh || args.disableCodexPluginAutoRefresh) fields.push('codex_plugin_auto_refresh_enabled');
  return [...new Set(fields)].sort();
}

function readDelegatedAuthority(args, testHooks = {}) {
  if (!args.delegatedAuthority) return null;
  const raw = testHooks.delegatedEnvelopeRaw !== undefined
    ? String(testHooks.delegatedEnvelopeRaw)
    : (globalThis.__TOOLKIT_DELEGATED_AUTHORITY_JSON || fs.readFileSync(0, 'utf8'));
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new Error(`delegated authority payload is not valid JSON: ${error.message}`);
  }
  if (
    testHooks.delegatedEnvelopeRaw !== undefined &&
    envelope?.child?.script_path &&
    !envelope.verified_source
  ) {
    const syntheticTree = requireGitText(envelope.child.source_repository, ['rev-parse', 'HEAD^{tree}'], 'read synthetic delegated fixture tree');
    const entryIdentity = envelope.child.source_identity;
    const syntheticManifest = [{
      relative_path: BRIDGE_ENTRY_RELATIVE_PATH,
      git_mode: '100644',
      git_blob: requireGitText(envelope.child.source_repository, ['rev-parse', `${envelope.child.source_commit}:${BRIDGE_ENTRY_RELATIVE_PATH}`], 'read synthetic delegated fixture blob'),
      byte_length: fs.readFileSync(envelope.child.script_path).length,
      sha256: entryIdentity
    }];
    const manifestDigest = sha256(canonicalJson(syntheticManifest));
    const receiptId = sha256(canonicalJson({ commit: envelope.child.source_commit, tree: syntheticTree, entryIdentity, manifestDigest }));
    envelope = {
      ...envelope,
      repository_result: { ...envelope.repository_result, tree: syntheticTree },
      child: {
        entry_relative_path: BRIDGE_ENTRY_RELATIVE_PATH,
        source_identity: entryIdentity,
        source_repository: envelope.child.source_repository,
        source_commit: envelope.child.source_commit,
        source_tree: syntheticTree,
        source_manifest_digest: manifestDigest,
        receipt_id: receiptId
      },
      verified_source: {
        receipt_id: receiptId,
        commit: envelope.child.source_commit,
        tree: syntheticTree,
        entry_digest: entryIdentity,
        source_manifest_digest: manifestDigest
      }
    };
    args.syntheticDelegatedFixture = true;
  }
  if (!envelope || envelope.contract !== DELEGATED_AUTHORITY_CONTRACT) throw new Error('delegated authority payload has the wrong contract');
  const keys = Object.keys(envelope).sort();
  const expectedKeys = ['actions', 'child', 'contract', 'destinations', 'hub', 'parent_invocation_id', 'repository_result', 'verified_source'].sort();
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)) throw new Error('delegated authority payload has unexpected fields');
  if (!envelope.actions || Object.keys(envelope.actions).some((key) => key !== 'targets')) throw new Error('delegated authority payload has invalid actions');
  if (canonicalJson(Object.keys(envelope.destinations || {}).sort()) !== canonicalJson(['targets'])) throw new Error('delegated authority payload has invalid destinations');
  if (canonicalJson(Object.keys(envelope.hub || {}).sort()) !== canonicalJson(['path'])) throw new Error('delegated authority payload has invalid hub identity');
  if (canonicalJson(Object.keys(envelope.repository_result || {}).sort()) !== canonicalJson(['branch', 'commit', 'path', 'remote', 'tree'])) throw new Error('delegated authority payload has invalid repository result');
  if (canonicalJson(Object.keys(envelope.child || {}).sort()) !== canonicalJson(['entry_relative_path', 'receipt_id', 'source_commit', 'source_identity', 'source_manifest_digest', 'source_repository', 'source_tree'])) throw new Error('delegated authority payload has invalid child identity');
  if (canonicalJson(Object.keys(envelope.verified_source || {}).sort()) !== canonicalJson(['commit', 'entry_digest', 'receipt_id', 'source_manifest_digest', 'tree'])) throw new Error('delegated authority payload has invalid verified-source handshake');
  const bootstrapHandshake = globalThis.__TOOLKIT_VERIFIED_SOURCE_HANDSHAKE;
  if (!testHooks.delegatedEnvelopeRaw && canonicalJson(bootstrapHandshake || {}) !== canonicalJson(envelope.verified_source)) {
    throw new Error('delegated child did not start from the verified source handshake');
  }
  if (Object.values(envelope.actions.targets || {}).some((action) => !['enable-sync', 'sync'].includes(action))) {
    throw new Error('delegated authority payload contains an unsupported target action');
  }
  const targetNames = Object.keys(envelope.actions.targets || {}).sort();
  if (targetNames.some((target) => !SUPPORTED_TARGETS.includes(target))) throw new Error('delegated authority payload contains an unsupported target');
  if (canonicalJson(targetNames) !== canonicalJson(Object.keys(envelope.destinations.targets || {}).sort())) throw new Error('delegated authority target actions and destinations differ');
  return deepFreeze(envelope);
}

function assertDelegatedInvocationArgs(args) {
  if (!args.delegatedEnvelope) return;
  const widened = [];
  if (requestedPreferenceFields(args).length) widened.push('preference flags');
  if (args.enableTargets.length || args.disableTargets.length || args.scopedSyncTargets.length) widened.push('target action flags');
  if (args.hook || args.syncEnabled || args.repoUpdateNow || args.reconcileStaging) widened.push('maintenance flags');
  if (args.openUpdateReport || args.enableUpdateReports || args.disableUpdateReports || args.enableUpdateReportOpen || args.disableUpdateReportOpen) widened.push('report flags');
  if (args.repoPath || args.repoBranch || args.repoRemote || args.setAg2PythonCommand) widened.push('source or repository flags');
  if (args.syncSource !== 'repo' || !args.write || !args.skipRepoAutoUpdate) widened.push('child execution flags');
  if (widened.length) throw new Error(`delegated child ordinary CLI flags cannot widen payload authority: ${widened.join(', ')}`);
}

function resolveExecutionAuthority({ args, hubPath, rawState, discoveries, delegatedEnvelope = null }) {
  const preferenceFields = delegatedEnvelope ? [] : requestedPreferenceFields(args);
  const targetActions = delegatedEnvelope ? { ...(delegatedEnvelope.actions.targets || {}) } : {};
  if (!delegatedEnvelope) {
    for (const target of args.enableTargets) targetActions[target] = 'enable-sync';
    for (const target of args.disableTargets) targetActions[target] = 'disable';
  }
  const durableTargetsMayAuthorize = !delegatedEnvelope && ((!args.hook && args.syncEnabled) || (args.hook && rawState?.auto_sync_enabled === true));
  if (durableTargetsMayAuthorize) {
    for (const target of SUPPORTED_TARGETS) {
      const persisted = rawState?.targets?.[target];
      if (!targetActions[target] && persisted?.enabled === true && persisted?.explicitly_disabled !== true) {
        targetActions[target] = 'sync';
      }
    }
  }

  const repoMaintenance = Boolean(
    !args.preferenceOnly &&
    !args.skipRepoAutoUpdate &&
    (args.repoUpdateNow || args.hook) &&
    rawState?.repo_auto_update_enabled === true
  );
  const nativeMaintenance = Boolean(
    !args.preferenceOnly &&
    args.hook &&
    args.syncSource === 'codex-plugin' &&
    rawState?.codex_plugin_auto_refresh_enabled === true
  );
  const reportMaintenance = Boolean(
    !delegatedEnvelope &&
    !args.preferenceOnly &&
    !args.suppressUpdateReport &&
    (args.hook || repoMaintenance || Object.keys(targetActions).length)
  );
  const destinations = Object.fromEntries(Object.keys(targetActions).sort().map((target) => [
    target,
    discoveries?.[target]?.target_path ? path.resolve(discoveries[target].target_path) : ''
  ]));
  const statePath = path.join(hubPath, 'state.json');
  const manifestPath = path.join(hubPath, 'manifest.json');
  const directReportTrigger = Boolean(args.hook || args.repoUpdateNow || args.openUpdateReport || isLegacyDelegatedRepoSync(args));
  const reportCreateEligible = !args.preferenceOnly && !args.suppressUpdateReport && rawState?.update_report_enabled !== false && directReportTrigger && !delegatedEnvelope;
  const noTargetPersistenceEligible = !args.preferenceOnly && args.syncEnabled && !Object.keys(targetActions).length && Boolean(
    rawState?.hub_version || Object.keys(rawState?.bridge_versions_by_source || {}).length || rawState?.auto_sync_enabled || rawState?.repo_auto_update_enabled
  );
  const managedWriteCeiling = Boolean(preferenceFields.length || Object.keys(targetActions).length || repoMaintenance || nativeMaintenance || reportMaintenance || reportCreateEligible || noTargetPersistenceEligible || args.reconcileStaging);
  const reportDir = path.resolve(updateReportDir());
  const repoPath = path.resolve(delegatedEnvelope?.repository_result.path || args.repoPath || rawState?.repo_path || '.');
  const bindings = {
    hub: path.resolve(hubPath),
    state_path: path.resolve(statePath),
    manifest_path: path.resolve(manifestPath),
    source_script: path.resolve(__filename),
    source_identity: sha256(fs.readFileSync(__filename)),
    source_repository: path.resolve(delegatedEnvelope?.child.source_repository || path.resolve(__dirname, '..', '..')),
    source_commit: delegatedEnvelope?.child.source_commit || currentToolkitCommit({ repo_path: path.resolve(__dirname, '..', '..') }),
    target_destinations: destinations,
    report_directory: reportDir,
    repository: {
      path: delegatedEnvelope ? repoPath : (args.repoPath || rawState?.repo_path ? repoPath : ''),
      branch: delegatedEnvelope?.repository_result.branch || args.repoBranch || rawState?.repo_branch || DEFAULT_REPO_BRANCH,
      remote: delegatedEnvelope?.repository_result.remote || args.repoRemote || rawState?.repo_remote || DEFAULT_REPO_REMOTE
    },
    native_source_repository: repoPath,
    staging_parents: args.reconcileStaging
      ? stagingReconciliationParents(args, hubPath, normalizedState(rawState)).map((value) => path.resolve(value)).sort()
      : []
  };
  if (repoMaintenance) {
    bindings.delegated_child = {
      entry_relative_path: BRIDGE_ENTRY_RELATIVE_PATH,
      cwd: repoPath,
      arguments: ['-e', RECEIPT_CHILD_BOOTSTRAP],
      target_actions: Object.fromEntries(Object.entries(targetActions).filter(([, action]) => ['enable-sync', 'sync'].includes(action)))
    };
  }
  if (delegatedEnvelope) {
    if (path.resolve(hubPath) !== path.resolve(delegatedEnvelope.hub.path)) throw new Error('delegated hub binding mismatch');
    const stageRootRaw = globalThis.__TOOLKIT_VERIFIED_SOURCE_STAGE_ROOT;
    if (!args.syntheticDelegatedFixture) {
      if (!stageRootRaw || slash(path.relative(path.resolve(stageRootRaw), path.resolve(__filename))) !== delegatedEnvelope.child.entry_relative_path) throw new Error('delegated child entry path mismatch');
    }
    if (bindings.source_identity !== delegatedEnvelope.child.source_identity) throw new Error('delegated child source identity mismatch');
    if (bindings.source_commit !== delegatedEnvelope.child.source_commit) throw new Error('delegated child source commit mismatch');
    if (path.resolve(bindings.source_repository) !== path.resolve(delegatedEnvelope.child.source_repository)) throw new Error('delegated child source repository mismatch');
    if (path.resolve(delegatedEnvelope.repository_result.path) !== path.resolve(delegatedEnvelope.child.source_repository)) throw new Error('delegated repository result path mismatch');
    if (delegatedEnvelope.repository_result.commit !== delegatedEnvelope.child.source_commit) throw new Error('delegated repository result commit mismatch');
    if (delegatedEnvelope.repository_result.tree !== delegatedEnvelope.child.source_tree) throw new Error('delegated repository result tree mismatch');
    if (delegatedEnvelope.child.receipt_id !== delegatedEnvelope.verified_source.receipt_id || delegatedEnvelope.child.source_manifest_digest !== delegatedEnvelope.verified_source.source_manifest_digest) throw new Error('delegated source receipt identity mismatch');
    const childBranch = gitCommand(delegatedEnvelope.child.source_repository, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const childRemote = gitCommand(delegatedEnvelope.child.source_repository, ['remote', 'get-url', 'origin']);
    if (!childBranch.ok || childBranch.stdout.trim() !== delegatedEnvelope.repository_result.branch) throw new Error('delegated repository result branch mismatch');
    if (!childRemote.ok || childRemote.stdout.trim() !== delegatedEnvelope.repository_result.remote) throw new Error('delegated repository result remote mismatch');
    if (canonicalJson(destinations) !== canonicalJson(delegatedEnvelope.destinations.targets || {})) throw new Error('delegated target destination binding mismatch');
  }
  const authority = {
    contract: INVOCATION_AUTHORITY_CONTRACT,
    invocation_id: delegatedEnvelope?.parent_invocation_id
      ? `${delegatedEnvelope.parent_invocation_id}:child`
      : crypto.randomUUID(),
    entrypoint: args.reconcileStaging
      ? 'staging-reconciliation'
      : (delegatedEnvelope ? 'delegated-child' : (args.preferenceOnly ? 'preference-only' : (args.hook ? 'hook-maintenance' : (args.repoUpdateNow ? 'repo-maintenance' : 'manual')))),
    write_requested: args.write === true,
    sync_source: args.syncSource,
    actions: {
      preferences: preferenceFields,
      targets: Object.fromEntries(Object.entries(targetActions).sort(([left], [right]) => left.localeCompare(right))),
      hub: { state_write: managedWriteCeiling, manifest_write: managedWriteCeiling && !args.preferenceOnly },
      repository: { update: repoMaintenance, failure_status: repoMaintenance, delegate_sync: repoMaintenance },
      native: { cache_maintenance: nativeMaintenance, hook_repair: nativeMaintenance },
      reports: { cleanup: reportMaintenance, create: reportCreateEligible, open: reportCreateEligible },
      staging: { reconcile: Boolean(args.reconcileStaging), generation: args.reconcileStaging || '' }
    },
    bindings
  };
  authority.state_binding = authorityStateBinding(rawState, authority);
  return deepFreeze(authority);
}

function scopeTargetAction(args, target) {
  return args.executionAuthority?.actions?.targets?.[target] || '';
}

function scopeAllowsTargetState(args, target) {
  return ['enable-sync', 'disable', 'sync'].includes(scopeTargetAction(args, target));
}

function scopeAllowsTargetSync(args, target) {
  return ['enable-sync', 'sync'].includes(scopeTargetAction(args, target));
}

function scopeHasExecutableWrite(args) {
  const actions = args.executionAuthority?.actions || {};
  return Boolean(
    actions.preferences?.length || Object.keys(actions.targets || {}).length || actions.hub?.state_write || actions.repository?.update ||
    actions.native?.cache_maintenance || actions.reports?.cleanup || actions.reports?.create || actions.staging?.reconcile
  );
}

function authorityStateBinding(rawState, authority) {
  const state = rawState && typeof rawState === 'object' && !Array.isArray(rawState) ? rawState : {};
  const binding = {};
  if (authority.actions.repository.update) {
    binding.repository = {
      enabled: state.repo_auto_update_enabled === true,
      path: state.repo_path ? path.resolve(state.repo_path) : '',
      branch: state.repo_branch || DEFAULT_REPO_BRANCH,
      remote: state.repo_remote || DEFAULT_REPO_REMOTE
    };
  }
  if (authority.actions.native.cache_maintenance || authority.actions.native.hook_repair) {
    binding.native = { enabled: state.codex_plugin_auto_refresh_enabled === true };
  }
  if (authority.actions.reports.cleanup || authority.actions.reports.create || authority.actions.reports.open) {
    binding.reports = {
      enabled: state.update_report_enabled !== false,
      retention_days: state.update_report_retention_days || DEFAULT_UPDATE_REPORT_RETENTION_DAYS
    };
  }
  binding.targets = Object.fromEntries(Object.keys(authority.actions.targets || {}).sort().map((target) => {
    const current = state.targets?.[target] || {};
    return [target, {
      enabled: current.enabled === true,
      explicitly_disabled: current.explicitly_disabled === true,
      target_path: current.target_path ? path.resolve(current.target_path) : ''
    }];
  }));
  return binding;
}

function lockIsOwned(lock) {
  if (!lock?.acquired || !lock.lockPath || !lock.token) return false;
  try {
    return readJsonIfExists(lock.lockPath)?.token === lock.token;
  } catch {
    return false;
  }
}

function lockFileFingerprint(lockPath) {
  try {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return {
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtime_ms: String(stat.birthtimeMs),
      ctime_ms: String(stat.ctimeMs),
      mtime_ms: String(stat.mtimeMs),
      size: stat.size
    };
  } catch {
    return null;
  }
}

function filesystemIdentity(filePath, expectedType) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return null;
    if (expectedType === 'file' && !stat.isFile()) return null;
    if (expectedType === 'directory' && !stat.isDirectory()) return null;
    if (path.resolve(fs.realpathSync.native(filePath)) !== path.resolve(filePath)) return null;
    const identity = {
      type: expectedType,
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtime_ms: String(stat.birthtimeMs)
    };
    if (expectedType === 'file') {
      identity.ctime_ms = String(stat.ctimeMs);
      identity.size = stat.size;
    }
    return identity;
  } catch {
    return null;
  }
}

function revalidateExecutionAuthority(args, discoveries, rawState = null) {
  for (const target of SUPPORTED_TARGETS.filter((name) => scopeTargetAction(args, name))) {
    const lockedDestination = discoveries?.[target]?.target_path
      ? path.resolve(discoveries[target].target_path)
      : '';
    const authorisedDestination = args.executionAuthority.bindings.target_destinations[target] || '';
    if (lockedDestination !== authorisedDestination) {
      throw new Error(`Execution authority destination changed while waiting for the lock: ${target}`);
    }
  }
  if (rawState !== null) {
    const expected = args.expectedAuthorityStateBinding || args.executionAuthority.state_binding;
    const actual = authorityStateBinding(rawState, args.executionAuthority);
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('authority-relevant state changed before managed mutation');
  }
  if (args.delegatedEnvelope) {
    const envelope = args.delegatedEnvelope;
    const sourceRepository = path.resolve(envelope.child.source_repository);
    if (sha256(fs.readFileSync(__filename)) !== envelope.child.source_identity) throw new Error('delegated child source identity changed before managed mutation');
    if (currentToolkitCommit({ repo_path: sourceRepository }) !== envelope.child.source_commit) throw new Error('delegated child source commit changed before managed mutation');
    if (requireGitText(sourceRepository, ['rev-parse', 'HEAD^{tree}'], 'recheck delegated source tree') !== envelope.child.source_tree) throw new Error('delegated child source tree changed before managed mutation');
    if (!args.syntheticDelegatedFixture && canonicalJson(globalThis.__TOOLKIT_VERIFIED_SOURCE_HANDSHAKE || {}) !== canonicalJson(envelope.verified_source)) throw new Error('delegated child source handshake changed before managed mutation');
    const branch = gitCommand(sourceRepository, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const remote = gitCommand(sourceRepository, ['remote', 'get-url', 'origin']);
    if (!branch.ok || branch.stdout.trim() !== envelope.repository_result.branch) throw new Error('delegated repository result branch changed before managed mutation');
    if (!remote.ok || remote.stdout.trim() !== envelope.repository_result.remote) throw new Error('delegated repository result remote changed before managed mutation');
  }
  return true;
}

function actionAuthorised(args, kind, options = {}) {
  const actions = args.executionAuthority?.actions || {};
  if (kind === 'preference.field.write') return actions.preferences?.includes(options.field);
  if (kind === 'hub.state.write') return actions.hub?.state_write === true;
  if (kind === 'hub.manifest.write') return actions.hub?.manifest_write === true;
  if (kind === 'hub.adapter.replace' || kind === 'target.destination.write' || kind === 'target.destination.remove') {
    return ['enable-sync', 'sync'].includes(actions.targets?.[options.target]);
  }
  if (['repository.fetch', 'repository.switch', 'repository.fast-forward-merge', 'repository.validation'].includes(kind)) return actions.repository?.update === true;
  if (kind === 'delegated.child.launch') return actions.repository?.delegate_sync === true;
  if (kind === 'failure-status.persist') return actions.repository?.failure_status === true;
  if (kind === 'native.cache.maintenance') return actions.native?.cache_maintenance === true;
  if (kind === 'third-party.hook.repair') return actions.native?.hook_repair === true;
  if (kind === 'report.cleanup') return actions.reports?.cleanup === true;
  if (kind === 'report.create') return actions.reports?.create === true;
  if (kind === 'report.open') return actions.reports?.open === true;
  if (kind === 'staging.reconcile') return actions.staging?.reconcile === true;
  return false;
}

function authorityPreferenceFields(args) {
  return [...(args.executionAuthority?.actions?.preferences || [])].sort();
}

function derivedActionSummary(args) {
  return {
    preferences: authorityPreferenceFields(args),
    targets: Object.fromEntries(SUPPORTED_TARGETS.map((target) => [target, scopeTargetAction(args, target)]).filter(([, action]) => action)),
    repo_maintenance: args.executionAuthority?.actions?.repository?.update === true,
    native_maintenance: args.executionAuthority?.actions?.native?.cache_maintenance === true,
    report_maintenance: args.executionAuthority?.actions?.reports?.cleanup === true,
    staging_reconciliation: args.executionAuthority?.actions?.staging?.reconcile ? args.reconcileStaging : ''
  };
}

function listUpdateReportCandidates(options = {}) {
  const reportDir = path.resolve(options.reportDir || updateReportDir());
  const retentionDays = Number.isInteger(options.retentionDays) && options.retentionDays > 0 ? options.retentionDays : DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  const maxReports = Number.isInteger(options.maxReports) && options.maxReports > 0 ? options.maxReports : DEFAULT_UPDATE_REPORT_MAX_FILES;
  const cutoffMs = (options.nowMs || Date.now()) - retentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(reportDir)) return [];
  const reports = fs.readdirSync(reportDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(entry.name))
    .map((entry) => {
      const filePath = path.join(reportDir, entry.name);
      return { filePath: path.resolve(filePath), mtimeMs: fs.statSync(filePath).mtimeMs };
    });
  const retained = reports.filter((entry) => entry.mtimeMs >= cutoffMs).sort((left, right) => right.mtimeMs - left.mtimeMs || right.filePath.localeCompare(left.filePath));
  return [...reports.filter((entry) => entry.mtimeMs < cutoffMs), ...retained.slice(maxReports)]
    .map((entry) => entry.filePath)
    .sort((left, right) => left.localeCompare(right));
}

function beginMutationPhase(args, { lock, hubPath, rawState, discoveries, testHooks = {} }) {
  if (!lockIsOwned(lock)) throw new Error('managed mutation phase requires the exact owned lock');
  revalidateExecutionAuthority(args, discoveries, rawState);
  if (args.phaseContext) invalidatePhaseContext(args.phaseContext);
  let reportCandidates = [];
  let reportInventoryError = '';
  if (actionAuthorised(args, 'report.cleanup')) {
    try {
      const inventory = testHooks.listUpdateReportCandidates || listUpdateReportCandidates;
      reportCandidates = inventory({ retentionDays: normalizedState(rawState).update_report_retention_days });
    } catch (error) {
      reportInventoryError = String(error.message || error);
    }
  }
  const context = deepFreeze({
    invocation_id: args.executionAuthority.invocation_id,
    lock_path: path.resolve(lock.lockPath),
    lock_token: lock.token,
    hub: path.resolve(hubPath),
    report_candidates: reportCandidates,
    report_inventory_error: reportInventoryError
  });
  phaseContextState.set(context, {
    active: true,
    firstMutation: false,
    lock,
    lockFingerprint: lockFileFingerprint(lock.lockPath),
    args,
    testHooks
  });
  if (!lock.phaseContexts) lock.phaseContexts = [];
  lock.phaseContexts.push(context);
  args.phaseContext = context;
  if (testHooks.afterPhaseContextCreated) testHooks.afterPhaseContextCreated({ context, lock });
  return context;
}

function invalidatePhaseContext(context) {
  const state = phaseContextState.get(context);
  if (state) state.active = false;
}

function validatePhaseContext(context) {
  const state = phaseContextState.get(context);
  const currentFingerprint = state?.lock ? lockFileFingerprint(state.lock.lockPath) : null;
  if (!state?.active || !currentFingerprint || canonicalJson(currentFingerprint) !== canonicalJson(state.lockFingerprint)) {
    if (state) state.active = false;
    throw new Error('managed mutation phase context is expired or its lock was lost');
  }
  return state;
}

function revalidateBeforeFirstMutation(args) {
  const hubPath = args.executionAuthority.bindings.hub;
  const rawState = readJsonIfExists(path.join(hubPath, 'state.json'));
  // Target discovery, including optional host probes, is frozen when the
  // mutation phase is established. Per-effect admission rechecks the exact
  // bound destinations plus durable state without rediscovering mutable
  // executable candidates between validation and dispatch.
  const discoveries = Object.fromEntries(SUPPORTED_TARGETS.map((target) => [target, {
    target_path: args.executionAuthority.bindings.target_destinations[target] || ''
  }]));
  revalidateExecutionAuthority(args, discoveries, rawState);
}

function assertActualMutationInput(args, kind, options = {}) {
  const opts = options || {};
  if (!actionAuthorised(args, kind, opts)) throw new Error(`managed mutation is not authorised: ${kind}${opts.target ? `:${opts.target}` : ''}`);
  const details = opts.details || {};
  const bindings = args.executionAuthority.bindings;
  const exactPath = details.path || details.repoPath || '';
  const requirePath = (expected, label) => {
    if (!exactPath || path.resolve(exactPath) !== path.resolve(expected)) throw new Error(`${label} input does not match invocation authority`);
  };
  if (details.hubPath && path.resolve(details.hubPath) !== path.resolve(bindings.hub)) throw new Error('hub input does not match invocation authority');
  if (kind === 'hub.state.write') requirePath(bindings.state_path, 'hub state writer');
  if (kind === 'hub.manifest.write') requirePath(bindings.manifest_path, 'hub manifest writer');
  if (kind === 'hub.adapter.replace') requirePath(path.join(bindings.hub, 'adapters', opts.target), 'hub adapter writer');
  if (kind === 'target.destination.write' || kind === 'target.destination.remove') requirePath(bindings.target_destinations[opts.target], 'target writer');
  if (kind.startsWith('repository.')) {
    requirePath(bindings.repository.path, 'repository helper');
    if (details.branch && details.branch !== bindings.repository.branch) throw new Error('repository branch input does not match invocation authority');
    if (details.remote && normalizeRemoteForCompare(details.remote) !== normalizeRemoteForCompare(bindings.repository.remote)) throw new Error('repository remote input does not match invocation authority');
    if (kind === 'repository.switch' && details.to !== bindings.repository.branch) throw new Error('repository branch input does not match invocation authority');
  }
  if (kind === 'delegated.child.launch') {
    requirePath(path.join(bindings.repository.path, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), 'delegated child');
    if (details.cwd && path.resolve(details.cwd) !== path.resolve(bindings.repository.path)) throw new Error('delegated child working directory input does not match invocation authority');
    if (details.arguments && canonicalJson(details.arguments) !== canonicalJson(bindings.delegated_child?.arguments || [])) throw new Error('delegated child arguments do not match invocation authority');
    const payload = details.payload;
    if (payload) {
      if (path.resolve(payload.child?.source_repository || '') !== path.resolve(bindings.repository.path)) throw new Error('delegated child payload source does not match invocation authority');
      if (path.resolve(payload.hub?.path || '') !== path.resolve(bindings.hub)) throw new Error('delegated child payload hub does not match invocation authority');
      if (canonicalJson(payload.actions?.targets || {}) !== canonicalJson(bindings.delegated_child?.target_actions || {})) throw new Error('delegated child payload actions do not match invocation authority');
      if (details.verifiedCommit && (payload.repository_result?.commit !== details.verifiedCommit || payload.child?.source_commit !== details.verifiedCommit)) {
        throw new Error('delegated child payload commit does not match verified repository result');
      }
      if (details.verifiedSourceIdentity && payload.child?.source_identity !== details.verifiedSourceIdentity) {
        throw new Error('delegated child payload source identity does not match verified repository result');
      }
    }
  }
  if (kind === 'native.cache.maintenance' || kind === 'third-party.hook.repair') {
    requirePath(path.resolve(defaultCodexHome()), 'native helper');
    if (details.repoPath && path.resolve(details.repoPath) !== path.resolve(bindings.native_source_repository)) throw new Error('native source repository input does not match invocation authority');
  }
  if (kind === 'staging.reconcile') {
    if (details.generation_id !== args.executionAuthority.actions.staging.generation) throw new Error('staging generation does not match invocation authority');
    const actualParents = (details.parents || []).map((value) => path.resolve(value)).sort();
    if (canonicalJson(actualParents) !== canonicalJson(bindings.staging_parents || [])) throw new Error('staging parent input does not match invocation authority');
  }
  if (kind === 'report.cleanup') {
    const actualCandidates = (details.candidate_paths || []).map((value) => path.resolve(value)).sort();
    const boundCandidates = (args.phaseContext?.report_candidates || []).map((value) => path.resolve(value)).sort();
    if (canonicalJson(actualCandidates) !== canonicalJson(boundCandidates)) throw new Error('report cleanup candidates do not match invocation authority');
  }
  if (kind === 'report.create' || kind === 'report.open') {
    if (!exactPath || !isInside(bindings.report_directory, path.resolve(exactPath))) throw new Error('report path does not match invocation authority');
    if (kind === 'report.open' && path.resolve(exactPath) !== path.resolve(args.createdReportPath || '')) throw new Error('only this invocation\'s freshly created report may be opened');
  }
}

function guardManagedMutation(args, kind, options = {}) {
  validatePhaseContext(args.phaseContext);
  assertActualMutationInput(args, kind, options);
  revalidateBeforeFirstMutation(args);
  validatePhaseContext(args.phaseContext);
}

function guardManagedPrimitive(args, kind, options = {}) {
  validatePhaseContext(args.phaseContext);
  assertActualMutationInput(args, kind, options);
}

function initializeInvocationRuntime(args, testHooks = {}) {
  args.testHooks = testHooks;
  args.expectedAuthorityStateBinding = args.executionAuthority.state_binding;
  args.phaseContext = null;
  args.createdReportPath = '';
  args.createdReportIdentity = null;
  args.delegatedReceipt = args.delegatedEnvelope ? {
    role: 'child',
    parent_invocation_id: args.delegatedEnvelope.parent_invocation_id,
    child_source_identity: args.delegatedEnvelope.child.source_identity
  } : null;
}

function assertPreferenceBoundary(args) {
  if (!args.preferenceOnly) return;
  const incompatible = [];
  if (args.hook) incompatible.push('--hook');
  if (args.syncEnabled) incompatible.push('--sync-enabled');
  if (args.repoUpdateNow) incompatible.push('--repo-update-now');
  if (args.reconcileStaging) incompatible.push('--reconcile-staging');
  if (args.enableTargets.length) incompatible.push('--enable-target');
  if (args.disableTargets.length) incompatible.push('--disable-target');
  if (args.scopedSyncTargets.length) incompatible.push('--scope-target-sync');
  if (args.setAg2PythonCommand) incompatible.push('--set-ag2-python-command');
  if (incompatible.length) throw new Error(`--preference-only cannot be combined with: ${incompatible.join(', ')}`);
  if (!requestedPreferenceFields(args).length) {
    throw new Error('--preference-only requires at least one explicit global preference');
  }
}

function assertRepoAutoUpdatePrerequisite(args, state) {
  if (args.enableRepoAutoUpdate && !(args.repoPath || state?.repo_path)) {
    throw new Error('--enable-repo-auto-update requires --repo-path or an existing repo_path in hub state');
  }
}

function printHelp() {
  console.log([
    'Toolkit Local Bridge updater',
    '',
    'Dry-run is the default. Add --write for local hub or target writes.',
    '',
    'Common commands:',
    '  node repo/scripts/toolkit-local-bridge.cjs --audit',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id>',
    '  node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id> --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write',
    '',
    'Options:',
    '  --enable-target opencode|ag2',
    '  --disable-target opencode|ag2',
    '  --preference-only',
    '  --delegated-invocation-authority  internal child mode; reads one fixed authority payload from stdin',
    '  --sync-enabled',
    '  --enable-auto-sync',
    '  --disable-auto-sync',
    '  --enable-repo-auto-update',
    '  --disable-repo-auto-update',
    '  --repo-path <path>',
    '  --repo-branch <branch>',
    '  --repo-remote <url>',
    '  --repo-update-now',
    '  --skip-repo-auto-update     internal recursion guard for delegated repo sync',
    '  --open-update-report        open the generated update report for this run, when one is created',
    '  --enable-update-reports     persist meaningful update report writes',
    '  --disable-update-reports',
    '  --update-report-retention-days <days>',
    '                                positive integer, default: 7',
    '  --enable-update-report-open compatibility alias for failure-only opening; successful reports remain closed',
    '  --disable-update-report-open retain failure-only opening; successful reports remain closed',
    '  --enable-codex-plugin-auto-refresh',
    '                                persist opt-in Codex Toolkit cache refresh and Windows third-party hook repair',
    '  --disable-codex-plugin-auto-refresh',
    '  --audit',
    '  --reconcile-staging <generation-id>',
    '                                audit one new-format owned generation; add --write for exact cleanup',
    '  --force-downgrade',
    '  --sync-source repo|codex-plugin|claude-plugin',
    '  --hub <path>                  test override; defaults to ~/.ai-agent-toolkit/current',
    '  --opencode-config-dir <path>  test or explicit setup override',
    '  --opencode-target <path>      test override for the managed OpenCode skills root',
    '  --python-command <command>    one-run AG2 Python detection override',
    '  --set-ag2-python-command <command>',
    '                                persist an AG2 Python command for future audit and hook runs'
  ].join('\n'));
}

function defaultHubPath() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'current');
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertSafeWritePath(targetPath, label) {
  const resolved = path.resolve(targetPath);
  const home = path.resolve(os.homedir());
  const temp = path.resolve(os.tmpdir());
  if (!isInside(home, resolved) && !isInside(temp, resolved)) {
    throw new Error(`${label} must stay under the current user home or temp directory: ${resolved}`);
  }
  return resolved;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseCommandSpec(commandSpec) {
  const raw = String(commandSpec || '').trim();
  if (!raw) return { command: '', args: [] };
  if (fs.existsSync(raw)) return { command: raw, args: [] };

  const parts = [];
  let current = '';
  let quote = '';
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (quote) throw new Error(`unterminated quote in command: ${raw}`);
  if (current) parts.push(current);
  return { command: parts[0] || '', args: parts.slice(1) };
}

function commandProbe(command, commandArgs) {
  if (!command) return { ok: false, output: '', error: 'missing command' };
  try {
    const parsed = parseCommandSpec(command);
    if (!parsed.command) return { ok: false, output: '', status: null, error: 'missing command' };
    if (/\.(?:cmd|bat)$/i.test(parsed.command)) {
      return {
        ok: false,
        output: '',
        status: null,
        error: 'shell command shims (.cmd/.bat) are not supported; use a direct executable path such as python.exe'
      };
    }
    const result = spawnSync(parsed.command, [...parsed.args, ...commandArgs], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    return {
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
      status: result.status,
      error: result.error ? result.error.message : ''
    };
  } catch (error) {
    return { ok: false, output: '', error: error.message };
  }
}

function runCommand(command, commandArgs, options = {}) {
  try {
    const result = spawnSync(command, commandArgs, {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeout || 30000,
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) },
      input: options.input
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error ? result.error.message : ''
    };
  } catch (error) {
    return { ok: false, status: null, stdout: '', stderr: '', error: error.message };
  }
}

function commandOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}${result.error || ''}`.trim();
}

function isCredentialError(message = '') {
  return /SEC_E_NO_CREDENTIALS|could not read Username|Authentication failed|Authentication|permission denied|terminal prompts disabled/i.test(
    String(message)
  );
}

function fetchWithCredentialFallback(repoPath, branch) {
  const defaultFetch = gitCommand(repoPath, ['fetch', 'origin', branch], { timeout: 120000 });
  if (defaultFetch.ok) return defaultFetch;

  let lastError = commandOutput(defaultFetch);
  if (!isCredentialError(lastError)) return defaultFetch;

  for (const helper of GIT_CREDENTIAL_HELPERS) {
    const fallback = gitCommand(
      repoPath,
      ['-c', `credential.helper=${helper}`, 'fetch', 'origin', branch],
      { timeout: 120000 }
    );
    if (fallback.ok) return fallback;
    const fallbackOutput = commandOutput(fallback);
    if (fallbackOutput) lastError = `${lastError}\n${fallbackOutput}`;
  }
  return {
    ok: false,
    status: defaultFetch.status,
    stdout: '',
    stderr: lastError,
    error: ''
  };
}

function gitCommand(repoPath, args, options = {}) {
  return runCommand('git', args, { cwd: repoPath, timeout: options.timeout || 30000 });
}

function requireGit(repoPath, args, label) {
  const result = gitCommand(repoPath, args);
  if (!result.ok) {
    throw new Error(`${label || `git ${args.join(' ')}`} failed: ${commandOutput(result)}`);
  }
  return result.stdout.trim();
}

function normalizeRemoteForCompare(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const slashValue = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  const githubSsh = slashValue.match(/^git@github\.com:(.+?)(?:\.git)?$/i);
  if (githubSsh) return `https://github.com/${githubSsh[1].replace(/\/+$/, '')}`.toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(slashValue)) {
    try {
      const url = new URL(slashValue);
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase();
      return url.toString().replace(/\/$/, '');
    } catch {
      return slashValue.replace(/\.git$/i, '').toLowerCase();
    }
  }
  return path.resolve(raw).replace(/\\/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function repoUpdateError(status, message, details = {}) {
  const error = new Error(message);
  error.repoUpdateStatus = status;
  error.repoUpdateDetails = details;
  return error;
}

function applyRepoUpdateStatus(state, status, details = {}) {
  const next = normalizedState(state);
  next.last_repo_update = timestamp();
  next.last_repo_update_status = status;
  next.last_repo_update_from_commit = details.fromCommit || '';
  next.last_repo_update_to_commit = details.toCommit || '';
  next.last_repo_update_error = details.error || '';
  return next;
}

function buildValidationSuite({ hookMode = false } = {}) {
  return [
    {
      label: 'node repo/scripts/validate-toolkit.cjs',
      args: [path.join('repo', 'scripts', 'validate-toolkit.cjs')],
      timeout: VALIDATE_TOOLKIT_TIMEOUT_MS
    },
    hookMode
      ? {
          label: 'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs',
          args: ['--test', HOOK_LIGHT_VALIDATION_TEST],
          timeout: HOOK_LIGHT_VALIDATION_TIMEOUT_MS
        }
      : {
          label: 'node --test repo/tests/toolkit-local-bridge.test.cjs',
          args: ['--test', FULL_VALIDATION_TEST],
          timeout: VALIDATE_TOOLKIT_TIMEOUT_MS
        }
  ];
}

function getRepoValidationLabels(options = {}) {
  return buildValidationSuite(options).map((entry) => entry.label);
}

function runRepoValidation(repoPath, options = {}) {
  const validations = buildValidationSuite(options);
  const commands = [];
  for (const validation of validations) {
    commands.push(validation.label);
    const result = runCommand(process.execPath, validation.args, {
      cwd: repoPath,
      timeout: validation.timeout
    });
    if (!result.ok) {
      throw repoUpdateError(
        'validation-failed',
        `${validation.label} failed: ${commandOutput(result)}`,
        {
          error: validation.label,
          validationStatus: 'failed',
          validationCommand: validation.label
        }
      );
    }
  }
  return {
    status: 'passed',
    commands
  };
}

function directProcessResult(result) {
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : ''
  };
}

function admitActionSpecificEffect(args, kind, options = {}) {
  const phase = validatePhaseContext(args.phaseContext);
  const detachedOptions = detachedFrozen(options);
  if (phase.testHooks?.beforeManagedEffectAdmission) phase.testHooks.beforeManagedEffectAdmission({ kind, options: detachedOptions });
  if (!phase.firstMutation && phase.testHooks?.beforeFirstManagedEffect) {
    phase.testHooks.beforeFirstManagedEffect({ kind, options: detachedOptions });
  }
  assertActualMutationInput(args, kind, options);
  revalidateBeforeFirstMutation(args);
  validatePhaseContext(args.phaseContext);
  phase.firstMutation = true;
}

function persistFailureStatus(args, state, status, details = {}) {
  admitActionSpecificEffect(args, 'failure-status.persist', {
    details: { status, fromCommit: details.fromCommit || '', toCommit: details.toCommit || '' }
  });
  return applyRepoUpdateStatus(state, status, details);
}

function switchRepositoryBranch(args, repoPath, branch, expectedRemote, currentBranch) {
  const resolvedRepo = path.resolve(repoPath);
  const exactBranch = String(branch);
  const commandArgs = ['switch', exactBranch];
  admitActionSpecificEffect(args, 'repository.switch', {
    details: { repoPath: resolvedRepo, branch: exactBranch, remote: expectedRemote, from: currentBranch, to: exactBranch, executable: 'git', arguments: commandArgs }
  });
  return directProcessResult(spawnSync('git', commandArgs, {
    cwd: resolvedRepo,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: { ...process.env }
  }));
}

function fetchRepositoryBranch(args, repoPath, branch, expectedRemote) {
  const resolvedRepo = path.resolve(repoPath);
  const exactBranch = String(branch);
  const attempts = [
    ['fetch', 'origin', exactBranch],
    ...GIT_CREDENTIAL_HELPERS.map((helper) => ['-c', `credential.helper=${helper}`, 'fetch', 'origin', exactBranch])
  ];
  let lastResult = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const commandArgs = attempts[index];
    if (index > 0 && lastResult && !isCredentialError(commandOutput(lastResult))) break;
    admitActionSpecificEffect(args, 'repository.fetch', {
      details: { repoPath: resolvedRepo, branch: exactBranch, remote: expectedRemote, retry: index, executable: 'git', arguments: commandArgs }
    });
    const result = directProcessResult(spawnSync('git', commandArgs, {
      cwd: resolvedRepo,
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
      env: { ...process.env }
    }));
    if (result.ok) return result;
    lastResult = result;
  }
  return lastResult || { ok: false, status: null, stdout: '', stderr: '', error: 'fetch was not attempted' };
}

function fastForwardRepository(args, repoPath, branch, expectedRemote, fromCommit, fetchedCommit) {
  const resolvedRepo = path.resolve(repoPath);
  const commandArgs = ['merge', '--ff-only', fetchedCommit];
  admitActionSpecificEffect(args, 'repository.fast-forward-merge', {
    details: { repoPath: resolvedRepo, branch, remote: expectedRemote, fromCommit, fetchedCommit, executable: 'git', arguments: commandArgs }
  });
  return directProcessResult(spawnSync('git', commandArgs, {
    cwd: resolvedRepo,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: { ...process.env }
  }));
}

function runRepositoryValidation(args, repoPath, options = {}) {
  const resolvedRepo = path.resolve(repoPath);
  const validations = buildValidationSuite(options);
  const commands = [];
  for (let index = 0; index < validations.length; index += 1) {
    const validation = validations[index];
    const commandArgs = [...validation.args];
    admitActionSpecificEffect(args, 'repository.validation', {
      details: {
        repoPath: resolvedRepo,
        branch: args.executionAuthority.bindings.repository.branch,
        remote: args.executionAuthority.bindings.repository.remote,
        executable: process.execPath,
        arguments: commandArgs,
        validation_index: index
      }
    });
    const result = directProcessResult(spawnSync(process.execPath, commandArgs, {
      cwd: resolvedRepo,
      encoding: 'utf8',
      timeout: validation.timeout,
      windowsHide: true,
      env: { ...process.env }
    }));
    commands.push(validation.label);
    if (!result.ok) {
      throw repoUpdateError('validation-failed', `${validation.label} failed: ${commandOutput(result)}`, {
        error: validation.label,
        validationStatus: 'failed',
        validationCommand: validation.label
      });
    }
  }
  return { status: 'passed', commands };
}

function runNativeRepositoryValidation(args, repoPath, options = {}) {
  const resolvedRepo = path.resolve(repoPath);
  const validations = buildValidationSuite(options);
  const commands = [];
  for (let index = 0; index < validations.length; index += 1) {
    const validation = validations[index];
    const commandArgs = [...validation.args];
    admitActionSpecificEffect(args, 'native.cache.maintenance', {
      details: {
        path: path.resolve(defaultCodexHome()),
        repoPath: resolvedRepo,
        executable: process.execPath,
        arguments: commandArgs,
        validation_index: index
      }
    });
    const result = directProcessResult(spawnSync(process.execPath, commandArgs, {
      cwd: resolvedRepo,
      encoding: 'utf8',
      timeout: validation.timeout,
      windowsHide: true,
      env: { ...process.env }
    }));
    commands.push(validation.label);
    if (!result.ok) throw new Error(`${validation.label} failed: ${commandOutput(result)}`);
  }
  return { status: 'passed', commands };
}

function changedFilesBetween(repoPath, fromCommit, toCommit) {
  if (!fromCommit || !toCommit || fromCommit === toCommit) return [];
  const result = gitCommand(repoPath, ['diff', '--name-only', fromCommit, toCommit]);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function validateAndUpdateRepo(state, args = {}) {
  const repoPath = path.resolve(state.repo_path || '');
  const branch = state.repo_branch || DEFAULT_REPO_BRANCH;
  const expectedRemote = state.repo_remote || DEFAULT_REPO_REMOTE;
  if (!state.repo_path) {
    throw repoUpdateError('skipped', 'repo auto-update enabled but repo_path is not configured', {
      error: 'repo_path not configured'
    });
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw repoUpdateError('skipped', `configured repo_path does not exist: ${repoPath}`, {
      error: 'repo_path does not exist'
    });
  }
  const inside = gitCommand(repoPath, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw repoUpdateError('skipped', `configured repo_path is not a git worktree: ${repoPath}`, {
      error: 'not a git repo'
    });
  }
  const currentBranch = requireGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], 'read current branch');
  const remoteResult = gitCommand(repoPath, ['remote', 'get-url', '--all', 'origin']);
  if (!remoteResult.ok) {
    throw repoUpdateError('skipped', `could not read origin remote: ${commandOutput(remoteResult)}`, {
      error: 'origin remote missing'
    });
  }
  const actualRemotes = remoteResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const expectedComparable = normalizeRemoteForCompare(expectedRemote);
  if (!actualRemotes.some((remote) => normalizeRemoteForCompare(remote) === expectedComparable)) {
    throw repoUpdateError('skipped', `origin remote does not match configured Toolkit repo remote: ${expectedRemote}`, {
      error: 'remote mismatch'
    });
  }
  const dirty = requireGit(repoPath, ['status', '--porcelain'], 'check working tree');
  if (dirty) {
    throw repoUpdateError('skipped', 'configured repo working tree is dirty; refusing auto-update', {
      error: 'dirty working tree'
    });
  }
  let branchSwitchedFrom = '';
  if (currentBranch !== branch) {
    const switchResult = switchRepositoryBranch(args, repoPath, branch, expectedRemote, currentBranch);
    if (!switchResult.ok) {
      throw repoUpdateError('skipped', `git switch ${branch} failed: ${commandOutput(switchResult)}`, {
        error: 'branch switch failed'
      });
    }
    branchSwitchedFrom = currentBranch;
  }
  const fromCommit = requireGit(repoPath, ['rev-parse', 'HEAD'], 'read current commit');
  const fetchResult = fetchRepositoryBranch(args, repoPath, branch, expectedRemote);
  if (!fetchResult.ok) {
    const fetchError = commandOutput(fetchResult) || 'fetch failed';
    const credentialHint = isCredentialError(fetchError)
      ? `\nCredential hint: fetch failed in this environment. Run this command from the same shell/profile that already works for git fetch, or run \`gh auth login\` in this context, then rerun setup/refresh.`
      : '';
    throw repoUpdateError('skipped', `git fetch origin ${branch} failed: ${fetchError}${credentialHint}`, {
      fromCommit,
      branchSwitchedFrom,
      error: 'fetch failed'
    });
  }
  const fetchedCommit = requireGit(repoPath, ['rev-parse', 'FETCH_HEAD'], 'read fetched commit');
  const ancestor = gitCommand(repoPath, ['merge-base', '--is-ancestor', fromCommit, fetchedCommit]);
  if (!ancestor.ok) {
    throw repoUpdateError('skipped', 'fetched update is not a fast-forward from the current repo commit', {
      fromCommit,
      toCommit: fetchedCommit,
      branchSwitchedFrom,
      error: 'not fast-forward'
    });
  }
  if (fromCommit !== fetchedCommit) {
    const merge = fastForwardRepository(args, repoPath, branch, expectedRemote, fromCommit, fetchedCommit);
    if (!merge.ok) {
      throw repoUpdateError('skipped', `git merge --ff-only FETCH_HEAD failed: ${commandOutput(merge)}`, {
        fromCommit,
        toCommit: fetchedCommit,
        branchSwitchedFrom,
        error: 'fast-forward failed'
      });
    }
  }
  const toCommit = requireGit(repoPath, ['rev-parse', 'HEAD'], 'read updated commit');
  const changedFiles = changedFilesBetween(repoPath, fromCommit, toCommit);
  let validation = null;
  try {
    validation = runRepositoryValidation(args, repoPath, { hookMode: args.hook === true });
  } catch (error) {
    throw repoUpdateError(error.repoUpdateStatus || 'validation-failed', error.message, {
      fromCommit,
      toCommit,
      changedFiles,
      branchSwitchedFrom,
      error: error.repoUpdateDetails?.error || error.message,
      validationStatus: error.repoUpdateDetails?.validationStatus || 'failed',
      validationCommand: error.repoUpdateDetails?.validationCommand || ''
    });
  }
  const verifiedSourceReceipt = createVerifiedSourceReceipt({
    repoPath,
    branch,
    remote: expectedRemote,
    validation
  });
  return {
    repoPath,
    fromCommit,
    toCommit,
    changedFiles,
    branchSwitchedFrom,
    validation,
    verifiedSourceReceipt,
    status: fromCommit === toCommit ? 'up-to-date' : 'updated'
  };
}

function compareSemver(left, right) {
  const a = String(left || '0.0.0').split('.').map((part) => Number(part) || 0);
  const b = String(right || '0.0.0').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function isValidBridgeVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(value || ''));
}

function compareBridgeVersions(left, right) {
  const leftParts = String(left).split('.').map((part) => BigInt(part));
  const rightParts = String(right).split('.').map((part) => BigInt(part));
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function assertRecognizedSyncSource(syncSource) {
  if (!SYNC_SOURCES.includes(syncSource)) {
    throw new Error(`Unsupported bridge sync source: ${syncSource || '<missing>'}`);
  }
}

function normalizeBridgeVersionsBySource(rawMap, legacyHubVersion, legacyLastSyncSource) {
  const normalized = {};
  const plainMap = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : null;
  if (plainMap) {
    for (const source of SYNC_SOURCES) {
      if (!Object.prototype.hasOwnProperty.call(plainMap, source)) continue;
      const version = plainMap[source];
      if (!isValidBridgeVersion(version)) {
        throw new Error(`Invalid bridge_versions_by_source.${source}: expected MAJOR.MINOR.PATCH`);
      }
      normalized[source] = version;
    }
  }

  if (
    !Object.keys(normalized).length &&
    SYNC_SOURCES.includes(legacyLastSyncSource) &&
    isValidBridgeVersion(legacyHubVersion)
  ) {
    normalized[legacyLastSyncSource] = legacyHubVersion;
  }
  return normalized;
}

function maximumBridgeVersion(existingHubVersion, versionsBySource) {
  let maximum = isValidBridgeVersion(existingHubVersion) ? existingHubVersion : '';
  for (const source of SYNC_SOURCES) {
    const version = versionsBySource?.[source];
    if (isValidBridgeVersion(version) && (!maximum || compareBridgeVersions(version, maximum) > 0)) maximum = version;
  }
  return maximum;
}

function defaultTargetState() {
  return {
    enabled: false,
    explicitly_disabled: false,
    detected: false,
    target_path: '',
    synced_version: '',
    synced_checksum: '',
    last_sync: '',
    skip_reason: 'not enabled'
  };
}

function defaultState() {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    architecture_version: ARCHITECTURE_VERSION,
    hub_version: '',
    bridge_versions_by_source: {},
    auto_sync_enabled: false,
    repo_auto_update_enabled: false,
    repo_path: '',
    repo_branch: DEFAULT_REPO_BRANCH,
    repo_remote: DEFAULT_REPO_REMOTE,
    last_repo_update: '',
    last_repo_update_status: '',
    last_repo_update_from_commit: '',
    last_repo_update_to_commit: '',
    last_repo_update_error: '',
    last_update_report_path: '',
    last_update_report_signature: '',
    update_report_enabled: true,
    update_report_open_enabled: false,
    update_report_open_behavior: 'action-required-only',
    legacy_update_report_open_migrated: false,
    update_report_retention_days: DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
    last_update_report_cleanup: null,
    codex_plugin_auto_refresh_enabled: false,
    created_at: '',
    updated_at: '',
    last_sync_source: '',
    targets: {
      opencode: defaultTargetState(),
      ag2: defaultTargetState()
    }
  };
}

function normalizedState(raw) {
  const state = { ...defaultState(), ...(raw || {}) };
  state.bridge_versions_by_source = normalizeBridgeVersionsBySource(
    raw?.bridge_versions_by_source,
    raw?.hub_version,
    raw?.last_sync_source
  );
  state.hub_version = isValidBridgeVersion(raw?.hub_version) ? raw.hub_version : '';
  state.targets = state.targets && typeof state.targets === 'object'
    ? JSON.parse(JSON.stringify(state.targets))
    : {};
  for (const target of SUPPORTED_TARGETS) {
    state.targets[target] = { ...defaultTargetState(), ...(state.targets[target] || {}) };
  }
  state.targets.ag2.python_command = state.targets.ag2.python_command || '';
  state.repo_branch = state.repo_branch || DEFAULT_REPO_BRANCH;
  state.repo_remote = state.repo_remote || DEFAULT_REPO_REMOTE;
  state.repo_path = state.repo_path || '';
  state.last_repo_update = state.last_repo_update || '';
  state.last_repo_update_status = state.last_repo_update_status || '';
  state.last_repo_update_from_commit = state.last_repo_update_from_commit || '';
  state.last_repo_update_to_commit = state.last_repo_update_to_commit || '';
  state.last_repo_update_error = state.last_repo_update_error || '';
  state.last_update_report_path = state.last_update_report_path || '';
  state.last_update_report_signature = state.last_update_report_signature || '';
  state.update_report_enabled = state.update_report_enabled !== false;
  state.legacy_update_report_open_migrated = raw?.update_report_open_enabled === true
    || raw?.legacy_update_report_open_migrated === true;
  state.update_report_open_enabled = false;
  state.update_report_open_behavior = 'action-required-only';
  state.update_report_retention_days = Number.isInteger(state.update_report_retention_days) && state.update_report_retention_days > 0
    ? state.update_report_retention_days
    : DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  state.last_update_report_cleanup = state.last_update_report_cleanup && typeof state.last_update_report_cleanup === 'object'
    ? state.last_update_report_cleanup
    : null;
  state.codex_plugin_auto_refresh_enabled = state.codex_plugin_auto_refresh_enabled === true;
  return state;
}

function applyRequestedState(state, args) {
  const next = normalizedState(state);
  if (args.enableAutoSync) next.auto_sync_enabled = true;
  if (args.disableAutoSync) next.auto_sync_enabled = false;
  if (args.repoPath) next.repo_path = path.resolve(args.repoPath);
  if (args.repoBranch) next.repo_branch = args.repoBranch;
  if (args.repoRemote) next.repo_remote = args.repoRemote;
  if (args.enableRepoAutoUpdate) {
    next.repo_auto_update_enabled = true;
    next.last_repo_update_status = 'configured';
    next.last_repo_update_error = '';
  }
  if (args.disableRepoAutoUpdate) {
    next.repo_auto_update_enabled = false;
    next.last_repo_update_status = 'disabled';
    next.last_repo_update_error = '';
  }
  if (args.enableUpdateReportOpen || args.disableUpdateReportOpen) next.update_report_open_enabled = false;
  if (args.enableUpdateReports) next.update_report_enabled = true;
  if (args.disableUpdateReports) next.update_report_enabled = false;
  if (args.updateReportRetentionDaysExplicit) next.update_report_retention_days = args.updateReportRetentionDays;
  if (args.enableCodexPluginAutoRefresh) next.codex_plugin_auto_refresh_enabled = true;
  if (args.disableCodexPluginAutoRefresh) next.codex_plugin_auto_refresh_enabled = false;
  if (args.setAg2PythonCommand) {
    next.targets.ag2.python_command = args.setAg2PythonCommand;
  }
  for (const target of args.enableTargets) {
    next.targets[target].enabled = true;
    next.targets[target].explicitly_disabled = false;
  }
  for (const target of args.disableTargets) {
    next.targets[target].enabled = false;
    next.targets[target].explicitly_disabled = true;
    next.targets[target].skip_reason = 'explicitly disabled';
  }
  return next;
}

function discoverOpenCode(args, targetState, hubPath) {
  const envConfig = args.opencodeConfigDir || process.env.OPENCODE_CONFIG_DIR || '';
  const homeConfig = path.join(os.homedir(), '.config', 'opencode');
  const configDir = envConfig || homeConfig;
  const internalAdapterPath = path.join(hubPath, 'adapters', 'opencode');
  const persistedState = Boolean(
    targetState.detected ||
    targetState.target_path ||
    targetState.synced_version ||
    targetState.synced_checksum ||
    targetState.last_sync
  );
  const defaultTarget = path.join(configDir, 'skills');
  const requestedTarget = args.opencodeTarget || targetState.target_path || defaultTarget;
  const configuredTarget = normalizeOpenCodeTargetPath(requestedTarget, defaultTarget);
  const command = commandProbe(args.opencodeCommand, ['--version']);
  const configExists = fs.existsSync(configDir);
  const targetExists = fs.existsSync(configuredTarget);
  const migratedTargetPath = path.resolve(configuredTarget) !== path.resolve(requestedTarget);
  const explicitlyEnabled = targetState.enabled === true;
  const detected = command.ok || Boolean(envConfig) || configExists || targetExists || explicitlyEnabled || persistedState;
  return {
    target: 'opencode',
    detected,
    target_path: configuredTarget,
    internal_adapter_path: internalAdapterPath,
    signals: {
      command_ok: command.ok,
      command_output: command.output,
      env_config_dir: Boolean(envConfig),
      config_dir: configDir,
      config_dir_exists: configExists,
      target_exists: targetExists,
      migrated_target_path: migratedTargetPath,
      requested_target_path: requestedTarget,
      persisted_state: persistedState,
      explicitly_enabled: explicitlyEnabled
    }
  };
}

function normalizeOpenCodeTargetPath(targetPath, defaultTarget) {
  const raw = String(targetPath || '').trim();
  if (!raw) return defaultTarget;
  const resolved = path.resolve(raw);
  if (
    path.basename(resolved) === TOOLKIT_NAME &&
    path.basename(path.dirname(resolved)) === 'skills'
  ) {
    return path.dirname(resolved);
  }
  return raw;
}

function readDirectoryNames(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readDirectoryFileNames(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isValidSkillName(name) {
  return SKILL_NAME_PATTERN.test(String(name || ''));
}

function ag2EnvPythonCandidates() {
  const candidates = [];
  if (process.env.UV_PYTHON) candidates.push(process.env.UV_PYTHON);
  if (process.env.VIRTUAL_ENV) {
    candidates.push(path.join(process.env.VIRTUAL_ENV, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'));
  }
  if (process.env.CONDA_PREFIX) {
    candidates.push(path.join(process.env.CONDA_PREFIX, process.platform === 'win32' ? 'python.exe' : 'bin/python'));
  }
  return candidates;
}

function windowsUserPythonCandidates() {
  if (process.platform !== 'win32') return [];
  const candidates = [];
  const home = os.homedir();
  if (home) {
    const localBin = path.join(home, '.local', 'bin');
    for (const fileName of readDirectoryFileNames(localBin)
      .filter((name) => /^python.*\.exe$/i.test(name))
      .sort((left, right) => left.localeCompare(right))) {
      candidates.push(path.join(localBin, fileName));
    }
    const pyenvRoot = path.join(home, '.pyenv', 'pyenv-win', 'versions');
    for (const version of readDirectoryNames(pyenvRoot)) {
      candidates.push(path.join(pyenvRoot, version, 'python.exe'));
    }
  }
  const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
  if (localAppData) {
    const pythonRoot = path.join(localAppData, 'Programs', 'Python');
    for (const version of readDirectoryNames(pythonRoot)) {
      candidates.push(path.join(pythonRoot, version, 'python.exe'));
    }
  }
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function uniqueCommandCandidates(commands) {
  const seen = new Set();
  const result = [];
  for (const command of commands.map((item) => String(item || '').trim()).filter(Boolean)) {
    const key = process.platform === 'win32' ? command.toLowerCase() : command;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(command);
  }
  return result;
}

function ag2PythonCandidates(args, targetState) {
  return uniqueCommandCandidates([
    targetState.python_command,
    args.pythonCommand,
    'python',
    'python3',
    'py',
    ...ag2EnvPythonCandidates(),
    ...windowsUserPythonCandidates()
  ]);
}

function probeAg2Python(command) {
  const python = commandProbe(command, ['--version']);
  const ag2Package = python.ok ? commandProbe(command, ['-m', 'pip', 'show', 'ag2']) : {
    ok: false,
    output: '',
    status: null,
    error: 'python command did not run'
  };
  return {
    command,
    python_ok: python.ok,
    python_output: python.output,
    python_status: python.status,
    python_error: python.error || '',
    ag2_package_ok: ag2Package.ok,
    ag2_package_output: ag2Package.output,
    ag2_package_status: ag2Package.status,
    ag2_package_error: ag2Package.error || ''
  };
}

function discoverAg2(args, targetState, hubPath) {
  const candidates = ag2PythonCandidates(args, targetState);
  const tried = [];
  let selected = null;
  for (const candidate of candidates) {
    const attempt = probeAg2Python(candidate);
    tried.push(attempt);
    if (attempt.python_ok && attempt.ag2_package_ok) {
      selected = attempt;
      break;
    }
  }
  const internalAdapterPath = path.join(hubPath, 'adapters', 'ag2');
  const home = os.homedir();
  const ag2ConfigDir = home ? path.join(home, '.antigravity') : '';
  const geminiConfigDir = home ? path.join(home, '.gemini', 'config') : '';
  const savedTargetPath = String(targetState.target_path || '');
  const savedSkillsTargetPath = String(targetState.skills_target_path || '');
  const supportedDiscovery = targetState.discovery_authority === 'supported-read-only-evidence'
    && targetState.destination_kind === 'supported-skills-directory'
    && targetState.skills_only === true
    && targetState.plugin_authority === false
    && savedSkillsTargetPath.length > 0;
  const targetPath = supportedDiscovery ? savedSkillsTargetPath : '';
  const ag2ConfigExists = Boolean(ag2ConfigDir && fs.existsSync(ag2ConfigDir));
  const geminiConfigExists = Boolean(geminiConfigDir && fs.existsSync(geminiConfigDir));
  const managedAdapterExists = fs.existsSync(internalAdapterPath);
  const appTargetExists = Boolean(targetPath && fs.existsSync(targetPath));
  const persistedState = Boolean(
    targetState.detected ||
    targetState.target_path ||
    targetState.synced_version ||
    targetState.synced_checksum ||
    targetState.last_sync
  );
  const explicitlyEnabled = targetState.enabled === true;
  const ag2PackageDetected = Boolean(selected);
  const detected = (
    ag2PackageDetected ||
    ag2ConfigExists ||
    geminiConfigExists ||
    managedAdapterExists ||
    appTargetExists ||
    persistedState ||
    explicitlyEnabled
  );
  return {
    target: 'ag2',
    detected,
    target_path: targetPath,
    legacy_target_path: savedTargetPath,
    internal_adapter_path: internalAdapterPath,
    python_command: selected?.command || '',
    ag2_package_detected: ag2PackageDetected,
    projection_proof: ag2SkillsProjectionProof({
      discovery: {
        supported: supportedDiscovery,
        destination_kind: targetState.destination_kind,
        target_path: targetPath,
        skills_only: targetState.skills_only,
        plugin_authority: targetState.plugin_authority
      }
    }),
    signals: {
      selected_python_command: selected?.command || '',
      tried_python_commands: tried,
      ag2_config_dir: ag2ConfigDir,
      ag2_config_exists: ag2ConfigExists,
      gemini_config_dir: geminiConfigDir,
      gemini_config_exists: geminiConfigExists,
      managed_adapter_exists: managedAdapterExists,
      app_target_exists: appTargetExists,
      projection_discovery_supported: supportedDiscovery,
      persisted_state: persistedState,
      explicitly_enabled: explicitlyEnabled
    }
  };
}

function hasToolkitSkillSource(sourceRoot) {
  const skillsRoot = path.join(sourceRoot, 'skills');
  return fs.existsSync(skillsRoot) && fs.statSync(skillsRoot).isDirectory();
}

function hasGitMetadata(sourceRoot) {
  return fs.existsSync(path.join(sourceRoot, '.git'));
}

function isTrustedGitWorktree(sourceRoot) {
  if (hasGitMetadata(sourceRoot)) return true;
  const result = gitCommand(sourceRoot, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
  return result.ok && result.stdout.trim() === 'true';
}

function resolveToolkitSourceRoot(state = {}) {
  if (state.repo_path) {
    const repoPath = path.resolve(state.repo_path);
    if (!hasToolkitSkillSource(repoPath)) {
      throw new Error(`configured Toolkit repo_path does not contain skills/: ${repoPath}`);
    }
    if (!isTrustedGitWorktree(repoPath)) {
      throw new Error(`configured Toolkit repo_path is not a git worktree: ${repoPath}`);
    }
    return repoPath;
  }

  const scriptRoot = pluginRootFromCwd() || path.resolve(__dirname, '..', '..');
  if (hasToolkitSkillSource(scriptRoot) && isTrustedGitWorktree(scriptRoot)) return scriptRoot;

  throw new Error(
    'Toolkit full skill sync requires a trusted local Toolkit git repo source; run the bridge from the repo or configure repo auto-update with --repo-path.'
  );
}

function collectFilesRecursively(rootDir) {
  const files = {};

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = slash(path.relative(rootDir, fullPath));
      files[relPath] = fs.readFileSync(fullPath);
    }
  }

  walk(rootDir);
  return files;
}

function collectToolkitSkills(sourceRoot) {
  const skillsRoot = path.join(sourceRoot, 'skills');
  const skills = {};
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!isValidSkillName(entry.name)) continue;
    const skillRoot = path.join(skillsRoot, entry.name);
    if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) continue;
    if (entry.name === TOOLKIT_NAME) {
      throw new Error(`Toolkit repo skills/ contains reserved bridge adapter skill name: ${TOOLKIT_NAME}`);
    }
    skills[entry.name] = collectFilesRecursively(skillRoot);
  }
  return skills;
}

function textPayload(text) {
  return Buffer.from(text, 'utf8');
}

function targetManifestPayload(targetName, skillNames) {
  return textPayload(`${JSON.stringify({
    managed_by: TARGET_MANIFEST_MARKER,
    schema_version: 1,
    target: targetName,
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    managed_skill_names: [...skillNames].sort()
  }, null, 2)}\n`);
}

function addSkillToPayload(payload, skillName, files, prefix = 'skills') {
  for (const [relPath, content] of Object.entries(files)) {
    payload[`${prefix}/${skillName}/${relPath}`] = Buffer.isBuffer(content) ? content : textPayload(String(content));
  }
}

function adapterPayloads(state = {}, sourceRoot = resolveToolkitSourceRoot(state)) {
  const toolkitSkills = collectToolkitSkills(sourceRoot);
  const toolkitSkillNames = Object.keys(toolkitSkills).sort();
  const opencodeSkill = [
    '---',
    'name: ai-agent-toolkit',
    'description: Use when working in OpenCode with the AI Agent Toolkit local bridge. Applies source-first policy, opt-in bridge setup, and audit/sync commands without using Codex or Claude private plugin caches.',
    '---',
    '',
    '# AI Agent Toolkit Bridge',
    '',
    'Use this skill when OpenCode needs Toolkit policy, bridge audit, or enabled-target sync guidance.',
    '',
    'Core rules:',
    '',
    '- Treat AGENTS.md and Toolkit skills/docs as portable policy. Hooks are optional automation only.',
    '- Do not install or update Codex or Claude Code from OpenCode.',
    '- Do not read Codex or Claude private plugin cache paths as bridge source.',
    '- Do not install npm, pip, Python, AG2, OpenCode, or any package by default.',
    '- Do not mutate project repos by default.',
    '- Use the Toolkit Local Bridge Hub manifest and state files under the user-local hub.',
    '',
    'Useful commands:',
    '',
    '```powershell',
    'node repo/scripts/toolkit-local-bridge.cjs --audit',
    'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    '```',
    ''
  ].join('\n');

  const opencodeReadme = [
    '# AI Agent Toolkit OpenCode Adapter',
    '',
    'Generated by the Toolkit Local Bridge Hub after the user explicitly enables the OpenCode target.',
    '',
    'This folder is safe to load from the OpenCode global skills directory. It is not source of truth. Update Toolkit through the native Codex or Claude Code plugin package and let the bridge sync enabled targets.',
    ''
  ].join('\n');

  const ag2Readme = [
    '# AI Agent Toolkit AG2 Skills Projection',
    '',
    'Generated by the Toolkit Local Bridge Hub only after supported read-only AG2 skills-directory discovery.',
    '',
    'This directory contains skills only. It is not a Toolkit plugin and it is not source of truth. The bridge must retain existing delivery and stop with AG2_PROOF_UNAVAILABLE when supported discovery is absent.',
    ''
  ].join('\n');

  const ag2Skill = [
    '---',
    `name: ${TOOLKIT_NAME}`,
    'description: Use when AG2 has a supported skills-only projection of the AI Agent Toolkit. Applies source-first policy without plugin authority.',
    '---',
    '',
    '# AI Agent Toolkit AG2 Adapter',
    '',
    'Use this skill when AG2 needs Toolkit policy, bridge audit, or enabled-target sync guidance.',
    '',
    'Core rules:',
    '',
    '- Treat AGENTS.md and Toolkit skills/docs as portable policy. Hooks are optional automation only.',
    '- Do not install or update Codex, Claude Code, AG2, or any package from this projection.',
    '- Do not read Codex or Claude private plugin cache paths as bridge source.',
    '- Do not infer an AG2 destination or plugin installation from package presence.',
    '- Do not mutate project repos by default.',
    '- Use the Toolkit Local Bridge Hub manifest and state files under the user-local hub.',
    '',
    'Useful commands:',
    '',
    '```powershell',
    'node repo/scripts/toolkit-local-bridge.cjs --audit',
    'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    '```',
    ''
  ].join('\n');

  const adapterFiles = {
    'SKILL.md': textPayload(opencodeSkill),
    'README.md': textPayload(opencodeReadme)
  };
  const ag2AdapterFiles = {
    'SKILL.md': textPayload(ag2Skill),
    'README.md': textPayload(ag2Readme)
  };
  const managedSkillNames = [TOOLKIT_NAME, ...toolkitSkillNames].sort();
  const opencodePayload = {
    [TARGET_MANIFEST_FILE]: targetManifestPayload('opencode', managedSkillNames)
  };
  const ag2Payload = {
    'README.md': textPayload(ag2Readme),
    [TARGET_MANIFEST_FILE]: targetManifestPayload('ag2', managedSkillNames)
  };

  for (const [skillName, files] of Object.entries(toolkitSkills)) {
    addSkillToPayload(opencodePayload, skillName, files);
    addSkillToPayload(ag2Payload, skillName, files);
  }
  addSkillToPayload(opencodePayload, TOOLKIT_NAME, adapterFiles);
  addSkillToPayload(ag2Payload, TOOLKIT_NAME, ag2AdapterFiles);

  return {
    opencode: opencodePayload,
    ag2: ag2Payload
  };
}

function payloadBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function payloadChecksum(payloads) {
  const hash = crypto.createHash('sha256');
  for (const target of Object.keys(payloads).sort()) {
    for (const rel of Object.keys(payloads[target]).sort()) {
      hash.update(target);
      hash.update('\0');
      hash.update(rel);
      hash.update('\0');
      hash.update(payloadBytes(payloads[target][rel]));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

function filePayloadChecksum(payload) {
  const hash = crypto.createHash('sha256');
  for (const rel of Object.keys(payload).sort()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(payloadBytes(payload[rel]));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function appTargetPayload(targetName, payloads) {
  if (targetName === 'opencode') {
    const prefix = 'skills/';
    return Object.fromEntries(Object.entries(payloads.opencode)
      .map(([rel, text]) => [rel.startsWith(prefix) ? rel.slice(prefix.length) : rel, text]));
  }
  if (targetName === 'ag2') return payloads.ag2;
  throw new Error(`Unsupported target: ${targetName}`);
}

function targetSkillNames(targetName, payloads) {
  const names = new Set();
  const payload = appTargetPayload(targetName, payloads);
  for (const rel of Object.keys(payload)) {
    const normalized = slash(rel);
    if (targetName === 'ag2') {
      const match = normalized.match(/^skills\/([^/]+)\//);
      if (match && isValidSkillName(match[1])) names.add(match[1]);
      continue;
    }
    const first = normalized.split('/')[0];
    if (first && isValidSkillName(first)) names.add(first);
  }
  return [...names].sort();
}

function readManagedTargetManifest(targetPath) {
  const manifest = readJsonIfExists(path.join(targetPath, TARGET_MANIFEST_FILE));
  if (!manifest || manifest.managed_by !== TARGET_MANIFEST_MARKER) return null;
  return manifest;
}

function previousManagedSkillNames(targetPath) {
  const manifest = readManagedTargetManifest(targetPath);
  if (!manifest || !Array.isArray(manifest.managed_skill_names)) return [];
  return manifest.managed_skill_names
    .map((name) => String(name || '').trim())
    .filter(isValidSkillName)
    .sort();
}

function targetHasNoStaleManagedSkills(targetName, targetPath, payloads) {
  if (!targetPath) return false;
  const previous = previousManagedSkillNames(targetPath);
  if (!previous.length) return true;
  const current = new Set(targetSkillNames(targetName, payloads));
  return previous.every((name) => current.has(name));
}

function targetOutputChecksum(targetPath, payload) {
  if (!targetPath) return '';
  const actual = {};
  for (const rel of Object.keys(payload)) {
    const filePath = path.join(targetPath, rel);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return '';
    actual[rel] = fs.readFileSync(filePath);
  }
  return filePayloadChecksum(actual);
}

function targetOutputIsCurrent(targetName, discovery, payloads) {
  const payload = appTargetPayload(targetName, payloads);
  return (
    targetOutputChecksum(discovery.target_path, payload) === filePayloadChecksum(payload) &&
    targetHasNoStaleManagedSkills(targetName, discovery.target_path, payloads)
  );
}

function targetOutputExists(targetName, discovery, payloads) {
  const payload = appTargetPayload(targetName, payloads);
  if (!discovery.target_path) return false;
  return Object.keys(payload).every((rel) => fs.existsSync(path.join(discovery.target_path, rel)));
}

function pluginRootFromCwd() {
  let current = __dirname;
  for (let index = 0; index < 6; index += 1) {
    if (fs.existsSync(path.join(current, '.codex-plugin'))) return current;
    if (fs.existsSync(path.join(current, '.claude-plugin'))) return current;
    current = path.dirname(current);
  }
  return '';
}

function currentToolkitCommit(state = {}) {
  const root = state.repo_path ? path.resolve(state.repo_path) : (pluginRootFromCwd() || path.resolve(__dirname, '..', '..'));
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function updateReportDir() {
  return path.join(os.tmpdir(), ...UPDATE_REPORT_ROOT.split('/'));
}

function cleanupUpdateReports(options = {}) {
  const reportDir = path.resolve(options.reportDir || updateReportDir());
  const expectedDir = path.resolve(options.expectedDir || updateReportDir());
  const retentionDays = Number.isInteger(options.retentionDays) && options.retentionDays > 0
    ? options.retentionDays
    : DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  const maxReports = Number.isInteger(options.maxReports) && options.maxReports > 0
    ? options.maxReports
    : DEFAULT_UPDATE_REPORT_MAX_FILES;
  const nowMs = options.nowMs || Date.now();
  const cutoffMs = nowMs - (retentionDays * 24 * 60 * 60 * 1000);
  const currentRunPath = options.currentRunPath ? path.resolve(options.currentRunPath) : '';
  const result = {
    retention_days: retentionDays,
    report_log_directory: reportDir,
    max_report_files: maxReports,
    deleted_count: 0,
    skipped_count: 0,
    error_count: 0,
    errors: []
  };

  if (reportDir !== expectedDir || !isInside(expectedDir, reportDir)) {
    result.error_count += 1;
    result.errors.push(`refusing cleanup outside Toolkit report directory: ${reportDir}`);
    return result;
  }
  if (Array.isArray(options.candidatePaths)) {
    for (const candidate of options.candidatePaths) {
      const filePath = path.resolve(candidate);
      if (!isInside(reportDir, filePath) || !/^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(path.basename(filePath))) {
        result.error_count += 1;
        result.errors.push(`refusing unbound report cleanup candidate: ${filePath}`);
        continue;
      }
      try {
        if (!fs.existsSync(filePath)) {
          result.skipped_count += 1;
          continue;
        }
        if (!fs.statSync(filePath).isFile()) throw new Error('candidate is not a regular file');
        if (options.beforeDelete) options.beforeDelete({ filePath, reportDir });
        fs.rmSync(filePath);
        result.deleted_count += 1;
      } catch (error) {
        result.error_count += 1;
        result.errors.push(`${filePath}: ${error.message}`);
      }
    }
    return result;
  }
  if (!fs.existsSync(reportDir)) return result;

  let entries = [];
  try {
    entries = fs.readdirSync(reportDir, { withFileTypes: true });
  } catch (error) {
    result.error_count += 1;
    result.errors.push(error.message);
    return result;
  }

  const retainedReports = [];
  for (const entry of entries) {
    const filePath = path.join(reportDir, entry.name);
    if (!entry.isFile() || !/^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(entry.name)) {
      result.skipped_count += 1;
      continue;
    }
    if (currentRunPath && path.resolve(filePath) === currentRunPath) {
      result.skipped_count += 1;
      continue;
    }
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs >= cutoffMs) retainedReports.push({ filePath, mtimeMs: stat.mtimeMs });
      else {
        fs.rmSync(filePath);
        result.deleted_count += 1;
      }
    } catch (error) {
      result.error_count += 1;
      result.errors.push(`${filePath}: ${error.message}`);
    }
  }

  retainedReports.sort((left, right) => (
    right.mtimeMs - left.mtimeMs ||
    right.filePath.localeCompare(left.filePath)
  ));
  retainedReports.forEach((entry, index) => {
    if (index < maxReports) {
      result.skipped_count += 1;
      return;
    }
    try {
      fs.rmSync(entry.filePath);
      result.deleted_count += 1;
    } catch (error) {
      result.error_count += 1;
      result.errors.push(`${entry.filePath}: ${error.message}`);
    }
  });

  return result;
}

function runAuthorisedUpdateReportCleanup(args, state) {
  if (
    args.write !== true ||
    !actionAuthorised(args, 'report.cleanup')
  ) {
    return state.last_update_report_cleanup || null;
  }
  validatePhaseContext(args.phaseContext);
  if (args.phaseContext.report_inventory_error) {
    if (!args.hook) console.warn(`Toolkit update report cleanup warning: ${sanitizeOutputMessage(args.phaseContext.report_inventory_error)}; no cleanup performed`);
    return state.last_update_report_cleanup || null;
  }
  const candidatePaths = (args.phaseContext.report_candidates || []).map((value) => path.resolve(value));
  const reportDir = path.resolve(args.executionAuthority.bindings.report_directory);
  const cleanupResult = {
    retention_days: state.update_report_retention_days,
    report_log_directory: reportDir,
    max_report_files: DEFAULT_UPDATE_REPORT_MAX_FILES,
    deleted_count: 0,
    skipped_count: 0,
    error_count: 0,
    errors: []
  };
  for (const filePath of candidatePaths) {
    try {
      if (!isInside(reportDir, filePath) || !/^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(path.basename(filePath))) {
        throw new Error('report cleanup deletion operand does not match invocation authority');
      }
      if (!fs.existsSync(filePath)) {
        cleanupResult.skipped_count += 1;
        continue;
      }
      const identity = filesystemIdentity(filePath, 'file');
      if (!identity) throw new Error('candidate is not a regular file');
      if (args.testHooks?.beforeReportCleanupDelete) args.testHooks.beforeReportCleanupDelete({ filePath, reportDir });
      const mutationOptions = { details: { candidate_paths: candidatePaths, path: filePath } };
      admitActionSpecificEffect(args, 'report.cleanup', mutationOptions);
      if (canonicalJson(filesystemIdentity(filePath, 'file')) !== canonicalJson(identity)) throw new Error('report cleanup candidate identity changed before delete');
      fs.rmSync(filePath, { force: false });
      if (fs.existsSync(filePath)) throw new Error('report cleanup postcondition failed');
      cleanupResult.deleted_count += 1;
    } catch (error) {
      cleanupResult.error_count += 1;
      cleanupResult.errors.push(`${filePath}: ${error.message}`);
    }
  }
  if (cleanupResult.error_count && !args.hook) {
    console.warn(`Toolkit update report cleanup warning: ${cleanupResult.errors.map(sanitizeOutputMessage).join('; ')}`);
  }
  return cleanupResult;
}

function updateReportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function nextUpdateReportPath(date = new Date()) {
  const reportDir = updateReportDir();
  const baseName = `toolkit-update-${updateReportTimestamp(date)}`;
  let candidate = path.join(reportDir, `${baseName}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(reportDir, `${baseName}-${index}.md`);
    index += 1;
  }
  return candidate;
}

function isUpdateReportPath(reportPath, options = {}) {
  const resolved = path.resolve(reportPath || '');
  const reportDir = path.resolve(options.reportDir || updateReportDir());
  const fileName = path.basename(resolved);
  return (
    isInside(reportDir, resolved) &&
    /^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(fileName) &&
    fs.existsSync(resolved) &&
    fs.statSync(resolved).isFile()
  );
}

function openUpdateReport(reportPath, options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const resolved = path.resolve(reportPath || '');
  if (platform !== 'win32') return { ok: false, skipped: 'not-windows' };
  if (!isUpdateReportPath(resolved, { reportDir: options.reportDir })) return { ok: false, skipped: 'unsafe-report-path' };
  try {
    if (options.expectedIdentity && canonicalJson(updateReportFileIdentity(resolved)) !== canonicalJson(options.expectedIdentity)) {
      return { ok: false, skipped: 'report-identity-changed' };
    }
    const child = spawnImpl('notepad.exe', [resolved], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    if (child && typeof child.unref === 'function') child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function updateReportFileIdentity(reportPath) {
  const resolved = path.resolve(reportPath || '');
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('created update report is no longer an ordinary file');
  return {
    path: resolved,
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtime_ms: String(stat.birthtimeMs),
    size: stat.size,
    sha256: sha256(fs.readFileSync(resolved))
  };
}

function verifyCreatedUpdateReport(args, reportPath) {
  if (!args.createdReportIdentity) throw new Error('created update report identity is unavailable');
  const actual = updateReportFileIdentity(reportPath);
  if (canonicalJson(actual) !== canonicalJson(args.createdReportIdentity)) {
    throw new Error('created update report was replaced or changed before open');
  }
}

function inlineCode(value) {
  return `\`${String(value || '').replace(/`/g, "'")}\``;
}

function normalizeManagedBlockText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function markerIdentity(source, label) {
  return `${source}::${label}`;
}

function parseManagedMarkerBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const markerPattern = /^\s*<!--\s*AI-AGENT-TOOLKIT:(.+?):(BEGIN|END)\s+(.+?)\s*-->\s*$/;
  const blocks = new Map();
  const errors = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*<!--\s*AI-AGENT-TOOLKIT:/.test(line)) continue;
    const match = line.match(markerPattern);
    if (!match) {
      errors.push(`line ${index + 1}: malformed AI-AGENT-TOOLKIT managed marker`);
      continue;
    }
    const source = match[1].trim();
    const action = match[2];
    const rawLabel = match[3].trim();
    const label = action === 'BEGIN' ? rawLabel.replace(/\s+v\d+$/i, '').trim() : rawLabel;
    const key = markerIdentity(source, label);

    if (action === 'BEGIN') {
      if (current) {
        errors.push(`line ${index + 1}: nested managed marker before END for ${current.label}`);
        continue;
      }
      current = {
        source,
        label,
        key,
        startLine: index
      };
      continue;
    }

    if (!current) {
      errors.push(`line ${index + 1}: END marker without matching BEGIN for ${label}`);
      continue;
    }
    if (current.source !== source || current.label !== label) {
      errors.push(`line ${index + 1}: END marker ${label} does not match BEGIN ${current.label}`);
      current = null;
      continue;
    }
    if (blocks.has(key)) {
      errors.push(`line ${index + 1}: duplicate managed block ${label}`);
      current = null;
      continue;
    }
    const blockText = lines.slice(current.startLine, index + 1).join('\n');
    blocks.set(key, {
      source,
      label,
      key,
      startLine: current.startLine + 1,
      endLine: index + 1,
      text: normalizeManagedBlockText(blockText)
    });
    current = null;
  }

  if (current) errors.push(`line ${current.startLine + 1}: BEGIN marker without matching END for ${current.label}`);
  return { blocks, errors };
}

function agentRulesPreflightSpecs(syncSource) {
  return AGENT_RULES_PREFLIGHT_FILES[syncSource] || [];
}

function nearestGitRoot(startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

function agentRulesPluginRoot(args, options = {}) {
  if (options.pluginRoot) return path.resolve(options.pluginRoot);
  if (args.syncSource === 'claude-plugin') return runtimeClaudePluginRoot();
  return runtimeCodexPluginRoot();
}

function compareAgentRuleFile({ targetRoot, templateRoot, spec }) {
  const targetPath = path.join(targetRoot, spec.target);
  const templatePath = path.join(templateRoot, spec.template);
  if (!fs.existsSync(templatePath)) {
    return [{
      file: spec.target,
      kind: 'template-missing',
      detail: `bundled template missing: ${slash(templatePath)}`
    }];
  }
  const template = parseManagedMarkerBlocks(fs.readFileSync(templatePath, 'utf8'));
  if (template.errors.length) {
    return template.errors.map((error) => ({
      file: spec.target,
      kind: 'template-broken',
      detail: error
    }));
  }
  if (!fs.existsSync(targetPath)) {
    return [{
      file: spec.target,
      kind: 'missing',
      detail: 'required instruction file is missing'
    }];
  }
  if (!fs.statSync(targetPath).isFile()) {
    return [{
      file: spec.target,
      kind: 'not-file',
      detail: 'required instruction path is not a file'
    }];
  }
  const target = parseManagedMarkerBlocks(fs.readFileSync(targetPath, 'utf8'));
  if (target.errors.length) {
    return target.errors.map((error) => ({
      file: spec.target,
      kind: 'broken-marker',
      detail: error
    }));
  }
  if (target.blocks.size === 0) {
    return [{
      file: spec.target,
      kind: 'unmanaged',
      detail: 'no complete AI-AGENT-TOOLKIT managed marker pair found'
    }];
  }

  const findings = [];
  for (const [key, templateBlock] of template.blocks) {
    const targetBlock = target.blocks.get(key);
    if (!targetBlock) {
      findings.push({
        file: spec.target,
        kind: 'missing-block',
        block: templateBlock.label,
        detail: `missing managed block ${templateBlock.label}`
      });
      continue;
    }
    if (targetBlock.text !== templateBlock.text) {
      findings.push({
        file: spec.target,
        kind: 'stale-block',
        block: templateBlock.label,
        detail: `managed block ${templateBlock.label} differs from the bundled template`
      });
    }
  }
  return findings;
}

function runAgentRulesPreflight(args, options = {}) {
  if (!args.hook) return { status: 'not-applicable', targetRoot: '', findings: [] };
  const specs = agentRulesPreflightSpecs(args.syncSource);
  if (!specs.length) return { status: 'not-applicable', targetRoot: '', findings: [] };

  const startRoot = path.resolve(options.targetRoot || process.cwd());
  const gitRoot = nearestGitRoot(startRoot);
  const targetRoot = gitRoot || startRoot;
  const pluginRoot = agentRulesPluginRoot(args, options);
  const templateRoot = path.join(pluginRoot, AGENT_RULES_TEMPLATE_DIR);
  const findings = [];
  for (const spec of specs) {
    findings.push(...compareAgentRuleFile({ targetRoot, templateRoot, spec }));
  }
  return {
    status: findings.length ? 'needs-attention' : 'ok',
    targetRoot,
    gitRoot,
    gitRepoDetected: Boolean(gitRoot),
    pluginRoot,
    templateRoot,
    findings
  };
}

function formatAgentRulesPreflight(result) {
  const findings = result.findings || [];
  if (!findings.length) return '';
  const shown = findings.slice(0, AGENT_RULES_PREFLIGHT_MAX_FINDINGS);
  const missingRootAgents = Boolean(result.gitRepoDetected) &&
    findings.some((finding) => finding.file === 'AGENTS.md' && finding.kind === 'missing');
  const staleOrBrokenManagedContent = findings.some((finding) => [
    'broken-marker',
    'missing-block',
    'stale-block',
    'template-broken',
    'unmanaged'
  ].includes(finding.kind));
  const lines = [
    'Toolkit agent-rules preflight: repo-local instructions need attention in the current repository.',
    ...shown.map((finding) => `- ${finding.file}: ${finding.detail}`)
  ];
  if (missingRootAgents) {
    lines.unshift("STOP: Root AGENTS.md is missing. Toolkit repo-local repository-agent-rules are not installed in this Git repository. Stop before repository work. Ask the user whether to install/repair Toolkit repo-local rules now or proceed without Toolkit repo-local rules. Do not install, repair, create, or write anything without the user's decision.");
  } else if (staleOrBrokenManagedContent) {
    lines.unshift("STOP: Toolkit-managed repo-local instruction blocks are stale or broken. Stop before repository work. Ask the user whether to repair/refresh Toolkit repo-local rules now or proceed without current Toolkit repo-local rules. Do not repair, refresh, create backups, or write anything without the user's decision.");
  } else {
    lines.unshift("STOP: Toolkit repo-local instructions need attention. Stop before repository work. Ask the user whether to install/repair Toolkit repo-local rules now or proceed without current Toolkit repo-local rules. Do not install, repair, create backups, or write anything without the user's decision.");
  }
  if (findings.length > shown.length) {
    lines.push(`- ${findings.length - shown.length} more issue(s) omitted.`);
  }
  lines.push('No files were changed by this hook.');
  return lines.join('\n');
}

function maybePrintAgentRulesPreflight(args) {
  const result = runAgentRulesPreflight(args);
  const message = formatAgentRulesPreflight(result);
  if (message) console.log(message);
  return result;
}

function targetDisplayName(targetName) {
  if (targetName === 'ag2') return 'AG2 skills projection';
  if (targetName === 'opencode') return 'OpenCode';
  return targetName;
}

function targetSyncPlan(targetName, discovery, payloads) {
  const skillNames = targetSkillNames(targetName, payloads);
  const previousNames = previousManagedSkillNames(discovery.target_path);
  const current = new Set(skillNames);
  return {
    target: targetName,
    targetPath: discovery.target_path,
    skillNames,
    removedSkillNames: previousNames.filter((name) => !current.has(name)).sort((left, right) => left.localeCompare(right))
  };
}

function isLegacyDelegatedRepoSync(args) {
  return Boolean(
    args.skipRepoAutoUpdate &&
    args.syncSource === 'repo' &&
    args.syncEnabled &&
    args.write &&
    !args.hook &&
    !args.repoUpdateNow
  );
}

function repoReportContextFromState(state, args) {
  if (!isLegacyDelegatedRepoSync(args)) {
    return {
      status: '',
      fromCommit: '',
      toCommit: '',
      changedFiles: [],
      validationStatus: 'not run',
      error: ''
    };
  }
  const status = state.last_repo_update_status || '';
  const fromCommit = state.last_repo_update_from_commit || '';
  const toCommit = state.last_repo_update_to_commit || '';
  const changedFiles = state.repo_path && fromCommit && toCommit
    ? changedFilesBetween(state.repo_path, fromCommit, toCommit)
    : [];
  const validationStatus = status === 'validation-failed'
    ? 'failed'
    : (status && !state.last_repo_update_error ? 'passed' : 'not run');
  return {
    status,
    fromCommit,
    toCommit,
    changedFiles,
    validationStatus,
    error: state.last_repo_update_error || ''
  };
}

function repoReportContextFromUpdate(state, updateResult, previousObservedCommit = '') {
  const branch = state.repo_branch || DEFAULT_REPO_BRANCH;
  const remote = state.repo_remote || DEFAULT_REPO_REMOTE;
  const toCommit = updateResult.toCommit || '';
  const externalAdvanceDetected = Boolean(
    updateResult.status === 'up-to-date' &&
    previousObservedCommit &&
    toCommit &&
    previousObservedCommit !== toCommit
  );
  const externalChangedFiles = externalAdvanceDetected
    ? changedFilesBetween(updateResult.repoPath, previousObservedCommit, toCommit)
    : [];
  return {
    status: updateResult.status,
    repoPath: updateResult.repoPath || state.repo_path || '',
    fromCommit: updateResult.fromCommit,
    toCommit,
    changedFiles: externalAdvanceDetected ? externalChangedFiles : (updateResult.changedFiles || []),
    validationStatus: updateResult.validation?.status || 'passed',
    branch,
    branchSwitchedFrom: updateResult.branchSwitchedFrom || '',
    remote,
    externalAdvanceDetected,
    externalAdvanceFromCommit: externalAdvanceDetected ? previousObservedCommit : '',
    externalAdvanceToCommit: externalAdvanceDetected ? toCommit : ''
  };
}

function shouldConsiderUpdateReport(args, state) {
  return Boolean(
    state.update_report_enabled !== false &&
    !args.suppressUpdateReport &&
    (
      args.hook ||
      args.repoUpdateNow ||
      args.openUpdateReport ||
      isLegacyDelegatedRepoSync(args)
    )
  );
}

function classifyUpdateReport(context) {
  const repoStatus = context.repo?.status || '';
  const cacheStatus = context.nativePluginCache?.status || '';
  const repairStatus = context.thirdPartyHookRepair?.status || '';
  const targetStatus = context.targetSyncStatus || '';
  const actionable = repoStatus === 'validation-failed'
    || repoStatus === 'sync-delegation-failed'
    || (repoStatus === 'skipped' && Boolean(context.repo?.error))
    || ['stale', 'missing', 'user-disabled', 'refresh-failed'].includes(cacheStatus)
    || ['repair-failed', 'partial-failed'].includes(repairStatus)
    || ['failed', 'not confirmed'].includes(targetStatus)
    || Boolean(context.warning);
  const successfulActivity = Boolean(context.repo?.branchSwitchedFrom)
    || repoStatus === 'updated'
    || Boolean(context.repo?.externalAdvanceDetected)
    || cacheStatus === 'refreshed'
    || repairStatus === 'repaired'
    || (context.targetSyncs || []).length > 0
    || (context.targetSyncs || []).some((entry) => (entry.removedSkillNames || []).length > 0);
  return {
    meaningful: actionable || successfulActivity,
    actionable,
    kind: actionable ? 'action-required' : (successfulActivity ? 'successful-activity' : 'no-op'),
  };
}

function updateReportIsMeaningful(context) {
  return classifyUpdateReport(context).meaningful;
}

function shortCommit(value) {
  const text = String(value || '');
  if (!text || text === 'none') return 'none';
  return text.slice(0, 8);
}

function repoTldr(repo, previousCommit, commit, warning) {
  if (repo.branchSwitchedFrom && repo.status === 'up-to-date') return `auto-switched to ${inlineCode(repo.branch || 'configured branch')}; already up to date`;
  if (repo.branchSwitchedFrom && repo.status === 'updated') return `auto-switched to ${inlineCode(repo.branch || 'configured branch')}; updated from ${shortCommit(previousCommit)} to ${shortCommit(commit)}`;
  if (repo.status === 'updated') return `updated from ${shortCommit(previousCommit)} to ${shortCommit(commit)}`;
  if (repo.externalAdvanceDetected) return 'already updated before this hook run';
  if (repo.status === 'validation-failed') return `updated to ${shortCommit(commit)}, but validation failed`;
  if (repo.status === 'sync-delegation-failed') return 'updated, but target sync failed';
  if (repo.status === 'skipped' && isDirtyWorkingTreeWarning(warning)) return 'skipped (configured Toolkit source checkout is dirty)';
  if (repo.status === 'skipped') return warning ? `skipped (${warning})` : 'skipped safely';
  if (repo.status === 'up-to-date') return 'already up to date';
  return 'not updated in this run';
}
function targetsTldr(targetSyncs, targetSyncStatus) {
  if (targetSyncs.length) {
    return targetSyncs
      .map((sync) => `${targetDisplayName(sync.target)} (${sync.skillNames.length} skills)`)
      .join(', ')
      .replace(/^/, 'synced ');
  }
  if (targetSyncStatus === 'skipped') return 'sync skipped';
  return 'nothing to sync';
}

function branchMismatchSuggestion(warning) {
  return /branch mismatch/i.test(String(warning || ''))
    ? 'switch the Toolkit repo back to `main`, then restart Codex or rerun setup/sync'
    : '';
}

function isDirtyWorkingTreeWarning(warning) {
  return /dirty working tree/i.test(String(warning || ''));
}

function dirtyWorkingTreeSuggestion(warning) {
  return isDirtyWorkingTreeWarning(warning)
    ? 'finish or stash changes in the configured Toolkit source checkout, or run `setup toolkit` to use a dedicated clean `main` checkout for startup updates'
    : '';
}

function warningSuggestion(warning) {
  return branchMismatchSuggestion(warning) || dirtyWorkingTreeSuggestion(warning);
}

function actionTldr({ repo, nativePluginCache, thirdPartyHookRepair, warning, state }) {
  if (nativePluginCache.status === 'stale') {
    if (state.codex_plugin_auto_refresh_enabled) {
      return 'Codex auto-refresh is enabled and will retry on the next hook run';
    }
    return 'enable Codex plugin auto-refresh in setup, or run `setup toolkit`';
  }
  if (nativePluginCache.status === 'missing') return 'run `setup toolkit` to install and verify the Codex plugin';
  if (nativePluginCache.status === 'unverified') return 'run `setup toolkit` after the current Codex plugin configuration and installed state can be inspected';
  if (nativePluginCache.status === 'user-disabled') return 'enable the Toolkit plugin in Codex configuration before refreshing it';
  if (nativePluginCache.status === 'refresh-failed') return 'run `setup toolkit` to refresh the Codex plugin cache manually';
  if (['repair-failed', 'partial-failed'].includes(thirdPartyHookRepair.status)) return 'check n8n Skills plugin compatibility drift';
  if (repo.status === 'validation-failed') return 'check hook-light validation';
  if (repo.status === 'sync-delegation-failed') return 'check target sync';
  const suggestion = warningSuggestion(warning);
  if (suggestion) return suggestion;
  if (warning) return `check: ${warning}`;
  return 'none';
}

function triggeredFromTldr(syncSource) {
  if (syncSource === 'claude-plugin') return `Claude Code plugin hook (${inlineCode('claude-plugin')})`;
  if (syncSource === 'codex-plugin') return `Codex plugin hook (${inlineCode('codex-plugin')})`;
  return `manual or repo run (${inlineCode(syncSource || 'repo')})`;
}

function buildUpdateReport({ args, state, checksum, context }) {
  const repo = context.repo || {};
  const targetSyncs = context.targetSyncs || [];
  const skippedTargets = context.skippedTargets || [];
  const nativePluginCache = context.nativePluginCache || {};
  const thirdPartyHookRepair = context.thirdPartyHookRepair || {};
  const cleanup = context.cleanup || state.last_update_report_cleanup || {};
  const warning = repo.error || context.warning || '';
  const suggestion = warningSuggestion(warning);
  const commit = repo.externalAdvanceToCommit || repo.toCommit || currentToolkitCommit(state);
  const previousCommit = repo.externalAdvanceFromCommit || repo.fromCommit || 'none';
  const validationStatus = repo.validationStatus || repo.validation?.status || (repo.status ? 'not run' : 'not run');
  const targetSyncStatus = context.targetSyncStatus || (targetSyncs.length ? 'synced' : 'not needed');
  const lines = [
    '# AI Agent Toolkit Update',
    '',
    '## TL;DR',
    '',
    `- Triggered from: ${triggeredFromTldr(args.syncSource)}.`,
    `- Repo: ${repoTldr(repo, previousCommit, commit, warning)}.`,
    `- Targets: ${targetsTldr(targetSyncs, targetSyncStatus)}.`,
    `- Action needed: ${actionTldr({ repo, nativePluginCache, thirdPartyHookRepair, warning, state })}.`,
    '',
    '## Details',
    '',
    `- Time (SGT): ${inlineCode(reportTimestampSgt(context.timestamp || timestamp()))}`,
    `- Running bridge source: ${inlineCode(args.syncSource)}`,
    `- Running bridge version: ${inlineCode(BRIDGE_VERSION)}`,
    `- Recorded repo version: ${inlineCode(state.bridge_versions_by_source.repo || 'not recorded')}`,
    `- Recorded Codex plugin version: ${inlineCode(state.bridge_versions_by_source['codex-plugin'] || 'not recorded')}`,
    `- Recorded Claude plugin version: ${inlineCode(state.bridge_versions_by_source['claude-plugin'] || 'not recorded')}`,
    `- Hub reporting version: ${inlineCode(state.hub_version || 'not recorded')}`,
    `- Downgrade enforcement scope: ${inlineCode(`${args.syncSource} only`)}`,
    `- Toolkit updated to commit: ${inlineCode(commit)}`,
    `- Previous commit: ${inlineCode(previousCommit)}`,
    `- Report/log retention days: ${inlineCode(cleanup.retention_days || state.update_report_retention_days || DEFAULT_UPDATE_REPORT_RETENTION_DAYS)}`,
    '',
    'Changed files:'
  ];

  if ((repo.changedFiles || []).length) {
    for (const file of repo.changedFiles) lines.push(`- ${inlineCode(slash(file))}`);
  } else if (repo.externalAdvanceDetected) {
    lines.push('- Local repo was already advanced before this hook run.');
  } else if (targetSyncs.length && (!repo.fromCommit || repo.fromCommit === repo.toCommit)) {
    lines.push('- No repo commit change; local bridge target state was stale.');
  } else if (repo.branchSwitchedFrom) {
    lines.push('- No repo commit change; clean branch auto-switch completed.');
  } else if (repo.status && repo.status !== 'updated') {
    lines.push('- No repo commit change; repo auto-update skipped safely.');
  } else {
    lines.push('- No repo commit change.');
  }

  lines.push('', '## Repo Update', '');
  if (repo.repoPath) lines.push(`- Configured repo path: ${inlineCode(repo.repoPath)}`);
  if (repo.branch) lines.push(`- Configured branch: ${inlineCode(repo.branch)}`);
  if (repo.remote) lines.push(`- Configured remote: ${inlineCode(repo.remote)}`);
  lines.push(`- Previous observed commit: ${inlineCode(previousCommit)}`);
  lines.push(`- Current commit: ${inlineCode(commit)}`);
  if (repo.branchSwitchedFrom) {
    lines.push(`- Bridge action: auto-switched clean Toolkit repo from ${inlineCode(repo.branchSwitchedFrom)} to ${inlineCode(repo.branch || 'configured branch')}.`);
  }
  if (repo.status === 'updated') {
    lines.push('- Bridge action: fast-forwarded the configured local repo during this hook run.');
  } else if (repo.externalAdvanceDetected) {
    lines.push('- Bridge action: Local repo was already advanced before this hook run.');
    lines.push('- Inference: Likely from a manual pull or another local Git update.');
  } else if (repo.status === 'up-to-date') {
    lines.push('- Bridge action: local repo stayed on the same commit during this hook run.');
  } else if (repo.status) {
    lines.push(`- Bridge action: ${inlineCode(repo.status)}.`);
  } else {
    lines.push('- Bridge action: repo update was not run.');
  }

  lines.push('', '## What Has Been Done', '');
  for (const sync of targetSyncs) {
    lines.push(`- Synced Toolkit skills to ${targetDisplayName(sync.target)}:`);
    lines.push(`  ${inlineCode(sync.targetPath)}`);
    lines.push(`- Copied/updated ${inlineCode(sync.skillNames.length)} Toolkit skills.`);
    if ((sync.removedSkillNames || []).length) {
      lines.push('- Removed stale managed skill folders:');
      for (const name of sync.removedSkillNames) lines.push(`  - ${inlineCode(name)}`);
    }
  }
  for (const target of skippedTargets) {
    lines.push(`- Skipped ${targetDisplayName(target)} because target is disabled.`);
  }
  if (!targetSyncs.length && !skippedTargets.length && repo.status) {
    lines.push('- No enabled target sync was completed.');
  }
  if (nativePluginCache.status === 'refreshed') {
    lines.push('- Codex native plugin cache was auto-refreshed from the trusted local Toolkit repo.');
  } else if (nativePluginCache.status === 'refresh-failed') {
    lines.push('- Codex native plugin cache auto-refresh failed. Run `setup toolkit` to refresh Codex plugin skills, hooks, and metadata manually.');
  } else if (nativePluginCache.status === 'missing') {
    lines.push('- Codex native plugin cache is missing or the current installed Toolkit plugin was not reported. Run `setup toolkit` to install and verify it.');
  } else if (nativePluginCache.status === 'unverified') {
    lines.push('- Codex native plugin cache state could not be proven from current Codex configuration and installed-plugin inspection; no refresh was attempted.');
  } else if (nativePluginCache.status === 'user-disabled') {
    lines.push('- Codex explicitly reports the Toolkit plugin as user-disabled; its state was preserved and no refresh was attempted.');
  } else if (nativePluginCache.status === 'stale') {
    if (state.codex_plugin_auto_refresh_enabled) {
      lines.push('- Codex native plugin cache is stale even though auto-refresh is enabled. The hook will retry automatic refresh on the next run; use `setup toolkit` only if this persists.');
    } else {
      lines.push('- Codex native plugin cache is stale. Enable Codex plugin auto-refresh during setup or run `setup toolkit` to refresh Codex plugin skills, hooks, and metadata.');
    }
  } else if (nativePluginCache.status === 'check-only' && nativePluginCache.manual_action) {
    lines.push(`- Claude Code native plugin cache: ${nativePluginCache.manual_action}`);
  }
  if (thirdPartyHookRepair.status === 'repaired' || thirdPartyHookRepair.status === 'partial-failed') {
    lines.push(`- Repaired ${inlineCode((thirdPartyHookRepair.repaired || []).length)} supported n8n Skills Codex plugin hook cache(s).`);
    for (const entry of thirdPartyHookRepair.repaired || []) {
      lines.push(`  - ${inlineCode(entry.plugin_id || entry.plugin_root)}`);
    }
  } else if (thirdPartyHookRepair.status === 'repair-failed') {
    lines.push('- n8n Skills plugin hook reconciliation failed closed.');
  } else if (thirdPartyHookRepair.status === 'not-needed') {
    lines.push('- Supported n8n Skills plugin hooks were already Windows-safe, or no supported target was installed.');
  }
  lines.push('- Skipped live n8n systems; not touched.');

  lines.push('', '## Update Report And Log Cleanup', '');
  lines.push(`- directory: ${inlineCode(cleanup.report_log_directory || updateReportDir())}`);
  lines.push(`- retention days: ${inlineCode(cleanup.retention_days || state.update_report_retention_days || DEFAULT_UPDATE_REPORT_RETENTION_DAYS)}`);
  lines.push(`- max retained reports: ${inlineCode(cleanup.max_report_files || DEFAULT_UPDATE_REPORT_MAX_FILES)}`);
  lines.push(`- deleted: ${inlineCode(cleanup.deleted_count || 0)}`);
  lines.push(`- skipped: ${inlineCode(cleanup.skipped_count || 0)}`);
  lines.push(`- errors: ${inlineCode(cleanup.error_count || 0)}`);
  for (const error of cleanup.errors || []) lines.push(`  - ${inlineCode(error)}`);

  lines.push('', '## Validation', '');
  lines.push(`- repo update status: ${inlineCode(repo.status || 'not run')}`);
  lines.push(`- hook-light validation: ${inlineCode(validationStatus)}`);
  lines.push(`- target sync status: ${inlineCode(targetSyncStatus)}`);
  if (nativePluginCache.status) {
    const cacheLabel = nativePluginCache.host === 'claude-code' ? 'Claude Code native plugin cache' : 'Codex native plugin cache';
    lines.push(`- ${cacheLabel}: ${inlineCode(nativePluginCache.status)}`);
    for (const error of nativePluginCache.errors || []) lines.push(`  - ${inlineCode(error)}`);
  }
  if (thirdPartyHookRepair.status) {
    lines.push(`- n8n Skills plugin hook reconciliation: ${inlineCode(thirdPartyHookRepair.status)}`);
    for (const error of thirdPartyHookRepair.errors || []) lines.push(`  - ${inlineCode(error)}`);
  }
  lines.push(`- checksum: ${inlineCode(checksum)}`);
  if (warning) {
    lines.push(`- warning/error: ${inlineCode(warning)}`);
    if (suggestion) lines.push(`- Suggested fix: ${suggestion}.`);
  }
  return `${lines.join('\n')}\n`;
}

function writeUpdateReportFile(markdown, exactPath = '', options = {}) {
  const reportPath = exactPath ? path.resolve(exactPath) : nextUpdateReportPath();
  const expectedDigest = sha256(Buffer.from(markdown, 'utf8'));
  if (options.guard) options.guard({ operation: 'mkdir', path: path.dirname(reportPath), reportPath, sha256: expectedDigest });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  let handle = null;
  try {
    if (options.beforeCreate) options.beforeCreate({ reportPath, sha256: expectedDigest });
    if (options.guard) options.guard({ operation: 'exclusive-create', path: reportPath, reportPath, sha256: expectedDigest });
    handle = fs.openSync(reportPath, 'wx+', 0o600);
    fs.writeFileSync(handle, markdown, 'utf8');
    if (options.afterWrite) options.afterWrite({ reportPath, handle });
    const stat = fs.fstatSync(handle);
    const expectedBytes = Buffer.from(markdown, 'utf8');
    const actualBytes = Buffer.alloc(stat.size);
    fs.readSync(handle, actualBytes, 0, actualBytes.length, 0);
    if (!actualBytes.equals(expectedBytes)) throw new Error('exclusive update report content verification failed');
    return {
      path: reportPath,
      identity: {
        path: reportPath,
        dev: String(stat.dev),
        ino: String(stat.ino),
        birthtime_ms: String(stat.birthtimeMs),
        size: stat.size,
        sha256: sha256(actualBytes)
      }
    };
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`reserved update report path is no longer available: ${reportPath}`);
    throw error;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}

function createRunReport(args, markdown, reportPath, classification) {
  const candidate = path.resolve(reportPath);
  const bytes = Buffer.from(markdown, 'utf8');
  const digest = sha256(bytes);
  const mutationOptions = { details: { path: candidate, classification } };
  ensureManagedDirectory(args, 'report.create', mutationOptions, path.dirname(candidate));
  if (args.testHooks?.beforeReportExclusiveCreate) args.testHooks.beforeReportExclusiveCreate({ reportPath: candidate, sha256: digest });
  admitActionSpecificEffect(args, 'report.create', mutationOptions);
  try {
    fs.writeFileSync(candidate, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`reserved update report path is no longer available: ${candidate}`);
    throw error;
  }
  const identity = updateReportFileIdentity(candidate);
  if (args.testHooks?.afterExclusiveReportWrite) args.testHooks.afterExclusiveReportWrite({ reportPath: candidate, identity });
  const readback = fs.readFileSync(candidate);
  const finalIdentity = updateReportFileIdentity(candidate);
  if (!identity || canonicalJson(identity) !== canonicalJson(finalIdentity) || !readback.equals(bytes)) {
    throw new Error('report creation identity does not match expected contents');
  }
  return detachedFrozen({
    path: candidate,
    identity: { ...identity, sha256: digest }
  });
}

function openRunReport(args, reportPath) {
  const candidate = path.resolve(reportPath);
  verifyCreatedUpdateReport(args, candidate);
  if (process.platform !== 'win32') return detachedFrozen({ status: 'not-supported', path: candidate });
  const mutationOptions = { details: { path: candidate } };
  admitActionSpecificEffect(args, 'report.open', mutationOptions);
  verifyCreatedUpdateReport(args, candidate);
  const child = spawn('notepad.exe', [candidate], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return detachedFrozen({ status: 'opened', path: candidate, executable: 'notepad.exe' });
}

function updateReportSignature({ args, checksum, context }) {
  const repo = context.repo || {};
  const nativePluginCache = context.nativePluginCache || {};
  const thirdPartyHookRepair = context.thirdPartyHookRepair || {};
  const cleanup = context.cleanup || {};
  const targetSyncs = context.targetSyncs || [];
  const skippedTargets = context.skippedTargets || [];
  const payload = {
    syncSource: args.syncSource,
    checksum,
    repo: {
      status: repo.status || '',
      error: repo.error || '',
      branch: repo.branch || '',
      branchSwitchedFrom: repo.branchSwitchedFrom || '',
      remote: repo.remote || '',
      fromCommit: repo.fromCommit || '',
      toCommit: repo.toCommit || '',
      externalAdvanceDetected: repo.externalAdvanceDetected === true,
      externalAdvanceFromCommit: repo.externalAdvanceFromCommit || '',
      externalAdvanceToCommit: repo.externalAdvanceToCommit || '',
      changedFiles: repo.changedFiles || [],
      validationStatus: repo.validationStatus || repo.validation?.status || ''
    },
    nativePluginCache: {
      status: nativePluginCache.status || '',
      errors: nativePluginCache.errors || []
    },
    thirdPartyHookRepair: {
      status: thirdPartyHookRepair.status || '',
      repaired: (thirdPartyHookRepair.repaired || []).map((entry) => ({
        plugin_id: entry.plugin_id || '',
        plugin_root: entry.plugin_root || '',
        actions: entry.actions || []
      })),
      errors: thirdPartyHookRepair.errors || []
    },
    cleanup: {
      retentionDays: cleanup.retention_days || '',
      maxReportFiles: cleanup.max_report_files || DEFAULT_UPDATE_REPORT_MAX_FILES,
      errorCount: cleanup.error_count || 0
    },
    targetSyncStatus: context.targetSyncStatus || '',
    targetSyncs: targetSyncs.map((sync) => ({
      target: sync.target || '',
      targetPath: sync.targetPath || '',
      skillNames: sync.skillNames || [],
      removedSkillNames: sync.removedSkillNames || []
    })),
    skippedTargets
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function maybeWriteUpdateReport({ args, hubPath, state, checksum, context }) {
  const classification = classifyUpdateReport(context);
  if (!shouldConsiderUpdateReport(args, state) || !classification.meaningful) {
    return { state, reportPath: '' };
  }
  if (!actionAuthorised(args, 'report.create')) {
    return { state, reportPath: '' };
  }
  const reportContext = {
    cleanup: state.last_update_report_cleanup || {},
    ...context,
    timestamp: context.timestamp || timestamp()
  };
  const signature = updateReportSignature({ args, checksum, context: reportContext });
  if (!args.openUpdateReport && state.last_update_report_signature === signature) {
    return { state, reportPath: '' };
  }
  const markdown = buildUpdateReport({ args, state, checksum, context: reportContext });
  let reportPath = '';
  let lastCollision = null;
  for (let attempt = 0; attempt < REPORT_CREATE_ATTEMPTS; attempt += 1) {
    const candidate = path.resolve(nextUpdateReportPath(new Date(Date.now() + attempt * 1000)));
    if (args.testHooks?.beforeReportCreation) args.testHooks.beforeReportCreation({ reportPath: candidate, classification, attempt });
    try {
      {
        const creation = createRunReport(args, markdown, candidate, classification.kind);
        if (!creation || typeof creation !== 'object' || !creation.path || !creation.identity) {
          throw new Error('report writer did not return exclusive creation identity');
        }
        const writtenPath = path.resolve(creation.path);
        if (writtenPath !== candidate || !isUpdateReportPath(writtenPath)) throw new Error('report writer did not create the exact authorised report path');
        if (creation.identity.path !== writtenPath || creation.identity.sha256 !== sha256(Buffer.from(markdown, 'utf8'))) {
          throw new Error('report creation identity does not match expected contents');
        }
        args.createdReportIdentity = deepFreeze({ ...creation.identity });
        verifyCreatedUpdateReport(args, writtenPath);
        reportPath = writtenPath;
      }
      break;
    } catch (error) {
      if (!/already available|reserved update report path|EEXIST/i.test(String(error.message || error))) throw error;
      lastCollision = error;
    }
  }
  if (!reportPath) throw new Error(`exclusive update report creation exhausted bounded attempts: ${lastCollision?.message || 'collision'}`);
  args.createdReportPath = reportPath;
  state.last_update_report_path = reportPath;
  state.last_update_report_signature = signature;
  if ((args.openUpdateReport || classification.actionable) && actionAuthorised(args, 'report.open')) {
    if (args.testHooks?.beforeReportOpen) args.testHooks.beforeReportOpen({ reportPath, identity: args.createdReportIdentity });
    openRunReport(args, reportPath);
  }
  return { state, reportPath };
}

const OUTPUT_PATH_PLACEHOLDER = '<private-path>';
const OUTPUT_PATH_TRAILING_TEXT_BOUNDARIES = [
  ' is ',
  ' was ',
  ' has ',
  ' cannot ',
  ' could ',
  ' does ',
  ' failed ',
  ' became ',
  ' changed ',
  ' while ',
  ' when ',
  ' because ',
  ' due to ',
  ' before ',
  ' after '
];

function isOutputPathBoundary(message, index) {
  return index === 0 || /[\s([{:;,=]/.test(message[index - 1]);
}

function hasUriSchemeBefore(message, index) {
  return /[A-Za-z][A-Za-z0-9+.-]*:$/.test(message.slice(0, index));
}

function outputPathKindAt(message, index, requireBoundary = true) {
  if (index >= message.length || (requireBoundary && !isOutputPathBoundary(message, index))) return '';
  const tail = message.slice(index);
  if (/^file:\/\//i.test(tail)) return 'file-uri';
  if (/^[A-Za-z]:[\\/]/.test(tail)) return 'drive';
  if (tail.startsWith('\\\\')) return 'unc-backslash';
  if (tail.startsWith('//') && !hasUriSchemeBefore(message, index)) return 'unc-forward';
  if (tail.startsWith('/') && !tail.startsWith('//')) return 'posix';
  return '';
}

function isValidOutputPath(candidate, kind) {
  if (!candidate || /[\r\n\t\0]/.test(candidate)) return false;
  if (kind === 'drive') return /^[A-Za-z]:[\\/][^\\/]+/.test(candidate);
  if (kind === 'posix') return candidate.startsWith('/') && candidate.indexOf('/', 1) > 1;
  if (kind === 'unc-backslash') {
    return candidate.slice(2).split('\\').filter(Boolean).length >= 2;
  }
  if (kind === 'unc-forward') {
    return candidate.slice(2).split('/').filter(Boolean).length >= 2;
  }
  if (kind === 'file-uri') {
    if (!/^file:\/\//i.test(candidate)) return false;
    const target = candidate.slice('file://'.length);
    if (/^\/[A-Za-z]:\//.test(target)) return target.slice(3).includes('/');
    if (target.startsWith('/')) return target.indexOf('/', 1) > 1;
    return target.split('/').filter(Boolean).length >= 2;
  }
  return false;
}

function isInternalOutputPathColon(message, start, index, kind) {
  if (kind === 'drive') return index === start + 1;
  if (kind !== 'file-uri') return false;
  if (index === start + 'file'.length) return true;
  return index >= start + 'file:///C'.length
    && /[A-Za-z]/.test(message[index - 1])
    && message[index - 2] === '/';
}

function unquotedOutputPathEnd(message, start, kind) {
  let end = start;
  while (end < message.length) {
    const character = message[end];
    if (/[\r\n\t'"`<>|,;)\]}!?#]/.test(character)) break;
    if (character === ':' && !isInternalOutputPathColon(message, start, end, kind)) break;
    end += 1;
  }

  while (end > start && message[end - 1] === ' ') end -= 1;
  const candidate = message.slice(start, end);
  for (const boundary of OUTPUT_PATH_TRAILING_TEXT_BOUNDARIES) {
    let offset = candidate.indexOf(boundary);
    while (offset !== -1) {
      const trailingText = candidate.slice(offset + boundary.length);
      if (!/[\\/]/.test(trailingText)) {
        end = Math.min(end, start + offset);
        break;
      }
      offset = candidate.indexOf(boundary, offset + boundary.length);
    }
  }

  while (end > start && message[end - 1] === ' ') end -= 1;
  if (end > start && message[end - 1] === '.') end -= 1;
  return end;
}

function sanitizeOutputMessage(message) {
  const input = String(message || '');
  let output = '';
  let copyFrom = 0;
  let index = 0;

  while (index < input.length) {
    const quote = input[index] === "'" || input[index] === '"' ? input[index] : '';
    if (quote && isOutputPathBoundary(input, index)) {
      const close = input.indexOf(quote, index + 1);
      const kind = outputPathKindAt(input, index + 1, false);
      if (close > index + 1 && kind) {
        const candidate = input.slice(index + 1, close);
        if (isValidOutputPath(candidate, kind)) {
          output += input.slice(copyFrom, index) + OUTPUT_PATH_PLACEHOLDER;
          index = close + 1;
          copyFrom = index;
          continue;
        }
      }
    }

    const kind = outputPathKindAt(input, index);
    if (kind) {
      const end = unquotedOutputPathEnd(input, index, kind);
      const candidate = input.slice(index, end);
      if (isValidOutputPath(candidate, kind)) {
        output += input.slice(copyFrom, index) + OUTPUT_PATH_PLACEHOLDER;
        index = end;
        copyFrom = index;
        continue;
      }
    }
    index += 1;
  }

  return output + input.slice(copyFrom);
}

function printUpdateReportLine(args, reportPath) {
  if (!reportPath) return;
  console.log('Toolkit local bridge sync complete.');
}

function buildManifest({ state, discoveries, checksum, sourceCommit, syncSource, hubPath }) {
  return {
    name: 'ai-agent-toolkit-local-bridge',
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    checksum,
    source_commit: sourceCommit,
    sync_source: syncSource,
    sync_timestamp: timestamp(),
    hub_path: hubPath,
    targets: {
      opencode: {
        detected: discoveries.opencode.detected,
        enabled: state.targets.opencode.enabled,
        explicitly_disabled: state.targets.opencode.explicitly_disabled,
        target_path: discoveries.opencode.target_path
      },
      ag2: {
        detected: discoveries.ag2.detected,
        enabled: state.targets.ag2.enabled,
        explicitly_disabled: state.targets.ag2.explicitly_disabled,
        target_path: discoveries.ag2.target_path
      }
    }
  };
}

function prepareStateForWrite(state, args) {
  assertRecognizedSyncSource(args.syncSource);
  const next = normalizedState(state);
  next.schema_version = STATE_SCHEMA_VERSION;
  next.architecture_version = ARCHITECTURE_VERSION;
  next.bridge_versions_by_source[args.syncSource] = BRIDGE_VERSION;
  next.hub_version = maximumBridgeVersion(next.hub_version, next.bridge_versions_by_source);
  next.created_at = next.created_at || timestamp();
  next.updated_at = timestamp();
  next.last_sync_source = args.syncSource;
  return next;
}

function deriveSnapshotGeneration({ args, hubPath, state, prepareForWrite = false }) {
  let nextState = normalizedState(state);
  const sourceRoot = args.delegatedEnvelope
    ? path.resolve(args.delegatedEnvelope.child.source_repository)
    : resolveToolkitSourceRoot(nextState);
  if (args.delegatedEnvelope && sourceRoot !== path.resolve(args.executionAuthority.bindings.source_repository)) {
    throw new Error('delegated payload source repository does not match invocation authority');
  }
  const payloads = adapterPayloads(nextState, sourceRoot);
  const checksum = payloadChecksum(payloads);
  const discoveries = {
    opencode: discoverOpenCode(args, nextState.targets.opencode, hubPath),
    ag2: discoverAg2(args, nextState.targets.ag2, hubPath)
  };
  if (scopeAllowsTargetState(args, 'opencode')) {
    updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, false, nextState.targets.opencode.enabled ? '' : 'not enabled');
  }
  if (scopeAllowsTargetState(args, 'ag2')) {
    updateTargetState(
      nextState,
      'ag2',
      discoveries.ag2,
      checksum,
      false,
      nextState.targets.ag2.enabled
        ? (discoveries.ag2.projection_proof?.status === 'PROVEN' ? '' : 'AG2_PROOF_UNAVAILABLE')
        : 'not enabled'
    );
  }
  const needsSyncTargets = SUPPORTED_TARGETS
    .filter((target) => targetWouldSync(target, nextState, checksum, discoveries[target], payloads));
  const plannedTargetSyncs = SUPPORTED_TARGETS
    .filter((target) => scopeAllowsTargetSync(args, target))
    .filter((target) => needsSyncTargets.includes(target))
    .map((target) => targetSyncPlan(target, discoveries[target], payloads));
  const skippedTargets = SUPPORTED_TARGETS
    .filter((target) => !nextState.targets[target].enabled || nextState.targets[target].explicitly_disabled);
  if (prepareForWrite) nextState = prepareStateForWrite(nextState, args);
  return {
    state: nextState,
    sourceRoot,
    sourceCommit: currentToolkitCommit({ repo_path: sourceRoot }),
    discoveries,
    payloads,
    checksum,
    needsSyncTargets,
    outOfScopeStaleTargets: needsSyncTargets.filter((target) => !scopeAllowsTargetSync(args, target)),
    plannedTargetSyncs,
    skippedTargets
  };
}

function createOwnedGenerationEntry(args, authorityKind, mutationOptions, entry) {
  const target = path.resolve(entry.path);
  const bytes = entry.base64 === undefined ? null : Buffer.from(entry.base64, 'base64');
  admitActionSpecificEffect(args, authorityKind, mutationOptions);
  if (entry.type === 'directory') fs.mkdirSync(target);
  else fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  const identity = filesystemIdentity(target, entry.type);
  if (!identity) throw new Error(`owned generation entry postcondition failed: ${target}`);
  if (bytes && !fs.readFileSync(target).equals(bytes)) throw new Error(`owned generation entry readback failed: ${target}`);
  return detachedFrozen({ action: 'createOwnedGenerationEntry', path: target, type: entry.type, identity, sha256: bytes ? sha256(bytes) : '' });
}

function removeOwnedGenerationEntry(args, authorityKind, mutationOptions, entry) {
  const target = path.resolve(entry.path);
  const expectedIdentity = detachedFrozen(entry.identity);
  const phase = validatePhaseContext(args.phaseContext);
  if (phase.testHooks?.beforeOwnedGenerationEntryRemoval) {
    phase.testHooks.beforeOwnedGenerationEntryRemoval(detachedFrozen({ path: target, type: entry.type, identity: expectedIdentity }));
  }
  admitActionSpecificEffect(args, authorityKind, mutationOptions);
  const actualIdentity = filesystemIdentity(target, entry.type);
  if (!actualIdentity || canonicalJson(actualIdentity) !== canonicalJson(expectedIdentity)) {
    throw new Error(`owned generation removal rejected identity drift: ${target}`);
  }
  if (entry.type === 'file') fs.rmSync(target, { force: false });
  else fs.rmdirSync(target);
  if (fs.existsSync(target)) throw new Error(`owned generation removal postcondition failed: ${target}`);
  return detachedFrozen({ action: 'removeOwnedGenerationEntry', path: target, type: entry.type, identity: expectedIdentity });
}

function writeTargetManagedFile(args, authorityKind, mutationOptions, filePath, content, flags = 'wx') {
  const target = path.resolve(filePath);
  const bytes = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(String(content), 'utf8');
  admitActionSpecificEffect(args, authorityKind, mutationOptions);
  fs.writeFileSync(target, bytes, { flag: flags, mode: 0o600 });
  const readback = fs.readFileSync(target);
  if (!readback.equals(bytes)) throw new Error(`managed file write postcondition failed: ${target}`);
  return detachedFrozen({ action: 'writeTargetManagedFile', path: target, byte_length: bytes.length, sha256: sha256(bytes) });
}

function frozenDirectoryPlan(rootPath) {
  const root = path.resolve(rootPath);
  const entries = [];
  function visit(current) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || path.resolve(fs.realpathSync.native(current)) !== path.resolve(current)) {
      throw new Error(`managed recursive plan rejected symlink or reparse entry: ${current}`);
    }
    const relative = slash(path.relative(root, current));
    if (stat.isDirectory()) {
      entries.push(Object.freeze({ relative_path: relative, type: 'directory', identity: filesystemIdentity(current, 'directory') }));
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        visit(path.join(current, entry.name));
      }
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(current);
      entries.push(Object.freeze({
        relative_path: relative,
        type: 'file',
        identity: filesystemIdentity(current, 'file'),
        byte_length: bytes.length,
        sha256: sha256(bytes),
        base64: bytes.toString('base64')
      }));
    } else throw new Error(`managed recursive plan rejected special entry: ${current}`);
  }
  visit(root);
  return Object.freeze(entries);
}

function assertManagedReplacementPath(boundTarget, candidate) {
  const parent = path.dirname(path.resolve(boundTarget));
  const resolved = path.resolve(candidate);
  if (resolved !== path.resolve(boundTarget) && !isInside(parent, resolved)) {
    throw new Error('managed replacement operand escaped its immutable target parent');
  }
  return resolved;
}

function renameManagedEntry(args, authorityKind, mutationOptions, sourcePath, targetPath) {
  const boundTarget = mutationOptions.details.path;
  const source = assertManagedReplacementPath(boundTarget, sourcePath);
  const target = assertManagedReplacementPath(boundTarget, targetPath);
  const identity = filesystemIdentity(source, 'directory');
  if (!identity) throw new Error(`managed rename source is not an ordinary directory: ${source}`);
  admitActionSpecificEffect(args, authorityKind, mutationOptions);
  if (canonicalJson(filesystemIdentity(source, 'directory')) !== canonicalJson(identity)) throw new Error('managed rename source identity drift');
  fs.renameSync(source, target);
  if (canonicalJson(filesystemIdentity(target, 'directory')) !== canonicalJson(identity)) throw new Error('managed rename postcondition failed');
  return detachedFrozen({ action: authorityKind, operation: 'rename', source, target, identity });
}

function removeManagedDirectoryPlan(args, authorityKind, mutationOptions, rootPath) {
  const plan = frozenDirectoryPlan(rootPath).slice().sort((left, right) => {
    const leftDepth = left.relative_path.split('/').length;
    const rightDepth = right.relative_path.split('/').length;
    return rightDepth - leftDepth || right.relative_path.localeCompare(left.relative_path);
  });
  const root = path.resolve(rootPath);
  for (const item of plan) {
    const target = item.relative_path ? path.join(root, ...item.relative_path.split('/')) : root;
    removeOwnedGenerationEntry(args, authorityKind, mutationOptions, { path: target, type: item.type, identity: item.identity });
  }
}

function copyManagedDirectoryPlan(args, authorityKind, mutationOptions, sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  const plan = frozenDirectoryPlan(source);
  for (const item of plan) {
    const destination = item.relative_path ? path.join(target, ...item.relative_path.split('/')) : target;
    if (item.type === 'directory') {
      createOwnedGenerationEntry(args, authorityKind, mutationOptions, { path: destination, type: 'directory' });
    } else {
      const bytes = Buffer.from(item.base64, 'base64');
      if (bytes.length !== item.byte_length || sha256(bytes) !== item.sha256) throw new Error('managed recursive copy plan bytes changed');
      writeTargetManagedFile(args, authorityKind, mutationOptions, destination, bytes, 'wx');
    }
  }
}

function replaceManagedDirectory(args, authorityKind, mutationOptions, sourceDir, targetDir, options = {}) {
  const source = assertManagedReplacementPath(mutationOptions.details.path, sourceDir);
  const target = assertManagedReplacementPath(mutationOptions.details.path, targetDir);
  const backup = path.join(path.dirname(target), `.${path.basename(target)}.backup-${crypto.randomUUID()}`);
  let displaced = false;
  if (fs.existsSync(target)) {
    renameManagedEntry(args, authorityKind, mutationOptions, target, backup);
    displaced = true;
  }
  try {
    if (options.beforeFinalRename) options.beforeFinalRename({ sourcePath: source, targetPath: target, backupPath: backup });
    renameManagedEntry(args, authorityKind, mutationOptions, source, target);
  } catch (renameError) {
    const canFallback = process.platform === 'win32' && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(renameError.code);
    if (canFallback && !fs.existsSync(target)) {
      try {
        copyManagedDirectoryPlan(args, authorityKind, mutationOptions, source, target);
        removeManagedDirectoryPlan(args, authorityKind, mutationOptions, source);
      } catch (copyError) {
        if (fs.existsSync(target)) removeManagedDirectoryPlan(args, authorityKind, mutationOptions, target);
        if (displaced && fs.existsSync(backup) && !fs.existsSync(target)) renameManagedEntry(args, authorityKind, mutationOptions, backup, target);
        const error = new Error(`managed replacement fallback failed: ${copyError.message}`);
        error.cause = copyError;
        throw error;
      }
    } else {
      if (displaced && fs.existsSync(backup) && !fs.existsSync(target)) renameManagedEntry(args, authorityKind, mutationOptions, backup, target);
      throw renameError;
    }
  }
  if (displaced && fs.existsSync(backup)) removeManagedDirectoryPlan(args, authorityKind, mutationOptions, backup);
  return detachedFrozen({ action: authorityKind, operation: 'replace-directory', source, target });
}

function renameManagedFile(args, authorityKind, mutationOptions, sourcePath, targetPath, expectedDigest) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  const sourceIdentity = filesystemIdentity(source, 'file');
  if (!sourceIdentity || sha256(fs.readFileSync(source)) !== expectedDigest) throw new Error('managed file rename source identity mismatch');
  admitActionSpecificEffect(args, authorityKind, mutationOptions);
  if (canonicalJson(filesystemIdentity(source, 'file')) !== canonicalJson(sourceIdentity) || sha256(fs.readFileSync(source)) !== expectedDigest) {
    throw new Error('managed file rename source drift');
  }
  fs.renameSync(source, target);
  if (sha256(fs.readFileSync(target)) !== expectedDigest) throw new Error('managed file rename postcondition failed');
  return detachedFrozen({ action: authorityKind, operation: 'rename-file', source, target, sha256: expectedDigest });
}

function writeManagedAtomicFile(args, authorityKind, mutationOptions, filePath, content) {
  const target = path.resolve(filePath);
  const bytes = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(String(content), 'utf8');
  const digest = sha256(bytes);
  ensureManagedDirectory(args, authorityKind, mutationOptions, path.dirname(target));
  const tempPath = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${crypto.randomUUID()}`);
  const backupPath = path.join(path.dirname(target), `.${path.basename(target)}.backup-${crypto.randomUUID()}`);
  writeTargetManagedFile(args, authorityKind, mutationOptions, tempPath, bytes, 'wx');
  let displacedDigest = '';
  if (fs.existsSync(target)) {
    displacedDigest = sha256(fs.readFileSync(target));
    renameManagedFile(args, authorityKind, mutationOptions, target, backupPath, displacedDigest);
  }
  try {
    renameManagedFile(args, authorityKind, mutationOptions, tempPath, target, digest);
  } catch (error) {
    if (fs.existsSync(tempPath)) removeTargetManagedEntry(args, authorityKind, mutationOptions, tempPath);
    if (displacedDigest && fs.existsSync(backupPath) && !fs.existsSync(target)) {
      renameManagedFile(args, authorityKind, mutationOptions, backupPath, target, displacedDigest);
    }
    throw error;
  }
  if (authorityKind === 'hub.state.write') {
    const persistedState = JSON.parse(bytes.toString('utf8'));
    args.expectedAuthorityStateBinding = authorityStateBinding(persistedState, args.executionAuthority);
  }
  if (displacedDigest && fs.existsSync(backupPath)) removeTargetManagedEntry(args, authorityKind, mutationOptions, backupPath);
  return detachedFrozen({ action: authorityKind, operation: 'atomic-file-write', path: target, byte_length: bytes.length, sha256: digest });
}

function writePayloadTree(rootDir, payload, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const payloadDigest = filePayloadChecksum(payload);
  if (options.guard) options.guard({ operation: 'write-payload-tree', root: resolvedRoot, payload_sha256: payloadDigest });
  for (const [rel, text] of Object.entries(payload)) {
    const target = path.resolve(rootDir, rel);
    if (!isInside(resolvedRoot, target)) throw new Error('payload write escaped its immutable root');
    const bytes = payloadBytes(text);
    const directory = path.dirname(target);
    if (!fs.existsSync(directory)) {
      const relativeDirectory = path.relative(resolvedRoot, directory);
      let current = resolvedRoot;
      for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        if (fs.existsSync(current)) continue;
        createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, { path: current, type: 'directory' });
      }
    }
    writeTargetManagedFile(options.args, options.authorityKind, options.mutationOptions, target, bytes, 'wx');
  }
}

function ensureManagedDirectory(args, authorityKind, mutationOptions, directoryPath) {
  const target = path.resolve(directoryPath);
  const missing = [];
  let cursor = target;
  while (!fs.existsSync(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`managed directory has no existing ancestor: ${target}`);
    cursor = parent;
  }
  const ancestorIdentity = filesystemIdentity(cursor, 'directory');
  if (!ancestorIdentity) throw new Error(`managed directory ancestor is unsafe: ${cursor}`);
  for (const entry of missing.reverse()) {
    createOwnedGenerationEntry(args, authorityKind, mutationOptions, { path: entry, type: 'directory' });
  }
}

function withOwnedStaging(options, callback) {
  if (!options.args || !options.authorityKind || !options.mutationOptions) {
    throw new Error('managed owned staging requires an action-specific executor binding');
  }
  const guard = typeof options.guard === 'function' ? options.guard : () => {};
  const parent = path.dirname(options.target);
  ensureManagedDirectory(options.args, options.authorityKind, options.mutationOptions, parent);
  const generation = planOwnedStagingGeneration({
    parent: path.dirname(options.target),
    target: options.target,
    stagePrefix: options.stagePrefix,
    operation: options.operation,
    sourceType: options.sourceType,
    bridgeVersion: BRIDGE_VERSION
  });
  createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, {
    path: generation.recordPath,
    type: 'file',
    base64: generation.recordBase64
  });
  if (options.afterRegistration) options.afterRegistration({ record: generation.record, recordPath: generation.recordPath, stagePath: generation.stagePath });
  createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, { path: generation.stagePath, type: 'directory' });
  const stageIdentity = filesystemIdentity(generation.stagePath, 'directory');
  const markerIdentity = { dev: stageIdentity.dev, ino: stageIdentity.ino, birthtime_ms: stageIdentity.birthtime_ms };
  if (options.afterDirectoryCreated) options.afterDirectoryCreated({ record: generation.record, recordPath: generation.recordPath, stagePath: generation.stagePath, directoryIdentity: markerIdentity });
  const ready = plannedStateMarker(generation, 'ready', markerIdentity);
  createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, { path: ready.path, type: 'file', base64: ready.base64 });
  createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, {
    path: generation.recordPath.replace(/\.json$/, '.ready.json'), type: 'file', base64: ready.base64
  });
  const immutableGeneration = deepFreeze({
    generation_id: generation.record.generation_id,
    ownership_token: generation.record.ownership_token,
    expected_parent: path.resolve(generation.record.expected_parent),
    expected_staging_path: path.resolve(generation.record.expected_staging_path),
    expected_final_target: path.resolve(generation.record.expected_final_target),
    record_path: path.resolve(generation.recordPath),
    stage_path: path.resolve(generation.stagePath)
  });
  const assertGenerationBinding = () => {
    const actual = {
      generation_id: generation.record.generation_id,
      ownership_token: generation.record.ownership_token,
      expected_parent: path.resolve(generation.record.expected_parent),
      expected_staging_path: path.resolve(generation.record.expected_staging_path),
      expected_final_target: path.resolve(generation.record.expected_final_target),
      record_path: path.resolve(generation.recordPath),
      stage_path: path.resolve(generation.stagePath)
    };
    if (canonicalJson(actual) !== canonicalJson(immutableGeneration)) {
      throw new Error('owned staging generation operands changed after creation');
    }
  };
  let operationError = null;
  try {
    const result = callback(generation.stagePath, generation);
    guard();
    assertGenerationBinding();
    const completed = plannedStateMarker(generation, 'completed');
    createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, { path: completed.path, type: 'file', base64: completed.base64 });
    return result;
  } catch (error) {
    operationError = error;
    try {
      guard();
      assertGenerationBinding();
      const failed = plannedStateMarker(generation, 'failed');
      createOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, { path: failed.path, type: 'file', base64: failed.base64 });
    } catch (markerError) {
      error.stagingMarkerError = markerError;
    }
    throw error;
  } finally {
    let cleanupGuarded = true;
    try {
      guard();
    } catch {
      cleanupGuarded = false;
    }
    if (cleanupGuarded) {
      const cleanup = planOwnedGenerationCleanup(generation, { currentOperation: true });
      if (options.beforeDelete) options.beforeDelete({ generation, inspection: cleanup.inspection });
      guard();
      assertGenerationBinding();
      if (!cleanup.cleanable) {
        const cleanupError = new Error(
          `Owned staging generation ${generation.record.generation_id} was preserved because cleanup could not prove ownership: ${cleanup.reason}`
        );
        if (operationError) {
          operationError.stagingCleanupError = cleanupError;
          operationError.message = `${operationError.message}; ${cleanupError.message}`;
        }
        else throw cleanupError;
      } else {
        for (const entry of cleanup.entries) {
          removeOwnedGenerationEntry(options.args, options.authorityKind, options.mutationOptions, entry);
        }
      }
    }
  }
}

function scopedStateForPersistence(hubPath, state, args) {
  const raw = readJsonIfExists(path.join(hubPath, 'state.json'));
  const persisted = JSON.parse(JSON.stringify(state));
  persisted.targets = persisted.targets && typeof persisted.targets === 'object' ? persisted.targets : {};
  for (const target of SUPPORTED_TARGETS) {
    if (scopeAllowsTargetState(args, target)) continue;
    if (raw?.targets && Object.prototype.hasOwnProperty.call(raw.targets, target)) {
      persisted.targets[target] = JSON.parse(JSON.stringify(raw.targets[target]));
    } else {
      delete persisted.targets[target];
    }
  }
  return persisted;
}

function scopedManifestForPersistence({ hubPath, args, state, discoveries, checksum, sourceCommit }) {
  const previous = readJsonIfExists(path.join(hubPath, 'manifest.json'));
  const current = buildManifest({ state: normalizedState(state), discoveries, checksum, sourceCommit, syncSource: args.syncSource, hubPath });
  const manifest = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? { ...previous, ...current }
    : { ...current };
  manifest.targets = previous?.targets && typeof previous.targets === 'object'
    ? JSON.parse(JSON.stringify(previous.targets))
    : {};
  for (const target of SUPPORTED_TARGETS) {
    if (scopeAllowsTargetState(args, target)) manifest.targets[target] = current.targets[target];
  }
  return manifest;
}

function validateStagedTargetAdapter(stagePath, target, payloads) {
  const required = target === 'opencode'
    ? path.join(stagePath, 'skills', 'ai-agent-toolkit', 'SKILL.md')
    : path.join(stagePath, 'skills', 'ai-agent-toolkit', 'SKILL.md');
  if (!fs.existsSync(required)) throw new Error(`staged ${target} adapter SKILL.md missing`);
  if (target === 'ag2') {
    for (const obsolete of ['plugin.json', 'installed_version.json', 'ai-agent-toolkit-ag2-adapter.json']) {
      if (fs.existsSync(path.join(stagePath, obsolete))) throw new Error(`staged AG2 plugin authority remains: ${obsolete}`);
    }
  }
  if (!Object.keys(payloads[target] || {}).length) throw new Error(`staged ${target} adapter payload is empty`);
  if (targetOutputChecksum(stagePath, payloads[target]) !== filePayloadChecksum(payloads[target])) {
    throw new Error(`staged ${target} adapter content checksum mismatch`);
  }
}

function writeHubSnapshot({ hubPath, args, state, discoveries, checksum, payloads, sourceCommit, plannedTargetSyncs = [] }, testHooks = {}) {
  revalidateExecutionAuthority(args, discoveries);
  const plannedHubTargets = new Set(plannedTargetSyncs.map((plan) => plan.target));
  for (const target of SUPPORTED_TARGETS.filter((name) => scopeAllowsTargetSync(args, name) && plannedHubTargets.has(name))) {
    const targetPath = path.join(hubPath, 'adapters', target);
    const mutationOptions = { target, action: scopeTargetAction(args, target), details: { path: targetPath, hubPath } };
    withOwnedStaging({
      target: targetPath,
      stagePrefix: `.${target}.staging-`,
      operation: 'target-directory-copy',
      sourceType: args.syncSource,
      args,
      authorityKind: 'hub.adapter.replace',
      mutationOptions,
      afterRegistration: testHooks.afterHubStagingRegistration,
      beforeDelete: testHooks.beforeHubStagingCleanup,
      guard: () => guardManagedMutation(args, 'hub.adapter.replace', mutationOptions)
    }, (stagePath, generation) => {
      if (testHooks.afterHubStagingReady) testHooks.afterHubStagingReady({ stagePath, generation, target });
      if (testHooks.beforeHubPayloadWrite) testHooks.beforeHubPayloadWrite({ stagePath, generation, target });
      const intendedDigest = filePayloadChecksum(payloads[target]);
      writePayloadTree(stagePath, payloads[target], {
        args,
        authorityKind: 'hub.adapter.replace',
        mutationOptions,
        guard(actual) {
          guardManagedPrimitive(args, 'hub.adapter.replace', mutationOptions);
          if (path.resolve(actual.root) !== path.resolve(stagePath) || actual.payload_sha256 !== intendedDigest) {
            throw new Error('hub payload primitive content changed before write');
          }
        }
      });
      if (testHooks.afterHubPayloadWrite) testHooks.afterHubPayloadWrite({ stagePath, generation, target });
      validateStagedTargetAdapter(stagePath, target, payloads);
      if (testHooks.afterHubValidation) testHooks.afterHubValidation({ stagePath, generation, target });
      if (testHooks.beforeHubReplacement) testHooks.beforeHubReplacement({ stagePath, generation, target });
      guardManagedMutation(args, 'hub.adapter.replace', mutationOptions);
      replaceManagedDirectory(args, 'hub.adapter.replace', mutationOptions, stagePath, targetPath, testHooks.replaceDirectoryOptions || {});
      validateStagedTargetAdapter(targetPath, target, payloads);
    });
  }
  const persistedState = scopedStateForPersistence(hubPath, state, args);
  const manifest = scopedManifestForPersistence({ hubPath, args, state: persistedState, discoveries, checksum, sourceCommit });
  const manifestPath = path.join(hubPath, 'manifest.json');
  writeManagedAtomicFile(args, 'hub.manifest.write', { details: { path: manifestPath, hubPath } }, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const statePath = path.join(hubPath, 'state.json');
  writeManagedAtomicFile(args, 'hub.state.write', { details: { path: statePath, hubPath } }, statePath, `${JSON.stringify(persistedState, null, 2)}\n`);
  if (testHooks.afterHubStateWrite) testHooks.afterHubStateWrite({ hubPath, persistedState });
  const verifiedState = readJsonIfExists(path.join(hubPath, 'state.json'));
  if (canonicalJson(verifiedState) !== canonicalJson(persistedState)) throw new Error('hub state postcondition verification failed');
  const verifiedManifest = readJsonIfExists(path.join(hubPath, 'manifest.json'));
  if (canonicalJson(verifiedManifest) !== canonicalJson(manifest)) throw new Error('hub manifest postcondition verification failed');
  args.expectedAuthorityStateBinding = authorityStateBinding(persistedState, args.executionAuthority);
}

function validateStagedHub(stagePath, checksum) {
  const manifest = readJsonIfExists(path.join(stagePath, 'manifest.json'));
  const state = readJsonIfExists(path.join(stagePath, 'state.json'));
  if (!manifest || manifest.checksum !== checksum) throw new Error('staged manifest checksum mismatch');
  if (!state || state.schema_version !== STATE_SCHEMA_VERSION) throw new Error('staged state schema mismatch');
  if (!fs.existsSync(path.join(stagePath, 'adapters', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md'))) {
    throw new Error('staged OpenCode adapter SKILL.md missing');
  }
  for (const obsolete of ['plugin.json', 'installed_version.json', 'ai-agent-toolkit-ag2-adapter.json']) {
    if (fs.existsSync(path.join(stagePath, 'adapters', 'ag2', obsolete))) {
      throw new Error(`staged AG2 plugin authority remains: ${obsolete}`);
    }
  }
  if (!fs.existsSync(path.join(stagePath, 'adapters', 'ag2', 'skills', 'ai-agent-toolkit', 'SKILL.md'))) {
    throw new Error('staged AG2 adapter SKILL.md missing');
  }
}

// Classify the recorded lock owner without ever signalling it for real.
// `alive` is proof a process with that PID exists and must be respected.
// `dead` is proof no such process exists, so the lock is recoverable even
// while fresh. `indeterminate` (for example EPERM) is not proof of death and
// falls back to the age rule. `unknown` covers missing or malformed PIDs.
function lockOwnerLiveness(pid, killFn = process.kill) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) return 'unknown';
  // A lock recording this process's own PID cannot belong to a concurrent
  // run of this single-threaded process; treat it as recoverable leftover.
  if (parsed === process.pid) return 'dead';
  try {
    killFn(parsed, 0);
    return 'alive';
  } catch (error) {
    if (error && error.code === 'ESRCH') return 'dead';
    return 'indeterminate';
  }
}

// Age of the lock for the stale-age fallback. A malformed or partially
// written lock file (unreadable JSON, unparsable created_at) falls back to
// the file mtime so a mid-write lock from another process is not treated as
// instantly stale and recklessly removed.
function lockAgeMs(lockPath, lock) {
  const created = Date.parse(lock?.created_at || '');
  if (Number.isFinite(created)) return Date.now() - created;
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const LOCK_RECOVERY_MARKER_SUFFIX = '.recovery';

// Decide whether an existing lock must be respected. A live recorded owner
// is always respected regardless of age; a provably dead owner is
// recoverable immediately; unknown or indeterminate owners fall back to the
// age rule (created_at, or file mtime when the lock is unreadable).
function inspectLockForRecovery(lockPath, liveness = lockOwnerLiveness) {
  let lock = {};
  try {
    lock = readJsonIfExists(lockPath) || {};
  } catch {
    // Malformed lock JSON: no owner can be determined; the mtime-based age
    // fallback decides freshness.
  }
  const owner = liveness(lock.pid);
  if (owner === 'alive') {
    return { respected: true, message: `Toolkit bridge lock at ${lockPath} is held by live process ${lock.pid}` };
  }
  if (owner !== 'dead') {
    const age = lockAgeMs(lockPath, lock);
    if (Number.isFinite(age) && age < LOCK_STALE_MS) {
      return { respected: true, message: `fresh Toolkit bridge lock exists at ${lockPath}` };
    }
  }
  return { respected: false, message: '' };
}

// Best-effort cleanup of long-spent claim tombstones (marker reclaim and
// displaced-evidence retirement tombstones). A generous age floor keeps
// cleanup far away from any live acquisition: a contender's
// inspect-to-claim window is one acquireLock call, and tombstones only need
// to outlive stale knowledge of a generation, not accumulate forever.
// Displaced-lock evidence files are deliberately never age-collected here:
// they are a persistent fail-closed acquisition barrier while their owner
// is alive or unverifiable, and are removed only through the identity-safe
// retirement protocol once the owner is provably dead.
const LOCK_ARTIFACT_GC_MS = 24 * 60 * 60 * 1000;
const RECOVERY_CLAIM_TOMBSTONE_PATTERN = /^update\.lock\.recovery\.claim-[0-9a-f]{16}$/;
const DISPLACED_RETIREMENT_TOMBSTONE_PATTERN = /^update\.lock\.displaced\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.retired-[0-9a-f]{16}$/;

function cleanupSpentLockArtifacts(hubRoot) {
  let entries = [];
  try {
    entries = fs.readdirSync(hubRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!RECOVERY_CLAIM_TOMBSTONE_PATTERN.test(entry) && !DISPLACED_RETIREMENT_TOMBSTONE_PATTERN.test(entry)) continue;
    const fullPath = path.join(hubRoot, entry);
    try {
      const artifact = fs.lstatSync(fullPath);
      if (artifact.isFile() && Date.now() - artifact.mtimeMs > LOCK_ARTIFACT_GC_MS) {
        fs.rmSync(fullPath, { force: true });
      }
    } catch {
      // Best-effort only; a busy or vanished artifact is left alone.
    }
  }
}

// Displaced-lock evidence is a persistent acquisition barrier. A previous
// recovery that displaced a live owner's lock and could not restore it
// preserves that lock as update.lock.displaced.<token>; until the recorded
// owner is provably dead, no later acquisition may create a new main lock,
// because the displaced owner may still be running as a writer.
//
// Classification per evidence file:
// - live owner: blocked, and the evidence must never be deleted;
// - indeterminate owner (for example EPERM): fail closed, blocked;
// - unusable owner data: age fallback (fresh blocks, stale is retirable);
// - provably dead owner: retirable through the identity-safe protocol.
function inspectDisplacedEvidenceFile(fullPath, liveness, testHooks = {}, phase = 'inspection') {
  let raw = null;
  try {
    raw = testHooks.readDisplacedEvidence
      ? testHooks.readDisplacedEvidence(fullPath, phase)
      : fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { gone: true };
    const code = error?.code || 'unknown I/O error';
    return {
      blocked: true,
      message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} is unreadable (${code}); failing closed because its owner state cannot be safely established`
    };
  }
  let displaced = {};
  try {
    displaced = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    // Malformed evidence: owner is unusable; the age fallback decides.
  }
  const owner = liveness(displaced.pid);
  if (owner === 'alive') {
    return {
      blocked: true,
      owner,
      pid: displaced.pid,
      raw,
      message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} belongs to live process ${displaced.pid}; a previous recovery could not restore it, and no new lock may be created while the displaced owner is alive`
    };
  }
  if (owner === 'indeterminate') {
    return {
      blocked: true,
      owner,
      pid: displaced.pid,
      raw,
      message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} records owner process ${displaced.pid} whose liveness cannot be verified; failing closed until the owner can be proved dead (verify the process before considering manual review of the evidence)`
    };
  }
  if (owner === 'unknown') {
    let age = Date.now() - Date.parse(displaced.created_at || '');
    if (!Number.isFinite(age)) {
      try {
        age = Date.now() - fs.statSync(fullPath).mtimeMs;
      } catch (error) {
        if (error && error.code === 'ENOENT') return { gone: true };
        const code = error?.code || 'unknown I/O error';
        return {
          blocked: true,
          owner,
          pid: displaced.pid,
          raw,
          message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} cannot be dated safely (${code}); failing closed because its owner state cannot be safely established`
        };
      }
    }
    if (age < LOCK_STALE_MS) {
      return {
        blocked: true,
        owner,
        pid: displaced.pid,
        raw,
        message: `Toolkit bridge acquisition blocked: fresh displaced lock evidence at ${fullPath} has no verifiable owner; failing closed`
      };
    }
  }
  return { blocked: false, owner, pid: displaced.pid, raw };
}

function inspectDisplacedEvidence(hubRoot, liveness = lockOwnerLiveness, testHooks = {}, phase = 'inspection') {
  let entries = [];
  try {
    entries = testHooks.listDisplacedEvidence
      ? testHooks.listDisplacedEvidence(hubRoot, phase)
      : fs.readdirSync(hubRoot);
  } catch (error) {
    const code = error?.code || 'unknown I/O error';
    return {
      blocked: true,
      retirable: [],
      message: `Toolkit bridge acquisition blocked: displaced lock evidence cannot be enumerated in ${hubRoot} (${code}); failing closed because absence of evidence cannot be established`
    };
  }
  const retirable = [];
  for (const entry of entries) {
    if (!/^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry)) continue;
    const fullPath = path.join(hubRoot, entry);
    const inspection = inspectDisplacedEvidenceFile(fullPath, liveness, testHooks, phase);
    if (inspection.gone) continue;
    if (inspection.blocked) return { blocked: true, retirable, message: inspection.message };
    retirable.push({ fullPath, raw: inspection.raw });
  }
  return { blocked: false, retirable };
}

// Retire dead-owner displaced evidence with the same atomic identity-safe
// discipline as marker reclaim: exclusively create a tombstone named after
// the hash of the exact inspected bytes (one winner per generation), then
// re-read and remove the evidence only when it is still that generation. A
// changed generation is left untouched and this contender yields.
function retireDisplacedEvidence(retirable, testHooks = {}) {
  for (const { fullPath, raw } of retirable) {
    if (testHooks.afterEvidenceInspect) testHooks.afterEvidenceInspect();
    const identity = lockGenerationIdentity(raw);
    const tombstonePath = `${fullPath}.retired-${identity}`;
    try {
      fs.writeFileSync(
        tombstonePath,
        `${JSON.stringify({ created_at: timestamp(), pid: process.pid, retired_identity: identity }, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' }
      );
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        return { retired: false, message: `Toolkit bridge displaced lock evidence at ${fullPath} is being retired by another process` };
      }
      throw error;
    }
    let current = null;
    try {
      current = testHooks.readDisplacedEvidence
        ? testHooks.readDisplacedEvidence(fullPath, 'retirement-verification')
        : fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      const code = error?.code || 'unknown I/O error';
      return {
        retired: false,
        message: `Toolkit bridge displaced lock evidence at ${fullPath} became unreadable during retirement verification (${code}); failing closed without removing it`
      };
    }
    if (current !== raw) {
      return { retired: false, message: `Toolkit bridge displaced lock evidence at ${fullPath} changed while being retired` };
    }
    fs.rmSync(fullPath, { force: true });
  }
  return { retired: true };
}

function lockGenerationIdentity(rawBytes) {
  return crypto.createHash('sha256').update(rawBytes, 'utf8').digest('hex').slice(0, 16);
}

// Inspect the recovery marker without mutating anything during marker claim
// or identity-safe reclaim.
function inspectRecoveryMarker(markerPath, liveness = lockOwnerLiveness) {
  let raw = null;
  try {
    raw = fs.readFileSync(markerPath, 'utf8');
  } catch {
    return { present: false };
  }
  let marker = {};
  try {
    marker = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    // Malformed marker content: liveness is unknown and the age fallback
    // (file mtime) decides below.
  }
  const owner = liveness(marker.pid);
  if (owner === 'alive') {
    return { present: true, active: true, raw, marker, message: `Toolkit bridge lock recovery at ${markerPath} is in progress by live process ${marker.pid}` };
  }
  if (owner !== 'dead') {
    const age = lockAgeMs(markerPath, marker);
    if (Number.isFinite(age) && age < LOCK_STALE_MS) {
      return { present: true, active: true, raw, marker, message: `fresh Toolkit bridge lock recovery marker exists at ${markerPath}` };
    }
  }
  return { present: true, active: false, raw, marker };
}

// Atomic recovery claim: only the process that exclusively created the
// recovery marker may displace a recoverable lock and write a replacement.
// The exclusive create is the atomic ownership primitive; the loser of the
// race never deletes anything.
//
// Reclaiming a marker left by a dead or stale recovery is itself atomic and
// identity-safe: the reclaimer must first exclusively create a tombstone
// whose name is derived from a hash of the exact marker bytes it inspected.
// Contenders that inspected the same marker generation compute the same
// tombstone path, so exactly one wins the exclusive create; the tombstone is
// never deleted by the protocol (only aged out long after any contender's
// knowledge of that generation could survive), so a loser acting on stale
// knowledge can never reclaim that generation later. The winner then
// re-reads the marker under its tombstone and proceeds only when the bytes
// are still the inspected generation.
function claimRecoveryMarker(markerPath, token, liveness = lockOwnerLiveness, testHooks = {}) {
  const markerBody = `${JSON.stringify({ created_at: timestamp(), pid: process.pid, token }, null, 2)}\n`;
  const tryCreateMarker = () => {
    try {
      fs.writeFileSync(markerPath, markerBody, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }
  };

  if (tryCreateMarker()) return { claimed: true };

  const inspection = inspectRecoveryMarker(markerPath, liveness);
  if (!inspection.present) {
    // The marker vanished between the exclusive create and the read; one
    // bounded retry decides ownership without any deletion.
    if (tryCreateMarker()) return { claimed: true };
    return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was re-created by another process` };
  }
  if (inspection.active) return { claimed: false, message: inspection.message };
  if (testHooks.afterMarkerInspect) testHooks.afterMarkerInspect();

  const identity = lockGenerationIdentity(inspection.raw);
  const tombstonePath = `${markerPath}.claim-${identity}`;
  try {
    fs.writeFileSync(
      tombstonePath,
      `${JSON.stringify({ created_at: timestamp(), pid: process.pid, token, reclaimed_marker_identity: identity }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was already reclaimed by another process` };
    }
    throw error;
  }

  // Verify under the tombstone: only the inspected generation may be
  // removed. A different generation means another process already cycled
  // the marker; it is left untouched and this contender yields.
  let current = null;
  try {
    current = fs.readFileSync(markerPath, 'utf8');
  } catch {
    // Marker gone: fall through to the exclusive create below.
  }
  if (current !== null && current !== inspection.raw) {
    return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} changed while being reclaimed` };
  }
  if (current !== null) fs.rmSync(markerPath, { force: true });

  if (tryCreateMarker()) return { claimed: true };
  return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was re-created by another process` };
}

function releaseRecoveryMarker(markerPath, token) {
  let marker = null;
  try {
    marker = readJsonIfExists(markerPath);
  } catch {
    return;
  }
  if (marker && marker.token === token) fs.rmSync(markerPath, { force: true });
}

// acquireLock protocol:
// 0. An initial displaced-evidence inspection may fail fast but never retires
//    evidence or authorizes creation. Every acquisition then owns the
//    recovery marker while it authoritatively re-inspects/retire evidence,
//    rechecks or recovers the main lock, and exclusively creates its lock.
//    This makes evidence validation and no-lock ownership commitment one
//    serialized protocol with no check-to-create gap.
// 1. No lock present: the recovery marker is still claimed before the
//    authoritative evidence inspection and exclusive main-lock creation.
// 2. Lock present and respected (live owner, or fresh with unknown owner):
//    hook runs skip, manual runs fail. Nothing is deleted.
// 3. Recoverable lock: claim the exclusive recovery marker (reclaiming a
//    dead or stale marker is atomic and identity-safe via a tombstone on
//    the inspected marker generation), re-inspect the lock under the marker
//    (a replacement written in the interim has a live owner and is
//    respected), displace the recoverable lock by rename and verify the
//    displaced file's owner is not alive before discarding it, then
//    exclusively create the replacement carrying a unique ownership token.
//    A displaced generation that cannot be proved safe to discard is never
//    renamed back over the main path: it remains evidence and this contender
//    yields without writing, eliminating destination-clobber races.
// testHooks is a test-only seam for deterministic interleaving; production
// call sites never pass it.
function acquireLock(hubRoot, args, testHooks = {}) {
  fs.mkdirSync(hubRoot, { recursive: true });
  cleanupSpentLockArtifacts(hubRoot);
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}${LOCK_RECOVERY_MARKER_SUFFIX}`;
  const liveness = testHooks.liveness || lockOwnerLiveness;
  const token = crypto.randomUUID();

  const skipOrThrow = (message) => {
    if (args.hook) return { acquired: false, lockPath, skipReason: message };
    throw new Error(message);
  };

  const tryExclusiveCreate = () => {
    const lockBody = `${JSON.stringify({
      created_at: timestamp(),
      pid: process.pid,
      token,
      bridge_version: BRIDGE_VERSION,
      sync_source: args.syncSource
    }, null, 2)}\n`;
    try {
      fs.writeFileSync(lockPath, lockBody, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }
  };

  // The initial scan is fail-fast only. A contender may pause after this
  // scan while another recovery creates evidence, so no retirement or lock
  // creation is permitted until the same checks repeat under marker ownership.
  const initialEvidence = inspectDisplacedEvidence(hubRoot, liveness, testHooks, 'initial');
  if (initialEvidence.blocked) return skipOrThrow(initialEvidence.message);
  if (testHooks.afterInitialEvidenceInspect) testHooks.afterInitialEvidenceInspect();

  if (fs.existsSync(lockPath)) {
    const inspection = inspectLockForRecovery(lockPath, liveness);
    if (inspection.respected) return skipOrThrow(inspection.message);
    if (testHooks.afterInspect) testHooks.afterInspect();
  }

  const marker = claimRecoveryMarker(markerPath, token, liveness, testHooks);
  if (!marker.claimed) return skipOrThrow(marker.message);

  try {
    if (testHooks.afterMarkerClaim) testHooks.afterMarkerClaim();
    // This is the authoritative barrier check. The marker remains owned
    // through retirement, main-lock recovery, and exclusive creation, so no
    // compliant recoverer can create evidence in a check-to-create gap.
    const evidence = inspectDisplacedEvidence(hubRoot, liveness, testHooks, 'under-marker');
    if (evidence.blocked) return skipOrThrow(evidence.message);
    if (evidence.retirable.length) {
      const retirement = retireDisplacedEvidence(evidence.retirable, testHooks);
      if (!retirement.retired) return skipOrThrow(retirement.message);
    }

    if (fs.existsSync(lockPath)) {
      const recheck = inspectLockForRecovery(lockPath, liveness);
      if (recheck.respected) return skipOrThrow(recheck.message);
      if (testHooks.beforeDisplace) testHooks.beforeDisplace();
      // Displace by rename instead of deleting in place, then verify the
      // displaced file. A generation that cannot be proved safe to discard
      // remains at this unique evidence path and this contender yields.
      const displacedPath = `${lockPath}.displaced.${token}`;
      let displaced = false;
      try {
        fs.renameSync(lockPath, displacedPath);
        displaced = true;
      } catch {
        // The lock disappeared between the recheck and the rename; continue
        // to the exclusive create, which remains the final arbiter.
      }
      if (testHooks.afterDisplace) testHooks.afterDisplace();
      if (displaced) {
        const displacedInspection = inspectDisplacedEvidenceFile(
          displacedPath,
          liveness,
          testHooks,
          'post-displacement'
        );
        if (!displacedInspection.gone && displacedInspection.blocked) {
          if (testHooks.beforeRestorationCommit) testHooks.beforeRestorationCommit();
          if (displacedInspection.owner === 'alive') {
            return skipOrThrow(`Toolkit bridge lock recovery displaced a lock held by live process ${displacedInspection.pid}; no-clobber restoration is not guaranteed, so the displaced lock is preserved at ${displacedPath}; not acquiring`);
          }
          return skipOrThrow(`${displacedInspection.message}; no-clobber restoration is not guaranteed, so the displaced lock is preserved; not acquiring`);
        }
        if (!displacedInspection.gone) fs.rmSync(displacedPath, { force: true });
      }
    }
    if (tryExclusiveCreate()) return { acquired: true, lockPath, token };
    return skipOrThrow(`Toolkit bridge lock at ${lockPath} was created by another process`);
  } finally {
    releaseRecoveryMarker(markerPath, token);
  }
}

// Release only the exact lock this run created: the current lock file must
// still carry this run's ownership token. A lock replaced by another
// process is never deleted, even by the process that previously owned that
// path. The token check is stable because no other process may recover a
// lock whose recorded owner is alive, and this process is alive while
// releasing.
function releaseLock(lock) {
  if (!lock?.acquired || !lock.lockPath) return;
  for (const context of lock.phaseContexts || []) invalidatePhaseContext(context);
  let current = null;
  try {
    current = readJsonIfExists(lock.lockPath);
  } catch {
    return;
  }
  if (!current || current.token !== lock.token) return;
  fs.rmSync(lock.lockPath, { force: true });
}

function isTransientRenameError(error) {
  return ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code);
}

function sleepSync(ms) {
  if (!ms) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameSyncWithRetry(sourcePath, targetPath, options = {}) {
  const attempts = options.renameAttempts || 6;
  const delayMs = options.retryDelayMs || 75;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (options.guard) options.guard({ operation: 'rename', sourcePath, targetPath });
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRenameError(error) || attempt === attempts) break;
      sleepSync(delayMs);
    }
  }
  throw lastError;
}

function replaceDirectoryAtomically(sourceDir, targetDir, options = {}) {
  const immutableSource = path.resolve(sourceDir);
  const immutableTarget = path.resolve(targetDir);
  const parent = path.dirname(immutableTarget);
  const guard = (details) => {
    if (path.resolve(sourceDir) !== immutableSource || path.resolve(targetDir) !== immutableTarget) {
      throw new Error('directory replacement operands changed before primitive');
    }
    if (options.guard) options.guard(details);
  };
  guard({ operation: 'mkdir', path: parent, sourcePath: immutableSource, targetPath: immutableTarget });
  fs.mkdirSync(parent, { recursive: true });
  const backup = path.join(parent, `.${path.basename(immutableTarget)}.backup-${process.pid}-${Date.now()}`);
  if (fs.existsSync(backup)) {
    guard({ operation: 'remove-backup', path: backup, sourcePath: immutableSource, targetPath: immutableTarget });
    fs.rmSync(backup, { recursive: true, force: true });
  }
  if (fs.existsSync(immutableTarget)) renameSyncWithRetry(immutableTarget, backup, { ...options, guard });
  try {
    renameSyncWithRetry(immutableSource, immutableTarget, { ...options, guard });
  } catch (error) {
    if (isTransientRenameError(error) && fs.existsSync(immutableSource) && !fs.existsSync(immutableTarget)) {
      try {
        guard({ operation: 'copy-fallback', sourcePath: immutableSource, targetPath: immutableTarget });
        fs.cpSync(immutableSource, immutableTarget, { recursive: true, force: false, errorOnExist: true });
        guard({ operation: 'remove-source-after-copy', path: immutableSource, sourcePath: immutableSource, targetPath: immutableTarget });
        fs.rmSync(immutableSource, { recursive: true, force: true });
        if (fs.existsSync(backup)) {
          guard({ operation: 'remove-backup-after-copy', path: backup, sourcePath: immutableSource, targetPath: immutableTarget });
          fs.rmSync(backup, { recursive: true, force: true });
        }
        return;
      } catch (copyError) {
        if (fs.existsSync(immutableTarget)) {
          guard({ operation: 'remove-failed-target', path: immutableTarget, sourcePath: immutableSource, targetPath: immutableTarget });
          fs.rmSync(immutableTarget, { recursive: true, force: true });
        }
        const fallbackError = new Error(
          `Failed to replace ${immutableTarget}: rename failed with ${error.code || error.message}; copy fallback failed with ${copyError.code || copyError.message}`
        );
        fallbackError.code = copyError.code || error.code;
        fallbackError.cause = copyError;
        error = fallbackError;
      }
    }
    if (fs.existsSync(backup) && !fs.existsSync(immutableTarget)) renameSyncWithRetry(backup, immutableTarget, { ...options, guard });
    throw error;
  }
  if (fs.existsSync(backup)) {
    guard({ operation: 'remove-backup', path: backup, sourcePath: immutableSource, targetPath: immutableTarget });
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

function copyDirectoryAtomically(sourceDir, targetDir, requiredRelPath = 'SKILL.md', options = {}) {
  return withOwnedStaging({
    target: targetDir,
    stagePrefix: `.${path.basename(targetDir)}.staging-`,
    operation: options.operation || 'target-directory-copy',
    sourceType: options.sourceType || 'repo',
    guard: options.guard,
    beforeDelete: options.beforeDelete
  }, (staging) => {
    if (options.guard) options.guard({ operation: 'copy-stage', sourcePath: sourceDir, targetPath: staging });
    fs.cpSync(sourceDir, staging, { recursive: true });
    if (requiredRelPath && !fs.existsSync(path.join(staging, requiredRelPath))) {
      throw new Error(`staged target missing ${requiredRelPath}: ${staging}`);
    }
    if (options.guard) options.guard({ operation: 'before-target-skill-replacement', sourcePath: staging, targetPath: targetDir });
    replaceManagedDirectory(options.args, 'target.destination.write', mutationOptions, staging, targetDir);
  });
}

function writeFileAtomically(filePath, content, options = {}) {
  const immutablePath = path.resolve(filePath);
  const bytes = payloadBytes(content);
  const expectedDigest = sha256(bytes);
  const guard = (details) => {
    if (path.resolve(filePath) !== immutablePath || sha256(payloadBytes(content)) !== expectedDigest) {
      throw new Error('atomic file write operands changed before primitive');
    }
    if (options.guard) options.guard(details);
  };
  guard({ operation: 'mkdir', path: path.dirname(immutablePath), targetPath: immutablePath, sha256: expectedDigest });
  fs.mkdirSync(path.dirname(immutablePath), { recursive: true });
  const tempPath = path.join(path.dirname(immutablePath), `.${path.basename(immutablePath)}.tmp-${process.pid}-${Date.now()}`);
  guard({ operation: 'write-temp', path: tempPath, targetPath: immutablePath, sha256: expectedDigest });
  fs.writeFileSync(tempPath, bytes);
  guard({ operation: 'rename-temp', sourcePath: tempPath, targetPath: immutablePath, sha256: expectedDigest });
  fs.renameSync(tempPath, immutablePath);
  if (sha256(fs.readFileSync(immutablePath)) !== expectedDigest) throw new Error('atomic file write postcondition failed');
}

function skillBaseRel(targetName, skillName) {
  if (targetName === 'opencode') return skillName;
  if (targetName === 'ag2') return path.join('skills', skillName);
  throw new Error(`Unsupported target: ${targetName}`);
}

function skillPayloadForTarget(targetName, payload, skillName) {
  const prefix = slash(skillBaseRel(targetName, skillName));
  const skillPayload = {};
  for (const [rel, content] of Object.entries(payload)) {
    const normalized = slash(rel);
    if (normalized === prefix) continue;
    if (!normalized.startsWith(`${prefix}/`)) continue;
    skillPayload[normalized.slice(prefix.length + 1)] = content;
  }
  return skillPayload;
}

function rootPayloadForTarget(targetName, payload) {
  const rootPayload = {};
  for (const [rel, content] of Object.entries(payload)) {
    const normalized = slash(rel);
    if (targetName === 'ag2' && normalized.startsWith('skills/')) continue;
    if (targetName === 'opencode' && isValidSkillName(normalized.split('/')[0]) && normalized.includes('/')) continue;
    rootPayload[normalized] = content;
  }
  return rootPayload;
}

function writeSkillPayloadAtomically(targetPath, baseRel, payload, sourceType, options = {}) {
  const targetDir = path.join(targetPath, ...slash(baseRel).split('/'));
  const mutationOptions = options.mutationOptions;
  return withOwnedStaging({
    target: targetDir,
    stagePrefix: `.${path.basename(targetDir)}.staging-`,
    operation: 'target-skill-replacement',
    sourceType,
    args: options.args,
    authorityKind: 'target.destination.write',
    mutationOptions,
    guard: options.guard,
    beforeDelete: options.beforeDelete
  }, (staging) => {
    const intendedDigest = filePayloadChecksum(payload);
    writePayloadTree(staging, payload, {
      args: options.args,
      authorityKind: 'target.destination.write',
      mutationOptions,
      guard(actual) {
        if (options.primitiveGuard) options.primitiveGuard(actual);
        if (path.resolve(actual.root) !== path.resolve(staging) || actual.payload_sha256 !== intendedDigest) {
          throw new Error('target skill payload content changed before write');
        }
      }
    });
    if (!fs.existsSync(path.join(staging, 'SKILL.md'))) {
      throw new Error(`staged target skill missing SKILL.md: ${staging}`);
    }
    if (targetOutputChecksum(staging, payload) !== filePayloadChecksum(payload)) {
      throw new Error(`staged target skill content checksum mismatch: ${baseRel}`);
    }
    if (options.guard) options.guard({ operation: 'before-target-skill-replacement', sourcePath: staging, targetPath: targetDir });
    if (options.args) {
      replaceManagedDirectory(options.args, 'target.destination.write', options.mutationOptions, staging, targetDir);
    } else {
      replaceDirectoryAtomically(staging, targetDir, { guard: options.primitiveGuard || options.guard }); // Standalone/non-managed compatibility path.
    }
  });
}

function removeStaleManagedSkills(targetName, targetPath, previousNames, currentNames, options = {}) {
  const current = new Set(currentNames);
  const removed = [];
  for (const name of previousNames) {
    if (current.has(name)) continue;
    const targetDir = path.join(targetPath, ...slash(skillBaseRel(targetName, name)).split('/'));
    if (fs.existsSync(targetDir)) {
      if (options.beforeDelete) options.beforeDelete({ targetDir, skillName: name });
      if (options.guard) options.guard({ operation: 'remove-stale-skill', path: targetDir });
      if (options.args) removeManagedDirectoryPlan(options.args, 'target.destination.remove', options.mutationOptions, targetDir);
      else fs.rmSync(targetDir, { recursive: true, force: true }); // Standalone/non-managed compatibility path.
    }
    removed.push(name);
  }
  return removed.sort((left, right) => left.localeCompare(right));
}

function removeTargetManagedEntry(args, authorityKind, mutationOptions, filePath) {
  const target = path.resolve(filePath);
  const identity = filesystemIdentity(target, 'file');
  if (!identity) throw new Error(`managed removal target is not an ordinary file: ${target}`);
  admitActionSpecificEffect(args, authorityKind, mutationOptions);
  if (canonicalJson(filesystemIdentity(target, 'file')) !== canonicalJson(identity)) throw new Error('managed removal target identity drift');
  fs.rmSync(target, { force: false });
  if (fs.existsSync(target)) throw new Error('managed removal postcondition failed');
  return detachedFrozen({ action: 'removeTargetManagedEntry', path: target, identity });
}

function syncTargetPayload(targetName, targetPath, payloads, sourceType, options = {}) {
  const payload = appTargetPayload(targetName, payloads);
  const skillNames = targetSkillNames(targetName, payloads);
  const previousNames = previousManagedSkillNames(targetPath);
  const mutationOptions = {
    target: targetName,
    action: options.args ? scopeTargetAction(options.args, targetName) : '',
    details: { path: targetPath }
  };
  const effectGuard = (details = {}) => {
    if (!options.args) return;
    guardManagedPrimitive(options.args, 'target.destination.write', mutationOptions);
    const paths = [details.path, details.sourcePath, details.targetPath].filter(Boolean).map((value) => path.resolve(value));
    const parent = path.dirname(path.resolve(targetPath));
    if (paths.some((value) => value !== path.resolve(targetPath) && !isInside(targetPath, value) && !isInside(parent, value))) {
      throw new Error('target primitive escaped its immutable destination binding');
    }
  };
  const operationGuard = () => {
    if (options.args) guardManagedMutation(options.args, 'target.destination.write', mutationOptions);
  };
  effectGuard({ operation: 'mkdir-target', path: targetPath });
  if (options.args) ensureManagedDirectory(options.args, 'target.destination.write', mutationOptions, targetPath);
  else fs.mkdirSync(targetPath, { recursive: true }); // Standalone/non-managed compatibility path.

  for (const skillName of skillNames) {
    writeSkillPayloadAtomically(
      targetPath,
      skillBaseRel(targetName, skillName),
      skillPayloadForTarget(targetName, payload, skillName),
      sourceType,
      {
        args: options.args,
        mutationOptions,
        guard: effectGuard,
        primitiveGuard: effectGuard,
        beforeDelete(details) {
          if (options.testHooks?.beforeTargetStagingCleanup) {
            options.testHooks.beforeTargetStagingCleanup(details);
            operationGuard();
          }
        }
      }
    );
  }

  const staleNames = previousNames.filter((name) => !new Set(skillNames).has(name));
  const removalOptions = {
    args: options.args,
    mutationOptions: {
      target: targetName,
      action: options.args ? scopeTargetAction(options.args, targetName) : '',
      details: { path: targetPath, skill_names: staleNames }
    },
    guard: operationGuard,
    beforeDelete: options.testHooks?.beforeTargetStaleDelete
  };
  const removedSkillNames = removeStaleManagedSkills(targetName, targetPath, previousNames, skillNames, removalOptions);

  for (const [rel, content] of Object.entries(rootPayloadForTarget(targetName, payload))) {
    const rootFile = path.join(targetPath, ...slash(rel).split('/'));
    writeManagedAtomicFile(options.args, 'target.destination.write', mutationOptions, rootFile, content);
  }

  if (targetName === 'ag2' && options.proof?.status === 'PROVEN') {
    for (const legacyFile of ['plugin.json', 'installed_version.json', 'ai-agent-toolkit-ag2-adapter.json']) {
      const legacyPath = path.join(targetPath, legacyFile);
      if (fs.existsSync(legacyPath)) {
        if (options.testHooks?.beforeTargetLegacyDelete) options.testHooks.beforeTargetLegacyDelete({ legacyPath, targetName });
        operationGuard();
        effectGuard({ operation: 'remove-legacy-file', path: legacyPath });
        removeTargetManagedEntry(options.args, 'target.destination.remove', {
          target: targetName,
          action: scopeTargetAction(options.args, targetName),
          details: { path: targetPath, legacy_file: legacyPath }
        }, legacyPath);
      }
    }
  }

  if (options.testHooks?.afterTargetPayloadWrite) {
    options.testHooks.afterTargetPayloadWrite({ targetName, targetPath, payload, skillNames });
  }

  return {
    target: targetName,
    targetPath,
    skillNames,
    removedSkillNames
  };
}

function targetWouldSync(targetName, state, checksum, discovery, payloads) {
  const target = state.targets[targetName];
  if (!target.enabled) return false;
  if (target.explicitly_disabled) return false;
  if (targetName === 'ag2' && discovery?.projection_proof?.status !== 'PROVEN') return false;
  const targetCurrent = discovery && payloads ? targetOutputIsCurrent(targetName, discovery, payloads) : true;
  return target.synced_version !== BRIDGE_VERSION || target.synced_checksum !== checksum || !targetCurrent;
}

function targetIsSynced(targetName, targetState, checksum, discovery, payloads) {
  if (targetName === 'ag2' && discovery?.projection_proof?.status !== 'PROVEN') return false;
  return (
    targetState.synced_version === BRIDGE_VERSION &&
    targetState.synced_checksum === checksum &&
    targetOutputIsCurrent(targetName, discovery, payloads)
  );
}

function targetStatus(targetState, discovery, checksum) {
  if (targetState.explicitly_disabled) return 'disabled';
  if (targetState.enabled) return 'enabled';
  if (discovery.detected) return 'detected';
  return 'not detected';
}

function updateTargetState(state, targetName, discovery, checksum, synced, skipReason) {
  const target = state.targets[targetName];
  target.detected = discovery.detected;
  if (discovery.target_path) target.target_path = discovery.target_path;
  if (targetName === 'ag2' && discovery.legacy_target_path && !target.target_path) {
    target.target_path = discovery.legacy_target_path;
  }
  if (targetName === 'ag2' && discovery.projection_proof?.status === 'PROVEN') {
    target.skills_target_path = discovery.target_path;
    target.discovery_authority = 'supported-read-only-evidence';
    target.destination_kind = 'supported-skills-directory';
    target.skills_only = true;
    target.plugin_authority = false;
  }
  target.skip_reason = skipReason || '';
  if (synced) {
    target.synced_version = BRIDGE_VERSION;
    target.synced_checksum = checksum;
    target.last_sync = timestamp();
  }
}

function stagingAuditParents(hubPath, discoveries) {
  const parents = [path.dirname(hubPath)];
  const opencodeTarget = discoveries?.opencode?.target_path;
  const ag2Target = discoveries?.ag2?.target_path;
  if (opencodeTarget) parents.push(opencodeTarget);
  if (ag2Target) parents.push(path.join(ag2Target, 'skills'));
  return [...new Set(parents.map((value) => path.resolve(value)))];
}

function stagingReconciliationParents(args, hubPath, state) {
  const parents = [path.dirname(hubPath)];
  const openCodeConfig = args.opencodeConfigDir || process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  const openCodeDefaultTarget = path.join(openCodeConfig, 'skills');
  const openCodeTarget = normalizeOpenCodeTargetPath(
    args.opencodeTarget || state.targets.opencode.target_path || openCodeDefaultTarget,
    openCodeDefaultTarget
  );
  parents.push(assertSafeWritePath(openCodeTarget, 'OpenCode staging reconciliation parent'));

  const savedAg2SkillsTarget = String(state.targets.ag2.skills_target_path || '');
  if (savedAg2SkillsTarget) {
    parents.push(assertSafeWritePath(savedAg2SkillsTarget, 'AG2 skills projection staging reconciliation parent'));
  }
  return [...new Set(parents.map((value) => path.resolve(value)))];
}

function stagingReconciliationOutput({ args, hubPath, reconciliation }) {
  const alreadyAbsent = reconciliation.reason === 'generation-id-not-found';
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    dry_run: !args.write,
    hub_path: hubPath,
    sync_source: args.syncSource,
    staging_generations: reconciliation.audit,
    staging_reconciliation: {
      generation_id: args.reconcileStaging,
      reconciled: reconciliation.reconciled,
      status: reconciliation.reconciled
        ? 'cleaned'
        : (alreadyAbsent ? 'already-absent' : (reconciliation.would_reconcile ? 'would-clean' : 'refused')),
      checked_parent_count: reconciliation.exact_lookup?.checked_parents?.length || 0,
      reason: reconciliation.reason || ''
    }
  };
}

function runStagingReconciliation({ args, hubPath, state, testHooks = {} }) {
  const parents = stagingReconciliationParents(args, hubPath, state);
  if (!args.write) {
    const reconciliation = reconcileOwnedStaging(parents, args.reconcileStaging, {
      write: false,
      liveness: testHooks.stagingLiveness
    });
    if (!reconciliation.would_reconcile && reconciliation.reason !== 'generation-id-not-found') {
      throw new Error(`staging reconciliation refused: ${reconciliation.reason}`);
    }
    const output = stagingReconciliationOutput({ args, hubPath, reconciliation });
    console.log(JSON.stringify(output, null, 2));
    return { status: 0, audit: reconciliation.audit, reconciliation };
  }

  const reconciliationLock = acquireLock(path.dirname(hubPath), args);
  if (!reconciliationLock.acquired) {
    throw new Error(`staging reconciliation blocked: ${reconciliationLock.skipReason}`);
  }
  try {
    if (testHooks.afterLockAcquired) testHooks.afterLockAcquired({ route: 'staging-reconciliation', lock: reconciliationLock });
    const latestRawState = readJsonIfExists(path.join(hubPath, 'state.json'));
    if (testHooks.afterLockedStateRead) testHooks.afterLockedStateRead({ route: 'staging-reconciliation', latestRawState });
    const lockedParents = stagingReconciliationParents(args, hubPath, normalizedState(latestRawState));
    beginMutationPhase(args, { lock: reconciliationLock, hubPath, rawState: latestRawState, discoveries: {}, testHooks });
    const exact = lookupExactOwnedGeneration(lockedParents, args.reconcileStaging, { liveness: testHooks.stagingLiveness });
    const audit = auditOwnedStaging(lockedParents, { liveness: testHooks.stagingLiveness });
    let reconciliation;
    if (!exact.complete || exact.candidates.length !== 1) {
      reconciliation = {
        reconciled: false,
        reason: exact.complete ? (exact.candidates.length ? 'generation-id-ambiguous' : 'generation-id-not-found') : exact.reason,
        exact_lookup: exact,
        audit
      };
    } else if (!exact.candidates[0].safe_to_reconcile) {
      reconciliation = { reconciled: false, reason: `generation-not-safe:${exact.candidates[0].classification}`, exact_lookup: exact, audit };
    } else {
      const recordPath = exact.candidates[0].record_path;
      const record = readJsonIfExists(recordPath);
      const generation = { record, recordPath, stagePath: record.expected_staging_path };
      const cleanup = planOwnedGenerationCleanup(generation, { liveness: testHooks.stagingLiveness });
      if (!cleanup.cleanable) {
        reconciliation = { reconciled: false, reason: cleanup.reason, exact_lookup: exact, audit };
      } else {
        if (testHooks.beforeStagingReconciliationDelete) {
          testHooks.beforeStagingReconciliationDelete(detachedFrozen({ generation, inspection: cleanup.inspection }));
        }
        const mutationOptions = { details: { generation_id: args.reconcileStaging, parents: lockedParents } };
        for (const entry of cleanup.entries) removeOwnedGenerationEntry(args, 'staging.reconcile', mutationOptions, entry);
        reconciliation = { reconciled: true, reason: '', exact_lookup: exact, generation: cleanup.inspection, audit };
      }
    }
    if (!reconciliation.reconciled && reconciliation.reason !== 'generation-id-not-found') {
      throw new Error(`staging reconciliation refused: ${reconciliation.reason}`);
    }
    const output = stagingReconciliationOutput({ args, hubPath, reconciliation });
    console.log(JSON.stringify(output, null, 2));
    return { status: 0, audit: reconciliation.audit, reconciliation };
  } finally {
    releaseLock(reconciliationLock);
  }
}

function buildAudit({ args, hubPath, state, discoveries, checksum, payloads }) {
  const dryRun = !args.write;
  const targetNeedsSync = Object.fromEntries(SUPPORTED_TARGETS.map((target) => [
    target,
    targetWouldSync(target, state, checksum, discoveries[target], payloads)
  ]));
  const authorisedTargetWrites = SUPPORTED_TARGETS.filter((target) => (
    scopeAllowsTargetSync(args, target) && targetNeedsSync[target]
  ));
  const outOfScopeStaleTargets = SUPPORTED_TARGETS.filter((target) => (
    targetNeedsSync[target] && !scopeAllowsTargetSync(args, target)
  ));
  const plannedWrites = [];
  for (const target of authorisedTargetWrites) {
    plannedWrites.push({ kind: 'hub-adapter-subtree', target, path: path.join(hubPath, 'adapters', target) });
    plannedWrites.push({ kind: 'managed-target-destination', target, path: discoveries[target].target_path });
  }
  for (const target of SUPPORTED_TARGETS.filter((name) => scopeTargetAction(args, name) === 'disable')) {
    plannedWrites.push({ kind: 'target-state-disable', target, path: path.join(hubPath, 'state.json') });
  }
  if (authorisedTargetWrites.length || SUPPORTED_TARGETS.some((name) => scopeTargetAction(args, name))) {
    plannedWrites.push({ kind: 'hub-metadata', path: path.join(hubPath, 'state.json') });
    plannedWrites.push({ kind: 'hub-metadata', path: path.join(hubPath, 'manifest.json') });
  }
  if (actionAuthorised(args, 'report.cleanup')) {
    plannedWrites.push({ kind: 'update-report-maintenance', path: updateReportDir() });
  }
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    running_bridge_source: args.syncSource,
    running_bridge_version: BRIDGE_VERSION,
    bridge_versions_by_source: { ...state.bridge_versions_by_source },
    hub_reporting_version: state.hub_version,
    downgrade_enforcement_source: args.syncSource,
    dry_run: dryRun,
    execution_authority: args.executionAuthority,
    delegated_receipt: args.delegatedReceipt || null,
    requested_authority: { entrypoint: args.executionAuthority?.entrypoint || '' },
    authorised_actions: derivedActionSummary(args),
    eligible_actions: {
      target_sync: authorisedTargetWrites,
      preferences: authorityPreferenceFields(args)
    },
    blocked_actions: SUPPORTED_TARGETS
      .filter((target) => scopeAllowsTargetSync(args, target) && !targetNeedsSync[target])
      .map((target) => ({ target, action: 'sync', reason: 'not stale or proof unavailable' })),
    out_of_scope_stale_targets: outOfScopeStaleTargets,
    planned_writes: plannedWrites,
    hub_path: hubPath,
    lock_path: path.join(path.dirname(hubPath), 'update.lock'),
    sync_source: args.syncSource,
    auto_sync_enabled: state.auto_sync_enabled,
    update_report_enabled: state.update_report_enabled,
    update_report_open_enabled: state.update_report_open_enabled,
    update_report_open_behavior: state.update_report_open_behavior,
    legacy_update_report_open_migrated: state.legacy_update_report_open_migrated,
    update_report_retention_days: state.update_report_retention_days,
    update_report_cleanup: state.last_update_report_cleanup || {
      retention_days: state.update_report_retention_days,
      report_log_directory: updateReportDir(),
      max_report_files: DEFAULT_UPDATE_REPORT_MAX_FILES,
      deleted_count: 0,
      skipped_count: 0,
      error_count: 0,
      errors: []
    },
    codex_plugin_auto_refresh_enabled: state.codex_plugin_auto_refresh_enabled,
    last_update_report_path: state.last_update_report_path,
    repo_auto_update: {
      enabled: state.repo_auto_update_enabled,
      repo_path: state.repo_path,
      repo_branch: state.repo_branch,
      repo_remote: state.repo_remote,
      last_update: state.last_repo_update,
      last_status: state.last_repo_update_status,
      from_commit: state.last_repo_update_from_commit,
      to_commit: state.last_repo_update_to_commit,
      error: state.last_repo_update_error
    },
    checksum,
    staging_generations: auditOwnedStaging(stagingAuditParents(hubPath, discoveries)),
    targets: Object.fromEntries(SUPPORTED_TARGETS.map((target) => {
      const targetState = state.targets[target];
      const discovery = discoveries[target];
      return [target, {
        status: target === 'ag2' && discovery.projection_proof?.status !== 'PROVEN'
          ? 'blocked-proof'
          : targetStatus(targetState, discovery, checksum),
        detected: discovery.detected,
        enabled: targetState.enabled,
        explicitly_disabled: targetState.explicitly_disabled,
        target_path: discovery.target_path,
        legacy_target_path: target === 'ag2' ? discovery.legacy_target_path || '' : undefined,
        skills_target_path: target === 'ag2' ? targetState.skills_target_path || '' : undefined,
        target_exists: targetOutputExists(target, discovery, payloads),
        internal_adapter_path: discovery.internal_adapter_path,
        internal_adapter_exists: fs.existsSync(discovery.internal_adapter_path),
        synced: targetIsSynced(target, targetState, checksum, discovery, payloads),
        synced_version: targetState.synced_version,
        synced_at: targetState.last_sync,
        ag2_package_detected: target === 'ag2' ? discovery.ag2_package_detected : undefined,
        projection_proof: target === 'ag2' ? discovery.projection_proof : undefined,
        python_command: target === 'ag2' ? discovery.python_command || '' : undefined,
        needs_sync: targetNeedsSync[target],
        authorised_would_write: scopeAllowsTargetSync(args, target) && targetNeedsSync[target],
        would_write: scopeAllowsTargetSync(args, target) && targetNeedsSync[target],
        skip_reason: targetState.enabled ? targetState.skip_reason : 'not enabled',
        signals: discovery.signals
      }];
    }))
  };
}

function isHookNoop(args, existingState) {
  if (!args.hook) return false;
  if (actionAuthorised(args, 'repository.fetch') || actionAuthorised(args, 'native.cache.maintenance')) return false;
  return !SUPPORTED_TARGETS.some((target) => scopeTargetAction(args, target));
}

function shouldRunRepoAutoUpdate(args, state) {
  if (!actionAuthorised(args, 'repository.fetch')) return false;
  if (!args.write) return false;
  if (args.skipRepoAutoUpdate) return false;
  if (!state.repo_auto_update_enabled) return false;
  return args.hook || args.repoUpdateNow;
}

function downgradeRemediation(syncSource) {
  if (syncSource === 'claude-plugin') {
    return 'the installed Claude Code plugin cache is stale; run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then restart Claude Code. If using the raw native command, run `claude plugin update ai-agent-toolkit@ai-agent-toolkit-local --scope user`; if it still reports stale, rerun setup so it can reinstall through the supported Claude Code marketplace path';
  }
  if (syncSource === 'codex-plugin') {
    return 'the installed Codex plugin cache is stale; run `setup toolkit` in Codex to refresh it';
  }
  return 'update or restore the managed Toolkit source checkout, or rerun `setup toolkit`';
}

function recordedBridgeVersionForSource(state, syncSource) {
  assertRecognizedSyncSource(syncSource);
  const version = state?.bridge_versions_by_source?.[syncSource] || '';
  return isValidBridgeVersion(version) ? version : '';
}

function assertSourceDowngradeAllowed(state, args) {
  assertRecognizedSyncSource(args.syncSource);
  const recordedVersion = recordedBridgeVersionForSource(state, args.syncSource);
  if (!recordedVersion || compareBridgeVersions(BRIDGE_VERSION, recordedVersion) >= 0 || args.forceDowngrade) return;
  const forceGuidance = args.hook ? '' : '; use `--force-downgrade` only for explicit manual same-source recovery';
  throw new Error(
    `Refusing downgrade for sync source ${args.syncSource}: running bridge ${BRIDGE_VERSION} is older than recorded ${args.syncSource} bridge ${recordedVersion}; ${downgradeRemediation(args.syncSource)}${forceGuidance}`
  );
}

function hookSafeWarning(args, message) {
  if (args.hook) {
    console.log(`Toolkit local bridge hook skipped: ${sanitizeOutputMessage(message)}`);
  }
}

function runtimeCodexPluginRoot() {
  return path.resolve(process.env.PLUGIN_ROOT || path.resolve(__dirname, '..', '..'));
}

function runtimeClaudePluginRoot() {
  return path.resolve(process.env.CLAUDE_PLUGIN_ROOT || process.env.PLUGIN_ROOT || path.resolve(__dirname, '..', '..'));
}

function codexNativePluginCacheStatus(args, state) {
  if (!args.hook || args.syncSource !== 'codex-plugin') return { status: '' };
  if (!state.repo_path) return { status: '' };
  const repoPath = path.resolve(state.repo_path);
  if (!fs.existsSync(repoPath)) return { status: '' };
  const codexHome = path.resolve(defaultCodexHome());
  const configurationProof = inspectCodexToolkitConfigurationProof({ codexHome });
  if (configurationProof.trusted && configurationProof.user_disabled === true) {
    return {
      status: 'user-disabled',
      host: 'codex',
      codex_home: codexHome,
      repo_path: repoPath,
      plugin_id: pluginId(),
      user_disabled: true,
      configuration_proof: configurationProof,
      installed_state_proof: null,
      errors: []
    };
  }
  if (configurationProof.trusted !== true || configurationProof.enabled !== true) {
    return {
      status: 'unverified',
      host: 'codex',
      codex_home: codexHome,
      repo_path: repoPath,
      plugin_id: pluginId(),
      configuration_proof: configurationProof,
      installed_state_proof: null,
      errors: [configurationProof.reason || 'Current Codex Toolkit configuration could not be proven']
        .slice(0, NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT)
    };
  }

  const installedState = inspectCodexToolkitInstalledState({
    codexHome,
    repoRoot: repoPath,
    codexCommand: process.env.CODEX_TOOLKIT_CODEX_CLI || ''
  });
  const installedStateProof = installedState.proof || null;
  const installedErrors = installedState.errors || [];
  const status = installedState.ok
    ? 'fresh'
    : (installedStateProof?.reported_version ? 'stale'
      : (installedErrors.some((error) => /is not installed/i.test(error)) ? 'missing' : 'unverified'));
  return {
    status,
    host: 'codex',
    codex_home: codexHome,
    plugin_root: installedStateProof?.cache_root || '',
    repo_path: repoPath,
    plugin_id: pluginId(),
    version: installedStateProof?.reported_version || null,
    fingerprint: installedStateProof?.fingerprint || null,
    fingerprint_verified: installedStateProof?.fingerprint_verified === true,
    bytes_verified: installedStateProof?.bytes_verified === true,
    cache_manifest_version: installedStateProof?.cache_manifest_version || null,
    configuration_proof: configurationProof,
    installed_state_proof: installedStateProof,
    errors: installedErrors.slice(0, NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT)
  };
}

function claudeNativePluginCacheStatus(args, state) {
  if (!args.hook || args.syncSource !== 'claude-plugin') return { status: '' };
  return {
    status: 'check-only',
    host: 'claude-code',
    plugin_root: runtimeClaudePluginRoot(),
    repo_path: state.repo_path ? path.resolve(state.repo_path) : '',
    manual_action: 'If Claude Code reports the Toolkit plugin is stale, missing, disabled, or untrusted, refresh it through Claude Code native plugin flow. Codex does not mutate Claude Code cache.'
  };
}

function nativePluginCacheStatus(args, state) {
  if (args.syncSource === 'codex-plugin') return codexNativePluginCacheStatus(args, state);
  if (args.syncSource === 'claude-plugin') return claudeNativePluginCacheStatus(args, state);
  return { status: '' };
}

function isToolkitCodexCacheRoot(cacheRoot, currentPluginRoot) {
  const normalized = path.resolve(cacheRoot);
  if (currentPluginRoot && path.resolve(currentPluginRoot) === normalized) return true;
  const parts = normalized.split(path.sep).map((part) => part.toLowerCase());
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (
      parts[index] === 'ai-agent-toolkit-local' &&
      parts[index + 1] === 'ai-agent-toolkit'
    ) {
      return true;
    }
  }
  return false;
}

function discoverCodexPluginHookRoots({ codexHome = defaultCodexHome(), currentPluginRoot = '' } = {}) {
  const cacheBase = path.join(codexHome, 'plugins', 'cache');
  const roots = [];
  const skipped = [];
  if (!fs.existsSync(cacheBase)) return { roots, skipped };

  for (const marketplace of fs.readdirSync(cacheBase, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const marketplacePath = path.join(cacheBase, marketplace.name);
    for (const plugin of fs.readdirSync(marketplacePath, { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      const pluginPath = path.join(marketplacePath, plugin.name);
      for (const version of fs.readdirSync(pluginPath, { withFileTypes: true })) {
        if (!version.isDirectory()) continue;
        const cacheRoot = path.join(pluginPath, version.name);
        const entry = {
          plugin_id: `${plugin.name}@${marketplace.name}`,
          version: version.name,
          plugin_root: cacheRoot
        };
        if (isToolkitCodexCacheRoot(cacheRoot, currentPluginRoot)) {
          skipped.push({ ...entry, reason: 'toolkit native plugin cache' });
          continue;
        }
        roots.push(entry);
      }
    }
  }
  roots.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
  skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
  return { roots, skipped };
}

function selectCurrentN8nSkillsCache({ codexHome, pluginList, discovered }) {
  const matches = findInstalledPluginEntries(pluginList, {
    pluginId: 'n8n-skills@n8n-io',
    name: 'n8n-skills',
    marketplaceName: 'n8n-io'
  });
  if (matches.length === 0) {
    return { status: 'not-installed', entry: null, reason: 'Codex reports no installed n8n-skills@n8n-io plugin' };
  }
  if (matches.length !== 1) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: 'Codex reports multiple installed n8n-skills@n8n-io entries; current cache is ambiguous'
    };
  }

  const installed = matches[0];
  if (installed.installed !== true || installed.enabled !== true) {
    return {
      status: 'not-installed',
      entry: null,
      reason: 'Codex does not report n8n-skills@n8n-io as installed and enabled'
    };
  }
  const version = typeof installed.version === 'string' ? installed.version.trim() : '';
  if (!version || version === '.' || version === '..' || /[\\/\0]/.test(version)) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: 'Codex reported an invalid n8n-skills@n8n-io version; current cache cannot be proven'
    };
  }

  const expectedRoot = path.resolve(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', version);
  const entry = discovered.roots.find((candidate) =>
    candidate.plugin_id === 'n8n-skills@n8n-io' && path.resolve(candidate.plugin_root) === expectedRoot
  ) || null;
  if (!entry) {
    return {
      status: 'missing',
      entry: null,
      reason: `Codex reports current n8n-skills@n8n-io version ${version}, but its installed cache root is missing`
    };
  }
  return { status: 'selected', entry, reason: '' };
}

function selectCurrentN8nSkillsCacheFromConfig({ codexHome, discovered }) {
  const configured = inspectCodexConfiguredPluginState({
    codexHome,
    identity: 'n8n-skills@n8n-io'
  });
  if (configured.status === 'disabled') {
    return {
      status: 'not-installed',
      entry: null,
      reason: 'Codex config explicitly reports n8n-skills@n8n-io disabled'
    };
  }
  if (configured.status !== 'enabled') {
    return {
      status: 'ambiguous',
      entry: null,
      reason: `Codex CLI omitted n8n-skills@n8n-io and current installed/enabled state cannot be proven: ${configured.reason}`
    };
  }

  const candidates = discovered.roots.filter((entry) => entry.plugin_id === 'n8n-skills@n8n-io');
  if (candidates.length !== 1) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: `Codex config explicitly enables n8n-skills@n8n-io, but ${candidates.length} cache candidates exist; the current cache cannot be proven without arbitrary selection`
    };
  }
  return {
    status: 'selected',
    entry: candidates[0],
    reason: 'Selected by explicit Codex config enablement plus one exact n8n Skills cache candidate'
  };
}

function applyNativeHookRepairFile(args, codexHome, plannedWrite) {
  const filePath = path.resolve(plannedWrite.path);
  if (!isInside(codexHome, filePath)) throw new Error('native hook repair plan escaped the verified Codex home');
  const after = Buffer.from(plannedWrite.after_base64, 'base64');
  if (after.length !== plannedWrite.after_byte_length || sha256(after) !== plannedWrite.after_sha256) {
    throw new Error('native hook repair plan after-bytes are inconsistent');
  }
  const phase = validatePhaseContext(args.phaseContext);
  if (phase.testHooks?.beforeManagedEffectAdmission) {
    phase.testHooks.beforeManagedEffectAdmission({
      kind: 'applyNativeHookRepairFile',
      options: detachedFrozen({ file_path: filePath, before_sha256: plannedWrite.before_sha256, after_sha256: plannedWrite.after_sha256 })
    });
  }
  assertActualMutationInput(args, 'third-party.hook.repair', { details: { path: codexHome, file_path: filePath } });
  revalidateBeforeFirstMutation(args);
  validatePhaseContext(args.phaseContext);
  let before = null;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || path.resolve(fs.realpathSync.native(filePath)) !== filePath) {
      throw new Error('native hook repair target is not an ordinary file');
    }
    before = fs.readFileSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (plannedWrite.before_exists !== (before !== null)) throw new Error('native hook repair target existence changed before write');
  if (before && (before.length !== plannedWrite.before_byte_length || sha256(before) !== plannedWrite.before_sha256)) {
    throw new Error('native hook repair target bytes changed before write');
  }
  fs.writeFileSync(filePath, after, { flag: plannedWrite.before_exists ? 'w' : 'wx' });
  const readback = fs.readFileSync(filePath);
  if (!readback.equals(after)) throw new Error('native hook repair file postcondition failed');
  phase.firstMutation = true;
  return detachedFrozen({ action: 'applyNativeHookRepairFile', path: filePath, before_sha256: plannedWrite.before_sha256, after_sha256: plannedWrite.after_sha256 });
}

function launchVerifiedNativeSetupChild(args, receipt) {
  if (!receipt || receipt.contract !== VERIFIED_SOURCE_RECEIPT_CONTRACT) throw new Error('native setup requires the verifier-owned source receipt');
  if (!receipt.native_setup) throw new Error('verifier-owned source receipt omitted native setup identity');
  verifySourceReceiptContinuity(receipt, 'pre-launch');
  const resolvedRepo = path.resolve(receipt.repository.root);
  const resolvedScript = path.resolve(resolvedRepo, receipt.native_setup.entry_relative_path);
  if (resolvedScript !== path.join(resolvedRepo, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs')) {
    throw new Error('native setup child path does not match the verified repository');
  }
  const environment = { ...process.env };
  const sourceBytes = fs.readFileSync(resolvedScript);
  if (sha256(sourceBytes) !== receipt.native_setup.entry_sha256) throw new Error('native setup source differs from the verifier-owned receipt');
  const nativePhaseId = crypto.randomUUID();
  const nativePhaseLockPath = path.join(path.resolve(defaultCodexHome()), `.ai-agent-toolkit-native-phase-${nativePhaseId}.json`);
  const delegatedAuthority = deepFreeze({
    contract: 'toolkit.local-bridge.delegated-native-setup-authority.v1',
    parent_invocation_id: args.executionAuthority.invocation_id,
    action: 'native.cache.maintenance',
    repository: resolvedRepo,
    codex_home: path.resolve(defaultCodexHome()),
    setup_source_sha256: receipt.native_setup.entry_sha256,
    source_cache_fingerprint: receipt.native_setup.cache_fingerprint,
    verified_source: {
      receipt_id: receipt.receipt_id,
      commit: receipt.commit,
      tree: receipt.tree,
      setup_source_sha256: receipt.native_setup.entry_sha256,
      source_manifest_digest: receipt.source_manifest_digest
    },
    mutation_phase_id: nativePhaseId,
    mutation_phase_lock_path: nativePhaseLockPath,
    executable: path.resolve(process.execPath),
    expected_version: EXPECTED_TOOLKIT_VERSION,
    env_digest: sha256(canonicalJson(environment)),
    allowed_effects: [
      'codex.command.probe',
      'codex.plugin.list',
      'codex.marketplace.add',
      'codex.plugin.remove',
      'codex.plugin.add',
      'codex.session-start.write',
      'toml.structural.check'
    ]
  });
  const delegatedArgument = Buffer.from(canonicalJson(delegatedAuthority), 'utf8').toString('base64url');
  const commandArgs = [resolvedScript, '--write', '--json', '--repo-root', resolvedRepo, '--delegated-invocation-authority', delegatedArgument];
  const mutationOptions = {
    details: {
      path: path.resolve(defaultCodexHome()),
      repoPath: resolvedRepo,
      executable: process.execPath,
      source_sha256: receipt.native_setup.entry_sha256,
      receipt_id: receipt.receipt_id,
      source_cache_fingerprint: receipt.native_setup.cache_fingerprint,
      arguments: commandArgs,
      cwd: resolvedRepo,
      env_digest: sha256(canonicalJson(environment))
    }
  };
  admitActionSpecificEffect(args, 'native.cache.maintenance', mutationOptions);
  verifySourceReceiptContinuity(receipt, 'pre-launch');
  if (sha256(fs.readFileSync(resolvedScript)) !== mutationOptions.details.source_sha256) throw new Error('native setup child source changed before launch');
  const result = directProcessResult(spawnSync(process.execPath, commandArgs, {
    cwd: resolvedRepo,
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
    env: environment,
    maxBuffer: 16 * 1024 * 1024
  }));
  return {
    result,
    evidence: detachedFrozen({
      action: 'launchVerifiedNativeSetupChild',
      source_sha256: mutationOptions.details.source_sha256,
      executable_sha256: sha256(fs.readFileSync(process.execPath)),
      argv_digest: sha256(canonicalJson(commandArgs)),
      delegated_authority_digest: sha256(canonicalJson(delegatedAuthority)),
      cwd: resolvedRepo,
      env_digest: mutationOptions.details.env_digest,
      exit_status: result.status
    })
  };
}

function repairThirdPartyCodexPluginHooks(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const windows = options.windows ?? process.platform === 'win32';
  const write = Boolean(options.write);
  const currentPluginRoot = options.currentPluginRoot || runtimeCodexPluginRoot();
  const discovered = discoverCodexPluginHookRoots({ codexHome, currentPluginRoot });
  const result = {
    status: windows ? 'not-needed' : 'not-supported',
    codex_home: codexHome,
    write,
    scanned: 0,
    skipped: discovered.skipped,
    repaired: [],
    unchanged: [],
    errors: []
  };

  if (!windows) return result;

  const n8nCandidates = [];
  for (const entry of discovered.roots) {
    if (entry.plugin_id === 'n8n-skills@n8n-io') n8nCandidates.push(entry);
    else result.skipped.push({ ...entry, reason: 'unrelated plugin; n8n Skills reconciliation is target-specific' });
  }
  if (n8nCandidates.length === 0) {
    result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
    return result;
  }

  const pluginInspection = Object.prototype.hasOwnProperty.call(options, 'pluginList')
    ? { ok: true, pluginList: options.pluginList, errors: [] }
    : inspectCodexPluginList({ codexCommand: options.codexCommand || '' });
  const cliMatches = pluginInspection.ok
    ? findInstalledPluginEntries(pluginInspection.pluginList, {
      pluginId: 'n8n-skills@n8n-io',
      name: 'n8n-skills',
      marketplaceName: 'n8n-io'
    })
    : [];
  const selection = pluginInspection.ok && cliMatches.length > 0
    ? selectCurrentN8nSkillsCache({
      codexHome,
      pluginList: pluginInspection.pluginList,
      discovered
    })
    : selectCurrentN8nSkillsCacheFromConfig({ codexHome, discovered });
  if (selection.status !== 'selected') {
    for (const entry of n8nCandidates) {
      result.skipped.push({ ...entry, reason: 'historical or unverified n8n Skills cache; not current according to Codex installed state' });
    }
    result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
    if (selection.status === 'not-installed') return result;
    result.status = 'repair-failed';
    result.errors = [
      selection.reason,
      ...(!pluginInspection.ok ? (pluginInspection.errors || []) : [])
    ].slice(0, THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT);
    return result;
  }

  const targets = [selection.entry];
  for (const entry of n8nCandidates) {
    if (path.resolve(entry.plugin_root) === path.resolve(selection.entry.plugin_root)) continue;
    result.skipped.push({ ...entry, reason: 'historical n8n Skills cache; not current according to Codex installed state' });
  }
  result.scanned = 1;
  result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));

  for (const entry of targets) {
    try {
      let repair;
      if (write && options.managedArgs) {
        const plan = planN8nSkillsPluginRepair(entry.plugin_root, { windows: true });
        const evidence = plan.writes.map((plannedWrite) => applyNativeHookRepairFile(options.managedArgs, codexHome, plannedWrite));
        const after = reconcileN8nSkillsPlugin(entry.plugin_root, { windows: true, write: false });
        if (after.status !== 'healthy') throw new Error(`managed n8n Skills repair verification failed: ${after.status}`);
        repair = { repaired: evidence.length > 0, actions: plan.actions, evidence };
      } else {
        // Explicitly standalone/non-managed compatibility path. The managed Bridge
        // always uses the pure plan plus applyNativeHookRepairFile above.
        repair = reconcileN8nSkillsPlugin(entry.plugin_root, { windows: true, write });
      }
      if (repair.repaired) {
        result.repaired.push({
          ...entry,
          actions: repair.actions || []
        });
      } else {
        result.unchanged.push({ ...entry, classification: repair.status });
      }
    } catch (error) {
      result.errors.push(`${entry.plugin_id}: ${error.message}`);
    }
  }

  if (result.errors.length && result.repaired.length) result.status = 'partial-failed';
  else if (result.errors.length) result.status = 'repair-failed';
  else if (result.repaired.length) result.status = 'repaired';
  else result.status = 'not-needed';
  result.errors = result.errors.slice(0, THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT);
  return result;
}

function maybeRepairThirdPartyCodexPluginHooks(args, state) {
  if (!actionAuthorised(args, 'third-party.hook.repair')) return { status: '' };
  if (!args.hook || args.syncSource !== 'codex-plugin') return { status: '' };
  if (!state.codex_plugin_auto_refresh_enabled) return { status: '' };
  return repairThirdPartyCodexPluginHooks({
    write: true,
    currentPluginRoot: runtimeCodexPluginRoot(),
    managedArgs: args
  });
}

function refreshCodexNativePluginCacheFromRepo({ args, state, repoPath, validateRepo = false, verifiedSourceReceipt = null }) {
  const before = codexNativePluginCacheStatus(args, state);
  if (!['stale', 'missing'].includes(before.status)) return before;
  if (!state.codex_plugin_auto_refresh_enabled) return before;
  const resolvedRepoPath = path.resolve(repoPath || state.repo_path || '');
  let receipt = verifiedSourceReceipt;
  if (validateRepo) {
    try {
      const validation = runNativeRepositoryValidation(args, resolvedRepoPath, { hookMode: true });
      receipt = createVerifiedSourceReceipt({
        repoPath: resolvedRepoPath,
        branch: state.repo_branch || DEFAULT_REPO_BRANCH,
        remote: state.repo_remote || DEFAULT_REPO_REMOTE,
        validation
      });
      verifySourceReceiptContinuity(receipt, 'post-verification');
    } catch (error) {
      return {
        ...before,
        status: 'refresh-failed',
        errors: [`Codex plugin cache auto-refresh skipped because trusted repo validation failed: ${error.message}`]
      };
    }
  }
  if (!receipt) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: ['Codex plugin cache auto-refresh has no verifier-owned source receipt']
    };
  }
  if (args.testHooks?.afterNativeSourceReceipt) args.testHooks.afterNativeSourceReceipt(detachedFrozen({ receipt: verifiedSourceEvidence(receipt) }));
  try {
    verifySourceReceiptContinuity(receipt, 'refresh-relock');
  } catch (error) {
    error.sourceContinuityFailure = true;
    throw error;
  }
  const setupScript = path.join(resolvedRepoPath, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs');
  if (!fs.existsSync(setupScript)) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: [`Codex plugin setup helper not found in trusted repo: ${setupScript}`]
    };
  }
  const sourceErrors = validateRepoPluginSource(resolvedRepoPath, EXPECTED_TOOLKIT_VERSION);
  if (sourceErrors.length) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: sourceErrors.slice(0, NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT)
    };
  }
  const sourceFingerprint = receipt.native_setup.cache_fingerprint;
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint)) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: ['Codex plugin cache auto-refresh could not establish a valid trusted repo fingerprint']
    };
  }
  let refreshResult = null;
  const sourceProof = {
    trusted: true,
    ambiguous: false,
    plugin_id: pluginId(),
    source_root: resolvedRepoPath,
    version: EXPECTED_TOOLKIT_VERSION,
    fingerprint: sourceFingerprint,
    source_fingerprint: sourceFingerprint,
    fingerprint_verified: true,
    evidence_source: 'trusted-repo-validation'
  };
  const configurationProof = before.configuration_proof;
  const recovery = recoverCodexCache({
    expectedVersion: EXPECTED_TOOLKIT_VERSION,
    refresh_required: true,
    source_proof: sourceProof,
    configuration_proof: configurationProof,
    refreshSupported: () => {
      verifySourceReceiptContinuity(receipt, 'refresh-relock');
      const launched = launchVerifiedNativeSetupChild(args, receipt);
      refreshResult = launched.result;
      return refreshResult.ok;
    },
    rediscover: () => {
      const codexHome = path.resolve(defaultCodexHome());
      const activeState = inspectCodexToolkitInstalledState({
        codexHome,
        repoRoot: resolvedRepoPath,
        codexCommand: process.env.CODEX_TOOLKIT_CODEX_CLI || ''
      });
      const proof = activeState.proof || null;
      return {
        present: activeState.ok === true,
        trusted: proof?.trusted === true,
        version: proof?.reported_version || null,
        bytes_verified: proof?.bytes_verified === true,
        fingerprint: proof?.fingerprint || null,
        source_fingerprint: proof?.source_fingerprint || null,
        cache_fingerprint: proof?.cache_fingerprint || null,
        fingerprint_verified: proof?.fingerprint_verified === true,
        cache_root: proof?.cache_root || null,
        installed_state_proof: proof,
        status: activeState.ok ? 'fresh' : (proof?.reported_version ? 'stale' : 'unverified'),
        executing: false,
        trust_failure: proof?.trusted !== true,
        structural_failure: proof?.ambiguous === true,
        errors: activeState.errors || []
      };
    }
  });
  if (!recovery.healthy) {
    const detail = refreshResult && !refreshResult.ok ? commandOutput(refreshResult) : recovery.reason_code;
    return {
      ...before,
      status: 'refresh-failed',
      errors: [`Codex plugin cache auto-refresh failed: ${detail}`]
    };
  }
  return {
    ...before,
    status: 'refreshed',
    plugin_root: recovery.cache_root,
    version: recovery.cache_version,
    fingerprint: recovery.cache_fingerprint,
    fingerprint_verified: true,
    installed_state_proof: recovery.installed_state_proof,
    errors: []
  };
}

function nativePluginCacheStatusForReport(args, state, options = {}) {
  if (
    args.syncSource === 'codex-plugin' &&
    actionAuthorised(args, 'native.cache.maintenance')
  ) {
    return refreshCodexNativePluginCacheFromRepo({
      args,
      state,
      repoPath: options.repoPath || state.repo_path,
      validateRepo: options.validateRepo === true,
      verifiedSourceReceipt: options.verifiedSourceReceipt || null
    });
  }
  return nativePluginCacheStatus(args, state);
}

function verifyDelegatedRepositoryResult({ args, repoPath, snapshot, updateResult }) {
  const receipt = updateResult.verifiedSourceReceipt;
  if (!receipt) throw new Error('repository verification did not originate a verified source receipt');
  verifySourceReceiptContinuity(receipt, 'refresh-relock');
  const verified = deepFreeze({
    path: path.resolve(repoPath),
    branch: args.executionAuthority.bindings.repository.branch,
    remote: args.executionAuthority.bindings.repository.remote,
    commit: updateResult.toCommit,
    tree: receipt.tree,
    entry_relative_path: receipt.entry.relative_path,
    source_identity: receipt.entry.sha256,
    source_manifest_digest: receipt.source_manifest_digest,
    receipt_id: receipt.receipt_id,
    receipt
  });
  const currentCommit = currentToolkitCommit({ repo_path: repoPath });
  const branch = gitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = gitCommand(repoPath, ['remote', 'get-url', 'origin']);
  if (currentCommit !== verified.commit || snapshot.sourceCommit !== verified.commit) {
    throw new Error('delegated repository commit changed after verified update result');
  }
  if (!branch.ok || branch.stdout.trim() !== verified.branch) throw new Error('delegated repository branch changed after verified update result');
  if (!remote.ok || normalizeRemoteForCompare(remote.stdout.trim()) !== normalizeRemoteForCompare(verified.remote)) {
    throw new Error('delegated repository remote changed after verified update result');
  }
  return verified;
}

function buildDelegatedAuthorityEnvelope({ args, hubPath, snapshot, verifiedRepositoryResult }) {
  const repoPath = verifiedRepositoryResult.path;
  const receipt = verifiedRepositoryResult.receipt;
  verifySourceReceiptContinuity(receipt, 'envelope-construction');
  const targetActions = Object.fromEntries(Object.entries(args.executionAuthority.actions.targets || {})
    .filter(([, action]) => ['enable-sync', 'sync'].includes(action)));
  const targetDestinations = Object.fromEntries(Object.keys(targetActions).map((target) => [
    target,
    path.resolve(snapshot.discoveries[target].target_path)
  ]));
  return deepFreeze({
    contract: DELEGATED_AUTHORITY_CONTRACT,
    parent_invocation_id: args.executionAuthority.invocation_id,
    actions: { targets: targetActions },
    destinations: { targets: targetDestinations },
    hub: { path: path.resolve(hubPath) },
    repository_result: {
      path: verifiedRepositoryResult.path,
      branch: verifiedRepositoryResult.branch,
      remote: verifiedRepositoryResult.remote,
      commit: verifiedRepositoryResult.commit,
      tree: verifiedRepositoryResult.tree
    },
    child: {
      entry_relative_path: verifiedRepositoryResult.entry_relative_path,
      source_identity: verifiedRepositoryResult.source_identity,
      source_repository: verifiedRepositoryResult.path,
      source_commit: verifiedRepositoryResult.commit,
      source_tree: verifiedRepositoryResult.tree,
      source_manifest_digest: verifiedRepositoryResult.source_manifest_digest,
      receipt_id: verifiedRepositoryResult.receipt_id
    },
    verified_source: {
      receipt_id: receipt.receipt_id,
      commit: receipt.commit,
      tree: receipt.tree,
      entry_digest: receipt.entry.sha256,
      source_manifest_digest: receipt.source_manifest_digest
    }
  });
}

function runDelegatedRepoSync({ args, hubPath, repoPath, snapshot, updateResult, testHooks = {} }) {
  // Source staging/launch owns a separate local lock so the delegated child
  // can independently acquire the hub mutation lock. The child revalidates
  // the delegated durable-state and destination bindings before any write.
  const launchLock = acquireLock(path.join(path.dirname(hubPath), '.verified-source-capsules'), args);
  if (!launchLock.acquired) throw new Error(`delegated child launch blocked: ${launchLock.skipReason}`);
  try {
    const lockedRawState = readJsonIfExists(path.join(hubPath, 'state.json'));
    beginMutationPhase(args, { lock: launchLock, hubPath, rawState: lockedRawState, discoveries: snapshot.discoveries, testHooks });
    const verifiedRepositoryResult = verifyDelegatedRepositoryResult({ args, repoPath, snapshot, updateResult });
    const envelope = buildDelegatedAuthorityEnvelope({ args, hubPath, snapshot, verifiedRepositoryResult });
    if (testHooks.beforeDelegatedChildLaunch) testHooks.beforeDelegatedChildLaunch({ envelope, verifiedRepositoryResult });
    const finalVerifiedRepositoryResult = verifyDelegatedRepositoryResult({ args, repoPath, snapshot, updateResult });
    if (canonicalJson(verifiedSourceEvidence(finalVerifiedRepositoryResult.receipt)) !== canonicalJson(verifiedSourceEvidence(verifiedRepositoryResult.receipt))) {
      throw new Error('delegated repository result changed before child launch');
    }
    const launched = launchVerifiedDelegatedChild({
      args,
      receipt: verifiedRepositoryResult.receipt,
      expectedState: snapshot.state,
      delegatedAuthority: envelope
    });
    const result = launched.result;
    args.delegatedReceipt = {
      parent_invocation_id: envelope.parent_invocation_id,
      child_source_identity: verifiedRepositoryResult.source_identity,
      receipt_id: verifiedRepositoryResult.receipt_id,
      source_manifest_digest: verifiedRepositoryResult.source_manifest_digest,
      verified_source_receipt: verifiedSourceEvidence(verifiedRepositoryResult.receipt),
      launch_evidence: launched.evidence,
      exit_status: result.status
    };
    if (result.stdout.trim() && !args.hook) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    if (!result.ok) throw new Error(`delegated repo sync failed: ${commandOutput(result)}`);
    return { status: 0 };
  } finally {
    releaseLock(launchLock);
  }
}

function runRepoAutoUpdate({ args, hubPath, state, discoveries, checksum, payloads, testHooks = {} }) {
  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping repo auto-update.`);
    return { status: 0, audit: buildAudit({ args, hubPath, state, discoveries, checksum, payloads }) };
  }

  let statusState = state;
  let updateResult = null;
  let snapshot = null;
  let plannedTargetSyncs = [];
  let nativePluginCache = { status: '' };
  let thirdPartyHookRepair = { status: '' };
  let previousObservedRepoCommit = state.last_repo_update_to_commit || '';
  try {
    if (testHooks.afterLockAcquired) testHooks.afterLockAcquired({ route: 'repo-update', lock });
    const lockedRawState = readJsonIfExists(path.join(hubPath, 'state.json'));
    if (testHooks.afterLockedStateRead) testHooks.afterLockedStateRead({ route: 'repo-update', lockedRawState });
    state = applyRequestedState(normalizedState(lockedRawState), args);
    assertSourceDowngradeAllowed(state, args);
    const lockedSnapshot = deriveSnapshotGeneration({ args, hubPath, state, prepareForWrite: true });
    beginMutationPhase(args, { lock, hubPath, rawState: lockedRawState, discoveries: lockedSnapshot.discoveries, testHooks });
    state.last_update_report_cleanup = runAuthorisedUpdateReportCleanup(args, state);

    statusState = state;
    previousObservedRepoCommit = state.last_repo_update_to_commit || '';
    try {
      updateResult = validateAndUpdateRepo(state, args);
      verifySourceReceiptContinuity(updateResult.verifiedSourceReceipt, 'post-verification');
      if (testHooks.afterRepositoryVerification) testHooks.afterRepositoryVerification({ receipt: verifiedSourceEvidence(updateResult.verifiedSourceReceipt) });
      try {
        verifySourceReceiptContinuity(updateResult.verifiedSourceReceipt, 'post-verification');
      } catch (error) {
        error.sourceContinuityFailure = true;
        throw error;
      }
      statusState = applyRepoUpdateStatus(state, updateResult.status, {
        fromCommit: updateResult.fromCommit,
        toCommit: updateResult.toCommit
      });
      snapshot = deriveSnapshotGeneration({ args, hubPath, state: statusState, prepareForWrite: true });
      statusState = snapshot.state;
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    } catch (error) {
      if (error.sourceContinuityFailure) throw error;
      const details = error.repoUpdateDetails || {};
      statusState = persistFailureStatus(args, state, error.repoUpdateStatus || 'skipped', {
        fromCommit: details.fromCommit || '',
        toCommit: details.toCommit || '',
        error: details.error || error.message
      });
      snapshot = deriveSnapshotGeneration({ args, hubPath, state: statusState, prepareForWrite: true });
      statusState = snapshot.state;
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
      const report = maybeWriteUpdateReport({
        args,
        hubPath,
        state: statusState,
        checksum: snapshot.checksum,
        context: {
          repo: {
            status: error.repoUpdateStatus || 'skipped',
            repoPath: state.repo_path ? path.resolve(state.repo_path) : '',
            fromCommit: details.fromCommit || '',
            toCommit: details.toCommit || '',
            changedFiles: details.changedFiles || [],
            validationStatus: details.validationStatus || (error.repoUpdateStatus === 'validation-failed' ? 'failed' : 'not run'),
            branchSwitchedFrom: details.branchSwitchedFrom || '',
            error: details.error || error.message
          },
          skippedTargets: snapshot.skippedTargets,
          nativePluginCache: nativePluginCacheStatus(args, statusState),
          targetSyncStatus: 'skipped'
        }
      });
      statusState = report.state;
      if (report.reportPath) {
        snapshot = { ...snapshot, state: statusState };
        writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
      }
      printUpdateReportLine(args, report.reportPath);
      if (args.hook) {
        hookSafeWarning(args, error.message);
        return { status: 0, audit: buildAudit({ args, hubPath, ...snapshot, state: statusState }) };
      }
      throw error;
    }
  } finally {
    releaseLock(lock);
  }

  const refreshLock = acquireLock(path.dirname(hubPath), args);
  try {
    if (refreshLock.acquired) {
      if (testHooks.beforeRelockProjection) testHooks.beforeRelockProjection({ route: 'post-repo-refresh', refreshLock });
      const refreshRawState = readJsonIfExists(path.join(hubPath, 'state.json')) || statusState;
      statusState = normalizedState(refreshRawState);
      assertSourceDowngradeAllowed(statusState, args);
      snapshot = deriveSnapshotGeneration({ args, hubPath, state: statusState, prepareForWrite: true });
      beginMutationPhase(args, { lock: refreshLock, hubPath, rawState: refreshRawState, discoveries: snapshot.discoveries, testHooks });
      verifySourceReceiptContinuity(updateResult.verifiedSourceReceipt, 'refresh-relock');
      statusState = snapshot.state;
      plannedTargetSyncs = snapshot.plannedTargetSyncs;
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
      nativePluginCache = nativePluginCacheStatusForReport(args, statusState, {
        repoPath: updateResult.repoPath,
        verifiedSourceReceipt: updateResult.verifiedSourceReceipt
      });
      thirdPartyHookRepair = maybeRepairThirdPartyCodexPluginHooks(args, statusState);
    }
  } finally {
    releaseLock(refreshLock);
  }

  try {
    if (testHooks.beforeDelegatedRepoSync) testHooks.beforeDelegatedRepoSync({ updateResult, snapshot });
    runDelegatedRepoSync({ args, hubPath, repoPath: updateResult.repoPath, snapshot, updateResult, testHooks });
  } catch (error) {
    const relock = acquireLock(path.dirname(hubPath), args);
    let failedState = statusState;
    let report = { state: failedState, reportPath: '' };
    try {
      if (relock.acquired) {
        if (testHooks.beforeRelockProjection) testHooks.beforeRelockProjection({ route: 'delegated-failure', relock });
        const latestRawState = readJsonIfExists(path.join(hubPath, 'state.json')) || statusState;
        const latestState = normalizedState(latestRawState);
        assertSourceDowngradeAllowed(latestState, args);
        let projectionSnapshot = deriveSnapshotGeneration({ args, hubPath, state: latestState, prepareForWrite: true });
        beginMutationPhase(args, { lock: relock, hubPath, rawState: latestRawState, discoveries: projectionSnapshot.discoveries, testHooks });
        failedState = persistFailureStatus(args, latestState, 'sync-delegation-failed', {
          fromCommit: updateResult.fromCommit,
          toCommit: updateResult.toCommit,
          error: error.message
        });
        let failedSnapshot = deriveSnapshotGeneration({ args, hubPath, state: failedState, prepareForWrite: true });
        failedState = failedSnapshot.state;
        writeHubSnapshot({ hubPath, args, ...failedSnapshot }, testHooks);
        report = maybeWriteUpdateReport({
          args,
          hubPath,
          state: failedState,
          checksum: failedSnapshot.checksum,
          context: {
            repo: {
              status: 'sync-delegation-failed',
              repoPath: updateResult.repoPath || state.repo_path || '',
              fromCommit: updateResult.fromCommit,
              toCommit: updateResult.toCommit,
              changedFiles: updateResult.changedFiles || [],
              validationStatus: updateResult.validation?.status || 'passed',
              error: error.message
            },
            skippedTargets: failedSnapshot.skippedTargets,
            nativePluginCache,
            thirdPartyHookRepair,
            targetSyncStatus: 'failed'
          }
        });
        failedState = report.state;
        if (report.reportPath) {
          failedSnapshot = { ...failedSnapshot, state: failedState };
          writeHubSnapshot({ hubPath, args, ...failedSnapshot }, testHooks);
        }
        snapshot = failedSnapshot;
      }
    } finally {
      releaseLock(relock);
    }
    printUpdateReportLine(args, report.reportPath);
    if (args.hook) {
      hookSafeWarning(args, error.message);
      return { status: 0, audit: buildAudit({ args, hubPath, ...snapshot, state: report.state }) };
    }
    throw error;
  }

  const finalState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')) || statusState);
  const plannedChecksum = snapshot.checksum;
  if (testHooks.beforeFinalReportLock) testHooks.beforeFinalReportLock({ hubPath, statusState, snapshot });
  const reportLock = acquireLock(path.dirname(hubPath), args);
  let report = { state: finalState, reportPath: '' };
  try {
    if (reportLock.acquired) {
      if (testHooks.beforeRelockProjection) testHooks.beforeRelockProjection({ route: 'final-report', reportLock });
      const latestRawState = readJsonIfExists(path.join(hubPath, 'state.json')) || finalState;
      const latestState = normalizedState(latestRawState);
      assertSourceDowngradeAllowed(latestState, args);
      let reportSnapshot = deriveSnapshotGeneration({ args, hubPath, state: latestState, prepareForWrite: true });
      beginMutationPhase(args, { lock: reportLock, hubPath, rawState: latestRawState, discoveries: reportSnapshot.discoveries, testHooks });
      const reportState = reportSnapshot.state;
      const completedTargetSyncs = plannedTargetSyncs.filter((sync) => (
        reportSnapshot.checksum === plannedChecksum &&
        targetIsSynced(sync.target, reportState.targets[sync.target], reportSnapshot.checksum, reportSnapshot.discoveries[sync.target], reportSnapshot.payloads)
      ));
      const reportContext = {
        repo: repoReportContextFromUpdate(reportState, updateResult, previousObservedRepoCommit),
        targetSyncs: completedTargetSyncs,
        skippedTargets: reportSnapshot.skippedTargets,
        nativePluginCache,
        thirdPartyHookRepair,
        targetSyncStatus: plannedTargetSyncs.length
          ? (completedTargetSyncs.length === plannedTargetSyncs.length ? 'synced' : 'not confirmed')
          : 'not needed'
      };
      report = maybeWriteUpdateReport({
        args,
        hubPath,
        state: reportState,
        checksum: reportSnapshot.checksum,
        context: reportContext
      });
      if (testHooks.afterFinalReportBuild) {
        testHooks.afterFinalReportBuild({ args, report, reportContext, reportSnapshot });
      }
      if (report.reportPath) {
        reportSnapshot = { ...reportSnapshot, state: report.state };
        writeHubSnapshot({ hubPath, args, ...reportSnapshot }, testHooks);
      }
      snapshot = reportSnapshot;
    }
  } finally {
    releaseLock(reportLock);
  }
  printUpdateReportLine(args, report.reportPath);
  if (!report.reportPath && !args.hook && updateResult.status === 'up-to-date' && !plannedTargetSyncs.length) {
    console.log('Toolkit already up to date.');
  }
  const finalAudit = buildAudit({ args, hubPath, ...snapshot, state: report.state });
  if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
  return { status: 0, audit: finalAudit };
}

function persistActiveNoTargetWrite({
  args,
  hubPath,
  buildReportContext,
  testHooks = {}
}) {
  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping sync.`);
    return {
      state: normalizedState(readJsonIfExists(path.join(hubPath, 'state.json'))),
      reportPath: '',
      persisted: false
    };
  }

  try {
    if (testHooks.afterLockAcquired) testHooks.afterLockAcquired({ route: 'no-target', lock });
    const latestRawState = readJsonIfExists(path.join(hubPath, 'state.json'));
    if (testHooks.afterLockedStateRead) testHooks.afterLockedStateRead({ route: 'no-target', latestRawState });
    const latestState = normalizedState(latestRawState);
    assertSourceDowngradeAllowed(latestState, args);
    let state = applyRequestedState(latestState, args);
    let snapshot = deriveSnapshotGeneration({ args, hubPath, state, prepareForWrite: true });
    beginMutationPhase(args, { lock, hubPath, rawState: latestRawState, discoveries: snapshot.discoveries, testHooks });
    state = snapshot.state;
    state.last_update_report_cleanup = runAuthorisedUpdateReportCleanup(args, state);
    snapshot = { ...snapshot, state };

    // Source-version persistence is independent of optional report creation.
    writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    const targetSyncs = [];
    for (const plan of snapshot.plannedTargetSyncs) {
      const targetPath = assertSafeWritePath(plan.targetPath, `${targetDisplayName(plan.target)} target path`);
      const syncResult = syncTargetPayload(plan.target, targetPath, snapshot.payloads, args.syncSource, { args, testHooks });
      if (!targetOutputIsCurrent(plan.target, snapshot.discoveries[plan.target], snapshot.payloads)) {
        throw new Error(`target sync postcondition verification failed: ${plan.target}`);
      }
      targetSyncs.push(syncResult);
      updateTargetState(state, plan.target, snapshot.discoveries[plan.target], snapshot.checksum, true, '');
    }
    if (targetSyncs.length) {
      state.updated_at = timestamp();
      snapshot = { ...snapshot, state };
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }
    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state,
      checksum: snapshot.checksum,
      context: buildReportContext(state, snapshot, targetSyncs)
    });
    if (report.reportPath) {
      snapshot = { ...snapshot, state: report.state };
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }
    return { ...report, snapshot, persisted: true };
  } finally {
    releaseLock(lock);
  }
}

function applyPreferenceOnlyRawState(rawState, args) {
  const next = rawState && typeof rawState === 'object' && !Array.isArray(rawState)
    ? JSON.parse(JSON.stringify(rawState))
    : {};
  if (args.enableAutoSync) next.auto_sync_enabled = true;
  if (args.disableAutoSync) next.auto_sync_enabled = false;
  if (args.enableRepoAutoUpdate) next.repo_auto_update_enabled = true;
  if (args.disableRepoAutoUpdate) next.repo_auto_update_enabled = false;
  if (args.enableRepoAutoUpdate) {
    next.last_repo_update_status = 'configured';
    next.last_repo_update_error = '';
  }
  if (args.disableRepoAutoUpdate) {
    next.last_repo_update_status = 'disabled';
    next.last_repo_update_error = '';
  }
  if (args.repoPath) next.repo_path = path.resolve(args.repoPath);
  if (args.repoBranch) next.repo_branch = args.repoBranch;
  if (args.repoRemote) next.repo_remote = args.repoRemote;
  if (args.enableUpdateReports) next.update_report_enabled = true;
  if (args.disableUpdateReports) next.update_report_enabled = false;
  if (args.updateReportRetentionDaysExplicit) next.update_report_retention_days = args.updateReportRetentionDays;
  if (args.enableUpdateReportOpen || args.disableUpdateReportOpen) {
    next.legacy_update_report_open_migrated = next.update_report_open_enabled === true || next.legacy_update_report_open_migrated === true;
    next.update_report_open_enabled = false;
    next.update_report_open_behavior = 'action-required-only';
  }
  if (args.enableCodexPluginAutoRefresh) next.codex_plugin_auto_refresh_enabled = true;
  if (args.disableCodexPluginAutoRefresh) next.codex_plugin_auto_refresh_enabled = false;
  return next;
}

function preferenceOnlyAudit(args, hubPath, rawState) {
  const next = applyPreferenceOnlyRawState(rawState, args);
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    dry_run: !args.write,
    execution_authority: args.executionAuthority,
    requested_authority: { entrypoint: args.executionAuthority.entrypoint },
    authorised_actions: derivedActionSummary(args),
    eligible_actions: { preferences: authorityPreferenceFields(args) },
    blocked_actions: [],
    out_of_scope_stale_targets: [],
    planned_writes: args.write || args.executionAuthority.write_requested
      ? [{ kind: 'preference.field.write', path: path.join(hubPath, 'state.json'), fields: authorityPreferenceFields(args) }]
      : [],
    preference_preview: Object.fromEntries(
      authorityPreferenceFields(args).map((field) => [field, next[field]])
    )
  };
}

function runPreferenceOnly({ args, hubPath, rawState }) {
  const audit = preferenceOnlyAudit(args, hubPath, rawState);
  if (!args.write) {
    console.log(JSON.stringify(audit, null, 2));
    return { status: 0, audit };
  }
  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping preference write.`);
    return { status: 0, audit };
  }
  try {
    if (args.testHooks?.afterLockAcquired) args.testHooks.afterLockAcquired({ route: 'preference-only', lock });
    const latestRaw = readJsonIfExists(path.join(hubPath, 'state.json'));
    if (args.testHooks?.afterLockedStateRead) args.testHooks.afterLockedStateRead({ route: 'preference-only', latestRaw });
    assertRepoAutoUpdatePrerequisite(args, latestRaw);
    beginMutationPhase(args, { lock, hubPath, rawState: latestRaw, discoveries: {}, testHooks: args.testHooks });
    const next = applyPreferenceOnlyRawState(latestRaw, args);
    const statePath = path.join(hubPath, 'state.json');
    const mutationOptions = { details: { path: statePath, hubPath, fields: authorityPreferenceFields(args) } };
    writeManagedAtomicFile(args, 'hub.state.write', mutationOptions, statePath, `${JSON.stringify(next, null, 2)}\n`);
    if (canonicalJson(readJsonIfExists(statePath)) !== canonicalJson(next)) throw new Error('preference state postcondition verification failed');
  } finally {
    releaseLock(lock);
  }
  if (args.audit) console.log(JSON.stringify({ ...audit, dry_run: false }, null, 2));
  else console.log('Toolkit local bridge preferences updated.');
  return { status: 0, audit: { ...audit, dry_run: false } };
}

function run(argv = process.argv.slice(2), testHooks = {}) {
  if (process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE === '1' && argv.includes('--hook')) {
    return { status: 0, audit: null, capability_probe_noop: true };
  }
  if (process.env.AI_AGENT_TOOLKIT_CHECKER === '1' && argv.includes('--hook')) {
    return { status: 0, audit: null, checker_session_noop: true };
  }
  const args = parseArgs(argv);
  args.delegatedEnvelope = readDelegatedAuthority(args, testHooks);
  assertDelegatedInvocationArgs(args);
  if (
    requestedPreferenceFields(args).length &&
    !args.hook &&
    !args.syncEnabled &&
    !args.repoUpdateNow &&
    !args.reconcileStaging &&
    !args.enableTargets.length &&
    !args.disableTargets.length &&
    !args.scopedSyncTargets.length &&
    !args.setAg2PythonCommand
  ) {
    args.preferenceOnly = true;
  }
  assertPreferenceBoundary(args);
  assertReconciliationCommandArgs(args);
  const hubPath = assertSafeWritePath(args.hub || defaultHubPath(), 'hub path');
  const existingRawState = readJsonIfExists(path.join(hubPath, 'state.json'));
  const existingState = normalizedState(existingRawState);
  assertRepoAutoUpdatePrerequisite(args, existingState);
  const authorityDiscoveries = (args.reconcileStaging || args.preferenceOnly)
    ? {}
    : {
        opencode: discoverOpenCode(args, existingState.targets.opencode, hubPath),
        ag2: discoverAg2(args, existingState.targets.ag2, hubPath)
      };
  args.executionAuthority = resolveExecutionAuthority({
    args,
    hubPath,
    rawState: existingRawState,
    discoveries: authorityDiscoveries,
    delegatedEnvelope: args.delegatedEnvelope
  });
  initializeInvocationRuntime(args, testHooks);
  if (args.preferenceOnly) return runPreferenceOnly({ args, hubPath, rawState: existingRawState });
  if (args.reconcileStaging) {
    assertSourceDowngradeAllowed(existingState, args);
    return runStagingReconciliation({ args, hubPath, state: existingState, testHooks });
  }
  maybePrintAgentRulesPreflight(args);

  assertSourceDowngradeAllowed(existingState, args);

  if (args.write && !scopeHasExecutableWrite(args)) {
    const nextState = normalizedState(existingState);
    const snapshot = deriveSnapshotGeneration({ args, hubPath, state: nextState });
    const audit = buildAudit({ args, hubPath, ...snapshot });
    if (args.syncEnabled && !args.audit && !args.hook) console.log('Toolkit local bridge: no enabled stale targets to sync.');
    else if (args.audit || !args.hook) console.log(JSON.stringify(audit, null, 2));
    return { status: 0, audit };
  }

  if (isHookNoop(args, existingState)) {
    if (existingState?.hub_version && !existingState.auto_sync_enabled) {
      console.log('Toolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.');
    }
    return { status: 0, audit: null };
  }

  let nextState = applyRequestedState(existingState, args);
  assertRepoAutoUpdatePrerequisite(args, nextState);
  const initialSnapshot = deriveSnapshotGeneration({ args, hubPath, state: nextState });
  nextState = initialSnapshot.state;
  let { discoveries, payloads, checksum } = initialSnapshot;
  if (testHooks.afterInitialSnapshotDerivation) testHooks.afterInitialSnapshotDerivation(initialSnapshot);

  const audit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
  if (args.audit || !args.write) {
    console.log(JSON.stringify(audit, null, 2));
  }
  if (!args.write) return { status: 0, audit };
  if (shouldRunRepoAutoUpdate(args, nextState)) {
    return runRepoAutoUpdate({ args, hubPath, state: nextState, discoveries, checksum, payloads, testHooks });
  }
  const hasTargetSync = initialSnapshot.plannedTargetSyncs.length > 0;
  if (
    args.syncEnabled &&
    !args.enableTargets.length &&
    !args.disableTargets.length &&
    !args.enableAutoSync &&
    !args.disableAutoSync &&
    !args.enableRepoAutoUpdate &&
    !args.disableRepoAutoUpdate &&
    !hasTargetSync
  ) {
    const hasConfiguredState = Boolean(
      existingState.hub_version ||
      Object.keys(existingState.bridge_versions_by_source || {}).length ||
      existingState.auto_sync_enabled ||
      existingState.repo_auto_update_enabled ||
      SUPPORTED_TARGETS.some((target) => existingState.targets[target]?.enabled)
    );
    if (!hasConfiguredState) {
      if (!args.hook) console.log('Toolkit local bridge: no enabled stale targets to sync.');
      return { status: 0, audit };
    }
    const report = persistActiveNoTargetWrite({
      args,
      hubPath,
      testHooks,
      buildReportContext: (state, snapshot, targetSyncs) => ({
        repo: repoReportContextFromState(state, args),
        targetSyncs,
        skippedTargets: snapshot.skippedTargets,
        nativePluginCache: nativePluginCacheStatusForReport(args, state, {
          repoPath: state.repo_path,
          validateRepo: true
        }),
        thirdPartyHookRepair: maybeRepairThirdPartyCodexPluginHooks(args, state),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      })
    });
    nextState = report.state;
    if (report.snapshot) ({ discoveries, payloads, checksum } = report.snapshot);
    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
    else if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    else if (!args.hook) console.log('Toolkit local bridge: no enabled stale targets to sync.');
    return { status: 0, audit: finalAudit };
  }
  if (args.hook && !hasTargetSync) {
    const report = persistActiveNoTargetWrite({
      args,
      hubPath,
      testHooks,
      buildReportContext: (state, snapshot, targetSyncs) => ({
        repo: repoReportContextFromState(state, args),
        targetSyncs,
        skippedTargets: snapshot.skippedTargets,
        nativePluginCache: nativePluginCacheStatusForReport(args, state, {
          repoPath: state.repo_path,
          validateRepo: true
        }),
        thirdPartyHookRepair: maybeRepairThirdPartyCodexPluginHooks(args, state),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      })
    });
    nextState = report.state;
    if (report.snapshot) ({ discoveries, payloads, checksum } = report.snapshot);
    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
    else if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    return { status: 0, audit: finalAudit };
  }

  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping sync.`);
    return { status: 0, audit };
  }

  try {
    if (testHooks.afterLockAcquired) testHooks.afterLockAcquired({ route: 'managed-write', lock });
    const lockedRawState = readJsonIfExists(path.join(hubPath, 'state.json'));
    if (testHooks.afterLockedStateRead) testHooks.afterLockedStateRead({ route: 'managed-write', lockedRawState });
    const lockedState = normalizedState(lockedRawState);
    assertSourceDowngradeAllowed(lockedState, args);
    nextState = applyRequestedState(lockedState, args);
    let snapshot = deriveSnapshotGeneration({ args, hubPath, state: nextState, prepareForWrite: true });
    beginMutationPhase(args, { lock, hubPath, rawState: lockedRawState, discoveries: snapshot.discoveries, testHooks });
    nextState = snapshot.state;
    nextState.last_update_report_cleanup = runAuthorisedUpdateReportCleanup(args, nextState);
    snapshot = { ...snapshot, state: nextState };
    ({ discoveries, payloads, checksum } = snapshot);
    writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);

    const targetSyncs = [];
    for (const plan of snapshot.plannedTargetSyncs) {
      const targetPath = assertSafeWritePath(plan.targetPath, `${targetDisplayName(plan.target)} target path`);
      const syncResult = syncTargetPayload(plan.target, targetPath, payloads, args.syncSource, {
        proof: discoveries[plan.target].projection_proof,
        args,
        testHooks
      });
      if (!targetOutputIsCurrent(plan.target, discoveries[plan.target], payloads)) {
        throw new Error(`target sync postcondition verification failed: ${plan.target}`);
      }
      targetSyncs.push(syncResult);
      updateTargetState(nextState, plan.target, discoveries[plan.target], checksum, true, '');
    }

    nextState.updated_at = timestamp();
    snapshot = { ...snapshot, state: nextState };
    writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);

    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state: nextState,
      checksum,
      context: {
        repo: repoReportContextFromState(nextState, args),
        targetSyncs,
        skippedTargets: snapshot.skippedTargets,
        nativePluginCache: nativePluginCacheStatusForReport(args, nextState, {
          repoPath: nextState.repo_path,
          validateRepo: true
        }),
        thirdPartyHookRepair: maybeRepairThirdPartyCodexPluginHooks(args, nextState),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      }
    });
    nextState = report.state;
    if (report.reportPath) {
      snapshot = { ...snapshot, state: nextState };
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }

    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
    else if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    else if (!args.hook) console.log('Toolkit local bridge sync complete.');
    return { status: 0, audit: finalAudit };
  } finally {
    releaseLock(lock);
  }
}

if (require.main === module) {
  try {
    const result = run();
    process.exit(result.status || 0);
  } catch (error) {
    const reconciliationRequested = process.argv.some((arg) => arg === '--reconcile-staging' || arg.startsWith('--reconcile-staging='));
    if (process.argv.includes('--hook') && !reconciliationRequested) {
      console.log(`Toolkit local bridge hook skipped: ${sanitizeOutputMessage(error.message)}`);
      process.exit(0);
    }
    console.error(`FAIL: ${sanitizeOutputMessage(error.message)}`);
    process.exit(1);
  }
}

module.exports = {
  AG2_PROOF_CONTRACT_VERSION,
  ARCHITECTURE_VERSION,
  BRIDGE_VERSION,
  RECEIPT_CHILD_BOOTSTRAP,
  canonicalJson,
  sha256,
  acquireLock,
  defaultHubPath,
  inspectDisplacedEvidence,
  inspectLockForRecovery,
  inspectRecoveryMarker,
  lockOwnerLiveness,
  parseArgs,
  releaseLock,
  releaseRecoveryMarker,
  assertActualMutationInput,
  validatePhaseContext,
  run,
  adapterPayloads,
  ag2SkillsProjectionProof,
  payloadChecksum,
  compareSemver,
  getRepoValidationLabels,
  runRepoValidation,
  updateReportSignature,
  classifyUpdateReport,
  maybeWriteUpdateReport,
  updateReportDir,
  cleanupUpdateReports,
  sanitizeOutputMessage,
  openUpdateReport,
  replaceDirectoryAtomically,
  parseManagedMarkerBlocks,
  nearestGitRoot,
  runAgentRulesPreflight,
  formatAgentRulesPreflight,
  discoverCodexPluginHookRoots,
  repairThirdPartyCodexPluginHooks
};
