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
const legacyProjectToken = '_' + 'projects';

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

const topologyScopePolicyPath = 'repo/contracts/topology-scope-policy.json';
const supportedTopologyScopes = new Set([
  'standalone-publisher',
  'historical-evidence',
  'non-operative-example'
]);
const activePolicyRootPaths = ['AGENTS.md', 'README.md'];
const activeSkillInstructionPattern = /^skills\/.+\/(?:SKILL|README|INSTALL)\.md$/i;
const topologyAtomIds = Object.freeze({
  projectsSourceOwnership: 'retired-projects-source-ownership',
  mainSourceOwnership: 'retired-main-source-ownership',
  curatedOutputSourceOwnership: 'retired-curated-output-for-ai',
  projectModuleSkillPair: 'retired-project-module-skill-pair',
  projectToSkill: 'retired-project-to-skill',
  projectManifestOutputPair: 'retired-project-manifest-output-pair',
  sourceToSurface: 'retired-source-to-surface',
  generatedPublication: 'retired-generated-publication',
  publisherInfrastructure: 'retired-publisher-infrastructure',
  syncToolkitProjectsCommand: 'retired-sync-toolkit-projects-command',
  packageSkillsCommand: 'retired-package-skills-command',
  packagePacksCommand: 'retired-package-packs-command'
});

const topologyAtomMessages = Object.freeze({
  [topologyAtomIds.projectsSourceOwnership]: 'references retired _projects path/source ownership',
  [topologyAtomIds.mainSourceOwnership]: 'references retired _main source ownership',
  [topologyAtomIds.curatedOutputSourceOwnership]: 'references retired curated-output publishing',
  [topologyAtomIds.projectModuleSkillPair]: 'claims retired project-module plus published/generated-skill topology',
  [topologyAtomIds.projectToSkill]: 'claims retired project-to-skill topology',
  [topologyAtomIds.projectManifestOutputPair]: 'claims retired project/source-manifest output pairing',
  [topologyAtomIds.sourceToSurface]: 'claims retired source-to-surface topology',
  [topologyAtomIds.generatedPublication]: 'claims retired generated/deterministic publication topology',
  [topologyAtomIds.publisherInfrastructure]: 'claims standalone publisher infrastructure for Toolkit topology',
  [topologyAtomIds.syncToolkitProjectsCommand]: 'references retired sync-toolkit-projects.cjs',
  [topologyAtomIds.packageSkillsCommand]: 'references retired package-skills.cjs',
  [topologyAtomIds.packagePacksCommand]: 'references retired package-packs.cjs'
});

const topologyAliases = Object.freeze({
  projectModule: ['project module', 'project modules'],
  publishedSkill: ['published skill', 'published skills'],
  generatedSkill: ['generated skill', 'generated skills'],
  projectToSkill: ['project to skill', 'project to skills'],
  projectManifest: ['project manifest', 'project manifests'],
  sourceManifest: ['source manifest', 'source manifests'],
  toolkitManifest: ['toolkit.project.json'],
  generated: ['generated', 'deterministic'],
  publication: ['copy', 'copies', 'publication', 'publishing', 'writeback'],
  output: ['skill', 'skills', 'generated skill', 'generated skills', 'generated skill output', 'generated skill outputs', 'surface', 'surfaces', 'output', 'outputs', 'pack', 'packs', 'publication', 'publishing', 'writeback'],
  sourceToSurface: ['source to surface', 'source to surfaces', 'source to generated surface', 'source to generated surfaces']
});

const negationWords = /\b(?:no|not|never|without|cannot|can't|must not|should not|does not|doesn't|do not|don't|did not|didn't|avoid|forbidden|removed|no longer)\b/gi;
const positiveBridgeWords = /\b(?:and|but|however|instead|also|now|still)\b/gi;
const positiveDirectiveWords = /\b(?:use|uses|used|run|runs|create|creates|created|maintain|maintains|maintained|publish|publishes|generate|generates|write|writes|written|sync|syncs|convert|converts|route|routes|routed|require|requires|pair|pairs|follow|follows)\b/i;

function normaliseTopologyText(value) {
  // Closed mapping: Unicode NFKC, lowercase, CRLF/LF, slash aliases, and hyphen/underscore/whitespace aliases.
  const source = String(value)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n');
  const lower = source.toLowerCase();
  const lexical = lower
    .replace(/[\\/_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { source, lower, lexical };
}

function normalizedMarkdownSource(value) {
  return String(value).normalize('NFKC').replace(/\r\n?/g, '\n');
}

function canonicalPolicyPath(value) {
  const candidate = String(value);
  if (!candidate || candidate !== candidate.trim()) return false;
  if (candidate.startsWith('.') || candidate.startsWith('/') || candidate.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(candidate) || candidate.includes(':')) return false;
  if (candidate.includes('\\') || candidate.includes('//')) return false;
  if (/[?*\[\]{}]/.test(candidate) || candidate.includes('...')) return false;
  if (candidate.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate)) return false;
  return path.posix.normalize(candidate) === candidate;
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
    errors.push(`${topologyScopePolicyPath} must contain an object`);
    return { policy: null, errors };
  }
  const policyKeys = Object.keys(policy).sort();
  if (JSON.stringify(policyKeys) !== JSON.stringify(['default_scope', 'entries', 'schema_version'])) {
    errors.push(`${topologyScopePolicyPath} must contain only schema_version, default_scope, and entries`);
  }
  if (policy.schema_version !== 1) errors.push(`${topologyScopePolicyPath} schema_version must be 1`);
  if (!Object.prototype.hasOwnProperty.call(policy, 'default_scope')) errors.push(`${topologyScopePolicyPath} default_scope is required`);
  else if (policy.default_scope !== 'active-toolkit') errors.push(`${topologyScopePolicyPath} default_scope must be active-toolkit`);
  if (!Array.isArray(policy.entries)) {
    errors.push(`${topologyScopePolicyPath} entries must be an array`);
    return { policy: null, errors };
  }

  const paths = new Set();
  policy.entries.forEach((entry, index) => {
    const label = `${topologyScopePolicyPath} entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['path', 'scope'])) errors.push(`${label} must contain only path and scope`);
    if (typeof entry.path !== 'string' || !canonicalPolicyPath(entry.path)) errors.push(`${label}.path must be an exact canonical repository-relative file path`);
    else {
      if (paths.has(entry.path)) errors.push(`${label}.path is duplicated: ${entry.path}`);
      paths.add(entry.path);
      if (!exists(entry.path) || !fs.statSync(path.join(root, entry.path)).isFile()) errors.push(`${label}.path target is missing: ${entry.path}`);
    }
    if (typeof entry.scope !== 'string' || !supportedTopologyScopes.has(entry.scope)) errors.push(`${label}.scope is unsupported`);
  });

  const scopeCounts = Object.fromEntries([...supportedTopologyScopes].map((scope) => [scope, 0]));
  for (const entry of policy.entries) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && supportedTopologyScopes.has(entry.scope)) {
      scopeCounts[entry.scope] += 1;
    }
  }
  for (const [scope, expected] of [['standalone-publisher', 2], ['historical-evidence', 2], ['non-operative-example', 5]]) {
    if (scopeCounts[scope] !== expected) errors.push(`${topologyScopePolicyPath} must contain exactly ${expected} ${scope} entries`);
  }

  return { policy: errors.length ? null : policy, errors };
}

function validateTopologyScopePolicy() {
  return topologyScopePolicyResult().errors;
}

function validTopologyScopePolicy() {
  const result = topologyScopePolicyResult();
  return result.policy;
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
  const skillInstructions = walk('skills').filter((rel) => activeSkillInstructionPattern.test(rel));
  return [...new Set([...activePolicyRootPaths, ...docs, ...skillInstructions])].filter(exists).sort();
}

function lineInfo(text) {
  const lines = [];
  let start = 0;
  const source = normalizedMarkdownSource(text);
  for (const line of source.split('\n')) {
    lines.push({ text: line, start, end: start + line.length });
    start += line.length + 1;
  }
  return { source, lines };
}

function indentationOf(value) {
  const match = String(value).match(/^\s*/);
  return (match ? match[0] : '').replace(/\t/g, '    ').length;
}

function listMarker(value) {
  const match = String(value).match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
  if (!match) return null;
  return { indent: indentationOf(match[1]), marker: match[2], text: match[3], contentStart: match[1].length + match[2].length + 1 };
}

function headingText(value) {
  const match = String(value).match(/^\s*(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function fenceStart(value) {
  const match = String(value).match(/^\s*(`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

function createEvidenceUnit({ kind, text, lineNumber, startOffset, endOffset, headingStack, parentListItems = [], leadIn = null }) {
  const leafText = String(text).trim();
  const headingTexts = headingStack.map((heading) => typeof heading === 'string' ? heading : heading.text);
  const ancestry = [
    ...headingTexts,
    ...(leadIn ? [leadIn] : []),
    ...parentListItems
  ].filter(Boolean);
  const effectiveText = [...ancestry, leafText].join('\n');
  return {
    kind,
    text: leafText,
    leafText,
    effectiveText,
    headingStack: headingTexts,
    parentListItems: [...parentListItems],
    leadIn,
    lineNumber,
    startOffset,
    endOffset,
    sourceSpan: { start: startOffset, end: endOffset }
  };
}

function structuralEvidenceUnits(text) {
  const { source, lines } = lineInfo(text);
  const units = [];
  const headingStack = [];
  const listStack = [];
  let pendingLeadIn = null;

  function clearList() {
    listStack.length = 0;
  }

  function addComment(index) {
    const start = lines[index].start;
    let endIndex = index;
    while (endIndex < lines.length && !lines[endIndex].text.includes('-->')) endIndex += 1;
    const end = lines[Math.min(endIndex, lines.length - 1)].end;
    const comment = lines.slice(index, Math.min(endIndex + 1, lines.length)).map((line) => line.text).join('\n');
    units.push(createEvidenceUnit({
      kind: 'html-comment',
      text: comment,
      lineNumber: index + 1,
      startOffset: start,
      endOffset: end,
      headingStack
    }));
    pendingLeadIn = null;
    clearList();
    return Math.min(endIndex + 1, lines.length);
  }

  function addFence(index, fence) {
    const start = lines[index].start;
    let endIndex = index + 1;
    while (endIndex < lines.length) {
      const close = lines[endIndex].text.match(new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`));
      if (close) {
        endIndex += 1;
        break;
      }
      endIndex += 1;
    }
    const end = lines[Math.min(endIndex - 1, lines.length - 1)].end;
    const code = lines.slice(index, endIndex).map((line) => line.text).join('\n');
    units.push(createEvidenceUnit({
      kind: 'code-fence',
      text: code,
      lineNumber: index + 1,
      startOffset: start,
      endOffset: end,
      headingStack
    }));
    pendingLeadIn = null;
    clearList();
    return endIndex;
  }

  for (let index = 0; index < lines.length;) {
    const raw = lines[index].text;
    const trimmed = raw.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('<!--')) {
      index = addComment(index);
      continue;
    }
    const fence = fenceStart(raw);
    if (fence) {
      index = addFence(index, fence);
      continue;
    }
    if (trimmed.startsWith('|')) {
      const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()).filter(Boolean);
      for (const cell of cells) {
        units.push(createEvidenceUnit({
          kind: 'table-cell',
          text: cell,
          lineNumber: index + 1,
          startOffset: lines[index].start,
          endOffset: lines[index].end,
          headingStack
        }));
      }
      pendingLeadIn = null;
      clearList();
      index += 1;
      continue;
    }
    const heading = headingText(raw);
    if (heading) {
      while (headingStack.length && headingStack[headingStack.length - 1].level >= heading.level) headingStack.pop();
      headingStack.push({ level: heading.level, text: heading.text });
      units.push(createEvidenceUnit({
        kind: 'heading',
        text: heading.text,
        lineNumber: index + 1,
        startOffset: lines[index].start,
        endOffset: lines[index].end,
        headingStack
      }));
      pendingLeadIn = null;
      clearList();
      index += 1;
      continue;
    }

    const marker = listMarker(raw);
    if (marker) {
      while (listStack.length && listStack[listStack.length - 1].indent >= marker.indent) listStack.pop();
      const parents = listStack.map((item) => item.text);
      const inheritedLeadIn = listStack.length ? listStack[0].leadIn : pendingLeadIn;
      const unit = createEvidenceUnit({
        kind: 'list-item',
        text: marker.text,
        lineNumber: index + 1,
        startOffset: lines[index].start,
        endOffset: lines[index].end,
        headingStack,
        parentListItems: parents,
        leadIn: inheritedLeadIn
      });
      units.push(unit);
      listStack.push({ indent: marker.indent, text: marker.text, unit, leadIn: inheritedLeadIn });
      index += 1;
      continue;
    }

    if (listStack.length && indentationOf(raw) > listStack[listStack.length - 1].indent) {
      const current = listStack[listStack.length - 1].unit;
      const continuation = raw.trim();
      current.text = `${current.text}\n${continuation}`;
      current.leafText = current.text;
      current.effectiveText = [
        ...current.headingStack,
        ...(current.leadIn ? [current.leadIn] : []),
        ...current.parentListItems,
        current.leafText
      ].filter(Boolean).join('\n');
      current.endOffset = lines[index].end;
      current.sourceSpan.end = lines[index].end;
      index += 1;
      continue;
    }

    clearList();
    const start = index;
    const paragraphLines = [];
    while (index < lines.length) {
      const candidate = lines[index].text;
      if (!candidate.trim() || headingText(candidate) || listMarker(candidate) || fenceStart(candidate) || candidate.trim().startsWith('<!--')) break;
      paragraphLines.push(candidate.trim());
      index += 1;
    }
    const paragraph = paragraphLines.join('\n');
    units.push(createEvidenceUnit({
      kind: 'paragraph',
      text: paragraph,
      lineNumber: start + 1,
      startOffset: lines[start].start,
      endOffset: lines[index - 1].end,
      headingStack
    }));
    pendingLeadIn = paragraph.trim().endsWith(':') ? paragraph : null;
  }
  return units;
}

function aliasPattern(alias) {
  const escaped = alias.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
}

function findAlias(lexical, aliases) {
  for (const alias of aliases) {
    const pattern = aliasPattern(alias);
    const match = pattern.exec(lexical);
    if (match) return { alias, index: match.index + match[0].search(/[a-z0-9]/i), length: alias.length };
  }
  return null;
}

function findAllAlias(lexical, aliases) {
  const matches = [];
  for (const alias of aliases) {
    const pattern = new RegExp(aliasPattern(alias).source, 'gi');
    for (const match of lexical.matchAll(pattern)) {
      matches.push({ alias, index: match.index + match[0].search(/[a-z0-9]/i), length: alias.length });
    }
  }
  return matches.sort((left, right) => left.index - right.index || left.alias.localeCompare(right.alias));
}

function findAllRegex(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].map((match) => ({
    value: match[0],
    index: match.index,
    length: match[0].length
  }));
}

function clauseRange(text, index) {
  const punctuation = /[!?;]|\.(?=\s|$)/g;
  const before = [...String(text).slice(0, index).matchAll(punctuation)].at(-1);
  const start = before ? before.index + 1 : 0;
  const after = String(text).slice(index).search(/[!?;]|\.(?=\s|$)/);
  const end = after === -1 ? String(text).length : index + after + 1;
  return { start, end, text: String(text).slice(start, end) };
}

function aliasInSameClause(lexical, anchor, aliases) {
  if (!anchor) return null;
  const range = clauseRange(lexical, anchor.index);
  const match = findAlias(range.text, aliases);
  return match ? { ...match, index: match.index + range.start } : null;
}

function findAliasPairSameClause(lexical, leftAliases, rightAliases) {
  const leftMatches = findAllAlias(lexical, leftAliases);
  const rightMatches = findAllAlias(lexical, rightAliases);
  for (const left of leftMatches) {
    const range = clauseRange(lexical, left.index);
    const right = rightMatches.find((candidate) => candidate.index >= range.start && candidate.index < range.end);
    if (right) return { left, right };
  }
  return null;
}

function exactPathAtoms(normalized) {
  return [
    [topologyAtomIds.projectsSourceOwnership, /(?:^|[^a-z0-9])_projects(?=$|[\\/\s])/gi],
    [topologyAtomIds.mainSourceOwnership, /(?:^|[^a-z0-9])_main(?=$|[\\/\s])/gi],
    [topologyAtomIds.curatedOutputSourceOwnership, /(?:^|[^a-z0-9])curated[ _\/\\-]+output[ _\/\\-]+for[ _\/\\-]+ai(?=$|[^a-z0-9])/gi]
  ].flatMap(([id, pattern]) => findAllRegex(normalized.source, pattern).map((match) => ({ id, concepts: [{ ...match, space: 'source' }] })));
}

function commandAtoms(normalized) {
  const commands = [
    [topologyAtomIds.syncToolkitProjectsCommand, /(?:\bnode\s+)?repo\s*[\\/]\s*scripts\s*[\\/]\s*sync-toolkit-projects\s*\.cjs\b/gi],
    [topologyAtomIds.packageSkillsCommand, /(?:\bnode\s+)?repo\s*[\\/]\s*scripts\s*[\\/]\s*package-skills\s*\.cjs\b/gi],
    [topologyAtomIds.packagePacksCommand, /(?:\bnode\s+)?repo\s*[\\/]\s*scripts\s*[\\/]\s*package-packs\s*\.cjs\b/gi]
  ];
  return commands.flatMap(([id, pattern]) => findAllRegex(normalized.source, pattern).map((match) => ({ id, concepts: [{ ...match, space: 'source' }] })));
}

function publisherTokenInOperationalContext(unit) {
  const direct = [unit.text, ...unit.parentListItems, unit.leadIn ? unit.leadIn : ''].join('\n');
  if (findAlias(normaliseTopologyText(direct).lexical, ['context preserving ai publisher'])) return true;
  return unit.headingStack.some((heading) => {
    const lexical = normaliseTopologyText(heading).lexical;
    return lexical !== 'context preserving ai publisher' && Boolean(findAlias(lexical, ['context preserving ai publisher']));
  });
}

function selfRepositoryIdentityMatches(unit) {
  const normalized = normaliseTopologyText(unit.effectiveText);
  const matches = [];
  const toolkitPattern = /(?<![a-z0-9._/\\-])toolkit(?:'s)?(?![a-z0-9_/\\-]|\.[a-z0-9])/gi;
  for (const match of findAllRegex(normalized.source, toolkitPattern)) matches.push(match);
  for (const pattern of [
    /\bai[ -]agent[ -]toolkit\b/gi,
    /\bweijunswj[\\/]ai[ -]agent[ -]toolkit\b/gi,
    /\b(?:this|our|current)\s+repo(?:sitory)?\b/gi
  ]) matches.push(...findAllRegex(normalized.source, pattern));
  return matches.sort((left, right) => left.index - right.index);
}

function topologyAtomsForUnit(unit) {
  const normalized = normaliseTopologyText(unit.effectiveText);
  const operationalText = [...unit.parentListItems, unit.leadIn ? unit.leadIn : '', unit.leafText].filter(Boolean).join('\n');
  const operational = normaliseTopologyText(operationalText);
  const atomSpecs = [...exactPathAtoms(operational), ...commandAtoms(operational)];
  const lexical = operational.lexical;
  const projectSkillPair = findAliasPairSameClause(lexical, topologyAliases.projectModule, [...topologyAliases.publishedSkill, ...topologyAliases.generatedSkill]);
  const projectToSkill = findAlias(lexical, topologyAliases.projectToSkill);
  const manifestAliases = [...topologyAliases.projectManifest, ...topologyAliases.sourceManifest, ...topologyAliases.toolkitManifest];
  const manifestOutputPair = findAliasPairSameClause(lexical, manifestAliases, topologyAliases.output);
  const sourceToSurface = findAlias(lexical, topologyAliases.sourceToSurface);
  const sourceSurfaceOperation = sourceToSurface ? (() => {
    const range = clauseRange(lexical, sourceToSurface.index);
    const operation = findAlias(range.text, [
      'workflow', 'workflows', 'publish', 'publishes', 'published', 'publishing',
      'generate', 'generates', 'generated', 'copy', 'copies', 'writeback', 'sync', 'syncs',
      'conversion', 'conversions', 'handoff'
    ]);
    return operation ? { ...operation, index: operation.index + range.start } : null;
  })() : null;
  const generatedSkillPublication = findAliasPairSameClause(lexical, topologyAliases.generatedSkill, topologyAliases.publication);
  const deterministicPublication = findAliasPairSameClause(lexical, ['deterministic'], topologyAliases.publication);

  function pair(id, concepts) {
    if (concepts.every(Boolean)) atomSpecs.push({ id, concepts: concepts.map((concept) => ({ value: concept.alias, index: concept.index, length: concept.length, space: 'lexical' })) });
  }

  if (projectSkillPair) pair(topologyAtomIds.projectModuleSkillPair, [projectSkillPair.left, projectSkillPair.right]);
  if (projectToSkill) atomSpecs.push({ id: topologyAtomIds.projectToSkill, concepts: [{ value: projectToSkill.alias, index: projectToSkill.index, length: projectToSkill.length, space: 'lexical' }] });
  const nativePluginManifest = /\bnative plugin source manifest(?:s)?\b/i.test(operational.source);
  if (manifestOutputPair && !nativePluginManifest) pair(topologyAtomIds.projectManifestOutputPair, [manifestOutputPair.left, manifestOutputPair.right]);
  if (sourceToSurface && sourceSurfaceOperation) {
    atomSpecs.push({ id: topologyAtomIds.sourceToSurface, concepts: [
      { value: sourceToSurface.alias, index: sourceToSurface.index, length: sourceToSurface.length, space: 'lexical' },
      { value: sourceSurfaceOperation.alias, index: sourceSurfaceOperation.index, length: sourceSurfaceOperation.length, space: 'lexical' }
    ] });
  }
  if (generatedSkillPublication || deterministicPublication) {
    const concepts = generatedSkillPublication
      ? [generatedSkillPublication.left, generatedSkillPublication.right]
      : [deterministicPublication.left, deterministicPublication.right];
    pair(topologyAtomIds.generatedPublication, concepts);
  }
  const publisherModulePair = findAliasPairSameClause(lexical, ['context preserving ai publisher'], topologyAliases.projectModule);
  if (publisherTokenInOperationalContext(unit) && publisherModulePair) {
    atomSpecs.push({ id: topologyAtomIds.publisherInfrastructure, concepts: [
      { value: publisherModulePair.left.alias, index: publisherModulePair.left.index, length: publisherModulePair.left.length, space: 'lexical' },
      { value: publisherModulePair.right.alias, index: publisherModulePair.right.index, length: publisherModulePair.right.length, space: 'lexical' }
    ] });
  }

  return atomSpecs.map((spec) => {
    const first = spec.concepts.slice().sort((left, right) => left.index - right.index)[0];
    const last = spec.concepts.slice().sort((left, right) => left.index + left.length - (right.index + right.length)).at(-1);
    return {
      id: spec.id,
      atomId: spec.id,
      family: spec.id,
      message: topologyAtomMessages[spec.id],
      match: spec.concepts.map((concept) => concept.value).join(' + '),
      matchSpan: { start: first.index, end: last.index + last.length },
      span: { ...unit.sourceSpan },
      sourceSpan: { ...unit.sourceSpan },
      normalizedEvidence: normalized.lexical,
      structural: {
        kind: unit.kind,
        lineNumber: unit.lineNumber,
        headingStack: [...unit.headingStack],
        parentListItems: [...unit.parentListItems],
        leadIn: unit.leadIn,
        leafText: unit.leafText,
        effectiveText: unit.effectiveText,
        operationalText,
        operationalSource: operational.source,
        operationalLexical: operational.lexical,
        normalizedSource: normalized.source,
        normalizedLexical: normalized.lexical,
        sourceSpan: { ...unit.sourceSpan }
      },
      concepts: spec.concepts.map((concept) => ({ ...concept }))
    };
  });
}

function detectRetiredTopologyAtoms(value) {
  const atoms = [];
  for (const unit of structuralEvidenceUnits(value)) atoms.push(...topologyAtomsForUnit(unit));
  return atoms.sort((left, right) => left.structural.sourceSpan.start - right.structural.sourceSpan.start
    || left.matchSpan.start - right.matchSpan.start
    || left.id.localeCompare(right.id));
}

function clauseForConcept(unit, concept) {
  const range = clauseRange(unit.effectiveText, concept.index);
  return { text: range.text, relativeIndex: concept.index - range.start };
}

function explicitlyNegatedConcept(unit, concept) {
  const source = concept.space === 'source' ? unit.operationalSource : unit.operationalLexical;
  const clause = clauseForConcept({ effectiveText: source }, concept);
  const before = clause.text.slice(0, clause.relativeIndex);
  const after = clause.text.slice(clause.relativeIndex + concept.length);
  const negativeBefore = [...before.matchAll(negationWords)].at(-1);
  const negativeAfter = /^(?:\s+(?:is|are|was|were|remains?)\s+)?\s+not\b/i.test(after)
    || /^(?:\s+(?:is|are|was|were|remains?)\s+not)\b/i.test(after);
  if (!negativeBefore && !negativeAfter) return false;
  const afterConcept = clause.text.slice(clause.relativeIndex + concept.length);
  const bridge = [...afterConcept.matchAll(positiveBridgeWords)].find((match) => true);
  if (bridge) {
    const tail = afterConcept.slice(bridge.index);
    if (positiveDirectiveWords.test(tail)) return false;
  }
  return true;
}

function explicitlyNegatedAtom(atom) {
  if (atom.id === topologyAtomIds.syncToolkitProjectsCommand
    || atom.id === topologyAtomIds.packageSkillsCommand
    || atom.id === topologyAtomIds.packagePacksCommand) return false;
  if (atom.id === topologyAtomIds.sourceToSurface) {
    const lexical = normaliseTopologyText(atom.structural.effectiveText).lexical;
    if (lexical.includes('generic source to surface publishing and anti drift product')
      && lexical.includes('not general coding work or toolkit topology')) return true;
  }
  return atom.concepts.length > 0 && atom.concepts.every((concept) => explicitlyNegatedConcept(atom.structural, concept));
}

function activeTopologyFinding(text, rel = '') {
  const scope = topologyScopeForPath(rel);
  for (const atom of detectRetiredTopologyAtoms(text)) {
    if (scope === 'historical-evidence' || scope === 'non-operative-example') continue;
    if (explicitlyNegatedAtom(atom)) continue;
    if (scope === 'standalone-publisher') {
      if (atom.id === topologyAtomIds.syncToolkitProjectsCommand
        || atom.id === topologyAtomIds.packageSkillsCommand
        || atom.id === topologyAtomIds.packagePacksCommand) {
        return { ...atom, scope, lineNumber: atom.structural.lineNumber, line: atom.structural.leafText };
      }
      if (selfRepositoryIdentityMatches({ effectiveText: atom.structural.effectiveText }).length > 0) {
        return {
          ...atom,
          scope,
          conflict: true,
          message: 'retired topology scope-conflict: standalone-publisher scope conflicts with current/self repository identity in the same structural evidence unit',
          lineNumber: atom.structural.lineNumber,
          line: atom.structural.leafText
        };
      }
      continue;
    }
    return { ...atom, scope: scope || 'invalid-policy', lineNumber: atom.structural.lineNumber, line: atom.structural.leafText };
  }
  return null;
}

function relPath(value) {
  return slash(path.relative(root, value));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
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

function pluginSnapshot(relPath, requiredFiles) {
  const manifest = readJson(relPath);
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
  const errors = [];
  for (const error of validateTopologyScopePolicy()) errors.push(error);
  const versionPath = 'repo/contracts/toolkit-local-bridge/version.json';
  if (!exists(versionPath)) {
    errors.push(`Missing Toolkit package version contract: ${versionPath}`);
  }

  let packageVersion = '';
  if (exists(versionPath)) {
    try {
      const version = readJson(versionPath);
      packageVersion = version.version || '';
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

  const sourcePlugins = [
    'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json',
    'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json'
  ];
  for (const rel of sourcePlugins) {
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
    if (rel.endsWith('.n6.json')) continue;
    if (legacyReferenceAllowed(rel)) continue;
    const text = readText(rel);
    if (text.includes(`${legacyProjectToken}/`) || text.includes('curated_output_for_ai/')) {
      errors.push(`${rel} references the retired project/publisher topology`);
    }
  }
  for (const rel of activePolicyFiles()) {
    const finding = activeTopologyFinding(readText(rel), rel);
    if (finding) {
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
      if (expected && JSON.stringify(expected) !== JSON.stringify(current)) errors.push('Canonical surface audit baseline is stale; review the exact movement and update it intentionally.');
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ snapshot: current, errors }, null, 2));
  } else {
    for (const error of errors) console.error(`FAIL: ${error}`);
    if (!errors.length) console.log(`Canonical surface audit ${checkMode ? 'check' : 'run'} passed for ${current.skill_count} skill(s).`);
  }
  if (errors.length) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  activePolicyFiles,
  activeTopologyFinding,
  detectRetiredTopologyAtoms,
  findAlias,
  findAliasPairSameClause,
  legacyReferenceAllowed,
  normaliseTopologyText,
  parseFrontMatter,
  policyScopeForPath: topologyScopeForPath,
  selfRepositoryIdentityMatches,
  skillDirs,
  structuralEvidenceUnits,
  snapshot,
  topologyAtomIds,
  validateTopologyScopePolicy,
  validate
};
