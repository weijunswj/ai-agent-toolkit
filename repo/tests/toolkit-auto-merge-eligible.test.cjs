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
const hostile = require('./support/hostile-inputs.cjs');

// Characters outside printable ASCII are built from their code points, so this file holds none.
const cp = (...points) => String.fromCodePoint(...points);

test('merge-authority paths and a major bump wait for the owner; everything else is eligible', () => {
  const verdict = (files, toolkit = true, versions = {}) => eligible.eligibility({ files, toolkit, versions });
  assert.deepEqual(verdict(['repo/scripts/run-tests.cjs', 'repo/docs/README.md', 'skills/frontend-art-direction/SKILL.md', 'repo/tests/x.test.cjs']), { eligible: true, reasons: [] });
  const authority = [
    '.github/toolkit-programme.json', '.github/ai-agent-toolkit-programme.json', '.github/workflows/validate.yml',
    'repo/contracts/agent-rules/global-rules.md', 'repo/contracts/agent-rules/gate-rules.md', 'repo/CONTROLLER.md',
    'repo/controller/roles-and-routes.md', 'repo/controller/gates.md', 'repo/controller/evidence-and-finish.md',
    'repo/contracts/programme-state/binding-v2.schema.json', 'skills/github-program-reconciler/scripts/programme-state.cjs',
    'repo/scripts/toolkit-merge-hold.cjs', 'repo/scripts/toolkit-shell-call.cjs', 'repo/scripts/toolkit-governance-gate.cjs',
    'repo/scripts/toolkit-governance-state.cjs', 'repo/scripts/toolkit-auto-merge-eligible.cjs',
    'repo/scripts/toolkit-rebump-prs.cjs', 'repo/scripts/toolkit-rebump-report.cjs', 'repo/scripts/toolkit-rebump-action.sh',
    'repo/scripts/toolkit-task-auto-merge-preferences.cjs', 'repo/scripts/setup-toolkit-core.cjs',
    'repo/scripts/setup-core-codex.cjs', 'repo/scripts/setup-core-claude.cjs',
    'repo/scripts/toolkit-repository-identity.cjs', 'repo/scripts/toolkit-user-state.cjs', 'repo/scripts/toolkit-governance-proposal.cjs', 'repo/contracts/agent-rules/toolkit-governed-rules.md',
    'repo/docs/agent-playbooks/safety-gates.md',
    'skills/repository-agent-rules/repo-local/docs/agent-playbooks/safety-gates.md',
    'repo/scripts/toolkit-permissions.cjs', 'repo/scripts/toolkit-permissions-apply.cjs', 'repo/scripts/toolkit-cleanup.cjs', 'repo/scripts/toolkit-store.cjs',
  ];
  for (const file of authority) {
    const result = verdict(['repo/docs/README.md', file]);
    assert.equal(result.eligible, false, file);
    assert.deepEqual(result.reasons.map(entry => entry.path), [file], file);
  }
  // Both hook manifests/entrypoints, setup and governance require typed merge too.
  const protectedPaths = [
    'repo/scripts/toolkit-issue-closure.cjs', 'skills/github-program-reconciler/scripts/issue-closure.cjs',
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

test('a controller takeover playbook-only change waits for typed merge as controller rules', () => {
  const file = 'repo/docs/agent-playbooks/controller-takeover.md';
  for (const sectionChanged of [[], [file]]) {
    assert.deepEqual(eligible.eligibility({ files: [file], toolkit: true, sectionChanged }), {
      eligible: false, reasons: [{ path: file, why: 'the controller rules' }],
    });
  }
  assert.deepEqual(eligible.eligibility({ files: ['repo/docs/agent-playbooks/INDEX.md'], toolkit: true }), {
    eligible: true, reasons: [],
  });
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
  assert.deepEqual([...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map(match => match[1].trim()), ["'node:fs'", "'node:path'", "'node:child_process'"], 'it needs nothing but Node\'s own modules');
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
  assert.equal(eligible.main(['--scope-only', '--base', base, '--head', docs], io), 0);
  assert.match(out.at(-1), /^Scope only: nothing here changes the merge rules\. The UAT verdict was not read, so this grants no merge readiness/);
  assert.equal(eligible.main(['--scope-only', '--base', docs, '--head', hook], io), 1, 'a hook waits for typed merge');
  assert.equal(eligible.main(['--scope-only', '--base', hook, '--head', workflow, '--json'], io), 1);
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: '.github/workflows/ci.yml', why: 'a CI workflow' }]);
  assert.equal(eligible.main(['--scope-only', '--base', hook, '--head', workflow], io), 1);
  assert.match(out.at(-1), /^Waits for the owner's typed merge[\s\S]*\.github\/workflows\/ci\.yml: a CI workflow/);
  assert.equal(eligible.main(['--scope-only', '--base', workflow, '--head', bump], io), 0, 'a first version file is no major bump');
  const stamped = commit('repo/CONTROLLER.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.19.19 sha256=59b80466f009 -->\nrules\n');
  const restamped = commit('repo/CONTROLLER.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nrules\n');
  assert.equal(eligible.main(['--scope-only', '--base', stamped, '--head', restamped], io), 0, 'the release bump\'s marker change is eligible');
  const reworded = commit('repo/CONTROLLER.md', '<!-- AI-AGENT-TOOLKIT:x:BEGIN Y v2 toolkit=3.20.0 sha256=59b80466f009 -->\nlooser rules\n');
  assert.equal(eligible.main(['--scope-only', '--base', restamped, '--head', reworded], io), 1, 'a rules change is not');
  assert.equal(eligible.main(['--scope-only', '--base', bump, '--head', stamped], io), 1, 'a new rules file is not stamp-only');
  let previous = reworded;
  for (const file of ['repo/scripts/toolkit-local-bridge.cjs', 'repo/scripts/toolkit-codex-session-start.cjs', 'repo/scripts/toolkit-codex-session-start.ps1']) {
    const head = commit(file, 'hook entrypoint\n');
    assert.equal(eligible.main(['--scope-only', '--base', previous, '--head', head, '--json'], io), 1, `${file} waits for typed merge`);
    assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: file, why: 'a host hook entrypoint' }]);
    previous = head;
  }
  // The Projects controller skill: only its Approvals section counts.
  const skill = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
  const skillText = approvals => `# Skill\nVersion: 2026-10-30.2\n\n## Threads\n- threads\n\n## Approvals\n- ${approvals}\n\n## Live systems\n- live\n`;
  const skillBase = commit(skill, skillText('ask first'));
  const otherSection = commit(skill, skillText('ask first').replace('- threads', '- threads, reworded').replace('30.2', '31.1'));
  assert.equal(eligible.main(['--scope-only', '--base', skillBase, '--head', otherSection], io), 0, 'another section of the skill');
  const approvals = commit(skill, skillText('merge whenever'));
  assert.equal(eligible.main(['--scope-only', '--base', otherSection, '--head', approvals, '--json'], io), 1, 'its Approvals section');
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: skill, why: 'the Projects controller skill\'s Approvals section' }]);
  const headingGone = commit(skill, skillText('merge whenever').replace('## Approvals', '## Approval'));
  assert.equal(eligible.main(['--scope-only', '--base', approvals, '--head', headingGone], io), 1, 'renaming the heading away counts');
  assert.equal(run(['rm', '-q', 'repo/contracts/agent-rules/global-rules.md']).status, 0);
  assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'drop']).status, 0);
  const dropped = run(['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(eligible.main(['--scope-only', '--base', headingGone, '--head', dropped, '--json'], io), 1, 'deleting the marker still gets the Toolkit list');
  assert.deepEqual(JSON.parse(out.at(-1)).reasons, [{ path: 'repo/contracts/agent-rules/global-rules.md', why: 'the agent rules on merging' }]);
  assert.equal(eligible.main(['--scope-only', '--base', 'nope', '--head', hook], io), 2);
  assert.equal(eligible.main(['--scope-only', '--base', 'f'.repeat(40), '--head', hook], io), 2);
  assert.equal(eligible.main(['--scope-only', '--head', hook], io), 2);
  assert.equal(eligible.main(['--base', base, '--head', docs], io), 2, 'neither a body nor --scope-only: no readiness claim');
  assert.match(out.at(-1), /--body-file/);
  // The merge hold reads the base from this folder's copy of the remote's default branch.
  assert.equal(run(['update-ref', 'refs/remotes/origin/main', docs]).status, 0);
  assert.equal(eligible.commitOf(root, 'refs/remotes/origin/main'), docs);
  assert.equal(eligible.commitOf(root, 'refs/remotes/origin/missing'), null);
  assert.equal(eligible.commitOf(root, '--all'), null, 'an option is never a ref');
  assert.equal(eligible.commitOf(root, 'HEAD; rm -rf /'), null);
});

// Hostile shapes that, put straight before a good UAT line, leave the line as written: each ends
// with a line break of its own, or is the one leading byte order mark the reader drops. (The
// bad-bytes case is its text as a UTF-8 read shows it; the CLI rows below refuse its bytes.)
const PREFIX_LEAVES_THE_LINE = ['tag-directive', 'indented-later-document', 'second-document', 'document-end-marker', 'bom-at-start', 'bom-before-tag-directive', 'bad-utf8-bytes', 'long-line', 'space-run', 'space-run-before-comment', 'many-short-lines'];

// The UAT verdict: one hand-written line in the pull request body. One row per closure-matrix row.
const UAT_ROWS = [
  // [name, body, state, problem pattern]
  ['absent', 'Fixes the thing.\n', 'absent', null],
  ['empty body', '', 'absent', /empty/],
  ['blank body', ' \n\n', 'absent', /empty/],
  ['not required', 'Intro\n\nUAT: NOT_REQUIRED (internal check only)\n', 'NOT_REQUIRED', null],
  ['owner test needed', 'UAT: OWNER_TEST_NEEDED (open the report and check the totals)', 'OWNER_TEST_NEEDED', null],
  ['passed', 'UAT: PASSED (owner OK, 11 Nov 2026, https://example.com/thread/1)', 'PASSED', null],
  ['CRLF and trailing spaces', 'Intro\r\nUAT: NOT_REQUIRED (docs only)  \r\nMore\r\n', 'NOT_REQUIRED', null],
  ['reason holding brackets', 'UAT: NOT_REQUIRED (covered by test (a) and test (b))', 'NOT_REQUIRED', null],
  ['no reason', 'UAT: NOT_REQUIRED', 'invalid', /reason/],
  ['empty reason', 'UAT: NOT_REQUIRED ()', 'invalid', /reason/],
  ['blank reason', 'UAT: NOT_REQUIRED (   )', 'invalid', /reason/],
  ['passed with no evidence', 'UAT: PASSED', 'invalid', /reason/],
  ['two lines, same', 'UAT: NOT_REQUIRED (a)\nUAT: NOT_REQUIRED (a)', 'invalid', /more than one/],
  ['two lines, different', 'UAT: NOT_REQUIRED (a)\n\nUAT: OWNER_TEST_NEEDED (b)', 'invalid', /more than one/],
  ['unknown word', 'UAT: SKIP (no need)', 'invalid', /NOT_REQUIRED, OWNER_TEST_NEEDED or PASSED/],
  ['a dash', 'UAT: -', 'invalid', /NOT_REQUIRED, OWNER_TEST_NEEDED or PASSED/],
  ['lower case label', 'uat: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['lower case value', 'UAT: not_required (a)', 'invalid', /NOT_REQUIRED, OWNER_TEST_NEEDED or PASSED/],
  ['bulleted', '- UAT: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['bold', '**UAT:** NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['indented', '  UAT: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['text after the reason', 'UAT: NOT_REQUIRED (a) and more', 'invalid', /reason/],
  ['a control character in the reason', 'UAT: NOT_REQUIRED (a\u001b[2Kb)', 'invalid', /invisible/],
  ['a tab in the reason', 'UAT: NOT_REQUIRED (a\tb)', 'invalid', /a tab/],
  ['one good line and one near miss', 'UAT: NOT_REQUIRED (a)\n- UAT: PASSED (b)', 'invalid', /more than one/],
  ['only in a code fence', '```\nUAT: NOT_REQUIRED (a)\n```\n', 'absent', null],
  ['only in a tilde fence', '~~~text\nUAT: NOT_REQUIRED (a)\n~~~\n', 'absent', null],
  ['only in an unclosed fence', 'Intro\n```\nUAT: NOT_REQUIRED (a)\n', 'absent', null],
  ['only in a quote', '> UAT: NOT_REQUIRED (a)\n', 'absent', null],
  ['only in an HTML comment', '<!--\nUAT: NOT_REQUIRED (a)\n-->\n', 'absent', null],
  ['only in an unclosed HTML comment', 'Intro\n<!--\nUAT: NOT_REQUIRED (a)\n', 'absent', null],
  // A marker block is read like any other text, so a visible line can never hide in a made-up one.
  ['in a Toolkit marker block', '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.60.0 sha256=9557d29730c2 -->\n**Status**\n\nUAT: NOT_REQUIRED (a)\n- UAT: -; review: -\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\nBody\n', 'NOT_REQUIRED', null],
  ['in an unclosed Toolkit marker block', 'Body\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.60.0 sha256=9557d29730c2 -->\nUAT: NOT_REQUIRED (a)\n', 'NOT_REQUIRED', null],
  ['a made-up marker block around a second line', '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.60.0 sha256=9557d29730c2 -->\nUAT: OWNER_TEST_NEEDED (b)\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\nUAT: NOT_REQUIRED (a)\n', 'invalid', /more than one/],
  ['only the generated status line in a marker block', '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.60.0 sha256=9557d29730c2 -->\n- UAT: NOT_REQUIRED; review: PASS\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n', 'absent', null],
  ['a generated status line outside a marker block', '- UAT: PASSED; review: PASS\n', 'invalid', /start of a line/],
  ['a marker block then the real line', '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.60.0 sha256=9557d29730c2 -->\n- UAT: PASSED; review: PASS\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n\nUAT: OWNER_TEST_NEEDED (try the export)\n', 'OWNER_TEST_NEEDED', null],
  ['a fence then the real line', '```\nUAT: PASSED (x)\n```\nUAT: NOT_REQUIRED (docs)\n', 'NOT_REQUIRED', null],
  ['prose that mentions UAT', 'The UAT: line is described in the playbook. Owner UAT is not needed.\n', 'absent', null],
  ['not a string', null, 'absent', null],
  // Dressed lines count as a line, so they are refused and never skipped.
  ['a heading', '## UAT: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['a heading beside the real line', '## UAT: OWNER_TEST_NEEDED (b)\n\nUAT: NOT_REQUIRED (a)', 'invalid', /more than one/],
  ['a numbered item', '1. UAT: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['italic', '*UAT*: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['a bullet in a bullet', '- - UAT: NOT_REQUIRED (a)', 'invalid', /start of a line/],
  ['an example in inline code', 'One of:\n  - `UAT: NOT_REQUIRED (reason)`\n', 'absent', null],
  // Line ends: GitHub ends a line at LF, CRLF and a lone CR.
  ['lone CR line ends', 'Intro\rUAT: NOT_REQUIRED (a)\rMore\r', 'NOT_REQUIRED', null],
  ['a second line after a lone CR', 'UAT: OWNER_TEST_NEEDED (b)\rUAT: NOT_REQUIRED (a)', 'invalid', /more than one/],
  ...[['NEL', 0x85], ['LS', 0x2028], ['PS', 0x2029], ['a vertical tab', 0x0b], ['a form feed', 0x0c]].flatMap(([name, point]) => [
    [`a second line after ${name}`, `UAT: OWNER_TEST_NEEDED (b)${cp(point)}UAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
    [`a line after ${name}`, `Intro${cp(point)}UAT: NOT_REQUIRED (a)`, 'invalid', /invisible/],
    [`${name} inside the reason`, `UAT: NOT_REQUIRED (a${cp(point)}b)`, 'invalid', /invisible/],
  ]),
  // A byte order mark: one at the very start is dropped, as GitHub and editors do.
  ['a byte order mark, then the line', `${cp(0xfeff)}UAT: NOT_REQUIRED (a)\r\n`, 'NOT_REQUIRED', null],
  ['a byte order mark, an owner test, then a second line', `${cp(0xfeff)}UAT: OWNER_TEST_NEEDED (b)\r\n\r\nUAT: NOT_REQUIRED (a)\r\n`, 'invalid', /more than one/],
  ['a byte order mark alone', cp(0xfeff), 'absent', /empty/],
  ['two byte order marks', `${cp(0xfeff, 0xfeff)}UAT: NOT_REQUIRED (a)`, 'invalid', /invisible/],
  ['a byte order mark on a later line', `Intro\n${cp(0xfeff)}UAT: NOT_REQUIRED (a)`, 'invalid', /invisible/],
  // Invisible characters, other spaces and look-alike letters in or before the word.
  ...[['a zero-width space', 0x200b], ['a zero-width joiner', 0x200d], ['a word joiner', 0x2060], ['a soft hyphen', 0xad], ['a right-to-left mark', 0x200f], ['a right-to-left override', 0x202e], ['a no-break space', 0xa0], ['an em space', 0x2003], ['an ideographic space', 0x3000], ['a tab', 0x09], ['a NUL', 0x00], ['a combining accent', 0x301]].flatMap(([name, point]) => [
    [`${name} before the word`, `${cp(point)}UAT: NOT_REQUIRED (a)`, 'invalid', /invisible|start of a line/],
    [`${name} before a second line`, `${cp(point)}UAT: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
    [`${name} inside the word`, `UA${cp(point)}T: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
    [`${name} before the colon`, `UAT${cp(point)}: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
  ]),
  ['a no-break space after the colon', `UAT:${cp(0xa0)}NOT_REQUIRED (a)`, 'invalid', /invisible/],
  ['a Cyrillic A in the word', `U${cp(0x410)}T: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
  ['a Greek tau in the word', `UA${cp(0x3a4)}: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
  ['an Armenian U in the word', `${cp(0x54d)}AT: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
  ['full-width letters and colon', `${cp(0xff35, 0xff21, 0xff34, 0xff1a)} OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
  ['a full-width colon', `UAT${cp(0xff1a)} OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)`, 'invalid', /more than one/],
  // Fences as GitHub reads them.
  ['a backtick in the fence info is no fence', '``` a`b\nUAT: OWNER_TEST_NEEDED (b)\n', 'OWNER_TEST_NEEDED', null],
  ['a shorter run does not close a fence', '````\nUAT: NOT_REQUIRED (a)\n```\nUAT: NOT_REQUIRED (b)\n', 'absent', null],
  ['a tilde run does not close a backtick fence', '```\nUAT: NOT_REQUIRED (a)\n~~~\nUAT: NOT_REQUIRED (b)\n', 'absent', null],
  ['a fence line with text after the run does not close', '```\nUAT: NOT_REQUIRED (a)\n``` x\nUAT: NOT_REQUIRED (b)\n', 'absent', null],
  ['a fence indented four spaces is no fence', '    ```\nUAT: OWNER_TEST_NEEDED (b)\n', 'OWNER_TEST_NEEDED', null],
  // HTML comments: hidden only when the comment starts a line.
  ['a comment that starts mid-line', 'Text <!--\nUAT: NOT_REQUIRED (a)\n-->\n', 'invalid', /HTML comment/],
  ['a comment that starts mid-line, beside a second line', 'Text <!--\nUAT: OWNER_TEST_NEEDED (b)\n-->\nUAT: NOT_REQUIRED (a)\n', 'invalid', /more than one/],
  ['a comment in indented code', '    <!--\nUAT: NOT_REQUIRED (a)\n-->\n', 'invalid', /HTML comment/],
  ['a comment in a bullet', '- <!--\nUAT: NOT_REQUIRED (a)\n-->\n', 'invalid', /HTML comment/],
  ['a closed mid-line comment, then the line', 'Text <!-- note --> more\nUAT: NOT_REQUIRED (a)\n', 'NOT_REQUIRED', null],
  ['a line after a comment on the same line', '<!-- note -->UAT: NOT_REQUIRED (a)\n', 'invalid', /HTML comment/],
  ['a second line after a comment on the same line', '<!-- note -->UAT: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)\n', 'invalid', /more than one/],
  ['a second line after the end of a comment', '<!--\nnote\n-->UAT: OWNER_TEST_NEEDED (b)\nUAT: NOT_REQUIRED (a)\n', 'invalid', /more than one/],
  ['a comment reopened after its end', '<!--\n--> <!--\nUAT: NOT_REQUIRED (a)\n-->\n', 'invalid', /HTML comment/],
  ['a comment, then the real line', '<!-- note -->\nUAT: NOT_REQUIRED (a)\n', 'NOT_REQUIRED', null],
];

test('the UAT verdict is exactly one hand-written line; anything else is absent or invalid, never assumed', () => {
  for (const [name, body, state, problem] of UAT_ROWS) {
    const verdict = eligible.uatVerdict(body);
    assert.equal(verdict.state, state, name);
    assert.equal(verdict.ready, state === 'NOT_REQUIRED' || state === 'PASSED', name);
    if (problem) assert.match(verdict.problem, problem, name); else assert.equal(verdict.problem, null, name);
  }
  assert.equal(eligible.uatVerdict('UAT: OWNER_TEST_NEEDED (try the export)').detail, 'try the export');
  assert.equal(eligible.uatVerdict(`UAT: NOT_REQUIRED (${'x'.repeat(501)})`).state, 'invalid', 'an over-long reason');
});

test('the UAT reader refuses the shared hostile-input set, with every exception named', () => {
  const ready = text => eligible.uatVerdict(text).ready;
  // A body that must wait (an owner test and a second line), rewritten with every line-break
  // shape, a byte order mark and tab indents: none may read as ready.
  hostile.expectDefaultDeny(assert, ready, hostile.variants('Intro\nUAT: OWNER_TEST_NEEDED (b)\n\nUAT: NOT_REQUIRED (a)\n'));
  hostile.expectDefaultDeny(assert, ready, hostile.variants('Intro\n  UAT: OWNER_TEST_NEEDED (b)\n\nUAT: NOT_REQUIRED (a)\n'));
  // A good body under the same rewrites. The exceptions are the shapes GitHub itself reads as the
  // same body: CRLF and lone CR line ends, one leading byte order mark, and no indent to change.
  hostile.expectDefaultDeny(assert, ready, hostile.variants('Intro\nUAT: NOT_REQUIRED (a)\nMore\n'), { allow: ['crlf', 'cr', 'bom', 'tabs'] });
  // The same with the line first: a leading byte order mark is still the only one dropped.
  hostile.expectDefaultDeny(assert, ready, hostile.variants('UAT: NOT_REQUIRED (a)\nMore\n'), { allow: ['crlf', 'cr', 'bom', 'tabs'] });
  // Every shape in the set as the text between an owner-test line and a second line, glued on
  // and on lines of its own: whatever it is, it never hides the first line. No exceptions.
  assert.ok(hostile.shapes.length > 100);
  hostile.expectDefaultDeny(assert, ready, hostile.shapes.map(shape => ({ id: `glued:${shape.id}`, text: `UAT: OWNER_TEST_NEEDED (b)${shape.text}UAT: NOT_REQUIRED (a)` })));
  hostile.expectDefaultDeny(assert, ready, hostile.shapes.map(shape => ({ id: `between:${shape.id}`, text: `UAT: OWNER_TEST_NEEDED (b)\n${shape.text}\nUAT: NOT_REQUIRED (a)` })));
  // And straight before a good line: only the named shapes leave it readable.
  const prefixed = hostile.shapes.map(shape => ({ id: `prefix:${shape.id}`, text: `${shape.text}UAT: NOT_REQUIRED (a)` }));
  for (const id of PREFIX_LEAVES_THE_LINE) {
    const { text } = hostile.shapes.find(shape => shape.id === id);
    assert.ok(/\n$/.test(text) || text === cp(0xfeff), `${id} ends its own line or is one byte order mark`);
  }
  hostile.expectDefaultDeny(assert, ready, prefixed, { allow: PREFIX_LEAVES_THE_LINE.map(id => `prefix:${id}`) });
  // Large inputs stay linear.
  const builders = {
    'many comment starts': size => `${'<!-- a --> '.repeat(Math.ceil(size / 11))}\nUAT: NOT_REQUIRED (a)`,
    'many dressed lines': size => '- UAT: x\n'.repeat(Math.ceil(size / 9)),
    'a long run of spaces': size => `${' '.repeat(size)}UAT: NOT_REQUIRED (a)`,
    'a long run of bullets': size => `${'- '.repeat(Math.ceil(size / 2))}x`,
    'a long marker-like line': size => `<!-- AI-AGENT-TOOLKIT:${':'.repeat(size)}`,
    'many other breaks': size => cp(0x2028).repeat(size),
    'a long reason': size => `UAT: NOT_REQUIRED (${'('.repeat(size)}`,
    ...Object.fromEntries(hostile.cases(['large-input']).map(shape => [shape.id, shape.build])),
  };
  for (const [name, build] of Object.entries(builders)) {
    const timed = hostile.timing(text => eligible.uatVerdict(text), build, { startSize: 4096, maxSize: 262144, minMs: 5 });
    assert.ok(timed.ok, `${name}: ${timed.message}`);
  }
});

test('the CLI with a pull request body: every waiting reason is named together, and only a ready verdict on an eligible scope exits 0', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-eligible-uat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    assert.equal(run(['add', '-A']).status, 0);
    assert.equal(run(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', file]).status, 0);
    return run(['rev-parse', 'HEAD']).stdout.trim();
  };
  // A consumer repository: no Toolkit layout, only the general list applies.
  assert.equal(run(['init', '-q', '-b', 'main']).status, 0);
  const base = commit('README.md', 'a\n');
  const docs = commit('docs/a.md', 'a\n');
  const workflow = commit('.github/workflows/ci.yml', 'name: ci\n');
  const out = [];
  const io = { cwd: root, stdout: { write: text => out.push(text) }, stderr: { write: text => out.push(text) } };
  const bodies = path.join(root, '.bodies');
  fs.mkdirSync(bodies);
  let count = 0;
  const check = (scope, body, extra = []) => {
    const file = path.join(bodies, `body-${count += 1}.md`);
    fs.writeFileSync(file, body);
    out.length = 0;
    const [from, to] = scope === 'eligible' ? [base, docs] : [docs, workflow];
    return eligible.main(['--base', from, '--head', to, '--body-file', file, ...extra], io);
  };
  const said = () => out.join('');
  // [scope, body, exit, expected text patterns, forbidden text patterns]
  const rows = [
    ['eligible', 'Body\n', 1, [/^Missing UAT verdict/m, /not a question for the owner/], [/typed merge/, /Auto-merge: yes/]],
    ['protected', 'Body\n', 1, [/^Missing UAT verdict/m, /^Waits for the owner's typed merge/m, /ci\.yml: a CI workflow/], [/Auto-merge: yes/]],
    ['eligible', 'UAT: NOT_REQUIRED (docs only)\n', 0, [/^Auto-merge: yes/, /NOT_REQUIRED \(docs only\)/], [/Missing/, /typed merge/]],
    ['protected', 'UAT: NOT_REQUIRED (docs only)\n', 1, [/^Waits for the owner's typed merge/m], [/Missing/, /UAT verdict invalid/, /Owner test needed/, /Auto-merge: yes/]],
    ['eligible', 'UAT: NOT_REQUIRED\n', 1, [/^UAT verdict invalid/m, /reason/], [/Auto-merge: yes/, /typed merge/]],
    ['eligible', 'UAT: OWNER_TEST_NEEDED (open the report)\n', 1, [/^Owner test needed: open the report/m], [/Auto-merge: yes/, /typed merge/]],
    ['protected', 'UAT: OWNER_TEST_NEEDED (open the report)\n', 1, [/^Owner test needed: open the report/m, /^Waits for the owner's typed merge/m], [/Auto-merge: yes/]],
    ['eligible', 'UAT: PASSED (owner OK, https://example.com/t/1)\n', 0, [/^Auto-merge: yes/, /PASSED/], []],
    ['eligible', 'UAT: PASSED\n', 1, [/^UAT verdict invalid/m], [/Auto-merge: yes/]],
    ['eligible', 'UAT: NOT_REQUIRED (a)\nUAT: PASSED (b)\n', 1, [/^UAT verdict invalid/m, /more than one/], [/Auto-merge: yes/]],
    ['eligible', 'UAT: SKIP (a)\n', 1, [/^UAT verdict invalid/m], [/Auto-merge: yes/]],
    ['eligible', '```\nUAT: NOT_REQUIRED (a)\n```\n', 1, [/^Missing UAT verdict/m], [/Auto-merge: yes/]],
    ['eligible', '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.60.0 sha256=9557d29730c2 -->\n- UAT: NOT_REQUIRED; review: PASS\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n', 1, [/^Missing UAT verdict/m], [/Auto-merge: yes/]],
    ['eligible', 'uat: NOT_REQUIRED (a)\n', 1, [/^UAT verdict invalid/m], [/Auto-merge: yes/]],
    ['eligible', 'Intro\r\nUAT: NOT_REQUIRED (a)  \r\n', 0, [/^Auto-merge: yes/], []],
  ];
  for (const [scope, body, exit, wanted, unwanted] of rows) {
    const name = `${scope}: ${JSON.stringify(body)}`;
    assert.equal(check(scope, body), exit, name);
    for (const pattern of wanted) assert.match(said(), pattern, name);
    for (const pattern of unwanted) assert.doesNotMatch(said(), pattern, name);
  }
  // --json carries both halves.
  assert.equal(check('protected', 'Body\n', ['--json']), 1);
  const report = JSON.parse(said());
  assert.equal(report.ready, false);
  assert.equal(report.eligible, false);
  assert.equal(report.uat.state, 'absent');
  assert.deepEqual(report.reasons, [{ path: '.github/workflows/ci.yml', why: 'a CI workflow' }]);
  assert.equal(check('eligible', 'UAT: NOT_REQUIRED (a)\n', ['--json']), 0);
  assert.deepEqual(JSON.parse(said()), { eligible: true, reasons: [], uat: { state: 'NOT_REQUIRED', detail: 'a', problem: null, ready: true }, ready: true });
  // The body from standard input.
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file', '-'], { ...io, stdin: 'UAT: NOT_REQUIRED (a)\n' }), 0);
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file', '-'], { ...io, stdin: '' }), 1, 'an empty body has no verdict');
  // Unreadable inputs make no readiness claim.
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file', path.join(bodies, 'missing.md')], io), 2);
  assert.match(said(), /could not be read/);
  fs.writeFileSync(path.join(bodies, 'big.md'), `UAT: NOT_REQUIRED (a)\n${'x'.repeat(512 * 1024)}`);
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file', path.join(bodies, 'big.md')], io), 2, 'an over-long body');
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file'], io), 2, 'a flag with no value');
  // An empty body says so.
  assert.equal(check('eligible', ''), 1);
  assert.match(said(), /^Missing UAT verdict: the pull request body is empty/);
  // Bodies as Windows saves them, byte for byte. Windows PowerShell 5.1 writes `> file` and
  // Out-File as UTF-16 little-endian with a byte order mark and CRLF; Set-Content -Encoding UTF8
  // and Notepad write UTF-8 with a byte order mark. A saved body is read or refused (exit 2),
  // and is never reported as a missing line or read past its first line.
  const utf16 = (text, big = false) => {
    const bytes = Buffer.from(text, 'utf16le');
    if (big) bytes.swap16();
    return Buffer.concat([Buffer.from(big ? [0xfe, 0xff] : [0xff, 0xfe]), bytes]);
  };
  const utf8Bom = text => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  const good = 'UAT: NOT_REQUIRED (docs only)\r\n';
  const two = 'UAT: OWNER_TEST_NEEDED (open the report)\r\n\r\nUAT: NOT_REQUIRED (docs only)\r\n';
  const byteRows = [
    // [name, bytes, exit, expected text patterns]
    ['UTF-16 with a mark, as PowerShell 5.1 redirection saves it', utf16(good), 0, [/^Auto-merge: yes/, /NOT_REQUIRED \(docs only\)/]],
    ['UTF-16 with a mark, text before the line', utf16(`Intro\r\n\r\n${good}`), 0, [/^Auto-merge: yes/]],
    ['UTF-16 with a mark, an owner test', utf16('UAT: OWNER_TEST_NEEDED (open the report)\r\n'), 1, [/^Owner test needed: open the report/m]],
    ['UTF-16 with a mark, an owner test then a second line', utf16(two), 1, [/^UAT verdict invalid/m, /more than one/]],
    ['UTF-16 with a mark, no line', utf16('Body\r\n'), 1, [/^Missing UAT verdict/m]],
    ['UTF-16 big-endian with a mark', utf16(good, true), 0, [/^Auto-merge: yes/]],
    ['UTF-8 with a mark, the line first', utf8Bom(good), 0, [/^Auto-merge: yes/]],
    ['UTF-8 with a mark, an owner test first then a second line', utf8Bom(two), 1, [/^UAT verdict invalid/m, /more than one/]],
    ['UTF-8 with a mark, an owner test first', utf8Bom('UAT: OWNER_TEST_NEEDED (open the report)\r\nMore\r\n'), 1, [/^Owner test needed: open the report/m]],
    ['UTF-8 with two marks', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8Bom(good)]), 1, [/^UAT verdict invalid/m, /invisible/]],
    ['UTF-16 with no mark', Buffer.from(good, 'utf16le'), 2, [/could not be read as text/, /UTF-8/]],
    ['UTF-16 with a mark and an odd byte count', Buffer.concat([utf16(good), Buffer.from([0x0a])]), 2, [/could not be read as text/]],
    ['UTF-16 with half a character pair', Buffer.concat([utf16(good), Buffer.from([0x00, 0xd8])]), 2, [/could not be read as text/]],
    ['UTF-16 holding a NUL', utf16(`${good}${cp(0)}`), 2, [/could not be read as text/]],
    ['UTF-32 with a mark', Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), ...[...good].map(char => Buffer.from([char.charCodeAt(0), 0, 0, 0]))]), 2, [/could not be read as text/]],
    ['UTF-32 big-endian with a mark', Buffer.concat([Buffer.from([0x00, 0x00, 0xfe, 0xff]), ...[...good].map(char => Buffer.from([0, 0, 0, char.charCodeAt(0)]))]), 2, [/could not be read as text/]],
    ['bytes that are not UTF-8', Buffer.concat([Buffer.from(good), Buffer.from([0xc3, 0x28])]), 2, [/could not be read as text/]],
    ['Windows-1252 bytes', Buffer.concat([Buffer.from('Caf'), Buffer.from([0xe9, 0x0d, 0x0a]), Buffer.from(good)]), 2, [/could not be read as text/]],
    ['UTF-8 holding a NUL', Buffer.concat([Buffer.from(good), Buffer.from([0x00])]), 2, [/could not be read as text/]],
    ['an empty file', Buffer.alloc(0), 1, [/^Missing UAT verdict: the pull request body is empty/]],
    ['only a UTF-16 mark', Buffer.from([0xff, 0xfe]), 1, [/^Missing UAT verdict: the pull request body is empty/]],
  ];
  for (const [name, bytes, exit, wanted] of byteRows) {
    assert.equal(check('eligible', bytes), exit, name);
    for (const pattern of wanted) assert.match(said(), pattern, name);
    if (exit !== 0) assert.doesNotMatch(said(), /Auto-merge: yes/, name);
    if (exit === 2) assert.doesNotMatch(said(), /Missing UAT verdict/, name);
    // The same bytes through standard input.
    out.length = 0;
    assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file', '-'], { ...io, stdin: bytes }), exit, `${name} (standard input)`);
  }
  // The shared set's byte-level cases, before a good line: never a yes.
  const byteCases = hostile.shapes.filter(shape => shape.bytes);
  assert.ok(byteCases.length >= 3);
  for (const shape of byteCases) {
    assert.notEqual(check('eligible', Buffer.concat([shape.bytes, Buffer.from(good)])), 0, shape.id);
    assert.doesNotMatch(said(), /Auto-merge: yes/, shape.id);
  }
  // A real pipe into the script, as the Windows instructions say to run it.
  const script = path.join(__dirname, '..', 'scripts', 'toolkit-auto-merge-eligible.cjs');
  const piped = input => spawnSync(process.execPath, [script, '--base', base, '--head', docs, '--body-file', '-'], { cwd: root, input, encoding: 'utf8' });
  assert.equal(piped(Buffer.from(good)).status, 0);
  assert.match(piped(utf16(good)).stdout, /^Auto-merge: yes/);
  assert.equal(piped(utf16(two)).status, 1);
  assert.equal(piped(Buffer.from(good, 'utf16le')).status, 2);
  assert.equal(piped(Buffer.alloc(0)).status, 1);
  // --json: "ready" is the answer; the usage text says so.
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs], io), 2, 'no mode named');
  assert.match(said(), /"ready" is the answer/);
  out.length = 0;
  assert.equal(eligible.main(['--base', base, '--head', docs, '--body-file', path.join(bodies, 'body-1.md'), '--scope-only'], io), 2, 'both modes at once');
  out.length = 0;
  assert.equal(eligible.main(['--base', 'nope', '--head', docs, '--body-file', path.join(bodies, 'body-3.md')], io), 2, 'unreadable commits');
});
