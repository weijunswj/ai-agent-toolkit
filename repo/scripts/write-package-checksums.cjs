#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, '_dist');
if (process.argv.length !== 3 || !['packs', 'skills'].includes(process.argv[2])) {
  throw new Error('PACKAGE_CHECKSUM_ARGUMENTS');
}
const output = path.join(dist, process.argv[2] + '-checksums.txt');
const files = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('PACKAGE_CHECKSUM_SYMLINK');
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() && absolute !== output) files.push(absolute);
  }
}

visit(dist);
const lines = files.map((file) => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
  return digest + '  ' + path.relative(root, file).replace(/\\/g, '/');
});
fs.writeFileSync(output, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
