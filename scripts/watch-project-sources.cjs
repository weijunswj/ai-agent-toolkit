#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

function riskForRepo(sourceRepo) {
  if (sourceRepo === 'nextlevelbuilder/ui-ux-pro-max-skill') return 'third-party';
  return sourceRepo?.startsWith('weijunswj/') ? 'own-repo' : 'manual-review';
}

function planEntry(lockFile) {
  const projectPath = lockFile.relPath.replace(/\/SOURCE-LOCK\.json$/, '');
  const lock = lockFile.lock;
  const risk = riskForRepo(lock.source_repo);
  return {
    project_path: projectPath,
    source_repo: lock.source_repo,
    source_ref: lock.source_ref,
    locked_commit: lock.source_commit,
    risk,
    labels: risk === 'third-party' ? ['source-update', 'third-party-review'] : ['source-update'],
    reviewer: risk === 'third-party' ? 'weijunswj' : null,
    allowlist: allowlists[lock.source_repo] || lock.files.map((file) => file.source_path).filter(Boolean).sort(),
    required_local_checks: [
      'node scripts/sync-toolkit-projects.cjs --write',
      'node scripts/audit-project-source-locks.cjs',
      'node scripts/validate-toolkit.cjs',
      'node --test tests/*.test.cjs'
    ],
    notes: risk === 'third-party'
      ? 'Draft PR only. Request weijunswj review, mention @weijunswj, and manually review scripts before merge.'
      : 'Direct PR update is allowed when allowlist and validation pass. Never auto-merge.'
  };
}

function renderMarkdown(entries) {
  return [
    '# Project Source Watch PR Plan',
    '',
    'This deterministic plan is advisory until a source update runner copies allowlisted upstream files.',
    'Normal local validation does not use network, execute upstream code, install packages, or run live n8n actions.',
    '',
    'GitHub Actions may use this plan to open draft source update PRs. It must never auto-merge.',
    '',
    '## Projects',
    '',
    ...entries.flatMap((entry) => [
      `### ${entry.project_path}`,
      '',
      `- Source repo: ${entry.source_repo}`,
      `- Source ref: ${entry.source_ref}`,
      `- Locked commit: ${entry.locked_commit}`,
      `- Risk: ${entry.risk}`,
      `- Labels: ${entry.labels.join(', ')}`,
      entry.reviewer ? `- Reviewer: ${entry.reviewer}` : '- Reviewer: project maintainer',
      '',
      'Allowlist:',
      ...entry.allowlist.map((item) => `- ${item}`),
      '',
      'Required local checks:',
      ...entry.required_local_checks.map((item) => `- ${item}`),
      '',
      entry.notes,
      ''
    ])
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = discoverLocks().map(planEntry);
  const output = args.json ? `${JSON.stringify(entries, null, 2)}\n` : renderMarkdown(entries);
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
  discoverLocks,
  planEntry,
  renderMarkdown
};
