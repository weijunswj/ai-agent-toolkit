'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const commands = require('../scripts/toolkit-commands.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const claudeHook = require('../scripts/toolkit-governance-hook.cjs');

const SCRIPT = require.resolve('../scripts/toolkit-commands.cjs');

test('exactly these typed commands are recognised', () => {
  assert.deepEqual([...commands.PHRASES].sort(), ['governance setup', 'refresh governance', 'setup governance', 'toolkit cmd', 'toolkit command', 'toolkit env', 'toolkit governance',
    'toolkit refresh', 'toolkit refresh governance', 'toolkit setup', 'toolkit setup governance', 'toolkit show env']);
});

test('the governance tools are no longer typed commands: agents, setup and CI run them', () => {
  for (const subcommand of ['status', 'check', 'discover', 'security', 'migrate']) {
    assert.equal(commands.typedCommand(`toolkit governance ${subcommand}`), null, subcommand);
    assert.equal(commands.phraseContext(`toolkit governance ${subcommand}`), '', subcommand);
  }
});

test('setup governance and refresh governance, which Toolkit tells the user to say, open the governance guide', () => {
  for (const phrase of ['setup governance', 'toolkit setup governance', 'refresh governance', 'toolkit refresh governance']) {
    assert.deepEqual(commands.typedCommand(` ${phrase.toUpperCase()}. `), { phrase, action: 'guide' });
    assert.equal(commands.phraseContext(phrase).replace(`\`${phrase}\``, ''), commands.phraseContext('toolkit governance').replace('`toolkit governance`', ''), phrase);
  }
  assert.equal(commands.typedCommand('toolkit setup').action, 'setup', 'plain toolkit setup is still machine setup');
  assert.equal(commands.typedCommand('please refresh governance'), null);
});

test('the governance guide runs setup, then offers the next step without answering for the user', () => {
  const script = path.join(__dirname, '..', 'scripts', 'toolkit-governance.cjs');
  for (const phrase of ['toolkit governance', 'governance setup']) {
    assert.deepEqual(commands.typedCommand(` ${phrase.toUpperCase()}. `), { phrase, action: 'guide' });
    const context = commands.phraseContext(phrase);
    assert.ok(/'setup'/.test(fs.readFileSync(script, 'utf8').match(/const COMMANDS = Object\.freeze\(\[[^\]]*\]\)/)[0]));
    assert.ok(context.includes(`Run exactly \`node "${script}" setup\``), phrase);
    assert.match(context, /works like setup toolkit's: the user replies `all recommended` or only their changes, such as `1\.2=B`/);
    assert.match(context, /one-use ticket/);
    // The bank's Agents line is for the agent alone; every app shows the owner the typed bank. A guide
    // that said "show its output in full" put the Agents line on the owner's screen.
    assert.match(context, /do what its paragraph that starts with `Agents` says\. That paragraph is for you alone: never show the user any of it\./);
    assert.match(context, /Show them the rest of the output once, as printed, as plain text and never in a code block/);
    assert.doesNotMatch(context, /question card|card input/, 'the bank is never put on a card');
    assert.doesNotMatch(context, /in full and as printed|every permission block/, 'never asks for the whole output, Agents paragraph included');
    assert.doesNotMatch(context, /--set|own terminal|toolkit governance enable/, 'no terminal hop and no switch flag');
    assert.match(context, /Never answer the bank for the user\.$/);
    for (const other of ['status', 'check', 'discover', 'security', 'migrate', 'enable']) assert.ok(!context.includes(`toolkit-governance.cjs" ${other}`), `${phrase} runs ${other}`);
  }
  // The gate's answer phrases stay the gate's.
  assert.equal(commands.typedCommand('toolkit governance enable'), null);
});

test('governance answers and other governance wording stay with the gate or plain text', () => {
  const plain = ['toolkit governance enable', 'toolkit governance disable', 'toolkit governance decline', 'toolkit governance check --offline',
    'toolkit governance check --json', 'toolkit governance check please', 'run toolkit governance check', 'toolkit governance reopen', 'toolkit governance publish', 'governance check'];
  for (const text of plain) assert.equal(commands.phraseContext(text), '', text);
});

// Nothing routes `toolkit governance check` as a typed command (agents run toolkit-governance.cjs check
// themselves), so no Toolkit text may tell the owner, a coordinator or a workflow reader to type it.
// The changelog keeps its history; tests may name the phrase to prove it stays plain words.
test('no Toolkit text tells anyone to type toolkit governance check', () => {
  const root = path.join(__dirname, '..', '..');
  const skip = new Set([path.join(root, 'repo', 'docs', 'CHANGELOG.md'), path.join(root, 'repo', 'docs', 'changelog.d'), path.join(root, 'repo', 'tests')]);
  const hits = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (skip.has(file) || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.(md|cjs|js|json|ya?ml|ps1|toml)$/.test(entry.name)) continue;
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => { if (/toolkit governance check/i.test(line)) hits.push(`${path.relative(root, file)}:${index + 1}`); });
    }
  };
  for (const top of ['skills', 'repo', '.github', '.claude-plugin', '.codex-plugin']) if (fs.existsSync(path.join(root, top))) walk(path.join(root, top));
  for (const file of ['README.md', 'AGENTS.md']) if (fs.readFileSync(path.join(root, file), 'utf8').match(/toolkit governance check/i)) hits.push(file);
  assert.deepEqual(hits, []);
});

test('each typed command maps to its own action, whatever the letter case, spacing or closing full stop', () => {
  const cases = [
    ['toolkit cmd', 'list'], ['toolkit command', 'list'], ['toolkit refresh', 'refresh'], ['toolkit setup', 'setup'], ['toolkit show env', 'env'],
    ['  TOOLKIT   Show\tEnv.  ', 'env'], ['Toolkit Cmd', 'list'], ['toolkit env', 'env'], ['Toolkit Env.', 'env'], ['toolkit governance', 'guide'], ['Governance Setup', 'guide'],
  ];
  for (const [text, action] of cases) assert.equal(commands.typedCommand(text)?.action, action, text);
});

test('anything that is not the whole message is plain text', () => {
  const plain = ['toolkit set env', 'toolkit', 'toolkit cmd please', 'please toolkit cmd', 'toolkit cmd\ntoolkit setup', 'toolkit cmd..', 'toolkit cmd!',
    'toolkit-cmd', '`toolkit cmd`', '"toolkit cmd"', 'toolkit show env OPENAI_API_KEY', '<b>toolkit cmd</b>', '', ' ', `toolkit cmd${' '.repeat(80)}`, null, undefined, 7, {}, ['toolkit cmd']];
  for (const text of plain) {
    assert.equal(commands.typedCommand(text), null, String(text));
    assert.equal(commands.phraseContext(text), '', String(text));
  }
});

test('the context line names the phrase and the one action to take', () => {
  assert.match(commands.phraseContext('toolkit cmd'), /^Toolkit command: the user typed `toolkit cmd`\. Show the user this list exactly as written, then end your turn\. Run nothing\.\nToolkit commands/);
  assert.match(commands.phraseContext('toolkit setup'), /Treat it exactly as `setup toolkit`: follow the toolkit-setup skill\.$/);
  assert.match(commands.phraseContext('toolkit refresh'), /Treat it exactly as `refresh toolkit`: follow the toolkit-setup skill\.$/);
  const env = commands.phraseContext('toolkit show env');
  assert.match(env, /follow the toolkit-env skill and run its `edit` route/);
  assert.match(env, /Never run the one-key `set` prompt/);
});

test('the list shows only the commands a user types, and is what the script prints', () => {
  const list = commands.listText();
  const rows = commands.COMMANDS.flatMap(command => command.type);
  assert.deepEqual(rows, ['toolkit cmd', 'toolkit command', 'setup toolkit', 'toolkit setup', 'refresh toolkit', 'toolkit refresh', 'remove toolkit', 'toolkit env', 'toolkit show env',
    'toolkit governance', 'governance setup', 'merge N']);
  for (const phrase of rows) assert.ok(list.includes(`\`${phrase}\``), phrase);
  // Other governance phrases and older commands still work when typed, but the list leaves them out.
  for (const hidden of ['toolkit permissions', 'toolkit update scheduled task', 'setup governance', 'refresh governance', 'toolkit governance enable', 'toolkit governance disable']) assert.ok(!list.includes(`\`${hidden}\``), hidden);
  for (const subcommand of ['status', 'check', 'discover', 'security', 'migrate']) assert.ok(!list.includes(`toolkit governance ${subcommand}`), subcommand);
  // Every typed phrase is listed, or opens the same action as a listed one.
  const listedActions = new Set(rows.map(phrase => commands.typedCommand(phrase)?.action).filter(Boolean));
  for (const phrase of commands.PHRASES) assert.ok(rows.includes(phrase) || listedActions.has(commands.typedCommand(phrase).action), phrase);
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, `${list}\n`);
});

test('the list is one two-column table per group, in group order, with every command in exactly one row', () => {
  const list = commands.listText();
  const lines = list.split('\n');
  assert.equal(lines[0], 'Toolkit commands (type one as your whole message):');
  assert.equal(lines.at(-1), 'Anything else: ask in your own words.');
  const headings = lines.filter(line => /^\*\*[^*]+\*\*$/.test(line)).map(line => line.slice(2, -2));
  assert.deepEqual(headings, [...commands.GROUPS]);
  assert.deepEqual(commands.GROUPS, ['Setup', 'Keys', 'Governance', 'Merge']);
  assert.equal(lines.filter(line => line === '| Type this | What it does |').length, commands.GROUPS.length);
  for (const command of commands.COMMANDS) {
    assert.ok(commands.GROUPS.includes(command.group), `${command.type[0]} has no known group`);
    assert.ok(!`${command.type.join('')}${command.does}`.includes('|'), `${command.type[0]} would break the table`);
    const row = `| ${command.type.map(text => `\`${text}\``).join(' or ')} | ${command.does} |`;
    assert.equal(lines.filter(line => line === row).length, 1, row);
    const section = lines.slice(0, lines.indexOf(row)).filter(line => /^\*\*[^*]+\*\*$/.test(line)).at(-1);
    assert.equal(section, `**${command.group}**`, command.type[0]);
  }
  assert.equal(lines.filter(line => line.startsWith('| `')).length, commands.COMMANDS.length);
});

// The prompt hooks add nothing for a typed command (INT-TK421-1323), so the skill is the one route: it
// sends every typed command to the script, which prints what that command asks for. Read on its own,
// `toolkit governance` once became a status summary instead of the bank (#1373).
test('the toolkit-setup skill gets the line for any typed command from the script', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8');
  assert.match(skill.match(/^description: .*$/m)[0], /`setup toolkit`, `refresh toolkit`, [^\n]*`toolkit cmd`, `toolkit governance`, refresh governance and toolkit permissions/);
  assert.match(skill, /If the whole message looks like a typed Toolkit command \(such as `toolkit cmd`, `toolkit governance` or `refresh governance`\), run `node <Toolkit>\/repo\/scripts\/toolkit-commands\.cjs "<the message>"` from the managed Toolkit checkout and do exactly what the line it prints says\. For `toolkit governance` that is the governance question bank, never a status or check summary\./);
  assert.doesNotMatch(skill, /hook line|as if the hook/, 'the skill waits for no hook');
  for (const phrase of commands.PHRASES) {
    const run = spawnSync(process.execPath, [SCRIPT, ` ${phrase.toUpperCase()}. `], { encoding: 'utf8' });
    assert.equal(run.status, 0, phrase);
    assert.equal(run.stdout, `${commands.phraseContext(phrase)}\n`, phrase);
  }
  for (const text of ['toolkit governance check', 'please toolkit governance', '']) {
    const run = spawnSync(process.execPath, [SCRIPT, text], { encoding: 'utf8' });
    assert.equal(run.status, 1, text);
    assert.equal(run.stdout, '', text);
    assert.match(run.stderr, /^Not a typed Toolkit command: read the message as plain language\.$/m);
  }
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'toolkit', 'cmd'], { encoding: 'utf8' }).status, 1, 'the message is one argument');
});

test('the how-to guide shows the same commands', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'HOW-TO-USE.md'), 'utf8');
  for (const command of commands.COMMANDS) for (const text of command.type) assert.ok(guide.includes(`\`${text}\``), `${text} is missing from HOW-TO-USE.md`);
});

// INT-TK421-1323: the host delivers the user's message and the skill reads it; the hook adds no line.
// The Codex prompt hook is held to the same by the hook pack (CMD.typed-command-adds-no-note).
function prompt(decision, text, environment = {}) {
  const stubGate = { ...gate, PromptHold: class { decide() { return decision; } }, sessionIdOf: () => 'session' };
  const mergeHold = { recordPromptNote: () => ({ count: 0, note: '' }) };
  return claudeHook.respond('UserPromptSubmit', { cwd: process.cwd(), prompt: text }, { gate: stubGate, mergeHold, environment });
}

test('Claude Code prompt hook: a typed command adds no note, on a computer or in the cloud', () => {
  for (const environment of [{}, { CLAUDE_CODE_REMOTE: 'true' }]) {
    for (const phrase of commands.PHRASES) assert.deepEqual(prompt({ action: 'pass' }, phrase, environment), {}, phrase);
  }
});

test('Claude Code prompt hook: a refusal, the governance question and other governance context are returned unchanged', () => {
  assert.deepEqual(prompt({ action: 'block', reason: 'refused' }, 'toolkit cmd'), { decision: 'block', reason: 'refused' });
  const shown = prompt({ action: 'pass', context: 'governance question', notice: 'pick one' }, 'toolkit cmd');
  assert.equal(shown.hookSpecificOutput.additionalContext, 'governance question');
  assert.equal(shown.systemMessage, 'pick one');
  assert.equal(prompt({ action: 'pass', context: 'a reply ticket' }, 'toolkit cmd').hookSpecificOutput.additionalContext, 'a reply ticket');
});
