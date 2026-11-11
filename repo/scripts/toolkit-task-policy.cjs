'use strict';

// This list is used by the planner. Adding a job here does
// not enrol it or grant approval: the health job is computer-wide and the footer job is per repository.
const INDEPENDENT_JOBS = Object.freeze(['footer-sweep', 'task-health']);
const GOVERNED_JOBS = Object.freeze(['programme-sweep', 'shard-timings']);
const COMMANDS = Object.freeze(['plan', 'apply', 'remove', 'list']);
const STANDING_APPROVAL = 'standing approval with verified ownership';

// A deliberately small command subset, never shell execution. No operators, variables,
// escapes, wrappers, redirection or extra flags can inherit the task exception.
function independentTaskCommand(text, { home = require('node:os').homedir(), cwd = process.cwd(), certainIndependent = () => false } = {}) {
  const fs = require('node:fs'), path = require('node:path');
  if (typeof text !== 'string' || /[\r\n$`%;|&<>#(){}]/.test(text)) return false;
  const words = [];
  const pattern = /\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"']+))/gy;
  let at = 0, match;
  while ((match = pattern.exec(text))) { words.push(match[1] ?? match[2] ?? match[3]); at = pattern.lastIndex; }
  if (text.slice(at).trim() || words.length < 2 || !/^(?:node|node\.exe)$/i.test(words[0])) return false;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), 'utf8'));
    if (typeof state.repo_path !== 'string' || !path.isAbsolute(state.repo_path)) return false;
    const root = fs.realpathSync(state.repo_path);
    const script = path.normalize(words[1]);
    if (!path.isAbsolute(script)) return false;
    const names = ['toolkit-windows-tasks.cjs', 'toolkit-tasks.cjs'];
    if (!names.some(name => script === path.join(root, 'repo', 'scripts', name))) return false;
    if (fs.realpathSync(script) !== script) return false;
    const windows = path.basename(script) === names[0];
    const implicitList = !windows && (!words[2] || words[2] === '--json');
    const command = implicitList ? 'list' : words[2];
    if (!COMMANDS.includes(command) || !windows && command !== 'list') return false;
    const args = words.slice(implicitList ? 2 : 3);
    let target = cwd;
    if (windows && args[0] === '--repo-root' && path.isAbsolute(args[1] || '')) { target = args[1]; args.splice(0, 2); }
    if (args[0] === '--json') args.shift();
    if (args.length) return false;
    // The task CLI rechecks the binding and full ownership before any effect. The hold
    // still requires a fresh independent shape, so an ON repository cannot use this exit.
    return certainIndependent(target, command, INDEPENDENT_JOBS);
  } catch { return false; }
}

module.exports = { INDEPENDENT_JOBS, GOVERNED_JOBS, COMMANDS, STANDING_APPROVAL, independentTaskCommand };
