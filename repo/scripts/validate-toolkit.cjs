#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const docContractSync = require('./sync-repo-doc-contract.cjs');
const agentInstructionSync = require('./sync-agent-instruction-shims.cjs');
const sourceLockAudit = require('./audit-project-source-locks.cjs');
const surfaceAudit = require('./audit-published-surfaces.cjs');
const skillPortabilityAudit = require('./audit-skill-portability.cjs');

function workspaceRootFromArgs(args = process.argv.slice(2)) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--workspace') return args[index + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

const root = path.resolve(workspaceRootFromArgs() || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const legacyProjectToken = '_' + 'projects';
const legacyPublisherToken = 'curated_' + 'output_for_ai';
const retiredSkillCreationReviewEvidencePatterns = [
  { pattern: /sync-toolkit-projects\.cjs/i, message: 'references retired sync-toolkit-projects.cjs' },
  { pattern: /_projects[\\/]/i, message: 'references a retired _projects path' },
  { pattern: /curated_output_for_ai|curated[- ]output/i, message: 'references retired curated-output publishing' },
  { pattern: /(?:^|[\s"'`])_main(?:[\\/]|[\s"'`]|$)/i, message: 'references a retired _main source path' },
  {
    pattern: /\bsource[- ]to[- ]surface\b[\s\S]{0,120}\b(?:publisher|publish(?:er|ing|ed)?|copy|writeback)\b/i,
    message: 'claims retired source-to-surface publishing'
  },
  {
    pattern: /\b(?:publisher|publish(?:er|ing|ed)?|copy|writeback)\b[\s\S]{0,120}\bsource[- ]to[- ]surface\b/i,
    message: 'claims retired source-to-surface publishing'
  },
  {
    pattern: /\b(?:generated|deterministic)\b[\s\S]{0,80}\bsource[- ]to[- ]surface\b/i,
    message: 'claims retired source-to-surface publishing'
  },
  {
    pattern: /\bsource[- ]to[- ]surface\b[\s\S]{0,80}\b(?:generated|deterministic)\b/i,
    message: 'claims retired source-to-surface publishing'
  },
  {
    pattern: /\b(?:generated|deterministic)\s+(?:skill\s+)?(?:copies?|publication|publishing|writeback)\b/i,
    message: 'claims retired generated or deterministic publication'
  },
  {
    pattern: /\b(?:create|creating|add|adding|maintain|use|publish|publishing)\b[\s\S]{0,100}\bproject\s+module\b[\s\S]{0,100}\bpublished\s+skill\b/i,
    message: 'claims retired Toolkit project-module plus published-skill publishing'
  }
];
const skillCreationOperationalEvidenceFields = [
  'existing_skill_review',
  'trigger',
  'decision',
  'decision_reason',
  'unique_value',
  'runtime_footprint',
  'local_assets',
  'output_contract',
  'anti_bloat_review',
  'safety_boundary',
  'source_provenance',
  'third_party_audit',
  'publisher_workflow',
  'routing'
];
const IMMUTABLE_GRANDFATHERED_SKILL_IDS = Object.freeze([
  'agent-skill-supply-chain-audit',
  'ai-coding-agent-rules',
  'context-preserving-ai-publisher',
  'knowledge-index-updater',
  'n8n-agent-rules',
  'n8n-local-setup',
  'n8n-workflow-helper-scripts',
  'n8n-workflow-templates',
  'secure-cicd-installer',
  'ui-ux-secure-frontend-design',
  'windows-localhost-workflows'
]);
const ignoredDirs = new Set(['.git', 'node_modules', '_dist', 'dist', 'coverage', '.tmp', '.n8n-local', '.n8n-production-cloudflare', '.to-sanitise', '.sanitised', '.n8n-workflow-backups', '.claude']);
const allowedRootEntries = new Set([
  '.git', '.github', '.gitattributes', '.gitignore', '.codex-plugin', '.claude-plugin', '.claude', '.agents',
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'README.md', 'package.json', 'repo', 'skills'
]);
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/
];
const executablePrefixes = [
  'repo/scripts/', 'repo/tests/', '.github/workflows/',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/',
  'skills/ui-ux-secure-frontend-design/tools/design-system-generator/tests/',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/',
  'skills/n8n-agent-rules/scripts/', 'skills/n8n-local-setup/templates/.n8n-local/',
  'skills/n8n-local-setup/templates/.n8n-production-cloudflare/',
  'skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/'
];
const executableExtensions = new Set(['.ps1', '.cmd', '.bat', '.cjs', '.mjs', '.js', '.ts', '.tsx', '.py', '.sh']);
const allowedTrackedTemplatePrefixes = [
  'skills/n8n-local-setup/templates/.n8n-local/',
  'skills/n8n-local-setup/templates/.n8n-production-cloudflare/'
];

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function existsRel(relPath) {
  return fs.existsSync(resolveRel(relPath));
}

function readText(relPath) {
  return fs.readFileSync(resolveRel(relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function walk(dir = root, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory() && ignoredDirs.has(item.name)) continue;
    const fullPath = path.join(dir, item.name);
    const relPath = slash(path.relative(root, fullPath));
    entries.push({ fullPath, relPath, dirent: item });
    if (item.isDirectory()) walk(fullPath, entries);
  }
  return entries;
}

function listFiles() {
  return walk().filter((entry) => entry.dirent.isFile());
}

function fail(errors, message) {
  errors.push(message);
}

function parseFrontMatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return null;
  const result = {};
  for (const line of normalized.slice(4, end).trim().split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function skillDirs() {
  const skillsRoot = resolveRel('skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => slash(path.relative(root, path.join(skillsRoot, entry.name))))
    .sort();
}

function markdownSection(text, heading) {
  const match = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').exec(text);
  if (!match) return '';
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

function parseSkillRouting(routing) {
  const routedSection = markdownSection(routing, 'Current Toolkit Skill Routing');
  const omittedSection = markdownSection(routing, 'Intentionally Omitted Skills');
  const routed = [...routedSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]).sort();
  const omitted = [...omittedSection.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/gm)]
    .map((match) => ({ name: match[1], reason: match[2].trim() }))
    .filter((entry) => entry.name !== 'Skill')
    .sort((left, right) => left.name.localeCompare(right.name));
  return { routed, omitted };
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function validateRootTopology(errors) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    if (!allowedRootEntries.has(entry.name)) fail(errors, `Unexpected root entry: ${entry.name}`);
  }
  if (existsRel(`${legacyProjectToken}/`)) fail(errors, `Legacy ${legacyProjectToken}/ tree must not exist`);
  if (existsRel('mcp')) fail(errors, 'Repo-wide mcp/ surface must not exist');
}

function validateForbiddenFiles(errors) {
  for (const entry of listFiles()) {
    const lower = entry.relPath.toLowerCase();
    const name = path.basename(entry.relPath);
    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) fail(errors, `Forbidden env file: ${entry.relPath}`);
    if (/\.(zip|tgz)$/i.test(name)) fail(errors, `Generated package artifact present: ${entry.relPath}`);
    if (/(?:\.live-(?:export|import)|\.credentials?|\.binding)\.json$/i.test(name)) fail(errors, `Sensitive runtime file present: ${entry.relPath}`);
    if (/\.(pem|key|p12|pfx)$/i.test(name) || name === 'id_rsa' || name === 'id_ed25519') fail(errors, `Private key/certificate file present: ${entry.relPath}`);
    if (lower.endsWith('/pack.json')) fail(errors, `Pack manifest is retired: ${entry.relPath}`);
  }
}

function validateSkills(errors) {
  for (const skillDir of skillDirs()) {
    const skillPath = `${skillDir}/SKILL.md`;
    if (!existsRel(skillPath)) {
      fail(errors, `${skillDir} missing SKILL.md`);
      continue;
    }
    if (!existsRel(`${skillDir}/README.md`) && !existsRel(`${skillDir}/INSTALL.md`)) fail(errors, `${skillDir} missing README.md or INSTALL.md`);
    const frontMatter = parseFrontMatter(readText(skillPath));
    if (!frontMatter?.name || !frontMatter.description) fail(errors, `${skillPath} missing frontmatter name or description`);
    if (frontMatter?.name !== path.posix.basename(skillDir)) fail(errors, `${skillPath} frontmatter name does not match its folder`);
  }
}

function trimValidationTarget(value) {
  return String(value).replace(/[),.;:!?\]}]+$/g, '');
}

function validationCommandTargetCandidates(command) {
  const source = String(command);
  const candidates = [];
  const pattern = /(?:^|[^A-Za-z0-9_-])((?:(?:[A-Za-z]:[\\/])|(?:\.{1,2}[\\/])|[\\/])?repo(?:[\\/]+[A-Za-z0-9._-]+)*[\\/]+(?:scripts|tests)(?:[\\/]+[^\s"'`),;:!?]+)*)/gi;
  for (const match of source.matchAll(pattern)) {
    const raw = trimValidationTarget(match[1]);
    if (!raw) continue;
    const start = match.index + match[0].length - match[1].length;
    candidates.push({ raw, preceding: start > 0 ? source[start - 1] : '' });
  }
  return candidates;
}

function isCanonicalValidationTarget(candidate) {
  const target = candidate.raw;
  if (candidate.preceding === '/' || candidate.preceding === '\\' || candidate.preceding === '.') return false;
  if (path.posix.isAbsolute(target) || path.win32.isAbsolute(target)) return false;
  if (!/^repo\/(?:scripts|tests)\//.test(target)) return false;
  const parts = target.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return false;
  return path.posix.normalize(target) === target;
}

function validationCommandTargetFinding(command) {
  for (const candidate of validationCommandTargetCandidates(command)) {
    if (!isCanonicalValidationTarget(candidate)) {
      return { target: candidate.raw, message: 'contains a noncanonical repository target spelling' };
    }
  }
  return null;
}

function validationCommandTargets(command) {
  return validationCommandTargetCandidates(command)
    .filter(isCanonicalValidationTarget)
    .map((candidate) => candidate.raw);
}

function retiredSkillCreationReviewFinding(value) {
  return retiredSkillCreationReviewEvidencePatterns.find(({ pattern }) => pattern.test(String(value))) || null;
}

function validateSkillCreationReviewEvidence(errors, baselinePath, skill, review) {
  const publisherWorkflow = String(review.publisher_workflow || '');
  if (!/\bdirect[- ]canonical\b/i.test(publisherWorkflow)) {
    fail(errors, `${baselinePath} skill_creation_review.${skill}.publisher_workflow must state direct-canonical maintenance`);
  }
  if (!publisherWorkflow.includes(`skills/${skill}/`)) {
    fail(errors, `${baselinePath} skill_creation_review.${skill}.publisher_workflow must name skills/${skill}/ as the canonical skill surface`);
  }
  if (!/\brepo\/\*\*/i.test(publisherWorkflow)) {
    fail(errors, `${baselinePath} skill_creation_review.${skill}.publisher_workflow must name canonical repo/** maintenance paths`);
  }

  for (const field of skillCreationOperationalEvidenceFields) {
    const finding = retiredSkillCreationReviewFinding(review[field]);
    if (finding) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.${field} ${finding.message}`);
    }
  }

  const validation = Array.isArray(review.validation) ? review.validation : [];
  let hasRepositoryValidator = false;
  let hasFocusedValidation = false;
  for (const command of validation) {
    const commandText = String(command);
    const finding = retiredSkillCreationReviewFinding(commandText);
    if (finding) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.validation command ${finding.message}`);
    }
    const targetFinding = validationCommandTargetFinding(commandText);
    if (targetFinding) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.validation command ${targetFinding.message}: ${targetFinding.target}`);
    }
    if (/^node\s+repo\/scripts\/validate-toolkit\.cjs(?:\s|$)/.test(commandText.trim())) {
      hasRepositoryValidator = true;
    }
    for (const target of validationCommandTargets(commandText)) {
      if (!existsRel(target) || !fs.statSync(resolveRel(target)).isFile()) {
        fail(errors, `${baselinePath} skill_creation_review.${skill}.validation references missing current target ${target}`);
      }
      if (target === 'repo/scripts/validate-toolkit.cjs') hasRepositoryValidator = true;
      if (target === 'repo/tests/skill-routing.test.cjs'
        || target.includes(`repo/tests/${skill}`)
        || target.includes(`repo/tests/toolkit-${skill}`)
        || (skill === 'toolkit-setup' && target.startsWith('repo/tests/toolkit-local-bridge'))) {
        hasFocusedValidation = true;
      }
    }
  }
  if (!hasRepositoryValidator) {
    fail(errors, `${baselinePath} skill_creation_review.${skill}.validation must include node repo/scripts/validate-toolkit.cjs`);
  }
  if (!hasFocusedValidation) {
    fail(errors, `${baselinePath} skill_creation_review.${skill}.validation must include a current focused routing or skill check`);
  }
}

function validateSkillCreationGate(errors) {
  const baselinePath = 'repo/docs/skill-creation-center-baseline.json';
  let baseline;
  try {
    baseline = readJson(baselinePath);
  } catch (error) {
    fail(errors, `${baselinePath} is not valid JSON: ${error.message}`);
    return;
  }

  if (baseline.schema_version !== 2) fail(errors, `${baselinePath} schema_version must be 2`);
  const grandfathered = baseline.grandfathered_skill_ids;
  const reviewedIds = baseline.reviewed_skill_ids;
  const reviewMap = baseline.skill_creation_review;
  if (!Array.isArray(grandfathered) || grandfathered.some((id) => typeof id !== 'string' || !id.trim())) {
    fail(errors, `${baselinePath} grandfathered_skill_ids must be an array of non-empty strings`);
    return;
  }
  if (!Array.isArray(reviewedIds) || reviewedIds.some((id) => typeof id !== 'string' || !id.trim())) {
    fail(errors, `${baselinePath} reviewed_skill_ids must be an array of non-empty strings`);
    return;
  }
  if (!reviewMap || typeof reviewMap !== 'object' || Array.isArray(reviewMap)) {
    fail(errors, `${baselinePath} skill_creation_review must be a keyed object`);
    return;
  }

  for (const [label, values] of [['grandfathered_skill_ids', grandfathered], ['reviewed_skill_ids', reviewedIds]]) {
    if (JSON.stringify(values) !== JSON.stringify([...values].sort((left, right) => left.localeCompare(right)))) {
      fail(errors, `${baselinePath} ${label} must be sorted`);
    }
    if (new Set(values).size !== values.length) fail(errors, `${baselinePath} ${label} must not contain duplicates`);
  }

  if (JSON.stringify(grandfathered) !== JSON.stringify(IMMUTABLE_GRANDFATHERED_SKILL_IDS)) {
    fail(errors, `${baselinePath} grandfathered_skill_ids must equal the immutable pre-gate legacy set`);
  }

  const grandfatheredSet = new Set(grandfathered);
  const currentSkills = skillDirs().map((relPath) => path.basename(relPath));
  const currentSet = new Set(currentSkills);
  const mapIds = Object.keys(reviewMap).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify([...reviewedIds].sort((left, right) => left.localeCompare(right))) !== JSON.stringify(mapIds)) {
    fail(errors, `${baselinePath} reviewed_skill_ids must match skill_creation_review keys`);
  }

  for (const skill of currentSkills) {
    const isGrandfathered = grandfatheredSet.has(skill);
    const hasReview = Object.prototype.hasOwnProperty.call(reviewMap, skill);
    if (isGrandfathered && hasReview) fail(errors, `${baselinePath} must not review grandfathered skill ${skill} in the post-gate map`);
    if (!isGrandfathered && !hasReview) fail(errors, `${baselinePath} missing skill_creation_review evidence for current skill ${skill}`);
  }

  const requiredStrings = [
    'existing_skill_review',
    'trigger',
    'decision',
    'decision_reason',
    'unique_value',
    'runtime_footprint',
    'local_assets',
    'output_contract',
    'anti_bloat_review',
    'safety_boundary',
    'third_party_audit',
    'publisher_workflow',
    'routing'
  ];
  for (const [skill, review] of Object.entries(reviewMap)) {
    if (!currentSet.has(skill)) {
      fail(errors, `${baselinePath} contains stale skill_creation_review evidence for ${skill}`);
      continue;
    }
    if (grandfatheredSet.has(skill)) fail(errors, `${baselinePath} post-gate review must not include grandfathered skill ${skill}`);
    if (!review || typeof review !== 'object' || Array.isArray(review)) {
      fail(errors, `${baselinePath} skill_creation_review.${skill} must be an object`);
      continue;
    }
    for (const key of requiredStrings) {
      if (typeof review[key] !== 'string' || review[key].trim().length < 12) {
        fail(errors, `${baselinePath} skill_creation_review.${skill}.${key} must be a non-empty evidence string`);
      }
    }
    if (!['extend_existing_skill', 'new_project_skill'].includes(review.decision)) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.decision must be extend_existing_skill or new_project_skill`);
    }
    if (!['first_party', 'third_party_audited', 'adapted_external', 'inspiration_only'].includes(review.source_provenance)) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.source_provenance is invalid`);
    }
    if (['third_party_audited', 'adapted_external'].includes(review.source_provenance) && !/agent-skill-supply-chain-audit/i.test(review.third_party_audit || '')) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.third_party_audit must name agent-skill-supply-chain-audit`);
    }
    if (!Array.isArray(review.validation) || review.validation.length === 0 || review.validation.some((item) => typeof item !== 'string' || !item.trim())) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.validation must list at least one validation command`);
    }
    if (!String(review.existing_skill_review || '').toLowerCase().includes(skill.toLowerCase())) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.existing_skill_review must mention ${skill}`);
    }
    if (!String(review.routing || '').toLowerCase().includes(skill.toLowerCase()) || !/\b(?:route|routed|routes|routing|omit|omits|omitted|omission)\b/i.test(review.routing || '')) {
      fail(errors, `${baselinePath} skill_creation_review.${skill}.routing must document whether ${skill} is routed or intentionally omitted`);
    }
    validateSkillCreationReviewEvidence(errors, baselinePath, skill, review);
  }
}

function validateSkillRouting(errors) {
  const routingPath = 'repo/contracts/agent-rules/toolkit-skill-routing.md';
  if (!existsRel(routingPath)) {
    fail(errors, `Missing routing source: ${routingPath}`);
    return;
  }
  const { routed, omitted } = parseSkillRouting(readText(routingPath));
  const current = skillDirs().map((rel) => path.basename(rel));
  const currentSet = new Set(current);
  const omittedNames = omitted.map((entry) => entry.name);
  for (const name of duplicates(routed)) fail(errors, `${routingPath} routes ${name} more than once`);
  for (const name of duplicates(omittedNames)) fail(errors, `${routingPath} omits ${name} more than once`);
  for (const name of routed) {
    if (omittedNames.includes(name)) fail(errors, `${routingPath} both routes and omits ${name}`);
    if (!currentSet.has(name)) fail(errors, `${routingPath} routes missing skill ${name}`);
  }
  for (const name of current) {
    if (!routed.includes(name) && !omittedNames.includes(name)) fail(errors, `${routingPath} is missing routing or omission for ${name}`);
  }
  for (const entry of omitted) {
    if (!entry.reason || entry.reason.length < 12) fail(errors, `${routingPath} omission for ${entry.name} needs a concrete reason`);
  }
}

function validateSkillSafetyMatrix(errors) {
  const matrixPath = 'repo/docs/SKILL-SAFETY-MATRIX.md';
  if (!existsRel(matrixPath)) {
    fail(errors, `Missing skill safety matrix: ${matrixPath}`);
    return;
  }
  const matrix = readText(matrixPath);
  const header = matrix.split('\n').find((line) => line.startsWith('| Skill |'));
  const expectedColumns = ['Skill', 'Primary Trigger', 'Risk Class', 'Local Writes', 'Scripts Or Tools', 'External Or Live Risk', 'Approval Boundary', 'Companion Skills', 'Source/Provenance', 'Notes And Boundaries'];
  if (!header || JSON.stringify(header.split('|').slice(1, -1).map((cell) => cell.trim())) !== JSON.stringify(expectedColumns)) {
    fail(errors, `${matrixPath} has an invalid safety table header`);
    return;
  }
  const rows = [...matrix.matchAll(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.+)$/gm)]
    .map((match) => ({ name: match[2].match(/^\.\.\/\.\.\/skills\/([^/]+)\/$/)?.[1] || '', displayName: match[1], link: match[2], cells: match[0].split('|').slice(1, -1).map((cell) => cell.trim()) }))
    .filter((row) => row.link.startsWith('../../skills/'));
  const names = rows.map((row) => row.name).sort();
  const current = skillDirs().map((rel) => path.basename(rel)).sort();
  if (JSON.stringify(names) !== JSON.stringify(current)) fail(errors, `${matrixPath} must cover current skills exactly once`);
  if (duplicates(names).length) fail(errors, `${matrixPath} lists a skill more than once`);
  for (const row of rows) {
    if (!row.name || row.link !== `../../skills/${row.name}/`) fail(errors, `${matrixPath} row for ${row.displayName || row.name} has the wrong link`);
    if (row.cells.length !== expectedColumns.length || row.cells.some((cell) => !cell)) fail(errors, `${matrixPath} row for ${row.displayName || row.name} has incomplete cells`);
    if (!/^(Low|Medium|High)$/.test(row.cells[2] || '')) fail(errors, `${matrixPath} row for ${row.displayName || row.name} has an invalid risk class`);
  }
}

function validateReadmeSkillTable(errors) {
  const readme = readText('README.md');
  const section = markdownSection(readme, 'Skills');
  const rows = [...section.matchAll(/^\|\s*\[([^\]]+)\]\(skills\/([^/)]+)\/\)\s*\|/gm)].map((match) => match[2]).sort();
  const current = skillDirs().map((rel) => path.basename(rel)).sort();
  if (JSON.stringify(rows) !== JSON.stringify(current)) fail(errors, 'README Skills table must cover current skills exactly once');
  if (duplicates(rows).length) fail(errors, 'README Skills table lists a skill more than once');
}

function validatePluginVersions(errors) {
  const versionPath = 'repo/contracts/toolkit-local-bridge/version.json';
  const sourceCodex = 'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json';
  const sourceClaude = 'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json';
  if (!existsRel(versionPath)) {
    fail(errors, `Missing plugin version contract: ${versionPath}`);
    return;
  }
  let version;
  try {
    version = readJson(versionPath).version;
  } catch (error) {
    fail(errors, `${versionPath} is invalid JSON: ${error.message}`);
    return;
  }
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail(errors, `${versionPath} must contain a semver version`);
  for (const rel of [sourceCodex, sourceClaude, '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    if (!existsRel(rel)) {
      fail(errors, `Missing plugin manifest: ${rel}`);
      continue;
    }
    const manifest = readJson(rel);
    if (manifest.name !== 'ai-agent-toolkit') fail(errors, `${rel} has the wrong plugin name`);
    if (manifest.version !== version) fail(errors, `${rel} version does not match ${version}`);
  }
  for (const rel of [
    'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json',
    'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json',
    'repo/contracts/toolkit-local-bridge/claude-plugin/marketplace.json',
    '.codex-plugin/hooks/hooks.json', '.claude-plugin/hooks/hooks.json', '.claude-plugin/marketplace.json',
    '.codex-plugin/assets/composer-icon.png', '.codex-plugin/assets/logo.png'
  ]) if (!existsRel(rel)) fail(errors, `Missing plugin package file: ${rel}`);

  const constants = [
    ['repo/scripts/toolkit-local-bridge.cjs', 'BRIDGE_VERSION'],
    ['repo/scripts/setup-codex-toolkit-plugin.cjs', 'EXPECTED_TOOLKIT_VERSION'],
    ['repo/scripts/codex-delegation-config.cjs', 'TOOLKIT_CLIENT_VERSION'],
    ['repo/scripts/toolkit-agent-control.cjs', 'CONTROL_VERSION']
  ];
  for (const [rel, name] of constants) {
    const match = readText(rel).match(new RegExp(`const\\s+${name}\\s*=\\s*['\"]([^'\"]+)['\"]`));
    if (!match) fail(errors, `${rel} is missing ${name}`);
    else if (match[1] !== version) fail(errors, `${rel} ${name} does not match ${version}`);
  }
  if (!/version:\s*BRIDGE_VERSION/.test(readText('repo/scripts/toolkit-local-bridge.cjs'))) fail(errors, 'AG2 bridge metadata must use BRIDGE_VERSION');
}

function validateManagedSurfaces(errors) {
  const docResult = docContractSync.validateAndSync({ mode: 'check' });
  for (const error of docResult.errors) fail(errors, error);
  const agentResult = agentInstructionSync.validateAndSync({ mode: 'check' });
  for (const error of agentResult.errors) fail(errors, error);
}

function validateSourceWatch(errors) {
  const result = sourceLockAudit.auditSourceLocks();
  for (const error of result.errors) fail(errors, error);
  for (const rel of ['repo/source-watch/advisory-targets.json', 'repo/source-watch/review-state.json']) {
    if (!existsRel(rel)) fail(errors, `Missing source-watch state: ${rel}`);
    else {
      try { readJson(rel); } catch (error) { fail(errors, `${rel} is invalid JSON: ${error.message}`); }
    }
  }
  const workflow = existsRel('.github/workflows/source-watch-pr.yml') ? readText('.github/workflows/source-watch-pr.yml') : '';
  if (!workflow.includes('This PR is a review notification only.')) fail(errors, 'Source-watch PR workflow must remain notification-only');
  if (workflow.includes('sync-toolkit-projects.cjs') || workflow.includes('package-packs.cjs')) fail(errors, 'Source-watch workflow references retired publisher machinery');
}

function validateContracts(errors) {
  for (const entry of listFiles().filter((item) => item.relPath.startsWith('repo/contracts/') && item.relPath.endsWith('.json'))) {
    try { JSON.parse(fs.readFileSync(entry.fullPath, 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { fail(errors, `${entry.relPath} is invalid JSON: ${error.message}`); }
  }
}

function validateLegacyReferences(errors) {
  const excluded = new Set(['repo/scripts/validate-toolkit.cjs', 'repo/scripts/audit-published-surfaces.cjs']);
  for (const entry of listFiles()) {
    if (excluded.has(entry.relPath)) continue;
    if (!/\.(md|json|ya?ml|txt|cjs|js|ps1|cmd|sh|py)$/i.test(entry.relPath)) continue;
    if (entry.relPath.endsWith('.n6.json')) continue;
    if (surfaceAudit.legacyReferenceAllowed(entry.relPath)) continue;
    const text = fs.readFileSync(entry.fullPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (text.includes(`${legacyProjectToken}/`) || text.includes(legacyPublisherToken)) fail(errors, `${entry.relPath} references the retired project/publisher topology`);
  }
}

function validateExecutables(errors) {
  for (const entry of listFiles()) {
    const ext = path.extname(entry.relPath).toLowerCase();
    if (!executableExtensions.has(ext)) continue;
    if (ext === '.py' && !entry.relPath.startsWith('skills/ui-ux-secure-frontend-design/tools/design-system-generator/') && !entry.relPath.startsWith('repo/tests/')) {
      fail(errors, `Python file outside approved local-only locations: ${entry.relPath}`);
    }
    if (!executablePrefixes.some((prefix) => entry.relPath.startsWith(prefix))) fail(errors, `Executable file outside approved locations: ${entry.relPath}`);
  }
}

function validateNoSecrets(errors) {
  for (const entry of listFiles()) {
    if (!/\.(md|json|ya?ml|txt|cjs|js|ps1|cmd|sh|py)$/i.test(entry.relPath)) continue;
    const text = fs.readFileSync(entry.fullPath, 'utf8');
    for (const pattern of secretPatterns) if (pattern.test(text)) fail(errors, `Possible secret pattern in ${entry.relPath}`);
  }
}

function validateTrackedLocalRuntimeFiles(errors) {
  if (!fs.existsSync(path.join(root, '.git'))) return;
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return;
  for (const rel of result.stdout.split('\0').filter(Boolean).map(slash)) {
    if (rel.split('/').some((segment) => ignoredDirs.has(segment))
      && !allowedTrackedTemplatePrefixes.some((prefix) => rel.startsWith(prefix))) {
      fail(errors, `Tracked local runtime file is not allowed: ${rel}`);
    }
  }
}

function validate() {
  const errors = [];
  validateRootTopology(errors);
  validateForbiddenFiles(errors);
  validateSkills(errors);
  validateSkillCreationGate(errors);
  validateSkillRouting(errors);
  validateSkillSafetyMatrix(errors);
  validateReadmeSkillTable(errors);
  validatePluginVersions(errors);
  validateManagedSurfaces(errors);
  validateSourceWatch(errors);
  validateContracts(errors);
  validateLegacyReferences(errors);
  validateExecutables(errors);
  validateNoSecrets(errors);
  validateTrackedLocalRuntimeFiles(errors);
  const surfaceResult = surfaceAudit.validate(surfaceAudit.snapshot());
  for (const error of surfaceResult) fail(errors, error);
  const portabilityResult = skillPortabilityAudit.auditSkillPortability(root);
  for (const error of portabilityResult.errors) fail(errors, error);
  return errors;
}

if (require.main === module) {
  const errors = validate();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} toolkit validation error(s).`);
    process.exit(1);
  }
  console.log(`Toolkit validation passed for ${skillDirs().length} skill(s).`);
}

module.exports = {
  parseFrontMatter,
  parseSkillRouting,
  skillDirs,
  validationCommandTargetFinding,
  validationCommandTargets,
  validateSkillCreationGate,
  IMMUTABLE_GRANDFATHERED_SKILL_IDS,
  validate
};
