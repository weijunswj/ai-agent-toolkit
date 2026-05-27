'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const toolkitBegin = '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:BEGIN ai-coding-agent-execution v1 -->';
const toolkitEnd = '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:END ai-coding-agent-execution -->';
const n8nBegin = '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:BEGIN n8n-adapter v1 -->';
const n8nEnd = '<!-- ai-agent-toolkit:development.ai-coding-agent-rules:END n8n-adapter -->';
const expectedN8nBlock = `${n8nBegin}
If the task involves n8n workflows, workflow templates, helper scripts, MCP, import/export, live n8n, credentials, or workflow JSON, stop and load \`skills/n8n-agent-rules\` before planning or editing.
If that skill or its full rules are unavailable, stop and report the limitation instead of continuing.
Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, or production actions without explicit current-turn approval naming the target and allowed operation.
${n8nEnd}`;

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

test('source structure keeps one reusable prompt partial and no tiny shim partials', () => {
  const kept = [
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
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
  const prompt = readText('_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md').trimEnd();
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
  const sourceToPublished = new Map([
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
      'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
    ],
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
      'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md'
    ],
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
      'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md'
    ],
    [
      '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
      'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md'
    ]
  ]);
  for (const [source, published] of sourceToPublished) {
    assert.equal(exists(source), true, source);
    assert.equal(exists(published), true, published);
    const publishedText = readText(published);
    assert.equal(generatedNoticeCount(publishedText), 1, published);
    assert.match(publishedText, /repo-local/i, published);
    assert.doesNotMatch(publishedText, /C:\\Users\\<your-user>\\\.(?:claude|gemini)|\$HOME\\\.(?:claude|gemini)|global rules example/i, published);
    assertNoForbiddenDefaultPromptPhrases(publishedText, published);
  }

  for (const relPath of [
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md'
  ]) {
    assert.equal(exists(relPath), false, relPath);
  }
});

test('root AGENTS.md keeps managed blocks before repo contract sections', () => {
  const text = readText('AGENTS.md');
  const h1s = text.match(/^# /gm) || [];
  assert.equal(h1s.length, 1);
  assert.match(text, /^# AI Agent Toolkit Repo Rules\n/);
  assert.doesNotMatch(text, /^# This repo is the canonical reusable AI Agent Toolkit\.$/m);
  assert.match(text, /\nThis repo is the canonical reusable AI Agent Toolkit\.\n/);
  assert.ok(text.indexOf(toolkitBegin) < text.indexOf(n8nBegin), 'toolkit block before n8n adapter');

  const n8nEndIndex = text.indexOf(n8nEnd);
  assert.notEqual(n8nEndIndex, -1, 'root AGENTS.md has n8n end marker');
  for (const section of [
    '## Source-of-Truth Contract',
    '## Agent Routing Rules',
    '## Mandatory Repo Docs By Task',
    '## New Or Changed Project Checklist',
    '## What Belongs Here',
    '## What Does Not Belong Here',
    '## Documentation Rules',
    '## Validation',
    '## n8n Safety'
  ]) {
    const index = text.indexOf(section, n8nEndIndex);
    assert.notEqual(index, -1, `root AGENTS.md contains ${section}`);
    assert.ok(index > n8nEndIndex, `${section} stays below managed blocks`);
  }
});

test('managed toolkit block comes from the execution prompt partial', () => {
  const prompt = readText('_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md').trimEnd();
  const rootToolkit = block(readText('AGENTS.md'), toolkitBegin, toolkitEnd, 'root toolkit block')
    .replace(toolkitBegin, '')
    .replace(toolkitEnd, '')
    .trim();
  const managedPayload = generatedPayload(readText('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'));
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
    ['repo-local AGENTS managed template', generatedPayload(readText('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'))],
    ['published repo-local AGENTS managed template', generatedPayload(readText('skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'))]
  ]) {
    const n8nBlock = block(text, n8nBegin, n8nEnd, label);
    assert.equal(n8nBlock.trim(), expectedN8nBlock, label);
    const inner = n8nBlock.slice(n8nBlock.indexOf(n8nBegin) + n8nBegin.length, n8nBlock.indexOf(n8nEnd)).trim();
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
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
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
  assert.match(section, /`AGENTS\.md` is the shared managed instruction file/);
  assert.match(section, /\| Codex \|[^\n]*repo-local\/AGENTS\.managed\.template\.md/);
  assert.match(section, /\| OpenCode \|[^\n]*repo-local\/AGENTS\.managed\.template\.md/);
  assert.match(section, /\| Claude Code \|[^\n]*Create or merge `AGENTS\.md` first[^\n]*repo-local\/AGENTS\.managed\.template\.md[^\n]*then add `CLAUDE\.md`[^\n]*repo-local\/CLAUDE\.shim\.template\.md/);
  assert.match(section, /\| Gemini CLI \|[^\n]*Create or merge `AGENTS\.md` first[^\n]*repo-local\/AGENTS\.managed\.template\.md[^\n]*then add `GEMINI\.md`[^\n]*repo-local\/GEMINI\.shim\.template\.md/);
  assert.match(section, /\| Antigravity \|[^\n]*Create or merge `AGENTS\.md` first[^\n]*repo-local\/AGENTS\.managed\.template\.md[^\n]*then add `GEMINI\.md`[^\n]*repo-local\/GEMINI\.shim\.template\.md[^\n]*00-agent-toolkit-bootstrap\.md[^\n]*repo-local\/antigravity-bootstrap\.template\.md/);
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
    assert.match(text, /\| Claude Code \|[^\n]*`AGENTS\.md`[^\n]*`CLAUDE\.md`/i, relPath);
    assert.match(text, /\| Gemini CLI \|[^\n]*`AGENTS\.md`[^\n]*`GEMINI\.md`/i, relPath);
    assert.match(text, /\| Antigravity \|[^\n]*`AGENTS\.md`[^\n]*(?:`GEMINI\.md`|`\.agents\/rules\/00-agent-toolkit-bootstrap\.md`)/i, relPath);
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
