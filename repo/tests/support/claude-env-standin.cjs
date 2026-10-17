'use strict';

// Harmless stand-in for the native Claude Code CLI in launcher environment tests: it starts no model and
// makes no network call. It writes one marker file in the directory given as the prompt (so a test can count
// real child processes) and reports, as stream-json, the environment and home directory it received.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const after = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
fs.writeFileSync(path.join(after('-p'), `child-${process.pid}-${crypto.randomUUID()}`), '');
const report = { env: { ...process.env }, home: os.homedir(), effort: after('--effort') };
process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: after('--session-id') || after('--resume'), model: after('--model') })}\n`
  + `${JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(report), total_cost_usd: 0 })}\n`);
