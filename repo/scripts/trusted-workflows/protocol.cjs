'use strict';

function result(value) {
  process.stdout.write(JSON.stringify(Object.assign({ protocol_version: 1 }, value)) + '\n');
}

function fail(code) {
  process.stderr.write(code + '\n');
  process.exit(2);
}

function opaque(value) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

module.exports = Object.freeze({ result, fail, opaque });
