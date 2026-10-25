#!/usr/bin/env node
'use strict';

// Installs the plain-text check into a repository:
//   - copies plain-text-check.cjs to .github/scripts/ with a managed header (version and hash),
//   - writes .github/plain-text.json when it is missing (issue and pull request reference rules on,
//     no banned terms: the repository adds its own shorthand codes later),
//   - writes the starting baseline once, from what is already there, so only new items fail,
//   - with --workflow, adds .github/workflows/plain-text.yml from the template if absent.
// The repository's own settings and baseline are never overwritten. --check changes nothing and
// reports drift: a missing, hand-edited or outdated copy, or missing settings.
//
// Usage: node install-plain-text-check.cjs --repo <dir> [--workflow] [--check]
// Exit codes: 0 done (or no drift), 1 drift found by --check, 2 not installed (the reason is printed).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECK_SOURCE = path.join(__dirname, 'plain-text-check.cjs');
const WORKFLOW_TEMPLATE = path.join(__dirname, '..', 'templates', 'github-actions', 'plain-text.yml');
const check = require('./plain-text-check.cjs');

const VENDORED_PATH = path.join('.github', 'scripts', 'plain-text-check.cjs');
const CONFIG_PATH = check.DEFAULT_CONFIG;
const WORKFLOW_PATH = path.join('.github', 'workflows', 'plain-text.yml');
const VENDOR_MARKER = /^\/\/ AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED plain-text-check check=(\d+) sha256=([0-9a-f]{12})$/m;

class InstallError extends Error {
  constructor(message) { super(message); this.name = 'InstallError'; }
}

function sha12(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12); }

// The vendored copy: the source with one managed header line after the shebang.
function vendoredText(raw = fs.readFileSync(CHECK_SOURCE, 'utf8')) {
  const source = raw.replace(/\r\n/g, '\n');
  const [shebang, ...rest] = source.split('\n');
  return [shebang, `// AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED plain-text-check check=${check.CHECK_VERSION} sha256=${sha12(source)}`, ...rest].join('\n');
}

// { state: 'current' | 'outdated' | 'edited' | 'unmanaged' | 'missing' } for a vendored copy.
function vendoredState(text, source = fs.readFileSync(CHECK_SOURCE, 'utf8')) {
  if (text === null) return { state: 'missing' };
  const normalised = text.replace(/\r\n/g, '\n');
  const marker = VENDOR_MARKER.exec(normalised);
  if (!marker) return { state: 'unmanaged' };
  const body = normalised.replace(`${marker[0]}\n`, '');
  if (sha12(body) !== marker[2]) return { state: 'edited' };
  if (marker[2] !== sha12(source.replace(/\r\n/g, '\n'))) return { state: 'outdated', check: Number(marker[1]) };
  return { state: 'current' };
}

const STARTING_CONFIG = Object.freeze({
  schema: check.CONFIG_SCHEMA,
  description: 'Settings for the plain-text check. Add this repository\'s own shorthand codes to banned_terms, each with a reason and the plain wording to use instead.',
  rules: { 'github-link': true, 'number-reference': true, 'pr-number-label': true, 'codex-mode-name': false },
  banned_terms: [],
  explained_terms: [],
  kept_terms: []
});

function readOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new InstallError(`${file} could not be read (${error.code || 'error'}).`);
  }
}

function writeFile(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  } catch (error) {
    throw new InstallError(`${file} could not be written (${error.code || 'error'}), so the check is not installed.`);
  }
}

class PlainTextInstaller {
  #repo; #spawn; #out;

  constructor({ repo, spawn = spawnSync, out = process.stdout }) {
    this.#repo = repo;
    this.#spawn = spawn;
    this.#out = out;
  }

  #say(line) { this.#out.write(`${line}\n`); }

  locate() {
    const result = this.#spawn('git', ['rev-parse', '--show-toplevel'], { cwd: this.#repo, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0 || !result.stdout.trim()) throw new InstallError(`${this.#repo} is not inside a git working tree, so nothing was installed.`);
    return path.resolve(result.stdout.trim());
  }

  install({ workflow = false } = {}) {
    const top = this.locate();
    const existingCopy = vendoredState(readOrNull(path.join(top, VENDORED_PATH)));
    if (existingCopy.state === 'unmanaged') {
      throw new InstallError(`${slash(VENDORED_PATH)} exists and is not a Toolkit copy, so nothing was installed. Move or rename it, then run the installer again.`);
    }
    const configFile = path.join(top, CONFIG_PATH);
    if (readOrNull(configFile) === null) {
      writeFile(configFile, `${JSON.stringify(STARTING_CONFIG, null, 2)}\n`);
      this.#say(`Settings written: ${slash(CONFIG_PATH)} (reference rules on, no banned terms yet).`);
    } else {
      this.#say(`Settings kept: ${slash(CONFIG_PATH)}.`);
    }
    let config;
    try { config = check.readConfigFile(configFile); }
    catch (error) { throw new InstallError(`${slash(CONFIG_PATH)} is not usable: ${error.message}. Fix it, then run the installer again.`); }
    writeFile(path.join(top, VENDORED_PATH), vendoredText());
    this.#say(`Check copied: ${slash(VENDORED_PATH)} (check v${check.CHECK_VERSION})${existingCopy.state === 'edited' ? '; local edits to the copy were replaced' : ''}.`);
    if (fs.existsSync(path.join(top, config.baseline))) this.#say(`Baseline kept: ${config.baseline}.`);
    else {
      let result;
      try { result = check.initBaseline(top, config, { spawn: this.#spawn }); }
      catch (error) { throw new InstallError(`the starting baseline could not be written: ${error.message}.`); }
      this.#say(`Baseline written: ${config.baseline} (${result.entries} existing item(s) allowed until rewritten).`);
    }
    let workflowWritten = false;
    if (workflow) {
      const target = path.join(top, WORKFLOW_PATH);
      const template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8');
      const current = readOrNull(target);
      if (current === null) { writeFile(target, template); workflowWritten = true; this.#say(`CI workflow added: ${slash(WORKFLOW_PATH)}.`); }
      else if (current.replace(/\r\n/g, '\n') === template.replace(/\r\n/g, '\n')) this.#say(`CI workflow already current: ${slash(WORKFLOW_PATH)}.`);
      else this.#say(`CI workflow kept as it is (it differs from the template): ${slash(WORKFLOW_PATH)}.`);
    }
    this.#say(`Next: commit the settings, the baseline${workflowWritten ? ', the check copy and the workflow' : ' and the check copy'} through a pull request.${workflow ? '' : ' Add the CI job with --workflow, or run the copy from an existing workflow.'}`);
  }

  // Drift report; changes nothing.
  check() {
    const top = this.locate();
    const problems = drift(top);
    if (problems.length) {
      for (const problem of problems) this.#say(`Drift: ${problem}`);
      return 1;
    }
    this.#say(`No drift: plain-text check v${check.CHECK_VERSION} and its settings.`);
    return 0;
  }
}

function slash(value) { return value.split(path.sep).join('/'); }

// Drift problems for a repository root, as plain lines; empty when the copy and settings are current.
function drift(top) {
  const problems = [];
  const copy = vendoredState(readOrNull(path.join(top, VENDORED_PATH)));
  if (copy.state !== 'current') problems.push(`check copy ${slash(VENDORED_PATH)}: ${copy.state}`);
  if (readOrNull(path.join(top, CONFIG_PATH)) === null) problems.push(`settings ${slash(CONFIG_PATH)}: missing`);
  return problems;
}

function main(argv, { out = process.stdout, err = process.stderr, spawn = spawnSync } = {}) {
  const options = { repo: process.cwd(), workflow: false, check: false };
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === '--repo') {
        if (argv[index + 1] === undefined) throw new InstallError('--repo needs a value.');
        options.repo = path.resolve(argv[++index]);
      } else if (arg === '--workflow') options.workflow = true;
      else if (arg === '--check') options.check = true;
      else throw new InstallError(`Unknown option ${arg}.`);
    }
    const installer = new PlainTextInstaller({ repo: options.repo, spawn, out });
    if (options.check) return installer.check();
    installer.install(options);
    return 0;
  } catch (error) {
    const message = error instanceof InstallError || (error && error.name === 'CheckError') ? error.message : `internal error (${error && error.name ? error.name : 'unknown'})`;
    err.write(`Not installed: ${message}\n`);
    return 2;
  }
}

module.exports = Object.freeze({ PlainTextInstaller, CONFIG_PATH, VENDORED_PATH, WORKFLOW_PATH, STARTING_CONFIG, drift, main, vendoredState, vendoredText });

if (require.main === module) process.exitCode = main(process.argv.slice(2));
