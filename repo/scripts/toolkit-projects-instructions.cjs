#!/usr/bin/env node
'use strict';

// Read-only renderer/checker. The coordinator places the block after owner confirmation.
const fs = require('node:fs');
const path = require('node:path');
const { renderBlock, findBlocks, blockState } = require('./toolkit-managed-block.cjs');

const SOURCE_FILE = 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md';
const VERSION_FILE = 'repo/contracts/toolkit-local-bridge/version.json';
const SOURCE = 'claude-projects';
const NAME = 'PROJECT-INSTRUCTIONS';
const VERSION = /^\d+\.\d+\.\d+$/;

function checkInstructions(text, expected, declinedVersion) {
  const { blocks, errors } = findBlocks(text);
  const targets = blocks.filter(block => block.name === NAME);
  if (errors.length || targets.length > 1 || (targets[0] && targets[0].source !== SOURCE)) {
    return { state: 'malformed', exitCode: 2 };
  }
  const state = { absent: 'missing', tampered: 'edited', stale: 'outdated', current: 'current' }[
    blockState(targets[0], expected)
  ];
  if (state === 'outdated' && declinedVersion === expected.version) return { state: 'declined', exitCode: 0 };
  return { state, exitCode: state === 'current' ? 0 : 1 };
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--render') return { mode: 'render' };
  if (args[0] === '--check' && args[1] && !args[1].startsWith('--')) {
    if (args.length === 2) return { mode: 'check', file: args[1] };
    if (args.length === 4 && args[2] === '--declined' && VERSION.test(args[3])) {
      return { mode: 'check', file: args[1], declinedVersion: args[3] };
    }
  }
  throw new Error('PROJECT_INSTRUCTIONS_ARGUMENTS');
}

class ProjectsInstructions {
  constructor({ root = path.resolve(__dirname, '../..'), readFile = fs.readFileSync } = {}) {
    this.root = root;
    this.readFile = readFile;
  }

  expectedBlock() {
    const body = this.readFile(path.join(this.root, SOURCE_FILE), 'utf8');
    const { version } = JSON.parse(this.readFile(path.join(this.root, VERSION_FILE), 'utf8'));
    const parsed = findBlocks(body);
    if (!VERSION.test(version) || !body.trim() || parsed.blocks.length || parsed.errors.length) {
      throw new Error('PROJECT_INSTRUCTIONS_SOURCE');
    }
    return { source: SOURCE, name: NAME, version, body };
  }

  render() {
    return renderBlock(this.expectedBlock());
  }

  check(file, declinedVersion) {
    const expected = this.expectedBlock();
    return checkInstructions(this.readFile(file, 'utf8'), expected, declinedVersion);
  }
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const instructions = new ProjectsInstructions();
    if (options.mode === 'render') {
      process.stdout.write(`${instructions.render()}\n`);
      return 0;
    }
    const result = instructions.check(options.file, options.declinedVersion);
    process.stdout.write(`${result.state}\n`);
    return result.exitCode;
  } catch {
    process.stderr.write('Project instructions could not be processed (PROJECT_INSTRUCTIONS_INVALID).\n');
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ ProjectsInstructions, checkInstructions, parseArgs });
