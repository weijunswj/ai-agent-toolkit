'use strict';

// Task auto-merge eligibility: the always-manual list and the CLI the auto-merge-eligible check runs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const eligible = require('../scripts/toolkit-auto-merge-eligible.cjs');

test('the always-manual paths and a major bump wait for the owner; ordinary changes are eligible', () => {
  const verdict = (files, toolkit = true, versions = {}) => eligible.eligibility({ files, toolkit, versions });
  assert.deepEqual(verdict(['repo/scripts/run-tests.cjs', 'repo/docs/README.md', 'skills/frontend-art-direction/SKILL.md', 'repo/tests/x.test.cjs']), { eligible: true, reasons: [] });
  const manual = [
    '.github/toolkit-programme.json', '.github/workflows/validate.yml', 'AGENTS.md', 'sub/CLAUDE.md', '.github/copilot-instructions.md',
    'hooks/hooks.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-governance-hook.cjs', 'repo/scripts/toolkit-codex-helper-hook.ps1',
    '.claude/settings.json', '.codex/config.toml',
    'repo/contracts/agent-rules/global-rules.md', 'repo/contracts/agent-rules/gate-rules.md', 'repo/CONTROLLER.md',
    'repo/contracts/claude-projects/web-controller-projects/SKILL.md', 'repo/contracts/programme-state/binding-v2.schema.json',
    'skills/github-program-reconciler/scripts/programme-state.cjs', 'repo/scripts/toolkit-merge-hold.cjs', 'repo/scripts/toolkit-shell-call.cjs',
    'repo/scripts/toolkit-auto-merge-eligible.cjs', 'repo/scripts/toolkit-governance-state.cjs', '.agents/rules/00-bootstrap.md',
    'skills/repository-agent-rules/SKILL.md', 'repo/scripts/setup-codex-toolkit-plugin.cjs', 'repo/scripts/setup-claude-toolkit-plugin.cjs',
  ];
  for (const file of manual) {
    const result = verdict(['repo/docs/README.md', file]);
    assert.equal(result.eligible, false, file);
    assert.deepEqual(result.reasons.map(entry => entry.path), [file], file);
  }
  assert.equal(verdict(['repo/CONTROLLER.md'], false).eligible, true, 'the Toolkit list applies only to the Toolkit repository');
  assert.equal(verdict(['AGENTS.md'], false).eligible, false, 'the general list applies everywhere');
  assert.match(verdict([], true, { 'repo/contracts/toolkit-local-bridge/version.json': { before: '3.20.0', after: '4.0.0' } }).reasons[0].why, /major version bump/);
  assert.equal(verdict([], true, { 'repo/contracts/toolkit-local-bridge/version.json': { before: '3.20.0', after: '3.21.0' } }).eligible, true);
  // What the release bump at merge time touches is eligible: plugin metadata, the changelog.
  assert.equal(verdict(['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'repo/docs/CHANGELOG.md']).eligible, true);
  // A module the hooks load is always manual.
  assert.deepEqual(eligible.eligibility({ files: ['repo/scripts/toolkit-push-check.cjs'], toolkit: true, hooks: new Set(['repo/scripts/toolkit-push-check.cjs']) }).reasons,
    [{ path: 'repo/scripts/toolkit-push-check.cjs', why: 'a module the hooks load' }]);
  assert.equal(eligible.eligibility({ files: ['AGENTS.md'], toolkit: true, stampOnly: ['AGENTS.md'] }).eligible, true, 'a stamp-only change');
  const marker = version => `<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=${version} sha256=59b80466f009 -->\nbody\nVersion: 2026-10-30.2\n`;
  assert.equal(eligible.withoutStamps(marker('3.19.19')), eligible.withoutStamps(marker('3.20.0').replace('30.2', '31.1')));
  assert.notEqual(eligible.withoutStamps(marker('3.19.19')), eligible.withoutStamps(marker('3.19.19').replace('body', 'changed body')));
  assert.equal(eligible.withoutStamps('{\n  "version": "3.21.0",\n}'), eligible.withoutStamps('{\n  "version": "3.22.0",\n}'));
  assert.equal(eligible.withoutStamps("const BRIDGE_VERSION = '3.21.0';\n"), eligible.withoutStamps("const BRIDGE_VERSION = '3.22.0';\n"));
  assert.notEqual(eligible.withoutStamps("const BRIDGE_VERSION = '3.21.0';\nhook();\n"), eligible.withoutStamps("const BRIDGE_VERSION = '3.22.0';\nother();\n"));
});

test('CI runs the default branch\'s copy, which needs nothing but Node\'s own modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'toolkit-auto-merge-eligible.cjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map(match => match[1].trim()), ["'node:child_process'"]);
  const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'auto-merge-eligible.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n {2}pull_request_target:/m, 'the default branch\'s workflow decides');
  // Only the default branch is checked out (no ref), and the pull request's commits are fetched as
  // objects, never checked out: none of its files run, the script included.
  assert.doesNotMatch(workflow, /^\s*ref:/m, 'the checkout is the default branch');
  assert.doesNotMatch(workflow, /git (?:checkout|switch|worktree)|gh pr checkout/, 'nothing from the pull request is checked out');
  assert.match(workflow, /fetch --no-tags --quiet origin "\$HEAD_SHA" "\$BASE_SHA"/);
  assert.match(workflow, /node repo\/scripts\/toolkit-auto-merge-eligible\.cjs --base "\$BASE_SHA" --head "\$HEAD_SHA" --binding-at "\$\(git rev-parse HEAD\)" \$owner/, 'the default branch\'s script decides, with the default branch\'s binding');
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}issues: write\n {2}statuses: write$/m, 'read-only but for the owner\'s label and its status');
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /types: \[opened, reopened, synchronize, edited, labeled, unlabeled\]/, 'a label change runs the check again');
  assert.match(workflow, /group: auto-merge-eligible-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.action == 'synchronize' && 'push' \|\| 'other' \}\}\n {2}cancel-in-progress: \$\{\{ github\.event\.action != 'synchronize' \}\}/, 'nothing cancels a push\'s run');
  assert.match(workflow, /--label-decision\)"/, 'the label decision is the tested one');
  assert.match(workflow, /\*record=1\*\)\n\s+gh api -X POST "repos\/\$GH_REPO\/statuses\/\$HEAD_SHA" -f state=success -f context=toolkit-owner-merge/);
  assert.match(workflow, /\*remove=1\*\)\n\s+gh api -X DELETE "repos\/\$GH_REPO\/issues\/\$NUMBER\/labels\/toolkit-owner-merge"/);
  assert.match(workflow, /\*owner_merge=1\*\) owner="--owner-merge"/);
  assert.match(workflow, /ADDED_LABEL: \$\{\{ github\.event\.label\.name \}\}/);
  assert.match(workflow, /SENDER: \$\{\{ github\.event\.sender\.login \}\}\n\s+SENDER_TYPE: \$\{\{ github\.event\.sender\.type \}\}\n\s+OWNER: \$\{\{ github\.repository_owner \}\}/, 'who added the label is checked');
  assert.doesNotMatch(workflow.split('run: |')[1], /\$\{\{/, 'event values reach the shell only through env');
  assert.ok(workflow.includes(eligible.OWNER_LABEL));
  assert.match(workflow, /^ {2}auto-merge-eligible:$/m, 'the check name the binding requires');
});

test('the owner\'s label counts only for the head it was added on, whatever runs were cancelled', () => {
  const label = eligible.OWNER_LABEL;
  const bot = eligible.OWNER_STATUS_CREATOR;
  const ok = [{ context: label, state: 'success', creator: bot }];
  const owner = { login: 'weijunswj', type: 'User' };
  const decide = (action, extra = {}) => eligible.labelDecision({ action, labels: [label], owner: 'weijunswj', ...extra });
  assert.deepEqual(decide('labeled', { added: label, sender: owner }), { owner_merge: true, record: true, remove: false }, 'adding it records it on that head');
  assert.deepEqual(decide('labeled', { added: label, sender: { login: 'WeiJunSWJ', type: 'User' } }).owner_merge, true, 'logins compare without case');
  assert.deepEqual(decide('edited', { statuses: ok }), { owner_merge: true, record: false, remove: false }, 'a later run on that head keeps it');
  assert.deepEqual(decide('synchronize', { statuses: ok }), { owner_merge: false, record: false, remove: true }, 'a push removes it');
  // The race: the owner labels head A, an agent pushes head B, and an edit to the body cancels the
  // push's run before it removed the label. The edit's run sees the label but no status on B.
  assert.deepEqual(decide('edited', { statuses: [] }), { owner_merge: false, record: false, remove: true }, 'a label left behind by a cancelled push run');
  assert.deepEqual(decide('labeled', { added: 'bug', statuses: [] }), { owner_merge: false, record: false, remove: true }, 'another label added after the push');
  assert.deepEqual(decide('reopened', { statuses: [{ context: label, state: 'success', creator: 'weijunswj' }] }).owner_merge, false, 'a status an agent made through the owner\'s login');
  assert.deepEqual(decide('edited', { statuses: [{ context: label, state: 'failure', creator: bot }] }).owner_merge, false);
  assert.deepEqual(eligible.labelDecision({ action: 'unlabeled', labels: ['bug'], statuses: ok }), { owner_merge: false, record: false, remove: false }, 'no label, no merge');
  // Only the repository owner's own user account counts; anyone else's label is removed and fails,
  // even when the head already carries the status.
  const refused = { owner_merge: false, record: false, remove: true, not_owner: true };
  for (const [sender, why] of [
    [{ login: 'someone-else', type: 'User' }, 'a collaborator'],
    [{ login: 'claude[bot]', type: 'Bot' }, 'an app'],
    [{ login: 'github-actions[bot]', type: 'Bot' }, 'the workflow token'],
    [{ login: 'weijunswj', type: 'Bot' }, 'a bot account named like the owner'],
    [{ login: 'weijunswj', type: 'Organization' }, 'not a user'],
    [{ login: '', type: 'User' }, 'no sender'],
    [null, 'no sender at all'],
  ]) {
    assert.deepEqual(decide('labeled', { added: label, sender, statuses: ok }), refused, why);
  }
  assert.deepEqual(eligible.labelDecision({ action: 'labeled', labels: [label], added: label, sender: owner, statuses: ok }), refused, 'no repository owner to compare with');
  assert.deepEqual(decide('synchronize', { sender: owner, statuses: ok }), { owner_merge: false, record: false, remove: true }, 'the owner pushing still removes it');
  // The workflow step's own reading of its environment.
  const out = [];
  const step = environment => { out.length = 0; eligible.main(['--label-decision'], { environment, stdout: { write: text => out.push(text) } }); return out.join('').trim(); };
  const by = (login, type = 'User') => ({ SENDER: login, SENDER_TYPE: type, OWNER: 'weijunswj' });
  assert.equal(step({ ACTION: 'labeled', ADDED_LABEL: label, LABELS: JSON.stringify([label]), STATUSES: '[]', ...by('weijunswj') }), 'owner_merge=1 record=1 remove=0');
  assert.equal(step({ ACTION: 'labeled', ADDED_LABEL: label, LABELS: JSON.stringify([label]), STATUSES: '[]', ...by('someone-else') }), 'owner_merge=0 record=0 remove=1 not_owner=1');
  assert.equal(step({ ACTION: 'labeled', ADDED_LABEL: label, LABELS: JSON.stringify([label]), STATUSES: '[]', ...by('claude[bot]', 'Bot') }), 'owner_merge=0 record=0 remove=1 not_owner=1');
  assert.equal(step({ ACTION: 'labeled', ADDED_LABEL: label, LABELS: JSON.stringify([label]), STATUSES: '[]' }), 'owner_merge=0 record=0 remove=1 not_owner=1', 'no sender in the environment');
  assert.equal(step({ ACTION: 'edited', LABELS: JSON.stringify([label]), STATUSES: '[]' }), 'owner_merge=0 record=0 remove=1');
  assert.equal(step({ ACTION: 'edited', LABELS: JSON.stringify([label]), STATUSES: JSON.stringify(ok) }), 'owner_merge=1 record=0 remove=0');
  assert.equal(step({ ACTION: 'edited', LABELS: JSON.stringify([label]), STATUSES: 'not json' }), 'owner_merge=0 record=0 remove=0', 'unreadable statuses give no merge');
});

test('the CLI reads the diff with git: exit 0 eligible, 1 always manual, 2 unreadable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-eligible-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    assert.equal(run(['add', '-A']).status, 0);
    assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', file]).status, 0);
    return run(['rev-parse', 'HEAD']).stdout.trim();
  };
  assert.equal(run(['init', '-q', '-b', 'main']).status, 0);
  const base = commit('repo/contracts/agent-rules/global-rules.md', 'rules\n');
  const docs = commit('repo/docs/a.md', 'a\n');
  const hook = commit('hooks/hooks.json', '{}\n');
  const bump = commit('repo/contracts/toolkit-local-bridge/version.json', '{"version":"4.0.0"}\n');
  const out = [];
  const io = { cwd: root, stdout: { write: text => out.push(text) }, stderr: { write: text => out.push(text) } };
  assert.equal(eligible.main(['--base', base, '--head', docs], io), 0);
  assert.equal(eligible.main(['--base', docs, '--head', hook, '--json'], io), 1);
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: 'hooks/hooks.json', why: 'a hook' }]);
  assert.equal(eligible.main(['--base', hook, '--head', bump], io), 0, 'a first version file is no major bump');
  const stamped = commit('AGENTS.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.19.19 sha256=59b80466f009 -->\nrules\n');
  const restamped = commit('AGENTS.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nrules\n');
  assert.equal(eligible.main(['--base', stamped, '--head', restamped], io), 0, 'the release bump\'s marker change is eligible');
  const reworded = commit('AGENTS.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nlooser rules\n');
  assert.equal(eligible.main(['--base', restamped, '--head', reworded], io), 1, 'a rules change is not');
  assert.equal(eligible.main(['--base', bump, '--head', stamped], io), 1, 'a new instruction file is not stamp-only');
  assert.equal(run(['rm', '-q', 'repo/contracts/agent-rules/global-rules.md']).status, 0);
  assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'drop']).status, 0);
  const dropped = run(['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(eligible.main(['--base', reworded, '--head', dropped, '--json'], io), 1, 'deleting the marker still gets the Toolkit list');
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: 'repo/contracts/agent-rules/global-rules.md', why: 'the agent rules' }]);
  assert.equal(eligible.main(['--base', 'nope', '--head', hook], io), 2);
  assert.equal(eligible.main(['--base', 'f'.repeat(40), '--head', hook], io), 2);
  assert.equal(eligible.main(['--head', hook], io), 2);
  assert.equal(eligible.main(['--base', docs, '--head', hook, '--owner-merge', '--json'], io), 0, 'the owner\'s label lets an always-manual pull request pass');
  assert.equal(JSON.parse(out.at(-1)).owner_merge, true);
  assert.equal(eligible.main(['--base', base, '--head', docs, '--owner-merge', '--json'], io), 0);
  assert.equal(JSON.parse(out.at(-1)).owner_merge, false, 'an eligible pull request does not need it');
});

test('while the default branch\'s binding leaves task auto-merge off, the check passes and only lists', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-eligible-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    assert.equal(run(['add', '-A']).status, 0);
    assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', file]).status, 0);
    return run(['rev-parse', 'HEAD']).stdout.trim();
  };
  assert.equal(run(['init', '-q', '-b', 'main']).status, 0);
  const none = commit('repo/docs/a.md', 'a\n');
  const hook = commit('hooks/hooks.json', '{}\n');
  const binding = value => commit('.github/toolkit-programme.json', typeof value === 'string' ? value : JSON.stringify(value));
  const noTask = binding({ schema: 2 });
  const off = binding({ schema: 2, task_prs: { auto_merge: 'off' } });
  const on = binding({ schema: 2, task_prs: { auto_merge: 'after-gates' } });
  const odd = binding({ schema: 2, task_prs: { auto_merge: 'sometimes' } });
  const broken = binding('{ not json');
  const oldName = (() => { assert.equal(run(['rm', '-q', '.github/toolkit-programme.json']).status, 0); return commit('.github/ai-agent-toolkit-programme.json', JSON.stringify({ task_prs: { auto_merge: 'after-gates' } })); })();
  assert.equal(eligible.taskAutoMergeAt(root, none), 'off', 'no binding');
  assert.equal(eligible.taskAutoMergeAt(root, noTask), 'off', 'no answer');
  assert.equal(eligible.taskAutoMergeAt(root, off), 'off');
  assert.equal(eligible.taskAutoMergeAt(root, on), 'on');
  assert.equal(eligible.taskAutoMergeAt(root, oldName), 'on', 'the older binding name');
  assert.equal(eligible.taskAutoMergeAt(root, odd), 'unknown');
  assert.equal(eligible.taskAutoMergeAt(root, broken), 'unknown');
  assert.equal(eligible.taskAutoMergeAt(root, 'f'.repeat(40)), 'unknown', 'a commit git does not have');
  assert.equal(eligible.taskAutoMergeAt(root, 'HEAD; rm -rf /'), 'unknown');
  const out = [];
  const io = { cwd: root, stdout: { write: text => out.push(text) }, stderr: { write: text => out.push(text) } };
  const check = at => eligible.main(['--base', none, '--head', hook, '--binding-at', at], io);
  assert.equal(check(off), 0, 'off: passes');
  assert.match(out.at(-1), /Task auto-merge is off[\s\S]*hooks\/hooks\.json: a hook/, 'and still lists what would be always manual');
  assert.equal(check(noTask), 0);
  assert.equal(check(none), 0);
  for (const at of [on, oldName, odd, broken]) assert.equal(check(at), 1, `the full check: ${at}`);
  assert.equal(eligible.main(['--base', none, '--head', hook], io), 1, 'without --binding-at the check is always the full one');
  assert.equal(eligible.main(['--base', none, '--head', hook, '--binding-at'], io), 2);
  assert.equal(eligible.main(['--base', none, '--head', hook, '--binding-at', off, '--json'], io), 0);
  assert.equal(JSON.parse(out.at(-1)).task_auto_merge, 'off');
  assert.equal(JSON.parse(out.at(-1)).eligible, false, 'the verdict itself is unchanged');
});

test('every module a hook loads is always manual, followed from hooks.json at both ends of the pull request', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-eligible-hooks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (files, remove = []) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    for (const file of remove) fs.rmSync(path.join(root, file));
    assert.equal(run(['add', '-A']).status, 0);
    assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c']).status, 0);
    return run(['rev-parse', 'HEAD']).stdout.trim();
  };
  assert.equal(run(['init', '-q', '-b', 'main']).status, 0);
  const base = commit({
    'plugin/hooks/hooks.json': '{ "command": "node \\"$ROOT/repo/scripts/entry.cjs\\"" }\n',
    'repo/scripts/entry.cjs': "require('./guard.cjs');\n",
    'repo/scripts/guard.cjs': "const path = require('node:path');\nrequire(path.join(__dirname, 'leaf.cjs'));\nrequire('../../skills/x/scripts/reader');\n",
    'repo/scripts/leaf.cjs': 'module.exports = 1;\n',
    'skills/x/scripts/reader.cjs': 'module.exports = 2;\n',
    'repo/scripts/unrelated.cjs': 'module.exports = 3;\n',
  });
  const io = { cwd: root, stdout: { write: () => {} }, stderr: { write: () => {} } };
  for (const file of ['repo/scripts/entry.cjs', 'repo/scripts/guard.cjs', 'repo/scripts/leaf.cjs', 'skills/x/scripts/reader.cjs']) {
    const head = commit({ [file]: `${fs.readFileSync(path.join(root, file), 'utf8')}// changed\n` });
    assert.equal(eligible.main(['--base', base, '--head', head], io), 1, file);
    assert.equal(run(['reset', '-q', '--hard', base]).status, 0);
  }
  const other = commit({ 'repo/scripts/unrelated.cjs': 'module.exports = 4;\n' });
  assert.equal(eligible.main(['--base', base, '--head', other], io), 0, 'a module no hook loads is eligible');
  assert.equal(run(['reset', '-q', '--hard', base]).status, 0);
  // A pull request that stops a hook loading a module and changes it is still caught from the base.
  const unhooked = commit({ 'repo/scripts/guard.cjs': 'module.exports = 0;\n', 'repo/scripts/leaf.cjs': 'module.exports = 9;\n' });
  const out = [];
  assert.equal(eligible.main(['--base', base, '--head', unhooked, '--json'], { ...io, stdout: { write: text => out.push(text) } }), 1);
  assert.deepEqual(JSON.parse(out.at(-1)).reasons.map(entry => entry.path).sort(), ['repo/scripts/guard.cjs', 'repo/scripts/leaf.cjs']);
});

test('the list covers every repository file the real hooks load when they start', () => {
  const root = path.resolve(__dirname, '..', '..');
  // The repository's files from git, or from the folder itself in a copy without git (an archive).
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const walk = (folder, prefix = '') => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules', '.tmp'].includes(entry.name)) return [];
    const rel = `${prefix}${entry.name}`;
    return entry.isDirectory() ? walk(path.join(folder, entry.name), `${rel}/`) : [rel];
  });
  const paths = listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : walk(root);
  const hooks = eligible.hookModules(paths, file => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } });
  const entries = new Set();
  for (const file of paths.filter(name => /(?:^|\/)hooks\.json$/.test(name))) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/repo\/scripts\/[\w.-]+\.cjs/g)) entries.add(match[0]);
  }
  assert.ok(entries.size >= 5, 'the hooks name their scripts');
  // Load every entry script the way a hook does (each guards its own main), then read what Node loaded.
  const probe = spawnSync(process.execPath, ['-e', `for (const file of ${JSON.stringify([...entries])}) require(require('node:path').join(${JSON.stringify(root)}, file)); process.stdout.write(JSON.stringify(Object.keys(require.cache)));`], { cwd: root, encoding: 'utf8', env: { ...process.env, TOOLKIT_GOVERNANCE_OFFLINE: '1' }, timeout: 60000 });
  assert.equal(probe.status, 0, probe.stderr);
  const loaded = JSON.parse(probe.stdout).map(file => path.relative(root, file).split(path.sep).join('/')).filter(file => !file.startsWith('..') && !file.startsWith('node_modules/'));
  assert.ok(loaded.length >= entries.size);
  const missing = loaded.filter(file => !hooks.has(file) && !file.endsWith('.json'));
  assert.deepEqual(missing, [], 'every module a hook loads is on the always-manual list');
  const verdict = eligible.eligibility({ files: loaded.filter(file => !file.endsWith('.json')), toolkit: true, hooks });
  assert.equal(verdict.reasons.length, loaded.filter(file => !file.endsWith('.json')).length);
});
