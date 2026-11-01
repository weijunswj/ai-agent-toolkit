'use strict';

// Task auto-merge scope: the merge-authority list that waits for the owner's typed merge, and the
// CLI the controller and the merge hold run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const eligible = require('../scripts/toolkit-auto-merge-eligible.cjs');

test('merge-authority paths and a major bump wait for the owner; everything else is eligible', () => {
  const verdict = (files, toolkit = true, versions = {}) => eligible.eligibility({ files, toolkit, versions });
  assert.deepEqual(verdict(['repo/scripts/run-tests.cjs', 'repo/docs/README.md', 'skills/frontend-art-direction/SKILL.md', 'repo/tests/x.test.cjs']), { eligible: true, reasons: [] });
  const authority = [
    '.github/toolkit-programme.json', '.github/ai-agent-toolkit-programme.json', '.github/workflows/validate.yml',
    'repo/contracts/agent-rules/global-rules.md', 'repo/contracts/agent-rules/gate-rules.md', 'repo/CONTROLLER.md',
    'repo/contracts/programme-state/binding-v2.schema.json', 'skills/github-program-reconciler/scripts/programme-state.cjs',
    'repo/scripts/toolkit-merge-hold.cjs', 'repo/scripts/toolkit-shell-call.cjs', 'repo/scripts/toolkit-governance-gate.cjs',
    'repo/scripts/toolkit-governance-state.cjs', 'repo/scripts/toolkit-auto-merge-eligible.cjs',
    'repo/scripts/toolkit-task-auto-merge-preferences.cjs', 'repo/scripts/setup-toolkit-core.cjs',
    'repo/scripts/setup-core-codex.cjs', 'repo/scripts/setup-core-claude.cjs',
    'repo/scripts/toolkit-capability-registry.cjs', 'repo/contracts/agent-rules/toolkit-governed-rules.md',
    'repo/docs/agent-playbooks/safety-gates.md',
    'skills/repository-agent-rules/repo-local/docs/agent-playbooks/safety-gates.md',
  ];
  for (const file of authority) {
    const result = verdict(['repo/docs/README.md', file]);
    assert.equal(result.eligible, false, file);
    assert.deepEqual(result.reasons.map(entry => entry.path), [file], file);
  }
  // Both hook manifests/entrypoints, setup and governance require typed merge too.
  const protectedPaths = [
    'hooks/hooks.json', '.claude-plugin/hooks/hooks.json', '.codex-plugin/hooks/hooks.json',
    'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json',
    'repo/scripts/toolkit-governance-hook.cjs', 'repo/scripts/toolkit-codex-helper-hook.cjs', 'repo/scripts/toolkit-codex-helper-hook.ps1',
    'repo/scripts/toolkit-claude-agent-hook.cjs', 'repo/scripts/toolkit-claude-attribution-hook.cjs',
    'repo/scripts/toolkit-local-bridge.cjs', 'repo/scripts/toolkit-codex-session-start.cjs', 'repo/scripts/toolkit-codex-session-start.ps1',
    'repo/scripts/setup-codex-toolkit-plugin.cjs', 'repo/scripts/setup-claude-toolkit-plugin.cjs',
    'repo/scripts/toolkit-governance-conformance.cjs', 'repo/scripts/toolkit-governance.cjs',
    'repo/scripts/toolkit-governance-binding.cjs', 'repo/scripts/toolkit-governance-answer.cjs',
  ];
  for (const file of protectedPaths) assert.equal(verdict([file]).eligible, false, file);
  for (const file of ['AGENTS.md', 'sub/CLAUDE.md', '.github/copilot-instructions.md', '.agents/rules/00-bootstrap.md',
    'skills/repository-agent-rules/SKILL.md', 'repo/contracts/agent-rules/README.md']) assert.equal(verdict([file]).eligible, true, file);
  assert.equal(verdict(['repo/CONTROLLER.md'], false).eligible, true, 'the Toolkit list applies only to the Toolkit repository');
  assert.equal(verdict(['.github/workflows/ci.yml'], false).eligible, false, 'the general list applies everywhere');
  assert.match(verdict([], true, { 'repo/contracts/toolkit-local-bridge/version.json': { before: '3.20.0', after: '4.0.0' } }).reasons[0].why, /major version bump/);
  assert.equal(verdict([], true, { 'repo/contracts/toolkit-local-bridge/version.json': { before: '3.20.0', after: '3.21.0' } }).eligible, true);
  // What the release bump at merge time touches is eligible: plugin metadata, the changelog.
  assert.equal(verdict(['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'repo/docs/CHANGELOG.md']).eligible, true);
  assert.equal(eligible.eligibility({ files: ['repo/CONTROLLER.md'], toolkit: true, stampOnly: ['repo/CONTROLLER.md'] }).eligible, true, 'a stamp-only change');
  // The Projects controller skill counts only when its Approvals section changed.
  const skill = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
  assert.equal(eligible.eligibility({ files: [skill], toolkit: true }).eligible, true, 'another section');
  assert.deepEqual(eligible.eligibility({ files: [skill], toolkit: true, sectionChanged: [skill] }).reasons, [{ path: skill, why: 'the Projects controller skill\'s Approvals section' }]);
  const marker = version => `<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=${version} sha256=59b80466f009 -->\nbody\nVersion: 2026-10-30.2\n`;
  assert.equal(eligible.withoutStamps(marker('3.19.19')), eligible.withoutStamps(marker('3.20.0').replace('30.2', '31.1')));
  assert.notEqual(eligible.withoutStamps(marker('3.19.19')), eligible.withoutStamps(marker('3.19.19').replace('body', 'changed body')));
  assert.equal(eligible.withoutStamps('{\n  "version": "3.21.0",\n}'), eligible.withoutStamps('{\n  "version": "3.22.0",\n}'));
  assert.equal(eligible.withoutStamps("const BRIDGE_VERSION = '3.21.0';\n"), eligible.withoutStamps("const BRIDGE_VERSION = '3.22.0';\n"));
  assert.notEqual(eligible.withoutStamps("const BRIDGE_VERSION = '3.21.0';\nhook();\n"), eligible.withoutStamps("const BRIDGE_VERSION = '3.22.0';\nother();\n"));
});

test('every script run by a host hook manifest, including Windows launchers, waits for typed merge', () => {
  const root = path.join(__dirname, '..', '..');
  const { renderInstalledWindowsHooks } = require('../scripts/setup-codex-toolkit-plugin.cjs');
  const manifests = [
    'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json',
    'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json',
    ...['hooks/hooks.json', '.claude-plugin/hooks/hooks.json', '.codex-plugin/hooks/hooks.json']
      .filter(file => fs.existsSync(path.join(root, file))),
  ];
  for (const manifest of manifests) {
    const scripts = new Set();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if ((key === 'command' || key === 'commandWindows') && typeof entry === 'string') {
          const matches = [...entry.replace(/\\/g, '/').matchAll(/\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}\/([A-Za-z0-9_./-]+)/g)];
          assert.ok(matches.length > 0, `${manifest}: ${key} must name a plugin script to check`);
          for (const match of matches) scripts.add(match[1]);
        } else visit(entry);
      }
    }
    const hooks = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
    // Check the actual commandWindows entries that setup adds to the installed Codex copy too.
    visit(manifest.includes('codex-plugin/') ? renderInstalledWindowsHooks(hooks, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') : hooks);
    assert.ok(scripts.size > 0, `${manifest}: hook scripts must be checked`);
    for (const file of scripts) {
      for (const toolkit of [false, true]) {
        assert.equal(eligible.eligibility({ files: [file], toolkit }).eligible, false, `${manifest}: ${file} must require typed merge (toolkit=${toolkit})`);
      }
    }
  }
});

test('a section runs from its heading to the next heading of the same or a higher level', () => {
  const text = '# Skill\n\n## Approvals\n- ask first\n### Detail\n- more\n## Live systems\n- other\n';
  assert.equal(eligible.sectionOf(text, '## Approvals'), '## Approvals\n- ask first\n### Detail\n- more');
  assert.equal(eligible.sectionOf(text.replace(/\n/g, '\r\n'), '## Approvals'), '## Approvals\n- ask first\n### Detail\n- more', 'CRLF reads the same');
  assert.equal(eligible.sectionOf('## Approvals\nlast\n', '## Approvals'), '## Approvals\nlast\n');
  assert.equal(eligible.sectionOf(text, '## Missing'), null);
});

test('nothing in the repository still uses the old label, its workflow or its status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'toolkit-auto-merge-eligible.cjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map(match => match[1].trim()), ["'node:child_process'"], 'it needs nothing but Node\'s own modules');
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'auto-merge-eligible.yml')), false, 'the label workflow is gone');
  const old = 'toolkit-owner-merge';
  for (const file of ['repo/scripts/toolkit-auto-merge-eligible.cjs', 'repo/scripts/toolkit-merge-hold.cjs', 'repo/scripts/toolkit-governance-state.cjs',
    'repo/scripts/toolkit-governance-conformance.cjs', 'repo/contracts/agent-rules/gate-rules.md', 'repo/contracts/claude-projects/web-controller-projects/SKILL.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE.md', 'repo/ARCHITECTURE.md']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').includes(old), false, file);
  }
});

test('the CLI reads the diff with git: exit 0 eligible, 1 waits for the owner, 2 unreadable', (t) => {
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
  const workflow = commit('.github/workflows/ci.yml', 'name: ci\n');
  const bump = commit('repo/contracts/toolkit-local-bridge/version.json', '{"version":"4.0.0"}\n');
  const out = [];
  const io = { cwd: root, stdout: { write: text => out.push(text) }, stderr: { write: text => out.push(text) } };
  assert.equal(eligible.main(['--base', base, '--head', docs], io), 0);
  assert.match(out.at(-1), /^Auto-merge: yes/);
  assert.equal(eligible.main(['--base', docs, '--head', hook], io), 1, 'a hook waits for typed merge');
  assert.equal(eligible.main(['--base', hook, '--head', workflow, '--json'], io), 1);
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: '.github/workflows/ci.yml', why: 'a CI workflow' }]);
  assert.equal(eligible.main(['--base', hook, '--head', workflow], io), 1);
  assert.match(out.at(-1), /^Waits for the owner's typed merge[\s\S]*\.github\/workflows\/ci\.yml: a CI workflow/);
  assert.equal(eligible.main(['--base', workflow, '--head', bump], io), 0, 'a first version file is no major bump');
  const stamped = commit('repo/CONTROLLER.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.19.19 sha256=59b80466f009 -->\nrules\n');
  const restamped = commit('repo/CONTROLLER.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nrules\n');
  assert.equal(eligible.main(['--base', stamped, '--head', restamped], io), 0, 'the release bump\'s marker change is eligible');
  const reworded = commit('repo/CONTROLLER.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nlooser rules\n');
  assert.equal(eligible.main(['--base', restamped, '--head', reworded], io), 1, 'a rules change is not');
  assert.equal(eligible.main(['--base', bump, '--head', stamped], io), 1, 'a new rules file is not stamp-only');
  let previous = reworded;
  for (const file of ['repo/scripts/toolkit-local-bridge.cjs', 'repo/scripts/toolkit-codex-session-start.cjs', 'repo/scripts/toolkit-codex-session-start.ps1']) {
    const head = commit(file, 'hook entrypoint\n');
    assert.equal(eligible.main(['--base', previous, '--head', head, '--json'], io), 1, `${file} waits for typed merge`);
    assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: file, why: 'a host hook entrypoint' }]);
    previous = head;
  }
  // The Projects controller skill: only its Approvals section counts.
  const skill = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
  const skillText = approvals => `# Skill\nVersion: 2026-10-30.2\n\n## Threads\n- threads\n\n## Approvals\n- ${approvals}\n\n## Live systems\n- live\n`;
  const skillBase = commit(skill, skillText('ask first'));
  const otherSection = commit(skill, skillText('ask first').replace('- threads', '- threads, reworded').replace('30.2', '31.1'));
  assert.equal(eligible.main(['--base', skillBase, '--head', otherSection], io), 0, 'another section of the skill');
  const approvals = commit(skill, skillText('merge whenever'));
  assert.equal(eligible.main(['--base', otherSection, '--head', approvals, '--json'], io), 1, 'its Approvals section');
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: skill, why: 'the Projects controller skill\'s Approvals section' }]);
  const headingGone = commit(skill, skillText('merge whenever').replace('## Approvals', '## Approval'));
  assert.equal(eligible.main(['--base', approvals, '--head', headingGone], io), 1, 'renaming the heading away counts');
  assert.equal(run(['rm', '-q', 'repo/contracts/agent-rules/global-rules.md']).status, 0);
  assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'drop']).status, 0);
  const dropped = run(['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(eligible.main(['--base', headingGone, '--head', dropped, '--json'], io), 1, 'deleting the marker still gets the Toolkit list');
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: 'repo/contracts/agent-rules/global-rules.md', why: 'the agent rules on merging' }]);
  assert.equal(eligible.main(['--base', 'nope', '--head', hook], io), 2);
  assert.equal(eligible.main(['--base', 'f'.repeat(40), '--head', hook], io), 2);
  assert.equal(eligible.main(['--head', hook], io), 2);
  // The merge hold reads the base from this folder's copy of the remote's default branch.
  assert.equal(run(['update-ref', 'refs/remotes/origin/main', docs]).status, 0);
  assert.equal(eligible.commitOf(root, 'refs/remotes/origin/main'), docs);
  assert.equal(eligible.commitOf(root, 'refs/remotes/origin/missing'), null);
  assert.equal(eligible.commitOf(root, '--all'), null, 'an option is never a ref');
  assert.equal(eligible.commitOf(root, 'HEAD; rm -rf /'), null);
});
