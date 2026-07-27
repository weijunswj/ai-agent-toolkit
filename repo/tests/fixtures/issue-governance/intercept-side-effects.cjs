#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const constants = fs.constants;

function blocked(exportPath) {
  return function guardedSideEffect() {
    const error = new Error('SIDE_EFFECT_GUARD_BLOCKED:' + exportPath);
    error.code = 'SIDE_EFFECT_GUARD_BLOCKED';
    error.exportPath = exportPath;
    throw error;
  };
}

const VALID_READ_FLAGS = new Set(['r', 'rs', 'sr']);
const VALID_WRITE_FLAGS = new Set(['r+', 'rs+', 'sr+', 'w', 'wx', 'w+', 'wx+', 'a', 'ax', 'a+', 'ax+']);
function classifyOpenFlag(flag) {
  if (typeof flag === 'string') {
    if (VALID_READ_FLAGS.has(flag)) return 'read';
    if (VALID_WRITE_FLAGS.has(flag)) return 'write';
    return 'invalid';
  }
  if (typeof flag === 'number') {
    const writeMask = constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND;
    return (flag & writeMask) !== 0 ? 'write' : 'read';
  }
  return 'invalid';
}

function install(moduleObject, names, prefix) {
  for (const name of names) {
    if (typeof moduleObject[name] === 'function') moduleObject[name] = blocked(prefix + '.' + name);
  }
}

install(require('node:http'), ['request', 'get', 'createServer'], 'http');
install(require('node:https'), ['request', 'get', 'createServer'], 'https');
install(require('node:net'), ['createConnection', 'connect', 'createServer'], 'net');
install(require('node:tls'), ['connect', 'createServer'], 'tls');
install(require('node:dgram'), ['createSocket'], 'dgram');
install(require('node:http2'), ['connect', 'createServer', 'createSecureServer'], 'http2');
install(require('node:dns'), ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse', 'lookupService'], 'dns');
if (require('node:dns').promises) {
  install(require('node:dns').promises, ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse', 'lookupService'], 'dns.promises');
}
install(require('node:child_process'), ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'], 'child_process');

const fsSync = [
  'writeFileSync', 'appendFileSync', 'mkdirSync', 'unlinkSync', 'rmdirSync', 'renameSync',
  'copyFileSync', 'truncateSync', 'rmSync', 'chmodSync', 'chownSync', 'utimesSync',
  'symlinkSync', 'linkSync', 'lchmodSync', 'createWriteStream'
];
const fsCallback = [
  'writeFile', 'appendFile', 'mkdir', 'unlink', 'rmdir', 'rename', 'copyFile', 'truncate',
  'rm', 'chmod', 'chown', 'utimes', 'symlink', 'link', 'lchmod'
];
const fsPromise = [
  'writeFile', 'appendFile', 'mkdir', 'unlink', 'rmdir', 'rename', 'copyFile', 'truncate',
  'rm', 'chmod', 'chown', 'utimes', 'symlink', 'link'
];
install(fs, fsSync.concat(fsCallback), 'fs');
if (fs.promises) install(fs.promises, fsPromise, 'fs.promises');

const originalOpen = fs.open;
const originalOpenSync = fs.openSync;
const originalPromiseOpen = fs.promises && fs.promises.open;
fs.open = function guardedOpen(target, flag) {
  const classification = classifyOpenFlag(flag);
  if (classification === 'write') return blocked('fs.open')();
  if (classification === 'invalid') throw new TypeError('SIDE_EFFECT_INVALID_OPEN_FLAG');
  return originalOpen.apply(fs, arguments);
};
fs.openSync = function guardedOpenSync(target, flag) {
  const classification = classifyOpenFlag(flag);
  if (classification === 'write') return blocked('fs.openSync')();
  if (classification === 'invalid') throw new TypeError('SIDE_EFFECT_INVALID_OPEN_FLAG');
  return originalOpenSync.apply(fs, arguments);
};
if (fs.promises) {
  fs.promises.open = function guardedPromiseOpen(target, flag) {
    const classification = classifyOpenFlag(flag);
    if (classification === 'write') return Promise.reject(blocked('fs.promises.open')());
    if (classification === 'invalid') return Promise.reject(new TypeError('SIDE_EFFECT_INVALID_OPEN_FLAG'));
    return originalPromiseOpen.apply(fs.promises, arguments);
  };
}

if (typeof globalThis.fetch === 'function') globalThis.fetch = blocked('global.fetch');
try {
  const workerThreads = require('node:worker_threads');
  if (workerThreads.Worker) workerThreads.Worker = blocked('worker_threads.Worker');
} catch {}
try {
  const cluster = require('node:cluster');
  if (cluster.fork) cluster.fork = blocked('cluster.fork');
} catch {}

Object.defineProperty(globalThis, '__ISSUE_GOVERNANCE_SIDE_EFFECT_GUARD__', {
  value: Object.freeze({
    valid_read_flags: Object.freeze([...VALID_READ_FLAGS]),
    valid_write_flags: Object.freeze([...VALID_WRITE_FLAGS]),
    classifyOpenFlag
  }),
  configurable: false,
  enumerable: false,
  writable: false
});
