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
//   - the gate's CI trigger, which follows the repository's own CI workflow or is left out,
//   - for the test shards copy (rendered from repo/contracts/ci/governed-test-shards.yml, which runs
//     nowhere in the Toolkit), the shard ids of each system the repository's shard list names, and
//     the job of a system it does not name, which is left out,
//   - for the Shard Timings copy, the header lines that name the Toolkit's own manifest, and the
//     refresh, which runs against the repository's own shard list (--repo-root).
// A source file that no longer matches what the render expects stops it, so a change to the
// workflows breaks the tests instead of producing a wrong copy.
const crypto = require('node:crypto');

const TOOLKIT_REPOSITORY = 'weijunswj/ai-agent-toolkit';
const TOOLKIT_PATH = '.toolkit';
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
const MARKER = /^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ([a-z-]+) toolkit=([0-9a-f]{40}) sha256=([0-9a-f]{12})$/m;
const SHA = /^[0-9a-f]{40}$/;
const SHARD_ID = /^[a-z]+-[1-9][0-9]*$/;
const SYSTEMS = Object.freeze(['linux', 'windows']);
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

// The shard ids a test shards copy runs, checked: { linux: [...], windows: [...] }, one system or both.
function shardSystems(input) {
  const systems = input && typeof input === 'object' ? input.systems : null;
  const names = systems && typeof systems === 'object' ? Object.keys(systems) : [];
  if (!names.length || names.some(name => !SYSTEMS.includes(name) || !Array.isArray(systems[name]) || !systems[name].length
    || systems[name].some(shard => typeof shard !== 'string' || !SHARD_ID.test(shard) || !shard.startsWith(`${name}-`)) || new Set(systems[name]).size !== systems[name].length)) {
    throw new InstallError('the test shards copy needs the shard ids of each system the shard list names.');
  }
  return systems;
}

function renderTestShards(source, commit, input) {
  const systems = shardSystems(input);
  let text = source;
  for (const system of SYSTEMS) {
    const placeholder = `        shard: TOOLKIT_SHARDS_${system.toUpperCase()}\n`;
    if (systems[system]) { text = replaceOnce(text, placeholder, `        shard: ${JSON.stringify(systems[system])}\n`, `${system} shards`); continue; }
    const start = text.indexOf(`\n  ${system}:\n`);
    const end = start === -1 ? -1 : text.slice(start + 1).search(/\n  [a-z-]+:\n/);
    if (start === -1 || end === -1 || !text.slice(start, start + 1 + end).includes(placeholder)) throw new InstallError(`the Toolkit's workflow changed shape (${system} job); the render needs an update.`);
    text = text.slice(0, start) + text.slice(start + 1 + end);
  }
  const present = SYSTEMS.filter(system => systems[system]);
  text = replaceOnce(text, '    needs: [linux, windows]\n', `    needs: [${present.join(', ')}]\n`, 'gate needs');
  const pins = (text.match(/^ {10}ref: TOOLKIT_COMMIT$/gm) || []).length;
  if (pins !== present.length + 1 || pins !== (text.match(/TOOLKIT_COMMIT/g) || []).length) throw new InstallError('the Toolkit\'s workflow changed shape (Toolkit checkouts); the render needs an update.');
  text = text.replace(/^( {10}ref: )TOOLKIT_COMMIT$/gm, `$1${commit}`);
  if (/TOOLKIT_[A-Z_]+/.test(text) || !text.includes(`node ${TOOLKIT_PATH}/repo/scripts/run-tests.cjs --repo-root . --verify `)) throw new InstallError('the Toolkit\'s workflow changed shape (test shards placeholders); the render needs an update.');
  return text;
}

const RUN_COMMIT_CHECKOUT = '      - name: Check out this run\'s commit\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n';

function renderBody(id, source, commit, ci) {
  if (id === 'test-shards') return renderTestShards(source, commit, ci);
  const toolkitScript = `        with:\n          repository: ${TOOLKIT_REPOSITORY}\n          ref: ${commit}\n          path: ${TOOLKIT_PATH}\n`;
  const toolkitCheckout = '      - name: Check out the Toolkit\n        uses: ' + CHECKOUT + '\n' + toolkitScript + '          persist-credentials: false\n';
  let text = source;
  if (id === 'shard-timings') {
    text = replaceOnce(text, '# Validate run on main and, when the shards have drifted, opens one pull request that updates the\n# shard manifest.',
      '# run on main of the workflow this repository\'s shard list names (.github/toolkit-test-shards.json)\n# and, when the shards have drifted, opens one pull request that updates that list.', 'shard timings header');
    text = replaceOnce(text, RUN_COMMIT_CHECKOUT, `${RUN_COMMIT_CHECKOUT}\n${toolkitCheckout}`, 'shard timings checkout');
    const refreshes = (text.match(/node repo\/scripts\/refresh-shard-timings\.cjs /g) || []).length;
    if (refreshes !== 2) throw new InstallError('the Toolkit\'s workflow changed shape (shard timings refresh); the render needs an update.');
    text = text.replace(/node repo\/scripts\/refresh-shard-timings\.cjs /g, 'node repo/scripts/refresh-shard-timings.cjs --repo-root "$GITHUB_WORKSPACE" ');
  } else if (id === 'programme-sweep') {
    text = replaceOnce(text, RUN_COMMIT_CHECKOUT, `${RUN_COMMIT_CHECKOUT}\n${toolkitCheckout}`, 'sweep checkout');
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

// The rendered copy: one managed header line, then the body. `input` is what the copy follows: the
// gate's CI workflow ({ file, name } or null), or the test shards copy's shard ids ({ systems }).
function render(id, source, commit, input = null) {
  if (!SHA.test(commit)) throw new InstallError('the Toolkit commit must be a full 40-character SHA.');
  const body = `${NOTE}\n${renderBody(id, normalise(source), commit, input)}`;
  return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${id} toolkit=${commit} sha256=${bodyHash(body)}\n${body}`;
}

module.exports = Object.freeze({ TOOLKIT_REPOSITORY, TOOLKIT_PATH, MARKER, SHA, SHARD_ID, InstallError, normalise, withoutPins, bodyHash, render });
