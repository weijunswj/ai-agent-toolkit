#!/usr/bin/env node
'use strict';

// Refreshes one active SOURCE-LOCK to a reviewed upstream commit, for the separate update pull
// request that follows a source-watch notice. It reads the upstream clone with git only and never
// runs upstream code. Without --write it changes nothing and prints the plan.
//
// Usage: node repo/scripts/refresh-source-lock.cjs --lock <SOURCE-LOCK.json> --clone <upstream clone>
//          --commit <full SHA> [--write] [--adapted-reviewed]
//   - exact entries: the upstream bytes are copied to root_surface_path and the pin moves;
//   - adapted entries: a changed upstream blob is listed; --write refuses until the adaptation is
//     ported by hand and --adapted-reviewed confirms it, then the pin moves;
//   - an exact or adapted path gone upstream refuses --write; a gone excluded path is dropped;
//   - a new upstream file beside a tracked one is added as excluded, so adopting it stays a choice.
// Exit 0 done (or nothing to do), 1 refused, 2 bad arguments or an unreadable clone.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FULL_SHA = /^[0-9a-f]{40}$/;
const NEW_FILE_NOTE = 'Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.';

function parseArgs(argv) {
  const args = { write: false, adaptedReviewed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') args.write = true;
    else if (arg === '--adapted-reviewed') args.adaptedReviewed = true;
    else if (['--lock', '--clone', '--commit', '--root'].includes(arg)) args[arg.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.lock || !args.clone || !FULL_SHA.test(args.commit || '')) {
    throw new Error('need --lock <path>, --clone <dir> and --commit <full 40-character SHA>');
  }
  return args;
}

function git(clone, args, encoding = 'utf8') {
  const result = spawnSync('git', ['-C', clone, ...args], { encoding, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return result.status === 0 ? result.stdout : null;
}

function upstreamBlob(clone, commit, sourcePath) {
  const out = git(clone, ['rev-parse', '--verify', '--quiet', `${commit}:${sourcePath}`]);
  return out ? out.trim() : null;
}

function filesBeside(clone, commit, dirs) {
  const files = new Set();
  for (const dir of dirs) {
    for (const line of (git(clone, ['ls-tree', commit, `${dir}/`]) || '').split('\n')) {
      const match = /^\d+ blob [0-9a-f]+\t(.+)$/.exec(line);
      if (match) files.add(match[1]);
    }
  }
  return files;
}

function isTree(clone, commit) {
  const out = git(clone, ['cat-file', '-t', `${commit}^{tree}`]);
  return out !== null && out.trim() === 'tree';
}

function plan({ lock, clone, commit }) {
  const changes = [];
  const refusals = [];
  const kept = [];
  for (const entry of lock.files) {
    const blob = upstreamBlob(clone, commit, entry.source_path);
    if (entry.mode === 'excluded') {
      if (blob) kept.push(entry);
      else changes.push({ kind: 'drop-excluded', entry });
      continue;
    }
    kept.push(entry);
    if (!blob) refusals.push(`GONE ${entry.mode} ${entry.source_path}: decide in the pull request`);
    else if (blob !== entry.source_blob_sha) changes.push({ kind: entry.mode, entry, blob });
  }
  const tracked = new Set(lock.files.map((entry) => entry.source_path));
  const dirs = new Set(lock.files.filter((entry) => entry.mode !== 'excluded').map((entry) => path.posix.dirname(entry.source_path)));
  for (const file of [...filesBeside(clone, commit, dirs)].sort()) {
    if (!tracked.has(file)) changes.push({ kind: 'new-upstream', entry: { mode: 'excluded', source_path: file, notes: NEW_FILE_NOTE } });
  }
  return { changes, refusals, kept };
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`refresh-source-lock: ${error.message}`);
    return 2;
  }
  const root = path.resolve(args.root || process.cwd());
  const lockPath = path.resolve(root, args.lock);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const remote = (git(args.clone, ['remote', 'get-url', 'origin']) || '').trim().replace(/\.git$/, '');
  if (!remote.endsWith(`/${lock.source_repo}`) || !isTree(args.clone, args.commit)) {
    console.error(`refresh-source-lock: ${args.clone} is not a clone of ${lock.source_repo} holding ${args.commit}`);
    return 2;
  }

  const { changes, refusals, kept } = plan({ lock, clone: args.clone, commit: args.commit });
  const adapted = changes.filter((change) => change.kind === 'adapted');
  if (adapted.length && !args.adaptedReviewed) {
    for (const change of adapted) refusals.push(`ADAPTED ${change.entry.source_path} changed upstream (${change.blob}): port it by hand, then pass --adapted-reviewed`);
  }
  console.log(`${lock.source_repo} ${lock.source_commit} -> ${args.commit}`);
  for (const change of changes) console.log(`${change.kind.toUpperCase()} ${change.entry.source_path}${change.blob ? ` ${change.blob}` : ''}`);
  for (const refusal of refusals) console.log(`REFUSED ${refusal}`);
  if (!args.write) {
    console.log('Dry run: nothing written.');
    return refusals.length ? 1 : 0;
  }
  if (refusals.length) return 1;

  for (const change of changes) {
    if (change.kind === 'exact') {
      const bytes = git(args.clone, ['cat-file', 'blob', change.blob], 'buffer');
      const target = path.resolve(root, change.entry.root_surface_path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    if (change.kind === 'exact' || change.kind === 'adapted') change.entry.source_blob_sha = change.blob;
  }
  lock.source_commit = args.commit;
  lock.files = [...kept, ...changes.filter((change) => change.kind === 'new-upstream').map((change) => change.entry)];
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Written: ${path.relative(root, lockPath)} and ${changes.filter((change) => change.kind === 'exact').length} exact file(s). Run npm run audit:source-locks next.`);
  return 0;
}

if (require.main === module) process.exitCode = main();
