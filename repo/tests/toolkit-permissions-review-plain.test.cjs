'use strict';

// Red on the parent (the 27 Nov owner test): review permissions showed the owner's own lines as raw
// commands (a risky line added its command's first words, and the Dead and Yours lines were the
// command itself), which the app shows as code. The chat list carries plain words only; the raw line
// comes only with show all (--all), masked.
const assert = require('node:assert/strict');
const test = require('node:test');
const permissions = require('../scripts/toolkit-permissions.cjs');
const cli = require('../scripts/toolkit-permissions-cli.cjs');
const review = require('../scripts/toolkit-permissions-review.cjs');
const fixture = require('./support/permission-fixture.cjs');

async function list(fix, extra = []) {
  fix.out.length = 0;
  fix.err.length = 0;
  assert.equal(await cli.main(['--review', '--repo-root', fix.root, ...extra], fix.deps), 0, fix.err.join(''));
  return fix.out.join('');
}

// The words of a Bash or PowerShell line after its program: its arguments, script names and paths.
function argumentWords(line) {
  const shell = /^(?:Bash|PowerShell)\(([\s\S]*)\)$/.exec(review.mask(line));
  if (!shell) return [];
  const words = shell[1].trim().split(/\s+/);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index += 1;
  return words.slice(index + 1).flatMap(word => word.split(/[\\/]/)).filter(word => /[A-Za-z0-9]/.test(word) && word.length >= 2 && word !== '*');
}

test('without show all, no risky, dead or own item line carries a code mark or a word of its command', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const items = JSON.parse(await list(fix, ['--json'])).items;
  const text = await list(fix);
  const lines = text.split('\n').filter(line => /^- \*\*[RDY]\d+\*\* /.test(line));
  assert.ok(lines.length >= 10, text);
  for (const line of lines) {
    assert.doesNotMatch(line, /`/, line);
    const id = /^- \*\*([RDY]\d+)\*\*/.exec(line)[1];
    const item = items.find(entry => entry.id === id);
    // What the line allows, before its place (" · computer", " · automation").
    const shown = line.replace(/^- \*\*[RDY]\d+\*\* /, '').replace(/ · [^·]+$/, '').toLowerCase();
    for (const word of argumentWords(item.line)) assert.ok(!shown.includes(word.toLowerCase()), `${id} shows "${word}" from ${item.line}: ${line}`);
  }
  // The owner's own risky, dead and own command lines read as what they let an agent do.
  for (const want of ['- **R2** Any GitHub call, merges and deletes included · automation', '- **R3** Runs any code · automation',
    '- **D1** Runs a Python script · computer', '- **Y1** Runs a Python script, any arguments · computer', '- **Y5** Runs a JavaScript script · automation']) {
    assert.ok(lines.includes(want), `${want}\n${text}`);
  }
});

test('show all gives every item its masked raw line, and only the command the owner runs is a code block', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const items = JSON.parse(await list(fix, ['--json'])).items;
  const text = await list(fix, ['--all']);
  for (const item of items) {
    const line = text.split('\n').find(entry => entry.startsWith(`- **${item.id}** `));
    assert.ok(line, item.id);
    assert.ok(line.endsWith(`. Line: \`${review.mask(item.line)}\``), line);
  }
  assert.ok(!text.includes('DEPLOY_TOKEN=') || text.includes('DEPLOY_TOKEN=<hidden>'), 'a key in a line stays hidden');
  assert.equal((text.match(/```/g) || []).length, 2, 'one code block: the owner\'s command');
});

// G2 Low on the plain-word reader: a joined line read as its first command ("Runs the cd command"),
// and a quoted program path with a space read as a fragment of the path ("Runs the Program command").
test('a joined line runs several commands, and a quoted program path is read whole, never as a path fragment', () => {
  for (const [line, words] of [
    ['Bash(cd /x && python foo.py)', 'Runs several commands'],
    ['Bash(ls; rm -rf build)', 'Runs several commands'],
    ['Bash(cat notes.txt | grep secret)', 'Runs several commands'],
    ['PowerShell(Get-ChildItem || exit 1)', 'Runs several commands (PowerShell)'],
    ['Bash("C:/Program Files/nodejs/node.exe" run.js)', 'Runs a JavaScript script'],
    ["Bash('/opt/my tools/git' status:*)", 'Runs a Git command, any arguments'],
    ['Bash(echo "a && b")', 'Runs the echo command'],
    ['Bash(FOO=1 python run.py)', 'Runs a Python script'],
  ]) assert.equal(review.shellWords(line), words, line);
  assert.doesNotMatch(review.shellWords('Bash("C:/Program Files/tool.exe" go)'), /Program|Files/);
});
