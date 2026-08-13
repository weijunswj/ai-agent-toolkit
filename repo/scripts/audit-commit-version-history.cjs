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

function readJsonAt(repoRoot, ref, relativePath, objectStore = null) {
  const text = objectStore ? objectStore.read(ref, relativePath) : readBlobAt(repoRoot, ref, relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { __parseError: error.message };
  }
}

function treeEntriesAt(repoRoot, ref) {
  const output = gitText(repoRoot, ['ls-tree', '-r', ref]);
  return output ? output.split(/\r?\n/).map((line) => {
    const separator = line.indexOf('\t');
    if (separator < 0) return null;
    const fields = line.slice(0, separator).split(/\s+/);
    if (fields.length < 3) return null;
    return {
      type: fields[1],
      objectId: fields[2],
      path: normalizePath(line.slice(separator + 1))
    };
  }).filter(Boolean) : [];
}

function readBlobBatch(repoRoot, objectIds) {
  const uniqueObjectIds = [...new Set(objectIds)];
  if (!uniqueObjectIds.length) return new Map();
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input: `${uniqueObjectIds.join('\n')}\n`,
    encoding: null,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git cat-file --batch failed (${result.status}): ${String(result.stderr || '').trim()}`);
  }
  const output = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
  const contents = new Map();
  let offset = 0;
  for (const objectId of uniqueObjectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error(`VERSION_AUDIT_OBJECT_READ_FAILED: ${objectId}`);
    const header = output.subarray(offset, headerEnd).toString('utf8').split(/\s+/);
    offset = headerEnd + 1;
    if (header[1] === 'missing') continue;
    const size = Number(header[2]);
    if (header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0 || offset + size > output.length) {
      throw new Error(`VERSION_AUDIT_OBJECT_READ_FAILED: ${objectId}`);
    }
    contents.set(objectId, output.subarray(offset, offset + size).toString('utf8'));
    offset += size;
    if (output[offset] === 0x0a) offset += 1;
  }
  return contents;
}

function createHistoricalObjectStore(repoRoot, refs) {
  const pathsByRef = new Map();
  const contentsByRefPath = new Map();
  for (const ref of refs) {
    const entries = treeEntriesAt(repoRoot, ref);
    const manifestEntries = entries.filter((entry) => entry.path.endsWith('/toolkit.project.json'));
    pathsByRef.set(ref, manifestEntries.map((entry) => entry.path));
    const wantedEntries = entries.filter((entry) => entry.type === 'blob' && (
      entry.path.endsWith('/toolkit.project.json') || BRIDGE_COUPLED_PATHS.includes(entry.path)
    ));
    const blobs = readBlobBatch(repoRoot, wantedEntries.map((entry) => entry.objectId));
    for (const entry of wantedEntries) {
      contentsByRefPath.set(`${ref}:${entry.path}`, blobs.get(entry.objectId) ?? null);
    }
  }
  return {
    pathsAt(ref) {
      return pathsByRef.get(ref) || [];
    },
    read(ref, relativePath) {
      const key = `${ref}:${normalizePath(relativePath)}`;
      if (contentsByRefPath.has(key)) return contentsByRefPath.get(key);
      return readBlobAt(repoRoot, ref, relativePath);
    }
  };
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

function projectManifestPathsAt(repoRoot, ref, objectStore = null) {
  if (objectStore) return objectStore.pathsAt(ref);
  const output = gitText(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', '_projects']);
  return output
    ? output.split(/\r?\n/).map(normalizePath).filter((value) => value.endsWith('/toolkit.project.json'))
    : [];
}

function extractProjectManifestsAt(repoRoot, ref, objectStore = null) {
  return projectManifestPathsAt(repoRoot, ref, objectStore).map((relativePath) => {
    const project = readJsonAt(repoRoot, ref, relativePath, objectStore);
    if (!project || typeof project !== 'object' || project.__parseError) {
      const detail = project && project.__parseError ? `: ${project.__parseError}` : '';
      throw new Error(`VERSION_AUDIT_MANIFEST_INVALID: ${ref}:${relativePath}${detail}`);
    }
    return { relativePath, project };
  });
}

function addUnique(values, value) {
  const normalized = normalizePath(value);
  if (normalized && !values.includes(normalized)) values.push(normalized);
}

function familyFromManifest(relativePath, project) {
  const modulePath = normalizePath(project.module_path || path.posix.dirname(relativePath));
  const mainPath = normalizePath(project.main_path || `${modulePath}/_main`);
  const outputs = Array.isArray(project.outputs) ? project.outputs : [];
  const triggerPaths = [];
  addUnique(triggerPaths, `${modulePath}/_main`);
  addUnique(triggerPaths, mainPath);
  addUnique(triggerPaths, `${modulePath}/curated_output_for_ai`);
  if (outputs.length > 0) {
    for (const output of outputs) {
      if (output && typeof output.output === 'string') addUnique(triggerPaths, output.output);
    }
  }
  const family = {
    id: String(project.id || modulePath),
    manifestPath: normalizePath(relativePath),
    modulePath,
    mainPath,
    version: typeof project.version === 'string' ? project.version : null,
    triggerPaths,
    coupledPaths: [normalizePath(relativePath)]
  };
  if (family.id === 'development.ai-coding-agent-rules') {
    family.triggerPaths.push(...AI_RULES_TRIGGER_PATHS);
  }
  if (family.id === 'development.toolkit-local-bridge') {
    family.triggerPaths.push(...BRIDGE_TRIGGER_PATHS);
    family.coupledPaths = [...BRIDGE_COUPLED_PATHS];
  }
  family.triggerPaths = [...new Set(family.triggerPaths.map(normalizePath))];
  family.coupledPaths = [...new Set(family.coupledPaths.map(normalizePath))];
  return family;
}

function buildFamilies(repoRoot, ref = 'HEAD', objectStore = null) {
  return extractProjectManifestsAt(repoRoot, ref, objectStore).map(({ relativePath, project }) =>
    familyFromManifest(relativePath, project));
}

function indexFamilies(families, side, ref) {
  const index = new Map();
  for (const family of families) {
    if (index.has(family.id)) {
      throw new Error(`VERSION_AUDIT_DUPLICATE_FAMILY_ID: ${side}:${ref}:${family.id}`);
    }
    index.set(family.id, family);
  }
  return index;
}

function pairFamilies(parentFamilies, commitFamilies, parent, commit) {
  const parentIndex = indexFamilies(parentFamilies, 'parent', parent);
  const commitIndex = indexFamilies(commitFamilies, 'commit', commit);
  const ids = [...new Set([...parentIndex.keys(), ...commitIndex.keys()])].sort();
  return ids.map((id) => {
    const parentFamily = parentIndex.get(id) || null;
    const commitFamily = commitIndex.get(id) || null;
    const manifestPaths = [];
    const triggerPaths = [];
    const coupledPaths = [];
    for (const family of [parentFamily, commitFamily]) {
      if (!family) continue;
      addUnique(manifestPaths, family.manifestPath);
      for (const triggerPath of family.triggerPaths) addUnique(triggerPaths, triggerPath);
      for (const coupledPath of family.coupledPaths) addUnique(coupledPaths, coupledPath);
    }
    return {
      id,
      parent: parentFamily,
      commit: commitFamily,
      parentManifestPath: parentFamily ? parentFamily.manifestPath : null,
      commitManifestPath: commitFamily ? commitFamily.manifestPath : null,
      manifestPath: commitFamily ? commitFamily.manifestPath : parentFamily.manifestPath,
      manifestPaths,
      triggerPaths,
      coupledPaths,
      requiredSource: commitFamily ? commitFamily.manifestPath : parentFamily.manifestPath
    };
  });
}

function versionAt(repoRoot, ref, relativePath, cache, objectStore = null) {
  const key = `${ref}:${normalizePath(relativePath)}`;
  if (cache && cache.has(key)) return cache.get(key);
  const value = extractVersion(relativePath, objectStore ? objectStore.read(ref, relativePath) : readBlobAt(repoRoot, ref, relativePath));
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

function violation(record, family, reason, triggerPaths, before, after, code = 'COMMIT_VERSION_MISMATCH') {
  return {
    code,
    commit: record.commit,
    trigger: triggerPaths,
    version_family: family.id,
    required_source: family.requiredSource || family.manifestPath,
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
  const commitInfo = commits.map((commit) => {
    const parents = commitParents(repoRoot, commit);
    return { commit, parents, parent: parents[0] || normalizedBase };
  });
  const refs = new Set([normalizedBase, normalizedHead]);
  for (const info of commitInfo) {
    refs.add(info.commit);
    refs.add(info.parent);
  }
  const objectStore = createHistoricalObjectStore(repoRoot, refs);
  const versionCache = new Map();
  const familyCache = new Map();
  const records = [];
  const familySummaries = new Map();
  let firstViolation = null;
  for (let index = 0; index < commits.length; index += 1) {
    const { commit, parents, parent } = commitInfo[index];
    const paths = changedPaths(repoRoot, parent, commit);
    const pathSet = new Set(paths);
    const familiesAt = (ref) => {
      if (!familyCache.has(ref)) familyCache.set(ref, buildFamilies(repoRoot, ref, objectStore));
      return familyCache.get(ref);
    };
    const parentFamilies = familiesAt(parent);
    const commitFamilies = familiesAt(commit);
    const families = pairFamilies(parentFamilies, commitFamilies, parent, commit);
    for (const family of families) {
      const summary = familySummaries.get(family.id) || {
        id: family.id,
        manifestPath: family.manifestPath,
        manifestPaths: [],
        triggerPaths: [],
        coupledPaths: []
      };
      summary.manifestPath = family.manifestPath;
      for (const manifestPath of family.manifestPaths) addUnique(summary.manifestPaths, manifestPath);
      for (const triggerPath of family.triggerPaths) addUnique(summary.triggerPaths, triggerPath);
      for (const coupledPath of family.coupledPaths) addUnique(summary.coupledPaths, coupledPath);
      familySummaries.set(family.id, summary);
    }
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
    let recordViolation = null;
    const noteViolation = (current) => {
      if (!recordViolation) recordViolation = current;
      if (!firstViolation) firstViolation = current;
    };
    for (const family of families) {
      const familyChangedPaths = paths.filter((candidate) =>
        family.manifestPaths.some((manifestPath) => candidate === manifestPath) ||
        family.triggerPaths.some((prefix) => pathMatches(candidate, prefix))
      );
      if (!familyChangedPaths.length) continue;

      const before = family.parent ? family.parent.version : null;
      const after = family.commit ? family.commit.version : null;
      const triggers = paths.filter((candidate) => family.triggerPaths.some((prefix) => pathMatches(candidate, prefix)));
      if (!family.commit) {
        const removalTriggers = [...new Set([
          ...triggers,
          ...family.manifestPaths.filter((manifestPath) => pathSet.has(manifestPath))
        ])];
        const familyRecord = {
          id: family.id,
          before,
          after,
          transition: 'removed',
          triggered_paths: triggers,
          manifest_paths: family.manifestPaths,
          trigger_union: family.triggerPaths
        };
        record.families.push(familyRecord);
        record.compliance = 'VERSION_FAMILY_REMOVAL_REQUIRES_POLICY';
        noteViolation(violation(
          record,
          family,
          'version family manifest disappeared without an explicit retirement policy',
          removalTriggers,
          before,
          after,
          'VERSION_FAMILY_REMOVAL_REQUIRES_POLICY'
        ));
        continue;
      }

      const transition = transitionClass(before, after);
      if (after !== null && !parseSemver(after)) {
        const current = violation(record, family, 'invalid SemVer in version source', [], before, after);
        noteViolation(current);
      }
      if (before !== null && after !== null && compareSemver(after, before) < 0) {
        const current = violation(record, family, 'version movement is non-monotonic', [], before, after);
        noteViolation(current);
      }
      const familyRecord = {
        id: family.id,
        before,
        after,
        transition,
        triggered_paths: triggers,
        manifest_paths: family.manifestPaths,
        trigger_union: family.triggerPaths
      };
      record.families.push(familyRecord);
      if (!triggers.length) {
        if (before !== after && record.compliance === 'NO_VERSION_TRIGGER') record.compliance = 'NO_VERSION_TRIGGER_VERSION_TRANSITION_OBSERVED';
        continue;
      }
      record.compliance = 'COMPLIANT_VERSION_TRANSITION';
      const versionSourceChanged = family.manifestPaths.some((manifestPath) => pathSet.has(manifestPath));
      if (!versionSourceChanged) {
        const current = violation(record, family, 'required same-commit version transition missing', triggers, before, after);
        noteViolation(current);
      } else if (after === null || (before !== null && after === before)) {
        const current = violation(record, family, 'required same-commit version transition missing', triggers, before, after);
        noteViolation(current);
      }
      for (const coupledPath of family.coupledPaths.filter((candidate) => !family.manifestPaths.includes(candidate))) {
        const coupledBefore = versionAt(repoRoot, parent, coupledPath, versionCache, objectStore);
        const coupledAfter = versionAt(repoRoot, commit, coupledPath, versionCache, objectStore);
        const changed = pathSet.has(normalizePath(coupledPath));
        if (coupledAfter !== after) {
          const current = violation(record, family, `coupled version surface ${coupledPath} is not aligned`, triggers, before, after);
          noteViolation(current);
        } else if (coupledBefore !== coupledAfter && !changed) {
          const current = violation(record, family, `coupled version surface ${coupledPath} moved outside the triggering commit`, triggers, before, after);
          noteViolation(current);
        } else if (coupledBefore === coupledAfter && changed && before !== after) {
          const current = violation(record, family, `coupled version surface ${coupledPath} did not transition`, triggers, before, after);
          noteViolation(current);
        } else if (coupledBefore === coupledAfter && before !== after) {
          const current = violation(record, family, `coupled version surface ${coupledPath} missing same-commit transition`, triggers, before, after);
          noteViolation(current);
        }
      }
    }
    if (recordViolation) record.violation = recordViolation;
    records.push(record);
    if (firstViolation) break;
  }
  const families = familySummaries.size
    ? [...familySummaries.values()].sort((left, right) => left.id.localeCompare(right.id))
    : buildFamilies(repoRoot, normalizedHead, objectStore).map((family) => ({
      id: family.id,
      manifestPath: family.manifestPath,
      manifestPaths: [family.manifestPath],
      triggerPaths: family.triggerPaths,
      coupledPaths: family.coupledPaths
    }));
  return { base: normalizedBase, head: normalizedHead, commits, records, firstViolation, families };
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
