#!/usr/bin/env node
'use strict';

// The Toolkit command list, and the typed commands the prompt hooks recognise.
//
// A typed command is the user's whole message and nothing else: `toolkit cmd`, `toolkit command`,
// `toolkit refresh`, `toolkit setup`, `toolkit show env`, or `toolkit governance` followed by one of
// the subcommands in GOVERNANCE below. For one of those the prompt hook adds a
// short context line that tells the agent what the user asked for, so the agent never has to guess
// from loose words (an owner once typed "toolkit set env" and got the one-key prompt instead of the
// editor). Every other request stays plain language, read by the skills.
//
// Advisory only: this module never blocks a prompt, reads no file and starts no process. A phrase
// inside a longer message, or with other words around it, is ordinary text and gets no line.
//
// Usage: node repo/scripts/toolkit-commands.cjs    prints the command list

const path = require('node:path');

// Each command as the user types it, its group in the printed list, and what it does in one line.
// All are read as plain language by their skill; the phrases in ACTIONS below are also matched
// exactly by the prompt hooks. Dropping a command is dropping its one entry here.
const COMMANDS = Object.freeze([
  Object.freeze({ group: 'Setup', type: ['toolkit cmd', 'toolkit command'], does: 'Show this list.' }),
  Object.freeze({ group: 'Setup', type: ['setup toolkit', 'toolkit setup'], does: 'Set up Toolkit on this computer, or change your setup answers.' }),
  Object.freeze({ group: 'Setup', type: ['refresh toolkit', 'toolkit refresh'], does: 'Update Toolkit on this computer to the newest version.' }),
  Object.freeze({ group: 'Keys', type: ['toolkit show env'], does: 'Open your keys in your editor. Values stay on this computer and never pass through chat.' }),
  Object.freeze({ group: 'Setup', type: ['toolkit update scheduled task'], does: "Review and update Toolkit's scheduled tasks on this computer." }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance enable', 'toolkit governance disable'], does: "Turn Toolkit's GitHub governance on or off for this repository. It prepares a pull request for you to merge." }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance status'], does: "Show whether Toolkit's GitHub governance is on for this repository, and refresh this computer's copy of the merged binding." }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance check'], does: "Check this repository against Toolkit's governance rules and GitHub settings. It changes nothing." }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance discover'], does: 'List what Toolkit finds for a governance setup here (parent issue, evidence store, checks). It changes nothing.' }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance catalogue'], does: 'List the skills offered in this repository under its governance state. It changes nothing.' }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance security'], does: "Turn on GitHub's free dependency and security settings for a governed repository." }),
  Object.freeze({ group: 'Governance', type: ['toolkit governance migrate'], does: 'Get the command that offers protection and security fixes; you run it in your own terminal and answer its question there.' }),
  Object.freeze({ group: 'Setup', type: ['remove toolkit'], does: "List everything Toolkit put on this computer, then remove it after your OK." }),
  Object.freeze({ group: 'Merge', type: ['merge N'], does: 'Approve the merge of pull request N.' }),
]);

const ACTIONS = {
  'toolkit cmd': 'list',
  'toolkit command': 'list',
  'toolkit refresh': 'refresh',
  'toolkit setup': 'setup',
  'toolkit show env': 'env',
};
// `toolkit governance <subcommand>`: each runs that subcommand of toolkit-governance.cjs, never a
// different one, and `migrate` (which asks its own typed yes) goes to the user's own terminal.
// `enable` and `disable` are answers the governance gate reads, so they are not listed here.
const GOVERNANCE = Object.freeze({ status: 'run', check: 'run', discover: 'run', catalogue: 'run', security: 'run', migrate: 'terminal' });
for (const subcommand of Object.keys(GOVERNANCE)) ACTIONS[`toolkit governance ${subcommand}`] = `governance:${subcommand}`;
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
  const [action, subcommand] = ACTIONS[phrase].split(':');
  return subcommand ? { phrase, action, subcommand } : { phrase, action };
}

const CONTEXT = Object.freeze({
  list: () => `Show the user this list exactly as written, then end your turn. Run nothing.\n${listText()}`,
  setup: () => 'Treat it exactly as `setup toolkit`: follow the toolkit-setup skill.',
  refresh: () => 'Treat it exactly as `refresh toolkit`: follow the toolkit-setup skill.',
  env: () => 'Open the env editor: follow the toolkit-env skill and run its `edit` route. Never run the one-key `set` prompt for this phrase, and never print a key value in chat.',
  governance: subcommand => {
    const command = `node "${path.join(__dirname, 'toolkit-governance.cjs')}" ${subcommand}`;
    return GOVERNANCE[subcommand] === 'terminal'
      ? `It asks for its own typed yes, so do not run it: give the user this exact command to run in their own terminal in this repository, and run nothing else. \`${command}\``
      : `Run exactly \`${command}\` in this repository and show the user its output. Run no other command in its place: no other governance subcommand, and not the programme \`attention\` list.`;
  },
});

// The context line for the user's own typed message, or '' when it is not a typed command.
function phraseContext(text) {
  const command = typedCommand(text);
  return command ? `Toolkit command: the user typed \`${command.phrase}\`. ${CONTEXT[command.action](command.subcommand)}` : '';
}

module.exports = Object.freeze({ COMMANDS, GROUPS, PHRASES, listText, typedCommand, phraseContext });

if (require.main === module) process.stdout.write(`${listText()}\n`);
