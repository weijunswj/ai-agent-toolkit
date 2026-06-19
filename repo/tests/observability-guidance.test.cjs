'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function extractSection(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  const headingStart = start === -1
    ? (text.startsWith(`## ${heading}\n`) ? 0 : -1)
    : start + 1;
  assert.notEqual(headingStart, -1, `missing section: ${heading}`);
  const contentStart = headingStart + `## ${heading}\n`.length;
  const nextHeading = text.indexOf('\n## ', contentStart);
  return text.slice(contentStart, nextHeading === -1 ? text.length : nextHeading).trim();
}

function assertCompactApplicationErrorBlock(text, relPath) {
  const section = extractSection(text, 'Application Error, Logging, And Privacy Defaults');
  const bulletCount = section.split('\n').filter((line) => line.trim().startsWith('- ')).length;
  assert.ok(bulletCount >= 3 && bulletCount <= 5, `${relPath} should keep the app error block compact`);
  assert.match(section, /generic user-facing errors/i, relPath);
  assert.match(section, /support-safe traceable reference/i, relPath);
  assert.match(section, /same event\/request-specific reference/i, relPath);
  assert.match(section, /server logs or the approved logging backend/i, relPath);
  assert.match(section, /privacy-minimized/i, relPath);
  assert.match(section, /raw prompts, uploads, model responses, secrets, auth headers, cookies, payment data, private connector data, private files, or unnecessary PII/i, relPath);
  assert.match(section, /Do not add broad fallbacks or backwards compatibility by default/i, relPath);
  assert.match(section, /route to the relevant frontend\/backend\/privacy\/observability skills and reference docs/i, relPath);
  assert.doesNotMatch(section, /UNKNOWN_ERROR|INTERNAL_ERROR|ERR_GENERIC/, `${relPath} should leave static-code details to skills`);
  assert.doesNotMatch(section, /accounts, forms, uploads, analytics, AI, payments, user data, customer\/business data, admin workflows, dashboards, or confidential business data/i, `${relPath} should leave legal-page detail to skills`);
  assert.doesNotMatch(section, /Privacy Policy|Terms of Use/i, `${relPath} should leave legal-page detail to skills`);
}

function assertTraceableErrorReference(text, relPath) {
  assert.match(text, /support-safe[\s\S]{0,80}non-PII[\s\S]{0,80}non-secret/i, relPath);
  assert.match(text, /event\/request-specific/i, relPath);
  assert.match(text, /exact backend log event|approved logging-backend entry/i, relPath);
  assert.match(text, /stable enough[\s\S]{0,80}quote[\s\S]{0,80}support/i, relPath);
  assert.match(text, /not reveal(?:ing)? internals/i, relPath);
  assert.match(text, /UNKNOWN_ERROR/i, relPath);
  assert.match(text, /INTERNAL_ERROR/i, relPath);
  assert.match(text, /ERR_GENERIC/i, relPath);
  assert.match(text, /static-only|static taxonomy codes/i, relPath);
  assert.match(text, /unique request id, event id, trace id, or error reference/i, relPath);
  assert.match(text, /same (?:visible )?error (?:code\/reference|code or reference|reference)[\s\S]{0,140}(?:backend logs|server-side logs|approved logging backend|logging-backend entry)/i, relPath);
}

function assertProductDataHandlingLegalScope(text, relPath) {
  assert.match(text, /product-facing and\/or data-handling frontend apps/i, relPath);
  assert.match(text, /accounts, forms, uploads, analytics, AI, payments, user data, customer\/business data, admin workflows, dashboards, or confidential business data/i, relPath);
  assert.match(text, /isolated component, static UI experiment, internal throwaway mock, or non-product frontend-only task/i, relPath);
  assert.match(text, /intended for product use or handles user\/business\/confidential data/i, relPath);
}

test('Secure CI/CD surfaces require privacy-safe deployment and AI observability', () => {
  for (const relPath of [
    '_projects/cicd/secure-installer/_main/README.md',
    'skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md',
    '_projects/cicd/secure-installer/curated_output_for_ai/templates/cicd/CURRENT_CICD_STATUS.template.md',
    'skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md',
    'skills/secure-cicd-installer/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /privacy-safe/i, relPath);
    assert.match(text, /metadata-only/i, relPath);
    assert.match(text, /PASS\/WARN\/FAIL/, relPath);
    assert.match(text, /AI attempt ledger/i, relPath);
    assert.match(text, /failure taxonomy/i, relPath);
    assert.match(text, /output-shape/i, relPath);
    assert.match(text, /raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data/i, relPath);
    assert.match(text, /provider calls, notification tests, production mutations, (?:(?:or|and) )?auto-remediation/i, relPath);
  }
});

test('self-hosted and managed app skills include metadata-only AI observability baseline', () => {
  for (const relPath of [
    '_projects/development/self-hosted-service-safety/_main/skill/SKILL.md',
    'skills/self-hosted-service-safety/SKILL.md',
    '_projects/development/managed-app-foundation-review/_main/skill/SKILL.md',
    'skills/managed-app-foundation-review/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /privacy-safe/i, relPath);
    assert.match(text, /metadata-only/i, relPath);
    assert.match(text, /PASS\/WARN\/FAIL/, relPath);
    assert.match(text, /AI (?:attempt ledger|modules?)/i, relPath);
    assert.match(text, /failure taxonomy/i, relPath);
    assert.match(text, /output-shape/i, relPath);
    assert.match(text, /raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data/i, relPath);
    assert.match(text, /provider calls, notification tests, production mutations, (?:(?:or|and) )?auto-remediation/i, relPath);
  }
});

test('frontend skill requires privacy-safe user-facing error references and legal pages', () => {
  for (const relPath of [
    '_projects/design/ui-ux-pro-max/_main/skill/SKILL.md',
    'skills/ui-ux-secure-frontend-design/SKILL.md',
    '_projects/design/ui-ux-pro-max/_main/skill/references/privacy-security-safety.md',
    'skills/ui-ux-secure-frontend-design/references/privacy-security-safety.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /GDPR/i, relPath);
    assert.match(text, /PDPA/i, relPath);
    assert.match(text, /Privacy Policy/i, relPath);
    assert.match(text, /Terms of Use/i, relPath);
    assert.match(text, /error (?:code|reference)/i, relPath);
    assert.match(text, /Contact support if this keeps happening/i, relPath);
    assert.match(text, /detailed .*logs/i, relPath);
    assertTraceableErrorReference(text, relPath);
    assertProductDataHandlingLegalScope(text, relPath);
  }
});

test('backend and app-foundation skills require traceable generic error handling', () => {
  for (const relPath of [
    '_projects/development/self-hosted-service-safety/_main/skill/SKILL.md',
    'skills/self-hosted-service-safety/SKILL.md',
    '_projects/development/managed-app-foundation-review/_main/skill/SKILL.md',
    'skills/managed-app-foundation-review/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /GDPR/i, relPath);
    assert.match(text, /PDPA/i, relPath);
    assert.match(text, /generic public-facing/i, relPath);
    assert.match(text, /error (?:code|reference)/i, relPath);
    assert.match(text, /Contact support if this keeps happening/i, relPath);
    assert.match(text, /server-side logs/i, relPath);
    assert.match(text, /raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data/i, relPath);
    assertTraceableErrorReference(text, relPath);
    assertProductDataHandlingLegalScope(text, relPath);
  }
});

test('repo-local agent rules keep application error defaults compact', () => {
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md',
    'AGENTS.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
  ]) {
    const text = readText(relPath);
    assertCompactApplicationErrorBlock(text, relPath);
  }
});
