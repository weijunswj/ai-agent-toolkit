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

function validateExecutable(value, platform = process.platform, label = 'Claude CLI') {
  const command = String(value || '');
  if (!command || command !== command.trim() || /[\0\r\n"]/.test(command)) {
    throw new Error(`${label} executable is empty, ambiguous, or contains unsafe characters.`);
  }
  const pathLike = /[\\/]/.test(command);
  if (!pathLike && !/^[A-Za-z0-9_.-]+$/.test(command)) {
    throw new Error(`Bare ${label} executable names may contain only letters, digits, dot, underscore, and hyphen.`);
  }
  const absolute = platform === 'win32' ? path.win32.isAbsolute(command) : path.posix.isAbsolute(command);
  if (pathLike && !absolute) {
    throw new Error(`An explicit ${label} path must be absolute.`);
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
  const label = options.label || 'Claude CLI';
  const command = validateExecutable(value, platform, label);
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
  throw new Error(`${label} executable is not available.`);
}

// A bare program name such as `git`: on Windows, Node searches the current folder before PATH, so a
// git.exe planted in the working folder would run. Return the .exe from PATH's absolute folders
// instead (throws when there is none). Other platforms search PATH only, so the name stays bare.
function resolvePathExecutable(name, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return name;
  return assertExecutableAvailable(path.extname(name) ? name : `${name}.exe`, { ...options, platform, label: options.label || name });
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

// The program a Windows npm command shim (cmd-shim format) starts, so it can run without cmd.exe:
// a native .exe it calls, or node with the package's script. null when the shim is not one.
function npmShimTarget(shim) {
  let text;
  try { text = fs.readFileSync(shim, 'utf8'); } catch { return null; }
  const line = text.split(/\r?\n/).reverse().find((entry) => /%\*\s*$/.test(entry));
  if (!line) return null;
  const quoted = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  const base = path.dirname(shim);
  const local = (value) => (/^%dp0%\\/i.test(value) ? path.join(base, value.slice(6)) : null);
  if (quoted[0] === '%_prog%' && quoted[1]) {
    const script = local(quoted[1]);
    const bundledNode = path.join(base, 'node.exe');
    return script ? { command: fs.existsSync(bundledNode) ? bundledNode : process.execPath, prefix: [script] } : null;
  }
  const program = quoted[0] && local(quoted[0]);
  return program && path.extname(program).toLowerCase() === '.exe' ? { command: program, prefix: [] } : null;
}

// How to start a program found on PATH (or by absolute path) directly, with no shell: .exe and
// POSIX programs as they are, scripts through this Node.js, and Windows npm command shims through
// the program they wrap. Other Windows command scripts are refused. options.label names it in errors.
function directSpawnParts(executable, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const label = options.label || 'Program';
  const command = assertExecutableAvailable(validateExecutable(executable, platform, label), { ...options, label });
  const extension = path.extname(command).toLowerCase();
  if (['.js', '.cjs', '.mjs'].includes(extension)) return { command: process.execPath, args: [command, ...args] };
  if (platform !== 'win32' || extension === '.exe' || extension === '.com') return { command, args: [...args] };
  const target = ['.cmd', '.bat'].includes(extension) ? npmShimTarget(command) : null;
  if (!target || !fs.existsSync(target.command) || !target.prefix.every((file) => fs.existsSync(file))) {
    throw new Error(`${label} ${path.basename(command)} is a Windows command script that is not a standard npm shim, so it cannot be started without cmd.exe.`);
  }
  return { command: target.command, args: [...target.prefix, ...args] };
}

module.exports = { assertExecutableAvailable, claudeCommandCandidates, claudeSpawnParts, directSpawnParts, resolveClaudeCommandInput, resolvePathExecutable, validateExecutable };
