'use strict';

// The child page row reader (programme-child-rows.cjs) that the sweep's stale-work findings use:
// it reads only its subset of GitHub's Markdown, so no other shape counts as a ticked row or a merged PR.

const assert = require('node:assert/strict');
const test = require('node:test');
const { rowTicks } = require('../../skills/github-program-reconciler/scripts/programme-child-rows.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const COMMIT = 'c'.repeat(40);
function statePage(issueNumber, { prs = [{ number: 900, state: 'MERGED', merge_sha: COMMIT }], keptAt = null, keptReason = 'Slice 2 still to come' } = {}) {
  const finished = prs.filter(pr => ['MERGED', 'CLOSED'].includes(pr.state)).map(pr => pr.number);
  const child = { issue: issueNumber, revision: 3, repository: 'acme/app', lifecycle: 'ACTIVE', pr: prs[0] || null, prs, gate: null, uat: null,
    private: keptAt ? { keep_open: { reason: keptReason, at: keptAt, covers: finished } } : {} };
  return programmeState.renderBlock(programmeState.renderChildBlockBody(child, { issue: issueNumber, class: 'COMMITTED', order: 1 }), '3.165.0');
}
const page = (issueNumber, rows, options) => `# TASK\n\n## DONE WHEN\n\n${rows}\n\n# PLAN\n\nNow.\n\n${statePage(issueNumber, options)}\n`;
const ALL_TICKED = '- [x] Slice 1 lands.';
const TWO_UNTICKED = '- [ ] Slice 1 lands.\n- [ ] Changelog fragment.';

test('the sweep draws the Kept open line under the PR GRAPH, with its since time', () => {
  assert.match(page(40, ALL_TICKED, { keptAt: '2026-11-13T08:00:00.000Z' }), /^Kept open: Slice 2 still to come \(since 2026-11-13 08:00Z\)$/m);
  assert.equal(programmeState.KEPT_OPEN_IDLE_HOURS, 6);
});

const DONE_WHEN_BASE = impostor => `# TASK\n\n## DONE WHEN\n\n- [ ] a real row\n${impostor}\n\n# PLAN\n\nNow.\n\n${statePage(70)}\n`;
const PLAN_BASE = impostor => `# TASK\n\n## DONE WHEN\n\n- [ ] a real row\n\n## PLAN\n\n${impostor}\n\n${statePage(70)}\n`;
const point = code => String.fromCodePoint(code);
const TICKED_IMPOSTORS = [
  ...[
    ['backtick-fence', '```\n- [x] fake\n```'],
    ['tilde-fence', '~~~\n- [x] fake\n~~~'],
    ['unclosed-fence', '```\n- [x] fake'],
    ['longer-fence-closed-short', '````\n```\n- [x] fake\n````'],
    ['html-comment-block', '<!--\n- [x] fake\n-->'],
    ['four-space-indent', '\n    - [x] fake'],
    ['tab-indent', '\t- [x] fake'],
    ['quoted', '> - [x] fake'],
    ['no-space-after-marker', '-[x] fake'],
    ['no-space-after-box', '- [x]fake'],
    ['check-mark', `- [${point(0x2713)}] fake`],
    ['cyrillic-x', `- [${point(0x0445)}] fake`],
    ['zero-width-in-box', `- [${point(0x200b)}x] fake`],
    ['nbsp-after-marker', `-${point(0xa0)}[x] fake`],
    ['fullwidth-box', `- ${point(0xff3b)}x${point(0xff3d)} fake`],
    ...['cr', 'nel', 'ls', 'ps'].map(name => [`joined-by-${name}`, `a note${hostile.BREAKS[name]}- [x] fake`]),
  ].map(([id, text]) => ({ id, text: DONE_WHEN_BASE(text) })),
  ...[
    ['heading-in-fence', '```\n## DONE WHEN\n- [x] fake\n```'],
    ['heading-in-comment', '<!--\n## DONE WHEN\n- [x] fake\n-->'],
    ['heading-without-space', '#DONE WHEN\n- [x] fake'],
    ['heading-four-space-indent', '    ## DONE WHEN\n- [x] fake'],
    ['heading-other-words', '## NOT DONE WHEN\n- [x] fake'],
    ['heading-with-bom', `${point(0xfeff)}## DONE WHEN\n- [x] fake`],
  ].map(([id, text]) => ({ id: `plan-${id}`, text: PLAN_BASE(text) })),
];

test('red: the row reader never reads a shape outside its subset as a ticked row (hostile inputs)', () => {
  const quiet = text => rowTicks(text).ticked > 0;
  assert.equal(quiet(DONE_WHEN_BASE('- [x] a real ticked row')), true, 'control: a real ticked row counts');
  assert.equal(quiet(DONE_WHEN_BASE('- [X] a real ticked row')), true, 'control: X in either case');
  assert.equal(quiet(PLAN_BASE('### ROWS\n\n* [x] a real ticked row')), true, 'control: a ROWS heading and a star marker');
  hostile.expectDefaultDeny(assert, quiet, TICKED_IMPOSTORS);
  // Every line-break shape of a real page: CRLF reads the same as LF; the rest join lines, so nothing is
  // read as ticked; a leading byte order mark and tab indents leave the page's rows as they are.
  const real = DONE_WHEN_BASE('- [x] a real ticked row');
  hostile.expectDefaultDeny(assert, quiet, hostile.variants(real), { allow: ['crlf', 'bom', 'tabs'] });
  const large = hostile.timing(rowTicks, size => DONE_WHEN_BASE('- [ ] row\n'.repeat(Math.ceil(size / 10))));
  assert.ok(large.ok, large.message);
});

test('red: the row reader reads a merged PR only from a row of the one STATE block the sweep draws (hostile inputs)', () => {
  const merged = text => rowTicks(text).merged.length > 0;
  assert.deepEqual(rowTicks(page(71, TWO_UNTICKED)).merged, [900], 'control: the drawn block');
  const block = statePage(71);
  const [begin, ...rest] = block.split('\n');
  const end = rest.pop();
  const row = rest.find(line => line.includes('|#900|'));
  const without = rest.filter(line => line !== row).join('\n');
  const impostors = [
    ['row-outside-block', `${row}\n\n${begin}\n${without}\n${end}`],
    ['begin-only', `${begin}\n${rest.join('\n')}`],
    ['end-before-begin', `${end}\n${rest.join('\n')}\n${begin}`],
    ['two-blocks', `${block}\n\n${block}`],
    ['lowercase-status', block.replace('|MERGED|', '|merged|')],
    ['status-not-merged', block.replace('|MERGED|', '|NOT MERGED|')],
    ['status-merged-question', block.replace('|MERGED|', '|MERGED?|')],
    ['no-merge-sha', block.replace(/\|\[c{7}\]\([^)]*\)\|$/m, '|-|')],
    ['sha-not-a-commit-link', block.replace(/\(https:[^)]*\)/, '(x)')],
    ['short-commit-in-link', block.replace(`/commit/${COMMIT}`, '/commit/ccccccc')],
    ['row-joined-by-ls', block.replace(row, `|x|#899|OPEN|-|${hostile.BREAKS.ls}${row}`)],
    ['block-in-fence', `\`\`\`\n${block}\n\`\`\``],
  ].map(([id, text]) => ({ id, text: `## DONE WHEN\n\n${TWO_UNTICKED}\n\n${text}\n` }));
  hostile.expectDefaultDeny(assert, merged, impostors);
});
