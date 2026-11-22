'use strict';

// repo/CONTROLLER.md is a small core plus the pages under repo/controller/. These tests keep the
// set whole: every page is listed, a page change changes the core (so one bound blob still covers
// every rule), no rule has two homes and every link resolves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const pages = require('../scripts/sync-controller-pages.cjs');
const { controllerFiles, controllerText } = require('./support/controller-text.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'sync-controller-pages.cjs');
const PAGE_FILES = ['evidence-and-finish.md', 'gates.md', 'principles.md', 'roles-and-routes.md'];

// A throwaway copy of the core, its pages and the files they link to.
function copyOfControllerSet(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-pages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copy = rel => {
    const target = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...rel.split('/')), target);
  };
  for (const rel of controllerFiles()) {
    copy(rel);
    const text = fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
    for (const [, link] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      copy(path.posix.join(path.posix.dirname(rel), link));
    }
  }
  return root;
}
// Edits see LF text whatever the checkout's line endings are, so the same edit works on Windows.
const edit = (root, rel, change) => {
  const file = path.join(root, ...rel.split('/'));
  fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')));
};
const run = (root, ...flags) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...flags], { encoding: 'utf8' });

test('the core lists exactly the pages that exist, and their hashes are current', () => {
  assert.deepEqual(pages.check(ROOT), []);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'repo', 'controller')).sort(), PAGE_FILES);
  assert.deepEqual(controllerFiles(), ['repo/CONTROLLER.md', 'repo/controller/principles.md', 'repo/controller/roles-and-routes.md',
    'repo/controller/gates.md', 'repo/controller/evidence-and-finish.md']);
});

test('the core tells a controller that the pages bind and when to read each one', () => {
  const core = fs.readFileSync(path.join(ROOT, 'repo', 'CONTROLLER.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(core.includes('These pages are part of this file: their rules bind like the rules above and were moved here word for word.'));
  assert.ok(core.includes('Read every page on adoption, and the matching page again before its step.'));
  assert.ok(core.includes("so a page change changes this file's blob."));
  for (const file of PAGE_FILES) {
    const text = fs.readFileSync(path.join(ROOT, 'repo', 'controller', file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text.split('\n')[1], pages.BACK_POINTER, file);
  }
});

test('a page edit without the sync fails the check and names the page; --write repairs only the hash', t => {
  const root = copyOfControllerSet(t);
  assert.equal(run(root).status, 0);
  const coreBefore = fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8');
  edit(root, 'repo/controller/gates.md', text => text.replace('Gate states: ACTIVE', 'Gate states: BUSY'));
  const stale = run(root);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /repo\/controller\/gates\.md changed/);
  assert.doesNotMatch(stale.stderr, /roles-and-routes\.md changed|evidence-and-finish\.md changed/);
  assert.equal(fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8'), coreBefore, 'the check writes nothing');

  const written = run(root, '--write');
  assert.equal(written.status, 0, written.stderr);
  const coreAfter = fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8');
  assert.notEqual(coreAfter, coreBefore, 'a page change changes the core, so the bound blob moves');
  const differing = coreBefore.split('\n').filter((line, index) => line !== coreAfter.split('\n')[index]);
  assert.equal(differing.length, 1);
  assert.match(differing[0], /^- \[Gates\]\(controller\/gates\.md\)/);
  assert.equal(run(root).status, 0);
});

test('a line-ending change alone does not move a page hash, and --write keeps a Windows checkout on CRLF', t => {
  assert.equal(pages.pageHash('a\r\nb\r\n'), pages.pageHash('a\nb\n'));
  assert.notEqual(pages.pageHash('a\nb\n'), pages.pageHash('a\nc\n'));
  const root = copyOfControllerSet(t);
  for (const rel of controllerFiles()) edit(root, rel, text => text.replace(/\r?\n/g, '\r\n'));
  assert.equal(run(root).status, 0, 'a CRLF checkout of the same text is in step');
  edit(root, 'repo/controller/gates.md', text => text.replace('Gate states: ACTIVE', 'Gate states: BUSY'));
  assert.equal(run(root, '--write').status, 0);
  const core = fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8');
  assert.equal(core.split('\r\n').length, core.split('\n').length, 'every line still ends in CRLF');
});

test('an unlisted page, a missing page and a malformed entry each fail', t => {
  const extra = copyOfControllerSet(t);
  fs.writeFileSync(path.join(extra, 'repo', 'controller', 'side-rules.md'), `# Side rules\n${pages.BACK_POINTER}\n- A rule nobody listed.\n`);
  assert.match(pages.check(extra).join('\n'), /repo\/controller\/side-rules\.md is not listed under "## Pages"/);

  const missing = copyOfControllerSet(t);
  fs.rmSync(path.join(missing, 'repo', 'controller', 'gates.md'));
  assert.match(pages.check(missing).join('\n'), /lists repo\/controller\/gates\.md, which does not exist/);
  assert.equal(run(missing, '--write').status, 1, '--write never hides a missing page');

  const malformed = copyOfControllerSet(t);
  edit(malformed, 'repo/CONTROLLER.md', text => text.replace(/(\(controller\/gates\.md\)) `[0-9a-f]{12}`/, '$1'));
  assert.match(pages.check(malformed).join('\n'), /a Pages entry must read/);

  const unlisted = copyOfControllerSet(t);
  edit(unlisted, 'repo/CONTROLLER.md', text => text.split('\n').filter(line => !line.includes('(controller/gates.md)')).join('\n'));
  assert.match(pages.check(unlisted).join('\n'), /repo\/controller\/gates\.md is not listed/);

  const noSection = copyOfControllerSet(t);
  edit(noSection, 'repo/CONTROLLER.md', text => text.replace('## Pages\n', ''));
  assert.match(pages.check(noSection).join('\n'), /needs exactly one "## Pages" section/);
});

test('a rule copied into a second controller file fails: each rule has one home', t => {
  const root = copyOfControllerSet(t);
  const rule = fs.readFileSync(path.join(root, 'repo', 'controller', 'gates.md'), 'utf8').split('\n').find(line => line.startsWith('- **Scope confirmation:**'));
  assert.ok(rule);
  edit(root, 'repo/controller/roles-and-routes.md', text => `${text}${rule}\n`);
  assert.equal(run(root, '--write').status, 1);
  assert.match(pages.check(root).join('\n'), /repo\/controller\/gates\.md line \d+ repeats repo\/controller\/roles-and-routes\.md line \d+: each rule has one home/);

  const inCore = copyOfControllerSet(t);
  edit(inCore, 'repo/CONTROLLER.md', text => text.replace('## Pages\n', `${rule}\n## Pages\n`));
  assert.match(pages.check(inCore).join('\n'), /each rule has one home/);
});

test('a page without its title or its pointer back to the core fails', t => {
  const root = copyOfControllerSet(t);
  edit(root, 'repo/controller/gates.md', text => text.replace(`${pages.BACK_POINTER}\n`, ''));
  assert.match(pages.check(root).join('\n'), /repo\/controller\/gates\.md must start with a "# " title, then the line/);
});

test('every relative link in the core and the pages resolves, and a broken one fails', t => {
  for (const rel of controllerFiles()) {
    const text = fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
    for (const [, link] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, path.posix.join(path.posix.dirname(rel), link))), `${rel} -> ${link}`);
    }
  }
  const root = copyOfControllerSet(t);
  edit(root, 'repo/controller/roles-and-routes.md', text => text.replace('](../docs/HOST-CONTRACT.md)', '](docs/HOST-CONTRACT.md)'));
  run(root, '--write');
  assert.match(pages.check(root).join('\n'), /repo\/controller\/roles-and-routes\.md links to docs\/HOST-CONTRACT\.md, which does not exist/);
});

test('the whole rule set is the core plus every page, each section in exactly one file', () => {
  const homes = {
    'repo/CONTROLLER.md': ['## Scope, fence and revisions', '## Takeover', '## Instructions and returns', '## Authority and effects', '## Pages'],
    'repo/controller/principles.md': ['## Design principles'],
    'repo/controller/roles-and-routes.md': ['## Roles and routes'],
    'repo/controller/gates.md': ['## Gate lifecycle and acceptance', '### Human-readable product and operational text'],
    'repo/controller/evidence-and-finish.md': ['## Evidence, progress and finish'],
  };
  for (const [rel, headings] of Object.entries(homes)) {
    const text = fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
    assert.deepEqual(text.split('\n').filter(line => /^##+ /.test(line)), headings, rel);
  }
  const all = controllerText();
  for (const heading of Object.values(homes).flat()) assert.equal(all.split('\n').filter(line => line === heading).length, 1, heading);
});

test('the design principles page binds above every skill, project line and brief', () => {
  const core = fs.readFileSync(path.join(ROOT, 'repo', 'CONTROLLER.md'), 'utf8').replace(/\r\n/g, '\n');
  const page = fs.readFileSync(path.join(ROOT, 'repo', 'controller', 'principles.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(core, /The \[design principles\]\(controller\/principles\.md\) bind above every skill, project line and brief: they add, never relax\./);
  assert.match(core.split('\n## Pages\n')[1], /^These pages[^\n]*\n- \[Design principles\]\(controller\/principles\.md\) `[0-9a-f]{12}`: /);
  assert.match(page, /^- \*\*Binding:\*\* [^\n]*never relax them;[^\n]*A clash goes to the owner as a decision; a new principle needs an owner record/m);
  for (const label of ['Development base', 'Owner-only acts', 'Git hygiene', 'Work runs where the controller runs']) assert.match(page, new RegExp(`^- \\*\\*${label}:\\*\\* `, 'm'), label);
});

test('controllers close every thread or session they spawned once it is fully done, through the host contract', () => {
  const page = fs.readFileSync(path.join(ROOT, 'repo', 'controller', 'principles.md'), 'utf8').replace(/\r\n/g, '\n');
  const line = page.split('\n').find(text => text.startsWith('- **Close what you spawn:** ')) || '';
  for (const phrase of [
    'on relay, close each thread or session you started (gate, gatekeeper, lane) once it is fully done',
    'its output is recorded', 'its PRs are merged or closed', 'its final message was read in full and every item acted on',
    'its result was relayed and no owner test, card, question or decision is still owed',
    "Use your host's close action ([host contract](../docs/HOST-CONTRACT.md)); with none, record it retired (gates page)",
    'Appointment authorises it (roles page)', "Never a scheduled task's home thread; idleness alone never counts",
    'With no timers, re-check open ones at session start and each owner turn',
  ]) assert.ok(line.includes(phrase), phrase);
  // The principles bind every harness, so they name none; each host's mechanics live in the host contract.
  assert.doesNotMatch(page, /projects|claude|codex|remote control|opencode|antigravity/i);
  const contract = fs.readFileSync(path.join(ROOT, 'repo', 'docs', 'HOST-CONTRACT.md'), 'utf8').replace(/\r\n/g, '\n');
  const section = contract.split('\n## 10. Closing finished sessions\n')[1] || '';
  for (const route of ['- **Claude Projects:** resolve the work thread', '- **Claude Code in the cloud:** archive the session (`archive_session`)',
    '- **Claude Code on a computer:** end the session', '- **Codex:** archive the thread', '- **Remote Control:** end the remote session',
    "never a scheduled task's home thread"]) assert.ok(section.includes(route), route);
});

test('work runs where the controller runs, and scheduled tasks prefer the cloud without a computer ban', () => {
  const page = fs.readFileSync(path.join(ROOT, 'repo', 'controller', 'principles.md'), 'utf8').replace(/\r\n/g, '\n');
  const line = page.split('\n').find(text => text.startsWith('- **Work runs where the controller runs:** ')) || '';
  for (const phrase of [
    'a cloud controller runs work in the cloud and a local one on its computer, unless a step needs the other side',
    'Scheduled tasks prefer the cloud; new scheduled work joins an existing task first and stays a short prod',
  ]) assert.ok(line.includes(phrase), phrase);
  assert.doesNotMatch(page, /no computer scheduled tasks|\*\*Cloud first:\*\*/);
});

test('lean children: one capped polish child, a stale check and automate-first in the global principles', () => {
  const page = fs.readFileSync(path.join(ROOT, 'repo', 'controller', 'principles.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(page, /^- \*\*Polish child:\*\* review Lows and small UAT nits are rows on one rolling Later polish child \(title starts `Polish`[^\n]*at most 8 rows; when full it ships as one batched PR and closes, and a fresh one opens\.$/m);
  // The stale check runs from the governance session-start hook in the background; the controller closes what is finished and asks the owner only for a close that needs their OK.
  assert.match(page, /^- \*\*Stale check:\*\* the governance session-start hook runs the stale check at most once a day per repository, in the background, as rows the controller answers\. The controller closes finished children itself and asks the owner only for a close that needs their OK \(a duplicate, an obsolete child or an owner-OK close\), in its next ask\.$/m);
  assert.doesNotMatch(page, /Daily stale sweep/);
  const global = fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'agent-rules', 'global-rules.md'), 'utf8').replace(/\r\n/g, '\n');
  // Clear-cut rules go into code first; judgement stays with controllers (owner, 20 November).
  assert.match(global, /^- \*\*Automate first:\*\* enforce clear-cut rules in code \(hooks, scripts, CI\), else in writing, memory last; controllers still decide judgement calls; checks prove results, not self-grading\.$/m);
  assert.doesNotMatch(global, /\*\*Checks over judgement:\*\*/);
  assert.match(global, /^- \*\*Written, not remembered:\*\* progress and decisions live in the branch, PR and records\.$/m);
});

test('the owner-post rule has one home: the principles page, read before every owner post', () => {
  const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
  const page = read('repo/controller/principles.md');
  const line = page.split('\n').find(text => text.startsWith('- **Plain owner posts:** ')) || '';
  for (const phrase of [
    'owner posts carry what the owner needs, not the working detail',
    'Beyond answering the owner, tell them their steps (tap, approve, test, typed OK, decide), real problems and outcomes worth knowing (landed, merged, failed, blocked, a decision or scope change)',
    'one point per task, or one line for a single task, each led by a bold task label, never a line saying nothing needs them',
    'Leave out the working detail of gates, helpers and other spawned work (probes, test counts, round-by-round findings, file lists) unless asked: it stays in their full reports and the evidence store',
    "This binds the controller's own posts to the owner, relays included",
    "Asked with the native question method, a card holds only the short question and short options, the pick marked; the context, items and each pick's reason go above it as formatted text",
    // A one-line status cannot lead with three lines, so only asks, plans and explanations do.
    'Asks, plans and explanations lead with problem, fix and skip',
  ]) assert.ok(line.includes(phrase), phrase);
  // Every controller type binds the core, which re-reads the page before it posts to the owner.
  assert.ok(read('repo/CONTROLLER.md').includes('before every plan, review, merge decision or owner post'));

  const projectsDir = path.join(ROOT, 'repo', 'contracts', 'claude-projects');
  const projects = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) projects.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(projectsDir);
  assert.ok(projects.length > 5, 'the Projects files are found');
  // No other controller file or Projects file restates when to message the owner.
  for (const rel of [...controllerFiles(), ...projects]) {
    assert.doesNotMatch(read(rel), /only when (?:the owner must act|it needs the owner)|unless the owner must act|one line when nothing needs the owner|\*\*Notify only when/i, rel);
  }
  // Information-only Projects notices fold into the next status instead of their own owner message.
  for (const rel of projects) {
    assert.doesNotMatch(read(rel), /tell the owner in one line what changed|tell the owner once which|and tell the owner; never|tell the owner once what waits|line, and tell the owner once\./i, rel);
  }
  // Ask cards carry only the question and options; the context sits above them.
  for (const rel of [...projects, 'repo/docs/agent-playbooks/safety-gates.md', 'skills/toolkit-playbooks/safety-gates.md']) {
    assert.doesNotMatch(read(rel), /a decision card and a reply|opening with its problem, fix and skip lines|posts one decision card: just this once[^.]*, with what is checked first|question card, with its problem, fix and skip|One plain-English card, one screen|three lines below|(?<!above )the card names|native change the card named|copy of the card and (?:the owner's )?answer/i, rel);
  }
});
