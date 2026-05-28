'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const executionPromptPath = '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md';
const n8nAdapterPath = '_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md';
const toolkitBegin = `<!-- AI-AGENT-TOOLKIT:${executionPromptPath}:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->`;
const toolkitEnd = `<!-- AI-AGENT-TOOLKIT:${executionPromptPath}:END GLOBAL-AGENTS.MD-TEMPLATE -->`;
const n8nBegin = `<!-- AI-AGENT-TOOLKIT:${n8nAdapterPath}:BEGIN N8N-AGENT-RULES-ADAPTER v1 -->`;
const n8nEnd = `<!-- AI-AGENT-TOOLKIT:${n8nAdapterPath}:END N8N-AGENT-RULES-ADAPTER -->`;
const expectedN8nBlock = `${n8nBegin}
If the task involves n8n workflows, workflow templates, helper scripts, MCP, import/export, live n8n, credentials, or workflow JSON, stop and load \`skills/n8n-agent-rules\` before planning or editing.
If that skill or its full rules are unavailable, stop and report the limitation instead of continuing.
Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, or production actions without explicit current-turn approval naming the target and allowed operation.
${n8nEnd}`;

const curatedRepoLocalSafetyComment = [
  '<!--',
  'Curated AI-facing source.',
  'Project: development.ai-coding-agent-rules',
  'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
  '-->',
].join('\n');
const forbiddenDefaultPromptPhrases = [
  'GitHub PR Completion Rules',
  'GITHUB APPROVAL NEEDED',
  'VERSION CONTROL APPROVAL NEEDED',
  'REMOTE APPROVAL NEEDED',
  'LOCAL CHANGE APPROVAL NEEDED',
  'PR: none yet',
  'PR lane',
  'remote source-of-truth',
  'GitHub PR URL',
  'Should I push this branch',
  'create a pull request',
  'update a pull request'
];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function markerCount(text, marker) {
  return text.split(marker).length - 1;
}

function block(text, begin, end, label) {
  assert.equal(markerCount(text, begin), 1, `${label} begin marker count`);
  assert.equal(markerCount(text, end), 1, `${label} end marker count`);
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  assert.ok(start < finish, `${label} marker order`);
  return text.slice(start, finish + end.length);
}

function generatedPayload(text) {
  const match = text.match(/\n````````md\n([\s\S]*?)\n````````\n?$/);
  assert.ok(match, 'template has one trailing 8-backtick Markdown payload fence');
  return match[1];
}

function repoLocalPayload(text, label) {
  const exactPrefix = `${curatedRepoLocalSafetyComment}\n\n`;
  assert.ok(
    text.startsWith(exactPrefix),
    `${label} starts with the exact curated-source safety comment`,
  );
  return text.slice(exactPrefix.length);
}

function assertBareRepoLocalTemplate(text, label) {
  const payload = repoLocalPayload(text, label);

  assert.equal(generatedNoticeCount(text), 0, `${label} has no generated toolkit notice`);
  assert.doesNotMatch(text, /Generated from toolkit/, `${label} has no generated notice text`);
  assert.doesNotMatch(text, /This file is inert/i, `${label} has no inert-template prose`);
  assert.doesNotMatch(text, /copy or merge the fenced payload/i, `${label} has no fenced-payload install prose`);
  assert.doesNotMatch(text, /^````````(?:md)?\s*$/m, `${label} has no 8-backtick install payload fence`);
  assert.doesNotMatch(text, /Or create it with PowerShell/i, `${label} has no README-style PowerShell install example`);
  assert.doesNotMatch(text, /mkdir -p "<repo>/i, `${label} has no README-style shell install example`);
  assert.doesNotMatch(text, /cat > "<repo>/i, `${label} has no README-style shell payload example`);
  assert.doesNotMatch(text, /Set-Content -LiteralPath/i, `${label} has no README-style PowerShell payload example`);
  assert.doesNotMatch(payload, /Curated AI-facing source/, `${label} contains the curated-source comment only once at the top`);
}
function generatedNoticeCount(text) {
  return (text.match(/Generated from toolkit (?:project source|curated output for AI)\. Do not edit directly\./g) || []).length;
}

function assertNoForbiddenDefaultPromptPhrases(text, label) {
  for (const phrase of forbiddenDefaultPromptPhrases) {
    assert.doesNotMatch(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${label}: ${phrase}`);
  }
}

function assertImportCount(text, importLine, label) {
  assert.equal(text.split('\n').filter((line) => line.trim() === importLine).length, 1, label);
}

test('source structure keeps reusable prompt and adapter partials with no tiny shim partials', () => {
  const kept = [
    executionPromptPath,
    n8nAdapterPath,
    '_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md'
  ];
  for (const relPath of kept) assert.equal(exists(relPath), true, relPath);

  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-managed-block.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-n8n-adapter-block.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/claude-shim.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/gemini-shim.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/antigravity-bootstrap.md',
    '_projects/development/ai-coding-agent-rules/_main/repo-local'
  ]) {
    assert.equal(exists(relPath), false, relPath);
  }
});

test('manual global source templates exist and are generated from execution prompt partial', () => {
  const prompt = readText(executionPromptPath).trimEnd();
  assert.match(prompt, /## Git Completion/);
  assert.match(prompt, /check PR CI\/status before reporting completion/i);
  assert.match(prompt, /Never:\n\n- Push to `main`/);
  assert.match(prompt, /- Claim CI passed unless checked/);
  assert.doesNotMatch(prompt, /## Pull Request Description/);
  assert.match(prompt, /keep the PR body aligned with the full base-to-head diff/i);
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'
  ]) {
    const text = readText(relPath);
    assert.equal(generatedNoticeCount(text), 1, relPath);
    assert.equal(generatedPayload(text).trimEnd(), prompt, relPath);
    assert.match(text, /global rules example/i, relPath);
    assertNoForbiddenDefaultPromptPhrases(text, relPath);
  }
});

test('repo-local source and published skill templates are local bootstrap templates', () => {
  const sourceToPublished = [
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
      'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    ],
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
      'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    ],
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
      'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
    ],
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
      'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
    ],
  ];

  for (const [sourcePath, publishedPath] of sourceToPublished) {
    const sourceText = readText(sourcePath);
    const publishedText = readText(publishedPath);

    assert.equal(publishedText, sourceText, `${publishedPath} matches curated source`);
    assertBareRepoLocalTemplate(sourceText, sourcePath);
    assertBareRepoLocalTemplate(publishedText, publishedPath);
    assertNoForbiddenDefaultPromptPhrases(repoLocalPayload(publishedText, publishedPath), publishedPath);
  }
});
test('managed toolkit block comes from the execution prompt partial', () => {
  const prompt = readText(executionPromptPath).trimEnd();
  const rootToolkit = block(readText('AGENTS.md'), toolkitBegin, toolkitEnd, 'root toolkit block')
    .replace(toolkitBegin, '')
    .replace(toolkitEnd, '')
    .trim();
  const managedPayload = repoLocalPayload(readText('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'), 'repo-local AGENTS managed template');
  const sourceToolkit = block(managedPayload, toolkitBegin, toolkitEnd, 'repo-local managed toolkit block')
    .replace(toolkitBegin, '')
    .replace(toolkitEnd, '')
    .trim();

  assert.equal(rootToolkit, prompt);
  assert.equal(sourceToolkit, prompt);
  assertNoForbiddenDefaultPromptPhrases(rootToolkit, 'root toolkit block');
});

test('n8n adapter is compact and fail-closed', () => {
  for (const [label, text] of [
    ['root AGENTS.md', readText('AGENTS.md')],
    ['repo-local AGENTS managed template', repoLocalPayload(readText('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'), 'repo-local AGENTS managed template')],
    ['published repo-local AGENTS managed template', repoLocalPayload(readText('skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'), 'published repo-local AGENTS managed template')]
  ]) {
    const n8nBlock = block(text, n8nBegin, n8nEnd, label);
    assert.equal(n8nBlock.trim(), expectedN8nBlock, label);
    const inner = n8nBlock.slice(n8nBlock.indexOf(n8nBegin) + n8nBegin.length, n8nBlock.indexOf(n8nEnd)).trim();
    assert.equal(inner, readText(n8nAdapterPath).trimEnd(), `${label} adapter comes from source partial`);
    assert.ok(Buffer.byteLength(inner, 'utf8') < 700, `${label} adapter text stays compact`);
    assert.ok(Buffer.byteLength(n8nBlock, 'utf8') < 900, `${label} block stays compact`);
    assert.match(inner, /stop and load `skills\/n8n-agent-rules` before planning or editing/i, label);
    assert.match(inner, /skill or its full rules are unavailable, stop and report the limitation instead of continuing/i, label);
    assert.match(inner, /explicit current-turn approval naming the target and allowed operation/i, label);
    for (const requiredTerm of [
      /live n8n/i,
      /Docker/i,
      /import\/export/i,
      /sync/i,
      /activation/i,
      /execution/i,
      /publish\/unpublish/i,
      /credential/i,
      /deployment/i,
      /production/i
    ]) {
      assert.match(inner, requiredTerm, `${label}: ${requiredTerm}`);
    }
    assert.doesNotMatch(inner, /n8n_docs|n8n_live|webhook IDs|archive\/delete|Adapter Auto-Check Protocol|Keep workflows inactive/i, label);
  }
});

test('root Claude, Gemini, and Antigravity shims stay tiny', () => {
  const claude = readText('CLAUDE.md');
  assert.match(claude, /^# Claude Code Instructions\n\n@AGENTS\.md\n\nRoot `AGENTS\.md` is canonical\.\n$/);
  assertImportCount(claude, '@AGENTS.md', 'root CLAUDE.md import count');
  assert.ok(Buffer.byteLength(claude, 'utf8') < 1024, 'root CLAUDE.md under 1KB');

  const gemini = readText('GEMINI.md');
  assert.match(gemini, /^# Gemini Instructions\n\n@\.\/AGENTS\.md\n\nRoot `AGENTS\.md` is canonical\.\n$/);
  assertImportCount(gemini, '@./AGENTS.md', 'root GEMINI.md import count');
  assert.ok(Buffer.byteLength(gemini, 'utf8') < 1024, 'root GEMINI.md under 1KB');

  const antigravity = readText('.agents/rules/00-agent-toolkit-bootstrap.md');
  assert.match(antigravity, /^# Agent Toolkit Antigravity Bootstrap$/m);
  assert.match(antigravity, /Root `AGENTS\.md` is the canonical repo instruction file\./);
  assert.doesNotMatch(antigravity, /@\.\.\/\.\.\/AGENTS\.md/);
  assert.ok(Buffer.byteLength(antigravity, 'utf8') < 1024, 'Antigravity bootstrap under 1KB');
});

test('active and generated default instruction surfaces exclude PR/VCS workflow prompt rules', () => {
  for (const relPath of [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.agents/rules/00-agent-toolkit-bootstrap.md',
    executionPromptPath,
    n8nAdapterPath,
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
    'skills/ai-coding-agent-rules/SKILL.md'
  ]) {
    assert.equal(exists(relPath), true, relPath);
    assertNoForbiddenDefaultPromptPhrases(readText(relPath), relPath);
  }
});

test('current managed outputs use source-aware markers only', () => {
  const staleMarkers = [
    '<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->',
    '<!-- AI-AGENT-TOOLKIT:END toolkit -->',
    '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->',
    '<!-- AI-AGENT-TOOLKIT:END n8n-adapter v1 -->',
    '<!-- AI-AGENT-TOOLKIT:END n8n-adapter -->',
    '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:BEGIN ai-coding-agent-execution v1 -->',
    '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:END ai-coding-agent-execution -->',
    '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:BEGIN n8n-adapter v1 -->',
    '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:END n8n-adapter -->',
    '<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->',
    '<!-- END SOURCE-OF-TRUTH-CONTRACT -->'
  ];
  for (const relPath of [
    'AGENTS.md',
    'README.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
  ]) {
    const text = readText(relPath);
    for (const marker of staleMarkers) assert.equal(text.includes(marker), false, `${relPath}: ${marker}`);
  }
});

test('published skill docs focus on repo-local automatic setup', () => {
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/README.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/SKILL.md',
    'skills/ai-coding-agent-rules/README.md',
    'skills/ai-coding-agent-rules/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /repo\/folder-local|repo-local/i, relPath);
    assert.match(text, /_projects\/development\/ai-coding-agent-rules\/_main\//, relPath);
    assert.doesNotMatch(text, /C:\\Users\\<your-user>\\\.(?:claude|gemini)|\$HOME\\\.(?:claude|gemini)|Claude Code global rules example|Gemini CLI and Antigravity global rules example/, relPath);
  }
});

test('root README platform guidance requires AGENTS before platform shims', () => {
  const text = readText('README.md');
  const section = text.slice(text.indexOf('## Install Skills By Platform'), text.indexOf('\n## MCP'));
  assert.match(section, /`AGENTS\.md` is the shared managed instruction file inside the target repo/);
  assert.match(section, /For portable installs, create or merge it from \[repo-local\/AGENTS\.managed\.template\.md\]/);
  assert.match(section, /not from this toolkit repo's root \[AGENTS\.md\]/);
  assert.match(section, /\| Codex \|[^\n]*<strong>Choose one:<\/strong>[^\n]*repo-local\/AGENTS\.managed\.template\.md/);
  assert.match(section, /\| OpenCode \|[^\n]*<strong>Choose one:<\/strong>[^\n]*repo-local\/AGENTS\.managed\.template\.md/);
  assert.match(section, /\| Claude Code \|[^\n]*<strong>Choose one:<\/strong>[^\n]*1\) Create or merge `AGENTS\.md` first[^\n]*repo-local\/AGENTS\.managed\.template\.md[^\n]*2\) Add `CLAUDE\.md`[^\n]*repo-local\/CLAUDE\.shim\.template\.md/);
  assert.match(section, /\| Gemini CLI \|[^\n]*\$HOME\/\.gemini\/extensions\/ai-agent-toolkit\/gemini-extension\.json[^\n]*\$HOME\/\.gemini\/extensions\/ai-agent-toolkit\/skills\/<skill-name>\/SKILL\.md[^\n]*1\) Create or merge `AGENTS\.md` first[^\n]*repo-local\/AGENTS\.managed\.template\.md[^\n]*2\) Add `GEMINI\.md`[^\n]*repo-local\/GEMINI\.shim\.template\.md[^\n]*\| N\/A \|/);
  assert.match(section, /\| Antigravity \|[^\n]*1\) Create or merge `AGENTS\.md` first[^\n]*repo-local\/AGENTS\.managed\.template\.md[^\n]*2\) Add `GEMINI\.md`[^\n]*repo-local\/GEMINI\.shim\.template\.md[^\n]*3\) Add `\.agents\/rules\/00-agent-toolkit-bootstrap\.md`[^\n]*repo-local\/antigravity-bootstrap\.template\.md/);
  assert.doesNotMatch(section, /if using the Gemini shim/);
  assert.doesNotMatch(section, /if using the Antigravity bootstrap/);
  assert.doesNotMatch(section, /and\/or/);
  assert.doesNotMatch(section, /skills\/ai-coding-agent-rules\/(?:AGENTS|CLAUDE|GEMINI)\.template\.md/);
  assert.doesNotMatch(section, /start from \[`(?:CLAUDE|GEMINI)\.template\.md`\]/);
});

test('skill README documents required file sets and shim dependency', () => {
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/README.md',
    'skills/ai-coding-agent-rules/README.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /Do not install a shim alone/i, relPath);
    assert.match(text, /Shims require root `AGENTS\.md`/i, relPath);
    assert.match(text, /`AGENTS\.managed\.template\.md` is canonical for the managed toolkit block/i, relPath);
    assert.match(text, /\| Claude Code \|[^\n]*1\) `AGENTS\.md`[^\n]*2\) `CLAUDE\.md`[^\n]*1\) \[repo-local\/AGENTS\.managed\.template\.md\][^\n]*2\) \[repo-local\/CLAUDE\.shim\.template\.md\]/i, relPath);
    assert.match(text, /\| Gemini CLI \|[^\n]*1\) `AGENTS\.md`[^\n]*2\) `GEMINI\.md`[^\n]*1\) \[repo-local\/AGENTS\.managed\.template\.md\][^\n]*2\) \[repo-local\/GEMINI\.shim\.template\.md\]/i, relPath);
    assert.match(text, /\| Antigravity \|[^\n]*1\) `AGENTS\.md`[^\n]*2\) `GEMINI\.md`[^\n]*3\) `\.agents\/rules\/00-agent-toolkit-bootstrap\.md`[^\n]*1\) \[repo-local\/AGENTS\.managed\.template\.md\][^\n]*2\) \[repo-local\/GEMINI\.shim\.template\.md\][^\n]*3\) \[repo-local\/antigravity-bootstrap\.template\.md\]/i, relPath);
    assert.doesNotMatch(text, /if using the Gemini shim/i, relPath);
    assert.doesNotMatch(text, /if using the Antigravity bootstrap/i, relPath);
    assert.doesNotMatch(text, /and\/or/i, relPath);
  }
});

test('skill instructions add only target platform shims by default', () => {
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/SKILL.md',
    'skills/ai-coding-agent-rules/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /Check or install `AGENTS\.md` as the canonical managed file/i, relPath);
    assert.match(text, /Add only the shim for the current\/target platform unless the user explicitly requests all platform shims/i, relPath);
    assert.match(text, /Preserve existing active instruction files/i, relPath);
    assert.match(text, /start a new agent session before continuing/i, relPath);
    assert.doesNotMatch(text, /The repo has no `CLAUDE\.md`/i, relPath);
    assert.doesNotMatch(text, /The repo has no `GEMINI\.md`/i, relPath);
    assert.doesNotMatch(text, /The repo has no `\.agents\/rules\/00-agent-toolkit-bootstrap\.md`/i, relPath);
  }
});
