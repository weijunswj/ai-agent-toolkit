'use strict';

// One page-copy format: every saved copy of a programme page is the page's exact text, as Markdown,
// at page-copies/issue-<n>/<sha256>.md in the private store. Both callers (marked notes leaving a
// page, and a task page re-laid into the fixed order) check the store is private and refuse
// secret-shaped text first. Copies an older Toolkit saved as JSON stay readable.

const assert = require('node:assert/strict');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const STORE = { kind: 'github', repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' };

function fixture({ storePrivate = true } = {}) {
  const github = new FakeGitHub({ repository: 'acme/app', store: STORE.repository, storePrivate });
  const store = new state.StateStore({ transport: github, store: STORE, now: () => '2026-11-15T00:00:00.000Z', toolkitVersion: '3.119.0' });
  return { github, store };
}

test('both callers save the same Markdown copy at one path, and saving it twice writes once', () => {
  const { github, store } = fixture();
  const page = '# Task\r\n\r\nBody with notes.\n';
  const saved = store.savePageCopy(806, page);
  const digest = state.sha256(page);
  assert.deepEqual(saved, { digest, path: `${STORE.path}page-copies/issue-806/${digest}.md`, outcome: 'WRITTEN' });
  assert.equal(github.files.get(saved.path).text, page, 'the page byte for byte, not wrapped in JSON');
  assert.equal(store.savePageCopy(806, page).outcome, 'EXISTS');
  assert.equal(typeof store.saveNoteCopy, 'undefined', 'one save path; no second format');
  assert.equal(typeof store.pageCopyPath, 'function');
  assert.equal(store.pageCopyPath(806, digest), saved.path);
});

test('the private-store check and the secret screen run before any copy, for every caller', () => {
  const open = fixture({ storePrivate: false });
  assert.throws(() => open.store.savePageCopy(806, '# Task\n'), { code: 'STORE_NOT_PRIVATE' });
  assert.equal(open.github.calls.filter(call => call.method === 'PUT').length, 0);
  const { github, store } = fixture();
  assert.throws(() => store.savePageCopy(806, `token ghp_${'a'.repeat(30)}`), { code: 'PAGE_COPY_REFUSED' });
  assert.equal(github.calls.filter(call => call.method === 'PUT').length, 0);
});

test('old JSON and Markdown copies both still read; a missing copy reads as null', () => {
  const { github, store } = fixture();
  const old = '# Old task page\n\nKept.\n';
  const oldDigest = state.sha256(old);
  // A copy an older Toolkit saved for a re-laid task page.
  github.putFile(`${STORE.path}page-copies/issue-806-${oldDigest.slice(0, 16)}.json`, { schema: 'toolkit.programme-page-copy.v1', issue: 806, sha256: oldDigest, updated_at: null, saved_at: '2026-11-01T00:00:00.000Z', body: old });
  assert.equal(store.readPageCopy(806, oldDigest), old);
  const note = '# Programme\n\n## Archive\nOld notes.\n';
  const noteDigest = store.savePageCopy(421, note).digest;
  assert.equal(store.readPageCopy(421, noteDigest), note);
  assert.equal(store.readPageCopy(421, 'f'.repeat(64)), null);
  // A legacy file whose text does not match the digest it is named by is not a copy.
  github.putFile(`${STORE.path}page-copies/issue-807-${'e'.repeat(16)}.json`, { schema: 'toolkit.programme-page-copy.v1', issue: 807, sha256: oldDigest, updated_at: null, saved_at: 'x', body: old });
  assert.equal(store.readPageCopy(807, 'e'.repeat(64)), null);
});

test('the public state branch sends page copies to the private store only, after its private check', () => {
  const source = require('node:fs').readFileSync(require.resolve('../../skills/github-program-reconciler/scripts/programme-state.cjs'), 'utf8');
  const branch = source.slice(source.indexOf('class BranchStateStore'), source.indexOf('function openStore('));
  assert.match(branch, /savePageCopy\(issue, text\) \{ this\.requirePrivateStore\(\); return this\.private\.savePageCopy\(issue, text\); \}/);
  assert.match(branch, /readPageCopy\(issue, digest\) \{ return this\.private\.readPageCopy\(issue, digest\); \}/);
});

test('ARCHIVE_COMMENT_UNTRUSTED names a saved copy only when that copy exists', () => {
  const { pageFixture } = require('./support/programme-page-fixture.cjs');
  const HAND = '# Programme\n\nOwner text that stays.\n\n## Archive\n### Old plan\nKeep every byte.\n\n## Current plan\nNever marked.\n';
  const untrusted = f => (f.parent().attention || []).filter(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED');
  for (const kept of [true, false]) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const entry = (f.parent().page_archive || []).find(part => part.kind === 'note');
    // The copy was lost from the store (deleted by hand, or the store restored from an older point).
    if (!kept) f.github.files.delete(`state/page-copies/issue-12/${entry.copy}.md`);
    f.github.comments.delete(entry.comment_id);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const [finding] = untrusted(f);
    const text = state.findingText(finding);
    if (kept) {
      assert.deepEqual(finding.diagnostics, { reason: 'missing', copy: entry.copy });
      assert.ok(text.includes(`page-copies/issue-12/${entry.copy}.md`), text);
    } else {
      assert.deepEqual(finding.diagnostics, { reason: 'missing' }, 'no pointer at a copy that is not there');
      assert.equal(text.includes(entry.copy), false, text);
    }
  }
});
