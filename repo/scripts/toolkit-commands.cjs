#!/usr/bin/env node
'use strict';

// The Toolkit command list, and the five typed commands the prompt hooks recognise.
//
// A typed command is the user's whole message and nothing else: `toolkit cmd`, `toolkit command`,
// `toolkit refresh`, `toolkit setup` or `toolkit show env`. For one of those the prompt hook adds a
// short context line that tells the agent what the user asked for, so the agent never has to guess
// from loose words (an owner once typed "toolkit set env" and got the one-key prompt instead of the
// editor). Every other request stays plain language, read by the skills.
//
// Advisory only: this module never blocks a prompt, reads no file and starts no process. A phrase
// inside a longer message, or with other words around it, is ordinary text and gets no line.
//
// Usage: node repo/scripts/toolkit-commands.cjs    prints the command list

// Each command as the user types it, with what it does in one line. All are read as plain language
// by their skill; the five in ACTIONS below are also matched exactly by the prompt hooks.
const COMMANDS = Object.freeze([
  Object.freeze({ type: ['toolkit cmd', 'toolkit command'], does: 'Show this list.' }),
  Object.freeze({ type: ['setup toolkit', 'toolkit setup'], does: 'Set up Toolkit on this computer, or change your setup answers.' }),
  Object.freeze({ type: ['refresh toolkit', 'toolkit refresh'], does: 'Update Toolkit on this computer to the newest version.' }),
  Object.freeze({ type: ['toolkit show env'], does: 'Open your keys in your editor. Values stay on this computer and never pass through chat.' }),
  Object.freeze({ type: ['toolkit update scheduled task'], does: "Review and update Toolkit's scheduled tasks on this computer." }),
  Object.freeze({ type: ['toolkit governance enable', 'toolkit governance disable'], does: "Turn Toolkit's GitHub governance on or off for this repository. It prepares a pull request for you to merge." }),
  Object.freeze({ type: ['remove toolkit'], does: "List Toolkit's scheduled tasks and rules on this computer, then remove them after your OK." }),
  Object.freeze({ type: ['merge N'], does: 'Approve the merge of pull request N.' }),
]);

const ACTIONS = Object.freeze({
  'toolkit cmd': 'list',
  'toolkit command': 'list',
  'toolkit refresh': 'refresh',
  'toolkit setup': 'setup',
  'toolkit show env': 'env',
});
const PHRASES = Object.freeze(Object.keys(ACTIONS));

function listText() {
  return ['Toolkit commands (type one as your whole message):', ...COMMANDS.map(command => `- ${command.type.map(text => `\`${text}\``).join(' or ')}: ${command.does}`),
    'Anything else: ask in your own words.'].join('\n');
}

// The typed command a message is, or null. The whole message must be the phrase: letter case, outer
// spaces, repeated inner spaces and one closing full stop are ignored, and nothing else is.
function typedCommand(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const phrase = text.trim().replace(/\.$/, '').replace(/[ \t]+/g, ' ').toLowerCase();
  return Object.hasOwn(ACTIONS, phrase) ? { phrase, action: ACTIONS[phrase] } : null;
}

const CONTEXT = Object.freeze({
  list: () => `Show the user this list exactly as written, then end your turn. Run nothing.\n${listText()}`,
  setup: () => 'Treat it exactly as `setup toolkit`: follow the toolkit-setup skill.',
  refresh: () => 'Treat it exactly as `refresh toolkit`: follow the toolkit-setup skill.',
  env: () => 'Open the env editor: follow the toolkit-env skill and run its `edit` route. Never run the one-key `set` prompt for this phrase, and never print a key value in chat.',
});

// The context line for the user's own typed message, or '' when it is not a typed command.
function phraseContext(text) {
  const command = typedCommand(text);
  return command ? `Toolkit command: the user typed \`${command.phrase}\`. ${CONTEXT[command.action]()}` : '';
}

module.exports = Object.freeze({ COMMANDS, PHRASES, listText, typedCommand, phraseContext });

if (require.main === module) process.stdout.write(`${listText()}\n`);
