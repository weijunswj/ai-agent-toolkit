'use strict';

// The one line a session start gives when its governance check crashed. Plug and play delivers the
// Toolkit-governed rules only through that check, so a crash that printed nothing would leave a
// governed repository's session without its rules and without saying so. The line names the rules
// file of the Toolkit copy that runs, so the session can still read them. Session start stays fail
// open: this never blocks, and it says nothing outside a git repository, where no governed rules apply.
// No dependencies beyond Node, so it still loads when the governance modules do not.

const fs = require('node:fs');
const path = require('node:path');

const RULES_FILE = path.resolve(__dirname, '..', 'contracts', 'agent-rules', 'toolkit-governed-rules.md');

// Whether `cwd` is inside a git working tree: a `.git` folder or file in it or a parent folder.
function insideGitRepository(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  let dir = path.resolve(cwd);
  for (;;) {
    try { fs.lstatSync(path.join(dir, '.git')); return true; } catch { /* keep looking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// The error's kind only (a code such as ENOENT or a class name such as TypeError), never its
// message, which may carry paths or contents.
function errorKind(error) {
  for (const value of [error && error.code, error && error.name]) {
    if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(value)) return value;
  }
  return 'error';
}

// The line for a crashed check at session start in `cwd`, or '' outside a git repository.
function sessionStartLine(cwd, error) {
  if (!insideGitRepository(cwd)) return '';
  return `Toolkit couldn't load the governance check at this session start (${errorKind(error)}). Continue with the global rules. If this repository is governed, read the Toolkit-governed rules at ${RULES_FILE} and follow them; say \`setup toolkit\` to repair the plugin.`;
}

module.exports = Object.freeze({ RULES_FILE, errorKind, insideGitRepository, sessionStartLine });
