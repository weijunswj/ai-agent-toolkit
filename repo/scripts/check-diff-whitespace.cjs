#!/usr/bin/env node
'use strict';

// Whitespace check for the change under review: every commit from the base to HEAD plus any
// uncommitted edits (`git diff --check <base>`). A plain `git diff --check` on a clean CI checkout
// compares nothing. The base is DIFF_BASE when set (CI: the pull request base, or the previous main
// tip on a push to main); otherwise it is where HEAD left origin/main.

const { spawnSync } = require('node:child_process');

function git(args, options = {}) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true, ...options });
}

function resolveBase(environment = process.env) {
  const requested = String(environment.DIFF_BASE || '').trim();
  if (requested) {
    const verified = git(['rev-parse', '--verify', '--quiet', `${requested}^{commit}`]);
    if (verified.status !== 0) throw new Error(`The whitespace check base ${requested} is not a commit in this checkout. Fetch full history, or set DIFF_BASE to a commit.`);
    return verified.stdout.trim();
  }
  const mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
  if (mergeBase.status !== 0) throw new Error('The whitespace check could not find where HEAD left origin/main. Fetch origin/main, or set DIFF_BASE to the commit to compare with.');
  return mergeBase.stdout.trim();
}

function main() {
  let base;
  try { base = resolveBase(); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  const result = git(['diff', '--check', base], { stdio: 'inherit' });
  if (result.status === 0) process.stdout.write(`Whitespace check passed against ${base.slice(0, 12)}.\n`);
  return result.status === null ? 1 : result.status;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ resolveBase, main });
