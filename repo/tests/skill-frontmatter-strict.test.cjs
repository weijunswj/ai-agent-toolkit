'use strict';

// Skill frontmatter and skill metadata must load in strict YAML hosts. Antigravity 2 refused two
// Toolkit skills whose plain description held ": " ("mapping values are not allowed in this context"),
// and Toolkit's own line readers accepted them, so nothing caught it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const validator = require('../scripts/validate-toolkit.cjs');
const { yamlScalarText } = require('../scripts/audit-published-surfaces.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

// The five lines Antigravity (or any strict parser) refused, by file and key.
const FIXED = [
  ['skills/external-operation-preflight/SKILL.md', 'description'],
  ['skills/n8n-workflow-transport/SKILL.md', 'description'],
  ['skills/github-program-reconciler/SKILL.md', 'description'],
  ['skills/toolkit-setup/SKILL.md', 'description'],
  ['skills/github-program-reconciler/agents/openai.yaml', 'default_prompt']
];

function keyLine(text, key) {
  const line = text.split('\n').find((entry) => entry.replace(/^ +/, '').startsWith(`${key}: `));
  assert.ok(line, `${key} line exists`);
  const indent = line.length - line.trimStart().length;
  return { indent: ' '.repeat(indent), value: line.slice(indent + key.length + 2) };
}

test('every skill frontmatter and skill metadata file in the repository passes the strict YAML check', () => {
  const errors = [];
  validator.validateStrictSkillYaml(errors);
  assert.deepEqual(errors, []);
});

test('each fixed line fails again as the plain value it once was, and passes quoted', () => {
  for (const [rel, key] of FIXED) {
    const { indent, value } = keyLine(read(rel), key);
    const text = yamlScalarText(value);
    assert.ok(value.startsWith('"') && value.endsWith('"'), `${rel} ${key} is double-quoted`);
    assert.ok(text.includes(': '), `${rel} ${key} still holds the ": " that strict YAML refuses unquoted`);
    const plain = validator.strictYamlFindings(`name: x\n${indent ? 'interface:\n' : ''}${indent}${key}: ${text}`);
    assert.equal(plain.length, 1, `${rel} ${key} unquoted: ${plain.join('; ')}`);
    assert.match(plain[0], /value holds ": ", which strict YAML reads as a nested key; quote the value with double quotes/);
    assert.deepEqual(validator.strictYamlFindings(`name: x\n${indent ? 'interface:\n' : ''}${indent}${key}: ${value}`), [], `${rel} ${key} quoted`);
  }
});

test('the strict check accepts the YAML shapes skill files use', () => {
  const ok = [
    'name: plain-name\ndescription: Use when a thing happens. Triggers on "quoted words" and `code`.',
    'name: "quoted"\ndescription: \'it\'\'s single-quoted\'',
    'description: "a: b, \\"escaped\\", tab\\t, \\u00e9, \\x41, \\U0010FFFF"',
    'interface:\n  display_name: Name\n  primary_color: \'#1D4ED8\'\n\n# a whole-line comment\npolicy:\n  products:\n    - codex\n    - chatgpt\n  allow_implicit_invocation: true',
    'url: https://example.com/a#b'
  ];
  for (const text of ok) assert.deepEqual(validator.strictYamlFindings(text), [], text);
});

test('the strict check refuses what strict YAML parsers refuse or read differently, naming the line', () => {
  const cases = [
    ['description: Prepare files safely offline: remove secrets', /^line 1: value holds ": "/],
    ['name: x\ndescription: ends with a colon:', /^line 2: value ends with ":"/],
    ['description: text # trailing comment', /^line 1: value holds " #"/],
    ['description: > folded', /^line 1: value starts with the YAML character >/],
    ['description: | literal', /^line 1: value starts with the YAML character \|/],
    ['description: *alias', /^line 1: value starts with the YAML character \*/],
    ['description: [a, b]', /^line 1: value starts with the YAML character \[/],
    ['description: "unknown \\q escape"', /^line 1: value is not one double-quoted string/],
    ['description: "\\U00110000 past Unicode"', /^line 1: value is not one double-quoted string/],
    ['description: "closed" then more', /^line 1: value is not one double-quoted string/],
    ['description: \'lone \' quote\'', /^line 1: value is not one single-quoted string/],
    ['name: a\nname: b', /^line 2: repeats the key name/],
    ['  name: a', /^line 1: is indented, but nothing above it opens a block/],
    ['interface:\n  a: 1\n   b: 2', /^line 3: is indented to a depth no earlier line uses/],
    ['policy:\n\tproducts: x', /^line 2: indents with a tab/],
    ['policy:\n  - a\n  b: c', /^line 3: mixes list items and keys at one depth/],
    ['policy:\n  products:\n    -', /^line 3: is an empty list item/],
    ['interface:\nname: x', /^line 1: has no value and no indented block under it/],
    ['name: x\ndescription:', /^line 2: has no value and no indented block under it/],
    ['just text', /^line 1: is not a `key: value` line or a `- value` list item/],
    ['key:value', /^line 1: is not a `key: value` line/]
  ];
  for (const [text, expected] of cases) {
    const findings = validator.strictYamlFindings(text);
    assert.equal(findings.length, 1, `${JSON.stringify(text)}: ${findings.join('; ')}`);
    assert.match(findings[0], expected, text);
  }
  assert.deepEqual(validator.strictYamlFindings('description: a: b', 5), ['line 5: value holds ": ", which strict YAML reads as a nested key; quote the value with double quotes']);
});

test('Toolkit frontmatter readers see the text inside the quotes', () => {
  const frontMatter = '---\nname: "quoted-name"\ndescription: \'it\'\'s "fine": \\\\ <b>\'\n---\n# Body\n';
  assert.deepEqual(validator.parseFrontMatter(frontMatter), { name: 'quoted-name', description: 'it\'s "fine": \\\\ <b>' });
  assert.equal(yamlScalarText('"tab\\there \\"q\\" \\\\ \\u00e9 \\x41 \\U0001F600 \\e"'), 'tab\there "q" \\ é A \u{1F600} \x1b');
  assert.equal(yamlScalarText('plain: "kept"'), 'plain: "kept"');
  assert.equal(yamlScalarText('"'), '"');
});
