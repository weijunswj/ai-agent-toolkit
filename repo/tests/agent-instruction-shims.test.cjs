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
  'Should I push this branch and create a pull request now?',
  'Should I push these changes to the existing pull request now?',
  'Should I push this branch and create/update the pull request now?',
  'Should I commit these local changes now?',
  'Should I push this branch to the configured remote now?',
  'Should I apply these file changes locally now?'
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
  const match = text.match(/\n````````md\n([\s\S]*?)\n````````\n$/);
  assert.ok(match, 'generated template has one trailing 8-backtick Markdown payload fence');
  return match[1];
}

function assertOrdered(text, earlier, later, label) {
  const earlierIndex = text.indexOf(earlier);
  const laterIndex = text.indexOf(later);
  assert.notEqual(earlierIndex, -1, `${label} contains ${earlier}`);
  assert.notEqual(laterIndex, -1, `${label} contains ${later}`);
  assert.ok(earlierIndex < laterIndex, `${label} order`);
}

function assertImportCount(text, importLine, label) {
  assert.equal(text.split('\n').filter((line) => line.trim() === importLine).length, 1, label);
}

function assertNoForbiddenDefaultPromptPhrases(text, label) {
  for (const phrase of forbiddenDefaultPromptPhrases) {
    assert.doesNotMatch(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
  }
}

function sharedToolkitTexts() {
  return [
    ['managed toolkit partial', readText('_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-managed-block.md')],
    ['root AGENTS.md toolkit block', block(readText('AGENTS.md'), toolkitBegin, toolkitEnd, 'root AGENTS.md toolkit block')],
    ['source AGENTS.template payload', generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md'))],
    ['published AGENTS.template payload', generatedPayload(readText('skills/ai-coding-agent-rules/AGENTS.template.md'))]
  ];
}

function sharedN8nTexts() {
  return [
    ['managed n8n partial', readText('_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-n8n-adapter-block.md')],
    ['root AGENTS.md n8n block', block(readText('AGENTS.md'), n8nBegin, n8nEnd, 'root AGENTS.md n8n block')],
    ['source AGENTS.template payload', block(generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md')), n8nBegin, n8nEnd, 'source AGENTS.template n8n block')],
    ['published AGENTS.template payload', block(generatedPayload(readText('skills/ai-coding-agent-rules/AGENTS.template.md')), n8nBegin, n8nEnd, 'published AGENTS.template n8n block')]
  ];
}

function skillEntrypointTexts() {
  return [
    ['curated SKILL.md', readText('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/SKILL.md')],
    ['published SKILL.md', readText('skills/ai-coding-agent-rules/SKILL.md')]
  ];
}

test('root AGENTS.md keeps managed blocks before the repo contract sections', () => {
  const text = readText('AGENTS.md');
  assert.match(text, /^# AI Agent Toolkit Repo Rules\n/);
  assertOrdered(text, '# AI Agent Toolkit Repo Rules', toolkitBegin, 'root AGENTS.md');
  assertOrdered(text, toolkitBegin, n8nBegin, 'root AGENTS.md');

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

test('root and AGENTS templates place toolkit managed block before n8n adapter block', () => {
  for (const [label, text] of [
    ['source AGENTS.template payload', generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md'))],
    ['published AGENTS.template payload', generatedPayload(readText('skills/ai-coding-agent-rules/AGENTS.template.md'))],
    ['root AGENTS.md', readText('AGENTS.md')]
  ]) {
    block(text, toolkitBegin, toolkitEnd, `${label} toolkit block`);
    block(text, n8nBegin, n8nEnd, `${label} n8n adapter block`);
    assertOrdered(text, toolkitBegin, n8nBegin, label);
  }
});

test('managed toolkit block is the reusable execution prompt without repo contract or PR workflow rules', () => {
  for (const [label, text] of sharedToolkitTexts()) {
    for (const phrase of [
      '## Role',
      'You are an execution-first coding agent.',
      '## Instruction Priority',
      '## Working Modes',
      '## Approval Rules',
      '## Scope Control',
      '## Generated Files',
      '## Skills And Local References',
      '## Validation',
      '## Communication'
    ]) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
    }
    assertNoForbiddenDefaultPromptPhrases(text, label);
    assert.doesNotMatch(text, /## Source-of-Truth Contract/, `${label} must not duplicate repo source-of-truth contract`);
    assert.doesNotMatch(text, /toolkit\.project\.json/, `${label} must not duplicate toolkit repo contract`);
    assert.doesNotMatch(text, /PR URL/, `${label} must not contain PR lane management`);
    assert.doesNotMatch(text, /create a pull request|update a pull request|merge request/i, `${label} must not contain remote review workflow rules`);
  }
});

test('managed n8n adapter is exactly one sentence pointing to n8n-agent-rules', () => {
  for (const [label, text] of sharedN8nTexts()) {
    assert.equal(text.trim(), expectedN8nBlock, label);
    const inner = text.slice(text.indexOf(n8nBegin) + n8nBegin.length, text.indexOf(n8nEnd)).trim();
    assert.match(inner, /\.$/, `${label} ends as one sentence`);
    assert.doesNotMatch(inner.slice(0, -1), /[.!?]/, `${label} has no extra sentence punctuation`);
    assert.ok(text.length < 500, `${label} under 500 characters`);
    assert.match(text, /skills\/n8n-agent-rules/, label);
    assert.doesNotMatch(text, /N8N RULES CHECK REQUIRED|N8N RULES APPROVAL NEEDED|Docker|activation|execution|publish\/unpublish|credential actions/i, label);
  }
});

test('Claude and Gemini root shims stay tiny and only import root AGENTS.md', () => {
  const claude = readText('CLAUDE.md');
  assert.match(claude, /^# Claude Code Instructions\n\n@AGENTS\.md\n/);
  assertImportCount(claude, '@AGENTS.md', 'root CLAUDE.md import count');
  assert.ok(Buffer.byteLength(claude, 'utf8') < 1024, 'root CLAUDE.md under 1KB');
  assert.doesNotMatch(claude, /AI-AGENT-TOOLKIT:BEGIN|## Source-of-Truth Contract|N8N RULES/, 'root CLAUDE.md does not duplicate rules');

  const gemini = readText('GEMINI.md');
  assert.match(gemini, /^# Gemini Instructions\n\n@\.\/AGENTS\.md\n/);
  assertImportCount(gemini, '@./AGENTS.md', 'root GEMINI.md import count');
  assert.ok(Buffer.byteLength(gemini, 'utf8') < 1024, 'root GEMINI.md under 1KB');
  assert.doesNotMatch(gemini, /AI-AGENT-TOOLKIT:BEGIN|## Source-of-Truth Contract|N8N RULES/, 'root GEMINI.md does not duplicate rules');
});

test('Antigravity bootstrap is tiny and does not import or duplicate AGENTS.md', () => {
  const relPath = '.agents/rules/00-agent-toolkit-bootstrap.md';
  assert.equal(exists(relPath), true, relPath);
  const text = readText(relPath);
  assert.match(text, /^# Agent Toolkit Antigravity Bootstrap$/m);
  assert.match(text, /Root `AGENTS\.md` is the canonical repo instruction file\./);
  assert.match(text, /\*\*If root `AGENTS\.md` is already loaded, do not duplicate or re-import it\.\*\*/);
  assert.match(text, /\*\*If root `AGENTS\.md` is not loaded, read root `AGENTS\.md` before repo edits\.\*\*/);
  assert.match(text, /Preserve existing `\.agents\/rules` files\./);
  assert.ok(Buffer.byteLength(text, 'utf8') < 1024, `${relPath} under 1KB`);
  assert.doesNotMatch(text, /@\.\.\/\.\.\/AGENTS\.md|AI-AGENT-TOOLKIT:BEGIN|## Source-of-Truth Contract|## Role/, `${relPath} stays a bootstrap`);
});

test('shim templates live in template-oriented source files and do not inline full rules', () => {
  const cases = [
    {
      label: 'Claude',
      source: '_projects/development/ai-coding-agent-rules/_main/templates/CLAUDE.shim.template.md',
      published: 'skills/ai-coding-agent-rules/CLAUDE.template.md',
      heading: '# Claude Code Instructions',
      importLine: '@AGENTS.md'
    },
    {
      label: 'Gemini',
      source: '_projects/development/ai-coding-agent-rules/_main/templates/GEMINI.shim.template.md',
      published: 'skills/ai-coding-agent-rules/GEMINI.template.md',
      heading: '# Gemini Instructions',
      importLine: '@./AGENTS.md'
    },
    {
      label: 'Antigravity',
      source: '_projects/development/ai-coding-agent-rules/_main/templates/antigravity-bootstrap.template.md',
      published: 'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md',
      heading: '# Agent Toolkit Antigravity Bootstrap',
      importLine: null
    }
  ];

  for (const item of cases) {
    assert.equal(exists(item.source), true, item.source);
    assert.equal(exists(item.published), true, item.published);
    for (const [label, text] of [
      [`source ${item.label} template payload`, generatedPayload(readText(item.source))],
      [`published ${item.label} template payload`, generatedPayload(readText(item.published))]
    ]) {
      assert.match(text, new RegExp(`^${item.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), label);
      if (item.importLine) assertImportCount(text, item.importLine, label);
      assert.ok(Buffer.byteLength(text, 'utf8') < 1024, `${label} payload under 1KB`);
      assert.doesNotMatch(text, /AI-AGENT-TOOLKIT:BEGIN|## Source-of-Truth Contract|## Role|N8N RULES/, `${label} does not duplicate full rules`);
    }
  }
});

test('ai-coding-agent-rules skill is a concise automatic bootstrap checker', () => {
  for (const [label, text] of skillEntrypointTexts()) {
    for (const phrase of [
      'Tiny automatic repo-instruction bootstrap/checker for local project instruction files.',
      'Use this skill automatically before repository editing work when any of these are true:',
      'Inspect `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.',
      'If all required files and markers are current, do not rewrite anything; continue the original user task.',
      'If files are missing or stale, create/update only toolkit-managed blocks and shims from the referenced templates.',
      'Preserve unmarked user-authored content.',
      'SESSION RESET NEEDED',
      'This automatic bootstrap is for local repo/folder instruction files only.',
      'It must not push, create or update a PR',
      'Use referenced files for full content: `AGENTS.template.md`, `CLAUDE.template.md`, `GEMINI.template.md`, and `antigravity-bootstrap.template.md`.'
    ]) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
    }
    assertNoForbiddenDefaultPromptPhrases(text, label);
    assert.doesNotMatch(text, /<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->/, `${label} does not inline managed toolkit block`);
    assert.ok(text.split(/\s+/).length < 450, `${label} stays concise`);
  }
});

test('active and generated instructions exclude default GitHub PR and VCS approval prompt rules', () => {
  for (const relPath of [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.agents/rules/00-agent-toolkit-bootstrap.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-managed-block.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/templates/CLAUDE.shim.template.md',
    '_projects/development/ai-coding-agent-rules/_main/templates/GEMINI.shim.template.md',
    '_projects/development/ai-coding-agent-rules/_main/templates/antigravity-bootstrap.template.md',
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
