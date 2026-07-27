#!/usr/bin/env node
'use strict';

const { result, fail, opaque } = require('../protocol.cjs');
const fs = require('node:fs');

if (process.argv.length !== 3) fail('TW_AUTOSYNC_CLASSIFY_ARGUMENTS');
let files;
try {
  files = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} catch {
  fail('TW_AUTOSYNC_CLASSIFY_INPUT');
}
if (!Array.isArray(files) || files.some((value) => typeof value !== 'string')) fail('TW_AUTOSYNC_CLASSIFY_SCHEMA');
const allowed = files.every((file) =>
  file.startsWith('_projects/') || file.startsWith('skills/') || file === 'README.md'
);
result({ eligible: allowed, file_count: files.length, inventory: files.map(opaque).sort() });
