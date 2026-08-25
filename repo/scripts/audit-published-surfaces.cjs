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
const activeTopologyPatterns = [
  { pattern: /\b_projects(?:\b|[\\/])/i, message: 'uses retired _projects source ownership' },
  { pattern: /\b_main(?:\b|[\\/])/i, message: 'uses standalone retired _main source ownership' },
  { pattern: /\bproject\s+module\b[\s\S]{0,120}\bpublished\s+skill\b/i, message: 'instructs Toolkit project-module plus published-skill creation' },
  { pattern: /\bproject[- ]to[- ]skill\b[\s\S]{0,100}\b(?:publish|publishing|published|generate|generated|copy|writeback|sync)\b/i, message: 'instructs retired project-to-skill publishing' },
  { pattern: /\bsource[- ]to[- ]surface\b[\s\S]{0,120}\b(?:workflow|publish|publishing|published|publisher|generate|generated|copy|writeback|sync)\b/i, message: 'instructs Toolkit source-to-surface publishing' },
  { pattern: /\b(?:workflow|publish|publishing|published|(?<!-)publisher|generate|generated|copy|writeback|sync)\b[\s\S]{0,120}\bsource[- ]to[- ]surface\b/i, message: 'instructs Toolkit source-to-surface publishing' },
  { pattern: /\b(?:generated|deterministic)\s+(?:skill\s+)?(?:copies?|publication|publishing|writeback)\b/i, message: 'instructs retired generated skill copies or writeback' },
  { pattern: /\b(?:skill\s+)?(?:copies?|publication|publishing|writeback)\s+(?:through|from|via)\s+(?:generated|deterministic)\b/i, message: 'instructs retired generated skill copies or writeback' },
  { pattern: /\b(?:node\s+)?repo\/scripts\/(?:sync-toolkit-projects|package-skills|package-packs)\.cjs\b/i, message: 'instructs a retired publishing or sync command' }
];

function activePolicyFiles() {
  const docs = walk('repo/docs')
    .filter((rel) => rel.endsWith('.md'))
    .filter((rel) => !historicalPolicyPaths.has(rel))
    .filter((rel) => !historicalPolicyPathPrefixes.some((prefix) => rel.startsWith(prefix)));
  return [...new Set([...activePolicyRootPaths, ...docs])].filter(exists).sort();
}

function nonOperationalContext(text) {
  return /\b(?:historical|earlier|previous|superseded|legacy|audit|finding|evidence)\b/i.test(text)
    || /\b(?:no|not|never|without|absent|forbidden|removed|avoid|outside|cannot|can't)\b/i.test(text)
    || /\b(?:do|does|did|must)\s+not\b/i.test(text);
}

function activeTopologyFinding(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let sectionHeading = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*#{1,6}\s+/.test(line)) sectionHeading = line;
    const context = `${sectionHeading}\n${line}`;
    if (nonOperationalContext(context)) continue;
    const window = line;
    for (const { pattern, message } of activeTopologyPatterns) {
      if (pattern.test(window)) return { lineNumber: index + 1, line: line.trim(), message };
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
    const finding = activeTopologyFinding(readText(rel));
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
  legacyReferenceAllowed,
  parseFrontMatter,
  skillDirs,
  snapshot,
  validate
};
