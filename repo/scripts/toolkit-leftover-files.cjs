#!/usr/bin/env node
'use strict';

// Report-only scan for Toolkit files left in repositories.
//
// It looks at each GitHub checkout in the owner's GitHub folder and one level below it. A repository
// whose governance could not be checked is not scanned. In the rest it lists only what is provably
// Toolkit's:
//   - a Toolkit marker (a managed block inside an instruction file, a vendored check's first line, or
//     the first line of a cloud sweep workflow copy);
//   - a file that is byte for byte a copy Toolkit shipped, now or earlier (playbook-history.json),
//     line endings aside.
// A repository whose governance is on gets its governed rules and playbooks from the installed
// Toolkit, so only those instruction copies (and the retired n8n adapter block) are listed there; its checks and workflow copies are in
// use and shown as kept. The repository's programme file is its on/off decision, so it is always kept.
// A one-line CLAUDE.md is listed only when AGENTS.md has nothing of its own left without the listed
// blocks; otherwise it loads the repository's own rules and is kept.
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
const SCANNED_STATES = Object.freeze({ DISABLED: 'governance off', UNDECIDED: 'no governance decision', ENABLED: 'governance on' });
// The Toolkit blocks that copied governed rules into a repository. Only these are leftovers where
// governance is on; any other block there is in use.
const GOVERNED_COPY_BLOCKS = Object.freeze(['TOOLKIT-GOVERNED-RULES', 'GLOBAL-AGENTS.MD-TEMPLATE', 'ANTIGRAVITY.BOOTSTRAP']);
// The n8n adapter block older setups copied into AGENTS.md. The global rules carry the n8n rules now,
// so it is a leftover in every governance state.
const RETIRED_COPY_BLOCKS = Object.freeze(['N8N-AGENT-RULES-ADAPTER']);
const HISTORY = path.resolve(__dirname, '..', 'contracts', 'agent-rules', 'playbook-history.json');
const IN_USE = 'governance is on, so it is in use';
const BROKEN = "its Toolkit markers are broken, so Toolkit cannot tell its text from the rest; fixing them by hand is the owner's choice";
const USAGE = 'Usage: node repo/scripts/toolkit-leftover-files.cjs scan [--github-folder <folder>] [--json]';

const unix = text => text.replace(/\r\n/g, '\n');

// The main checkouts in the GitHub folder and one level below it. A linked worktree is not one; a
// folder that cannot be read is returned as { root, held, reason } so readable neighbours still show.
function gitKind(root) {
  try { return fs.lstatSync(path.join(root, '.git')).isDirectory() ? 'main' : 'linked'; } catch { return null; }
}
function discoverCheckouts(folder, { readDir = dir => fs.readdirSync(dir, { withFileTypes: true }) } = {}) {
  if (!fs.existsSync(folder)) return [];
  if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) throw new Error('GitHub checkout folder is not a directory');
  const found = [];
  for (const item of readDir(folder)) {
    if (!item.isDirectory() || item.isSymbolicLink() || item.name.startsWith('.')) continue;
    const root = path.join(folder, item.name), kind = gitKind(root);
    if (kind === 'main') found.push(root);
    else if (!kind) {
      let children;
      try { children = readDir(root); } catch { found.push({ root, held: true, reason: 'Checkout folder could not be read; check local folder access, then retry.' }); continue; }
      for (const child of children) {
        if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.')) continue;
        const candidate = path.join(root, child.name);
        if (gitKind(candidate) === 'main') found.push(candidate);
      }
    }
  }
  return found;
}

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

const shortHash = text => require('node:crypto').createHash('sha256').update(text).digest('hex').slice(0, 16);

// The curated-source comment Toolkit's retired managed template put at the top of AGENTS.md, above its
// blocks, as it last shipped (playbook-history.json). Older wordings of it are not known here, so they
// stay the owner's text. This is the one place that reads it, for the scan and the cleanup alike.
function curatedHeader() {
  return JSON.parse(fs.readFileSync(HISTORY, 'utf8')).agents_header;
}

// An instruction file's text, after its listed blocks were removed, without the curated header when
// it is the first text there (blank lines before it aside), exactly as it shipped, on lines of its own.
// The header goes with its line ending and one blank line after it; every other byte stays.
function withoutCuratedHeader(text) {
  const header = curatedHeader();
  const lines = header.split('\n').map(line => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const found = new RegExp(`^(\uFEFF?)(?:[ \\t]*\\r?\\n)*${lines.join('\\r?\\n')}(?:\\r?\\n|$)(?:[ \\t]*(?:\\r?\\n|$))?`).exec(text);
  return found ? found[1] + text.slice(found[0].length) : text;
}

// The text left in an instruction file once the given blocks and the curated header go: empty means
// nothing of the owner's is left.
function ownText(text, names) {
  let rest = text;
  for (const name of names) rest = blocks.removeBlock(rest, name);
  return withoutCuratedHeader(rest).trim();
}

class LeftoverScan {
  #githubFolder; #discover; #governance; #templates; #history;

  // `history` maps a playbook name to the hashes of every copy Toolkit shipped (playbook-history.json).
  constructor({ home = os.homedir(), githubFolder, discover, governance, templates = TEMPLATES, history = null } = {}) {
    this.#githubFolder = githubFolder || path.join(home, 'GitHub');
    this.#discover = discover || discoverCheckouts;
    this.#governance = governance || require('./toolkit-governance-state.cjs');
    this.#templates = templates;
    this.#history = history || JSON.parse(fs.readFileSync(HISTORY, 'utf8')).playbooks;
  }

  // One checkout, as scan() reports it.
  inspect(root) { return this.#repository(root); }

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
    if (!Object.hasOwn(SCANNED_STATES, state)) return { root, name, scanned: false, reason: 'its governance could not be checked' };
    const result = { root, name, scanned: true, governance: SCANNED_STATES[state], governed: state === 'ENABLED', files: [], kept: [], unproven: [] };
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

  // A Toolkit block inside an instruction file. The rest of the file is the owner's; `empties` says
  // whether anything of the owner's is left once the listed blocks go.
  #blocks(root, result) {
    for (const file of BLOCK_FILES) {
      const read = readInside(root, file);
      if (!read) continue;
      if (read.skipped) { if (file !== 'GEMINI.md') result.unproven.push({ file, reason: read.skipped }); continue; }
      const parsed = blocks.findBlocks(read.text);
      // With broken markers no block in the file is proven: where one ends cannot be told, so the
      // whole file stays until the owner fixes the markers by hand.
      if (parsed.errors.length) { result.unproven.push({ file, reason: BROKEN }); continue; }
      const listed = parsed.blocks.filter(block => !result.governed || GOVERNED_COPY_BLOCKS.includes(block.name) || RETIRED_COPY_BLOCKS.includes(block.name));
      const empties = listed.length > 0 && !ownText(read.text, listed.map(block => block.name));
      for (const block of listed) {
        const edited = block.format >= 2 && block.digest !== blocks.bodyDigest(block.body);
        result.files.push({ file, kind: 'block', block: block.name, proof: 'Toolkit marker', edited, empties });
      }
    }
  }

  // CLAUDE.md that is exactly Toolkit's one-line pointer. It is a leftover only when AGENTS.md is
  // missing or has nothing of its own left; otherwise it loads the repository's own rules.
  #pointer(root, result) {
    const read = readInside(root, 'CLAUDE.md');
    if (!read?.text) return;
    const template = fs.readFileSync(path.join(this.#templates, 'CLAUDE.shim.template.md'), 'utf8');
    if (unix(read.text).trim() !== unix(template).trim()) return;
    const agents = readInside(root, 'AGENTS.md');
    const empties = result.files.some(item => item.file === 'AGENTS.md' && item.empties);
    if (!agents || empties) result.files.push({ file: 'CLAUDE.md', kind: 'file', proof: "same as Toolkit's shipped copy" });
    else result.kept.push({ file: 'CLAUDE.md', reason: "it loads this repository's own rules in AGENTS.md" });
  }

  // Playbooks that are a copy Toolkit shipped, now or earlier, including retired names. A same-named
  // file that differs from every copy may be the owner's.
  #playbooks(root, result) {
    const shipped = require('./toolkit-playbooks.cjs').repositoryPlaybooks();
    // A linked docs or playbook folder is reported once, not once per shipped playbook name.
    const parent = readInside(root, 'docs/agent-playbooks/.');
    if (parent?.skipped === 'it is a symbolic link') { result.unproven.push({ file: 'docs/agent-playbooks', reason: parent.skipped }); return; }
    for (const name of [...new Set([...Object.keys(shipped), ...Object.keys(this.#history)])].sort()) {
      const file = `docs/agent-playbooks/${name}`, read = readInside(root, file);
      if (!read) continue;
      if (read.skipped) { result.unproven.push({ file, reason: read.skipped }); continue; }
      const text = unix(read.text);
      if (text === shipped[name]) result.files.push({ file, kind: 'file', proof: "same as Toolkit's shipped copy" });
      else if ((this.#history[name] || []).includes(shortHash(text))) result.files.push({ file, kind: 'file', proof: 'same as an earlier Toolkit copy' });
      else result.unproven.push({ file, reason: 'it differs from every Toolkit copy' });
    }
  }

  // A vendored check that still carries Toolkit's first-line marker. The check works without governance.
  #checks(root, result) {
    for (const name of VENDORED_CHECKS) {
      const file = `.github/scripts/${name}.cjs`, read = readInside(root, file);
      if (!read?.text) continue;
      if (VENDORED_MARKER.exec(unix(read.text))?.[1] !== name) continue;
      if (result.governed) result.kept.push({ file, reason: IN_USE });
      else result.files.push({ file, kind: 'check', proof: 'Toolkit marker' });
    }
  }

  // A Toolkit workflow copy (the sweep, its gate, the test shards workflow or Shard Timings) whose first
  // line is the Toolkit's marker for a copy that may sit at that path; the test shards copy is found at
  // whatever name its shard list chose. A workflow without the marker may be the owner's, so it is not
  // listed.
  #workflows(root, result) {
    // Each candidate is read through readInside, which refuses links at every level, so a linked
    // folder only lists names that are then skipped.
    let names = null;
    try { names = fs.readdirSync(path.join(root, '.github', 'workflows')); } catch { names = null; }
    const fixed = new Set(cloud.DEFAULT_CLOUD_WORKFLOWS.filter(row => row.kind === 'rendered').map(row => row.file));
    for (const file of cloud.copyCandidates(names)) {
      const read = readInside(root, file);
      if (!read) continue;
      // Only a fixed copy path is worth naming when it cannot be read; any other workflow may be the owner's.
      if (read.skipped) { if (fixed.has(file)) result.unproven.push({ file, reason: read.skipped }); continue; }
      const text = unix(read.text), marker = cloud.MARKER.exec(text);
      const id = cloud.copyIdAt(file, text);
      if (!id) continue;
      if (result.governed) { result.kept.push({ file, reason: IN_USE }); continue; }
      result.files.push({ file, kind: 'workflow', ...(id.startsWith('programme-sweep') ? {} : { copy: id }), proof: 'Toolkit marker', edited: cloud.bodyHash(text.slice(marker[0].length + 1)) !== marker[3] });
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
  if (item.kind === 'workflow' && item.copy) return `- ${item.file}: a Toolkit ${item.copy === 'test-shards' ? 'test shards workflow' : 'Shard Timings'} copy${item.edited ? ', edited by hand since' : ''}. Governance is off, so nothing refreshes it any more and removing it is suggested.`;
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

module.exports = Object.freeze({ LeftoverScan, discoverCheckouts, describe, parseArgs, main, withoutCuratedHeader });

if (require.main === module) process.exitCode = main();
