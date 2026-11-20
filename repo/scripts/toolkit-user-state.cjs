'use strict';

// Resolves private operational state, never a governance decision. Overrides are test-only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function userStateDirectory(options = {}) {
  const overridden = ['stateDirectory', 'registryPath', 'userHome'].some(key => options[key] !== undefined);
  if (overridden && options.testOnly !== true) throw Object.assign(new Error('STATE_PATH_OVERRIDE_FORBIDDEN'), { code: 'STATE_PATH_OVERRIDE_FORBIDDEN' });
  // registryPath is retained only for existing isolated test fixtures, never opened.
  const directory = options.stateDirectory ?? (options.registryPath === undefined ? null : path.dirname(options.registryPath));
  const home = options.userHome ?? os.homedir();
  const value = directory ?? path.join(home, '.ai-agent-toolkit', 'user-state');
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Object.assign(new Error('STATE_PATH_INVALID'), { code: 'STATE_PATH_INVALID' });
  return path.normalize(value);
}

// The path of a Toolkit file that messages name for the owner or an agent to run, given from the
// Toolkit root: the managed checkout's copy (the bridge records it as repo_path in
// ~/.ai-agent-toolkit/current/state.json) when it holds the file, else this copy's. A desktop app runs
// Toolkit from its own synced plugin folder, whose path changes with each update, so a command built
// from it goes stale. The path is the one toolkit permissions pins its lines to (safePath: forward
// slashes, only plain characters), so the command shown and the owner's permission line match byte
// for byte; any other recorded path is never used.
function managedToolkitFile(relative, { userHome = os.homedir() } = {}) {
  const own = path.join(__dirname, '..', '..', ...relative.split('/'));
  let recorded = '';
  try { recorded = JSON.parse(fs.readFileSync(path.join(userHome, '.ai-agent-toolkit', 'current', 'state.json'), 'utf8')).repo_path; } catch { return own; }
  const safe = require('./toolkit-permissions.cjs').safePath(recorded, process.platform);
  if (!safe) return own;
  const managed = `${safe}/${relative}`;
  return fs.existsSync(managed) ? managed : own;
}

function managedScript(name, options) { return managedToolkitFile(`repo/scripts/${name}`, options); }

// The programme script sits with its skill, not in repo/scripts with most Toolkit scripts, so a bare
// "programme.cjs" in a hint once sent a session looking in the wrong folder (it said the script was
// missing). Every hint a session on this computer reads names the runnable command through
// programmeCommand. Text kept on GitHub or in the evidence store is read on other computers, so it
// names PROGRAMME_SCRIPT from the Toolkit root instead.
const PROGRAMME_SCRIPT = 'skills/github-program-reconciler/scripts/programme.cjs';
function programmeCommand(args, options) { return `node "${managedToolkitFile(PROGRAMME_SCRIPT, options)}" ${args}`; }

module.exports = Object.freeze({ userStateDirectory, managedScript, PROGRAMME_SCRIPT, programmeCommand });
