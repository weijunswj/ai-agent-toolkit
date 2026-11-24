#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook: refuses an agent tool call that reads, writes, searches or lists the Toolkit env edit
// folder (`~/.ai-agent-toolkit/env/edit/`). The edit file there holds the user's real key values while an edit is
// open, so an agent opening it would put every value in the chat. Only `toolkit env edit`, `apply` and `status` work
// with that folder; an agent runs those commands and never touches the folder itself.
//
// It matches paths, never intent: a file tool's path field (`file_path`, `path`, `notebook_path`, and Glob's
// `pattern`), or a shell or Monitor command's text, that names the edit folder (its separators may be slashes,
// backslashes or quoted path pieces such as `'.ai-agent-toolkit', 'env', 'edit'`), an edit file name
// (`env-edit-<id>.env`, or an earlier `.txt` one), or the env folder itself as a whole (a listing or search there
// reaches the edit folder). Reading `~/.ai-agent-toolkit/env/manifest.json` (names only) and running
// `toolkit-env.cjs` pass. Text being written (Edit and Write content) and Grep's search text are never read, so
// editing a document that mentions the folder passes.
//
// Accepted gaps (an agent slip is the risk, not a determined program): a relative path after changing folder
// (`cd ~/.ai-agent-toolkit` then `cat env/edit/...`), a path built in a variable or from pieces further apart, a
// search rooted above the env folder (the home folder or `~/.ai-agent-toolkit`), short or linked folder names,
// the saved copies an editor keeps elsewhere, and tools outside its matcher that take a local path (an MCP
// file tool, an artifact publish or a send-file call). It may wrongly stop a shell command that only mentions the
// folder as text, such as `grep -rn ".ai-agent-toolkit/env/edit" repo` or a commit message naming it; use the Grep
// tool or a message file instead.
//
// Its own failure: a call it cannot read passes, except one whose raw input names the env folder or an edit file,
// which is refused, because the effect leaks values. Registered without `onFailure: "block"`, so a hook process that
// cannot start never stops other tool calls. Claude Code only: Codex runs its own hooks.
const fs = require('node:fs');

const REASON = 'Toolkit: the env edit folder (~/.ai-agent-toolkit/env/edit/) holds the user\'s real key values, so agents never read, write, search or list it. Run `toolkit env edit`, `status` or `apply` instead; the user types in the edit file themselves.';

// The edit folder, with up to six separator characters between its pieces (slashes, quotes, commas, spaces).
const EDIT_FOLDER = /\.ai-agent-toolkit[^\w\r\n]{1,6}env[^\w\r\n]{1,6}edit(?![\w-])/i;
// An edit file name, current or earlier, or a wildcard for one (`env-edit-*.env`).
const EDIT_FILE = /env-edit-[A-Za-z0-9*?[\]-]+\.(?:env|txt)(?![\w])/i;
// The env folder as a whole: not followed by a further path piece (manifest.json passes).
const ENV_FOLDER = /\.ai-agent-toolkit[\\/]+env[\\/]*(?![\w.\\/-])/i;
// The same screen on raw hook input, where JSON doubles backslashes.
const RAW = /\.ai-agent-toolkit[^\w\r\n]{1,8}env(?:[^\w\r\n]{1,8}edit(?![\w-])|[\\/"']*(?![\w.\\/-]))|env-edit-[A-Za-z0-9-]+\.(?:env|txt)/i;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'];

function namesEditFolder(text) {
  return typeof text === 'string' && (EDIT_FOLDER.test(text) || EDIT_FILE.test(text) || ENV_FOLDER.test(text));
}

// The strings a call would act on: a shell command, or a file tool's path fields (Glob's pattern is a path too).
function targets(input) {
  const tool = String(input?.tool_name || '');
  const args = input?.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (SHELL_TOOLS.has(tool)) return [args.command];
  const out = PATH_FIELDS.map((field) => args[field]);
  if (tool === 'Glob') out.push(args.pattern);
  if (tool === 'Grep') out.push(args.glob);
  return out;
}

function decide(input) {
  return targets(input).some(namesEditFolder);
}

function refuse() {
  const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } };
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.stderr.write(`${REASON}\n`);
  return 2;
}

function main(read = () => fs.readFileSync(0, 'utf8'), check = decide) {
  let raw = '';
  try { raw = read() || ''; } catch { return 0; }
  try { return check(JSON.parse(raw || '{}')) ? refuse() : 0; }
  catch { return RAW.test(raw) ? refuse() : 0; }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, decide, namesEditFolder, REASON };
