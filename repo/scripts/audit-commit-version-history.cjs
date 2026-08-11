'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const BRIDGE_COUPLED_PATHS = [
  '_projects/development/toolkit-local-bridge/toolkit.project.json',
  '_projects/development/toolkit-local-bridge/_main/codex-plugin/plugin.json',
  '_projects/development/toolkit-local-bridge/_main/claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/setup-codex-toolkit-plugin.cjs',
  'repo/scripts/codex-delegation-config.cjs',
  'repo/scripts/toolkit-agent-control.cjs'
];
const BRIDGE_TRIGGER_PATHS = [
  'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/setup-toolkit.cjs',
  'repo/scripts/setup-toolkit-core.cjs',
  'repo/scripts/setup-codex-toolkit-plugin.cjs',
  'repo/scripts/setup-claude-toolkit-plugin.cjs',
  'repo/scripts/codex-delegation-config.cjs',
  'repo/scripts/toolkit-agent-control.cjs',
  'repo/scripts/repair-codex-plugin-windows-hooks.cjs',
  '.codex-plugin',
  '.claude-plugin'
];
const AI_RULES_TRIGGER_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.agents/rules'
];

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function pathMatches(value, prefix) {
  const candidate = normalizePath(value);
  const normalizedPrefix = normalizePath(prefix).replace(/\/$/, '');
  return candidate === normalizedPrefix || candidate.startsWith(`${normalizedPrefix}/`);
}

function gitResult(repoRoot, args, allowFailure = false) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${(result.stderr || '').trim()}`);
  }
  return result;
}

function gitText(repoRoot, args, allowFailure = false) {
  return String(gitResult(repoRoot, args, allowFailure).stdout || '').trim();
}

function readBlobAt(repoRoot, ref, relativePath) {
  const result = gitResult(repoRoot, ['show', `${ref}:${normalizePath(relativePath)}`], true);
  return result.status === 0 ? String(result.stdout || '') : null;
}

function readJsonAt(repoRoot, ref, relativePath) {
  const text = readBlobAt(repoRoot, ref, relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { __parseError: error.message };
  }
}

function parseSemver(value) {
  const match = SEMVER_PATTERN.exec(String(value || ''));
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function transitionClass(before, after) {
  if (before === null || before === undefined) return 'initial';
  const previous = parseSemver(before);
  const next = parseSemver(after);
  if (!previous || !next) return 'invalid';
  if (next[0] !== previous[0]) return 'major';
  if (next[1] !== previous[1]) return 'minor';
  if (next[2] !== previous[2]) return 'patch';
  return 'none';
}

function extractVersion(relativePath, text) {
  if (text === null || text === undefined) return null;
  const normalized = normalizePath(relativePath);
  if (normalized.endsWith('.json')) {
    try {
      const value = JSON.parse(text).version;
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  const patterns = [
    /const\s+BRIDGE_VERSION\s*=\s*['"]([^'"]+)['"]/,
    /const\s+EXPECTED_TOOLKIT_VERSION\s*=\s*['"]([^'"]+)['"]/,
    /const\s+TOOLKIT_CLIENT_VERSION\s*=\s*['"]([^'"]+)['"]/,
    /const\s+CONTROL_VERSION\s*=\s*['"]([^'"]+)['"]/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

function extractProjectManifests(repoRoot) {
  const result = [];
  const root = path.join(repoRoot, '_projects');
  if (!fs.existsSync(root)) return result;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name === 'toolkit.project.json') {
        const relativePath = normalizePath(path.relative(repoRoot, absolute));
        const project = JSON.parse(fs.readFileSync(absolute, 'utf8'));
        result.push({ relativePath, project });
      }
    }
  };
  visit(root);
  return result;
}

function buildFamilies(repoRoot) {
  return extractProjectManifests(repoRoot).map(({ relativePath, project }) => {
    const modulePath = normalizePath(project.module_path || path.posix.dirname(relativePath));
    const outputs = Array.isArray(project.outputs) ? project.outputs : [];
    const triggerPaths = [];
    if (outputs.length > 0) {
      triggerPaths.push(`${modulePath}/_main`, `${modulePath}/curated_output_for_ai`);
      for (const output of outputs) {
        if (output && typeof output.output === 'string') triggerPaths.push(output.output);
      }
    }
    const family = {
      id: String(project.id || modulePath),
      manifestPath: relativePath,
      modulePath,
      triggerPaths,
      coupledPaths: [relativePath]
    };
    if (family.id === 'development.ai-coding-agent-rules') {
      family.triggerPaths.push(...AI_RULES_TRIGGER_PATHS);
    }
    if (family.id === 'development.toolkit-local-bridge') {
      family.triggerPaths.push(...BRIDGE_TRIGGER_PATHS);
      family.coupledPaths = [...BRIDGE_COUPLED_PATHS];
    }
    return family;
  });
}

function versionAt(repoRoot, ref, relativePath, cache) {
  const key = `${ref}:${normalizePath(relativePath)}`;
  if (cache && cache.has(key)) return cache.get(key);
  const value = extractVersion(relativePath, readBlobAt(repoRoot, ref, relativePath));
  if (cache) cache.set(key, value);
  return value;
}

function changedPaths(repoRoot, parent, commit) {
  const output = gitText(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', parent, commit]);
  return output ? output.split(/\r?\n/).map(normalizePath).filter(Boolean) : [];
}

function subjectAt(repoRoot, commit) {
  return gitText(repoRoot, ['show', '-s', '--format=%s', commit]);
}

function commitParents(repoRoot, commit) {
  const values = gitText(repoRoot, ['rev-list', '--parents', '-n', '1', commit]).split(/\s+/).filter(Boolean);
  return values.slice(1);
}

function violation(record, family, reason, triggerPaths, before, after) {
  return {
    code: 'COMMIT_VERSION_MISMATCH',
    commit: record.commit,
    trigger: triggerPaths,
    version_family: family.id,
    required_source: family.manifestPath,
    parent_version: before === null ? '<absent>' : before,
    commit_version: after === null ? '<missing>' : after,
    reason
  };
}

function auditRange({ repoRoot, base, head }) {
  const normalizedBase = String(base || '').trim();
  const normalizedHead = String(head || '').trim();
  if (!normalizedBase || !normalizedHead) throw new Error('VERSION_AUDIT_RANGE_UNAVAILABLE');
  for (const ref of [normalizedBase, normalizedHead]) {
    const exists = gitResult(repoRoot, ['cat-file', '-e', `${ref}^{commit}`], true).status === 0;
    if (!exists) throw new Error(`VERSION_AUDIT_HISTORY_UNAVAILABLE: ${ref}`);
  }
  if (gitResult(repoRoot, ['merge-base', '--is-ancestor', normalizedBase, normalizedHead], true).status !== 0) {
    throw new Error(`VERSION_AUDIT_BASE_NOT_ANCESTOR: ${normalizedBase} -> ${normalizedHead}`);
  }
  const commits = gitText(repoRoot, ['rev-list', '--reverse', `${normalizedBase}..${normalizedHead}`]).split(/\r?\n/).filter(Boolean);
  const families = buildFamilies(repoRoot);
  const versionCache = new Map();
  const records = [];
  let firstViolation = null;
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const parents = commitParents(repoRoot, commit);
    const parent = parents[0] || normalizedBase;
    const paths = changedPaths(repoRoot, parent, commit);
    const pathSet = new Set(paths);
    const record = {
      ordinal: index + 1,
      commit,
      parent,
      parent_count: parents.length,
      subject: subjectAt(repoRoot, commit),
      changed_paths: paths,
      families: [],
      compliance: 'NO_VERSION_TRIGGER'
    };
    const candidateFamilies = families.filter((family) => paths.some((candidate) =>
      family.triggerPaths.some((prefix) => pathMatches(candidate, prefix)) ||
      candidate === normalizePath(family.manifestPath)
    ));
    for (const family of candidateFamilies) {
      const before = versionAt(repoRoot, parent, family.manifestPath, versionCache);
      const after = versionAt(repoRoot, commit, family.manifestPath, versionCache);
      const transition = transitionClass(before, after);
      if (after !== null && !parseSemver(after)) {
        const current = violation(record, family, 'invalid SemVer in version source', [], before, after);
        if (!firstViolation) firstViolation = current;
      }
      if (before !== null && after !== null && compareSemver(after, before) < 0) {
        const current = violation(record, family, 'version movement is non-monotonic', [], before, after);
        if (!firstViolation) firstViolation = current;
      }
      const triggers = paths.filter((candidate) => family.triggerPaths.some((prefix) => pathMatches(candidate, prefix)));
      const familyRecord = { id: family.id, before, after, transition, triggered_paths: triggers };
      record.families.push(familyRecord);
      if (!triggers.length) {
        if (before !== after && record.compliance === 'NO_VERSION_TRIGGER') record.compliance = 'NO_VERSION_TRIGGER_VERSION_TRANSITION_OBSERVED';
        continue;
      }
      record.compliance = 'COMPLIANT_VERSION_TRANSITION';
      if (!pathSet.has(normalizePath(family.manifestPath))) {
        const current = violation(record, family, 'required same-commit version transition missing', triggers, before, after);
        if (!firstViolation) firstViolation = current;
      } else if (after === null || (before !== null && after === before)) {
        const current = violation(record, family, 'required same-commit version transition missing', triggers, before, after);
        if (!firstViolation) firstViolation = current;
      }
      for (const coupledPath of family.coupledPaths.slice(1)) {
        const coupledBefore = versionAt(repoRoot, parent, coupledPath, versionCache);
        const coupledAfter = versionAt(repoRoot, commit, coupledPath, versionCache);
        const changed = pathSet.has(normalizePath(coupledPath));
        if (coupledAfter !== after) {
          const current = violation(record, family, `coupled version surface ${coupledPath} is not aligned`, triggers, before, after);
          if (!firstViolation) firstViolation = current;
        } else if (coupledBefore !== coupledAfter && !changed) {
          const current = violation(record, family, `coupled version surface ${coupledPath} moved outside the triggering commit`, triggers, before, after);
          if (!firstViolation) firstViolation = current;
        } else if (coupledBefore === coupledAfter && changed && before !== after) {
          const current = violation(record, family, `coupled version surface ${coupledPath} did not transition`, triggers, before, after);
          if (!firstViolation) firstViolation = current;
        } else if (coupledBefore === coupledAfter && before !== after) {
          const current = violation(record, family, `coupled version surface ${coupledPath} missing same-commit transition`, triggers, before, after);
          if (!firstViolation) firstViolation = current;
        }
      }
    }
    if (firstViolation && !record.violation) record.violation = firstViolation.commit === record.commit ? firstViolation : null;
    records.push(record);
    if (firstViolation) break;
  }
  return { base: normalizedBase, head: normalizedHead, commits, records, firstViolation, families: families.map((family) => ({ id: family.id, manifestPath: family.manifestPath, coupledPaths: family.coupledPaths })) };
}

function eventRange(environment = process.env) {
  let event = null;
  if (environment.GITHUB_EVENT_PATH && fs.existsSync(environment.GITHUB_EVENT_PATH)) {
    try { event = JSON.parse(fs.readFileSync(environment.GITHUB_EVENT_PATH, 'utf8')); } catch {}
  }
  return {
    base: environment.VERSION_AUDIT_BASE || event?.pull_request?.base?.sha || event?.before || '',
    head: environment.VERSION_AUDIT_HEAD || event?.pull_request?.head?.sha || environment.GITHUB_SHA || event?.after || ''
  };
}

function cliOptions(argv) {
  const options = { repoRoot: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo') options.repoRoot = path.resolve(argv[++index]);
    else if (argument === '--base') options.base = argv[++index];
    else if (argument === '--head') options.head = argv[++index];
    else if (argument === '--json') options.json = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  const defaults = eventRange();
  return { ...options, base: options.base || defaults.base, head: options.head || defaults.head };
}

function formatViolation(finding) {
  return [
    finding.code,
    `commit: ${finding.commit}`,
    'trigger:',
    ...finding.trigger.map((value) => `  ${value}`),
    `version_family: ${finding.version_family}`,
    `required_source: ${finding.required_source}`,
    `parent_version: ${finding.parent_version}`,
    `commit_version: ${finding.commit_version}`,
    `reason: ${finding.reason}`
  ].join('\n');
}

if (require.main === module) {
  try {
    const options = cliOptions(process.argv.slice(2));
    const result = auditRange(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.firstViolation) {
      process.stderr.write(`${formatViolation(result.firstViolation)}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Commit version history passed: ${result.commits.length} commit(s) from ${result.base} to ${result.head}.\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  auditRange,
  buildFamilies,
  compareSemver,
  extractVersion,
  formatViolation,
  parseSemver,
  transitionClass
};
