'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { toolkitSkillPayload, parseArgs } = require('../scripts/toolkit-local-bridge.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-native-routes-'));
}

test('the bridge has no OpenCode or AG2 target options', () => {
  for (const argv of [
    ['--enable-target', 'opencode'], ['--disable-target', 'ag2'], ['--install-opencode-project-plugin'],
    ['--opencode-project-root', 'C:/example'], ['--opencode-config-dir', 'C:/example'], ['--opencode-target', 'C:/example'],
    ['--set-ag2-python-command', 'python'],
  ]) assert.throws(() => parseArgs(argv), /Unknown argument/, argv[0]);
  assert.equal(parseArgs(['--copy-antigravity-skills', '--antigravity-project-root', 'C:/example']).copyAntigravitySkills, true);
});

test('the hub skill payload holds only the Toolkit skill files', (t) => {
  const source = tempRoot();
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  fs.mkdirSync(path.join(source, 'skills', 'portable-example'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills', 'portable-example', 'SKILL.md'), '---\nname: portable-example\n---\n');
  assert.deepEqual(Object.keys(toolkitSkillPayload({}, source)), ['skills/portable-example/SKILL.md']);
});
