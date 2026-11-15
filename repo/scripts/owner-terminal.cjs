#!/usr/bin/env node
'use strict';

// The owner's terminal: the one place Toolkit scripts print to, and confirm with, a person running a
// step in their own PowerShell or terminal. Read this before writing or changing such a step.
//
// The rule: owner terminal steps are short and Enter-only.
//   - Short: a title line, a few `label: value` facts, at most one plain sentence, and one OK or STOP
//     line with a Next line. Anything the owner must read or choose is shown in the agent chat first;
//     the terminal repeats only the facts the Enter acts on.
//   - Enter-only: every confirmation is a fresh Enter keypress (pressEnter); Ctrl+C, Ctrl+D or the end
//     of input stop and change nothing. No script asks the owner to type a word to confirm. Real
//     input (a secret value typed hidden, a path or a number) is not a confirmation and stays typed.
//   - Choices: a step that needs a choice takes it in chat first (the agent runs the script's own
//     non-interactive answer route); the terminal step then only confirms with Enter.
//   - Agents never answer: pressEnter refuses in a shell a coding agent started (AGENT_MARKERS) and
//     without a terminal on both ends. A script whose agent route reads a chat-approved answer from a
//     pipe keeps that route; only its terminal branch uses pressEnter.
//   - Paste-safe: pressEnter puts the terminal in raw mode and turns on bracketed paste. It drops
//     everything typed or pasted before the prompt, and anything that arrives before the input has
//     been quiet for QUIET_MS. A bracketed paste or a burst of keys never confirms, and restarts the
//     quiet wait; only a lone Enter after the quiet wait does. So the blank line at the end of a
//     pasted command block never answers the prompt. The terminal mode is always restored.
//   - Looks: colour and the OK and STOP markers only on a terminal with NO_COLOR unset; plain ASCII
//     otherwise, with long text left unwrapped for whatever reads it. On a terminal, say() wraps at
//     min(width, 80) with a two-space hanging indent, so words never break mid-line.
//
// Sync callers use pressEnterSync, which runs the same prompt in a child process sharing the terminal.
//
//   node repo/scripts/owner-terminal.cjs press-enter "<effect>"   (exit 0 on Enter, 1 otherwise)

const childProcess = require('node:child_process');
const { AGENT_HOST_MARKER_NAMES } = require('./agent-host-markers.cjs');

// Set (non-empty) in shells that a coding agent starts: each app's exact markers, plus the generic AI_AGENT.
const AGENT_MARKERS = Object.freeze([...AGENT_HOST_MARKER_NAMES, 'AI_AGENT']);
const QUIET_MS = 400;
const WIDTH = 80;
const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const ENTER = /^(?:\r\n|\r|\n)$/;
const STOP_KEYS = /[\x03\x04]/;

// Colour and markers only on a terminal with NO_COLOR unset.
function colour({ stream = process.stdout, environment = process.env } = {}) {
  return Boolean(stream && stream.isTTY) && !environment.NO_COLOR;
}
const paint = (on, code, text) => (on ? `\x1b[${code}m${text}\x1b[0m` : text);

// The reason an Enter prompt is not shown, or null: an agent's shell, or no terminal on both ends.
function refusal({ environment = process.env, tty = { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) } } = {}) {
  const marker = AGENT_MARKERS.find(name => Boolean(environment[name]));
  if (marker) return { stopped: `this shell was started by a coding agent (${marker}), and agents never answer the owner's prompts.`, next: 'the owner runs this in their own PowerShell or terminal, outside any agent. Nothing changed.' };
  if (!tty.stdin || !tty.stdout) return { stopped: 'this needs your own terminal (no pipe or file).', next: 'run it in your own PowerShell or terminal. Nothing changed.' };
  return null;
}

function title(text, options = {}) { return paint(colour(options), '1', text); }

function step(number, total, text, options = {}) { return `${paint(colour(options), '1', `[${number}/${total}]`)} ${text}`; }

function ok(text, options = {}) { return colour(options) ? `${paint(true, '32', 'OK')}  ${text}` : text; }

// Plain text keeps the one-line "Stopped: ... Next: ..." form that agents and logs read.
function stop(stopped, next, options = {}) {
  return colour(options) ? `${paint(true, '31', 'STOP')}  ${stopped}\nNext: ${next}` : `Stopped: ${stopped} Next: ${next}`;
}

// Wraps at min(terminal width, 80) with a two-space hanging indent; text that is not going to a
// terminal stays one line.
function say(text, { stream = process.stdout } = {}) {
  if (!stream || !stream.isTTY) return String(text);
  const width = Math.max(40, Math.min(Number(stream.columns) || WIDTH, WIDTH) - 1);
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const indent = lines.length ? '  ' : '';
    if (line && (indent + line + ' ' + word).length > width) { lines.push(indent + line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push((lines.length ? '  ' : '') + line);
  return lines.join('\n');
}

// A short `label: value` list, labels padded to one column.
function facts(rows, options = {}) {
  const entries = (Array.isArray(rows) ? rows : Object.entries(rows)).filter(([, value]) => value !== undefined && value !== null && value !== '');
  const pad = Math.max(0, ...entries.map(([label]) => String(label).length));
  return entries.map(([label, value]) => `  ${paint(colour(options), '1', `${String(label).padEnd(pad)}:`)} ${value}`).join('\n');
}

// Resolves true only on a fresh, lone Enter; false on Ctrl+C, Ctrl+D, end of input or a refusal.
function pressEnter(effect, { input = process.stdin, output = process.stderr, environment = process.env, quietMs = QUIET_MS } = {}) {
  const refused = refusal({ environment, tty: { stdin: Boolean(input.isTTY), stdout: Boolean(output.isTTY) } });
  if (refused) {
    output.write(`${stop(refused.stopped, refused.next, { stream: output, environment })}\n`);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const wasRaw = Boolean(input.isRaw);
    let armed = false;
    let pasting = false;
    let timer = null;
    let done = false;
    const wait = () => { armed = false; clearTimeout(timer); timer = setTimeout(() => { armed = !pasting; }, quietMs); };
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      input.removeListener('error', onEnd);
      try { output.write(`${PASTE_OFF}\n`); } catch { /* the prompt line stays as it is */ }
      try { input.setRawMode(wasRaw); } catch { /* a closed terminal has no mode left to restore */ }
      try { input.pause(); } catch { /* nothing more is read either way */ }
      resolve(value);
    };
    function onEnd() { finish(false); }
    function onData(chunk) {
      const text = String(chunk);
      if (STOP_KEYS.test(text)) return finish(false);
      if (pasting || text.includes(PASTE_START)) {
        const end = text.lastIndexOf(PASTE_END);
        pasting = end === -1 || text.lastIndexOf(PASTE_START) > end;
        return wait();
      }
      if (armed && ENTER.test(text)) return finish(true);
      return wait();
    }
    try {
      input.setRawMode(true);
      output.write(`${PASTE_ON}Press Enter to ${effect}. Ctrl+C stops, nothing changes. `);
      input.on('data', onData);
      input.once('end', onEnd);
      input.once('close', onEnd);
      input.once('error', onEnd);
      wait();
      input.resume();
    } catch { finish(false); }
  });
}

// The same prompt for a synchronous caller, in a child process that shares this terminal.
function pressEnterSync(effect, { environment = process.env, spawn = childProcess.spawnSync, output = process.stderr } = {}) {
  const refused = refusal({ environment, tty: { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(output.isTTY) } });
  if (refused) {
    output.write(`${stop(refused.stopped, refused.next, { stream: output, environment })}\n`);
    return false;
  }
  const result = spawn(process.execPath, [__filename, 'press-enter', String(effect)], { stdio: 'inherit', env: environment });
  return result.status === 0;
}

if (require.main === module) {
  const [command, effect] = process.argv.slice(2);
  if (command !== 'press-enter' || !effect) {
    process.stderr.write('Usage: node owner-terminal.cjs press-enter "<effect>"\n');
    process.exitCode = 2;
  } else pressEnter(effect).then((yes) => { process.exitCode = yes ? 0 : 1; });
}

module.exports = Object.freeze({ AGENT_MARKERS, QUIET_MS, PASTE_START, PASTE_END, colour, refusal, title, step, ok, stop, say, facts, pressEnter, pressEnterSync });
