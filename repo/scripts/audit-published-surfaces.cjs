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
  return value.split(path.sep).join('/');
}

const legacyReferenceAllowedPaths = new Set([
  'skills/context-preserving-ai-publisher/references/audit-and-baseline-workflow.md',
  'skills/context-preserving-ai-publisher/references/validation-strategy.md',
  'skills/context-preserving-ai-publisher/templates/project-module/SOURCE-LOCK.template.json',
  'skills/context-preserving-ai-publisher/templates/project-module/toolkit.project.template.json',
  'skills/context-preserving-ai-publisher/templates/repo-docs/project-module-standard.template.md'
]);

function legacyReferenceAllowed(rel) {
  return legacyReferenceAllowedPaths.has(slash(rel));
}

const activePolicyRootPaths = ['AGENTS.md', 'README.md'];
const historicalPolicyPathPrefixes = ['repo/docs/audits/'];
const historicalPolicyPaths = new Set(['repo/docs/RETIRED-SOURCE-PROVENANCE.md']);
const activeSkillInstructionPattern = /^skills\/.+\/(?:SKILL|README|INSTALL)\.md$/i;
const standalonePublisherEntrypointPaths = new Set([
  'skills/context-preserving-ai-publisher/SKILL.md',
  'skills/context-preserving-ai-publisher/README.md'
]);
const retiredTopologyOperationPatterns = [
  {
    family: 'projects-source-ownership',
    pattern: /\b_projects(?:\b|[\\/])/i,
    message: 'references a retired _projects path/source ownership'
  },
  {
    family: 'main-source-ownership',
    pattern: /\b_main(?:\b|[\\/])/i,
    message: 'references a retired _main source path'
  },
  {
    family: 'curated-output-source-ownership',
    pattern: /\bcurated[_ -]output[_ -]for[_ -]ai\b/i,
    message: 'references retired curated-output publishing'
  },
  {
    family: 'project-module-skill-pair',
    pattern: /\bproject[- ]modules?\b[^.!?]{0,180}\b(?:published|generated)\s+skills?\b|\b(?:published|generated)\s+skills?\b[^.!?]{0,180}\bproject[- ]modules?\b/i,
    message: 'claims retired Toolkit project-module plus published/generated-skill operation'
  },
  {
    family: 'project-to-skill-publishing',
    pattern: /\bproject[- ]to[- ]skills?\b/i,
    message: 'claims retired project-to-skill publishing'
  },
  {
    family: 'project-manifest-publishing',
    pattern: /\b(?:project[- ]manifest|toolkit\.project\.json|source[- ]manifest)\b[^.!?]{0,120}\b(?:publish(?:ing|ed|es)?|generate(?:d|s|ing)?|copies?|writeback|sync)\b[^.!?]{0,80}\b(?:skills?|surfaces?|outputs?|packs?|publication|publishing)\b|\b(?:skills?|surfaces?|outputs?|packs?|publication|publishing)\b[^.!?]{0,80}\b(?:publish(?:ing|ed|es)?|generate(?:d|s|ing)?|copies?|writeback|sync)\b[^.!?]{0,120}\b(?:project[- ]manifest|toolkit\.project\.json|source[- ]manifest)\b|\b(?:project[- ]manifest|toolkit\.project\.json|source[- ]manifest)\s+(?:publishing|publication|writeback|sync)\b/i,
    message: 'claims retired project-manifest publishing'
  },
  {
    family: 'source-to-surface-publishing',
    pattern: /\bsource[- ]to[- ](?:generated[- ]?)?surfaces?\b[^.!?]{0,180}\b(?:workflow|(?<!-)publisher|publish(?:ing|ed|es)?|generate(?:d|s|ing)?|copies?|writeback|sync|conversion|handoff)\b|\b(?:workflow|(?<!-)publisher|publish(?:ing|ed|es)?|generate(?:d|s|ing)?|copies?|writeback|sync|conversion|handoff)\b[^.!?]{0,180}\bsource[- ]to[- ](?:generated[- ]?)?surfaces?\b/i,
    message: 'claims retired source-to-surface publishing'
  },
  {
    family: 'generated-skill-publication',
    pattern: /\b(?:generated|deterministic)\s+(?:skills?\s+)?(?:copies?|publication|publishing|writeback)\b|\b(?:skills?\s+)?(?:copies?|publication|publishing|writeback)\b\s+(?:from|through|via|of|for|using)\s+(?:generated|deterministic)(?:\s+skills?)?\b/i,
    message: 'claims retired generated or deterministic publication'
  },
  {
    family: 'standalone-publisher-routing',
    pattern: /\bcontext-preserving-ai-publisher\b[^.!?]{0,180}\b(?:route|routes|use|uses|require|requires|pair|pairs|follow|follows|name|names)\b|\b(?:route|routes|use|uses|require|requires|pair|pairs|follow|follows|name|names)\b[^.!?]{0,180}\bcontext-preserving-ai-publisher\b/i,
    message: 'routes Toolkit conversion through the standalone publisher'
  },
  {
    family: 'retired-sync-toolkit-projects-command',
    pattern: /\b(?:node\s+)?repo[\\/]\s*scripts[\\/]\s*sync-toolkit-projects\s*\.cjs\b/i,
    message: 'references retired sync-toolkit-projects.cjs'
  },
  {
    family: 'retired-package-skills-command',
    pattern: /\b(?:node\s+)?repo[\\/]\s*scripts[\\/]\s*package-skills\s*\.cjs\b/i,
    message: 'references retired package-skills.cjs'
  },
  {
    family: 'retired-package-packs-command',
    pattern: /\b(?:node\s+)?repo[\\/]\s*scripts[\\/]\s*package-packs\s*\.cjs\b/i,
    message: 'references retired package-packs.cjs'
  }
];

const currentRepositoryScopePatterns = [
  /(?<![A-Za-z0-9_-])Toolkit(?:'s)?\b/i,
  /\b(?:this|our|current)\s+repo(?:sitory)?\b/i
];

function normaliseRetiredTopologyText(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/\s*([\\/-])\s*/g, '$1')
    .trim();
}

function detectRetiredTopologyOperations(value) {
  const text = normaliseRetiredTopologyText(value);
  const matches = [];
  for (const operation of retiredTopologyOperationPatterns) {
    const flags = operation.pattern.flags.includes('g') ? operation.pattern.flags : `${operation.pattern.flags}g`;
    const pattern = new RegExp(operation.pattern.source, flags);
    for (const match of text.matchAll(pattern)) {
      matches.push({
        family: operation.family,
        message: operation.message,
        match: match[0],
        index: match.index,
        text
      });
    }
  }
  return matches.sort((left, right) => left.index - right.index || left.family.localeCompare(right.family));
}

function activePolicyFiles() {
  const docs = walk('repo/docs')
    .filter((rel) => rel.endsWith('.md'))
    .filter((rel) => !historicalPolicyPaths.has(rel))
    .filter((rel) => !historicalPolicyPathPrefixes.some((prefix) => rel.startsWith(prefix)));
  const skillInstructions = walk('skills').filter((rel) => activeSkillInstructionPattern.test(rel));
  return [...new Set([...activePolicyRootPaths, ...docs, ...skillInstructions])].filter(exists).sort();
}

function markdownBlocks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = [];
  let startLine = 1;

  function flush() {
    if (current.length) blocks.push({ lines: current, lineNumber: startLine });
    current = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*#{1,6}\s+/.test(line)) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      blocks.push({ lines: [line], lineNumber: index + 1 });
      continue;
    }
    if (!current.length) startLine = index + 1;
    if (current.length && /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) flush();
    if (!current.length) startLine = index + 1;
    current.push(line.trim());
  }
  flush();
  return blocks;
}

function sentenceForMatch(text, index) {
  let start = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (/[.!?]/.test(text[cursor]) && /\s/.test(text[cursor + 1] || '')) start = cursor + 1;
  }
  let end = text.length;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (/[.!?]/.test(text[cursor]) && /\s/.test(text[cursor + 1] || '')) {
      end = cursor + 1;
      break;
    }
  }
  return text.slice(start, end).trim();
}

function hasUnnegatedDirective(text) {
  const cleaned = text
    .replace(/\bauto-sync\b/gi, '')
    .replace(/\b(?:sync|writeback)\s+(?:command|lane|step|workflow|machinery)\b/gi, '');
  const directivePattern = /\b(?:use|uses|run|runs|create|creates|add|adds|maintain|maintains|edit|edits|update|updates|follow|follows|publish|publishes|generate|generates|write|writes|sync|syncs|convert|converts|store|stores|keep|keeps|build|builds|pair|pairs|name|names|require|requires)\b/gi;
  let match;
  while ((match = directivePattern.exec(cleaned))) {
    const prefix = cleaned.slice(Math.max(0, match.index - 45), match.index);
    if (/\b(?:no|not|never|without|avoid|forbidden|removed|retired|cannot|can't|doesn't|does not|don't|do not|must not|should not|no longer)\b[\s\S]{0,40}$/i.test(prefix)) continue;
    return true;
  }
  return false;
}

function retiredTopologyHistoryOrNegativeExemption(clause) {
  const negative = /\b(?:no|not|never|without|absent|forbidden|removed|retired|avoid|outside|cannot|can't|doesn't|does not|don't|do not|must not|should not|no longer|not current|not used|not required|not maintained)\b/i.test(clause);
  const historical = /\b(?:historical|earlier|previous|formerly|superseded|legacy|used to|once|was|were)\b/i.test(clause);
  const current = /\b(?:current|currently|now|today|still)\b/i.test(clause);
  if (hasUnnegatedDirective(clause)) return false;
  if (negative) return true;
  return historical && !current;
}

function currentRepositoryScope(clause) {
  for (const pattern of currentRepositoryScopePatterns) {
    const match = pattern.exec(clause);
    if (!match) continue;
    if (pattern.source.startsWith('(?<!')) {
      const suffix = clause.slice(match.index + match[0].length);
      if (/^\.(?:project|json)\b/i.test(suffix) || /^[-_/\\]/.test(suffix)) continue;
    }
    return true;
  }
  return false;
}

function standalonePublisherEntrypoint(rel) {
  return standalonePublisherEntrypointPaths.has(slash(String(rel)));
}

function activePolicyScope(clause, rel = '') {
  if (standalonePublisherEntrypoint(rel) && !currentRepositoryScope(clause)) return 'standalone-publisher';
  return 'current-toolkit';
}

function activeTopologyFinding(text, rel = '') {
  for (const block of markdownBlocks(text)) {
    const candidate = block.lines.join(' ');
    for (const operation of detectRetiredTopologyOperations(candidate)) {
      const clause = sentenceForMatch(operation.text, operation.index);
      if (retiredTopologyHistoryOrNegativeExemption(clause)) continue;
      if (activePolicyScope(clause, rel) === 'standalone-publisher') continue;
      return { lineNumber: block.lineNumber, line: block.lines[0].trim(), message: operation.message };
    }
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
  activePolicyScope,
  detectRetiredTopologyOperations,
  legacyReferenceAllowed,
  parseFrontMatter,
  skillDirs,
  snapshot,
  validate
};
