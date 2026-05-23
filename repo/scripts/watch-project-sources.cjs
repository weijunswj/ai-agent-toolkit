#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  isActiveThirdPartyAttributionLock,
  isRetiredMigrationLock
} = require('./audit-project-source-locks.cjs');

const root = process.cwd();
const projectRoot = '_projects';

const allowlists = {
  'nextlevelbuilder/ui-ux-pro-max-skill': [
    'src/ui-ux-pro-max/scripts/core.py',
    'src/ui-ux-pro-max/scripts/design_system.py',
    'src/ui-ux-pro-max/data/**/*.csv',
    'LICENSE'
  ]
};

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function walk(dir, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === '__pycache__') continue;
    const fullPath = path.join(dir, item.name);
    entries.push({ fullPath, relPath: slash(path.relative(root, fullPath)), dirent: item });
    if (item.isDirectory()) walk(fullPath, entries);
  }
  return entries;
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(resolveRel(relPath), 'utf8').replace(/^\uFEFF/, ''));
}

function discoverLocks() {
  return walk(resolveRel(projectRoot))
    .filter((entry) => entry.dirent.isFile() && entry.relPath.endsWith('/SOURCE-LOCK.json'))
    .map((entry) => ({ relPath: entry.relPath, lock: readJson(entry.relPath) }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function parseArgs(argv) {
  const result = { out: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') result.out = argv[++index] || null;
    else if (arg === '--json') result.json = true;
  }
  return result;
}

function isRetiredProvenanceSource(lock) {
  return isRetiredMigrationLock(lock);
}

function assertSupportedLifecycle(lockFile) {
  if (isRetiredMigrationLock(lockFile.lock) || isActiveThirdPartyAttributionLock(lockFile.lock)) return;
  throw new Error(`Unsupported SOURCE-LOCK lifecycle metadata: ${lockFile.relPath}`);
}

function riskForActiveSource(lock) {
  if (lock.source_role === 'third_party_attribution_source' || lock.source_repo === 'nextlevelbuilder/ui-ux-pro-max-skill') {
    return 'third-party';
  }
  return lock.source_repo?.startsWith('weijunswj/') ? 'own-repo' : 'manual-review';
}

function planEntry(lockFile) {
  const projectPath = lockFile.relPath.replace(/\/SOURCE-LOCK\.json$/, '');
  const lock = lockFile.lock;
  const risk = riskForActiveSource(lock);
  return {
    project_path: projectPath,
    source_repo: lock.source_repo,
    source_ref: lock.source_ref,
    locked_commit: lock.source_commit,
    source_lifecycle: lock.source_lifecycle,
    source_role: lock.source_role,
    update_policy: lock.source_update_policy,
    public_attribution_required: lock.public_attribution_required,
    risk,
    labels: risk === 'third-party' ? ['source-update', 'third-party-review'] : ['source-update'],
    reviewer: risk === 'third-party' ? 'weijunswj' : null,
    allowlist: allowlists[lock.source_repo] || lock.files.map((file) => file.source_path).filter(Boolean).sort(),
    tracked_files: lock.files.map((file) => ({
      mode: file.mode || 'exact',
      source_path: file.source_path,
      source_blob_sha: file.source_blob_sha || null
    })),
    required_local_checks: [
      'node repo/scripts/sync-toolkit-projects.cjs --write',
      'node repo/scripts/audit-project-source-locks.cjs',
      'npm run validate:all'
    ],
    notes: risk === 'third-party'
      ? 'Read-only advisory. Future updater work must use SOURCE-LOCK pins, keep weijunswj review, manual script review, allowlist checks, attribution checks, and full validation.'
      : 'Future deterministic PR update may be allowed when allowlist and validation pass. Never auto-merge.'
  };
}

function retiredProvenanceEntry(lockFile) {
  const projectPath = lockFile.relPath.replace(/\/SOURCE-LOCK\.json$/, '');
  const lock = lockFile.lock;
  return {
    project_path: projectPath,
    source_repo: lock.source_repo,
    source_ref: lock.source_ref,
    locked_commit: lock.source_commit,
    source_lifecycle: lock.source_lifecycle,
    source_role: lock.source_role,
    update_policy: lock.source_update_policy,
    public_attribution_required: lock.public_attribution_required,
    notes: 'Historical provenance only. Do not fetch, watch, or update this retired source repo.'
  };
}

function buildPlan(lockFiles = discoverLocks()) {
  const active = [];
  const retired = [];
  for (const lockFile of lockFiles) {
    assertSupportedLifecycle(lockFile);
    if (isRetiredProvenanceSource(lockFile.lock)) retired.push(retiredProvenanceEntry(lockFile));
    else active.push(planEntry(lockFile));
  }
  return {
    active_update_candidates: active,
    retired_provenance_sources: retired
  };
}

function renderMarkdown(plan) {
  const active = Array.isArray(plan) ? plan : plan.active_update_candidates;
  const retired = Array.isArray(plan) ? [] : plan.retired_provenance_sources;
  return [
    '# Project Source Watch Plan',
    '',
    'This deterministic plan is advisory. It does not fetch upstream commits, copy files, update SOURCE-LOCK.json, create branches, or create PRs.',
    'A future PR updater may use this plan as input, but normal local validation does not use network, execute upstream code, install packages, or run live n8n actions.',
    '',
    'Retired internal sources are provenance-only and are not active update candidates.',
    '',
    '## Active Update Candidates',
    '',
    ...(active.length ? active.flatMap((entry) => [
      `### ${entry.project_path}`,
      '',
      `- Source repo: ${entry.source_repo}`,
      `- Source ref: ${entry.source_ref}`,
      `- Locked commit: ${entry.locked_commit}`,
      `- Lifecycle: ${entry.source_lifecycle}`,
      `- Update policy: ${entry.update_policy}`,
      `- Risk: ${entry.risk}`,
      `- Labels: ${entry.labels.join(', ')}`,
      entry.reviewer ? `- Reviewer: ${entry.reviewer}` : '- Reviewer: project maintainer',
      '',
      'Allowlist:',
      ...entry.allowlist.map((item) => `- ${item}`),
      '',
      'Tracked SOURCE-LOCK files:',
      ...entry.tracked_files.map((item) => `- ${item.mode}: ${item.source_path}${item.source_blob_sha ? ` @ ${item.source_blob_sha}` : ''}`),
      '',
      'Required local checks:',
      ...entry.required_local_checks.map((item) => `- ${item}`),
      '',
      entry.notes,
      ''
    ]) : ['No active update candidates.', '']),
    '## Retired Internal Provenance Sources',
    '',
    ...(retired.length ? retired.flatMap((entry) => [
      `### ${entry.project_path}`,
      '',
      `- Source repo: ${entry.source_repo}`,
      `- Source ref: ${entry.source_ref}`,
      `- Locked commit: ${entry.locked_commit}`,
      `- Lifecycle: ${entry.source_lifecycle}`,
      `- Update policy: ${entry.update_policy}`,
      `- Public attribution required: ${entry.public_attribution_required}`,
      '',
      entry.notes,
      ''
    ]) : ['None.', ''])
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildPlan();
  const output = args.json ? `${JSON.stringify(plan, null, 2)}\n` : renderMarkdown(plan);
  if (args.out) {
    const outPath = path.resolve(root, args.out);
    const rel = path.relative(root, outPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Output path must stay inside the repo.');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`Wrote ${args.out}`);
  } else {
    process.stdout.write(output);
    if (!output.endsWith('\n')) process.stdout.write('\n');
  }
}

if (require.main === module) main();

module.exports = {
  allowlists,
  buildPlan,
  discoverLocks,
  isRetiredProvenanceSource,
  planEntry,
  retiredProvenanceEntry,
  renderMarkdown
};
