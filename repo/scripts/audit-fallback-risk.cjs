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

function targetArgs(args = process.argv.slice(2)) {
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target') {
      if (args[i + 1]) targets.push(args[i + 1]);
      i += 1;
    } else if (arg.startsWith('--target=')) {
      targets.push(arg.slice('--target='.length));
    }
  }
  return targets;
}

const root = path.resolve(workspaceRootFromArgs() || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);
const skippedDirs = new Set(['.git', 'node_modules', '_dist', 'dist', 'coverage', '.tmp', '.n8n-local']);
const defaultScanTargets = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.agents/rules/00-agent-toolkit-bootstrap.md',
  '_projects/development/ai-coding-agent-rules',
  'repo/docs/agent-playbooks',
  'skills'
];

const exactErrorPatterns = [
  { regex: /\bbroad fallbacks?\b/i, phrase: 'broad fallback', reason: 'Broad fallback policy drift is forbidden unless the text explicitly restricts it.' },
  { regex: /\bbackwards? compatibility by default\b/i, phrase: 'backwards compatibility by default', reason: 'Compatibility fallback paths must be explicitly approved, not default behaviour.' },
  { regex: /\bsilent (?:fallbacks?|compatibility paths?)\b/i, phrase: 'silent fallback or compatibility path', reason: 'Silent fallback behaviour can hide real failures.' },
  { regex: /\b(?:synthetic|sample|mock) data fallbacks?\b/i, phrase: 'synthetic/sample/mock data fallback', reason: 'Fallbacks must not substitute fake business data.' },
  { regex: /\bfake success(?: states?)?\b/i, phrase: 'fake success', reason: 'Fake success states hide failed work.' },
  { regex: /\bcatch(?:-|\s+and\s+)continue\b/i, phrase: 'catch-and-continue', reason: 'Catch-and-continue behaviour can swallow real failures.' },
  { regex: /\bswallow errors?\b/i, phrase: 'swallow errors', reason: 'Swallowing errors hides real failures.' },
  { regex: /\bignore missing config(?:uration)?\b/i, phrase: 'ignore missing config', reason: 'Missing configuration must be visible and actionable.' },
  {
    regex: /\bdefault to (?:an? )?empty (?:object|array|\{\}|\[\])\b.{0,120}\b(?:persistence|auth|authentication|audit|config|configuration|validation)\b.{0,80}\bfails?\b/i,
    phrase: 'default to empty object/array when critical state fails',
    reason: 'Critical persistence, auth, audit, config, or validation failures must not be hidden behind empty defaults.'
  },
  {
    regex: /\b(?:persistence|auth|authentication|audit|config|configuration|validation)\b.{0,80}\bfails?\b.{0,120}\bdefault to (?:an? )?empty (?:object|array|\{\}|\[\])\b/i,
    phrase: 'default to empty object/array when critical state fails',
    reason: 'Critical persistence, auth, audit, config, or validation failures must not be hidden behind empty defaults.'
  },
  {
    regex: /\bgraceful degradation\b.{0,120}\b(?:hides?|mask(?:s|ing)?|conceals?)\b.{0,80}\b(?:business|production|payment|persistence|auth|audit|security|validation)\b/i,
    phrase: 'graceful degradation that hides business failure',
    reason: 'Graceful degradation must not hide business or production failures.'
  }
];

const warningPatterns = [
  { regex: /\bfallbacks?\b.{0,80}\b(?:legacy|compatibility|compatible|old clients?|old projects?|migration)\b/i, phrase: 'fallback with legacy or compatibility language', reason: 'Compatibility fallback wording needs human review unless it is clearly restricted.' },
  { regex: /\b(?:legacy|compatibility|compatible|old clients?|old projects?|migration)\b.{0,80}\bfallbacks?\b/i, phrase: 'legacy or compatibility fallback', reason: 'Compatibility fallback wording needs human review unless it is clearly restricted.' },
  { regex: /\bgraceful degradation\b/i, phrase: 'graceful degradation', reason: 'Graceful degradation can be valid, but should not hide business failures.' },
  { regex: /\bcontinue on errors?\b/i, phrase: 'continue on error', reason: 'Continuing after errors needs review to ensure failures remain visible.' }
];

function slash(value) {
  return value.split(path.sep).join('/');
}

function normalizeRel(value) {
  return path.posix.normalize(String(value).replace(/\\/g, '/')).replace(/^\.\//, '');
}

function resolveRel(rootDir, relPath) {
  return path.join(rootDir, relPath);
}

function readText(rootDir, relPath) {
  return fs.readFileSync(resolveRel(rootDir, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function walk(rootDir, relDir, files = []) {
  const fullDir = resolveRel(rootDir, relDir);
  if (!fs.existsSync(fullDir)) return files;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirs.has(entry.name)) continue;
    const fullPath = path.join(fullDir, entry.name);
    const relPath = slash(path.relative(rootDir, fullPath));
    if (entry.isDirectory()) {
      walk(rootDir, relPath, files);
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(normalizeRel(relPath));
    }
  }
  return files;
}

function discoverScanFiles(rootDir, targets = defaultScanTargets) {
  const files = new Set();
  for (const target of targets) {
    const relTarget = normalizeRel(target);
    const full = resolveRel(rootDir, relTarget);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const relPath of walk(rootDir, relTarget)) files.add(relPath);
    } else if (stat.isFile() && textExtensions.has(path.extname(relTarget).toLowerCase())) {
      files.add(relTarget);
    }
  }
  return [...files].sort();
}

function lineContext(lines, index) {
  return lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join('\n');
}

function isRestrictiveContext(text) {
  return /\b(?:do not|don't|must not|never|forbid(?:s|den)?|disallow(?:s|ed)?|not allowed|not add|not invent|not substitute|not silently|must never|only when|only if|unless|without (?:explicit|user|owner) approval|(?:explicitly|owner|user)-?approved|ask the user first|avoid|instead of masking|must not fail merely because)\b/i.test(text);
}

function isActionOrientedContext(text) {
  return /\b(?:add|default to|enable|fall back to|fallback to|implement|prefer|provide|route through|support|use)\b/i.test(text);
}

function firstMatch(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) return { ...pattern, matched: match[0] };
  }
  return null;
}

function finding(severity, relPath, line, match) {
  return { severity, path: relPath, line, phrase: match.phrase, matched: match.matched, reason: match.reason };
}

function auditFile(rootDir, relPath) {
  const findings = [];
  const lines = readText(rootDir, relPath).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*#{1,6}\s/.test(line) && !/\b(?:add|allow|default|enable|implement|provide|use)\b/i.test(line)) continue;
    if (!/\b(?:fallbacks?|compatibility|degradation|catch|swallow|missing config|empty object|empty array|fake success|continue on error)\b/i.test(line)) continue;
    const context = lineContext(lines, index);
    const errorMatch = firstMatch(exactErrorPatterns, line);
    if (errorMatch) {
      if (!isRestrictiveContext(context)) findings.push(finding('error', relPath, index + 1, errorMatch));
      continue;
    }
    const warningMatch = firstMatch(warningPatterns, line);
    if (warningMatch && isActionOrientedContext(line) && !isRestrictiveContext(context)) {
      findings.push(finding('warning', relPath, index + 1, warningMatch));
    }
  }
  return findings;
}

function auditFallbackRisk(rootDir = root, options = {}) {
  const files = discoverScanFiles(rootDir, options.targets || defaultScanTargets);
  const findings = files.flatMap((relPath) => auditFile(rootDir, relPath));
  return {
    files,
    findings,
    errors: findings.filter((item) => item.severity === 'error'),
    warnings: findings.filter((item) => item.severity === 'warning')
  };
}

function formatFinding(item) {
  return `${item.severity.toUpperCase()}: ${item.path}:${item.line} matched "${item.matched}" (${item.phrase}) - ${item.reason}`;
}

function formatReport(result) {
  const lines = [`Fallback risk audit scanned ${result.files.length} file(s).`];
  if (result.errors.length) {
    lines.push('', 'Errors:', ...result.errors.map(formatFinding));
  }
  if (result.warnings.length) {
    lines.push('', 'Warnings:', ...result.warnings.map(formatFinding));
  }
  lines.push('', `Summary: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
  lines.push(result.errors.length ? 'Fallback risk audit failed.' : (result.warnings.length ? 'Fallback risk audit passed with warnings.' : 'Fallback risk audit passed.'));
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const targets = targetArgs(args);
  const result = auditFallbackRisk(root, { targets: targets.length ? targets : defaultScanTargets });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.errors.length) {
    process.stderr.write(formatReport(result));
  } else {
    process.stdout.write(formatReport(result));
  }
  if (result.errors.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  auditFallbackRisk,
  auditFile,
  defaultScanTargets,
  discoverScanFiles,
  formatReport,
  isRestrictiveContext
};
