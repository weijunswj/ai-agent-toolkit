#!/usr/bin/env node
'use strict';

// Report-only scan for Toolkit files left in repositories that do not use Toolkit's GitHub governance.
//
// It looks at each GitHub checkout under the owner's GitHub folder (the same discovery the scheduled
// task update uses). A repository whose governance is on, or could not be checked, is not scanned.
// In the rest it lists only what is provably Toolkit's:
//   - a Toolkit marker (a managed block inside an instruction file, a vendored check's first line, or
//     the first line of a cloud sweep workflow copy);
//   - a file that is byte for byte Toolkit's shipped copy, line endings aside.
// The repository's programme file is its on/off decision, so it is always shown as kept.
//
// It never deletes, writes, stages or fetches anything, and it prints no file contents. Removing a
// leftover is a later step: one pull request per repository, with the owner's OK.
//
// Usage: node repo/scripts/toolkit-leftover-files.cjs scan [--github-folder <folder>] [--json]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const blocks = require('./toolkit-managed-block.cjs');
const cloud = require('./toolkit-cloud-workflows.cjs');

const TEMPLATES = path.resolve(__dirname, '..', '..', 'skills', 'repository-agent-rules', 'repo-local');
const DECISION_FILE = '.github/toolkit-programme.json';
const BLOCK_FILES = Object.freeze(['AGENTS.md', 'GEMINI.md', '.agents/rules/00-agent-toolkit-bootstrap.md']);
const VENDORED_CHECKS = Object.freeze(['plain-text-check', 'personal-data-guard']);
const VENDORED_MARKER = /^\/\/ AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED (\S+) \w+=\d+ sha256=[0-9a-f]{12}$/m;
const LIMIT = 1024 * 1024;
const SCANNED_STATES = Object.freeze({ DISABLED: 'governance off', UNDECIDED: 'no governance decision' });
const USAGE = 'Usage: node repo/scripts/toolkit-leftover-files.cjs scan [--github-folder <folder>] [--json]';

const unix = text => text.replace(/\r\n/g, '\n');

// One file inside a checkout, read without following a symbolic link anywhere on its path.
// Returns { text } for a readable regular file, { skipped } when it cannot be judged, null when absent.
function readInside(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? null : { skipped: 'it could not be read' }; }
    if (stat.isSymbolicLink()) return { skipped: 'it is a symbolic link' };
  }
  const stat = fs.lstatSync(current);
  if (!stat.isFile()) return { skipped: 'it is not a regular file' };
  if (stat.size > LIMIT) return { skipped: 'it is too large to compare' };
  try { return { text: fs.readFileSync(current, 'utf8') }; } catch { return { skipped: 'it could not be read' }; }
}

function repositoryName(identity) {
  const remote = identity?.remote;
  if (!identity?.valid || !remote?.path) return null;
  return String(remote.path).replace(/^\/+/, '').replace(/\.git$/i, '') || null;
}

class LeftoverScan {
  #githubFolder; #discover; #governance; #templates;

  constructor({ home = os.homedir(), githubFolder, discover, governance, templates = TEMPLATES } = {}) {
    this.#githubFolder = githubFolder || path.join(home, 'GitHub');
    this.#discover = discover || require('./toolkit-update-scheduled-task.cjs').discoverCheckouts;
    this.#governance = governance || require('./toolkit-governance-state.cjs');
    this.#templates = templates;
  }

  scan() {
    let found;
    try { found = this.#discover(this.#githubFolder); }
    catch { return { folder: this.#githubFolder, readable: false, repositories: [] }; }
    const repositories = found.map(row => typeof row === 'string' ? this.#repository(row) : { root: row.root, name: path.basename(row.root), scanned: false, reason: 'the folder could not be read' });
    return { folder: this.#githubFolder, readable: true, repositories };
  }

  #repository(root) {
    let name = path.basename(root), state;
    try { name = repositoryName(this.#governance.readIdentity(root)) || name; } catch { /* the folder name stands in */ }
    try { state = this.#governance.governanceState(root)?.state; } catch { state = null; }
    if (state === 'ENABLED') return { root, name, scanned: false, reason: 'governance is on, so its Toolkit files are in use' };
    if (!Object.hasOwn(SCANNED_STATES, state)) return { root, name, scanned: false, reason: 'its governance could not be checked' };
    const result = { root, name, scanned: true, governance: SCANNED_STATES[state], files: [], kept: [], unproven: [] };
    try {
      this.#blocks(root, result);
      this.#pointer(root, result);
      this.#playbooks(root, result);
      this.#checks(root, result);
      this.#workflows(root, result);
      this.#decision(root, result);
    } catch { return { root, name, scanned: false, reason: 'its files could not be read' }; }
    return result;
  }

  // A Toolkit block inside an instruction file. The rest of the file is the owner's.
  #blocks(root, result) {
    for (const file of BLOCK_FILES) {
      const read = readInside(root, file);
      if (!read) continue;
      if (read.skipped) { if (file !== 'GEMINI.md') result.unproven.push({ file, reason: read.skipped }); continue; }
      const parsed = blocks.findBlocks(read.text);
      for (const block of parsed.blocks) {
        const edited = block.format >= 2 && block.digest !== blocks.bodyDigest(block.body);
        result.files.push({ file, kind: 'block', block: block.name, proof: 'Toolkit marker', edited });
      }
      if (parsed.errors.length) result.unproven.push({ file, reason: 'its Toolkit markers are broken' });
    }
  }

  // CLAUDE.md that is exactly Toolkit's one-line pointer.
  #pointer(root, result) {
    const read = readInside(root, 'CLAUDE.md');
    if (!read?.text) return;
    const template = fs.readFileSync(path.join(this.#templates, 'CLAUDE.shim.template.md'), 'utf8');
    if (unix(read.text).trim() === unix(template).trim()) result.files.push({ file: 'CLAUDE.md', kind: 'file', proof: "same as Toolkit's shipped copy" });
  }

  // Playbooks that are still Toolkit's shipped copy. A same-named file that differs may be the owner's.
  #playbooks(root, result) {
    const folder = path.join(this.#templates, 'docs', 'agent-playbooks');
    // A linked docs or playbook folder is reported once, not once per shipped playbook name.
    const parent = readInside(root, 'docs/agent-playbooks/.');
    if (parent?.skipped === 'it is a symbolic link') { result.unproven.push({ file: 'docs/agent-playbooks', reason: parent.skipped }); return; }
    for (const name of fs.readdirSync(folder).filter(entry => entry.endsWith('.md')).sort()) {
      const file = `docs/agent-playbooks/${name}`, read = readInside(root, file);
      if (!read) continue;
      if (read.skipped) { result.unproven.push({ file, reason: read.skipped }); continue; }
      if (unix(read.text) === unix(fs.readFileSync(path.join(folder, name), 'utf8'))) result.files.push({ file, kind: 'file', proof: "same as Toolkit's shipped copy" });
      else result.unproven.push({ file, reason: "it differs from Toolkit's shipped copy" });
    }
  }

  // A vendored check that still carries Toolkit's first-line marker. The check works without governance.
  #checks(root, result) {
    for (const name of VENDORED_CHECKS) {
      const file = `.github/scripts/${name}.cjs`, read = readInside(root, file);
      if (!read?.text) continue;
      if (VENDORED_MARKER.exec(unix(read.text))?.[1] === name) result.files.push({ file, kind: 'check', proof: 'Toolkit marker' });
    }
  }

  // A cloud sweep workflow copy whose first line is the Toolkit's marker for that same workflow. A
  // same-named workflow without it may be the owner's, so it is not listed.
  #workflows(root, result) {
    for (const { id, file } of cloud.WORKFLOWS) {
      const read = readInside(root, file);
      if (!read) continue;
      if (read.skipped) { result.unproven.push({ file, reason: read.skipped }); continue; }
      const text = unix(read.text), marker = cloud.MARKER.exec(text);
      if (!marker || text.indexOf(marker[0]) !== 0 || marker[1] !== id) continue;
      result.files.push({ file, kind: 'workflow', proof: 'Toolkit marker', edited: cloud.bodyHash(text.slice(marker[0].length + 1)) !== marker[3] });
    }
  }

  // The programme file is the repository's decision, never a leftover.
  #decision(root, result) {
    const read = readInside(root, DECISION_FILE);
    if (!read) return;
    // A link or unreadable file is not proven to be the decision, so it is reported as not listed.
    if (read.skipped) { result.unproven.push({ file: DECISION_FILE, reason: read.skipped }); return; }
    let off = false;
    try { off = read.text ? JSON.parse(read.text).governance === 'disabled' : false; } catch { off = false; }
    result.kept.push({ file: DECISION_FILE, reason: off ? "it records this repository's \"governance off\" decision" : "it is the repository's programme file, which Toolkit reads for the on/off decision" });
  }
}

function describeFile(item) {
  if (item.kind === 'block') return `- ${item.file}: Toolkit block ${item.block} inside the file${item.edited ? ', edited by hand since' : ''}. The rest of the file is yours.`;
  if (item.kind === 'check') return `- ${item.file}: a Toolkit check copy. It keeps working without governance; removing it is your choice, together with its workflow and settings.`;
  if (item.kind === 'workflow') return `- ${item.file}: a Toolkit cloud sweep copy${item.edited ? ', edited by hand since' : ''}. With governance off it writes nothing, but its runs still start on GitHub, so removing it is suggested.`;
  return `- ${item.file}: ${item.proof}.`;
}

function describe(report) {
  const lines = ['Leftover Toolkit files (report only: nothing was changed or deleted)', `Folder scanned: ${report.folder}`];
  if (!report.readable) return [...lines, 'The folder could not be read, so nothing was scanned.'];
  if (!report.repositories.length) return [...lines, 'No GitHub checkouts were found there.'];
  for (const repository of report.repositories) {
    lines.push('');
    if (!repository.scanned) { lines.push(`${repository.name}: not scanned, because ${repository.reason}.`); continue; }
    lines.push(`${repository.name} (${repository.governance}), ${repository.root}:`);
    if (!repository.files.length) lines.push('- No file here is provably Toolkit\'s.');
    for (const item of repository.files) lines.push(describeFile(item));
    for (const item of repository.kept) lines.push(`- Kept: ${item.file}, because ${item.reason}.`);
    for (const item of repository.unproven) lines.push(`- Not listed as Toolkit's: ${item.file}, because ${item.reason}.`);
  }
  lines.push('', 'The scan reads each checkout as it is on this computer, on whatever branch is checked out.',
    'To remove a leftover, ask for one pull request in that repository. Nothing is removed without your OK.');
  return lines;
}

function parseArgs(argv) {
  if (argv[0] !== 'scan') throw new Error(USAGE);
  const options = { json: false, githubFolder: null };
  for (let index = 1; index < argv.length; index++) {
    if (argv[index] === '--json') options.json = true;
    else if (argv[index] === '--github-folder' && argv[index + 1] && !argv[index + 1].startsWith('--')) options.githubFolder = path.resolve(argv[++index]);
    else throw new Error(USAGE);
  }
  return options;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || console.log;
  let options;
  try { options = parseArgs(argv); } catch (error) { (deps.error || console.error)(error.message); return 2; }
  const report = new LeftoverScan({ ...deps, githubFolder: options.githubFolder || deps.githubFolder }).scan();
  if (options.json) log(JSON.stringify(report, null, 2));
  else for (const line of describe(report)) log(line);
  return 0;
}

module.exports = Object.freeze({ LeftoverScan, describe, parseArgs, main });

if (require.main === module) process.exitCode = main();
