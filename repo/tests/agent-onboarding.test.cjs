'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

test('agent onboarding path exposes repo purpose and major navigation roots', () => {
  const readme = readText('README.md');
  const agents = readText('AGENTS.md');

  assert.match(readme, /A practical skills-first toolkit of reusable AI-agent skills and preserved source projects\./);
  assert.match(readme, /\[_projects\/\]\(_projects\/\) preserves project source, provenance, and reviewed AI-facing source\./);
  assert.match(readme, /\[skills\/\]\(skills\/\) contains copyable AI-agent skill folders\./);
  assert.match(readme, /\[repo\/\]\(repo\/\) contains repo maintenance docs, scripts, tests, and validation policy\./);
  assert.match(readme, /\| Full guide or source context \| Open a project under \[_projects\/\]\(_projects\/\), then its `_main\/` folder\. \|/);
  assert.match(readme, /\| Install a skill \| Copy the whole skill folder using \[Install Skills By Platform\]/);
  assert.match(readme, /\| Review skill safety \| Use the \[Skill Safety Matrix\]/);
  assert.match(readme, /\| Maintenance work \| Start with \[repo\/docs\/\]/);

  assert.match(agents, /This root `AGENTS\.md` is toolkit-repo-specific\./);
  assert.match(agents, /Toolkit-specific root rules live directly after the managed execution blocks\./);
  assert.match(agents, /Portable repo installs must use \[`skills\/ai-coding-agent-rules\/repo-local\/AGENTS\.managed\.template\.md`\]/);
  assert.match(agents, /Setup\/refresh: use \[For AI Agents\]\(repo\/docs\/FOR_AI_AGENTS\.md\); run `setup-toolkit\.cjs --execute`/);
});

test('agent onboarding path keeps source-of-truth and validation anchors visible', () => {
  const agents = readText('AGENTS.md');
  const sourceOfTruth = readText('repo/docs/SOURCE-OF-TRUTH.md');
  const validation = readText('repo/docs/VALIDATION-STRATEGY.md');

  assert.match(agents, /`_projects\/\*\*\/_main\/` preserves full source material and original docs\./);
  assert.match(agents, /`_projects\/\*\*\/curated_output_for_ai\/` stores reviewed AI-facing source material\./);
  assert.match(agents, /`_projects\/\*\*\/toolkit\.project\.json` is the routing and toolkit project-version contract\./);
  assert.match(agents, /`skills\/` contains copyable AI-agent skill folders\./);

  assert.match(sourceOfTruth, /The repo-wide generated surface is skills-first plus native plugin metadata\./);
  assert.match(sourceOfTruth, /Humans use `_projects\/\*\*` for source review and maintenance, agents use generated `skills\/\*\*` folders after sync, and native plugin installers read generated `\.codex-plugin\/\*\*` or `\.claude-plugin\/\*\*` metadata\./);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Persistent status, report, implementation plan, handoff, operations, setup, CI\/CD, deployment, safety, and troubleshooting notes belong under an existing `docs\/` path/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /read the relevant docs and treat them as active context/i);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /For `setup toolkit`, `refresh toolkit`, or plain `refresh` when the current task is clearly about Toolkit setup\/update state, run the host-aware orchestrator from a clean trusted checkout/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Claude Code uses `node repo\/scripts\/setup-toolkit\.cjs --execute --host claude-code`/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Even when Toolkit is already installed, complete the full setup journey so stale pieces are detected and patched in order/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /routine setup uses `repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs`/);
  assert.match(validation, /For this repo, the canonical full validation command is:/);
  assert.match(validation, /npm run validate:all/);
});

test('agent onboarding path does not advertise repo-wide MCP as a current surface', () => {
  const readme = readText('README.md');
  const surfaceAudit = readText('repo/docs/SURFACE-FIDELITY-AUDIT.md');

  assert.match(readme, /Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now\./);
  assert.match(surfaceAudit, /`mcp\/\*\*` is not shipped\./);
  assert.match(surfaceAudit, /Project manifests must not declare repo-wide `mcp\/\*\*` outputs or `publish_as: "mcp"` \/ `publish_as: "both"`\./);
  assert.match(surfaceAudit, /No tracked root `mcp\/\*\*` file is part of the current generated\/published surface\./);
});
