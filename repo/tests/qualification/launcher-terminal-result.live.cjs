#!/usr/bin/env node
'use strict';

// UAT-F1 native verification (outside the CI glob). Replays retained native Claude Code
// stream-json captures through the candidate and corrected GateSessionLauncher and
// compares the reported text, error state and cost with the stream's terminal result
// event. Optionally runs one fresh isolated native session through the corrected
// launcher. Emits one JSON evidence record; raw streams are only digested, never copied.
//
// Usage: node launcher-terminal-result.live.cjs --candidate-ref <commit> --stream <file>... [--live <empty-dir>]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'repo', 'scripts');
const LAUNCHER = 'repo/scripts/toolkit-gate-session-launcher.cjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function args() {
  const out = { streams: [] }, a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--candidate-ref') out.candidateRef = a[++i];
    else if (a[i] === '--stream') out.streams.push(path.resolve(a[++i]));
    else if (a[i] === '--live') out.live = path.resolve(a[++i]);
    else throw new Error(`unknown argument ${a[i]}`);
  }
  if (!/^[0-9a-f]{40}$/.test(out.candidateRef || '')) throw new Error('--candidate-ref must be a full commit id');
  return out;
}

// Loads launcher bytes from a commit as a module beside the real scripts so its
// relative dependencies resolve to the same working-tree modules.
function launcherAt(ref) {
  const src = spawnSync('git', ['-C', ROOT, 'show', `${ref}:${LAUNCHER}`], { encoding: 'utf8' });
  if (src.status !== 0) throw new Error(`cannot read ${LAUNCHER} at ${ref}`);
  const filename = path.join(SCRIPTS, `__launcher-${ref.slice(0, 12)}.cjs`);
  const m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(SCRIPTS);
  m._compile(src.stdout, filename);
  return { GateSessionLauncher: m.exports.GateSessionLauncher, source_sha256: sha(src.stdout) };
}

function parse(raw) {
  return raw.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function terminal(raw) {
  const results = parse(raw).filter(l => l.type === 'result'), last = results.at(-1) || {};
  return { result_events: results.length,
    terminal: { result_text: typeof last.result === 'string' ? last.result : null, is_error: last.is_error === true,
      cost_usd: typeof last.total_cost_usd === 'number' ? last.total_cost_usd : null } };
}
const pick = run => ({ result_text: run.result_text, is_error: run.is_error, cost_usd: run.cost_usd });
const same = (a, b) => a.result_text === b.result_text && a.is_error === b.is_error && a.cost_usd === b.cost_usd;
const digestText = v => ({ ...v, result_text: v.result_text === null ? null : { sha256: sha(v.result_text), chars: v.result_text.length } });

function gateFor() {
  const { GateAssignment } = require(path.join(SCRIPTS, 'toolkit-v3-lifecycle.cjs'));
  const h = s => sha(s);
  return GateAssignment.admit({ assignment_id: 'uat-f1-native-verification', programme: 421, child: 461, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: h('uat-f1'), owner: 'owner' } })
    .launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' }).gate;
}
function captured() { return require(path.join(ROOT, 'repo', 'tests', 'support', 'captured-stack-fixture.cjs')).capturedStack('owner-claude'); }

function replay(Launcher, raw) {
  const launcher = new Launcher({ captured: captured(), role: 'G1', claude: 'claude', spawn: () => ({ status: 0, stdout: raw }) });
  return pick(launcher.start(gateFor(), { session_id: 's1', prompt: 'replay', cwd: ROOT }));
}

function main() {
  const opt = args();
  const head = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const candidate = launcherAt(opt.candidateRef);
  const corrected = { GateSessionLauncher: require(path.join(SCRIPTS, 'toolkit-gate-session-launcher.cjs')).GateSessionLauncher,
    source_sha256: sha(fs.readFileSync(path.join(ROOT, LAUNCHER), 'utf8')) };
  const replays = opt.streams.map(file => {
    const raw = fs.readFileSync(file, 'utf8'), t = terminal(raw);
    const cand = replay(candidate.GateSessionLauncher, raw), corr = replay(corrected.GateSessionLauncher, raw);
    return { stream: path.basename(file), stream_sha256: sha(raw), result_events: t.result_events,
      terminal: digestText(t.terminal), candidate: digestText(cand), corrected: digestText(corr),
      candidate_matches_terminal: same(cand, t.terminal), corrected_matches_terminal: same(corr, t.terminal) };
  });
  let live = null;
  if (opt.live) {
    fs.mkdirSync(opt.live, { recursive: true });
    if (fs.readdirSync(opt.live).length) throw new Error('--live directory must be empty');
    let raw = '';
    const launcher = new corrected.GateSessionLauncher({ captured: captured(), role: 'G1',
      base_args: ['--setting-sources', 'project,local', '--max-turns', '2'],
      spawn: (cmd, a, o) => { const r = spawnSync(cmd, a, o); raw = String(r.stdout || ''); return r; } });
    const run = launcher.start(gateFor(), { session_id: 's1', prompt: 'Reply with exactly: UAT-F1-LIVE-OK', cwd: opt.live });
    const t = terminal(raw);
    live = { exit: run.exit, model: run.model, result_events: t.result_events, stream_sha256: sha(raw),
      terminal: digestText(t.terminal), corrected: digestText(pick(run)), corrected_matches_terminal: same(pick(run), t.terminal),
      text_is_expected: run.result_text === 'UAT-F1-LIVE-OK', cost_usd: run.cost_usd };
  }
  const record = { schema: 'toolkit.v3.uat-f1-native-verification.v1', at_utc: new Date().toISOString(), head,
    candidate_ref: opt.candidateRef, candidate_launcher_sha256: candidate.source_sha256,
    corrected_launcher_sha256: corrected.source_sha256, replays, live,
    // A stream without a terminal result is missing evidence, never a pass.
    pass: replays.length > 0 && replays.every(r => r.result_events > 0 && r.corrected_matches_terminal)
      && (!live || (live.result_events > 0 && live.corrected_matches_terminal && live.exit === 0)) };
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  process.exitCode = record.pass ? 0 : 1;
}

main();
