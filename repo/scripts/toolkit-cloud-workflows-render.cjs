'use strict';

// The render behind toolkit-cloud-workflows.cjs: how a governed repository's copy of a Toolkit cloud
// workflow is made from the Toolkit's own file. It lives in its own file so a copy can be checked
// against a re-render at the Toolkit commit it names: while this file is the same at that commit as
// here, rendering that commit's workflow files here gives exactly what the installer wrote then.
// Keep only the render in this file; a change here makes copies from older commits checkable by
// their hash alone until the next rules refresh.
//
// The render changes only:
//   - a managed header line naming the Toolkit commit and the copy's hash,
//   - each Toolkit-script checkout, which names the Toolkit repository, the pinned commit and `.toolkit/`,
//   - `node repo/scripts/` paths, which become `node .toolkit/repo/scripts/`,
//   - the gate's CI trigger, which follows the repository's own CI workflow or is left out.
// A source file that no longer matches what the render expects stops it, so a change to the
// workflows breaks the tests instead of producing a wrong copy.
const crypto = require('node:crypto');

const TOOLKIT_REPOSITORY = 'weijunswj/ai-agent-toolkit';
const TOOLKIT_PATH = '.toolkit';
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
const MARKER = /^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ([a-z-]+) toolkit=([0-9a-f]{40}) sha256=([0-9a-f]{12})$/m;
const SHA = /^[0-9a-f]{40}$/;
const NOTE = '# A copy of the Toolkit\'s own workflow, pinned to the Toolkit commit above. Do not edit it here: refresh the repository rules to update it.';

class InstallError extends Error {
  constructor(message) { super(message); this.name = 'InstallError'; }
}

const normalise = text => String(text).replace(/\r\n/g, '\n');
const sha12 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
// Each action's pinned version left out, so a Dependabot bump of a `uses:` pin reads as an older copy
// (the next refresh puts the Toolkit's pins back), not as a hand edit.
const withoutPins = text => text.replace(/^(\s+(?:- )?uses: [^@\s]+)@[^\n]*$/gm, '$1');
const bodyHash = body => sha12(withoutPins(body));

function replaceOnce(text, from, to, what) {
  const at = text.indexOf(from);
  if (at === -1 || text.indexOf(from, at + 1) !== -1) throw new InstallError(`the Toolkit's workflow changed shape (${what}); the render needs an update.`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

function renderBody(id, source, commit, ci) {
  const toolkitScript = `        with:\n          repository: ${TOOLKIT_REPOSITORY}\n          ref: ${commit}\n          path: ${TOOLKIT_PATH}\n`;
  let text = source;
  if (id === 'programme-sweep') {
    text = replaceOnce(text, '      - name: Check out this run\'s commit\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n',
      '      - name: Check out this run\'s commit\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n\n'
      + '      - name: Check out the Toolkit\n        uses: ' + CHECKOUT + '\n' + toolkitScript + '          persist-credentials: false\n', 'sweep checkout');
    text = replaceOnce(text, '      - name: Check out the follow-up script\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n',
      '      - name: Check out the follow-up script\n        uses: ' + CHECKOUT + '\n' + toolkitScript, 'follow-up checkout');
  } else {
    text = replaceOnce(text, '      - name: Check out the gate from main\n        uses: ' + CHECKOUT + '\n        with:\n          ref: main\n',
      '      - name: Check out the gate from the Toolkit\n        uses: ' + CHECKOUT + '\n' + toolkitScript, 'gate checkout');
    if (ci) {
      text = replaceOnce(text, '    workflows: [Validate]\n', `    workflows: [${JSON.stringify(ci.name)}]\n`, 'gate CI trigger');
      text = replaceOnce(text, '          CI_WORKFLOW: validate.yml\n', `          CI_WORKFLOW: ${ci.file}\n`, 'gate CI workflow');
    } else {
      text = replaceOnce(text, '  workflow_run:\n    workflows: [Validate]\n    types: [completed]\n', '', 'gate CI trigger');
      text = replaceOnce(text, '          CI_WORKFLOW: validate.yml\n', '', 'gate CI workflow');
    }
  }
  const scripts = (text.match(/node repo\/scripts\//g) || []).length;
  if (!scripts) throw new InstallError(`the Toolkit's workflow changed shape (${id} runs no Toolkit script); the render needs an update.`);
  text = text.replace(/node repo\/scripts\//g, `node ${TOOLKIT_PATH}/repo/scripts/`);
  return text;
}

// The rendered copy: one managed header line, then the body.
function render(id, source, commit, ci = null) {
  if (!SHA.test(commit)) throw new InstallError('the Toolkit commit must be a full 40-character SHA.');
  const body = `${NOTE}\n${renderBody(id, normalise(source), commit, ci)}`;
  return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${id} toolkit=${commit} sha256=${bodyHash(body)}\n${body}`;
}

module.exports = Object.freeze({ TOOLKIT_REPOSITORY, TOOLKIT_PATH, MARKER, SHA, InstallError, normalise, withoutPins, bodyHash, render });
