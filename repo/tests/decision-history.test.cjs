'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = path.resolve(__dirname, '../../skills/github-program-reconciler/scripts');
const { OTHER_COMMENTS, commentTag, splitTag, groupByTag } = require(path.join(SCRIPTS, 'decision-tags.cjs'));
const { CONFIRMATION_TAG, entriesFromComments, entriesFromLedger, analyseTrace, childHistory, renderSummary, renderProgramme, summaryOf, parseArgs } = require(path.join(SCRIPTS, 'decision-history.cjs'));

const PREFIX = 'INT-TK421-';
let clock = 0;
const comment = (id, body, { login = 'owner', type = 'User', at } = {}) => ({
  id, body, user: { login, type }, created_at: at || `2026-10-${String(10 + Math.floor(clock / 24)).padStart(2, '0')}T${String(clock++ % 24).padStart(2, '0')}:00:00Z`
});
const tagged = (tag, text) => `${tag}\n---\n${text}`;
const read = (issue, comments) => entriesFromComments(issue, comments, { repo: 'acme/app', prefix: PREFIX });

test('a tag is the first line followed by a --- line, in upper case', () => {
  assert.equal(commentTag('DATA-LEAK-FIX-122\n---\nBody'), 'DATA-LEAK-FIX-122');
  assert.equal(commentTag('table-creation\r\n---\r\nBody'), 'TABLE-CREATION');
  assert.equal(commentTag('\n\n  SCOPE.V2_x  \n---  \nBody'), 'SCOPE.V2_X');
  assert.equal(commentTag('DATA-LEAK-FIX\n---'), 'DATA-LEAK-FIX');
  for (const body of ['', null, 'DATA-LEAK-FIX', 'DATA-LEAK-FIX\nBody\n---', 'Two words\n---\nBody', '-LEADING\n---\n', '## HEADING\n---\nBody', 'TAG\n----\nBody', `${'A'.repeat(81)}\n---\n`]) {
    assert.equal(commentTag(body), null, JSON.stringify(body));
  }
  assert.deepEqual(splitTag('TAG\r\n---\r\nline one\r\nline two'), { tag: 'TAG', text: 'line one\nline two' });
  assert.deepEqual(splitTag('No tag here'), { tag: null, text: 'No tag here' });
  assert.equal(OTHER_COMMENTS, 'Other comments');
});

test('the tag module is pure: it reads and writes nothing', () => {
  const source = fs.readFileSync(path.join(SCRIPTS, 'decision-tags.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(/);
});

test('tags are never combined and each list is oldest first, ties broken by comment ID', () => {
  const { tags, other } = groupByTag([
    { id: '30', tag: 'B', created_at: '2026-10-02' }, { id: '20', tag: 'A', created_at: '2026-10-03' },
    { id: '11', tag: 'A', created_at: '2026-10-01' }, { id: '9', tag: 'A', created_at: '2026-10-01' }, { id: '5', tag: null, created_at: '2026-10-01' }
  ]);
  assert.deepEqual([...tags.keys()], ['A', 'B']);
  assert.deepEqual(tags.get('A').map(entry => entry.id), ['9', '11', '20']);
  assert.deepEqual(tags.get('B').map(entry => entry.id), ['30']);
  assert.deepEqual(other.map(entry => entry.id), ['5']);
});

test('the latest comment per tag is live and earlier ones are replaced by inference', () => {
  const { entries } = read(548, [
    comment(1, tagged('VERSIONING', 'Use 4.0.0')), comment(2, tagged('LABELS', 'Keep labels')), comment(3, tagged('VERSIONING', 'Use 3.10.0 instead'))
  ]);
  const trace = analyseTrace(entries);
  assert.deepEqual(trace.live.map(entry => [entry.tag, entry.id, entry.replaces]), [['VERSIONING', '3', 1], ['LABELS', '2', 0]]);
  assert.deepEqual(trace.replaced.map(entry => [entry.id, entry.basis, entry.by]), [['1', 'inferred', 'comment 3']]);
  assert.equal(trace.tags, 2);
  assert.equal(trace.tagged, 3);
});

test('an explicit SUPERSEDES= replaces a record outright, even the latest in its tag', () => {
  const { entries } = read(548, [
    comment(1, tagged('PAGE', `${PREFIX}010 page has seven columns`)),
    comment(2, tagged('OTHER-TOPIC', `${PREFIX}011 drop the page entirely SUPERSEDES=${PREFIX}010`)),
    comment(3, tagged('CACHE', `${PREFIX}012 first`)), comment(4, tagged('CACHE', `${PREFIX}013 second SUPERSEDES=${PREFIX}012`))
  ]);
  const explicit = new Set(entries.flatMap(entry => entry.supersedes));
  const trace = analyseTrace(entries, explicit);
  assert.deepEqual(trace.live.map(entry => entry.tag).sort(), ['CACHE', 'OTHER-TOPIC']);
  const byId = Object.fromEntries(trace.replaced.map(entry => [entry.id, entry]));
  assert.equal(byId[1].basis, 'explicit');
  assert.equal(byId[1].by, `${PREFIX}011`);
  assert.equal(byId[3].basis, 'explicit');
  assert.equal(byId[3].by, `${PREFIX}013`);
});

test('an owner confirmation marks earlier replacements confirmed and later decisions new', () => {
  const { entries } = read(548, [
    comment(1, tagged('SCOPE', 'v1')), comment(2, tagged('SCOPE', 'v2')),
    comment(3, tagged(CONFIRMATION_TAG, 'Owner confirmed the live scope')),
    comment(4, tagged('LABELS', 'No labels')), comment(5, tagged('SCOPE', 'v3'))
  ]);
  const trace = analyseTrace(entries);
  assert.ok(trace.confirmation);
  assert.ok(!trace.live.some(entry => entry.tag === CONFIRMATION_TAG));
  assert.deepEqual(trace.live.map(entry => [entry.tag, entry.confirmed]), [['SCOPE', false], ['LABELS', false]]);
  assert.deepEqual(trace.replaced.map(entry => entry.basis), ['inferred', 'inferred']);
  const early = analyseTrace(read(548, [comment(6, tagged('A', 'one')), comment(7, tagged('A', 'two')), comment(8, tagged(CONFIRMATION_TAG, 'ok'))]).entries);
  assert.deepEqual(early.replaced.map(entry => entry.basis), ['confirmed']);
  assert.equal(early.live[0].confirmed, true);
  assert.match(renderSummary(childHistory({ child: 548, parent: 548, childEntries: read(548, [comment(9, tagged('A', 'x')), comment(10, tagged(CONFIRMATION_TAG, 'ok')), comment(11, tagged('B', 'y'))]) })), /B · .* · new/);
});

test('untagged comments go to Other comments, and ones naming a tag after its decision are uncertain', () => {
  const { entries } = read(548, [comment(1, tagged('LABELS', 'Keep labels')), comment(2, 'I changed my mind on labels, see LABELS'), comment(3, 'Unrelated note'), comment(4, `${PREFIX}020 untagged record`)]);
  const trace = analyseTrace(entries);
  assert.deepEqual(trace.other.map(entry => entry.id), ['2', '3', '4']);
  assert.deepEqual(trace.uncertain.map(item => [item.entry.id, item.tag]), [['2', 'LABELS']]);
  assert.deepEqual(trace.untagged_records.map(entry => entry.record), [`${PREFIX}020`]);
});

test('bots and index comments are counted, never entries', () => {
  const result = read(548, [comment(1, 'bot says hi', { login: 'ci[bot]' }), comment(2, 'x', { type: 'Bot' }), comment(3, '<!-- decision-trace-index -->\nlist'), comment(4, 'person')]);
  assert.deepEqual(result.counts, { comments: 4, bots: 2, index_comments: 1 });
  assert.deepEqual(result.entries.map(entry => entry.id), ['4']);
  assert.equal(result.entries[0].url, 'https://github.com/acme/app/issues/548#issuecomment-4');
});

test('parent and child traces are read and analysed separately, with SUPERSEDES= across them', () => {
  const parentEntries = read(421, [comment(100, tagged('VERSIONING', `${PREFIX}001 one number per batch`)), comment(101, 'Note about #548 and #5480'), comment(102, 'Note about #549')]);
  const childEntries = read(548, [comment(200, tagged('VERSIONING', `${PREFIX}002 child keeps no version SUPERSEDES=${PREFIX}001`))]);
  const history = childHistory({ child: 548, parent: 421, childEntries, parentEntries });
  assert.deepEqual(history.child_trace.live.map(entry => entry.id), ['200']);
  assert.deepEqual(history.parent_trace.live, []);
  assert.equal(history.parent_trace.replaced[0].basis, 'explicit');
  assert.deepEqual(history.parent_trace.mentions_child.map(entry => entry.id), ['101']);
  assert.ok(history.child_trace.live.every(entry => entry.issue === 548));
  assert.ok(history.parent_trace.other.every(entry => entry.issue === 421));
  const text = renderSummary(history);
  assert.ok(text.indexOf('#548 live decisions') < text.indexOf('#421 live decisions'));
  assert.match(text, /#421 other comments that mention the child: 1/);
});

test('the summary caps long lists with a count, never silently, and --full lists everything', () => {
  const many = Array.from({ length: 14 }, (_, at) => comment(300 + at, tagged(`TAG-${at}`, `Decision ${at} [with] brackets`)));
  const history = childHistory({ child: 548, parent: 548, childEntries: read(548, many) });
  const short = renderSummary(history, { max: 5 });
  assert.match(short, /and 9 more \(run with --full to list them\)/);
  assert.match(short, /Nothing skipped\./);
  assert.match(short, /Decision 13 \(with\) brackets/);
  assert.equal((renderSummary(history, { full: true }).match(/^- TAG-/gm) || []).length, 14);
});

test('summaries are one short plain line safe inside a link', () => {
  assert.equal(summaryOf('<!-- hidden -->\n## **Heading** `x`\nmore'), 'Heading x');
  assert.equal(summaryOf('[a](b) | c'), '(a)(b) c');
  assert.equal(summaryOf('x'.repeat(200)).length, 80);
  assert.equal(summaryOf(''), 'comment');
  assert.equal(summaryOf('<!-- a\nb --> Real <b>line</b>'), 'Real bline/b');
  assert.equal(summaryOf('<!-- never closed\nstill hidden'), 'comment');
  assert.doesNotMatch(summaryOf('<<!--x-->!-- y'), /<|>/);
});

test('a gap-audit ledger reads as untagged entries and reports issues it does not hold', () => {
  const ledger = { schema: 'toolkit.decision-ledger.v1', issues: [{ issue: 421, comments: 2, index_comment_ids: [9], entries: [
    { comment_id: 1, url: 'https://github.com/acme/app/issues/421#issuecomment-1', created_at: '2026-10-01T00:00:00Z', record_id: `${PREFIX}001`, supersedes: [], summary: 'First', topic: 'review' },
    { comment_id: 2, url: 'https://github.com/acme/app/issues/421#issuecomment-2', created_at: '2026-10-02T00:00:00Z', record_id: `${PREFIX}002`, supersedes: [`${PREFIX}001`], summary: 'Second', topic: 'review' }
  ] }] };
  const parent = entriesFromLedger(ledger, 421);
  assert.deepEqual(parent.entries.map(entry => [entry.tag, entry.hint]), [[null, 'review'], [null, 'review']]);
  const missing = entriesFromLedger(ledger, 548);
  assert.equal(missing.counts.missing, true);
  const history = childHistory({ child: 548, parent: 421, childEntries: missing, parentEntries: parent });
  assert.deepEqual(history.parent_trace.other_replaced.map(entry => entry.id), ['1']);
  const text = renderSummary(history);
  assert.match(text, /#548: not in the ledger, so not read/);
  assert.doesNotMatch(text, /Nothing skipped/);
  assert.match(renderProgramme(421, [{ number: 421, trace: { ...analyseTrace(parent.entries), counts: parent.counts } }, { number: 548, trace: { ...analyseTrace([]), counts: missing.counts } }]), /1 issue\(s\) not in the ledger/);
  assert.throws(() => entriesFromLedger({ schema: 'other' }, 1), /decision-ledger/);
});

test('arguments are checked before anything is read', () => {
  assert.deepEqual(parseArgs(['--repo', 'acme/app', '--child', '548']).child, 548);
  assert.equal(parseArgs(['--repo', 'acme/app', '--programme']).programme, true);
  for (const argv of [[], ['--repo', 'bad', '--child', '1'], ['--repo', 'acme/app'], ['--repo', 'acme/app', '--child', '1', '--programme'], ['--repo', 'acme/app', '--child', 'x'],
    ['--ledger', 'f.json', '--child', '1'], ['--ledger', 'f.json', '--child', '1', '--parent', '2', '--edits'], ['--repo', 'acme/app', '--child', '1', '--record-prefix', 'a b'],
    ['--repo', 'acme/app', '--child', '1', '--max', '0'], ['--repo', 'acme/app', '--child', '1', '--write']]) {
    assert.throws(() => parseArgs(argv), undefined, JSON.stringify(argv));
  }
});

test('the CLI only reads through gh, resolved to a full path with its window hidden', () => {
  const source = fs.readFileSync(path.join(SCRIPTS, 'decision-history.cjs'), 'utf8');
  const calls = [];
  const resolved = path.resolve(__dirname, 'fake-gh.exe');
  const binding = Buffer.from(JSON.stringify({ parent_issue: 421, record_prefix: PREFIX })).toString('base64');
  const output = [];
  const context = {
    module: {}, Buffer, console,
    process: { argv: ['node', 'history', '--repo', 'acme/app', '--child', '548', '--edits'], stdout: { write(text) { output.push(text); } } },
    require(name) {
      if (name === './resolve-executable.cjs') return { resolveExecutable(executable) { assert.equal(executable, 'gh'); return resolved; } };
      if (name === './decision-tags.cjs') return require(path.join(SCRIPTS, 'decision-tags.cjs'));
      if (name === 'node:child_process') return { spawnSync(executable, args, options) {
        calls.push({ executable, args, options });
        if (args[1] === 'graphql') return { status: 0, stdout: JSON.stringify({ data: { repository: { issue: { lastEditedAt: '2026-10-20T00:00:00Z', userContentEdits: { totalCount: 3 } } } } }) };
        if (String(args[1]).includes('contents/')) return { status: 0, stdout: JSON.stringify({ content: binding }) };
        const issue = /issues\/(\d+)\/comments/.exec(args.join(' '))?.[1];
        return { status: 0, stdout: JSON.stringify([[{ id: Number(issue) * 10, user: { login: 'owner' }, created_at: '2026-10-01T00:00:00Z', body: tagged('SCOPE', `Decision on ${issue}`) }]]) };
      } };
      return require(name);
    },
  };
  context.require.main = context.module;
  vm.runInNewContext(source, context);
  assert.equal(context.process.exitCode, 0);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.executable, resolved);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.args[0], 'api');
    assert.ok(!call.args.includes('--method') && !call.args.includes('-X'));
    assert.ok(!call.args.some(arg => /mutation/i.test(arg)));
  }
  const text = output.join('');
  assert.match(text, /#548 body: 3 revision\(s\), last edited 2026-10-20/);
  assert.match(text, /- SCOPE · 2026-10-01 · comment · \[Decision on 548\]/);
  assert.match(text, /- SCOPE · 2026-10-01 · comment · \[Decision on 421\]/);
});

test('the G0 history step is routed from the rules, both playbook indexes, the Projects skill and CONTROLLER.md', () => {
  const root = path.resolve(__dirname, '../..');
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const playbook = 'skills/repository-agent-rules/repo-local/docs/agent-playbooks/decision-trace.md';
  assert.ok(fs.existsSync(path.join(root, playbook)));
  assert.match(read('skills/repository-agent-rules/repo-local/docs/agent-playbooks/INDEX.md'), /Before G0 plans a programme child[^\n]*\(decision-trace\.md\)/);
  assert.ok(read('repo/docs/agent-playbooks/INDEX.md').includes(`Read: \`${playbook}\`.`));
  assert.match(read('repo/contracts/agent-rules/toolkit-governed-rules.md'), /Decision traces:[^\n]*parent and child traces never mix[^\n]*latest comment wins[^\n]*G0 reads both traces[^\n]*\(decision-trace playbook\)/);
  assert.match(read('repo/contracts/claude-projects/web-controller-projects/SKILL.md'), /Every G0 brief for a programme child says to read the parent's and the child's decision traces first/);
  assert.match(read('repo/CONTROLLER.md'), /live-scope summary \(decision-trace playbook\) is the spec only once the owner confirms it; record that as a `SCOPE-CONFIRMED` comment/);
  const text = read(playbook);
  assert.ok(text.includes(`--child <n>`) && text.includes('SCOPE-CONFIRMED') && text.includes('never every child'));
  assert.doesNotMatch(text, /github\.com|#\d/);
});
