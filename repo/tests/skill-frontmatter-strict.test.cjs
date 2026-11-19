'use strict';

// Skill frontmatter and skill metadata must load in strict YAML hosts. Antigravity 2 refused two
// Toolkit skills whose plain description held ": " ("mapping values are not allowed in this context"),
// and Toolkit's own line readers accepted them, so nothing caught it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const validator = require('../scripts/validate-toolkit.cjs');
const surfaceAudit = require('../scripts/audit-published-surfaces.cjs');
const { copyRepo } = require('./validate-toolkit-test-support.cjs');

const { yamlScalarText } = surfaceAudit;

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
    'url: https://example.com/a#b',
    'description: Caf\u00e9 \u{1F600} na\u00efve\u00a0text \ufeff\u2027\u202a\ud7ff\ue000\ufffd\u{10FFFF}',
    'description: "\\uD7FF \\uE000 \\U0000D7FF \\U0000E000 \\U0001F680 \\U0010FFFF \\x85 \\N \\t"'
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
    ['policy:\n  - a\n  b: c', /^line 3: mixes list items and keys at one depth/],
    ['policy:\n  products:\n    -', /^line 3: is an empty list item/],
    ['interface:\nname: x', /^line 1: has no value and no indented block under it/],
    ['name: x\ndescription:', /^line 2: has no value and no indented block under it/],
    ['just text', /^line 1: is not a `key: value` line or a `- value` list item/],
    ['key:value', /^line 1: is not a `key: value` line/],
    ['description: ?x', /^line 1: value starts with the YAML character \?/],
    ['description: %x', /^line 1: value starts with the YAML character %/],
    ['description: =', /^line 1: value is "=", which YAML 1\.1 reads as a special tag/],
    ['description: <<', /^line 1: value is "<<", which YAML 1\.1 reads as a special tag/],
    // Tabs: strict parsers read a tab after a colon or before an indicator as YAML syntax, and refuse
    // one in indentation, a comment line included.
    ['name: x\ndescription: Prepare files offline:\tremove secrets', /^line 2: holds a tab \(U\+0009\)/],
    ['interface:\n  display_name: X\n\t# keep this short\n  short_description: Y', /^line 3: holds a tab \(U\+0009\)/],
    ['name: x\ndescription: \t- starts like a list', /^line 2: holds a tab \(U\+0009\)/],
    ['policy:\n\tproducts: x', /^line 2: holds a tab \(U\+0009\)/],
    ['name: x\n\t\ndescription: y', /^line 2: holds a tab \(U\+0009\)/],
    ['description: "a\tb"', /^line 1: holds a tab \(U\+0009\)/],
    ['description: text\t# comment', /^line 1: holds a tab \(U\+0009\)/],
    // Control characters, anywhere and quoted too, and characters YAML 1.1 reads as a line break.
    ['description: Don\u0092t run live changes.', /^line 1: holds the character U\+0092/],
    ['description: Shows \x1b[1mbold\x1b[0m text.', /^line 1: holds the character U\+001B/],
    ['description: "Form\x0cfeed"', /^line 1: holds the character U\+000C/],
    ["description: 'nul\x00'", /^line 1: holds the character U\+0000/],
    ['description: del\x7f', /^line 1: holds the character U\+007F/],
    ['description: a\rb', /^line 1: holds the character U\+000D/],
    ['description: a\ufffeb', /^line 1: holds the character U\+FFFE/],
    ['description: a\uffffb', /^line 1: holds the character U\+FFFF/],
    ['# comment \x01', /^line 1: holds the character U\+0001/],
    ['description: First.\u0085Second.', /^line 1: holds the character U\+0085/],
    ['description: "First.\u0085Second."', /^line 1: holds the character U\+0085/],
    ['description: First.\u2028Second.', /^line 1: holds the character U\+2028/],
    ['description: "First.\u2029Second."', /^line 1: holds the character U\+2029/],
    ['description: lone \ud800 half', /^line 1: holds the character U\+D800/],
    // Surrogate escapes, as Python's json.dumps writes an emoji.
    ['description: "Ship it \\ud83d\\ude80 now"', /^line 1: value is not one double-quoted string/],
    ['description: "\\uD800"', /^line 1: value is not one double-quoted string/],
    ['description: "\\uDFFF"', /^line 1: value is not one double-quoted string/],
    ['description: "\\U0000D800"', /^line 1: value is not one double-quoted string/],
    ['description: "\\U0000DFFF"', /^line 1: value is not one double-quoted string/]
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
  assert.deepEqual(surfaceAudit.parseFrontMatter('---\nname: "quoted-name"\ndescription: \'a: b\'\n---\n'), { name: 'quoted-name', description: 'a: b' });
});

test('the validator command checks every skill file set, naming each file and line', () => {
  const cwd = copyRepo();
  const edit = (rel, change) => {
    const file = path.join(cwd, rel);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const changed = change(text);
    assert.notEqual(changed, text, `${rel} changed`);
    fs.writeFileSync(file, changed);
  };
  const setDescription = (value) => (text) => text.replace(/^description: .*$/m, `description: ${value}`);
  edit('skills/toolkit-setup/SKILL.md', setDescription('Set up the Toolkit offline:\tthen check it.'));
  edit('skills/github-program-reconciler/agents/openai.yaml', (text) => text.replace(/^interface:\n/, 'interface:\n\t# a tab-indented comment\n'));
  edit('repo/contracts/third-party/n8n-io-skills/skills/n8n-loops-official/SKILL.md', setDescription('Use for loops: batches and pages.'));
  edit('repo/contracts/claude-projects/web-controller-projects/SKILL.md', (text) => text.replace(/^---\n[\s\S]*?\n---\n/, ''));
  const result = spawnSync(process.execPath, [path.join(cwd, 'repo/scripts/validate-toolkit.cjs'), '--workspace', cwd], { cwd, encoding: 'utf8', timeout: 60000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const expected of [
    /skills\/toolkit-setup\/SKILL\.md line 3: holds a tab \(U\+0009\)/,
    /skills\/github-program-reconciler\/agents\/openai\.yaml line 2: holds a tab \(U\+0009\)/,
    /repo\/contracts\/third-party\/n8n-io-skills\/skills\/n8n-loops-official\/SKILL\.md line 3: value holds ": "/,
    /repo\/contracts\/claude-projects\/web-controller-projects\/SKILL\.md has no frontmatter block between --- lines/
  ]) assert.match(result.stderr, expected);
});
