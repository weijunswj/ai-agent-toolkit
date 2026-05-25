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
  auditSkill,
  auditSkillPortability,
  cleanMarkdownTarget,
  markdownTargets,
  skillDirs
};
