#!/usr/bin/env node
'use strict';

const path = require('node:path');

const WINDOWS_SHELL_META = /([()%!^"<>&|;, *?])/g;

function validateExecutable(value, platform = process.platform) {
  const command = String(value || '');
  if (!command || command !== command.trim() || /[\0\r\n"]/.test(command)) {
    throw new Error('Claude CLI executable is empty, ambiguous, or contains unsafe characters.');
  }
  const pathLike = /[\\/]/.test(command);
  if (!pathLike && !/^[A-Za-z0-9_.-]+$/.test(command)) {
    throw new Error('Bare Claude CLI executable names may contain only letters, digits, dot, underscore, and hyphen.');
  }
  if (platform === 'win32' && pathLike && !path.win32.isAbsolute(command)) {
    throw new Error('An explicit Windows Claude CLI path must be absolute.');
  }
  return command;
}

function quoteWindowsArgument(value, doubleEscapeMeta = false) {
  let argument = String(value);
  argument = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  argument = argument.replace(/(?=(\\+?)?)\1$/g, '$1$1');
  argument = `"${argument}"`.replace(WINDOWS_SHELL_META, '^$1');
  return doubleEscapeMeta ? argument.replace(WINDOWS_SHELL_META, '^$1') : argument;
}

function escapeWindowsCommand(value) {
  return String(value).replace(WINDOWS_SHELL_META, '^$1');
}

function claudeSpawnParts(executable, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const command = validateExecutable(executable, platform);
  const extension = path.extname(command).toLowerCase();
  if (['.js', '.cjs', '.mjs'].includes(extension)) {
    return { command: process.execPath, args: [command, ...args], shell: false, windowsVerbatimArguments: false, raw_executable: command };
  }
  if (platform !== 'win32' || extension === '.exe') {
    return { command, args: [...args], shell: false, windowsVerbatimArguments: false, raw_executable: command };
  }
  if (extension && !['.cmd', '.bat'].includes(extension)) {
    throw new Error(`Unsupported Windows Claude CLI executable type: ${extension}`);
  }
  const commandLine = [escapeWindowsCommand(command), ...args.map((arg) => quoteWindowsArgument(arg, true))].join(' ');
  return {
    command: options.comspec || process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/v:off', '/c', `"${commandLine}"`],
    shell: false,
    windowsVerbatimArguments: true,
    raw_executable: command,
  };
}

module.exports = { claudeSpawnParts, escapeWindowsCommand, quoteWindowsArgument, validateExecutable };
