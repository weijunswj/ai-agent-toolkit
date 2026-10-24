'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { renderBlock, findBlocks } = require('../scripts/toolkit-managed-block.cjs');
const { ProjectsInstructions, parseArgs, placeInstructions } = require('../scripts/toolkit-projects-instructions.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'repo/scripts/toolkit-projects-instructions.cjs');
const BODY = path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const owner = () => new ProjectsInstructions({ root: ROOT });

function fixture(t, text) {
  const tempRoot = path.join(ROOT, '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tempRoot, 'projects-instructions-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'instructions.txt');
  fs.writeFileSync(file, text);
  return file;
}

function check(t, text, state, code, extra = [], overlaps = '') {
  const file = fixture(t, text);
  const before = fs.readFileSync(file);
  const result = run(['--check', file, ...extra]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, code, result.stderr);
  assert.equal(result.stdout, `${state}\n${overlaps}`);
  assert.equal(result.stderr, '');
  assert.deepEqual(fs.readFileSync(file), before, 'checking never writes instructions');
}

test('rendered CLI block round-trips as current with shared markers and package version', t => {
  const result = run(['--render']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const expected = owner().expectedBlock();
  assert.equal(result.stdout, `${renderBlock(expected)}\n`);
  const parsed = findBlocks(result.stdout);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].source, 'claude-projects');
  assert.equal(parsed.blocks[0].name, 'PROJECT-INSTRUCTIONS');
  assert.equal(parsed.blocks[0].version, JSON.parse(fs.readFileSync(path.join(ROOT,
    'repo/contracts/toolkit-local-bridge/version.json'), 'utf8')).version);
  check(t, result.stdout, 'current', 0);
});

test('outside bytes are ignored and never printed, including unrelated managed blocks', t => {
  const outside = renderBlock({ source: 'other', name: 'OTHER', version: '1.0.0', body: 'private owner text' });
  check(t, `\n\n${owner().render()}\nprivate suffix\r\n${outside}\n`, 'current', 0);
  check(t, 'private owner text only', 'missing', 1);
});

// The block goes first: base layer at the top, the project's own lines after its END marker.
test('a current block below project text is misplaced; worse states win over misplaced', t => {
  const outside = renderBlock({ source: 'other', name: 'OTHER', version: '1.0.0', body: 'private owner text' });
  check(t, `private prefix\r\n${outside}\n${owner().render()}\nprivate suffix`, 'misplaced', 1);
  check(t, `- Project line.\n\n${owner().render()}\n`, 'misplaced', 1);
  check(t, `- Project line.\n${renderBlock({ ...owner().expectedBlock(), version: '0.0.0' })}`, 'outdated', 1);
  check(t, `- Project line.\n${owner().render().replace('- Roles:', '- Edited roles:')}`, 'edited', 1);
  check(t, `- Project line.\n${renderBlock({ ...owner().expectedBlock(), version: '0.0.0' })}`, 'declined', 0,
    ['--declined', owner().expectedBlock().version]);
});

test('--place puts main\'s block first and keeps every project line in order, byte for byte', t => {
  const expected = owner().expectedBlock();
  const rendered = owner().render();
  const project = '- Repo: example-owner/example-repo.\n- Where work runs: cloud.';
  const cases = [
    [`${project}\n\n${rendered}\n`, `${rendered}\n\n${project}\n`],
    [`${project}\n${renderBlock({ ...expected, version: '0.0.0', body: 'Old body.' })}\n- Later line.\n`,
      `${rendered}\n\n${project}\n- Later line.\n`],
    [project, `${rendered}\n\n${project}\n`],
    ['', `${rendered}\n`],
    [`${rendered}\n\n${project}\n`, `${rendered}\n\n${project}\n`]
  ];
  for (const [input, output] of cases) {
    const file = fixture(t, input);
    const result = run(['--place', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, output);
    check(t, result.stdout, 'current', 0);
  }
  // CRLF instructions stay CRLF.
  const crlf = placeInstructions(`${project}\r\n`.replace(/\n(?!$)/g, '\r\n'), expected);
  assert.ok(crlf.startsWith(rendered.split('\n').join('\r\n')));
  assert.doesNotMatch(crlf.replace(/\r\n/g, ''), /\n/);
});

test('--place keeps lines added inside an edited block, labelled, and refuses broken markers', t => {
  const rendered = owner().render();
  const edited = rendered.replace('- Roles:', '- Project rule added inside the block.\n- Roles:');
  const placed = placeInstructions(`${edited}\n\n- Project line.\n`, owner().expectedBlock());
  assert.equal(placed, `${rendered}\n\n(kept from an edit inside the block)\n- Project rule added inside the block.\n\n- Project line.\n`);
  const file = fixture(t, `${rendered}\n${rendered}`);
  const result = run(['--place', file]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

// The overlap hint flags project lines that repeat block lines; it never flags project-only rules,
// lines already trimmed and labelled "(adds to the block)", or anything inside the block.
test('overlap hint flags repeated project lines and stays quiet on deduped fixtures', t => {
  const fixtures = path.join(ROOT, 'repo/tests/fixtures/projects-dedupe');
  const withBlock = name => `${owner().render()}\n\n${fs.readFileSync(path.join(fixtures, name), 'utf8')}`;
  check(t, withBlock('repo-project-before.md'), 'current', 1, [], 'overlaps: 2 (line 24 ~ block line 2; line 26 ~ block line 1)\n');
  for (const name of ['repo-project-expected.md', 'no-repo-project-before.md', 'no-repo-project-expected.md']) {
    check(t, withBlock(name), 'current', 0);
  }
  // Dedupe keeps every project-only rule, including ones the block does not carry.
  const expected = fs.readFileSync(path.join(fixtures, 'repo-project-expected.md'), 'utf8');
  for (const kept of ['closing PRs', 'G2 reviewers never write fixes', 'C:\\Users\\example\\GitHub\\example-repo', 'example.com fakes']) {
    assert.ok(expected.includes(kept), kept);
  }
  const noRepo = fs.readFileSync(path.join(fixtures, 'no-repo-project-expected.md'), 'utf8');
  for (const kept of ['local first', 'CUSTODY_PENDING', 'SSH to real servers', 'one-line ELI5']) assert.ok(noRepo.includes(kept), kept);
  // A copy of a block line is flagged; declining the dedupe for this version silences it.
  const copy = `${owner().render()}\n\n${owner().expectedBlock().body.split('\n')[4]}\n`;
  check(t, copy, 'current', 1, [], 'overlaps: 1 (line 22 ~ block line 5)\n');
  check(t, copy, 'current', 0, ['--declined-dedupe', owner().expectedBlock().version]);
  check(t, copy, 'current', 1, ['--declined-dedupe', '0.0.0'], 'overlaps: 1 (line 22 ~ block line 5)\n');
  // Overlaps add to a worse state without changing it; malformed never reports overlaps.
  check(t, `${copy}\n${owner().render()}`, 'malformed', 2);
});

test('CRLF copies remain current', t => {
  check(t, `${owner().render()}\n`.replace(/\n/g, '\r\n'), 'current', 0);
});

test('an intact older version or different source body is outdated', t => {
  const expected = owner().expectedBlock();
  check(t, renderBlock({ ...expected, version: '0.0.0' }), 'outdated', 1);
  check(t, renderBlock({ ...expected, body: 'Previously published body.' }), 'outdated', 1);
  check(t, '<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN PROJECT-INSTRUCTIONS v1 -->\nOld body.\n'
    + '<!-- AI-AGENT-TOOLKIT:claude-projects:END PROJECT-INSTRUCTIONS -->', 'outdated', 1);
});

test('body edits are flagged even when the block is also from an older version', t => {
  const rendered = owner().render();
  check(t, rendered.replace('- Roles:', '- Edited roles:'), 'edited', 1);
  check(t, renderBlock({ ...owner().expectedBlock(), version: '0.0.0' })
    .replace('- Roles:', '- Edited roles:'), 'edited', 1);
});

test('malformed, mismatched, nested and duplicate marker pairs fail closed', t => {
  const rendered = owner().render();
  const lines = rendered.split('\n');
  for (const bad of [
    lines.slice(0, -1).join('\n'), lines.slice(1).join('\n'),
    rendered.replace(' v2 toolkit=', ' vbroken toolkit='),
    rendered.replace(/sha256=[0-9a-f]{12}/, 'sha256=bad'),
    rendered.replace(':END PROJECT-INSTRUCTIONS', ':END OTHER'),
    `${rendered}\n${rendered}`, `${lines[0]}\n${rendered}\n${lines.at(-1)}`,
    renderBlock({ ...owner().expectedBlock(), source: 'wrong-source' })
  ]) check(t, bad, 'malformed', 2);
});

test('declined current source version suppresses only outdated and a newer version is offered', t => {
  const expected = owner().expectedBlock();
  const outdated = renderBlock({ ...expected, version: '0.0.0' });
  const declined = ['--declined', expected.version];
  check(t, outdated, 'declined', 0, declined);
  check(t, outdated, 'outdated', 1, ['--declined', '0.0.0']);
  check(t, owner().render(), 'current', 0, declined);
  check(t, owner().render().replace('- Roles:', '- Edited:'), 'edited', 1, declined);
  check(t, 'owner text', 'missing', 1, declined);
  check(t, `${owner().render()}\n${owner().render()}`, 'malformed', 2, declined);
});

test('invalid arguments and unreadable input fail with generic errors, no file contents or paths', t => {
  const file = fixture(t, 'private owner text');
  for (const args of [[], ['--render', '--check', file], ['--check'], ['--check', file, '--write'],
    ['--check', file, '--declined', 'bad-version'], ['--check', path.join(path.dirname(file), 'absent')],
    ['--check', file, '--declined', '1.0.0', '--declined', '1.0.0'], ['--check', file, '--declined-dedupe'],
    ['--place'], ['--place', file, '--write'], ['--place', path.join(path.dirname(file), 'absent')]]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Project instructions could not be processed (PROJECT_INSTRUCTIONS_INVALID).\n');
  }
  assert.throws(() => parseArgs(['--render', '--declined', '1.0.0']));
});

test('owner reads only injected source/version dependencies and rejects malformed source', () => {
  const calls = [];
  const instructions = new ProjectsInstructions({ root: ROOT, readFile(file) {
    calls.push(file);
    return file.endsWith('version.json') ? '{"version":"1.0.0"}' : '- Test body.\n';
  } });
  assert.match(instructions.render(), /toolkit=1\.0\.0/);
  assert.equal(calls.length, 2);
  assert.throws(() => new ProjectsInstructions({ root: ROOT, readFile: () => '{}' }).render());
});

test('source body stays under 4000 CRLF bytes and contains no marker lines or front matter', () => {
  const text = fs.readFileSync(BODY, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(Buffer.byteLength(text.replace(/\n/g, '\r\n')) < 4000);
  assert.match(text, /^- Roles:/);
  assert.doesNotMatch(text, /AI-AGENT-TOOLKIT:|^---$/m);
  assert.deepEqual(findBlocks(text), { blocks: [], errors: [] });
  assert.doesNotMatch(text, /[^\x00-\x7f]/);
});
