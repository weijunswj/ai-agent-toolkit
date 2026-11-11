'use strict';
// Marked notes: hand-written text under one `## Archive` line leaves the parent page for verified,
// never-edited comments, after a copy of the whole page is saved to the private store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const archive = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-page-archive.cjs'));
const tags = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-tags.cjs'));
const { pageFixture } = require('./support/programme-page-fixture.cjs');

const HEAD = '# Programme\n\nOwner text that stays.  \n\n';
const AREA = '## Archive\n### Old plan\nKeep every byte.  \n\n<details><summary>Folded</summary>\n\n## Inside the fold\nStill marked.\n</details>\n\n';
const TAIL = '## Current plan\nNever marked.\n';
const HAND = HEAD + AREA + TAIL;
const copies = f => f.github.calls.filter(call => call.method === 'PUT' && call.path.includes('/contents/state/page-copies/'));
const noteEntries = f => (f.parent().page_archive || []).filter(entry => entry.kind === 'note');
const context = f => state.findStateBlock(f.page(), 'CONTEXT').block.body;
const unsafe = f => (f.parent().attention || []).filter(entry => entry.code === 'ARCHIVE_SECTION_UNSAFE');
const untrusted = f => (f.parent().attention || []).filter(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED');
const hand = f => { const page = f.page(); return page.slice(0, page.indexOf('<!-- AI-AGENT-TOOLKIT')) + '|' + page.slice(page.lastIndexOf('END CONTEXT -->') + 'END CONTEXT -->'.length, page.indexOf('<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN TRACE')); };

// ---- The reader -------------------------------------------------------------------------------

const old = '## Archive\n### Hidden\nOld.\n';
const ACCEPTED = [
  ['next heading ends it', HEAD + old + '\n## Next\nStay.\n', old + '\n'],
  ['a level one heading ends it', old + '# Next\nStay.\n', old],
  ['an indented heading ends it', old + '   ## Next\nStay.\n', old],
  ['an empty heading ends it', old + '##\nStay.\n', old],
  ['end of page ends it, without a final newline', 'Text.\n\n' + old + 'Last line', old + 'Last line'],
  ['CRLF is kept as found', '## Archive\r\nA\r\n\r\n## Next\r\n', '## Archive\r\nA\r\n\r\n'],
  ['a marker straight after a paragraph is still a heading', 'Text.\n' + old, old],
  ['a marker after a closed comment line', '<!-- note -->\n' + old, old],
  ['a marker after a closed folded section and a blank line', '<details>\nOld.\n</details>\n\n' + old, old],
  ['deeper headings stay inside', old + '### More\n#### Deep\nText.\n\n## Next\n', old + '### More\n#### Deep\nText.\n\n'],
  ['a heading inside a code block stays inside', old + '```\n## Not a heading\n```\n\n## Next\n', old + '```\n## Not a heading\n```\n\n'],
  ['a heading inside a comment stays inside', old + '<!--\n## Not a heading\n-->\n\n## Next\n', old + '<!--\n## Not a heading\n-->\n\n'],
  ['a heading inside a folded section that starts in the area stays inside', old + '<details><summary>s</summary>\n\n## Inner\ntext\n</details>\n\n## Next\n', old + '<details><summary>s</summary>\n\n## Inner\ntext\n</details>\n\n'],
  ['a generated block ends it', old + state.renderBlock('x', '3.57.0', 'TRACE') + '\n', old],
  ['a rule after a blank line is not a heading', old + 'Text.\n\n---\n\n## Next\n', old + 'Text.\n\n---\n\n'],
  ['a table rule is not a heading', old + '| a |\n|---|\n| b |\n\n## Next\n', old + '| a |\n|---|\n| b |\n\n'],
];
const REFUSED = [
  ['two_markers', old + '## Archive\nMore\n'],
  ['two_markers', old + '```\n## Archive\n```\n'],
  ['marker_nested', '```md\n## Archive\n### Notes\nText\n```\n'],
  ['marker_nested', '~~~\n## Archive\n~~~\n'],
  ['marker_nested', '<details>\n## Archive\n</details>\n'],
  ['marker_nested', '<details>\n\n## Archive\ntext\n</details>\n'],
  ['marker_nested', '<!--\n## Archive\n-->\n'],
  ['marker_nested', 'Text <!-- open\n\n' + old],
  ['marker_nested', '<div>\n' + old],
  ['marker_nested', '<pre>\n' + old],
  ['marker_nested', '<table>\n' + old],
  ['marker_nested', '</span>\n' + old],
  ['marker_nested', '<details>\nOld.\n</details>\n' + old],
  ['marker_nested', '<![CDATA[\n\n' + old],
  ['marker_nested', '<script>\n\n' + old + '</script>\n'],
  ['marker_nested', '<style>\n\n' + old + '</style>\n'],
  ['marker_nested', '<textarea>\n\n' + old + '</textarea>\n'],
  // A code block inside a list item ends with the item, so the next top-level fence hides the marker.
  ['marker_nested', '- step\n  ```\n  code\nText.\n```\n\n## Archive\n### Hidden\nKeep.\n```\n- x\n  ```\n\nTail the owner never marked.\n\n## Risks\n'],
  ['marker_nested', '> ```\n> code\n\n```\n' + old + '```\n'],
  ['marker_nested', state.renderBlock('## Archive\n### Notes\nText', '3.57.0')],
  ['open_fence', old + '```\ncode\n'],
  // A backtick in the info string means the first line opens nothing, so the last fence never closes.
  ['open_fence', '```info`\n' + old.replace('Old.', 'Old.\n```')],
  ['open_fence', old + '~~~\ncode\n\n## Next\n'],
  ['open_comment', old + '<!-- open\ntext\n'],
  ['open_html', old + '<details>\n\n## Inner\n'],
  ['open_html', old + '</details>\n\n## Next\n'],
  ['open_html', old + '<pre>\ntext\n'],
  ['ambiguous_markup', old + 'Text <!-- open\n## Risks\nKeep.\n-->\n'],
  ['ambiguous_markup', old + '- x\n  ```\n\nTail\n\n## Risks\nx\n'],
  ['ambiguous_markup', old + '> ```\n> code\n\n## Risks\n'],
  ['underlined_heading', old + 'Current plan\n===\nKeep.\n'],
  ['underlined_heading', old + 'Current plan\n---\nKeep.\n'],
  ['control_character', '## Archive\nA\rB\n'],
  ['control_character', `## Archive\nA${String.fromCharCode(0)}B\n`],
  ['control_character', `## Archive\nA${String.fromCharCode(0x2028)}B\n`],
  ['control_character', `## Archive\nA${String.fromCharCode(0x2029)}B\n`],
  ['control_character', `## Archive\nA${String.fromCharCode(0xD800)}B\n`],
  ['link_definition_split', 'See [the plan][plan].\n\n' + old + '[plan]: https://example.com/plan\n'],
  ['link_definition_split', old + '[Plan]: https://example.com/plan\n\n## Next\nSee [plan].\n'],
];
const INERT = ['## archive\nText\n', '    ## Archive\nText\n', '## Archive\t\nText\n', '## Archive \nText\n', '### Archive\nText\n', '## Archive ##\nText\n',
  ` ## Archive\nText\n`, `## Arch${String.fromCodePoint(0x456)}ve\nText\n`, '## Archive notes\nText\n', 'Text ## Archive\n'];

test('the reader accepts only a plain top-level marker and stops at the first real boundary', () => {
  for (const [name, body, expected] of ACCEPTED) {
    const found = archive.noteArea(body);
    assert.equal(found.kind, 'area', `${name}: ${found.reason}`);
    assert.equal(body.slice(found.start, found.end), expected, name);
    assert.equal(found.parts.map(part => part.text).join(''), expected, name);
    for (const part of found.parts) assert.equal(archive.noteText(part.body), part.text, name);
  }
});

test('the reader refuses every doubtful shape with a fixed reason and moves nothing', () => {
  for (const [reason, body] of REFUSED) {
    const found = archive.noteArea(body);
    assert.deepEqual(found, { kind: 'unsafe', reason }, JSON.stringify(body));
    assert.ok(archive.NOTE_REASONS.includes(reason));
  }
  for (const body of INERT) assert.deepEqual(archive.noteArea(body), { kind: 'none' }, JSON.stringify(body));
  assert.deepEqual(archive.noteArea(''), { kind: 'none' });
});

test('every refusal reason has owner wording, and the finding text never repeats note text', () => {
  for (const reason of archive.NOTE_REASONS) {
    const text = state.findingText({ code: 'ARCHIVE_SECTION_UNSAFE', issue: 12, diagnostics: { reason } });
    assert.match(text, /^ARCHIVE_SECTION_UNSAFE #12: the notes under `## Archive` were not moved \(.{10,}\); fix that or remove the line$/);
    assert.doesNotMatch(text, new RegExp(reason));
  }
});

test('parts split at sub-headings, then blank lines, stay under the limit and join to the exact area', () => {
  const sections = Array.from({ length: 6 }, (_, i) => `### Section ${i}\n${'word '.repeat(150)}\n\n${'more '.repeat(150)}\n\n`).join('');
  const body = HEAD + '## Archive\n' + sections + TAIL;
  const found = archive.noteArea(body, { limit: 2600 });
  assert.equal(found.kind, 'area');
  assert.ok(found.parts.length >= 4);
  assert.equal(found.parts.map(part => part.text).join(''), '## Archive\n' + sections);
  for (const [index, part] of found.parts.entries()) {
    assert.ok(part.body.length < 2600);
    assert.equal(part.key, `note-${found.id}-${index + 1}`);
    assert.match(part.key, archive.NOTE_KEY);
    assert.equal(archive.noteText(part.body), part.text);
    if (index) assert.match(part.text, /^### Section /);
    assert.equal(tags.isArchiveComment(part.body), true);
  }
  // No sub-heading fits: blank lines are the next choice.
  const blanks = archive.noteArea(body, { limit: 1500 });
  assert.equal(blanks.kind, 'area');
  assert.equal(blanks.parts.map(part => part.text).join(''), '## Archive\n' + sections);
  // Nothing to split on.
  assert.deepEqual(archive.noteArea('## Archive\n' + 'x'.repeat(5000) + '\n', { limit: 2000 }), { kind: 'unsafe', reason: 'part_too_large' });
  // A split never lands inside a code block or a folded section.
  const block = '```\n' + 'code\n\n'.repeat(300) + '```\n\n', folded = '<details>\n\n' + 'fold\n\n'.repeat(300) + '</details>\n\n';
  for (const inner of [block, folded]) {
    assert.deepEqual(archive.noteArea('## Archive\n' + inner + 'text\n\n'.repeat(200), { limit: 1500 }), { kind: 'unsafe', reason: 'part_too_large' });
    const whole = archive.noteArea('## Archive\n' + inner + 'text\n\n'.repeat(200), { limit: 2500 });
    assert.equal(whole.kind, 'area');
    assert.ok(whole.parts.length > 1);
    assert.ok(whole.parts[0].text.startsWith('## Archive\n' + inner), 'the first part holds the whole block');
  }
});

test('the key is bound to the exact text, and link definitions that stay are copied under the part', () => {
  const body = HEAD + '## Archive\nSee [the plan][Plan] and [other].\n\n' + TAIL + '\n[plan]: https://example.com/plan\n[other]: https://example.com/other\n[unused]: https://example.com/unused\n';
  const found = archive.noteArea(body);
  assert.equal(found.kind, 'area');
  assert.match(found.parts[0].body, /<!-- programme-note-end -->\n\n<!-- programme-note-links -->\n\[plan\]: https:\/\/example\.com\/plan\n\[other\]: https:\/\/example\.com\/other$/);
  assert.doesNotMatch(found.parts[0].body, /unused/);
  assert.equal(archive.noteText(found.parts[0].body), '## Archive\nSee [the plan][Plan] and [other].\n\n');
  assert.equal(archive.noteArea(body).id, found.id);
  assert.notEqual(archive.noteArea(body.replace('the plan', 'the plans')).id, found.id);
  assert.notEqual(archive.noteArea(body.replace('example.com/plan', 'example.com/plan2')).id, found.id);
  // A changed comment no longer yields note text.
  assert.equal(archive.noteText(found.parts[0].body.replace('See [the plan]', 'See [a plan]')), null);
  assert.equal(archive.noteText('plain comment'), null);
});

// ---- The sweep --------------------------------------------------------------------------------

test('marked notes move byte for byte: saved copy first, verified comment, one cut, links, then quiet', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  const before = f.page();
  const result = f.make().run({ apply: true });
  assert.deepEqual(result.holds, []);
  // Saved copy first: the store write of the whole page precedes the first comment post.
  const order = f.github.calls.map((call, index) => ({ call, index }));
  const firstCopy = order.find(({ call }) => call.method === 'PUT' && call.path.includes('/page-copies/'));
  const firstPost = order.find(({ call }) => call.method === 'POST' && /issues\/12\/comments$/.test(call.path));
  const cut = order.find(({ call }) => call.method === 'PATCH' && /issues\/12$/.test(call.path));
  assert.ok(firstCopy && firstPost && cut && firstCopy.index < firstPost.index && firstPost.index < cut.index);
  assert.equal(Buffer.from(firstCopy.call.body.content, 'base64').toString('utf8'), before);
  assert.equal(firstCopy.call.path, `repos/example.test/store/contents/state/page-copies/issue-12/${state.sha256(before)}.md`);
  // One comment, exact text, under the signed-in login.
  assert.equal(f.posts().length, 1); assert.equal(f.edits().length, 0);
  const [entry] = noteEntries(f);
  const comment = f.github.comments.get(entry.comment_id);
  assert.equal(archive.noteText(comment.body), AREA);
  assert.equal(entry.state, 'moved'); assert.equal(entry.login, 'owner'); assert.equal(entry.group, null);
  assert.equal(entry.digest, archive.digest(comment.body));
  assert.match(entry.title, /^Notes archived 2026-11-09 \(part 1 of 1\)$/);
  // The copy named by the entry is the page the cut replaced, and it is in the store.
  assert.ok(f.github.files.has(`state/page-copies/issue-12/${entry.copy}.md`));
  assert.ok(f.github.files.get(`state/page-copies/issue-12/${entry.copy}.md`).text.includes(AREA));
  // The page: marked bytes gone, every unmarked byte and its order kept.
  assert.equal(f.page().includes('## Archive'), context(f).includes('## Archive'));
  assert.equal(f.page().includes('Keep every byte.'), false);
  assert.equal(hand(f), '# Programme\n\n|\n\nOwner text that stays.  \n\n' + TAIL + '\n');
  assert.match(context(f), new RegExp(`\\n\\n- \\[Notes archived 2026-11-09 \\(part 1 of 1\\)\\]\\(https://github\\.com/example\\.test/app/issues/12#issuecomment-${entry.comment_id}\\)$`));
  assert.deepEqual(unsafe(f), []);
  assert.deepEqual(state.validateParent(f.parent()), []);
  // Steady state: nothing more is written to GitHub.
  const writes = f.github.mutations();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.github.mutations(), writes);
  assert.equal(f.posts().length, 1);
  // The page did not change between the post and the cut, so one stored copy serves both.
  assert.equal(copies(f).length, 1);
});

test('dry runs and single-issue passes post nothing, save nothing and cut nothing', () => {
  for (const options of [{ apply: false }, { apply: true, issue: 100 }]) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    const result = f.make().run(options);
    assert.deepEqual(result.holds, []);
    assert.equal(f.posts().length + f.edits().length + copies(f).length, 0);
    assert.ok(f.page().includes(AREA));
    assert.deepEqual(noteEntries(f), []);
    if (!options.apply) assert.ok(result.effects.some(effect => effect.kind === 'post_archive_comment' && archive.NOTE_KEY.test(effect.target.key)), 'the dry run names the planned note comment');
  }
});

test('an unsafe area raises one finding, moves nothing and never blocks the redraw; fixing it moves the notes and resolves the finding', () => {
  const bad = HEAD + '## Archive\nOld.\n\nCurrent plan\n---\nNever marked.\n';
  const f = pageFixture(state, { count: 3, hand: bad });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length + copies(f).length, 0);
  assert.ok(f.page().includes('## Archive\nOld.\n\nCurrent plan\n---\nNever marked.\n'));
  assert.ok(state.findStateBlock(f.page()).block, 'the graph still redraws');
  assert.equal(unsafe(f).length, 1);
  assert.deepEqual(unsafe(f)[0].diagnostics, { reason: 'underlined_heading' });
  assert.equal(unsafe(f)[0].state, 'new');
  assert.doesNotMatch(JSON.stringify(f.parent().attention), /Never marked|Old\./);
  // The same finding, not a second one, on the next pass.
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(unsafe(f).length, 1);
  // The owner fixes the heading.
  f.github.issues.get(12).body = f.page().replace('Current plan\n---\n', '## Current plan\n');
  f.github.issues.get(12).updated_at = f.github.tick();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.page().includes('Old.'), false);
  assert.ok(f.page().includes('## Current plan\nNever marked.\n'));
  assert.equal(unsafe(f)[0].state, 'resolved');
});

test('no saved copy, no move: a store that is not private, a failed copy and secret-shaped text all post nothing', () => {
  const open = pageFixture(state, { count: 3, hand: HAND });
  open.github.repos.get('example.test/store').private = false;
  const held = open.make().run({ apply: true });
  assert.ok(held.holds.some(hold => hold.code === 'STORE_NOT_PRIVATE'));
  assert.equal(open.posts().length + copies(open).length, 0);
  assert.ok(open.page().includes(AREA));

  const failing = pageFixture(state, { count: 3, hand: HAND });
  failing.github.intercept(call => (call.method === 'PUT' && call.path.includes('/page-copies/') ? { status: 500, json: { message: 'Server error' } } : null));
  assert.ok(failing.make().run({ apply: true }).holds.length);
  assert.equal(failing.posts().length, 0);
  assert.ok(failing.page().includes(AREA));
  failing.github.hooks = [];
  assert.deepEqual(failing.make().run({ apply: true }).holds, []);
  assert.equal(failing.page().includes('Keep every byte.'), false);

  const mismatched = pageFixture(state, { count: 3, hand: HAND });
  mismatched.github.intercept((call, github) => {
    if (call.method !== 'PUT' || !call.path.includes('/page-copies/')) return null;
    const answer = github.route(call.method, call.path, call.body);
    github.files.get(decodeURIComponent(call.path.split('/contents/')[1])).text += 'changed';
    for (const files of github.snapshots.values()) for (const [name, file] of files) if (name.includes('/page-copies/')) file.text += 'changed';
    return answer;
  });
  assert.ok(mismatched.make().run({ apply: true }).holds.some(hold => hold.code === 'STATE_READBACK_MISMATCH'));
  assert.equal(mismatched.posts().length, 0);

  const secret = pageFixture(state, { count: 3, hand: HAND.replace('Never marked.', `Bearer ${'a'.repeat(30)}`) });
  assert.deepEqual(secret.make().run({ apply: true }).holds, []);
  assert.equal(secret.posts().length + copies(secret).length, 0);
  assert.ok(secret.page().includes(AREA));
  assert.deepEqual(unsafe(secret).map(entry => entry.diagnostics), [{ reason: 'secret_like' }]);
  // A page the saved copy could not carry byte for byte (a lone surrogate outside the marked area).
  const broken = pageFixture(state, { count: 3, hand: HAND.replace('Never marked.', `Never${String.fromCharCode(0xD800)} marked.`) });
  assert.deepEqual(broken.make().run({ apply: true }).holds, []);
  assert.equal(broken.posts().length + copies(broken).length, 0);
  assert.ok(broken.page().includes(AREA));
  assert.deepEqual(unsafe(broken).map(entry => entry.diagnostics), [{ reason: 'control_character' }]);
  assert.throws(() => secret.store.savePageCopy(12, `token ghp_${'a'.repeat(30)}`), { code: 'PAGE_COPY_REFUSED' });
});

test('a lost post reply is found under its key and never posted twice', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  let lost = false;
  f.github.intercept(call => {
    if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
      lost = true; f.github.route(call.method, call.path, call.body);
      throw Object.assign(new Error('Lost reply'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  assert.ok(f.page().includes(AREA), 'nothing is cut before the comment is verified');
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1); assert.equal(f.edits().length, 0);
  assert.equal(noteEntries(f)[0].state, 'moved');
  assert.equal(f.page().includes('Keep every byte.'), false);
  assert.ok(f.page().includes(`#issuecomment-${noteEntries(f)[0].comment_id}`));
});

test('a comment changed or taken over before the cut never authorises it: the text stays until a fresh exact comment exists', () => {
  for (const mode of ['changed', 'foreign']) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    let lost = false;
    f.github.intercept(call => {
      if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
        lost = true; f.github.route(call.method, call.path, call.body);
        throw Object.assign(new Error('Lost reply'), { code: 'PASS_LOCK_LOST' });
      }
    });
    assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
    f.github.hooks = [];
    const id = [...f.github.comments.keys()][0];
    if (mode === 'changed') f.github.comments.get(id).body += 'Owner edit.';
    else f.github.comments.get(id).login = 'another-user';
    const retained = f.github.comments.get(id).body;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.edits().length, 0);
    assert.equal(f.github.comments.get(id).body, retained);
    const [entry] = noteEntries(f);
    assert.notEqual(entry.comment_id, id);
    assert.equal(archive.noteText(f.github.comments.get(entry.comment_id).body), AREA);
    assert.equal(entry.state, 'moved');
    assert.ok(untrusted(f).length);
  }
});

test('a page edit between the post and the cut: unrelated text reuses the comment, changed notes set it aside', () => {
  for (const mode of ['unrelated', 'notes']) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    let edited = false;
    f.github.intercept((call, github) => {
      // The owner saves an edit just after the note comment lands.
      if (!edited && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
        edited = true;
        const answer = github.route(call.method, call.path, call.body);
        const issue = github.issues.get(12);
        issue.body = mode === 'unrelated' ? issue.body.replace('Never marked.', 'Never marked. Owner addition.') : issue.body.replace('Keep every byte.', 'Keep every byte. Owner addition.');
        issue.updated_at = github.tick();
        return answer;
      }
      return null;
    });
    // The pass re-reads the page after the post, so it plans the cut from the owner's newer text.
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.ok(f.page().includes('Owner addition.') || mode === 'notes', 'the owner edit is never overwritten');
    const firstId = [...f.github.comments.keys()][0], firstBody = f.github.comments.get(firstId).body;
    assert.equal(archive.noteText(firstBody), AREA);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.edits().length, 0);
    assert.equal(f.github.comments.get(firstId).body, firstBody);
    const moved = noteEntries(f).filter(entry => entry.state === 'moved');
    assert.equal(moved.length, 1);
    if (mode === 'unrelated') {
      assert.equal(f.posts().length, 1);
      assert.equal(moved[0].comment_id, firstId);
      assert.ok(f.page().includes('Never marked. Owner addition.'));
      // The copy named is the page the cut replaced, with the owner's addition in it.
      assert.ok(f.github.files.get(`state/page-copies/issue-12/${moved[0].copy}.md`).text.includes('Owner addition.'));
    } else {
      assert.equal(f.posts().length, 2);
      assert.notEqual(moved[0].comment_id, firstId);
      assert.equal(archive.noteText(f.github.comments.get(moved[0].comment_id).body), AREA.replace('Keep every byte.', 'Keep every byte. Owner addition.'));
      const aside = noteEntries(f).find(entry => entry.comment_id === firstId);
      assert.equal(aside.state, 'withdrawn');
      assert.equal(context(f).includes(`issuecomment-${firstId}`), false);
      assert.ok(context(f).includes(`issuecomment-${moved[0].comment_id}`));
      // The first text coming back finds its untouched comment again: no third post.
      f.github.issues.get(12).body = f.page().replace('## Current plan\n', AREA + '## Current plan\n');
      f.github.issues.get(12).updated_at = f.github.tick();
      assert.deepEqual(f.make().run({ apply: true }).holds, []);
      assert.equal(f.posts().length, 2); assert.equal(f.edits().length, 0);
      assert.equal(noteEntries(f).find(entry => entry.comment_id === firstId).state, 'moved');
      assert.ok(context(f).includes(`issuecomment-${firstId}`));
      assert.equal(f.github.comments.get(firstId).body, firstBody);
    }
    assert.equal(f.page().includes('Keep every byte.'), false);
    assert.deepEqual(state.validateParent(f.parent()), []);
  }
});

test('a host that does not keep a note comment byte for byte gets one comment, not one per pass', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  f.github.intercept((call, github) => {
    if (call.method !== 'POST' || !/issues\/12\/comments$/.test(call.path)) return null;
    const answer = github.route(call.method, call.path, call.body);
    const stored = github.comments.get(answer.json.id); stored.body = stored.body.replace('Keep every byte.  \n', 'Keep every byte.\n');
    return answer;
  });
  assert.ok(f.make().run({ apply: true }).holds.length, 'the first pass reports that the comment did not settle');
  assert.equal(f.posts().length, 1);
  assert.ok(f.page().includes(AREA));
  assert.equal(noteEntries(f)[0].state, 'withdrawn');
  for (let pass = 0; pass < 3; pass++) {
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.posts().length, 1, 'the same text is never posted again');
    assert.equal(f.edits().length, 0);
    assert.ok(f.page().includes(AREA));
    assert.deepEqual(unsafe(f).map(entry => entry.diagnostics), [{ reason: 'comment_not_exact' }]);
    assert.equal(context(f).includes('issuecomment-'), false);
  }
  assert.deepEqual(state.validateParent(f.parent()), []);
  // Text the host keeps moves as usual and resolves the finding.
  f.github.hooks = [];
  f.github.issues.get(12).body = f.page().replace('Keep every byte.  \n', 'Keep every byte.\n');
  f.github.issues.get(12).updated_at = f.github.tick();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 2);
  assert.equal(f.page().includes('Keep every byte.'), false);
  assert.equal(unsafe(f)[0].state, 'resolved');
});

test('an interrupted cut settles by read-back: no second post, no replay, link kept', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  let landed = false, stopped = false;
  f.github.intercept(call => {
    if (call.method === 'PATCH' && /issues\/12$/.test(call.path)) landed = true;
    if (landed && !stopped && call.method === 'GET' && /issues\/12$/.test(call.path)) {
      stopped = true; throw Object.assign(new Error('Interrupted readback'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  const [pending] = noteEntries(f);
  assert.equal(pending.state, 'pending');
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.github.calls.filter(call => call.method === 'PATCH' && /issues\/12$/.test(call.path)).length, 1, 'the body write is never replayed');
  assert.equal(noteEntries(f)[0].state, 'moved');
  assert.ok(f.page().includes(`#issuecomment-${pending.comment_id}`));
  assert.equal(f.page().includes('Keep every byte.'), false);
});

const damage = (f, entry, mode) => {
  if (mode === 'changed') f.github.comments.get(entry.comment_id).body += '\nEdited later.';
  else if (mode === 'missing') f.github.comments.delete(entry.comment_id);
  else f.github.comments.get(entry.comment_id).login = 'another-user';
};
const answer = (f, id, change) => { const { doc, sha } = f.store.read('parent', 12); f.store.write('parent', 12, state.answerFinding(doc, { id, now: f.NOW, ...change }), { previous: doc, sha }); };

test('a moved note whose comment later changes or disappears keeps its link, raises one finding and is never reposted or edited', () => {
  for (const mode of ['changed', 'missing', 'foreign']) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const [entry] = noteEntries(f);
    damage(f, entry, mode);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.posts().length, 1); assert.equal(f.edits().length, 0);
    // The link and id stay; the id is pinned as untrusted so the report is made once.
    assert.deepEqual(noteEntries(f), [{ ...entry, untrusted_ids: [entry.comment_id] }]);
    assert.ok(context(f).includes(`#issuecomment-${entry.comment_id}`));
    assert.deepEqual(untrusted(f).map(found => found.diagnostics), [{ reason: mode, copy: entry.copy }]);
    // The finding names the saved copy file, which holds the notes.
    const text = state.findingText(untrusted(f)[0]);
    assert.ok(text.includes(`page-copies/issue-12/${entry.copy}.md`), text);
    assert.ok(f.github.files.get(`state/page-copies/issue-12/${entry.copy}.md`).text.includes(AREA));
    // Runtime and schema agree on the finding's copy name, and both refuse anything else there.
    const Ajv = require('ajv/dist/2020');
    const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
    const both = (value, valid) => { assert.equal(state.validateParent(value).length === 0, valid); assert.equal(validate(value), valid, JSON.stringify(validate.errors)); };
    both(f.parent(), true);
    for (const change of [d => { d.copy = 'short'; }, d => { d.text = 'note text'; }, d => { delete d.reason; }]) {
      const bad = structuredClone(f.parent()); change(bad.attention.find(found => found.code === 'ARCHIVE_COMMENT_UNTRUSTED').diagnostics); both(bad, false);
    }
    // Unanswered, it stays open. One pass shows it in the CURRENT summary; then the programme
    // goes quiet: no writes, nothing planned.
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const first = untrusted(f)[0], writes = f.github.mutations();
    for (let pass = 0; pass < 2; pass++) {
      assert.deepEqual(f.make().run({ apply: false }).effects, [], 'a dry run plans nothing');
      assert.deepEqual(f.make().run({ apply: true }).holds, []);
      assert.equal(f.github.mutations(), writes, 'no state commit, page write or comment');
    }
    assert.deepEqual(untrusted(f), [first]);
    // An unrelated owner edit still redraws: the damaged note does not hold the page.
    f.github.issues.get(12).body = f.page().replace('Never marked.', 'Never marked. Later edit.');
    f.github.issues.get(12).updated_at = f.github.tick();
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.posts().length, 1);
    assert.deepEqual(untrusted(f), [first]);
  }
});

test("the owner's answer to a damaged note finding stands on every later pass", () => {
  for (const change of [{ state: 'acknowledged' }, { state: 'disposed', reason: 'Restored by hand.' }]) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    damage(f, noteEntries(f)[0], 'changed');
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    answer(f, untrusted(f)[0].id, change);
    const answered = untrusted(f)[0];
    assert.equal(answered.state, change.state);
    for (let pass = 0; pass < 3; pass++) {
      assert.deepEqual(f.make().run({ apply: true }).holds, []);
      assert.deepEqual(untrusted(f), [answered], 'the answer is not undone');
    }
    const writes = f.github.mutations();
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.github.mutations(), writes);
    assert.equal(f.posts().length, 1);
  }
});

test('putting the same notes back under the marker after the comment is damaged posts a fresh comment and never holds the page', () => {
  for (const mode of ['changed', 'missing', 'foreign']) for (const reportedFirst of [true, false]) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const [entry] = noteEntries(f);
    const retained = f.github.comments.get(entry.comment_id)?.body;
    damage(f, entry, mode);
    const damaged = f.github.comments.get(entry.comment_id)?.body;
    if (reportedFirst) assert.deepEqual(f.make().run({ apply: true }).holds, []);
    // The owner restores the notes exactly as the saved page copy holds them.
    assert.ok(f.github.files.get(`state/page-copies/issue-12/${entry.copy}.md`).text.includes(AREA));
    f.github.issues.get(12).body = f.page().replace('## Current plan\n', AREA + '## Current plan\n');
    f.github.issues.get(12).updated_at = f.github.tick();
    assert.deepEqual(f.make().run({ apply: true }).holds, [], `${mode}: the page is not held`);
    assert.equal(f.posts().length, 2); assert.equal(f.edits().length, 0);
    const [fresh] = noteEntries(f);
    assert.equal(noteEntries(f).length, 1);
    assert.equal(fresh.key, entry.key); assert.equal(fresh.state, 'moved');
    assert.notEqual(fresh.comment_id, entry.comment_id);
    assert.ok(fresh.untrusted_ids.includes(entry.comment_id));
    assert.equal(archive.noteText(f.github.comments.get(fresh.comment_id).body), AREA);
    assert.equal(f.github.comments.get(entry.comment_id)?.body, damaged, 'the damaged comment is left as found');
    if (mode !== 'missing') assert.notEqual(retained, undefined);
    assert.equal(f.page().includes('Keep every byte.'), false);
    assert.ok(context(f).includes(`#issuecomment-${fresh.comment_id}`));
    assert.equal(context(f).includes(`#issuecomment-${entry.comment_id}`), false);
    assert.equal(untrusted(f).length, 1, 'reported once');
    assert.deepEqual(state.validateParent(f.parent()), []);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.posts().length, 2);
    const writes = f.github.mutations();
    assert.deepEqual(f.make().run({ apply: false }).effects, []);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.github.mutations(), writes);
  }
});

test('a pass that stopped for time finishes its redraw but posts and cuts no notes; the next full pass moves them', () => {
  for (const left of [170000, 90000]) {
    const f = pageFixture(state, { count: 3, hand: HAND });
    const start = Date.parse(f.NOW);
    const stopped = f.make({ pass: new state.RefreshBudget({ nowMs: () => start, budgetMs: left }) }).run({ apply: true });
    assert.ok(stopped.holds.some(hold => hold.code === 'PASS_STOPPED'), JSON.stringify(stopped.holds));
    assert.ok(state.findStateBlock(f.page()).block, 'the page is still redrawn');
    assert.equal(f.posts().length + copies(f).length, 0);
    assert.ok(f.page().includes(AREA));
    assert.deepEqual(noteEntries(f), []);
    assert.deepEqual(f.make().run({ apply: true }).holds.filter(hold => hold.code !== 'PASS_STOPPED'), []);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.posts().length, 1);
    assert.equal(f.page().includes('Keep every byte.'), false);
  }
  // The projection itself: asked to keep notes, it names the area's parts and leaves the page whole.
  const f = pageFixture(state, { count: 3, hand: HAND });
  const kept = f.make().projectBody(12, f.page(), state.renderParentBlockBody(f.parent(), f.children, f.issues), [], '3.57.0', null,
    state.renderCurrentBlockBody(f.parent(), f.children, f.issues, f.NOW), null, 5, { parent: f.parent(), only: false, keepNotes: true });
  assert.equal(kept.noteCut, undefined); assert.equal(kept.noteKeys.length, 1);
  assert.ok(kept.body.includes(AREA));
  assert.equal(kept.archive.some(part => part.kind === 'note'), false);
});

test('the shared hostile variants never widen what the reader accepts, and reading stays linear', () => {
  const hostile = require('./support/hostile-inputs.cjs');
  const sound = (body, name) => {
    const found = archive.noteArea(body);
    assert.ok(['none', 'unsafe', 'area'].includes(found.kind), name);
    if (found.kind !== 'area') return found;
    assert.equal(found.parts.map(part => part.text).join(''), body.slice(found.start, found.end), name);
    assert.ok(body.slice(found.start).startsWith('## Archive'), name);
    assert.ok(found.start === 0 || body[found.start - 1] === '\n', name);
    for (const part of found.parts) assert.equal(archive.noteText(part.body), part.text, name);
    return found;
  };
  for (const [name, body, expected] of ACCEPTED) for (const variant of hostile.variants(body)) {
    const found = sound(variant.text, `${name}/${variant.id}`);
    // CRLF is an ordinary line ending: the same area, as found. Every other break GitHub may or may
    // not honour, and a leading byte-order mark, must not yield an area.
    if (variant.id === 'crlf' && body.includes('\r')) continue;
    if (variant.id === 'crlf') assert.equal(found.kind === 'area' && variant.text.slice(found.start, found.end), hostile.variants(expected)[0].text, `${name}/crlf`);
    else if (variant.id !== 'tabs') assert.notEqual(found.kind, 'area', `${name}/${variant.id}`);
  }
  for (const [reason, body] of REFUSED) for (const variant of hostile.variants(body)) {
    assert.notEqual(sound(variant.text, `${reason}/${variant.id}`).kind, 'area', `${reason}/${variant.id}: ${JSON.stringify(variant.text)}`);
  }
  // Every shared hostile shape, dropped into the marked area and above it, keeps the reader sound.
  for (const shape of hostile.shapes) for (const body of [`${HEAD}## Archive\n${shape.text}\n\n${TAIL}`, `${shape.text}\n\n${HEAD}${AREA}${TAIL}`]) sound(body, shape.id);
  // A lone carriage return or a leading byte-order mark above the marker changes how GitHub reads
  // the lines before it, so nothing moves.
  assert.deepEqual(archive.noteArea('Text.\r```\n' + old + '```\n'), { kind: 'unsafe', reason: 'control_character' });
  assert.deepEqual(archive.noteArea(String.fromCharCode(0xFEFF) + '```\n' + old + '```\n'), { kind: 'unsafe', reason: 'control_character' });
  const build = size => `${HEAD}## Archive\n${'### Section\nword word word\n\n- [x] item `code`\n<!-- note -->\n\n'.repeat(Math.ceil(size / 60))}${TAIL}`;
  const timed = hostile.timing(text => archive.noteArea(text), build);
  assert.ok(timed.ok, timed.message);
});

test('a dry run says that notes leave the page', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  const planned = f.make().run({ apply: false }).effects.find(effect => effect.kind === 'post_archive_comment');
  assert.equal(state.describeEffect(planned), 'Move the notes marked under `## Archive` off #12\'s page into a verified comment');
  assert.equal(state.describeEffect({ kind: 'post_archive_comment', target: { issue: 12, key: 'graph-now-1' } }), 'Archive programme content from #12 in a verified comment');
});

test('a second marked area later adds a new entry and keeps the first link', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const first = noteEntries(f)[0];
  f.github.issues.get(12).body = f.page().replace('## Current plan\n', '## Archive\nSecond batch.\n\n## Current plan\n');
  f.github.issues.get(12).updated_at = f.github.tick();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const entries = noteEntries(f);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], first);
  assert.equal(archive.noteText(f.github.comments.get(entries[1].comment_id).body), '## Archive\nSecond batch.\n\n');
  assert.ok(context(f).indexOf(`issuecomment-${first.comment_id}`) < context(f).indexOf(`issuecomment-${entries[1].comment_id}`));
  assert.equal(f.page().includes('Second batch.'), false);
  assert.equal(f.github.comments.get(first.comment_id).body.includes('Second batch.'), false);
});

test('the Agent context comment and moved notes are both listed, the comment first, and a note comment never counts as context', () => {
  const f = pageFixture(state, { count: 3, hand: HEAD + '## Archive\nAgent context\n\n---\nOld background.\n\n' + TAIL });
  const id = f.github.addComment(12, { body: 'Agent context\n---\nBackground for agents.' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const [entry] = noteEntries(f);
  assert.equal(entry.state, 'moved');
  const link = number => `https://github.com/example.test/app/issues/12#issuecomment-${number}`;
  assert.equal(context(f), `${state.renderContextBlockBody()}\n\n- [Agent context](${link(id)})\n\n- [${entry.title}](${link(entry.comment_id)})`);
  assert.equal(f.page().includes('Old background.'), false);
  const writes = f.github.mutations();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.github.mutations(), writes);
});

test('notes share the five-comment budget after graph rows: with no slot left they wait, uncut, for the next pass', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  const none = f.project(f.page(), 0);
  assert.equal(none.noteCut, undefined);
  assert.ok(none.body.includes(AREA));
  assert.equal(none.archive.some(part => part.kind === 'note'), false);
  assert.equal(none.noteKeys.length, 1);
  const one = f.project(f.page(), 1);
  assert.equal(one.noteCut, true);
  assert.equal(one.body.includes('Keep every byte.'), false);
  assert.deepEqual(one.archive.map(part => part.kind), ['note']);
  assert.equal(one.posts, 1);
});

test('note entries, their intents and the new finding are closed in runtime and schema', () => {
  const f = pageFixture(state, { count: 3, hand: HAND });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  const doc = f.parent();
  assert.deepEqual(state.validateParent(doc), []); assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  assert.deepEqual(state.publicView('parent', doc).page_archive, doc.page_archive);
  const both = (value, valid) => { assert.equal(state.validateParent(value).length === 0, valid, JSON.stringify(state.validateParent(value))); assert.equal(validate(value), valid, JSON.stringify(validate.errors)); };
  const withdrawn = structuredClone(doc); withdrawn.page_archive[0].state = 'withdrawn'; both(withdrawn, true);
  for (const change of [
    entry => { delete entry.copy; }, entry => { entry.copy = 'short'; }, entry => { entry.group = 'NOW'; }, entry => { entry.key = 'note-xyz-1'; },
    entry => { entry.key = 'graph-now-1'; }, entry => { entry.kind = 'graph'; }, entry => { entry.state = 'done'; }, entry => { entry.text = 'note text'; },
    entry => { entry.comment_id = null; },
  ]) { const bad = structuredClone(doc); change(bad.page_archive[0]); both(bad, false); }
  // A graph entry can never be withdrawn or carry a copy.
  const graph = { key: 'graph-now-1', kind: 'graph', group: 'NOW', title: 'NOW', comment_id: 5, login: 'owner', digest: 'a'.repeat(64), state: 'moved' };
  const withGraph = structuredClone(doc); withGraph.page_archive.push(graph); both(withGraph, true);
  for (const change of [entry => { entry.state = 'withdrawn'; }, entry => { entry.copy = 'b'.repeat(64); }, entry => { entry.group = null; }]) {
    const bad = structuredClone(withGraph); change(bad.page_archive[1]); both(bad, false);
  }
  // Intents: a note may be posted, never edited.
  const target = { issue: 12, key: doc.page_archive[0].key, comment_id: null, login: 'owner', before: null, digest: 'b'.repeat(64) };
  const post = structuredClone(doc); post.pending_effects = [{ intent_id: 'note-intent', kind: 'post_archive_comment', state: 'IN_FLIGHT', target }]; both(post, true);
  const edit = structuredClone(doc); edit.pending_effects = [{ intent_id: 'note-intent', kind: 'edit_archive_comment', state: 'IN_FLIGHT', target: { ...target, comment_id: 7, before: 'a'.repeat(64) } }]; both(edit, false);
  // The finding: a fixed reason and nothing else.
  const finding = reason => { const value = structuredClone(doc); value.attention = state.foldAttention(value.attention, { source: 'reconcile', complete: false, now: f.NOW, seen: [{ code: 'ARCHIVE_SECTION_UNSAFE', issue: 12, diagnostics: { reason } }] }); return value; };
  for (const reason of archive.NOTE_REASONS) both(finding(reason), true);
  both(finding('some note text'), false);
  const extra = finding('two_markers'); extra.attention.at(-1).diagnostics.text = 'note text'; both(extra, false);
  const none = finding('two_markers'); delete none.attention.at(-1).diagnostics; both(none, false);
});

test('an archived note is a quotation: its old records and tags never count as decisions', () => {
  const quoted = '## Archive\nTEST-7 SUPERSEDES=TEST-3\n\nSCOPE-CONFIRMED\n\n---\nOld decision text.\n<!-- decision-trace-index -->\n';
  const part = archive.noteArea(quoted).parts[0];
  assert.equal(tags.isArchiveComment(part.body), true);
  assert.equal(tags.isArchiveComment(part.body.replace(/\n/g, '\r\n')), true);
  assert.equal(tags.isArchiveComment(part.body.replace('# Archived notes', '# Archived note')), false);
  assert.equal(tags.isArchiveComment(`Preface\n${part.body}`), false);
  const { auditDecisionTraces } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs'));
  const comments = [{ id: 1, user: { login: 'owner' }, body: part.body, created_at: '2026-11-09T00:00:00Z' }];
  const audit = auditDecisionTraces({ body: '', comments, prefix: 'TEST-', repository: 'example.test/app', issue: 12 });
  assert.deepEqual(audit.unlinked_decisions || [], []);
  assert.deepEqual(audit.unknown_supersedes || [], []);
});
