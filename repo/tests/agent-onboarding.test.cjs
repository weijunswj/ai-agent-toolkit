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

  assert.match(readme, /A practical skills-first toolkit of reusable AI-agent skills, machine contracts, provenance records, and safe maintenance scripts\./);
  assert.match(readme, /This repo keeps reusable AI-agent material in a direct canonical layout/);
  assert.match(readme, /\[skills\/\]\(skills\/\) contains complete copyable AI-agent skill folders\./);
  assert.match(readme, /\[repo\/\]\(repo\/\) contains maintenance docs, scripts, tests, provenance, and validation policy\./);
  assert.match(readme, /\| Full guide or source context \| Open the relevant `skills\/<skill-name>\/` folder or `repo\/contracts\/` entry\. \|/);
  assert.match(readme, /\| Install a skill \| Copy the whole skill folder using \[Install Skills By Platform\]/);
  assert.match(readme, /\| Review skill safety \| Use the \[Skill Safety Matrix\]/);
  assert.match(readme, /\| Maintenance work \| Start with \[repo\/docs\/\]/);

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
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /%USERPROFILE%\\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\setup-toolkit\.cjs/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /\$HOME\/\.ai-agent-toolkit\/source\/ai-agent-toolkit\/repo\/scripts\/setup-toolkit\.cjs/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Use `node repo\/scripts\/setup-toolkit\.cjs --execute --profile auto-main` from the active repo only as bootstrap\/fallback/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Verification after managed setup must use the managed checkout verifier/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /Even when Toolkit is already installed, complete the full setup journey so stale pieces are detected and patched in order/);
  assert.match(readText('repo/docs/FOR_AI_AGENTS.md'), /routine setup uses `repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs`/);
  assert.match(validation, /For this repo, the canonical full validation command is:/);
  assert.match(validation, /npm run validate:all/);
});

test('agent onboarding path does not advertise repo-wide MCP as a current surface', () => {
  const readme = readText('README.md');
  const surfaceAudit = readText('repo/docs/SURFACE-FIDELITY-AUDIT.md');

  assert.match(readme, /Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now\./);
  assert.match(surfaceAudit, /No repo-wide `mcp\/\*\*` surface is shipped or maintained\./);
  assert.match(surfaceAudit, /No secondary routing metadata, duplicate package-build path, or privileged publication workflow is part of the maintained topology\./);
  assert.match(surfaceAudit, /that no required local surface points back to the deleted project\/publisher tree\./);
});
