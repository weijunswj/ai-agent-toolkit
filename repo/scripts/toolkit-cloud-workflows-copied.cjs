'use strict';

// The default cloud workflows that are copied as they are, not rendered against a Toolkit commit: the
// personal data guard (its check and sweep workflows, its script and its settings file; no local hooks)
// and dependency auto-merge. toolkit-cloud-workflows.cjs lists them in DEFAULT_CLOUD_WORKFLOWS and asks
// here for their rows: { id, file, expected, state, kind: 'copied', held }.
//
//   - A file Toolkit did not write (no managed header, a link, a folder) is 'unmanaged' and never
//     written, and the entry's other files are `held`: a workflow never runs a script Toolkit did not
//     write, and a script is never left beside someone else's workflow of the same name.
//   - The guard's settings file is the owner's once it exists: it gets a row only while it is missing, or
//     while it holds a retired setting, which leaves with the script that stopped reading it (so it waits
//     with the script where that is held). One already on an open pull request's branch is kept there.
//   - A hand-edited or older copy is brought back to the Toolkit's own text.
const fs = require('node:fs');
const path = require('node:path');

const security = require('./toolkit-governance-security.cjs');

const GUARD_WORKFLOW = '.github/workflows/personal-data-guard.yml';
const SWEEP_WORKFLOW = '.github/workflows/personal-data-sweep.yml';
const GUARD_SCRIPT = '.github/scripts/personal-data-guard.cjs';
const GUARD_CONFIG = '.github/personal-data-guard.json';
const GUARD_TEMPLATE = 'skills/secure-ci-cd/templates/github-actions/personal-data-guard.yml';
const SWEEP_TEMPLATE = 'skills/secure-ci-cd/templates/github-actions/personal-data-sweep.yml';
const GUARD_SOURCE = 'skills/secure-ci-cd/scripts/personal-data-guard.cjs';

const FOREIGN = Symbol('foreign');
const LIMIT = 4 * 1024 * 1024;

// The text of one file in the checkout, null when nothing is there, or FOREIGN for anything that is not
// a plain file reached without links.
function readPlain(target, file) {
  let current = target;
  const parts = file.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') return null; return FOREIGN; }
    const last = index === parts.length - 1;
    if (last ? !stat.isFile() || stat.size > LIMIT : !stat.isDirectory()) return FOREIGN;
  }
  try { return fs.readFileSync(current, 'utf8'); } catch { return FOREIGN; }
}

const stateOf = (text, read) => (text === FOREIGN ? 'unmanaged' : read(text).state);

// `source(file)` gives a Toolkit file's text at the commit the copies come from.
const ROWS = Object.freeze({
  'personal-data-guard'(target, source) {
    const installer = require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs');
    const script = source(GUARD_SOURCE);
    const workflow = (file, name, template) => ({ file, expected: installer.workflowText(name, template), state: stateOf(readPlain(target, file), text => installer.workflowState(text, name, template)) });
    const rows = [
      workflow(GUARD_WORKFLOW, 'personal-data-guard', source(GUARD_TEMPLATE)),
      workflow(SWEEP_WORKFLOW, 'personal-data-sweep', source(SWEEP_TEMPLATE)),
      { file: GUARD_SCRIPT, expected: installer.vendoredText(script), state: stateOf(readPlain(target, GUARD_SCRIPT), text => installer.vendoredState(text, script)) },
    ];
    const config = readPlain(target, GUARD_CONFIG);
    if (config === null || config === FOREIGN) rows.push({ file: GUARD_CONFIG, expected: installer.configText(), state: config === null ? 'missing' : 'unmanaged' });
    else if (installer.currentConfigText(config) !== config) rows.push({ file: GUARD_CONFIG, expected: installer.currentConfigText(config), state: 'outdated', why: 'the retired identity setting, which no guard reads any more, taken out' });
    return rows;
  },
  'dependency-auto-merge'(target, source) {
    const template = source(security.WORKFLOW_TEMPLATE_REL);
    return [{ file: security.WORKFLOW_REL, expected: template, state: stateOf(readPlain(target, security.WORKFLOW_REL), text => ({
      state: text === null ? 'missing' : text.replace(/\r\n/g, '\n') === template ? 'current' : text.startsWith(security.WORKFLOW_MARKER) ? 'outdated' : 'unmanaged',
    })) }];
  },
});

function copiedRows({ id, consequence }, target, source) {
  const rows = ROWS[id](target, source).map(row => ({ id, ...row, absolute: path.join(target, ...row.file.split('/')), kind: 'copied', consequence }));
  const foreign = rows.some(row => row.state === 'unmanaged');
  return foreign ? rows.map(row => (row.state === 'unmanaged' ? row : { ...row, held: true })) : rows;
}

// The files each of these workflows may have, its workflow file first.
const COPIED_FILES = Object.freeze({
  'personal-data-guard': Object.freeze([GUARD_WORKFLOW, SWEEP_WORKFLOW, GUARD_SCRIPT, GUARD_CONFIG]),
  'dependency-auto-merge': Object.freeze([security.WORKFLOW_REL]),
});
// The Toolkit files they are made from.
const COPIED_SOURCES = Object.freeze([GUARD_TEMPLATE, SWEEP_TEMPLATE, GUARD_SOURCE, security.WORKFLOW_TEMPLATE_REL]);

module.exports = Object.freeze({ COPIED_FILES, COPIED_SOURCES, GUARD_CONFIG, SWEEP_WORKFLOW, copiedRows });
