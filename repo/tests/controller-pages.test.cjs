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
  for (const label of ['Development base', 'Owner-only acts', 'Git hygiene', 'Cloud first']) assert.match(page, new RegExp(`^- \\*\\*${label}:\\*\\* `, 'm'), label);
});
