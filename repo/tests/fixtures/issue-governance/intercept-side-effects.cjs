#!/usr/bin/env node
'use strict';

const blocked = (family) => () => { throw new Error('BLOCKED: ' + family + ' call intercepted by test guard.'); };

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const cp = require('node:child_process');

http.request = blocked('http.request');
http.get = blocked('http.get');
https.request = blocked('https.request');
https.get = blocked('https.get');

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = blocked('fetch');
}

net.createConnection = blocked('net.createConnection');
net.connect = blocked('net.connect');

if (tls && tls.connect) tls.connect = blocked('tls.connect');
if (tls && tls.createServer) tls.createServer = blocked('tls.createServer');

dns.lookup = blocked('dns.lookup');
dns.resolve = blocked('dns.resolve');
dns.resolve4 = blocked('dns.resolve4');
dns.resolve6 = blocked('dns.resolve6');
dns.lookupService = blocked('dns.lookupService');

if (dns.promises) {
  dns.promises.lookup = blocked('dns.promises.lookup');
  dns.promises.resolve = blocked('dns.promises.resolve');
  dns.promises.resolve4 = blocked('dns.promises.resolve4');
  dns.promises.resolve6 = blocked('dns.promises.resolve6');
  dns.promises.lookupService = blocked('dns.promises.lookupService');
}

fs.writeFile = blocked('fs.writeFile');
fs.writeFileSync = blocked('fs.writeFileSync');
fs.appendFile = blocked('fs.appendFile');
fs.appendFileSync = blocked('fs.appendFileSync');
fs.mkdir = blocked('fs.mkdir');
fs.mkdirSync = blocked('fs.mkdirSync');
fs.unlink = blocked('fs.unlink');
fs.unlinkSync = blocked('fs.unlinkSync');
fs.rmdir = blocked('fs.rmdir');
fs.rmdirSync = blocked('fs.rmdirSync');
fs.rename = blocked('fs.rename');
fs.renameSync = blocked('fs.renameSync');
fs.copyFile = blocked('fs.copyFile');
fs.copyFileSync = blocked('fs.copyFileSync');
fs.truncate = blocked('fs.truncate');
fs.truncateSync = blocked('fs.truncateSync');
fs.rm = blocked('fs.rm');
fs.rmSync = blocked('fs.rmSync');

var origOpen = fs.open;
var origOpenSync = fs.openSync;

function isWriteFlag(flag) {
  if (typeof flag === 'string') {
    var writePatterns = [/^w/, /^a/, /^x/, /^r\+/, /^rs\+/, /^sr\+/];
    for (var p of writePatterns) {
      if (p.test(flag)) return true;
    }
    return false;
  }
  if (typeof flag === 'number') {
    var O_WRONLY = 1;
    var O_RDWR = 2;
    var O_CREAT = require('node:constants').O_CREAT || 64;
    var O_TRUNC = require('node:constants').O_TRUNC || 512;
    var O_APPEND = require('node:constants').O_APPEND || 1024;
    if ((flag & O_WRONLY) || (flag & O_RDWR) || (flag & O_CREAT) || (flag & O_TRUNC) || (flag & O_APPEND)) {
      return true;
    }
  }
  return false;
}

fs.open = function(path, flags, mode, callback) {
  if (isWriteFlag(flags)) return blocked('fs.open (write)')();
  return origOpen.apply(fs, arguments);
};
fs.openSync = function(path, flags, mode) {
  if (isWriteFlag(flags)) return blocked('fs.openSync (write)')();
  return origOpenSync.apply(fs, arguments);
};

if (fs.promises) {
  var origPromisesOpen = fs.promises.open;
  fs.promises.open = function(path, flags, mode) {
    if (isWriteFlag(flags)) return blocked('fs.promises.open (write)')();
    return origPromisesOpen.apply(fs.promises, arguments);
  };
  fs.promises.writeFile = blocked('fs.promises.writeFile');
  fs.promises.appendFile = blocked('fs.promises.appendFile');
  fs.promises.mkdir = blocked('fs.promises.mkdir');
  fs.promises.unlink = blocked('fs.promises.unlink');
  fs.promises.rmdir = blocked('fs.promises.rmdir');
  fs.promises.rm = blocked('fs.promises.rm');
  fs.promises.rename = blocked('fs.promises.rename');
  fs.promises.copyFile = blocked('fs.promises.copyFile');
  fs.promises.truncate = blocked('fs.promises.truncate');
}

fs.createWriteStream = blocked('fs.createWriteStream');

cp.exec = blocked('child_process.exec');
cp.execSync = blocked('child_process.execSync');
cp.execFile = blocked('child_process.execFile');
cp.execFileSync = blocked('child_process.execFileSync');
cp.spawn = blocked('child_process.spawn');
cp.spawnSync = blocked('child_process.spawnSync');
cp.fork = blocked('child_process.fork');

try {
  var worker_threads = require('node:worker_threads');
  if (worker_threads && worker_threads.Worker) {
    var OrigWorker = worker_threads.Worker;
    worker_threads.Worker = function() {
      return blocked('worker_threads.Worker')();
    };
  }
} catch (e) {}
