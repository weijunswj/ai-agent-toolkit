'use strict';

// Two computers' handoff runs on one store, for the race rows of the mirror closure matrix: a local
// bare "GitHub" store (toolkit-store-world) with computer A's checkout and computer B's clone, a
// controlled-repository checkout (acme/widget) and one memory folder path, as two computers with the
// same user and project path have it; its content is switched to whichever computer runs. Each
// computer keeps its own Toolkit user-state folder (run record and folder records). Fakes only: temp
// folders and the local bare remote, never a real store, memory folder or user-state folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const store = require('../../scripts/toolkit-store.cjs');
const { git, world } = require('./toolkit-store-world.cjs');

const FOLDER = 'evidence/handoff/acme/widget';

function raceWorld(t, { bHolds = true } = {}) {
  const w = world(t);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-race-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'widget');
  git(base, 'init', '--quiet', repo);
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
  const memory = path.join(base, 'memory');
  const put = (rel, text, when) => {
    const file = path.join(memory, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, new Date(when), new Date(when));
  };
  const drop = rel => fs.rmSync(path.join(memory, ...rel.split('/')), { force: true });
  put('MEMORY.md', '# Memory\n- a, b, c\n', '2026-11-21T08:00:00Z');
  put('a.md', 'a v1\n', '2026-11-21T09:00:00Z');
  put('b.md', 'b v1\n', '2026-11-21T09:10:00Z');
  put('c.md', 'c v1\n', '2026-11-21T09:20:00Z');
  // B runs through plain Git (only the reported remote address faked), so its own pushes never use
  // the push hooks that time A's pushes.
  const plain = (cmd, args, options) => {
    const rest = args.slice(args.indexOf('-C') + 2);
    if (rest[0] === 'remote' && rest[1] === 'get-url') return { status: 0, stdout: `${w.reported.origin}\n`, stderr: '' };
    return spawnSync(cmd, args, options);
  };
  const on = (computer, argv, now) => {
    const out = [];
    const deps = { ...w.deps, ...(computer === 'b' ? { run: plain } : {}) };
    const code = store.main(['handoff', '--store', computer === 'b' ? w.other : w.dir, '--repo-root', repo, ...argv, '--json'],
      { ...deps, handoffState: path.join(base, `computer-${computer}`, 'handoff-refresh.json'), now: () => new Date(now), stdout: text => out.push(text), stderr: text => out.push(text) });
    return { code, result: out.length ? JSON.parse(out.join('')) : null };
  };
  const manifest = () => JSON.parse(w.remoteFile(`${FOLDER}/manifest.json`));
  const row = name => manifest().files.find(item => item.path === name);
  const removed = name => (manifest().removed || []).find(item => item.path === name);
  const has = name => w.remoteHas(`${FOLDER}/${name}`);
  // A writes the first snapshot; B (with bHolds) syncs to it, so its folder record holds the same content.
  assert.equal(on('a', ['--memory', memory], '2026-11-21T10:00:00Z').result.handoff, 'SAVED');
  if (bHolds) assert.equal(on('b', [], '2026-11-21T10:30:00Z').result.handoff, 'UNCHANGED');
  // One run of B: its folder content for the run, then A's back.
  const asB = (setB, setA, now) => () => {
    setB();
    const b = on('b', [], now);
    assert.equal(b.code, 0, `B saved: ${JSON.stringify(b.result)}`);
    setA();
  };
  const ahead = () => Number(git(w.dir, 'rev-list', '--count', 'origin/main..HEAD'));
  return { w, memory, put, drop, on, row, removed, has, asB, ahead };
}

module.exports = { FOLDER, raceWorld };
