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
      if (/^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:node|python|bash|sh|pwsh|powershell)/i.test(text)) {
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

function validateSuppressions(document, root, today = new Date()) {
  const errors = [];
  const policy = readJson(POLICY_PATH);
  const lock = readJson(TOOL_LOCK_PATH);
  const rulesVersion = readJson(RULES_PATH).rules_version;
  if (!document || document.schema_version !== 1 || !Array.isArray(document.suppressions)) {
    return { valid: false, errors: ['suppression document must use schema_version 1 and an array'] };
  }
  const ids = new Set();
  for (const item of document.suppressions) {
    const prefix = item && item.id ? item.id : '<unknown>';
    const required = [
      'id', 'tool', 'rule', 'finding_identity', 'path', 'scope',
      'exploitability_rationale', 'approver_reference', 'introduction_commit',
      'expires', 'compensating_test', 'tool_version', 'rule_version', 'source_sha256'
    ];
    for (const field of required) {
      if (item == null || typeof item[field] !== 'string' || !item[field].trim()) {
        errors.push(`${prefix}: ${field} is required`);
      }
    }
    if (!item) continue;
    if (ids.has(item.id)) errors.push(`${prefix}: duplicate id`);
    ids.add(item.id);
    if (/[*?]/.test(item.path || '') || path.isAbsolute(item.path || '') || String(item.path || '').split(/[\\/]/).includes('..')) {
      errors.push(`${prefix}: wildcard, absolute, or traversal path is forbidden`);
    }
    if (!['exact_path', 'exact_line', 'synthetic_fixture'].includes(item.scope)) {
      errors.push(`${prefix}: scope must be exact`);
    }
    if (!SHA64.test(item.finding_identity || '') || !SHA64.test(item.source_sha256 || '')) {
      errors.push(`${prefix}: finding and source digests must be SHA-256`);
    }
    if (!SHA40.test(item.introduction_commit || '')) errors.push(`${prefix}: introduction_commit must be exact`);
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
    const full = path.resolve(root, item.path || '');
    if (isWithin(root, full) && fs.existsSync(full) && fs.lstatSync(full).isFile()) {
      if (sourceBindingDigest(full) !== item.source_sha256) errors.push(`${prefix}: source binding changed`);
    } else {
      errors.push(`${prefix}: suppression path is missing or outside repository`);
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

function stableFinding(tool, rule, relativePath, line, message) {
  const normalizedPath = slash(relativePath).replace(/^\.?\//, '');
  const normalizedMessage = String(message).replace(/\s+/g, ' ').trim().slice(0, 240);
  const identity = sha256([tool, rule, normalizedPath.toLowerCase(), String(line || 0), normalizedMessage].join('\n'));
  return { identity, tool, rule, path: normalizedPath, line: Number(line || 0), message: normalizedMessage };
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
    const text = smallText(file);
    if (!text) continue;
    const lines = text.split('\n');
    for (const rule of rulesDocument.rules) {
      if (!rule.extensions.includes(extension)) continue;
      const expression = new RegExp(rule.pattern, 'i');
      for (let index = 0; index < lines.length; index += 1) {
        if (!expression.test(lines[index])) continue;
        findings.push({
          ...stableFinding('toolkit-rules', rule.id, file.relative, index + 1, rule.message),
          severity: rule.severity,
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
    maxBuffer: OUTPUT_LIMIT
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

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function relativeScannerPath(root, value) {
  if (typeof value !== 'string' || !value.trim()) return '(repository)';
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (!isWithin(root, absolute)) return '(outside-repository-redacted)';
  return slash(path.relative(root, absolute)) || '(repository)';
}

function genericJsonFindings(tool, root, parsed) {
  const findings = [];
  function add(rule, severity, filePath, line, message) {
    findings.push({
      ...stableFinding(tool, String(rule || 'finding'), relativeScannerPath(root, filePath), line, message || `${tool} finding`),
      severity: String(severity || 'MEDIUM').toUpperCase()
    });
  }
  if (tool === 'trivy') {
    for (const result of parsed.Results || []) {
      for (const item of result.Vulnerabilities || []) add(item.VulnerabilityID, item.Severity, result.Target, 0, 'Dependency vulnerability');
      for (const item of result.Misconfigurations || []) add(item.ID, item.Severity, result.Target, item.CauseMetadata?.StartLine || 0, 'Configuration weakness');
      for (const item of result.Secrets || []) add(item.RuleID, item.Severity || 'HIGH', result.Target, item.StartLine || 0, 'Potential secret material');
    }
  } else if (tool === 'osv-scanner') {
    for (const result of parsed.results || []) {
      for (const pkg of result.packages || []) {
        for (const vulnerability of pkg.vulnerabilities || []) add(vulnerability.id, 'HIGH', result.source?.path, 0, 'Dependency vulnerability');
      }
    }
  } else if (tool === 'zizmor') {
    for (const audit of Array.isArray(parsed) ? parsed : []) {
      for (const location of audit.locations || []) {
        const filePath = location.symbolic?.key?.Local?.verbatim_path;
        const row = location.concrete?.location?.start_point?.row;
        add(audit.ident, audit.determinations?.severity || 'MEDIUM', filePath, Number.isInteger(row) ? row + 1 : 0, 'zizmor finding');
      }
    }
  } else {
    const list = Array.isArray(parsed) ? parsed : (parsed.findings || parsed.results || parsed.diagnostics || []);
    for (const item of list) {
      add(
        item.rule || item.rule_id || item.RuleID || item.ident || item.kind || item.code || item.id,
        item.severity || item.level || 'MEDIUM',
        item.path || item.file || item.File || item.filepath || item.filename || item.location?.path,
        item.line || item.StartLine || item.line_number || item.location?.line || 0,
        `${tool} finding`
      );
    }
  }
  return findings;
}

function runAdapter(name, root, toolsDir, files) {
  const executable = toolExecutable(toolsDir, name);
  if (name !== 'psscriptanalyzer' && !fs.existsSync(executable)) {
    return { status: 'missing', findings: [], failure: `${name}: verified binary is missing` };
  }
  let result;
  let parsed;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-gate-'));
  try {
    if (name === 'trivy') {
      result = run(executable, ['fs', '--format', 'json', '--scanners', 'vuln,secret,misconfig', '--exit-code', '0', root], { cwd: root });
      if (result.error || result.status !== 0) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'osv-scanner') {
      result = run(executable, ['scan', 'source', '-r', root, '--format', 'json'], { cwd: root });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'zizmor') {
      result = run(executable, ['--format=json', path.join(root, '.github', 'workflows')], { cwd: root });
      // zizmor uses exit 14 when audits found reportable results.
      if (result.error || ![0, 1, 14].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'actionlint') {
      result = run(executable, ['-format', '{{json .}}'], { cwd: root });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      parsed = lines.map((line) => parseJson(line, name));
    } else if (name === 'shellcheck') {
      const shellFiles = files.filter((file) => ['.sh', '.bash'].includes(path.extname(file.relative).toLowerCase()));
      if (shellFiles.length === 0) return { status: 'not_applicable', findings: [] };
      result = run(executable, ['--format=json', '--severity=warning', ...shellFiles.map((file) => file.full)], { cwd: root });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = parseJson(result.stdout, name);
    } else if (name === 'psscriptanalyzer') {
      const psFiles = files.filter((file) => ['.ps1', '.psm1', '.psd1'].includes(path.extname(file.relative).toLowerCase()));
      if (psFiles.length === 0) return { status: 'not_applicable', findings: [] };
      const modulePath = path.join(path.resolve(toolsDir), 'PSScriptAnalyzer', 'PSScriptAnalyzer.psd1');
      if (!fs.existsSync(modulePath)) return { status: 'missing', findings: [], failure: 'psscriptanalyzer: verified module is missing' };
      const command = [
        `$items = @(${psFiles.map((file) => `'${file.full.replace(/'/g, "''")}'`).join(',')})`,
        `Import-Module '${modulePath.replace(/'/g, "''")}' -Force`,
        '$results = foreach ($item in $items) { Invoke-ScriptAnalyzer -Path $item -Recurse:$false }',
        '$results | Select-Object RuleName,Severity,ScriptPath,Line | ConvertTo-Json -Depth 4 -Compress'
      ].join('; ');
      result = run('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: root });
      if (result.error || result.status !== 0) throw new Error(result.error || `exit ${result.status}`);
      parsed = result.stdout.trim() ? parseJson(result.stdout, name) : [];
      if (!Array.isArray(parsed)) parsed = [parsed];
      parsed = parsed.map((item) => ({ rule: item.RuleName, severity: item.Severity, path: item.ScriptPath, line: item.Line }));
    } else if (name === 'gitleaks-cli') {
      const reportPath = path.join(temporary, 'gitleaks.json');
      result = run(executable, ['dir', root, '--no-banner', '--redact', '--report-format', 'json', '--report-path', reportPath], { cwd: root });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error || `exit ${result.status}`);
      parsed = fs.existsSync(reportPath) ? readJson(reportPath) : [];
    } else {
      return { status: 'invalid', findings: [], failure: `${name}: adapter is not implemented` };
    }
    return { status: 'complete', findings: genericJsonFindings(name, root, parsed) };
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

function runInvariants(root, mode, base, head) {
  const document = readJson(INVARIANTS_PATH);
  const findings = [];
  const failures = [];
  const consumed = [];
  const seen = new Set();
  for (const evidence of document.evidence) {
    for (const relative of evidence.tests) {
      if (seen.has(relative)) continue;
      seen.add(relative);
      const full = path.join(root, relative);
      if (!fs.existsSync(full)) {
        failures.push(`${evidence.id}: missing ${relative}`);
        continue;
      }
      const result = run(process.execPath, ['--test', relative], { cwd: root });
      consumed.push(relative);
      if (result.error || result.status !== 0) {
        findings.push({
          ...stableFinding('toolkit-invariants', evidence.id, relative, 0, 'Security invariant test failed'),
          severity: 'HIGH'
        });
      }
    }
  }
  return { findings, failures, consumed, mode, base, head };
}

function scannerApplicability(name, classification, files) {
  const hasActions = files.some((file) => file.relative.toLowerCase().startsWith('.github/workflows/'));
  const hasManifest = files.some((file) => manifestNames.has(path.basename(file.relative).toLowerCase()));
  const hasDependencyLock = files.some((file) => dependencyLockNames.has(path.basename(file.relative).toLowerCase()));
  const hasIac = files.some((file) => deployNames.has(path.basename(file.relative).toLowerCase()) || path.extname(file.relative).toLowerCase() === '.tf');
  if (['actionlint', 'zizmor'].includes(name)) return hasActions;
  if (name === 'shellcheck') return files.some((file) => ['.sh', '.bash'].includes(path.extname(file.relative).toLowerCase()));
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
    `- Mode: \`${report.mode}\``,
    `- Base: \`${report.base || 'not_applicable'}\``,
    `- Head: \`${report.head || 'not_applicable'}\``,
    `- Artifact digest: \`${report.artifact_digest || 'not_applicable'}\``,
    `- Profile: \`${report.profile}\``,
    '',
    '## Coverage',
    ''
  ];
  for (const item of report.coverage) lines.push(`- \`${item.layer}\`: ${item.status}`);
  lines.push('', '## Findings', '');
  if (report.findings.length === 0) lines.push('No unsuppressed findings.');
  for (const finding of report.findings) {
    lines.push(`- \`${finding.severity}\` \`${finding.tool}/${finding.rule}\` at \`${finding.path}:${finding.line}\` (${finding.identity})`);
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
  const jsonPath = path.resolve(root, args['report-json'] || 'security-reports/security-gate.json');
  const markdownPath = path.resolve(root, args['report-md'] || 'security-reports/security-gate.md');
  for (const target of [jsonPath, markdownPath]) {
    if (!isWithin(root, target)) throw new Error('Report output must stay inside the repository.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdownReport(report), 'utf8');
  return { json: slash(path.relative(root, jsonPath)), markdown: slash(path.relative(root, markdownPath)) };
}

function scanCommand(args) {
  const root = safeRepoRoot(args.repo || '.');
  const policy = readJson(POLICY_PATH);
  const mode = String(args.mode || '');
  if (!policy.allowed_modes.includes(mode)) throw new Error(`Mode must be one of: ${policy.allowed_modes.join(', ')}`);
  const files = walkRepository(root);
  const classification = classifyRepository(root, files);
  const head = args.head || (mode === 'pr' || mode === 'release' ? git(root, ['rev-parse', 'HEAD']) : null);
  const base = args.base || null;
  if (mode === 'pr' && (!SHA40.test(base || '') || !SHA40.test(head || ''))) {
    throw new Error('PR mode requires exact --base and --head commits.');
  }
  if (mode === 'release' && !SHA40.test(head || '')) throw new Error('Release mode requires exact --head.');
  if (mode === 'release' && git(root, ['rev-parse', 'HEAD']) !== head) throw new Error('Release head is stale.');
  const artifactDigest = args['artifact-digest'] || null;
  if (artifactDigest && !/^sha256:[0-9a-f]{64}$/i.test(artifactDigest)) throw new Error('Artifact digest must be sha256:<64 hex>.');
  const lock = readJson(TOOL_LOCK_PATH);
  const lockResult = validateToolLock(lock);
  const coverage = [{ layer: 'repository_classification', status: 'complete' }];
  const unverified = [];
  const infrastructureFailures = [];
  let findings = [];
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
      git(root, ['diff', '--name-only', '--diff-filter=ACMR', base, head])
        .split(/\r?\n/).filter(Boolean).map((item) => slash(item).toLowerCase())
    );
    const critical = policy.security_critical_paths.some((prefix) =>
      [...changed].some((item) => item.startsWith(prefix.toLowerCase()))
    );
    ruleFiles = critical ? files : files.filter((file) => changed.has(file.relative.toLowerCase()));
    coverage.push({
      layer: 'pr_scope',
      status: 'complete',
      changed_files: changed.size,
      security_critical_full_expansion: critical
    });
  }
  if (!lockResult.valid) {
    coverage.push({ layer: 'tool_lock', status: 'invalid' });
    unverified.push(...lockResult.errors.map((item) => `tool lock: ${item}`));
  } else {
    coverage.push({ layer: 'tool_lock', status: 'complete' });
  }
  if (classification.profile === PROFILE_EXEMPT) {
    const report = sanitisedReport({
      schema_version: 1,
      state: PROFILE_EXEMPT,
      repository: repositoryIdentity(root),
      mode,
      base,
      head,
      artifact_digest: artifactDigest,
      profile: classification.profile,
      versions: { lock: lock.lock_version, rules: readJson(RULES_PATH).rules_version, tools: [] },
      coverage,
      findings: [],
      suppressed_findings: [],
      unverified_areas: [],
      infrastructure_failures: [],
      next_action: 'No executable repository surface was detected. Reclassify if content changes.'
    });
    const outputs = writeReportFiles(report, args, root);
    process.stdout.write(`${JSON.stringify({ state: report.state, profile: report.profile, outputs })}\n`);
    return 0;
  }
  findings.push(...scanToolkitRules(root, ruleFiles));
  coverage.push({ layer: 'toolkit_rules', status: 'complete' });
  const toolsDir = args['tools-dir'] || path.join(root, '.security-tools');
  const externalEnabled = !args['internal-only'];
  const toolVersions = [];
  const scannerNames = ['trivy', 'osv-scanner', 'zizmor', 'actionlint', 'shellcheck', 'psscriptanalyzer', 'gitleaks-cli'];
  for (const name of scannerNames) {
    if (!scannerApplicability(name, classification, files)) {
      coverage.push({ layer: name, status: 'not_applicable' });
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
    const result = runAdapter(name, root, toolsDir, files);
    coverage.push({ layer: name, status: result.status });
    findings.push(...result.findings);
    if (result.failure) {
      infrastructureFailures.push(result.failure);
      unverified.push(`${name}: required scanner did not complete`);
    }
  }
  const requiresToolkitInvariants = classification.profile === PROFILE_TOOLING && fs.existsSync(path.join(root, 'repo', 'tests'));
  if (requiresToolkitInvariants) {
    if (args['run-invariants']) {
      const invariantResult = runInvariants(root, mode, base, head);
      findings.push(...invariantResult.findings);
      unverified.push(...invariantResult.failures);
      coverage.push({
        layer: 'toolkit_invariants',
        status: invariantResult.failures.length === 0 && invariantResult.findings.length === 0 ? 'complete' : 'findings',
        consumed_tests: invariantResult.consumed
      });
    } else {
      coverage.push({ layer: 'toolkit_invariants', status: 'unverified' });
      unverified.push('toolkit_invariants: --run-invariants was not enabled');
    }
  }
  let suppressionDocument = null;
  if (args.suppressions) {
    const suppressionPath = path.resolve(root, args.suppressions);
    if (!isWithin(root, suppressionPath)) throw new Error('Suppressions must stay inside repository.');
    suppressionDocument = readJson(suppressionPath);
    const suppressionResult = validateSuppressions(suppressionDocument, root);
    if (!suppressionResult.valid) {
      unverified.push(...suppressionResult.errors.map((item) => `suppression: ${item}`));
      coverage.push({ layer: 'suppressions', status: 'invalid' });
    } else {
      coverage.push({ layer: 'suppressions', status: 'complete' });
    }
  } else {
    coverage.push({ layer: 'suppressions', status: 'not_configured' });
  }
  const applied = applySuppressions(findings, suppressionDocument);
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
  let state = 'SECURITY_PASS';
  if (infrastructureFailures.length > 0) state = 'SECURITY_GATE_INFRA_BLOCKED';
  else if (unverified.length > 0 || !lockResult.valid) state = 'SECURITY_GATE_UNVERIFIED';
  else if (boundedFindings.length > 0) state = 'SECURITY_FINDINGS';
  const report = sanitisedReport({
    schema_version: 1,
    state,
    repository: repositoryIdentity(root),
    mode,
    base,
    head,
    artifact_digest: artifactDigest,
    profile: classification.profile,
    versions: { lock: lock.lock_version, rules: readJson(RULES_PATH).rules_version, tools: toolVersions },
    coverage,
    findings: boundedFindings,
    suppressed_findings: applied.suppressed,
    unverified_areas: unverified,
    infrastructure_failures: infrastructureFailures,
    next_action: state === 'SECURITY_PASS'
      ? 'Preserve this exact-head evidence and obtain independent review when the risk packet requires it.'
      : 'Keep the pull request open; resolve findings or restore complete verified coverage, then rerun at the same exact head.'
  });
  if (!REPORT_STATES.has(report.state)) throw new Error('Internal report state is invalid.');
  const outputs = writeReportFiles(report, args, root);
  process.stdout.write(`${JSON.stringify({ state: report.state, profile: report.profile, findings: report.findings.length, outputs })}\n`);
  return report.state === 'SECURITY_PASS' ? 0 : (report.state === 'SECURITY_FINDINGS' ? 1 : 2);
}

function riskClassification(changedFiles) {
  const sensitivePattern = /(^|\/)(?:auth|oauth|identity|session|authorization|tenan|workspace|admin|storage|database|api|route|webhook|upload|redirect|command|shell|process|filesystem|transaction|backup|credential|crypto|encrypt|security|deployment|infrastructure|workflow|dependency|package|lock)/i;
  const sensitiveExtensions = /\.(?:js|cjs|mjs|jsx|ts|tsx|py|go|rs|java|cs|php|rb|sh|ps1|yml|yaml|json|toml)$/i;
  const sensitive = changedFiles.filter((file) =>
    file.startsWith('.github/workflows/') ||
    sensitivePattern.test(file) ||
    (sensitiveExtensions.test(file) && !/\.(?:md|txt)$/i.test(file))
  );
  return { required: sensitive.length > 0, sensitive };
}

function reviewPacketCommand(args) {
  const root = safeRepoRoot(args.repo || '.');
  const base = String(args.base || '');
  const head = String(args.head || '');
  if (!SHA40.test(base) || !SHA40.test(head)) throw new Error('review-packet requires exact --base and --head.');
  if (git(root, ['rev-parse', 'HEAD']) !== head) throw new Error('Review packet rejected: head is stale.');
  const reportPath = path.resolve(root, args.report || 'security-reports/security-gate.json');
  if (!isWithin(root, reportPath)) throw new Error('Report path must stay inside repository.');
  const report = readJson(reportPath);
  if (report.head !== head || report.base !== base) throw new Error('Review packet rejected: report base/head do not match.');
  if (report.state !== 'SECURITY_PASS') throw new Error('Review packet requires green deterministic evidence.');
  const policy = readJson(POLICY_PATH);
  const changedFiles = git(root, ['diff', '--name-only', '--diff-filter=ACMR', base, head])
    .split(/\r?\n/).filter(Boolean).map(slash).slice(0, policy.review_packet_max_files);
  const risk = riskClassification(changedFiles);
  const diff = git(root, ['diff', '--unified=0', '--no-color', base, head, '--', ...risk.sensitive]);
  const locations = [];
  let currentFile = null;
  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) currentFile = fileMatch[1];
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && currentFile) locations.push({ path: currentFile, start_line: Number(hunk[1]), line_count: Number(hunk[2] || 1) });
  }
  const packet = {
    schema_version: 1,
    base,
    head,
    profile: report.profile,
    risk_review_required: risk.required,
    changed_files: changedFiles,
    sensitive_locations: locations.slice(0, policy.review_packet_max_locations),
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
  const output = path.resolve(root, args.output || 'security-reports/security-review-packet.json');
  if (!isWithin(root, output)) throw new Error('Packet output must stay inside repository.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ risk_review_required: packet.risk_review_required, output: slash(path.relative(root, output)) })}\n`);
  return 0;
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
    '  node security-gate.cjs validate-suppressions --repo <path> --file <path>',
    '  node security-gate.cjs self-test',
    '  node security-gate.cjs scan --mode <pr|full|scheduled|release> --repo <path> [--base <sha> --head <sha>] [--tools-dir <path>] [--run-invariants]',
    '  node security-gate.cjs review-packet --repo <path> --base <sha> --head <sha> --report <path> [--output <path>]'
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
    const result = validateSuppressions(readJson(file), root);
    if (!result.valid) throw new Error(result.errors.join('; '));
    process.stdout.write('OK: suppressions are exact, current, and source-bound.\n');
    return 0;
  }
  if (command === 'self-test') return selfTest();
  if (command === 'scan') return scanCommand(args);
  if (command === 'review-packet') return reviewPacketCommand(args);
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
  classifyRepository,
  main,
  riskClassification,
  scanToolkitRules,
  stableFinding,
  validateSuppressions,
  validateToolLock
};
