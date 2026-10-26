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

  // The README is a short front page: what it is, supported OS, install, update, remove, skills, where the docs live.
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings.slice(0, 6), ['Install', 'Update', 'Remove', 'Skills', 'Where the docs live', 'Appendix: Source-of-Truth Contract']);
  assert.match(readme.split('\n')[2], /^Skills and working rules for AI coding agents\. /);
  assert.equal(readme.split('\n')[4], '**Supported OS:** Windows 10 and 11. macOS and Linux computers are not supported. (Linux is still used for CI, cloud agent sessions and the remote servers some skills manage.)');
  assert.match(readme, /Open the folder in Codex or Claude Code and say `setup toolkit`/);
  assert.match(readme, /say `refresh toolkit`/);
  assert.match(readme, /`claude plugin uninstall ai-agent-toolkit@ai-agent-toolkit-local`/);
  assert.match(readme, /`codex plugin remove ai-agent-toolkit@ai-agent-toolkit-local`/);
  assert.match(readme, /toolkit-global-rules\.cjs" --remove/);
  assert.match(readme, /\[Skill Safety Matrix\]\(repo\/docs\/SKILL-SAFETY-MATRIX\.md\)/);
  assert.match(readme, /\[How To Use\]\(repo\/docs\/HOW-TO-USE\.md#install-toolkit-skills\)/);
  assert.match(readme, /Maintainers start with \[AGENTS\.md\]\(AGENTS\.md\)/);
  assert.doesNotMatch(readme, /POSIX|\$HOME|macOS Codex|Linux Codex/);
  const beforeAppendix = readme.slice(0, readme.indexOf('## Appendix'));
  assert.ok(beforeAppendix.split('\n').length <= 80, 'README front page stays short');

  assert.match(agents, /This repository is the canonical AI Agent Toolkit, and this file applies to it only: never copy it into another repository\./);
  assert.match(agents, /Keep this file short: it loads in every session here/);
  assert.match(agents, /add nothing merely for completeness/);
  assert.match(agents, /Portable installs use \[`skills\/repository-agent-rules\/repo-local\/AGENTS\.managed\.template\.md`\]/);
  assert.match(agents, /Setup or refresh: follow \[For AI Agents\]\(repo\/docs\/FOR_AI_AGENTS\.md\); run the managed checkout's setup script when it exists/);
});

test('agent onboarding path keeps source-of-truth and validation anchors visible', () => {
  const agents = readText('AGENTS.md');
  const sourceOfTruth = readText('repo/docs/SOURCE-OF-TRUTH.md');
  const validation = readText('repo/docs/VALIDATION-STRATEGY.md');

  const contract = readText('repo/contracts/source-of-truth-contract.md');
  assert.match(agents, /read the \[Source-of-Truth Contract\]\(repo\/contracts\/source-of-truth-contract\.md\)/);
  assert.match(contract, /`repo\/contracts\/\*\*` holds the machine contracts \(schemas, policies, fixtures, templates, agent-rule sources\)/);
  assert.match(contract, /`repo\/source-watch\/provenance\/\*\*\/SOURCE-LOCK\.json` holds only active third-party pins/);
  assert.match(contract, /One direct canonical tree: new skills go under `skills\/\*\*` after Skill Creation Center review, everything else under `repo\/\*\*`\./);
  assert.match(contract, /`skills\/\*\*` is the canonical copyable product surface/);

  assert.match(sourceOfTruth, /Direct canonical content lives in `skills\/\*\*` and `repo\/\*\*`; there is no second project or publisher tree\./);
  assert.match(sourceOfTruth, /Active third-party provenance under `repo\/source-watch\/provenance\/\*\*`\./);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Persistent status, report, implementation plan, handoff, operations, setup, CI\/CD, deployment, safety, and troubleshooting notes belong under an existing `docs\/` path/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /read the relevant docs and treat them as active context/i);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /run the host-aware orchestrator from the managed checkout when that checkout exists/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Set the shell tool's working folder to the managed checkout \(`<home folder>\/\.ai-agent-toolkit\/source\/ai-agent-toolkit` as a full path\) and run `node repo\/scripts\/setup-toolkit\.cjs --execute --profile auto-main`/);
  assert.doesNotMatch(readText('repo/docs/FOR_AI_AGENTS.md'), /POSIX|\$HOME\/\.ai-agent-toolkit/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Run the same command with the working folder set to the active repo only as bootstrap\/fallback/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Verification after managed setup must use the managed checkout verifier/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Even when Toolkit is already installed, complete the full setup journey so stale pieces are detected and patched in order/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /routine setup uses `repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs`/);
  assert.match(validation, /For this repo, the canonical full validation command is:/);
  assert.match(validation, /npm run validate:all/);
});

test('agent onboarding path does not advertise repo-wide MCP as a current surface', () => {
  const readme = readText('README.md');
  const howToUse = readText('repo/docs/HOW-TO-USE.md');
  const surfaceAudit = readText('repo/docs/SURFACE-FIDELITY-AUDIT.md');

  assert.match(readme, /There is no repo-wide MCP server; n8n work uses the \[official n8n Skills\]/);
  assert.match(howToUse, /Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now\./);
  assert.match(surfaceAudit, /No repo-wide `mcp\/\*\*` surface is shipped or maintained\./);
  assert.match(surfaceAudit, /No secondary routing metadata, duplicate package-build path, or privileged publication workflow is part of the maintained topology\./);
  assert.match(surfaceAudit, /that no required local surface points back to the deleted project\/publisher tree\./);
});
