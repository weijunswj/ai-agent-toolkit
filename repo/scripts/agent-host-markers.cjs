'use strict';

// Environment variables a coding agent sets (non-empty) in the shells it starts. Exact names only:
// a whole prefix such as CODEX_ or CLAUDE_ would also match CODEX_HOME or CLAUDE_CONFIG_DIR in the
// owner's own profile.
const HOST_MARKERS = Object.freeze({
  'claude-code': Object.freeze(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']),
  codex: Object.freeze(['CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'])
});
const AGENT_HOST_MARKER_NAMES = Object.freeze([...HOST_MARKERS['claude-code'], ...HOST_MARKERS.codex]);
const HOST_LABELS = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex' });

// 'claude-code' or 'codex' when only that app's markers are set, else 'unknown'. Both apps' markers
// together (one app started from the other's shell) stay 'unknown' rather than a guess.
function detectAgentHost(environment = process.env) {
  const found = Object.keys(HOST_MARKERS).filter((host) => HOST_MARKERS[host].some((name) => Boolean(environment[name])));
  return found.length === 1 ? found[0] : 'unknown';
}

module.exports = { HOST_MARKERS, AGENT_HOST_MARKER_NAMES, HOST_LABELS, detectAgentHost };
