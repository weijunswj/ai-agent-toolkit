'use strict';

// What the personal data guard refuses in an ordinary pull request, with the settings a governance
// turn-on writes: the next step it prints for a file it cannot read (images and fonts, which pass, are in
// personal-data-guard-unread.test.cjs), and the addresses it leaves alone on
// the author lines git and GitHub write into a commit message. Throwaway repositories and fake values only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const installer = require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs');
const guard = require('../../skills/secure-ci-cd/scripts/personal-data-guard.cjs');
const { OLE, PNG, TestRepo, assertNoEcho, docxWithSplitRun, pii, prText, zip } = require('./support/personal-data-fixtures.cjs');
const { hasAttribution } = require('../scripts/toolkit-attribution-guard.cjs');

const CONFIG = '.github/personal-data-guard.json';
const settings = () => JSON.parse(installer.configText());
const person = pii.email();
const noreply = pii.email('12345+jane', 'users.noreply.github.com');
const LEAK = /data is public now|data is public\.|remove it in a new commit|Remove it in a new commit|remove the value|rewriting history/;
const UNREAD = /were not checked, because the guard cannot read them/;
const LIST = /add its path with a reason to\nnot_scanned in \.github\/personal-data-guard\.json, /;

function guarded(t) {
  const repo = new TestRepo(t, { config: settings() });
  return { repo, base: repo.commit('Start', { [CONFIG]: installer.configText(), 'README.md': 'App\n' }) };
}

// The guard in this process, for tables of many lines.
function inProcess(repo, args) {
  let all = '';
  const write = text => { all += text; return true; };
  return { status: guard.main([...args, '--repo', repo.root], { out: { write }, err: { write } }), all };
}

// The pull request check as GitHub runs it.
function pullRequest(repo, base, { title = 'Add the logo', body = 'A logo.', ref = 'feature' } = {}) {
  const event = path.join(repo.dir, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 5, title, body, head: { sha: repo.git(['rev-parse', 'HEAD']), ref }, base: { sha: base, ref: 'main' } }, repository: { default_branch: 'main' } }));
  return repo.guard(['ci'], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, GITHUB_ACTIONS: 'true' } });
}

// ---- a file the guard cannot read ---------------------------------------------------------------

test('a pull request refused only for a file the guard cannot read says what to do, and does not call it a leak', t => {
  for (const [file, bytes] of [['public/logo.png', zip([['a.txt', 'text']])], ['old.doc', OLE], ['bundle.zip', zip([['a.txt', 'text']])], ['data.sqlite', Buffer.from('SQLite format 3\0\0\0')], ['picture.bin', PNG]]) {
    const { repo, base } = guarded(t);
    repo.commit('Add a file', { [file]: bytes });
    const refused = pullRequest(repo, base);
    assert.equal(refused.status, 1, file);
    assert.ok(refused.all.includes(`${file}  unscannable  PDG-UNSCANNABLE`), refused.all);
    assert.match(refused.all, /Nothing was found: the item\(s\) listed were not checked/);
    assert.match(refused.all, LIST);
    assert.match(refused.all, /in this pull request/);
    assert.doesNotMatch(refused.all, LEAK);
    // Doing what it says, in the same pull request, lets it through.
    const config = settings();
    config.not_scanned.push({ path: file, reason: 'our own artwork' });
    repo.commit('List it', { [CONFIG]: `${JSON.stringify(config, null, 2)}\n` });
    const passed = pullRequest(repo, base);
    assert.equal(passed.status, 0, passed.all);
    assert.ok(passed.all.includes(`the change adds ${file} to not_scanned: our own artwork`), passed.all);
  }
});

test('every way the guard runs gives the right next step for an unread file, a found value and both', t => {
  const { repo, base } = guarded(t);
  const listed = (result, where) => { assert.equal(result.status, 1, where); assert.match(result.all, UNREAD, where); assert.match(result.all, LIST, where); };
  // Staged and pushed, on the computer.
  repo.write('logo.bin', PNG);
  repo.git(['add', 'logo.bin']);
  let result = repo.guard(['staged']);
  listed(result, 'staged');
  assert.match(result.all, /in the same change\./);
  assert.doesNotMatch(result.all, LEAK);
  repo.write('notes.txt', `${person}\n`);
  repo.git(['add', 'notes.txt']);
  result = repo.guard(['staged']);
  listed(result, 'staged, both');
  assert.match(result.all, /The PDG-UNSCANNABLE item\(s\) were not checked[^]*The other item\(s\) were found:\nNext: remove the value/);
  repo.git(['reset', '-q', 'notes.txt']);
  fs.rmSync(path.join(repo.root, 'notes.txt'));
  const image = repo.commit('Add the logo');
  result = repo.guard(['pre-push', 'origin'], { input: `refs/heads/feature ${image} refs/heads/feature ${'0'.repeat(40)}\n` });
  listed(result, 'pre-push');
  assert.doesNotMatch(result.all, LEAK);
  // A range, the pull request check and a whole tree.
  result = repo.guard(['range', `${base}..HEAD`]);
  listed(result, 'range');
  assert.doesNotMatch(result.all, LEAK);
  result = repo.guard(['tree']);
  listed(result, 'tree');
  assert.match(result.all, /in a pull request\./);
  assert.doesNotMatch(result.all, LEAK);
  // With a problem in the pull request text only: that text's own step, and no leak from the image.
  result = pullRequest(repo, base, { body: `See ${prText.linuxHome()}` });
  listed(result, 'pull request text');
  assert.match(result.all, /The other item\(s\) were found:\nThese are in the pull request title or body, not in a commit\./);
  assert.doesNotMatch(result.all, LEAK);
  // With a value in a commit: both texts, and the leak's own steps as before.
  repo.commit('Add a note', { 'notes.txt': `${person}\n` });
  for (const [where, run] of [['range', () => repo.guard(['range', `${base}..HEAD`])], ['ci', () => pullRequest(repo, base)]]) {
    result = run();
    listed(result, `${where}, both`);
    assert.match(result.all, /The other item\(s\) were found:\nThese commits are already on GitHub\. If the repository is public, the data is public now\./, where);
    assertNoEcho(assert, result.all, person, where);
  }
  result = repo.guard(['tree']);
  listed(result, 'tree, both');
  assert.match(result.all, /The other item\(s\) were found:\nThese files are already committed\./);
  // Only a value: exactly the text as before.
  const clean = guarded(t);
  clean.repo.commit('Add a note', { 'notes.txt': `${person}\n` });
  result = pullRequest(clean.repo, clean.base);
  assert.equal(result.status, 1);
  assert.match(result.all, /These commits are already on GitHub\. If the repository is public, the data is public now\./);
  assert.doesNotMatch(result.all, UNREAD);
});

test('a document with a found value and a part that cannot be read gets both steps; a submodule is an unread item', t => {
  const { repo, base } = guarded(t);
  const value = pii.email('zq.split', 'marker.sg');
  const document = docxWithSplitRun(value);
  assert.ok(document.length);
  repo.commit('Add a letter', { 'letter.docx': document, 'photo.bin': PNG });
  let result = pullRequest(repo, base);
  assert.match(result.all, UNREAD);
  assert.match(result.all, /the data is public now/);
  assertNoEcho(assert, result.all, value, 'document');
  const other = guarded(t);
  other.repo.git(['update-index', '--add', '--cacheinfo', `160000,${other.base},vendor/lib`]);
  other.repo.commit('Add a submodule');
  result = pullRequest(other.repo, other.base);
  assert.equal(result.status, 1);
  assert.match(result.all, /vendor\/lib {2}unscannable/);
  assert.match(result.all, LIST);
  assert.doesNotMatch(result.all, LEAK);
});

// ---- author lines in commit messages ------------------------------------------------------------

test('git\'s and GitHub\'s own author lines never refuse a pull request', t => {
  const rows = [
    ['git commit --signoff: the committer\'s own address, written by git', ['--signoff', '-m', 'Fix']],
    ['GitHub\'s suggestion button: a co-author with a GitHub no-reply address', ['-m', `Update a.js\n\nCo-authored-by: Jane <${noreply}>`]],
    ['a GitHub squash merge or pairing: a co-author\'s own address', ['-m', `Update a.js (#7)\n\nCo-authored-by: Jane Tan <${person}>`]],
    ['a Dependabot sign-off', ['-m', `Bump a\n\nSigned-off-by: dependabot[bot] <support${pii.at}github.com>`]],
    ['several, as a squash writes them', ['-m', `Update\n\n* one\n\nSigned-off-by: Jane Tan <${person}>\n\n* two\n\nCo-authored-by: Jane Tan <${person}>\nReviewed-by: Li <${pii.email('li')}>`]],
    ['the author and committer themselves', ['-m', 'Fix']],
  ];
  for (const [name, args] of rows) {
    const { repo, base } = guarded(t);
    repo.env.GIT_AUTHOR_EMAIL = person;
    repo.env.GIT_COMMITTER_EMAIL = person;
    repo.git(['commit', '-q', '--no-verify', '--allow-empty', ...args]);
    for (const result of [repo.guard(['range', `${base}..HEAD`]), pullRequest(repo, base)]) assert.equal(result.status, 0, `${name}: ${result.all}`);
    const pushed = repo.guard(['pre-push', 'origin'], { input: `refs/heads/feature ${repo.git(['rev-parse', 'HEAD'])} refs/heads/feature ${base}\n` });
    assert.equal(pushed.status, 0, `${name}: ${pushed.all}`);
  }
});

// One line of a commit message at a time, as the commit, the push, the check and the sweep read it.
test('only the one address of an author line is left alone; anything else on or around it is checked', t => {
  const { repo } = guarded(t);
  const other = pii.email('li.wei', 'corner.sg');
  const ok = [
    ...['Co-authored-by', 'Co-committed-by', 'Co-developed-by', 'Signed-off-by', 'Reviewed-by', 'Acked-by', 'Tested-by'].flatMap(label => [`${label}: Jane Tan <${person}>`, `${label.toUpperCase()}: Jane Tan <${person.toUpperCase()}>`]),
    `Signed-off-by: <${person}>`, `Signed-off-by: ${person}`, `  Signed-off-by:Jane <${person}>  `, `Signed-off-by: Jane <${person}>\r`,
    `Signed-off-by: ${person} <${person}>`, `Signed-off-by: Séamus O'Brien <${pii.email('o\'brien')}>`, `Signed-off-by: Claude Dupont <${pii.email('claude.dupont')}>`,
    `Thanks to ${noreply}`, `Reported-by: Jane <${noreply}>`, `noreply${pii.at}github.com wrote it`, `x ${pii.email('49699333+dependabot', 'USERS.noreply.GitHub.com')}`,
  ];
  const refused = [
    `Fix for ${person}`, `Reported-by: Jane <${person}>`, `Cc: Jane <${person}>`, `From: Jane <${person}>`, `Author: Jane <${person}>`, `Suggested-by: Jane <${person}>`,
    `See Signed-off-by: Jane <${person}>`, `* Signed-off-by: Jane <${person}>`, `> Signed-off-by: Jane <${person}>`,
    `Signed-off-by: Jane <${person}> for ${other}`, `Signed-off-by: ${other} <${person}>`, `Signed-off-by: Jane <${person}> <${other}>`, `Signed-off-by: <see the note> Jane <${person}>`, `Signed-off-by: Jane <${person},${other}>`, `Signed-off-by: ${person} ${other}`,
    `Signed-off-by: Jane ${pii.sgPlus()} <${person}>`, `Signed-off-by: Jane ${pii.waMe()} <${person}>`, `Signed-off-by: Jane <${person}> ${pii.sgPlus('')}`, `Signed-off-by: ${pii.sgPlus()}`,
    `Signed-off-by: Jane\n <${person}>`, `Signed-off-by:\n${person}`, `Signed-off by: Jane <${person}>`, `Signed-off-by Jane <${person}>`,
    `${pii.email('jane', 'users.noreply.github.com.corner.sg')}`, `${pii.email('jane', 'noreply.github.com')}`, `${pii.email('jane', 'github.com')}`, `support${pii.at}github.com`,
    // AI attribution keeps its own rules: what the attribution guard refuses is still refused here.
    `Co-authored-by: Claude <noreply${pii.at}anthropic.com>`, `Co-Authored-By: Claude Opus <${person}>`, `co-authored-by: someone <${pii.email('someone', 'anthropic.com')}>`, `Signed-off-by: Claude <noreply${pii.at}anthropic.com>`,
    `# Author:    Jane <${person}>\n# Please ${other}`,
  ];
  for (const [lines, status] of [[ok, 0], [refused, 1]]) {
    for (const line of lines) {
      const file = repo.write('.git/COMMIT_EDITMSG', `Subject\n\n${line}\n`);
      const result = inProcess(repo, ['message', file]);
      assert.equal(result.status, status, `${line}\n${result.all}`);
      assertNoEcho(assert, result.all.replace(/example\.com|github\.com/g, ''), person, line);
    }
  }
  // The same lines, as commits in a range: the ones left alone together, and one of each refused kind.
  for (const [lines, status] of [[[ok.join('\n\n')], 0], [refused.filter((line, index) => index % 6 === 0), 1]]) {
    for (const line of lines) {
      const base = repo.git(['rev-parse', 'HEAD']);
      repo.git(['commit', '-q', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-F', '-'], { input: `Subject\n\n${line}\n` });
      const result = inProcess(repo, ['range', `${base}..HEAD`]);
      assert.equal(result.status, status, `${line}\n${result.all}`);
    }
  }
  // Every co-author line the attribution guard refuses is refused here too.
  for (const line of refused.filter(text => /^co-authored-by/i.test(text))) assert.equal(hasAttribution(line), true, line);
});

// A co-author line naming an AI tool fails whatever its address: the no-reply exemption comes after it.
test('a co-author line naming an AI tool is refused whatever its address, a human co-author is not', t => {
  const { repo } = guarded(t);
  const bot = name => pii.email(`12345+${name}`, 'users.noreply.github.com');
  const addresses = [noreply, `noreply${pii.at}github.com`, person, `noreply${pii.at}anthropic.com`, bot('claude[bot]')];
  const refused = [
    // Each tool, with a GitHub no-reply address and with its own.
    ...addresses.map(address => `Co-authored-by: Claude <${address}>`),
    `Co-authored-by: claude[bot] <${bot('claude[bot]')}>`, `Co-authored-by: Jane <${pii.email('jane', 'anthropic.com')}>`, `Co-authored-by: Anthropic <${noreply}>`,
    `Co-authored-by: Codex <noreply${pii.at}openai.com>`, `Co-authored-by: chatgpt-codex-connector[bot] <${bot('chatgpt-codex-connector[bot]')}>`,
    `Co-authored-by: Cursor Agent <cursoragent${pii.at}cursor.com>`, `Co-authored-by: Cursor <${noreply}>`,
    `Co-authored-by: Copilot <${bot('Copilot')}>`, `Co-authored-by: copilot-swe-agent[bot] <${bot('copilot-swe-agent[bot]')}>`,
    `Co-authored-by: Gemini <${noreply}>`, `Co-authored-by: gemini-code-assist[bot] <${bot('gemini-code-assist[bot]')}>`,
    `Co-authored-by: ChatGPT <${noreply}>`, `Co-authored-by: OpenAI <${noreply}>`, `Co-authored-by: Windsurf <${noreply}>`, `Co-authored-by: Codeium <${noreply}>`,
    `Co-authored-by: Tabnine <${noreply}>`, `Co-authored-by: aider <${noreply}>`, `Co-authored-by: Amazon Q Developer <${noreply}>`, `Co-authored-by: CodeWhisperer <${noreply}>`, `Co-authored-by: devin-ai-integration[bot] <${bot('devin-ai-integration[bot]')}>`,
    // Case, spacing and the other spellings of the trailer.
    `CO-AUTHORED-BY: CLAUDE <${noreply.toUpperCase()}>`, `co-authored-by: copilot <${noreply}>`, `Co-Authored-By: Gemini <${noreply}>`,
    `Co-authored-by :\tClaude <${noreply}>`, `  Co-authored-by:Cursor <${noreply}>  `, `Co-authored-by: Claude <${noreply}>\r`, `Co-authored-by=Claude <${noreply}>`, `Co-authored-by \t= Codex <${noreply}>`,
    `Co-developed-by: Claude <${noreply}>`, `Co-committed-by: Copilot <${noreply}>`, `Co-authored-by: Claude`, `Co-authored-by: <${bot('claude')}>`,
    `See Co-authored-by: Claude <${noreply}>`, `> Co-authored-by: Codex <${noreply}>`, `Co-authored-by: Jane <${noreply}> and Claude`,
    // A human named like a tool: refused, as the attribution guard refuses it.
    `Co-authored-by: Claude Dupont <${pii.email('claude.dupont', 'users.noreply.github.com')}>`, `Co-authored-by: Claudette Tan <${noreply}>`,
  ];
  const ok = [
    `Co-authored-by: Jane <${noreply}>`, `Co-authored-by: Jane Tan <${person}>`, `Co-Authored-By: Jane Tan <${noreply}>`, `Co-developed-by: Jane <${noreply}>`,
    `Co-authored-by: Ann Cursorini <${noreply}>`, `Co-authored-by: Ming Copilotto <${noreply}>`, `Co-authored-by: Ben Geminiani <${noreply}>`,
    `Signed-off-by: Claude Dupont <${pii.email('claude.dupont', 'users.noreply.github.com')}>`, `Signed-off-by: Jane <${noreply}>`,
    `Signed-off-by: dependabot[bot] <support${pii.at}github.com>`, `Co-authored-by: dependabot[bot] <${bot('dependabot[bot]')}>`,
    'Fixed the parser that Cursor and Copilot both tripped on', `Thanks to Claude for the idea, see ${noreply}`,
  ];
  const rule = /commit message:3:\d+ {2}ai-attribution {2}PDG-AI-CO-AUTHOR/;
  for (const [lines, status] of [[refused, 1], [ok, 0]]) {
    for (const line of lines) {
      const file = repo.write('.git/COMMIT_EDITMSG', `Subject\n\n${line}\n`);
      const result = inProcess(repo, ['message', file]);
      assert.equal(result.status, status, `${line}\n${result.all}`);
      if (status) assert.match(result.all, rule, line);
      else assert.doesNotMatch(result.all, /PDG-AI-CO-AUTHOR/, line);
    }
  }
  // Every co-author line the attribution guard refuses fails here, whatever its address.
  for (const name of ['Claude', 'claude', 'Claude Opus 4', 'claude[bot]', 'Jane (anthropic.com)']) {
    for (const address of addresses) {
      for (const label of ['Co-authored-by: ', 'Co-Authored-By:', 'co-authored-by = ']) {
        const line = `${label}${name} <${address}>`;
        assert.equal(hasAttribution(line), true, line);
        const file = repo.write('.git/COMMIT_EDITMSG', `Subject\n\n${line}\n`);
        assert.equal(inProcess(repo, ['message', file]).status, 1, line);
      }
    }
  }
  // As commits: the check of a range and the pull request check refuse one; the push check too.
  for (const line of [`Co-authored-by: Claude <${noreply}>`, `Co-authored-by: Copilot <${bot('Copilot')}>`]) {
    const { repo: other, base } = guarded(t);
    other.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', `Fix\n\n${line}`]);
    const head = other.git(['rev-parse', 'HEAD']);
    for (const result of [other.guard(['range', `${base}..HEAD`]), pullRequest(other, base), other.guard(['pre-push', 'origin'], { input: `refs/heads/feature ${head} refs/heads/feature ${base}\n` })]) {
      assert.equal(result.status, 1, `${line}\n${result.all}`);
      assert.match(result.all, /message:3:1 {2}ai-attribution {2}PDG-AI-CO-AUTHOR/, line);
    }
  }
});

test('a long line that looks like an author line is read in one pass', t => {
  const { repo } = guarded(t);
  for (const filler of [' ', '\t ', '<', '>', '< ', '> <']) {
    const file = repo.write('.git/COMMIT_EDITMSG', `Subject\n\nSigned-off-by:${filler.repeat(100000)}\n${filler.repeat(100000)}Signed-off-by: Jane <\n`);
    const started = Date.now();
    assert.equal(inProcess(repo, ['message', file]).status, 0);
    assert.ok(Date.now() - started < 5000, `${JSON.stringify(filler)} took ${Date.now() - started} ms`);
  }
});

test('the line git itself adds to the message file for another author is left alone there, and only there', t => {
  const { repo, base } = guarded(t);
  // The message file as git hands it to the commit-msg hook (git commit --author with an editor).
  const hook = path.join(repo.root, '.git', 'hooks', 'commit-msg');
  fs.writeFileSync(hook, '#!/bin/sh\ncat "$1" > .git/seen\n');
  fs.chmodSync(hook, 0o755);
  const editor = repo.write('.git/editor.cjs', 'const fs = require("node:fs"); fs.writeFileSync(process.argv[2], `Fix\\n${fs.readFileSync(process.argv[2], "utf8")}`);');
  repo.env.GIT_EDITOR = `"${process.execPath.replace(/\\/g, '/')}" "${editor.replace(/\\/g, '/')}"`;
  repo.git(['commit', '-q', '--allow-empty', `--author=Jane Tan <${person}>`]);
  const seen = fs.readFileSync(path.join(repo.root, '.git', 'seen'), 'utf8');
  assert.match(seen, /^# Author: {4}Jane Tan </m, 'git writes the author into the file');
  assert.equal(repo.guard(['message', path.join(repo.root, '.git', 'seen')]).status, 0);
  assert.equal(repo.guard(['range', `${base}..HEAD`]).status, 0);
  // In a real commit message it is text like any other.
  const before = repo.git(['rev-parse', 'HEAD']);
  fs.rmSync(hook);
  repo.git(['commit', '-q', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-F', '-'], { input: `Fix\n\n# Author:    Jane Tan <${person}>\n` });
  assert.equal(repo.guard(['range', `${before}..HEAD`]).status, 1);
});

test('author lines are left alone only in commit messages: not in files, tags, pull request text or branch names', t => {
  const { repo, base } = guarded(t);
  const line = `Signed-off-by: Jane Tan <${person}>`;
  repo.commit('Add a note', { 'notes.txt': `${line}\n` });
  assert.equal(repo.guard(['range', `${base}..HEAD`]).status, 1, 'a file');
  const clean = guarded(t);
  clean.repo.commit('Fine');
  assert.equal(pullRequest(clean.repo, clean.base, { body: line }).status, 1, 'a pull request body');
  clean.repo.git(['tag', '-a', 'v1', '-m', `One\n\n${line}`]);
  const tag = clean.repo.git(['rev-parse', 'v1']);
  assert.equal(clean.repo.guard(['pre-push', 'origin'], { input: `refs/tags/v1 ${tag} refs/tags/v1 ${'0'.repeat(40)}\n` }).status, 1, 'a tag message');
  // A GitHub no-reply address is no personal data anywhere.
  const open = guarded(t);
  open.repo.commit(`Thanks to ${noreply}`, { 'notes.txt': `${noreply}\n`, [`by/${noreply}/a.txt`]: 'x\n' });
  const passed = pullRequest(open.repo, open.base, { title: `From ${noreply}`, body: noreply, ref: `by-${noreply}` });
  assert.equal(passed.status, 0, passed.all);
});
