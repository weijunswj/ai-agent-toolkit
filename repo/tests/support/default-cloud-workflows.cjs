'use strict';

// The default cloud workflows as tests need them: the rendered ones by what they need, and the files of
// the ones copied as they are.
const fs = require('node:fs');
const path = require('node:path');
const workflows = require('../../scripts/toolkit-cloud-workflows.cjs');

const RENDERED = workflows.DEFAULT_CLOUD_WORKFLOWS.filter(row => row.kind === 'rendered');
const SWEEPS = RENDERED.filter(row => row.needs === 'main');
const COPIED = workflows.DEFAULT_CLOUD_WORKFLOWS.filter(row => row.kind === 'copied');
const COPIED_FILES = workflows.DEFAULT_FILES.filter(file => !RENDERED.some(row => row.file === file));
const { COPIED_SOURCES } = require('../../scripts/toolkit-cloud-workflows-copied.cjs');

// Writes the current copied files into `dir`, from the Toolkit checkout `root` at `commit`.
function putCopied(dir, { root, commit }) {
  for (const row of workflows.plan({ repo: dir, root, commit }).rows.filter(entry => entry.kind === 'copied')) {
    fs.mkdirSync(path.dirname(row.absolute), { recursive: true });
    fs.writeFileSync(row.absolute, row.expected);
  }
}

module.exports = { COPIED, COPIED_FILES, COPIED_SOURCES, RENDERED, SWEEPS, putCopied };
