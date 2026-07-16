#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_SHELL_META = /([()%!^"<>&|;, *?])/g;

function claudeCommandCandidates(options = {}) {
  const env = Object.prototype.hasOwnProperty.call(options, 'env') ? options.env : process.env;
  return [...new Set([
    options.explicit,
    env?.AI_AGENT_TOOLKIT_CLAUDE_CLI,
    env?.CLAUDE_TOOLKIT_CLAUDE_CLI,
    env?.CLAUDE_CLI_PATH,
    options.persisted,
    'claude',
  ].filter(Boolean).map(String))];
}

function resolveClaudeCommandInput(options = {}) {
  return claudeCommandCandidates(options)[0];
}

function validateExecutable(value, platform = process.platform) {
  const command = String(value || '');
  if (!command || command !== command.trim() || /[\0\r\n"]/.test(command)) {
    throw new Error('Claude CLI executable is empty, ambiguous, or contains unsafe characters.');
  }
  const pathLike = /[\\/]/.test(command);
  if (!pathLike && !/^[A-Za-z0-9_.-]+$/.test(command)) {
    throw new Error('Bare Claude CLI executable names may contain only letters, digits, dot, underscore, and hyphen.');
  }
  const absolute = platform === 'win32' ? path.win32.isAbsolute(command) : path.posix.isAbsolute(command);
  if (pathLike && !absolute) {
    throw new Error('An explicit Claude CLI path must be absolute.');
  }
  return command;
}

function executableCandidates(command, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (/[\\/]/.test(command)) return [command];
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const directories = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')
    .filter((directory) => directory && pathApi.isAbsolute(directory));
  if (platform !== 'win32') return directories.map((directory) => pathApi.join(directory, command));
  const extensions = path.extname(command)
    ? ['']
    : String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  return directories.flatMap((directory) => extensions.map((extension) => pathApi.join(directory, `${command}${extension}`)));
}

function assertExecutableAvailable(value, options = {}) {
  const platform = options.platform || process.platform;
  const command = validateExecutable(value, platform);
  const candidates = executableCandidates(command, options);
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) continue;
      if (platform !== 'win32' && !['.js', '.cjs', '.mjs'].includes(path.extname(candidate).toLowerCase())) {
        fs.accessSync(resolved, fs.constants.X_OK);
      }
      return !/[\\/]/.test(command) ? candidate : command;
    } catch {}
  }
  throw new Error('Claude CLI executable is not available.');
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
  const validated = validateExecutable(executable, platform);
  const command = assertExecutableAvailable(validated, options);
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

module.exports = { assertExecutableAvailable, claudeCommandCandidates, claudeSpawnParts, escapeWindowsCommand, executableCandidates, quoteWindowsArgument, resolveClaudeCommandInput, validateExecutable };
