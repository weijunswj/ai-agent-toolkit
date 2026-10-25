#!/usr/bin/env node
'use strict';

// Helper set stamp for the n8n import/export helpers. `n8n-helper-set.json` lists every helper file in
// this folder with a content hash, so a copy on any machine can prove it is one complete, matching set
// before a helper runs. Hashes ignore line endings and a leading byte-order mark, because Git may check
// these files out with either line ending.
//
// This file avoids newer JavaScript syntax so an old Node.js still reaches the version check below.
//
// Usage:
//   node n8n-helper-set.cjs check [--dir <helper folder>]
//   node n8n-helper-set.cjs refresh --from <Toolkit helper folder> --to <consumer helper folder> [--write]
//   node n8n-helper-set.cjs write-manifest [--dir <helper folder>]   (Toolkit maintainers only)

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var MANIFEST_NAME = 'n8n-helper-set.json';
var MANIFEST_KIND = 'ai-agent-toolkit n8n import-export helpers';
var MIN_NODE_MAJOR = 18;
var ALLOW_LOCAL_CHANGES_ENV = 'N8N_HELPERS_ALLOW_LOCAL_CHANGES';
// Documentation may be edited per repository; it is not part of the stamped set.
var UNSTAMPED_FILES = { 'README.md': true };

function nodeMajor(version) {
  var match = /^v?(\d+)\./.exec(String(version || process.version));
  return match ? Number(match[1]) : 0;
}

function hashText(buffer) {
  var text = buffer.toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashFile(filePath) {
  return hashText(fs.readFileSync(filePath));
}

function stampedFileNames(dir) {
  return fs.readdirSync(dir).filter(function (name) {
    if (name === MANIFEST_NAME || UNSTAMPED_FILES[name]) return false;
    var stat = fs.lstatSync(path.join(dir, name));
    return stat.isFile();
  }).sort();
}

function setIdFor(files) {
  var lines = Object.keys(files).sort().map(function (name) { return name + ':' + files[name]; });
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex').slice(0, 12);
}

function buildManifest(dir) {
  var files = {};
  stampedFileNames(dir).forEach(function (name) { files[name] = hashFile(path.join(dir, name)); });
  return { schemaVersion: 1, kind: MANIFEST_KIND, setId: setIdFor(files), files: files };
}

function readManifest(dir) {
  var manifestPath = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return null;
  var manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    return { invalid: true };
  }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== MANIFEST_KIND || !manifest.files || typeof manifest.files !== 'object') {
    return { invalid: true };
  }
  return manifest;
}

// Returns { status, setId, missing, changed, extra, problems } where status is OK, CHANGED or FAIL.
function checkSet(dir, options) {
  options = options || {};
  var result = { status: 'OK', setId: '', missing: [], changed: [], extra: [], problems: [] };
  var major = nodeMajor(options.nodeVersion);
  if (major < MIN_NODE_MAJOR) {
    result.problems.push('Node.js ' + (options.nodeVersion || process.version) + ' is too old. Install Node.js ' + MIN_NODE_MAJOR + ' or newer.');
  }
  var manifest = readManifest(dir);
  if (manifest === null) {
    result.problems.push('This helper folder has no ' + MANIFEST_NAME + ', so it is an older or partial copy. Refresh it from Toolkit.');
  } else if (manifest.invalid) {
    result.problems.push(MANIFEST_NAME + ' is not a valid helper set stamp. Refresh the helper folder from Toolkit.');
  } else {
    result.setId = String(manifest.setId || '');
    Object.keys(manifest.files).sort().forEach(function (name) {
      var filePath = path.join(dir, name);
      if (!fs.existsSync(filePath)) {
        result.missing.push(name);
        return;
      }
      if (hashFile(filePath) !== manifest.files[name]) result.changed.push(name);
    });
    stampedFileNames(dir).forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) result.extra.push(name);
    });
    if (result.missing.length > 0) {
      result.problems.push('Missing helper file(s): ' + result.missing.join(', ') + '. Refresh the helper folder from Toolkit.');
    }
  }
  if (result.problems.length > 0) result.status = 'FAIL';
  else if (result.changed.length > 0) result.status = options.allowLocalChanges ? 'CHANGED' : 'FAIL';
  return result;
}

function checkLines(result, options) {
  options = options || {};
  var lines = [];
  result.problems.forEach(function (problem) { lines.push('FAIL: ' + problem); });
  if (result.changed.length > 0) {
    var label = options.allowLocalChanges ? 'WARN: ' : 'FAIL: ';
    lines.push(label + 'Helper file(s) differ from the stamped set: ' + result.changed.join(', ') + '.');
    if (!options.allowLocalChanges) {
      lines.push('Refresh the helper folder from Toolkit, or set ' + ALLOW_LOCAL_CHANGES_ENV + '=1 for this run if the local change is intended.');
    }
  }
  result.extra.forEach(function (name) { lines.push('INFO: Repository-local file kept outside the stamped set: ' + name + '.'); });
  if (result.status !== 'FAIL') lines.push('OK: Helper set ' + result.setId + ' is complete' + (result.changed.length ? ' with local changes.' : ' and matches its stamp.'));
  return lines;
}

// Plans a refresh of a consumer copy. Never deletes: files the consumer has that Toolkit does not ship
// are kept and reported, and so are files an older set had that the new set no longer uses.
function planRefresh(fromDir, toDir) {
  var source = readManifest(fromDir);
  if (!source || source.invalid) throw new Error('The Toolkit helper folder has no valid ' + MANIFEST_NAME + '.');
  var current = buildManifest(fromDir);
  if (current.setId !== source.setId) throw new Error('The Toolkit helper folder does not match its own stamp; refresh Toolkit first.');
  var previous = fs.existsSync(toDir) ? readManifest(toDir) : null;
  var actions = [];
  Object.keys(source.files).sort().forEach(function (name) {
    var target = path.join(toDir, name);
    if (!fs.existsSync(target)) actions.push({ action: 'ADD', name: name });
    else if (hashFile(target) !== source.files[name]) actions.push({ action: 'UPDATE', name: name });
    else actions.push({ action: 'SAME', name: name });
  });
  ['README.md', MANIFEST_NAME].forEach(function (name) {
    if (!fs.existsSync(path.join(fromDir, name))) return;
    var target = path.join(toDir, name);
    var same = fs.existsSync(target) && hashFile(target) === hashFile(path.join(fromDir, name));
    actions.push({ action: fs.existsSync(target) ? (same ? 'SAME' : 'UPDATE') : 'ADD', name: name });
  });
  if (fs.existsSync(toDir)) {
    stampedFileNames(toDir).forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(source.files, name)) return;
      var wasStamped = previous && !previous.invalid && Object.prototype.hasOwnProperty.call(previous.files, name);
      actions.push({ action: wasStamped ? 'UNUSED' : 'KEEP', name: name });
    });
  }
  return { setId: source.setId, previousSetId: previous && !previous.invalid ? String(previous.setId || '') : '', actions: actions };
}

function applyRefresh(fromDir, toDir, plan) {
  fs.mkdirSync(toDir, { recursive: true });
  plan.actions.forEach(function (entry) {
    if (entry.action !== 'ADD' && entry.action !== 'UPDATE') return;
    fs.copyFileSync(path.join(fromDir, entry.name), path.join(toDir, entry.name));
  });
}

function refreshLines(plan, write) {
  var notes = {
    ADD: 'new helper file',
    UPDATE: 'helper file changes',
    SAME: 'unchanged',
    KEEP: 'repository-local file, kept',
    UNUSED: 'no longer part of the helper set, kept; delete it yourself once nothing uses it',
  };
  var lines = ['Helper set ' + (plan.previousSetId || '(none)') + ' -> ' + plan.setId + (write ? '' : ' (preview; rerun with --write to apply)')];
  plan.actions.forEach(function (entry) {
    if (entry.action === 'SAME') return;
    lines.push(entry.action + ': ' + entry.name + ' (' + notes[entry.action] + ')');
  });
  if (lines.length === 1) lines.push('No changes.');
  return lines;
}

function parseArgs(argv) {
  var options = { command: argv[0] || '' };
  for (var index = 1; index < argv.length; index += 1) {
    var arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--dir' || arg === '--from' || arg === '--to') {
      options[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else throw new Error('Unknown argument: ' + arg);
  }
  return options;
}

function main(argv) {
  var options;
  try {
    options = parseArgs(argv || process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    return 2;
  }
  var dir = path.resolve(options.dir || __dirname);
  try {
    if (options.command === 'check') {
      var allowLocalChanges = process.env[ALLOW_LOCAL_CHANGES_ENV] === '1';
      var result = checkSet(dir, { allowLocalChanges: allowLocalChanges });
      if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else checkLines(result, { allowLocalChanges: allowLocalChanges }).forEach(function (line) { process.stdout.write(line + '\n'); });
      return result.status === 'FAIL' ? 1 : 0;
    }
    if (options.command === 'refresh') {
      if (!options.from || !options.to) throw new Error('refresh needs --from <Toolkit helper folder> and --to <consumer helper folder>.');
      var fromDir = path.resolve(options.from);
      var toDir = path.resolve(options.to);
      var plan = planRefresh(fromDir, toDir);
      if (options.write) applyRefresh(fromDir, toDir, plan);
      refreshLines(plan, options.write).forEach(function (line) { process.stdout.write(line + '\n'); });
      return 0;
    }
    if (options.command === 'write-manifest') {
      fs.writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(buildManifest(dir), null, 2) + '\n', 'utf8');
      process.stdout.write('Wrote ' + MANIFEST_NAME + '.\n');
      return 0;
    }
    process.stderr.write('Usage: node n8n-helper-set.cjs check|refresh|write-manifest\n');
    return 2;
  } catch (error) {
    process.stderr.write('FAIL: ' + error.message + '\n');
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ALLOW_LOCAL_CHANGES_ENV: ALLOW_LOCAL_CHANGES_ENV,
  MANIFEST_NAME: MANIFEST_NAME,
  MIN_NODE_MAJOR: MIN_NODE_MAJOR,
  buildManifest: buildManifest,
  checkLines: checkLines,
  checkSet: checkSet,
  hashText: hashText,
  main: main,
  nodeMajor: nodeMajor,
  planRefresh: planRefresh,
  applyRefresh: applyRefresh,
  refreshLines: refreshLines,
};
