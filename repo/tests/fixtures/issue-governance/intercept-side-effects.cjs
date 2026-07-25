#!/usr/bin/env node
'use strict';

// Side-effect interceptor for testing the audit CLI.
// Blocks network, filesystem mutation, shell, and child-process calls.
// Only reads are permitted.

const blocked = (family) => () => { throw new Error(`BLOCKED: ${family} call intercepted by test guard.`); };

// Network and DNS
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

http.request = blocked('http.request');
http.get = blocked('http.get');
https.request = blocked('https.request');
https.get = blocked('https.get');
dns.lookup = blocked('dns.lookup');
dns.resolve = blocked('dns.resolve');
dns.resolve4 = blocked('dns.resolve4');
dns.resolve6 = blocked('dns.resolve6');
dns.lookupService = blocked('dns.lookupService');
net.createConnection = blocked('net.createConnection');
net.connect = blocked('net.connect');

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = blocked('fetch');
}

// Filesystem mutation
const fs = require('node:fs');
const origWriteFile = fs.writeFile;
const origWriteFileSync = fs.writeFileSync;
const origAppendFile = fs.appendFile;
const origAppendFileSync = fs.appendFileSync;
const origMkdir = fs.mkdir;
const origMkdirSync = fs.mkdirSync;
const origUnlink = fs.unlink;
const origUnlinkSync = fs.unlinkSync;
const origRmdir = fs.rmdir;
const origRmdirSync = fs.rmdirSync;
const origRename = fs.rename;
const origRenameSync = fs.renameSync;
const origCopyFile = fs.copyFile;
const origCopyFileSync = fs.copyFileSync;
const origTruncate = fs.truncate;
const origTruncateSync = fs.truncateSync;
const origRm = fs.rm;
const origRmSync = fs.rmSync;

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

// Also block promise-based variants
if (fs.promises) {
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

// Shell and child process
const cp = require('node:child_process');
cp.exec = blocked('child_process.exec');
cp.execSync = blocked('child_process.execSync');
cp.execFile = blocked('child_process.execFile');
cp.execFileSync = blocked('child_process.execFileSync');
cp.spawn = blocked('child_process.spawn');
cp.spawnSync = blocked('child_process.spawnSync');
cp.fork = blocked('child_process.fork');
