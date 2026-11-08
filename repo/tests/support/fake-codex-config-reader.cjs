'use strict';

// A fixture Codex app-server that reads any config: used so config load checks in tests never start a real
// Codex found on this machine's PATH. Name it first with CODEX_TOOLKIT_CODEX_CLI (see useFakeConfigReader).
const path = require('node:path');

function useFakeConfigReader() {
  process.env.CODEX_TOOLKIT_CODEX_CLI = path.join(__dirname, 'fake-codex-config-reader.cjs');
}

if (require.main === module) {
  const rl = require('node:readline').createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
    if (request.method === 'config/read') process.stdout.write(JSON.stringify({ id: request.id, result: { config: {} } }) + '\n');
  });
}

module.exports = { useFakeConfigReader };
