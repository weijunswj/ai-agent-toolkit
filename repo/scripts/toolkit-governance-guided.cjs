'use strict';

// The guided governance setup (INT-TK421-1386, with INT-TK421-1389 and 1390): `toolkit governance` in
// a repository that is not governed asks three short questions, each explained first, in the global
// rules' question shape (questions last, numbered and bold, choices lettered and nested, the
// recommended one marked). How they show (plain text, a card or the end-of-turn box) is the app's
// choice: Toolkit forces no card and no wait. The owner's reply in any form the host offers counts:
// their own typed message, or their tap on a card the app chose to show, comes back to the agent with
// a one-use ticket (toolkit-governance-bank.cjs BankTickets), and the agent sends it with that ticket.
//
//   1. Governance: yes / later / no (where it is off already: keep it off / turn it back on).
//   2. Evidence store: use the suggested private repository / another one the owner names / no store.
//   3. Task auto-merge with merge train: yes / no.
//
// Where the owner already said yes to the session-start question in this run, question 1 is left out.
// The failure this prevents: the old bank showed every part as a table with codes such as 1.2=B, asked
// the owner to edit files and run commands, and could not be answered in plain words.

const STORE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const SLUG_IN_TEXT = /[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}/;
const LETTERS = 'ABC';

class GuidedAnswerError extends Error {
  constructor(message, code = 'GUIDED_ANSWER_UNREAD') {
    super(message);
    this.name = 'GuidedAnswerError';
    this.code = code;
  }
}

// The questions for one repository. `state` is the governance state (UNDECIDED or DISABLED), `store`
// { repository, path, exists } where Toolkit knows it (null where the store comes from a programme file
// prepared in the working tree), `agreed` whether the owner already said yes in this run.
// Returns [{ key, title, question, explain, choices: [{ value, label, reason }], recommended }], numbered
// in order of display.
function guidedQuestions({ state, store = null, agreed = false }) {
  const slug = state.repository || 'this repository';
  const disabled = state.state === 'DISABLED';
  const questions = [];
  if (disabled) {
    questions.push({
      key: 'governance', title: 'GitHub governance',
      explain: 'Governance is off here: the coding rules apply, with no programme records or evidence store. Turning it back on is one pull request that applies only after you merge it.',
      question: `Turn GitHub governance back on for ${slug}?`,
      choices: [
        { value: 'keep', label: 'Keep it off', reason: 'Nothing changes.' },
        { value: 'on', label: 'Turn it back on', reason: 'Toolkit prepares one pull request that turns governance on; it applies after you merge it.' },
      ],
    });
  } else if (!agreed) {
    questions.push({
      key: 'governance', title: 'GitHub governance',
      explain: 'Toolkit keeps a task list, decisions and review evidence for this repository on GitHub, the same on every computer. It sets up a private evidence store, a parent issue, one setup pull request with Toolkit\'s checks, and branch rules where GitHub allows them. You give three quick answers, approve one merge, then run two commands in PowerShell.',
      question: `Turn on GitHub governance for ${slug}?`,
      choices: [
        { value: 'on', label: 'Yes', reason: 'Toolkit sets up the store, parent issue and checks after your other answers.' },
        { value: 'later', label: 'Later', reason: 'Nothing changes; Toolkit asks again next session.' },
        { value: 'off', label: 'No', reason: 'Toolkit prepares a pull request that records governance off.' },
      ],
    });
  }
  if (!disabled && store) {
    const where = `${store.repository}, folder \`${store.path}\``;
    questions.push({
      key: 'store', title: 'Evidence store',
      explain: `A separate private repository where Toolkit keeps programme records, plans and reviews, so they never sit in your code. Suggested: ${where}. ${store.exists ? 'It already exists.' : 'Toolkit creates it if it does not exist yet.'} Without a store governance cannot keep its records, so it stays off.`,
      question: `Keep records in ${store.repository}?`,
      choices: [
        { value: 'use', label: 'Use it', reason: store.exists ? 'Your private repository, already there.' : 'Private repository; Toolkit creates it.' },
        { value: 'another', label: 'Another repository', reason: 'Name a private repository you own as owner/name.' },
        { value: 'none', label: 'No store', reason: 'Governance stays off.' },
      ],
    });
  }
  questions.push({
    key: 'auto-merge', title: 'Task auto-merge with merge train',
    explain: 'On: a task pull request lands on its own once its review passed and every check is green, and pull requests ready at the same time ride one merge train; you get a short notice after each landing. Off: every task pull request waits for your merge approval. Setup, hooks, governance and CI changes wait for your approval either way.',
    question: 'Turn on task auto-merge with merge train?',
    choices: [
      { value: 'on', label: 'Yes', reason: 'Reviewed, green task pull requests land on their own.' },
      { value: 'off', label: 'No', reason: 'Every task pull request waits for your merge approval.' },
    ],
  });
  // The recommended choice is the first one; numbers follow the order shown.
  return questions.map((question, index) => ({ ...question, number: index + 1, recommended: question.choices[0].value }));
}

// The owner-facing text: a title, each part explained, then the questions last, then how to answer.
function renderGuided(questions, { state, agreed = false }) {
  const slug = state.repository || 'this repository';
  const example = questions.map(question => `${question.number}A`).join(' ');
  return [
    `**Toolkit governance for ${slug}**`,
    '',
    ...(agreed ? ['You said yes to GitHub governance. Two more answers, then Toolkit sets everything up.', ''] : []),
    ...questions.map(question => `- **${question.title}:** ${question.explain}`),
    '',
    ...questions.flatMap(question => [
      `**${question.number}. Question: ${question.question}**`,
      ...question.choices.map((choice, index) => `   - **${LETTERS[index]}. ${choice.label}${index === 0 ? ' (my pick)' : ''}:** ${choice.reason}`),
      '',
    ]),
    `Answer in your own words, or with the letters, such as ${example}.`,
  ].join('\n');
}

// The answer the owner gave, read from their words or letters (the agent sends it as the owner wrote it
// or in the letter form, such as "1A 2B you/records 3A"). Returns { governance, taskAutoMerge, store,
// noStore, later }:
//   governance 'on' | 'off' | 'keep'; taskAutoMerge 'on' | 'off'; store a named owner/name or null.
// A reply that cannot be read, or that answers one question two ways, throws GuidedAnswerError.
function parseGuidedAnswer(text, questions, { state }) {
  const byKey = Object.fromEntries(questions.map(question => [question.key, question]));
  const byNumber = Object.fromEntries(questions.map(question => [String(question.number), question]));
  const picks = {};
  let named = null;
  const pick = (key, value, said) => {
    if (!byKey[key]) throw new GuidedAnswerError(`"${said}" answers a question that is not asked here.`);
    if (picks[key] !== undefined && picks[key] !== value) throw new GuidedAnswerError(`The answer gives two answers to "${byKey[key].question}".`);
    picks[key] = value;
  };
  const name = (value, said) => {
    const clean = value.replace(/[.]$/, '');
    if (!STORE_NAME.test(clean)) throw new GuidedAnswerError(`"${said}" needs a repository as owner/name, such as you/TRANSPORT-project.`);
    if (named && named.toLowerCase() !== clean.toLowerCase()) throw new GuidedAnswerError('The answer names two stores.');
    named = clean;
  };
  let all = false;
  const body = String(text || '').trim().replace(/[.!]+$/, '');
  if (!body) throw new GuidedAnswerError('The answer is empty.');
  for (const raw of body.split(/[,;\n]+|\s+and\s+/i)) {
    const part = raw.trim().replace(/[.!]+$/, '');
    if (!part) continue;
    const lower = part.toLowerCase().replace(/\s+/g, ' ');
    // Letter picks, one or more in a row: 1A, 1=A, 1. A, 2B you/records.
    const letters = /^(?:\d\s*[=.:)-]?\s*[a-c]\b\s*(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\s*)?)+$/i;
    if (letters.test(part)) {
      for (const found of part.matchAll(/(\d)\s*[=.:)-]?\s*([a-c])\b\s*([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})?/gi)) {
        const question = byNumber[found[1]];
        if (!question) throw new GuidedAnswerError(`There is no question ${found[1]} here.`);
        const choice = question.choices[LETTERS.indexOf(found[2].toUpperCase())];
        if (!choice) throw new GuidedAnswerError(`Question ${found[1]} has no choice ${found[2].toUpperCase()}.`);
        pick(question.key, choice.value, `${found[1]}${found[2].toUpperCase()}`);
        if (found[3]) {
          if (question.key !== 'store' || choice.value !== 'another') throw new GuidedAnswerError(`A repository name goes only with "Another repository" for the store.`);
          name(found[3], found[0]);
        }
      }
      continue;
    }
    if (/^(?:all )?(?:recommended|my picks?|your picks?|picks)$|^all a$/.test(lower)) { all = true; continue; }
    if (/^(?:yes|y)$/.test(lower)) {
      if (byKey.governance) pick('governance', 'on', part); else all = true;
      continue;
    }
    if (/^(?:later|not now|ask (?:me )?later)$/.test(lower)) { pick('governance', 'later', part); continue; }
    if (/^(?:no|keep (?:it )?off|stay off)$/.test(lower)) { pick('governance', byKey.governance?.choices.some(choice => choice.value === 'keep') ? 'keep' : 'off', part); continue; }
    if (/^(?:turn (?:it )?(?:back )?on|turn on governance|governance on)$/.test(lower)) { pick('governance', 'on', part); continue; }
    if (/^no[ _-]?store$/.test(lower)) { pick('store', 'none', part); continue; }
    if (/^use (?:it|the (?:suggested )?store|the suggestion|that store)$/.test(lower)) { pick('store', 'use', part); continue; }
    const storeNamed = /^(?:store ?= ?|store |another (?:repository|store)?:? ?|use )(\S+)$/i.exec(part) || (SLUG_IN_TEXT.test(part) && STORE_NAME.test(part) ? [part, part] : null);
    if (storeNamed) { pick('store', 'another', part); name(storeNamed[1], part); continue; }
    const merge = /^(?:task )?auto[ -]?merge(?: with merge trains?)? ?(?:=|:)? ?(yes|on|no|off)$/.exec(lower);
    if (merge) { pick('auto-merge', ['yes', 'on'].includes(merge[1]) ? 'on' : 'off', part); continue; }
    throw new GuidedAnswerError(`This part of the answer was not read: "${part}".`);
  }
  if (picks.store === 'another' && !named) throw new GuidedAnswerError('"Another repository" needs its name as owner/name, such as 2B you/TRANSPORT-project.');
  const disabled = state.state === 'DISABLED';
  const governance = picks.governance;
  const others = ['store', 'auto-merge'].filter(key => picks[key] !== undefined);
  // Later, no and keep off stand alone: nothing else is set up, so nothing else can be answered.
  if (['later', 'off', 'keep'].includes(governance) && others.length) throw new GuidedAnswerError(`"${byKey.governance.choices.find(choice => choice.value === governance).label}" keeps governance off, so answer it on its own.`);
  if (governance === 'later') return { later: true, noStore: true };
  if (governance === 'off') return { governance: 'off', taskAutoMerge: 'off', store: null };
  if (governance === 'keep') return { governance: 'keep', taskAutoMerge: 'off', store: null };
  // Where governance is off already, only an explicit turn back on changes anything.
  if (disabled && governance !== 'on') {
    if (others.length) throw new GuidedAnswerError('Governance stays off unless the answer turns it back on, so the other answer does nothing on its own.');
    return { governance: 'keep', taskAutoMerge: 'off', store: null };
  }
  if (picks.store === 'none') {
    if (picks['auto-merge'] !== undefined || governance === 'on') throw new GuidedAnswerError('No store keeps governance off, so answer it on its own.');
    return { noStore: true };
  }
  // Any other answer, all recommended included, turns governance on; a question left out takes its
  // recommended choice.
  if (!all && governance === undefined && !others.length) throw new GuidedAnswerError('The answer was not read.');
  const autoMerge = picks['auto-merge'] !== undefined ? picks['auto-merge'] : byKey['auto-merge'].recommended;
  return { governance: 'on', taskAutoMerge: autoMerge, store: picks.store === 'another' ? named : null };
}

module.exports = Object.freeze({ GuidedAnswerError, guidedQuestions, parseGuidedAnswer, renderGuided, STORE_NAME });
