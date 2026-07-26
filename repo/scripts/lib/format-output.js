'use strict';

const { loadPolicy } = require('./emit-finding');

function formatHuman(result, repo) {
  const lines = [];
  lines.push('Issue Governance Advisory Audit');
  lines.push('================================');
  lines.push(`Policy version: ${loadPolicy().policy_version}`);
  lines.push(`Governance mode: ${repo.governance_mode}`);
  lines.push('');

  if (result.schemaErrors && result.schemaErrors.length > 0) {
    lines.push(`${result.schemaErrors.length} schema error(s):`);
    lines.push('');
    for (const err of result.schemaErrors) lines.push(`  SCHEMA: ${err}`);
    return lines.join('\n');
  }
  if (result.findings.length === 0) { lines.push('No violations found.'); return lines.join('\n'); }
  lines.push(`${result.findings.length} finding(s):`);
  lines.push('');
  for (const f of result.findings) {
    const ref = f.subject ? ` [${f.subject}]` : ' [@repo]';
    lines.push(`  ${f.code} (${f.severity}|${f.group})${ref}: ${f.message}`);
  }
  return lines.join('\n');
}

function formatJson(result, repo) {
  return JSON.stringify({
    audit_version: loadPolicy().policy_version,
    governance_mode: repo.governance_mode,
    schema_errors: (result.schemaErrors || []),
    finding_count: result.findings.length,
    findings: result.findings.map(f => ({
      code: f.code,
      severity: f.severity,
      group: f.group,
      subject: f.subject || null,
      message_key: f.message_key,
      message: f.message
    }))
  }, null, 2);
}

module.exports = { formatHuman, formatJson };
