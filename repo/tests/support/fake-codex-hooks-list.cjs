'use strict';
// Stand-in for `codex app-server --listen stdio://` in the hook check tests. It answers initialize and
// hooks/list only, from <CODEX_HOME>/fake-hooks-list.json ({ mode, result }), and logs its pid and every
// method it receives to <CODEX_HOME>/fake-hooks-list.log. It never calls a model or writes config.toml.
// Modes: answer (default) | exit | error-reply | no-result | garbled | hang.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const home = process.env.CODEX_HOME;
const spec = JSON.parse(fs.readFileSync(path.join(home, 'fake-hooks-list.json'), 'utf8'));
const log = line => fs.appendFileSync(path.join(home, 'fake-hooks-list.log'), `${line}\n`);
log(`pid ${process.pid}`);
log(`argv ${process.argv.slice(2).join(' ')}`);
if (spec.mode === 'exit') process.exit(3);
if (spec.mode === 'hang' || spec.mode === 'garbled') setInterval(() => {}, 1000);
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
readline.createInterface({ input: process.stdin }).on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  log(`method ${message.method}`);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method !== 'hooks/list' || spec.mode === 'hang') return;
  if (spec.mode === 'garbled') process.stdout.write('not json\n{"id":2,"result":\n');
  else if (spec.mode === 'error-reply') send({ id: message.id, error: { message: 'hooks/list failed' } });
  else if (spec.mode === 'no-result') send({ id: message.id });
  else send({ id: message.id, result: spec.result });
});
