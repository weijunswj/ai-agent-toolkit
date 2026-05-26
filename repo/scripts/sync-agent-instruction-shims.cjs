#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function workspaceRootFromArgs(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--workspace') return args[i + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

const workspaceRoot = workspaceRootFromArgs();
const root = path.resolve(workspaceRoot || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const mode = process.argv.includes('--write') ? 'write' : 'check';

const toolkitBegin = '<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->';
const toolkitEnd = '<!-- AI-AGENT-TOOLKIT:END toolkit -->';
const n8nBegin = '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->';
const n8nEnd = '<!-- AI-AGENT-TOOLKIT:END n8n-adapter -->';

const partials = {
  toolkit: '_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-managed-block.md',
  n8n: '_projects/development/ai-coding-agent-rules/_main/_partials/agent-toolkit-n8n-adapter-block.md',
  claude: '_projects/development/ai-coding-agent-rules/_main/_partials/claude-shim.md',
  gemini: '_projects/development/ai-coding-agent-rules/_main/_partials/gemini-shim.md',
  antigravity: '_projects/development/ai-coding-agent-rules/_main/_partials/antigravity-bootstrap.md'
};

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readRequired(relPath, errors) {
  const full = resolveRel(relPath);
  if (!fs.existsSync(full)) {
    errors.push(`Missing agent instruction source: ${relPath}`);
    return null;
  }
  return normalize(fs.readFileSync(full, 'utf8')).trimEnd();
}

function readOptional(relPath) {
  const full = resolveRel(relPath);
  if (!fs.existsSync(full)) return '';
  return normalize(fs.readFileSync(full, 'utf8'));
}

function markerCount(text, marker) {
  return text.split(marker).length - 1;
}

function stripManagedBlock(relPath, text, begin, end, errors) {
  const beginCount = markerCount(text, begin);
  const endCount = markerCount(text, end);
  if (beginCount === 0 && endCount === 0) return text;
  if (beginCount !== 1 || endCount !== 1) {
    errors.push(`Malformed managed agent instruction markers in ${relPath}`);
    return null;
  }
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start > finish) {
    errors.push(`Managed agent instruction markers out of order in ${relPath}`);
    return null;
  }
  return `${text.slice(0, start)}${text.slice(finish + end.length)}`;
}

function removeSupersededGitHubPrSection(text) {
  const heading = '## GitHub PR Completion Rules';
  const start = text.indexOf(`\n${heading}\n`);
  const sectionStart = start === -1 && text.startsWith(`${heading}\n`) ? 0 : start;
  if (sectionStart === -1) return text;

  const headingStart = sectionStart === 0 ? 0 : sectionStart + 1;
  const contentStart = headingStart + heading.length + 1;
  const nextSection = text.indexOf('\n## ', contentStart);
  const sectionEnd = nextSection === -1 ? text.length : nextSection;
  return `${text.slice(0, headingStart)}${text.slice(sectionEnd)}`.replace(/\n{3,}/g, '\n\n');
}

function removeExactLine(text, exactLine) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== exactLine)
    .join('\n');
}

function removeLeadingHeading(text, heading) {
  let trimmed = text.trimStart();
  while (trimmed.startsWith(`${heading}\n`)) {
    trimmed = trimmed.slice(heading.length).replace(/^\n+/, '');
  }
  return trimmed;
}

function rootAgentsExpected(current, source, errors) {
  let body = stripManagedBlock('AGENTS.md', current, toolkitBegin, toolkitEnd, errors);
  if (body === null) return null;
  body = stripManagedBlock('AGENTS.md', body, n8nBegin, n8nEnd, errors);
  if (body === null) return null;
  body = removeSupersededGitHubPrSection(body).trimStart();
  body = removeLeadingHeading(body, '# Existing user / repo content below');

  const prefix = `${source.toolkit}\n\n${source.n8n}\n\n# Existing user / repo content below`;
  return body ? `${prefix}\n\n${body.trimEnd()}\n` : `${prefix}\n`;
}

function shimExpected(relPath, current, sourceText, options, errors) {
  let body = stripManagedBlock(relPath, current, toolkitBegin, toolkitEnd, errors);
  if (body === null) return null;
  if (options.importLine) body = removeExactLine(body, options.importLine);
  if (options.heading) body = removeLeadingHeading(body, options.heading);
  body = body.trim();
  return body ? `${sourceText}\n\n${body}\n` : `${sourceText}\n`;
}

function writeOrCheck(relPath, expected, errors, runMode) {
  if (expected === null) return;
  const current = readOptional(relPath);
  if (runMode === 'write') {
    fs.mkdirSync(path.dirname(resolveRel(relPath)), { recursive: true });
    fs.writeFileSync(resolveRel(relPath), expected, 'utf8');
    return;
  }
  if (current !== expected) {
    errors.push(`Stale managed agent instruction file: ${relPath}`);
  }
}

function validateAndSync(options = {}) {
  const runMode = options.mode || mode;
  const errors = [];
  const source = {
    toolkit: readRequired(partials.toolkit, errors),
    n8n: readRequired(partials.n8n, errors),
    claude: readRequired(partials.claude, errors),
    gemini: readRequired(partials.gemini, errors),
    antigravity: readRequired(partials.antigravity, errors)
  };
  if (Object.values(source).some((value) => value === null)) return { errors };

  writeOrCheck('AGENTS.md', rootAgentsExpected(readOptional('AGENTS.md'), source, errors), errors, runMode);
  writeOrCheck('CLAUDE.md', shimExpected('CLAUDE.md', readOptional('CLAUDE.md'), source.claude, {
    heading: '# Claude Code Instructions',
    importLine: '@AGENTS.md'
  }, errors), errors, runMode);
  writeOrCheck('GEMINI.md', shimExpected('GEMINI.md', readOptional('GEMINI.md'), source.gemini, {
    heading: '# Gemini Instructions',
    importLine: '@./AGENTS.md'
  }, errors), errors, runMode);
  writeOrCheck('.agents/rules/00-agent-toolkit-bootstrap.md', shimExpected(
    '.agents/rules/00-agent-toolkit-bootstrap.md',
    readOptional('.agents/rules/00-agent-toolkit-bootstrap.md'),
    source.antigravity,
    { heading: '# Agent Toolkit Antigravity Bootstrap' },
    errors
  ), errors, runMode);

  return { errors };
}

if (require.main === module) {
  const { errors } = validateAndSync();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} managed agent instruction error(s).`);
    process.exit(1);
  }
  console.log(`Managed agent instruction ${mode === 'write' ? 'sync' : 'check'} passed.`);
}

module.exports = {
  validateAndSync
};
