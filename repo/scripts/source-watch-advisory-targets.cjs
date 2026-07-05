#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const defaultAdvisoryDocPath = 'repo/source-watch/advisory-targets.json';
const githubApiBaseUrl = 'https://api.github.com';
const fullCommitShaPattern = /^[0-9a-f]{40}$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const hiddenUnicodeControlPattern = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

function sanitizeGeneratedMarkdown(value) {
  return String(value).replace(hiddenUnicodeControlPattern, '');
}

function resolveWorkspacePath(workspace, relOrAbsPath) {
  return path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.resolve(workspace, relOrAbsPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readAdvisoryDocument(workspace, advisoryDocPath = defaultAdvisoryDocPath) {
  const fullPath = resolveWorkspacePath(workspace, advisoryDocPath);
  if (!fs.existsSync(fullPath)) {
    return {
      relPath: advisoryDocPath,
      fullPath,
      document: {
        schema_version: 1,
        policy: {},
        targets: []
      }
    };
  }
  const document = readJson(fullPath);
  validateAdvisoryDocument(document, advisoryDocPath);
  return { relPath: advisoryDocPath, fullPath, document };
}

function requireString(value, label, targetId) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${targetId} ${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, label, targetId) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`${targetId} ${label} must be a string when present`);
  return value.trim();
}

function optionalStringArray(value, label, targetId) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${targetId} ${label} must be an array when present`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`, targetId));
}

function validateIsoDate(value, label, targetId) {
  if (!isoDatePattern.test(value)) throw new Error(`${targetId} ${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${targetId} ${label} must be a valid calendar date`);
  }
  return value;
}

function validateReviewCadence(rawTarget, targetId) {
  if (rawTarget.review_cadence_days == null) return {};
  if (!Number.isInteger(rawTarget.review_cadence_days) || rawTarget.review_cadence_days < 1) {
    throw new Error(`${targetId} review_cadence_days must be a positive integer when present`);
  }
  const reviewTemplate = requireString(rawTarget.review_template, 'review_template', targetId);
  const evidenceSources = optionalStringArray(rawTarget.evidence_sources, 'evidence_sources', targetId);
  const toolkitScope = optionalStringArray(rawTarget.toolkit_scope, 'toolkit_scope', targetId);
  const classificationOptions = optionalStringArray(rawTarget.classification_options, 'classification_options', targetId);
  if (evidenceSources.length === 0) throw new Error(`${targetId} evidence_sources must list at least one source`);
  if (toolkitScope.length === 0) throw new Error(`${targetId} toolkit_scope must list at least one toolkit area`);
  if (classificationOptions.length === 0) throw new Error(`${targetId} classification_options must list at least one option`);
  const lastReviewedAt = rawTarget.last_reviewed_at == null
    ? null
    : validateIsoDate(rawTarget.last_reviewed_at, 'last_reviewed_at', targetId);
  return {
    review_cadence_days: rawTarget.review_cadence_days,
    last_reviewed_at: lastReviewedAt,
    review_template: reviewTemplate,
    evidence_sources: evidenceSources,
    toolkit_scope: toolkitScope,
    classification_options: classificationOptions
  };
}

function validateAdvisoryDocument(document, relPath) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${relPath} must be a JSON object`);
  }
  if (document.schema_version !== 1) {
    throw new Error(`${relPath} schema_version must be 1`);
  }
  if (!Array.isArray(document.targets)) {
    throw new Error(`${relPath} targets must be an array`);
  }
  for (const rawTarget of document.targets) validateTarget(rawTarget);
}

function validateTarget(rawTarget) {
  if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
    throw new Error('Advisory target must be an object');
  }
  const id = requireString(rawTarget.id, 'id', 'target');
  if (rawTarget.enabled === false) return { ...rawTarget, id, enabled: false };

  const kind = requireString(rawTarget.kind, 'kind', id);
  if (!['github_repo', 'github_path', 'manual'].includes(kind)) {
    throw new Error(`${id} kind must be github_repo, github_path, or manual`);
  }
  const state = rawTarget.state == null ? 'watching' : requireString(rawTarget.state, 'state', id);
  if (!['watching', 'pending_action'].includes(state)) {
    throw new Error(`${id} state must be watching or pending_action`);
  }
  requireString(rawTarget.name, 'name', id);
  requireString(rawTarget.recommendation, 'recommendation', id);
  requireString(rawTarget.action_taken, 'action_taken', id);
  requireString(rawTarget.remaining_work, 'remaining_work', id);
  requireString(rawTarget.removal_condition, 'removal_condition', id);
  if (kind !== 'manual') {
    requireString(rawTarget.repo, 'repo', id);
    requireString(rawTarget.ref, 'ref', id);
    if (kind === 'github_path') requireString(rawTarget.path, 'path', id);
    if (rawTarget.baseline_sha && !fullCommitShaPattern.test(rawTarget.baseline_sha)) {
      throw new Error(`${id} baseline_sha must be a 40-character SHA when set`);
    }
  }
  return { ...rawTarget, id, kind, state, ...validateReviewCadence(rawTarget, id) };
}

function requestJson(url, headers = {}) {
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-agent-toolkit-source-watch-advisory',
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub API request failed (${response.statusCode}): ${body.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`GitHub API returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function parseGitHubRepo(sourceRepo) {
  if (typeof sourceRepo !== 'string' || !sourceRepo.trim()) {
    throw new Error('source_repo must be a non-empty GitHub owner/repo value');
  }
  let value = sourceRepo.trim();
  value = value.replace(/^https:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '');
  value = value.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Unsupported GitHub source_repo: ${sourceRepo}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function githubApiBase(env = process.env) {
  return (env.SOURCE_WATCH_GITHUB_API_BASE_URL || env.GITHUB_API_URL || githubApiBaseUrl).replace(/\/+$/, '');
}

function authHeaders(env = process.env) {
  const headers = {};
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

function currentUtcDate(env = process.env) {
  if (env.SOURCE_WATCH_TODAY) {
    return new Date(`${validateIsoDate(env.SOURCE_WATCH_TODAY, 'SOURCE_WATCH_TODAY', 'env')}T00:00:00Z`);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysBetween(startDate, endDate) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86400000);
}

function periodicReviewFinding(target, env = process.env) {
  if (!target.review_cadence_days) return null;
  const today = currentUtcDate(env);
  if (!target.last_reviewed_at) {
    return {
      type: 'periodic_review_due',
      target,
      today: today.toISOString().slice(0, 10),
      due_reason: 'No last_reviewed_at is recorded.'
    };
  }
  const lastReviewed = new Date(`${target.last_reviewed_at}T00:00:00Z`);
  const elapsedDays = daysBetween(lastReviewed, today);
  if (elapsedDays < 0) throw new Error(`${target.id} last_reviewed_at must not be in the future`);
  if (elapsedDays < target.review_cadence_days) return null;
  return {
    type: 'periodic_review_due',
    target,
    today: today.toISOString().slice(0, 10),
    elapsed_days: elapsedDays,
    due_reason: `${elapsedDays} day(s) since last_reviewed_at.`
  };
}

async function latestCommitForGitHubRepoTarget(target, env = process.env) {
  const { owner, repo } = parseGitHubRepo(target.repo);
  const url = new URL(`${githubApiBase(env)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(target.ref)}`);
  const response = await requestJson(url, authHeaders(env));
  if (!response || typeof response.sha !== 'string' || !fullCommitShaPattern.test(response.sha)) {
    throw new Error(`GitHub API response for ${target.id} did not include a full commit SHA`);
  }
  return response.sha;
}

async function latestCommitForGitHubPathTarget(target, env = process.env) {
  const { owner, repo } = parseGitHubRepo(target.repo);
  const url = new URL(`${githubApiBase(env)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`);
  url.searchParams.set('sha', target.ref);
  url.searchParams.set('path', target.path);
  url.searchParams.set('per_page', '1');
  const response = await requestJson(url, authHeaders(env));
  if (!Array.isArray(response)) {
    throw new Error(`GitHub API response for ${target.id} path history was not an array`);
  }
  if (response.length === 0) {
    throw new Error(`GitHub API response for ${target.id} returned no commits for ${target.path}`);
  }
  const sha = response[0] && response[0].sha;
  if (typeof sha !== 'string' || !fullCommitShaPattern.test(sha)) {
    throw new Error(`GitHub API response for ${target.id} did not include a full commit SHA`);
  }
  return sha;
}

async function advisoryFindings({ workspace, advisoryDocPath = defaultAdvisoryDocPath }, env = process.env) {
  const { document } = readAdvisoryDocument(workspace, advisoryDocPath);
  const findings = [];
  for (const rawTarget of document.targets) {
    const target = validateTarget(rawTarget);
    if (target.enabled === false) continue;
    if (target.state === 'pending_action') {
      findings.push({ type: 'pending_advisory_action', target });
      continue;
    }
    const periodicReview = periodicReviewFinding(target, env);
    if (periodicReview) findings.push(periodicReview);
    if (target.kind === 'manual') continue;
    if (!target.baseline_sha) {
      findings.push({
        type: 'advisory_baseline_required',
        target,
        baseline_note: target.baseline_note || 'Initial advisory baseline must be set in a separate human-reviewed PR.'
      });
      continue;
    }
    const latest = target.kind === 'github_path'
      ? await latestCommitForGitHubPathTarget(target, env)
      : await latestCommitForGitHubRepoTarget(target, env);
    if (latest.toLowerCase() === target.baseline_sha.toLowerCase()) continue;
    findings.push({
      type: 'advisory_update',
      target,
      baseline_sha: target.baseline_sha,
      latest_sha: latest
    });
  }
  return {
    findings,
    target_count: document.targets.filter((target) => target && target.enabled !== false).length,
    relPath: advisoryDocPath
  };
}

function renderAdvisoryFinding(finding) {
  const target = finding.target;
  const lines = [
    `### ${sanitizeGeneratedMarkdown(target.name)}`,
    '',
    `- Target id: \`${sanitizeGeneratedMarkdown(target.id)}\``,
    `- Kind: \`${sanitizeGeneratedMarkdown(target.kind)}\``,
    `- State: \`${sanitizeGeneratedMarkdown(target.state || 'watching')}\``
  ];
  if (target.repo) lines.push(`- Repo: \`${sanitizeGeneratedMarkdown(target.repo)}\``);
  if (target.ref) lines.push(`- Ref: \`${sanitizeGeneratedMarkdown(target.ref)}\``);
  if (target.path) lines.push(`- Path: \`${sanitizeGeneratedMarkdown(target.path)}\``);
  if (finding.type === 'pending_advisory_action') {
    lines.push('- Status: `Pending advisory action`');
  } else if (finding.type === 'advisory_baseline_required') {
    lines.push('- Status: `Advisory baseline required`');
    lines.push(`- Baseline note: ${sanitizeGeneratedMarkdown(finding.baseline_note)}`);
  } else if (finding.type === 'advisory_update') {
    lines.push('- Status: `Advisory update detected`');
    lines.push(`- Baseline commit: \`${sanitizeGeneratedMarkdown(finding.baseline_sha)}\``);
    lines.push(`- Latest commit: \`${sanitizeGeneratedMarkdown(finding.latest_sha)}\``);
  } else if (finding.type === 'periodic_review_due') {
    lines.push('- Status: `Periodic review due`');
    lines.push(`- Review cadence: \`${target.review_cadence_days} day(s)\``);
    lines.push(`- Last reviewed: \`${sanitizeGeneratedMarkdown(target.last_reviewed_at || 'never')}\``);
    lines.push(`- Today: \`${sanitizeGeneratedMarkdown(finding.today)}\``);
    lines.push(`- Due reason: ${sanitizeGeneratedMarkdown(finding.due_reason)}`);
  }
  if (target.review_template) lines.push(`- Review template: \`${sanitizeGeneratedMarkdown(target.review_template)}\``);
  if (Array.isArray(target.evidence_sources) && target.evidence_sources.length > 0) {
    lines.push('- Evidence sources:');
    lines.push(...target.evidence_sources.map((item) => `  - ${sanitizeGeneratedMarkdown(item)}`));
  }
  if (Array.isArray(target.toolkit_scope) && target.toolkit_scope.length > 0) {
    lines.push('- Toolkit scope:');
    lines.push(...target.toolkit_scope.map((item) => `  - ${sanitizeGeneratedMarkdown(item)}`));
  }
  if (Array.isArray(target.classification_options) && target.classification_options.length > 0) {
    lines.push(`- Classification options: ${target.classification_options.map(sanitizeGeneratedMarkdown).join(', ')}`);
  }
  lines.push(`- Recommendation: ${sanitizeGeneratedMarkdown(target.recommendation)}`);
  lines.push(`- Action taken: ${sanitizeGeneratedMarkdown(target.action_taken)}`);
  lines.push(`- Remaining work: ${sanitizeGeneratedMarkdown(target.remaining_work)}`);
  lines.push(`- Removal condition: ${sanitizeGeneratedMarkdown(target.removal_condition)}`);
  lines.push('');
  return lines;
}

function renderAdvisorySection(findings, advisoryDocPath = defaultAdvisoryDocPath) {
  if (findings.length === 0) {
    return [
      '## Advisory Actions Requiring Review',
      '',
      'No actionable advisory targets require review.',
      ''
    ];
  }
  return [
    '## Advisory Actions Requiring Review',
    '',
    `Advisory target document: \`${advisoryDocPath}\`.`,
    `Update \`${advisoryDocPath}\` when advisory action is taken. Record the recommendation, action taken, remaining work, and removal condition. For periodic manual reviews, record last_reviewed_at only in a separate human-reviewed PR. Remove a target once fully implemented and covered by normal SOURCE-LOCK source-watch, or once it is no longer relevant.`,
    '',
    ...findings.flatMap(renderAdvisoryFinding)
  ];
}

module.exports = {
  advisoryFindings,
  defaultAdvisoryDocPath,
  readAdvisoryDocument,
  renderAdvisorySection,
  sanitizeGeneratedMarkdown,
  validateAdvisoryDocument
};
