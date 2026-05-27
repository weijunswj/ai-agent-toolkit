#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const baselineRelPath = 'repo/docs/published-surface-audit-baseline.json';
const publishedRoots = ['skills', 'mcp'];
const projectRoot = '_projects';
const textExtensions = new Set(['.md', '.json', '.ps1', '.cmd', '.cjs', '.js', '.txt', '.yaml', '.yml']);
const suspiciousPathWords = /\b(prompt|template|reference|guide|setup|policy|agent|rules|readme)\b/i;
const sourceSectionMarkers = [
  'Copy this prompt',
  'Manual step needed',
  'Troubleshooting',
  'Do not commit',
  'Do not push',
  'Do not deploy'
];
const boundaryHeadingMarkers = [
  ...sourceSectionMarkers,
  'Install',
  'Setup',
  'Upgrade',
  'Import',
  'Export'
];
const curatedRuntimePathWords = /\b(guides?|setup|workflows?|prompts?|templates?|references?|playbooks?)\b/i;
const numberedStepPattern = /^\s*\d+\.\s+/gm;
const codeFencePattern = /^```/gm;
const markdownHeadingPattern = /^#{1,6}\s+/gm;
const runtimeNumberedStepPattern = /^\s*\d+\.\s+.*\b(?:install|start|run|execute|import|export|deploy|publish|activate|deactivate|archive|delete|server|package|npm|npx|node|docker|powershell|cmd|bash|workflow|dependencies)\b/gim;
const commandSnippetPattern = /^```(?:[a-z0-9_-]+)?\n[\s\S]*?\b(?:npm|pnpm|yarn|node|npx|docker|docker-compose|powershell|cmd|bash|sh|gh|git|n8n)\b[\s\S]*?^```/gim;
const runtimeServerPackagePattern = /\b(?:local server|mcp server|server package|start(?:ing)? (?:the )?[^.\n]{0,60}server|install(?:ing)? (?:the )?[^.\n]{0,60}(?:package|dependency|dependencies)|runtime tools?)\b/i;
const runtimeSetupMarkers = new Set(['Setup', 'Install', 'Upgrade']);
const safetyOnlyMarkers = new Set(['Do not commit', 'Do not push', 'Do not deploy']);

function slash(value) {
  return value.split(path.sep).join('/');
}

function normalizeRel(value) {
  return slash(path.normalize(value)).replace(/^\.\//, '');
}

function workspaceRootFromArgs(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--workspace') return args[i + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    argv,
    check: argv.includes('--check'),
    json: argv.includes('--json'),
    writeBaseline: argv.includes('--write-baseline'),
    workspace: workspaceRootFromArgs(argv)
  };
}

function resolveRel(root, relPath) {
  return path.join(root, relPath);
}

function readText(root, relPath) {
  return fs.readFileSync(resolveRel(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(root, relPath) {
  return JSON.parse(readText(root, relPath));
}

function walk(root, relDir, files = []) {
  const fullDir = resolveRel(root, relDir);
  if (!fs.existsSync(fullDir)) return files;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '_dist') continue;
    const fullPath = path.join(fullDir, entry.name);
    const relPath = slash(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      walk(root, relPath, files);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

function listFiles(root, relDir) {
  return walk(root, relDir).sort();
}

function gitTrackedFiles(root, prefixes) {
  const result = spawnSync('git', ['ls-files', '--', ...prefixes], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizeRel)
    .sort();
}

function trackedOrFilesystemFiles(root, prefixes) {
  const tracked = gitTrackedFiles(root, prefixes);
  if (tracked) {
    return {
      source: 'git',
      files: tracked.filter((relPath) => {
        const fullPath = resolveRel(root, relPath);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
      })
    };
  }
  const files = prefixes.flatMap((prefix) => listFiles(root, prefix)).sort();
  return { source: 'filesystem', files };
}

function discoverProjectManifests(root) {
  return listFiles(root, projectRoot)
    .filter((relPath) => relPath.endsWith('/toolkit.project.json'))
    .map((relPath) => readJson(root, relPath))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function sourceRel(project, relPath) {
  if (!relPath) return '';
  const normalized = normalizeRel(relPath);
  if (normalized.startsWith('_projects/') || normalized.startsWith('skills/') || normalized.startsWith('mcp/')) {
    return normalized;
  }
  return normalizeRel(path.join(project.module_path, normalized));
}

function outputEntry(project, output, relPath, extras = {}) {
  return {
    path: normalizeRel(relPath),
    projectId: project.id,
    projectPath: project.module_path,
    kind: output.kind,
    source: extras.source || '',
    sources: extras.sources || [],
    recipeOutput: output.output,
    notes: output.notes || '',
    fidelity: output.fidelity || '',
    sharedSurface: output.shared_surface === true,
    surfaceOwnerProject: output.surface_owner_project || '',
    sharedSurfaceReason: output.shared_surface_reason || ''
  };
}

function expandProjectOutput(root, project, output) {
  const outputPath = normalizeRel(output.output);
  if (output.kind === 'linked') {
    const full = resolveRel(root, outputPath);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      return listFiles(root, outputPath).map((relPath) => outputEntry(project, output, relPath));
    }
    return [outputEntry(project, output, outputPath)];
  }

  const sources = Array.isArray(output.sources)
    ? output.sources.map((item) => sourceRel(project, item))
    : [sourceRel(project, output.source)].filter(Boolean);

  if (output.kind === 'copy' && sources.length === 1) {
    const sourcePath = resolveRel(root, sources[0]);
    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
      return listFiles(root, sources[0]).map((sourceFile) => {
        const child = slash(path.relative(sourcePath, resolveRel(root, sourceFile)));
        return outputEntry(project, output, path.join(outputPath, child), { source: sourceFile, sources: [sourceFile] });
      });
    }
  }

  return [outputEntry(project, output, outputPath, { source: sources[0] || '', sources })];
}

function declaredOutputs(root, projects) {
  const entries = [];
  for (const project of projects) {
    for (const output of project.outputs || []) {
      entries.push(...expandProjectOutput(root, project, output));
    }
  }
  if (fs.existsSync(resolveRel(root, 'mcp/registry/projects.registry.json'))) {
    entries.push({
      path: 'mcp/registry/projects.registry.json',
      projectId: 'repo.project-registry',
      projectPath: projectRoot,
      kind: 'generated_registry',
      source: '_projects/**/toolkit.project.json',
      sources: projects.map((project) => `${project.module_path}/toolkit.project.json`),
      recipeOutput: 'mcp/registry/projects.registry.json'
    });
  }
  const byPath = new Map();
  for (const entry of entries) {
    const list = byPath.get(entry.path) || [];
    list.push(entry);
    byPath.set(entry.path, list);
  }
  return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)), byPath };
}

function discoverPackManifests(root) {
  return listFiles(root, 'skills')
    .filter((relPath) => /\/packs\/[^/]+\/pack\.json$/.test(relPath))
    .map((relPath) => {
      const pack = readJson(root, relPath);
      return {
        path: relPath,
        id: pack.id || relPath,
        installs: Array.isArray(pack.installs) ? pack.installs.map(normalizeRel) : []
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function expandInstallPath(root, installPath, publishedFiles) {
  const normalized = normalizeRel(installPath).replace(/\/\*\*$/, '/');
  const full = resolveRel(root, normalized);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return [normalized];
  const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
  return publishedFiles.filter((relPath) => relPath.startsWith(prefix));
}

function packInstalledFiles(root, publishedFiles) {
  const manifests = discoverPackManifests(root);
  const byPath = new Map();
  for (const pack of manifests) {
    for (const installPath of pack.installs) {
      for (const relPath of expandInstallPath(root, installPath, publishedFiles)) {
        const packs = byPath.get(relPath) || [];
        packs.push({ id: pack.id, path: pack.path, install: installPath });
        byPath.set(relPath, packs);
      }
    }
  }
  return { manifests, byPath };
}

function manualClassification(relPath) {
  if (relPath === 'mcp/README.md') return 'manual_repo_surface';
  if (relPath.startsWith('mcp/registry/')) return 'manual_registry_surface';
  if (relPath.startsWith('mcp/')) return 'manual_mcp_surface';
  if (relPath.startsWith('skills/')) return 'manual_skill_surface';
  return 'unknown_manual_surface';
}

function classifyPublishedFile(relPath, declared, packInstalled) {
  const declaredEntries = declared.get(relPath) || [];
  const installed = packInstalled.has(relPath);
  if (declaredEntries.length && installed) return 'pack_installed_declared';
  if (declaredEntries.some((entry) => entry.kind === 'linked')) return 'declared_linked';
  if (declaredEntries.length) return 'declared_generated';
  if (installed) return 'pack_installed_undeclared';
  return manualClassification(relPath);
}

function skillRoot(relPath) {
  const parts = relPath.split('/');
  if (parts[0] !== 'skills' || !parts[1]) return '';
  return `${parts[0]}/${parts[1]}`;
}

function projectOwners(projects) {
  const bySkillRoot = new Map();
  const byMcpPath = new Map();
  for (const project of projects) {
    const skillPath = project.surface?.skill?.path ? normalizeRel(project.surface.skill.path) : '';
    if (skillPath) bySkillRoot.set(skillPath, project);
    for (const output of project.outputs || []) {
      if (output.shared_surface === true) continue;
      const root = skillRoot(normalizeRel(output.output || ''));
      if (root && !bySkillRoot.has(root)) bySkillRoot.set(root, project);
    }
    const mcpPath = project.surface?.mcp?.path ? normalizeRel(project.surface.mcp.path) : '';
    if (mcpPath) byMcpPath.set(mcpPath, project);
  }
  return { bySkillRoot, byMcpPath };
}

function crossOwnedEntry(entry, target, root) {
  return {
    projectId: entry.projectId,
    projectPath: entry.projectPath,
    targetProjectId: target.id,
    targetSkill: root,
    output: entry.path,
    kind: entry.kind
  };
}

function crossOwnershipOutputs(projects, declaredEntries) {
  const owners = projectOwners(projects);
  const crossOwned = [];
  const sharedSurface = [];
  const sharedSurfaceMetadataFindings = [];

  for (const entry of declaredEntries) {
    const root = skillRoot(entry.path);
    if (!root) continue;
    const target = owners.bySkillRoot.get(root);
    if (!target || target.id === entry.projectId) continue;

    const base = crossOwnedEntry(entry, target, root);
    const missing = [];
    const metadataPresent = entry.sharedSurface || entry.surfaceOwnerProject || entry.sharedSurfaceReason;
    if (!entry.sharedSurface) missing.push('shared_surface must be true');
    if (!entry.surfaceOwnerProject) {
      missing.push('surface_owner_project is required');
    } else if (entry.surfaceOwnerProject !== target.id) {
      missing.push(`surface_owner_project must be ${target.id}`);
    }
    if (!entry.sharedSurfaceReason || !entry.sharedSurfaceReason.trim()) {
      missing.push('shared_surface_reason is required');
    }

    if (!missing.length) {
      sharedSurface.push({
        ...base,
        surfaceOwnerProject: entry.surfaceOwnerProject,
        sharedSurfaceReason: entry.sharedSurfaceReason
      });
      continue;
    }

    crossOwned.push(base);
    if (metadataPresent) {
      sharedSurfaceMetadataFindings.push({
        ...base,
        surfaceOwnerProject: entry.surfaceOwnerProject,
        sharedSurfaceReason: entry.sharedSurfaceReason,
        reasons: missing
      });
    }
  }

  const sortKey = (entry) => `${entry.projectId}:${entry.output}`;
  return {
    crossOwned: crossOwned.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    sharedSurface: sharedSurface.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    sharedSurfaceMetadataFindings: sharedSurfaceMetadataFindings.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  };
}

function fileSize(root, relPath) {
  try {
    return fs.statSync(resolveRel(root, relPath)).size;
  } catch {
    return 0;
  }
}

function isTextLike(relPath) {
  return textExtensions.has(path.extname(relPath).toLowerCase());
}

function markerHits(text) {
  return sourceSectionMarkers.filter((marker) => text.includes(marker));
}

function looksLikeRuntimeSurface(relPath) {
  const normalized = relPath.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return suspiciousPathWords.test(normalized) || relPath.includes('/references/') || relPath.includes('/templates/');
}

function sourcePathsForEntry(entry) {
  return entry.sources?.length ? entry.sources : [entry.source].filter(Boolean);
}

function entryHasSource(entry, marker) {
  return sourcePathsForEntry(entry).some((source) => source.includes(marker));
}

function isSkillRouter(relPath) {
  return /^skills\/[^/]+\/SKILL\.md$/.test(relPath);
}

function isSkillReadme(relPath) {
  return /^skills\/[^/]+\/README\.md$/.test(relPath);
}

function isPromotedStandaloneSkillSource(entry) {
  const root = skillRoot(entry.path);
  if (!root || entry.kind !== 'copy') return false;
  const skillRelativePath = entry.path.slice(root.length + 1);
  if (!skillRelativePath) return false;
  const expectedSuffix = `/_main/skill/${skillRelativePath}`;
  return sourcePathsForEntry(entry).every((source) => source.endsWith(expectedSuffix));
}

function isPackManifest(relPath) {
  return /\/packs\/[^/]+\/pack\.json$/.test(relPath);
}

function isPackReadme(relPath) {
  return /^skills\/[^/]+\/packs\/[^/]+\/README\.md$/.test(relPath);
}

function isAgentMetadata(relPath) {
  return /^skills\/[^/]+\/agents\/[^/]+\.(md|ya?ml)$/.test(relPath);
}

function isMcpSpec(entryOrPath) {
  const relPath = typeof entryOrPath === 'string' ? entryOrPath : entryOrPath.path;
  if (!relPath.startsWith('mcp/')) return false;
  if (relPath === 'mcp/README.md') return true;
  if (/^mcp\/registry\/(?:README\.md|[^/]+\.registry\.json)$/.test(relPath)) return true;
  if (/^mcp\/projects\/[^/]+\.md$/.test(relPath)) return true;
  if (/^mcp\/(?:installer-mcp|registry-mcp)\/(?:README|SECURITY|SPEC)\.md$/.test(relPath)) return true;
  if (/^mcp\/references\/(?:README|installer-mcp|local-mcp-setup|mcp-security|registry-mcp)\.md$/.test(relPath)) return true;
  return false;
}

function isReferenceShim(entry) {
  return entry.path.includes('/reference-link-shims/') ||
    entry.source.includes('/reference-link-shims/') ||
    entry.sources.some((source) => source.includes('/reference-link-shims/'));
}

function isIndexLike(entry) {
  return path.basename(entry.path).toLowerCase() === 'readme.md' ||
    /\b(index|navigation|table of contents|entrypoint|router)\b/i.test(`${entry.notes} ${entry.fidelity}`);
}

function isOverviewLike(entry) {
  return /\boverview\b/i.test(`${entry.notes} ${entry.fidelity}`);
}

function isSkillReferenceOutput(relPath) {
  return /^skills\/[^/]+\/references\//.test(relPath);
}

function isSkillTemplateOutput(relPath) {
  return /^skills\/[^/]+\/templates\//.test(relPath);
}

function isSkillTemplateReadme(relPath) {
  return /^skills\/[^/]+\/templates\/(?:.*\/)?README\.md$/.test(relPath);
}

function isReviewedTemplate(entry) {
  if (!isSkillTemplateOutput(entry.path) || isSkillTemplateReadme(entry.path)) return false;
  return /\btemplate\b/i.test(`${entry.notes} ${entry.fidelity}`);
}

function isReviewedTemplateExample(entry) {
  return isReviewedTemplate(entry) && /\bexample\b/i.test(`${entry.path} ${entry.notes}`);
}

function isReviewedReference(entry) {
  if (!isSkillReferenceOutput(entry.path)) return false;
  return /\b(short|skill-local|reviewed|safety)\b/i.test(`${entry.notes} ${entry.fidelity}`) &&
    /\breference\b/i.test(`${entry.notes} ${entry.fidelity}`);
}

function isBriefN8nAgentAdapter(entry) {
  return entry.projectId === 'development.ai-coding-agent-rules' &&
    /^skills\/n8n-agent-rules\/adapters\/(?:AGENTS|CLAUDE|GEMINI)\.n8n-brief\.template\.md$/.test(entry.path) &&
    sourcePathsForEntry(entry).every((source) =>
      source.startsWith('_projects/development/ai-coding-agent-rules/curated_output_for_ai/adapters/')
    ) &&
    /\bbrief\b/i.test(`${entry.notes} ${entry.fidelity}`);
}

function isGeneratedN8nAgentCrossSkillReference(entry) {
  const sources = sourcePathsForEntry(entry);
  return entry.projectId === 'development.ai-coding-agent-rules' &&
    entry.sharedSurface === true &&
    /^skills\/n8n-(?:local-setup|workflow-helper-scripts|workflow-templates)\/references\/n8n-agent-rules\.md$/.test(entry.path) &&
    sources.includes('_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md') &&
    sources.some((source) =>
      source.startsWith('_projects/development/ai-coding-agent-rules/curated_output_for_ai/cross-skill-references/')
    );
}

function boundaryMarkerHits(text) {
  return boundaryHeadingMarkers.filter((marker) => new RegExp(`\\b${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}

function runtimeBoundaryMarkerHits(text) {
  return boundaryMarkerHits(text).filter((hit) => !safetyOnlyMarkers.has(hit));
}

function markdownHeadingsOutsideFences(text) {
  const headings = [];
  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  let fence = null;

  for (const line of lines) {
    const lineStart = offset;
    const cleanLine = line.replace(/\r?\n$/, '');
    const fenceMatch = cleanLine.match(/^\s*(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      const fenceChar = marker[0];
      if (!fence) {
        fence = { char: fenceChar, length: marker.length };
      } else if (fence.char === fenceChar && marker.length >= fence.length) {
        fence = null;
      }
      offset += line.length;
      continue;
    }

    if (!fence) {
      const headingMatch = cleanLine.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) {
        headings.push({
          level: headingMatch[1].length,
          title: headingMatch[2].trim(),
          index: lineStart,
          end: lineStart + line.length
        });
      }
    }

    offset += line.length;
  }

  return headings;
}

function runtimeImportExportActionMarkersWithCommand(text) {
  const markers = [];
  const headings = markdownHeadingsOutsideFences(text);
  for (const [index, heading] of headings.entries()) {
    if (!/^(Import|Export)$/i.test(heading.title)) continue;

    const marker = heading.title.toLowerCase() === 'import' ? 'Import' : 'Export';
    const nextHeading = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const section = text.slice(heading.end, nextHeading ? nextHeading.index : text.length);
    if ((section.match(commandSnippetPattern) || []).length) markers.push(marker);
  }
  return [...new Set(markers)];
}

function runtimeInstructionReasons(text) {
  const reasons = [];
  const hits = runtimeBoundaryMarkerHits(text);
  const hasSetupMarker = hits.some((hit) => runtimeSetupMarkers.has(hit));
  const importExportActionMarkers = runtimeImportExportActionMarkersWithCommand(text);
  const numberedRuntimeSteps = text.match(runtimeNumberedStepPattern) || [];
  const commandSnippets = text.match(commandSnippetPattern) || [];
  const hasServerPackagePattern = runtimeServerPackagePattern.test(text);
  const hasImportExportCommand = importExportActionMarkers.length > 0;
  const hasRuntimeContext =
    numberedRuntimeSteps.length >= 2 ||
    commandSnippets.length >= 2 ||
    hasServerPackagePattern ||
    hasImportExportCommand;

  if (hits.length && hasRuntimeContext && (hasSetupMarker || commandSnippets.length >= 2 || hasServerPackagePattern || hasImportExportCommand)) {
    reasons.push(`runtime markers: ${hits.join(', ')}`);
  }
  if (numberedRuntimeSteps.length >= 2 && (hasSetupMarker || commandSnippets.length >= 2 || hasServerPackagePattern)) {
    reasons.push(`numbered runtime setup steps: ${numberedRuntimeSteps.length}`);
  }
  if (commandSnippets.length >= 2) {
    reasons.push('command snippets look executable');
  }
  if (hasServerPackagePattern && (hasSetupMarker || commandSnippets.length >= 2 || numberedRuntimeSteps.length >= 2)) {
    reasons.push('server or package runtime pattern');
  }

  return reasons;
}

function isRepoLocalAgentRuleTemplateEntry(entry) {
  return entry.projectId === 'development.ai-coding-agent-rules' &&
    /^skills\/ai-coding-agent-rules\/(?:repo-local\/)?(?:AGENTS|CLAUDE|GEMINI|antigravity-bootstrap)(?:\.(?:managed|shim))?\.template\.md$/.test(entry.path) &&
    sourcePathsForEntry(entry).every((source) =>
      source.startsWith('_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/')
    );
}

function recipeBoundaryReasons(root, entry) {
  const reasons = [];
  const reviewedTemplate = isReviewedTemplate(entry);
  const runtimeCheckedCurated =
    isPackReadme(entry.path) ||
    isSkillTemplateReadme(entry.path) ||
    isMcpSpec(entry) ||
    isReviewedReference(entry) ||
    reviewedTemplate ||
    isIndexLike(entry) ||
    isOverviewLike(entry);
  const allowedCurated =
    isSkillRouter(entry.path) ||
    isSkillReadme(entry.path) ||
    isPackManifest(entry.path) ||
    isPackReadme(entry.path) ||
    isAgentMetadata(entry.path) ||
    isMcpSpec(entry) ||
    isReferenceShim(entry) ||
    isSkillTemplateReadme(entry.path) ||
    isReviewedReference(entry) ||
    reviewedTemplate ||
    isIndexLike(entry) ||
    isOverviewLike(entry);
  const shouldAuditRuntimeHeft = !allowedCurated || runtimeCheckedCurated;

  if (isSkillReferenceOutput(entry.path) && !allowedCurated) {
    reasons.push('skill reference output uses curated source');
  }
  if (isSkillTemplateOutput(entry.path) && !allowedCurated) {
    reasons.push('skill template output uses curated source');
  }
  if (entry.path.startsWith('mcp/') && !isMcpSpec(entry)) {
    reasons.push('MCP output is not a known design, spec, registry, project, reference, or index surface');
  }
  if (looksLikeRuntimeSurface(entry.path) && !allowedCurated) {
    reasons.push('runtime-looking output uses curated source');
  }

  for (const source of sourcePathsForEntry(entry)) {
    if (!source.includes('/curated_output_for_ai/') || !source.endsWith('.md')) continue;
    if (!fs.existsSync(resolveRel(root, source))) continue;
    const text = readText(root, source);
    const runtimeReasons = runtimeInstructionReasons(text);
    if (runtimeReasons.length && shouldAuditRuntimeHeft) {
      for (const reason of runtimeReasons) {
        reasons.push(`curated source has ${reason}`);
      }
    }
    if (fileSize(root, source) >= 3000 && curatedRuntimePathWords.test(source) && shouldAuditRuntimeHeft) {
      reasons.push('large curated Markdown source looks runtime-critical');
    }
  }

  return [...new Set(reasons)];
}

function isMcpReadyRegistryEntry(entry) {
  return entry.projectId === 'repo-methodology.mcp-ready-registry' &&
    entry.path.startsWith('mcp/') &&
    sourcePathsForEntry(entry).every((source) => source.startsWith('_projects/repo-methodology/mcp-ready-registry/_main/'));
}

function mainAdapterReasons(root, entry) {
  const reasons = [];
  if (isPromotedStandaloneSkillSource(entry)) return reasons;
  if (isMcpReadyRegistryEntry(entry)) {
    if (isMcpSpec(entry)) return reasons;
    reasons.push('mcp-ready registry output is not a known design, spec, registry, reference, or index surface');
    for (const source of sourcePathsForEntry(entry)) {
      if (!source.endsWith('.md') || !fs.existsSync(resolveRel(root, source))) continue;
      for (const reason of runtimeInstructionReasons(readText(root, source))) {
        reasons.push(`main MCP source has ${reason}`);
      }
    }
    return [...new Set(reasons)];
  }
  if (isSkillRouter(entry.path) || isSkillReadme(entry.path) || isMcpSpec(entry) || isPackManifest(entry.path)) {
    reasons.push('main source is publishing an adapter, index, spec, or metadata surface');
  }
  return reasons;
}

function classifyBoundaryRecipe(root, entry) {
  if (entry.kind === 'generated_registry') return 'curated_metadata';
  if (entry.kind === 'linked') return 'linked_exception';
  if (isGeneratedN8nAgentCrossSkillReference(entry)) return 'generated_cross_skill_reference';
  if (isBriefN8nAgentAdapter(entry)) return 'curated_adapter';
  const hasCuratedSource = entryHasSource(entry, '/curated_output_for_ai/');
  const hasMainSource = entryHasSource(entry, '/_main/');

  if (hasCuratedSource) {
    if (isRepoLocalAgentRuleTemplateEntry(entry)) return 'curated_repo_local_agent_template';
    if (isReferenceShim(entry)) return 'curated_shim';
    if (isPackManifest(entry.path) || entry.kind === 'json') return 'curated_metadata';
    if (isAgentMetadata(entry.path)) return 'curated_agent_metadata';
    if (isSkillRouter(entry.path)) return 'curated_router';
    if (isMcpSpec(entry)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_spec';
    }
    if (isPackReadme(entry.path)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_pack_readme';
    }
    if (isSkillTemplateReadme(entry.path)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_template_index';
    }
    if (isReviewedReference(entry)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_reference';
    }
    if (isReviewedTemplateExample(entry)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_template_example';
    }
    if (isReviewedTemplate(entry)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_template';
    }
    if (isIndexLike(entry) || isOverviewLike(entry)) {
      return recipeBoundaryReasons(root, entry).length ? 'suspicious_curated_runtime' : 'curated_index';
    }
    if (recipeBoundaryReasons(root, entry).length) return 'suspicious_curated_runtime';
    return 'unknown';
  }

  if (hasMainSource) {
    if (mainAdapterReasons(root, entry).length) return 'suspicious_main_adapter';
    return 'main_full_fidelity';
  }

  return 'unknown';
}

function boundaryRecipes(root, entries) {
  return entries
    .map((entry) => ({
      path: entry.path,
      projectId: entry.projectId,
      kind: entry.kind,
      source: entry.source,
      sources: sourcePathsForEntry(entry),
      recipeOutput: entry.recipeOutput,
      notes: entry.notes,
      fidelity: entry.fidelity,
      classification: classifyBoundaryRecipe(root, entry),
      reasons: []
    }))
    .map((entry) => ({
      ...entry,
      reasons: entry.classification === 'suspicious_curated_runtime'
        ? recipeBoundaryReasons(root, entry)
        : entry.classification === 'suspicious_main_adapter'
          ? mainAdapterReasons(root, entry)
          : entry.classification === 'unknown'
            ? ['recipe source boundary is not classifiable by current heuristics']
            : []
    }))
    .sort((a, b) => `${a.classification}:${a.path}`.localeCompare(`${b.classification}:${b.path}`));
}

function curatedFileAllowedCategory(relPath) {
  if (/^_projects\/development\/ai-coding-agent-rules\/curated_output_for_ai\/skills\/ai-coding-agent-rules\/repo-local\/[^/]+\.template\.md$/.test(relPath)) {
    return 'curated_repo_local_agent_template';
  }
  if (relPath.endsWith('/SKILL.md')) return 'curated_router';
  if (/\/curated_output_for_ai\/agents\/[^/]+\.(md|ya?ml)$/.test(relPath)) return 'curated_agent_metadata';
  if (/\/curated_output_for_ai\/overviews\/.*\.md$/.test(relPath)) return 'curated_index';
  if (/\/curated_output_for_ai\/templates\/.*\/README\.md$/.test(relPath)) return 'curated_template_index';
  if (/\/curated_output_for_ai\/templates\/.*\.md$/.test(relPath)) return 'curated_template';
  if (/\/curated_output_for_ai\/packs\/[^/]+\/README\.md$/.test(relPath)) return 'curated_pack_readme';
  if (path.basename(relPath).toLowerCase() === 'readme.md') return 'curated_index';
  if (/\/packs\/[^/]+\/pack\.json$/.test(relPath)) return 'curated_metadata';
  if (relPath.includes('/mcp/')) return 'curated_spec';
  if (relPath.includes('/reference-link-shims/')) return 'curated_shim';
  return '';
}

function hasExplicitPlatformOverviewBoundary(relPath, text) {
  return relPath.includes('/curated_output_for_ai/references/ai-agent-platforms/') &&
    /^## Boundary$/m.test(text) &&
    /\bshort platform (overview|router)\b/i.test(text) &&
    /not the full runtime setup guide/i.test(text) &&
    /full-fidelity references and templates/i.test(text);
}

function hasExplicitOverviewBoundary(relPath, text) {
  return relPath.includes('/curated_output_for_ai/overviews/') &&
    /^## Boundary$/m.test(text) &&
    /\bshort .*?(overview|reference|safety wrapper|safety checklist)\b/i.test(text) &&
    /not the full runtime (setup guide|helper guide)/i.test(text);
}

function hasExplicitWorkflowToolkitReferenceBoundary(relPath, text) {
  return relPath.includes('_projects/n8n/workflow-toolkit/curated_output_for_ai/references/') &&
    /^## Boundary$/m.test(text) &&
    /\bshort .*?(overview|reference|safety wrapper|safety checklist)\b/i.test(text) &&
    /not the full runtime (guide|helper guide)/i.test(text);
}

function curatedDirectoryReasons(root, relPath) {
  if (!relPath.endsWith('.md')) return [];
  const allowedCategory = curatedFileAllowedCategory(relPath);
  const runtimeAuditedCategories = new Set(['curated_index', 'curated_template', 'curated_template_index', 'curated_pack_readme', 'curated_spec']);
  if (allowedCategory && !runtimeAuditedCategories.has(allowedCategory)) return [];
  const text = readText(root, relPath);
  const reasons = [];
  if (fileSize(root, relPath) >= 3000) reasons.push('large Markdown file');
  const codeFences = text.match(codeFencePattern) || [];
  if (codeFences.length >= 4) reasons.push('many command or code fences');
  const numberedSteps = text.match(numberedStepPattern) || [];
  if (numberedSteps.length >= 4) reasons.push('many numbered setup steps');
  const headingCount = (text.match(markdownHeadingPattern) || []).length;
  if (headingCount >= 8) reasons.push('many Markdown headings');
  const runtimeReasons = runtimeInstructionReasons(text);
  reasons.push(...runtimeReasons);
  if ((!allowedCategory || allowedCategory === 'curated_index') && curatedRuntimePathWords.test(relPath)) {
    reasons.push('path looks like guide, setup, workflow, prompt, template, reference, or playbook');
  }
  const heavyRuntimeShape = fileSize(root, relPath) >= 3000 ||
    codeFences.length >= 4 ||
    headingCount >= 8 ||
    runtimeReasons.length >= 2;
  if (hasExplicitPlatformOverviewBoundary(relPath, text) && !heavyRuntimeShape) return [];
  if (hasExplicitOverviewBoundary(relPath, text) && !heavyRuntimeShape) return [];
  if (hasExplicitWorkflowToolkitReferenceBoundary(relPath, text) && !heavyRuntimeShape) return [];
  if (allowedCategory && allowedCategory !== 'curated_index') {
    return runtimeReasons.length >= 2 || codeFences.length >= 4 ? [...new Set(reasons)] : [];
  }
  if (allowedCategory === 'curated_index' && reasons.length < 3) return [];
  if (reasons.length >= 2) return [...new Set(reasons)];
  return [];
}

function curatedDirectoryFindings(root, projects) {
  return projects
    .flatMap((project) => listFiles(root, `${project.module_path}/curated_output_for_ai`)
      .map((relPath) => ({
        path: relPath,
        projectId: project.id,
        bytes: fileSize(root, relPath),
        reasons: curatedDirectoryReasons(root, relPath)
      })))
    .filter((entry) => entry.reasons.length)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function sourceTokens(relPath) {
  const base = path.basename(relPath, path.extname(relPath)).toLowerCase();
  return new Set(
    base
      .replace(/tunnelling/g, 'tunneling')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !['readme', 'template', 'guide', 'extra'].includes(token))
  );
}

function inferProjectForPublishedFile(projects, relPath) {
  const owners = projectOwners(projects);
  const root = skillRoot(relPath);
  if (root && owners.bySkillRoot.has(root)) return owners.bySkillRoot.get(root);
  if (owners.byMcpPath.has(relPath)) return owners.byMcpPath.get(relPath);
  return null;
}

function likelySourceDoc(root, project, relPath) {
  if (!project) return null;
  const tokens = sourceTokens(relPath);
  if (!tokens.size) return null;
  const candidates = listFiles(root, project.main_path)
    .filter((item) => item.endsWith('.md') && !item.includes('/_generated/'))
    .map((source) => {
      const candidateTokens = sourceTokens(source);
      let score = 0;
      for (const token of tokens) {
        if (candidateTokens.has(token)) score += 2;
        if (source.toLowerCase().includes(token)) score += 1;
      }
      return { source, score, size: fileSize(root, source) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.size - a.size || a.source.localeCompare(b.source));
  return candidates[0] || null;
}

function suspiciousDeclaredOutputs(root, declaredEntries) {
  const issues = [];
  for (const entry of declaredEntries) {
    if (!entry.source || !isTextLike(entry.path) || !isTextLike(entry.source)) continue;
    if (!fs.existsSync(resolveRel(root, entry.path)) || !fs.existsSync(resolveRel(root, entry.source))) continue;
    if (!looksLikeRuntimeSurface(entry.path) && !looksLikeRuntimeSurface(entry.source)) continue;
    const sourceSize = fileSize(root, entry.source);
    const outputSize = fileSize(root, entry.path);
    if (sourceSize < 3000 || outputSize === 0 || outputSize / sourceSize >= 0.4) continue;

    const sourceText = readText(root, entry.source);
    const outputText = readText(root, entry.path);
    const missingMarkers = markerHits(sourceText).filter((marker) => !outputText.includes(marker));
    issues.push({
      path: entry.path,
      source: entry.source,
      projectId: entry.projectId,
      sourceBytes: sourceSize,
      outputBytes: outputSize,
      ratio: Number((outputSize / sourceSize).toFixed(3)),
      reason: missingMarkers.length ? `missing source markers: ${missingMarkers.join(', ')}` : 'published output is much smaller than declared source'
    });
  }
  return issues;
}

function suspiciousManualOutputs(root, projects, undeclaredFiles) {
  const issues = [];
  for (const file of undeclaredFiles) {
    if (!file.endsWith('.md') || !looksLikeRuntimeSurface(file)) continue;
    const project = inferProjectForPublishedFile(projects, file);
    const candidate = likelySourceDoc(root, project, file);
    if (!candidate) continue;
    const outputSize = fileSize(root, file);
    const sourceSize = candidate.size;
    if (sourceSize < 3000 || outputSize === 0 || outputSize / sourceSize >= 0.5) continue;

    const sourceText = readText(root, candidate.source);
    const outputText = readText(root, file);
    const missingMarkers = markerHits(sourceText).filter((marker) => !outputText.includes(marker));
    issues.push({
      path: file,
      source: candidate.source,
      projectId: project.id,
      sourceBytes: sourceSize,
      outputBytes: outputSize,
      ratio: Number((outputSize / sourceSize).toFixed(3)),
      reason: missingMarkers.length ? `missing likely source markers: ${missingMarkers.join(', ')}` : 'manual published file is much smaller than likely source doc'
    });
  }
  return issues;
}

function suspiciousPublishedSurfaces(root, projects, declaredEntries, undeclaredFiles) {
  return [
    ...suspiciousDeclaredOutputs(root, declaredEntries),
    ...suspiciousManualOutputs(root, projects, undeclaredFiles)
  ].sort((a, b) => `${a.path}:${a.source}`.localeCompare(`${b.path}:${b.source}`));
}

function projectModuleForPath(relPath) {
  const parts = relPath.split('/');
  if (parts[0] !== '_projects' || !parts[1] || !parts[2]) return '';
  return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

function duplicateProjectContentGroups(root) {
  const groups = new Map();
  for (const relPath of listFiles(root, projectRoot)) {
    if (relPath.includes('/_generated/')) continue;
    const modulePath = projectModuleForPath(relPath);
    if (!modulePath) continue;
    const content = fs.readFileSync(resolveRel(root, relPath));
    if (!content.length) continue;
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const group = groups.get(hash) || [];
    group.push({ path: relPath, modulePath, bytes: content.length });
    groups.set(hash, group);
  }
  return [...groups.entries()]
    .map(([hash, files]) => ({ hash, files }))
    .filter((group) => new Set(group.files.map((file) => file.modulePath)).size > 1)
    .filter((group) => !isLegacyN8nHelperProvenanceDuplicate(group))
    .sort((a, b) => a.hash.localeCompare(b.hash));
}

function isLegacyN8nHelperProvenanceDuplicate(group) {
  const allowedPrefixes = [
    '_projects/cicd/secure-installer/_main/templates/n8n/',
    '_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/'
  ];
  const allowedModules = new Set([
    '_projects/cicd/secure-installer',
    '_projects/n8n/workflow-toolkit'
  ]);
  const modules = new Set(group.files.map((file) => file.modulePath));
  return [...modules].every((modulePath) => allowedModules.has(modulePath)) &&
    group.files.every((file) => allowedPrefixes.some((prefix) => file.path.startsWith(prefix)));
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) counts[item[field]] = (counts[item[field]] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function buildAudit(root) {
  const projects = discoverProjectManifests(root);
  const tracked = trackedOrFilesystemFiles(root, publishedRoots);
  const publishedFiles = tracked.files.filter((relPath) => relPath.startsWith('skills/') || relPath.startsWith('mcp/')).sort();
  const declared = declaredOutputs(root, projects);
  const packInstalled = packInstalledFiles(root, publishedFiles);

  const files = publishedFiles.map((relPath) => {
    const declaredEntries = declared.byPath.get(relPath) || [];
    const packs = packInstalled.byPath.get(relPath) || [];
    return {
      path: relPath,
      classification: classifyPublishedFile(relPath, declared.byPath, packInstalled.byPath),
      declared: declaredEntries.map((entry) => ({ projectId: entry.projectId, kind: entry.kind, source: entry.source, recipeOutput: entry.recipeOutput })),
      packs
    };
  });

  const undeclaredPublishedFiles = files.filter((file) => !declared.byPath.has(file.path));
  const packInstalledUndeclared = files.filter((file) => file.classification === 'pack_installed_undeclared');
  const crossOwnership = crossOwnershipOutputs(projects, declared.entries);
  const suspicious = suspiciousPublishedSurfaces(root, projects, declared.entries, undeclaredPublishedFiles.map((file) => file.path));
  const duplicateGroups = duplicateProjectContentGroups(root);
  const boundaryRecipeEntries = boundaryRecipes(root, declared.entries);
  const boundaryRecipeFindings = boundaryRecipeEntries.filter((entry) => entry.reasons.length);
  const curatedFindings = curatedDirectoryFindings(root, projects);

  return {
    version: 1,
    generatedAt: new Date(0).toISOString(),
    inputs: {
      fileSource: tracked.source,
      projectManifests: projects.map((project) => `${project.module_path}/toolkit.project.json`),
      packManifests: packInstalled.manifests.map((pack) => pack.path)
    },
    summary: {
      projects: projects.length,
      publishedFiles: publishedFiles.length,
      declaredOutputFiles: declared.byPath.size,
      packInstalledFiles: packInstalled.byPath.size,
      undeclaredPublishedFiles: undeclaredPublishedFiles.length,
      packInstalledUndeclared: packInstalledUndeclared.length,
      crossOwnedOutputs: crossOwnership.crossOwned.length,
      sharedSurfaceOutputs: crossOwnership.sharedSurface.length,
      sharedSurfaceMetadataFindings: crossOwnership.sharedSurfaceMetadataFindings.length,
      suspiciousPublishedSurfaces: suspicious.length,
      duplicateProjectContentGroups: duplicateGroups.length,
      boundaryRecipeOutputs: boundaryRecipeEntries.length,
      boundaryRecipeFindings: boundaryRecipeFindings.length,
      curatedDirectoryFindings: curatedFindings.length
    },
    classifications: countBy(files, 'classification'),
    boundaryClassifications: countBy(boundaryRecipeEntries, 'classification'),
    files,
    boundaryRecipes: boundaryRecipeEntries,
    issues: {
      undeclaredPublishedFiles: undeclaredPublishedFiles.map(({ path, classification, packs }) => ({ path, classification, packs })).sort((a, b) => a.path.localeCompare(b.path)),
      packInstalledUndeclared: packInstalledUndeclared.map(({ path, classification, packs }) => ({ path, classification, packs })).sort((a, b) => a.path.localeCompare(b.path)),
      crossOwnedOutputs: crossOwnership.crossOwned,
      sharedSurfaceOutputs: crossOwnership.sharedSurface,
      sharedSurfaceMetadataFindings: crossOwnership.sharedSurfaceMetadataFindings,
      suspiciousPublishedSurfaces: suspicious,
      duplicateProjectContentGroups: duplicateGroups,
      boundaryRecipeFindings,
      curatedDirectoryFindings: curatedFindings
    }
  };
}

function baselineFromReport(report) {
  return {
    version: 1,
    description: 'Known published-surface audit findings allowed until follow-up PRs classify or generate them.',
    summary: report.summary,
    issueKeys: {
      undeclaredPublishedFiles: report.issues.undeclaredPublishedFiles.map((entry) => entry.path).sort(),
      packInstalledUndeclared: report.issues.packInstalledUndeclared.map((entry) => entry.path).sort(),
      crossOwnedOutputs: report.issues.crossOwnedOutputs.map((entry) => `${entry.projectId} -> ${entry.targetProjectId}: ${entry.output}`).sort(),
      sharedSurfaceOutputs: report.issues.sharedSurfaceOutputs.map((entry) => `${entry.projectId} -> ${entry.targetProjectId}: ${entry.output} [${entry.sharedSurfaceReason}]`).sort(),
      sharedSurfaceMetadataFindings: report.issues.sharedSurfaceMetadataFindings.map((entry) => `${entry.projectId} -> ${entry.targetProjectId}: ${entry.output}: ${entry.reasons.join('; ')}`).sort(),
      suspiciousPublishedSurfaces: report.issues.suspiciousPublishedSurfaces.map((entry) => `${entry.path} <= ${entry.source}: ${entry.reason}`).sort(),
      duplicateProjectContentGroups: report.issues.duplicateProjectContentGroups.map((entry) => `${entry.hash}: ${entry.files.map((file) => file.path).sort().join(' | ')}`).sort(),
      boundaryRecipeFindings: report.issues.boundaryRecipeFindings.map((entry) => `${entry.path} <= ${entry.sources.join(' + ')}: ${entry.classification}: ${entry.reasons.join('; ')}`).sort(),
      curatedDirectoryFindings: report.issues.curatedDirectoryFindings.map((entry) => `${entry.path}: ${entry.reasons.join('; ')}`).sort()
    }
  };
}

function diffKeys(label, current, baseline, display) {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  const errors = [];
  for (const key of currentSet) {
    if (!baselineSet.has(key)) errors.push(`new ${label}: ${display(key)}`);
  }
  for (const key of baselineSet) {
    if (!currentSet.has(key)) errors.push(`baseline ${label} no longer reported: ${display(key)}`);
  }
  return errors;
}

function compareToBaseline(root, report) {
  const baselinePath = resolveRel(root, baselineRelPath);
  if (!fs.existsSync(baselinePath)) {
    return { ok: false, errors: [`missing published surface audit baseline: ${baselineRelPath}`] };
  }
  const baseline = readJson(root, baselineRelPath);
  const current = baselineFromReport(report).issueKeys;
  const expected = baseline.issueKeys || {};
  const errors = [
    ...diffKeys('undeclared published surface', current.undeclaredPublishedFiles, expected.undeclaredPublishedFiles || [], (key) => key),
    ...diffKeys('pack-installed undeclared surface', current.packInstalledUndeclared, expected.packInstalledUndeclared || [], (key) => key),
    ...diffKeys('cross-owned output', current.crossOwnedOutputs, expected.crossOwnedOutputs || [], (key) => key),
    ...diffKeys('shared-surface output', current.sharedSurfaceOutputs, expected.sharedSurfaceOutputs || [], (key) => key),
    ...diffKeys('shared-surface metadata finding', current.sharedSurfaceMetadataFindings, expected.sharedSurfaceMetadataFindings || [], (key) => key),
    ...diffKeys('suspicious published surface', current.suspiciousPublishedSurfaces, expected.suspiciousPublishedSurfaces || [], (key) => key),
    ...diffKeys('duplicate project content group', current.duplicateProjectContentGroups, expected.duplicateProjectContentGroups || [], (key) => key),
    ...diffKeys('boundary recipe finding', current.boundaryRecipeFindings, expected.boundaryRecipeFindings || [], (key) => key),
    ...diffKeys('curated directory boundary finding', current.curatedDirectoryFindings, expected.curatedDirectoryFindings || [], (key) => key)
  ];
  return { ok: errors.length === 0, errors };
}

function renderList(lines, items, formatter, emptyText) {
  if (!items.length) {
    lines.push(`- ${emptyText}`);
    return;
  }
  for (const item of items) lines.push(`- ${formatter(item)}`);
}

function renderReport(report, checkResult = null) {
  const lines = [];
  lines.push('Published surface audit');
  lines.push('');
  lines.push('Summary:');
  for (const [key, value] of Object.entries(report.summary)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push('');
  lines.push('Classifications:');
  for (const [key, value] of Object.entries(report.classifications)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push('');
  lines.push('Boundary recipe classifications:');
  for (const [key, value] of Object.entries(report.boundaryClassifications)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push('');
  lines.push('Pack-installed undeclared files:');
  renderList(lines, report.issues.packInstalledUndeclared, (entry) => `${entry.path} (${entry.packs.map((pack) => pack.id).join(', ')})`, 'none');
  lines.push('');
  lines.push('Cross-owned outputs:');
  renderList(lines, report.issues.crossOwnedOutputs, (entry) => `${entry.projectId} -> ${entry.targetProjectId}: ${entry.output}`, 'none');
  lines.push('');
  lines.push('Declared shared-surface outputs:');
  renderList(lines, report.issues.sharedSurfaceOutputs, (entry) => `${entry.projectId} -> ${entry.targetProjectId}: ${entry.output} (${entry.sharedSurfaceReason})`, 'none');
  lines.push('');
  lines.push('Shared-surface metadata findings:');
  renderList(lines, report.issues.sharedSurfaceMetadataFindings, (entry) => `${entry.projectId} -> ${entry.targetProjectId}: ${entry.output} [${entry.reasons.join('; ')}]`, 'none');
  lines.push('');
  lines.push('Suspicious published surfaces:');
  renderList(lines, report.issues.suspiciousPublishedSurfaces, (entry) => `${entry.path} <= ${entry.source} (${entry.reason}; ratio ${entry.ratio})`, 'none');
  lines.push('');
  lines.push('Manual and undeclared published files:');
  renderList(lines, report.issues.undeclaredPublishedFiles, (entry) => `${entry.path} [${entry.classification}]`, 'none');
  lines.push('');
  lines.push('Exact duplicate groups across _projects:');
  renderList(lines, report.issues.duplicateProjectContentGroups, (entry) => `${entry.hash}: ${entry.files.map((file) => file.path).join(' | ')}`, 'none');
  lines.push('');
  lines.push('Curated output boundary recipe findings:');
  renderList(
    lines,
    report.issues.boundaryRecipeFindings,
    (entry) => `${entry.path} <= ${entry.sources.join(' + ')} [${entry.classification}: ${entry.reasons.join('; ')}]`,
    'none'
  );
  lines.push('');
  lines.push('Curated directory boundary findings:');
  renderList(
    lines,
    report.issues.curatedDirectoryFindings,
    (entry) => `${entry.path} [${entry.reasons.join('; ')}]`,
    'none'
  );
  if (checkResult) {
    lines.push('');
    lines.push(checkResult.ok ? `Baseline check passed: ${baselineRelPath}` : `Baseline check failed: ${baselineRelPath}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs();
  const root = path.resolve(args.workspace || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
  const report = buildAudit(root);
  if (args.writeBaseline) {
    const baselinePath = resolveRel(root, baselineRelPath);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(baselineFromReport(report), null, 2)}\n`, 'utf8');
  }
  const checkResult = args.check ? compareToBaseline(root, report) : null;

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderReport(report, checkResult));
  }

  if (checkResult && !checkResult.ok) {
    process.stderr.write(`${checkResult.errors.join('\n')}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  baselineFromReport,
  buildAudit,
  compareToBaseline,
  renderReport
};
