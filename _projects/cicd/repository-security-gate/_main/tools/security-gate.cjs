#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACK_ROOT = path.resolve(__dirname, '..');
const TOOL_LOCK_PATH = path.join(PACK_ROOT, 'config', 'tool-lock.json');
const POLICY_PATH = path.join(PACK_ROOT, 'config', 'security-policy.json');
const INVARIANTS_PATH = path.join(PACK_ROOT, 'config', 'invariants.json');
const RULES_PATH = path.join(PACK_ROOT, 'rules', 'toolkit-rules.json');
const CLASSIFICATION_FIXTURES_PATH = path.join(PACK_ROOT, 'fixtures', 'classification-cases.json');
const RULE_FIXTURES_PATH = path.join(PACK_ROOT, 'fixtures', 'rule-cases.json');
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const GIT_PATH_LIMIT = 100000;
const CASE_ALIAS_LIMIT = 200;
const ENFORCEMENT_CONTROL_PATHS = [
  '.github/workflows/repository-security-gate.yml',
  '_projects/cicd/repository-security-gate/_main/config/',
  '_projects/cicd/repository-security-gate/_main/rules/',
  '_projects/cicd/repository-security-gate/_main/schemas/',
  '_projects/cicd/repository-security-gate/_main/templates/github/security-gate.yml',
  '_projects/cicd/repository-security-gate/_main/tools/',
  'skills/repository-security-gate/config/',
  'skills/repository-security-gate/rules/',
  'skills/repository-security-gate/schemas/',
  'skills/repository-security-gate/templates/github/security-gate.yml',
  'skills/repository-security-gate/tools/'
];
const PROFILE_EXEMPT = 'SECURITY_PROFILE_EXEMPT';
const PROFILE_LIGHTWEIGHT = 'SECURITY_PROFILE_LIGHTWEIGHT_CI';
const PROFILE_TOOLING = 'SECURITY_PROFILE_TOOLING_LIBRARY';
const PROFILE_WEB = 'SECURITY_PROFILE_WEB_API';
const PROFILE_WORKFLOW = 'SECURITY_PROFILE_WORKFLOW_INTEGRATION';
const REPORT_STATES = new Set([
  'SECURITY_PASS',
  'SECURITY_FINDINGS',
  'SECURITY_GATE_UNVERIFIED',
  'SECURITY_GATE_INFRA_BLOCKED',
  PROFILE_EXEMPT
]);
const TEXT_LIMIT = 2 * 1024 * 1024;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const INVARIANT_OUTPUT_LIMIT = 64 * 1024;
const SHELL_FILE_LIMIT = 1000;
const APPROVAL_REFERENCE = /^https:\/\/github\.com\/weijunswj\/ai-agent-toolkit\/(?:issues\/\d+|pull\/\d+#discussion_r\d+)$/;
const ignoredDirectories = new Set([
  '.git',
  '.agent-toolkit-backups',
  '_agent-toolkit-backups',
  'node_modules',
  'dist',
  '_dist',
  'coverage',
  'security-reports',
  '.security-tools'
]);
const sourceExtensions = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java',
  '.kt', '.kts', '.cs', '.php', '.rb', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.psm1', '.psd1', '.cmd', '.bat', '.exe', '.dll', '.so', '.dylib', '.wasm'
]);
const manifestNames = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock',
  'requirements.txt', 'pyproject.toml', 'poetry.lock', 'pipfile', 'pipfile.lock',
  'go.mod', 'go.sum', 'cargo.toml', 'cargo.lock', 'pom.xml', 'build.gradle',
  'build.gradle.kts', 'composer.json', 'composer.lock', 'gemfile', 'gemfile.lock'
]);
const dependencyLockNames = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'poetry.lock',
  'pipfile.lock', 'go.sum', 'cargo.lock', 'composer.lock', 'gemfile.lock'
]);
const deployNames = new Set([
  'dockerfile', 'compose.yml', 'compose.yaml', 'docker-compose.yml',
  'docker-compose.yaml', 'vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml',
  'serverless.yml', 'serverless.yaml', 'procfile', 'wrangler.toml'
]);
const webSignals = [
  'next.config.', 'nuxt.config.', 'vite.config.', 'openapi.', 'swagger.',
  '/api/', '/routes/', '/controllers/', '/webhooks/', '/uploads/'
];
const webPackages = new Set([
  'express', 'fastify', 'koa', 'hapi', 'next', 'nuxt', 'nestjs', '@nestjs/core',
  'flask', 'django', 'fastapi', 'spring-boot'
]);

function slash(value) {
  return String(value).replace(/\\/g, '/').split(path.sep).join('/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceBindingDigest(filePath) {
  return sha256(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
}

function normalizedRelativePath(value) {
  return slash(value).replace(/^\.?\//, '');
}

function canonicalGitPath(value) {
  const original = String(value || '');
  if (!original || /[\u0000-\u001f\u007f]/.test(original) || path.isAbsolute(original) || /^[A-Za-z]:[\\/]/.test(original)) {
    throw new Error('Git path must be a repository-relative path.');
  }
  const parts = slash(original).split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..')) {
    throw new Error('Git path must not be empty or traverse outside the repository.');
  }
  return parts.join('/');
}

function enforcementControlChanges(paths) {
  return paths.filter((candidate) => ENFORCEMENT_CONTROL_PATHS.some((control) =>
    control.endsWith('/') ? candidate.startsWith(control) : candidate === control
  ));
}

function trackedPathInventory(root, revision = 'HEAD', limit = GIT_PATH_LIMIT) {
  const result = run('git', [
    '-c', 'core.quotepath=false',
    'ls-tree', '-r', '-z', '--full-tree', revision
  ], { cwd: root, maxBuffer: OUTPUT_LIMIT });
  if (result.error || result.status !== 0) throw new Error('Unable to enumerate the exact Git tree.');
  if (result.stdout.length >= OUTPUT_LIMIT) throw new Error('Git tree inventory output reached the safety bound.');
  const records = result.stdout.split('\0').filter(Boolean);
  if (records.length > limit) throw new Error(`Tracked path safety bound ${limit} exceeded.`);
  const entries = [];
  const exact = new Map();
  const aliases = new Map();
  for (const record of records) {
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('Git tree inventory is malformed.');
    const metadata = record.slice(0, tab);
    const relative = canonicalGitPath(record.slice(tab + 1));
    if (exact.has(relative)) throw new Error(`Git tree contains duplicate exact path: ${relative}`);
    exact.set(relative, metadata);
    const folded = relative.toLowerCase();
    const group = aliases.get(folded) || [];
    group.push(relative);
    aliases.set(folded, group);
    entries.push(`${metadata}\t${relative}`);
  }
  const caseAliases = [...aliases.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort())
    .sort((left, right) => (left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0)));
  if (caseAliases.length > CASE_ALIAS_LIMIT) {
    throw new Error(`Case-fold alias safety bound ${CASE_ALIAS_LIMIT} exceeded.`);
  }
  return {
    revision,
    count: entries.length,
    exact,
    aliases,
    caseAliases,
    manifest_sha256: sha256(`${entries.sort().join('\0')}\0`)
  };
}

function resolveScannerPath(root, value, inventory) {
  if (typeof value !== 'string' || !value.trim() || value === '(repository)') return '(repository)';
  let candidate = value;
  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
    const absolute = path.resolve(candidate);
    if (!isWithin(root, absolute)) throw new Error('Scanner reported a path outside the repository.');
    candidate = path.relative(root, absolute);
  }
  const relative = canonicalGitPath(candidate);
  if (inventory.exact.has(relative)) return relative;
  const aliases = inventory.aliases.get(relative.toLowerCase()) || [];
  if (aliases.length > 1) {
    throw new Error(`Scanner path is ambiguous across case-fold aliases: ${relative}`);
  }
  if (aliases.length === 1) {
    throw new Error(`Scanner path case does not match the exact Git path: ${relative}`);
  }
  throw new Error(`Scanner reported an untracked path: ${relative}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const equals = item.indexOf('=');
    if (equals !== -1) {
      args[item.slice(2, equals)] = item.slice(equals + 1);
      continue;
    }
    const name = item.slice(2);
    if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      args[name] = argv[++index];
    } else {
      args[name] = true;
    }
  }
  return args;
}

function safeRepoRoot(value) {
  const root = path.resolve(value || '.');
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Repository root must be a non-symlink directory.');
  }
  return fs.realpathSync.native(root);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkRepository(root) {
  const files = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name.toLowerCase())) continue;
      const full = path.join(directory, entry.name);
      const relative = slash(path.relative(root, full));
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        files.push({ relative, full, redirected: true, size: stat.size });
        continue;
      }
      const real = fs.realpathSync.native(full);
      if (!isWithin(root, real)) {
        files.push({ relative, full, redirected: true, size: stat.size });
        continue;
      }
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push({ relative, full, redirected: false, size: stat.size });
    }
  }
  visit(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function smallText(file) {
  if (file.redirected || file.size > TEXT_LIMIT) return '';
  const buffer = fs.readFileSync(file.full);
  if (buffer.includes(0)) return '';
  return buffer.toString('utf8').replace(/\r\n/g, '\n');
}

function shellDescriptor(file) {
  if (file.redirected || file.size > TEXT_LIMIT) return null;
  const extension = path.extname(file.relative).toLowerCase();
  const firstLine = smallText(file).split('\n', 1)[0] || '';
  const shebang = firstLine.match(/^#!\s*(.+)$/);
  let interpreter = null;
  if (shebang) {
    const tokens = shebang[1].trim().split(/\s+/);
    let executable = tokens.shift() || '';
    if (path.posix.basename(executable.replace(/\\/g, '/')).toLowerCase() === 'env') {
      while (tokens[0] && tokens[0].startsWith('-')) tokens.shift();
      executable = tokens.shift() || '';
    }
    interpreter = path.posix.basename(executable.replace(/\\/g, '/')).toLowerCase();
  }
  const supported = new Map([
    ['bash', 'bash'],
    ['sh', 'sh'],
    ['dash', 'dash'],
    ['ash', 'sh'],
    ['ksh', 'ksh']
  ]);
  if (interpreter && supported.has(interpreter)) {
    return { file, dialect: supported.get(interpreter), interpreter, source: 'shebang' };
  }
  if (interpreter && ['zsh', 'fish', 'csh', 'tcsh'].includes(interpreter)) {
    return { file, dialect: null, interpreter, source: 'shebang' };
  }
  if (extension === '.bash') return { file, dialect: 'bash', interpreter: 'bash', source: 'extension' };
  if (extension === '.sh') return { file, dialect: 'sh', interpreter: 'sh', source: 'extension' };
  if (['.zsh', '.fish'].includes(extension)) {
    return { file, dialect: null, interpreter: extension.slice(1), source: 'extension' };
  }
  return null;
}

function shellInventory(files) {
  const descriptors = files.map(shellDescriptor).filter(Boolean);
  return {
    supported: descriptors.filter((item) => item.dialect),
    unsupported: descriptors.filter((item) => !item.dialect)
  };
}

function packageSignals(files) {
  const signals = new Set();
  for (const file of files) {
    if (path.basename(file.relative).toLowerCase() !== 'package.json') continue;
    try {
      const parsed = JSON.parse(smallText(file));
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const name of Object.keys(parsed[section] || {})) signals.add(name.toLowerCase());
      }
    } catch {
      signals.add('invalid-package-json');
    }
  }
  return signals;
}

function classifyRepository(root, suppliedFiles = null) {
  const files = suppliedFiles || walkRepository(root);
  let source = false;
  let manifest = false;
  let action = false;
  let deploy = false;
  let workflow = false;
  let web = false;
  let ambiguousExecutable = false;
  const evidence = [];
  const packages = packageSignals(files);
  for (const file of files) {
    const relativeLower = file.relative.toLowerCase();
    const basename = path.basename(relativeLower);
    const extension = path.extname(basename);
    if (file.redirected) {
      ambiguousExecutable = true;
      evidence.push({ type: 'redirected_entry', path: file.relative });
      continue;
    }
    if (relativeLower.startsWith('.github/workflows/') && ['.yml', '.yaml'].includes(extension)) {
      action = true;
      evidence.push({ type: 'github_action', path: file.relative });
    }
    if (manifestNames.has(basename)) {
      manifest = true;
      evidence.push({ type: 'dependency_manifest', path: file.relative });
    }
    if (
      deployNames.has(basename) ||
      extension === '.tf' ||
      relativeLower.includes('/k8s/') ||
      relativeLower.startsWith('.vercel/') ||
      relativeLower.startsWith('.netlify/')
    ) {
      deploy = true;
      evidence.push({ type: 'deploy_or_iac', path: file.relative });
    }
    if (
      relativeLower.startsWith('n8n-workflows/') ||
      relativeLower.includes('/n8n-workflows/') ||
      relativeLower.includes('/workflow-integration/')
    ) {
      workflow = true;
      evidence.push({ type: 'workflow_integration', path: file.relative });
    }
    if (sourceExtensions.has(extension)) {
      source = true;
      evidence.push({ type: 'executable_source', path: file.relative });
    } else {
      const text = smallText(file).slice(0, 512);
      if (
        shellDescriptor(file) ||
        /^#!\s*\/(?:usr\/)?bin\/(?:env(?:\s+-S)?\s+)?(?:node|python\d*|pwsh|powershell)/i.test(text)
      ) {
        ambiguousExecutable = true;
        evidence.push({ type: 'misleading_executable', path: file.relative });
      }
    }
    if (webSignals.some((signal) => relativeLower.includes(signal))) {
      web = true;
      evidence.push({ type: 'web_api_surface', path: file.relative });
    }
  }
  if ([...packages].some((name) => webPackages.has(name))) web = true;
  let profile = PROFILE_EXEMPT;
  if (workflow) profile = PROFILE_WORKFLOW;
  else if (web && (source || manifest || ambiguousExecutable)) profile = PROFILE_WEB;
  else if (source || manifest || ambiguousExecutable) profile = PROFILE_TOOLING;
  else if (action || deploy) profile = PROFILE_LIGHTWEIGHT;
  return {
    profile,
    evidence: evidence.slice(0, 200),
    counts: { files: files.length, source, manifest, action, deploy, workflow, web, ambiguousExecutable }
  };
}

function validateDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function validateToolLock(lock = readJson(TOOL_LOCK_PATH), today = new Date()) {
  const errors = [];
  if (lock.schema_version !== 1) errors.push('schema_version must be 1');
  if (!/^\d+\.\d+\.\d+$/.test(lock.lock_version || '')) errors.push('lock_version must be semver');
  try {
    validateDate(lock.first_approved_date, 'first_approved_date');
    validateDate(lock.last_verified_date, 'last_verified_date');
  } catch (error) {
    errors.push(error.message);
  }
  if (!Array.isArray(lock.records) || lock.records.length === 0) errors.push('records must be non-empty');
  const names = new Set();
  for (const record of lock.records || []) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push('record must be an object');
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(record.name || '')) errors.push('record name is invalid');
    if (names.has(record.name)) errors.push(`duplicate record: ${record.name}`);
    names.add(record.name);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.upstream || '')) {
      errors.push(`${record.name}: upstream must be owner/repo`);
    }
    const upstreamOwner = String(record.upstream || '').split('/')[0];
    if (record.state === 'active' && String(record.publisher || '').toLowerCase() !== upstreamOwner.toLowerCase()) {
      errors.push(`${record.name}: publisher must match the approved upstream owner`);
    }
    if (!['ADOPT', 'DEFER', 'REJECT', 'REPLACE_WITH_ALTERNATIVE'].includes(record.adoption_decision)) {
      errors.push(`${record.name}: invalid adoption_decision`);
    }
    if (!['active', 'superseded', 'blocked'].includes(record.state)) {
      errors.push(`${record.name}: invalid state`);
    }
    if (record.state === 'active' && record.adoption_decision !== 'ADOPT') {
      errors.push(`${record.name}: only ADOPT records can be active`);
    }
    if (record.state === 'active' && !SHA40.test(record.commit || '')) {
      errors.push(`${record.name}: active record requires exact commit`);
    }
    if (record.state === 'active' && !SHA64.test(record.license_sha256 || '')) {
      errors.push(`${record.name}: active record requires licence digest`);
    }
    if (
      record.state === 'active' &&
      record.kind === 'scanner' &&
      (!record.expected_release_asset || !SHA64.test(record.release_checksum || '') || !record.asset_url)
    ) {
      errors.push(`${record.name}: active scanner requires exact asset URL and checksum`);
    }
    if (!Array.isArray(record.supported_platforms) || record.supported_platforms.length === 0) {
      errors.push(`${record.name}: supported_platforms must be non-empty`);
    }
    if (!record.output_schema || !record.rules_database_version) {
      errors.push(`${record.name}: output and rules/database version are required`);
    }
  }
  for (const record of lock.records || []) {
    for (const binding of record.transitive_tools || []) {
      const target = lock.records.find((item) => item.name === binding.name);
      if (
        !target ||
        target.state !== 'active' ||
        binding.required !== true ||
        !/^-[a-z0-9-]+$/.test(binding.selection || '')
      ) {
        errors.push(`${record.name}: transitive tool binding is invalid or not active`);
      }
    }
  }
  const actionlint = (lock.records || []).find((item) => item.name === 'actionlint' && item.state === 'active');
  if (
    actionlint &&
    (
      !Array.isArray(actionlint.transitive_tools) ||
      actionlint.transitive_tools.length !== 1 ||
      actionlint.transitive_tools[0].name !== 'shellcheck' ||
      actionlint.transitive_tools[0].selection !== '-shellcheck' ||
      actionlint.transitive_tools[0].required !== true
    )
  ) {
    errors.push('actionlint: exact -shellcheck transitive binding is required');
  }
  const policy = readJson(POLICY_PATH);
  try {
    const verified = validateDate(lock.last_verified_date, 'last_verified_date');
    const age = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - verified.getTime()) / 86400000);
    if (age < 0) errors.push('last_verified_date must not be in the future');
    if (age > policy.tool_lock_max_age_days) errors.push(`tool lock is stale (${age} days)`);
  } catch {
    // Already reported.
  }
  return { valid: errors.length === 0, errors };
}

function commitTouchesPath(root, commit, relativePath) {
  try {
    const exactPath = canonicalGitPath(relativePath);
    const resolved = git(root, ['rev-parse', '--verify', `${commit}^{commit}`]);
    if (resolved.toLowerCase() !== commit.toLowerCase()) return false;
    const changed = gitPathList(root, [
      '-c', 'core.quotepath=false',
      'diff-tree', '--root', '--no-commit-id', '--name-only', '-z', '-r', commit
    ]);
    return changed.includes(exactPath);
  } catch {
    return false;
  }
}

function validateSuppressions(document, root, today = new Date(), options = {}) {
  const errors = [];
  const policy = readJson(POLICY_PATH);
  const lock = readJson(TOOL_LOCK_PATH);
  const rulesVersion = readJson(RULES_PATH).rules_version;
  const executedTests = options.executedTests instanceof Map ? options.executedTests : new Map();
  let pathInventory;
  try {
    pathInventory = trackedPathInventory(root);
  } catch (error) {
    return { valid: false, errors: [`suppression Git path inventory failed: ${error.message}`] };
  }
  if (!document || document.schema_version !== 3 || !Array.isArray(document.suppressions)) {
    return { valid: false, errors: ['suppression document must use schema_version 3 and an array'] };
  }
  const ids = new Set();
  const findingIdentities = new Set();
  const authorityScopes = new Set();
  for (const item of document.suppressions) {
    const prefix = item && item.id ? item.id : '<unknown>';
    const required = [
      'id', 'tool', 'rule', 'finding_identity', 'path', 'scope',
      'exploitability_rationale', 'approver_reference', 'introduction_commit',
      'expires', 'compensating_test', 'compensating_test_sha256',
      'tool_version', 'rule_version', 'source_sha256'
    ];
    for (const field of required) {
      if (item == null || typeof item[field] !== 'string' || !item[field].trim()) {
        errors.push(`${prefix}: ${field} is required`);
      }
    }
    if (!item) continue;
    if (ids.has(item.id)) errors.push(`${prefix}: duplicate id`);
    ids.add(item.id);
    if (findingIdentities.has(item.finding_identity)) errors.push(`${prefix}: duplicate finding identity`);
    findingIdentities.add(item.finding_identity);
    const authorityScope = [
      String(item.tool || '').toLowerCase(),
      String(item.rule || '').toLowerCase(),
      normalizedRelativePath(item.path || ''),
      item.scope
    ].join('\n');
    if (authorityScopes.has(authorityScope)) errors.push(`${prefix}: overlapping suppression authority`);
    authorityScopes.add(authorityScope);
    if (/[*?]/.test(item.path || '') || path.isAbsolute(item.path || '') || String(item.path || '').split(/[\\/]/).includes('..')) {
      errors.push(`${prefix}: wildcard, absolute, or traversal path is forbidden`);
    }
    if (!['exact_path', 'exact_line', 'synthetic_fixture'].includes(item.scope)) {
      errors.push(`${prefix}: scope must be exact`);
    }
    if (
      !SHA64.test(item.finding_identity || '') ||
      !SHA64.test(item.source_sha256 || '') ||
      !SHA64.test(item.compensating_test_sha256 || '')
    ) {
      errors.push(`${prefix}: finding, source, and compensating-test digests must be SHA-256`);
    }
    if (!APPROVAL_REFERENCE.test(item.approver_reference || '')) {
      errors.push(`${prefix}: approver_reference must be a supported Toolkit issue or review discussion`);
    }
    if (!SHA40.test(item.introduction_commit || '')) {
      errors.push(`${prefix}: introduction_commit must be exact`);
    } else if (!commitTouchesPath(root, item.introduction_commit, item.path)) {
      errors.push(`${prefix}: introduction_commit does not exist or does not introduce/change the suppressed path`);
    }
    try {
      const expiry = validateDate(item.expires, `${prefix}.expires`);
      const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      if (expiry.getTime() < todayUtc) {
        errors.push(`${prefix}: suppression is expired`);
      }
      const maximum = todayUtc + (policy.suppression_max_days * 24 * 60 * 60 * 1000);
      if (expiry.getTime() > maximum) errors.push(`${prefix}: suppression exceeds the maximum lifetime`);
    } catch (error) {
      errors.push(error.message);
    }
    if (item.scope === 'synthetic_fixture' && !/(?:^|\/)fixtures\//i.test(item.path || '')) {
      errors.push(`${prefix}: synthetic secret suppression must target an exact fixture`);
    }
    let exactSourcePath = null;
    try {
      exactSourcePath = canonicalGitPath(item.path || '');
      if (!pathInventory.exact.has(exactSourcePath)) {
        errors.push(`${prefix}: suppression path does not exactly match a tracked Git path`);
      }
    } catch {
      errors.push(`${prefix}: suppression path is not a canonical Git path`);
    }
    const full = path.resolve(root, exactSourcePath || item.path || '');
    if (
      isWithin(root, full) &&
      fs.existsSync(full) &&
      fs.lstatSync(full).isFile() &&
      !fs.lstatSync(full).isSymbolicLink() &&
      isWithin(root, fs.realpathSync.native(full))
    ) {
      if (sourceBindingDigest(full) !== item.source_sha256) errors.push(`${prefix}: source binding changed`);
    } else {
      errors.push(`${prefix}: suppression path is missing or outside repository`);
    }
    let testRelative = '';
    try {
      testRelative = canonicalGitPath(item.compensating_test || '');
      if (!pathInventory.exact.has(testRelative)) {
        errors.push(`${prefix}: compensating_test does not exactly match a tracked Git path`);
      }
    } catch {
      errors.push(`${prefix}: compensating_test is not a canonical Git path`);
    }
    const testFull = path.resolve(root, testRelative);
    if (
      path.isAbsolute(item.compensating_test || '') ||
      testRelative.split('/').includes('..') ||
      !isWithin(root, testFull) ||
      !fs.existsSync(testFull) ||
      !fs.lstatSync(testFull).isFile() ||
      fs.lstatSync(testFull).isSymbolicLink() ||
      !isWithin(root, fs.realpathSync.native(testFull))
    ) {
      errors.push(`${prefix}: compensating_test must be a contained regular repository file`);
    } else {
      const testDigest = sourceBindingDigest(testFull);
      if (testDigest !== item.compensating_test_sha256) {
        errors.push(`${prefix}: compensating test binding changed`);
      }
      if (executedTests.get(testRelative) !== testDigest) {
        errors.push(`${prefix}: compensating test was not executed as invariant evidence at its bound digest`);
      }
    }
    if (item.tool === 'toolkit-rules') {
      if (item.tool_version !== rulesVersion || item.rule_version !== rulesVersion) {
        errors.push(`${prefix}: Toolkit rule version binding changed`);
      }
    } else {
      const record = lock.records.find((entry) => entry.name === item.tool && entry.state === 'active');
      if (!record || item.tool_version !== record.release || item.rule_version !== record.rules_database_version) {
        errors.push(`${prefix}: tool or rule version binding changed`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function stableFinding(tool, rule, relativePath, line, message, options = {}) {
  const normalizedPath = relativePath === '(repository)'
    ? '(repository)'
    : canonicalGitPath(relativePath);
  const normalizedMessage = String(message).replace(/\s+/g, ' ').trim().slice(0, 240);
  const diagnostic = String(options.diagnostic || `message-sha256:${sha256(normalizedMessage)}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const canonical = {
    tool: String(tool),
    rule: String(rule),
    path: normalizedPath,
    line: Number(line || 0),
    column: Number(options.column || 0),
    severity: String(options.severity || 'MEDIUM').toUpperCase(),
    diagnostic,
    message: normalizedMessage
  };
  const identity = sha256(JSON.stringify(canonical));
  return {
    identity,
    tool: canonical.tool,
    rule: canonical.rule,
    path: normalizedPath,
    line: canonical.line,
    column: canonical.column,
    diagnostic,
    message: normalizedMessage,
    severity: canonical.severity,
    occurrence_count: 1
  };
}

function canonicalFindingPayload(finding) {
  return JSON.stringify({
    tool: finding.tool,
    rule: finding.rule,
    path: finding.path === '(repository)' ? '(repository)' : canonicalGitPath(finding.path),
    line: Number(finding.line || 0),
    column: Number(finding.column || 0),
    severity: String(finding.severity || 'MEDIUM').toUpperCase(),
    diagnostic: String(finding.diagnostic || ''),
    message: String(finding.message || '')
  });
}

function deduplicateFindings(findings) {
  const byIdentity = new Map();
  const collisions = [];
  for (const finding of findings) {
    const payload = canonicalFindingPayload(finding);
    const existing = byIdentity.get(finding.identity);
    if (!existing) {
      byIdentity.set(finding.identity, { finding: { ...finding, occurrence_count: 1 }, payload });
      continue;
    }
    if (existing.payload !== payload) {
      collisions.push(finding.identity);
      continue;
    }
    existing.finding.occurrence_count += 1;
  }
  const unique = [...byIdentity.values()].map((item) => item.finding);
  return {
    findings: unique,
    duplicates: unique
      .filter((item) => item.occurrence_count > 1)
      .map((item) => ({ identity: item.identity, occurrence_count: item.occurrence_count })),
    collisions: [...new Set(collisions)].sort()
  };
}

function scanToolkitRules(root, files, rulesDocument = readJson(RULES_PATH)) {
  const findings = [];
  for (const file of files) {
    if (file.redirected || file.size > TEXT_LIMIT) continue;
    const relativeLower = slash(file.relative).toLowerCase();
    if (
      relativeLower.includes('/tests/') ||
      relativeLower.startsWith('repo/tests/') ||
      relativeLower.includes('/fixtures/') ||
      relativeLower.includes('/repository-security-gate/rules/')
    ) continue;
    const extension = path.extname(file.relative).toLowerCase();
    const shell = shellDescriptor(file);
    const text = smallText(file);
    if (!text) continue;
    const lines = text.split('\n');
    for (const rule of rulesDocument.rules) {
      const appliesByExtension = rule.extensions.includes(extension);
      const appliesByShellContent = shell && rule.extensions.some((item) => ['.sh', '.bash'].includes(item));
      if (!appliesByExtension && !appliesByShellContent) continue;
      const expression = new RegExp(rule.pattern, 'i');
      for (let index = 0; index < lines.length; index += 1) {
        if (!expression.test(lines[index])) continue;
        findings.push({
          ...stableFinding('toolkit-rules', rule.id, file.relative, index + 1, rule.message, {
            severity: rule.severity,
            diagnostic: rule.id
          }),
          rule_version: rulesDocument.rules_version
        });
      }
    }
  }
  return findings;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: options.maxBuffer || OUTPUT_LIMIT,
    timeout: options.timeout
  });
  if (result.error) return { status: null, stdout: '', stderr: '', error: result.error.message };
  return {
    status: result.status,
    stdout: String(result.stdout || '').slice(0, OUTPUT_LIMIT),
    stderr: String(result.stderr || '').slice(0, OUTPUT_LIMIT),
    error: null
  };
}

function toolExecutable(toolsDir, name) {
  const windows = process.platform === 'win32';
  const map = {
    trivy: windows ? 'trivy.exe' : 'trivy',
    'osv-scanner': windows ? 'osv-scanner.exe' : 'osv-scanner',
    zizmor: windows ? 'zizmor.exe' : 'zizmor',
    actionlint: windows ? 'actionlint.exe' : 'actionlint',
    shellcheck: windows ? 'shellcheck.exe' : 'shellcheck',
    'gitleaks-cli': windows ? 'gitleaks.exe' : 'gitleaks'
  };
  return path.join(path.resolve(toolsDir), map[name] || name);
}

function isContainedRegularTool(toolsDir, candidate) {
  const root = path.resolve(toolsDir);
  try {
    const rootStat = fs.lstatSync(root);
    const candidateStat = fs.lstatSync(candidate);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) return false;
    return isWithin(fs.realpathSync.native(root), fs.realpathSync.native(candidate));
  } catch {
    return false;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function relativeScannerPath(root, value, inventory = trackedPathInventory(root)) {
  return resolveScannerPath(root, value, inventory);
}

function genericJsonFindings(tool, root, parsed, options = {}) {
  const findings = [];
  const inventory = options.pathInventory || trackedPathInventory(root);
  function add(rule, severity, filePath, line, column, discriminatorParts = []) {
    const normalizedRule = String(rule || 'finding').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
    const safeSeverity = String(severity || 'MEDIUM').toUpperCase();
    const diagnosticHash = sha256(JSON.stringify(discriminatorParts.map((item) => String(item ?? ''))));
    const diagnostic = `${normalizedRule}:sha256:${diagnosticHash}`;
    findings.push(stableFinding(
      tool,
      normalizedRule,
      relativeScannerPath(root, filePath, inventory),
      line,
      `${tool} diagnostic ${normalizedRule}`,
      { column, severity: safeSeverity, diagnostic }
    ));
  }
  if (tool === 'trivy') {
    for (const result of parsed.Results || []) {
      for (const item of result.Vulnerabilities || []) {
        add(item.VulnerabilityID, item.Severity, result.Target, 0, 0, [
          item.VulnerabilityID, item.PkgName, item.InstalledVersion, item.FixedVersion
        ]);
      }
      for (const item of result.Misconfigurations || []) {
        add(item.ID, item.Severity, result.Target, item.CauseMetadata?.StartLine || 0, 0, [
          item.ID, item.Type, item.CauseMetadata?.Provider
        ]);
      }
      for (const item of result.Secrets || []) {
        add(item.RuleID, item.Severity || 'HIGH', result.Target, item.StartLine || 0, 0, [
          item.RuleID, item.Category, item.EndLine
        ]);
      }
    }
  } else if (tool === 'osv-scanner') {
    for (const result of parsed.results || []) {
      for (const pkg of result.packages || []) {
        for (const vulnerability of pkg.vulnerabilities || []) {
          add(vulnerability.id, 'HIGH', result.source?.path, 0, 0, [
            vulnerability.id, pkg.package?.name, pkg.package?.version, result.source?.type
          ]);
        }
      }
    }
  } else if (tool === 'zizmor') {
    for (const audit of Array.isArray(parsed) ? parsed : []) {
      for (const location of audit.locations || []) {
        const filePath = location.symbolic?.key?.Local?.verbatim_path;
        const row = location.concrete?.location?.start_point?.row;
        const column = location.concrete?.location?.start_point?.column;
        add(
          audit.ident,
          audit.determinations?.severity || 'MEDIUM',
          filePath,
          Number.isInteger(row) ? row + 1 : 0,
          Number.isInteger(column) ? column + 1 : 0,
          [audit.ident, audit.determinations?.confidence, audit.determinations?.persona]
        );
      }
    }
  } else {
    const list = Array.isArray(parsed) ? parsed : (parsed.findings || parsed.results || parsed.diagnostics || []);
    for (const item of list) {
      const scannerCode = item.code || item.RuleID || item.rule_id ||
        String(item.message || '').match(/\bSC\d{4}\b/i)?.[0] || '';
      add(
        item.rule || item.rule_id || item.RuleID || item.ident || item.kind || item.code || item.id,
        item.severity || item.level || 'MEDIUM',
        item.path || item.file || item.File || item.filepath || item.filename || item.location?.path,
        item.line || item.StartLine || item.line_number || item.location?.line || 0,
        item.column || item.StartColumn || item.column_number || item.location?.column || 0,
        [
          scannerCode,
          item.message || item.Message || item.description || item.Description,
          item.endLine || item.EndLine,
          item.endColumn || item.EndColumn
        ]
      );
    }
  }
  return findings;
}

function runAdapter(name, root, toolsDir, files, options = {}) {
  const execute = options.execute || run;
  const executeScanner = (command, args, runOptions = {}) => execute(command, args, {
    ...runOptions,
    env: options.env || invariantEnvironment(options.sandboxHome)
  });
  const pathInventory = options.pathInventory || trackedPathInventory(root);
  const executable = toolExecutable(toolsDir, name);
  if (name !== 'psscriptanalyzer' && !isContainedRegularTool(toolsDir, executable)) {
    return { status: 'missing', findings: [], failure: `${name}: verified binary is missing` };
  }
  let result;
  let parsed;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-gate-'));
  try {
    if (name === 'trivy') {
      result = executeScanner(executable, ['fs', '--format', 'json', '--scanners', 'vuln,secret,misconfig', '--exit-code', '0', root], { cwd: root });
      if (result.error || result.status !== 0) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'osv-scanner') {
      result = executeScanner(executable, ['scan', 'source', '-r', root, '--format', 'json'], { cwd: root });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'zizmor') {
      result = executeScanner(executable, ['--format=json', path.join(root, '.github', 'workflows')], { cwd: root });
      // zizmor uses exit 14 when audits found reportable results.
      if (result.error || ![0, 1, 14].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'actionlint') {
      const shellcheckExecutable = toolExecutable(toolsDir, 'shellcheck');
      if (!isContainedRegularTool(toolsDir, shellcheckExecutable)) {
        return {
          status: 'missing',
          findings: [],
          failure: 'actionlint: verified transitive ShellCheck binary is missing'
        };
      }
      result = executeScanner(
        executable,
        ['-shellcheck', shellcheckExecutable, '-format', '{{json .}}'],
        { cwd: root, env: options.env || process.env }
      );
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      parsed = lines.flatMap((line) => {
        const value = parseJson(line, name);
        return Array.isArray(value) ? value : [value];
      });
      const findings = genericJsonFindings(name, root, parsed, { pathInventory });
      return {
        status: 'complete',
        findings,
        evidence: {
          shellcheck_binding: `operation-tools/${path.basename(shellcheckExecutable)}`,
          shellcheck_selection: 'actionlint -shellcheck <verified-path>'
        }
      };
    } else if (name === 'shellcheck') {
      const inventory = shellInventory(files);
      if (inventory.supported.length + inventory.unsupported.length === 0) {
        return { status: 'not_applicable', findings: [] };
      }
      if (inventory.supported.length + inventory.unsupported.length > SHELL_FILE_LIMIT) {
        return {
          status: 'invalid',
          findings: [],
          failure: `shellcheck: shell input limit ${SHELL_FILE_LIMIT} exceeded`
        };
      }
      parsed = [];
      for (const descriptor of inventory.supported) {
        result = executeScanner(
          executable,
          ['--format=json', '--severity=warning', `--shell=${descriptor.dialect}`, descriptor.file.full],
          { cwd: root, env: options.env || process.env }
        );
        if (result.error || ![0, 1].includes(result.status)) {
          throw new Error(result.error || `exit ${result.status}`);
        }
        parsed.push(...parseJson(result.stdout, name));
      }
      const findings = genericJsonFindings(name, root, parsed, { pathInventory });
      if (inventory.unsupported.length > 0) {
        return {
          status: 'unverified',
          findings,
          unverified: inventory.unsupported.map((item) =>
            `shellcheck: unsupported shell interpreter ${item.interpreter} at ${normalizedRelativePath(item.file.relative)}`
          ),
          evidence: {
            explicit_dialects: [...new Set(inventory.supported.map((item) => item.dialect))].sort()
          }
        };
      }
      return {
        status: 'complete',
        findings,
        evidence: {
          explicit_dialects: [...new Set(inventory.supported.map((item) => item.dialect))].sort()
        }
      };
    } else if (name === 'psscriptanalyzer') {
      const psFiles = files.filter((file) => ['.ps1', '.psm1', '.psd1'].includes(path.extname(file.relative).toLowerCase()));
      if (psFiles.length === 0) return { status: 'not_applicable', findings: [] };
      const modulePath = path.join(path.resolve(toolsDir), 'PSScriptAnalyzer', 'PSScriptAnalyzer.psd1');
      if (!isContainedRegularTool(toolsDir, modulePath)) {
        return { status: 'missing', findings: [], failure: 'psscriptanalyzer: verified module is missing' };
      }
      const command = [
        `$items = @(${psFiles.map((file) => `'${file.full.replace(/'/g, "''")}'`).join(',')})`,
        `Import-Module '${modulePath.replace(/'/g, "''")}' -Force`,
        "$securityRules = @('PSAvoidUsingConvertToSecureStringWithPlainText','PSAvoidUsingInvokeExpression','PSAvoidUsingPlainTextForPassword','PSAvoidUsingUsernameAndPasswordParams','PSUsePSCredentialType')",
        '$results = foreach ($item in $items) { Invoke-ScriptAnalyzer -Path $item -Recurse:$false -IncludeRule $securityRules }',
        '$results | Select-Object RuleName,Severity,ScriptPath,Line | ConvertTo-Json -Depth 4 -Compress'
      ].join('; ');
      result = executeScanner('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: root });
      if (result.error || result.status !== 0) throw new Error(result.error || `exit ${result.status}`);
      parsed = result.stdout.trim() ? parseJson(result.stdout, name) : [];
      if (!Array.isArray(parsed)) parsed = [parsed];
      parsed = parsed.map((item) => ({
        rule: item.RuleName,
        severity: ({ 0: 'LOW', 1: 'MEDIUM', 2: 'HIGH' })[Number(item.Severity)] || item.Severity,
        path: item.ScriptPath,
        line: item.Line
      }));
    } else if (name === 'gitleaks-cli') {
      const reportPath = path.join(temporary, 'gitleaks.json');
      result = executeScanner(executable, ['dir', root, '--no-banner', '--redact', '--report-format', 'json', '--report-path', reportPath], { cwd: root });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = fs.existsSync(reportPath) ? readJson(reportPath) : [];
    } else {
      return { status: 'invalid', findings: [], failure: `${name}: adapter is not implemented` };
    }
    return { status: 'complete', findings: genericJsonFindings(name, root, parsed, { pathInventory }) };
  } catch (error) {
    return { status: 'invalid', findings: [], failure: `${name}: ${error.message}` };
  } finally {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
    } catch {
      // Operation-owned temporary cleanup failure does not hide adapter evidence.
    }
  }
}

function invariantEnvironment(home) {
  const operationHome = home || os.tmpdir();
  const env = {
    PATH: process.env.PATH || '',
    HOME: operationHome,
    TEMP: operationHome,
    TMP: operationHome,
    CI: 'true',
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || 'C.UTF-8'
  };
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function runInvariantCommand(command, args, options = {}) {
  const env = invariantEnvironment(options.sandboxHome);
  if (options.sandboxUid && options.sandboxGid && process.platform !== 'win32') {
    return run('sudo', [
      '-n',
      'unshare',
      '--net',
      '--fork',
      '--kill-child',
      '--setgid', String(options.sandboxGid),
      '--setuid', String(options.sandboxUid),
      '--',
      'env', '-i',
      ...Object.entries(env).map(([name, value]) => `${name}=${value}`),
      command,
      ...args
    ], {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      env
    });
  }
  return run(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    env
  });
}

function runInvariants(root, mode, base, head, options = {}) {
  const document = readJson(INVARIANTS_PATH);
  const findings = [];
  const failures = [];
  const consumed = [];
  const executedTests = new Map();
  const seen = new Set();
  for (const evidence of document.evidence) {
    for (const relative of evidence.tests) {
      if (seen.has(relative)) continue;
      seen.add(relative);
      const full = path.join(root, relative);
      if (
        !fs.existsSync(full) ||
        !fs.lstatSync(full).isFile() ||
        fs.lstatSync(full).isSymbolicLink() ||
        !isWithin(root, fs.realpathSync.native(full))
      ) {
        failures.push(`${evidence.id}: missing ${relative}`);
        continue;
      }
      const digest = sourceBindingDigest(full);
      const result = runInvariantCommand(process.execPath, ['--test', relative], {
        cwd: root,
        timeout: 120000,
        maxBuffer: INVARIANT_OUTPUT_LIMIT,
        sandboxUid: options.sandboxUid,
        sandboxGid: options.sandboxGid,
        sandboxHome: options.sandboxHome
      });
      consumed.push({ path: relative, sha256: digest, status: result.error || result.status !== 0 ? 'FINDINGS' : 'PASS' });
      if (result.error || result.status !== 0) {
        findings.push({
          ...stableFinding('toolkit-invariants', evidence.id, relative, 0, 'Security invariant test failed', {
            severity: 'HIGH',
            diagnostic: evidence.id
          })
        });
      } else {
        executedTests.set(relative, digest);
      }
    }
  }
  return { findings, failures, consumed, executedTests, mode, base, head };
}

function safeInvariantEvidence(value, root) {
  if (!Array.isArray(value) || value.length > 50) return false;
  return value.every((item) => {
    if (typeof item !== 'string' || !/^[A-Za-z0-9 ._:/-]{1,160}$/.test(item)) return false;
    if (item.includes('..') || path.isAbsolute(item) || /^[A-Za-z]:[\\/]/.test(item)) return false;
    return !item.includes(root) && !item.includes(os.homedir());
  });
}

function consumerInvariantCommand(test) {
  if (test.runner === 'node') return { command: process.execPath, args: [test.path], extensions: ['.js', '.cjs', '.mjs'] };
  if (test.runner === 'python') {
    return { command: process.platform === 'win32' ? 'python' : 'python3', args: [test.path], extensions: ['.py'] };
  }
  if (test.runner === 'powershell') {
    return {
      command: 'pwsh',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', test.path],
      extensions: ['.ps1']
    };
  }
  return null;
}

function runConsumerInvariants(root, profile, manifestRelative, mode, base, head, options = {}) {
  const findings = [];
  const failures = [];
  const consumed = [];
  const executedTests = new Map();
  const expectedLayer = profile === PROFILE_WEB ? 'project_invariants' : 'workflow_invariants';
  const normalizedManifest = normalizedRelativePath(manifestRelative || '');
  if (
    !normalizedManifest ||
    path.isAbsolute(manifestRelative || '') ||
    normalizedManifest.split('/').includes('..') ||
    /[*?]/.test(normalizedManifest)
  ) {
    return { layer: expectedLayer, findings, failures: [`${expectedLayer}: invariant manifest path is invalid`], consumed, executedTests };
  }
  const manifestPath = path.resolve(root, normalizedManifest);
  if (
    !isWithin(root, manifestPath) ||
    !fs.existsSync(manifestPath) ||
    !fs.lstatSync(manifestPath).isFile() ||
    fs.lstatSync(manifestPath).isSymbolicLink() ||
    !isWithin(root, fs.realpathSync.native(manifestPath))
  ) {
    return { layer: expectedLayer, findings, failures: [`${expectedLayer}: invariant manifest is missing or redirected`], consumed, executedTests };
  }
  let document;
  try {
    document = readJson(manifestPath);
  } catch {
    return { layer: expectedLayer, findings, failures: [`${expectedLayer}: invariant manifest is malformed`], consumed, executedTests };
  }
  if (
    document.schema_version !== 1 ||
    document.profile !== profile ||
    !Array.isArray(document.tests) ||
    document.tests.length === 0 ||
    document.tests.length > 100
  ) {
    return { layer: expectedLayer, findings, failures: [`${expectedLayer}: invariant manifest contract is invalid`], consumed, executedTests };
  }
  const ids = new Set();
  for (const test of document.tests) {
    const keys = test && typeof test === 'object' ? Object.keys(test).sort() : [];
    if (
      !test ||
      keys.join(',') !== 'id,path,runner,timeout_seconds' ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(test.id || '') ||
      ids.has(test.id) ||
      !Number.isInteger(test.timeout_seconds) ||
      test.timeout_seconds < 1 ||
      test.timeout_seconds > 120
    ) {
      failures.push(`${expectedLayer}: invariant entry is invalid`);
      continue;
    }
    ids.add(test.id);
    const relative = normalizedRelativePath(test.path || '');
    const command = consumerInvariantCommand({ ...test, path: relative });
    const full = path.resolve(root, relative);
    if (
      !command ||
      path.isAbsolute(test.path || '') ||
      relative.split('/').includes('..') ||
      /[*?]/.test(relative) ||
      !command.extensions.includes(path.extname(relative).toLowerCase()) ||
      !isWithin(root, full) ||
      !fs.existsSync(full) ||
      !fs.lstatSync(full).isFile() ||
      fs.lstatSync(full).isSymbolicLink() ||
      !isWithin(root, fs.realpathSync.native(full)) ||
      fs.lstatSync(full).size > TEXT_LIMIT
    ) {
      failures.push(`${expectedLayer}/${test.id}: invariant test is missing, redirected, or outside the approved runner contract`);
      continue;
    }
    const digest = sourceBindingDigest(full);
    const result = runInvariantCommand(command.command, command.args, {
      cwd: root,
      timeout: test.timeout_seconds * 1000,
      maxBuffer: INVARIANT_OUTPUT_LIMIT,
      sandboxUid: options.sandboxUid,
      sandboxGid: options.sandboxGid,
      sandboxHome: options.sandboxHome
    });
    if (result.error) {
      failures.push(`${expectedLayer}/${test.id}: invariant execution did not complete`);
      consumed.push({ id: test.id, path: relative, sha256: digest, status: 'UNVERIFIED' });
      continue;
    }
    if (result.status !== 0) {
      findings.push(stableFinding(
        'consumer-invariants',
        test.id,
        relative,
        0,
        'Consumer attacker invariant failed',
        { severity: 'HIGH', diagnostic: test.id }
      ));
      consumed.push({ id: test.id, path: relative, sha256: digest, status: 'FINDINGS' });
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(result.stdout.trim());
    } catch {
      payload = null;
    }
    if (
      !payload ||
      payload.schema_version !== 1 ||
      payload.test_id !== test.id ||
      !['PASS', 'FINDINGS'].includes(payload.status) ||
      !safeInvariantEvidence(payload.evidence, root)
    ) {
      failures.push(`${expectedLayer}/${test.id}: invariant result is malformed or unsafe`);
      consumed.push({ id: test.id, path: relative, sha256: digest, status: 'UNVERIFIED' });
      continue;
    }
    if (payload.status === 'FINDINGS') {
      findings.push(stableFinding(
        'consumer-invariants',
        test.id,
        relative,
        0,
        'Consumer attacker invariant reported a finding',
        { severity: 'HIGH', diagnostic: test.id }
      ));
      consumed.push({ id: test.id, path: relative, sha256: digest, status: 'FINDINGS' });
      continue;
    }
    executedTests.set(relative, digest);
    consumed.push({ id: test.id, path: relative, sha256: digest, status: 'PASS', evidence: payload.evidence });
  }
  return {
    layer: expectedLayer,
    findings,
    failures,
    consumed,
    executedTests,
    manifest: normalizedManifest,
    manifest_sha256: sourceBindingDigest(manifestPath),
    profile,
    mode,
    base,
    head
  };
}

function scannerApplicability(name, classification, files) {
  const hasActions = files.some((file) => file.relative.toLowerCase().startsWith('.github/workflows/'));
  const hasManifest = files.some((file) => manifestNames.has(path.basename(file.relative).toLowerCase()));
  const hasDependencyLock = files.some((file) => dependencyLockNames.has(path.basename(file.relative).toLowerCase()));
  const hasIac = files.some((file) => deployNames.has(path.basename(file.relative).toLowerCase()) || path.extname(file.relative).toLowerCase() === '.tf');
  if (['actionlint', 'zizmor'].includes(name)) return hasActions;
  if (name === 'shellcheck') {
    const inventory = shellInventory(files);
    return inventory.supported.length + inventory.unsupported.length > 0;
  }
  if (name === 'psscriptanalyzer') return files.some((file) => ['.ps1', '.psm1', '.psd1'].includes(path.extname(file.relative).toLowerCase()));
  if (name === 'trivy') return hasManifest || hasIac;
  if (name === 'osv-scanner') return hasDependencyLock;
  if (name === 'gitleaks-cli') return classification.profile !== PROFILE_EXEMPT;
  return false;
}

function applySuppressions(findings, document) {
  if (!document) return { active: findings, suppressed: [] };
  const byIdentity = new Map(document.suppressions.map((item) => [item.finding_identity, item]));
  const active = [];
  const suppressed = [];
  for (const finding of findings) {
    const suppression = byIdentity.get(finding.identity);
    if (!suppression || suppression.path !== finding.path || suppression.rule !== finding.rule || suppression.tool !== finding.tool) {
      active.push(finding);
    } else {
      suppressed.push({ ...finding, suppression_id: suppression.id, expires: suppression.expires });
    }
  }
  return { active, suppressed };
}

function git(root, args) {
  const result = run('git', args, { cwd: root });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

function gitPathList(root, args) {
  const result = run('git', args, { cwd: root });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed`);
  if (result.stdout.length >= OUTPUT_LIMIT) throw new Error('Git path-list output reached the safety bound.');
  return result.stdout.split('\0').filter(Boolean).map(canonicalGitPath);
}

function resolveExactCommit(root, revision, label) {
  if (!SHA40.test(revision || '')) throw new Error(`${label} must be an exact 40-character commit.`);
  let resolved;
  try {
    resolved = git(root, ['rev-parse', '--verify', `${revision}^{commit}`]);
  } catch {
    throw new Error(`${label} does not resolve to a commit.`);
  }
  if (resolved.toLowerCase() !== String(revision).toLowerCase()) {
    throw new Error(`${label} is ambiguous or did not resolve exactly.`);
  }
  return resolved.toLowerCase();
}

function verifyExactCheckout(root, baseRevision, headRevision, requireBase) {
  const head = resolveExactCommit(root, headRevision, 'head');
  const base = requireBase ? resolveExactCommit(root, baseRevision, 'base') : null;
  const checkedOut = resolveExactCommit(root, git(root, ['rev-parse', 'HEAD']), 'checked-out HEAD');
  if (checkedOut !== head) throw new Error('Checked-out commit does not equal the supplied exact head.');
  if (base) {
    const ancestry = run('git', ['merge-base', '--is-ancestor', base, head], { cwd: root });
    if (ancestry.error || ancestry.status !== 0) {
      throw new Error('Base commit is not reachable as an ancestor of the supplied head.');
    }
  }
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
  if (status) throw new Error('Exact-head evidence requires a clean working tree.');
  return {
    base,
    head,
    scanned_head_digest: `git-sha1:${head}`
  };
}

function captureRepositoryIntegrity(root, head, inventory = trackedPathInventory(root, head)) {
  return {
    head: resolveExactCommit(root, git(root, ['rev-parse', 'HEAD']), 'integrity HEAD'),
    tree: git(root, ['rev-parse', `${head}^{tree}`]).toLowerCase(),
    manifest_sha256: inventory.manifest_sha256,
    tracked_files: inventory.count,
    status: git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'])
  };
}

function compareRepositoryIntegrity(root, expected) {
  try {
    const inventory = trackedPathInventory(root, expected.head);
    const current = captureRepositoryIntegrity(root, expected.head, inventory);
    const changed = (
      current.head !== expected.head ||
      current.tree !== expected.tree ||
      current.manifest_sha256 !== expected.manifest_sha256 ||
      current.tracked_files !== expected.tracked_files ||
      current.status !== expected.status
    );
    return { valid: !changed, current };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function exactFileDigest(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function validateTrustedAuthority(authority, candidateHead) {
  const errors = [];
  if (!authority || authority.schema_version !== 1) {
    return { valid: false, errors: ['trusted authority schema is missing or invalid'] };
  }
  if (!['protected-base', 'bootstrap-immutable-review'].includes(authority.mode)) {
    errors.push('trusted authority mode is invalid');
  }
  if (!SHA40.test(authority.commit || '') || !SHA40.test(authority.tree || '')) {
    errors.push('trusted authority commit and tree must be exact Git identities');
  }
  if (authority.candidate_head !== candidateHead) errors.push('trusted authority candidate head does not match');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(authority.target_repository || '') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(authority.candidate_repository || '')
  ) {
    errors.push('trusted authority repository identities are missing or invalid');
  }
  try {
    if (authority.gate_version !== readJson(POLICY_PATH).policy_version) {
      errors.push('trusted authority gate version does not match the trusted policy');
    }
  } catch {
    errors.push('trusted authority policy is missing or unreadable');
  }
  const expectedTopology = {
    trusted_gate: 'trusted-gate',
    scanned_candidate: 'candidate',
    operation_tools: 'operation/tools',
    operation_reports: 'operation/reports',
    operation_scanner_home: 'operation/scanner-home',
    operation_invariant_home: 'operation/invariant-home',
    executable_candidate_code: 'isolated-no-secret-no-network-worker-only'
  };
  if (JSON.stringify(authority.checkout_topology) !== JSON.stringify(expectedTopology)) {
    errors.push('trusted authority checkout topology is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(authority.manifest_digest || '')) {
    errors.push('trusted authority manifest digest is invalid');
  }
  if (
    !authority.invoking_workflow ||
    !SHA40.test(authority.invoking_workflow.commit || '') ||
    !/^sha256:[0-9a-f]{64}$/.test(authority.invoking_workflow.sha256 || '')
  ) {
    errors.push('invoking workflow identity is missing or invalid');
  }
  const authorityRoot = (() => {
    try {
      return safeRepoRoot(git(PACK_ROOT, ['rev-parse', '--show-toplevel']));
    } catch {
      return null;
    }
  })();
  if (!authorityRoot) {
    errors.push('trusted authority repository root is unavailable');
    return { valid: false, errors };
  }
  try {
    const head = resolveExactCommit(authorityRoot, git(authorityRoot, ['rev-parse', 'HEAD']), 'trusted authority HEAD');
    if (head !== authority.commit) errors.push('trusted authority checkout commit mismatch');
    const tree = git(authorityRoot, ['rev-parse', `${authority.commit}^{tree}`]).toLowerCase();
    if (tree !== authority.tree) errors.push('trusted authority tree mismatch');
    const status = git(authorityRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
    if (status) errors.push('trusted authority checkout is not clean');
  } catch (error) {
    errors.push(error.message);
  }
  const bindings = authority.bindings && typeof authority.bindings === 'object'
    ? authority.bindings
    : {};
  const required = ['workflow', 'runner', 'trusted_runner', 'policy', 'rules', 'tool_lock', 'installer', 'report_schema', 'suppression_schema', 'invariant_schema'];
  for (const name of required) {
    const binding = bindings[name];
    if (
      !binding ||
      typeof binding.path !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(binding.sha256 || '')
    ) {
      errors.push(`trusted authority binding ${name} is missing or invalid`);
      continue;
    }
    let relative;
    try {
      relative = canonicalGitPath(binding.path);
    } catch {
      errors.push(`trusted authority binding ${name} path is invalid`);
      continue;
    }
    const full = path.resolve(authorityRoot, relative);
    if (!isWithin(authorityRoot, full) || !fs.existsSync(full) || !fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) {
      errors.push(`trusted authority binding ${name} is missing or redirected`);
      continue;
    }
    if (`sha256:${exactFileDigest(full)}` !== binding.sha256) {
      errors.push(`trusted authority binding ${name} digest mismatch`);
    }
  }
  if (
    authority.mode === 'protected-base' &&
    authority.invoking_workflow &&
    (
      authority.invoking_workflow.commit !== authority.commit ||
      authority.invoking_workflow.sha256 !== bindings.workflow?.sha256
    )
  ) {
    errors.push('protected invoking workflow does not match trusted authority');
  }
  const unsigned = { ...authority };
  delete unsigned.manifest_digest;
  if (`sha256:${sha256(JSON.stringify(unsigned))}` !== authority.manifest_digest) {
    errors.push('trusted authority manifest digest mismatch');
  }
  return { valid: errors.length === 0, errors, authorityRoot };
}

function sealReport(report) {
  const unsigned = { ...report };
  delete unsigned.report_digest;
  return {
    ...unsigned,
    report_digest: `sha256:${sha256(`${JSON.stringify(unsigned)}\n`)}`
  };
}

function repositoryIdentity(root) {
  try {
    const url = git(root, ['config', '--get', 'remote.origin.url']);
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i);
    return match ? match[1] : path.basename(root);
  } catch {
    return path.basename(root);
  }
}

function sanitisedReport(report) {
  const text = JSON.stringify(report);
  if (text.includes(process.cwd()) || text.includes(os.homedir())) {
    throw new Error('Report contains a private absolute path.');
  }
  return report;
}

function markdownReport(report) {
  const lines = [
    '# Repository Security Gate',
    '',
    `- State: \`${report.state}\``,
    `- Repository: \`${report.repository}\``,
    `- Candidate repository: \`${report.candidate_repository || 'unverified'}\``,
    `- Mode: \`${report.mode}\``,
    `- Base: \`${report.base || 'not_applicable'}\``,
    `- Head: \`${report.head || 'not_applicable'}\``,
    `- Scanned head digest: \`${report.scanned_head_digest || 'not_applicable'}\``,
    `- Scanned tree digest: \`${report.scanned_tree_digest || 'not_applicable'}\``,
    `- Scanned manifest digest: \`${report.scanned_manifest_digest || 'not_applicable'}\``,
    `- Trusted gate commit: \`${report.trusted_authority?.commit || 'unverified'}\``,
    `- Trusted workflow digest: \`${report.trusted_authority?.bindings?.workflow?.sha256 || 'unverified'}\``,
    `- Trusted runner digest: \`${report.trusted_authority?.bindings?.runner?.sha256 || 'unverified'}\``,
    `- Artifact digest: \`${report.artifact_digest || 'not_applicable'}\``,
    `- Profile: \`${report.profile}\``,
    `- Report digest: \`${report.report_digest || 'not_sealed'}\``,
    '',
    '## Coverage',
    ''
  ];
  for (const item of report.coverage) lines.push(`- \`${item.layer}\`: ${item.status}`);
  lines.push('', '## Findings', '');
  if (report.findings.length === 0) lines.push('No unsuppressed findings.');
  for (const finding of report.findings) {
    lines.push(`- \`${finding.severity}\` \`${finding.tool}/${finding.rule}\` at \`${finding.path}:${finding.line}\` (${finding.identity}; occurrences ${finding.occurrence_count})`);
  }
  lines.push('', '## Duplicate emissions', '');
  if (report.finding_duplicates.length === 0) lines.push('None.');
  for (const duplicate of report.finding_duplicates) {
    lines.push(`- \`${duplicate.identity}\`: ${duplicate.occurrence_count} canonical emissions`);
  }
  lines.push('', '## Suppressed findings', '');
  if (report.suppressed_findings.length === 0) lines.push('No suppressed findings.');
  for (const finding of report.suppressed_findings) {
    lines.push(`- \`${finding.tool}/${finding.rule}\` at \`${finding.path}:${finding.line}\` via \`${finding.suppression_id}\``);
  }
  lines.push('', '## Unverified areas', '');
  if (report.unverified_areas.length === 0) lines.push('None.');
  for (const item of report.unverified_areas) lines.push(`- ${item}`);
  lines.push('', '## Infrastructure failures', '');
  if (report.infrastructure_failures.length === 0) lines.push('None.');
  for (const item of report.infrastructure_failures) lines.push(`- ${item}`);
  lines.push('', '## Next action', '', report.next_action, '');
  return lines.join('\n');
}

function writeReportFiles(report, args, root) {
  const explicitReportRoot = Boolean(args['report-root']);
  const reportRoot = path.resolve(args['report-root'] || root);
  if (!fs.existsSync(reportRoot)) fs.mkdirSync(reportRoot, { recursive: true });
  const jsonPath = path.resolve(
    reportRoot,
    args['report-json'] || (explicitReportRoot ? 'security-gate.json' : 'security-reports/security-gate.json')
  );
  const markdownPath = path.resolve(
    reportRoot,
    args['report-md'] || (explicitReportRoot ? 'security-gate.md' : 'security-reports/security-gate.md')
  );
  for (const target of [jsonPath, markdownPath]) {
    if (!isWithin(reportRoot, target)) throw new Error('Report output must stay inside the operation-owned report root.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdownReport(report), 'utf8');
  return {
    json: slash(path.relative(reportRoot, jsonPath)),
    markdown: slash(path.relative(reportRoot, markdownPath))
  };
}

function scanCommand(args) {
  const root = safeRepoRoot(args.repo || '.');
  const policy = readJson(POLICY_PATH);
  const mode = String(args.mode || '');
  if (!policy.allowed_modes.includes(mode)) throw new Error(`Mode must be one of: ${policy.allowed_modes.join(', ')}`);
  let head = null;
  let base = null;
  let scannedHeadDigest = null;
  if (mode === 'pr') {
    const verified = verifyExactCheckout(root, String(args.base || ''), String(args.head || ''), true);
    base = verified.base;
    head = verified.head;
    scannedHeadDigest = verified.scanned_head_digest;
  } else if (mode === 'release') {
    const verified = verifyExactCheckout(root, null, String(args.head || ''), false);
    head = verified.head;
    scannedHeadDigest = verified.scanned_head_digest;
  } else {
    try {
      head = resolveExactCommit(root, git(root, ['rev-parse', 'HEAD']), 'checked-out HEAD');
      scannedHeadDigest = `git-sha1:${head}`;
    } catch {
      head = null;
      scannedHeadDigest = null;
    }
  }
  const inventory = trackedPathInventory(root, head || 'HEAD');
  const candidateIntegrity = captureRepositoryIntegrity(root, head, inventory);
  const candidateTreeDigest = `git-sha1:${candidateIntegrity.tree}`;
  const candidateManifestDigest = `sha256:${candidateIntegrity.manifest_sha256}`;
  let authority = null;
  let authorityResult = { valid: false, errors: ['trusted authority manifest was not supplied'] };
  if (args['trusted-authority-file']) {
    const authorityPath = path.resolve(args['trusted-authority-file']);
    authority = readJson(authorityPath);
    authorityResult = validateTrustedAuthority(authority, head);
    if (
      authorityResult.valid &&
      repositoryIdentity(root).toLowerCase() !== authority.candidate_repository.toLowerCase()
    ) {
      authorityResult = { valid: false, errors: ['candidate checkout repository identity does not match trusted authority'] };
    }
  }
  const reportRoot = path.resolve(args['report-root'] || root);
  const toolsDir = path.resolve(args['tools-dir'] || path.join(root, '.security-tools'));
  if (authorityResult.valid) {
    const authorityRoot = authorityResult.authorityRoot;
    if (
      root === authorityRoot ||
      isWithin(root, authorityRoot) ||
      isWithin(authorityRoot, root)
    ) {
      authorityResult = { valid: false, errors: ['trusted authority and candidate checkouts are not separate'] };
    } else if (
      reportRoot === root ||
      isWithin(root, reportRoot) ||
      reportRoot === authorityRoot ||
      isWithin(authorityRoot, reportRoot)
    ) {
      authorityResult = { valid: false, errors: ['report root is not operation-owned and separate from both checkouts'] };
    } else if (
      toolsDir === root ||
      isWithin(root, toolsDir) ||
      toolsDir === authorityRoot ||
      isWithin(authorityRoot, toolsDir)
    ) {
      authorityResult = { valid: false, errors: ['tool root is not operation-owned and separate from both checkouts'] };
    }
  }
  const files = walkRepository(root);
  const classification = classifyRepository(root, files);
  const artifactDigest = args['artifact-digest'] || null;
  if (artifactDigest && !/^sha256:[0-9a-f]{64}$/i.test(artifactDigest)) throw new Error('Artifact digest must be sha256:<64 hex>.');
  const lock = readJson(TOOL_LOCK_PATH);
  const lockResult = validateToolLock(lock);
  const coverage = [{ layer: 'repository_classification', status: 'complete' }];
  const unverified = [];
  const infrastructureFailures = [];
  let findings = [];
  if (!authorityResult.valid) {
    coverage.push({ layer: 'trusted_authority', status: 'invalid' });
    unverified.push(...authorityResult.errors.map((item) => `trusted authority: ${item}`));
  } else {
    coverage.push({ layer: 'trusted_authority', status: 'complete' });
  }
  coverage.push({
    layer: 'git_path_identity',
    status: 'complete',
    tracked_files: inventory.count,
    manifest_digest: candidateManifestDigest,
    case_fold_alias_count: inventory.caseAliases.length
  });
  const assertIntegrity = (layer) => {
    const candidateCheck = compareRepositoryIntegrity(root, candidateIntegrity);
    if (!candidateCheck.valid) {
      coverage.push({ layer: `${layer}_candidate_integrity`, status: 'invalid' });
      unverified.push(`${layer}: candidate tree changed during trusted gate execution`);
    }
    let trustedCheck = { valid: authorityResult.valid };
    if (authorityResult.valid) {
      trustedCheck = validateTrustedAuthority(authority, head);
      if (!trustedCheck.valid) {
        coverage.push({ layer: `${layer}_trusted_integrity`, status: 'invalid' });
        unverified.push(...trustedCheck.errors.map((item) => `${layer}: trusted authority ${item}`));
      }
    }
    return candidateCheck.valid && trustedCheck.valid;
  };
  if (args['preflight-failed']) {
    coverage.push({ layer: 'gate_preflight', status: 'invalid' });
    unverified.push('gate_preflight: provenance or fixture validation failed');
  }
  if (args['install-failed']) {
    coverage.push({ layer: 'tool_installation', status: 'blocked' });
    infrastructureFailures.push('verified scanner installation did not complete');
    unverified.push('tool_installation: required scanner installation failed');
  }
  let ruleFiles = files;
  if (mode === 'pr') {
    const changed = new Set(
      gitPathList(root, [
        '-c', 'core.quotepath=false',
        'diff', '--name-only', '-z', '--diff-filter=ACMR', base, head
      ])
    );
    const critical = policy.security_critical_paths.some((prefix) =>
      [...changed].some((item) => item.toLowerCase().startsWith(prefix.toLowerCase()))
    );
    ruleFiles = critical ? files : files.filter((file) => changed.has(canonicalGitPath(file.relative)));
    coverage.push({
      layer: 'pr_scope',
      status: 'complete',
      changed_files: changed.size,
      security_critical_full_expansion: critical
    });
    const controlChanges = enforcementControlChanges([...changed]);
    if (controlChanges.length > 0) {
      coverage.push({
        layer: 'authority_promotion',
        status: 'review_required',
        changed_control_files: controlChanges.length
      });
      unverified.push('authority_promotion: enforcement-control changes require separate immutable independent review before promotion');
    } else {
      coverage.push({ layer: 'authority_promotion', status: 'complete' });
    }
  }
  if (!lockResult.valid) {
    coverage.push({ layer: 'tool_lock', status: 'invalid' });
    unverified.push(...lockResult.errors.map((item) => `tool lock: ${item}`));
  } else {
    coverage.push({ layer: 'tool_lock', status: 'complete' });
  }
  if (classification.profile === PROFILE_EXEMPT) {
    let state = authorityResult.valid ? PROFILE_EXEMPT : 'SECURITY_GATE_UNVERIFIED';
    if (!assertIntegrity('report_sealing')) state = 'SECURITY_GATE_UNVERIFIED';
    const report = sanitisedReport(sealReport({
      schema_version: 3,
      gate_version: policy.policy_version,
      state,
      repository: authorityResult.valid ? authority.target_repository : repositoryIdentity(root),
      candidate_repository: authorityResult.valid ? authority.candidate_repository : null,
      mode,
      base,
      head,
      scanned_head_digest: scannedHeadDigest,
      scanned_tree_digest: candidateTreeDigest,
      scanned_manifest_digest: candidateManifestDigest,
      artifact_digest: artifactDigest,
      profile: classification.profile,
      trusted_authority: authorityResult.valid ? authority : null,
      path_identity: {
        contract: 'exact-git-path-case-v1',
        tracked_files: inventory.count,
        manifest_digest: candidateManifestDigest,
        case_fold_aliases: inventory.caseAliases
      },
      versions: { lock: lock.lock_version, rules: readJson(RULES_PATH).rules_version, tools: [] },
      coverage,
      findings: [],
      finding_duplicates: [],
      suppressed_findings: [],
      unverified_areas: unverified,
      infrastructure_failures: [],
      next_action: 'No executable repository surface was detected. Reclassify if content changes.'
    }));
    const outputs = writeReportFiles(report, args, root);
    process.stdout.write(`${JSON.stringify({ state: report.state, profile: report.profile, outputs })}\n`);
    return report.state === PROFILE_EXEMPT ? 0 : 2;
  }
  findings.push(...scanToolkitRules(root, ruleFiles));
  coverage.push({ layer: 'toolkit_rules', status: 'complete' });
  const externalEnabled = !args['internal-only'];
  const toolVersions = [];
  const scannerNames = ['trivy', 'osv-scanner', 'zizmor', 'actionlint', 'shellcheck', 'psscriptanalyzer', 'gitleaks-cli'];
  for (const name of scannerNames) {
    if (!scannerApplicability(name, classification, files)) {
      coverage.push({ layer: name, status: 'not_applicable' });
      continue;
    }
    if (!lockResult.valid) {
      coverage.push({ layer: name, status: 'blocked' });
      unverified.push(`${name}: execution blocked by invalid tool provenance lock`);
      continue;
    }
    const record = lock.records.find((item) => item.name === name);
    if (!record || record.state !== 'active') {
      coverage.push({ layer: name, status: 'blocked' });
      unverified.push(`${name}: no active approved lock record`);
      continue;
    }
    toolVersions.push({ name, release: record.release, commit: record.commit, output_schema: record.output_schema, rules_database_version: record.rules_database_version });
    if (!externalEnabled) {
      coverage.push({ layer: name, status: 'unverified' });
      unverified.push(`${name}: external execution intentionally disabled`);
      continue;
    }
    const result = runAdapter(name, root, toolsDir, files, {
      pathInventory: inventory,
      env: invariantEnvironment(args['scanner-home'])
    });
    const evidence = { ...(result.evidence || {}) };
    if (name === 'actionlint') {
      const shellcheckRecord = lock.records.find((item) => item.name === 'shellcheck' && item.state === 'active');
      if (shellcheckRecord) {
        evidence.shellcheck_release = shellcheckRecord.release;
        evidence.shellcheck_commit = shellcheckRecord.commit;
      }
    }
    coverage.push({ layer: name, status: result.status, ...evidence });
    findings.push(...result.findings);
    if (result.unverified) unverified.push(...result.unverified);
    if (result.failure) {
      infrastructureFailures.push(result.failure);
      unverified.push(`${name}: required scanner did not complete`);
    }
    assertIntegrity(name);
  }
  const executedInvariantTests = new Map();
  const requiresToolkitInvariants = classification.profile === PROFILE_TOOLING && fs.existsSync(path.join(root, 'repo', 'tests'));
  if (requiresToolkitInvariants) {
    if (args['run-invariants']) {
      if (authorityResult.valid && process.platform !== 'win32' && (!args['sandbox-uid'] || !args['sandbox-gid'] || !args['sandbox-home'])) {
        coverage.push({ layer: 'invariant_isolation', status: 'invalid' });
        unverified.push('toolkit_invariants: trusted execution requires an isolated no-network worker identity');
      }
      const invariantResult = runInvariants(root, mode, base, head, {
        sandboxUid: args['sandbox-uid'],
        sandboxGid: args['sandbox-gid'],
        sandboxHome: args['sandbox-home']
      });
      findings.push(...invariantResult.findings);
      unverified.push(...invariantResult.failures);
      for (const [relative, digest] of invariantResult.executedTests) executedInvariantTests.set(relative, digest);
      coverage.push({
        layer: 'toolkit_invariants',
        status: invariantResult.failures.length === 0 ? 'complete' : 'unverified',
        consumed_tests: invariantResult.consumed
      });
      assertIntegrity('toolkit_invariants');
    } else {
      coverage.push({ layer: 'toolkit_invariants', status: 'unverified' });
      unverified.push('toolkit_invariants: --run-invariants was not enabled');
    }
  }
  if ([PROFILE_WEB, PROFILE_WORKFLOW].includes(classification.profile)) {
    const layer = classification.profile === PROFILE_WEB ? 'project_invariants' : 'workflow_invariants';
    if (args['run-invariants']) {
      if (authorityResult.valid && process.platform !== 'win32' && (!args['sandbox-uid'] || !args['sandbox-gid'] || !args['sandbox-home'])) {
        coverage.push({ layer: 'invariant_isolation', status: 'invalid' });
        unverified.push(`${layer}: trusted execution requires an isolated no-network worker identity`);
      }
      const invariantResult = runConsumerInvariants(
        root,
        classification.profile,
        args['invariant-manifest'] || policy.consumer_invariant_manifest,
        mode,
        base,
        head,
        {
          sandboxUid: args['sandbox-uid'],
          sandboxGid: args['sandbox-gid'],
          sandboxHome: args['sandbox-home']
        }
      );
      findings.push(...invariantResult.findings);
      unverified.push(...invariantResult.failures);
      for (const [relative, digest] of invariantResult.executedTests) executedInvariantTests.set(relative, digest);
      coverage.push({
        layer,
        status: invariantResult.failures.length === 0 ? 'complete' : 'unverified',
        manifest: invariantResult.manifest || null,
        manifest_sha256: invariantResult.manifest_sha256 || null,
        profile: classification.profile,
        base,
        head,
        consumed_tests: invariantResult.consumed
      });
      assertIntegrity(layer);
    } else {
      coverage.push({ layer, status: 'unverified' });
      unverified.push(`${layer}: --run-invariants was not enabled`);
    }
  }
  let suppressionDocument = null;
  if (args.suppressions) {
    const suppressionPath = path.resolve(root, args.suppressions);
    if (!isWithin(root, suppressionPath)) throw new Error('Suppressions must stay inside repository.');
    suppressionDocument = readJson(suppressionPath);
    const suppressionResult = validateSuppressions(suppressionDocument, root, new Date(), {
      executedTests: executedInvariantTests
    });
    if (!suppressionResult.valid) {
      unverified.push(...suppressionResult.errors.map((item) => `suppression: ${item}`));
      coverage.push({ layer: 'suppressions', status: 'invalid' });
      suppressionDocument = null;
    } else {
      coverage.push({ layer: 'suppressions', status: 'complete' });
    }
  } else {
    coverage.push({ layer: 'suppressions', status: 'not_configured' });
  }
  const normalizedFindings = deduplicateFindings(findings);
  if (normalizedFindings.collisions.length > 0) {
    unverified.push(`finding identity collision detected (${normalizedFindings.collisions.length})`);
  }
  const applied = applySuppressions(normalizedFindings.findings, suppressionDocument);
  const boundedFindings = applied.active.slice(0, policy.report_max_findings);
  if (applied.active.length > boundedFindings.length) unverified.push('finding limit exceeded; report is incomplete');
  const requiredLayers = policy.profiles[classification.profile]?.required_layers || [];
  for (const required of requiredLayers) {
    const layer = coverage.find((item) => item.layer === required);
    if (!layer) {
      coverage.push({ layer: required, status: 'unverified' });
      unverified.push(`${required}: required layer is not implemented for this repository`);
      continue;
    }
    if (!['complete', 'not_applicable'].includes(layer.status)) {
      unverified.push(`${required}: required layer status is ${layer.status}`);
    }
  }
  assertIntegrity('report_sealing');
  let state = 'SECURITY_PASS';
  if (infrastructureFailures.length > 0) state = 'SECURITY_GATE_INFRA_BLOCKED';
  else if (unverified.length > 0 || !lockResult.valid) state = 'SECURITY_GATE_UNVERIFIED';
  else if (boundedFindings.length > 0) state = 'SECURITY_FINDINGS';
  const report = sanitisedReport(sealReport({
    schema_version: 3,
    gate_version: policy.policy_version,
    state,
    repository: authorityResult.valid ? authority.target_repository : repositoryIdentity(root),
    candidate_repository: authorityResult.valid ? authority.candidate_repository : null,
    mode,
    base,
    head,
    scanned_head_digest: scannedHeadDigest,
    scanned_tree_digest: candidateTreeDigest,
    scanned_manifest_digest: candidateManifestDigest,
    artifact_digest: artifactDigest,
    profile: classification.profile,
    trusted_authority: authorityResult.valid ? authority : null,
    path_identity: {
      contract: 'exact-git-path-case-v1',
      tracked_files: inventory.count,
      manifest_digest: candidateManifestDigest,
      case_fold_aliases: inventory.caseAliases
    },
    versions: { lock: lock.lock_version, rules: readJson(RULES_PATH).rules_version, tools: toolVersions },
    coverage,
    findings: boundedFindings,
    finding_duplicates: normalizedFindings.duplicates,
    suppressed_findings: applied.suppressed,
    unverified_areas: unverified,
    infrastructure_failures: infrastructureFailures,
    next_action: state === 'SECURITY_PASS'
      ? 'Preserve this exact-head evidence and obtain independent review when the risk packet requires it.'
      : 'Keep the pull request open; resolve findings or restore complete verified coverage, then rerun at the same exact head.'
  }));
  if (!REPORT_STATES.has(report.state)) throw new Error('Internal report state is invalid.');
  const outputs = writeReportFiles(report, args, root);
  process.stdout.write(`${JSON.stringify({ state: report.state, profile: report.profile, findings: report.findings.length, outputs })}\n`);
  return report.state === 'SECURITY_PASS' ? 0 : (report.state === 'SECURITY_FINDINGS' ? 1 : 2);
}

function riskClassification(changedFiles) {
  const sensitivePattern = /(^|\/)(?:auth|oauth|identity|session|authorization|tenan|workspace|admin|storage|database|api|route|webhook|upload|redirect|command|shell|process|filesystem|transaction|backup|credential|crypto|encrypt|security|deployment|infrastructure|workflow|dependency|package|lock)/i;
  const sensitiveExtensions = /\.(?:js|cjs|mjs|jsx|ts|tsx|py|go|rs|java|cs|php|rb|sh|ps1|yml|yaml|json|toml)$/i;
  const sensitive = changedFiles.filter((file) =>
    file.toLowerCase().startsWith('.github/workflows/') ||
    sensitivePattern.test(file) ||
    (sensitiveExtensions.test(file) && !/\.(?:md|txt)$/i.test(file))
  );
  return { required: sensitive.length > 0, sensitive };
}

function reviewPacketCommand(args) {
  const root = safeRepoRoot(args.repo || '.');
  const verified = verifyExactCheckout(root, String(args.base || ''), String(args.head || ''), true);
  const base = verified.base;
  const head = verified.head;
  const reportPath = path.resolve(root, args.report || 'security-reports/security-gate.json');
  const report = readJson(reportPath);
  const unsignedReport = { ...report };
  delete unsignedReport.report_digest;
  if (
    report.head !== head ||
    report.base !== base ||
    report.scanned_head_digest !== verified.scanned_head_digest ||
    report.scanned_tree_digest !== `git-sha1:${git(root, ['rev-parse', `${head}^{tree}`]).toLowerCase()}` ||
    report.report_digest !== `sha256:${sha256(`${JSON.stringify(unsignedReport)}\n`)}`
  ) {
    throw new Error('Review packet rejected: report exact-head evidence does not match.');
  }
  const authorityResult = validateTrustedAuthority(report.trusted_authority, head);
  if (!authorityResult.valid) {
    throw new Error('Review packet rejected: trusted gate authority is missing or invalid.');
  }
  if (report.state !== 'SECURITY_PASS') throw new Error('Review packet requires green deterministic evidence.');
  const policy = readJson(POLICY_PATH);
  const completeChangedFiles = gitPathList(root, [
    '-c', 'core.quotepath=false',
    'diff', '--name-only', '-z', '--diff-filter=ACMR', base, head
  ]);
  if (completeChangedFiles.length > policy.review_manifest_max_files) {
    throw new Error(`Review packet rejected: changed-file safety bound ${policy.review_manifest_max_files} exceeded.`);
  }
  const risk = riskClassification(completeChangedFiles);
  if (risk.sensitive.length > policy.review_packet_max_files) {
    throw new Error('Review packet rejected: complete security-sensitive file coverage cannot fit the packet.');
  }
  const sensitiveSet = new Set(risk.sensitive);
  const changedFiles = [
    ...risk.sensitive,
    ...completeChangedFiles.filter((item) => !sensitiveSet.has(item))
  ].slice(0, policy.review_packet_max_files);
  const diff = risk.sensitive.length === 0
    ? ''
    : git(root, ['-c', 'core.quotepath=false', 'diff', '--unified=0', '--no-color', base, head, '--', ...risk.sensitive]);
  const locations = [];
  let currentFile = null;
  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) currentFile = fileMatch[1];
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && currentFile) locations.push({ path: currentFile, start_line: Number(hunk[1]), line_count: Number(hunk[2] || 1) });
  }
  if (locations.length > policy.review_packet_max_locations) {
    throw new Error('Review packet rejected: complete security-sensitive location coverage cannot fit the packet.');
  }
  const packet = {
    schema_version: 3,
    repository: report.repository,
    candidate_repository: report.candidate_repository,
    base,
    head,
    scanned_head_digest: verified.scanned_head_digest,
    scanned_tree_digest: report.scanned_tree_digest,
    scanned_manifest_digest: report.scanned_manifest_digest,
    trusted_authority: report.trusted_authority,
    security_report_digest: report.report_digest,
    path_identity: report.path_identity,
    profile: report.profile,
    risk_review_required: risk.required,
    changed_files: changedFiles,
    changed_file_manifest: {
      total_count: completeChangedFiles.length,
      included_count: changedFiles.length,
      omitted_count: completeChangedFiles.length - changedFiles.length,
      sha256: sha256(JSON.stringify(completeChangedFiles))
    },
    sensitive_locations: locations,
    references: changedFiles.filter((file) => /\.(?:js|cjs|mjs|ts|tsx|py)$/.test(file)).map((file) => ({ path: file, reference: 'deterministic file-level caller/callee review required' })),
    scanner_summary: { state: report.state, versions: report.versions, coverage: report.coverage },
    invariant_evidence: report.coverage.filter((item) => /invariant/.test(item.layer)),
    unresolved_findings: report.findings,
    coverage_gaps: report.unverified_areas,
    supported_outcomes: [
      'AI_SECURITY_PASS',
      'AI_SECURITY_FINDINGS',
      'AI_SECURITY_INCOMPLETE',
      'AI_SECURITY_INFRA_BLOCKED'
    ]
  };
  const outputRoot = path.resolve(args['report-root'] || root);
  const output = path.resolve(outputRoot, args.output || 'security-review-packet.json');
  if (!isWithin(outputRoot, output)) throw new Error('Packet output must stay inside the operation-owned report root.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ risk_review_required: packet.risk_review_required, output: slash(path.relative(outputRoot, output)) })}\n`);
  return 0;
}

function invalidateReportCommand(args) {
  const reportPath = path.resolve(args.report || '');
  const reportRoot = path.resolve(args['report-root'] || path.dirname(reportPath));
  if (!isWithin(reportRoot, reportPath)) throw new Error('Report must stay inside the operation-owned report root.');
  const report = readJson(reportPath);
  const reason = String(args.reason || '').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z0-9 ._:/()-]{1,200}$/.test(reason)) throw new Error('Invalidation reason is missing or unsafe.');
  report.state = 'SECURITY_GATE_UNVERIFIED';
  report.unverified_areas = [...new Set([...(report.unverified_areas || []), reason])];
  report.next_action = 'Keep the pull request open and rerun the trusted gate at the current exact head.';
  const sealed = sanitisedReport(sealReport(report));
  fs.writeFileSync(reportPath, `${JSON.stringify(sealed, null, 2)}\n`, 'utf8');
  const markdownPath = path.join(path.dirname(reportPath), 'security-gate.md');
  if (isWithin(reportRoot, markdownPath)) fs.writeFileSync(markdownPath, markdownReport(sealed), 'utf8');
  process.stdout.write('SECURITY_GATE_UNVERIFIED: sealed evidence was invalidated.\n');
  return 2;
}

function selfTest() {
  const lock = validateToolLock();
  if (!lock.valid) throw new Error(`Lock self-test failed: ${lock.errors.join('; ')}`);
  const classificationFixtures = readJson(CLASSIFICATION_FIXTURES_PATH);
  for (const fixture of classificationFixtures.cases) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-classifier-'));
    try {
      for (const [relative, content] of Object.entries(fixture.files)) {
        const target = path.join(temporary, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
      }
      const actual = classifyRepository(temporary).profile;
      if (actual !== fixture.expected_profile) throw new Error(`${fixture.id}: expected ${fixture.expected_profile}, received ${actual}`);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const rules = readJson(RULES_PATH);
  const ruleFixtures = readJson(RULE_FIXTURES_PATH);
  for (const fixture of ruleFixtures.cases) {
    const rule = rules.rules.find((item) => item.id === fixture.rule);
    if (!rule) throw new Error(`${fixture.rule}: rule is missing`);
    const expression = new RegExp(rule.pattern, 'i');
    if (!expression.test(fixture.malicious)) throw new Error(`${fixture.rule}: malicious fixture did not match`);
    if (expression.test(fixture.clean)) throw new Error(`${fixture.rule}: clean fixture matched`);
  }
  process.stdout.write(`OK: ${classificationFixtures.cases.length} classification cases, ${ruleFixtures.cases.length} rule cases, and tool lock validated.\n`);
  return 0;
}

function usage() {
  return [
    'Usage:',
    '  node security-gate.cjs classify --repo <path>',
    '  node security-gate.cjs validate-lock',
    '  node security-gate.cjs validate-suppressions --repo <path> --file <path> --run-invariants [--invariant-manifest <path>]',
    '  node security-gate.cjs self-test',
    '  node security-gate.cjs scan --mode <pr|full|scheduled|release> --repo <path> [--base <sha> --head <sha>] [--tools-dir <path>] [--run-invariants]',
    '  node security-gate.cjs review-packet --repo <path> --base <sha> --head <sha> --report <path> [--output <path>]',
    '  node security-gate.cjs invalidate-report --report-root <path> --report <path> --reason <bounded reason>'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || command === 'help' || args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (command === 'classify') {
    const root = safeRepoRoot(args.repo || '.');
    process.stdout.write(`${JSON.stringify(classifyRepository(root), null, 2)}\n`);
    return 0;
  }
  if (command === 'validate-lock') {
    const result = validateToolLock();
    if (!result.valid) throw new Error(result.errors.join('; '));
    process.stdout.write('OK: tool provenance lock is valid and fresh.\n');
    return 0;
  }
  if (command === 'validate-suppressions') {
    const root = safeRepoRoot(args.repo || '.');
    const file = path.resolve(root, args.file || '');
    if (!isWithin(root, file)) throw new Error('Suppression path must stay inside repository.');
    if (!args['run-invariants']) {
      throw new Error('Suppression validation requires --run-invariants evidence.');
    }
    const classification = classifyRepository(root);
    const executedTests = new Map();
    let invariantResult = null;
    if (classification.profile === PROFILE_TOOLING && fs.existsSync(path.join(root, 'repo', 'tests'))) {
      invariantResult = runInvariants(root, 'full', null, null);
    } else if ([PROFILE_WEB, PROFILE_WORKFLOW].includes(classification.profile)) {
      invariantResult = runConsumerInvariants(
        root,
        classification.profile,
        args['invariant-manifest'] || readJson(POLICY_PATH).consumer_invariant_manifest,
        'full',
        null,
        null
      );
    }
    if (!invariantResult) throw new Error('No supported invariant evidence is available for suppression validation.');
    if (invariantResult.failures.length > 0 || invariantResult.findings.length > 0) {
      throw new Error('Invariant evidence did not pass; suppressions cannot be validated.');
    }
    for (const [relative, digest] of invariantResult.executedTests) executedTests.set(relative, digest);
    const result = validateSuppressions(readJson(file), root, new Date(), { executedTests });
    if (!result.valid) throw new Error(result.errors.join('; '));
    process.stdout.write('OK: suppressions are exact, current, and source-bound.\n');
    return 0;
  }
  if (command === 'self-test') return selfTest();
  if (command === 'scan') return scanCommand(args);
  if (command === 'review-packet') return reviewPacketCommand(args);
  if (command === 'invalidate-report') return invalidateReportCommand(args);
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`SECURITY_GATE_UNVERIFIED: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  applySuppressions,
  canonicalFindingPayload,
  canonicalGitPath,
  classifyRepository,
  compareRepositoryIntegrity,
  deduplicateFindings,
  enforcementControlChanges,
  genericJsonFindings,
  main,
  resolveScannerPath,
  riskClassification,
  runAdapter,
  runConsumerInvariants,
  scanToolkitRules,
  shellDescriptor,
  shellInventory,
  stableFinding,
  trackedPathInventory,
  validateTrustedAuthority,
  validateSuppressions,
  validateToolLock
};
