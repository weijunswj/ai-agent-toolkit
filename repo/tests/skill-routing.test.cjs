'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const routingPartial = path.join(
  repoRoot,
  '_projects',
  'development',
  'ai-coding-agent-rules',
  '_main',
  '_partials',
  'toolkit-skill-routing.md'
);

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function skillNames() {
  return fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(repoRoot, 'skills', name, 'SKILL.md')))
    .sort();
}

function section(text, heading) {
  const marker = `## ${heading}\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const contentStart = start + marker.length;
  const nextHeading = text.indexOf('\n## ', contentStart);
  return nextHeading === -1 ? text.slice(contentStart) : text.slice(contentStart, nextHeading);
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

test('toolkit skill routing covers current skill folders or documents omissions', () => {
  const routing = readText(routingPartial);
  const routedSection = section(routing, 'Current Toolkit Skill Routing');
  const omittedSection = section(routing, 'Intentionally Omitted Skills');

  const routed = [...routedSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]).sort();
  const omitted = [...omittedSection.matchAll(/^-\s*`([^`]+)`:\s*(.+)$/gm)]
    .map((match) => ({ name: match[1], reason: match[2].trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const omittedNames = omitted.map((entry) => entry.name);
  const current = skillNames();
  const currentSet = new Set(current);

  assert.deepEqual(duplicates(routed), [], 'routing table should not list a skill twice');
  assert.deepEqual(duplicates(omittedNames), [], 'omitted skills should not list a skill twice');

  for (const name of current) {
    assert.ok(
      routed.includes(name) || omittedNames.includes(name),
      `${name} exists under skills/ but is not routed or intentionally omitted`
    );
  }

  for (const name of routed) {
    assert.ok(currentSet.has(name), `${name} is routed but has no skills/${name}/SKILL.md`);
  }

  for (const { name, reason } of omitted) {
    assert.ok(currentSet.has(name), `${name} is intentionally omitted but has no skills/${name}/SKILL.md`);
    assert.ok(reason.length >= 12, `${name} omission needs a concrete reason`);
  }
});

test('toolkit skill routing stays routing-only', () => {
  const routing = readText(routingPartial);

  assert.match(routing, /Use the skill name, description, and local files to decide whether a skill applies/);
  assert.doesNotMatch(routing, /Codex Install And Discovery/);
  assert.doesNotMatch(routing, /Repo-level Codex skill/);
  assert.doesNotMatch(routing, /User-level Codex skill/);
  assert.doesNotMatch(routing, /Admin-level Codex skill/);
  assert.doesNotMatch(routing, /`~\/\.codex\/config\.toml`/);
  assert.doesNotMatch(routing, /`\/skills`/);
  assert.doesNotMatch(routing, /`\$skill-name`/);
});

test('human setup docs cover platform-specific skill and rule setup fairly', () => {
  const howToUse = readText(path.join(repoRoot, 'repo', 'docs', 'HOW-TO-USE.md'));
  const readme = readText(path.join(repoRoot, 'README.md'));
  const codexRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'codex.md'));
  const claudeCodeRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'claude-code.md'));
  const opencodeRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'opencode.md'));
  const antigravityRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'antigravity.md'));

  for (const heading of ['Codex Setup', 'Claude Code Setup', 'OpenCode Setup', 'Antigravity Setup']) {
    assert.match(howToUse, new RegExp(`^## ${heading}$`, 'm'), heading);
  }

  for (const heading of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity']) {
    assert.match(howToUse, new RegExp(`^### ${heading}$`, 'm'), heading);
  }

  assert.match(readme, /^## Install Skills By Platform$/m);
  assert.match(readme, /\[How To Use: Install Toolkit Skills\]\(repo\/docs\/HOW-TO-USE\.md#install-toolkit-skills\)/);
  for (const platform of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity']) {
    assert.match(readme, new RegExp(`\\| ${platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`), platform);
  }

  assert.match(howToUse, /Preferred install: use plugin\/package install for Codex, Claude Code, and Antigravity/);
  assert.match(howToUse, /OpenCode stays on a short manual skill-folder install note for now/);
  assert.match(howToUse, /Copy whole skill folders, not just `SKILL\.md`/);
  assert.match(howToUse, /Do not paste secrets, tokens, `.env` values, or credentials into repo files/);
  assert.match(howToUse, /Codex \| Plugin\/package install first/);
  assert.match(howToUse, /Claude Code \| Plugin\/package install first/);
  assert.match(howToUse, /Antigravity \| Plugin-scoped install first/);
  assert.match(howToUse, /OpenCode \| Short manual skill-folder note only/);
  assert.match(howToUse, /`\.codex-plugin\/plugin\.json`/);
  assert.match(howToUse, /`skills\/<skill-name>\/README\.md`/);
  assert.match(howToUse, /`C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md`/);

  assert.match(readme, /Codex \| Plugin\/package install first/);
  assert.match(readme, /Claude Code \| Plugin\/package install first/);
  assert.match(readme, /Antigravity \| Plugin-scoped install first/);
  assert.match(readme, /OpenCode \| Short manual skill-folder install only/);
  assert.match(readme, /`C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\`/);

  assert.match(howToUse, /Fallback repo-level: `<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Fallback user-level: `\$HOME\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Fallback admin-level: `\/etc\/codex\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /`~\/\.codex\/config\.toml` is for Codex configuration/);
  assert.match(howToUse, /Fallback project-level: `<repo>\/\.claude\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Fallback user-level: `\$HOME\/\.claude\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Use `CLAUDE\.md`, `CLAUDE\.local\.md`, or `\.claude\/rules\/`/);
  assert.match(howToUse, /Project OpenCode config: `<repo>\/\.opencode\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /User OpenCode config: `\$HOME\/\.config\/opencode\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Project Claude-compatible: `<repo>\/\.claude\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /User Claude-compatible: `\$HOME\/\.claude\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Project agent-compatible: `<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /User agent-compatible: `\$HOME\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(howToUse, /Use `AGENTS\.md`, `AGENTS\.override\.md`, or the configured OpenCode rules file/);
  assert.match(howToUse, /Plugin-scoped: `C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md`/);
  assert.doesNotMatch(howToUse, /\$HOME\/\.gemini\/antigravity\/skills\/<skill-name>\/SKILL\.md/);
  assert.doesNotMatch(howToUse, /\$HOME\/\.gemini\/skills\/<skill-name>\/SKILL\.md/);
  assert.doesNotMatch(howToUse, /<workspace-root>\/\.agent\/skills\/<skill-name>\/SKILL\.md/);
  assert.match(howToUse, /Use `GEMINI\.md` or the configured context file/);
  assert.match(readme, /`<repo>\/\.claude\/skills\/<skill-name>\/`/);
  assert.match(readme, /`\$HOME\/\.config\/opencode\/skills\/<skill-name>\/`/);
  assert.match(readme, /`AGENTS\.md` is the shared managed instruction file/);
  assert.match(readme, /\[`repo-local\/AGENTS\.managed\.template\.md`\]\(skills\/ai-coding-agent-rules\/repo-local\/AGENTS\.managed\.template\.md\)/);
  assert.match(readme, /\[`repo-local\/CLAUDE\.shim\.template\.md`\]\(skills\/ai-coding-agent-rules\/repo-local\/CLAUDE\.shim\.template\.md\)/);
  assert.match(readme, /\[`repo-local\/GEMINI\.shim\.template\.md`\]\(skills\/ai-coding-agent-rules\/repo-local\/GEMINI\.shim\.template\.md\)/);
  assert.match(readme, /\[`repo-local\/antigravity-bootstrap\.template\.md`\]\(skills\/ai-coding-agent-rules\/repo-local\/antigravity-bootstrap\.template\.md\)/);
  assert.doesNotMatch(readme, /\[`(?:AGENTS|CLAUDE|GEMINI)\.template\.md`\]\(skills\/ai-coding-agent-rules\/(?:AGENTS|CLAUDE|GEMINI)\.template\.md\)/);
  assert.match(readme, /\(skills\/n8n-agent-rules\/\)/);
  assert.doesNotMatch(readme, /\$HOME\/\.gemini\/antigravity\/skills\/<skill-name>\//);
  assert.doesNotMatch(readme, /\$HOME\/\.gemini\/skills\/<skill-name>\//);
  assert.doesNotMatch(readme, /<workspace-root>\/\.agent\/skills\/<skill-name>\//);
  assert.match(howToUse, /\[OpenCode reference\]\(\.\.\/\.\.\/skills\/n8n-local-setup\/references\/ai-agent-platforms\/opencode\.md\)/);
  assert.match(howToUse, /\[Antigravity reference\]\(\.\.\/\.\.\/skills\/n8n-local-setup\/references\/ai-agent-platforms\/antigravity\.md\)/);

  assert.match(codexRef, /Preferred install: use the Codex plugin\/package path/);
  assert.match(claudeCodeRef, /Preferred install: use Claude Code plugin\/package skills support/);
  assert.match(opencodeRef, /OpenCode does not get a toolkit plugin package in this PR/);
  assert.doesNotMatch(opencodeRef, /plugin\/package install first/i);
  assert.match(antigravityRef, /C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md/);

  const installDocs = [howToUse, readme, codexRef, claudeCodeRef, opencodeRef, antigravityRef].join('\n');
  assert.doesNotMatch(
    installDocs,
    /^(?!.*\b(?:do not|don't|not)\b).*copy only\s+`?SKILL\.md`?/gim,
    'install docs must not tell users to copy only SKILL.md'
  );
});
