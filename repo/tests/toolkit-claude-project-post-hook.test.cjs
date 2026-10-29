'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-project-post-hook.cjs');
const { decide, linkIssue, wordingIssue, layoutIssue, editIssue, mergeTarget, mergeTargets, NEAR_LIMIT_BYTES } = require('../scripts/toolkit-claude-project-post-hook.cjs');

const POST = 'mcp__hearthbot__post_message';
const EDIT = 'mcp__hearthbot__edit_message';
let callCount = 0;

// Transcript lines in Claude Code's shape: owner wakes, post and edit calls, and their results.
const wake = (from = 'human', extra = '') => ({ type: 'user', message: { role: 'user', content: `<wake reason="mention">${extra}<message from="${from}" trust="principal">hi</message></wake>` } });
function call(name, input, result = '{"message_id":"cmsg_A1"}', isError = false) {
  const id = `toolu_${callCount += 1}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text: result }] }] } },
  ];
}
const lines = entries => entries.flat().map(entry => JSON.stringify(entry));
const post = (entries, text = 'Done.') => decide({ tool_name: POST, transcript_path: 'transcript.jsonl', tool_input: { text } }, () => lines(entries));

test('a fresh post with no owner message since the newest post is refused and names the post to edit', () => {
  const reason = post([wake(), call(POST, { text: 'First.' })]);
  assert.match(reason, /one running post/);
  assert.match(reason, /cmsg_A1/);
  assert.match(reason, /edit_message/);
});

test('a fresh post is allowed after an owner message, at the start, after a failed post and near 8 KB', () => {
  assert.equal(post([wake()]), '');
  assert.equal(post([call(POST, { text: 'First.' }), wake()]), '');
  assert.equal(post([wake(), call(POST, { text: 'First.' }, 'error', true)]), '');
  assert.equal(post([wake(), call(POST, { text: 'x'.repeat(NEAR_LIMIT_BYTES) })]), '');
  // Edits that grow the running post count toward the limit; edits to other posts do not.
  assert.equal(post([wake(), call(POST, { text: 'First.' }), call(EDIT, { message_id: 'cmsg_A1', text: 'x'.repeat(NEAR_LIMIT_BYTES) }, 'ok')]), '');
  assert.match(post([wake(), call(POST, { text: 'First.' }), call(EDIT, { message_id: 'cmsg_B2', text: 'x'.repeat(NEAR_LIMIT_BYTES) }, 'ok')]), /one running post/);
  // An owner message delivered as a queued prompt also counts.
  const queued = { type: 'attachment', attachment: { type: 'queued_command', prompt: '<message from="human">more</message>' } };
  assert.equal(post([wake(), call(POST, { text: 'First.' }), queued]), '');
});

test('owner text inside a tool result does not count, and messages from other Claudes do not either', () => {
  const echoed = call('mcp__hearthbot__read_project_chat', {}, '<message from="human">old</message>');
  assert.match(post([wake(), call(POST, { text: 'First.' }), echoed]), /one running post/);
  assert.match(post([wake(), call(POST, { text: 'First.' }), wake('claude')]), /one running post/);
});

test('work threads keep one running post too, and replies under a post are not counted but are link-checked', () => {
  const thread = [wake('human', 'You are a Thread Session created by this project'), call(POST, { text: 'First.' })];
  assert.match(post(thread), /one running post/);
  assert.match(post(thread, 'Merged PR 612.'), /carries its link/);
  const reply = text => decide({ tool_name: POST, transcript_path: 't', tool_input: { thread_id: 'cmsg_T', text } }, () => lines([wake(), call(POST, { text: 'First.' })]));
  assert.equal(reply('Answer under the post.'), '');
  // Replies are exempt from the running post rule only: the link rule still holds.
  assert.match(reply('PR 5 merged'), /carries its link/);
  assert.equal(post([wake(), call(POST, { thread_id: 'cmsg_T', text: 'Reply.' })]), '');
});

test('every PR named carries a link: changed files when ready, otherwise the owning thread', () => {
  assert.match(linkIssue('Merged PR 612 today.'), /"PR 612" has no link/);
  assert.match(linkIssue('See PR #613.'), /has no link/);
  assert.match(linkIssue('PR 614 at https://github.com/o/r/pull/614'), /without \/files/);
  assert.equal(linkIssue('[PR 612](https://github.com/o/r/pull/612/files) is ready.'), '');
  assert.equal(linkIssue('Waiting: [PR 616 refresh](#cmsg_ABC) in its thread.'), '');
  assert.equal(linkIssue('PR 619 (https://github.com/o/r/pull/619/files) is ready.'), '');
  assert.equal(linkIssue('Run `gh pr view` and `PR 5` in code.'), '');
  assert.equal(linkIssue('No pull requests mentioned.'), '');
  // Coordinator posts and edits are checked for links.
  const edit = text => decide({ tool_name: EDIT, transcript_path: 't', tool_input: { message_id: 'cmsg_A1', text } }, () => lines([wake()]));
  assert.match(edit('PR 7 merged'), /carries its link/);
  assert.match(post([wake()], 'PR 7 merged'), /carries its link/);
  assert.equal(edit('All done.'), '');
});

test('the hook process denies with a reason and passes other tools and unreadable input', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-project-post-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${lines([wake(), call(POST, { text: 'First.' })]).join('\n')}\n`);
  const run = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const denied = run(JSON.stringify({ tool_name: POST, transcript_path: transcript, tool_input: { text: 'Second.' } }));
  assert.equal(denied.status, 2);
  const decision = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.equal(decision.permissionDecision, 'deny');
  assert.match(decision.permissionDecisionReason, /cmsg_A1/);
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'PR 5' } })).status, 0);
  assert.equal(run('not json').status, 0);
  assert.equal(run(JSON.stringify({ tool_name: POST, transcript_path: path.join(dir, 'missing.jsonl'), tool_input: { text: 'Hi.' } })).status, 0);
});

test('the hook is for Claude Projects only: other tools, other servers and other hosts are never checked', () => {
  const transcript = () => lines([wake(), call(POST, { text: 'First.' })]);
  for (const tool of ['Bash', 'Write', 'mcp__slack__post_message', 'mcp__github__add_issue_comment', 'post_message', 'mcp__hearthbot__request_decision', 'mcp__hearthbot__update_progress_checklist']) {
    assert.equal(decide({ tool_name: tool, transcript_path: 't', tool_input: { text: 'PR 5 merged', command: 'PR 5' } }, transcript), '', tool);
  }
  // Only the Claude Code plugin registers it, on the Projects post tools and the merge commands; Codex hooks never name it.
  const claudeHooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const entries = claudeHooks.hooks.PreToolUse.filter(entry => entry.hooks.some(hook => /toolkit-claude-project-post-hook/.test(hook.command)));
  assert.deepEqual(entries.map(entry => entry.matcher), ['^(?:mcp__hearthbot__(?:post_message|edit_message)|Bash|PowerShell|mcp__.*merge_pull_request)$']);
  for (const other of ['.codex-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, other), 'utf8'), /project-post-hook/, other);
  }
});

test('each PR in a list needs its own link', () => {
  assert.match(linkIssue('PRs 612 and 613, see https://github.com/o/r/pull/612/files'), /PR 613/);
  for (const text of ['PR 612 and 613 /pull/612/files', 'PRs 612 & 613 /pull/612/files', 'PRs 612/613 /pull/612/files', 'PRs [612](https://github.com/o/r/pull/612/files) and 613']) {
    assert.match(linkIssue(text), /PR 613/, text);
  }
  assert.equal(linkIssue('PRs [612](https://github.com/o/r/pull/612/files) and [613](#cmsg_A)'), '');
  assert.equal(linkIssue('[PRs 612 and 613](#cmsg_A) are waiting.'), '');
  assert.equal(linkIssue('PRs 612, 613 /pull/612/files /pull/613/files'), '');
  assert.equal(linkIssue('PR 9 waits; [PR 9](#cmsg_A) has the thread.'), '');
  assert.match(linkIssue('pr 612 merged'), /PR 612/);
  assert.equal(linkIssue('The PRD is PR-ready.'), '');
  // Link text on the first number never covers the rest of the list.
  assert.match(linkIssue('[PR 612](#cmsg_A) and 613'), /PR 613/);
  assert.match(linkIssue('[PR 612](https://github.com/o/r/pull/612/files) and 613 at https://github.com/o/r/pull/613'), /PR 613 is linked without \/files/);
  // Oxford comma and "or" lists run to their last number.
  assert.match(linkIssue('PRs 612, 613, and 614 /pull/612/files /pull/613/files'), /PR 614/);
  assert.match(linkIssue('PRs 612, 613 or 614 /pull/612/files /pull/613/files'), /PR 614/);
  assert.match(linkIssue('PRs 612, 613, or 614 /pull/612/files /pull/613/files'), /PR 614/);
  // A count after a list number is not read as a PR number.
  assert.equal(linkIssue('[PR 612](#cmsg_A) and 2 others'), '');
  assert.equal(linkIssue('PR [612](#cmsg_A), 3 checks pending'), '');
  // A real PR number (three or more digits) followed by a count word is still a PR.
  for (const text of ['PR [612](#cmsg_A)/613 files', 'PRs [612](#cmsg_A) and 613 checks pass', 'PRs [612](#cmsg_A), 613 left to merge', 'PRs [612](#cmsg_A) and 613 more']) {
    assert.match(linkIssue(text), /PR 613/, text);
  }
  // A colon or bracket after the PR word still starts a list.
  assert.match(linkIssue('Ready PRs: 612 and 613'), /PR 612/);
  assert.match(linkIssue('PRs (612, 613)'), /PR 612/);
  // A long run of spaces after the PR word, a colon, a bracket or a list comma stays fast.
  for (const start of ['PR 1,', 'PR', 'PR:', 'PR(']) {
    const started = Date.now();
    linkIssue(`${start}${' '.repeat(32000)}x`);
    assert.ok(Date.now() - started < 500, start);
  }
});

test('guards hold: failed posts, size in bytes, the 8 KB escape and quoted owner text', () => {
  // A failed post never becomes the running post, even when its error names a message id.
  assert.equal(post([wake(), call(POST, { text: 'First.' }, 'error: cmsg_X9 rejected', true)]), '');
  // Size counts bytes: 3,600 two-byte characters are over the 7,000-byte limit.
  assert.equal(post([wake(), call(POST, { text: 'é'.repeat(3600) })]), '');
  assert.match(post([wake(), call(POST, { text: 'a'.repeat(3600) })]), /one running post/);
  // The 8 KB escape lifts the running post rule only, never the link rule.
  assert.match(post([wake(), call(POST, { text: 'x'.repeat(NEAR_LIMIT_BYTES) })], 'PR 5 merged'), /carries its link/);
  // Owner tags in compaction summaries, meta entries or quoted inside other text are not owner messages.
  const quoted = text => ({ type: 'user', message: { role: 'user', content: text } });
  for (const entry of [
    { ...quoted('<message from="human">old</message>'), isCompactSummary: true },
    { ...quoted('<message from="human">skill text</message>'), isMeta: true },
    quoted('<relay from="coordinator"><note>They wrote <message from="human">hi</message></note></relay>'),
    // Two quoted owner messages in a row, and a forwarded thread block, inside another message.
    quoted('<relay from="coordinator"><note><message from="human">a</message><message from="human">b</message></note></relay>'),
    quoted('<relay from="coordinator"><cited><thread ts="t"><message from="human">fwd</message></thread></cited></relay>'),
  ]) {
    assert.match(post([wake(), call(POST, { text: 'First.' }), entry]), /one running post/);
  }
  // Each quoting tag hides an owner tag inside it, including a sibling's message and a bare coordinator relay.
  for (const name of [
    'message', 'note', 'cited', 'relay', 'coordinator-relay',
    'cross-session-message', 'task-notification', 'child-session-output', 'project_claude_message',
  ]) {
    const entry = quoted(`<wake><${name} from="sibling">They wrote <message from="human">hi</message></${name}></wake>`);
    assert.match(post([wake(), call(POST, { text: 'First.' }), entry]), /one running post/, name);
  }
  assert.match(post([wake(), call(POST, { text: 'First.' }), quoted('<coordinator-relay><message from="human">hi</message></coordinator-relay>')]), /one running post/);
  // A real wake nests the message under its project and thread tags.
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake reason="mention">\n  <project id="p">\n    <thread ts="t">\n      <message from="human" trust="principal">hi</message>')]), '');
  // A self-closing tag and a stray "<" in earlier text do not hide the owner message.
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake><project id="p"><attachment name="a"/><message from="human">hi</message></project></wake>')]), '');
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake><message from="claude">a<b</message><message from="human">hi</message></wake>')]), '');
  // An unfamiliar wake wrapper still counts, so a new wake shape cannot block every fresh post.
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake><channel id="c"><message from="human">hi</message></channel></wake>')]), '');
  // An owner message after a Claude's message in the same wake counts.
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake><project id="p"><thread ts="t"><message from="claude">note</message><message from="human">hi</message></thread></project></wake>')]), '');
  // A wake with an image arrives as an image block, then the wake text.
  const withImage = { type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'image', source: {} }, { type: 'text', text: '<wake><message from="human">see</message></wake>' }] } };
  assert.equal(post([call(POST, { text: 'First.' }), withImage]), '');
});

// A post in the approved layout, long enough that the layout applies.
const LAID_OUT = [
  '**Now:** the hook build is in review and CI is green on the branch head.',
  '- **[09:41] Update:** built the layout checks and their tests.',
  '- **[09:52] Update:** opened the pull request and CI passed.',
  '**Waiting on you (1):**',
  '1. Merge OK for the hook: [card](#cmsg_CARD)',
  '**ELI5:** The rule checker is built and waiting for your OK.',
].join('\n');

test('wording: no em-dashes or arrows outside code, and one Question per post, replies included', () => {
  assert.match(wordingIssue('Done — next.'), /em-dash/);
  assert.match(wordingIssue('Build -> review.'), /arrow/);
  assert.match(wordingIssue('Build → review.'), /arrow/);
  assert.equal(wordingIssue('Run `a -> b` and\n```\nx — y\n```\n<!-- note -->'), '');
  assert.equal(wordingIssue('Build, then review. A short-lived branch.'), '');
  assert.equal(wordingIssue('Log:\n~~~\na -> b\n~~~'), '');
  assert.equal(wordingIssue('Log:\n```\na -> b'), '');
  // A fence counts only at the start of a line, so a lone ``` in prose hides nothing after it.
  assert.match(wordingIssue('Type ``` to start a block, then -> done.'), /arrow/);
  assert.match(wordingIssue('**Question:** a?\n**Question:** b?'), /more than one bare \*\*Question:\*\* label\. Write each question as a numbered item under \*\*Waiting on you\*\*/);
  assert.equal(wordingIssue('**Question:** merge it?'), '');
  const reply = decide({ tool_name: POST, transcript_path: 't', tool_input: { thread_id: 'cmsg_T', text: 'Yes — done.' } }, () => lines([wake()]));
  assert.match(reply, /post wording/);
  assert.match(post([wake()], 'Done — next.'), /post wording/);
});

test('layout: Now first, ELI5 last and alone, Update lines without questions, Waiting items linked', () => {
  assert.equal(layoutIssue(LAID_OUT), '');
  assert.equal(post([wake()], LAID_OUT), '');
  // Short posts are exempt; a long one without the layout is refused.
  assert.equal(layoutIssue('Got it, on it now.'), '');
  const long = 'The plan is approved and a fresh session builds the hook next, so this thread is finished and you will get a merge card from that session.';
  assert.match(layoutIssue(long), /\*\*Now:\*\*/);
  assert.match(post([wake()], long), /post layout/);
  assert.equal(layoutIssue(`Re: your reply on the hook\n${LAID_OUT}`), '');
  assert.match(layoutIssue(`${LAID_OUT}\nOne more thing.`), /ELI5/);
  assert.match(layoutIssue(`${LAID_OUT}\n**ELI5:** again.`), /exactly one/);
  assert.match(layoutIssue(LAID_OUT.replace('**ELI5:** The rule checker is built and waiting for your OK.', '')), /ELI5/);
  // Even a short post with an Update line uses the layout.
  assert.match(layoutIssue('- **[09:41] Update:** built it.'), /\*\*Now:\*\*/);
  assert.match(layoutIssue(LAID_OUT.replace('CI passed.', 'CI passed. Question: merge it? 1. merge 2. hold')), /question or numbered options/);
  assert.match(layoutIssue(LAID_OUT.replace('CI passed.', 'CI passed, merge it? 1. merge 2. hold')), /numbered options/);
  assert.match(layoutIssue(LAID_OUT.replace('[card](#cmsg_CARD)', 'the card')), /Waiting on you item .* has no link/);
  assert.equal(layoutIssue(LAID_OUT.replace('[card](#cmsg_CARD)', 'https://github.com/o/r/pull/7/files')), '');
  // A question in an Update line is refused on its own; one numbered item alone is not an option list.
  assert.match(layoutIssue(LAID_OUT.replace('CI passed.', 'CI passed. Question: merge it?')), /question or numbered options in it\. An Update line is one short status sentence; ask the question as a numbered \*\*Question:\*\* item under \*\*Waiting on you\*\* instead\./);
  assert.equal(layoutIssue(LAID_OUT.replace('CI passed.', 'G2 (round 1) passed. Phase 2. Review starts.')), '');
  for (const options of ['pick (1) merge (2) hold', 'pick 1) merge 2) hold']) {
    assert.match(layoutIssue(LAID_OUT.replace('CI passed.', options)), /numbered options/, options);
  }
  // Questions under Waiting on you: indented choice bullets need no link, the numbered items do. No spacer line is
  // needed after the last choice.
  const QUESTIONS = LAID_OUT.replace('**Waiting on you (1):**\n1. Merge OK for the hook: [card](#cmsg_CARD)', [
    '**Waiting on you (2):**',
    '1. **Question: merge the hook now?** [card](#cmsg_CARD)',
    '    - **Merge (my pick).** CI is green and the review passed.',
    '    - **Hold.** Wait for the next release.',
    '2. **Question: keep the old wording?** [thread](#cmsg_THREAD)',
    '    - **No (my pick).** The new wording replaces it.',
  ].join('\n'));
  assert.notEqual(QUESTIONS, LAID_OUT);
  assert.equal(layoutIssue(QUESTIONS), '');
  assert.equal(wordingIssue(QUESTIONS), '');
  // A spacer left after a question's last choice is neither required nor refused.
  const LEFTOVER = QUESTIONS.replace('\n2. **Question', '\n    &nbsp;\n2. **Question').replace('replaces it.', 'replaces it.\n    &nbsp;');
  assert.notEqual(LEFTOVER, QUESTIONS);
  assert.equal(layoutIssue(LEFTOVER), '');
  // An &nbsp; spacer after each Update line keeps the layout and the edit rules happy, and leaving it out is not refused.
  const SPACED = QUESTIONS.replace(/(Update:\*\* [^\n]*)/g, '$1\n&nbsp;');
  assert.notEqual(SPACED, QUESTIONS);
  assert.equal(layoutIssue(SPACED), '');
  assert.equal(editIssue(QUESTIONS.replace(/\n- \*\*\[09:52\][^\n]*/, ''), QUESTIONS), '');
  assert.equal(editIssue(SPACED.replace(/\n- \*\*\[09:52\][^\n]*\n&nbsp;/, ''), SPACED), '');
  assert.match(layoutIssue(QUESTIONS.replace(' [thread](#cmsg_THREAD)', '')), /Waiting on you item "2\. .* has no link/);
  // An unindented or two-space bullet is its own item and still needs a link.
  assert.match(layoutIssue(QUESTIONS.replace('    - **Hold.**', '- **Hold.**')), /Waiting on you item "- \*\*Hold/);
  assert.match(layoutIssue(QUESTIONS.replace('    - **Hold.**', '  - **Hold.**')), /Waiting on you item "- \*\*Hold/);
  // Tab-indented choices, a blank line before a choice and nested choices pass.
  assert.equal(layoutIssue(QUESTIONS.replace('    - **Hold.**', '\t- **Hold.**')), '');
  assert.equal(layoutIssue(QUESTIONS.replace('    - **Hold.**', '\n    - **Hold.**')), '');
  assert.equal(layoutIssue(QUESTIONS.replace('    - **Hold.**', '        - **Hold.**')), '');
  // Indented bullets need a link unless they sit under a numbered Question item in the same Waiting list.
  const choice = '    - **Hold.** Wait for the next release.';
  const plainItem = LAID_OUT.replace('[card](#cmsg_CARD)', '[card](#cmsg_CARD)\n' + choice);
  assert.match(layoutIssue(plainItem), /Waiting on you item ".*Hold/);
  const underHeader = LAID_OUT.replace('**Waiting on you (1):**', '**Waiting on you (1):**\n' + choice);
  assert.match(layoutIssue(underHeader), /Waiting on you item ".*Hold/);
  const fenced = LAID_OUT.replace('**Waiting on you (1):**\n1. Merge OK for the hook: [card](#cmsg_CARD)', '**Waiting on you (1):**\n```\n1. **Question: merge?** [card](#cmsg_CARD)\n```\n' + choice);
  assert.match(layoutIssue(fenced), /Waiting on you item ".*Hold/);
  const earlierQuestion = LAID_OUT.replace('[card](#cmsg_CARD)', '[card](#cmsg_CARD)\n' + choice)
    .replace('\n- **[09:41]', '\n1. **Question: merge?** [card](#cmsg_CARD)\n- **[09:41]');
  assert.notEqual(earlierQuestion, LAID_OUT);
  assert.match(layoutIssue(earlierQuestion), /Waiting on you item ".*Hold/);
  // Spacers in any form, and other lines that are not list items, never end the scan, so a later item with no link
  // is still caught; only an Update or ELI5 line ends the list.
  for (const spacer of ['&nbsp;', '    &nbsp;', '&#160;', '  &#160;  ', '&#xA0;', '&nbsp;&nbsp;', '&nbsp; note', '<br>', '+ plus bullet', '    indented prose']) {
    const spaced = QUESTIONS.replace('\n2. **Question', `\n${spacer}\n2. **Question`).replace(' [thread](#cmsg_THREAD)', '');
    assert.match(layoutIssue(spaced), /Waiting on you item "2\. .* has no link/, JSON.stringify(spacer));
  }
  // A choice that looks like an Update or ELI5 line is still a choice, so the scan goes on to the next item.
  for (const lookAlike of ['    - **[10:00] Update:** later.', '    - **ELI5:** later.']) {
    const shaped = QUESTIONS.replace('    - **Hold.** Wait for the next release.', lookAlike).replace(' [thread](#cmsg_THREAD)', '');
    assert.match(layoutIssue(shaped), /Waiting on you item "2\. .* has no link/, lookAlike);
  }
  // A lone CR or CRLF ends a line like LF does.
  assert.match(layoutIssue(QUESTIONS.replace(' [thread](#cmsg_THREAD)', '').replace(/\n/g, '\r')), /Waiting on you item "2\. .* has no link/);
  assert.equal(layoutIssue(QUESTIONS.replace(/\n/g, '\r\n')), '');
  assert.match(layoutIssue(LAID_OUT.replace(/\n/g, '\r').replace('CI passed.', 'CI passed. Question: merge it?')), /question or numbered options/);
  // A short post with a Waiting on you line uses the layout too.
  assert.match(layoutIssue('**Waiting on you (1):**\n1. Merge OK: [card](#cmsg_C)'), /\*\*Now:\*\*/);
  // Bulleted Now and ELI5 lines are fine, and the Waiting list stops at the ELI5 line.
  assert.equal(layoutIssue(LAID_OUT.replace('**Now:**', '- **Now:**').replace('**ELI5:**', '- **ELI5:**')), '');
  // Code after the ELI5 line still counts as text after it.
  assert.match(layoutIssue(`${LAID_OUT}\n~~~\nlog\n~~~`), /ELI5/);
  // Replies under a post keep only the wording and link rules.
  const reply = decide({ tool_name: POST, transcript_path: 't', tool_input: { thread_id: 'cmsg_T', text: long } }, () => lines([wake()]));
  assert.equal(reply, '');
});

test('edits keep every earlier Update line word for word and add a new one', () => {
  const earlier = LAID_OUT.split('\n').filter(line => !line.includes('09:52')).join('\n');
  assert.equal(editIssue(earlier, LAID_OUT), '');
  assert.match(editIssue(LAID_OUT, LAID_OUT), /no new/);
  assert.match(editIssue(LAID_OUT, LAID_OUT.replace('built the layout', 'wrote the layout')), /drops or changes .*built the layout/);
  const swapped = LAID_OUT.split('\n');
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.match(editIssue(LAID_OUT, [...swapped.slice(0, 3), '- **[10:00] Update:** new.', ...swapped.slice(3)].join('\n')), /reorders/);
  const base = LAID_OUT.split('\n');
  const withLine = (index, line) => [...base.slice(0, index), line, ...base.slice(index)].join('\n');
  assert.match(editIssue(LAID_OUT, withLine(3, base[1])), /repeats the earlier line .*built the layout/);
  assert.match(editIssue(LAID_OUT, withLine(2, '- **[10:00] Update:** new.')), /above an earlier one/);
  assert.equal(editIssue(LAID_OUT, withLine(3, '- **[10:00] Update:** new.')), '');
  // Through the hook: the edited post's text comes from the transcript; replies and unknown posts are not checked.
  const edit = (entries, text) => decide({ tool_name: EDIT, transcript_path: 't', tool_input: { message_id: 'cmsg_A1', text } }, () => lines(entries));
  assert.equal(edit([wake(), call(POST, { text: earlier })], LAID_OUT), '');
  assert.match(edit([wake(), call(POST, { text: LAID_OUT })], LAID_OUT), /post layout.*no new/);
  assert.match(edit([wake(), call(POST, { text: 'On it.' })], 'Done.'), /no new/);
  // A later edit is compared with the newest text, not the first.
  assert.match(edit([wake(), call(POST, { text: earlier }), call(EDIT, { message_id: 'cmsg_A1', text: LAID_OUT }, 'ok')], LAID_OUT), /no new/);
  assert.equal(edit([wake(), call(POST, { thread_id: 'cmsg_T', text: 'Reply.' })], 'Reply, fixed.'), '');
  assert.equal(edit([wake()], 'Fixed.'), '');
  // After the owner writes, appending an Update to the older post would put the answer above their message.
  assert.match(edit([wake(), call(POST, { text: earlier }), wake()], LAID_OUT), /post fresh: the owner wrote since this post/);
  assert.match(edit([wake(), call(POST, { text: earlier }), call(EDIT, { message_id: 'cmsg_A1', text: earlier }, 'ok'), wake()], LAID_OUT), /post fresh/);
  // Any added line is refused, whatever it holds: a plain line, a link, a Waiting item or a look-alike Update.
  for (const added of ['More news here.', '[PR 7](https://github.com/o/r/pull/7/files) is up.', '2. Another ask: [card](#cmsg_C2)', '**[10:00] update:** lower case.', '[10:00] Update: no bold.']) {
    assert.match(edit([wake(), call(POST, { text: LAID_OUT }), wake()], LAID_OUT.replace('**Waiting on you', `${added}\n**Waiting on you`)), /post fresh/, added);
  }
  // Every other edit is refused the same way: wording, a changed or dropped Update line.
  assert.match(edit([wake(), call(POST, { text: LAID_OUT }), wake()], LAID_OUT.replace('is in review', 'is under review')), /post fresh/);
  assert.match(edit([wake(), call(POST, { text: LAID_OUT }), wake()], LAID_OUT.replace('built the layout', 'wrote the layout')), /post fresh/);
  assert.match(edit([wake(), call(POST, { text: LAID_OUT }), wake()], earlier), /post fresh/);
  // The owner answers the question; dropping the answered item while appending an Update is refused too.
  const answered = LAID_OUT.replace('\n1. Merge OK for the hook: [card](#cmsg_CARD)', '').replace('\n**Waiting on you (1):**', '\n- **[10:05] Update:** you said merge, so I merged it.');
  assert.notEqual(answered, LAID_OUT);
  assert.equal(layoutIssue(answered), '');
  assert.match(edit([wake(), call(POST, { text: LAID_OUT }), wake()], answered), /post fresh: the owner wrote since this post/);
  // A wording edit after the owner wrote does not clear the mark, so a later append is still refused.
  const reworded = LAID_OUT.replace('is in review', 'is under review');
  const plusUpdate = `${reworded.replace('\n**Waiting on you', '\n- **[10:00] Update:** new.\n**Waiting on you')}`;
  assert.match(edit([wake(), call(POST, { text: LAID_OUT }), wake(), call(EDIT, { message_id: 'cmsg_A1', text: reworded }, 'ok')], plusUpdate), /post fresh/);
  // A message from another Claude is not the owner writing.
  assert.equal(edit([wake(), call(POST, { text: earlier }), wake('claude')], LAID_OUT), '');
  // An owner reply under this post sits below it, so appending is still fine; a reply under another post or a
  // message in the work thread is not.
  const threadWake = ts => ({ type: 'user', message: { role: 'user', content: `<wake reason="mention"><project id="chan_X"><thread ts="${ts}"><message from="human" trust="principal">ok</message></thread></project></wake>` } });
  assert.equal(edit([wake(), call(POST, { text: earlier }), threadWake('cmsg_A1')], LAID_OUT), '');
  // A second owner reply under the same post is still a reply under it.
  assert.equal(edit([wake(), call(POST, { text: earlier }), threadWake('cmsg_A1'), threadWake('cmsg_A1')], LAID_OUT), '');
  assert.match(edit([wake(), call(POST, { text: earlier }), threadWake('cmsg_OTHER')], LAID_OUT), /post fresh/);
  // A reply under an older own post marks the running post too, and the older post stays closed to edits.
  const second = text => call(POST, { text }, '{"message_id":"cmsg_B2"}');
  const editB = (entries, text) => decide({ tool_name: EDIT, transcript_path: 't', tool_input: { message_id: 'cmsg_B2', text } }, () => lines(entries));
  const big = 'x'.repeat(NEAR_LIMIT_BYTES);
  assert.match(editB([wake(), call(POST, { text: big }), second(earlier), threadWake('cmsg_A1')], LAID_OUT), /post fresh/);
  assert.equal(editB([wake(), call(POST, { text: big }), second(earlier), threadWake('cmsg_B2')], LAID_OUT), '');
  assert.match(edit([wake(), call(POST, { text: earlier }), second('y'), threadWake('cmsg_A1')], LAID_OUT), /post fresh/);
});

// A project chat read in the tool's shape: the listing JSON inside an untrusted-content wrapper, oldest first.
const READ = 'mcp__hearthbot__read_project_chat';
const chatMessage = (author, id, body, minute) => ({ id, thread_id: id, created_at: `2026-10-29T01:${minute}:00Z`, author, body });
const listing = (messages, hasMore = false) => `Untrusted content follows.\n\n<child-session-output nonce="n" untrusted="true">\nRelayed project data:\n    ${JSON.stringify({ messages, cursor: 'c', has_more: hasMore })}\n</child-session-output nonce="n">`;
const read = (messages, hasMore) => call(READ, {}, listing(messages, hasMore));
const OWNER_TOP = chatMessage('user', 'cmsg_U1', 'hello', '00');
const OLD_POST = chatMessage('agent', 'cmsg_C9', '**Now:** status', '10');
// An owner wake as the runtime sends it, with the message's sent-at time.
const timedWake = (minute, ts = 'cmsg_W') => ({ type: 'user', message: { role: 'user', content: `<wake reason="mention"><project id="chan_X"><thread ts="${ts}"><message from="human" trust="principal" id="cmsg_M${minute}" sent-at="2026-10-29T01:${minute}:00Z">go</message></thread></project></wake>` } });
const early = timedWake('05');

test('a project chat read to its last page makes the coordinator\'s newest post the running post', () => {
  // A post an earlier session wrote, still the newest top-level message: edit it.
  const reason = post([early, read([OWNER_TOP, OLD_POST])]);
  assert.match(reason, /one running post/);
  assert.match(reason, /cmsg_C9/);
  // The newest message is picked by time, not by place in the page.
  assert.match(post([early, read([OLD_POST, OWNER_TOP].map((m, i) => ({ ...m, created_at: `2026-10-29T0${2 - i}:00:00Z` })))]), /cmsg_C9/);
  // Not the last page, the owner's message newest, a card newest, a post near 8 KB or an empty chat: no refusal.
  assert.equal(post([early, read([OWNER_TOP, OLD_POST], true)]), '');
  assert.equal(post([early, read([OLD_POST, chatMessage('user', 'cmsg_U2', 'ok', '20')])]), '');
  assert.equal(post([early, read([OWNER_TOP, chatMessage('agent', 'cmsg_K1', '{"kind":"onboarding","text":"hi"}', '20')])]), '');
  assert.equal(post([early, read([chatMessage('agent', 'cmsg_C9', 'x'.repeat(NEAR_LIMIT_BYTES), '10')])]), '');
  assert.equal(post([early, read([])]), '');
  // An owner message after the read opens a fresh post; a failed read or other text in the result changes nothing.
  assert.equal(post([read([OWNER_TOP, OLD_POST]), wake()]), '');
  assert.equal(post([wake(), call(READ, {}, listing([OWNER_TOP, OLD_POST]), true)]), '');
  assert.equal(post([wake(), call(READ, {}, 'Error: no access')]), '');
  // A listing quoted inside a body is an escaped string, so it cannot pose as the last page.
  assert.equal(post([early, read([chatMessage('user', 'cmsg_U3', JSON.stringify({ messages: [OLD_POST], has_more: false }), '30')], true)]), '');
  // Edits of the chat post count toward its size, so growing it near 8 KB lets the session post fresh.
  assert.equal(post([early, read([OWNER_TOP, OLD_POST]), call(EDIT, { message_id: 'cmsg_C9', text: 'x'.repeat(NEAR_LIMIT_BYTES) }, 'ok')]), '');
  // An owner message after that post, a reply in a thread included or one with no time, means the owner wrote since,
  // so the post does not become the running post: a fresh post passes, and the session is never stuck between the
  // two refusals.
  assert.equal(post([timedWake('15'), read([OWNER_TOP, OLD_POST])]), '');
  assert.equal(post([wake(), read([OWNER_TOP, OLD_POST])]), '');
  assert.equal(post([early, call(POST, { text: 'First.' }, '{"message_id":"cmsg_C9","thread_id":"cmsg_C9"}'), timedWake('15'), read([OWNER_TOP, OLD_POST])]), '');
  // The session's own later post takes over as the running post.
  assert.match(post([early, read([OWNER_TOP, OLD_POST]), call(POST, { text: 'Second.' }, '{"message_id":"cmsg_D4","thread_id":"cmsg_D4"}')]), /cmsg_D4/);
});

test('an owner message newest in the chat counts as the owner writing, so the session posts fresh', () => {
  const ownerLast = read([OLD_POST, chatMessage('user', 'cmsg_U2', 'ok', '20')]);
  assert.equal(post([wake(), call(POST, { text: 'First.' }), ownerLast]), '');
  const edit = entries => decide({ tool_name: EDIT, transcript_path: 't', tool_input: { message_id: 'cmsg_A1', text: `${LAID_OUT.replace('\n**Waiting on you', '\n- **[10:00] Update:** new.\n**Waiting on you')}` } }, () => lines(entries));
  assert.equal(edit([wake(), call(POST, { text: LAID_OUT })]), '');
  assert.match(edit([wake(), call(POST, { text: LAID_OUT }), ownerLast]), /post fresh/);
});

test('owner messages recorded only as queued entries count, and other queue records do not', () => {
  const queued = (operation, content) => ({ type: 'queue-operation', operation, timestamp: 't', sessionId: 's', content });
  assert.equal(post([wake(), call(POST, { text: 'First.' }), queued('enqueue', '<wake><project id="p"><thread ts="t"><message from="human" id="cmsg_Q">more</message></thread></project></wake>')]), '');
  assert.match(post([wake(), call(POST, { text: 'First.' }), queued('dequeue', '<wake><message from="human">more</message></wake>')]), /one running post/);
  assert.match(post([wake(), call(POST, { text: 'First.' }), queued('enqueue', '<relay from="coordinator"><note><message from="human">fwd</message></note></relay>')]), /one running post/);
  assert.match(post([wake(), call(POST, { text: 'First.' }), queued('enqueue', '<wake><message from="claude">note</message></wake>')]), /one running post/);
});

test('work-thread sessions skip project chat reads, since their posts go to their thread', () => {
  const spawn = '<relay from="coordinator" session="s" current-time="t" reason="spawn">\n  <note>Gate: none</note>\n</relay>';
  assert.equal(post([{ type: 'user', isMeta: true, message: { role: 'user', content: spawn } }, early, read([OWNER_TOP, OLD_POST])]), '');
  assert.equal(post([{ type: 'queue-operation', operation: 'enqueue', content: spawn }, early, read([OWNER_TOP, OLD_POST])]), '');
  // A post that lands in a thread marks a work-thread session; a reply under a post with a thread_id does not.
  const inThread = call(POST, { text: 'First.' }, '{"message_id":"cmsg_A1","thread_id":"cmsg_T1"}');
  assert.equal(post([inThread, early, read([OWNER_TOP, OLD_POST])]), '');
  assert.match(post([inThread]), /one running post/);
  const reply = call(POST, { thread_id: 'cmsg_R', text: 'r' }, '{"message_id":"cmsg_B2","thread_id":"cmsg_R"}');
  assert.match(post([reply, early, read([OWNER_TOP, OLD_POST])]), /cmsg_C9/);
  const topLevel = call(POST, { text: 'First.' }, '{"message_id":"cmsg_A1","thread_id":"cmsg_A1"}');
  assert.match(post([topLevel, early, read([OWNER_TOP, OLD_POST])]), /cmsg_C9/);
  // The owner's newest chat message does not close a work thread's posts either.
  const ownerLast = read([OLD_POST, chatMessage('user', 'cmsg_U2', 'ok', '20')]);
  assert.match(post([inThread, ownerLast]), /one running post/);
  // A relay with another reason is not a spawn.
  assert.match(post([{ type: 'user', isMeta: true, message: { role: 'user', content: spawn.replace('spawn', 'reply') } }, early, read([OWNER_TOP, OLD_POST])]), /cmsg_C9/);
});

test('merges in a Projects session need an earlier post with the PR\'s external effects', () => {
  assert.deepEqual(mergeTarget('Bash', { command: 'gh pr merge 628 --merge' }), { number: '628' });
  assert.deepEqual(mergeTarget('PowerShell', { command: 'cd x; gh pr merge https://github.com/o/r/pull/9 --merge' }), { number: '9' });
  assert.deepEqual(mergeTarget('Bash', { command: 'gh pr merge --merge' }), { number: null });
  assert.deepEqual(mergeTarget('Bash', { command: 'gh api -X PUT repos/o/r/pulls/12/merge' }), { number: '12' });
  assert.deepEqual(mergeTarget('mcp__github__merge_pull_request', { owner: 'o', repo: 'r', pull_number: 5 }), { number: '5' });
  assert.deepEqual(mergeTarget('Bash', { command: 'gh api --method PUT repos/o/r/pulls/12/merge' }), { number: '12' });
  assert.deepEqual(mergeTarget('Bash', { command: 'x=$(gh pr merge 7)' }), { number: '7' });
  // A --body text never supplies the number.
  assert.deepEqual(mergeTarget('Bash', { command: 'gh pr merge --merge --body "closes 12"' }), { number: null });
  assert.deepEqual(mergeTarget('Bash', { command: 'gh pr merge 628 --merge --body "see 12"' }), { number: '628' });
  // Option values (text, a file or a repository) never supply the number, even as one quoted word.
  for (const command of ['gh pr merge 628 --body "https://github.com/o/r/pull/5"', 'gh pr merge --subject "5" 628', 'gh pr merge -R "o/r" 628', 'gh pr merge --repo=o/r 628']) {
    assert.deepEqual(mergeTarget('Bash', { command }), { number: '628' }, command);
  }
  // Every merge in a command is a target.
  assert.deepEqual(mergeTargets('Bash', { command: 'gh pr merge 627 && gh pr merge 628' }), [{ number: '627' }, { number: '628' }]);
  assert.equal(mergeTargets('Bash', { command: 'npm test' }), null);
  for (const command of [
    'git merge origin/main', 'git commit -m "then gh pr merge 5"', 'gh pr view 5', 'echo gh pr merge 5',
    'git commit -m "fix; gh pr merge 5"', 'grep -E "foo|gh pr merge" x', 'echo "a && gh pr merge 5"',
    "git commit -F- <<'EOF'\nsubject\ngh pr merge 5\nEOF", 'gh api repos/o/r/pulls/12/merge',
  ]) {
    assert.equal(mergeTarget('Bash', { command }), null, command);
  }
  // Quoted single tokens are unwrapped, not removed, and the heredoc operator's own line still counts.
  for (const [command, number] of [
    ['gh pr merge "628"', '628'], ["gh pr merge 'https://github.com/o/r/pull/628'", '628'],
    ['gh api -X PUT "repos/o/r/pulls/628/merge"', '628'], ['gh api -X "PUT" repos/o/r/pulls/628/merge', '628'],
    ['cat <<EOF > f; gh pr merge 628\nbody\nEOF', '628'], ['cat <<< y\ngh pr merge 628', '628'],
    ['echo $((1<<2))\ngh pr merge 628', '628'], ["echo it\\'s; gh pr merge 628; echo 'x'", '628'],
    ['git commit -m "$(cat <<\'EOF\'\nmerge 627\nEOF\n)" && gh pr merge 628', '628'],
  ]) {
    assert.deepEqual(mergeTarget('Bash', { command }), { number }, command);
  }
  // Stripping stays fast on long hostile input.
  for (const command of ['\\"'.repeat(40000), `cat <<EOF\n${'\n'.repeat(50000)}`, `"${'\\"'.repeat(40000)}`, '<<A '.repeat(20000)]) {
    const started = Date.now();
    mergeTarget('Bash', { command });
    assert.ok(Date.now() - started < 500, command.slice(0, 10));
  }
  const merge = (entries, command = 'gh pr merge 628 --merge') => decide({ tool_name: 'Bash', transcript_path: 't', tool_input: { command } }, () => lines(entries));
  assert.match(merge([wake(), call(POST, { text: 'On it.' })]), /external effects of PR 628/);
  assert.equal(merge([wake(), call(POST, { text: 'External effects of [PR 628](https://github.com/o/r/pull/628/files): a new hook.' })]), '');
  // The summary may arrive in an edit of the running post, and must name the PR being merged.
  assert.equal(merge([wake(), call(POST, { text: 'On it.' }), call(EDIT, { message_id: 'cmsg_A1', text: 'PR 628 external effects: none.' }, 'ok')]), '');
  assert.match(merge([wake(), call(POST, { text: 'External effects of PR 627: none.' })]), /PR 628/);
  assert.match(merge([wake(), call(POST, { text: 'External effects of PR 628: none.' }, 'error', true)]), /PR 628/);
  assert.equal(merge([wake(), call(POST, { text: 'External effects: a new hook.' })], 'gh pr merge --merge'), '');
  // The phrase and the PR sit on one line, outside code; a longer number, a bare #N or the phrase alone does not count.
  const summary = text => merge([wake(), call(POST, { text })]);
  assert.match(summary('- **[09:00] Update:** external effects of PR 627: none.\n**Now:** [PR 628](https://github.com/o/r/pull/628/files) waits.'), /PR 628/);
  assert.match(summary('External effects of PR 1628: none.'), /PR 628/);
  assert.match(summary('External effects of PR 6280: none.'), /PR 628/);
  assert.match(summary('External effects of https://github.com/o/r/pull/6280/files: none.'), /PR 628/);
  assert.equal(summary('External effects of https://github.com/o/r/pull/628/files: none.'), '');
  assert.match(summary('External effects of PR 627 (see #628): none.'), /PR 628/);
  assert.match(summary('PR 628 effects: none.'), /PR 628/);
  assert.match(summary('~~~\nexternal effects of PR 628\n~~~'), /PR 628/);
  assert.equal(summary('External effects of PR #628: none.'), '');
  assert.equal(summary('External effects of PRs 627 and 628: none.'), '');
  // Each merge in one command needs its own summary, and an option value never stands in for the PR.
  const both = 'gh pr merge 627 && gh pr merge 628';
  assert.match(merge([wake(), call(POST, { text: 'External effects of PR 627: none.' })], both), /external effects of PR 628/);
  assert.equal(merge([wake(), call(POST, { text: 'External effects of PRs 627 and 628: none.' })], both), '');
  for (const command of ['gh pr merge 628 --body "https://github.com/o/r/pull/5"', 'gh pr merge --subject "5" 628', 'gh pr merge --subject="5" 628', 'gh pr merge -b"https://github.com/o/r/pull/5" 628', 'gh pr merge -sb "https://github.com/o/r/pull/5" 628']) {
    assert.match(merge([wake(), call(POST, { text: 'External effects of PR 5: none.' })], command), /external effects of PR 628/, command);
  }
  // A quoted value with spaces, or an empty one, stays one option value and never hides the PR number.
  for (const command of ['gh pr merge --subject "Fix the hook" 628', 'gh pr merge --body "" 628', "gh pr merge -t 'a b' 628", 'gh pr merge"" 628', 'gh pr merge 628""']) {
    assert.deepEqual(mergeTarget('Bash', { command }), { number: '628' }, command);
    assert.match(merge([wake(), call(POST, { text: 'External effects of PR 627: none.' })], command), /external effects of PR 628/, command);
  }
  assert.match(merge([wake(), call(POST, { text: 'External effects of PR 622: none.' })], 'gh pr merge 22'), /PR 22/);
  // Outside Projects (no Projects tool in the transcript), and for other commands, nothing is checked or read.
  assert.equal(merge([wake()]), '');
  let read = false;
  const reader = () => { read = true; return lines([wake(), call(POST, { text: 'On it.' })]); };
  assert.equal(decide({ tool_name: 'Bash', transcript_path: 't', tool_input: { command: 'npm test' } }, reader), '');
  assert.equal(read, false);
});

// Every command shape the reviews raised: [command, the first PR it merges, null for a merge with no number, or false
// for no merge]. The reader follows the shell, so quotes, escapes, empty quotes and option values never hide or
// replace the PR number.
test('the merge reader reads commands the way the shell does', () => {
  const rows = [
    ['gh api -X PUT "repos/o/r/pulls/628/merge"', '628'], ['gh api -X "PUT" repos/o/r/pulls/628/merge', '628'],
    ['cat <<EOF > f; gh pr merge 628\nbody\nEOF', '628'], ["gh pr merge 'https://github.com/o/r/pull/628'", '628'],
    ['gh pr merge "628"', '628'], ["gh pr merge '#628'", '628'], ['"gh" pr merge 628', '628'],
    ['cat <<< y\ngh pr merge 628', '628'], ['echo $((1<<2))\ngh pr merge 628', '628'],
    ["echo it\\'s; gh pr merge 628", '628'], ["echo it\\'s; gh pr merge 628; echo 'x'", '628'],
    ['gh pr merge \\\n628', '628'], ['gh pr \\\nmerge 628', '628'],
    ['gh pr merge 628 --body "fixes 627"', '628'], ["gh pr merge 628 --subject 'x 627'", '628'],
    ['(gh pr merge 628)', '628'], ['x=$(gh pr merge 628)', '628'],
    ["cat <<'EOF'\ngh pr merge 627\nEOF", false], ['gh pr merge 628 --body-file - <<EOF\ngh pr merge 627\nEOF', '628'],
    ['git commit -m "$(cat <<\'EOF\'\nfix "quoted" (paren)\ngh pr merge 627\nEOF\n)" && gh pr merge 628', '628'],
    ['git commit -m "fix; gh pr merge 5"', false], ['echo "a && gh pr merge 5"', false], ['grep -E "foo|gh pr merge" x', false],
    ['gh api repos/o/r/pulls/628/merge', false], ['gh api --method=put repos/o/r/pulls/628/merge', '628'], ['gh api -XPUT repos/o/r/pulls/628/merge', '628'],
    ['gh pr merge --squash', null], ['gh pr merge --body "closes 12"', null],
    ["echo 'gh pr merge 5'", false], ['printf "%s\\n" "gh pr merge 5"', false],
    ['gh pr merge 628 --body "oops', '628'], ['echo "oops; gh pr merge 628', null], ['cat <<EOF\ngh pr merge 628', null],
    ['echo "a \'b\' c"; gh pr merge 628', '628'], ['echo \'a "b" c\'; gh pr merge 628', '628'], ['echo "a \'gh pr merge 5\' c"', false],
    ['cat <<-EOF\n\tgh pr merge 5\n\tEOF\ngh pr merge 628', '628'], ['cat <<"EOF"\ngh pr merge 5\nEOF\ngh pr merge 628', '628'],
    ['echo a\\; gh pr merge 5', false], ["echo $'a\\'b'; gh pr merge 628", '628'], ["echo $'a\\'b'; gh pr merge 628; echo 'done'", '628'],
    ['gh pr merge 627 && gh pr merge 628', '627'], ['gh pr merge --squash; gh pr merge 628', null],
    ['gh pr merge --subject "5" 628', '628'], ['gh pr merge -t "5" 628', '628'], ['gh pr merge -b "https://github.com/o/r/pull/5" 628', '628'],
    ['gh pr merge -t 5 628', '628'], ['gh pr merge --subject=5 628', '628'], ['gh pr merge 628 --body=https://github.com/o/r/pull/5', '628'],
    ['gh pr merge -R "o/r" 628', '628'], ['gh pr merge --repo o/r 628', '628'], ['gh pr merge -R=o/r 628', '628'], ['gh pr merge -A "a@example.com" 628', '628'],
    ['gh pr merge --match-head-commit abc123 628', '628'], ['gh pr merge -F - 628', '628'], ['gh pr merge --body-file=x.md 628', '628'],
    ['gh pr merge -t5 628', '628'], ['gh pr merge -d 628', '628'], ['gh pr merge --admin --auto -s -r -m 628', '628'],
    ['gh pr merge --squash --delete-branch 628', '628'], ['gh pr merge --subject="Fix the hook" 628', '628'],
    ['git commit -m "use a<<b"\ngh pr merge 628', '628'], ['echo $((x<<y))\ngh pr merge 628', '628'],
    ['cat <<\\EOF\ngh pr merge 5\nEOF', false],
    ['gh pr merge --subject="5" 628', '628'], ['gh pr merge --body "fixes a bug" 628', '628'], ['gh pr merge --body "" 628', '628'],
    ["gh pr merge --body '' 628", '628'], ['gh pr merge --body "$(cat notes.md)" 628', '628'],
    ["gh pr merge -b \"$(cat <<'EOF'\nbody \"x\" )\nEOF\n)\" 628", '628'], ["gh pr merge -t 'Fix x (#628)' 628", '628'],
    ['gh pr merge -R o/r --subject "a b" https://github.com/o/r/pull/628', '628'],
    ['gh pr merge --squash --subject "Fix x" 627 && gh pr merge 628', '627'],
    ['gh pr merge "62"8', '628'], ["gh pr merge '62'8", '628'], ['gh pr merge 6"2"8', '628'],
    ['gh" "pr merge 628', false], ["'gh'pr merge 628", false], ['gh pr merge"x" 628', false],
    ['g"h" pr merge 628', '628'], ['gh pr "merge" 628', '628'], ['gh pr me"rge" 628', '628'], ['"gh" "pr" "merge" "628"', '628'],
    ['echo "x";gh pr merge 628', '628'], ['echo "a b"&&gh pr merge 628', '628'], ['echo ""&&gh pr merge 628', '628'],
    ['gh pr merge 628;""', '628'], ['(gh pr merge 628)""', '628'],
    ['echo "x;gh pr merge 5"', false], ['echo x"&&"gh pr merge 5', false], ['"gh pr merge 5"', false], ['"gh"" pr merge 5"', false],
    ['gh pr merge "" 628', '628'], ['gh pr merge --body """" 628', '628'], ['gh pr merge --subject="" 628', '628'],
    ['gh pr merge -t"a b" 628', '628'], ['gh pr merge --subject"=5" 628', '628'], ['gh pr merge "#"628', '628'],
    ['gh pr merge -b"see https://github.com/o/r/pull/5 now" 628', '628'],
    ['gh pr merge --subject "5"628', null], ['gh \\\npr \\\nmerge \\\n628', '628'],
    ['gh pr merge"" 628', '628'], ["gh pr merge'' 628", '628'], ['gh pr merge 628""', '628'], ["gh pr merge 628''", '628'],
    ['gh pr merge ""628', '628'], ['gh pr merge "https://github.com/o/r/pull/628"""', '628'], ['gh pr merge 628"";echo', '628'],
    ['gh pr merge 627"" && gh pr merge 628', '627'], ['gh pr merge --body"" 5 628', '628'],
    ['gh pr merge -b"https://github.com/o/r/pull/5" 628', '628'], ["gh pr merge -b'https://github.com/o/r/pull/5' 628", '628'],
    ['gh pr merge 628 -b"https://github.com/o/r/pull/5"', '628'], ['gh pr merge -bhttps://github.com/o/r/pull/5 628', '628'],
    ['gh pr merge -sb "https://github.com/o/r/pull/5" 628', '628'], ['gh pr merge -dt "5" 628', '628'], ['gh pr merge -st 5 628', '628'],
    ['gh pr merge 6\\28', '628'], ['gh pr merge \\628', '628'], ['echo # gh pr merge 5', false], ['npm test', false],
  ];

  for (const [command, expected] of rows) {
    const targets = mergeTargets('Bash', { command });
    assert.equal(targets ? targets[0].number : false, expected, command);
  }
  // Every pass moves forward only: a megabyte of hostile input stays fast.
  for (const command of ['\\"'.repeat(500000), '""'.repeat(500000), `cat <<EOF\n${'\n'.repeat(1000000)}`, '<<A '.repeat(250000), `"${'$('.repeat(300000)}`]) {
    const started = Date.now();
    mergeTargets('Bash', { command });
    assert.ok(Date.now() - started < 1500, command.slice(0, 8));
  }
});

// The closure matrix: bash and PowerShell across quotes, escapes, expansions, heredocs and here-strings, redirections,
// comments, compound commands and input the reader cannot finish. [tool, command, the first PR it merges, null for a
// merge with no number (an open or unreadable command that mentions a gh merge counts here), or false for no merge].
test('the merge reader closure matrix for bash and PowerShell', () => {
  const deep = `x="${'$('.repeat(6000)}"; gh pr merge 628`;
  const rows = [
    // Bash quotes and escapes.
    ['Bash', 'gh pr merge --subject "a; b" 628', '628'], ['Bash', "gh pr merge --subject 'it''s' 628", '628'], ['Bash', 'gh pr merge 6\\28', '628'],
    // Bash expansions: a variable or command in the PR's place is a merge with no number.
    ['Bash', 'gh pr merge $PR', null], ['Bash', 'gh pr merge "$(cat n)"', null], ['Bash', 'gh pr merge `cat n`', null],
    ['Bash', 'gh api -X PUT repos/o/r/pulls/$PR/merge', null], ['Bash', 'echo "$(gh pr merge 5)"', false],
    // Bash heredocs and arithmetic.
    ['Bash', '((x<<2))\ngh pr merge 628', '628'], ['Bash', 'cat <<EOF\nbody\nEOF\ngh pr merge 628', '628'],
    // (( is arithmetic only when its inner bracket closes straight into the outer one; otherwise two subshells.
    ['Bash', '((gh pr merge 628) && echo ok)', '628'], ['Bash', '((cd r && gh pr merge 628) || echo f)', '628'], ['Bash', '((gh pr merge 628))', false],
    // Bash redirections: the stream number and target are never the PR.
    ['Bash', 'gh pr merge 2>/dev/null 628', '628'], ['Bash', 'gh pr merge 2>&1 628', '628'], ['Bash', 'gh pr merge >out.txt 628', '628'],
    ['Bash', 'gh pr merge <in 628', '628'], ['Bash', 'gh pr merge &>log 628', '628'], ['Bash', 'gh pr merge <<< y 628', '628'],
    ['Bash', 'gh pr merge 628 >/dev/null 2>&1', '628'], ['Bash', 'gh pr merge >>log 2>|err 628', '628'],
    // Bash comments.
    ['Bash', '# gh pr merge 5', false], ['Bash', 'gh pr merge 628 # merge 5', '628'],
    // Bash compound commands.
    ['Bash', 'if gh pr checks 628; then gh pr merge 628; fi', '628'], ['Bash', '{ gh pr merge 628; }', '628'],
    ['Bash', '! gh pr merge 628', '628'], ['Bash', 'time gh pr merge 628', '628'], ['Bash', 'time -p gh pr merge 628', '628'], ['Bash', 'while true; do gh pr merge 628; done', '628'],
    // Bash input the reader cannot finish fails toward checking.
    ['Bash', "echo 'oops; gh pr merge 628", null], ['Bash', 'echo `oops; gh pr merge 628', null], ['Bash', "echo $'oops; gh pr merge 628", null],
    ['Bash', 'echo $((1 + gh pr merge 628', null], ['Bash', 'x="$(gh pr merge 628"', null], ['Bash', deep, null],
    // Closed nesting too deep for the reader takes the error path and still fails toward checking.
    ['Bash', `${'echo "$('.repeat(5000)}${')"'.repeat(5000)}; gh pr merge 628`, null],
    ['Bash', "echo 'oops; npm test", false],
    // PowerShell quotes, here-strings and escapes.
    ['PowerShell', 'gh pr merge 628', '628'], ['PowerShell', "echo 'it''s'; gh pr merge 628", '628'],
    ['PowerShell', "$b = @'\nIt's done\n'@\ngh pr merge 628", '628'], ['PowerShell', '$b = @"\nsay "hi" `$x\n"@\ngh pr merge 628', '628'],
    ['PowerShell', "$b = @'\ngh pr merge 5\n'@", false], ['PowerShell', 'gh pr merge 6`28', '628'], ['PowerShell', 'gh pr merge `\n628', '628'],
    ['PowerShell', 'echo `"a`"; gh pr merge 628', '628'], ['PowerShell', 'gh pr merge --body "C:\\temp\\" 628', '628'],
    ['PowerShell', 'gh pr merge "628"', '628'], ['PowerShell', 'gh pr merge --subject "a; b" 628', '628'],
    ['PowerShell', 'gh api -X PUT repos/o/r/pulls/628/merge', '628'],
    // PowerShell comments, redirections and blocks.
    ['PowerShell', '# gh pr merge 5', false], ['PowerShell', '<# gh pr merge 5 #> gh pr merge 628', '628'],
    ['PowerShell', 'gh pr merge 628 2>&1', '628'], ['PowerShell', 'gh pr merge 2>$null 628', '628'], ['PowerShell', 'gh pr merge *> log 628', '628'],
    // PowerShell streams are 1 to 6 and *, so a longer number before > is the PR.
    ['PowerShell', 'gh pr merge 628>out', '628'],
    ['PowerShell', 'if ($ok) { gh pr merge 628 }', '628'], ['PowerShell', '& gh pr merge 628', '628'], ['PowerShell', 'echo "$(gh pr merge 5)"', false],
    // PowerShell input the reader cannot finish fails toward checking.
    ['PowerShell', "echo 'oops; gh pr merge 628", null], ['PowerShell', "$b = @'\noops gh pr merge 628", null], ['PowerShell', 'echo "oops gh pr merge 628', null],
  ];
  for (const [tool, command, expected] of rows) {
    const targets = mergeTargets(tool, { command });
    assert.equal(targets ? targets[0].number : false, expected, `${tool}: ${command.slice(0, 60)}`);
  }
  // An open read with many gh words and no merge stays linear, in both shells.
  for (const tool of ['Bash', 'PowerShell']) {
    for (const command of [`'${'gh '.repeat(330000)}`, `"${'gh x '.repeat(200000)}`, `${'(('.repeat(250000)}gh pr merge 628`]) {
      const started = Date.now();
      mergeTargets(tool, { command });
      assert.ok(Date.now() - started < 1500, `${tool}: ${command.slice(0, 8)}`);
    }
  }
});
