'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./setup-toolkit-core.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const outputPath = path.join(repoRoot, 'repo', 'docs', 'SETUP-QUESTIONS.generated.md');

function generatedBytes() {
  return core.renderSetupQuestionDocumentation();
}

function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  if (write === check) throw new Error('Use exactly one of --write or --check.');
  const expected = generatedBytes();
  if (write) {
    fs.writeFileSync(outputPath, expected, 'utf8');
    console.log('Updated repo/docs/SETUP-QUESTIONS.generated.md');
    return;
  }
  const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (actual !== expected) throw new Error('Stale generated setup question documentation. Run node repo/scripts/generate-setup-question-docs.cjs --write');
  console.log('Setup question documentation is current.');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { generatedBytes, main, outputPath };
