'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { renderBlock, findBlocks } = require('../scripts/toolkit-managed-block.cjs');
const { ProjectsInstructions, parseArgs } = require('../scripts/toolkit-projects-instructions.cjs');

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

function check(t, text, state, code, extra = []) {
  const file = fixture(t, text);
  const before = fs.readFileSync(file);
  const result = run(['--check', file, ...extra]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, code, result.stderr);
  assert.equal(result.stdout, `${state}\n`);
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
  check(t, `private prefix\r\n${outside}\n${owner().render()}\nprivate suffix`, 'current', 0);
  check(t, 'private owner text only', 'missing', 1);
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
    ['--check', file, '--declined', 'bad-version'], ['--check', path.join(path.dirname(file), 'absent')]]) {
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
