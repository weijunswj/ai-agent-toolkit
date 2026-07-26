'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json');

let _policy = null;

function getPolicy() {
  if (!_policy) _policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  return _policy;
}

function emitFinding(findings, code, subjectKey, messageKey, context) {
  if (!findings || !Array.isArray(findings)) {
    throw new Error('findings must be an array');
  }

  const policy = getPolicy();
  const meta = policy.finding_codes[code];
  if (!meta) {
    throw new Error(`Undeclared finding code: ${code}`);
  }

  const msgSpec = (meta.messages || {})[messageKey];
  if (!msgSpec) {
    throw new Error(`Undeclared message key "${messageKey}" for ${code}`);
  }

  const severity = meta.severity;
  const group = meta.group;

  const ctxSpec = msgSpec.context || {};
  const ctx = context || {};

  // Reject unknown keys
  for (const key of Object.keys(ctx)) {
    if (!(key in ctxSpec)) {
      throw new Error(`Undeclared context key "${key}" for ${code}/${messageKey}`);
    }
  }

  // Verify all required keys present and valid
  for (const [key, spec] of Object.entries(ctxSpec)) {
    if (!(key in ctx)) {
      throw new Error(`Missing context key "${key}" for ${code}/${messageKey}`);
    }
    const value = ctx[key];
    if (spec.type === 'integer') {
      if (!Number.isInteger(value)) {
        throw new Error(`Context "${key}" must be integer for ${code}/${messageKey}`);
      }
      const min = spec.minimum !== undefined ? spec.minimum : -Infinity;
      const max = spec.maximum !== undefined ? spec.maximum : Infinity;
      if (value < min || value > max) {
        throw new Error(`Context "${key}" out of bounds [${min},${max}] for ${code}/${messageKey}`);
      }
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`Context "${key}" must be boolean for ${code}/${messageKey}`);
      }
    } else if (spec.type === 'enum') {
      if (!spec.values.includes(value)) {
        throw new Error(`Context "${key}" must be one of ${JSON.stringify(spec.values)} for ${code}/${messageKey}`);
      }
    }
  }

  // Substitute context values into template
  let message = msgSpec.template;
  for (const key of Object.keys(ctx)) {
    const re = new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
    message = message.replace(re, String(ctx[key]));
  }

  findings.push({
    code,
    severity,
    group,
    subject: subjectKey !== undefined ? subjectKey : null,
    message_key: messageKey,
    message
  });
}

function loadPolicy() { return getPolicy(); }

module.exports = { emitFinding, getPolicy, loadPolicy, POLICY_PATH };
