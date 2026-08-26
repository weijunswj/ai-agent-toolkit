#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function workspaceRootFromArgs(args = process.argv.slice(2)) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--workspace') return args[index + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

const root = path.resolve(workspaceRootFromArgs() || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const checkMode = process.argv.includes('--check');
const jsonMode = process.argv.includes('--json');
const writeBaseline = process.argv.includes('--write-baseline');
const baselinePath = path.join(root, 'repo', 'docs', 'published-surface-audit-baseline.json');
const topologyScopePolicyPath = 'repo/contracts/topology-scope-policy.json';
const legacyProjectToken = '_' + 'projects';
const supportedTopologyScopes = new Set(['standalone-publisher', 'historical-evidence', 'non-operative-example']);
const supportedMatcherKinds = new Set(['identifier-token', 'normalized-phrase', 'exact-filename']);
const supportedStandaloneDispositions = new Set(['generic-permitted', 'always-forbidden']);
const rootPolicyPaths = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'README.md'];
const skillInstructionPattern = /^skills\/.+\/(?:SKILL|README|INSTALL)\.md$/i;

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function relPath(value) {
  return slash(path.relative(root, value));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function readJson(rel) {
  return JSON.parse(readText(rel));
}

function walk(relDir, files = []) {
  const fullDir = path.join(root, relDir);
  if (!fs.existsSync(fullDir)) return files;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '_dist') continue;
    const full = path.join(fullDir, entry.name);
    if (entry.isDirectory()) walk(relPath(full), files);
    else if (entry.isFile()) files.push(relPath(full));
  }
  return files;
}

function canonicalPolicyPath(value) {
  const candidate = String(value);
  if (!candidate || candidate !== candidate.trim()) return false;
  if (candidate.startsWith('.') || candidate.startsWith('/') || candidate.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(candidate) || candidate.includes(':')) return false;
  if (candidate.includes('\\') || candidate.includes('//')) return false;
  if (/[?*\[\]{}]/.test(candidate) || candidate.includes('...')) return false;
  if (candidate.endsWith('/')) return false;
  if (candidate.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate)) return false;
  return path.posix.normalize(candidate) === candidate;
}

function normalizeSource(value) {
  return String(value).normalize('NFKC').replace(/\r\n?/g, '\n');
}

function normalizedAlias(value, matcherKind) {
  const source = normalizeSource(value).toLowerCase();
  if (matcherKind === 'normalized-phrase') return source.replace(/[\s_-]+/g, ' ').trim();
  return source;
}

function validateDefinitions(errors, definitions, identity, ids, aliases) {
  const label = identity ? 'standalone_identity_definitions' : 'primitive_definitions';
  if (!Array.isArray(definitions)) {
    errors.push(`${topologyScopePolicyPath} ${label} must be an array`);
    return;
  }
  const expectedCount = identity ? 3 : 21;
  if (definitions.length !== expectedCount) {
    errors.push(`${topologyScopePolicyPath} ${label} must contain exactly ${expectedCount} definitions`);
  }
  definitions.forEach((definition, index) => {
    const itemLabel = `${topologyScopePolicyPath} ${label}[${index}]`;
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      errors.push(`${itemLabel} must be an object`);
      return;
    }
    const expectedKeys = identity
      ? ['aliases', 'id', 'matcher_kind']
      : ['aliases', 'id', 'matcher_kind', 'standalone_disposition'];
    const keys = Object.keys(definition).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      errors.push(`${itemLabel} must contain only ${expectedKeys.join(', ')}`);
    }
    if (typeof definition.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id)) {
      errors.push(`${itemLabel}.id must be a stable lowercase hyphenated ID`);
    } else if (ids.has(definition.id)) {
      errors.push(`${itemLabel}.id is duplicated: ${definition.id}`);
    } else {
      ids.add(definition.id);
    }
    if (!supportedMatcherKinds.has(definition.matcher_kind)) errors.push(`${itemLabel}.matcher_kind is unsupported`);
    if (!Array.isArray(definition.aliases) || definition.aliases.length === 0) {
      errors.push(`${itemLabel}.aliases must be a non-empty array`);
    } else {
      for (const [aliasIndex, alias] of definition.aliases.entries()) {
        if (typeof alias !== 'string' || !alias.trim() || alias !== alias.trim()) {
          errors.push(`${itemLabel}.aliases[${aliasIndex}] must be a non-empty trimmed string`);
          continue;
        }
        if (supportedMatcherKinds.has(definition.matcher_kind)) {
          const normalized = normalizedAlias(alias, definition.matcher_kind);
          if (!normalized) {
            errors.push(`${itemLabel}.aliases[${aliasIndex}] must contain matchable characters`);
          } else if (aliases.has(normalized)) {
            errors.push(`${itemLabel}.aliases[${aliasIndex}] duplicates normalized alias from ${aliases.get(normalized)}: ${alias}`);
          } else {
            aliases.set(normalized, `${label}.${definition.id || index}`);
          }
        }
      }
    }
    if (!identity && !supportedStandaloneDispositions.has(definition.standalone_disposition)) {
      errors.push(`${itemLabel}.standalone_disposition is unsupported`);
    }
  });
}

function topologyScopePolicyResult() {
  const errors = [];
  if (!exists(topologyScopePolicyPath)) {
    return { policy: null, errors: [`Missing topology scope policy: ${topologyScopePolicyPath}`] };
  }
  let policy;
  try {
    policy = readJson(topologyScopePolicyPath);
  } catch (error) {
    return { policy: null, errors: [`${topologyScopePolicyPath} is not valid JSON: ${error.message}`] };
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return { policy: null, errors: [`${topologyScopePolicyPath} must contain an object`] };
  }
  const policyKeys = Object.keys(policy).sort();
  const expectedPolicyKeys = [
    'default_scope',
    'entries',
    'normalization',
    'primitive_definitions',
    'schema_version',
    'standalone_identity_definitions'
  ].sort();
  if (JSON.stringify(policyKeys) !== JSON.stringify(expectedPolicyKeys)) {
    errors.push(`${topologyScopePolicyPath} has unsupported or missing top-level keys`);
  }
  if (policy.schema_version !== 2) errors.push(`${topologyScopePolicyPath} schema_version must be 2`);
  if (policy.default_scope !== 'active-toolkit') errors.push(`${topologyScopePolicyPath} default_scope must be active-toolkit`);
  if (policy.normalization !== 'nfkc-lower-separator-v1') errors.push(`${topologyScopePolicyPath} normalization is unsupported`);
  const definitionIds = new Set();
  const definitionAliases = new Map();
  validateDefinitions(errors, policy.primitive_definitions, false, definitionIds, definitionAliases);
  validateDefinitions(errors, policy.standalone_identity_definitions, true, definitionIds, definitionAliases);
  if (!Array.isArray(policy.entries)) {
    errors.push(`${topologyScopePolicyPath} entries must be an array`);
    return { policy: null, errors };
  }
  const paths = new Set();
  const scopeCounts = Object.fromEntries([...supportedTopologyScopes].map((scope) => [scope, 0]));
  policy.entries.forEach((entry, index) => {
    const label = `${topologyScopePolicyPath} entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['path', 'scope'])) {
      errors.push(`${label} must contain only path and scope`);
    }
    if (typeof entry.path !== 'string' || !canonicalPolicyPath(entry.path)) {
      errors.push(`${label}.path must be an exact canonical repository-relative file path`);
    } else {
      if (paths.has(entry.path)) errors.push(`${label}.path is duplicated: ${entry.path}`);
      paths.add(entry.path);
      if (!exists(entry.path) || !fs.statSync(path.join(root, entry.path)).isFile()) {
        errors.push(`${label}.path target is missing: ${entry.path}`);
      }
    }
    if (typeof entry.scope !== 'string' || !supportedTopologyScopes.has(entry.scope)) {
      errors.push(`${label}.scope is unsupported`);
    } else {
      scopeCounts[entry.scope] += 1;
    }
  });
  for (const [scope, expected] of [['standalone-publisher', 3], ['historical-evidence', 2], ['non-operative-example', 5]]) {
    if (scopeCounts[scope] !== expected) errors.push(`${topologyScopePolicyPath} must contain exactly ${expected} ${scope} entries`);
  }
  return { policy: errors.length ? null : policy, errors };
}

function validateTopologyScopePolicy() {
  return topologyScopePolicyResult().errors;
}

function validTopologyScopePolicy() {
  return topologyScopePolicyResult().policy;
}

function topologyScopeForPath(rel, policy = validTopologyScopePolicy()) {
  if (!policy) return null;
  const candidate = slash(String(rel));
  const entry = policy.entries.find((item) => item.path === candidate);
  return entry ? entry.scope : policy.default_scope;
}

function legacyReferenceAllowed(rel) {
  return topologyScopeForPath(rel) === 'non-operative-example';
}

function activePolicyFiles() {
  const docs = walk('repo/docs').filter((rel) => rel.endsWith('.md'));
  const contracts = walk('repo/contracts').filter((rel) => rel.endsWith('.md'));
  const skills = walk('skills').filter((rel) => skillInstructionPattern.test(rel));
  return [...new Set([...rootPolicyPaths, ...docs, ...contracts, ...skills])].filter(exists).sort();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) if (source[offset] === '\n') line += 1;
  return line;
}

function filenamePathSpans(source) {
  const spans = [];
  const tokenPattern = /[^\s`"'<>()[\]{}]+/gu;
  for (const match of source.matchAll(tokenPattern)) {
    let token = match[0];
    let trimLeft = 0;
    while (/^[,;:!?]/.test(token)) {
      token = token.slice(1);
      trimLeft += 1;
    }
    token = token.replace(/[,;:!?]+$/g, '');
    if (!token) continue;
    const pathLike = /[\\/]/.test(token)
      || /\.(?:md|json|cjs|mjs|js|ts|tsx|yml|yaml|txt|ps1|cmd|sh|py)(?:[#?].*)?$/i.test(token)
      || /^[a-z][a-z0-9+.-]*:\/\//i.test(token);
    if (pathLike) spans.push({ start: match.index + trimLeft, end: match.index + trimLeft + token.length });
  }
  return spans;
}

function overlaps(span, spans) {
  return spans.some((candidate) => span.start < candidate.end && span.end > candidate.start);
}

function maskSpans(source, spans) {
  const chars = source.split('');
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) if (chars[index] !== '\n') chars[index] = ' ';
  }
  return chars.join('');
}

function matcherPattern(alias, matcherKind) {
  if (matcherKind === 'normalized-phrase') {
    const parts = normalizedAlias(alias, matcherKind).split(' ').map(escapeRegex);
    return new RegExp(`(?<![\\p{L}\\p{N}_])${parts.join('[\\s_-]+')}(?![\\p{L}\\p{N}_])`, 'giu');
  }
  if (matcherKind === 'identifier-token') {
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(normalizeSource(alias))}(?![\\p{L}\\p{N}_])`, 'giu');
  }
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegex(normalizeSource(alias))}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, 'giu');
}

function deduplicateDefinitionMatches(matches) {
  const ordered = matches.sort((left, right) => left.sourceSpan.start - right.sourceSpan.start
    || (right.sourceSpan.end - right.sourceSpan.start) - (left.sourceSpan.end - left.sourceSpan.start)
    || left.match.localeCompare(right.match));
  const kept = [];
  for (const match of ordered) {
    if (kept.some((candidate) => overlaps(match.sourceSpan, [candidate.sourceSpan]))) continue;
    kept.push(match);
  }
  return kept.sort((left, right) => left.sourceSpan.start - right.sourceSpan.start);
}

function matchesForDefinition(source, definition, options = {}) {
  const normalized = normalizeSource(source);
  const pathSpans = filenamePathSpans(normalized);
  const searchable = definition.matcher_kind === 'normalized-phrase'
    ? maskSpans(normalized, pathSpans)
    : normalized;
  const matches = [];
  for (const alias of definition.aliases) {
    const pattern = matcherPattern(alias, definition.matcher_kind);
    for (const match of searchable.matchAll(pattern)) {
      const span = { start: match.index, end: match.index + match[0].length };
      if (options.excludePathTokens && overlaps(span, pathSpans)) continue;
      matches.push({
        id: definition.id,
        atomId: definition.id,
        family: definition.id,
        matcherKind: definition.matcher_kind,
        standaloneDisposition: definition.standalone_disposition,
        message: `references retired topology primitive ${definition.id}`,
        match: normalized.slice(span.start, span.end),
        lineNumber: lineNumberAt(normalized, span.start),
        line: normalized.split('\n')[lineNumberAt(normalized, span.start) - 1] || '',
        span,
        sourceSpan: span
      });
    }
  }
  return deduplicateDefinitionMatches(matches);
}

function detectRetiredTopologyAtoms(value, policy = validTopologyScopePolicy()) {
  if (!policy) return [];
  const source = normalizeSource(value);
  const atoms = policy.primitive_definitions.flatMap((definition) => matchesForDefinition(source, definition));
  return atoms.sort((left, right) => left.sourceSpan.start - right.sourceSpan.start
    || left.id.localeCompare(right.id));
}

function standaloneIdentityMatches(value, policy = validTopologyScopePolicy()) {
  if (!policy) return [];
  const source = normalizeSource(value);
  const matches = policy.standalone_identity_definitions.flatMap((definition) => matchesForDefinition(source, definition, {
    excludePathTokens: definition.matcher_kind === 'identifier-token'
  }));
  return matches.sort((left, right) => left.sourceSpan.start - right.sourceSpan.start
    || left.id.localeCompare(right.id));
}

function activeTopologyFindings(text, rel = '') {
  const policy = validTopologyScopePolicy();
  if (!policy) return [];
  const scope = topologyScopeForPath(rel, policy);
  const atoms = detectRetiredTopologyAtoms(text, policy);
  if (scope === 'historical-evidence' || scope === 'non-operative-example') return [];
  if (scope === 'standalone-publisher') {
    const identities = standaloneIdentityMatches(text, policy);
    return atoms.filter((atom) => atom.standaloneDisposition === 'always-forbidden' || identities.length > 0)
      .map((atom) => ({
        ...atom,
        scope,
        conflict: atom.standaloneDisposition !== 'always-forbidden',
        identities,
        message: atom.standaloneDisposition === 'always-forbidden'
          ? `references always-forbidden retired topology primitive ${atom.id}`
          : `retired topology scope-conflict: standalone-publisher document contains current/self repository identity and generic primitive ${atom.id}`
      }));
  }
  return atoms.map((atom) => ({
    ...atom,
    scope: scope || 'invalid-policy',
    message: `references forbidden active Toolkit topology primitive ${atom.id}`
  }));
}

function activeTopologyFinding(text, rel = '') {
  return activeTopologyFindings(text, rel)[0] || null;
}

function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const result = {};
  for (const line of text.slice(4, end).trim().split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function skillDirs() {
  const skillsRoot = path.join(root, 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `skills/${entry.name}`)
    .sort();
}

function pluginSnapshot(relPathValue, requiredFiles) {
  const manifest = readJson(relPathValue);
  return {
    name: manifest.name || '',
    version: manifest.version || '',
    required_files: requiredFiles.map((rel) => ({ path: rel, present: exists(rel) }))
  };
}

function snapshot() {
  const skills = skillDirs();
  const packManifests = walk('skills').filter((rel) => /\/packs\/[^/]+\/pack\.json$/.test(rel));
  return {
    schema_version: 2,
    skills,
    skill_count: skills.length,
    pack_manifests: packManifests,
    project_tree_present: exists(`${legacyProjectToken}/`),
    native_plugins: {
      codex: pluginSnapshot('.codex-plugin/plugin.json', [
        '.codex-plugin/plugin.json',
        '.codex-plugin/hooks/hooks.json',
        '.codex-plugin/assets/composer-icon.png',
        '.codex-plugin/assets/logo.png'
      ]),
      claude: pluginSnapshot('.claude-plugin/plugin.json', [
        '.claude-plugin/plugin.json',
        '.claude-plugin/hooks/hooks.json',
        '.claude-plugin/marketplace.json'
      ])
    }
  };
}

function validate(snapshotValue) {
  const errors = [...validateTopologyScopePolicy()];
  const versionPath = 'repo/contracts/toolkit-local-bridge/version.json';
  if (!exists(versionPath)) errors.push(`Missing Toolkit package version contract: ${versionPath}`);
  let packageVersion = '';
  if (exists(versionPath)) {
    try {
      packageVersion = readJson(versionPath).version || '';
      if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) errors.push(`${versionPath} must declare a semver version`);
    } catch (error) {
      errors.push(`${versionPath} is not valid JSON: ${error.message}`);
    }
  }
  if (snapshotValue.project_tree_present) errors.push(`Legacy ${legacyProjectToken}/ tree is present`);
  if (snapshotValue.pack_manifests.length) errors.push(`Pack manifests are not supported: ${snapshotValue.pack_manifests.join(', ')}`);
  if (snapshotValue.skills.includes('skills/knowledge-index-updater')) errors.push('Retired skill surface is present: skills/knowledge-index-updater');
  for (const skill of snapshotValue.skills) {
    const skillPath = `${skill}/SKILL.md`;
    if (!exists(skillPath)) {
      errors.push(`${skill} is missing SKILL.md`);
      continue;
    }
    if (!exists(`${skill}/README.md`) && !exists(`${skill}/INSTALL.md`)) errors.push(`${skill} is missing README.md or INSTALL.md`);
    const frontMatter = parseFrontMatter(readText(skillPath));
    if (!frontMatter?.name || !frontMatter.description) errors.push(`${skillPath} is missing frontmatter name or description`);
    if (frontMatter?.name !== path.posix.basename(skill)) errors.push(`${skillPath} name does not match its folder`);
  }
  for (const rel of [
    'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json',
    'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json'
  ]) {
    if (!exists(rel)) errors.push(`Missing native plugin source manifest: ${rel}`);
    else {
      const source = readJson(rel);
      if (source.name !== 'ai-agent-toolkit') errors.push(`${rel} has the wrong plugin name`);
      if (source.version !== packageVersion) errors.push(`${rel} version ${source.version || '<missing>'} does not match ${packageVersion}`);
    }
  }
  for (const [name, plugin] of Object.entries(snapshotValue.native_plugins)) {
    if (plugin.name !== 'ai-agent-toolkit') errors.push(`${name} native plugin manifest has the wrong name`);
    if (plugin.version !== packageVersion) errors.push(`${name} native plugin version ${plugin.version || '<missing>'} does not match ${packageVersion}`);
    for (const file of plugin.required_files) if (!file.present) errors.push(`Missing native plugin file: ${file.path}`);
  }
  for (const rel of [...walk('skills'), ...walk('repo/contracts')]) {
    if (!/\.(md|json|ya?ml|txt)$/i.test(rel)) continue;
    if (rel === topologyScopePolicyPath || rel.endsWith('.n6.json') || legacyReferenceAllowed(rel)) continue;
    const text = readText(rel);
    if (text.includes(`${legacyProjectToken}/`) || text.includes('curated_output_for_ai/')) {
      errors.push(`${rel} references the retired project/publisher topology`);
    }
  }
  for (const rel of activePolicyFiles()) {
    for (const finding of activeTopologyFindings(readText(rel), rel)) {
      errors.push(`${rel}:${finding.lineNumber} ${finding.message}: ${finding.line}`);
    }
  }
  return errors;
}

function main() {
  let current;
  try {
    current = snapshot();
  } catch (error) {
    console.error(`FAIL: Cannot inspect canonical surfaces: ${error.message}`);
    process.exit(1);
  }
  const errors = validate(current);
  if (writeBaseline) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  }
  if (checkMode && !writeBaseline) {
    if (!fs.existsSync(baselinePath)) errors.push(`Missing audit baseline: ${slash(path.relative(root, baselinePath))}`);
    else {
      let expected;
      try {
        expected = JSON.parse(fs.readFileSync(baselinePath, 'utf8').replace(/^\uFEFF/, ''));
      } catch (error) {
        errors.push(`Invalid audit baseline: ${error.message}`);
      }
      if (expected && JSON.stringify(expected) !== JSON.stringify(current)) {
        errors.push('Canonical surface audit baseline is stale; review the exact movement and update it intentionally.');
      }
    }
  }
  if (jsonMode) console.log(JSON.stringify({ snapshot: current, errors }, null, 2));
  else {
    for (const error of errors) console.error(`FAIL: ${error}`);
    if (!errors.length) console.log(`Canonical surface audit ${checkMode ? 'check' : 'run'} passed for ${current.skill_count} skill(s).`);
  }
  if (errors.length) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  activePolicyFiles,
  activeTopologyFinding,
  activeTopologyFindings,
  detectRetiredTopologyAtoms,
  legacyReferenceAllowed,
  normaliseTopologyText: normalizeSource,
  parseFrontMatter,
  policyScopeForPath: topologyScopeForPath,
  skillDirs,
  snapshot,
  standaloneIdentityMatches,
  validateTopologyScopePolicy,
  validate
};
