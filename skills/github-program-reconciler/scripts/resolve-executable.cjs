'use strict';

const fs = require('node:fs');
const path = require('node:path');

class ProgrammeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// Resolves an executable to a full path from absolute PATH entries, skipping the working folder
// (Windows looks there first for a bare name) and, on Windows, anything but `.exe`.
function resolveExecutable(name, { environment = process.env, platform = process.platform, cwd = process.cwd(), exists = fs.existsSync } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const file = platform === 'win32' ? `${name}.exe` : name;
  const raw = environment.PATH ?? environment.Path ?? '';
  const here = api.resolve(cwd).toLowerCase();
  for (const entry of String(raw).split(platform === 'win32' ? ';' : ':')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !api.isAbsolute(dir) || api.resolve(dir).toLowerCase() === here) continue;
    const candidate = api.join(dir, file);
    if (exists(candidate)) return candidate;
  }
  throw new ProgrammeError('EXECUTABLE_NOT_FOUND', `${name} was not found on PATH. Install it or add its folder to PATH.`);
}

module.exports = { ProgrammeError, resolveExecutable };
