'use strict';

// Dependency and security settings for a Toolkit-governed (ENABLED) github.com repository, and the
// guarded auto-merge of Dependabot updates:
//
//   S1 Dependabot alerts on.
//   S2 Dependabot security updates on.
//   S3 .github/dependabot.yml has a version-update entry for every package ecosystem found in the
//      repository (npm, pip, GitHub Actions, Docker, Go, Cargo, Bundler, Composer).
//   S4 secret scanning and push protection on (public repositories; on a private repository they
//      need a paid GitHub plan, so they are reported as not on this plan, never as drift).
//   S5 CodeQL code scanning default setup configured (public repositories; private as S4).
//   S6 private vulnerability reporting on (public repositories only).
//   S8 on a private repository, the programme binding records the owner's answer on GitHub's paid
//      security features (`paid_security`: "off" or "on"). With "on", S4 and S5 are required there.
//   S7 auto-merge matches the programme binding's `dependency_updates.auto_merge`. With
//      "patch-minor": the auto-merge workflow is present and current, the repository allows
//      auto-merge, and default-branch protection (toolkit-governance-protection.cjs) is conformant
//      with at least one required check. With "off" (the default) nothing more is needed: the
//      workflow, if present, does nothing.
//
// S1, S2, S4-S7 ask GitHub through the signed-in `gh` CLI; S3 and the workflow file are read from the
// checkout. `--offline` checks only those files. Nothing here writes, except `applySecurity` (through
// `ghSecurityWriter` and `writeSecurityFiles`), which `toolkit governance security` and `migrate` call
// for an ENABLED repository: the owner's yes to governance covers the free settings, and the
// binding's `paid_security: "on"` covers the paid ones. Toolkit never edits a dependabot.yml or
// workflow it did not write: when one exists and differs, it reports what to change by hand.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const governance = require('./toolkit-governance-state.cjs');

const GH_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_TEMPLATE_REL = 'skills/secure-ci-cd/templates/github-actions/dependency-auto-merge.yml';
const WORKFLOW_REL = '.github/workflows/dependency-auto-merge.yml';
const DEPENDABOT_REL = '.github/dependabot.yml';
const WORKFLOW_MARKER = '# Toolkit dependency auto-merge v';
const AUTO_MERGE_VALUES = Object.freeze(['off', 'patch-minor']);
const ACTIONS_VALUES = Object.freeze(['auto-merge', 'owner']);
const PAID_VALUES = Object.freeze(['off', 'on']);
// Version updates wait this many days after a release (security updates never wait). GitHub
// Actions wait longer: an action runs with the workflow's token, so a bad release costs more.
const COOLDOWN_DAYS = Object.freeze({ default: 3, 'github-actions': 7 });

// Manifest file names per Dependabot ecosystem. GitHub Actions is found from .github/workflows.
const ECOSYSTEM_FILES = Object.freeze({
  npm: ['package.json'],
  pip: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'],
  docker: ['Dockerfile'],
  gomod: ['go.mod'],
  cargo: ['Cargo.toml'],
  bundler: ['Gemfile'],
  composer: ['composer.json'],
});
const SKIP_DIRECTORIES = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'venv', '__pycache__']);

// ---- files (S3, the workflow) -------------------------------------------------------------------

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function readSmall(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

// Map(ecosystem -> sorted Dependabot directories such as "/" or "/webapp"), from the repository
// root and the folders directly inside it (hidden and build folders skipped).
function detectEcosystems(root) {
  const found = new Map();
  const add = (ecosystem, directory) => {
    if (!found.has(ecosystem)) found.set(ecosystem, new Set());
    found.get(ecosystem).add(directory);
  };
  const scan = (folder, directory) => {
    for (const [ecosystem, names] of Object.entries(ECOSYSTEM_FILES)) {
      if (names.some(name => isFile(path.join(folder, name)))) add(ecosystem, directory);
    }
  };
  scan(root, '/');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
    scan(path.join(root, entry.name), `/${entry.name}`);
  }
  try {
    if (fs.readdirSync(path.join(root, '.github', 'workflows')).some(name => /\.ya?ml$/i.test(name))) add('github-actions', '/');
  } catch { /* no workflows */ }
  return new Map([...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ecosystem, dirs]) => [ecosystem, [...dirs].sort()]));
}

function unquote(value) {
  const text = String(value).trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))) return text.slice(1, -1);
  return text;
}

// Map(ecosystem -> [directories]) from a dependabot.yml, or null when it is missing or unreadable.
// It reads the plain block style GitHub's examples use; inline lists are understood too.
function readDependabotConfig(root) {
  const text = readSmall(path.join(root, ...DEPENDABOT_REL.split('/')));
  if (text === null) return null;
  const entries = new Map();
  let current = null;
  let inDirectories = false;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const ecosystem = /^\s*-?\s*package-ecosystem:\s*(.+)$/.exec(line);
    if (ecosystem) {
      current = unquote(ecosystem[1]);
      if (!entries.has(current)) entries.set(current, []);
      inDirectories = false;
      continue;
    }
    if (!current) continue;
    const directory = /^\s*directory:\s*(.+)$/.exec(line);
    if (directory) { entries.get(current).push(unquote(directory[1])); inDirectories = false; continue; }
    const directories = /^\s*directories:\s*(.*)$/.exec(line);
    if (directories) {
      const inline = directories[1].trim();
      if (inline.startsWith('[')) {
        entries.get(current).push(...inline.slice(1, -1).split(',').map(unquote).filter(Boolean));
        inDirectories = false;
      } else inDirectories = true;
      continue;
    }
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (inDirectories && item && !item[1].includes(':')) { entries.get(current).push(unquote(item[1])); continue; }
    inDirectories = false;
  }
  return entries;
}

function directoryCovered(configured, directory) {
  const normalise = value => (value === '/' ? '/' : `/${String(value).replace(/^\/+|\/+$/g, '')}`);
  return configured.some(pattern => {
    const wanted = normalise(directory);
    const have = normalise(pattern);
    if (have === wanted || have === '/**' || have === '/*') return true;
    if (have.endsWith('/**')) return wanted.startsWith(have.slice(0, -2));
    return false;
  });
}

// [{ ecosystem, directory }] found in the repository but missing from `config`.
function uncoveredEcosystems(detected, config) {
  const missing = [];
  for (const [ecosystem, directories] of detected) {
    const configured = (config && config.get(ecosystem)) || [];
    for (const directory of directories) if (!directoryCovered(configured, directory)) missing.push({ ecosystem, directory });
  }
  return missing;
}

// The dependabot.yml Toolkit writes when a repository has none: weekly version updates for every
// detected ecosystem, a cooldown, and patch and minor updates grouped into one pull request per
// ecosystem (so a group is never a major update); majors arrive one per pull request.
function renderDependabotConfig(detected) {
  const lines = [
    '# Written by Toolkit governance: weekly Dependabot version updates for every package ecosystem',
    '# found in this repository. Security updates are separate, turned on in the repository settings,',
    '# and never wait for the cooldown.',
    'version: 2',
    'updates:',
  ];
  for (const [ecosystem, directories] of detected) {
    lines.push(`  - package-ecosystem: "${ecosystem}"`);
    if (directories.length === 1) lines.push(`    directory: "${directories[0]}"`);
    else lines.push('    directories:', ...directories.map(directory => `      - "${directory}"`));
    lines.push(
      '    schedule:',
      '      interval: "weekly"',
      '    cooldown:',
      `      default-days: ${COOLDOWN_DAYS[ecosystem] || COOLDOWN_DAYS.default}`,
      '    groups:',
      `      ${ecosystem}-patch-and-minor:`,
      '        update-types: ["patch", "minor"]',
    );
  }
  return `${lines.join('\n')}\n`;
}

function digest(text) {
  return crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

function workflowTemplate(toolkitRoot = ROOT) {
  return fs.readFileSync(path.join(toolkitRoot, ...WORKFLOW_TEMPLATE_REL.split('/')), 'utf8');
}

// 'current' | 'outdated' (Toolkit's, older) | 'foreign' (someone else's file at that path) | 'missing'.
function workflowState(root, toolkitRoot = ROOT) {
  const text = readSmall(path.join(root, ...WORKFLOW_REL.split('/')));
  if (text === null) return 'missing';
  let template;
  try { template = workflowTemplate(toolkitRoot); } catch { return 'foreign'; }
  if (digest(text) === digest(template)) return 'current';
  return text.startsWith(WORKFLOW_MARKER) ? 'outdated' : 'foreign';
}

// The binding's policy: { auto_merge, github_actions, paid_security }; defaults off, auto-merge and
// null (the owner has not answered the paid-features question yet).
function bindingPolicy(root) {
  const fallback = { auto_merge: 'off', github_actions: 'auto-merge', paid_security: null };
  const text = readSmall(path.join(root, '.github', 'toolkit-programme.json'));
  if (text === null) return fallback;
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    const value = parsed && parsed.dependency_updates && typeof parsed.dependency_updates === 'object' ? parsed.dependency_updates : {};
    return {
      auto_merge: AUTO_MERGE_VALUES.includes(value.auto_merge) ? value.auto_merge : 'off',
      github_actions: ACTIONS_VALUES.includes(value.github_actions) ? value.github_actions : 'auto-merge',
      paid_security: parsed && PAID_VALUES.includes(parsed.paid_security) ? parsed.paid_security : null,
    };
  } catch { return fallback; }
}

// ---- GitHub settings (S1, S2, S4-S7) ------------------------------------------------------------

function ghRun(args, spawn, input = null) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', ...args], {
      encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false,
      ...(input === null ? {} : { input }),
    });
  } catch {
    return { ok: false, reason: 'gh-unavailable' };
  }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) {
    const text = String(result.stderr || '') + String(result.stdout || '');
    if (/HTTP 404/.test(text)) return { ok: false, reason: 'not-found' };
    if (/HTTP 403/.test(text)) return { ok: false, reason: /advanced security|code security|secret protection|not available|upgrade/i.test(text) ? 'not-on-plan' : 'forbidden' };
    return { ok: false, reason: 'gh-request-failed' };
  }
  const stdout = String(result.stdout || '').trim();
  if (!stdout) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(stdout) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

function statusOf(section) {
  return section && typeof section.status === 'string' ? section.status : null;
}

// What GitHub says about `slug`: { ok, visibility, allow_auto_merge, alerts, security_updates,
// secret_scanning, push_protection, code_scanning, private_reporting } where each setting is
// 'enabled' | 'disabled' | 'not-on-plan' | 'unreadable', or { ok: false, reason }.
function ghSecurityReader(slug, { spawn = childProcess.spawnSync } = {}) {
  const repository = ghRun([`repos/${slug}`], spawn);
  if (!repository.ok) return repository;
  const value = repository.value || {};
  const visibility = value.private === true ? 'private' : value.visibility === 'internal' ? 'internal' : 'public';
  const analysis = value.security_and_analysis && typeof value.security_and_analysis === 'object' ? value.security_and_analysis : null;
  const fromAnalysis = key => {
    const status = analysis ? statusOf(analysis[key]) : null;
    if (status === 'enabled' || status === 'disabled') return status;
    return visibility === 'public' ? 'unreadable' : 'not-on-plan';
  };
  const alertsRead = ghRun([`repos/${slug}/vulnerability-alerts`, '--silent'], spawn);
  const alerts = alertsRead.ok ? 'enabled' : alertsRead.reason === 'not-found' ? 'disabled' : 'unreadable';
  const fixes = ghRun([`repos/${slug}/automated-security-fixes`], spawn);
  const securityUpdates = fixes.ok && fixes.value && typeof fixes.value.enabled === 'boolean'
    ? (fixes.value.enabled && fixes.value.paused !== true ? 'enabled' : 'disabled')
    : (statusOf(analysis && analysis.dependabot_security_updates) || 'unreadable');
  const codeRead = ghRun([`repos/${slug}/code-scanning/default-setup`], spawn);
  const codeScanning = codeRead.ok && codeRead.value
    ? (codeRead.value.state === 'configured' ? 'enabled' : 'disabled')
    : (visibility === 'public' ? 'unreadable' : 'not-on-plan');
  let privateReporting = 'not-on-plan';
  if (visibility === 'public') {
    const reporting = ghRun([`repos/${slug}/private-vulnerability-reporting`], spawn);
    privateReporting = reporting.ok && reporting.value && typeof reporting.value.enabled === 'boolean' ? (reporting.value.enabled ? 'enabled' : 'disabled') : 'unreadable';
  }
  return {
    ok: true,
    visibility,
    allow_auto_merge: value.allow_auto_merge === true,
    alerts,
    security_updates: securityUpdates,
    secret_scanning: fromAnalysis('secret_scanning'),
    push_protection: fromAnalysis('secret_scanning_push_protection'),
    code_scanning: codeScanning,
    private_reporting: privateReporting,
  };
}

// The settings writes for the fixes `plan` lists ({ alerts, security_updates, secret_scanning,
// code_scanning, private_reporting, allow_auto_merge }: true for each to turn on; `paid: true` on a
// private repository, where secret scanning needs GitHub Secret Protection and code scanning GitHub
// Code Security turned on first). Returns [{ setting, ok, reason }]; each write is tried once, never
// retried.
function ghSecurityWriter(slug, plan, { spawn = childProcess.spawnSync } = {}) {
  const results = [];
  const write = (setting, args, input = null) => {
    const outcome = ghRun(args, spawn, input);
    results.push({ setting, ok: outcome.ok, reason: outcome.ok ? null : outcome.reason });
  };
  if (plan.alerts) write('alerts', ['-X', 'PUT', `repos/${slug}/vulnerability-alerts`, '--silent']);
  if (plan.security_updates) write('security_updates', ['-X', 'PUT', `repos/${slug}/automated-security-fixes`, '--silent']);
  if (plan.secret_scanning) {
    const body = { security_and_analysis: {
      ...(plan.paid ? { secret_protection: { status: 'enabled' } } : {}),
      secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' },
    } };
    write('secret_scanning', ['-X', 'PATCH', `repos/${slug}`, '--input', '-'], JSON.stringify(body));
  }
  if (plan.code_scanning && plan.paid) write('code_security', ['-X', 'PATCH', `repos/${slug}`, '--input', '-'], JSON.stringify({ security_and_analysis: { code_security: { status: 'enabled' } } }));
  if (plan.allow_auto_merge) write('allow_auto_merge', ['-X', 'PATCH', `repos/${slug}`, '--input', '-'], JSON.stringify({ allow_auto_merge: true }));
  if (plan.code_scanning) write('code_scanning', ['-X', 'PATCH', `repos/${slug}/code-scanning/default-setup`, '--input', '-'], JSON.stringify({ state: 'configured' }));
  if (plan.private_reporting) write('private_reporting', ['-X', 'PUT', `repos/${slug}/private-vulnerability-reporting`, '--silent']);
  return results;
}

// Writes the files in `files` ({ dependabot: true, workflow: true }) only where nothing is at that
// path yet, or the workflow is Toolkit's own older copy. Returns [{ file, result }].
function writeSecurityFiles(root, files, { toolkitRoot = ROOT } = {}) {
  const results = [];
  const put = (rel, text) => {
    const file = path.join(root, ...rel.split('/'));
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      results.push({ file: rel, result: 'written' });
    } catch (error) {
      results.push({ file: rel, result: `failed (${error && error.code ? error.code : 'unexpected error'})` });
    }
  };
  if (files.dependabot && !isFile(path.join(root, ...DEPENDABOT_REL.split('/')))) put(DEPENDABOT_REL, renderDependabotConfig(detectEcosystems(root)));
  if (files.workflow && ['missing', 'outdated'].includes(workflowState(root, toolkitRoot))) put(WORKFLOW_REL, workflowTemplate(toolkitRoot));
  return results;
}

// Turns on what `result` (a dependencySecurity verdict) lists as fixes and writes its missing files,
// then reads back through `reread()`. { settings, files, still_off, result: 'applied' | 'nothing' |
// 'failed' }.
function applySecurity(root, result, { writer = ghSecurityWriter, fileWriter = writeSecurityFiles, reread = null } = {}) {
  const fixes = result.fixes || {};
  const wantSettings = Object.entries(fixes).some(([key, on]) => key !== 'paid' && on);
  const wantFiles = Boolean(result.files && (result.files.dependabot || result.files.workflow));
  if (!wantSettings && !wantFiles) return { settings: [], files: [], still_off: [], result: 'nothing' };
  let settings = [];
  if (wantSettings) {
    try { settings = writer(result.slug, fixes); } catch { settings = [{ setting: 'all', ok: false, reason: 'writer-failed' }]; }
  }
  let files = [];
  if (wantFiles) {
    try { files = fileWriter(root, result.files); } catch { files = [{ file: 'all', result: 'failed (writer-failed)' }]; }
  }
  const after = reread ? reread() : null;
  const stillOff = after && after.fixes ? Object.entries(after.fixes).filter(([key, on]) => key !== 'paid' && on && fixes[key]).map(([key]) => key) : [];
  const failed = settings.some(entry => !entry.ok) || files.some(entry => entry.result !== 'written') || stillOff.length > 0;
  return { settings, files, still_off: stillOff, result: failed ? 'failed' : 'applied' };
}

const SETTING_LABELS = Object.freeze({
  alerts: 'Dependabot alerts', security_updates: 'Dependabot security updates', secret_scanning: 'secret scanning and push protection',
  code_security: 'GitHub Code Security', code_scanning: 'CodeQL code scanning', private_reporting: 'private vulnerability reporting',
  allow_auto_merge: 'allow auto-merge', all: 'the settings',
});

// Plain lines saying what `applySecurity` did, and what is left to do by hand.
function describeOutcome(slug, root, result, outcome) {
  const lines = [];
  for (const entry of outcome.settings) lines.push(`- ${slug}: ${SETTING_LABELS[entry.setting] || entry.setting} ${entry.ok ? 'turned on' : `not turned on (${entry.reason})`}.`);
  for (const entry of outcome.files) lines.push(`- ${root}: ${entry.file} ${entry.result}${entry.result === 'written' ? '; commit it through a pull request' : ''}.`);
  if (outcome.still_off.length) lines.push(`- ${slug}: reading back still shows off: ${outcome.still_off.map(key => SETTING_LABELS[key] || key).join(', ')}.`);
  else if (outcome.result === 'applied') lines.push(`- ${slug}: read back.`);
  const byHand = [];
  if (result.checks.S3 && result.checks.S3.status === 'drift' && !(result.files && result.files.dependabot)) byHand.push(...result.checks.S3.details);
  if (result.checks.S7 && result.checks.S7.status === 'drift') byHand.push(...result.checks.S7.details.filter(detail => !detail.includes(WORKFLOW_REL) || result.workflow === 'foreign'));
  if (result.checks.S8 && result.checks.S8.status === 'drift') byHand.push(...result.checks.S8.details);
  for (const id of ['S4', 'S5']) if (result.checks[id] && result.checks[id].status === 'drift' && !(result.fixes && result.fixes[id === 'S4' ? 'secret_scanning' : 'code_scanning'])) byHand.push(...result.checks[id].details);
  if (byHand.length) lines.push(`${slug}: still to do (Toolkit never edits a file it did not write, and asks the owner about paid features):`, ...byHand.map(note => `  - ${note}`));
  return lines;
}

// ---- the verdict --------------------------------------------------------------------------------

function settingCheck(value, label) {
  if (value === 'enabled') return { status: 'ok', details: [] };
  if (value === 'disabled') return { status: 'drift', details: [`${label} is off`] };
  if (value === 'not-on-plan') return { status: 'not-on-plan', details: [`${label} needs a paid GitHub plan on a private repository`] };
  if (value === 'not-checked') return { status: 'not-checked', details: ['offline'] };
  return { status: 'unverified', details: [`${label} could not be read`] };
}

function verdict(status, reason, checks = {}, extra = {}) {
  return Object.freeze({ status, reason, checks: Object.freeze(checks), ...extra });
}

// { status: conformant | drift | unverified | not-applicable, reason, checks: { S1..S8 }, policy,
// missing_ecosystems, fixes } for the repository at `root`. Options: `offline`, `reader(slug)`
// (tests), `protectionResult` (the default-branch verdict, for S7), `toolkitRoot`.
function dependencySecurity(root, { offline = false, reader = ghSecurityReader, protectionResult = null, toolkitRoot = ROOT } = {}) {
  let identity;
  try { identity = governance.readIdentity(root); } catch { return verdict('unverified', 'identity-unreadable'); }
  const slug = identity.valid ? governance.remoteSlug(identity.remote) : null;
  if (!identity.valid || identity.remote.host !== 'github.com' || !slug) return verdict('not-applicable', 'not-a-github-repository');
  const policy = bindingPolicy(root);
  const detected = detectEcosystems(root);
  const config = readDependabotConfig(root);
  const missingEcosystems = uncoveredEcosystems(detected, config);
  const workflow = workflowState(root, toolkitRoot);
  let read = null;
  if (!offline) {
    try { read = reader(slug); } catch { read = { ok: false, reason: 'reader-failed' }; }
  }
  const online = read && read.ok === true;
  const value = key => (offline ? 'not-checked' : online ? read[key] : 'unreadable');
  const checks = {
    S1: settingCheck(value('alerts'), 'Dependabot alerts'),
    S2: settingCheck(value('security_updates'), 'Dependabot security updates'),
    S3: missingEcosystems.length === 0
      ? { status: 'ok', details: [] }
      : { status: 'drift', details: missingEcosystems.map(item => `${DEPENDABOT_REL} has no "${item.ecosystem}" entry for ${item.directory}`) },
  };
  const scanning = settingCheck(value('secret_scanning'), 'Secret scanning');
  const pushProtection = settingCheck(value('push_protection'), 'Push protection');
  const off = [scanning, pushProtection].filter(item => item.status === 'drift');
  checks.S4 = off.length ? { status: 'drift', details: off.flatMap(item => item.details) }
    : [scanning, pushProtection].find(item => item.status !== 'ok') || scanning;
  checks.S5 = settingCheck(value('code_scanning'), 'CodeQL code scanning');
  const isPrivate = Boolean(online && read.visibility !== 'public');
  if (isPrivate) {
    for (const id of ['S4', 'S5']) {
      if (policy.paid_security !== 'on') {
        if (checks[id].status === 'drift' || checks[id].status === 'not-on-plan') checks[id] = { status: 'not-applicable', details: [`a paid GitHub feature on a private repository; the binding ${policy.paid_security === 'off' ? 'keeps it off' : 'has no answer yet'}`] };
      } else if (checks[id].status === 'not-on-plan') {
        checks[id] = { status: 'drift', details: [`the binding turns GitHub's paid ${id === 'S4' ? 'Secret Protection' : 'Code Security'} on, but this account's plan does not offer it (it needs GitHub Team or Enterprise Cloud); buy it or set paid_security to off`] };
      }
    }
  }
  checks.S8 = isPrivate
    ? (policy.paid_security === null
      ? { status: 'drift', details: ['the programme binding has no paid_security answer: ask the owner whether to turn on GitHub\'s paid Secret Protection and Code Security for this private repository (billed per active committer; default off) and record "off" or "on"'] }
      : { status: 'ok', details: [] })
    : offline ? { status: 'not-checked', details: ['offline'] }
      : online ? { status: 'not-applicable', details: [] } : { status: 'unverified', details: ['the repository visibility could not be read'] };
  checks.S6 = online && read.visibility !== 'public'
    ? { status: 'not-applicable', details: ['private vulnerability reporting is for public repositories'] }
    : settingCheck(value('private_reporting'), 'Private vulnerability reporting');
  const s7 = [];
  let s7Status = 'ok';
  if (policy.auto_merge === 'patch-minor') {
    if (workflow !== 'current') s7.push(workflow === 'missing' ? `${WORKFLOW_REL} is missing` : workflow === 'outdated' ? `${WORKFLOW_REL} is an older Toolkit copy` : `${WORKFLOW_REL} is not Toolkit's file`);
    if (offline) s7Status = 'not-checked';
    else if (!online) s7Status = 'unverified';
    else if (!read.allow_auto_merge) s7.push('the repository does not allow auto-merge');
    const branch = protectionResult ? protectionResult.status : 'unverified';
    if (protectionResult && protectionResult.reason === 'binding-has-no-required-checks') s7.push('the binding names no required checks, so auto-merge could merge untested code');
    else if (['drift', 'not-enforceable', 'not-applicable'].includes(branch)) s7.push('the default branch is not protected the way auto-merge needs (see the default-branch protection findings)');
    else if (branch !== 'conformant' && s7Status === 'ok') s7Status = 'unverified';
    if (s7.length) s7Status = 'drift';
  }
  checks.S7 = { status: s7Status, details: s7.length ? s7 : s7Status === 'not-checked' ? ['offline'] : s7Status === 'unverified' ? ['the repository settings or default-branch protection could not be read'] : [] };
  const statuses = Object.values(checks).map(entry => entry.status);
  const status = statuses.includes('drift') ? 'drift'
    : statuses.every(item => ['ok', 'not-on-plan', 'not-applicable'].includes(item)) ? 'conformant' : 'unverified';
  // Free features always; on a private repository the paid ones only when the binding says on and
  // GitHub shows the setting (a plan without it has nothing to turn on).
  const wanted = online && (read.visibility === 'public' || policy.paid_security === 'on');
  const fixes = online ? {
    alerts: read.alerts === 'disabled',
    security_updates: read.security_updates === 'disabled',
    secret_scanning: Boolean(wanted) && (read.secret_scanning === 'disabled' || read.push_protection === 'disabled'),
    code_scanning: Boolean(wanted) && read.code_scanning === 'disabled',
    private_reporting: read.visibility === 'public' && read.private_reporting === 'disabled',
    allow_auto_merge: policy.auto_merge === 'patch-minor' && !read.allow_auto_merge && Boolean(protectionResult && protectionResult.status === 'conformant'),
    paid: read.visibility !== 'public',
  } : null;
  const files = {
    dependabot: config === null && detected.size > 0,
    workflow: policy.auto_merge === 'patch-minor' && ['missing', 'outdated'].includes(workflow),
  };
  return verdict(status, null, checks, { slug, policy, visibility: online ? read.visibility : null, missing_ecosystems: missingEcosystems, workflow, fixes, files });
}

module.exports = Object.freeze({
  WORKFLOW_REL,
  WORKFLOW_TEMPLATE_REL,
  DEPENDABOT_REL,
  COOLDOWN_DAYS,
  detectEcosystems,
  readDependabotConfig,
  uncoveredEcosystems,
  renderDependabotConfig,
  workflowState,
  bindingPolicy,
  ghSecurityReader,
  ghSecurityWriter,
  writeSecurityFiles,
  applySecurity,
  describeOutcome,
  dependencySecurity,
});
