#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {
  activeThirdPartyLocks,
  discoverSourceLocks,
  latestCommitForLock,
  parseGitHubRepo
} = require('./check-project-source-updates.cjs');

const defaultConfigPath = 'repo/ecosystem-radar.json';
const defaultReportPath = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
const githubApiBaseUrl = 'https://api.github.com';
const fullCommitShaPattern = /^[0-9a-f]{40}$/i;

function slash(value) {
  return value.split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    config: defaultConfigPath,
    report: defaultReportPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') args.workspace = argv[++index] || args.workspace;
    else if (arg === '--config') args.config = argv[++index] || args.config;
    else if (arg === '--report') args.report = argv[++index] || args.report;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.workspace = path.resolve(args.workspace);
  return args;
}

function usage() {
  return [
    'Usage: node repo/scripts/check-ecosystem-updates.cjs [--workspace <dir>] [--config <path>] [--report <path>]',
    '',
    'Checks existing active third-party SOURCE-LOCK pins plus advisory ecosystem targets.',
    'When review is needed, writes one report only. It never updates source pins, advisory baselines, generated skills, provider/deployment config, secrets, or application code.'
  ].join('\n');
}

function resolveWorkspacePath(workspace, relOrAbsPath) {
  return path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.resolve(workspace, relOrAbsPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readConfig(workspace, configPath) {
  const config = readJson(resolveWorkspacePath(workspace, configPath));
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Ecosystem radar config must be a JSON object');
  }
  if (config.schema_version !== 1) {
    throw new Error('Ecosystem radar config schema_version must be 1');
  }
  if (!Array.isArray(config.targets)) {
    throw new Error('Ecosystem radar config targets must be an array');
  }
  return config;
}

function requestJson(url, headers = {}) {
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-agent-toolkit-ecosystem-radar',
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

function githubApiBase(env = process.env) {
  return (env.ECOSYSTEM_RADAR_GITHUB_API_BASE_URL ||
    env.SOURCE_WATCH_GITHUB_API_BASE_URL ||
    env.GITHUB_API_URL ||
    githubApiBaseUrl).replace(/\/+$/, '');
}

function authHeaders(env = process.env) {
  const headers = {};
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

function requireString(value, label, targetId) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${targetId} ${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('Ecosystem radar target must be an object');
  }
  const id = requireString(target.id, 'id', 'target');
  if (target.enabled === false) return { ...target, id, enabled: false };

  const kind = requireString(target.kind, 'kind', id);
  if (!['github_repo', 'github_path', 'manual'].includes(kind)) {
    throw new Error(`${id} kind must be github_repo, github_path, or manual`);
  }
  if (kind === 'manual') return { ...target, id, kind };

  requireString(target.repo, 'repo', id);
  requireString(target.ref, 'ref', id);
  if (kind === 'github_path') requireString(target.path, 'path', id);
  if (target.baseline_sha && !fullCommitShaPattern.test(target.baseline_sha)) {
    throw new Error(`${id} baseline_sha must be a 40-character SHA when set`);
  }
  return { ...target, id, kind };
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

async function advisoryFindings(config, env = process.env) {
  const findings = [];
  for (const rawTarget of config.targets) {
    const target = validateTarget(rawTarget);
    if (target.enabled === false) continue;
    const baseline = target.baseline_sha || '';
    if (!baseline) {
      findings.push({
        type: 'advisory_baseline_required',
        target,
        baseline_note: target.baseline_note || 'Initial advisory baseline must be set in a separate human-approved PR.'
      });
      continue;
    }
    if (target.kind === 'manual') {
      findings.push({
        type: 'manual_advisory_review',
        target,
        baseline_sha: baseline,
        baseline_note: target.baseline_note || 'Manual advisory target requires human review.'
      });
      continue;
    }

    const latest = target.kind === 'github_path'
      ? await latestCommitForGitHubPathTarget(target, env)
      : await latestCommitForGitHubRepoTarget(target, env);
    if (latest.toLowerCase() === baseline.toLowerCase()) continue;
    findings.push({
      type: 'advisory_update',
      target,
      baseline_sha: baseline,
      latest_sha: latest
    });
  }
  return findings;
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

async function sourceLockFindings(workspace, env = process.env) {
  const locks = discoverSourceLocks(workspace);
  const activeLocks = activeThirdPartyLocks(locks);
  const findings = [];
  for (const lockFile of activeLocks) {
    const lock = lockFile.lock;
    const latestCommit = await latestCommitForLock(lock, env);
    if (latestCommit.toLowerCase() === String(lock.source_commit || '').toLowerCase()) continue;
    findings.push({
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
  return { activeLocks, findings };
}

function listValue(values) {
  return Array.isArray(values) && values.length
    ? values.map((value) => `\`${value}\``).join(', ')
    : '`not specified`';
}

function renderSourceLockSection(findings) {
  if (findings.length === 0) {
    return [
      '## Active Third-Party Source Pins',
      '',
      'No active third-party source pin drift was detected.',
      ''
    ];
  }
  return [
    '## Active Third-Party Source Pins',
    '',
    ...findings.flatMap((finding) => [
      `### ${finding.project_path}`,
      '',
      `- Source repo: \`${finding.source_repo}\``,
      `- Source ref: \`${finding.source_ref}\``,
      `- Locked commit: \`${finding.locked_commit}\``,
      `- Latest commit: \`${finding.latest_commit}\``,
      `- Update policy: \`${finding.update_policy}\``,
      `- Public attribution required: \`${finding.public_attribution_required}\``,
      '',
      'Tracked files:',
      ...finding.tracked_files.map(trackedFileLine),
      ''
    ])
  ];
}

function renderAdvisoryFinding(finding) {
  const target = finding.target;
  const lines = [
    `### ${target.name || target.id}`,
    '',
    `- Target id: \`${target.id}\``,
    `- Kind: \`${target.kind}\``,
    `- Repo: \`${target.repo || 'not applicable'}\``,
    `- Ref: \`${target.ref || 'not applicable'}\``
  ];
  if (target.path) lines.push(`- Path: \`${target.path}\``);
  lines.push(`- Affects: ${listValue(target.affects)}`);
  if (finding.type === 'advisory_baseline_required') {
    lines.push('- Status: `Advisory baseline required`');
    lines.push(`- Baseline note: ${finding.baseline_note}`);
  } else if (finding.type === 'manual_advisory_review') {
    lines.push('- Status: `Manual advisory review required`');
    lines.push(`- Baseline commit: \`${finding.baseline_sha}\``);
    lines.push(`- Baseline note: ${finding.baseline_note}`);
  } else {
    lines.push('- Status: `Advisory update detected`');
    lines.push(`- Baseline commit: \`${finding.baseline_sha}\``);
    lines.push(`- Latest commit: \`${finding.latest_sha}\``);
  }
  if (target.recommended_action) lines.push(`- Recommended action: ${target.recommended_action}`);
  lines.push('');
  return lines;
}

function renderAdvisorySection(findings) {
  if (findings.length === 0) {
    return [
      '## Advisory Targets',
      '',
      'No advisory target drift was detected.',
      ''
    ];
  }
  return [
    '## Advisory Targets',
    '',
    ...findings.flatMap(renderAdvisoryFinding)
  ];
}

function renderReviewReport({ sourceFindings, advisoryTargetFindings }) {
  const safetyNotes = [
    'This PR is a weekly ecosystem radar report only.',
    'The scheduled workflow stages only `repo/source-watch/reviews/weekly-ecosystem-radar.md`.',
    'No `_projects/**`, `SOURCE-LOCK.json`, generated `skills/**`, advisory baselines, provider or deployment config, secrets, or application code were staged by the workflow.',
    'No issues are created and no `issues: write` permission is requested.',
    'No source pins were changed.',
    'No SOURCE-LOCK pins were changed.',
    'No advisory baselines were changed.',
    'No upstream code was executed.',
    'No upstream packages were installed.',
    'No live deployment actions, provider calls, notification tests, or production mutations were run.',
    'No auto-merge is allowed.',
    'Advisory baseline advancement requires a separate human-approved PR.'
  ];
  const checklist = [
    '- [ ] Review source-lock drift manually before opening any source update PR.',
    '- [ ] Confirm advisory target relevance before changing baselines.',
    '- [ ] Keep source-pin and advisory-baseline changes in separate human-approved PRs.',
    '- [ ] Confirm no upstream code or package installation was run.',
    '- [ ] Confirm no live deployment, provider, notification, or production mutation occurred.'
  ];

  return [
    '# Weekly Ecosystem Radar',
    '',
    'PR needed: yes',
    '',
    ...safetyNotes,
    '',
    'Existing source-watch behavior is preserved; this radar reuses the same active SOURCE-LOCK discovery and latest-commit comparison helpers, and the legacy daily source-watch workflow remains unchanged.',
    '',
    '## Manual Review Checklist',
    '',
    ...checklist,
    '',
    ...renderSourceLockSection(sourceFindings),
    ...renderAdvisorySection(advisoryTargetFindings)
  ].join('\n');
}

function writeReport(workspace, reportPath, markdown) {
  const outPath = resolveWorkspacePath(workspace, reportPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return outPath;
}

function removeReportIfPresent(workspace, reportPath) {
  const outPath = resolveWorkspacePath(workspace, reportPath);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
}

async function checkEcosystemUpdates(args, env = process.env) {
  const config = readConfig(args.workspace, args.config);
  const { activeLocks, findings: sourceFindings } = await sourceLockFindings(args.workspace, env);
  const advisoryTargetFindings = await advisoryFindings(config, env);
  const findingsCount = sourceFindings.length + advisoryTargetFindings.length;
  if (findingsCount === 0) {
    removeReportIfPresent(args.workspace, args.report);
    return {
      report_written: false,
      source_updates: sourceFindings,
      advisory_updates: advisoryTargetFindings,
      summary: `Checked ${activeLocks.length} active third-party source lock(s) and ${config.targets.length} advisory target(s); all tracked ecosystem targets are current.`
    };
  }

  const reportPath = writeReport(args.workspace, args.report, renderReviewReport({ sourceFindings, advisoryTargetFindings }));
  return {
    report_written: true,
    report_path: reportPath,
    source_updates: sourceFindings,
    advisory_updates: advisoryTargetFindings,
    summary: `PR needed: yes (${sourceFindings.length} source update${sourceFindings.length === 1 ? '' : 's'}, ${advisoryTargetFindings.length} advisory finding${advisoryTargetFindings.length === 1 ? '' : 's'}).`
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await checkEcosystemUpdates(args);
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
  advisoryFindings,
  checkEcosystemUpdates,
  latestCommitForGitHubPathTarget,
  latestCommitForGitHubRepoTarget,
  parseArgs,
  readConfig,
  renderReviewReport,
  sourceLockFindings
};
