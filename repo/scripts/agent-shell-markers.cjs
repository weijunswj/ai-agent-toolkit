'use strict';

// Every name set (non-empty) in a shell a coding agent started, for the owner-only commands that no hook loads
// (governance answers, toolkit env show, the governance App setup, the programme's owner Enter): owner-terminal's
// list, plus the Claude desktop app's own mark of a Terminal panel tab Claude opened, which carries none of the
// others. The app does not set that mark in a tab the owner opens there (read in the app's code, 7.37095.0).
// It is not in owner-terminal.cjs because the hooks of every harness load that file, and a shared hook module
// holds no one harness's names (hook design playbook); nor in agent-host-markers.cjs, because it decides only
// who answers, never which app started setup. An Enter prompt that only owner-terminal.cjs guards still cannot be
// answered by an agent in such a tab: the app types nothing into a tab that is running something.

const { AGENT_MARKERS } = require('./owner-terminal.cjs');

const AGENT_SHELL_MARKERS = Object.freeze([...AGENT_MARKERS, 'CLAUDE_CODE_LAUNCHED_BY_SESSION_IDS']);

module.exports = Object.freeze({ AGENT_SHELL_MARKERS });
