'use strict';

// toolkit permissions --review and --apply --drop: every permission line in scope is listed as risky,
// dead or the owner's own; nothing that is not Toolkit's goes without the owner's pick, a matching
// preview code and their Enter; one backup folder comes first and every written file is put back on a
// failure. Real files in temporary folders through main(), in the shapes found on a real computer
// (support/permission-fixture.cjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const permissions = require('../scripts/toolkit-permissions.cjs');
// --review, --apply and --remove run in toolkit-permissions-cli.cjs (its own process when typed); the
// tests call it in this process so they can hand it a temporary computer.
const cli = require('../scripts/toolkit-permissions-cli.cjs');
const review = require('../scripts/toolkit-permissions-review.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const fixture = require('./support/permission-fixture.cjs');

async function run(fix, args) {
  fix.out.length = 0;
  fix.err.length = 0;
  const code = await cli.main(args, fix.deps);
  return { code, out: fix.out.join(''), err: fix.err.join('') };
}
const reviewJson = async (fix, extra = []) => JSON.parse((await run(fix, ['--review', '--repo-root', fix.root, '--json', ...extra])).out);
const bytes = fix => Object.fromEntries([fix.files.computer, fix.files.repo, fix.files.shared, ...fix.files.copies].map(file => [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null]));
const backupRoot = fix => path.join(fix.home, '.ai-agent-toolkit', 'backups', 'permissions');
const lines = (fix, file, key = 'allow') => fix.read(file).permissions[key] || [];

test('review lists every line in scope by class, folds each line across files and writes nothing', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const before = bytes(fix);
  const listed = await reviewJson(fix);
  assert.deepEqual(listed.counts, { risky: 4, dead: 8, own: 11, other: 23 });
  assert.deepEqual(listed.toolkit, { missing: 6, old: 0, status: '6 missing' }, 'five lines and the auto mode rule');
  const byLine = Object.fromEntries(listed.items.map(item => [item.line, item]));
  assert.deepEqual(byLine['Bash(gh api *)'], { id: 'R2', class: 'risky', list: 'allow', line: 'Bash(gh api *)', where: ['automation'] }, 'one id for the line in the main file and its three worktree copies');
  assert.equal(listed.items.find(item => item.line === 'WebFetch').id, 'R1');
  assert.deepEqual(listed.items.filter(item => item.line === 'WebFetch').map(item => item.where), [['computer'], ['automation in Git']], 'a line in Git keeps its own id');
  assert.equal(byLine['Bash(python -I /work/scratch/scan-old.py)'].class, 'dead');
  assert.equal(byLine['Bash(python -I /work/automation/tools/report.py *)'].class, 'own', 'a path that exists is not dead');
  assert.equal(byLine['Read(//work/automation/docs/**)'].class, 'own', 'a folder before a wildcard that exists is not dead');
  assert.equal(byLine.WebSearch.class, 'own', 'bare web search is the owner\'s own');
  assert.equal(byLine['mcp__scheduled-tasks__list_scheduled_tasks'].class, 'own', 'an MCP tool is not risky by name');
  assert.deepEqual(listed.items.map(item => item.id).slice(0, 6), ['R1', 'R2', 'R3', 'R4', 'D1', 'D2'], 'ids by class, then first file, then line');
  assert.ok(!listed.items.some(item => /node "\/opt\/toolkit/.test(item.line)), 'Toolkit\'s current lines are never listed');
  assert.deepEqual(bytes(fix), before, 'review writes nothing');
  assert.equal(fs.existsSync(backupRoot(fix)), false);
});

test('the chat list is in the house format: one heading, groups by colour, short plain lines, only the command in a code block', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const { code, out } = await run(fix, ['--review', '--repo-root', fix.root]);
  assert.equal(code, 0);
  const text = out.trimEnd();
  assert.match(text.split('\n')[0], /^\*\*Toolkit permissions \(Claude Code\):\*\* Toolkit lines 6 missing · Other lines 23 to review$/);
  for (const group of ['🔵 **Toolkit: 4 to add (6 lines)**', '🔴 **Risky (4)**', '🟡 **Dead (8)**', '🟢 **Yours (11)**']) assert.ok(text.includes(`\n${group}\n`), group);
  assert.equal((text.match(/```/g) || []).length, 2, 'one code block');
  assert.match(text, /```powershell\nnode "\/opt\/toolkit\/repo\/scripts\/toolkit-permissions\.cjs" --apply --host claude --repo-root "\/work\/automation"\n```$/);
  const list = text.slice(0, text.indexOf('```'));
  assert.doesNotMatch(list, /`/, 'no code marks in the list');
  assert.match(list, /\n- \*\*R2\*\* Any GitHub call, merges and deletes included \(gh api\) · automation\n/);
  assert.match(list, /\n- \*\*D6 to D8:\*\* 3 more, all automation\. Say show all to list them\.\n/);
  assert.match(list, /\*\*Reply\*\* keep all, or name what goes, such as remove D1-D8\. Nothing changes until you press Enter in your own terminal\./);
  const all = (await run(fix, ['--review', '--repo-root', fix.root, '--all'])).out;
  assert.match(all, /\n- \*\*D8\*\* .* · automation\. Line: `Bash\(python \/work\/scratch\/check\.py\)`\n/, 'show all unfolds and gives the raw line');
});

test('golden screens: the chat list, the picks and the owner\'s terminal match the approved look', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  // The preview code covers each file's full path, which is a new temporary folder each run.
  const steady = text => text.replace(/\r\n/g, '\n').replace(/--preview [0-9a-f]{8}/g, '--preview <code>');
  const golden = name => steady(fs.readFileSync(path.join(__dirname, 'fixtures', 'permission-review', name), 'utf8'));
  assert.equal((await run(fix, ['--review', '--repo-root', fix.root])).out, golden('chat-list.md'));
  assert.equal(steady((await run(fix, ['--review', '--repo-root', fix.root, '--drop', 'D1-D8,R2'])).out), golden('chat-picks.md'));
  const { preview } = await reviewJson(fix, ['--drop', 'R2 D1-D8']);
  const applied = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', 'D1-D8,R2', '--preview', preview]);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(applied.out, golden('terminal.txt'));
});

test('risky rules and their plain reasons; the path reader reads only plain absolute paths', () => {
  const rules = review.riskyRules(permissions.NEVER);
  const reason = line => review.riskyReason(line, rules);
  for (const [line, want] of [
    ['Bash', 'Any command at all'], ['Bash(*)', 'Any command at all'], ['PowerShell', 'Any command at all'], ['Edit', 'Any file edit'], ['Write(**)', 'Any file edit'],
    ['WebFetch', 'Any web address'], ['Bash(gh pr merge *)', 'Can merge pull requests'], ['mcp__github__merge_pull_request', 'Can merge pull requests'],
    ['Bash(gh issue close *)', 'Can close issues or pull requests'], ['Bash(rm -rf *)', 'Can delete files or branches'], ['Bash(git branch -D *)', 'Can delete files or branches'],
    ['Bash(git push origin --delete old)', 'Can delete files or branches'], ['Bash(git reset --hard *)', 'Can rewrite Git history'], ['Bash(git push *)', 'Can push to any branch, force included'],
    ['Bash(gh auth token)', 'Can read or change secrets and keys'], ['Edit(//c/Users/me/.claude/settings.json)', 'Can change settings or rules files'],
    ['Bash(gh *)', 'Any GitHub call, merges and deletes included'], ['Bash(gh api *)', 'Any GitHub call, merges and deletes included'], ['Bash(gh repo:*)', 'Any GitHub call, merges and deletes included'],
    ['Bash(node *)', 'Runs any code'], ["Bash(python -c ' *)", 'Runs any code'], ['Bash(bash -c *)', 'Runs any code'], ['PowerShell(pwsh -NoProfile -Command *)', 'Runs any code'], ['Bash(node -e *)', 'Runs any code'], ['Bash(python -)', 'Runs any code'],
    ['Bash(* --version)', 'Any command that ends this way'],
    ['WebSearch', null], ['mcp__scheduled-tasks__list_scheduled_tasks', null], ['Bash(gh pr view *)', null], ['Bash(git fetch *)', null], ['Read(//c/Users/me/.claude/settings.json)', null], ['WebFetch(domain:example.com)', null],
  ]) assert.equal(reason(line), want, line);

  const read = (line, platform = 'linux') => review.readPaths(line, { platform, home: platform === 'win32' ? 'C:/Users/me' : '/home/me' }).map(found => found.real);
  assert.deepEqual(read('Bash(python /work/a.py)'), ['/work/a.py']);
  assert.deepEqual(read('Bash(python "/work/my dir/a.py" *)'), ['/work/my dir/a.py']);
  assert.deepEqual(read('Bash(cat ~/notes.txt)'), [path.join('/home/me', 'notes.txt')]);
  assert.deepEqual(read('Read(//work/docs/**)'), ['/work/docs'], 'a wildcard at the end checks the folder before it');
  assert.deepEqual(read('Read(/docs/**)'), [], 'a file rule\'s /path is relative to the settings file: not checked');
  assert.deepEqual(read('Bash(cat /work/*/a)'), [], 'a wildcard inside is not checked');
  assert.deepEqual(read('Bash(cat /work/../etc/passwd)'), [], 'a .. part is not checked');
  assert.deepEqual(read('Bash(cat C:/x/a.txt)'), [], 'a drive path on Linux is not checked');
  assert.deepEqual(read('Bash(cat C:/x/a.txt)', 'win32'), ['C:/x/a.txt']);
  assert.deepEqual(read('Bash(cat C:\\x\\a.txt)', 'win32'), ['C:\\x\\a.txt']);
  assert.deepEqual(read('Bash(cat /c/x/a.txt)', 'win32'), ['C:/x/a.txt'], 'Git Bash form');
  assert.deepEqual(read('Read(//c/x/**)', 'win32'), ['C:/x'], 'Claude Code\'s absolute form');
  assert.deepEqual(read('Bash(cat /usr/a.txt)', 'win32'), [], 'a POSIX root path on Windows is not checked');
  assert.deepEqual(read('Bash(cat $HOME/a.txt)'), [], 'a variable is not read');
  assert.deepEqual(read('mcp__x__y'), []);
});

test('hostile inputs: the --drop reader refuses every shape; the path reader never reads a line with a break or invisible character', () => {
  hostile.expectDefaultDeny(assert, text => review.readDrop(text).ok, hostile.cases(hostile.FAMILIES));
  for (const text of ['D0', 'D9-D2', 'X1', 'D1-R5', 'D1;D2', 'D1\nD2', 'd1', 'D01', ' ', '', 'D1--D2', 'D12345', `D1-D${review.MAX_DROP + 1}`]) assert.equal(review.readDrop(text).ok, false, JSON.stringify(text));
  assert.deepEqual(review.readDrop('D1-D3, R1 Y2,D2').ids, ['D1', 'D2', 'D3', 'R1', 'Y2']);
  assert.deepEqual(review.readDrop('D1-3').ids, ['D1', 'D2', 'D3']);
  assert.equal(review.readDrop(`D1-D${review.MAX_DROP}`).ids.length, review.MAX_DROP);
  // A look-alike letter is a real letter: the path is read as written and simply does not exist.
  hostile.expectDefaultDeny(assert, text => review.readPaths(`Bash(cat /work/gone${text})`, { platform: 'linux', home: '/h' }).length > 0, hostile.cases(['line-breaks', 'continued-lines', 'invisible']), { allow: ['cyrillic-look-alike'] });
  hostile.expectDefaultDeny(assert, text => review.readPaths(`Bash(${text})`, { platform: 'linux', home: '/h' }).length > 0, hostile.cases(hostile.FAMILIES));
});

test('masking hides tokens in chat and terminal; the id still removes the real line', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  assert.equal(review.mask('Bash(GH_TOKEN=abc123 gh api x)'), 'Bash(GH_TOKEN=<hidden> gh api x)');
  assert.equal(review.mask(`Bash(curl -H ${'a'.repeat(40)})`), 'Bash(curl -H <hidden>)');
  const listed = await reviewJson(fix, ['--all']);
  const secret = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  assert.ok(!JSON.stringify(listed).includes(secret), 'the token never reaches the chat output');
  const item = listed.items.find(entry => /DEPLOY_TOKEN/.test(entry.line));
  const { preview } = await reviewJson(fix, ['--drop', item.id]);
  const applied = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', item.id, '--preview', preview]);
  assert.equal(applied.code, 0, applied.err);
  assert.ok(!applied.out.includes(secret), 'the terminal screen hides it too');
  assert.ok(!lines(fix, fix.files.repo).some(line => line.includes(secret)), 'the real line is gone');
});

test('--review --drop gives the picks and the one command; an unknown id or a line in Git stops', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const picks = await run(fix, ['--review', '--repo-root', fix.root, '--drop', 'D1-D8,R2']);
  assert.equal(picks.code, 0);
  assert.match(picks.out, /^\*\*Toolkit permissions \(Claude Code\): your picks\*\*\n\n- \*\*Remove:\*\* 9 lines: R2 and D1 to D8\n- \*\*From:\*\* computer \(1\), automation \(8\), 3 worktree copies \(8 each\)\n- \*\*Keep:\*\* 14 other lines, and every other setting\n/);
  assert.match(picks.out, /--drop R2,D1-D8 --preview [0-9a-f]{8}\n```\n$/);
  for (const [drop, why] of [['D9', /D9 is not in the list/], ['R4', /shared settings file in Git/], ['D1;rm', /something other than ids/]]) {
    const stopped = await run(fix, ['--review', '--repo-root', fix.root, '--drop', drop]);
    assert.equal(stopped.code, 1, drop);
    assert.match(stopped.err, why);
  }
});

test('--apply --drop: one backup folder first, picked lines gone everywhere, everything else kept, Toolkit lines current', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const before = bytes(fix);
  const { preview } = await reviewJson(fix, ['--drop', 'D1-D8,R2']);
  const applied = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', 'D1-D8,R2', '--preview', preview]);
  assert.equal(applied.code, 0, applied.err);
  assert.deepEqual(fix.asked, ['back up and write 5 files']);
  const folder = path.join(backupRoot(fix), '20261126T101500Z');
  const list = fs.readFileSync(path.join(folder, 'list.txt'), 'utf8').trim().split('\n');
  assert.equal(list.length, 5);
  for (const entry of list) {
    const [name, target] = entry.split('  ->  ');
    const virtual = fixture.slashed(target).replace(/^[A-Za-z]:(?=\/)/, '');
    const original = Object.entries(before).find(([file]) => path.resolve(file) === path.resolve(virtual.startsWith(`${fixture.VROOT}/`) ? path.join(fix.real, virtual.slice(fixture.VROOT.length)) : target));
    assert.ok(original, target);
    assert.equal(fs.readFileSync(path.join(folder, name), 'utf8'), original[1], `${name} holds the exact old bytes`);
  }
  const gone = ['Bash(gh api *)', 'Bash(python -I /work/scratch/scan-old.py)', ...fixture.REPO_OTHER.filter(line => /\/work\/scratch\//.test(line))];
  for (const file of [fix.files.computer, fix.files.repo, ...fix.files.copies]) {
    assert.ok(!lines(fix, file).some(line => gone.includes(line)), `${file}: picked lines gone`);
  }
  for (const file of [fix.files.repo, ...fix.files.copies]) for (const line of fixture.REPO_OTHER.filter(entry => !gone.includes(entry))) assert.ok(lines(fix, file).includes(line), `${file} keeps ${line}`);
  const computer = fs.readFileSync(fix.files.computer, 'utf8');
  assert.ok(computer.startsWith('\uFEFF{\r\n    "model"'), 'the byte order mark, CRLF and 4-space indent are kept');
  const settings = fix.read(fix.files.computer);
  assert.deepEqual(settings.autoMode, { allow: ['keep this', ...permissions.AUTO_MODE_ALLOW] }, 'the owner\'s auto mode rules stay; Toolkit\'s rule is added after them, with no $defaults added to a list the owner made');
  assert.deepEqual(settings.permissions.deny, ['Bash(rm -rf /)']);
  assert.equal(settings.permissions.defaultMode, 'default');
  assert.deepEqual(settings.env, { A: '1' });
  for (const line of ['WebFetch', 'WebSearch', 'mcp__scheduled-tasks__list_scheduled_tasks']) assert.ok(settings.permissions.allow.includes(line), `keeps ${line}`);
  assert.equal(fs.readFileSync(fix.files.shared, 'utf8'), before[fix.files.shared], 'the shared file in Git is never written');
  assert.equal(cli.main(['--check', fix.files.computer, '--scope', 'computer'], { ...fix.deps, stdout: () => {} }), 0, 'Toolkit lines current on the computer');
  assert.equal(cli.main(['--check', fix.files.repo, '--scope', 'repo', '--repo-root', fix.root], { ...fix.deps, stdout: () => {} }), 0, 'and in the repository');
  for (const copy of fix.files.copies) assert.ok(!lines(fix, copy).some(line => /gh pr comment/.test(line)), 'nothing is added to a worktree copy');
  const again = await reviewJson(fix);
  assert.deepEqual(again.counts, { risky: 3, dead: 0, own: 11, other: 14 });
  assert.equal(again.toolkit.status, 'up to date');
});

test('a stale preview stops with nothing written and no backup folder: a file edited, a pick changed, a worktree added', async t => {
  for (const change of ['edit', 'pick', 'worktree']) {
    const fix = fixture.setup(t);
    fixture.populate(fix, { permissions });
    const { preview } = await reviewJson(fix, ['--drop', 'D1']);
    let drop = 'D1';
    if (change === 'edit') fix.write(fix.files.repo, { permissions: { allow: [...fixture.REPO_OTHER, 'Bash(echo new)'] } });
    if (change === 'pick') drop = 'D2';
    if (change === 'worktree') {
      const extra = path.join(fix.real, '.claude', 'worktrees', 'wt-new', '.claude', 'settings.local.json');
      fix.write(extra, { permissions: { allow: ['Bash(cat /work/scratch/run-1.log)'] } });
    }
    const before = bytes(fix);
    const stopped = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', drop, '--preview', preview]);
    assert.equal(stopped.code, 1, change);
    assert.match(stopped.err, /the settings files changed after the list you saw \(preview [0-9a-f]{8}\)\. Next: ask for the list again\. Nothing was written\./, change);
    assert.deepEqual(fix.asked, [], change);
    assert.deepEqual(bytes(fix), before, change);
    assert.equal(fs.existsSync(backupRoot(fix)), false, change);
  }
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  for (const args of [['--drop', 'D1'], ['--preview', 'abcd1234'], ['--drop', 'D1', '--preview', 'nothex!!']]) {
    assert.equal((await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, ...args])).code, 2, args.join(' '));
  }
});

test('keep everything: --apply without --drop removes no other line; Ctrl+C on a --drop run writes nothing and makes no folder', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const kept = await reviewJson(fix);
  const applied = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root]);
  assert.equal(applied.code, 0, applied.err);
  const after = await reviewJson(fix);
  assert.deepEqual(after.items.map(item => item.line), kept.items.map(item => item.line), 'every other line stays');
  assert.equal(after.toolkit.status, 'up to date');
  for (const copy of fix.files.copies) assert.deepEqual(lines(fix, copy), [...fixture.REPO_OTHER], 'copies are not touched without picks');

  const stop = fixture.setup(t, { answer: false });
  fixture.populate(stop, { permissions });
  const before = bytes(stop);
  const { preview } = await reviewJson(stop, ['--drop', 'D1']);
  const stopped = await run(stop, ['--apply', '--host', 'claude', '--repo-root', stop.root, '--drop', 'D1', '--preview', preview]);
  assert.equal(stopped.code, 1);
  assert.match(stopped.out, /Stopped\. Nothing was written\./);
  assert.deepEqual(bytes(stop), before);
  assert.equal(fs.existsSync(backupRoot(stop)), false);
});

test('a write that fails on the third of five files puts the first two back byte for byte and names the folder', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const before = bytes(fix);
  const { preview } = await reviewJson(fix, ['--drop', 'D1-D8,R2']);
  let renames = 0;
  const failing = new Proxy(fix.deps.fs, { get: (target, name) => (name === 'renameSync' ? (...args) => { renames += 1; if (renames === 3) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return target.renameSync(...args); } : target[name]) });
  fix.out.length = 0; fix.err.length = 0;
  const code = await cli.main(['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', 'D1-D8,R2', '--preview', preview], { ...fix.deps, fs: failing });
  assert.equal(code, 1);
  const message = fix.err.join('');
  assert.match(message, /could not be written \(ENOSPC\)\. Every file Toolkit wrote is back as it was\. Backup folder: .*20261126T101500Z/);
  assert.deepEqual(bytes(fix), before, 'every file is as it was');
  assert.ok(!fs.readdirSync(path.dirname(fix.files.copies[0])).some(name => /toolkit-tmp-/.test(name)), 'no temp file left');
});

test('the review covers worktree folders git lists and ones left over; a non-governed --repo-root stops', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  const model = new review.PermissionReview({ blocks: new permissions.PermissionBlocks(fix.deps), rows: permissions.ROWS, never: permissions.NEVER, safePath: permissions.safePath, ...fix.deps }).collect({ repoRoot: fix.root });
  assert.deepEqual(model.files.map(file => file.kind), ['computer', 'repo', 'shared', 'copy', 'copy', 'copy'], 'the unregistered third copy is found too');
  fix.setRegistered([]);
  const leftOnly = new review.PermissionReview({ blocks: new permissions.PermissionBlocks(fix.deps), rows: permissions.ROWS, never: permissions.NEVER, safePath: permissions.safePath, ...fix.deps }).collect({ repoRoot: fix.root });
  assert.equal(leftOnly.files.filter(file => file.kind === 'copy').length, 3, 'folders under .claude/worktrees are read without git');
});

test('a repository Toolkit does not govern is reviewed and cleaned too, and gets no Toolkit line', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  fs.writeFileSync(path.join(fix.real, '.github', 'toolkit-programme.json'), JSON.stringify({ ...fixture.ENABLED_BINDING, governance: 'disabled' }));
  const listed = await run(fix, ['--review', '--repo-root', fix.root]);
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /^\*\*Toolkit permissions \(Claude Code\):\*\* Toolkit lines 2 missing · Other lines 23 to review\n/, 'only the computer misses Toolkit lines');
  assert.match(listed.out, /\nautomation is not governed by Toolkit, so Toolkit adds no lines there; its lines are listed for you to keep or pick\.\n/);
  assert.match(listed.out, /--apply --host claude --repo-root "\/work\/automation"\n```\n$/);
  const { preview } = await reviewJson(fix, ['--drop', 'R2']);
  const applied = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', 'R2', '--preview', preview]);
  assert.equal(applied.code, 0, applied.err);
  for (const file of [fix.files.repo, ...fix.files.copies]) {
    assert.ok(!lines(fix, file).includes('Bash(gh api *)'), `${file}: the pick is gone`);
    assert.ok(!lines(fix, file).some(line => /gh pr comment/.test(line)), `${file}: no Toolkit line added`);
  }
  const outside = await run(fix, ['--review', '--repo-root', '/not/a/repo']);
  assert.equal(outside.code, 1);
  assert.match(outside.err, /that folder is not inside a Git repository/);
});

test('a broken worktree copy is listed as not read and never stops or changes anything', async t => {
  const fix = fixture.setup(t);
  fixture.populate(fix, { permissions });
  fs.writeFileSync(fix.files.copies[0], '{ broken');
  const listed = await run(fix, ['--review', '--repo-root', fix.root]);
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /\nNot read, and never changed here \(not valid settings files\): automation worktree copy wt-a\.\n/);
  const { preview } = await reviewJson(fix, ['--drop', 'D2']);
  const applied = await run(fix, ['--apply', '--host', 'claude', '--repo-root', fix.root, '--drop', 'D2', '--preview', preview]);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(fs.readFileSync(fix.files.copies[0], 'utf8'), '{ broken');
  assert.ok(!lines(fix, fix.files.copies[1]).includes('Bash(bash /work/scratch/probe-a.sh)'), 'the readable copies lose the picked line');
  fs.writeFileSync(fix.files.repo, '{ broken');
  const stopped = await run(fix, ['--review', '--repo-root', fix.root]);
  assert.equal(stopped.code, 1, 'a main file Toolkit writes must read cleanly');
  assert.match(stopped.err, /not a settings file Toolkit can merge into safely/);
});
