'use strict';

// #460 S1-EXPLICIT-SETUP-INTENT-001: a session start never starts interactive setup. Only an
// explicit "setup toolkit" runs setup-toolkit.cjs, which owns the question bank; the session-start
// hooks and everything they load must not reach it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const SETUP_ENTRY = /setup-toolkit(?:-core)?\.cjs/;

function hookScripts(file) {
  const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')).hooks;
  return Object.values(hooks).flat().flatMap((entry) => entry.hooks)
    .map((hook) => /\/(repo\/scripts\/[^"\s]+\.cjs)/.exec(hook.command)?.[1]).filter(Boolean);
}

// Every Toolkit file a script loads with require('./...'), followed transitively.
function localRequireGraph(start) {
  const seen = new Set();
  const pending = [path.join(repoRoot, start)];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, target] of fs.readFileSync(file, 'utf8').matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
      const resolved = path.resolve(path.dirname(file), target);
      pending.push(resolved.endsWith('.cjs') || resolved.endsWith('.js') ? resolved : `${resolved}.cjs`);
    }
  }
  return [...seen];
}

test('session-start hooks never load or launch interactive setup', () => {
  const sessionStart = ['.claude-plugin/hooks/hooks.json', '.codex-plugin/hooks/hooks.json']
    .flatMap((file) => hookScripts(file).filter((script) => /session-start|local-bridge/.test(script)));
  assert.deepEqual(sessionStart.sort(), ['repo/scripts/toolkit-codex-session-start.cjs', 'repo/scripts/toolkit-local-bridge.cjs']);
  for (const script of sessionStart) {
    for (const file of localRequireGraph(script)) {
      const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
      assert.doesNotMatch(rel, SETUP_ENTRY, `${script} loads ${rel}`);
      // setup-codex-toolkit-plugin.cjs lists both files only as plugin payload paths, and the
      // continuation classifier lists the setup script's basename only to recognise it in a command.
      const text = fs.readFileSync(file, 'utf8').replace(/^\s*'(?:repo\/scripts\/)?setup-toolkit(?:-core)?\.cjs',\r?$/gm, '');
      assert.doesNotMatch(text, SETUP_ENTRY, `${rel} names an interactive setup entry`);
      assert.doesNotMatch(text, /setup-toolkit-question-bank:begin/, `${rel} prints a question bank`);
    }
  }
});
