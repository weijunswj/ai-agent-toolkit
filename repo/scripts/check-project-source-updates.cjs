#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {
  isActiveThirdPartyAttributionLock,
  isRetiredMigrationLock
} = require('./audit-project-source-locks.cjs');
const {
  advisoryFindings,
  defaultAdvisoryDocPath,
  renderAdvisorySection,
  sanitizeGeneratedMarkdown
} = require('./source-watch-advisory-targets.cjs');

const defaultReportPath = 'repo/source-watch/reviews/active-third-party-updates.md';
const defaultSecurityToolLockPath = 'skills/repository-security-gate/config/tool-lock.json';
const githubApiBaseUrl = 'https://api.github.com';

function slash(value) {
  return value.split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    report: defaultReportPath,
    advisoryDoc: defaultAdvisoryDocPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') args.workspace = argv[++index] || args.workspace;
    else if (arg === '--report') args.report = argv[++index] || args.report;
    else if (arg === '--advisory-doc') args.advisoryDoc = argv[++index] || args.advisoryDoc;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.workspace = path.resolve(args.workspace);
  return args;
}

function usage() {
  return [
    'Usage: node repo/scripts/check-project-source-updates.cjs [--workspace <dir>] [--report <path>] [--advisory-doc <path>]',
    '',
    'Checks active third-party SOURCE-LOCK.json entries, security-tool provenance records, and actionable advisory targets against GitHub.',
    'When review is needed, writes a review-notification report only. It never copies upstream files, updates SOURCE-LOCK.json or advisory target documents, or changes toolkit components.'
  ].join('\n');
}

function securityToolLock(workspace, relPath = defaultSecurityToolLockPath) {
  const fullPath = path.join(workspace, relPath);
  if (!fs.existsSync(fullPath)) return { records: [], relPath, present: false };
  const lock = readJson(fullPath);
  if (lock.schema_version !== 1 || !Array.isArray(lock.records)) {
    throw new Error(`${relPath} must use schema_version 1 with records`);
  }
  const records = lock.records.filter((record) => record && record.state === 'active');
  for (const record of records) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.upstream || '')) {
      throw new Error(`${record.name || '<unknown>'} has an invalid security-tool upstream`);
    }
    if (!/^[0-9a-f]{40}$/i.test(record.commit || '')) {
      throw new Error(`${record.name || '<unknown>'} active security-tool record requires a full commit`);
    }
    if (!/^[0-9a-f]{64}$/i.test(record.license_sha256 || '')) {
      throw new Error(`${record.name || '<unknown>'} active security-tool record requires a licence digest`);
    }
  }
  return { records, relPath, present: true };
}

function githubRequestUrl(env, pathname) {
  const apiBase = (env.SOURCE_WATCH_GITHUB_API_BASE_URL || env.GITHUB_API_URL || githubApiBaseUrl).replace(/\/+$/, '');
  return new URL(`${apiBase}${pathname}`);
}

function githubHeaders(env) {
  const headers = {};
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function securityToolFindings(workspace, env = process.env) {
  const lock = securityToolLock(workspace);
  const findings = [];
  for (const record of lock.records) {
    const { owner, repo } = parseGitHubRepo(record.upstream);
    const repository = await requestJson(
      githubRequestUrl(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
      githubHeaders(env)
    );
    if (repository.archived || repository.disabled) {
      findings.push({ record, type: 'maintenance_state', detail: repository.archived ? 'archived' : 'disabled' });
    }
    const license = await requestJson(
      githubRequestUrl(
        env,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(record.license_file)}?ref=${encodeURIComponent(record.commit)}`
      ),
      githubHeaders(env)
    );
    if (!license || typeof license.content !== 'string') {
      throw new Error(`${record.name} licence source returned no content`);
    }
    const licenceDigest = crypto.createHash('sha256')
      .update(Buffer.from(license.content.replace(/\s/g, ''), 'base64'))
      .digest('hex');
    if (licenceDigest !== record.license_sha256) {
      findings.push({ record, type: 'license_drift', detail: licenceDigest });
    }

    if (record.kind === 'scanner') {
      const release = await requestJson(
        githubRequestUrl(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`),
        githubHeaders(env)
      );
      if (release.tag_name !== record.release) {
        findings.push({ record, type: 'release_drift', detail: release.tag_name || 'missing tag' });
        continue;
      }
      const asset = (release.assets || []).find((item) => item.name === record.expected_release_asset);
      if (!asset) {
        findings.push({ record, type: 'asset_missing', detail: record.expected_release_asset });
      } else if (asset.digest !== `sha256:${record.release_checksum}`) {
        findings.push({ record, type: 'asset_checksum_drift', detail: asset.digest || 'missing digest' });
      }
      continue;
    }

    const latest = await requestJson(
      githubRequestUrl(
        env,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(record.release)}`
      ),
      githubHeaders(env)
    );
    if (!latest || !/^[0-9a-f]{40}$/i.test(latest.sha || '')) {
      throw new Error(`${record.name} source returned no full commit`);
    }
    if (latest.sha.toLowerCase() !== record.commit.toLowerCase()) {
      findings.push({ record, type: 'commit_drift', detail: latest.sha });
    }
  }
  return { findings, record_count: lock.records.length, lock_path: lock.relPath };
}

function walk(dir, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === '__pycache__' || item.name === 'node_modules') continue;
    const fullPath = path.join(dir, item.name);
    entries.push({ fullPath, dirent: item });
    if (item.isDirectory()) walk(fullPath, entries);
  }
  return entries;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function discoverSourceLocks(workspace) {
  const projectsDir = path.join(workspace, '_projects');
  return walk(projectsDir)
    .filter((entry) => entry.dirent.isFile() && entry.fullPath.endsWith(`${path.sep}SOURCE-LOCK.json`))
    .map((entry) => ({
      relPath: slash(path.relative(workspace, entry.fullPath)),
      fullPath: entry.fullPath,
      lock: readJson(entry.fullPath)
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function isActiveThirdPartyLock(lock) {
  return isActiveThirdPartyAttributionLock(lock);
}

function activeThirdPartyLocks(lockFiles) {
  return lockFiles.filter((lockFile) => {
    if (isActiveThirdPartyAttributionLock(lockFile.lock)) return true;
    if (isRetiredMigrationLock(lockFile.lock)) return false;
    throw new Error(`Unsupported SOURCE-LOCK lifecycle metadata: ${lockFile.relPath}`);
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

function requestJson(url, headers = {}) {
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-agent-toolkit-source-watch',
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

async function latestCommitForLock(lock, env = process.env) {
  const { owner, repo } = parseGitHubRepo(lock.source_repo);
  const apiBase = (env.SOURCE_WATCH_GITHUB_API_BASE_URL || env.GITHUB_API_URL || githubApiBaseUrl).replace(/\/+$/, '');
  const url = new URL(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(lock.source_ref)}`);
  const headers = {};
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await requestJson(url, headers);
  if (!response || typeof response.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(response.sha)) {
    throw new Error(`GitHub API response for ${lock.source_repo}@${lock.source_ref} did not include a full commit SHA`);
  }
  return response.sha;
}

function projectPathFromLock(lockFile) {
  return lockFile.relPath.replace(/\/SOURCE-LOCK\.json$/, '');
}

function trackedFileLine(file) {
  const target = file.project_path || file.root_surface_path || '(excluded)';
  const blob = file.source_blob_sha ? ` @ ${file.source_blob_sha}` : '';
  const notes = file.notes ? ` - ${file.notes}` : '';
  return `- \`${file.mode || 'exact'}\` \`${file.source_path || '(missing source_path)'}\` -> \`${target}\`${blob}${notes}`;
}

function renderSourceUpdatesSection(updates) {
  if (updates.length === 0) {
    return [
      '## Active Third-Party Updates',
      '',
      'No active third-party source updates were detected.',
      ''
    ];
  }
  return [
    '## Active Third-Party Updates',
    '',
    ...updates.flatMap((update) => [
      `### ${update.project_path}`,
      '',
      `- Source repo: \`${update.source_repo}\``,
      `- Source ref: \`${update.source_ref}\``,
      `- Locked commit: \`${update.locked_commit}\``,
      `- Latest commit: \`${update.latest_commit}\``,
      `- Update policy: \`${update.update_policy}\``,
      `- Public attribution required: \`${update.public_attribution_required}\``,
      '',
      'Tracked files:',
      ...update.tracked_files.map(trackedFileLine),
      ''
    ])
  ];
}

function renderSecurityToolSection(findings, lockPath = defaultSecurityToolLockPath) {
  if (findings.length === 0) {
    return [
      '## Security Tool Provenance Updates',
      '',
      'No security-tool provenance drift was detected.',
      ''
    ];
  }
  return [
    '## Security Tool Provenance Updates',
    '',
    `Tool lock: \`${lockPath}\`. Detection is metadata-only and executed no upstream code.`,
    '',
    ...findings.flatMap((finding) => [
      `### ${sanitizeGeneratedMarkdown(finding.record.name)}`,
      '',
      `- Upstream: \`${sanitizeGeneratedMarkdown(finding.record.upstream)}\``,
      `- Locked release/ref: \`${sanitizeGeneratedMarkdown(finding.record.release)}\``,
      `- Locked commit: \`${sanitizeGeneratedMarkdown(finding.record.commit)}\``,
      `- Finding: \`${sanitizeGeneratedMarkdown(finding.type)}\``,
      `- Current evidence: \`${sanitizeGeneratedMarkdown(finding.detail)}\``,
      '- Next action: use the separate quarantined candidate-validation lane; do not mutate this lock or main from source-watch.',
      ''
    ])
  ];
}

function renderReviewReport({ updates, securityToolUpdates = [], securityToolLockPath = defaultSecurityToolLockPath, advisoryUpdates, advisoryDocPath }) {
  const notificationText = [
    'This PR is a review notification only.',
    'No source files or advisory tracking documents were updated.',
    'No SOURCE-LOCK pins or advisory baselines were changed.',
    'No SOURCE-LOCK pins were changed.',
    'No toolkit rules, skills, hooks, memory guidance, repo-map guidance, or cleanup guidance were modified or deleted.',
    'No upstream code was executed.',
    'No auto-merge is allowed.',
    'A human must review upstream changes, attribution/licence impact, allowlist scope, advisory recommendations, and host-harness drift evidence, then ask an AI agent to inspect before any real edits happen.'
  ];
  const checklist = [
    '- [ ] Review upstream diff manually.',
    '- [ ] Confirm changed files are within allowlist.',
    '- [ ] Confirm attribution/licence notes still apply.',
    '- [ ] Confirm no upstream code was executed.',
    '- [ ] Decide whether a separate update PR should copy/adapt files.',
    '- [ ] For Host Harness Capability Drift Review, classify affected toolkit components using the linked template before proposing changes.',
    '- [ ] Confirm any shrink, move, host-native, or delete recommendation is implemented only in a separate evidence-backed PR.',
    '- [ ] If advisory action is taken, update the advisory document in a separate human-reviewed PR.',
    '- [ ] Run npm run validate:all before any real source update merge.'
  ];

  return sanitizeGeneratedMarkdown([
    '# Active Source Watch Review',
    '',
    'PR needed: yes',
    '',
    ...notificationText,
    '',
    `Advisory actions, when present, are read from \`${advisoryDocPath}\`.`,
    'No advisory tracking document was changed by this workflow.',
    'If advisory action is taken, update the advisory document in a separate human-reviewed PR.',
    'If meaningful host-harness drift is found, open a separate PR with evidence, rationale, exact proposed modifications, and validation.',
    '',
    '## Manual Review Checklist',
    '',
    ...checklist,
    '',
    ...renderSourceUpdatesSection(updates),
    ...renderSecurityToolSection(securityToolUpdates, securityToolLockPath),
    ...renderAdvisorySection(advisoryUpdates, advisoryDocPath)
  ].join('\n'));
}

function resolveReportPath(workspace, reportPath) {
  return path.isAbsolute(reportPath) ? reportPath : path.resolve(workspace, reportPath);
}

function writeReport(workspace, reportPath, markdown) {
  const outPath = resolveReportPath(workspace, reportPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return outPath;
}

function removeReportIfPresent(workspace, reportPath) {
  const outPath = resolveReportPath(workspace, reportPath);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
}

async function checkProjectSourceUpdates({ workspace, report, advisoryDoc = defaultAdvisoryDocPath }, env = process.env) {
  const locks = discoverSourceLocks(workspace);
  const activeLocks = activeThirdPartyLocks(locks);

  const updates = [];
  for (const lockFile of activeLocks) {
    const lock = lockFile.lock;
    const latestCommit = await latestCommitForLock(lock, env);
    if (latestCommit.toLowerCase() === String(lock.source_commit || '').toLowerCase()) continue;
    updates.push({
      project_path: projectPathFromLock(lockFile),
      source_repo: lock.source_repo,
      source_ref: lock.source_ref,
      locked_commit: lock.source_commit,
      latest_commit: latestCommit,
      update_policy: lock.source_update_policy,
      public_attribution_required: lock.public_attribution_required,
      tracked_files: Array.isArray(lock.files) ? lock.files : []
    });
  }
  const securityToolResult = await securityToolFindings(workspace, env);
  const securityToolUpdates = securityToolResult.findings;
  const advisoryResult = await advisoryFindings({ workspace, advisoryDocPath: advisoryDoc }, env);
  const advisoryUpdates = advisoryResult.findings;

  if (updates.length === 0 && securityToolUpdates.length === 0 && advisoryUpdates.length === 0) {
    removeReportIfPresent(workspace, report);
    if (activeLocks.length === 0 && securityToolResult.record_count === 0 && advisoryResult.target_count === 0) {
      return {
        report_written: false,
        updates: [],
        security_tool_updates: [],
        advisory_updates: [],
        summary: 'No active third-party source update candidates found.'
      };
    }
    return {
      report_written: false,
      updates,
      security_tool_updates: securityToolUpdates,
      advisory_updates: advisoryUpdates,
      summary: advisoryResult.target_count > 0
        ? `Checked ${activeLocks.length} active third-party source lock(s), ${securityToolResult.record_count} security-tool record(s), and ${advisoryResult.target_count} advisory target(s); no actionable updates found.`
        : `Checked ${activeLocks.length} active third-party source lock(s) and ${securityToolResult.record_count} security-tool record(s); all pins are current.`
    };
  }

  const reportPath = writeReport(workspace, report, renderReviewReport({
    updates,
    securityToolUpdates,
    securityToolLockPath: securityToolResult.lock_path,
    advisoryUpdates,
    advisoryDocPath: advisoryDoc
  }));
  return {
    report_written: true,
    report_path: reportPath,
    updates,
    security_tool_updates: securityToolUpdates,
    advisory_updates: advisoryUpdates,
    summary: `PR needed: yes (${updates.length} source update${updates.length === 1 ? '' : 's'}, ${securityToolUpdates.length} security-tool update${securityToolUpdates.length === 1 ? '' : 's'}, ${advisoryUpdates.length} advisory action${advisoryUpdates.length === 1 ? '' : 's'}).`
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await checkProjectSourceUpdates(args);
  console.log(result.summary);
  if (result.report_written) console.log(`Wrote ${slash(path.relative(args.workspace, result.report_path))}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  activeThirdPartyLocks,
  checkProjectSourceUpdates,
  discoverSourceLocks,
  isActiveThirdPartyLock,
  latestCommitForLock,
  parseArgs,
  parseGitHubRepo,
  renderReviewReport,
  renderSecurityToolSection,
  securityToolFindings,
  securityToolLock,
  renderSourceUpdatesSection
};
