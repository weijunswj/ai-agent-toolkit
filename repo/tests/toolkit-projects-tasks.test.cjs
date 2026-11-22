'use strict';

// The scheduled task prompts a Projects coordinator runs, rendered and checked from Toolkit
// templates. Each closure-matrix row from the self-updating projects plan is a table entry here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { renderBlock, findBlocks } = require('../scripts/toolkit-managed-block.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const { STEPS_TEXT } = require('../scripts/toolkit-claude-account-copy.cjs');
const { ProjectsTasks, KEPT_LABEL, PROJECT_HEADING, LEGACY_RAISE, validateParams, checkMemory, parseArgs } = require('../scripts/toolkit-projects-tasks.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'repo/scripts/toolkit-projects-tasks.cjs');
const TASKS = path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/tasks');
const SKILL = path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/SKILL.md');
// Guided setup moved out of SKILL.md into its reference file, uploaded with the skill.
const SETUP = path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/reference/setup.md');
const INVENTORY = path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/setup-inventory.json');
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const tasks = () => new ProjectsTasks({ root: ROOT });

const PARAMS = {
  'daily-check-in': { project: 'EXAMPLE', repo: 'example-owner/example-repo', parent_issue: '12', report_dir: '/mnt/project-files/daily-check-in', effort: 'medium' },
  'hourly-nudge': { project: 'EXAMPLE', repo: 'example-owner/example-repo', report_dir: '/mnt/project-files/hourly-nudge', effort: 'medium' },
  custom: { project: 'EXAMPLE', repo: 'none', report_dir: '/mnt/project-files/sweep', effort: 'medium' }
};
const OWN_TEXT = 'Task: check the example folder and list what changed.\n1. List the folder.\n2. Compare with the last report.';
const params = kind => validateParams(kind, PARAMS[kind]);
const nudge0 = () => fs.readFileSync(path.join(TASKS, 'hourly-nudge.md'), 'utf8');
const rendered = kind => full(kind, params(kind), kind === 'custom' ? OWN_TEXT : undefined);
const pointer = kind => tasks().render(kind, params(kind), kind === 'custom' ? OWN_TEXT : undefined);

// The stored prompt shape from before pointers: the full instructions as managed blocks, as live
// tasks still carry it until their first refresh. Content tests read the instructions through it;
// its blocks are exactly what --expand prints (checked below).
function full(kind, promptParams, projectText, source = tasks()) {
  const [setup, ...rest] = source.instructionBlocks(kind, promptParams).map(renderBlock);
  const delivery = rest.pop();
  const own = projectText === undefined ? '' : projectText.replace(/^\n+|\n+$/g, '');
  if (!own && kind === 'custom') throw new Error('custom needs its own steps');
  const fence = ['```toolkit-task-params', JSON.stringify(promptParams, null, 2), '```'].join('\n');
  return [setup, '', fence, '', ...rest.flatMap(block => [block, '']), own || `${PROJECT_HEADING}\n- none`, '', delivery, ''].join('\n');
}

// What a run of this stored prompt loads: --expand with the params block it carries.
const loadedFrom = (kind, stored) => tasks().expand(kind, validateParams(kind, JSON.parse(stored.match(/```toolkit-task-params\n([\s\S]*?)\n```/)[1])));

// For these params, the stored pointer checks current and a refresh keeps it byte for byte, and
// the full prompt from before pointers checks outdated and refreshes into exactly that pointer.
function assertStable(kind, promptParams, projectText, label) {
  const stored = tasks().render(kind, promptParams, projectText);
  assert.equal(tasks().check(kind, stored).state, 'current', label);
  assert.equal(tasks().refresh(kind, stored), stored, label);
  const before = full(kind, promptParams, projectText);
  assert.equal(tasks().check(kind, before).state, 'outdated', label);
  assert.equal(tasks().refresh(kind, before), stored, label);
}

function tempDir(t) {
  const tempRoot = path.join(ROOT, '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tempRoot, 'projects-tasks-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function file(t, name, text) {
  const target = path.join(tempDir(t), name);
  fs.writeFileSync(target, text);
  return target;
}

function cli(t, kind, text) {
  const target = file(t, 'prompt.md', text);
  const before = fs.readFileSync(target);
  const result = run(['--check', kind, target]);
  assert.equal(result.stderr, '');
  assert.deepEqual(fs.readFileSync(target), before, 'checking never writes the prompt');
  return { state: result.stdout.trim(), status: result.status };
}

// A ProjectsTasks whose template files or version differ from the repo: what a later main renders.
// template changes the instruction templates; pointer changes the stored pointer's own text.
function laterMain({ version, template, pointer: pointerText } = {}) {
  return new ProjectsTasks({ root: ROOT, readFile(target, encoding) {
    const text = fs.readFileSync(target, encoding);
    if (version && target.endsWith('version.json')) return JSON.stringify({ version });
    const isPointer = target === path.join(TASKS, 'pointer.md');
    if ((template && target.startsWith(TASKS) && !isPointer) || (pointerText && isPointer)) return `${text}\n- A step added on main.`;
    return text;
  } });
}

const replaceBlockBody = (text, name, from, to) => {
  const { blocks } = findBlocks(text);
  const block = blocks.find(entry => entry.name === name);
  return text.slice(0, block.start) + text.slice(block.start, block.end).replace(from, to) + text.slice(block.end);
};

test('render is deterministic and every kind round-trips as current through the CLI', t => {
  for (const kind of ['daily-check-in', 'hourly-nudge', 'custom']) {
    assert.equal(pointer(kind), pointer(kind));
    assert.deepEqual(cli(t, kind, pointer(kind)), { state: 'current', status: 0 });
    const paramsFile = file(t, 'params.json', JSON.stringify(PARAMS[kind]));
    const args = ['--render', kind, '--params', paramsFile];
    if (kind === 'custom') args.push('--project-text', file(t, 'own.md', OWN_TEXT));
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, pointer(kind));
    const expanded = run(['--expand', kind, '--params', paramsFile]);
    assert.equal(expanded.status, 0, expanded.stderr);
    assert.equal(expanded.stdout, tasks().expand(kind, params(kind)));
  }
  assert.equal(run(['--name', 'daily-check-in', '--params', file(t, 'p.json', JSON.stringify(PARAMS['daily-check-in']))]).stdout, 'EXAMPLE: Daily check-in\n');
  assert.equal(run(['--name', 'hourly-nudge', '--params', file(t, 'p.json', JSON.stringify(PARAMS['hourly-nudge']))]).stdout, 'EXAMPLE: Hourly nudge\n');
  assert.equal(run(['--name', 'custom', '--params', file(t, 'p.json', JSON.stringify(PARAMS.custom))]).status, 2);
  assert.equal(run(['--expand', 'daily-check-in', '--params', file(t, 'p.json', '{"project":"EXAMPLE"}')]).status, 2, 'bad params never print instructions');
});

// A project's own (custom) task stores a short pointer; each run prints the instructions from main
// with --expand. The two Toolkit tasks store a ping instead (the ping tests below).
test('the stored prompt is a pointer and every run loads the current instructions from main', t => {
  for (const kind of ['custom']) {
    for (const session of ['bound', 'fresh']) {
      const promptParams = validateParams(kind, { ...PARAMS[kind], session });
      const stored = tasks().render(kind, promptParams, kind === 'custom' ? OWN_TEXT : undefined);
      const { blocks } = findBlocks(stored);
      assert.deepEqual(blocks.map(block => block.name), ['TASK-POINTER'], `${kind} ${session}: one Toolkit block`);
      assert.ok(stored.length < 4000, `${kind} ${session}: short (${stored.length})`);
      assert.match(stored, /^- First check, before anything else: if this turn has no mcp__hearthbot__ tools/m);
      assert.ok(stored.includes(`git clone --depth 1 https://github.com/weijunswj/ai-agent-toolkit TK-LOAD`));
      assert.ok(stored.includes(`node TK-LOAD/repo/scripts/toolkit-projects-tasks.cjs --expand ${kind} --params TK-LOAD-params.json`));
      assert.match(stored, /never run the task from memory or an older copy/);
      assert.match(stored, /"TASK LOAD FAILED: <clone or expand>: <one-line reason>"/);
      assert.equal(stored.includes('set_thread_resolved'), session === 'fresh', `${kind} ${session}: only a fresh run resolves`);
      // What a run loads: every instruction block, in order, as plain text with no markers.
      const loaded = tasks().expand(kind, promptParams);
      assert.equal(findBlocks(loaded).blocks.length, 0);
      assert.match(loaded, /^TOOLKIT TASK INSTRUCTIONS \(.+, toolkit \d+\.\d+\.\d+\)\n/);
      let at = 0;
      for (const block of tasks().instructionBlocks(kind, promptParams)) {
        const found = loaded.indexOf(block.body.replace(/\n+$/, ''), at);
        assert.ok(found > at, `${kind} ${session}: ${block.name} loaded in order`);
        at = found;
      }
      if (kind === 'custom') assert.match(loaded, /own steps are the project additions in its stored prompt/);
    }
  }
  // A Toolkit release reaches the task with no change to its stored prompt.
  const stored = pointer('custom');
  const later = laterMain({ version: '99.0.0', template: true });
  assert.equal(later.check('custom', stored).state, 'current', 'a later main leaves the pointer current');
  assert.match(later.expand('custom', params('custom')), /A step added on main\./);
  assert.match(later.expand('custom', params('custom')), /toolkit 99\.0\.0/);
  // A pointer stored before tiers still loads: --expand migrates its params as a refresh would.
  const old = { ...PARAMS.custom, effort: 'low' };
  const result = run(['--expand', 'custom', '--params', file(t, 'old.json', JSON.stringify(old))]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /set_effort_level with medium/);
  // Main's script reads params any older release stored: a key it no longer knows is dropped, not a
  // load failure, while every known value is still checked.
  const retired = run(['--expand', 'hourly-nudge', '--params', file(t, 'retired.json', JSON.stringify({ ...PARAMS['hourly-nudge'], retired_key: 'x', constructor: 'y' }))]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.equal(retired.stdout, tasks().expand('hourly-nudge', params('hourly-nudge')));
  assert.equal(run(['--expand', 'hourly-nudge', '--params', file(t, 'bad.json', JSON.stringify({ ...PARAMS['hourly-nudge'], report_dir: '/tmp/x' }))]).status, 2);
  assert.equal(run(['--expand', 'hourly-nudge', '--params', file(t, 'list.json', '[]')]).status, 2);
  // Every param a stored prompt may lack has a fallback, so an older pointer still loads (readers before writers).
  const optional = Object.keys(validateParams('hourly-nudge', PARAMS['hourly-nudge'])).filter(key => !(key in PARAMS['hourly-nudge']));
  assert.deepEqual(optional.sort(), ['model', 'parent_issue', 'toolkit_repo']);
});

// Closure matrix: input state -> check result.
test('closure matrix: each prompt state gets its check result', t => {
  const stored = pointer('daily-check-in');
  const before = rendered('daily-check-in');
  const fence = /```toolkit-task-params\n[\s\S]*?\n```/;
  const oldDelivery = before.slice(findBlocks(before).blocks[2].start, findBlocks(before).blocks[2].end);
  const rows = [
    ['ping rendered from current main, untouched', 'daily-check-in', stored, 'current', 0],
    ['ping stamped by an older release, same text', 'daily-check-in', laterMain({ version: '1.0.0' }).render('daily-check-in', params('daily-check-in')), 'current', 0],
    ['ping text changed on main', 'daily-check-in', laterMain({ template: true }).render('daily-check-in', params('daily-check-in')), 'outdated', 1],
    ['a custom pointer\'s text changed on main', 'custom', laterMain({ pointer: true }).render('custom', params('custom'), OWN_TEXT), 'outdated', 1],
    ['full prompt from before pointers', 'daily-check-in', before, 'outdated', 1],
    ['full prompt from an older release', 'daily-check-in', full('daily-check-in', params('daily-check-in'), undefined, laterMain({ version: '1.0.0' })), 'outdated', 1],
    ['full prompt hand-edited inside a block', 'daily-check-in', replaceBlockBody(before, 'DAILY-CHECK-IN-CHECKS', '\nCHECKS\n', '\nCHECKS (edited)\n'), 'edited', 1],
    ['full prompt with a block deleted', 'daily-check-in', before.replace(/<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN DAILY-CHECK-IN-CHECKS[\s\S]*?END DAILY-CHECK-IN-CHECKS -->\n/, ''), 'outdated', 1],
    ['params block changed by the project', 'daily-check-in', stored.replace('"effort": "medium"', '"effort": "high",\n  "raise_reason": "misses checks at medium"'), 'current', 0],
    ['a session change rewrites the ping', 'daily-check-in', stored.replace('"effort": "medium"', '"effort": "medium",\n  "session": "fresh"'), 'outdated', 1],
    ['a raise without its reason', 'daily-check-in', stored.replace('"effort": "medium"', '"effort": "high"'), 'malformed', 2],
    ['effort below the medium floor', 'daily-check-in', stored.replace('"effort": "medium"', '"effort": "low"'), 'malformed', 2],
    ['text inside the ping hand-edited', 'daily-check-in', replaceBlockBody(stored, 'TASK-PING', 'TASK PING', 'TASK PING (edited)'), 'edited', 1],
    ['project lines left in a ping move to project-additions.md first', 'daily-check-in', `${stored}- Also list the example sweep.\n`, 'outdated', 1],
    ['legacy prompt, no markers', 'daily-check-in', 'EXAMPLE daily check-in\n1. Do the checks.\n', 'missing', 1],
    ['legacy prompt with only a params block', 'daily-check-in', `${stored.match(fence)[0]}\nOld steps.\n`, 'missing', 1],
    ['two pings', 'daily-check-in', stored.replace(fence, match => `${match}\n\n${renderBlock(tasks().pingBlock('daily-check-in', params('daily-check-in')))}`), 'malformed', 2],
    ['two pointers', 'custom', pointer('custom').replace(fence, match => `${match}\n\n${renderBlock(tasks().pointerBlock('custom', params('custom')))}`), 'malformed', 2],
    ['a pointer and an old block together', 'daily-check-in', `${stored}\n${oldDelivery}\n`, 'outdated', 1],
    ['a block another kind owns', 'daily-check-in', `${stored}\n${renderBlock({ source: 'claude-projects', name: 'HOURLY-NUDGE-CHECKS', version: '1.0.0', body: 'x' })}\n`, 'malformed', 2],
    ['broken END marker', 'daily-check-in', stored.replace(':END TASK-PING', ':END OTHER'), 'malformed', 2],
    ['bad params JSON', 'daily-check-in', stored.replace('"effort": "medium"', '"effort": medium'), 'malformed', 2],
    ['param fails validation', 'daily-check-in', stored.replace('"report_dir": "/mnt/project-files/daily-check-in"', '"report_dir": "/tmp/elsewhere"'), 'malformed', 2],
    ['unknown param', 'daily-check-in', stored.replace('"effort": "medium"', '"effort": "medium", "note": "x"'), 'malformed', 2],
    ['two params blocks', 'daily-check-in', stored.replace(fence, match => `${match}\n\n${match}`), 'malformed', 2],
    ['unclosed params block', 'daily-check-in', stored.replace(/(```toolkit-task-params\n[\s\S]*?\n)```/, '$1'), 'malformed', 2],
    ['ping without a params block', 'daily-check-in', stored.replace(fence, ''), 'malformed', 2],
    ['a check-in ping checked as the nudge', 'hourly-nudge', stored, 'malformed', 2],
    ['a check-in full prompt checked as the nudge', 'hourly-nudge', before, 'malformed', 2],
    ['custom: pointer current, own section changed', 'custom', pointer('custom').replace('List the folder.', 'List both folders.'), 'current', 0],
    ['custom: hand edit inside the pointer', 'custom', replaceBlockBody(pointer('custom'), 'TASK-POINTER', 'TASK POINTER', 'TASK POINTER (mine)'), 'edited', 1],
    ['text before the pointer', 'custom', `Project note first.\n${pointer('custom')}`, 'misplaced', 1],
    ['params block before the ping', 'daily-check-in', stored.replace(fence, '').replace(/^/, `${stored.match(fence)[0]}\n\n`), 'misplaced', 1],
    ['project text last, as rendered', 'custom', `${pointer('custom')}Project note last.\n`, 'current', 0],
    ['only blank lines around the prompt', 'daily-check-in', `\n\n${stored}\n\n`, 'current', 0]
  ];
  for (const [label, kind, text, state, status] of rows) assert.deepEqual(cli(t, kind, text), { state, status }, label);
  // Unknown task kind is a usage error.
  assert.equal(run(['--check', 'drift-watch', file(t, 'p.md', stored)]).status, 2);
});

test('refresh turns a full prompt into the ping, keeping the params block byte for byte once its project text is saved', t => {
  const params = '```toolkit-task-params\n{"project":"EXAMPLE","repo":"example-owner/example-repo","report_dir":"/mnt/project-files/daily-check-in","effort":"medium"}\n```';
  const project = 'Project additions:\n- Also list the example sweep.\n  - indented, with trailing spaces   \n- Second rule.';
  const old = laterMain({ version: '1.0.0' });
  const blocks = old.instructionBlocks('daily-check-in', validateParams('daily-check-in', JSON.parse(params.split('\n')[1]))).map(renderBlock);
  const live = [blocks[0], '', params, '', blocks[1], '', project, '', blocks[2], ''].join('\n');
  assert.equal(tasks().check('daily-check-in', live).state, 'outdated');
  assert.equal(tasks().additions('daily-check-in', live), project, 'the project text to move, byte for byte');
  const refreshed = tasks().refresh('daily-check-in', live, { additions: `${project}\n` });
  assert.equal(tasks().check('daily-check-in', refreshed).state, 'current');
  assert.deepEqual(findBlocks(refreshed).blocks.map(block => block.name), ['TASK-PING']);
  assert.ok(refreshed.includes(`\n${params}\n`), 'params block kept byte for byte');
  assert.ok(!refreshed.includes('Also list the example sweep'), 'project text lives in project-additions.md, not the ping');
  // CLI agrees, and a refresh of a current prompt changes nothing.
  const target = file(t, 'live.md', live);
  assert.equal(run(['--refresh', 'daily-check-in', target, '--session', 'bound', '--additions-saved', file(t, 'additions.md', project)]).stdout, refreshed);
  assert.equal(run(['--refresh', 'daily-check-in', target]).status, 2, 'a Toolkit task refresh names the session its replacement runs in');
  assert.equal(tasks().refresh('daily-check-in', refreshed), refreshed);
  // A custom task keeps its project text in its prompt: text before the pointer moves into it, words unchanged.
  const misplaced = tasks().refresh('custom', `Early owner line.\n${pointer('custom')}`);
  assert.equal(tasks().check('custom', misplaced).state, 'current');
  assert.ok(misplaced.includes(`Early owner line.\n\n${OWN_TEXT}\n`));
});

test('refresh of an edited block keeps the added lines, labelled, and malformed holds', t => {
  const edited = replaceBlockBody(rendered('hourly-nudge'), 'HOURLY-NUDGE-CHECKS', 'CHECKS\n', 'CHECKS\n- Project step typed inside the block.\n');
  assert.equal(tasks().check('hourly-nudge', edited).state, 'edited');
  const kept = `${PROJECT_HEADING}\n- none\n${KEPT_LABEL}\n- Project step typed inside the block.`;
  assert.equal(tasks().additions('hourly-nudge', edited), kept, 'the added lines move to project-additions.md, labelled');
  const refreshed = tasks().refresh('hourly-nudge', edited, { additions: kept });
  assert.equal(tasks().check('hourly-nudge', refreshed).state, 'current');
  const custom = replaceBlockBody(full('custom', params('custom'), OWN_TEXT), 'TASK-DELIVERY', 'DELIVERY\n', 'DELIVERY\n- Project step typed inside the block.\n');
  assert.ok(tasks().refresh('custom', custom).includes(`${OWN_TEXT}\n${KEPT_LABEL}\n- Project step typed inside the block.\n`), 'a custom task keeps them in its prompt');
  assert.throws(() => tasks().refresh('hourly-nudge', `${edited}\n${edited}`));
  assert.equal(run(['--refresh', 'hourly-nudge', file(t, 'bad.md', edited.replace(':END TASK-DELIVERY', ':END X')), '--session', 'bound']).status, 2);
});

test('a legacy prompt migrates only with params and moved project text; custom needs its own steps', t => {
  const legacy = 'EXAMPLE nudge\n1. Old steps.\n';
  assert.throws(() => tasks().refresh('hourly-nudge', legacy));
  // A hand-made Toolkit task's own steps go word for word into project-additions.md; the ping takes none.
  assert.throws(() => tasks().refresh('hourly-nudge', legacy, { params: params('hourly-nudge'), projectText: '- Kept project step, word for word.' }));
  const migrated = tasks().refresh('hourly-nudge', legacy, { params: params('hourly-nudge'), additions: '- Kept project step, word for word.' });
  assert.equal(tasks().check('hourly-nudge', migrated).state, 'current');
  const customMigrated = tasks().refresh('custom', legacy, { params: params('custom'), projectText: '- Kept project step, word for word.' });
  assert.equal(tasks().check('custom', customMigrated).state, 'current');
  assert.ok(customMigrated.includes('\n- Kept project step, word for word.\n'));
  assert.throws(() => tasks().refresh('hourly-nudge', rendered('hourly-nudge'), { params: params('hourly-nudge') }), 'params only for a legacy prompt');
  assert.throws(() => tasks().render('custom', params('custom')), 'custom has no default section');
  assert.throws(() => tasks().render('daily-check-in', params('daily-check-in'), rendered('hourly-nudge')), 'no markers in project text');
  const paramsFile = file(t, 'p.json', JSON.stringify(PARAMS['hourly-nudge']));
  const result = run(['--refresh', 'hourly-nudge', file(t, 'legacy.md', legacy), '--params', paramsFile, '--session', 'bound', '--additions-saved', file(t, 'additions.md', '- Kept project step, word for word.\n')]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(tasks().check('hourly-nudge', result.stdout).state, 'current');
});

test('params are strict: known keys, safe values, report folder in the shared folder', () => {
  const base = PARAMS['daily-check-in'];
  for (const bad of [
    { ...base, project: 'lower' }, { ...base, project: 'TRAILING ' }, { ...base, project: 'A'.repeat(41) },
    { ...base, project: 'BAD;NAME' }, { ...base, repo: 'no-slash' }, { ...base, repo: 'a/b/c' },
    { ...base, parent_issue: '#12' }, { ...base, parent_issue: '0' }, { ...base, report_dir: '/mnt/project-files/../x' },
    { ...base, report_dir: '/mnt/project-files/x/' }, { ...base, report_dir: '/mnt/other' }, { ...base, effort: 'ultra' },
    { ...base, effort: 2 }, { ...base, session: 'sometimes' }, { ...base, extra: 'x' }, (({ effort, ...rest }) => rest)(base), [], null
  ]) assert.throws(() => validateParams('daily-check-in', bad), JSON.stringify(bad));
  assert.deepEqual(validateParams('daily-check-in', { ...base, repo: 'none' }).toolkit_repo, 'weijunswj/ai-agent-toolkit');
  assert.equal(validateParams('custom', { ...PARAMS.custom, session: 'bound' }).session, 'bound');
  assert.throws(() => validateParams('custom', { ...PARAMS.custom, session: 'sometimes' }));
  assert.throws(() => validateParams('weekly', base));
});

test('model tier and effort: cheapest by default, medium floor, every raise carries its reason', () => {
  // Left out, each kind takes its default tier: custom tasks small, the check-in and the nudge mid
  // (the nudge's stuck check and lane sweep missed threads on small).
  assert.equal(params('hourly-nudge').model, 'mid');
  assert.equal(params('daily-check-in').model, 'mid');
  assert.equal(params('custom').model, 'small');
  const base = PARAMS['hourly-nudge'];
  for (const bad of [
    { ...base, effort: 'low' }, { ...base, effort: 'minimal' }, { ...base, model: 'haiku' }, { ...base, model: 'top' },
    { ...base, effort: 'high' }, { ...base, model: 'top', raise_reason: '' }, { ...base, model: 'top', raise_reason: 'no' },
    { ...base, model: 'top', raise_reason: 'a | b' }, { ...base, model: 'top', raise_reason: 'line\nbreak' },
    { ...base, model: 'top', raise_reason: ' padded ' }, { ...base, model: 'top', raise_reason: '{{project}} leak' }
  ]) assert.throws(() => validateParams('hourly-nudge', bad), JSON.stringify(bad));
  // A step down below the default needs no reason; a raise with one renders it.
  assert.equal(validateParams('daily-check-in', { ...PARAMS['daily-check-in'], model: 'small' }).model, 'small');
  assert.equal(validateParams('hourly-nudge', { ...base, model: 'small' }).model, 'small');
  const raised = validateParams('hourly-nudge', { ...base, model: 'top', effort: 'high', raise_reason: 'missed checks at small' });
  const prompt = full('hourly-nudge', raised);
  assert.match(prompt, /Model tier for this task: top \(agent-cost-control ladder; on Claude, small is Haiku, mid Sonnet, top Opus\), effort high\./);
  assert.match(prompt, /Raised above the cheapest fitting step because: missed checks at small/);
  assert.match(prompt, /TIER GAP: served <model>\/<effort>, want top\/high/);
  assert.doesNotMatch(rendered('hourly-nudge'), /Raised above/);
  assert.match(rendered('daily-check-in'), /Model tier for this task: mid /);
  // A live prompt rendered before tiers existed still parses: its params take the default tier.
  const legacy = pointer('hourly-nudge').replace(/,\n {2}"model": "mid"/, '');
  assert.doesNotMatch(legacy, /"model"/);
  assert.equal(tasks().check('hourly-nudge', legacy).state, 'current');
  // A prompt rendered before tiers (no model key) with any old effort still checks and refreshes.
  const projectText = 'Project additions:\n- Keep this owner line.';
  for (const kind of ['daily-check-in', 'hourly-nudge', 'custom']) {
    for (const [effort, want, reason] of [['low', 'medium', undefined], ['medium', 'medium', undefined], ['high', 'high', LEGACY_RAISE], ['xhigh', 'xhigh', LEGACY_RAISE], ['max', 'max', LEGACY_RAISE]]) {
      const old = full(kind, params(kind), kind === 'custom' ? OWN_TEXT : projectText, laterMain({ version: '1.0.0' }));
      const legacyPrompt = old.replace(/,\n {2}"model": "[a-z]+"/, '').replace('"effort": "medium"', `"effort": "${effort}"`);
      assert.doesNotMatch(legacyPrompt, /"model"/);
      assert.equal(tasks().check(kind, legacyPrompt).state, 'outdated', `${kind} ${effort}`);
      const session = kind === 'custom' ? undefined : 'bound';
      const refreshed = tasks().refresh(kind, legacyPrompt, { session, ...(kind === 'custom' ? {} : { additions: projectText }) });
      assert.equal(tasks().check(kind, refreshed).state, 'current', `${kind} ${effort} refreshed`);
      const migrated = JSON.parse(refreshed.match(/```toolkit-task-params\n([\s\S]*?)\n```/)[1]);
      assert.equal(migrated.effort, want);
      assert.equal(migrated.raise_reason, reason);
      assert.ok(kind === 'custom' ? refreshed.includes('List the folder.') : tasks().additions(kind, legacyPrompt) === projectText, 'project text kept');
    }
  }
  // Built-in object property names are unknown keys, in new and pre-tier params alike.
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => validateParams('hourly-nudge', Object.assign(JSON.parse(`{"${key}": "x"}`), PARAMS['hourly-nudge'])), key);
    const withKey = rendered('hourly-nudge').replace(/,\n {2}"model": "mid"/, '').replace('"effort": "medium"', `"effort": "high",\n  "${key}": "x"`);
    assert.equal(tasks().check('hourly-nudge', withKey).state, 'malformed', key);
  }
  // A swap carries a recorded raise by writing it into the saved params before the refresh,
  // so the prompt itself sets the raised effort and checks current.
  const saved = full('hourly-nudge', params('hourly-nudge'), projectText, laterMain({ version: '1.0.0' }));
  const withRaise = saved.replace('"effort": "medium"', '"effort": "high",\n  "raise_reason": "missed checks at medium"');
  const carried = tasks().refresh('hourly-nudge', withRaise, { session: 'bound', additions: projectText });
  assert.equal(tasks().check('hourly-nudge', carried).state, 'current');
  const paramsOf = text => JSON.parse(text.match(/```toolkit-task-params\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual([paramsOf(carried).effort, paramsOf(carried).raise_reason], ['high', 'missed checks at medium'], 'the ping keeps the raise its home thread starts on');
  const customRaised = tasks().refresh('custom', tasks().render('custom', validateParams('custom', { ...PARAMS.custom, effort: 'high', raise_reason: 'missed checks at medium' }), OWN_TEXT));
  assert.match(loadedFrom('custom', customRaised), /call mcp__hearthbot__set_effort_level with high;/);
  assert.match(loadedFrom('custom', customRaised), /Raised above the cheapest fitting step because: missed checks at medium/);
  const swap = fs.readFileSync(path.join(path.dirname(SETUP), 'recurring-tasks.md'), 'utf8');
  assert.match(swap, /First make the saved params block match the task's entry: with a recorded raise, set `model`, `effort` and `raise_reason` to the higher of the template's and the raised values and the entry's reason; with none, set the template's tier, `medium` effort and no `raise_reason`/);
  assert.match(swap, /with its home thread started on the tier and effort in the rendered params/);
  // A removed raise is removed from the params too, so the prompt drops back to medium.
  const lowered = tasks().refresh('hourly-nudge', saved, { session: 'bound', additions: projectText });
  assert.deepEqual([paramsOf(lowered).effort, paramsOf(lowered).raise_reason], ['medium', undefined]);
  // Every rebuild renders the prompt the way the swap does, so a raise is carried. Both lines moved word for word
  // from the skill's Hourly nudge section into reference/periodic-runs.md.
  const skill = fs.readFileSync(path.join(path.dirname(SKILL), 'reference', 'periodic-runs.md'), 'utf8');
  assert.match(skill, /new home thread and task, with the prompt rendered as in the swap \(\*\*Recurring tasks\*\* step 2, so a recorded raise is carried\)/);
  assert.match(skill, /recreates it from the template on `main` \(rendered as in the swap, \*\*Recurring tasks\*\* step 2\)/);
  // A params reason follows the same rules as the memory reason.
  for (const reason of ['x stopped by the owner today', 'kept for Owner-Schedule', 'caf\u00e9 reason', 'a`b`c']) {
    assert.throws(() => validateParams('hourly-nudge', { ...base, model: 'top', raise_reason: reason }), reason);
  }
  // New-format params stay strict: no migration once a model key is present.
  assert.equal(tasks().check('hourly-nudge', rendered('hourly-nudge').replace('"effort": "medium"', '"effort": "low"')).state, 'malformed');
  // The check-in reports model and effort gaps, and a recorded raise excuses them.
  const checkIn = fs.readFileSync(path.join(TASKS, 'daily-check-in.md'), 'utf8');
  assert.match(checkIn, /weekdays-only, no-effort, model, effort, name/);
  assert.match(checkIn, /unless the served settings match a `raised <tier>\/<effort>` field/);
  // A gap a swap cannot fix never causes a daily swap: fresh entries and repeats are advice only.
  assert.match(checkIn, /Report each model or effort gap in the prefix only once: when the entry says fresh[^\n]*list it under \*\*Tasks:\*\* as "tier gap still open" instead, so it never causes a daily swap/);
  assert.match(checkIn, /each model or effort gap reported or still open \(task, served, wanted\)/);
  assert.match(checkIn, /listed under \*\*Tasks:\*\* as "effort kept from before tiers: confirm or lower"/);
  assert.ok(checkIn.includes(`reads "${LEGACY_RAISE}"`), 'the check-in names the exact migration reason');
  // The nudge never resolves a coordinator post or its reply thread (no session of its own: resolving
  // it hides the chat message), and lists threads due for rotation.
  const nudge = fs.readFileSync(path.join(TASKS, 'hourly-nudge.md'), 'utf8');
  assert.doesNotMatch(nudge, /QUIET-6H|6 hours with no new message/);
  assert.match(nudge, /Never list a post or its reply thread as a resolve candidate: it has no Claude session of its own, and resolving it hides the chat message\./);
  assert.match(nudge, /Never list a task home thread, or a thread rooted in a coordinator project-chat post/);
  assert.match(nudge, /Backlog sweep \(every run\): page list_threads for the states blocked, review_ready and done, with each thread's pull requests/);
  assert.match(nudge, /A "waiting on you" thread whose PRs all merged and whose UAT is recorded counts as done\./);
  assert.match(nudge, /Rotate: standing non-gate threads \(integrator, review runner, record keeper, any long-lived lane, Remote Control lanes included; never gate sessions/);
  assert.match(nudge, /\*\*Rotate:\*\*/);
});

test('templates hold no ids, owner names, project-only tasks or old resolve rules, and fill every placeholder', () => {
  for (const name of fs.readdirSync(TASKS)) {
    const text = fs.readFileSync(path.join(TASKS, name), 'utf8');
    assert.doesNotMatch(text, /trig_|chan_|cmsg_|session_01|weijunswj|WJ_Lappy|TOOLKIT:|SWOO/, name);
    // No real home folder: a Windows, Git Bash, WSL, Cygwin, Linux or macOS home path of any user name is caught here, so the test names none.
    assert.doesNotMatch(text, /[a-z]:[\\/]+users[\\/]|\/(?:mnt\/|cygdrive\/)?[a-z]\/users\//i, name);
    assert.doesNotMatch(text, /(?<![\w.~$\/-])\/(?:home|Users)\/[^\s\\\/]/, name);
    // No separate drift watch task: the guidebook steps keep the library copy of the skill current.
    assert.doesNotMatch(text, /drift watch|resolve window|idle window|default 2 days|IDLE-2D/i, name);
    assert.doesNotMatch(text, /AI-AGENT-TOOLKIT:/, name);
    assert.doesNotMatch(text, /[^\x00-\x7f]/, name);
  }
  for (const kind of ['daily-check-in', 'hourly-nudge', 'custom']) {
    for (const repo of ['example-owner/example-repo', 'none']) {
      const text = full(kind, validateParams(kind, { ...PARAMS[kind], repo }), kind === 'custom' ? OWN_TEXT : undefined);
      assert.doesNotMatch(text, /\{\{|^\[[a-z-]+\]/m, `${kind} ${repo}`);
      if (repo === 'none') assert.doesNotMatch(text, /example-owner\/example-repo/);
    }
  }
  const noRepo = full('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo: 'none', parent_issue: 'none' }));
  assert.match(noRepo, /11\. GitHub: none \(no repo\)\./);
  assert.match(noRepo, /\*\*Binding:\*\* none \(no repo\)/);
  assert.doesNotMatch(noRepo, /issue #/);
  assert.match(rendered('daily-check-in'), /New comments on issue #12/);
});

test('every Toolkit-made prompt carries the recurring-task requirements; fresh runs self-resolve, the bound nudge never does', () => {
  // A custom task's loaded instructions carry the full run contract; the two Toolkit tasks' pings
  // carry theirs (the ping tests below), and the coordinator works their checklists.
  for (const kind of ['custom']) {
    const text = rendered(kind);
    for (const required of ['set_effort_level', '/latest.md (overwrite), then read it back', 'at most 1,500 characters', 'retry once',
      'never claim it was delivered', 'Never end any message with a question to the owner', 'Project additions in the stored prompt override the Toolkit base where they differ',
      'Never write project memory, the binding line or project instructions', 'mcp__hearthbot__no_reply_needed']) {
      assert.ok(text.includes(required), `${kind}: ${required}`);
    }
  }
  for (const kind of ['daily-check-in', 'hourly-nudge']) {
    const ping = pointer(kind);
    assert.match(ping, /Never resolve this home thread/, kind);
    assert.doesNotMatch(ping, /resolve this run's own thread|Fresh session per run/, kind);
  }
  assert.match(rendered('hourly-nudge'), /CONTEXT RESET DUE/);
  const bound = full('custom', validateParams('custom', { ...PARAMS.custom, session: 'bound' }), OWN_TEXT);
  assert.match(bound, /Never resolve this home thread/);
  assert.doesNotMatch(bound, /set_thread_resolved/);
  // The fresh-session fallback renders as a fresh run that resolves its own thread, keeps session in
  // its params so a refresh or check keeps it, and a bound Toolkit task stores no session at all.
  for (const kind of ['daily-check-in', 'hourly-nudge']) {
    assert.equal(validateParams(kind, PARAMS[kind]).session, undefined, kind);
    const params = validateParams(kind, { ...PARAMS[kind], session: 'fresh' });
    assert.equal(params.session, 'fresh');
    const fresh = tasks().render(kind, params, '');
    assert.match(fresh, /resolve this run's own thread/, kind);
    assert.doesNotMatch(fresh, /Never resolve this home thread/, kind);
    assert.equal(tasks().check(kind, fresh).state, 'current', kind);
    // A swap moves a task between the fallback and bound.
    const moved = tasks().refresh(kind, fresh, { session: 'bound' });
    assert.match(moved, /Never resolve this home thread/, kind);
    assert.doesNotMatch(moved, /resolve this run's own thread|"session"/, kind);
    assert.equal(tasks().check(kind, moved).state, 'current', kind);
    const back = tasks().refresh(kind, moved, { session: 'fresh' });
    assert.match(back, /"session": "fresh"/, kind);
    assert.match(back, /resolve this run's own thread/, kind);
    assert.throws(() => tasks().refresh(kind, moved, { session: 'sometimes' }), kind);
    // The session-mismatch loop: a bound entry whose stored prompt was rendered fresh. The swap
    // always names the replacement's session, so the result is bound and the check stays current.
    const repaired = tasks().refresh(kind, tasks().render(kind, params, ''), { session: 'bound' });
    assert.doesNotMatch(repaired, /"session"|resolve this run's own thread/, kind);
    assert.equal(tasks().refresh(kind, repaired, { session: 'bound' }), repaired, `${kind}: a second swap changes nothing`);
  }
  assert.throws(() => tasks().refresh('custom', tasks().render('custom', validateParams('custom', PARAMS.custom), OWN_TEXT), { session: 'bound' }), 'a custom task keeps its own session');
});

test('only the project that runs the Toolkit repo watches other projects, and only reports', () => {
  const other = rendered('daily-check-in');
  assert.doesNotMatch(other, /OTHER PROJECTS:/);
  const own = full('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo: 'weijunswj/ai-agent-toolkit' }));
  assert.match(own, /OTHER PROJECTS: this project runs the Toolkit repo/);
  for (const required of ['reusing the same list_triggers result (no extra calls)', 'Group the cloud tasks by hearth_channel_id',
    '"PROJECT TASKS MISSING: <PROJECT>=<task>[+<task>], ... | "', 'unless state.md already reported the same set',
    'Report only: that project\'s own coordinator recreates its tasks on its next wake',
    // The platform refuses a prompt swap from another project, so outdated tasks are reported, not swapped here.
    'Report only: a task\'s prompt changes only from the thread it posts into, so that project\'s own coordinator swaps them in place on its own check-in, never this one.']) {
    assert.ok(own.includes(required), required);
  }
  assert.doesNotMatch(own, /so this coordinator swaps them in place/);
  const reference = fs.readFileSync(path.join(TASKS, '..', 'reference', 'recurring-tasks.md'), 'utf8');
  assert.ok(reference.includes("Never call `update_trigger` on another project's task."), 'no cross-project swap');
  const acting = fs.readFileSync(path.join(TASKS, '..', 'reference', 'periodic-runs.md'), 'utf8');
  assert.ok(acting.includes("  - `PROJECT TASKS OUTDATED` (Toolkit project only): another project's enabled check-in or nudge") && acting.includes("own check-in's `TASKS OUTDATED`, never this one."), 'PROJECT TASKS OUTDATED is report only');
});

test('the check-in carries every prefix in the fixed order and checks both Toolkit tasks; the nudge compares cheaply first', () => {
  const text = rendered('daily-check-in');
  const order = ['CONTEXT RESET DUE', 'GUIDEBOOK MISSING or SKILL COPY STALE', 'SKILL UPDATE', 'SKILL CARD OUTDATED', 'BLOCK OUTDATED', 'BINDING STALE or BINDING UNKNOWN', 'TOOLKIT CHANGED', 'MEMORY FORMAT', 'TASKS OUTDATED', 'NUDGE NOT ARMED', 'PROJECT TASKS MISSING', 'PROJECT TASKS OUTDATED', 'PLUGIN BEHIND', 'TASK FAILING', 'PR ATTENTION'];
  const line = text.split('\n').find(entry => entry.startsWith('- First line:'));
  const positions = order.map(prefix => line.indexOf(prefix));
  assert.ok(positions.every((at, index) => at > -1 && (index === 0 || at > positions[index - 1])), line);
  for (const required of ['"EXAMPLE: Daily check-in"', '"EXAMPLE: Hourly nudge"', '--check daily-check-in', '--check hourly-nudge',
    '--check-memory', 'bound to its home thread (persist_session true), or a fresh session per run (persist_session false) only where the entry says fresh', 'CONTEXT RESET DUE, GUIDEBOOK MISSING', 'weekly-rebuild', 'unlisted', 'hearth_channel_id',
    'advice only', 'local, advice', 'Never suggest moving a local task to the cloud', '--declined-dedupe', 'overlaps',
    'remove only the ai-agent-toolkit plugin on claude.ai in a web browser', 'state done', 'older than 65 minutes', 'Never flag other memory lines',
    'a quiet run posts nothing, and the hourly nudge\'s CHECK-IN NOT ARMED and RUN MISSED catch a missing run', 'so a Toolkit release alone never makes them outdated', 'The coordinator swaps each named Toolkit task in place the same turn']) {
    assert.ok(text.includes(required), required);
  }
  // The guidebook step compares the library copy with main, refreshes it only as the backstop, and names the Version for SKILL UPDATE.
  for (const required of ['3. TOOL STEP (shell): GUIDEBOOK: run `node TK/repo/scripts/toolkit-projects-guidebook.cjs --check /mnt/project-files/toolkit/web-controller-projects`',
    'Under two hours ago: "**Guidebook:** <printed line>, left to the hourly nudge"', 'unless the nudge\'s entry on the SCHEDULED TASKS line ends "stopped by owner <date>" or the nudge is not armed',
    '"GUIDEBOOK MISSING: <reason>, <result> | "', '"SKILL COPY STALE: <reason>, <result> | "', 'with the `skill <Version>` on the BINDING line in memory',
    '"SKILL UPDATE: <old> -> <new> | "', 'Read /mnt/project-files/toolkit/web-controller-projects/VERSION and state it.', 'the guidebook\'s VERSION line, main\'s SHA']) {
    assert.ok(text.includes(required), required);
  }
  // The saved claude.ai copy of the skill is compared with the guidebook; the check-in only reports, and a Version
  // already offered, declined or refused (any "skill card <Version>" memory line) is never raised again.
  for (const required of ['`/root/.claude/skills/synced/*/web-controller-projects/SKILL.md`', '"SKILL CARD OUTDATED: saved <old>, main <new> | "',
    'unless memory has a "skill card <guidebook Version>" line', 'the day counter as a number, so .10 is newer than .9', '"**Guidebook:** no saved skill copy seen", advice only']) {
    assert.ok(text.includes(required), required);
  }
  assert.doesNotMatch(text, /SKILL DRIFT|SKILL BEHIND|propose_skills/);
  // The Claude app steps still equal the shared session-start reminder and install text.
  assert.ok(text.includes(`put the owner's steps under **Plugin:** for the coordinator's plugin card: ${STEPS_TEXT} Missing account copy`));
  assert.ok(text.includes('Omit empty bullets except Guidebook, Block, Binding, Tasks, Nudge, Plugin and Run.'));
  // The check-in holds no card, so no run of it, bound or fresh, keeps its thread open for one.
  const freshCheckIn = full('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], session: 'fresh' }));
  for (const rendered of [text, freshCheckIn]) assert.doesNotMatch(rendered, /skip the resolve in DELIVERY|posted a card/);
  // Both Toolkit tasks are bound now, so a bound check-in is never its own gap.
  assert.doesNotMatch(text, /the check-in runs a fresh session per run/);
  assert.match(text, /bound-session or fresh-session when that differs from the entry/);
  const nudge = rendered('hourly-nudge');
  // The cheap check reads the last run's state first and skips the full sweep when nothing moved;
  // the binding check is daily only. The nudge clones Toolkit once, in its guidebook step, every run:
  // the library folder can change while main is quiet, so the check never waits for a merge.
  assert.ok(nudge.indexOf('nudge-state.md') > -1 && nudge.indexOf('nudge-state.md') < nudge.indexOf('list_threads'), 'cheap compare before the sweep');
  assert.match(nudge, /no change since <time>/);
  assert.doesNotMatch(nudge, /BINDING|git ls-remote|guidebook checked/);
  // Toolkit once: decision traces and CI drift, which need the project's own checkout, run daily.
  assert.equal((nudge.match(/git clone/g) || []).length, 1);
  const guidebook = nudge.split('\n').find(line => line.startsWith('9. TOOL STEP (shell): Guidebook and controller check'));
  for (const required of ['runs every time, even when step 1 found no change', 'the library folder can change while main is quiet',
    '`git clone --depth 1 https://github.com/weijunswj/ai-agent-toolkit TK` in your scratchpad (a fresh clone)',
    '`node TK/repo/scripts/toolkit-controller-check.cjs --host projects --skip programme,traces,stale,ci,handoff`', 'adding `--repo example-owner/example-repo` when step 9a applies',
    '`CONTROLLER CHECK: clear ...`: write "**Guidebook:** current" and "**Controller check:** clear", and read no further',
    '`node TK/repo/scripts/toolkit-projects-guidebook.cjs --out /mnt/project-files/toolkit/web-controller-projects`', 'the same with `--check` in place of `--out`',
    '"BLOCK CHANGED <version> | "', '"SKILL COPY FAILED: <reason> | "', '"CONTROLLER CHECK: <n> | "']) assert.ok(guidebook.includes(required), required);
  assert.ok(nudge.includes('9a. Repository for step 9\'s controller check: it scans example-owner/example-repo for leftover footers, with no checkout'), 'no repository checkout hourly');
  assert.ok(nudge.includes('"SKILL COPY FAILED: <reason> | ", "CONTROLLER CHECK: <n> | "'), 'first-line prefix');
  assert.match(nudge, /report BLOCK CHANGED only when this run printed it/);
  assert.match(nudge, /plus steps 2a, 2b, 4, 4a, 5 and 7 to 11 \(and 5b when it applies\)/);
  assert.match(nudge, /CONTEXT RESET DUE \(age\)/);
  // Each task reports the other missing, so the coordinator recreates a deleted one.
  assert.ok(nudge.includes('is missing (no such trigger in list_triggers'), 'nudge sees a deleted check-in');
  assert.ok(rendered('daily-check-in').includes('is missing (no such trigger in list_triggers'), 'check-in sees a deleted nudge');
  assert.match(nudge, /The nudge's ping posts one line in its home thread; the coordinator relays it to the project chat and works this checklist that turn \(`ping-run.md`\), acting on every finding\./);
  assert.doesNotMatch(nudge, /It runs silently|read_project_chat \(limit 1\)|its only thread-resolve pass|with the three conditions or QUIET-6H/);
  for (const required of ['list a thread when (1) and (3) hold', 'the state file says the last thread scan was complete', '`scan: complete` or `scan: <read> of <total>`', 'and its backstop thread-resolve pass.',
    '**Resolve:** (threads with their own session, with conditions (1) and (3) and the relay state)', 'relay unverified', 'RESOLVE DUE: <n> | ', 'THREAD SCAN INCOMPLETE: <read> of <total> | ',
    'never report "none" for **Resolve:** from a partial scan', "the state file's resolve candidates that list_threads still shows unresolved", 'Idleness is never a reason', 'Never list a task home thread', 'Unrelayed', 'Hidden reply',
    'state done', '"EXAMPLE: Daily check-in"', 'CHECK-IN NOT ARMED', 'limit 10', 'list all of them every run']) {
    assert.ok(nudge.includes(required), required);
  }
  assert.match(nudge, /not SUCCEEDED, or its home thread is resolved, start the first line with "CHECK-IN NOT ARMED/);
});

// Task runs once reported only to the coordinator by message, so a recycled coordinator dropped
// them and the owner saw nothing. Each run now posts one line in its home thread and stamps a file
// only it writes; the coordinator stamps the relay, and the nudge and check-in flag any gap. Any
// template change already checks as outdated (the template-changed case above), so live prompts swap.
test('every kind and session keeps separate per-run reports and stamps, with scoped write permission', () => {
  const stamps = { 'daily-check-in': 'daily-check-in-example-a9eaed51fb', 'hourly-nudge': 'hourly-nudge-example-65865a7fc8', custom: 'custom-example-54f6cccf2f' };
  for (const [kind, slug] of Object.entries(stamps)) {
    for (const session of ['bound', 'fresh']) {
      const promptParams = validateParams(kind, { ...PARAMS[kind], session });
      const text = full(kind, promptParams, kind === 'custom' ? OWN_TEXT : undefined);
      const delivery = findBlocks(text).blocks.find(block => block.name === 'TASK-DELIVERY').body;
      const guard = text.split('\n').find(line => line.startsWith('- Read-only,'));
      const stamp = `/mnt/project-files/toolkit/task-runs/${slug}/<run UTC>.md`;
      const report = `${promptParams.report_dir}/runs/<run UTC>.md`;
      assert.ok(delivery.includes(report), `${kind} ${session}: per-run report`);
      assert.ok(delivery.includes(stamp), `${kind} ${session}: per-run stamp`);
      assert.ok(delivery.includes(`Full: ${report}`), 'home post names the immutable report');
      assert.match(delivery, /YYYYMMDDTHHMMSSZ/);
      assert.match(delivery, /Never overwrite an existing per-run report or stamp/);
      assert.match(delivery, /wait for a new UTC second/, 'replacement runs cannot reuse the same second');
      assert.ok(guard.includes(`report files under ${promptParams.report_dir}/`));
      assert.ok(guard.includes(`this task's own new run stamp and .failed files under /mnt/project-files/toolkit/task-runs/${slug}/`));
      assert.match(guard, /never a \.relayed file or a \.done file/);
      assert.match(delivery, /never write a \.relayed file or a \.done file/);
      const taskName = kind === 'custom' ? 'this task' : `EXAMPLE: ${kind === 'hourly-nudge' ? 'Hourly nudge' : 'Daily check-in'}`;
      assert.ok(delivery.includes(`| ${slug} | task ${taskName} | thread <this run's thread link> | ${report} |`));
      assert.match(delivery, /mcp__hearthbot__read_thread with no thread_id/);
      assert.match(delivery, /Never take the link from memory's current home thread/);
      assert.ok(delivery.indexOf('mcp__hearthbot__read_thread') < delivery.indexOf('Run stamp: create'));
      assert.ok(delivery.indexOf('Run stamp: create') < delivery.indexOf('Post exactly ONE message'));
      assert.doesNotMatch(delivery, /Full: [^\n]*\/latest\.md|overwrite \/mnt\/project-files\/toolkit\/task-runs\//);
      assertStable(kind, promptParams, kind === 'custom' ? OWN_TEXT : undefined, 'a refresh retains the current per-run contract');
    }
  }
});

test('all slugs hash the full identity and separate colliding paths, projects and kinds', () => {
  const rows = [
    ['custom', 'EXAMPLE', 'security/sweep', 'custom-example-04adabf650'],
    ['custom', 'EXAMPLE', 'security-sweep', 'custom-example-e911db3420'],
    ['custom', 'EXAMPLE', 'security_sweep', 'custom-example-dfc8560bc7'],
    ['custom', 'EXAMPLE', 'finance/sweep', 'custom-example-2a2d78d396'],
    ['custom', 'EXAMPLE', 'Security/Weekly__Sweep.v2', 'custom-example-15ad2d688f'],
    ['hourly-nudge', 'EXAMPLE', 'hourly-nudge', 'hourly-nudge-example-65865a7fc8'],
    ['daily-check-in', 'EXAMPLE', 'daily-check-in', 'daily-check-in-example-a9eaed51fb'],
    ['hourly-nudge', 'CUSTOM', 'hourly-nudge', 'hourly-nudge-custom-c70242e7ff'],
    ['custom', 'CUSTOM', 'hourly-nudge', 'custom-custom-5fc2496f87'],
    ['custom', 'EXAMPLE A', 'sweep', 'custom-example-a-11aec7629c'],
    ['custom', 'EXAMPLE-A', 'sweep', 'custom-example-a-a44b756653'],
    ['custom', 'EXAMPLE_A', 'sweep', 'custom-example-a-5d8ab9f2f1']
  ];
  const folders = rows.map(([kind, project, reportFolder, slug]) => {
    const promptParams = validateParams(kind, { ...PARAMS[kind], project, report_dir: `/mnt/project-files/${reportFolder}` });
    const text = full(kind, promptParams, kind === 'custom' ? OWN_TEXT : undefined);
    const folder = text.match(/Run stamp: create (\/mnt\/project-files\/toolkit\/task-runs\/[^/]+)\/<run UTC>\.md/)[1];
    assert.equal(folder, `/mnt/project-files/toolkit/task-runs/${slug}`);
    assertStable(kind, promptParams, kind === 'custom' ? OWN_TEXT : undefined, 'replacement task retains its identity');
    return folder;
  });
  assert.equal(new Set(folders).size, rows.length, 'custom/custom and custom/Toolkit folders stay distinct');
});

test('old custom shells remain outdated advice until the owner approves that task update', () => {
  const old = new ProjectsTasks({ root: ROOT, readFile(target, encoding) {
    if (target === path.join(TASKS, 'run-setup.md')) return 'RUN SETUP\n- Read-only except report files under {{report_dir}}/.';
    if (target === path.join(TASKS, 'delivery.md')) return 'DELIVERY\n- Write the full report to {{report_dir}}/latest.md (overwrite), then read it back.\n- Send ONE message with mcp__hearthbot__message_coordinator: the first line, then "Full: {{report_dir}}/latest.md".';
    return fs.readFileSync(target, encoding);
  } });
  for (const session of ['bound', 'fresh']) {
    const promptParams = validateParams('custom', { ...PARAMS.custom, session });
    const text = full('custom', promptParams, OWN_TEXT, old);
    assert.equal(tasks().check('custom', text).state, 'outdated');
    assert.match(text, /Full: \/mnt\/project-files\/sweep\/latest\.md/);
    assert.doesNotMatch(text, /task-runs\/|Run stamp:|\.relayed|\.done/);
    const updated = tasks().refresh('custom', text);
    assert.equal(tasks().check('custom', updated).state, 'current');
    assert.ok(updated.includes(OWN_TEXT));
    assert.match(tasks().expand('custom', promptParams), /task-runs\/custom-example-[0-9a-f]{10}\/<run UTC>\.md/);
  }
  const checkIn = rendered('daily-check-in');
  assert.ok(checkIn.includes('old shell: no run stamp or catch-up until the owner OKs the shell update'));
  assert.match(checkIn, /gets no catch-up or relay gap check/);
  assert.match(checkIn, /Keep its stored prompt until that task's owner-approved shell update/);
});

test('delivery ending matrix covers all sends in every kind and session without claiming success', () => {
  const endings = [
    ['Home post succeeded:', true],
    ['Home post failed but coordinator message succeeded:', false],
    ['Every send failed:', false]
  ];
  for (const kind of Object.keys(PARAMS)) {
    for (const session of ['bound', 'fresh']) {
      const text = full(kind, validateParams(kind, { ...PARAMS[kind], session }), kind === 'custom' ? OWN_TEXT : undefined);
      const delivery = findBlocks(text).blocks.find(block => block.name === 'TASK-DELIVERY').body;
      const lines = delivery.split('\n');
      for (const [label, homePostSucceeded] of endings) {
        const matches = lines.filter(line => line.startsWith(`- ${label}`));
        assert.equal(matches.length, 1, `${kind} ${session}: ${label}`);
        const [ending] = matches;
        if (session === 'fresh') {
          assert.match(ending, /resolve this run's own thread with mcp__hearthbot__set_thread_resolved \(resolved: true\), then end with mcp__hearthbot__no_reply_needed/);
        } else {
          assert.doesNotMatch(ending, /set_thread_resolved/);
          if (homePostSucceeded) {
            assert.match(ending, /that post is the last call/);
            assert.doesNotMatch(ending, /no_reply_needed/);
          } else assert.match(ending, /end with mcp__hearthbot__no_reply_needed/);
        }
        if (label === 'Every send failed:') {
          const failure = lines.find(line => line.startsWith('- Failure file:'));
          const stampPath = delivery.match(/Run stamp: create ([^\n]+?) with one line/)[1];
          assert.ok(failure.includes(stampPath.replace(/\.md$/, '.failed')));
          assert.match(failure, /create .* exclusively with one line "DELIVERY FAILED \| <the report's first line>", then read it back/);
          assert.match(failure, /Never overwrite it or amend the run stamp/);
          assert.match(ending, /create the \.failed file above, state the failure in this turn's last text/);
          assert.ok(delivery.indexOf("DELIVERY FAILED | <the report's first line>") < delivery.indexOf(ending) + ending.indexOf('no_reply_needed'));
        }
      }
      assert.match(delivery, /at most 1,500 characters/);
      assert.match(delivery, /retry once/);
      assert.match(delivery, /never claim it was delivered/);
      assert.doesNotMatch(delivery, /say plainly in this turn's last text|only when no post was made/);
    }
  }
});

test('old mutable delivery checks as outdated at the same version and refreshes in every mode', () => {
  const oldDelivery = 'DELIVERY\n- Write the full report to {{report_dir}}/latest.md (overwrite), then read it back.\n- Run stamp: overwrite /mnt/project-files/toolkit/task-runs/{{task_slug}}.md with one line.';
  const old = new ProjectsTasks({ root: ROOT, readFile(target, encoding) {
    return target === path.join(TASKS, 'delivery.md') ? oldDelivery : fs.readFileSync(target, encoding);
  } });
  for (const kind of Object.keys(PARAMS)) {
    for (const session of ['bound', 'fresh']) {
      const promptParams = validateParams(kind, { ...PARAMS[kind], session });
      const text = full(kind, promptParams, OWN_TEXT, old);
      assert.equal(tasks().check(kind, text).state, 'outdated');
      const updated = tasks().refresh(kind, text, kind === 'custom' ? {} : { additions: OWN_TEXT });
      assert.equal(tasks().check(kind, updated).state, 'current');
      if (kind !== 'custom') {
        assert.equal(tasks().additions(kind, text), OWN_TEXT, 'owner steps move to project-additions.md');
        assert.equal(updated.includes("resolve this run's own thread"), session === 'fresh', 'the ping\'s ending follows the session');
        continue;
      }
      assert.ok(updated.includes(OWN_TEXT), 'owner steps survive the refresh');
      const loaded = tasks().expand(kind, promptParams);
      assert.ok(loaded.includes(`${promptParams.report_dir}/runs/<run UTC>.md`));
      assert.equal(loaded.includes('mcp__hearthbot__set_thread_resolved'), session === 'fresh');
      assert.equal(updated.includes('mcp__hearthbot__set_thread_resolved'), session === 'fresh', 'the pointer\'s load-failure ending follows the session too');
    }
  }
});

test('nudge and check-in watch every pending run, ignore stopped tasks and use the complete lane rule', () => {
  const nudge = rendered('hourly-nudge');
  for (const required of ['10. TOOL STEP (shell, task reads): Task runs (runs every time', 'node TK/repo/scripts/toolkit-projects-run-missed.cjs --input <file>',
    '`receipts` (each <run UTC> there with a .relayed or .done file, mapped to `relayed` and `done` with each file\'s text)', '"UNRELAYED TASK RUNS: <n> | "', '11. Lanes (runs every time', '"LANES UNDER CAP: <working> of <cap>, queue <n> | "', '**Lanes:**',
    'no thread in list_threads other than this home thread has activity', 'page read_project_chat with limit 10 to its last page']) {
    assert.ok(nudge.includes(required), required);
  }
  const checkIn = rendered('daily-check-in');
  assert.ok(checkIn.includes('"RELAY GAP: <task name>[, <task name>] | "'));
  assert.ok(checkIn.includes('advice: no home-thread line or run stamp; opt into the Toolkit shell (custom) to get both'));
  assert.ok(checkIn.includes('TASKS OUTDATED, RELAY GAP, NUDGE NOT ARMED'));
  assert.match(checkIn, /including tasks whose older runs are still unrelayed even if their latest run was relayed/);
  // The receipt states are counted by the run check, not by hand (its own tests cover each state and the 5-line cap).
  assert.match(nudge, /it flags fires with no stamp \(`RUN MISSED`\), runs never relayed or never finished \(`RUN PENDING`\), receipts out of order or empty \(`RECEIPT BROKEN`\) and receipts with no stamp \(`RECEIPT ORPHAN`\)/);
  assert.match(nudge, /Old custom shells without a stamp have no catch-up or relay gap check until their owner-approved shell update/);
  const quickCheck = nudge.split('\n').find(line => line.startsWith('1. Cheap check'));
  assert.match(quickCheck, /ignore activity that is only the coordinator relaying a task run, whether a post or an Update line naming a task run/);
  assert.match(quickCheck, /owner messages and other coordinator posts still count/);
  const lanes = nudge.split('\n').find(line => line.startsWith('11. Lanes'));
  for (const excluded of ['task home threads', "the coordinator's own", 'post reply threads',
    'the one extra lane kept for a sudden owner request', 'work waiting on the owner', 'PRs waiting on CI or the review queue']) {
    assert.ok(lanes.includes(excluded), excluded);
  }
  for (const line of [nudge.split('\n').find(line => line.startsWith('10. TOOL STEP (shell, task reads): Task runs')),
    checkIn.split('\n').find(line => line.startsWith('   RELAY GAP:'))]) {
    assert.match(line, /skip(?:ping)? every run stamp of a task whose SCHEDULED TASKS entry says "stopped by owner"/);
    assert.ok(line.indexOf('stopped by owner') < line.indexOf('.relayed'), 'stop filter precedes acknowledgement inspection');
    assert.match(line, /Match built-in task names from their stamps and custom slugs from saved prompts' DELIVERY to that entry/);
    assert.match(line, /hold and report an unknown or ambiguous mapping/);
    assert.match(line, /<slug>\//);
    assert.match(line, /<run UTC>\.md/);
    assert.doesNotMatch(line, /newer than its \.relayed run time|<slug>\.md/);
  }
});

test('memory check reads only the BINDING and SCHEDULED TASKS lines', () => {
  const binding = `- BINDING: example-owner/ai-agent-toolkit main commit ${'a'.repeat(40)} CONTROLLER.md blob ${'b'.repeat(40)} toolkit 3.10.1 skill 2026-10-24.5 bound 2026-10-24`;
  const tasksLine = '- SCHEDULED TASKS: EXAMPLE: Daily check-in | trig_01abc | CRON_TZ=Asia/Singapore 47 8 * * * | fresh; EXAMPLE: Hourly nudge | trig_02def | CRON_TZ=Asia/Singapore 37 * * * * | bound home cmsg_03ghi since 2026-10-24; Sweep | trig_04jkl | CRON_TZ=Asia/Singapore 0 9 * * 1-5 | local | owner schedule';
  const rows = [
    [`# Memory\n${binding}\n${tasksLine}\n- Owner note: anything at all.\n`, ['current'], 0],
    [`${tasksLine}\n`, ['MEMORY FORMAT: BINDING missing'], 1],
    [`${binding.replace(' toolkit 3.10.1', '')}\n${tasksLine}\n`, ['MEMORY FORMAT: BINDING old format'], 1],
    [`${binding}\n${binding}\n${tasksLine}\n`, ['MEMORY FORMAT: BINDING more than one line'], 1],
    [`${binding}\n`, ['MEMORY FORMAT: SCHEDULED TASKS missing'], 1],
    [`${binding}\n- SCHEDULED TASKS: EXAMPLE daily trig_01abc\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | stopped by owner 2026-10-25;')}\n`, ['current'], 0],
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | stopped;')}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    [`${binding}\n${tasksLine.replace('fresh;', 'sometimes;')}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    // A recorded raise survives swaps; it names tier, effort, date and reason.
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | raised top/high 2026-10-25: licence calls the owner acts on;')}\n`, ['current'], 0],
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | raised top/high 2026-10-25: licence calls | stopped by owner 2026-10-26;')}\n`, ['current'], 0],
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | raised top/low 2026-10-25: below the floor;')}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | raised top/high 2026-10-25;')}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    // A reason can never pass for the owner's stop or schedule marks.
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | raised top/high 2026-10-25: x stopped by owner 2026-10-26;')}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', 'since 2026-10-24 | raised top/high 2026-10-25: kept for the owner schedule;')}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1],
    ...['x Stopped By Owner 2026-10-26', 'x stopped  by owner 2026-10-26', 'kept for owner-schedule', 'x stopped by the owner 2026-10-26',
      // The same characters and length as the raise_reason param.
      'a{b}c', 'a`b', 'ab', 'x'.repeat(201)
    ].map(reason => [`${binding}\n${tasksLine.replace('since 2026-10-24;', `since 2026-10-24 | raised top/high 2026-10-25: ${reason};`)}\n`, ['MEMORY FORMAT: SCHEDULED TASKS old format'], 1]),
    [`${binding}\n${tasksLine.replace('since 2026-10-24;', `since 2026-10-24 | raised top/high 2026-10-25: ${'x'.repeat(200)};`)}\n`, ['current'], 0],
    ['', ['MEMORY FORMAT: BINDING missing', 'MEMORY FORMAT: SCHEDULED TASKS missing'], 1]
  ];
  for (const [text, lines, exitCode] of rows) assert.deepEqual(checkMemory(text), { lines, exitCode }, text);
  // The raise reason is printable ASCII on one line: a line break or invisible character inside it is
  // refused, so no reader sees a stop or schedule mark the check does not. CRLF is a real line end.
  const withReason = reason => `${binding}\n${tasksLine.replace('since 2026-10-24;', `since 2026-10-24 | raised top/high 2026-10-25: reason ${reason} end;`)}\n`;
  hostile.expectDefaultDeny(assert, text => checkMemory(withReason(text)).exitCode === 0, hostile.cases(['line-breaks', 'invisible']), {
    allow: ['crlf-line-end', 'crlf-then-lone-cr']
  });
});

function inventoryStepContract(inventory, playbook) {
  for (const row of inventory.rows) {
    for (const step of row.setup_steps) {
      assert.match(step, /^(?:P[1-6]|generic-[1-9]\d*)$/, `${row.id}: ${step}`);
      if (step.startsWith('generic-')) assert.ok(playbook.includes(`### ${step.slice(8)}. `), `${row.id}: ${step} heading`);
    }
    for (const [, step] of row.source.matchAll(/generic step (\d+)\b/g)) {
      assert.ok(playbook.includes(`### ${step}. `), `${row.id}: generic step ${step} source heading`);
    }
  }
}

test('T7 every setup step that creates something has an inventory row, and every row is checked by the daily check-in, a registered launch hook or a written rule', () => {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const playbook = fs.readFileSync(path.join(ROOT, 'repo/docs/agent-playbooks/controller-takeover.md'), 'utf8').replace(/\r\n/g, '\n');
  inventoryStepContract(inventory, playbook);
  const invalid = structuredClone(inventory);
  invalid.rows[0].setup_steps.push('generic-11');
  assert.throws(() => inventoryStepContract(invalid, playbook), { code: 'ERR_ASSERTION' }, 'generic-11 has no heading');
  assert.throws(() => inventoryStepContract(inventory, playbook.replace('### 5. ', '### Missing. ')),
    { code: 'ERR_ASSERTION' }, 'generic-5 has no heading');
  const sourceOnly = structuredClone(inventory);
  sourceOnly.rows[0].source += '; generic step 11';
  assert.throws(() => inventoryStepContract(sourceOnly, playbook), { code: 'ERR_ASSERTION' }, 'source step has no heading');
  const invalidId = structuredClone(inventory);
  invalidId.rows[0].setup_steps.push('P7');
  assert.throws(() => inventoryStepContract(invalidId, playbook), { code: 'ERR_ASSERTION' }, 'P7 is not a setup step');
  const setup = fs.readFileSync(SETUP, 'utf8').replace(/\r\n/g, '\n');
  assert.match(fs.readFileSync(SKILL, 'utf8'), /reference\/setup\.md/, 'the skill routes setup to its reference file');
  const steps = [...setup.matchAll(/^(P[1-6])\. \*\*/gm)].map(match => match[1]);
  assert.deepEqual(steps, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  assert.ok(setup.indexOf('`takeover.md` first') < setup.indexOf('P1. **'));
  const covered = new Set(inventory.rows.flatMap(row => row.setup_steps));
  for (const step of steps) {
    assert.ok(covered.has(step) || Object.prototype.hasOwnProperty.call(inventory.steps_without_artefacts, String(step)), `setup step ${step}`);
  }
  for (const step of Object.keys(inventory.steps_without_artefacts)) assert.ok(!covered.has(step), `step ${step} listed twice`);
  const template = fs.readFileSync(path.join(TASKS, 'daily-check-in.md'), 'utf8');
  for (const row of inventory.rows) {
    assert.match(row.resync, /^(auto|owner|report)\b/, row.id);
    // A row a launch hook enforces names that hook's script, which must exist and be registered in the Claude Code
    // plugin; a row a written rule covers names the file that holds the rule; every other row is in the check-in.
    const hook = row.check.match(/^hook: (\S+)$/);
    const rule = row.check.match(/^rule: (\S+)$/);
    if (rule) assert.ok(fs.existsSync(path.join(ROOT, rule[1])), `${row.id}: ${rule[1]}`);
    else if (hook) {
      assert.ok(fs.existsSync(path.join(ROOT, hook[1])), `${row.id}: ${hook[1]}`);
      assert.ok(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8').includes(`/${hook[1]}\\"`), `${row.id}: ${hook[1]} registered`);
    }
    else if (row.check !== 'never changed') assert.ok(template.includes(row.check), `${row.id}: ${row.check}`);
  }
  assert.equal(new Set(inventory.rows.map(row => row.id)).size, inventory.rows.length);
});

test('invalid arguments and unreadable input fail with one generic error', t => {
  const prompt = file(t, 'p.md', rendered('daily-check-in'));
  for (const args of [[], ['--render', 'daily-check-in'], ['--render', 'nope', '--params', prompt], ['--check', 'daily-check-in'],
    ['--check', 'daily-check-in', prompt, '--write', 'x'], ['--check', 'daily-check-in', path.join(path.dirname(prompt), 'absent')],
    ['--params-from'], ['--params-from', file(t, 'none.md', 'no params here')], ['--check-memory'],
    ['--render', 'daily-check-in', '--params', prompt], ['--name', 'daily-check-in', '--params']]) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Task prompt could not be processed (PROJECT_TASKS_INVALID).\n');
  }
  const result = run(['--params-from', prompt]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).project, 'EXAMPLE');
  assert.throws(() => parseArgs(['--refresh', 'daily-check-in', prompt, '--params', 'a', '--params', 'b']));
  assert.equal(parseArgs(['--refresh', 'daily-check-in', prompt, '--session', 'bound']).session, 'bound');
  assert.throws(() => parseArgs(['--check', 'daily-check-in', prompt, '--session', 'bound']));
});

test('every line that re-arms, updates, swaps, rebuilds, recreates or sets up a Toolkit task honours a stopped by owner entry', () => {
  // Scans by what a line does, not where it sits, so a new path that forgets the exception fails
  // here, whatever it calls the task (a job, a schedule, a home thread, both).
  // The named lines are not automatic paths: introductions, how a task is created or rendered (every
  // path that uses them carries the exception), the project's own tasks, the tool route, the steps
  // under the swap paragraph (which carries the exception), runs of the task itself, and thread
  // resolving.
  const dir = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects');
  const files = ['SKILL.md', 'project-instructions.md', ...['reference', 'tasks'].flatMap(sub => fs.readdirSync(path.join(dir, sub)).filter(name => name.endsWith('.md')).map(name => `${sub}/${name}`))];
  const acts = /\b(?:re-?arm|rebuil[dt]|re-?creat|swap|catch(?:es)? (?:it )?up|set up the|re-?enabl|restor|refresh|replac|switch|re-?add|resum|fire (?:it |them )?again|update (?:the|those|its)\b[^.]*prompt|creat(?:e|es) (?:it|them|the|a)\b|starts? (?:a )?new home thread)/i;
  for (const line of ['Re-arm any recurring job that missed its run.', 'Rebuild the home thread when it is a week old.', 'Re-create the schedule when its cron drifts.',
    'Swap both from the template on main.', 'Start a new home thread for it.', 'The coordinator creates it again from main.']) assert.match(line, acts, line);
  const notPaths = [
    'Whenever the user asks for anything recurring', "**The project's own tasks**", 'Reference for the `web-controller-projects` skill',
    'A cloud thread creates, recreates and deletes tasks', '3. Same session as the entry', '4. Rewrite the `SCHEDULED TASKS:` line', '7. Age rebuild:', '**It is bound to its own home thread,**',
    'Every Toolkit scheduled task is bound to its own home thread (`<PROJECT>: <task name>`): start', '**Toolkit-made tasks** (the daily check-in and the hourly nudge) are rendered', 'Resolve candidates:',
    'When a recurring task replaces an older one, delete the older one',
    'Toolkit-made task swaps under their safeguards', 'so the coordinator rebuilds this home thread', '2. Render the new prompt',
    // Rows of the base overrides list and the cloud hook table: they name rules and hooks, not task paths.
    'Task auto-merge switch is the project line', 'The hourly programme sweep refreshes programme pages', '`toolkit-governance-hook.cjs` (merge hold) |', '`toolkit-github-footer-hook.cjs` |', '`toolkit-programme-checkpoint-hook.cjs` |',
    // Lines about other things that happen to use one of the verbs: repos, setup, GitHub reads,
    // shared checkouts, Remote Control, the instructions sync and the repo map.
    // These endings create only a receipt for the current run, never a task or schedule.
    '- Every send failed: create the .failed file above,',
    // The ping's transition label names the swap it asks for; a stopped task never fires to print it.
    'This run was loaded by an old pointer prompt',
    // These resume existing local rc conversations; none creates, resumes or changes a scheduled task.
    '**Build one complete list.**', '**Recovery is an owner ask.**', '**Deduplicate recovery reminders.**',
    '- A project with no repo attached gets this coordinator contract', 'Before any other work as a newly appointed controller', '**Threads do GitHub reads.**',
    '- Local sessions sharing one checkout must not clash', '**Remote Control wake.**', '4. Check the result: `--check` reads `current`', '5. Post one short note in project chat: block version',
    '- On undo, restore the saved copy and record `declined project-instructions', '**Dedupe in the same change.**', '**Evidence before "done":**',
    'start a bounded G0 to create or refresh it before you plan anything',
    // The cloud Programme Sweep is a GitHub workflow, not a project task: these lines say no computer task is set up.
    '**Programme pages refresh themselves in the cloud.**', '**Programme sweep in the cloud.**',
    // The reconciler's `refresh` command brings programme pages up to date; it touches no task.
    '**Programme pages refresh themselves, without tokens.**', '5b. TOOL STEP (shell, GitHub): Programme sweep',
    // The attention check reads the programme with `attention --refresh`; it touches no task.
    '**Programme attention before gates, finality and settling.**',
    // The guidebook refresh rewrites the library copy of the skill and the block file; it touches no task.
    '**Read it every turn**', '**One refresh, three routes.**', 'refreshes a stale or changed copy itself', 'start a cloud thread for the refresh at once', 'The daily check-in is the backstop',
    '**BLOCK CHANGED:**', '**Missing folder:**', '`SKILL COPY FAILED`: start one fresh refresh thread', 'a guidebook refresh reports BLOCK CHANGED', '`GUIDEBOOK MISSING` or `SKILL COPY STALE`',
    '9. the guidebook:', 'coordinator: refresh the guidebook', 'the guidebook refresh brings both here', '- Projects guidebook:', "Read the guidebook's `VERSION`",
    'library copy of the Projects skill (the guidebook)', 'and the guidebook refresh (step 9)', '9. TOOL STEP (shell): Guidebook and controller check (runs every time', 'With BLOCK CHANGED, the coordinator replaces the block',
    '**Refresh routes, a missing folder and `SKILL COPY FAILED`:**', '# Web Controller for Claude Projects: guidebook refresh', '## Refreshing the guidebook copy',
  ];
  const unguarded = [];
  for (const rel of files) {
    fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
      if (acts.test(line) && !/stopped by owner|owner stopped them/.test(line) && !notPaths.some(text => line.includes(text))) unguarded.push(`${rel}:${index + 1}: ${line.slice(0, 120)}`);
    });
  }
  assert.deepEqual(unguarded, []);
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.match(skill, /\*\*Stopped by owner:\*\* a task whose `SCHEDULED TASKS:` entry says `stopped by owner` is outside every automatic path/);
  assert.match(skill, /the restart removes the mark/);
  assert.match(fs.readFileSync(path.join(dir, 'reference', 'recurring-tasks.md'), 'utf8'), /When the owner restarts it, remove the mark\./);
  assert.match(fs.readFileSync(path.join(dir, 'reference', 'recurring-tasks.md'), 'utf8'), /--refresh <kind> <old prompt file> --session <bound\|fresh>`, adding `--additions-saved <that file>` when there were additions \(it refuses without them\); it keeps the params and a project task's text and always names the session the replacement runs in/);
});

// A run that starts outside its home thread (for example fire_trigger from another thread) has no
// project tools or files: its first RUN SETUP step stops it with one line, in every kind and session.
test('every rendered task stops first when it started outside its home thread', () => {
  const guard = '- First check, before anything else: if this turn has no mcp__hearthbot__ tools (listed directly or as deferred tools) or cannot read /mnt/project-files/, it started outside its home thread or project. Make no other tool call (no effort call, message, file write, resolve or retry) and skip every later step, DELIVERY included: end the turn with the single line "skipped: started outside its home thread".';
  for (const kind of Object.keys(PARAMS)) {
    for (const session of ['bound', 'fresh']) {
      const text = full(kind, validateParams(kind, { ...PARAMS[kind], session }), kind === 'custom' ? OWN_TEXT : undefined);
      const lines = text.split('\n');
      const heading = lines.findIndex(line => line.startsWith('RUN SETUP ('));
      assert.ok(heading > -1, `${kind} ${session}`);
      assert.equal(lines[heading + 1], guard, `${kind} ${session}`);
    }
  }
});

// The nudge's due time comes from its own cron, so waking-hours gaps and slower nudges are not late.
test('the check-in reads the nudge due time from its own cron', () => {
  const text = rendered('daily-check-in');
  for (const required of ['the newest time at or before now when the cron fires', 'hours outside its waking window never count', 'use its interval plus 5 minutes instead of 65 minutes', 'a nudge with no run yet, as after a swap, counts as armed while its next run is within one interval of now']) {
    assert.ok(text.includes(required), required);
  }
});

// These check the instruction contract, not the Projects model's interpretation; that remains UAT.
for (const [variant, repo] of [['repo', 'example-owner/example-repo'], ['Toolkit', 'weijunswj/ai-agent-toolkit'], ['no repo', 'none']]) {
  for (const session of ['bound', 'fresh']) {
    test('plugin baseline and evidence contract: ' + variant + ', ' + session, () => {
      const promptParams = validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo, parent_issue: repo === 'none' ? 'none' : '12', session });
      const text = full('daily-check-in', promptParams);
      const plugin = text.slice(text.indexOf('10. TOOL STEP (shell): PLUGIN BEHIND:'), text.indexOf('11. TOOL STEP (GitHub): GitHub'));
      const rows = [
        ['copies found by name prefix', [/\/root\/\.claude\/plugins\/synced\/\*\/ai-agent-toolkit\*\//, /the host can rename a copy, for example `ai-agent-toolkit~g2`/, /holds `\.claude-plugin\/plugin\.json`/]],
        ['pinned until the container restarts', [/stays pinned until the container restarts/]],
        ['sync time from the host manifest, renewed every start', [/`stat -c %Y <bucket>\/manifest\.json`/, /rewrites at every container start, even when no plugin changed/]],
        ['never a folder or plugin file time', [/Never use a plugin file's mtime \(synced files read 1980-01-01\) or the copy folder's own birth or change time as the sync time: an unchanged copy keeps its folder from an earlier start/]],
        ['folder birth time only as a lower bound', [/earlier than the copy folder's birth time \(`stat -c %W <copy>`, when above 0\), use that birth time instead/]],
        ['never the session start or other clocks', [/Never use this session's start, which stays old while the container re-syncs the copy/, /never the coordinator's thread, the trigger creation time/]],
        ['valid non-future time in UTC', [/Accept only a whole number of seconds above 0 that is not in the future/, /date -u -d @<seconds> \+%FT%TZ/]],
        ['newest of several copies, the others with version and sync time', [/Several copies: use the one with the newest sync time, read its version and list each other copy under \*\*Plugin:\*\* with its version and sync time/]],
        ['historical first-parent baseline', [/git -C TK rev-list -1 --first-parent --before=<sync time> HEAD/, /git -C TK show B:\.claude-plugin\/plugin\.json/]],
        ['unavailable sync time falls back to today explicitly', [/Missing manifest, zero, invalid, future or unreadable sync time: use today's HEAD as B/, /sync time unavailable; comparing with main today/, /Otherwise baseline mode is sync-time/]],
        ['numeric version comparison', [/Compare version components numerically \(3\.9\.0 is older than 3\.10\.0\), never as strings/]],
        ['current today', [/equal to today's main: "\*\*Plugin:\*\* current \(<version>\)"/]],
        ['matches or exceeds baseline, below today', [/Equal to or newer than the selected baseline, but older than today's main/, /pinned copy synced at <time>; observed <account>, baseline <baseline> at <commit7>, main today <main>/, /verified pinned report gets no PLUGIN BEHIND prefix, owner steps or plugin card/]],
        ['ahead of today', [/newer than today's main is reported as ahead/, /no prefix, owner steps or card/]],
        ['only real baseline lag is aged', [/Only a copy older than the selected baseline enters the lag-age calculation/, /--format='%h %cI' B -- \.claude-plugin\/plugin\.json/, /next newer commit on the first-parent path up to B/, /oldest commit up to B whose version is above the account's/]],
        ['lag age measured at the sync time', [/Measure the age from that commit's time to the sync time \(to now in baseline mode today\)/]],
        ['at and below the threshold, no card', [/At or below 24 hours:[^\n]*no prefix, owner steps or card/]],
        ['strictly above the threshold', [/Strictly more than 24 hours:/, /PLUGIN BEHIND: <account> vs <baseline> \|/, /only for this verified more-than-24-hours gap put the owner's steps/]],
        ['repeat runs dedupe the baseline', [/unless state\.md has "plugin behind <baseline version>"/, /Dedupe once per selected baseline version, even when today's main advances again; retain the genuine gap and its steps on repeat runs/]],
        ['one bounded history retry', [/historical baseline or lag-age evidence is missing from a shallow clone/, /fetch --unshallow` once in total/, /retry the affected reads/]],
        ['failed or unavailable evidence holds', [/A failed unshallow, missing historical baseline or still-missing lag-age evidence is stuck\/unverified/, /no PLUGIN BEHIND prefix, owner steps or plugin card/, /Never substitute today's baseline for missing historical evidence, invent a date\/version or clear an earlier lag marker on uncertainty/, /no proven transition and time, use the stuck\/unverified rule/]],
        ['copy unavailable or invalid', [/Missing\/unreadable copy or invalid version: report unverified and no prefix, owner steps or plugin card/]],
      ];
      for (const [label, patterns] of rows) for (const pattern of patterns) assert.match(plugin, pattern, label);
      assert.doesNotMatch(plugin, /ccr\.created_at|session start unavailable/, 'the session start is no longer a baseline');
      assert.doesNotMatch(plugin, /stat -c '%W %Z'|means its change time|synced\/\*\/ai-agent-toolkit\//, 'no folder-time sync source or exact copy name');
      const state = text.split('\n').find(line => line.startsWith('- Overwrite '));
      for (const pattern of [/baseline mode \(sync-time or today\)/, /validated sync time in UTC \(or unavailable\)/,
        /baseline commit\/version and observed version \(or unverified\)/, /carry it forward while that gap remains, even on an unverified run/,
        /including a legacy "plugin behind <main version>"/, /only when this run verifies current, pinned or ahead; uncertainty never clears it/]) assert.match(state, pattern);
      assert.match(text, /Recompute the baseline in step 10 each run; an old state record is never evidence/);
      assertStable('daily-check-in', promptParams, undefined, 'repeat refresh is stable');
    });
  }
}

test('hook note covers changed, deleted, unchanged and unavailable evidence without new actions', () => {
  const text = rendered('daily-check-in');
  const note = text.split('\n').find(line => line.startsWith('   Hook note:'));
  for (const pattern of [/observed plugin is older than today's main and the sync-time baseline is verified/,
    /first-parent range `B\.\.HEAD`/, /\.claude-plugin\/hooks\/hooks\.json/, /`hooks\/hooks\.json`/,
    /changed\/deleted hook entry scripts named by either the baseline or current manifests/, /resolve their plugin-root paths/,
    /\*hook\*\.cjs/, /\*hook\*\.ps1/, /exactly one advisory sentence/, /home thread may retain older hooks/,
    /fresh home thread after account sync can load the updated copy/, /No changes: omit the advisory/,
    /changed since this copy was synced/, /Missing history or manifests needed for this comparison, or unavailable sync time/, /hook check unverified/,
    /manifest proven absent at a revision is a deletion\/addition, not a failed read/, /Never infer which hooks ran/,
    /no prefix, plugin card, owner update steps or automatic thread rotation/]) assert.match(note, pattern);
});

test('today-only plugin prompts become outdated at the same version and refresh preserves owner text in every mode', () => {
  const earlier = new ProjectsTasks({ root: ROOT, readFile(target, encoding) {
    const text = fs.readFileSync(target, encoding);
    return target === path.join(TASKS, 'daily-check-in.md')
      ? text.replace(/^10\. PLUGIN BEHIND:[\s\S]*?(?=^\[repo\]11\.)/m, '10. PLUGIN BEHIND: compare the account version with main today.\n') : text;
  } });
  for (const repo of ['example-owner/example-repo', 'weijunswj/ai-agent-toolkit', 'none']) {
    for (const session of ['bound', 'fresh']) {
      const promptParams = validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo, parent_issue: repo === 'none' ? 'none' : '12', session });
      const old = full('daily-check-in', promptParams, undefined, earlier).replace('- none', '- Keep this owner check.');
      assert.equal(tasks().check('daily-check-in', old).state, 'outdated');
      const moved = tasks().additions('daily-check-in', old);
      assert.ok(moved.includes('Keep this owner check.'), 'owner text moves to project-additions.md');
      const refreshed = tasks().refresh('daily-check-in', old, { session, additions: moved });
      assert.equal(tasks().check('daily-check-in', refreshed).state, 'current');
      assert.ok(full('daily-check-in', promptParams).includes('stat -c %Y <bucket>/manifest.json'), 'the checklist the coordinator works reads the sync time');
      assert.equal(refreshed.match(/```toolkit-task-params\n([\s\S]*?)\n```/)[1], old.match(/```toolkit-task-params\n([\s\S]*?)\n```/)[1]);
    }
  }
});

test('rendered hourly nudges always reconcile owner asks and recovery, including quiet runs', () => {
  for (const repo of ['example-owner/example-repo', 'none']) {
    for (const session of ['bound', 'fresh']) {
      const text = full('hourly-nudge', validateParams('hourly-nudge', {
        ...PARAMS['hourly-nudge'], repo, session
      }));
      for (const phrase of ['plus steps 2a, 2b, 4, 4a, 5 and 7 to 11 (and 5b when it applies)',
        'skip the other checks in steps 2 to 6', '2a. Owner asks (runs every time, including the no-change path)',
        'Page the inventories and read enough source history to identify each ask and any later answer or completed action',
        'also check older asks absent from later relays',
        'A newer unrelated post or a thread-title link without the ask does not prove relay',
        'regardless of whether their thread is working, blocked or recently resolved',
        "Follow step 2's recent-resolved-thread window; report unavailable history or incomplete coverage plainly",
        'the source thread linked by its title, the ask and its source time',
        '"notification unverified"', 'do not infer notification from an edit timestamp',
        'this task does not post a separate owner notification or mark an ask relayed',
        'unless the earlier one neared 8 KB or the later fresh post carries a new actionable owner ask under **Call-to-action pings** in SKILL.md',
        '(verify the actual new ask before accepting that exception)',
        '4. Remote Control (runs every time, even when step 1 found no change)',
        'page through list_threads and reconcile the local rc lanes with the remote_control_status inventory',
        'an active session that is not connected or served is parked',
        'Skip finished, superseded, resolved, cloud and already-working lanes',
        'type anything, such as `.`', 'a parked status or a successful task run alone does not prove',
        'This task never wakes lanes, posts a separate recovery announcement or edits',
        'End RC candidates for running sessions whose threads are finished or resolved',
        "Reuse step 4's current Remote Control findings", 'Do not count it as working because a coordinator message was sent to it',
        '"UNRELAYED ASK: <n> | "', '**Unrelayed:**', '**Waiting on owner:**',
        'A lane whose device is confirmed not reachable also goes under **Waiting on owner:**', 'the step "bring Claude on that device back online"',
        '"UNRELAYED ASK: <n> | ", "DEVICE OFFLINE: <n> | ", "ROTATE DUE: <n> | ", "LANES UNDER CAP:', '"WORK QUEUE: <n> | ", "PROGRAMME FINDINGS: <n> new | ", "CLOUD SWEEP: <why> | " and "NEEDS SETUP: <check>: <what to add, and where> | " prefixes',
        'the programme graph is the queue', 'it needs the coordinator\'s step this turn even when lanes are full', 'A failed status read is "could not be checked", never offline',
        'An action request remains outstanding until its required action occurs; a reaction alone acknowledges it']) {
        assert.ok(text.includes(phrase), `${repo}/${session}: ${phrase}`);
      }
      assert.doesNotMatch(text, /type `continue`|skip the other steps from 2 to 6/);
    }
  }
});

test('coordinators act on task warnings: backlog, rotation and missing set-up are explicit, never noise', () => {
  const nudge = rendered('hourly-nudge');
  // The ping flags its own backlog from its run folder (D1), so the owner sees it in the home thread
  // even with no coordinator awake.
  for (const kind of ['hourly-nudge', 'daily-check-in']) {
    assert.ok(pointer(kind).includes('When the two newest earlier stamps (<run UTC>.md files) both have no matching .done file, the line starts "COORDINATOR BEHIND: <n> | "'), kind);
  }
  const age = nudge.split('\n').find(line => line.startsWith('7. Age rebuild'));
  for (const required of ['Three or more days ago', 'handoff.md', '"CONTEXT RESET DUE (age) | "']) assert.ok(age.includes(required), required);
  const first = nudge.split('\n').find(line => line.startsWith('- First line:'));
  assert.ok(first.startsWith('- First line: any "COORDINATOR BEHIND: <n> runs | "'), 'the backlog prefix leads');
  assert.ok(first.includes('"NEEDS SETUP: <check>: <what to add, and where> | "'));
  for (const kind of ['hourly-nudge', 'daily-check-in']) {
    const text = rendered(kind);
    assert.match(text, /or a step could not finish for lack of context, write \S+\/handoff\.md/, kind);
    assert.match(text, /never reports a bare "unknown": add "NEEDS SETUP: <check>: <what to add, and where> \| "/, kind);
  }
  const dir = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects');
  const periodic = fs.readFileSync(path.join(dir, 'reference', 'periodic-runs.md'), 'utf8');
  const acting = periodic.slice(periodic.indexOf('## Acting on the nudge report'));
  for (const required of ['- **Task lines are work.**', 'never ends your turn with `no_reply_needed`', 'The same prefix on two runs in a row goes to the owner once, with the exact step and what blocks it',
    '- `COORDINATOR BEHIND`:', "then write each run's own `.relayed` and `.done`", '- `NEEDS SETUP`:', "briefing the new home with the run's `handoff.md`"]) assert.ok(acting.includes(required), required);
  assert.ok(periodic.includes('- **Task lines are work** (as in **Acting on the nudge report**).'), 'the check-in follows the same rule');
  assert.ok(acting.includes("that confirmed ping completes the prefix's action, so write `.done`"), 'a blocked prefix still closes its run');
  assert.ok(periodic.includes('  - `NEEDS SETUP`: as under **Acting on the nudge report**.'), 'the check-in acts on NEEDS SETUP');
  const rotation = periodic.split('\n').find(line => line.includes('asks for a rebuild of that task the same turn'));
  for (const required of ["A task's home thread cannot be moved", 'never ask the owner to repoint it', 'does every step itself',
    'creates a new task bound to itself with that prompt and the same name, schedule and model', 'reads it back with `get_trigger` (enabled, the right next run time, bound to this thread; never `fire_trigger` it, the first scheduled run is the proof)',
    "then deletes the outdated task (its record saved to the shared folder and read back first, as in the swap's step 1)", 'with the new id and today\'s "since" date',
    "the first rotation needs the owner's go; record it in project memory, and later rotations proceed on it", '`stopped by owner`']) assert.ok(rotation.includes(required), required);
  assert.ok(rotation.indexOf('reads it back with `get_trigger`') < rotation.indexOf('then deletes the outdated task'), 'the outdated task goes only after the new one reads back');
  assert.doesNotMatch(rotation, /disables the old task/, 'a rotation leaves no disabled copy behind');
  assert.doesNotMatch(rotation, /test-fires/, 'a rotation never fires the new task');
  const rotate = nudge.split('\n').find(line => line.startsWith('   Rotate:'));
  for (const required of ['any long-lived lane, Remote Control lanes included', 'that still take new work and have handled 15 or more PRs, records or review rounds, started over a day ago, or show summarised context',
    'never one only waiting on the owner (a test, a decision card, an open ask or a watched PR) until that clears',
    'any thread the coordinator reused for a new task after its own finished', '"ROTATE DUE: <n> | "']) assert.ok(rotate.includes(required), required);
  assert.ok(first.includes('"ROTATE DUE: <n> | "'), 'ROTATE DUE is a first-line prefix');
  assert.ok(acting.includes('- `ROTATE DUE`: rotate each listed thread this turn'), 'the coordinator acts on ROTATE DUE');
  const device = fs.readFileSync(path.join(dir, 'reference', 'device-work.md'), 'utf8');
  // Never fire_trigger: setup, the nudge home thread and Both gone read the new task back instead.
  const recurring = fs.readFileSync(path.join(dir, 'reference', 'recurring-tasks.md'), 'utf8');
  assert.ok(recurring.includes('4. Read it back with `get_trigger` (enabled, a future next run, bound to its home thread); never `fire_trigger` it: the first scheduled run is the proof.'));
  assert.ok(recurring.includes('a fresh-session task is never fired (no `fire_trigger`), so its next scheduled run covers the gap.'));
  assert.ok(periodic.includes('reads it back with `get_trigger` (never `fire_trigger`; its first scheduled run is the proof) and updates the `SCHEDULED TASKS:` line'));
  for (const [name, text] of [['SKILL.md', fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')], ['recurring-tasks.md', recurring], ['periodic-runs.md', periodic]]) {
    assert.doesNotMatch(text, /fires it once|Fire it once|Test one run now|caught up by firing it/, name);
  }
  assert.ok(device.includes('- **Rotate long Remote Control lanes too.**') && device.includes('you end its session with `stop_remote_control` once the handoff is read back'), 'Remote Control lanes rotate too');
  assert.ok(rendered('daily-check-in').includes('PROJECT TASKS MISSING, PROJECT TASKS OUTDATED, PLUGIN BEHIND, TASK FAILING, PR ATTENTION, TRACE GAPS, WORKFLOW FAILING, CI GAPS, NEEDS SETUP.'), 'the check-in orders NEEDS SETUP last');
  const freshAge = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], session: 'fresh' })).split('\n').find(line => line.startsWith('7. Age rebuild'));
  assert.ok(freshAge.includes('handoff.md (the state file, last report and every open warning the new home needs)'), 'a fresh render carries the handoff content inline');
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  // The daily check-in posts to the owner only what changed, is stuck or needs them: a quiet run posts nothing.
  assert.ok(skill.includes('Post to the owner only what changed, is stuck or needs them: a quiet run posts nothing'), 'the Projects skill posts nothing on a quiet run');
  assert.doesNotMatch(skill, /"nothing changed" included|It always reaches you/);
  assert.match(skill, /\*\*Every task run reaches the project chat\.\*\*[^\n]*a prefixed line is work, never `no_reply_needed`\./);
  assert.match(skill, /each new task gets a fresh thread, linking the old one\. Rotate every standing non-gate thread \(integrator, review runner, record keeper, any long-lived lane\) per `agent-cost-control`, and at the latest at 15 PRs, records or review rounds, a day old or summarised context:/);
});

test('the check-in turns stuck work into prefixes the coordinator must act on, and the controller owns every finding', () => {
  const text = rendered('daily-check-in');
  // A failing or missed task is no longer advice only.
  assert.match(text, /never in the prefix, except an enabled task not stopped by the owner whose last run is read as failed, or as missing its last scheduled run: start the first line with "TASK FAILING: <names> \| "\. A task whose status cannot be read is "<name>: unverified" under \*\*Tasks:\*\*, and a disabled one stays advice\./);
  // Toolkit runs no computer tasks any more, so the check-in reads no task-health files.
  assert.doesNotMatch(text, /task-health/);
  // An open PR that needs a step gets a prefix, review-notification PRs included.
  assert.match(text, /An open PR with a failing check, a ready PR whose UAT verdict is missing or invalid, or an open PR with no update for 3 days \(review-notification PRs included\), unless the PR or its task records a wait with its blocker and the date it is due: start the first line with "PR ATTENTION: <n> \| "/);
  // A missing set reported before is not silenced forever: after 3 days it returns for the owner.
  const own = full('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo: 'weijunswj/ai-agent-toolkit' }));
  assert.match(own, /with the date it was first reported; once that date is 3 or more days old, start the first line with it again, marked "3 days"/);
  assert.match(own, /PROJECT TASKS MISSING set reported with the date it was first reported/);
  const dir = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects');
  const periodic = fs.readFileSync(path.join(dir, 'reference', 'periodic-runs.md'), 'utf8');
  const acting = periodic.slice(periodic.indexOf('## Acting on the check-in report'), periodic.indexOf('## Hourly nudge home thread'));
  for (const required of ['  - `TASK FAILING`:', '  - `PR ATTENTION`:', 'Marked "3 days"', '- **Task lines are work** (as in **Acting on the nudge report**).']) assert.ok(acting.includes(required), required);
  // One merged line owns the rule for every task's prefixes, the check-in's included.
  const workLine = periodic.split('\n').find(line => line.startsWith('- **Task lines are work.**'));
  for (const required of ["the check-in's included, is a finding the controller owns (**Findings** in the Toolkit controller's evidence page)", 'give each an action and a deadline that turn',
    'The same prefix on two runs in a row goes to the owner once, with the exact step']) assert.ok(workLine.includes(required), required);
  assert.ok(!periodic.includes('- Every prefix is a finding'), 'the overlapping check-in line is merged away');
  // The controller rule and its page: an action and a deadline the turn a finding is seen, escalation on a repeat.
  const core = fs.readFileSync(path.join(ROOT, 'repo', 'CONTROLLER.md'), 'utf8');
  assert.match(core, /\*\*Findings are the controller's work:\*\*[^\n]*gets an action and a deadline from the controller the turn it is seen; an acknowledgement, log line, count or relay is not an action\. A missed deadline or a repeat goes to the owner/);
  const page = fs.readFileSync(path.join(ROOT, 'repo', 'controller', 'evidence-and-finish.md'), 'utf8');
  for (const required of ['- **Findings:** the controller owns every finding whoever raised it', 'Dispose only with a recorded reason',
    'the same finding on two runs in a row, goes to the owner once with the exact step', 'never a bare unknown',
    'Re-read owed lists (promises, polish child, pending owner OKs, review-only PRs) at session start and on every periodic run']) assert.ok(page.includes(required), required);
  // Findings and leftovers go to their area's open child, not a new child per review.
  assert.match(page, /add it to a lane's next slice or its area's open child, or ask the owner/);
  assert.match(core, /extend\/reopen its area's child \(leftovers too\), else create\/attach a native child/);
  for (const text of [page, core]) assert.doesNotMatch(text, /a tracked child|a follow-up child starts|extend\/reopen an owner/);
  // The stale check left the daily check-in: the governance session-start hook runs it, so the check-in has no
  // sweep, close list, stamp or list of children to close. Its own controller check skips it (below).
  const projects = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects');
  const daily = fs.readFileSync(path.join(projects, 'tasks', 'daily-check-in.md'), 'utf8');
  const nudge = fs.readFileSync(path.join(projects, 'tasks', 'hourly-nudge.md'), 'utf8');
  const periodicRuns = fs.readFileSync(path.join(projects, 'reference', 'periodic-runs.md'), 'utf8');
  const staleSweepText = /Stale sweep|STALE SWEEP|CLOSE LIST|stale-sweep\.json|--stale-stamp|JUDGE\?|POLISH FULL|nothing to close today|"nothing changed"/;
  for (const [name, text] of [['rendered daily check-in', rendered('daily-check-in')], ['daily-check-in.md', daily], ['rendered hourly nudge', rendered('hourly-nudge')], ['periodic-runs.md', periodicRuns]]) {
    assert.doesNotMatch(text, staleSweepText, name);
  }
  // The first line is what changed or is stuck; a run with nothing to report posts no first line.
  // Split on CRLF too: a Windows checkout ends each line with a carriage return.
  const firstLine = daily.split(/\r?\n/).find(line => line.startsWith('- First line: '));
  assert.ok(firstLine.startsWith('- First line: what changed or is stuck, starting with any prefixes in this fixed order: CONTEXT RESET DUE, '), firstLine);
  assert.ok(firstLine.endsWith('NEEDS SETUP. A run with nothing changed or stuck posts no first line to the owner.'), firstLine);
  assert.doesNotMatch(daily, /Fold check:/);
  // The nudge's step 9 names the governance session-start hook for the stale check.
  assert.match(nudge, /the governance session-start hook runs the stale check, and the daily check-in the decision traces and CI drift/);
  // The controller check's stale check runs only from the governance session-start hook: every Projects call skips it.
  assert.match(nudge, /toolkit-controller-check\.cjs --host projects --skip programme,traces,stale,ci,handoff`/);
  assert.match(daily, /toolkit-controller-check\.cjs --host projects --checkout R --repo \{\{repo\}\} --skip guidebook,instructions,memory,tasks,programme,stale,footer,refs,handoff`/);
  const ownerAsks = fs.readFileSync(path.join(projects, 'reference', 'owner-asks.md'), 'utf8');
  assert.match(ownerAsks, /\*\*Owner UAT comes after agent UAT\.\*\* Ask the owner for UAT only once every agent UAT step at that build passed[^\n]*lists only the steps no tool reaches[^\n]*links the agent UAT evidence/);
  const gates = fs.readFileSync(path.join(ROOT, 'repo', 'controller', 'gates.md'), 'utf8');
  for (const required of ["follow-up (Low or `POST_SHIP`: a one-line Low fixed in the PR, else the polish child; others on their area's open child, unless the owner accepted it)",
    "agent UAT runs first, and only its pass puts the ask on the owner's waiting list", 'then relaunch one successor or record the hold on the child',
    'Before a merge record is written, the G2 report is archived to the evidence store and read back, and the record (and its brief) names that path and the PASS head.']) assert.ok(gates.includes(required), required);
  // A verified plugin gap stays on the owner's list every run, not only on the run that first reports it.
  assert.match(text, /Missing account copy: say so under \*\*Plugin:\*\*\. While that verified gap remains, also list "update the Toolkit plugin on claude\.ai \(behind since <date>\)" under \*\*Waiting on owner:\*\* every run\./);
});

// A bot or workflow PR wakes no thread, so the PR step runs every hour, covers the evidence store,
// and flags any open PR with no owner or live next step; the coordinator routes it the same turn.
test('periodic tasks give every open PR an owner and a next step, bot and workflow PRs included', () => {
  for (const session of ['bound', 'fresh']) {
    const text = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], session }));
    const step = text.split('\n').find(line => line.startsWith('5. TOOL STEP (GitHub): PRs'));
    assert.ok(step, `${session}: step 5`);
    for (const phrase of ['runs every time, even when step 1 found no change', 'a bot or workflow PR wakes no thread',
      'every open PR on example-owner/example-repo and on the project\'s evidence store', '"store unread"',
      'its owner (the thread that owns or watches it', 'or the merge train holding it', 'its live next step',
      // Step 2 is skipped on quiet runs, so owners come from step 2b's list_threads read, which always runs.
      'that step 2b reads on every run, quiet runs included', 'under `GITHUB STEPS OWED` pages list_threads itself',
      'bot and workflow PRs included', '`PR UNOWNED`', '"PR UNOWNED: <n> | "']) assert.ok(step.includes(phrase), `${session}: ${phrase}`);
    assert.ok(text.includes('plus steps 2a, 2b, 4, 4a, 5 and 7 to 11'), `${session}: quiet runs keep step 5`);
    const none = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], repo: 'none', session }));
    assert.ok(none.includes('5. PRs: none (no repo).') && !none.includes('every open PR on'), `${session}: no-repo nudge has no PR sweep`);
  }
  const checkIn = rendered('daily-check-in').split('\n').find(line => line.startsWith('11. TOOL STEP (GitHub): GitHub'));
  for (const phrase of ["and the project's evidence store", 'no thread owns or watches', 'no merge train holds',
    'bot and workflow PRs included', 'the reason `unowned`']) assert.ok(checkIn.includes(phrase), phrase);
  const acting = fs.readFileSync(path.join(TASKS, '..', 'reference', 'periodic-runs.md'), 'utf8');
  for (const phrase of ['- `PR UNOWNED`: every open PR needs an owner and a live next step', 'to the merge train',
    "after the owner's OK (an evidence-store PR needs none: the store is agent-managed with standing permission, so merge or close it yourself)", 'the same PR listed again on the next run goes to the owner',
    'an `unowned` PR is routed as for `PR UNOWNED`']) assert.ok(acting.includes(phrase), phrase);
});

// A thread silently waiting on CI makes no activity, so the CI-wait check runs on the no-change path too,
// and its prefix sits between LANES UNDER CAP and WORK QUEUE.
test('rendered hourly nudges flag threads quiet 20 minutes or more with CI pending, on every run', () => {
  for (const repo of ['example-owner/example-repo', 'none']) {
    for (const session of ['bound', 'fresh']) {
      const text = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], repo, session }));
      const step = text.split('\n').find(line => line.startsWith('2b. TOOL STEP (GitHub): CI waits'));
      assert.ok(step, `${repo}/${session}: step 2b`);
      for (const phrase of ['runs every time, even when step 1 found no change', 'page it on the no-change path too',
        'other than task home threads', 'no activity for 20 minutes or more', 'owns or watches an open PR',
        'says it waits on CI or another outside event', 'still pending, or finished after the thread\'s latest message',
        '`CI WAIT QUIET` with the thread linked by its title, the PR number, the CI state and the minutes quiet',
        '"CI WAIT QUIET: <n> | "', 'this task never messages threads itself']) {
        assert.ok(step.includes(phrase), `${repo}/${session}: ${phrase}`);
      }
      assert.ok(text.includes('plus steps 2a, 2b, 4, 4a, 5 and 7 to 11 (and 5b when it applies)'));
      assert.ok(text.includes('"LANES UNDER CAP: <working> of <cap>, queue <n> | ", "CI WAIT QUIET: <n> | ", "STUCK THREADS: <n> | ", "STUCK FOR OWNER: <n> | ", "STUCK CHECK FAILED: <why> | ", "PR UNOWNED: <n> | ", "WORK QUEUE: <n> | ", "PROGRAMME FINDINGS: <n> new | ", "CLOUD SWEEP: <why> | " and "NEEDS SETUP: <check>: <what to add, and where> | " prefixes'));
    }
  }
});

test('the daily check-in reads each PR check from its newest run on the head only', () => {
  const text = rendered('daily-check-in');
  assert.ok(text.includes('every open PR with each check by name and the conclusion of its newest run on the head only (a re-run supersedes older runs)'));
  assert.doesNotMatch(text, /every check run by name and conclusion/);
});

// The programme findings and cloud sweep prefixes belong to the report's first-line list, never to a step's own text.
test('rendered hourly nudges list PROGRAMME FINDINGS and CLOUD SWEEP only in the first-line prefix list', () => {
  for (const repo of ['example-owner/example-repo', 'none']) {
    for (const session of ['bound', 'fresh']) {
      const text = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], repo, session }));
      const lines = text.split('\n');
      const first = lines.find(line => line.startsWith('- First line:'));
      assert.ok(first, `${repo}/${session}: first-line list`);
      for (const prefix of ['"PROGRAMME FINDINGS: <n> new | "', '"CLOUD SWEEP: <why> | "']) {
        assert.ok(first.indexOf(prefix) > first.indexOf('"WORK QUEUE: <n> | "'), `${repo}/${session}: ${prefix} after WORK QUEUE`);
        assert.ok(first.indexOf(prefix) < first.indexOf('"NEEDS SETUP:'), `${repo}/${session}: ${prefix} before NEEDS SETUP`);
      }
      const lanes = lines.find(line => line.startsWith('11. Lanes'));
      assert.ok(lanes && !lanes.includes('PROGRAMME FINDINGS'), `${repo}/${session}: step 11 has no findings prefix`);
    }
  }
});

// The owner's catch-what-was-missed checks run in the daily check-in, each with its own first-line prefix.
test('rendered daily check-ins run workflow health, and the decision trace and CI check-up through the controller check', () => {
  const text = rendered('daily-check-in');
  const step = text.slice(text.indexOf('11b. TOOL STEP (shell, GitHub): CHECKERS'), text.indexOf('12. Promises'));
  for (const phrase of ['the hourly controller check skips them', 'R is TK when example-owner/example-repo is weijunswj/ai-agent-toolkit, else `git clone --depth 1 https://github.com/example-owner/example-repo R`',
    '`node TK/repo/scripts/toolkit-controller-check.cjs --host projects --checkout R --repo example-owner/example-repo --skip guidebook,instructions,memory,tasks,programme,stale,footer,refs,handoff`',
    '"TRACE GAPS: <its counts> | "', '--repair --out <file>', 'that have a `schedule` trigger', '"WORKFLOW FAILING: <names> | "', '"CI GAPS: <n> | "']) {
    assert.ok(step.includes(phrase), phrase);
  }
  assert.ok(text.indexOf('**Checkers:**', text.indexOf('REPORT')) > 0, 'the report has a Checkers bullet');
});

// A session without repo access once relayed runs and wrote `.done` with the PR sweep unrun, leaving a
// bot PR unowned. A GitHub step that cannot read GitHub is a prefix, and `.done` waits for a thread with the repos.
test('periodic runs hand GitHub steps they cannot read to a thread with the repos before .done', () => {
  for (const session of ['bound', 'fresh']) {
    const text = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], session }));
    const step = text.split('\n').find(line => line.startsWith('5. TOOL STEP (GitHub): PRs'));
    assert.ok(step.includes('this step is not done: start the first line with "GITHUB STEPS OWED: <steps> | "'), `${session}: step 5`);
    assert.doesNotMatch(step, /If GitHub MCP is unavailable, say so\./, `${session}: step 5 no longer just says so`);
    assert.ok(text.includes('"THREAD SCAN INCOMPLETE: <read> of <total> | ", "GITHUB STEPS OWED: <steps> | "'), `${session}: first line`);
  }
  const checkIn = rendered('daily-check-in');
  assert.ok(checkIn.includes('start the first line with "GITHUB STEPS OWED: <steps> | ", naming each step that could not read GitHub (11, 11b)'));
  assert.ok(checkIn.includes('NUDGE NOT ARMED, GITHUB STEPS OWED, PROJECT TASKS MISSING'));
  const reference = path.join(TASKS, '..', 'reference');
  const recurring = fs.readFileSync(path.join(reference, 'recurring-tasks.md'), 'utf8');
  for (const phrase of ['- **GitHub steps need repo access.**', 'a relay alone does not complete it',
    'hand every GitHub step of the run', 'Write `.done` only after that thread reports back']) assert.ok(recurring.includes(phrase), phrase);
  const periodic = fs.readFileSync(path.join(reference, 'periodic-runs.md'), 'utf8');
  assert.ok(periodic.includes('  - `GITHUB STEPS OWED`:') && periodic.includes('- `GITHUB STEPS OWED`: as in **Acting on the check-in report**'));
  assert.ok(fs.readFileSync(SKILL, 'utf8').includes("Without repo access, hand the run's GitHub steps to a thread with the repos; `.done` waits for its report."));
});

// GitHub can skip a scheduled workflow run, and a skipped run wakes no one, so the hourly PR step
// flags a workflow whose newest run is older than its longest scheduled gap, and the coordinator starts it by hand.
test('the hourly nudge flags a skipped scheduled workflow for a manual run', () => {
  for (const session of ['bound', 'fresh']) {
    const text = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], session }));
    const step = text.split('\n').find(line => line.startsWith('   Scheduled workflows'));
    assert.ok(step, `${session}: scheduled workflows check`);
    for (const phrase of ['part of step 5, so it runs every time', 'a scheduled time passed more than 30 minutes ago',
      'no run of it started since that time', '"SCHEDULE MISSED: <names> | "', 'whether it takes `workflow_dispatch`',
      'a disabled workflow is listed once as off', "needs the owner's approval by name for anything that acts outside the repository",
      'this task never starts workflows itself']) assert.ok(step.includes(phrase), `${session}: ${phrase}`);
    assert.ok(text.includes('"GITHUB STEPS OWED: <steps> | ", "SCHEDULE MISSED: <names> | "'), `${session}: first line`);
    const none = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], repo: 'none', session }));
    assert.ok(!none.includes('Scheduled workflows'), `${session}: no-repo nudge has no workflow check`);
  }
  const periodic = fs.readFileSync(path.join(TASKS, '..', 'reference', 'periodic-runs.md'), 'utf8');
  const missed = periodic.split('\n').find(line => line.startsWith('- `SCHEDULE MISSED`:'));
  // A generic guidebook must never hand-start a project's deploy, publish, sync or mail workflow without the owner naming it.
  for (const phrase of ['Re-read its newest run first', "stays inside the repository's own GitHub state", 'or one the owner approved by name',
    "is never started without the owner's approval naming it", 'with the file, ref and effect', 'A disabled workflow is not missed',
    'with a default-branch-only job guard']) assert.ok(missed.includes(phrase), phrase);
});

test('owner waits on the board reach the owner every run, missed runs are flagged from each cron, and gate starts record their assignment', () => {
  const dir = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects');
  for (const session of ['bound', 'fresh']) {
    const nudge = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], parent_issue: '12', session })).split('\n');
    const waits = nudge.find(line => line.startsWith('   Owner waits'));
    assert.ok(waits && nudge.indexOf(waits) > nudge.findIndex(line => line.startsWith('2a. Owner asks')) && nudge.indexOf(waits) < nudge.findIndex(line => line.startsWith('2b. ')), `${session}: owner waits belong to step 2a`);
    for (const phrase of ['`programme.cjs attention`', '`Owner waits`', 'under **Waiting on owner:** every run until done', '`UNRELAYED ASK:`',
      "the parent page's PROGRAMME GRAPH rows whose Waiting on cell holds `Owner:`", '"Owner waits: unknown"']) assert.ok(waits.includes(phrase), `${session}: ${phrase}`);
    const runs = nudge.find(line => line.startsWith('10. TOOL STEP (shell, task reads): Task runs'));
    for (const phrase of ['toolkit-projects-run-missed.cjs', '`cron_expression`', '`last_fired_at`', '"RUN MISSED: <n> | "', '"RUN CHECK FAILED: <why> | "', 'stopped by owner',
      "on this task's own entry only, add `own_run` (this run's own time, never as a stamp"]) {
      assert.ok(runs.includes(phrase), `${session}: ${phrase}`);
    }
    assert.ok(!/own time included/.test(runs), `${session}: this run's own time as a stamp would hide its own missed runs`);
    const first = nudge.find(line => line.startsWith('- First line:'));
    assert.ok(first.includes('"CHECK-IN NOT ARMED: <why> | ", "RUN MISSED: <n> | ", "RUN CHECK FAILED: <why> | "'), `${session}: first line`);
    const none = full('hourly-nudge', validateParams('hourly-nudge', { ...PARAMS['hourly-nudge'], session }));
    assert.ok(!none.includes('   Owner waits'), `${session}: no programme parent, no owner-waits list`);
  }
  const daily = rendered('daily-check-in').split('\n');
  const dailyWaits = daily.find(line => line.startsWith('   Owner waits'));
  assert.ok(dailyWaits && daily.indexOf(dailyWaits) > daily.findIndex(line => line.startsWith('12. ')), 'the daily check-in lists owner waits in step 12');
  assert.ok(dailyWaits.includes('`programme.cjs attention`') && dailyWaits.includes('**Waiting on owner:**'));
  const asks = fs.readFileSync(path.join(dir, 'reference', 'owner-asks.md'), 'utf8');
  assert.match(asks, /^- \*\*Owner waits on the programme board are asks\.\*\*[^\n]*Recording an owed UAT or decision is a new ask: ping it the same turn\./m);
  const periodic = fs.readFileSync(path.join(dir, 'reference', 'periodic-runs.md'), 'utf8');
  const missedRun = periodic.split('\n').find(line => line.startsWith('- `RUN MISSED`'));
  assert.ok(missedRun && missedRun.includes('**Moving a task or catching up**') && missedRun.includes('`RUN CHECK FAILED`'), 'the coordinator catches up a missed run');
  const skill = fs.readFileSync(SKILL, 'utf8');
  assert.match(skill, /\*\*Programme attention before gates, finality and settling\.\*\*[^\n]*the turn a gate thread starts, queue its `assign` holder order, naming the assignment id in the brief, and its return the turn it reports \(\*\*Gate assignments\*\*, `reference\/periodic-runs\.md`\)\./);
  // Every assignment a gate start opens is ended by the controller, and the next gate supersedes a live one; else the next
  // `assign` is refused (ASSIGNMENT_LIVE) and a finished gate keeps its task in progress (the route itself: programme-parent-layout).
  const gates = periodic.split('\n').find(line => line.startsWith('- **Gate assignments**'));
  assert.ok(gates, 'the reference names the gate route');
  for (const phrase of ['`assign --issue <n> --role <gate> --assignment <id>`', "while the task's previous gate is still live", '`--supersede --reason',
    '`ASSIGNMENT_LIVE`', 'The turn the thread reports its result, queue in one order `return --issue <n> --record <id>.r<round> --assignment <id>`',
    'for a G0 or G2 `return --issue <n> --consume <id>.r<round> --verdict ACCEPT`', "a G1's return stays submitted until its G2's `assign --supersede` ends it",
    '`interrupt --issue <n> --reason <why>`', "When the task's last gate is an accepted one of the same role", 'both `assign` forms are refused (`GATE_STATE`)',
    '`reopen --issue <n> --assignment <id> --reason "<gate> follows accepted <gate>"`']) assert.ok(gates.includes(phrase), phrase);
});

// The two Toolkit tasks store a ping: it stamps its run and posts one line, and the coordinator works
// the checklist that turn from the guidebook copy. Project additions live in project-additions.md.
const PINGED = ['daily-check-in', 'hourly-nudge'];
const pingOf = (kind, extra = {}) => tasks().render(kind, validateParams(kind, { ...PARAMS[kind], ...extra }));

test('ping: each Toolkit task stamps one file, posts one line, reads only its run folder and never writes receipts', () => {
  const slugs = { 'daily-check-in': 'daily-check-in-example-a9eaed51fb', 'hourly-nudge': 'hourly-nudge-example-65865a7fc8' };
  for (const kind of PINGED) {
    for (const session of ['bound', 'fresh']) {
      const stored = pingOf(kind, { session });
      const label = `${kind} ${session}`;
      assert.deepEqual(findBlocks(stored).blocks.map(block => block.name), ['TASK-PING'], label);
      assert.equal(tasks().check(kind, stored).state, 'current', label);
      assert.equal(tasks().refresh(kind, stored, { session }), stored, `${label}: a refresh changes nothing`);
      assert.ok(stored.length < 3000, `${label}: short (${stored.length})`);
      const body = findBlocks(stored).blocks[0].body;
      const folder = `/mnt/project-files/toolkit/task-runs/${slugs[kind]}/`;
      // I1, I3: exactly one stamp, one post, a .failed file only when every send failed.
      assert.equal(body.match(/\bcreate \/mnt\/project-files\/toolkit\/task-runs\//g).length, 1, label);
      assert.ok(body.includes(`create ${folder}<run UTC>.md, never overwriting one`), label);
      assert.ok(body.includes(`"run <run UTC> | ${slugs[kind]} | task ${taskNameOf(kind)} | thread <this run's thread link> | ping | <the prefixes, or ping>"`), `${label}: stamp line`);
      assert.equal(body.match(/Post exactly one line in this thread/g).length, 1, label);
      assert.match(body, /If that post fails, send the same line once as a message to the coordinator\. If that fails too, create <run UTC>\.failed/);
      assert.match(body, /never claim the line was delivered/);
      // I4, D1: reads only its run folder; flags its own backlog.
      assert.ok(body.includes(`Run folder: ${folder}`), label);
      assert.match(body, /Read nothing but this task's run folder, change nothing else, never write a \.relayed or \.done file/);
      assert.match(body, /When the two newest earlier stamps \(<run UTC>\.md files\) both have no matching \.done file, the line starts "COORDINATOR BEHIND: <n> \| "/);
      // I6: a bound ping never resolves its home thread; a fresh one resolves only its own run thread.
      assert.equal(/Never resolve this home thread/.test(body), session === 'bound', label);
      assert.equal(/resolve this run's own thread/.test(body), session === 'fresh', label);
      // Generic: a neutral outside-home-thread guard, no tool names, no clone or script.
      assert.match(body, /^- First check, before anything else: if this turn cannot post in a project thread or cannot read \/mnt\/project-files\/, it started outside its home thread or project\./m);
      assert.doesNotMatch(body, /mcp__|hearthbot|git clone|node |TK-LOAD|latest\.md|set_effort_level/, label);
      // The line names the checklist, ping-run.md and every value the coordinator fills in.
      assert.ok(body.includes(`/mnt/project-files/toolkit/web-controller-projects/tasks/${kind}.md with tasks/ping-run.md`), label);
      assert.ok(body.includes(`additions ${PARAMS[kind].report_dir}/project-additions.md`), label);
      assert.doesNotMatch(body, /TASKS OUTDATED/, `${label}: the stored ping never asks for its own swap`);
    }
  }
});

function taskNameOf(kind) {
  return `EXAMPLE: ${kind === 'hourly-nudge' ? 'Hourly nudge' : 'Daily check-in'}`;
}

test('ping check matrix: ping current, pointer and full prompts outdated, edits and other kinds held', t => {
  const oldPointer = kind => renderBlock(tasks().pointerBlock(kind, params(kind)));
  const pointerPrompt = kind => [oldPointer(kind), '', '```toolkit-task-params', JSON.stringify(params(kind), null, 2), '```', '', `${PROJECT_HEADING}\n- none`, ''].join('\n');
  const rows = [
    ['ping, untouched', 'hourly-nudge', pingOf('hourly-nudge'), 'current', 0],
    ['ping stamped by an older release, same text', 'hourly-nudge', laterMain({ version: '1.0.0' }).render('hourly-nudge', params('hourly-nudge')), 'current', 0],
    ['ping text changed on main', 'hourly-nudge', laterMain({ template: true }).render('hourly-nudge', params('hourly-nudge')), 'outdated', 1],
    ['pointer from before pings', 'hourly-nudge', pointerPrompt('hourly-nudge'), 'outdated', 1],
    ['pointer from before pings, check-in', 'daily-check-in', pointerPrompt('daily-check-in'), 'outdated', 1],
    ['full prompt from before pointers', 'daily-check-in', rendered('daily-check-in'), 'outdated', 1],
    ['ping still carrying project text', 'hourly-nudge', `${pingOf('hourly-nudge')}\nProject step left in the prompt.\n`, 'outdated', 1],
    ['ping hand-edited', 'hourly-nudge', replaceBlockBody(pingOf('hourly-nudge'), 'TASK-PING', 'TASK PING', 'TASK PING (edited)'), 'edited', 1],
    ['a check-in ping checked as the nudge', 'hourly-nudge', pingOf('daily-check-in'), 'malformed', 2],
    ['a ping checked as a custom task', 'custom', pingOf('hourly-nudge'), 'malformed', 2],
    ['two pings', 'hourly-nudge', `${pingOf('hourly-nudge')}\n${renderBlock(tasks().pingBlock('hourly-nudge', params('hourly-nudge')))}\n`, 'malformed', 2],
    ['hand-made ping, no markers', 'hourly-nudge', 'HOURLY PING\n1. Stamp.\n2. Post one line.\n', 'missing', 1],
    ['custom pointer stays current', 'custom', pointer('custom'), 'current', 0]
  ];
  for (const [label, kind, text, state, status] of rows) assert.deepEqual(cli(t, kind, text), { state, status }, label);
});

test('ping swap: project additions are printed, must be saved word for word, and never land in the ping', t => {
  const promptParams = params('hourly-nudge');
  const own = 'Project additions:\n- Also list the example sweep.\n  - kept as typed   ';
  const withText = [renderBlock(tasks().pointerBlock('hourly-nudge', promptParams)), '', '```toolkit-task-params', JSON.stringify(promptParams, null, 2), '```', '', own, ''].join('\n');
  assert.equal(tasks().additions('hourly-nudge', withText), own);
  const target = file(t, 'old.md', withText);
  const printed = run(['--additions-from', 'hourly-nudge', target]);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, `${own}\n`);
  // I10: no refresh until the additions are saved and read back word for word.
  assert.throws(() => tasks().refresh('hourly-nudge', withText, { session: 'bound' }), /TASK_ADDITIONS_UNSAVED/);
  assert.throws(() => tasks().refresh('hourly-nudge', withText, { session: 'bound', additions: 'Project additions:\n- Also list the sweep.' }), /TASK_ADDITIONS_UNSAVED/);
  assert.equal(run(['--refresh', 'hourly-nudge', target, '--session', 'bound']).status, 2);
  const saved = file(t, 'project-additions.md', `# Saved before the swap\n${own}\n`);
  const result = run(['--refresh', 'hourly-nudge', target, '--session', 'bound', '--additions-saved', saved]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, pingOf('hourly-nudge'));
  assert.ok(!result.stdout.includes('example sweep'), 'the ping carries no project text');
  // An untouched default section and lines typed inside an edited block are handled the same way.
  assert.equal(tasks().additions('daily-check-in', rendered('daily-check-in')), '');
  assert.equal(tasks().refresh('daily-check-in', rendered('daily-check-in'), { session: 'bound' }), pingOf('daily-check-in'));
  const edited = replaceBlockBody(rendered('hourly-nudge'), 'HOURLY-NUDGE-CHECKS', 'CHECKS\n', 'CHECKS\n- Project step typed inside the block.\n');
  assert.equal(tasks().additions('hourly-nudge', edited), `${PROJECT_HEADING}\n- none\n${KEPT_LABEL}\n- Project step typed inside the block.`);
  // A ping never takes project text, a hand-made prompt's steps go to the file, not --project-text,
  // and custom tasks keep their text in their own prompt.
  assert.throws(() => tasks().render('hourly-nudge', promptParams, 'Project step.'), /TASK_PROJECT_TEXT/);
  assert.throws(() => tasks().refresh('hourly-nudge', 'HAND-MADE\n', { params: promptParams, projectText: 'x' }));
  assert.equal(tasks().refresh('hourly-nudge', 'HAND-MADE\n', { params: promptParams, session: 'bound', additions: '- Hand-made step, saved first.' }), pingOf('hourly-nudge'));
  assert.throws(() => tasks().additions('custom', pointer('custom')));
  assert.throws(() => tasks().refresh('custom', pointer('custom'), { additions: 'x' }));
});

test('a hand-made Toolkit task refresh needs its project lines saved first: no or blank --additions-saved is refused', t => {
  // A hand-made prompt has no project section the script can read back, so the saved file must at least be non-empty.
  const hand = 'HOURLY PING\n1. Stamp.\n2. Post one line.\n';
  const promptParams = params('hourly-nudge');
  for (const additions of [undefined, '', ' \n\n']) {
    assert.throws(() => tasks().refresh('hourly-nudge', hand, { params: promptParams, session: 'bound', additions }), /TASK_ADDITIONS_UNSAVED/, `additions ${JSON.stringify(additions)}`);
  }
  assert.equal(tasks().refresh('hourly-nudge', hand, { params: promptParams, session: 'bound', additions: '- Hand-made step.' }), pingOf('hourly-nudge'));
  const paramsFile = file(t, 'params.json', JSON.stringify(PARAMS['hourly-nudge']));
  const target = file(t, 'hand.md', hand);
  const refreshCli = extra => run(['--refresh', 'hourly-nudge', target, '--params', paramsFile, '--session', 'bound', ...extra]);
  const none = refreshCli([]);
  assert.equal(none.status, 2, 'no --additions-saved');
  assert.equal(none.stdout, '');
  assert.equal(refreshCli(['--additions-saved', file(t, 'blank.md', ' \n')]).status, 2, 'a blank saved file');
  const saved = refreshCli(['--additions-saved', file(t, 'additions.md', '- Hand-made step.\n')]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout, pingOf('hourly-nudge'));
});

// A hand-made prompt with no project lines still needs the file saved, so the refusal and the reference say what
// the file holds: the project lines word for word, or the line "- none" when there are none.
test('a hand-made task with no project lines saves "- none", and the refusal and recurring-tasks.md say so', t => {
  const reference = fs.readFileSync(path.join(path.dirname(SETUP), 'recurring-tasks.md'), 'utf8');
  assert.match(reference, /A hand-written Toolkit prompt is refused until that file is saved non-empty[^\n]*write the line `- none` there/);
  const refusal = run(['--refresh', 'hourly-nudge', file(t, 'hand.md', 'HOURLY PING\n1. Stamp.\n'), '--params', file(t, 'params.json', JSON.stringify(PARAMS['hourly-nudge'])), '--session', 'bound']);
  assert.equal(refusal.status, 2);
  assert.match(refusal.stderr, /a hand-made Toolkit task needs project-additions\.md saved first: write its project lines in it word for word, or the line "- none" when it has none; then pass that file as --additions-saved\.\n$/);
});

test('a refused refresh names its task and the rule it broke on stderr; any other failure keeps the generic line only', t => {
  const generic = 'Task prompt could not be processed (PROJECT_TASKS_INVALID).\n';
  const hand = file(t, 'hand.md', 'HOURLY PING\n1. Stamp.\n');
  const paramsFile = file(t, 'params.json', JSON.stringify(PARAMS['hourly-nudge']));
  const withoutProject = { ...PARAMS['hourly-nudge'] };
  delete withoutProject.project;
  const noProject = file(t, 'no-project.json', JSON.stringify(withoutProject));
  const additions = file(t, 'additions.md', '- Step.\n');
  const cases = [
    [['--refresh', 'daily-check-in', hand], `${generic}Refresh of daily-check-in refused (TASK_ARGUMENTS): a Toolkit task refresh needs --session bound or fresh, the session its replacement runs in.\n`],
    [['--refresh', 'hourly-nudge', hand, '--params', noProject, '--session', 'bound', '--additions-saved', additions], `${generic}Refresh of hourly-nudge refused (TASK_PARAMS): a required param is missing: project.\n`],
    [['--refresh', 'hourly-nudge', hand, '--params', paramsFile, '--session', 'bound'], `${generic}Refresh of hourly-nudge refused (TASK_ADDITIONS_UNSAVED): a hand-made Toolkit task needs project-additions.md saved first: write its project lines in it word for word, or the line "- none" when it has none; then pass that file as --additions-saved.\n`],
    // Options may come before the task kind; the refusal once read the kind only from the first argument after --refresh.
    [['--refresh', '--session', 'bound', '--params', paramsFile, 'hourly-nudge', hand], `${generic}Refresh of hourly-nudge refused (TASK_ADDITIONS_UNSAVED): a hand-made Toolkit task needs project-additions.md saved first: write its project lines in it word for word, or the line "- none" when it has none; then pass that file as --additions-saved.\n`],
    [['--refresh', 'nope', hand, '--session', 'bound'], generic]
  ];
  for (const [args, stderr] of cases) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
    assert.equal(result.stderr, stderr, args.join(' '));
  }
});

test('ping transition: an unswapped pointer loads the ping, which asks for its own swap', t => {
  for (const kind of PINGED) {
    for (const extra of [{}, { effort: 'low', model: undefined }]) {
      const raw = { ...PARAMS[kind], ...extra };
      const result = run(['--expand', kind, '--params', file(t, 'params.json', JSON.stringify(raw))]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`^TOOLKIT TASK INSTRUCTIONS \\(${taskNameOf(kind)}, toolkit \\d+\\.\\d+\\.\\d+\\)\\n\\nTASK PING \\(`));
      assert.ok(result.stdout.includes(`the line also starts "TASKS OUTDATED: ${taskNameOf(kind)}: pointer, swap to ping | "`), kind);
      assert.ok(result.stdout.includes(findBlocks(pingOf(kind)).blocks[0].body.split('\n').slice(1, 4).join('\n')), `${kind}: the same ping steps`);
      assert.doesNotMatch(result.stdout, /HOURLY NUDGE \(|DAILY CHECK-IN \(|^RUN SETUP|^DELIVERY$/m, `${kind}: never the old heavy shell (I9)`);
    }
  }
  assert.doesNotMatch(tasks().expand('custom', params('custom')), /TASK PING|TASKS OUTDATED/);
});

test('ping coverage: every step of the old run maps to a step the coordinator works, each tool step labelled', () => {
  const checklist = name => fs.readFileSync(path.join(TASKS, name), 'utf8').split(/\r?\n/);
  // Main's step ids before pings (frozen), with the tools each needs ('' = the coordinator's own tools).
  const steps = {
    'hourly-nudge.md': { 1: '', 2: '', '2a': '', '2b': 'GitHub', 3: '', 4: '', '4a': 'shell', 5: 'GitHub', '5b': 'shell, GitHub', 6: '', 7: '', 8: 'task reads', 9: 'shell', '9a': '', 10: 'shell, task reads', 11: '' },
    'daily-check-in.md': { 1: '', 2: 'shell', 3: 'shell', 4: 'shell', 5: 'shell', 6: 'shell', 7: 'shell', 8: 'shell, task reads', 9: 'task reads', 10: 'shell', 11: 'GitHub', '11b': 'shell, GitHub', 12: '', 13: '' }
  };
  for (const [name, ids] of Object.entries(steps)) {
    const lines = checklist(name);
    for (const [id, tools] of Object.entries(ids)) {
      const found = lines.filter(line => new RegExp(`^(?:\\[[a-z-]+\\])?${id}\\. `).test(line));
      assert.ok(found.length >= 1, `${name}: step ${id}`);
      for (const line of found.filter(entry => !entry.startsWith('[no-repo]'))) {
        const label = /^(?:\[[a-z-]+\])?\w+\. TOOL STEP \(([^)]+)\): /.exec(line);
        assert.equal(label ? label[1] : '', tools, `${name}: step ${id} label`);
      }
    }
  }
  // Named sub-steps and the report survive inside their steps.
  const nudge = checklist('hourly-nudge.md').join('\n');
  const daily = checklist('daily-check-in.md').join('\n');
  for (const part of ['Owner waits (part of step 2a', 'Scheduled workflows (part of step 5', '\nREPORT\n']) assert.ok(nudge.includes(part), part);
  for (const part of ['SKILL UPDATE:', 'SKILL CARD OUTDATED:', 'BASE CHECK:', 'OTHER PROJECTS:', 'RELAY GAP:', 'Workflow health:', 'Owner waits:', '\nREPORT\n']) assert.ok(daily.includes(part), part);
  // The coordinator's guide to both checklists.
  const guide = fs.readFileSync(path.join(TASKS, 'ping-run.md'), 'utf8');
  for (const part of ['**Values.** Take them from the ping line', '`[repo]` applies when repo is not `none`', '**Project additions** in `{{report_dir}}/project-additions.md`',
    '**You act, not report.**', 'ping runs write no `latest.md` or `runs/` report', 'A step that starts `TOOL STEP (<tools>)`',
    'send every such step of this run in one message to the task\'s home thread', '`.done` waits for that reply and your action on it']) assert.ok(guide.includes(part), part);
});

test('ping rules: each invariant and matrix row is pinned in the file that states it', () => {
  const dir = path.join(ROOT, 'repo', 'contracts', 'claude-projects', 'web-controller-projects');
  const at = rel => fs.readFileSync(rel.startsWith('repo/') ? path.join(ROOT, rel) : path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
  const rows = [
    ['I1 only the ping writes its stamp and .failed, never a receipt', 'tasks/ping.md', 'never write a .relayed or .done file'],
    ['I1 the failure file is created, never overwritten', 'tasks/ping.md', 'create <run UTC>.failed in the run folder, never overwriting one'],
    ['I2 only the coordinator writes receipts, each with content', 'reference/recurring-tasks.md', 'The coordinator alone owns `.relayed` and `.done`, each with its one content line'],
    ['I2 .done only after every action', 'reference/recurring-tasks.md', 'Only after every prefix has been acted on, write `<run UTC>.done`'],
    ['I3 one post, one fallback message', 'tasks/ping.md', 'Post exactly one line in this thread'],
    ['I3 fallback only on a failed post', 'tasks/ping.md', 'If that post fails, send the same line once as a message to the coordinator.'],
    ['I4 the ping reads only its run folder', 'tasks/ping.md', "Read nothing but this task's run folder, change nothing else"],
    ['I5 the tool thread changes nothing', 'reference/recurring-tasks.md', 'That thread runs them read-only and replies once; it writes no receipt, memory, binding line, task or project setting.'],
    ['I5 the home thread as tool thread', 'reference/periodic-runs.md', 'it writes no receipt, memory, task or setting'],
    ['I6 nobody resolves a home thread', 'reference/periodic-runs.md', 'Never resolve the home thread or list it as a resolve candidate'],
    ['I7 stopped by owner is outside every path', 'SKILL.md', 'is outside every automatic path in this skill, its references and task prompts'],
    ['I8 a run stays pending while a step is open', 'reference/recurring-tasks.md', 'A partial pass is never done: never write `.done` while any step is unfinished'],
    ['I8 .done waits for the tool reply', 'tasks/ping-run.md', '`.done` waits for that reply and your action on it'],
    ['I9 an unswapped pointer runs as a ping', 'reference/recurring-tasks.md', 'Until it is swapped, a pointer loads the ping through `--expand`'],
    ['I10 project additions are saved before the swap', 'reference/recurring-tasks.md', 'first save its project additions word for word to `<report_dir>/project-additions.md`'],
    ['I11 the run check prints every receipt state', 'reference/recurring-tasks.md', 'prints every run unrelayed after 15 minutes or unfinished past its next fire (`RUN PENDING`), every broken receipt (`RECEIPT BROKEN`) and every receipt with no stamp (`RECEIPT ORPHAN`)'],
    ['I12 a deferred or paused run notifies the owner', 'reference/recurring-tasks.md', 'A run you defer or pause gets one notified owner line the same turn: why, and when it resumes'],
    ['I12 D3 (option a): a normal start does not notify', 'reference/recurring-tasks.md', 'A normal start shows only as its home-thread line and your project-chat Update line, with no notification.'],
    ['I12 the principle', 'repo/controller/principles.md', 'A scheduled run the controller defers or pauses gets one notified owner line: why, and when it resumes.'],
    ['I13 run work never takes the gate lane', 'reference/recurring-tasks.md', "Run work happens in your turn and the task's home thread, so it never takes or waits for a gate lane."],
    ['matrix: ping run, stamp only', 'reference/recurring-tasks.md', '| Ping run, stamp only, not `stopped by owner` | Relay its line, write `.relayed`, work its checklist and send tool steps'],
    ['matrix: coordinator behind', 'reference/recurring-tasks.md', '| Ping line starts `COORDINATOR BEHIND`, not `stopped by owner` | Clear the oldest first'],
    ['matrix: deferred or paused', 'reference/recurring-tasks.md', '| Run deferred or paused, not `stopped by owner` | One notified owner line (why, resume point)'],
    ['matrix: run check lines', 'reference/recurring-tasks.md', '| Run check prints `RUN PENDING`, `RECEIPT BROKEN` or `RECEIPT ORPHAN`, not `stopped by owner` | Finish the run, or rewrite the receipt'],
    ['matrix: tasks outdated', 'reference/recurring-tasks.md', '| Ping line starts `TASKS OUTDATED`, not `stopped by owner` | Work the run, then swap the task in place that turn.'],
    ['acting on the receipt lines', 'reference/periodic-runs.md', '- `RUN PENDING`, `RECEIPT BROKEN`, `RECEIPT ORPHAN` (under `UNRELAYED TASK RUNS`)'],
    ['the block names the ping', 'project-instructions.md', 'Each Toolkit scheduled task is a ping bound to its own home thread']
  ];
  for (const [label, rel, phrase] of rows) assert.ok(at(rel).includes(phrase), `${label}: ${rel}`);
});

// Owner rule: the handoff refresh never runs in a scheduled task. No host marks a session as
// scheduled, so every Toolkit task prompt's first tool call creates the file the after-tool handoff
// hook checks first (it runs after each call, so that first call is covered), and whoever runs a
// ping run's tool steps does the same. The file name is the one the hook reads.
test('every Toolkit scheduled task keeps the handoff refresh out of its session with its first tool call', () => {
  const step = '- Your very first tool call, before the first check: run `touch ~/.toolkit-handoff-off` in a shell. The empty file turns Toolkit\'s handoff hook off for this scheduled session.';
  for (const kind of Object.keys(PARAMS)) {
    for (const session of ['bound', 'fresh']) {
      const promptParams = validateParams(kind, { ...PARAMS[kind], session });
      const stored = tasks().render(kind, promptParams, kind === 'custom' ? OWN_TEXT : undefined);
      const [block] = findBlocks(stored).blocks;
      assert.equal(block.body.split('\n')[1], step, `${kind} ${session}: the stored prompt's first step`);
      const loaded = tasks().expand(kind, promptParams);
      if (block.name === 'TASK-PING') assert.ok(loaded.includes(step), `${kind} ${session}: an unswapped pointer's run gets it too`);
    }
  }
  for (const file of ['ping-run.md', 'hourly-nudge.md', 'daily-check-in.md']) {
    assert.ok(fs.readFileSync(path.join(TASKS, file), 'utf8').includes('first runs `touch ~/.toolkit-handoff-off`'), `${file}: tool steps set it first`);
  }
  const hook = fs.readFileSync(path.join(ROOT, 'repo/scripts/toolkit-handoff-hook.cjs'), 'utf8');
  assert.ok(hook.includes("'.toolkit-handoff-off'"), 'the hook reads the file the prompts create');
});
