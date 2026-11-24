'use strict';

// A crashed session-start governance check says so inside a repository and names the governed rules
// file, says nothing outside one, and never repeats the error's message. Both hosts' session-start
// scripts give that line instead of printing nothing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const notice = require(path.join(scripts, 'toolkit-governance-unavailable.cjs'));
const hook = require(path.join(scripts, 'toolkit-governance-hook.cjs'));
const codex = require(path.join(scripts, 'toolkit-codex-session-start.cjs'));

function folders(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-unavailable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'));
  const plain = path.join(root, 'plain');
  fs.mkdirSync(plain);
  return { repo, plain };
}

const SECRET = 'a private path and contents';
const crash = () => { throw Object.assign(new TypeError(SECRET), {}); };

test('the line names the rules file of the running Toolkit copy, inside a repository and its subfolders only', (t) => {
  const { repo, plain } = folders(t);
  assert.ok(fs.existsSync(notice.RULES_FILE), 'the named rules file exists');
  for (const cwd of [repo, path.join(repo, 'docs')]) {
    const line = notice.sessionStartLine(cwd, new TypeError(SECRET));
    assert.match(line, /^Toolkit couldn't load the governance check at this session start \(TypeError\)\. Continue with the global rules\./);
    assert.ok(line.includes(notice.RULES_FILE));
    assert.doesNotMatch(line, new RegExp(SECRET));
  }
  // A linked worktree has a .git file, not a folder.
  const tree = path.join(path.dirname(repo), 'tree');
  fs.mkdirSync(tree);
  fs.writeFileSync(path.join(tree, '.git'), 'gitdir: ../repo/.git/worktrees/tree\n');
  assert.notEqual(notice.sessionStartLine(tree, null), '');
  if (!notice.insideGitRepository(plain)) assert.equal(notice.sessionStartLine(plain, new Error('x')), '');
  assert.equal(notice.sessionStartLine(undefined, new Error('x')), '');
});

test('only an error code or class name is shown, never its message', () => {
  assert.equal(notice.errorKind(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(notice.errorKind(new RangeError('x')), 'RangeError');
  assert.equal(notice.errorKind({ code: 'has spaces and /paths', name: 'also bad!' }), 'error');
  assert.equal(notice.errorKind(null), 'error');
});

test('Claude Code: a session start whose gate throws gives the line, and still nothing outside a repository', (t) => {
  const { repo, plain } = folders(t);
  const gate = new Proxy({}, { get: crash });
  const inside = hook.respond('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' }, { gate, environment: { CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(inside.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(inside.hookSpecificOutput.additionalContext, /Toolkit couldn't load the governance check at this session start/);
  if (!notice.insideGitRepository(plain)) {
    assert.deepEqual(hook.respond('SessionStart', { cwd: plain, session_id: 's1', source: 'startup' }, { gate, environment: { CLAUDE_CODE_REMOTE: 'true' } }), {});
  }
});

test('Codex: a session start whose gate throws prints the line after the bridge', (t) => {
  const { repo } = folders(t);
  const lines = [];
  const log = console.log;
  console.log = (text) => lines.push(String(text));
  try {
    codex.main(codex.HOOK_ARGS, { bridge: { run: () => ({ status: 0 }) }, gate: new Proxy({}, { get: crash }), input: { cwd: repo } });
  } finally { console.log = log; }
  assert.equal(lines.filter((line) => line.startsWith("Toolkit couldn't load the governance check")).length, 1, lines.join('\n'));
});
