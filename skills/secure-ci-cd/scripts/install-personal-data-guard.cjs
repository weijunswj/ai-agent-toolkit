#!/usr/bin/env node
'use strict';

// Installs the personal-data guard into a repository on the owner's opt-in:
//   - copies personal-data-guard.cjs to .github/scripts/ with a managed header (version and hash),
//   - writes .github/personal-data-guard.json when it is missing (the owner names the identity
//     choice; nothing is defaulted silently),
//   - installs pre-commit, commit-msg and pre-push hooks in the folder git actually runs hooks from
//     (git rev-parse --git-path hooks, which follows core.hooksPath). A hook that is already there
//     and is not this guard's is kept as <name>.pre-personal-data-guard and runs after the guard.
//   - with --workflow, adds .github/workflows/personal-data-guard.yml from the template if absent.
// --check changes nothing and reports drift: a hand-edited or outdated copy, missing hooks.
//
// Usage: node install-personal-data-guard.cjs --repo <dir> [--identity excluded|included]
//          [--identity-reason <text>] [--required-check validate|personal-data|none] [--workflow] [--check]
// Exit codes: 0 done (or no drift), 1 drift found by --check, 2 not installed (the reason is printed).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD_SOURCE = path.join(__dirname, 'personal-data-guard.cjs');
const WORKFLOW_TEMPLATE = path.join(__dirname, '..', 'templates', 'github-actions', 'personal-data-guard.yml');
const { GUARD_VERSION, CONFIG_SCHEMA, validateConfig } = require('./personal-data-guard.cjs');

const VENDORED_PATH = path.join('.github', 'scripts', 'personal-data-guard.cjs');
const CONFIG_PATH = path.join('.github', 'personal-data-guard.json');
const WORKFLOW_PATH = path.join('.github', 'workflows', 'personal-data-guard.yml');
const VENDOR_MARKER = /^\/\/ AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED personal-data-guard guard=(\d+) sha256=([0-9a-f]{12})$/m;
const HOOK_MARKER = 'AI-AGENT-TOOLKIT:secure-ci-cd:HOOK personal-data-guard';
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];
const SAVED_SUFFIX = '.pre-personal-data-guard';

class InstallError extends Error {
  constructor(message) { super(message); this.name = 'InstallError'; }
}

function sha12(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12); }

// The vendored copy: the source with one managed header line after the shebang.
function vendoredText(raw = fs.readFileSync(GUARD_SOURCE, 'utf8')) {
  const source = raw.replace(/\r\n/g, '\n');
  const [shebang, ...rest] = source.split('\n');
  return [shebang, `// AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED personal-data-guard guard=${GUARD_VERSION} sha256=${sha12(source)}`, ...rest].join('\n');
}

// { state: 'current' | 'outdated' | 'edited' | 'unmanaged' | 'missing' } for a vendored copy.
function vendoredState(text, source = fs.readFileSync(GUARD_SOURCE, 'utf8')) {
  if (text === null) return { state: 'missing' };
  const normalised = text.replace(/\r\n/g, '\n');
  const marker = VENDOR_MARKER.exec(normalised);
  if (!marker) return { state: 'unmanaged' };
  const body = normalised.replace(`${marker[0]}\n`, '');
  if (sha12(body) !== marker[2]) return { state: 'edited' };
  if (marker[2] !== sha12(source.replace(/\r\n/g, '\n'))) return { state: 'outdated', guard: Number(marker[1]) };
  return { state: 'current' };
}

function hookText(name) {
  const lines = [
    '#!/bin/sh',
    `# ${HOOK_MARKER} guard=${GUARD_VERSION} hook=${name}`,
    '# Installed by the Toolkit personal-data guard installer. A hook that was here before is kept as',
    `# ${name}${SAVED_SUFFIX} next to this file and runs after the guard.`,
    'root=$(git rev-parse --show-toplevel) || exit 1',
    'guard="$root/.github/scripts/personal-data-guard.cjs"',
    `chained="$(dirname "$0")/${name}${SAVED_SUFFIX}"`,
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "personal-data-guard: node was not found on PATH, so the check cannot run; blocked." >&2',
    '  exit 1',
    'fi',
    'if [ ! -f "$guard" ]; then',
    '  echo "personal-data-guard: .github/scripts/personal-data-guard.cjs is missing; blocked. Run the installer again." >&2',
    '  exit 1',
    'fi',
  ];
  if (name === 'pre-commit') {
    lines.push('node "$guard" staged --repo "$root" || exit $?');
    lines.push('if [ -f "$chained" ]; then exec "$chained" "$@"; fi');
  } else if (name === 'commit-msg') {
    lines.push('node "$guard" message "$1" --repo "$root" || exit $?');
    lines.push('if [ -f "$chained" ]; then exec "$chained" "$@"; fi');
  } else {
    lines.push('input=$(cat)');
    lines.push('printf \'%s\\n\' "$input" | node "$guard" pre-push --repo "$root" || exit $?');
    lines.push('if [ -f "$chained" ]; then printf \'%s\\n\' "$input" | "$chained" "$@"; exit $?; fi');
  }
  lines.push('exit 0', '');
  return lines.join('\n');
}

class GuardInstaller {
  #repo; #spawn; #out;

  constructor({ repo, spawn = spawnSync, out = process.stdout }) {
    this.#repo = repo;
    this.#spawn = spawn;
    this.#out = out;
  }

  #git(args) {
    const result = this.#spawn('git', args, { cwd: this.#repo, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim();
  }

  // The worktree root and the folder git runs hooks from.
  locate() {
    const top = this.#git(['rev-parse', '--show-toplevel']);
    if (!top) throw new InstallError(`${this.#repo} is not inside a git working tree, so nothing was installed.`);
    const hooks = this.#git(['rev-parse', '--git-path', 'hooks']);
    if (!hooks) throw new InstallError('git did not report its hooks folder, so nothing was installed.');
    // --git-path answers relative to the folder git ran in (here the repo argument).
    return { top: path.resolve(top), hooks: path.resolve(this.#repo, hooks) };
  }

  #say(line) { this.#out.write(`${line}\n`); }

  install({ identity, identityReason, requiredCheck = 'none', workflow = false }) {
    const { top, hooks } = this.locate();
    try { fs.mkdirSync(hooks, { recursive: true }); }
    catch (error) { throw new InstallError(`the hooks folder ${hooks} could not be created (${error.code || 'error'}), so nothing was installed.`); }
    const configFile = path.join(top, CONFIG_PATH);
    if (!fs.existsSync(configFile)) {
      if (!identity) throw new InstallError('There is no .github/personal-data-guard.json yet. Ask the owner whether commit author and committer addresses are scanned, then pass --identity excluded or --identity included (with --identity-reason when excluded). Nothing was installed.');
      const config = {
        schema: CONFIG_SCHEMA,
        scope: { file_content: true, paths: true, commit_messages: true, branch_names: true, pull_request_text: true },
        identity,
        ...(identity === 'excluded' ? { identity_reason: identityReason } : {}),
        allow: [],
        not_scanned: [],
        required_check: requiredCheck,
      };
      validateConfig(config, CONFIG_PATH);
      writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
      this.#say(`Config written: ${CONFIG_PATH} (identity ${identity}, required check ${requiredCheck}).`);
    } else {
      this.#say(`Config kept: ${CONFIG_PATH}.`);
    }
    writeFile(path.join(top, VENDORED_PATH), vendoredText());
    this.#say(`Guard copied: ${VENDORED_PATH} (guard v${GUARD_VERSION}).`);
    for (const name of HOOKS) this.#say(this.#installHook(hooks, name));
    for (const name of HOOKS) {
      const text = readOrNull(path.join(hooks, name));
      if (!text || !text.includes(HOOK_MARKER)) throw new InstallError(`The ${name} hook could not be read back from ${hooks}; treat the guard as not installed.`);
    }
    this.#say(`Hooks folder git uses: ${hooks}`);
    if (workflow) {
      const target = path.join(top, WORKFLOW_PATH);
      const template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8');
      const current = readOrNull(target);
      if (current === null) { writeFile(target, template); this.#say(`CI workflow added: ${WORKFLOW_PATH}.`); }
      else if (current.replace(/\r\n/g, '\n') === template) this.#say(`CI workflow already current: ${WORKFLOW_PATH}.`);
      else this.#say(`CI workflow kept as it is (it differs from the template): ${WORKFLOW_PATH}.`);
    }
    this.#say('Next: commit the config, the guard copy and the workflow through a pull request. Hooks stay local to');
    this.#say('this clone; CI is the check that cannot be skipped with --no-verify.');
  }

  #installHook(hooks, name) {
    const target = path.join(hooks, name);
    const saved = `${target}${SAVED_SUFFIX}`;
    const current = readOrNull(target);
    let chained = false;
    if (current !== null && !current.includes(HOOK_MARKER)) {
      const earlier = readOrNull(saved);
      if (earlier !== null && earlier !== current) {
        throw new InstallError(`${name}: a hook is already saved as ${name}${SAVED_SUFFIX} and a different one is in place; nothing was overwritten. Merge them by hand, then run the installer again.`);
      }
      try { fs.renameSync(target, saved); }
      catch (error) { throw new InstallError(`${name}: the existing hook could not be moved aside (${error.code || 'error'}).`); }
      chained = true;
    } else if (readOrNull(saved) !== null) {
      chained = true;
    }
    writeFile(target, hookText(name), 0o755);
    return chained ? `Hook installed: ${name} (the earlier hook runs after it).` : `Hook installed: ${name}.`;
  }

  // Drift report; changes nothing.
  check() {
    const { top, hooks } = this.locate();
    const problems = [];
    const copy = vendoredState(readOrNull(path.join(top, VENDORED_PATH)));
    if (copy.state !== 'current') problems.push(`guard copy ${VENDORED_PATH}: ${copy.state}`);
    if (!fs.existsSync(path.join(top, CONFIG_PATH))) problems.push(`config ${CONFIG_PATH}: missing`);
    for (const name of HOOKS) {
      const text = readOrNull(path.join(hooks, name));
      if (text === null) problems.push(`hook ${name}: missing from ${hooks}`);
      else if (!text.includes(HOOK_MARKER)) problems.push(`hook ${name}: not the guard's hook`);
      else if (!text.includes(`guard=${GUARD_VERSION} `)) problems.push(`hook ${name}: outdated`);
    }
    if (problems.length) {
      for (const problem of problems) this.#say(`Drift: ${problem}`);
      return 1;
    }
    this.#say(`No drift: guard v${GUARD_VERSION}, config and hooks in ${hooks}.`);
    return 0;
  }
}

function readOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new InstallError(`${file} could not be read (${error.code || 'error'}).`);
  }
}

function writeFile(file, text, mode) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, mode ? { mode } : undefined);
    if (mode) fs.chmodSync(file, mode);
  } catch (error) {
    throw new InstallError(`${file} could not be written (${error.code || 'error'}), so the guard is not installed.`);
  }
}

function main(argv, { out = process.stdout, err = process.stderr, spawn = spawnSync } = {}) {
  const options = { repo: process.cwd(), identity: null, identityReason: null, requiredCheck: 'none', workflow: false, check: false };
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      const value = () => {
        const next = argv[index + 1];
        if (next === undefined) throw new InstallError(`${arg} needs a value.`);
        index += 1;
        return next;
      };
      if (arg === '--repo') options.repo = path.resolve(value());
      else if (arg === '--identity') options.identity = value();
      else if (arg === '--identity-reason') options.identityReason = value();
      else if (arg === '--required-check') options.requiredCheck = value();
      else if (arg === '--workflow') options.workflow = true;
      else if (arg === '--check') options.check = true;
      else throw new InstallError(`Unknown option ${arg}.`);
    }
    const installer = new GuardInstaller({ repo: options.repo, spawn, out });
    if (options.check) return installer.check();
    installer.install(options);
    return 0;
  } catch (error) {
    const message = error instanceof InstallError || (error && error.name === 'GuardError') ? error.message : `internal error (${error && error.name ? error.name : 'unknown'})`;
    err.write(`Not installed: ${message}\n`);
    return 2;
  }
}

module.exports = Object.freeze({ GuardInstaller, HOOKS, HOOK_MARKER, hookText, main, vendoredState, vendoredText });

if (require.main === module) process.exitCode = main(process.argv.slice(2));
