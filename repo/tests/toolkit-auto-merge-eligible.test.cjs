'use strict';

// Task auto-merge eligibility: the always-manual list and the CLI the auto-merge-eligible check runs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const eligible = require('../scripts/toolkit-auto-merge-eligible.cjs');

test('the always-manual paths and a major bump wait for the owner; ordinary changes are eligible', () => {
  const verdict = (files, toolkit = true, versions = {}) => eligible.eligibility({ files, toolkit, versions });
  assert.deepEqual(verdict(['repo/scripts/run-tests.cjs', 'repo/docs/README.md', 'skills/frontend-art-direction/SKILL.md', 'repo/tests/x.test.cjs']), { eligible: true, reasons: [] });
  const manual = [
    '.github/toolkit-programme.json', '.github/workflows/validate.yml', 'AGENTS.md', 'sub/CLAUDE.md', '.github/copilot-instructions.md',
    'hooks/hooks.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-governance-hook.cjs', 'repo/scripts/toolkit-codex-helper-hook.ps1',
    '.claude/settings.json', '.codex/config.toml',
    'repo/contracts/agent-rules/global-rules.md', 'repo/contracts/agent-rules/gate-rules.md', 'repo/CONTROLLER.md',
    'repo/contracts/claude-projects/web-controller-projects/SKILL.md', 'repo/contracts/programme-state/binding-v2.schema.json',
    'skills/github-program-reconciler/scripts/programme-state.cjs', 'repo/scripts/toolkit-merge-hold.cjs', 'repo/scripts/toolkit-shell-call.cjs',
    'repo/scripts/toolkit-auto-merge-eligible.cjs', 'repo/scripts/toolkit-governance-state.cjs', '.agents/rules/00-bootstrap.md',
    'skills/repository-agent-rules/SKILL.md',
  ];
  for (const file of manual) {
    const result = verdict(['repo/docs/README.md', file]);
    assert.equal(result.eligible, false, file);
    assert.deepEqual(result.reasons.map(entry => entry.path), [file], file);
  }
  assert.equal(verdict(['repo/CONTROLLER.md'], false).eligible, true, 'the Toolkit list applies only to the Toolkit repository');
  assert.equal(verdict(['AGENTS.md'], false).eligible, false, 'the general list applies everywhere');
  assert.match(verdict([], true, { 'repo/contracts/toolkit-local-bridge/version.json': { before: '3.20.0', after: '4.0.0' } }).reasons[0].why, /major version bump/);
  assert.equal(verdict([], true, { 'repo/contracts/toolkit-local-bridge/version.json': { before: '3.20.0', after: '3.21.0' } }).eligible, true);
  // What the release bump at merge time touches is eligible: plugin metadata, the bridge version.
  assert.equal(verdict(['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'repo/scripts/toolkit-local-bridge.cjs', 'repo/docs/CHANGELOG.md']).eligible, true);
  assert.equal(eligible.eligibility({ files: ['AGENTS.md'], toolkit: true, stampOnly: ['AGENTS.md'] }).eligible, true, 'a stamp-only change');
  const marker = version => `<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=${version} sha256=59b80466f009 -->\nbody\nVersion: 2026-10-30.2\n`;
  assert.equal(eligible.withoutStamps(marker('3.19.19')), eligible.withoutStamps(marker('3.20.0').replace('30.2', '31.1')));
  assert.notEqual(eligible.withoutStamps(marker('3.19.19')), eligible.withoutStamps(marker('3.19.19').replace('body', 'changed body')));
});

test('CI runs the default branch\'s copy, which needs nothing but Node\'s own modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'toolkit-auto-merge-eligible.cjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map(match => match[1].trim()), ["'node:child_process'"]);
  const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'auto-merge-eligible.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n {2}pull_request_target:/m, 'the default branch\'s workflow decides');
  assert.match(workflow, /git show "\$BASE_SHA:repo\/scripts\/toolkit-auto-merge-eligible\.cjs"/, 'the default branch\'s script decides');
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /^ {2}auto-merge-eligible:$/m, 'the check name the binding requires');
});

test('the CLI reads the diff with git: exit 0 eligible, 1 always manual, 2 unreadable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-eligible-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    assert.equal(run(['add', '-A']).status, 0);
    assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', file]).status, 0);
    return run(['rev-parse', 'HEAD']).stdout.trim();
  };
  assert.equal(run(['init', '-q', '-b', 'main']).status, 0);
  const base = commit('repo/contracts/agent-rules/global-rules.md', 'rules\n');
  const docs = commit('repo/docs/a.md', 'a\n');
  const hook = commit('hooks/hooks.json', '{}\n');
  const bump = commit('repo/contracts/toolkit-local-bridge/version.json', '{"version":"4.0.0"}\n');
  const out = [];
  const io = { cwd: root, stdout: { write: text => out.push(text) }, stderr: { write: text => out.push(text) } };
  assert.equal(eligible.main(['--base', base, '--head', docs], io), 0);
  assert.equal(eligible.main(['--base', docs, '--head', hook, '--json'], io), 1);
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: 'hooks/hooks.json', why: 'a hook' }]);
  assert.equal(eligible.main(['--base', hook, '--head', bump], io), 0, 'a first version file is no major bump');
  const stamped = commit('AGENTS.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.19.19 sha256=59b80466f009 -->\nrules\n');
  const restamped = commit('AGENTS.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nrules\n');
  assert.equal(eligible.main(['--base', stamped, '--head', restamped], io), 0, 'the release bump\'s marker change is eligible');
  const reworded = commit('AGENTS.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nlooser rules\n');
  assert.equal(eligible.main(['--base', restamped, '--head', reworded], io), 1, 'a rules change is not');
  assert.equal(eligible.main(['--base', bump, '--head', stamped], io), 1, 'a new instruction file is not stamp-only');
  assert.equal(run(['rm', '-q', 'repo/contracts/agent-rules/global-rules.md']).status, 0);
  assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'drop']).status, 0);
  const dropped = run(['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(eligible.main(['--base', reworded, '--head', dropped, '--json'], io), 1, 'deleting the marker still gets the Toolkit list');
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: 'repo/contracts/agent-rules/global-rules.md', why: 'the agent rules' }]);
  assert.equal(eligible.main(['--base', 'nope', '--head', hook], io), 2);
  assert.equal(eligible.main(['--base', 'f'.repeat(40), '--head', hook], io), 2);
  assert.equal(eligible.main(['--head', hook], io), 2);
});
