'use strict';

// One answer, shared by the Claude and Codex helper hooks, to "does Toolkit V3 govern
// helper launches in this working directory?". Ordinary and ungoverned work gets no
// restriction, so both hooks return no decision there.
//
// Governed when any of these holds:
//   - a launcher marker is present in the hook environment (a Toolkit launcher started
//     this session for a gate, a pinned task profile or a pinned helper binding);
//   - the nearest git root's AGENTS.md carries the managed GLOBAL-AGENTS.MD-TEMPLATE block;
//   - the nearest git root is a Toolkit source checkout.
// The managed-block test can be turned off (`managedBlock: false`) for a host whose
// helper policy is only qualified inside Toolkit itself: Codex keeps native helpers in
// repositories that merely carry the managed block until its own allow-list exists (#469).
// The walk stops at the first `.git` (a directory, or the file a worktree uses). Node
// built-ins only. A read error never gates on its own: without a launcher marker the
// result is ungoverned.

const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']);
const GATE_ROLES = Object.freeze(['G0', 'G1', 'G2']);
const GOVERNED_BLOCK = /^<!-- AI-AGENT-TOOLKIT:[^\r\n]*:BEGIN GLOBAL-AGENTS\.MD-TEMPLATE v\d+ -->\r?$/m;
// Stable files every Toolkit checkout carries; documentation paths are not used.
const CHECKOUT_FILES = Object.freeze([
  ['repo', 'contracts', 'toolkit-local-bridge', 'version.json'],
  ['skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'],
]);
const AGENTS_READ_LIMIT = 1024 * 1024;

class GovernedRepoPredicate {
  #environment; #managedBlock;
  constructor(environment = process.env, { managedBlock = true } = {}) {
    this.#environment = environment || {};
    this.#managedBlock = managedBlock !== false;
  }

  // The gate role a Toolkit launcher declared for this session, if any.
  gateRole() {
    const role = this.#environment.TOOLKIT_GATE_ROLE;
    return GATE_ROLES.includes(role) ? role : null;
  }

  launcherMarker() {
    return LAUNCHER_MARKERS.find(name => typeof this.#environment[name] === 'string' && this.#environment[name] !== '') || null;
  }

  static gitRoot(start) {
    let current = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(current, '.git'))) return current;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }

  static #hasGovernedBlock(root) {
    const file = path.join(root, 'AGENTS.md');
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, AGENTS_READ_LIMIT));
      fs.readSync(handle, buffer, 0, buffer.length, 0);
      return GOVERNED_BLOCK.test(buffer.toString('utf8'));
    } finally { fs.closeSync(handle); }
  }

  static #isToolkitCheckout(root) {
    return CHECKOUT_FILES.every(parts => fs.existsSync(path.join(root, ...parts)));
  }

  // { governed, reason, root, marker, gate_role }
  evaluate(cwd) {
    const marker = this.launcherMarker();
    const gate_role = this.gateRole();
    const result = (governed, reason, root = null) => Object.freeze({ governed, reason, root, marker, gate_role });
    let root;
    try {
      root = GovernedRepoPredicate.gitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd());
      if (marker) return result(true, 'launcher-marker', root);
      if (!root) return result(false, 'no-git-root');
      if (this.#managedBlock && GovernedRepoPredicate.#hasGovernedBlock(root)) return result(true, 'managed-agents-block', root);
      if (GovernedRepoPredicate.#isToolkitCheckout(root)) return result(true, 'toolkit-checkout', root);
      return result(false, 'ungoverned-repository', root);
    } catch {
      return marker ? result(true, 'launcher-marker', root || null) : result(false, 'predicate-error');
    }
  }
}

function governedRepo(cwd, environment = process.env, options = {}) { return new GovernedRepoPredicate(environment, options).evaluate(cwd); }

module.exports = Object.freeze({ GovernedRepoPredicate, governedRepo, LAUNCHER_MARKERS });
