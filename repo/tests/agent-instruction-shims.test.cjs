'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const toolkitBegin = '<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->';
const toolkitEnd = '<!-- AI-AGENT-TOOLKIT:END toolkit -->';
const n8nBegin = '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->';
const n8nEnd = '<!-- AI-AGENT-TOOLKIT:END n8n-adapter -->';

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

function sharedToolkitTexts() {
  return [
    ['managed toolkit partial', readText('_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-managed-block.md')],
    ['root AGENTS.md', block(readText('AGENTS.md'), toolkitBegin, toolkitEnd, 'root AGENTS.md toolkit block')],
    ['source AGENTS.template payload', generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md'))],
    ['published AGENTS.template payload', generatedPayload(readText('skills/ai-coding-agent-rules/AGENTS.template.md'))]
  ];
}

function sharedN8nTexts() {
  return [
    ['managed n8n partial', readText('_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-n8n-adapter-block.md')],
    ['root AGENTS.md', block(readText('AGENTS.md'), n8nBegin, n8nEnd, 'root AGENTS.md n8n block')],
    ['source AGENTS.template payload', generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md'))],
    ['published AGENTS.template payload', generatedPayload(readText('skills/ai-coding-agent-rules/AGENTS.template.md'))]
  ];
}

function skillEntrypointTexts() {
  return [
    ['curated SKILL.md', readText('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/SKILL.md')],
    ['published SKILL.md', readText('skills/ai-coding-agent-rules/SKILL.md')]
  ];
}

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

test('Claude and Gemini templates and root shims import AGENTS.md once', () => {
  const claudeSource = generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md'));
  const claudePublished = generatedPayload(readText('skills/ai-coding-agent-rules/CLAUDE.template.md'));
  const claudeRoot = readText('CLAUDE.md');
  for (const [label, text] of [
    ['source CLAUDE.template payload', claudeSource],
    ['published CLAUDE.template payload', claudePublished],
    ['root CLAUDE.md', claudeRoot]
  ]) {
    assert.match(text, /^# Claude Code Instructions$/m, label);
    assertImportCount(text, '@AGENTS.md', label);
    block(text, toolkitBegin, toolkitEnd, `${label} toolkit block`);
    assert.doesNotMatch(text, /^## Source-of-Truth Contract$/m, label);
  }

  const geminiSource = generatedPayload(readText('_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'));
  const geminiPublished = generatedPayload(readText('skills/ai-coding-agent-rules/GEMINI.template.md'));
  const geminiRoot = readText('GEMINI.md');
  for (const [label, text] of [
    ['source GEMINI.template payload', geminiSource],
    ['published GEMINI.template payload', geminiPublished],
    ['root GEMINI.md', geminiRoot]
  ]) {
    assert.match(text, /^# Gemini Instructions$/m, label);
    assertImportCount(text, '@./AGENTS.md', label);
    block(text, toolkitBegin, toolkitEnd, `${label} toolkit block`);
    assert.doesNotMatch(text, /^## Source-of-Truth Contract$/m, label);
  }
});

test('Antigravity bootstrap is tiny, managed, and does not re-import AGENTS.md by default', () => {
  const relPath = '.agents/rules/00-agent-toolkit-bootstrap.md';
  assert.equal(exists(relPath), true, relPath);
  const text = readText(relPath);
  assert.match(text, /^# Agent Toolkit Antigravity Bootstrap$/m);
  block(text, toolkitBegin, toolkitEnd, relPath);
  assert.doesNotMatch(text, /@\.\.\/\.\.\/AGENTS\.md/);
  assert.match(text, /Existing Antigravity workspace rules in `\.agents\/rules\/` remain valid and must be preserved\./);
  assert.match(text, /do not duplicate, mirror, or re-import its full content/i);
});

test('managed toolkit rules support GitHub and non-GitHub approval lanes', () => {
  for (const [label, text] of sharedToolkitTexts()) {
    for (const phrase of [
      'AGENTS.md is the canonical shared repo instruction file.',
      'These instruction files are repo/folder-local.',
      'GitHub repos, GitLab repos, Bitbucket repos, local Git repos with no remote, and plain project folders with no Git remote.',
      'Patch source first, then sync generated surfaces.',
      'Do not edit generated-only outputs directly unless declared linked or source-owned.',
      'Never commit secrets, credentials, `.env`, `.n8n-local`, `.tmp`, private keys, runtime payloads, or live exports.',
      'Line-by-line PR review is required for PR audits.',
      'Do not rely only on PR summaries.',
      'Keep GitHub-specific approval wording only when the current project is actually linked to GitHub',
      'If no GitHub context exists, do not invent one.',
      'Generic repo/folder-change requests allow scoped local edits and validation only',
      'GITHUB APPROVAL NEEDED',
      'Should I push this branch and create a pull request now?',
      'Should I push these changes to the existing pull request now?',
      'Should I push this branch and create/update the pull request now?',
      'VERSION CONTROL APPROVAL NEEDED',
      'Should I commit these local changes now?',
      'REMOTE APPROVAL NEEDED',
      'Should I push this branch to the configured remote now?',
      'LOCAL CHANGE APPROVAL NEEDED',
      'Should I apply these file changes locally now?',
      '`GITHUB APPROVAL NEEDED` is only for GitHub push or PR actions.',
      '`REMOTE APPROVAL NEEDED` is for pushing to a non-GitHub or unknown remote.',
      'When the user provides a PR URL, treat the PR URL as remote source-of-truth.',
      'Do not report `PR: none` as a final completion state.',
      'Do not report `PR: none` unless GitHub has been checked or the user explicitly says no PR exists.',
      'Local `git status` alone is not enough to determine whether a PR exists.'
    ]) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
    }
    assert.doesNotMatch(text, /PR: none yet/, label);
    assert.doesNotMatch(text, /If no PR exists yet, state `PR: none yet`/, label);
  }
});

test('ai-coding-agent-rules skill is a concise automatic bootstrap checker', () => {
  for (const [label, text] of skillEntrypointTexts()) {
    for (const phrase of [
      'Use this skill automatically before repository editing work when any of these are true:',
      'The repo has no `AGENTS.md`.',
      'The repo has no `CLAUDE.md`.',
      'The repo has no `GEMINI.md`.',
      'The repo has no `.agents/rules/00-agent-toolkit-bootstrap.md`.',
      'Existing instruction files lack `AI-AGENT-TOOLKIT` managed marker blocks.',
      'Existing managed marker blocks are stale or out of order.',
      'The session appears to be the first agent session after toolkit skills were installed.',
      'Inspect `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.',
      'Check for current toolkit managed marker blocks and the expected order.',
      'If all required files and markers are current, do not rewrite anything; continue the original user task.',
      'If files are missing or stale, create/update only toolkit-managed blocks and shims from the referenced templates.',
      'Preserve unmarked user-authored content.',
      'Do not delete duplicate/conflicting unmarked content automatically; report it.',
      'SESSION RESET NEEDED',
      'This automatic bootstrap is for local repo/folder instruction files only.',
      'GitHub, GitLab, Bitbucket, local Git repos, and plain folders.',
      'It must not push, create or update a PR',
      'Do not install heavy global `AGENTS.md` or global `GEMINI.md` rules.',
      'After setup, the repo-local files are the source of truth.',
      'Use referenced files for full content: `AGENTS.template.md`, `CLAUDE.template.md`, `GEMINI.template.md`, and `ANTIGRAVITY.bootstrap.template.md`.'
    ]) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
    }
    assert.doesNotMatch(text, /<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->/, `${label} does not inline managed toolkit block`);
    assert.ok(text.split(/\s+/).length < 450, `${label} stays concise`);
  }
});

test('managed n8n adapter rules require loading n8n agent rules before n8n work', () => {
  for (const [label, text] of sharedN8nTexts()) {
    for (const phrase of [
      'N8N RULES CHECK REQUIRED',
      'N8N RULES APPROVAL NEEDED',
      'Should I load/apply the n8n Agent Rules before continuing this task?',
      'workflows',
      'MCP',
      'credentials',
      'import/export',
      'live n8n',
      'helper scripts',
      'workflow templates',
      'workflow JSON',
      'runtime actions'
    ]) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
    }
  }
});

test('managed toolkit rules include session reset and preservation requirements', () => {
  for (const [label, text] of sharedToolkitTexts()) {
    for (const phrase of [
      'SESSION RESET NEEDED',
      'I loaded/updated agent instructions for this repo',
      'start a new agent session before continuing the implementation task',
      'loads a new skill',
      'appends toolkit/n8n instructions into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules`',
      'The active agent context changed because a skill was loaded and/or managed agent instructions were appended/updated.',
      'Continuing the original implementation task in the same session may ignore the newly installed instructions.',
      'Preserve existing user-authored `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules` content.',
      'Only edit marker-owned blocks automatically.',
      'Ask before deleting duplicate/conflicting unmarked content.',
      'For safety conflicts, default to the stricter rule.'
    ]) {
      assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: ${phrase}`);
    }
  }
});
