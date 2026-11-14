'use strict';

// refresh toolkit: every row keeps its displayed A. Keep current with no bank while the questions match
// the last bank answered on this computer; any new or different question shows the full bank.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../scripts/setup-toolkit-core.cjs');

const HOSTS = ['codex', 'claude-code'];

function tempFolder(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-refresh-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

// A settled computer: everything installed, current and answered before.
function settledState(host, overrides = {}) {
  const base = core.documentationFixtureState();
  const state = {
    ...base,
    ...(host === 'claude-code' ? {
      agentProfile: { supported: true, topology: 'root-only' },
      claudeSubagentDepth: { state: 'default' },
      claudeSettings: [],
      claudePluginInstall: { installed: true, enabled: true, recordCurrent: true, version: '1.0.0', runningRoot: base.managed.currentPath },
      nativePlugin: { status: 'fresh', manifest_version: '1.0.0' },
    } : {}),
  };
  for (const [key, value] of Object.entries(overrides)) state[key] = typeof value === 'function' ? value(state[key]) : value;
  return state;
}

function refreshArgs(host) {
  return core.parseArgs(['--execute', '--profile', 'auto-main', '--host', host, '--refresh']);
}

function specsFor(host, state) {
  return core.setupQuestionSpecs(core.parseArgs(['--execute', '--host', host]), state);
}

// Saves the shapes of the bank as answered in `state`, the way an answered setup run does.
function saveAnswered(file, host, state) {
  core.saveRefreshShapes(core.refreshShapeRows(specsFor(host, state), state), host, { refreshShapePath: file });
}

async function refresh(host, state, file) {
  const args = refreshArgs(host);
  let written = '';
  let prompted = false;
  const logs = [];
  const log = console.log;
  console.log = (...parts) => logs.push(parts.join(' '));
  try {
    const result = await core.answerSetupQuestionBank(args, state, {
      isTTY: true,
      refreshShapePath: file,
      write(text) { written += text; return true; },
      createReadlineInterface() {
        return { async question() { prompted = true; throw new Error('Setup question bank requires an answer (test pause)'); }, close() {} };
      },
    });
    return { args, result, written, prompted, logs: logs.join('\n') };
  } catch (error) {
    return { args, error, written, prompted, logs: logs.join('\n') };
  } finally {
    console.log = log;
  }
}

function assertBankShown(outcome, pattern) {
  assert.match(outcome.written, new RegExp(core.QUESTION_BANK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(outcome.prompted, true, 'the bank waits for an answer');
  assert.match(String(outcome.error?.message), /Setup question bank requires/);
  if (pattern) assert.match(outcome.logs, pattern);
}

function assertKept(outcome) {
  assert.equal(outcome.error, undefined, outcome.error?.stack);
  assert.doesNotMatch(outcome.written, /setup-toolkit-question-bank/);
  assert.equal(outcome.prompted, false);
  assert.equal(outcome.result.appeared, false);
  assert.equal(outcome.result.answer_source, 'refresh kept current answers');
  assert.match(outcome.written, /refresh kept your current answers/);
}

for (const host of HOSTS) {
  test(`${host}: same questions keep every displayed Keep current with no bank`, async (t) => {
    const file = path.join(tempFolder(t), 'shapes.json');
    const state = settledState(host);
    saveAnswered(file, host, state);
    const outcome = await refresh(host, state, file);
    assertKept(outcome);
    for (const spec of specsFor(host, state).filter((row) => !row.report_only)) {
      const value = outcome.args.setupChoices[spec.key] ?? '';
      assert.equal(spec.choices[0].label, 'Keep current', spec.id);
      // Setup turns a kept agent topology into the topology it read, after any answer, as it does after a bank.
      if (spec.key === 'claudeTopology') { assert.equal(value, 'root-only'); continue; }
      assert.equal(value, spec.choices[0].value, `${spec.id} keeps its displayed A`);
    }
  });

  test(`${host}: a Current text change alone (a version move) stays silent`, async (t) => {
    const file = path.join(tempFolder(t), 'shapes.json');
    saveAnswered(file, host, settledState(host));
    const moved = settledState(host, {
      codexInstall: (install) => ({ ...install, versions: ['1.1.0'], version: '1.1.0', sourceVersion: '1.1.0' }),
      ...(host === 'claude-code' ? {
        claudePluginInstall: (install) => ({ ...install, version: '1.1.0' }),
        nativePlugin: { status: 'fresh', manifest_version: '1.1.0' },
      } : {}),
    });
    assertKept(await refresh(host, moved, file));
  });

  test(`${host}: a new question shows the full bank and names it`, async (t) => {
    const file = path.join(tempFolder(t), 'shapes.json');
    const state = settledState(host);
    const rows = core.refreshShapeRows(specsFor(host, state), state);
    delete rows['update-reports'];
    core.saveRefreshShapes(rows, host, { refreshShapePath: file });
    assertBankShown(await refresh(host, state, file), /Update reports: it is new/);
  });

  test(`${host}: a changed question or choice list shows the full bank`, async (t) => {
    const file = path.join(tempFolder(t), 'shapes.json');
    const state = settledState(host);
    const rows = core.refreshShapeRows(specsFor(host, state), state);
    rows['update-reports'] = { ...rows['update-reports'], shape: 'f'.repeat(64) };
    core.saveRefreshShapes(rows, host, { refreshShapePath: file });
    assertBankShown(await refresh(host, state, file), /Update reports: its question or choices changed/);
  });

  test(`${host}: a newly recommended change shows the bank; one already declined stays silent`, async (t) => {
    const file = path.join(tempFolder(t), 'shapes.json');
    saveAnswered(file, host, settledState(host));
    const off = settledState(host, { audit: audit => ({ ...audit, update_report_enabled: false }) });
    assertBankShown(await refresh(host, off, file), /setup now recommends a change/);
    // Answered with the recommendation showing: the owner kept Off, so later refreshes keep it.
    saveAnswered(file, host, off);
    const kept = await refresh(host, off, file);
    assertKept(kept);
    assert.equal(kept.args.setupChoices.updateReports, 'keep');
    assert.equal(kept.args.updateReports, false);
  });

  test(`${host}: no saved record, or an unreadable one, shows the bank once`, async (t) => {
    const folder = tempFolder(t);
    const state = settledState(host);
    assertBankShown(await refresh(host, state, path.join(folder, 'missing.json')), /none saved yet/);
    const broken = path.join(folder, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    assertBankShown(await refresh(host, state, broken), /could not be read/);
    assert.equal(fs.readFileSync(broken, 'utf8'), '{ not json', 'nothing is written before answers');
    fs.writeFileSync(broken, JSON.stringify({ version: 1, hosts: { [host]: { rows: { 'update-source': { shape: 'short', recommendation: 'Keep current' } } } } }));
    assertBankShown(await refresh(host, state, broken), /could not be read/);
  });

  test(`${host}: a removed question does not bring the bank back`, async (t) => {
    const file = path.join(tempFolder(t), 'shapes.json');
    const state = settledState(host);
    const rows = core.refreshShapeRows(specsFor(host, state), state);
    rows['retired-question'] = { shape: 'a'.repeat(64), recommendation: 'Keep current' };
    core.saveRefreshShapes(rows, host, { refreshShapePath: file });
    assertKept(await refresh(host, state, file));
  });
}

test('codex: an installed, turned-on plugin left behind by an update is refreshed with no bank', async (t) => {
  const file = path.join(tempFolder(t), 'shapes.json');
  saveAnswered(file, 'codex', settledState('codex'));
  const stale = settledState('codex', { codexInstall: (install) => ({ ...install, version: '1.0.0', sourceVersion: '1.1.0', older: true, cacheFresh: false }) });
  const plugin = specsFor('codex', stale).find((row) => row.id === 'codex-toolkit-plugin');
  assert.equal(plugin.choices[0].value, 'keep', 'the stale row offers a no-change Keep current');
  assert.equal(plugin.recommended, 'install');
  const outcome = await refresh('codex', stale, file);
  assertKept(outcome);
  assert.equal(outcome.args.setupChoices.codexPluginBehavior, 'install');
  assert.match(outcome.logs, /Keep Toolkit available in Codex\?: Install or refresh/);
});

test('codex: a turned-off plugin is a real change, so the bank asks', async (t) => {
  const file = path.join(tempFolder(t), 'shapes.json');
  saveAnswered(file, 'codex', settledState('codex'));
  const off = settledState('codex', { codexInstall: (install) => ({ ...install, plugin: 'off' }) });
  assertBankShown(await refresh('codex', off, file), /Keep Toolkit available in Codex\?: setup now recommends a change/);
});

test('claude-code: an installed, turned-on plugin left behind by an update is refreshed with no bank', async (t) => {
  const file = path.join(tempFolder(t), 'shapes.json');
  saveAnswered(file, 'claude-code', settledState('claude-code'));
  const stale = settledState('claude-code', { nativePlugin: { status: 'stale', manifest_version: '1.1.0' } });
  const outcome = await refresh('claude-code', stale, file);
  assertKept(outcome);
  assert.equal(outcome.args.setupChoices.claudePluginBehavior, 'install');
});

test('claude-code: a turned-off plugin is a real change, so the bank asks', async (t) => {
  const file = path.join(tempFolder(t), 'shapes.json');
  saveAnswered(file, 'claude-code', settledState('claude-code'));
  const off = settledState('claude-code', {
    claudePluginInstall: (install) => ({ ...install, enabled: false }),
    nativePlugin: { status: 'stale', manifest_version: '1.1.0' },
  });
  assertBankShown(await refresh('claude-code', off, file), /Keep Toolkit available in Claude Code\?: setup now recommends a change/);
});

test('--refresh refuses every other answer source before any write', () => {
  const base = ['--execute', '--profile', 'auto-main', '--refresh'];
  for (const extra of [
    ['--yes-recommended'], ['--approve-codex-config-proposal'], ['--approve-high-helper-capacity'],
    ['--keep-repo-auto-update'], ['--codex-helper-count', '1'],
    ['--update-report-retention-days', '3'], ['--repo-root', os.tmpdir()], ['--claude-settings', 'keep'],
    ['--codex-plugin-behavior', 'install'],
  ]) {
    assert.throws(() => core.parseArgs([...base, ...extra]), /--refresh keeps every current answer/, extra.join(' '));
  }
  assert.throws(() => core.parseArgs(['--plan', '--refresh']), /--refresh keeps every current answer/);
  assert.throws(() => core.parseArgs(['--refresh']), /--refresh runs with --execute/);
  assert.equal(core.parseArgs(base).refresh, true);
  // The retired task flag is no answer source: refresh accepts it and ignores it.
  assert.equal(core.parseArgs([...base, '--scheduled-task-update', 'standing']).retiredScheduledTaskFlag, true);
});

test('the saved record holds question shapes only, per app, and is rewritten only when it changes', (t) => {
  const file = path.join(tempFolder(t), 'nested', 'shapes.json');
  const codex = settledState('codex');
  const claude = settledState('claude-code');
  assert.equal(core.saveRefreshShapes(core.refreshShapeRows(specsFor('codex', codex), codex), 'codex', { refreshShapePath: file }), true);
  assert.equal(core.saveRefreshShapes(core.refreshShapeRows(specsFor('claude-code', claude), claude), 'claude-code', { refreshShapePath: file }), true);
  assert.equal(core.saveRefreshShapes(core.refreshShapeRows(specsFor('codex', codex), codex), 'codex', { refreshShapePath: file }), false);
  const text = fs.readFileSync(file, 'utf8');
  const record = JSON.parse(text);
  assert.deepEqual(Object.keys(record.hosts).sort(), ['claude-code', 'codex']);
  for (const rows of Object.values(record.hosts).map((entry) => entry.rows)) {
    for (const row of Object.values(rows)) {
      assert.deepEqual(Object.keys(row).sort(), ['recommendation', 'shape']);
      assert.match(row.shape, /^[a-f0-9]{64}$/);
    }
  }
  for (const secret of [codex.managed.currentPath, os.homedir(), '1.0.0', 'after-gates']) {
    assert.equal(text.includes(secret), false, `record leaks ${secret}`);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['shapes.json'], 'no temporary file is left behind');
});

// The managed route: a child that keeps the current answers reports it on the control channel and waits
// for the parent's acknowledgement; the parent forwards its output and refuses any bank alongside it.
function runParent(t, childLines, argv) {
  const folder = tempFolder(t);
  const child = path.join(folder, 'child.cjs');
  fs.writeFileSync(child, ["'use strict';", "const fs = require('node:fs');", ...childLines, ''].join('\n'));
  const driver = path.join(folder, 'driver.cjs');
  fs.writeFileSync(driver, [
    "'use strict';",
    `const core = require(${JSON.stringify(path.resolve(__dirname, '../scripts/setup-toolkit-core.cjs'))});`,
    `core.runManagedQuestionBankChild(${JSON.stringify(child)}, ${JSON.stringify(folder)}, ${JSON.stringify(argv)}, { timeoutMs: 20000 })`,
    "  .then((status) => { process.stdout.write(`\\nPARENT STATUS ${status}\\n`); })",
    "  .catch((error) => { process.stdout.write(`\\nPARENT FAILED ${error.message}\\n`); });",
    '',
  ].join('\n'));
  return spawnSync(process.execPath, [driver], { encoding: 'utf8', timeout: 30000 });
}

const receipt = JSON.stringify({ protocol: core.MANAGED_QUESTION_BANK_PROTOCOL, event: 'refresh-kept-current', stream: 'stdout', question_count: 11 });
const keptChild = (extra = []) => [
  "fs.writeSync(1, 'Refresh kept your current answers\\n');",
  `fs.writeSync(3, ${JSON.stringify(`${receipt}\n`)});`,
  "const ack = fs.readFileSync(4, 'utf8').trim();",
  "if (ack !== 'refresh-kept-current-visible') process.exit(91);",
  ...extra,
  "fs.writeSync(1, 'writes after the acknowledgement\\n');",
  'process.exit(0);',
];

test('managed route: a kept-current refresh is acknowledged and its output forwarded', (t) => {
  const result = runParent(t, keptChild(), ['--execute', '--profile', 'auto-main', '--refresh']);
  assert.match(result.stdout, /Refresh kept your current answers/);
  assert.match(result.stdout, /writes after the acknowledgement/);
  assert.match(result.stdout, /PARENT STATUS 0/);
});

test('managed route: a kept-current receipt is refused on a setup run', (t) => {
  const result = runParent(t, keptChild(), ['--execute', '--profile', 'auto-main']);
  assert.match(result.stdout, /PARENT FAILED .*control receipt/);
  assert.doesNotMatch(result.stdout, /writes after the acknowledgement/);
});

test('managed route: a refresh that also prints a bank is refused', (t) => {
  const result = runParent(t, keptChild([`fs.writeSync(1, ${JSON.stringify(`${core.QUESTION_BANK_BEGIN}\n`)});`]), ['--execute', '--profile', 'auto-main', '--refresh']);
  assert.match(result.stdout, /PARENT FAILED .*control receipt/);
});

test('an answered setup run saves the question shapes the next refresh compares with', (t) => {
  const support = require('./toolkit-setup-test-support.cjs');
  const root = support.tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { origin, setupRepo } = support.createGitBackedSetupRepo(root);
  const result = support.run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: support.isolatedHomeEnv(root), timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const record = JSON.parse(fs.readFileSync(path.join(root, '.ai-agent-toolkit', 'user-state', 'setup-question-shapes.json'), 'utf8'));
  assert.equal(record.version, 1);
  assert.ok(Object.keys(record.hosts.codex.rows).includes('update-source'));
});
