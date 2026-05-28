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
const rootReal = fs.realpathSync.native(root);
const mode = process.argv.includes('--write') ? 'write' : 'check';

const projectId = 'development.ai-coding-agent-rules';
const fixCommand = 'node repo/scripts/sync-agent-instruction-shims.cjs --write';
const executionPromptPath = '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md';
const n8nAdapterPath = '_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md';
const manualTemplatePaths = {
  agents: '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
  claude: '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
  gemini: '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'
};
const repoLocalTemplatePaths = {
  managedAgents: '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
  claude: '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
  gemini: '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
  antigravity: '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md'
};

const toolkitBegin = `<!-- AI-AGENT-TOOLKIT:${executionPromptPath}:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->`;
const toolkitEnd = `<!-- AI-AGENT-TOOLKIT:${executionPromptPath}:END GLOBAL-AGENTS.MD-TEMPLATE -->`;
const n8nBegin = `<!-- AI-AGENT-TOOLKIT:${n8nAdapterPath}:BEGIN N8N-AGENT-RULES-ADAPTER v1 -->`;
const n8nEnd = `<!-- AI-AGENT-TOOLKIT:${n8nAdapterPath}:END N8N-AGENT-RULES-ADAPTER -->`;
const toolkitMarkerPairs = [
  { begin: toolkitBegin, end: toolkitEnd },
  {
    begin: `<!-- ai-agent-toolkit:${projectId}:BEGIN ai-coding-agent-execution v1 -->`,
    end: `<!-- ai-agent-toolkit:${projectId}:END ai-coding-agent-execution -->`
  },
  {
    begin: '<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->',
    end: '<!-- AI-AGENT-TOOLKIT:END toolkit -->'
  }
];
const n8nMarkerPairs = [
  { begin: n8nBegin, end: n8nEnd },
  {
    begin: `<!-- ai-agent-toolkit:${projectId}:BEGIN n8n-adapter v1 -->`,
    end: `<!-- ai-agent-toolkit:${projectId}:END n8n-adapter -->`
  },
  {
    begin: '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->',
    end: '<!-- AI-AGENT-TOOLKIT:END n8n-adapter v1 -->'
  },
  {
    begin: '<!-- AI-AGENT-TOOLKIT:BEGIN n8n-adapter v1 -->',
    end: '<!-- AI-AGENT-TOOLKIT:END n8n-adapter -->'
  }
];

function slash(value) {
  return value.split(path.sep).join('/');
}

function normalizeWorkspaceRel(value) {
  return path.posix.normalize(String(value).replace(/\\/g, '/'));
}

function hasPathTraversal(value) {
  const slashValue = String(value).replace(/\\/g, '/');
  const normalized = normalizeWorkspaceRel(value);
  return slashValue.split('/').includes('..') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../');
}

function isAbsolutePathLike(value) {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function isInsideRoot(realPath) {
  const relative = path.relative(rootReal, realPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeWorkspacePath(relPath, label, options = {}) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error(`${label} must be a non-empty workspace-relative path`);
  }
  if (isAbsolutePathLike(relPath) || hasPathTraversal(relPath)) {
    throw new Error(`Unsafe workspace path for ${label}: ${relPath}`);
  }

  const normalized = normalizeWorkspaceRel(relPath);
  const parts = normalized.split('/').filter(Boolean);
  let current = root;
  let existing = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (options.allowMissing) break;
      throw new Error(`${label} does not exist: ${normalized}`);
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe symlink in ${label}: ${normalized}`);
    }
    existing = current;
  }

  const real = fs.realpathSync.native(existing);
  if (!isInsideRoot(real)) {
    throw new Error(`Unsafe path outside workspace for ${label}: ${normalized}`);
  }
  return path.join(root, normalized);
}

function resolveRel(relPath) {
  return safeWorkspacePath(relPath, 'agent instruction path', { allowMissing: true });
}

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readRequired(relPath, errors) {
  let full;
  try {
    full = safeWorkspacePath(relPath, `agent instruction source ${relPath}`);
  } catch (error) {
    errors.push(`${error.message}. Run ${fixCommand}.`);
    return null;
  }
  return normalize(fs.readFileSync(full, 'utf8')).trimEnd();
}

function readOptional(relPath) {
  const full = safeWorkspacePath(relPath, `agent instruction file ${relPath}`, { allowMissing: true });
  if (!fs.existsSync(full)) return '';
  return normalize(fs.readFileSync(full, 'utf8'));
}

function generatedNotice(sourcePaths) {
  return [
    '<!--',
    'Generated from toolkit project source. Do not edit directly.',
    `Project: ${projectId}`,
    ...sourcePaths.map((sourcePath) => `Source: ${sourcePath}`),
    'Update the project source and run sync.',
    '-->',
    ''
  ].join('\n');
}

function fencedTemplate({ title, audience, destinationDisplay, activeNameText, installSubject, examples, payload, sourcePaths }) {
  const body = [
    generatedNotice(sourcePaths),
    `# ${title}`,
    '',
    `Use this generated template for ${audience}.`,
    '',
    `This file is inert while it keeps the \`.template.md\` filename. It is safe to keep inside a skill folder because ${activeNameText}.`,
    '',
    `Copy or merge the fenced payload into the target repo root as ${destinationDisplay} only when the user explicitly wants ${installSubject} installed.`,
    '',
    `If the target repo already has ${destinationDisplay}, do not overwrite it. Merge manually or produce a diff/merge plan.`
  ];

  for (const example of examples) {
    body.push('');
    body.push(`## ${example.heading}`);
    body.push('');
    body.push('Copy or merge the fenced payload into:');
    body.push('');
    body.push('```text');
    body.push(example.path);
    body.push('```');
    body.push('');
    body.push('Or create it with PowerShell:');
    body.push('');
    body.push('```text');
    for (const command of example.commands) body.push(command);
    body.push('```');
  }

  body.push('');
  body.push('---');
  body.push('');
  body.push('````````md');
  body.push(payload.trimEnd());
  body.push('````````');
  return `${body.join('\n').trimEnd()}\n`;
}

function managedPayload(executionPrompt, n8nAdapter) {
  return [
    toolkitBegin,
    executionPrompt.trimEnd(),
    toolkitEnd,
    '',
    n8nBegin,
    n8nAdapter.trimEnd(),
    n8nEnd
  ].join('\n');
}

function expectedSourceTemplates(executionPrompt) {
  const sourcePaths = [executionPromptPath];
  return {
    [manualTemplatePaths.agents]: fencedTemplate({
      title: 'AGENTS.template.md AI coding agent rules',
      audience: 'Codex or OpenCode',
      destinationDisplay: '`AGENTS.md`',
      activeNameText: 'it is not named `AGENTS.md`',
      installSubject: 'generic Codex/OpenCode rules',
      examples: [
        {
          heading: 'Codex global rules example',
          path: 'C:\\Users\\<your-user>\\.codex\\AGENTS.md',
          commands: ['mkdir $HOME\\.codex -Force', 'notepad $HOME\\.codex\\AGENTS.md']
        },
        {
          heading: 'OpenCode global rules example',
          path: 'C:\\Users\\<your-user>\\.config\\opencode\\AGENTS.md',
          commands: ['mkdir $HOME\\.config\\opencode -Force', 'notepad $HOME\\.config\\opencode\\AGENTS.md']
        }
      ],
      payload: executionPrompt,
      sourcePaths
    }),
    [manualTemplatePaths.claude]: fencedTemplate({
      title: 'CLAUDE.template.md AI coding agent rules',
      audience: 'Claude Code',
      destinationDisplay: '`CLAUDE.md`',
      activeNameText: 'it is not named `CLAUDE.md`',
      installSubject: 'generic Claude Code rules',
      examples: [
        {
          heading: 'Claude Code global rules example',
          path: 'C:\\Users\\<your-user>\\.claude\\CLAUDE.md',
          commands: ['mkdir $HOME\\.claude -Force', 'notepad $HOME\\.claude\\CLAUDE.md']
        }
      ],
      payload: executionPrompt,
      sourcePaths
    }),
    [manualTemplatePaths.gemini]: fencedTemplate({
      title: 'GEMINI.template.md AI coding agent rules',
      audience: 'Antigravity',
      destinationDisplay: '`GEMINI.md`',
      activeNameText: 'it is not named `GEMINI.md`',
      installSubject: 'generic Antigravity rules',
      examples: [
        {
          heading: 'Antigravity global rules example',
          path: 'C:\\Users\\<your-user>\\.gemini\\GEMINI.md',
          commands: ['mkdir $HOME\\.gemini -Force', 'notepad $HOME\\.gemini\\GEMINI.md']
        }
      ],
      payload: executionPrompt,
      sourcePaths
    })
  };
}

function markerCount(text, marker) {
  return text.split(marker).length - 1;
}

const repoLocalSafetyComment = [
  '<!--',
  'Curated AI-facing source.',
  'Project: development.ai-coding-agent-rules',
  'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
  '-->'
].join('\n');

const repoLocalWrapperPatterns = [
  { pattern: /Generated from toolkit/i, description: 'generated toolkit notice' },
  { pattern: /This file is inert/i, description: 'inert template prose' },
  { pattern: /copy or merge the fenced payload/i, description: 'fenced-payload install prose' },
  { pattern: /^````````md$/m, description: 'opening 8-backtick payload fence' },
  { pattern: /^````````$/m, description: 'closing 8-backtick payload fence' },
  { pattern: /^## Repo-local /m, description: 'README-style repo-local install heading' },
  { pattern: /<repo>\\/i, description: 'README-style destination example' },
  { pattern: /Or create it with PowerShell/i, description: 'README-style PowerShell install prose' }
];

function readBareRepoLocalTemplate(relPath, errors) {
  const text = readRequired(relPath, errors);
  if (text === null) return null;
  const safetyPrefix = `${repoLocalSafetyComment}\n\n`;
  if (!text.startsWith(safetyPrefix)) {
    errors.push(`Repo-local install template must start with the exact curated-source safety comment: ${relPath}. Run ${fixCommand}.`);
  }
  const payload = text.startsWith(safetyPrefix) ? text.slice(safetyPrefix.length) : text;
  for (const { pattern, description } of repoLocalWrapperPatterns) {
    if (pattern.test(payload)) {
      errors.push(`Repo-local install template must be a bare copy-ready payload without ${description}: ${relPath}. Run ${fixCommand}.`);
    }
  }
  if (/Curated AI-facing source|Review rule:/i.test(payload)) {
    errors.push(`Repo-local install template must not duplicate curated-source comments in the payload body: ${relPath}. Run ${fixCommand}.`);
  }
  return payload;
}

function extractManagedBlock(relPath, text, begin, end, errors) {
  const beginCount = markerCount(text, begin);
  const endCount = markerCount(text, end);
  if (beginCount !== 1 || endCount !== 1) {
    errors.push(`Malformed managed agent instruction source markers in ${relPath}. Run ${fixCommand}.`);
    return null;
  }
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start > finish) {
    errors.push(`Managed agent instruction source markers out of order in ${relPath}. Run ${fixCommand}.`);
    return null;
  }
  return text.slice(start, finish + end.length).trimEnd();
}

function stripManagedBlock(relPath, text, begin, end, errors) {
  const beginCount = markerCount(text, begin);
  const endCount = markerCount(text, end);
  if (beginCount === 0 && endCount === 0) return text;
  if (beginCount !== 1 || endCount !== 1) {
    errors.push(`Malformed managed agent instruction markers in ${relPath}. Run ${fixCommand}.`);
    return null;
  }
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start > finish) {
    errors.push(`Managed agent instruction markers out of order in ${relPath}. Run ${fixCommand}.`);
    return null;
  }
  return `${text.slice(0, start)}${text.slice(finish + end.length)}`;
}

function stripManagedBlockAny(relPath, text, markerPairs, errors) {
  const matches = markerPairs
    .map((pair) => ({
      ...pair,
      beginCount: markerCount(text, pair.begin),
      endCount: markerCount(text, pair.end)
    }))
    .filter((pair) => pair.beginCount > 0 || pair.endCount > 0);
  if (matches.length === 0) return text;

  const completeMatches = matches.filter((pair) =>
    pair.beginCount === 1 && pair.endCount === 1 && text.indexOf(pair.begin) < text.indexOf(pair.end)
  );
  if (completeMatches.length !== 1) {
    errors.push(`Malformed managed agent instruction markers in ${relPath}. Run ${fixCommand}.`);
    return null;
  }
  return stripManagedBlock(relPath, text, completeMatches[0].begin, completeMatches[0].end, errors);
}

function stripN8nManagedBlock(relPath, text, errors) {
  return stripManagedBlockAny(relPath, text, n8nMarkerPairs, errors);
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

function normalizeRepoIntroHeading(text) {
  return text.replace(
    /^# This repo is the canonical reusable AI Agent Toolkit\.$/m,
    'This repo is the canonical reusable AI Agent Toolkit.'
  );
}

function shimBody(sourceText, options) {
  let body = sourceText;
  if (options.importLine) body = removeExactLine(body, options.importLine);
  if (options.heading) body = removeLeadingHeading(body, options.heading);
  return body.trim();
}

function rootAgentsExpected(current, source, errors) {
  let body = stripManagedBlockAny('AGENTS.md', current, toolkitMarkerPairs, errors);
  if (body === null) return null;
  body = stripN8nManagedBlock('AGENTS.md', body, errors);
  if (body === null) return null;
  body = removeSupersededGitHubPrSection(body).trimStart();
  body = removeLeadingHeading(body, '# Existing user / repo content below');
  body = normalizeRepoIntroHeading(body);

  const heading = '# AI Agent Toolkit Repo Rules';
  const normalizedBody = body.trimStart();
  if (normalizedBody.startsWith(`${heading}\n`)) {
    const rest = normalizedBody.slice(heading.length).replace(/^\n+/, '').trimEnd();
    return rest
      ? `${heading}\n\n${source.toolkit}\n\n${source.n8n}\n\n${rest}\n`
      : `${heading}\n\n${source.toolkit}\n\n${source.n8n}\n`;
  }

  return normalizedBody
    ? `${source.toolkit}\n\n${source.n8n}\n\n${normalizedBody.trimEnd()}\n`
    : `${source.toolkit}\n\n${source.n8n}\n`;
}

function shimExpected(relPath, current, sourceText, options, errors) {
  let body = stripManagedBlockAny(relPath, current, toolkitMarkerPairs, errors);
  if (body === null) return null;
  if (options.importLine) body = removeExactLine(body, options.importLine);
  if (options.heading) body = removeLeadingHeading(body, options.heading);
  body = body.trim();
  const expectedBody = shimBody(sourceText, options);
  while (expectedBody && (body === expectedBody || body.startsWith(`${expectedBody}\n`))) {
    body = body.slice(expectedBody.length).trim();
  }
  return body ? `${sourceText}\n\n${body}\n` : `${sourceText}\n`;
}

function writeOrCheck(relPath, expected, errors, runMode, label = 'managed agent instruction file') {
  if (expected === null) return;
  const current = readOptional(relPath);
  if (runMode === 'write') {
    const full = safeWorkspacePath(relPath, `agent instruction output ${relPath}`, { allowMissing: true });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, expected, 'utf8');
    return;
  }
  if (current !== expected) {
    errors.push(`Stale ${label}: ${relPath}. Run ${fixCommand}.`);
  }
}

function validateAndSync(options = {}) {
  const runMode = options.mode || mode;
  const errors = [];
  const executionPrompt = readRequired(executionPromptPath, errors);
  const n8nAdapter = readRequired(n8nAdapterPath, errors);
  if (executionPrompt === null || n8nAdapter === null) return { errors };

  const sourceTemplates = expectedSourceTemplates(executionPrompt);
  for (const [relPath, expected] of Object.entries(sourceTemplates)) {
    writeOrCheck(relPath, expected, errors, runMode, 'agent instruction source template');
  }

  const managedAgentsTemplate = readBareRepoLocalTemplate(repoLocalTemplatePaths.managedAgents, errors);
  const claudeTemplate = readBareRepoLocalTemplate(repoLocalTemplatePaths.claude, errors);
  const geminiTemplate = readBareRepoLocalTemplate(repoLocalTemplatePaths.gemini, errors);
  const antigravityTemplate = readBareRepoLocalTemplate(repoLocalTemplatePaths.antigravity, errors);
  if ([managedAgentsTemplate, claudeTemplate, geminiTemplate, antigravityTemplate].some((value) => value === null)) return { errors };

  const source = {
    toolkit: extractManagedBlock(repoLocalTemplatePaths.managedAgents, managedAgentsTemplate, toolkitBegin, toolkitEnd, errors),
    n8n: extractManagedBlock(repoLocalTemplatePaths.managedAgents, managedAgentsTemplate, n8nBegin, n8nEnd, errors),
    claude: claudeTemplate,
    gemini: geminiTemplate,
    antigravity: antigravityTemplate
  };
  if (Object.values(source).some((value) => value === null)) return { errors };
  if (managedAgentsTemplate.trimEnd() !== managedPayload(executionPrompt, n8nAdapter).trimEnd()) {
    errors.push(`Stale curated repo-local managed AGENTS template: ${repoLocalTemplatePaths.managedAgents}. Update the curated source from ${executionPromptPath} and ${n8nAdapterPath}, keep the compact fail-closed n8n adapter, then run sync.`);
    return { errors };
  }

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
