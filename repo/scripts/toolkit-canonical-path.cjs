'use strict';

// One path identity for records and copies Toolkit compares: the real path of the
// nearest existing ancestor plus the not-yet-existing remainder, case-folded on Windows.
// Two spellings of one folder (case, slashes, 8.3 short names, links) compare equal.

const fs = require('node:fs');
const path = require('node:path');

function fold(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function canonicalPath(value) {
  let current = path.resolve(String(value));
  const remainder = [];
  for (;;) {
    try {
      return fold(path.join(fs.realpathSync.native(current), ...remainder));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return fold(path.join(current, ...remainder));
      remainder.unshift(path.basename(current));
      current = parent;
    }
  }
}

function samePath(left, right) {
  return Boolean(left) && Boolean(right) && canonicalPath(left) === canonicalPath(right);
}

module.exports = Object.freeze({ canonicalPath, samePath });
