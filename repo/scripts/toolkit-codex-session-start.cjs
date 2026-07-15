#!/usr/bin/env node
'use strict';

const path = require('node:path');
const util = require('node:util');

const HOOK_ARGS = ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'];
const WARNING = 'Toolkit SessionStart skipped optional maintenance safely. Run `setup toolkit` in Codex to repair the installed hook.';
const MAX_CAPTURE_BYTES = 1024 * 1024;

function captureBridgeOutput(run) {
  const writes = [];
  let capturedBytes = 0;
  let overflow = false;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalConsole = {};
  const captureChunk = (stream, chunk, encoding) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
    capturedBytes += bytes.length;
    if (capturedBytes <= MAX_CAPTURE_BYTES) writes.push({ stream, bytes });
    else overflow = true;
  };
  const capture = (stream) => function write(chunk, encoding, callback) {
    captureChunk(stream, chunk, encoding);
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') done();
    return true;
  };
  process.stdout.write = capture('stdout');
  process.stderr.write = capture('stderr');
  for (const [method, stream] of [
    ['log', 'stdout'], ['info', 'stdout'], ['error', 'stderr'], ['warn', 'stderr'], ['debug', 'stderr']
  ]) {
    originalConsole[method] = console[method];
    console[method] = (...args) => captureChunk(stream, `${util.format(...args)}\n`, 'utf8');
  }
  try {
    const result = run();
    if (overflow) throw new Error('bridge output exceeded the safe capture limit');
    return { result, writes };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    for (const [method, original] of Object.entries(originalConsole)) console[method] = original;
  }
}

function replayBridgeOutput(writes) {
  for (const write of writes) {
    const stream = write.stream === 'stdout' ? process.stdout : process.stderr;
    stream.write(write.bytes);
  }
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    if (JSON.stringify(argv) !== JSON.stringify(HOOK_ARGS)) throw new Error('unexpected hook arguments');
    const pluginRoot = path.resolve(__dirname, '..', '..');
    process.env.PLUGIN_ROOT = pluginRoot;
    const captured = captureBridgeOutput(() => {
      const bridge = dependencies.bridge || require('./toolkit-local-bridge.cjs');
      return bridge.run(HOOK_ARGS);
    });
    const result = captured.result;
    if (!result || result.status !== 0) throw new Error('bridge returned a non-zero status');
    replayBridgeOutput(captured.writes);
  } catch {
    console.log(WARNING);
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { HOOK_ARGS, MAX_CAPTURE_BYTES, WARNING, main };
