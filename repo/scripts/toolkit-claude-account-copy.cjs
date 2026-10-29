'use strict';

// The Claude desktop app runs the Toolkit copy from the user's claude.ai account, and only
// claude.ai updates it. This module finds the app's account-plugin folders and holds the one text
// that tells the owner how to bring that copy up to date: the session-start reminder, the install
// check and setup use it from here, and a test keeps the daily check-in task's steps equal to
// STEPS_TEXT. It loads nothing but Node's own modules, so the session-start hook can use it.

const fs = require('node:fs');
const path = require('node:path');

// The Claude desktop app keeps plugins from the user's claude.ai account in
// %LOCALAPPDATA%\Claude-Data\claude_<package>\rpm\<a>\<b>\, with a manifest.json listing each plugin's id.
// Returns those folders, or [] when the app is not installed. Read only.
function claudeAccountPluginFolders(environment = process.env) {
  const base = environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'Claude-Data') : '';
  const folders = [];
  const children = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { return []; } };
  for (const app of children(base).filter((entry) => entry.name.startsWith('claude_'))) {
    const rpm = path.join(base, app.name, 'rpm');
    for (const first of children(rpm)) for (const second of children(path.join(rpm, first.name))) folders.push(path.join(rpm, first.name, second.name));
  }
  // In name order, so every reader sees the same first copy whatever order the disk lists them in.
  return folders.sort();
}

const STEPS = Object.freeze([
  'On claude.ai, open Customize > Plugins, open the ai-agent-toolkit marketplace, check that Sync automatically is on, and click Check for updates.',
  'If it is still behind, remove only the ai-agent-toolkit plugin on claude.ai in a web browser (not the marketplace), and let it reinstall.',
  'If it is still stuck, remove the marketplace and add weijunswj/ai-agent-toolkit again with Sync automatically on.',
  'Then fully quit and reopen the Claude app and start a new chat. Open chats keep the old copy.',
]);

const STEPS_TEXT = STEPS.map((step, index) => `${index + 1}. ${step}`).join(' ');

// The notice for an account copy older than this PC's Toolkit, naming both versions.
function accountCopyBehind(accountVersion, localVersion) {
  return `The Toolkit copy from your claude.ai account is ${accountVersion}; this PC has ${localVersion}. The Claude app runs the account copy, and only claude.ai updates it: ${STEPS_TEXT}`;
}

function isOlder(left, right) {
  const valid = (value) => /^\d+\.\d+\.\d+$/.test(value || '');
  if (!valid(left) || !valid(right)) return false;
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// Setup's line for the Claude app: setup cannot update the account copy, and when it is behind,
// the install check's "Claude app account copy" row gives the steps.
function claudeAppCopyLine(accountVersion, localVersion) {
  if (!accountVersion) return 'no claude.ai copy found on this PC';
  const line = `claude.ai copy ${accountVersion}, which only claude.ai updates`;
  return isOlder(accountVersion, localVersion)
    ? `${line}; it is behind this PC, so follow the "Claude app account copy" steps under Install check`
    : line;
}

module.exports = Object.freeze({ STEPS, STEPS_TEXT, claudeAccountPluginFolders, accountCopyBehind, claudeAppCopyLine });
