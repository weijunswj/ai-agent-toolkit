#!/usr/bin/env node
'use strict';

// Toolkit's own run of the plain-text check (skills/secure-ci-cd/scripts/plain-text-check.cjs), with
// Toolkit's settings in repo/contracts/plain-references/config.json. User-facing docs, skills and
// AI-facing instructions carry no GitHub issue, pull request, discussion, commit or compare links,
// no `#123` references, no "PR 237" labels, no Codex mode class names and none of Toolkit's own
// shorthand codes (release, lane, record or test-row codes). Links to repository files are fine.
// Write what the reference means instead, for example "the governance states work" rather than a number.
//
// Pre-existing offenders are listed in the baseline and allowed up to their recorded count; any new
// one fails. The baseline only shrinks: `--prune-baseline` drops entries that no longer occur, and
// nothing here adds entries.
//
// Usage: node repo/scripts/check-plain-references.cjs [--root <dir>] [--prune-baseline] [--files <path>...]

const path = require('node:path');
const portable = require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs');

const CONFIG_FILE = path.join(__dirname, '..', 'contracts', 'plain-references', 'config.json');
const CONFIG = portable.readConfigFile(CONFIG_FILE);
const BASELINE_REL = CONFIG.baseline;
const RULES = portable.REFERENCE_RULES;

const inScope = (rel) => Boolean(portable.scopeOf(rel, CONFIG));
// Toolkit is always read by walking the folder, so a check of a fixture folder and of the checkout behave alike.
const noGit = () => ({ status: 1, stdout: '' });
const listScopedFiles = (root) => portable.listScopedFiles(root, CONFIG, { spawn: noGit });
const findReferences = (text, file = '') => portable.findInText(text, file, CONFIG, file ? portable.scopeOf(file, CONFIG) || 'text' : 'text');
const scan = (root) => portable.scanFiles(root, listScopedFiles(root), CONFIG);
const check = (root, options = {}) => portable.check(root, CONFIG, { spawn: noGit, ...options });
const describeFailure = (finding) => portable.describeFailure(finding, CONFIG);
const pruneBaseline = (root) => portable.pruneBaseline(root, CONFIG, { spawn: noGit });

function parseArgs(argv) {
  const args = { root: process.cwd(), prune: false, files: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = argv[++index];
    else if (argv[index] === '--prune-baseline') args.prune = true;
    else if (argv[index] === '--files') { args.files = argv.slice(index + 1); break; }
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  args.root = path.resolve(args.root);
  return args;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.prune) {
    const result = pruneBaseline(args.root);
    console.log(`Plain-references baseline pruned: ${result.removed} entr${result.removed === 1 ? 'y' : 'ies'} removed, ${result.kept} kept.`);
    return 0;
  }
  return portable.report(check(args.root, { files: args.files }), CONFIG, process.stdout, process.stderr);
}

if (require.main === module) {
  try { process.exitCode = run(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}

module.exports = Object.freeze({ BASELINE_REL, CONFIG, RULES, inScope, listScopedFiles, findReferences, scan, check, describeFailure, pruneBaseline });
