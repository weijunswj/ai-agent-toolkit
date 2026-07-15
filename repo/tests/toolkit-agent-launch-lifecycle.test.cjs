'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const control = require('../scripts/toolkit-agent-control.cjs');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test('detached Claude supervisor forces medium non-fast invocation and releases its reservation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-lifecycle-'));
  const fake = path.join(root, 'fake-claude.cjs');
  fs.writeFileSync(fake, [
    "'use strict';",
    "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), fast_disabled: process.env.CLAUDE_CODE_DISABLE_FAST_MODE, background_disabled: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS }));",
    '',
  ].join('\n'));
  const result = control.launch({
    child_responsibility: 'Implement the isolated parser shard and focused unit coverage.',
    parent_responsibility: 'Review the integration interface and reconcile adjacent contracts.',
    integration_plan: 'The root owns interface reconciliation and final integration judgement.',
    validation_plan: 'The root runs cross-shard validation and reviews the final combined diff.',
    material_benefit: 'The isolated parser work is independent and improves implementation quality.',
    child_prompt: 'Implement only the isolated parser shard.',
  }, {
    root,
    claudeCli: fake,
    profile: { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT, capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0 },
    resourceState: { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB, commit_available: 32 * control.GIB },
  });
  assert.equal(result.result, control.RESULTS.START);
  assert.equal(result.status, 'launched');
  let output = '';
  let reservations = [{}];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(result.output_path)) output = fs.readFileSync(result.output_path, 'utf8');
    const state = JSON.parse(fs.readFileSync(control.statePath({ root }), 'utf8'));
    reservations = state.reservations;
    if (output && reservations.length === 0) break;
    await wait(25);
  }
  assert.equal(reservations.length, 0);
  const child = JSON.parse(output);
  assert.equal(child.fast_disabled, '1');
  assert.equal(child.background_disabled, '1');
  assert.deepEqual(child.args.slice(0, 7), ['--print', '--output-format', 'json', '--effort', 'medium', '--disallowedTools', 'Agent']);
});
