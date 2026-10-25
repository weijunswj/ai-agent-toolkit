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
const { decide, linkIssue, NEAR_LIMIT_BYTES } = require('../scripts/toolkit-claude-project-post-hook.cjs');

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
  // Only the Claude Code plugin registers it, and only on the Projects post tools; Codex hooks never name it.
  const claudeHooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const entries = claudeHooks.hooks.PreToolUse.filter(entry => entry.hooks.some(hook => /toolkit-claude-project-post-hook/.test(hook.command)));
  assert.deepEqual(entries.map(entry => entry.matcher), ['^mcp__hearthbot__(?:post_message|edit_message)$']);
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
  // A real wake nests the message under its project and thread tags.
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake reason="mention">\n  <project id="p">\n    <thread ts="t">\n      <message from="human" trust="principal">hi</message>')]), '');
  // An owner message after a Claude's message in the same wake counts.
  assert.equal(post([call(POST, { text: 'First.' }), quoted('<wake><project id="p"><thread ts="t"><message from="claude">note</message><message from="human">hi</message></thread></project></wake>')]), '');
  // A wake with an image arrives as an image block, then the wake text.
  const withImage = { type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'image', source: {} }, { type: 'text', text: '<wake><message from="human">see</message></wake>' }] } };
  assert.equal(post([call(POST, { text: 'First.' }), withImage]), '');
});
