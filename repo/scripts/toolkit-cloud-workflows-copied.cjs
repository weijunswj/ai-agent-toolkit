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

const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
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

const guardInstaller = () => require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs');
// How each copied file's text reads, against the Toolkit file it is made from (by default this copy's
// own): { source, expected(raw), state(text, raw) }. The guard's settings file has no such state.
const COPIES = Object.freeze({
  [GUARD_WORKFLOW]: { source: GUARD_TEMPLATE, expected: raw => guardInstaller().workflowText('personal-data-guard', raw), state: (text, raw) => guardInstaller().workflowState(text, 'personal-data-guard', raw).state },
  [SWEEP_WORKFLOW]: { source: SWEEP_TEMPLATE, expected: raw => guardInstaller().workflowText('personal-data-sweep', raw), state: (text, raw) => guardInstaller().workflowState(text, 'personal-data-sweep', raw).state },
  [GUARD_SCRIPT]: { source: GUARD_SOURCE, expected: raw => guardInstaller().vendoredText(raw), state: (text, raw) => guardInstaller().vendoredState(text, raw).state },
  [security.WORKFLOW_REL]: { source: security.WORKFLOW_TEMPLATE_REL, expected: raw => raw, state: (text, raw = fs.readFileSync(path.join(TOOLKIT_ROOT, ...security.WORKFLOW_TEMPLATE_REL.split('/')), 'utf8').replace(/\r\n/g, '\n')) => (text === null ? 'missing' : text.replace(/\r\n/g, '\n') === raw ? 'current' : text.startsWith(security.WORKFLOW_MARKER) ? 'outdated' : 'unmanaged') },
});

// 'current', 'outdated', 'edited', 'unmanaged' or 'missing' (null) for a copied file's text.
const copiedState = (file, text, raw = undefined) => COPIES[file].state(text, raw);

function copyRow(target, file, source) {
  const raw = source(COPIES[file].source), text = readPlain(target, file);
  return { file, expected: COPIES[file].expected(raw), state: text === FOREIGN ? 'unmanaged' : copiedState(file, text, raw) };
}

// What a file Toolkit did not write leaves out.
const clashNote = (file, id) => `${file} is not a Toolkit copy, so it is left as it is and the default ${id} workflow is not added around it; move it aside in a pull request first.`;

// `source(file)` gives a Toolkit file's text at the commit the copies come from.
const ROWS = Object.freeze({
  'personal-data-guard'(target, source) {
    const installer = guardInstaller();
    const rows = [GUARD_WORKFLOW, SWEEP_WORKFLOW, GUARD_SCRIPT].map(file => copyRow(target, file, source));
    const config = readPlain(target, GUARD_CONFIG);
    if (config === null || config === FOREIGN) rows.push({ file: GUARD_CONFIG, expected: installer.configText(), state: config === null ? 'missing' : 'unmanaged' });
    else if (installer.currentConfigText(config) !== config) rows.push({ file: GUARD_CONFIG, expected: installer.currentConfigText(config), state: 'outdated', why: 'the retired identity setting, which no guard reads any more, taken out' });
    return rows;
  },
  'dependency-auto-merge'(target, source) {
    return [copyRow(target, security.WORKFLOW_REL, source)];
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
const COPIED_SOURCES = Object.freeze(Object.values(COPIES).map(copy => copy.source));

module.exports = Object.freeze({ COPIED_FILES, COPIED_SOURCES, GUARD_CONFIG, SWEEP_WORKFLOW, clashNote, copiedRows, copiedState });
