'use strict';

// A fixture Codex app-server that reads any config: used so config load checks in tests never start a real
// Codex found on this machine's PATH. Name it first with CODEX_TOOLKIT_CODEX_CLI (see useFakeConfigReader).
const fs = require('node:fs');
const path = require('node:path');

function useFakeConfigReader() {
  const fixture = path.join(__dirname, 'fake-codex-config-reader.cjs');
  process.env.CODEX_TOOLKIT_CODEX_CLI = fixture;
  process.env.CODEX_CLI_PATH = fixture;
  // Runtime detection tries later candidates after a refused method. Exclude installed Codex
  // folders as well, so an unknown fixture result never starts the real PATH program.
  for (const key of Object.keys(process.env).filter(key => /^path$/i.test(key))) {
    process.env[key] = process.env[key].split(path.delimiter).filter(directory =>
      !['', '.exe', '.com', '.cmd', '.bat'].some(extension =>
        fs.existsSync(path.join(directory.replace(/^"(.*)"$/, '$1'), 'codex' + extension)))).join(path.delimiter);
  }
}

if (require.main === module) {
  const rl = require('node:readline').createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
    else if (request.method === 'config/read') process.stdout.write(JSON.stringify({ id: request.id, result: { config: {} } }) + '\n');
    else if (request.id !== undefined) process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32601, message: 'Unsupported fixture method' } }) + '\n');
  });
}

module.exports = { useFakeConfigReader };
