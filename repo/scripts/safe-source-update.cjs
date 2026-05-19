#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

function classify(filePath) {
  const lower = String(filePath || '').toLowerCase();
  const isN8nHelperTemplate =
    (
      lower.startsWith('skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/') ||
      lower.startsWith('skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/')
    ) &&
    (lower.endsWith('.md') || lower.endsWith('.ps1') || lower.endsWith('.cmd') || lower.endsWith('.cjs') || lower.endsWith('.js'));
  if (isN8nHelperTemplate) return 'manual';
  if (
    lower.includes('.env') ||
    lower.includes('credential') ||
    lower.includes('binding') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.endsWith('.p12') ||
    lower.endsWith('.pfx') ||
    lower.endsWith('package.json') ||
    lower.endsWith('package-lock.json') ||
    lower.endsWith('pnpm-lock.yaml') ||
    lower.endsWith('yarn.lock') ||
    lower.includes('workflow') && lower.endsWith('.json') ||
    lower.includes('allowed-tools')
  ) {
    return 'blocked';
  }
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'safe';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.ps1') || lower.endsWith('.cmd') || lower.endsWith('.cjs') || lower.endsWith('.js') || lower.endsWith('.toml') || lower.endsWith('.json')) {
    return 'manual';
  }
  return 'manual';
}

function parseArgs(argv) {
  const files = [];
  let source = 'manual-source';
  let out = path.join('safe-source-update-summary.md');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') source = argv[++i] || source;
    else if (arg === '--out') out = argv[++i] || out;
    else files.push(arg);
  }
  return { source, out, files };
}

function renderSummary({ source, files }) {
  const grouped = { safe: [], manual: [], blocked: [] };
  for (const file of files) grouped[classify(file)].push(file);

  return [
    '# Safe Source Update Summary',
    '',
    `Upstream source: ${source}`,
    '',
    'This v1 summary is advisory only. No upstream code was executed, no changes were applied, no PR was created, and no merge was attempted.',
    '',
    '## Changed Files',
    '',
    ...(files.length ? files.map((file) => `- ${file} (${classify(file)})`) : ['- None provided.']),
    '',
    '## Classification',
    '',
    `- safe: ${grouped.safe.length}`,
    `- manual: ${grouped.manual.length}`,
    `- blocked: ${grouped.blocked.length}`,
    '',
    '## Recommended Human Review Prompt',
    '',
    'Review this source update summary. Treat it as advisory only. Approve safe documentation changes manually, inspect manual changes carefully, and reject blocked changes unless a new explicit plan is approved.',
    '',
    'Reminder: ChatGPT web review is manual and advisory. Do not automate ChatGPT web with cookies, sessions, browser automation, or session hacks.',
    ''
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = renderSummary(args);
  const outPath = path.resolve(root, args.out);
  const rel = path.relative(root, outPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Output path must stay inside the repo.');
  fs.writeFileSync(outPath, output);
  console.log(`Wrote ${args.out}`);
}

if (require.main === module) main();

module.exports = { classify, renderSummary };
