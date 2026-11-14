#!/usr/bin/env node
'use strict';

// The Toolkit command list, and the typed commands the prompt hooks recognise.
//
// A typed command is the user's whole message and nothing else: one of the phrases in ACTIONS below.
// For a typed command the prompt hook adds a short context line that tells the agent what the user
// asked for, so the agent never has to guess from loose words (an owner once typed "toolkit set env"
// and got the one-key prompt instead of the editor). Every other request stays plain language, read
// by the skills. Every typed command is on the printed list, or opens the same action as one that is.
//
// Advisory only: this module never blocks a prompt, reads no file and starts no process. A phrase
// inside a longer message, or with other words around it, is ordinary text and gets no line.
//
// Usage: node repo/scripts/toolkit-commands.cjs    prints the command list

const path = require('node:path');

// Each command the printed list shows, as the user types it, its group and what it does in one
// line. The list holds only commands a user would type themselves; the phrases in ACTIONS below are
// matched exactly by the prompt hooks whether listed or not, so a command left off the list still
// works when typed. Dropping a command from the list is dropping its one entry here.
const COMMANDS = Object.freeze([
  Object.freeze({ group: 'Setup', type: ['toolkit cmd', 'toolkit command'], does: 'Show this list.' }),
  Object.freeze({ group: 'Setup', type: ['setup toolkit', 'toolkit setup'], does: 'Set up Toolkit on this computer, or change your setup answers.' }),
  Object.freeze({ group: 'Setup', type: ['refresh toolkit', 'toolkit refresh'], does: 'Update Toolkit on this computer to the newest version.' }),
  Object.freeze({ group: 'Setup', type: ['remove toolkit'], does: "Choose this app or every app, list what Toolkit put there, then remove it after your OK." }),
  Object.freeze({ group: 'Keys', type: ['toolkit env', 'toolkit show env'], does: 'Open your keys in your editor. Values stay on this computer and never pass through chat.' }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance', 'governance setup'], does: "Show this repository's governance choices, answered like setup toolkit: governance on or off, task auto-merge and permission blocks. Each change is one pull request for you to merge." }),
  Object.freeze({ group: 'Merge', type: ['merge N'], does: 'Approve the merge of pull request N.' }),
]);

const ACTIONS = {
  'toolkit cmd': 'list',
  'toolkit command': 'list',
  'toolkit refresh': 'refresh',
  'toolkit setup': 'setup',
  'toolkit env': 'env',
  'toolkit show env': 'env',
};
// The governance question bank: the one governance entry. `setup governance` and `refresh governance`,
// which Toolkit's own messages tell the user to say, open the same bank. `toolkit governance enable` and `disable`
// are answers the governance gate reads, so they are not here; the governance tools (status, check
// and the rest) are run by agents, setup and CI, not typed.
for (const phrase of ['toolkit governance', 'governance setup', 'setup governance', 'toolkit setup governance', 'refresh governance', 'toolkit refresh governance']) ACTIONS[phrase] = 'guide';
Object.freeze(ACTIONS);
const PHRASES = Object.freeze(Object.keys(ACTIONS));

// The order the groups print in; a group with no commands is left out.
const GROUPS = Object.freeze(['Setup', 'Keys', 'Governance', 'Merge']);

// The command list as one small two-column Markdown table per group.
function listText() {
  const lines = ['Toolkit commands (type one as your whole message):'];
  for (const group of GROUPS) {
    const rows = COMMANDS.filter(command => command.group === group);
    if (!rows.length) continue;
    lines.push('', `**${group}**`, '', '| Type this | What it does |', '| --- | --- |',
      ...rows.map(command => `| ${command.type.map(text => `\`${text}\``).join(' or ')} | ${command.does} |`));
  }
  return [...lines, '', 'Anything else: ask in your own words.'].join('\n');
}

// The typed command a message is, or null. The whole message must be the phrase: letter case, outer
// spaces, repeated inner spaces and one closing full stop are ignored, and nothing else is.
function typedCommand(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const phrase = text.trim().replace(/\.$/, '').replace(/[ \t]+/g, ' ').toLowerCase();
  if (!Object.hasOwn(ACTIONS, phrase)) return null;
  return { phrase, action: ACTIONS[phrase] };
}

const CONTEXT = Object.freeze({
  list: () => `Show the user this list exactly as written, then end your turn. Run nothing.\n${listText()}`,
  setup: () => 'Treat it exactly as `setup toolkit`: follow the toolkit-setup skill.',
  refresh: () => 'Treat it exactly as `refresh toolkit`: follow the toolkit-setup skill.',
  env: () => 'Open the env editor: follow the toolkit-env skill and run its `edit` route. Never run the one-key `set` prompt for this phrase, and never print a key value in chat.',
  guide: () => {
    const command = subcommand => `node "${path.join(__dirname, 'toolkit-governance.cjs')}" ${subcommand}`;
    return `Show the user Toolkit's governance question bank for this repository. Run exactly \`${command('setup')}\` in this repository and show the user its output once, in full and as printed, every table, any permission table and every permission block included, and the reply line; never summarise it, shorten it or repeat it, then stop. Run no other governance subcommand first. `
      + 'The bank works like setup toolkit\'s: the user replies `all recommended` or only their changes, such as `1.2=B`. Their next own message comes back to you with a one-use ticket and the exact command to send their answer with; every change to governance or task auto-merge is one pull request for the user to merge. '
      + 'Never answer the bank for the user.';
  },
});

// The context line for the user's own typed message, or '' when it is not a typed command.
function phraseContext(text) {
  const command = typedCommand(text);
  return command ? `Toolkit command: the user typed \`${command.phrase}\`. ${CONTEXT[command.action]()}` : '';
}

module.exports = Object.freeze({ COMMANDS, GROUPS, PHRASES, listText, typedCommand, phraseContext });

if (require.main === module) process.stdout.write(`${listText()}\n`);
