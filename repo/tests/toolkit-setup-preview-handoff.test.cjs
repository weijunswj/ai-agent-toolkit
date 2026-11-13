'use strict';

// A setup preview (`--plan`, `--explain`) runs in the managed checkout, like the run does, so both work
// out the bank with the same script. Two script copies working out the bank once showed the owner a
// third bank. A stub managed checkout in a throwaway home records how it was started.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');
const { AGENT_HOST_MARKER_NAMES } = require('../scripts/agent-host-markers.cjs');

const SETUP = path.resolve(__dirname, '..', 'scripts', 'setup-toolkit.cjs');
const DEPTH = 'AI_AGENT_TOOLKIT_MANAGED_DELEGATION_DEPTH';

const homes = [];
test.after(() => { for (const dir of homes) fs.rmSync(dir, { recursive: true, force: true }); });

function stubHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-preview-handoff-'));
  homes.push(home);
  const script = path.join(home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'setup-toolkit.cjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  const probe = { protocol: core.MANAGED_QUESTION_BANK_PROTOCOL, question_bank_stream: 'stdout', control_fd: 3, acknowledgement_fd: 4, pause_status: core.SETUP_PAUSED_FOR_QUESTION_BANK };
  fs.writeFileSync(script, [
    "'use strict';",
    `if (process.argv[2] === '--managed-question-bank-protocol-probe') { process.stdout.write(${JSON.stringify(JSON.stringify(probe))} + '\\n'); process.exit(0); }`,
    `process.stdout.write('STUB ' + JSON.stringify({ argv: process.argv.slice(2), depth: process.env.${DEPTH}, cwd: process.cwd() }) + '\\n');`,
    'process.exit(0);',
  ].join('\n'));
  return { home, root: path.dirname(path.dirname(path.dirname(script))) };
}

function setup(home, argv, extraEnv = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, CI: 'true', ...extraEnv };
  // The test runner may itself run inside a coding app; its markers would stop a Codex preview.
  for (const name of [DEPTH, ...AGENT_HOST_MARKER_NAMES]) delete env[name];
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [SETUP, ...argv], { env, encoding: 'utf8', timeout: 60000 });
}

const stubbed = result => {
  const line = String(result.stdout).split('\n').find(text => text.startsWith('STUB '));
  return line ? JSON.parse(line.slice(5)) : null;
};

for (const argv of [['--plan', '--host', 'codex'], ['--plan', '--host', 'codex', '--explain', '1.2']]) {
  test(`${argv.join(' ')} runs the managed checkout's script with the same arguments, once`, () => {
    const { home, root } = stubHome();
    const result = setup(home, argv);
    assert.equal(result.status, 0, result.stderr);
    const seen = stubbed(result);
    assert.ok(seen, `the managed script ran: ${result.stdout}\n${result.stderr}`);
    assert.deepEqual(seen.argv, argv);
    assert.equal(seen.depth, '1', 'marked as a hand-off, so the managed script never hands off again');
    assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(root));
  });
}

test('a preview with --repo-root does not hand off', () => {
  const { home } = stubHome();
  const result = setup(home, ['--plan', '--host', 'codex', '--repo-root', path.resolve(__dirname, '..', '..')]);
  assert.equal(stubbed(result), null);
});

test('a preview inside a hand-off refuses to hand off again', () => {
  const { home } = stubHome();
  const result = setup(home, ['--plan', '--host', 'codex'], { [DEPTH]: '1' });
  assert.equal(stubbed(result), null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recursive/i);
});
