'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { pageFixture } = require('./support/programme-page-fixture.cjs');
const { expectDefaultDeny, BREAKS } = require('./support/hostile-inputs.cjs');
const reader = text => state.archiveSection(text);

test('B-T8: marked notes move byte-exact with reference copies and become moved after body readback', () => {
  const text = '### Notes\r\nA [link][ref].  \r\n\r\n  Code\r\n';
  const refs = '[ref]: https://example.com\r\n';
  const hand = '# Programme\r\n\r\nKeep this.  \r\n\r\n' + refs + '\r\n## Archive\r\n' + text;
  const f = pageFixture(state, { hand });
  let bodyReadback = false;
  f.github.intercept(call => {
    if (call.method === 'GET' && call.path.endsWith('/issues/12') && !/^## Archive\r?$/m.test(f.github.issues.get(12).body)) bodyReadback = true;
    if (call.method === 'PUT' && call.body?.content) {
      const doc = JSON.parse(Buffer.from(call.body.content, 'base64').toString());
      if (doc.page_archive?.some(entry => entry.state === 'moved')) assert.equal(bodyReadback, true);
    }
  });
  const report = f.make().run({ apply: true });
  assert.deepEqual(report.holds, []);
  const entry = f.parent().page_archive[0];
  assert.equal(entry.state, 'moved');
  const comment = f.github.comments.get(entry.comment_id);
  assert.ok(comment.body.includes(text));
  assert.ok(comment.body.endsWith(refs));
  assert.ok(f.page().includes(refs));
  assert.ok(f.page().includes('Keep this.  \r\n'));
  assert.doesNotMatch(f.page(), /^## Archive|^### Notes/m);
  assert.match(state.findStateBlock(f.page(), 'CONTEXT').block.body, /Archived notes: \[Notes\]/);
  const writes = f.github.mutations();
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
  assert.equal(f.github.mutations(), writes);
});

test('oversized marked items split only at blank lines with every byte retained', () => {
  const text = '### Notes\n' + 'a'.repeat(35000) + '\n\n' + 'b'.repeat(35000) + '\n';
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n' + text });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 2);
  const payloads = [...f.github.comments.values()].map(comment => comment.body.split('Moved unchanged from the programme page.\n\n')[1]);
  assert.equal(payloads.join(''), text);
  assert.ok([...f.github.comments.values()].every(comment => comment.body.length < 60000));
  assert.ok(f.page().length < 55000);
  assert.equal(f.parent().page_archive.filter(entry => entry.state === 'moved').length, 2);
});

test('reference copies cover shortcut and collapsed links and retain definitions inside the marked area', () => {
  const refs = '[ref]: https://example.com\n  "A title"\n';
  const text = `### Notes\nUse [ref] and [ref][].\n\n${refs}`;
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n' + text });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok([...f.github.comments.values()][0].body.includes(text));
  assert.ok([...f.github.comments.values()][0].body.endsWith(refs));
  assert.ok(f.page().includes(refs));
});

test('graph archive parts stay below the hard limit and preserve graph row order', () => {
  const archive = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-page-archive.cjs'));
  const rows = Array.from({ length: 1000 }, (_, i) => ({ group: 'RETIRED', text: `|Task ${i}|${'x'.repeat(140)}|#${1000 + i}|-|-|RETIRED|-|` }));
  const parts = archive.graphComments(rows);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.body.length < 60000));
  assert.deepEqual(parts.flatMap(part => part.body.split('\n').filter(line => /^\|Task /.test(line))), rows.map(row => row.text));
});

test('B-T5: five posts per parent pass, marked notes continue on the next pass', () => {
  const f = pageFixture(state, { hand: '# Programme\n\n## Archive\n' + Array.from({ length: 8 }, (_, i) => `### Note ${i}\nText ${i}.\n\n`).join('') });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 5);
  assert.equal((f.page().match(/^### Note/gm) || []).length, 3);
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 8);
  assert.doesNotMatch(f.page(), /^## Archive/m);
  assert.equal(f.parent().page_archive.filter(entry => entry.state === 'moved').length, 8);
});

test('the shared post budget spends graph archives before notes and trace pages', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) + '\n## Archive\n' + Array.from({ length: 8 }, (_, i) => `### Note ${i}\nSmall note.\n\n`).join('') });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 5);
  const kinds = f.posts().map(post => post.body.body.startsWith('<!-- programme-page-archive key=graph-') ? 0 : post.body.body.startsWith('<!-- programme-page-archive key=section-') ? 1 : 2);
  assert.equal(kinds[0], 0);
  assert.ok(kinds.includes(1));
  assert.deepEqual(kinds, [...kinds].sort(), 'all graph posts precede notes and trace pages');
  assert.ok(f.page().length < 55000);
});

test('a repair notice waits with its intent when archives spend all five comment slots', () => {
  const f = pageFixture(state, { count: 1, groups: ['LATER'], hand: '# Programme\n## Archive\n' + Array.from({ length: 5 }, (_, i) => `### Note ${i}\nText.\n\n`).join('') });
  Object.assign(f.binding, { schema: state.SCHEMA.bindingV2, governance: 'enabled', parent_lifecycle: { reopen_incomplete: true, complete_when_children_closed: false } });
  const parent = f.github.issues.get(12);
  parent.state = 'closed'; parent.closed_at = f.NOW;
  parent.events = [{ id: 9, event: 'closed', actor: { login: 'owner' }, created_at: f.NOW }];
  const first = f.make().run({ apply: true });
  assert.equal(f.posts().length, 5);
  assert.equal(parent.state, 'open');
  assert.ok(first.holds.length);
  assert.ok(f.parent().pending_effects.some(effect => effect.kind === 'post_parent_repair'));
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 6);
  assert.match(f.posts().at(-1).body.body, /toolkit-parent-repair:12:9/);
  assert.deepEqual(f.parent().pending_effects, []);
});

test('B-T9: an owner edit after the verified post updates that comment instead of posting again', () => {
  const f = pageFixture(state, { hand: '# Programme\n\n## Archive\n### Notes\nOriginal.\n' });
  let changed = false;
  f.github.intercept(call => {
    if (!changed && call.method === 'GET' && /issues\/comments\//.test(call.path)) {
      changed = true; f.github.issues.get(12).body = '# Programme\n\n## Archive\n### Notes\nOwner changed it.\n'; f.github.issues.get(12).updated_at = f.github.tick();
    }
  });
  f.make().run({ apply: true });
  assert.equal(f.posts().length, 1);
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.ok(f.edits().length >= 1);
  assert.match([...f.github.comments.values()][0].body, /Owner changed it/);
  assert.equal(f.parent().page_archive[0].state, 'moved');
});

test('B-T10: archive reader rejects hostile markers and refuses malformed marked areas', () => {
  const hidden = [
    ['fenced', '```md\n## Archive\n### Notes\nText\n```\n'],
    ['tilde-fenced', '~~~\n## Archive\n~~~\n'],
    ['details', '<details>\n## Archive\n</details>\n'],
    ['comment', '<!--\n## Archive\n-->\n'],
    ['case', '## archive\n### Notes\nText\n'],
    ['indent', '    ## Archive\nText\n'],
    ['lookalike', `## Arch${String.fromCodePoint(0x456)}ve\nText\n`],
    ['trailing-space', '## Archive \nText\n'],
    ['heading-lookalike', '### Archive\nText\n'],
    ['managed', state.renderBlock('## Archive\n### Notes\nText', '3.57.0')],
  ].map(([id, text]) => ({ id, text }));
  for (const [name, eol] of Object.entries({ lf: '\n', cr: BREAKS.cr, crlf: BREAKS.crlf, ls: BREAKS.ls, ps: BREAKS.ps, mixed: '\r\n' })) {
    for (const [shape, prefix] of [
      ['fence', '```info' + eol], ['tilde', '~~~info' + eol],
      ['fence-comment-info', '```md <!-- a -->' + eol], ['tilde-comment-info', '~~~md <!-- a -->' + eol],
      ['reopen', '<!-- a --> <!--' + eol], ['close-reopen', '<!--\nend --> <!--' + eol],
      ['pre', '<pre>' + eol], ['div', '<div>' + eol], ['table', '<table>' + eol],
      ['pre-comment', '<pre><!-- a -->' + eol], ['div-comment', '<div><!-- a -->' + eol],
      ['invalid-info', '```info`' + eol],
    ]) hidden.push({ id: `${name}-${shape}`, text: prefix + '## Archive\n### Hidden\nKeep this.\n' });
  }
  hidden.push({ id: 'mixed-crlf-cr', text: '```md\r\n## Archive\r### Hidden\nKeep.\r\n```\n' });
  expectDefaultDeny(assert, text => reader(text).items.length > 0, hidden);
  for (const [id, body, reason] of [
    ['doubled', '## Archive\nText\n## Archive\nMore\n', 'duplicate_marker'],
    ['doubled-after-block', `## Archive\nText\n${state.renderBlock('trace', '3.57.0', 'TRACE')}\n## Archive\nMore\n`, 'duplicate_marker'],
    ['fence', '## Archive\n### Notes\n```\nText\n', 'open_fence'],
    ['comment', '## Archive\n<!--\nText\n', 'open_comment'],
    ['comment-at-boundary', `## Archive\n<!--\nText\n${state.renderBlock('trace', '3.57.0', 'TRACE')}\n`, 'open_comment'],
    ['fence-at-boundary', `## Archive\n~~~\nText\n${state.renderBlock('trace', '3.57.0', 'TRACE')}\n~~~\n`, 'open_fence'],
    ['details', '## Archive\n<details>\nText\n', 'unbalanced_details'],
    ['closing-details', '## Archive\n</details>\n', 'unbalanced_details'],
    ['raw-html', '## Archive\n<div>\nHidden\n</div>\n', 'raw_html'],
    ['invalid-info', '## Archive\n```md`bad\nHidden\n', 'invalid_fence'],
  ]) assert.equal(reader(body).unsafe, reason, id);
  for (const eol of ['\n', BREAKS.crlf]) {
    const text = ['## Archive', '### Notes', '<details>', 'Body.', '</details>', ''].join(eol);
    assert.equal(reader(text).items.length, 1);
    assert.equal(reader(text).items[0].text, text.slice(text.indexOf('###')));
  }
});

test('a new note with an old title keeps the old moved comment and posts a distinct item', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nFirst note.\n' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const first = f.parent().page_archive[0].comment_id;
  f.github.issues.get(12).body += '\n## Archive\n### Notes\nSecond note.\n';
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.length, 2);
  assert.equal(f.posts().length, 2);
  assert.equal(f.edits().length, 0);
  assert.match(f.github.comments.get(first).body, /First note/);
  assert.equal(state.findStateBlock(f.page(), 'CONTEXT').block.body.match(/\[Notes\]/g).length, 2);
});

test('pending note identity survives an owner title edit without another post', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  f.github.intercept(call => call.method === 'PATCH' && /issues\/12$/.test(call.path) ? { status: 409, json: {} } : undefined);
  assert.ok(f.make().run({ apply: true }).holds.length);
  f.github.hooks = [];
  f.github.issues.get(12).body = f.page().replace('### Notes', '### Renamed notes');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.edits().length, 1);
  assert.match([...f.github.comments.values()][0].body, /### Renamed notes/);
});

test('an interrupted body readback keeps verified notes reachable and settles the pending registry', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  let landed = false, stopped = false;
  f.github.intercept(call => {
    if (call.method === 'PATCH' && /issues\/12$/.test(call.path)) landed = true;
    if (landed && !stopped && call.method === 'GET' && /issues\/12$/.test(call.path)) {
      stopped = true; throw Object.assign(new Error('Interrupted readback'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  assert.equal(f.parent().page_archive[0].state, 'pending');
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.parent().page_archive[0].state, 'moved');
  assert.match(state.findStateBlock(f.page(), 'CONTEXT').block.body, /Archived notes: \[Notes\]/);
});

test('a comment changed during body-intent bookkeeping cannot remove the marked source', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  let changed = false;
  f.github.intercept(call => {
    if (!changed && call.method === 'PUT' && call.body?.content) {
      const doc = JSON.parse(Buffer.from(call.body.content, 'base64').toString());
      if (doc.pending_effects?.some(effect => effect.kind === 'replace_block') && doc.page_archive?.[0]?.comment_id) {
        changed = true; f.github.comments.get(doc.page_archive[0].comment_id).body += 'Concurrent change.';
      }
    }
  });
  const report = f.make().run({ apply: true });
  assert.ok(report.holds.some(entry => entry.code === 'EFFECT_UNKNOWN'));
  assert.match(f.page(), /^### Notes\nText/m);
  assert.equal(f.parent().page_archive[0].state, 'pending');
  assert.equal(f.github.calls.some(call => call.method === 'PATCH' && /issues\/12$/.test(call.path)), false);
});

test('missing graph archives repost only under a new verified id', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const first = f.parent().page_archive[0];
  const previousEdits = f.edits().length;
  f.github.comments.delete(first.comment_id);
  const report = f.make().run({ apply: true });
  assert.deepEqual(report.holds, []);
  const current = f.parent().page_archive.find(entry => entry.key === first.key);
  assert.notEqual(current.comment_id, first.comment_id);
  assert.equal(current.state, 'moved');
  assert.match(f.page(), new RegExp(`#issuecomment-${current.comment_id}`));
  assert.ok(f.edits().slice(previousEdits).every(call => !call.path.endsWith(`/${first.comment_id}`)), 'the missing id is never edited');
});

test('archive registry, effect targets and new diagnostics are closed in runtime and schema', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  const doc = f.parent(), digest = state.contentDigest(doc);
  const without = structuredClone(doc); delete without.page_archive;
  assert.equal(state.contentDigest(without), digest);
  assert.equal(state.sameState(without, doc), false);
  assert.deepEqual(state.publicView('parent', doc).page_archive, doc.page_archive);
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  const target = { issue: 12, key: doc.page_archive[0].key, comment_id: doc.page_archive[0].comment_id, login: 'owner', before: 'a'.repeat(64), digest: 'b'.repeat(64) };
  for (const kind of ['post_archive_comment', 'edit_archive_comment']) {
    const valid = structuredClone(doc);
    valid.pending_effects = [{ intent_id: 'archive-intent', kind, state: 'IN_FLIGHT', target: { ...target, ...(kind === 'post_archive_comment' ? { before: null, comment_id: null } : {}) } }];
    assert.deepEqual(state.validateParent(valid), []); assert.equal(validate(valid), true, JSON.stringify(validate.errors));
    for (const change of [value => { value.pending_effects[0].target.extra = 'text'; }, value => { value.pending_effects[0].target.digest = 'wrong'; }]) {
      const bad = structuredClone(valid); change(bad);
      assert.ok(state.validateParent(bad).length); assert.equal(validate(bad), false);
    }
  }
  for (const change of [value => { value.page_archive[0].extra = true; }, value => { value.page_archive[0].digest = 'bad'; }, value => { value.page_archive[0].state = 'done'; }, value => { value.page_archive[0].kind = 'other'; }]) {
    const bad = structuredClone(doc); change(bad);
    assert.ok(state.validateParent(bad).length); assert.equal(validate(bad), false);
  }
});

test('unsafe sections produce durable closed diagnostics and zero comment effects', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\n```\nOpen\n' });
  const report = f.make().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.ok(state.findStateBlock(f.page()).block, 'unsafe notes do not stop the first redraw');
  const entry = f.parent().attention.find(entry => entry.code === 'ARCHIVE_SECTION_UNSAFE');
  assert.deepEqual(entry.diagnostics, { reason: 'open_fence' });
  assert.equal(f.posts().length + f.edits().length, 0);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  assert.equal(validate(f.parent()), true, JSON.stringify(validate.errors));
  assert.deepEqual(state.validateParent(f.parent()), []);
  const bad = structuredClone(f.parent()); bad.attention[0].diagnostics.owner_text = 'private';
  assert.equal(validate(bad), false);
  assert.ok(state.validateParent(bad).length);
});

test('B-T11: missing, foreign and changed moved notes detach without blocking redraw', () => {
  for (const mode of ['missing', 'foreign', 'changed']) {
    const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const entry = f.parent().page_archive[0], id = entry.comment_id;
    if (mode === 'missing') f.github.comments.delete(id);
    else if (mode === 'foreign') f.github.comments.get(id).login = 'another-user';
    else f.github.comments.get(id).body += 'Owner edit.';
    f.github.issues.get(12).body += '\n## Archive\n### More\nNew content.\n';
    const before = f.posts().length, edits = f.edits().length;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.posts().length, before + 1); assert.equal(f.edits().length, edits);
    assert.ok(f.parent().page_archive.find(part => part.key === entry.key).untrusted_ids?.includes(id));
    assert.match(state.findStateBlock(f.page(), 'CONTEXT').block.body, new RegExp(`\\[Notes\\]\\([^)]*#issuecomment-${id}\\)`));
    if (mode === 'missing') assert.match(f.page(), /missing comment; owner recovery needed/);
    assert.equal(f.parent().attention.find(finding => finding.code === 'ARCHIVE_COMMENT_UNTRUSTED').state, 'new');
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.parent().attention.find(finding => finding.code === 'ARCHIVE_COMMENT_UNTRUSTED').state, 'new', 'attention lasts until owner disposition');
    assert.equal(f.edits().length, edits);
    if (mode !== 'missing') {
      f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.attention.find(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED').state = 'disposed'; return doc; } });
      f.github.comments.delete(id);
      assert.deepEqual(f.make().run({ apply: true }).holds, []);
      assert.match(f.page(), /missing comment; owner recovery needed/);
      assert.equal(f.parent().attention.find(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED').state, 'new');
      assert.equal(f.edits().length, edits);
    }
  }
});

test('B-T12: archive comments remain untagged and every decision stays reachable', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  f.github.addComment(12, { body: 'Delivery\n---\nTEST-1\nA decision.' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.length, 1, 'the moved note is still reachable through the trace');
  const audit = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs')).auditDecisionTraces({ body: f.page(), comments: f.github.commentsOf(12), recordPrefix: 'TEST-', repository: f.github.repository, issue: 12 });
  assert.deepEqual(audit.unlinked_decisions, []);
  assert.match(state.findStateBlock(f.page(), 'TRACE').block.body, /Other comments/);
});

test('archived quotations cannot introduce decision records, supersession or trace indexes', () => {
  const auditModule = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs'));
  const quoted = `<!-- programme-page-archive key=section-${'a'.repeat(16)}-1 -->\nMoved unchanged from the programme page.\n\nTEST-2\nSUPERSEDES=TEST-1\nSUPERSEDES=TEST-999\n`;
  const direct = auditModule.auditDecisionTraces({ body: '[one](#issuecomment-1) [two](#issuecomment-2)', comments: [
    { id: 1, body: 'Delivery\n---\nTEST-1\nDecision.', user: { login: 'owner' } },
    { id: 2, body: quoted, user: { login: 'owner' } },
  ], recordPrefix: 'TEST-', repository: 'example.test/app', issue: 12 });
  assert.deepEqual(direct.unknown_supersedes, [], 'quoted text must not create a new supersession instruction');
  assert.deepEqual(direct.superseded_unmarked, []);
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Old notes\nTEST-2\nSUPERSEDES=TEST-1\nSUPERSEDES=TEST-999\n<!-- decision-trace-index -->\n' });
  const original = f.github.addComment(12, { body: 'Delivery\n---\nTEST-1\nA real decision.' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.length, 1);
  const comments = f.github.commentsOf(12);
  const audit = auditModule.auditDecisionTraces({ body: f.page(), comments, recordPrefix: 'TEST-', repository: f.github.repository, issue: 12 });
  assert.deepEqual(audit.unlinked_decisions, []);
  assert.deepEqual(audit.unknown_supersedes, []);
  assert.deepEqual(audit.superseded_unmarked, []);
  assert.doesNotMatch(state.findStateBlock(f.page(), 'TRACE').block.body, /replaced by/);
  const history = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-history.cjs')).entriesFromComments(12, comments, { repo: f.github.repository, prefix: 'TEST-' });
  const moved = history.entries.find(entry => entry.id !== String(original));
  assert.equal(moved.tag, null); assert.equal(moved.record, null); assert.deepEqual(moved.supersedes, []);
  // Plain user comments remain decisions; only the complete generated quote header is exempt.
  const plain = auditModule.auditDecisionTraces({ body: '', comments: [{ id: 1, body: 'TEST-3\nA real unlinked record.', user: { login: 'owner' } }], recordPrefix: 'TEST-', repository: f.github.repository, issue: 12 });
  assert.equal(plain.unlinked_decisions.length, 1);
});

test('B-T4: graph archives re-sort on reopen, empty parts stay registered and are reused', t => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const first = f.parent().page_archive.find(entry => entry.kind === 'graph');
  assert.ok(first);
  const id = first.comment_id;
  const beforePosts = f.posts().length;
  assert.ok(f.page().length < 55000);
  for (const outcome of f.parent().outcomes) {
    const saved = f.store.read('child', outcome.issue).doc;
    const rowCount = [...f.github.comments.values()].filter(comment => comment.issue === 12).reduce((count, comment) => count + Number(new RegExp(`^\\|[^\\n]*\\|#${outcome.issue}\\|`, 'm').test(comment.body)), 0)
      + Number(new RegExp(`^\\|[^\\n]*\\|#${outcome.issue}\\|`, 'm').test(f.page()));
    assert.equal(rowCount, 1, `one location for ${outcome.issue}, ${saved.lifecycle}`);
  }
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
  // Remove the unmarked padding as an owner edit. Every row returns; the empty comment remains.
  f.github.issues.get(12).body = f.page().replace('Notes. '.repeat(5700), 'Short notes.');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.find(entry => entry.key === first.key).comment_id, id);
  assert.match(f.github.comments.get(id).body, /No rows are archived/);
  assert.doesNotMatch(f.page(), /Archived: \[/);
  f.github.issues.get(12).body = f.page().replace('Short notes.', 'Notes. '.repeat(5700));
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, beforePosts);
  assert.ok(f.github.comments.get(id).body.includes('|#'));
  const archivedIssue = Number(/\|#(\d+)\|/.exec(f.github.comments.get(id).body)[1]);
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.outcomes.find(outcome => outcome.issue === archivedIssue).class = 'COMMITTED'; return doc; } });
  f.store.mutate('child', archivedIssue, { writer: f.writer, parentDoc: f.parent(), change: doc => { doc.lifecycle = 'ACTIVE'; delete doc.completed_at; return doc; } });
  f.github.issues.get(archivedIssue).state = 'open'; f.github.issues.get(archivedIssue).closed_at = null;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.match(f.page(), new RegExp(`^\\|[^\\n]*\\|#${archivedIssue}\\|`, 'm'));
  assert.doesNotMatch(f.github.comments.get(id).body, new RegExp(`\\|#${archivedIssue}\\|`));
  t.diagnostic(JSON.stringify({ fixture: '84 rows applied', body: f.page().length, posts: f.posts().length, edits: f.edits().length }));
});

test('large overflow respects graph group order, five posts and reaches a stable redraw', t => {
  const f = pageFixture(state, { count: 180, width: 100, hand: '# Programme\n\n' + 'Notes. '.repeat(6600) });
  const start = f.github.calls.length;
  const r = f.make(), plan = r.plan();
  const planning = f.github.calls.length - start, applyAt = f.github.calls.length;
  const report = r.apply(plan);
  const applyRequests = f.github.calls.length - applyAt;
  assert.deepEqual(report.holds, []);
  assert.ok(f.page().length < 55000);
  assert.ok(f.posts().length <= 5);
  const archive = f.parent().page_archive;
  const moved = archive.map(entry => [entry.group, (f.github.comments.get(entry.comment_id).body.match(/^\|[^\n]*\|#\d+\|/gm) || []).length]);
  assert.deepEqual(moved.map(([group]) => group), ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'].slice(0, moved.length));
  assert.equal(moved.reduce((sum, [, count]) => sum + count, 0) + (f.page().match(/^\|[^\n]*\|#\d+\|/gm) || []).length, 180);
  for (const entry of archive) {
    const ids = (f.github.comments.get(entry.comment_id).body.match(/\|#\d+\|/g) || []).map(cell => Number(cell.slice(2, -1)));
    const eligible = f.parent().outcomes.filter(outcome => ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'][(outcome.issue - 100) % 5] === entry.group).map(outcome => outcome.issue).sort((a, b) => a - b);
    assert.deepEqual([...ids].sort((a, b) => a - b), eligible.slice(0, ids.length), `${entry.group}: oldest eligible rows move first`);
    const graphOrder = state.renderParentBlockBody(f.parent(), f.children, f.issues).split('\n').filter(line => /^\|[^\n]*\|#\d+\|/.test(line)).map(line => Number(line.split('|')[3].slice(1)));
    assert.deepEqual(ids, graphOrder.filter(id => ids.includes(id)), `${entry.group}: archive keeps graph sort`);
  }
  t.diagnostic(JSON.stringify({ fixture: 'large overflow', moved, posts: f.posts().length, body: f.page().length, planning_requests: planning, apply_requests: applyRequests }));
  // The first pass used all five posts on graph groups. The next pass can page their new trace
  // links, returning the now-unnecessary row prefix to the body; then it must settle completely.
  const posts = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(f.posts().length - posts <= 5);
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
});

test('archive post recovery finds a lost successful response without a second post', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  let lost = false;
  f.github.intercept(call => {
    if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
      lost = true; f.github.route(call.method, call.path, call.body);
      throw Object.assign(new Error('Lost response'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  assert.equal(f.parent().pending_effects[0].kind, 'post_archive_comment');
  assert.match(f.page(), /^### Notes/m);
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.parent().page_archive[0].state, 'moved');
  assert.deepEqual(f.parent().pending_effects, []);
});

test('archive edit recovery distinguishes exact DONE, NOT_DONE and detached owner edits', () => {
  for (const outcome of ['DONE', 'NOT_DONE', 'UNKNOWN']) {
    const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nOriginal.\n' });
    f.github.intercept(call => call.method === 'PATCH' && /issues\/12$/.test(call.path) ? { status: 409, json: {} } : undefined);
    assert.ok(f.make().run({ apply: true }).holds.length);
    assert.equal(f.parent().page_archive[0].state, 'pending');
    f.github.hooks = [];
    f.github.issues.get(12).body = f.page().replace('Original.', 'Changed.');
    let stopped = false;
    f.github.intercept(call => {
      if (!stopped && call.method === 'PATCH' && /issues\/comments\//.test(call.path)) {
        stopped = true;
        if (outcome === 'DONE') f.github.route(call.method, call.path, call.body);
        if (outcome === 'UNKNOWN') f.github.comments.get(f.parent().page_archive[0].comment_id).body += 'Unexpected edit.';
        throw Object.assign(new Error('Interrupted edit'), { code: 'PASS_LOCK_LOST' });
      }
    });
    assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
    f.github.hooks = [];
    const plan = f.make().plan();
    assert.equal(plan.resolutions.find(entry => entry.archive || entry.untrusted || entry.outcome === outcome)?.outcome, outcome === 'UNKNOWN' ? 'NOT_DONE' : outcome);
    if (outcome === 'UNKNOWN') {
      assert.deepEqual(f.make().apply(plan).holds, []);
      assert.equal(f.posts().length, 2, 'unlinked pending source gets a fresh verified comment');
      assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'));
      assert.match(f.page(), /Archived notes:/);
    } else {
      assert.deepEqual(f.make().apply(plan).holds, []);
      assert.equal(f.posts().length, 1);
    }
  }
});

test('single-issue passes never post or edit archive comments and keep marked text', () => {
  const f = pageFixture(state, { count: 1, hand: '# Programme\n## Archive\n### Notes\nText\n' });
  assert.deepEqual(f.make().run({ apply: true, issue: 100 }).holds, []);
  assert.equal(f.posts().length + f.edits().length, 0);
  assert.match(f.page(), /^### Notes/m);
  assert.equal(state.findStateBlock(f.page(), 'CONTEXT').block.body.includes('Archived notes:'), false);
});

for (const count of [1, 7]) for (const mode of ['crash', 'lost-fence', '502', 'owner-edit']) {
  test(`H1: ${count} notes survive ${mode} body readback and a later new note`, () => {
    const notes = Array.from({ length: count + 1 }, (_, i) => `### Note ${i}\nPayload ${i}.\n\n`);
    const f = pageFixture(state, { hand: '# Programme\n## Archive\n' + notes.slice(0, count).join('') });
    let landed = false, interrupted = false;
    f.github.intercept(call => {
      if (call.method === 'PATCH' && /issues\/12$/.test(call.path)) landed = true;
      if (landed && !interrupted && call.method === 'GET' && /issues\/12$/.test(call.path)) {
        interrupted = true;
        if (mode === '502') return { status: 502, json: {} };
        if (mode === 'owner-edit') { f.github.issues.get(12).body += '\nOwner readback edit.\n'; return; }
        throw Object.assign(new Error('Interrupted after body landed'), { code: mode === 'crash' ? 'PASS_LOCK_LOST' : 'STALE_WRITER' });
      }
    });
    if (['crash', 'lost-fence'].includes(mode)) assert.throws(() => f.make().run({ apply: true }), { code: mode === 'crash' ? 'PASS_LOCK_LOST' : 'STALE_WRITER' });
    else assert.ok(f.make().run({ apply: true }).holds.length);
    assert.equal(f.posts().length, Math.min(count, 5));
    assert.ok(f.parent().page_archive.some(entry => entry.state === 'pending'));
    f.github.hooks = [];
    const area = reader(f.page());
    f.github.issues.get(12).body = area.start === null ? f.page() + '\n## Archive\n' + notes[count]
      : f.page().slice(0, area.end) + notes[count] + f.page().slice(area.end);
    const before = f.posts().length;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.ok(f.posts().length - before <= 5);
    const context = state.findStateBlock(f.page(), 'CONTEXT').block.body;
    for (const [i, note] of notes.entries()) {
      const locations = Number(f.page().includes(note)) + [...f.github.comments.values()].filter(comment => comment.body.includes(note)).length;
      assert.equal(locations, 1, `Note ${i} has exactly one location`);
      const entry = f.parent().page_archive.find(entry => entry.title === `Note ${i}`);
      assert.equal(entry.state, 'moved');
      assert.ok(context.includes(`[Note ${i}](https://github.com/example.test/app/issues/12#issuecomment-${entry.comment_id})`));
      assert.ok(f.github.comments.get(entry.comment_id).body.includes(note));
    }
    if (mode === 'owner-edit') assert.ok(f.page().includes('Owner readback edit.'));
  });
}

for (const mode of ['checkbox', 'typo', 'edit', 'missing', 'viewer', 'foreign']) {
  test(`H2: ${mode} graph comment detaches and redraws with a fresh verified part`, () => {
    const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const first = f.parent().page_archive.find(entry => entry.kind === 'graph'), id = first.comment_id;
    if (mode === 'missing') f.github.comments.delete(id);
    else if (mode === 'viewer') f.github.login = 'another-user';
    else if (mode === 'foreign') f.github.comments.get(id).login = 'another-user';
    else f.github.comments.get(id).body += mode === 'checkbox' ? '\n- [x] Checked by owner.' : mode === 'typo' ? '\nTypo fixed.' : '\nOwner comment edit.';
    const old = f.github.comments.get(id)?.body, before = f.posts().length, edits = f.edits().length;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const next = f.parent().page_archive.find(entry => entry.key === first.key);
    assert.notEqual(next.comment_id, id);
    assert.ok(next.untrusted_ids?.includes(id));
    assert.ok(f.posts().length > before && f.posts().length - before <= 5);
    assert.ok(f.edits().slice(edits).every(call => !call.path.endsWith(`/${id}`)));
    assert.equal(f.github.comments.get(id)?.body, old);
    assert.ok(f.page().includes(`#issuecomment-${next.comment_id}`));
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED' && entry.state === 'new'));
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED' && entry.state === 'new'));
  });
}

test('H2/L10: lost-reply duplicate markers select the lowest exact verified id', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nPayload.\n' });
  let lost = false;
  f.github.intercept(call => {
    if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
      lost = true; f.github.route(call.method, call.path, call.body);
      f.github.addComment(12, { body: call.body.body });
      f.github.addComment(12, { body: call.body.body + 'Different content.' });
      throw Object.assign(new Error('Lost reply, duplicate already visible'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive[0].comment_id, Math.min(...f.github.comments.keys()));
  assert.equal(f.posts().length, 1);
  assert.equal(f.edits().length, 0);
  assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'));
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
});

for (const issueScoped of [false, true]) for (const shape of ['duplicate', 'fence', 'comment', 'details']) {
  test(`M1: ${shape} unsafe first projection redraws, issueScoped=${issueScoped}`, () => {
    const suffix = { duplicate: '## Archive\nMore\n', fence: '```\nOpen\n', comment: '<!--\nOpen\n', details: '<details>\nOpen\n' }[shape];
    const hand = '# Programme\n## Archive\n### Notes\nKeep.\n' + suffix;
    const f = pageFixture(state, { count: 1, hand });
    const report = f.make().run({ apply: true, ...(issueScoped ? { issue: 100 } : {}) });
    assert.deepEqual(report.holds, []);
    assert.ok(state.findStateBlock(f.page()).block);
    assert.ok(f.page().includes('### Notes\nKeep.\n' + suffix));
    assert.equal(f.posts().length + f.edits().length, 0);
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_SECTION_UNSAFE' && entry.state === 'new'));
  });
}

test('M1: unsafe marker after five moves still redraws an activated task', () => {
  const f = pageFixture(state, { count: 1, hand: '# Programme\n## Archive\n' + Array.from({ length: 7 }, (_, i) => `### Note ${i}\nPayload.\n\n`).join('') });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  f.github.issues.get(12).body += '\n## Archive\nMore\n';
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.outcomes[0].class = 'COMMITTED'; return doc; } });
  f.store.mutate('child', 100, { writer: f.writer, parentDoc: f.parent(), change: doc => { doc.lifecycle = 'ACTIVE'; return doc; } });
  f.github.issues.get(100).state = 'open'; f.github.issues.get(100).closed_at = null;
  const before = f.posts().length + f.edits().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.match(state.findStateBlock(f.page()).block.body, /\|NOW\|IN PROGRESS\|/);
  assert.equal(f.posts().length + f.edits().length, before);
  assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_SECTION_UNSAFE'));
});

test('M2: only Archive items move; later H1/H2 sections keep their exact bytes', () => {
  for (const boundary of ['# Current plan', '## Current plan']) {
    const later = `${boundary}\r\nKeep this.  \r\n\r\n## Risks\r\n  Keep risks.\r\n`;
    const text = '### Old decision log\r\nOld notes.\r\n#### Detail\r\nMore.\r\n';
    const f = pageFixture(state, { hand: '# Programme\r\n## Archive\r\n' + text + later });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.ok(f.page().includes(later));
    assert.ok([...f.github.comments.values()].some(comment => comment.body.includes(text)));
    assert.ok([...f.github.comments.values()].every(comment => !comment.body.includes('Keep this.') && !comment.body.includes('Keep risks.')));
    assert.doesNotMatch(state.findStateBlock(f.page(), 'CONTEXT').block.body, /\[Current plan\]|\[Risks\]/);
  }
  for (const tail of ['', '## Current plan\nKeep.\n']) {
    const text = 'Preamble.\n\n### Log\n```md\n## Inside fence\n```\n<!--\n## Inside comment\n-->\nNotes.\n';
    const area = reader('## Archive\n' + text + tail);
    assert.equal(area.items.length, 2);
    assert.equal(area.items[0].title, 'Archived notes');
    assert.equal(area.items.map(item => item.text).join(''), text);
  }
});

test('M3: CR and mixed CommonMark line endings preserve exact Archive offsets', () => {
  const archive = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-page-archive.cjs'));
  for (const text of ['## Archive\r### Notes\rPayload.\r## Current\rKeep.\r', '## Archive\r\n### Notes\rPayload.\n## Current\r\nKeep.\r']) {
    const area = reader(text);
    assert.equal(area.items.length, 1);
    assert.equal(area.items[0].text, text.slice(area.content, text.indexOf('## Current')));
    assert.equal(archive.removeItems(text, area, area.items), text.slice(text.indexOf('## Current')));
  }
  const reference = '[ref]: https://example.com\r';
  const referenced = reader('## Archive\r### Notes\rUse [ref].\r## Current\rKeep.\r' + reference);
  assert.equal(referenced.items[0].refs, reference, 'CR reference copies cannot include unmarked later sections');
  assert.doesNotMatch(archive.sectionComment(referenced.items[0]), /Keep\./);
});


test('H2: detached registry and attention diagnostics fail closed in runtime and schema', () => {
  const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nText\n' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const id = f.parent().page_archive[0].comment_id;
  f.github.comments.delete(id);
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const doc = f.parent();
  assert.equal(doc.page_archive[0].missing, true);
  const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
  const formatted = cli.formatReport({ store: f.binding.store, repository: f.binding.repository, parent_issue: 12, mode: 'preview', summary: 'Archive recovery', effects: [], recovered: [], holds: [], close_list: [], findings: [{ code: 'ARCHIVE_COMMENT_UNTRUSTED', issue: 12, detail: 'Inspect the missing comment', diagnostics: { reason: 'missing' } }] });
  assert.match(formatted, /Archive comment: missing/);
  assert.doesNotMatch(formatted, /Archive markup: missing/);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  assert.deepEqual(state.validateParent(doc), []);
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  for (const change of [value => { value.page_archive[0].untrusted_ids = [null]; }, value => { value.page_archive[0].untrusted_ids = [id, id]; }, value => { value.page_archive[0].missing = 'yes'; },
    value => { value.attention.find(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED').diagnostics.reason = 'owner text'; },
    value => { value.attention.find(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED').diagnostics.extra = 'text'; }]) {
    const bad = structuredClone(doc); change(bad);
    assert.ok(state.validateParent(bad).length);
    assert.equal(validate(bad), false);
  }
});

test('H2: lost-reply comments edited or transferred before registration cannot hold the page', () => {
  for (const mode of ['changed', 'foreign']) {
    const f = pageFixture(state, { hand: '# Programme\n## Archive\n### Notes\nPayload.\n' });
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
    assert.equal(f.posts().length, 2);
    assert.equal(f.github.comments.get(id).body, retained);
    assert.ok(f.parent().page_archive[0].untrusted_ids?.includes(id));
    assert.notEqual(f.parent().page_archive[0].comment_id, id);
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'));
  }
});

test('H2: graph replacements share five posts with the owed repair notice', () => {
  const f = pageFixture(state, { count: 180, hand: '# Programme\n\n' + 'Notes. '.repeat(6600) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 5);
  for (const entry of f.parent().page_archive) f.github.comments.get(entry.comment_id).body += '\nOwner edit.';
  Object.assign(f.binding, { schema: state.SCHEMA.bindingV2, governance: 'enabled', parent_lifecycle: { reopen_incomplete: true, complete_when_children_closed: false } });
  const issue = f.github.issues.get(12);
  issue.state = 'closed'; issue.closed_at = f.NOW;
  issue.events = [{ id: 9, event: 'closed', actor: { login: 'owner' }, created_at: f.NOW }];
  const before = f.posts().length;
  f.make().run({ apply: true });
  assert.equal(f.posts().length - before, 5);
  assert.ok(f.parent().pending_effects.some(effect => effect.kind === 'post_parent_repair'));
  assert.ok(state.findStateBlock(f.page()).block);
  const second = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(f.posts().length - second <= 5);
  assert.ok(f.posts().some(call => call.body.body.includes('toolkit-parent-repair:12:9')));
});
