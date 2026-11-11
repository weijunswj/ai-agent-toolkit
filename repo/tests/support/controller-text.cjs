'use strict';

// The controller rules are repo/CONTROLLER.md (the core) plus the pages its Pages section lists.
// Tests that pin a rule's wording, or that a wording is gone, read the whole set through here, so
// a rule is found wherever it lives and an absence check still covers every page.
const fs = require('node:fs');
const path = require('node:path');
const { CORE, PAGES_DIR, listedPages } = require('../../scripts/sync-controller-pages.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');

function controllerFiles(root = ROOT) {
  const { errors, entries } = listedPages(read(root, CORE));
  if (errors.length) throw new Error(errors.join('\n'));
  return [CORE, ...entries.map(entry => `${PAGES_DIR}/${entry.file}`)];
}

function controllerText(root = ROOT) {
  return controllerFiles(root).map(rel => read(root, rel)).join('\n');
}

module.exports = { controllerFiles, controllerText };
