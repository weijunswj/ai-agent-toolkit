'use strict';
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TRUSTED_ROOT = path.join(REPO_ROOT, 'repo', 'scripts', 'trusted-workflows');

const VALIDATION_ONLY = new Set([
  'repo/scripts/trusted-workflows/build-closure-manifest.cjs',
  'repo/scripts/trusted-workflows/update-bootstrap-digests.cjs'
]);

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeRepoRelative(absolute) {
  return path.relative(REPO_ROOT, absolute).replace(/\\/g, '/');
}

function verifyContainment(repoRelative) {
  if (typeof repoRelative !== 'string' || repoRelative === '' || path.isAbsolute(repoRelative)) {
    throw new Error('TW_VERIFY_PATH:absolute');
  }
  const parts = repoRelative.replace(/\\/g, '/').split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('TW_VERIFY_ESCAPE');
  }
  
  const absolute = path.resolve(REPO_ROOT, repoRelative);
  const relToTrusted = path.relative(TRUSTED_ROOT, absolute);
  if (relToTrusted.startsWith('..' + path.sep) || path.isAbsolute(relToTrusted)) {
    throw new Error('TW_VERIFY_ESCAPE');
  }
  
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch (err) {
    throw new Error('TW_VERIFY_SYMLINK:failed');
  }
  // Allow realpath to change letter casing on Windows but not resolve symlinks outside
  // Actually, since realpath on Windows might differ by case, we should just check if the realpath escapes TRUSTED_ROOT.
  const realRel = path.relative(TRUSTED_ROOT, real);
  if (realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) {
    throw new Error('TW_VERIFY_ESCAPE:symlink');
  }
  // To reject symlinks entirely:
  const lstat = fs.lstatSync(absolute);
  if (lstat.isSymbolicLink()) {
    throw new Error('TW_VERIFY_SYMLINK');
  }

  return absolute;
}

module.exports = {
  REPO_ROOT,
  TRUSTED_ROOT,
  VALIDATION_ONLY,
  compareCodeUnits,
  normalizeRepoRelative,
  verifyContainment
};
