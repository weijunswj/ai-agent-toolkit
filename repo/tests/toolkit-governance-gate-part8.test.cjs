'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
test('what the agent is told: ask the question in plain words, never ask the user to run a command', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const deny = tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }).deny;
  const line = gate.sessionLine(repo, { registryOptions: ctx.options });
  const refused = tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'node repo/scripts/toolkit-governance.cjs enable' } }).deny;
  for (const text of [deny, line, refused]) {
    assert.ok(text.includes(gate.ASK), text);
    assert.doesNotMatch(text, /toolkit governance (?:enable|disable)|run the command/, text);
  }
  assert.match(deny, /never ask them to run a command/);
  // An agent cannot forge a "not now" either: the file lives with Toolkit's user state.
  const forged = path.join(path.dirname(ctx.registryPath), gate.NOT_NOW_BASENAME);
  assert.ok(tools(ctx).decide({ tool_name: 'Write', cwd: repo, tool_input: { file_path: forged } }).deny);
});

test('H-08: a decision made at the terminal lets the next prompt through and hands back the held prompts', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  hold(ctx).decide({ cwd: repo, prompt: 'held while away' });
  require('./support/governance-observations.cjs').seedMerged(repo, 'disable', { registryOptions: ctx.options });
  const next = hold(ctx).decide({ cwd: repo, prompt: 'anything' });
  assert.equal(next.action, 'pass');
  assert.match(next.context, /1\. held while away/);
  assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: 'again' }), { action: 'pass' });
});

test('a copy in the repository is never the authority: forged and edited copies open and change nothing', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  // Forged: a hand-written ENABLED file with no decision behind it opens nothing.
  fs.mkdirSync(path.join(repo, OLD_FOLDER), { recursive: true });
  const forged = JSON.stringify({ schema: 'toolkit.repository-governance.v1', repository_id: stateOf(ctx, repo).repository_id, state: 'ENABLED', basis: 'your decision', updated_at: 'x', history: [] });
  fs.writeFileSync(oldCopy(repo), forged);
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go' }).action, 'block');
  assert.ok(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }).deny);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // Decided as DISABLED: the ENABLED file changes nothing and is never rewritten.
  require('./support/governance-observations.cjs').seedMerged(repo, 'disable', { registryOptions: ctx.options });
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go' }).action, 'pass');
  assert.equal(stateOf(ctx, repo).state, 'DISABLED');
  assert.equal(fs.readFileSync(oldCopy(repo), 'utf8'), forged);
  // Deleted: nothing comes back.
  fs.rmSync(path.join(repo, OLD_FOLDER), { recursive: true });
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go' }).action, 'pass');
  writesNothingIn(repo);
});

for (const decision of ['disable', 'enable']) {
  for (const row of ROOT_GITIGNORE_ROWS) {
    test(`B2 matrix: ${decision}d repository, root .gitignore ${row.name}: never edited, never held, git status clean`, (t) => {
      const ctx = scratch(t);
      const slug = `${decision}-${row.name.replace(/[^a-z]+/g, '-')}`;
      const repo = gitRepo(ctx, slug, { remote: `https://github.com/example-owner/${slug}.git` });
      try { row.make(repo); } catch (error) {
        if (error.code === 'EPERM' && process.platform === 'win32') return t.skip('symlinks need privileges on this Windows runner');
        throw error;
      }
      git(repo, ['add', '-A']);
      git(repo, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']);
      if (row.after) row.after(repo);
      t.after(() => { try { fs.chmodSync(path.join(repo, '.gitignore'), 0o644); } catch { /* absent or not a file */ } });
      const before = snapshot(path.join(repo, '.gitignore'));
      require('./support/governance-observations.cjs').seedMerged(repo, decision, { registryOptions: ctx.options });
      for (let round = 0; round < 3; round += 1) {
        assert.equal(hold(ctx).decide({ cwd: repo, prompt: `request ${round}` }).action, 'pass');
        assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
        assert.equal(tools(ctx).decide({ tool_name: 'Edit', cwd: repo, tool_input: { file_path: path.join(repo, 'a.txt') } }), null);
      }
      assert.equal(snapshot(path.join(repo, '.gitignore')), before);
      assert.equal(stateOf(ctx, repo).state, decision === 'enable' ? 'ENABLED' : 'DISABLED');
      writesNothingIn(repo);
      assert.equal(git(repo, ['status', '--porcelain', '--untracked-files=all']), '');
    });
  }
}

for (const decision of ['disable', 'enable']) {
  for (const type of ['file', 'dir', 'junction']) {
    test(`${decision}d repository with a ${type} where the old copy folder was: never touched, never held`, (t) => {
      const ctx = scratch(t);
      const repo = gitRepo(ctx, `leftover-${decision}-${type}`, { remote: `https://github.com/example-owner/leftover-${decision}-${type}.git` });
      const sibling = gitRepo(ctx, `sibling-${decision}-${type}`, { remote: `https://github.com/example-owner/sibling-${decision}-${type}.git` });
      fs.writeFileSync(path.join(sibling, '.gitignore'), 'node_modules/\n');
      git(sibling, ['add', '-A']);
      git(sibling, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
      const placed = path.join(repo, OLD_FOLDER);
      if (type === 'file') fs.writeFileSync(placed, 'not a folder\n');
      else {
        try { fs.symlinkSync(sibling, placed, type); } catch (error) {
          if (error.code === 'EPERM' && process.platform === 'win32') return t.skip('directory symlinks need privileges on this Windows runner');
          throw error;
        }
      }
      const decided = require('./support/governance-observations.cjs').seedMerged(repo, decision, { registryOptions: ctx.options });
      assert.deepEqual([decided.hold, decided.reason], [false, 'decided']);
      for (let round = 0; round < 2; round += 1) {
        assert.equal(hold(ctx).decide({ cwd: repo, prompt: `request ${round}` }).action, 'pass');
        assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
      }
      assert.match(gate.sessionLine(repo, { registryOptions: ctx.options }), new RegExp(`^Toolkit governance: ${decision === 'enable' ? 'ENABLED' : 'DISABLED'}`));
      assert.doesNotMatch(gate.sessionLine(repo, { registryOptions: ctx.options }), /copy/);
      if (type === 'file') assert.equal(fs.readFileSync(placed, 'utf8'), 'not a folder\n');
      else assert.equal(fs.lstatSync(placed).isSymbolicLink(), true, 'the link itself is left in place');
      assert.equal(fs.existsSync(path.join(sibling, 'governance.json')), false);
      assert.equal(fs.readFileSync(path.join(sibling, '.gitignore'), 'utf8'), 'node_modules/\n');
      assert.equal(git(sibling, ['status', '--porcelain', '--untracked-files=all']), '');
    });
  }
}

test('R7: a working-tree binding is neither merged nor the user\'s answer; it is held and asked, and applies only once merged', (t) => {
  const ctx = scratch(t);
  const carried = gitRepo(ctx, 'carried', { block: true, binding: true });
  const before = stateOf(ctx, carried);
  assert.deepEqual([before.state, before.rule, before.reason, before.governed_rules_bind], ['UNDECIDED', 'R7', 'no-decision', false]);
  assert.ok(before.notes.includes('pending-binding-merge'));
  const first = hold(ctx).decide({ cwd: carried, prompt: 'go', sessionId: 's1' });
  assert.equal(first.action, 'block');
  assert.match(first.reason, /^Its working tree has a programme binding that is not merged on the default branch yet\.$/m);
  assert.match(tools(ctx).decide({ tool_name: 'Bash', cwd: carried, session_id: 's1', tool_input: { command: 'ls' } }).deny, /no governance decision yet/);
  assert.match(gate.sessionLine(carried, { registryOptions: ctx.options, sessionId: 's1' }), /no GitHub governance decision yet/);
  // An earlier version's copy saying ENABLED by repository opt-in grants nothing.
  fs.mkdirSync(path.join(carried, OLD_FOLDER), { recursive: true });
  const leftover = JSON.stringify({ schema: 'toolkit.repository-governance.v1', repository_id: before.repository_id, state: 'ENABLED', basis: 'repository opt-in', history: [] });
  fs.writeFileSync(oldCopy(carried), leftover);
  // A later message in other words goes to the agent to read, with a reply ticket; it decides nothing.
  const again = hold(ctx).decide({ cwd: carried, prompt: 'again', sessionId: 's1' });
  assert.equal(again.action, 'pass');
  assert.match(again.context, /Read what they mean before anything else/);
  assert.equal(stateOf(ctx, carried).state, 'UNDECIDED');
  const answered = hold(ctx).decide({ cwd: carried, prompt: 'yes', sessionId: 's1' });
  assert.equal(answered.action, 'pass');
  const after = stateOf(ctx, carried);
  assert.deepEqual([after.state, after.rule, after.governed_rules_bind], ['UNDECIDED', 'R7', false], 'records bind only once the binding merges');
  recordMerged(carried, { registryPath: ctx.options.registryPath });
  const merged = stateOf(ctx, carried);
  assert.deepEqual([merged.state, merged.rule, merged.governed_rules_bind], ['ENABLED', 'M1', true]);
  assert.equal(fs.readFileSync(oldCopy(carried), 'utf8'), leftover, 'the old copy is never rewritten');
});

test('a plain folder is DISABLED automatically, never held, and nothing is written into it', (t) => {
  const ctx = scratch(t);
  const plain = path.join(ctx.root, 'X-Boundaries');
  fs.mkdirSync(plain);
  if (governance.findGitRoot(plain) !== null) return;
  assert.deepEqual(hold(ctx).decide({ cwd: plain, prompt: 'go' }), { action: 'pass' });
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: plain, tool_input: { command: 'ls' } }), null);
  assert.match(gate.sessionLine(plain, { registryOptions: ctx.options }), /^Toolkit governance: DISABLED automatically \(this folder is not a git repository/);
  assert.deepEqual(new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(plain).reason, 'no-git');
  writesNothingIn(plain);
  for (const personal of [path.join(ctx.root, 'home'), path.join(ctx.root, 'home', 'Desktop'), path.join(ctx.root, 'home', 'Downloads')]) {
    fs.mkdirSync(personal, { recursive: true });
    assert.deepEqual(hold(ctx).decide({ cwd: personal, prompt: 'go' }), { action: 'pass' }, personal);
    writesNothingIn(personal);
  }
  assert.equal(fs.existsSync(ctx.heldPath), false);
  assert.equal(registryBytes(ctx), null);
});

test('tools: an undecided repository runs no tool but ToolSearch and the card, read-only ones included; decided repositories are not held', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const [tool_name, tool_input] of [['Bash', { command: 'ls' }], ['PowerShell', { command: 'dir' }], ['Edit', { file_path: 'a.js' }], ['Write', { file_path: 'b.js' }],
    ['apply_patch', { input: '*** Begin Patch\n*** Add File: c.js\n+x\n*** End Patch' }], ['Agent', { prompt: 'help' }], ['mcp__github__create_pull_request', {}], ['exec_command', { cmd: 'ls' }]]) {
    assert.match(tools(ctx).decide({ tool_name, cwd: repo, tool_input }).deny, /no governance decision yet/, tool_name);
  }
  for (const tool_name of ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill']) assert.match(tools(ctx).decide({ tool_name, cwd: repo, tool_input: {} }).deny, /no governance decision yet/, tool_name);
  assert.equal(tools(ctx).decide({ tool_name: 'ToolSearch', cwd: repo, tool_input: { query: 'select:AskUserQuestion' } }), null);
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  for (const tool_name of ['Read', 'Grep']) assert.equal(tools(ctx).decide({ tool_name, cwd: plain, tool_input: {} }), null, `${tool_name} outside a repository`);
  require('./support/governance-observations.cjs').seedMerged(repo, 'enable', { registryOptions: ctx.options });
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
});
