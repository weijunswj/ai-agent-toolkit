#!/usr/bin/env node
'use strict';

const path = require('node:path');

const HOOK_ARGS = ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'];
const WARNING = 'Toolkit SessionStart skipped optional maintenance safely. Run `setup toolkit` in Codex to repair the installed hook.';

function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    if (JSON.stringify(argv) !== JSON.stringify(HOOK_ARGS)) throw new Error('unexpected hook arguments');
    const pluginRoot = path.resolve(__dirname, '..', '..');
    process.env.PLUGIN_ROOT = pluginRoot;
    const bridge = dependencies.bridge || require('./toolkit-local-bridge.cjs');
    const result = bridge.run(HOOK_ARGS);
    if (!result || result.status !== 0) throw new Error('bridge returned a non-zero status');
  } catch {
    console.log(WARNING);
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { HOOK_ARGS, WARNING, main };
