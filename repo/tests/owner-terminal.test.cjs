'use strict';

// The owner's terminal: pressEnter confirms only on a fresh, lone Enter, so a blank line typed or
// pasted ahead of the prompt, a pasted burst or a bracketed paste never answers it; Ctrl+C stops and
// the caller writes nothing. A guard keeps every owner prompt on this helper.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const terminal = require('../scripts/owner-terminal.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const QUIET = 40;
const later = ms => new Promise(resolve => setTimeout(resolve, ms));

// A terminal on both ends: keys written to `input`, the prompt read from `output`, raw mode recorded.
function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const modes = [];
  input.setRawMode = mode => { modes.push(mode); input.isRaw = mode; return input; };
  const output = new PassThrough();
  output.isTTY = true;
  let shown = '';
  output.on('data', chunk => { shown += chunk; });
  return { input, output, modes, shown: () => shown };
}

// pressEnter on the fake terminal, with whether (and how) it has resolved so far.
function prompt(term) {
  const state = { done: false, value: undefined };
  const promise = terminal.pressEnter('write the files', { input: term.input, output: term.output, environment: {}, quietMs: QUIET })
    .then(value => { Object.assign(state, { done: true, value }); return value; });
  return { state, promise };
}

test('(a) a blank line typed or pasted before the prompt never confirms; a fresh Enter afterwards does', async () => {
  const term = fakeTerminal();
  term.input.write('\r\n');
  const asked = prompt(term);
  await later(QUIET * 3);
  assert.equal(asked.state.done, false, 'the typed-ahead blank line did not answer');
  term.input.write('\r');
  assert.equal(await asked.promise, true);
  assert.match(term.shown(), /Press Enter to write the files\. Ctrl\+C stops, nothing changes\./);
});

test('(b) a pasted burst ending in Enter, or a bracketed paste, never confirms', async () => {
  for (const paste of ['text\r', 'node x.cjs --apply\r\n\r\n', `${terminal.PASTE_START}\r${terminal.PASTE_END}`, `${terminal.PASTE_START}line one\rline two\r${terminal.PASTE_END}`]) {
    const term = fakeTerminal();
    const asked = prompt(term);
    await later(QUIET * 2);
    term.input.write(paste);
    await later(QUIET / 4);
    assert.equal(asked.state.done, false, JSON.stringify(paste));
    // Nor does an Enter that follows the paste before the input has been quiet.
    term.input.write('\r');
    await later(QUIET * 3);
    assert.equal(asked.state.done, false, `${JSON.stringify(paste)} then an early Enter`);
    term.input.write('\r');
    assert.equal(await asked.promise, true, JSON.stringify(paste));
  }
  // A bracketed paste split across reads stays a paste until it ends.
  const term = fakeTerminal();
  const asked = prompt(term);
  await later(QUIET * 2);
  term.input.write(`${terminal.PASTE_START}first`);
  await later(QUIET * 3);
  term.input.write('\r');
  await later(QUIET * 3);
  assert.equal(asked.state.done, false, 'an Enter inside an open paste');
  term.input.write(`second${terminal.PASTE_END}`);
  await later(QUIET * 3);
  term.input.write('\r');
  assert.equal(await asked.promise, true);
});

test('(c) a lone Enter after the quiet wait confirms and restores the terminal', async () => {
  const term = fakeTerminal();
  const asked = prompt(term);
  await later(QUIET * 2);
  term.input.write('\r');
  assert.equal(await asked.promise, true);
  assert.deepEqual(term.modes, [true, false], 'raw mode on, then back to how it was');
  assert.ok(term.shown().includes('\x1b[?2004h') && term.shown().includes('\x1b[?2004l'), 'bracketed paste on, then off');
});

test('(d) Ctrl+C, Ctrl+D or the end of input stops, restores the terminal, and the caller writes nothing', async () => {
  for (const stop of ['\x03', '\x04', null]) {
    const term = fakeTerminal();
    const writes = [];
    const caller = prompt(term).promise.then(yes => { if (yes) writes.push('file'); return yes; });
    await later(QUIET * 2);
    if (stop === null) term.input.end(); else term.input.write(stop);
    assert.equal(await caller, false, JSON.stringify(stop));
    assert.deepEqual(writes, []);
    assert.deepEqual(term.modes, [true, false]);
  }
});

// A bracketed paste marker is six characters and can arrive split across reads at any byte boundary.
// Every split of each marker is tried: the reads are kept a tick apart so they are never joined.
const everySplit = marker => {
  const splits = [];
  for (let cut = 1; cut < marker.length; cut += 1) splits.push([marker.slice(0, cut), marker.slice(cut)]);
  splits.push([...marker]);
  return splits;
};
const readsApart = async (term, pieces) => {
  for (const piece of pieces) { term.input.write(piece); await later(QUIET / 4); }
};

test('(e) a paste end marker split across reads still closes the paste, so a later lone Enter confirms', async () => {
  for (const split of everySplit(terminal.PASTE_END)) {
    const term = fakeTerminal();
    const asked = prompt(term);
    await readsApart(term, [`${terminal.PASTE_START}line one`, ...split]);
    await later(QUIET * 2);
    term.input.write('\r');
    await later(QUIET / 4);
    const confirmed = asked.state.value === true;
    term.input.write('\x03');
    assert.equal(confirmed, true, `end marker split as ${JSON.stringify(split)}: the paste never closed, so the Enter did not confirm`);
  }
});

test('(f) a paste start marker split across reads still opens the paste, so an Enter inside it never confirms', async () => {
  for (const split of everySplit(terminal.PASTE_START)) {
    const term = fakeTerminal();
    const asked = prompt(term);
    await readsApart(term, [...split, 'line one']);
    await later(QUIET * 2);
    term.input.write('\r');
    await later(QUIET * 2);
    assert.equal(asked.state.done, false, `start marker split as ${JSON.stringify(split)}: an Enter inside the paste confirmed`);
    await readsApart(term, [terminal.PASTE_END]);
    await later(QUIET * 2);
    term.input.write('\r');
    await later(QUIET / 4);
    assert.equal(asked.state.value, true, `start marker split as ${JSON.stringify(split)}: the paste did not end, so the Enter after it did not confirm`);
  }
});

test('an agent shell or a missing terminal is refused before the prompt', async () => {
  for (const marker of terminal.AGENT_MARKERS) {
    const term = fakeTerminal();
    const yes = await terminal.pressEnter('write', { input: term.input, output: term.output, environment: { [marker]: '1' }, quietMs: QUIET });
    assert.equal(yes, false, marker);
    assert.deepEqual(term.modes, [], `${marker}: the terminal is never touched`);
    assert.match(term.shown(), new RegExp(`coding agent \\(${marker}\\)`));
  }
  const piped = fakeTerminal();
  piped.input.isTTY = false;
  assert.equal(await terminal.pressEnter('write', { input: piped.input, output: piped.output, environment: {}, quietMs: QUIET }), false);
  assert.deepEqual(piped.modes, []);
});

// Every owner prompt goes through owner-terminal.cjs: no `Type <word>` confirmation, and no script
// opens its own readline question or reads its own answer line. The named exceptions are real input,
// not confirmations, plus the two question banks moving in the next slice.
const PROMPT_SITES = Object.freeze({
  'repo/scripts/toolkit-env.cjs': 1, // the hidden secret value
  'repo/scripts/toolkit-governance.cjs': 1, // the governance bank answer (moves to chat next)
  'repo/scripts/setup-toolkit-core.cjs': 5, // two setup bank answers (moving to chat next), a path, a helper count, retention days
});

function scripts() {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (/\.(c|m)?js$/.test(entry.name)) files.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  };
  walk(path.join(ROOT, 'repo', 'scripts'));
  for (const skill of fs.readdirSync(path.join(ROOT, 'skills'))) {
    const dir = path.join(ROOT, 'skills', skill, 'scripts');
    if (fs.existsSync(dir)) walk(dir);
  }
  return files;
}

test('no owner script asks for a typed confirmation word or opens its own prompt outside the helper', () => {
  const typed = /\bType (?:\$\{[^}]+\}|[a-z]+)(?: again)?(?: to\b|:)|\b[Tt]ype `?(?:apply|create|approve|replace|yes)\b(?!-)/;
  const own = /\.question\(|readSync\(0,/g;
  const problems = [];
  for (const file of scripts()) {
    if (file === 'repo/scripts/owner-terminal.cjs') continue;
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    text.split('\n').forEach((line, index) => { if (typed.test(line)) problems.push(`${file}:${index + 1} asks for a typed word: ${line.trim().slice(0, 120)}`); });
    const sites = (text.match(own) || []).length;
    if (sites !== (PROMPT_SITES[file] || 0)) problems.push(`${file} opens ${sites} prompt(s) of its own, ${PROMPT_SITES[file] || 0} allowed: use owner-terminal.cjs pressEnter`);
  }
  assert.deepEqual(problems, []);
});
