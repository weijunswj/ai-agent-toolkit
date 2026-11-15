#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function workspaceRootFromArgs(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--workspace') return args[i + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

const root = path.resolve(workspaceRootFromArgs() || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const supportDirs = ['references', 'examples', 'templates', 'agents', 'tools', 'packs', 'scripts'];
const localMentionPrefixes = new Set([...supportDirs, 'README.md', 'INSTALL.md', 'SOURCE.md']);
const removedSurfaceName = 'for_' + 'ai';
const removedSurfacePattern = new RegExp('(^|[^A-Za-z0-9_])' + 'for_' + 'ai\\/(skills|mcp)');

function slash(value) {
  return value.split(path.sep).join('/');
}

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function stripFrontMatter(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 4);
  return end === -1 ? text : text.slice(end + 4);
}

function cleanMarkdownTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (!target || target.startsWith('#') || target.startsWith('//')) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
  const whitespace = target.search(/\s/);
  if (whitespace !== -1) target = target.slice(0, whitespace);
  target = target.split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function markdownTargets(text) {
  const targets = [];
  const inline = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  const reference = /^\s*\[[^\]\n]+\]:[ \t]+(\S+)/gm;
  for (const regex of [inline, reference]) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const target = cleanMarkdownTarget(match[1]);
      if (target) targets.push(target);
    }
  }
  return targets;
}

function codePathMentions(text) {
  const mentions = [];
  const regex = /`((?:references|examples|templates|agents|tools|packs|scripts)\/[^`\n]+|README\.md|INSTALL\.md|SOURCE\.md)`/g;
  let match;
  while ((match = regex.exec(text)) !== null) mentions.push(match[1].trim());
  return mentions;
}

function normalizeMention(mention) {
  return slash(mention)
    .replace(/^\.\/+/, '')
    .replace(/[),.;:]+$/g, '');
}

function isSupportMention(target) {
  const normalized = normalizeMention(target);
  const first = normalized.split('/')[0];
  return localMentionPrefixes.has(first);
}

function localTargetRel(skillRel, target) {
  const normalized = normalizeMention(target);
  const base = slash(path.posix.dirname(skillRel));
  return slash(path.posix.normalize(path.posix.join(base, normalized)));
}

function skillDirs(rootDir = root) {
  const skillsRoot = path.join(rootDir, 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => slash(path.join('skills', entry.name)))
    .sort();
}

function hasSupportFiles(skillRel) {
  return supportDirs.some((dir) => fs.existsSync(resolveRel(path.posix.join(skillRel, dir))));
}

function wordCount(text) {
  const body = stripFrontMatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[#>*_\-[\]()`]/g, ' ');
  const words = body.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
  return words ? words.length : 0;
}

function externalLinks(text) {
  return text.match(/https?:\/\/[^\s)`>]+/g) || [];
}

function appearsPlaceholderOnly(text) {
  const body = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .trim();
  const words = body.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || [];
  return words.length <= 25 && /\b(todo|tbd|placeholder|coming soon|stub)\b/i.test(body);
}

function walkFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, files);
    else files.push(full);
  }
  return files;
}

function auditSkill(skillRel) {
  const errors = [];
  const skillDir = resolveRel(skillRel);
  const skillMd = path.join(skillDir, 'SKILL.md');
  const readme = path.join(skillDir, 'README.md');
  const install = path.join(skillDir, 'INSTALL.md');

  if (!fs.existsSync(skillMd)) {
    errors.push(`${skillRel} missing SKILL.md`);
    return errors;
  }
  if (!fs.existsSync(readme) && !fs.existsSync(install)) {
    errors.push(`${skillRel} missing README.md or INSTALL.md install/use note`);
  }

  const text = readText(skillMd);
  if (removedSurfacePattern.test(text)) {
    errors.push(`${skillRel}/SKILL.md references removed legacy skill or MCP paths`);
  }

  const words = wordCount(text);
  if (words < 80) {
    errors.push(`${skillRel}/SKILL.md is extremely thin (${words} words)`);
  }

  const links = externalLinks(text);
  const hasSupport = hasSupportFiles(skillRel);
  if (links.length > 1 && !hasSupport) {
    errors.push(`${skillRel}/SKILL.md has multiple external links but no local support folders`);
  }
  if (links.length && !hasSupport && /\b(required|must|normal use|runtime context|see|read)\b/i.test(text)) {
    errors.push(`${skillRel}/SKILL.md appears to route required runtime context through external URLs only`);
  }

  const localMentions = new Set([
    ...markdownTargets(text).filter(isSupportMention),
    ...codePathMentions(text).filter(isSupportMention)
  ]);
  for (const mention of localMentions) {
    const rel = localTargetRel(slash(path.join(skillRel, 'SKILL.md')), mention);
    if (!fs.existsSync(resolveRel(rel))) {
      errors.push(`${skillRel}/SKILL.md references missing local file or folder: ${mention}`);
    }
  }

  for (const full of walkFiles(skillDir)) {
    const rel = slash(path.relative(root, full));
    if (!/\.(md|txt|ya?ml|json)$/i.test(rel)) continue;
    const fileText = readText(full);
    if (removedSurfacePattern.test(fileText)) {
      errors.push(`${rel} references removed legacy skill or MCP paths`);
    }
    if (appearsPlaceholderOnly(fileText)) {
      errors.push(`${rel} appears to be placeholder-only`);
    }
  }

  return errors;
}

// Skill classes (repo/contracts/skill-publication.json): every skill folder is either portable (works
// anywhere) or Toolkit's own. A portable skill's SKILL.md (name, description and text) outside fenced
// code must not use a Toolkit term, or name an app unless depends_on_app gives the reason. Hits that
// were already there sit in the baseline, which only shrinks: a count must match the hits exactly.
const CONTRACT_REL = 'repo/contracts/skill-publication.json';
// The README's Skills section has one table per class, named by its first header cell.
const CLASSES = Object.freeze({ portable: 'Portable skill', toolkit: "Toolkit's own skill" });

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole words, any case, plural "s" included: "controllers" counts as "controller".
function countWord(text, word) {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(word)}s?(?![A-Za-z0-9])`, 'gi');
  return (text.match(pattern) || []).length;
}

// The text a portable skill is judged on: its whole SKILL.md (front matter included) outside fenced code.
function publicSkillText(skillRel) {
  return readText(path.join(resolveRel(skillRel), 'SKILL.md')).replace(/```[\s\S]*?```/g, ' ');
}

function readmeSkillGroups() {
  const readmePath = resolveRel('README.md');
  const readme = fs.existsSync(readmePath) ? readText(readmePath) : '';
  const section = readme.match(/^## Skills[ \t]*$(?<body>[\s\S]*?)(?=^## |(?![\s\S]))/m)?.groups?.body || '';
  const groups = new Map();
  let current = null;
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) {
      current = null;
      continue;
    }
    const row = line.match(/^\|\s*\[[^\]]+\]\(skills\/([^/)]+)\/\)\s*\|/);
    if (row) groups.set(row[1], current);
    else if (current === null) current = line.split('|')[1].trim();
  }
  return groups;
}

function auditSkillClasses(skills) {
  const errors = [];
  const contractPath = resolveRel(CONTRACT_REL);
  if (!fs.existsSync(contractPath)) return [`Missing ${CONTRACT_REL}`];
  let contract;
  try {
    contract = JSON.parse(readText(contractPath));
  } catch (error) {
    return [`${CONTRACT_REL} is invalid JSON: ${error.message}`];
  }
  // An empty or missing word list would quietly switch the check off, so it fails instead.
  const wordList = (key) => {
    const list = contract[key];
    if (Array.isArray(list) && list.length && list.every((word) => typeof word === 'string' && word.trim())) return list;
    errors.push(`${CONTRACT_REL} ${key} must be a non-empty list of words`);
    return [];
  };
  const terms = wordList('toolkit_terms');
  const apps = wordList('app_names');
  const entries = {};
  for (const [name, entry] of Object.entries(contract.skills || {})) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) entries[name] = entry;
    else errors.push(`${name} entry must be an object with class and reason`);
  }
  const folderNames = new Set(skills.map((skillRel) => path.posix.basename(skillRel)));

  for (const name of folderNames) {
    if (!Object.hasOwn(contract.skills || {}, name)) errors.push(`skills/${name} has no class in ${CONTRACT_REL}`);
  }
  for (const [name, entry] of Object.entries(entries)) {
    if (!folderNames.has(name)) errors.push(`${name} is classified but skills/${name} does not exist`);
    if (!Object.hasOwn(CLASSES, entry.class)) errors.push(`${name} class must be "portable" or "toolkit"`);
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) errors.push(`${name} needs a one-line reason`);
    for (const [app, why] of Object.entries(entry.depends_on_app || {})) {
      if (!apps.includes(app)) errors.push(`${name} depends_on_app "${app}" is not one of app_names`);
      else if (typeof why !== 'string' || !why.trim()) errors.push(`${name} depends_on_app "${app}" needs a reason`);
    }
  }

  const allowed = new Map();
  const baseline = contract.baseline === undefined ? [] : contract.baseline;
  if (!Array.isArray(baseline)) errors.push(`${CONTRACT_REL} baseline must be a list`);
  for (const raw of Array.isArray(baseline) ? baseline : []) {
    const item = raw && typeof raw === 'object' ? raw : {};
    if (entries[item.skill]?.class !== 'portable') {
      errors.push(`baseline entry for ${item.skill} must name a portable skill`);
    } else if (!terms.includes(item.term) && !apps.includes(item.term)) {
      errors.push(`baseline entry "${item.term}" for ${item.skill} is not one of toolkit_terms or app_names`);
    } else if (!Number.isInteger(item.count) || item.count < 1) {
      errors.push(`baseline entry "${item.term}" for ${item.skill} needs a whole-number count above 0`);
    } else if (allowed.has(`${item.skill}\0${item.term}`)) {
      errors.push(`baseline lists "${item.term}" for ${item.skill} more than once`);
    } else {
      allowed.set(`${item.skill}\0${item.term}`, item.count);
    }
  }

  for (const [name, entry] of Object.entries(entries)) {
    if (entry.class !== 'portable' || !folderNames.has(name)) continue;
    const text = publicSkillText(`skills/${name}`);
    const checks = [
      ...terms.map((term) => ({ term, label: `uses Toolkit term "${term}"`, exempt: false })),
      ...apps.map((app) => ({ term: app, label: `names app "${app}"`, exempt: Object.hasOwn(entry.depends_on_app || {}, app) }))
    ];
    for (const check of checks) {
      if (check.exempt) continue;
      const hits = countWord(text, check.term);
      const key = `${name}\0${check.term}`;
      const limit = allowed.has(key) ? allowed.get(key) : 0;
      if (hits > limit) {
        const reason = apps.includes(check.term) ? ' with no depends_on_app reason' : '';
        errors.push(`skills/${name} is portable but ${check.label} ${hits} time(s)${reason}; allowed ${limit}`);
      } else if (allowed.has(key) && hits < limit) {
        const fix = hits ? `lower the count to ${hits}` : 'remove the entry';
        errors.push(`${CONTRACT_REL} baseline allows "${check.term}" ${limit} time(s) in ${name} but it now appears ${hits} time(s); ${fix}`);
      }
    }
  }

  const groups = readmeSkillGroups();
  for (const [name, entry] of Object.entries(entries)) {
    const expected = CLASSES[entry.class];
    if (!expected || !folderNames.has(name)) continue;
    const listed = groups.get(name);
    if (listed === undefined) errors.push(`README.md does not list skills/${name} in the "${expected}" table`);
    else if (listed !== expected) errors.push(`README.md lists skills/${name} in the "${listed}" table but its class is ${entry.class}`);
  }
  return errors;
}

function auditSkillPortability() {
  const skills = skillDirs(root);
  const errors = [];
  if (!fs.existsSync(path.join(root, 'skills'))) {
    errors.push('Missing skills/ directory');
    return { skills, errors };
  }
  for (const skillRel of skills) {
    errors.push(...auditSkill(skillRel));
  }
  errors.push(...auditSkillClasses(skills));
  if (fs.existsSync(path.join(root, removedSurfaceName, 'skills'))) {
    errors.push('Removed legacy skills directory is still present');
  }
  return { skills, errors };
}

function main() {
  const result = auditSkillPortability(root);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${result.errors.length} skill portability error(s).`);
    process.exit(1);
  }
  console.log(`Skill portability audit passed for ${result.skills.length} skill(s).`);
}

if (require.main === module) main();

module.exports = {
  auditSkillPortability,
  skillDirs
};
