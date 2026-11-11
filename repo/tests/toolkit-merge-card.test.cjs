'use strict';

// The merge card: a tap on Toolkit's exact AskUserQuestion card in place of a typed "merge N", for
// one pull request at one full head SHA, counted only in a session that could record a typed
// approval, from a hook event the session's own shell could not have fed, as a plain answer with
// nothing else attached. Every case uses a temporary user-state folder and temporary git repositories.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const hold = require('../scripts/toolkit-merge-hold.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const claudeHook = require('../scripts/toolkit-governance-hook.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const SHA = '62405ebd4c27859d66036e18f13c856c645d366d';
const NEXT = '7384901397e63407783c60f6656499db9edf6b12';
const closureGuard = { checkPullRequest: () => ({ status: 'allowed' }) };

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function context(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-merge-card-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const options = { registryOptions: { registryPath, testOnly: true, home: path.join(root, 'home') } };
  const repo = path.join(root, 'a');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', 'https://github.com/owner/a.git']);
  const remotes = path.join(repo, '.git', 'refs', 'remotes', 'origin');
  fs.mkdirSync(remotes, { recursive: true });
  fs.writeFileSync(path.join(remotes, 'main'), `${SHA}\n`);
  fs.writeFileSync(path.join(remotes, 'HEAD'), 'ref: refs/remotes/origin/main\n');
  require('./toolkit-governed-fixture-support.cjs').recordAbsent(repo, { home: path.join(root, 'home') });
  return { root, repo, options, file: path.join(path.dirname(registryPath), hold.APPROVALS_BASENAME) };
}

// Sessions by how they began. Each returns { id, environment }.
const SESSIONS = {
  'a chat the user started': ctx => { gate.startSession({ session_id: 'user', source: 'startup', cwd: ctx.repo }, { ...ctx.options, environment: {} }); return { id: 'user', environment: {} }; },
  'a session a launcher started': ctx => { const environment = { [gate.LAUNCHER_MARKERS[0]]: 'G1' }; gate.startSession({ session_id: 'lane', source: 'startup', cwd: ctx.repo }, { ...ctx.options, environment }); return { id: 'lane', environment }; },
  'a session another session started': ctx => { const environment = { [gate.HOST_SESSION_VARIABLE]: 'parent' }; gate.startSession({ session_id: 'child', source: 'startup', cwd: ctx.repo }, { ...ctx.options, environment }); return { id: 'child', environment }; },
  'a resumed session': ctx => { for (const source of ['startup', 'resume']) gate.startSession({ session_id: 'resumed', source, cwd: ctx.repo }, { ...ctx.options, environment: {} }); return { id: 'resumed', environment: {} }; },
  'a session with no start mark': () => ({ id: 'unmarked', environment: {} }),
  'a call with no session id': () => ({ id: null, environment: {} }),
};

const card = (repository = 'owner/a', pr = 618, sha = SHA) => hold.mergeCard(repository, pr, sha);
const clone = value => JSON.parse(JSON.stringify(value));
let calls = 0;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Shows a card and answers it, as the hook events arrive: the host hands the asked input back with
// the answers and empty annotations added, and reports the same in its response. `response` may
// differ from what was shown; `back` and `extra` change what the host hands back and reports.
function tap(ctx, session, input, label, { ask = true, response = input, toolUseId = `toolu_${calls += 1}`, answers, back, extra = {} } = {}) {
  const base = { cwd: ctx.repo, session_id: session.id, tool_name: 'AskUserQuestion', tool_use_id: toolUseId };
  const options = { ...ctx.options, environment: session.environment };
  const noted = ask ? hold.cardAsked({ ...base, tool_input: input }, options) : false;
  const question = response && Array.isArray(response.questions) && response.questions[0] ? response.questions[0].question : '';
  const given = answers === undefined ? { [question]: label } : answers;
  const handedBack = back !== undefined ? back(input, given) : plain(input) ? { ...input, answers: given, annotations: {} } : input;
  const answered = hold.cardAnswered({ ...base, ...(handedBack === null ? {} : { tool_input: handedBack }), tool_response: { questions: response && response.questions, answers: given, annotations: {}, ...extra } }, options);
  return { noted, answered, toolUseId };
}
const merge = (ctx, session, { pr = 618, sha = SHA, host = 'claude', repo = '' } = {}) => hold.decide(
  { cwd: ctx.repo, session_id: session.id, tool_name: 'Bash', tool_input: { command: `gh pr merge ${pr}${repo ? ` --repo ${repo}` : ''} --merge${sha ? ` --match-head-commit ${sha}` : ''}` } },
  { ...ctx.options, closureGuard, environment: session.environment, host });
const stored = ctx => { try { return JSON.parse(fs.readFileSync(ctx.file, 'utf8')).approvals; } catch { return []; } };

test('who may approve a merge by card: only a fresh chat the user started', async t => {
  for (const [name, start] of Object.entries(SESSIONS)) {
    await t.test(name, t => {
      const ctx = context(t);
      const session = start(ctx);
      const counts = name === 'a chat the user started';
      // The refusal offers the card only where its answer can count.
      const refusal = merge(ctx, session).deny;
      assert.match(refusal, /no unused approval/);
      assert.equal(refusal.includes('"question":"Merge owner/a#618 at 62405eb?"'), counts);
      const { noted, answered } = tap(ctx, session, card(), 'Merge');
      assert.equal(noted, counts);
      if (counts) {
        assert.match(answered.context, /recorded the user's tap on Merge as one approval for owner\/a#618 at 62405ebd4c27859d66036e18f13c856c645d366d/);
        assert.deepEqual(stored(ctx).map(({ repository, pr, sha, card: byCard }) => [repository, pr, sha, byCard]), [['owner/a', 618, SHA, true]]);
        assert.equal(merge(ctx, session), null, 'the approved merge passes');
        assert.match(merge(ctx, session).deny, /no unused approval/, 'one tap is one merge');
      } else {
        assert.match(answered.context, /no merge approval was recorded/);
        assert.deepEqual(stored(ctx), []);
        assert.match(merge(ctx, session).deny, /no unused approval/);
      }
    });
  }
});

test('a tap approves one pull request at one head; Not now approves nothing and withdraws an unused approval', t => {
  const ctx = context(t);
  const session = SESSIONS['a chat the user started'](ctx);
  // A new head after the tap: refused, with a card for the new head.
  tap(ctx, session, card(), 'Merge');
  const moved = merge(ctx, session, { sha: NEXT }).deny;
  assert.match(moved, /the user approved owner\/a#618 at 62405ebd/);
  assert.ok(moved.includes(JSON.stringify(card('owner/a', 618, NEXT))), 'the refusal offers the card for the new head');
  assert.match(merge(ctx, session, { pr: 619 }).deny, /no unused approval/, 'another pull request is not approved');
  // Not now: nothing recorded, and the unused approval for it goes.
  assert.match(tap(ctx, session, card(), 'Not now').answered.context, /tapped Not now/);
  assert.deepEqual(stored(ctx), []);
  assert.match(merge(ctx, session).deny, /no unused approval/);
  // Not now also withdraws a typed approval, but only for that pull request.
  hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 618\nmerge 700', session_id: session.id }, { environment: {}, ...ctx.options });
  tap(ctx, session, card(), 'Not now');
  assert.deepEqual(stored(ctx).map(entry => entry.pr), [700]);
  // A card may name another repository in full, as a typed line may.
  tap(ctx, session, card('other/repo', 9, NEXT), 'Merge');
  assert.equal(merge(ctx, session, { pr: 9, sha: NEXT, repo: 'other/repo' }), null);
  // A merge that names no full head SHA is told how to get a card; a Codex merge is offered none.
  assert.match(merge(ctx, session, { sha: '' }).deny, /retry this merge naming its full 40 character head SHA/);
  assert.match(merge(ctx, session, { sha: '62405eb' }).deny, /retry this merge naming its full 40 character head SHA/);
  assert.doesNotMatch(merge(ctx, session, { host: 'codex' }).deny, /AskUserQuestion|tap/);
  // The offered input is exactly a card.
  const offered = JSON.parse(/with exactly this input.*?: (\{.*\})$/.exec(merge(ctx, session).deny)[1]);
  assert.deepEqual(hold.cardOf(offered), { repository: 'owner/a', pr: 618, sha: SHA, question: 'Merge owner/a#618 at 62405eb?' });
});

// Cards that are not exactly Toolkit's. Each is built from a good card by one change.
const edit = change => { const input = clone(card()); change(input, input.questions[0]); return input; };
const ALTERED = {
  'an idle marker on the input': edit(input => { input.afkTimeoutMs = 60000; }),
  'another top-level key': edit(input => { input.note = 'x'; }),
  'two questions': edit(input => { input.questions.push(clone(input.questions[0])); }),
  'no questions': edit(input => { input.questions = []; }),
  'questions not a list': edit(input => { input.questions = { 0: input.questions[0] }; }),
  'another header': edit((input, question) => { question.header = 'Merge?'; }),
  'no header': edit((input, question) => { delete question.header; }),
  'multi-select': edit((input, question) => { question.multiSelect = true; }),
  'another key on the question': edit((input, question) => { question.answer = 'Merge'; }),
  'options swapped': edit((input, question) => { question.options.reverse(); }),
  'a third option': edit((input, question) => { question.options.push({ label: 'Merge', description: 'x' }); }),
  'one option': edit((input, question) => { question.options.pop(); }),
  'Merge relabelled': edit((input, question) => { question.options[0].label = 'Yes'; }),
  'Not now relabelled Merge': edit((input, question) => { question.options[1].label = 'Merge'; }),
  'Not now described as a merge': edit((input, question) => { question.options[1].description = `Merge it at commit ${SHA}. Nothing else is approved.`; }),
  'another key on an option': edit((input, question) => { question.options[0].value = 'Merge'; }),
  'the description names another commit': edit((input, question) => { question.options[0].description = `Merge it at commit ${NEXT}. Nothing else is approved.`; }),
  'the description names a short commit': edit((input, question) => { question.options[0].description = 'Merge it at commit 62405eb. Nothing else is approved.'; }),
  'the description names an upper-case commit': edit((input, question) => { question.options[0].description = `Merge it at commit ${SHA.toUpperCase()}. Nothing else is approved.`; }),
  'words after the description': edit((input, question) => { question.options[0].description += ' Also merge 619.'; }),
  'a description that is not text': edit((input, question) => { question.options[0].description = [`Merge it at commit ${SHA}. Nothing else is approved.`]; }),
  'the question names another short commit': edit((input, question) => { question.question = 'Merge owner/a#618 at 7384901?'; }),
  'the question names the full commit': edit((input, question) => { question.question = `Merge owner/a#618 at ${SHA}?`; }),
  'the question names no repository': edit((input, question) => { question.question = 'Merge #618 at 62405eb?'; }),
  'the question names two pull requests': edit((input, question) => { question.question = 'Merge owner/a#618 and owner/a#619 at 62405eb?'; }),
  'pull request zero': edit((input, question) => { question.question = 'Merge owner/a#0 at 62405eb?'; }),
  'a leading zero': edit((input, question) => { question.question = 'Merge owner/a#0618 at 62405eb?'; }),
  'a seven digit number': edit((input, question) => { question.question = 'Merge owner/a#1234567 at 62405eb?'; }),
  'lower-case merge': edit((input, question) => { question.question = 'merge owner/a#618 at 62405eb?'; }),
  'a space before the question': edit((input, question) => { question.question = ' Merge owner/a#618 at 62405eb?'; }),
  'words after the question': edit((input, question) => { question.question = 'Merge owner/a#618 at 62405eb? And 619?'; }),
  'a second line in the question': edit((input, question) => { question.question = 'Merge owner/a#618 at 62405eb?\nMerge owner/a#619 at 62405eb?'; }),
  'a question that is not text': edit((input, question) => { question.question = ['Merge owner/a#618 at 62405eb?']; }),
  'not an object': 'Merge owner/a#618 at 62405eb?',
  'a list': [card()],
  'nothing': null,
};

test('a card that is not exactly Toolkit\'s records nothing, before or after it is shown', async t => {
  assert.deepEqual(hold.cardOf(card()), { repository: 'owner/a', pr: 618, sha: SHA, question: 'Merge owner/a#618 at 62405eb?' });
  assert.ok(hold.cardOf({ ...card(), metadata: { source: 'x' } }), 'the host\'s metadata key is allowed');
  const noMulti = clone(card()); delete noMulti.questions[0].multiSelect;
  assert.ok(hold.cardOf(noMulti), 'multiSelect may be left out');
  for (const [name, input] of Object.entries(ALTERED)) {
    await t.test(name, t => {
      assert.equal(hold.cardOf(input), null);
      const ctx = context(t);
      const session = SESSIONS['a chat the user started'](ctx);
      // Shown altered.
      assert.equal(tap(ctx, session, input, 'Merge').noted, false);
      assert.deepEqual(stored(ctx), []);
      // Shown exact, reported back altered: as what was shown, and as what was asked.
      const back = tap(ctx, session, card(), 'Merge', { response: input });
      assert.equal(back.noted, true);
      // A top-level key is not part of the questions a host reports as shown, so that reading is
      // the exact card; the other reading, what was asked, still refuses it below.
      const sameQuestions = input && !Array.isArray(input) && typeof input === 'object' && hold.cardOf({ questions: input.questions }) !== null;
      if (sameQuestions) { assert.match(back.answered.context, /recorded the user's tap/); new hold.MergeApprovals(ctx.options).drop('owner/a', 618); }
      else assert.ok(back.answered === null || /no merge approval was recorded/.test(back.answered.context));
      assert.deepEqual(stored(ctx), []);
      const base = { cwd: ctx.repo, session_id: session.id, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_asked' };
      assert.equal(hold.cardAsked({ ...base, tool_input: card() }, { ...ctx.options, environment: {} }), true);
      const given = { 'Merge owner/a#618 at 62405eb?': 'Merge' };
      const reported = hold.cardAnswered({ ...base, tool_input: plain(input) ? { ...input, answers: given, annotations: {} } : input, tool_response: { questions: card().questions, answers: given, annotations: {} } }, { ...ctx.options, environment: {} });
      assert.match(reported.context, /no merge approval was recorded/, 'asked altered, shown exact');
      assert.deepEqual(stored(ctx), []);
      assert.match(merge(ctx, session).deny, /no unused approval/);
    });
  }
});

test('what the host hands back after a tap: the card plus its answer counts, anything more does not', async t => {
  const question = 'Merge owner/a#618 at 62405eb?';
  const choice = () => edit((input, first) => { first.kind = 'choice'; });
  const counted = {
    'the input handed back with answers and empty annotations': {},
    'the input handed back as it was asked': { back: input => input },
    'no input handed back': { back: () => null },
    'answers but no annotations on the input': { back: (input, answers) => ({ ...input, answers }) },
    'the host adds its choice kind to the question it shows': { response: choice(), back: (input, answers) => ({ ...choice(), answers, annotations: {} }) },
  };
  for (const [name, options] of Object.entries(counted)) {
    await t.test(name, t => {
      const ctx = context(t);
      const session = SESSIONS['a chat the user started'](ctx);
      const result = tap(ctx, session, card(), 'Merge', options);
      assert.equal(result.noted, true);
      assert.match(result.answered.context, /recorded the user's tap on Merge/);
      assert.equal(merge(ctx, session), null);
    });
  }
  const note = { [question]: { notes: 'only after the Windows smoke passes' } };
  const uncounted = {
    'the host marks an idle auto-resolve': { extra: { afkTimeoutMs: 60000 } },
    'an idle marker of zero': { extra: { afkTimeoutMs: 0 } },
    'an idle marker on the input handed back': { back: (input, answers) => ({ ...input, answers, annotations: {}, afkTimeoutMs: 60000 }) },
    'the host marks a follow-up': { extra: { followUp: true } },
    'a follow-up marked false': { extra: { followUp: false } },
    'typed text beside the answer': { extra: { response: 'wait, not yet' } },
    'empty typed text': { extra: { response: '' } },
    'a note on the answer': { extra: { annotations: note } },
    'a note on the input handed back': { back: (input, answers) => ({ ...input, answers, annotations: note }) },
    'an empty annotation for the question': { extra: { annotations: { [question]: {} } } },
    'annotations that are not an object': { extra: { annotations: [] } },
    'a field the reader does not know': { extra: { source: 'dialog' } },
    'a field the reader does not know on the input': { back: (input, answers) => ({ ...input, answers, annotations: {}, source: 'dialog' }) },
    'a second answer': { answers: { [question]: 'Merge', 'Merge owner/a#619 at 62405eb?': 'Merge' } },
    'the input handed back answers Not now': { back: input => ({ ...input, answers: { [question]: 'Not now' }, annotations: {} }) },
    'the input handed back answers another question': { back: input => ({ ...input, answers: { 'Merge owner/a#619 at 62405eb?': 'Merge' }, annotations: {} }) },
    'the input handed back holds empty answers': { back: input => ({ ...input, answers: {}, annotations: {} }) },
    'another kind on the question shown': { response: edit((input, first) => { first.kind = 'text'; }) },
    'another kind on the question handed back': { back: (input, answers) => ({ ...edit((changed, first) => { first.kind = 'text'; }), answers, annotations: {} }) },
  };
  for (const [name, options] of Object.entries(uncounted)) {
    await t.test(name, t => {
      const ctx = context(t);
      const session = SESSIONS['a chat the user started'](ctx);
      const result = tap(ctx, session, card(), 'Merge', options);
      assert.equal(result.noted, true);
      assert.match(result.answered.context, /no merge approval was recorded/);
      assert.deepEqual(stored(ctx), []);
      assert.match(merge(ctx, session).deny, /no unused approval/);
    });
  }
  await t.test('a card asked with its answer already filled in is never noted', t => {
    const ctx = context(t);
    const session = SESSIONS['a chat the user started'](ctx);
    const filled = { ...card(), answers: { [question]: 'Merge' } };
    assert.equal(hold.cardOf(filled), null);
    assert.ok(hold.cardOf(filled, true), 'the same shape is what a host hands back after a real tap');
    const result = tap(ctx, session, filled, 'Merge', { response: card() });
    assert.equal(result.noted, false);
    assert.match(result.answered.context, /no merge approval was recorded/);
    assert.deepEqual(stored(ctx), []);
  });
  await t.test('Not now withdraws whatever else the answer carries', t => {
    const ctx = context(t);
    const session = SESSIONS['a chat the user started'](ctx);
    for (const extra of [{ afkTimeoutMs: 60000 }, { response: 'later' }, { annotations: note }, { followUp: true }]) {
      hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 618', session_id: session.id }, { environment: {}, ...ctx.options });
      assert.equal(stored(ctx).length, 1);
      assert.match(tap(ctx, session, card(), 'Not now', { extra }).answered.context, /tapped Not now/);
      assert.deepEqual(stored(ctx), []);
    }
  });
});

test('nothing a session\'s own shell can run is read as a card shown or answered', async t => {
  // The host's own hook process has no host-session variable; a command run from the session's
  // shell carries it. Any presence of it, whatever the value, makes the event a feed.
  for (const [name, value] of [['matching the session', 'user'], ['empty', ''], ['another session', 'parent']]) {
    await t.test(`a card event whose environment holds the variable, ${name}`, t => {
      const ctx = context(t);
      const session = SESSIONS['a chat the user started'](ctx);
      const fed = { id: session.id, environment: { [gate.HOST_SESSION_VARIABLE]: value } };
      // Fed card and fed answer.
      const both = tap(ctx, fed, card(), 'Merge');
      assert.equal(both.noted, false);
      assert.match(both.answered.context, /no merge approval was recorded/);
      // A card the host really showed, with a fed answer.
      const base = { cwd: ctx.repo, session_id: session.id, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_real' };
      assert.equal(hold.cardAsked({ ...base, tool_input: card() }, { ...ctx.options, environment: {} }), true);
      assert.match(tap(ctx, fed, card(), 'Merge', { ask: false, toolUseId: 'toolu_real' }).answered.context, /no merge approval was recorded/);
      // A fed Not now cannot withdraw the user's typed approval.
      hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 618', session_id: session.id }, { environment: {}, ...ctx.options });
      assert.match(tap(ctx, fed, card(), 'Not now').answered.context, /no merge approval was recorded/);
      assert.equal(stored(ctx).length, 1);
      assert.equal(merge(ctx, session), null, 'the typed approval still stands');
      assert.deepEqual(stored(ctx), []);
    });
  }
  await t.test('the direct feed commands are refused, and ordinary commands near them are not', t => {
    const ctx = context(t);
    const session = SESSIONS['a chat the user started'](ctx);
    const run = command => hold.decide({ cwd: ctx.repo, session_id: session.id, tool_name: 'Bash', tool_input: { command } }, { ...ctx.options, closureGuard, environment: {}, host: 'claude' });
    const hook = '~/.claude/plugins/cache/ai-agent-toolkit/ai-agent-toolkit/3.63.0/repo/scripts/toolkit-governance-hook.cjs';
    const event = JSON.stringify({ session_id: session.id, cwd: ctx.repo, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_fed', tool_input: card() });
    for (const command of [
      `printf '%s' '${event}' | node ${hook} --event PreToolUse`,
      `printf '%s' '${event}' | node ${hook} --event PostToolUse`,
      `node ${hook} --event=PostToolUse < answer.json`,
      `cat answer.json | node repo/scripts/toolkit-governance-hook.cjs --event PostToolUse`,
      'node -e "const hold = load(\'./repo/scripts/toolkit-merge-hold.cjs\'); hold.cardAnswered(event)"',
      'node -p "load(\'./repo/scripts/toolkit-merge-hold.cjs\').cardAsked(event)"',
      `bun ${hook} --event PostToolUse < answer.json`,
    ]) assert.match(run(command).deny, /feed them a prompt, tool or session-start event are refused/, command);
    // An emptied environment hides the session variable, so naming a hook script with one is refused.
    for (const command of [
      `env -i PATH="$PATH" node ${hook} --event "$(cat a.txt)" < a.json`,
      `env --ignore-environment node ${hook} --event "$(cat b.txt)" < b.json`,
      `env - PATH=/usr/bin node repo/scripts/toolkit-governance-hook.cjs --event "$(cat b.txt)" < b.json`,
      'FOO=1 env -i node repo/scripts/toolkit-merge-hold.cjs check',
    ]) assert.match(run(command).deny, /names Toolkit's hook scripts and starts with an empty environment is refused/, command);
    for (const command of [
      'node --test repo/tests/toolkit-governance-hook.test.cjs',
      'node --test repo/tests/toolkit-merge-card.test.cjs repo/tests/toolkit-merge-hold.test.cjs',
      'node repo/scripts/toolkit-merge-hold.cjs check',
      'grep -n cardOffer repo/scripts/toolkit-merge-hold.cjs',
      'git log --oneline -- repo/scripts/toolkit-governance-hook.cjs',
      'grep -rn PostToolUse hooks/',
      // Searches, diffs, commit messages and test runs that name a hook script and an event.
      'grep -n PreToolUse repo/scripts/toolkit-governance-hook.cjs',
      'grep -n cardAnswered repo/scripts/toolkit-merge-hold.cjs',
      'rg -n "PostToolUse" repo/scripts/toolkit-governance-hook.cjs',
      "sed -n '/PostToolUse/,+12p' repo/scripts/toolkit-governance-hook.cjs",
      'git log -S cardAsked --oneline -- repo/scripts/toolkit-merge-hold.cjs',
      'git diff origin/main -- repo/scripts/toolkit-governance-hook.cjs | grep -n PostToolUse',
      'git commit -m "Note the merge card at PreToolUse in toolkit-merge-hold"',
      'node --test repo/tests/toolkit-governance-hook.test.cjs --test-name-pattern PreToolUse',
      'Select-String -Path repo/scripts/toolkit-governance-hook.cjs -Pattern PreToolUse',
      'env -i PATH="$PATH" node --version',
    ]) assert.doesNotMatch(String((run(command) || {}).deny), /feed them|must come from the user/, command);
  });
});

test('an answer counts once, from the noted call, as one of the two labels', t => {
  const ctx = context(t);
  const session = SESSIONS['a chat the user started'](ctx);
  const question = 'Merge owner/a#618 at 62405eb?';
  const uncounted = [
    ['no card was shown first', { ask: false }, 'Merge'],
    ['typed into Other', {}, 'Merge it'],
    ['a label in another case', {}, 'merge'],
    ['a label with a space', {}, 'Merge '],
    ['an answer that is not text', {}, ['Merge']],
    ['no answers', { answers: {} }, 'Merge'],
    ['answers as a list', { answers: [question, 'Merge'] }, 'Merge'],
    ['an answer to another question', { answers: { 'Merge owner/a#619 at 62405eb?': 'Merge' } }, 'Merge'],
    ['an inherited answer', { answers: Object.create({ [question]: 'Merge' }) }, 'Merge'],
  ];
  for (const [name, options, label] of uncounted) {
    assert.match(tap(ctx, session, card(), label, options).answered.context, /no merge approval was recorded/, name);
    assert.deepEqual(stored(ctx), [], name);
  }
  // The answer to one call replayed, and the note of one card used for another.
  const first = tap(ctx, session, card(), 'Merge');
  assert.equal(stored(ctx).length, 1);
  assert.match(tap(ctx, session, card(), 'Merge', { ask: false, toolUseId: first.toolUseId }).answered.context, /no merge approval was recorded/, 'a replayed answer');
  assert.equal(stored(ctx).length, 1);
  assert.equal(hold.cardAsked({ cwd: ctx.repo, session_id: session.id, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_swap', tool_input: card('owner/a', 619) }, { ...ctx.options, environment: {} }), true);
  assert.match(tap(ctx, session, card(), 'Merge', { ask: false, toolUseId: 'toolu_swap' }).answered.context, /no merge approval was recorded/, 'a note for another pull request');
  // A note from one session answered in another, and a session restarted between card and tap.
  const other = { id: 'second', environment: {} };
  gate.startSession({ session_id: 'second', source: 'startup', cwd: ctx.repo }, { ...ctx.options, environment: {} });
  hold.cardAsked({ cwd: ctx.repo, session_id: session.id, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_cross', tool_input: card('owner/a', 620) }, { ...ctx.options, environment: {} });
  assert.match(tap(ctx, other, card('owner/a', 620), 'Merge', { ask: false, toolUseId: 'toolu_cross' }).answered.context, /no merge approval was recorded/, 'another session\'s note');
  hold.cardAsked({ cwd: ctx.repo, session_id: session.id, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_resume', tool_input: card('owner/a', 621) }, { ...ctx.options, environment: {} });
  gate.startSession({ session_id: session.id, source: 'resume', cwd: ctx.repo }, { ...ctx.options, environment: {} });
  assert.match(tap(ctx, session, card('owner/a', 621), 'Merge', { ask: false, toolUseId: 'toolu_resume' }).answered.context, /no merge approval was recorded/, 'a resume between card and tap');
  assert.deepEqual(stored(ctx).map(entry => entry.pr), [618]);
  // Other tools and other questions are none of the card's business.
  assert.equal(hold.cardAnswered({ tool_name: 'Bash', tool_response: { questions: card().questions } }, ctx.options), null);
  assert.equal(hold.cardAnswered({ tool_name: 'AskUserQuestion', tool_response: { questions: [{ question: 'Which colour?' }], answers: {} } }, ctx.options), null);
  assert.equal(hold.cardAnswered({ tool_name: 'AskUserQuestion' }, ctx.options), null);
  assert.equal(hold.cardAsked({ tool_name: 'Bash', tool_input: card() }, ctx.options), false);
});

test('the card reader refuses the shared hostile-input set', () => {
  const accepts = input => hold.cardOf(input) !== null;
  const question = 'Merge owner/a#618 at 62405eb?';
  const description = `Merge it at commit ${SHA}. Nothing else is approved.`;
  const withQuestion = text => edit((input, first) => { first.question = text; });
  const withDescription = text => edit((input, first) => { first.options[0].description = text; });
  // The question and the description rewritten with every line-break shape, a byte order mark and
  // tabs. Neither has a line break or an indent, so the break and tab rewrites leave them as they
  // are: those are the named exceptions. A byte order mark is refused.
  for (const [build, text] of [[withQuestion, question], [withDescription, description]]) {
    hostile.expectDefaultDeny(assert, shape => accepts(build(shape)), hostile.variants(text), { allow: ['crlf', 'cr', 'nel', 'ls', 'ps', 'tabs'] });
  }
  // Every shape in the set glued before, after and inside each text: never a card.
  assert.ok(hostile.shapes.length > 100);
  const glued = hostile.shapes.flatMap(shape => [
    { id: `question-before:${shape.id}`, text: withQuestion(`${shape.text}${question}`) },
    { id: `question-after:${shape.id}`, text: withQuestion(`${question}${shape.text}`) },
    { id: `question-inside:${shape.id}`, text: withQuestion(`Merge owner/a#618${shape.text} at 62405eb?`) },
    { id: `repository:${shape.id}`, text: withQuestion(`Merge owner/${shape.text}#618 at 62405eb?`) },
    { id: `description-before:${shape.id}`, text: withDescription(`${shape.text}${description}`) },
    { id: `description-after:${shape.id}`, text: withDescription(`${description}${shape.text}`) },
    { id: `label:${shape.id}`, text: edit((input, first) => { first.options[0].label = `Merge${shape.text}`; }) },
  ]);
  // The exceptions are three shapes that are ordinary repository names (1.10, True, CI).
  hostile.expectDefaultDeny(assert, shape => accepts(shape), glued, { allow: ['repository:name-yaml-number', 'repository:name-yaml-boolean', 'repository:name-letter-case'] });
  // Large inputs stay linear.
  for (const [name, build] of Object.entries({
    'a long question': size => withQuestion(`Merge owner/${'a'.repeat(size)}#618 at 62405eb?`),
    'a long description': size => withDescription(`Merge it at commit ${'a'.repeat(size)}`),
    'many questions': size => ({ questions: Array.from({ length: Math.ceil(size / 64) }, () => card().questions[0]) }),
  })) {
    const timed = hostile.timing(input => hold.cardOf(input), build, { startSize: 4096, maxSize: 262144, minMs: 5 });
    assert.ok(timed.ok, `${name}: ${timed.message}`);
  }
});

test('through the Claude Code hook: the card is noted, the tap recorded, and a cloud session records nothing', t => {
  const ctx = context(t);
  const options = { ...ctx.options, environment: {}, closureGuard };
  // A plain folder outside any repository, so no governance question is waiting; the merge names
  // its repository in full.
  const folder = path.join(ctx.root, 'plain');
  fs.mkdirSync(folder);
  ctx.repo = folder;
  claudeHook.respond('SessionStart', { session_id: 'user', source: 'startup', cwd: ctx.repo }, options);
  const command = { cwd: ctx.repo, session_id: 'user', tool_name: 'Bash', tool_input: { command: `gh pr merge 618 --repo owner/a --merge --match-head-commit ${SHA}` } };
  const refusal = claudeHook.respond('PreToolUse', command, options).hookSpecificOutput;
  assert.equal(refusal.permissionDecision, 'deny');
  const offered = JSON.parse(/with exactly this input.*?: (\{.*\})$/.exec(refusal.permissionDecisionReason)[1]);
  const ask = { cwd: ctx.repo, session_id: 'user', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_hook', tool_input: offered };
  assert.deepEqual(claudeHook.respond('PreToolUse', ask, options), {}, 'the card itself is never refused');
  const answer = { ...ask, tool_response: { questions: offered.questions, answers: { [offered.questions[0].question]: 'Merge' } } };
  assert.match(claudeHook.respond('PostToolUse', answer, options).hookSpecificOutput.additionalContext, /recorded the user's tap on Merge/);
  assert.deepEqual(claudeHook.respond('PreToolUse', command, options), {}, 'the merge now passes');
  assert.equal(claudeHook.respond('PreToolUse', command, options).hookSpecificOutput.permissionDecision, 'deny', 'once');
  // An ordinary question passes untouched and says nothing.
  const plain = { cwd: ctx.repo, session_id: 'user', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_plain', tool_input: { questions: [{ question: 'Merge the two lists or keep them apart?', header: 'Lists', options: [{ label: 'Merge', description: 'One list.' }, { label: 'Keep apart', description: 'Two lists.' }] }] } };
  assert.deepEqual(claudeHook.respond('PreToolUse', plain, options), {});
  assert.deepEqual(claudeHook.respond('PostToolUse', { ...plain, tool_response: { questions: plain.tool_input.questions, answers: { 'Merge the two lists or keep them apart?': 'Merge' } } }, options), {});
  // A cloud session: the hook is advisory there, so a card records nothing.
  const cloud = { ...options, environment: { CLAUDE_CODE_REMOTE: 'true' } };
  assert.deepEqual(claudeHook.respond('PreToolUse', { ...ask, tool_use_id: 'toolu_cloud' }, cloud), {});
  assert.deepEqual(claudeHook.respond('PostToolUse', { ...answer, tool_use_id: 'toolu_cloud' }, cloud), {});
  assert.deepEqual(stored(ctx), []);
});
