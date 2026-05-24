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

test('toolkit skill routing documents current Codex skill discovery semantics', () => {
  const routing = readText(routingPartial);

  assert.match(routing, /`AGENTS\.md`, `CLAUDE\.md`, and `GEMINI\.md` are always-on agent instruction files/);
  assert.match(routing, /Codex Skills are on-demand directories/);
  assert.match(routing, /Codex initially sees each skill's name, description, and file path/);
  assert.match(routing, /Explicit Codex invocation uses `\/skills` or `\$skill-name`/);
  assert.match(routing, /Repo-level Codex skill: `<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(routing, /User-level Codex skill: `\$HOME\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(routing, /Admin-level Codex skill: `\/etc\/codex\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(routing, /Symlinked skill folders are acceptable/);
  assert.match(routing, /`~\/\.codex\/config\.toml` is for Codex configuration/);
  assert.match(routing, /not the main skill install surface/);
});
