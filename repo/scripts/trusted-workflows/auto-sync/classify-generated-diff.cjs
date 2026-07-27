#!/usr/bin/env node
'use strict';

const { result, fail, opaque } = require('../protocol.cjs');
const fs = require('node:fs');

if (process.argv.length !== 3) fail('TW_AUTOSYNC_DIFF_ARGUMENTS');
let files;
try {
  files = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} catch {
  fail('TW_AUTOSYNC_DIFF_INPUT');
}
if (!Array.isArray(files) || files.some((value) => typeof value !== 'string')) fail('TW_AUTOSYNC_DIFF_SCHEMA');
const approved = files.every((file) =>
  file === 'README.md' || file.startsWith('skills/') ||
  file.startsWith('.codex-plugin/') || file.startsWith('.claude-plugin/')
);
result({ approved, file_count: files.length, inventory: files.map(opaque).sort() });
