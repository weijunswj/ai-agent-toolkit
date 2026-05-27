'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const toolkitBegin = '<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->';
const toolkitEnd = '<!-- AI-AGENT-TOOLKIT:END toolkit -->';
const n8nBegin = '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->';
const n8nEnd = '<!-- AI-AGENT-TOOLKIT:END n8n-adapter v1 -->';
const expectedN8nBlock = `${n8nBegin}
If the task involves n8n workflows, workflow templates, helper scripts, MCP, import/export, live n8n, credentials, or workflow JSON, use \`skills/n8n-agent-rules\` before continuing.
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
    '_projects/development/ai-coding-agent-rules/_main/_partials/antigravity-bootstrap.md'
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
      '_projects/development/ai-coding-agent-rules/_main/repo-local/AGENTS.managed.template.md',
      'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
    ],
    [
      '_projects/development/ai-coding-agent-rules/_main/repo-local/CLAUDE.shim.template.md',
      'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md'
    ],
    [
      '_projects/development/ai-coding-agent-rules/_main/repo-local/GEMINI.shim.template.md',
      'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md'
    ],
    [
      '_projects/development/ai-coding-agent-rules/_main/repo-local/antigravity-bootstrap.template.md',
      'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md'
    ]
  ]);
  const compatibilityAliases = [
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md'
  ];

  for (const [source, published] of sourceToPublished) {
    assert.equal(exists(source), true, source);
    assert.equal(exists(published), true, published);
    const publishedText = readText(published);
    assert.equal(generatedNoticeCount(publishedText), 1, published);
    assert.match(publishedText, /repo-local/i, published);
    assert.doesNotMatch(publishedText, /C:\\Users\\<your-user>\\\.(?:claude|gemini)|\$HOME\\\.(?:claude|gemini)|global rules example/i, published);
    assertNoForbiddenDefaultPromptPhrases(publishedText, published);
  }

  for (const relPath of compatibilityAliases) {
    assert.equal(exists(relPath), true, relPath);
    const text = readText(relPath);
    assert.equal(generatedNoticeCount(text), 1, relPath);
    assert.match(text, /repo-local/i, relPath);
    assert.doesNotMatch(text, /C:\\Users\\<your-user>\\\.(?:claude|gemini)|\$HOME\\\.(?:claude|gemini)|global rules example/i, relPath);
    assertNoForbiddenDefaultPromptPhrases(text, relPath);
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
  const managedPayload = generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/repo-local/AGENTS.managed.template.md'));
  const sourceToolkit = block(managedPayload, toolkitBegin, toolkitEnd, 'repo-local managed toolkit block')
    .replace(toolkitBegin, '')
    .replace(toolkitEnd, '')
    .trim();

  assert.equal(rootToolkit, prompt);
  assert.equal(sourceToolkit, prompt);
  assertNoForbiddenDefaultPromptPhrases(rootToolkit, 'root toolkit block');
});

test('n8n adapter is exactly one sentence pointing to n8n-agent-rules', () => {
  for (const [label, text] of [
    ['root AGENTS.md', readText('AGENTS.md')],
    ['repo-local AGENTS managed template', generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/repo-local/AGENTS.managed.template.md'))],
    ['published repo-local AGENTS managed template', generatedPayload(readText('skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'))],
    ['published compatibility AGENTS template', generatedPayload(readText('skills/ai-coding-agent-rules/AGENTS.template.md'))]
  ]) {
    const n8nBlock = block(text, n8nBegin, n8nEnd, label);
    assert.equal(n8nBlock.trim(), expectedN8nBlock, label);
    const inner = n8nBlock.slice(n8nBlock.indexOf(n8nBegin) + n8nBegin.length, n8nBlock.indexOf(n8nEnd)).trim();
    assert.match(inner, /\.$/, `${label} ends as one sentence`);
    assert.doesNotMatch(inner.slice(0, -1), /[.!?]/, `${label} has no extra sentence punctuation`);
    assert.ok(n8nBlock.length < 500, `${label} under 500 characters`);
    assert.match(n8nBlock, /skills\/n8n-agent-rules/, label);
    assert.doesNotMatch(n8nBlock, /N8N RULES CHECK REQUIRED|Docker|activation|execution|publish\/unpublish|credential actions/i, label);
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
    '_projects/development/ai-coding-agent-rules/_main/repo-local/AGENTS.managed.template.md',
    '_projects/development/ai-coding-agent-rules/_main/repo-local/CLAUDE.shim.template.md',
    '_projects/development/ai-coding-agent-rules/_main/repo-local/GEMINI.shim.template.md',
    '_projects/development/ai-coding-agent-rules/_main/repo-local/antigravity-bootstrap.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md',
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md',
    'skills/ai-coding-agent-rules/SKILL.md'
  ]) {
    assert.equal(exists(relPath), true, relPath);
    assertNoForbiddenDefaultPromptPhrases(readText(relPath), relPath);
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
