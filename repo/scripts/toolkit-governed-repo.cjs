'use strict';

// One answer, shared by the Claude and Codex helper hooks, to "does Toolkit V3 govern
// helper launches in this working directory?". Ordinary and ungoverned work gets no
// restriction, so both hooks return no decision there.
//
// Governed when either holds:
//   - a launcher marker is present in the hook environment (a Toolkit launcher started
//     this session for a gate, a pinned task profile or a pinned helper binding, which
//     must hold wherever it is supplied);
//   - the repository's governance state (toolkit-governance-state.cjs, the single authority)
//     is ENABLED with the governed rules in force: the TOOLKIT-GOVERNED-RULES block and a
//     valid programme binding, and the user has not declined. A DECLINED, UNKNOWN or
//     incomplete repository is not governed here; an UNKNOWN one is held by the
//     governance gate before any helper launch is reached.
// The `managedBlock: false` option keeps a host whose helper policy is only qualified inside
// Toolkit itself to Toolkit checkouts: Codex keeps native helpers in other governed
// repositories until its own allow-list exists (#469). The walk stops at the first `.git`
// (a directory, or the file a worktree uses). Node built-ins only, no subprocess. Without a
// launcher marker, an error is ungoverned.

const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']);
const GATE_ROLES = Object.freeze(['G0', 'G1', 'G2']);
// Stable files every Toolkit checkout carries; documentation paths are not used.
const CHECKOUT_FILES = Object.freeze([
  ['repo', 'contracts', 'toolkit-local-bridge', 'version.json'],
  ['skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'],
]);

class GovernedRepoPredicate {
  #environment; #managedBlock; #registryOptions;
  constructor(environment = process.env, { managedBlock = true, registryOptions = {} } = {}) {
    this.#environment = environment || {};
    this.#managedBlock = managedBlock !== false;
    this.#registryOptions = registryOptions;
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

  static #isToolkitCheckout(root) {
    return CHECKOUT_FILES.every(parts => fs.existsSync(path.join(root, ...parts)));
  }

  // { governed, reason, root, marker, gate_role, state }
  evaluate(cwd) {
    const marker = this.launcherMarker();
    const gate_role = this.gateRole();
    const result = (governed, reason, root = null, state = null) => Object.freeze({ governed, reason, root, marker, gate_role, state });
    let root;
    try {
      root = GovernedRepoPredicate.gitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd());
      if (marker) return result(true, 'launcher-marker', root);
      if (!root) return result(false, 'no-git-root');
      const state = require('./toolkit-governance-state.cjs').governanceState(root, this.#registryOptions);
      if (state.state !== 'ENABLED' || !state.governed_rules_bind) return result(false, `governance-${state.state === 'ENABLED' ? 'incomplete' : state.state.toLowerCase()}`, root, state.state);
      if (!this.#managedBlock) {
        return GovernedRepoPredicate.#isToolkitCheckout(root) ? result(true, 'toolkit-checkout', root, state.state) : result(false, 'outside-toolkit', root, state.state);
      }
      return result(true, 'governance-enabled', root, state.state);
    } catch {
      return marker ? result(true, 'launcher-marker', root || null) : result(false, 'predicate-error');
    }
  }
}

function governedRepo(cwd, environment = process.env, options = {}) { return new GovernedRepoPredicate(environment, options).evaluate(cwd); }

module.exports = Object.freeze({ GovernedRepoPredicate, governedRepo, LAUNCHER_MARKERS });
