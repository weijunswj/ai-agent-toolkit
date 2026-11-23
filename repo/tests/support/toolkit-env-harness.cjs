'use strict';

// The toolkit env test harness: a ToolkitEnv on a stand-in store (no real credentials) in a temp home,
// with the CLI, the questions it asks and the edit helper captured. Shared by the env test files.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FakeEnvStore } = require('./fake-env-store.cjs');
const { EnvEditSession, EnvManifest, EnvPaths, ToolkitEnv, ToolkitEnvCli } = require('../../scripts/toolkit-env.cjs');
const { helperCommand } = require('../../scripts/toolkit-env-feeders.cjs');

function sentinel() { return `dummy-${crypto.randomBytes(9).toString('hex')}`; }

function tempHome(t) {
  // The real path: CI temp folders can be short 8.3 names (Windows) or sit behind a link, and the
  // Codex config backup refuses a config reached through either.
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-test-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// Collects what a command prints.
class Capture {
  constructor() { this.text = ''; }
  write(chunk) { this.text += String(chunk); return true; }
}

function noPrivateDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }

function commandFor(binding) {
  return helperCommand({ nodePath: 'C:/Program Files/nodejs/node.exe', scriptPath: 'C:/Users/Test User/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs', name: binding.name, header: binding.header, scheme: binding.scheme });
}

// environment holds the agent markers a test sets (none by default, whatever runs the tests);
// tty, enters (true for a fresh Enter) and clipboard stand in for the terminal and the clipboard used by show.
function harness(t, { values = {}, answers = [], hidden = [], enters = [], feeders = [], corruptReadBack = [], opener, environment = {}, tty = { stdin: true, stdout: true }, clipboard, scriptPath, clock, helpers = [], startHelper, findApp, cleanCopies } = {}) {
  const home = tempHome(t);
  const paths = new EnvPaths({ homeDir: home, environment: {} });
  const store = new FakeEnvStore({ values, corruptReadBack });
  const asked = [];
  const now = clock ? () => new Date(clock.ms) : () => new Date();
  const env = new ToolkitEnv({
    environment,
    now,
    tty: () => tty,
    askTerminal: async (effect) => { asked.push(effect); return enters.shift() ?? false; },
    clipboard: clipboard || (() => { throw new Error('the clipboard is not used in this test'); }),
    ...(scriptPath ? { scriptPath } : {}),
    ...(findApp ? { findApp } : {}),
    ...(cleanCopies ? { cleanCopies } : {}),
    store,
    manifest: new EnvManifest({ file: paths.manifest, now }),
    editSession: new EnvEditSession({
      directory: paths.editDir, opener: opener || (async () => true), privateDirectory: noPrivateDirectory, now,
      startHelper: startHelper || ((file) => { helpers.push(file); return true; }),
    }),
    feeders,
    paths,
    ask: async (question, effect) => { asked.push(effect ? `${question} [${effect}]` : question); return answers.shift() ?? ''; },
    askHidden: async (question) => { asked.push(question); return hidden.shift() ?? ''; },
    commandFor,
  });
  const run = async (...argv) => {
    const stdout = new Capture();
    const stderr = new Capture();
    const code = await new ToolkitEnvCli({ env, stdout, stderr }).main(argv);
    return { code, stdout: stdout.text, stderr: stderr.text };
  };
  return { home, paths, store, env, run, asked, helpers };
}

function editFile(paths) {
  return path.join(paths.editDir, fs.readdirSync(paths.editDir).find((name) => name.endsWith('.env')));
}

function editFiles(paths) {
  try { return fs.readdirSync(paths.editDir).filter((name) => name.endsWith('.env')); } catch { return []; }
}

// The lines of an edit file below its header.
function bodyOf(text) { return text.split(/\r?\n/).filter((line) => line && !/^# (Toolkit env|While this tab|Close any|Change a value|Each save|A line showing|Your own|When you are|Status:)/.test(line)); }

function clockAt(iso = '2026-10-31T09:00:00.000Z') { return { ms: Date.parse(iso) }; }

// What a save in Notepad does to the file: new bytes, a new modified time.
function save(file, text) {
  fs.writeFileSync(file, text);
  const later = new Date(fs.statSync(file).mtimeMs + 1000);
  fs.utimesSync(file, later, later);
}

function storeImage(h) { return JSON.stringify(h.store.list().map((name) => [name, h.store.peek(name)])); }

function editState(paths) { return JSON.parse(fs.readFileSync(path.join(paths.editDir, 'session.json'), 'utf8')); }

module.exports = {
  Capture, bodyOf, clockAt, commandFor, editFile, editFiles, editState, harness, noPrivateDirectory, save, sentinel, storeImage, tempHome,
};
