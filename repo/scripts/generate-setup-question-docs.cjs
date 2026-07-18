'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./setup-toolkit-core.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const outputPath = path.join(repoRoot, 'repo', 'docs', 'SETUP-QUESTIONS.generated.md');

function generatedBytes() {
  return core.renderSetupQuestionDocumentation();
}

function normalizeTextForComparison(text) {
  return text.replace(/\r\n/g, '\n');
}

function writeGeneratedDocument(targetPath = outputPath) {
  fs.writeFileSync(targetPath, generatedBytes(), 'utf8');
}

function checkGeneratedDocument(targetPath = outputPath) {
  const expected = generatedBytes();
  const actual = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  if (normalizeTextForComparison(actual) !== normalizeTextForComparison(expected)) {
    throw new Error('Stale generated setup question documentation. Run node repo/scripts/generate-setup-question-docs.cjs --write');
  }
}

function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  if (write === check) throw new Error('Use exactly one of --write or --check.');
  if (write) {
    writeGeneratedDocument();
    console.log('Updated repo/docs/SETUP-QUESTIONS.generated.md');
    return;
  }
  checkGeneratedDocument();
  console.log('Setup question documentation is current.');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  checkGeneratedDocument,
  generatedBytes,
  main,
  normalizeTextForComparison,
  outputPath,
  writeGeneratedDocument,
};
