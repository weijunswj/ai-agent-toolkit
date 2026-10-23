'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runAgentRulesPreflight } = require('../scripts/toolkit-local-bridge.cjs');
const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');
const {
  repoRoot,
  tmpRoot,
  run,
  installToolkitCopy,
  claudeHookEnv,
  writeJson,
  writeFile,
  readLatestReport
} = require('./support/toolkit-local-bridge-fixture.cjs');

test('agent-rules preflight checks Claude shim content in Claude hook mode', () => {
  const templateDir = path.join(repoRoot, 'skills', 'repository-agent-rules', 'repo-local');
  assert.equal(fs.readFileSync(path.join(templateDir, 'CLAUDE.shim.template.md'), 'utf8'), '@AGENTS.md\n');
  const oldMarkedShim = [
    '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/repo-local/CLAUDE.shim.template.md:BEGIN CLAUDE.SHIM v2 toolkit=3.5.0 sha256=5bab3ffc1689 -->',
    '# Claude Code Instructions',
    '',
    '@AGENTS.md',
    '',
    'Root `AGENTS.md` is canonical.',
    '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/repo-local/CLAUDE.shim.template.md:END CLAUDE.SHIM -->',
    ''
  ].join('\n');
  const cases = [
    ['@AGENTS.md\n', []],
    ['@AGENTS.md\r\n', []],
    ['# Our notes\n\n@AGENTS.md\n\nMore of our own text.\n', []],
    [oldMarkedShim, ['CLAUDE.md:stale-block']],
    ['@./AGENTS.md\n', ['CLAUDE.md:unmanaged']],
    ['See `@AGENTS.md` for the rules.\n', ['CLAUDE.md:unmanaged']],
    ['# Notes\n\n```text\n@AGENTS.md\n```\n', ['CLAUDE.md:unmanaged']],
    ['@AGENTS.md\n<!-- AI-AGENT-TOOLKIT:other.md:BEGIN OTHER v2 toolkit=3.6.0 sha256=000000000000 -->\n', ['CLAUDE.md:broken-marker']]
  ];
  for (const [claudeText, expected] of cases) {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    writeFile(path.join(root, 'AGENTS.md'), fs.readFileSync(path.join(templateDir, 'AGENTS.managed.template.md'), 'utf8'));
    writeFile(path.join(root, 'CLAUDE.md'), claudeText);
    const result = runAgentRulesPreflight(
      { hook: true, syncSource: 'claude-plugin' },
      { targetRoot: root, pluginRoot: repoRoot }
    );
    assert.deepEqual(result.findings.map((finding) => `${finding.file}:${finding.kind}`), expected, JSON.stringify(claudeText));
    if (expected.length) assert.equal(result.status, 'needs-attention');
  }
});

test('Claude hook reports the install check and never runs Codex refresh', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  installToolkitCopy(root);
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: '1.0.0', auto_sync_enabled: true, repo_path: repoRoot
  });
  const renderer = ClaudeHelperAgentRenderer.fromRepository('owner-claude', repoRoot);
  const agents = path.join(root, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  const { file, text } = renderer.render('G0');
  fs.writeFileSync(path.join(agents, file), text.replace(/SHA-256 `[0-9a-f]{64}`/, `SHA-256 \`${'0'.repeat(64)}\``));

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: claudeHookEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(report.text, /^## Install check$/m);
  assert.doesNotMatch(report.text, /Claude Code native plugin cache/);
  assert.doesNotMatch(report.text, /Codex native plugin cache/);
  assert.doesNotMatch(report.text, /Codex plugin updated/);
});
