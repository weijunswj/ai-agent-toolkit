'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const toml = require('../scripts/toolkit-toml-structural.cjs');
const migration = require('../scripts/toolkit-managed-config-migration.cjs');
const setup = require('../scripts/setup-codex-toolkit-plugin.cjs');

const fixturePath = path.join(__dirname, 'fixtures', 'toolkit-toml', 'escaped-triple-quote-user-content.toml');

test('shared structural boundary accepts escaped triple quotes without exposing user strings', () => {
  const text = fs.readFileSync(fixturePath, 'utf8');
  const analysis = toml.analyseToml(text);
  assert.equal(analysis.validity.ok, true, analysis.validity.detail);
  assert.match(analysis.validity.parser, /tomllib/);
  assert.deepEqual(analysis.tables.map((table) => table.path), [['quoted.table', 'segment']]);
  assert.equal(analysis.lines.filter((line) => line.structural_comment && /AI-AGENT-TOOLKIT/.test(line.text)).length, 0);
  assert.equal(migration.inspectManagedConfiguration({ text }).status, 'NOOP');
  assert.equal(setup.inspectConfiguredPluginState(text, setup.pluginId()).status, 'unprovable');
});

test('shared structure decodes one real plugin table and one direct boolean enabled value', () => {
  const identity = setup.pluginId();
  const base = fs.readFileSync(fixturePath, 'utf8');
  const enabled = `${base}\n[plugins."${identity}"]\nenabled = true\n`;
  assert.equal(toml.analyseToml(enabled).validity.ok, true);
  assert.equal(setup.inspectConfiguredPluginState(enabled, identity).status, 'enabled');
  for (const invalid of [
    `[plugins."${identity}"]\nenabled = true\nenabled = false\n`,
    `[plugins."${identity}"]\nenabled = true\n[plugins.'${identity}']\nenabled = true\n`,
    `[[plugins."${identity}"]]\nenabled = true\n`,
    `[plugins."${identity}"]\nenabled = [true]\n`,
    `[plugins."${identity}"]\nstate = { enabled = true }\n`,
  ]) assert.equal(setup.inspectConfiguredPluginState(invalid, identity).status, 'unprovable');
});
