'use strict';

// The scheduled task prompts a Projects coordinator runs, rendered and checked from Toolkit
// templates. Each closure-matrix row from the self-updating projects plan is a table entry here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { renderBlock, findBlocks } = require('../scripts/toolkit-managed-block.cjs');
const { ProjectsTasks, KEPT_LABEL, PROJECT_HEADING, validateParams, checkMemory, parseArgs } = require('../scripts/toolkit-projects-tasks.cjs');

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
  custom: { project: 'EXAMPLE', repo: 'none', report_dir: '/mnt/project-files/sweep', effort: 'low' }
};
const OWN_TEXT = 'Task: check the example folder and list what changed.\n1. List the folder.\n2. Compare with the last report.';
const params = kind => validateParams(kind, PARAMS[kind]);
const rendered = kind => tasks().render(kind, params(kind), kind === 'custom' ? OWN_TEXT : undefined);

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
function laterMain({ version, template } = {}) {
  return new ProjectsTasks({ root: ROOT, readFile(target, encoding) {
    const text = fs.readFileSync(target, encoding);
    if (version && target.endsWith('version.json')) return JSON.stringify({ version });
    if (template && target.startsWith(TASKS)) return `${text}\n- A step added on main.`;
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
    assert.equal(rendered(kind), rendered(kind));
    assert.deepEqual(cli(t, kind, rendered(kind)), { state: 'current', status: 0 });
    const paramsFile = file(t, 'params.json', JSON.stringify(PARAMS[kind]));
    const args = ['--render', kind, '--params', paramsFile];
    if (kind === 'custom') args.push('--project-text', file(t, 'own.md', OWN_TEXT));
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, rendered(kind));
  }
  assert.equal(run(['--name', 'daily-check-in', '--params', file(t, 'p.json', JSON.stringify(PARAMS['daily-check-in']))]).stdout, 'EXAMPLE: Daily check-in\n');
  assert.equal(run(['--name', 'hourly-nudge', '--params', file(t, 'p.json', JSON.stringify(PARAMS['hourly-nudge']))]).stdout, 'EXAMPLE: Hourly nudge\n');
  assert.equal(run(['--name', 'custom', '--params', file(t, 'p.json', JSON.stringify(PARAMS.custom))]).status, 2);
});

// Closure matrix: input state -> check result.
test('closure matrix: each prompt state gets its check result', t => {
  const checkIn = rendered('daily-check-in');
  const fence = /```toolkit-task-params\n[\s\S]*?\n```/;
  const rows = [
    ['rendered from current main, untouched', 'daily-check-in', checkIn, 'current', 0],
    ['template changed on main, params same', 'daily-check-in', laterMain({ template: true }).check('daily-check-in', checkIn).state, null],
    ['params block changed by the project', 'daily-check-in', checkIn.replace('"effort": "medium"', '"effort": "high"'), 'outdated', 1],
    ['text inside markers hand-edited', 'daily-check-in', replaceBlockBody(checkIn, 'DAILY-CHECK-IN-CHECKS', '\nCHECKS\n', '\nCHECKS (edited)\n'), 'edited', 1],
    ['a Toolkit block deleted', 'daily-check-in', checkIn.replace(/<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN DAILY-CHECK-IN-CHECKS[\s\S]*?END DAILY-CHECK-IN-CHECKS -->\n/, ''), 'edited', 1],
    ['owner lines in the additions section changed', 'daily-check-in', checkIn.replace('- none', '- Also list the example sweep.'), 'current', 0],
    ['legacy prompt, no markers', 'daily-check-in', 'EXAMPLE daily check-in\n1. Do the checks.\n', 'missing', 1],
    ['legacy prompt with only a params block', 'daily-check-in', `${checkIn.match(fence)[0]}\nOld steps.\n`, 'missing', 1],
    ['two BEGIN markers', 'daily-check-in', checkIn.replace('<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN TASK-DELIVERY', '<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN TASK-RUN-SETUP v2 toolkit=1.0.0 sha256=000000000000 -->\n<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN TASK-DELIVERY'), 'malformed', 2],
    ['broken END marker', 'daily-check-in', checkIn.replace(':END TASK-DELIVERY', ':END OTHER'), 'malformed', 2],
    ['bad params JSON', 'daily-check-in', checkIn.replace('"effort": "medium"', '"effort": medium'), 'malformed', 2],
    ['param fails validation', 'daily-check-in', checkIn.replace('"report_dir": "/mnt/project-files/daily-check-in"', '"report_dir": "/tmp/elsewhere"'), 'malformed', 2],
    ['unknown param', 'daily-check-in', checkIn.replace('"effort": "medium"', '"effort": "medium", "note": "x"'), 'malformed', 2],
    ['two params blocks', 'daily-check-in', checkIn.replace(fence, match => `${match}\n\n${match}`), 'malformed', 2],
    ['unclosed params block', 'daily-check-in', checkIn.replace(/(```toolkit-task-params\n[\s\S]*?\n)```/, '$1'), 'malformed', 2],
    ['markers without a params block', 'daily-check-in', checkIn.replace(fence, ''), 'malformed', 2],
    ['a check-in prompt checked as the nudge', 'hourly-nudge', checkIn, 'malformed', 2],
    ['custom: shell current, own section changed', 'custom', rendered('custom').replace('List the folder.', 'List both folders.'), 'current', 0],
    ['custom: hand edit inside a shell block', 'custom', replaceBlockBody(rendered('custom'), 'TASK-RUN-SETUP', 'RUN SETUP', 'RUN SETUP (mine)'), 'edited', 1],
    ['custom carrying a check-in block', 'custom', checkIn.replace(/"effort": "medium"/, '"effort": "medium", "session": "fresh"'), 'malformed', 2],
    ['text before run setup', 'daily-check-in', `Project note first.\n${checkIn}`, 'misplaced', 1],
    ['text after delivery', 'daily-check-in', `${checkIn}Project note last.\n`, 'misplaced', 1],
    ['only blank lines around the blocks', 'daily-check-in', `\n\n${checkIn}\n\n`, 'current', 0]
  ];
  assert.equal(rows[1][2], 'outdated', 'template changed on main');
  for (const [label, kind, text, state, status] of rows) {
    if (state === null) continue;
    assert.deepEqual(cli(t, kind, text), { state, status }, label);
  }
  // Base blocks out of the fixed order.
  const blocks = findBlocks(checkIn).blocks;
  const checks = blocks.find(block => block.name === 'DAILY-CHECK-IN-CHECKS');
  const checksText = checkIn.slice(checks.start, checks.end);
  const swapped = checkIn.replace(`${checksText}\n`, '').replace('```toolkit-task-params', `${checksText}\n\n\`\`\`toolkit-task-params`);
  assert.deepEqual(cli(t, 'daily-check-in', swapped), { state: 'misplaced', status: 1 }, 'checks before params');
  // A Toolkit version bump with the same bodies reads outdated.
  assert.equal(laterMain({ version: '99.0.0' }).check('daily-check-in', checkIn).state, 'outdated');
  // Unknown task kind is a usage error.
  assert.equal(run(['--check', 'drift-watch', file(t, 'p.md', checkIn)]).status, 2);
});

test('refresh replaces only Toolkit text and keeps the params block and project text byte for byte', t => {
  const params = '```toolkit-task-params\n{"project":"EXAMPLE","repo":"example-owner/example-repo","report_dir":"/mnt/project-files/daily-check-in","effort":"medium"}\n```';
  const project = 'Project additions:\n- Also list the example sweep.\n  - indented, with trailing spaces   \n- Second rule.';
  const old = laterMain({ version: '1.0.0' });
  const blocks = old.expectedBlocks('daily-check-in', validateParams('daily-check-in', JSON.parse(params.split('\n')[1]))).map(renderBlock);
  const live = [blocks[0], '', params, '', blocks[1], '', project, '', blocks[2], ''].join('\n');
  assert.equal(tasks().check('daily-check-in', live).state, 'outdated');
  const refreshed = tasks().refresh('daily-check-in', live);
  assert.equal(tasks().check('daily-check-in', refreshed).state, 'current');
  assert.ok(refreshed.includes(`\n${params}\n`), 'params block kept byte for byte');
  assert.ok(refreshed.includes(`\n${project}\n`), 'project text kept byte for byte');
  // CLI agrees, and a refresh of a current prompt changes nothing.
  const target = file(t, 'live.md', live);
  assert.equal(run(['--refresh', 'daily-check-in', target, '--session', 'bound']).stdout, refreshed);
  assert.equal(run(['--refresh', 'daily-check-in', target]).status, 2, 'a Toolkit task refresh names the session its replacement runs in');
  assert.equal(tasks().refresh('daily-check-in', refreshed), refreshed);
  // Misplaced project text (after delivery) moves into the project section, words unchanged.
  const misplaced = tasks().refresh('daily-check-in', `${refreshed}Late owner line.\n`);
  assert.equal(tasks().check('daily-check-in', misplaced).state, 'current');
  assert.ok(misplaced.includes(`${project}\n\nLate owner line.\n`));
});

test('refresh of an edited block keeps the added lines, labelled, and malformed holds', t => {
  const edited = replaceBlockBody(rendered('hourly-nudge'), 'HOURLY-NUDGE-CHECKS', 'CHECKS\n', 'CHECKS\n- Project step typed inside the block.\n');
  assert.equal(tasks().check('hourly-nudge', edited).state, 'edited');
  const refreshed = tasks().refresh('hourly-nudge', edited);
  assert.equal(tasks().check('hourly-nudge', refreshed).state, 'current');
  assert.ok(refreshed.includes(`${PROJECT_HEADING}\n- none\n${KEPT_LABEL}\n- Project step typed inside the block.\n`));
  assert.throws(() => tasks().refresh('hourly-nudge', `${edited}\n${edited}`));
  assert.equal(run(['--refresh', 'hourly-nudge', file(t, 'bad.md', edited.replace(':END TASK-DELIVERY', ':END X')), '--session', 'bound']).status, 2);
});

test('a legacy prompt migrates only with params and moved project text; custom needs its own steps', t => {
  const legacy = 'EXAMPLE nudge\n1. Old steps.\n';
  assert.throws(() => tasks().refresh('hourly-nudge', legacy));
  const migrated = tasks().refresh('hourly-nudge', legacy, { params: params('hourly-nudge'), projectText: '- Kept project step, word for word.' });
  assert.equal(tasks().check('hourly-nudge', migrated).state, 'current');
  assert.ok(migrated.includes('\n- Kept project step, word for word.\n'));
  assert.throws(() => tasks().refresh('hourly-nudge', rendered('hourly-nudge'), { params: params('hourly-nudge') }), 'params only for a legacy prompt');
  assert.throws(() => tasks().render('custom', params('custom')), 'custom has no default section');
  assert.throws(() => tasks().render('daily-check-in', params('daily-check-in'), rendered('hourly-nudge')), 'no markers in project text');
  const paramsFile = file(t, 'p.json', JSON.stringify(PARAMS['hourly-nudge']));
  const result = run(['--refresh', 'hourly-nudge', file(t, 'legacy.md', legacy), '--params', paramsFile, '--session', 'bound']);
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

test('templates hold no ids, owner names, project-only tasks or old resolve rules, and fill every placeholder', () => {
  for (const name of fs.readdirSync(TASKS)) {
    const text = fs.readFileSync(path.join(TASKS, name), 'utf8');
    assert.doesNotMatch(text, /trig_|chan_|cmsg_|session_01|weijunswj|xPass|WJ_Lappy|TOOLKIT:|SWOO/, name);
    // The skill drift watch is part of the daily check-in now (SKILL DRIFT), never a separate task.
    assert.doesNotMatch(text, /drift watch|resolve window|idle window|default 2 days|IDLE-2D/i, name);
    assert.doesNotMatch(text, /AI-AGENT-TOOLKIT:/, name);
    assert.doesNotMatch(text, /[^\x00-\x7f]/, name);
  }
  for (const kind of ['daily-check-in', 'hourly-nudge', 'custom']) {
    for (const repo of ['example-owner/example-repo', 'none']) {
      const text = tasks().render(kind, validateParams(kind, { ...PARAMS[kind], repo }), kind === 'custom' ? OWN_TEXT : undefined);
      assert.doesNotMatch(text, /\{\{|^\[[a-z-]+\]/m, `${kind} ${repo}`);
      if (repo === 'none') assert.doesNotMatch(text, /example-owner\/example-repo/);
    }
  }
  const noRepo = tasks().render('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo: 'none', parent_issue: 'none' }));
  assert.match(noRepo, /11\. GitHub: none \(no repo\)\./);
  assert.match(noRepo, /\*\*Binding:\*\* none \(no repo\)/);
  assert.doesNotMatch(noRepo, /issue #/);
  assert.match(rendered('daily-check-in'), /New comments on issue #12/);
});

test('every Toolkit-made prompt carries the recurring-task requirements; fresh runs self-resolve, the bound nudge never does', () => {
  for (const kind of ['daily-check-in', 'hourly-nudge', 'custom']) {
    const text = rendered(kind);
    for (const required of ['set_effort_level', '/latest.md (overwrite), then read it back', 'at most 1,500 characters', 'retry once',
      'never claim it was delivered', 'Never end any message with a question to the owner', 'Project additions in this prompt override the Toolkit base where they differ',
      'Never write project memory, the binding line or project instructions', 'mcp__hearthbot__no_reply_needed']) {
      assert.ok(text.includes(required), `${kind}: ${required}`);
    }
  }
  const checkIn = rendered('daily-check-in');
  assert.match(checkIn, /fires into its own home thread/);
  assert.match(checkIn, /Never resolve this home thread/);
  assert.doesNotMatch(checkIn, /set_thread_resolved|Fresh session per run/);
  const nudge = rendered('hourly-nudge');
  assert.match(nudge, /fires into its own home thread/);
  assert.match(nudge, /Never resolve this home thread/);
  assert.match(nudge, /CONTEXT RESET DUE/);
  assert.doesNotMatch(nudge, /set_thread_resolved|Fresh session per run/);
  const bound = tasks().render('custom', validateParams('custom', { ...PARAMS.custom, session: 'bound' }), OWN_TEXT);
  assert.match(bound, /Never resolve this home thread/);
  assert.doesNotMatch(bound, /set_thread_resolved/);
  // The fresh-session fallback renders as a fresh run that resolves its own thread, keeps session in
  // its params so a refresh or check keeps it, and a bound Toolkit task stores no session at all.
  for (const kind of ['daily-check-in', 'hourly-nudge']) {
    assert.equal(validateParams(kind, PARAMS[kind]).session, undefined, kind);
    const params = validateParams(kind, { ...PARAMS[kind], session: 'fresh' });
    assert.equal(params.session, 'fresh');
    const fresh = tasks().render(kind, params, '');
    assert.match(fresh, /set_thread_resolved/, kind);
    assert.doesNotMatch(fresh, /Never resolve this home thread/, kind);
    assert.equal(tasks().check(kind, fresh).state, 'current', kind);
    // A swap moves a task between the fallback and bound, keeping the project text.
    const withText = tasks().render(kind, params, 'Project step kept.');
    const moved = tasks().refresh(kind, withText, { session: 'bound' });
    assert.match(moved, /Never resolve this home thread/, kind);
    assert.doesNotMatch(moved, /set_thread_resolved|"session"/, kind);
    assert.match(moved, /Project step kept\./, kind);
    assert.equal(tasks().check(kind, moved).state, 'current', kind);
    const back = tasks().refresh(kind, moved, { session: 'fresh' });
    assert.match(back, /"session": "fresh"/, kind);
    assert.match(back, /set_thread_resolved/, kind);
    assert.throws(() => tasks().refresh(kind, moved, { session: 'sometimes' }), kind);
    // The session-mismatch loop: a bound entry whose stored prompt was rendered fresh. The swap
    // always names the replacement's session, so the result is bound and the check stays current.
    const repaired = tasks().refresh(kind, tasks().render(kind, params, ''), { session: 'bound' });
    assert.doesNotMatch(repaired, /"session"|set_thread_resolved/, kind);
    assert.equal(tasks().refresh(kind, repaired, { session: 'bound' }), repaired, `${kind}: a second swap changes nothing`);
  }
  assert.throws(() => tasks().refresh('custom', tasks().render('custom', validateParams('custom', PARAMS.custom), OWN_TEXT), { session: 'bound' }), 'a custom task keeps its own session');
});

test('only the project that runs the Toolkit repo watches other projects, and only reports', () => {
  const other = rendered('daily-check-in');
  assert.doesNotMatch(other, /OTHER PROJECTS:/);
  const own = tasks().render('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], repo: 'weijunswj/ai-agent-toolkit' }));
  assert.match(own, /OTHER PROJECTS: this project runs the Toolkit repo/);
  for (const required of ['reusing the same list_triggers result (no extra calls)', 'Group the cloud tasks by hearth_channel_id',
    '"PROJECT TASKS MISSING: <PROJECT>=<task>[+<task>], ... | "', 'unless state.md already reported the same set',
    'Report only: that project\'s own coordinator recreates its tasks on its next wake']) {
    assert.ok(own.includes(required), required);
  }
});

test('the check-in carries every prefix in the fixed order and checks both Toolkit tasks; the nudge compares cheaply first', () => {
  const text = rendered('daily-check-in');
  const order = ['CONTEXT RESET DUE', 'SKILL UPDATE', 'SKILL DRIFT', 'SKILL BEHIND', 'BLOCK OUTDATED', 'BINDING STALE or BINDING UNKNOWN', 'TOOLKIT CHANGED', 'MEMORY FORMAT', 'TASKS OUTDATED', 'NUDGE NOT ARMED', 'PROJECT TASKS MISSING', 'PLUGIN BEHIND'];
  const line = text.split('\n').find(entry => entry.startsWith('- First line:'));
  const positions = order.map(prefix => line.indexOf(prefix));
  assert.ok(positions.every((at, index) => at > -1 && (index === 0 || at > positions[index - 1])), line);
  for (const required of ['"EXAMPLE: Daily check-in"', '"EXAMPLE: Hourly nudge"', '--check daily-check-in', '--check hourly-nudge',
    '--check-memory', 'bound to its home thread (persist_session true), or a fresh session per run (persist_session false) only where the entry says fresh', 'CONTEXT RESET DUE, SKILL UPDATE', 'weekly-rebuild', 'unlisted', 'hearth_channel_id',
    'advice only', 'local, advice', 'Never suggest moving a local task to the cloud', '--declined-dedupe', 'overlaps',
    'remove the Toolkit plugin only', 'state done', 'older than 65 minutes', 'Never flag other memory lines',
    'git hash-object --stdin', 'matches no revision', '/skill-drift/', 'unless state.md already reported these hashes',
    'every run reaches the owner as one line', 'swaps each named Toolkit task from the template on main the same turn']) {
    assert.ok(text.includes(required), required);
  }
  // The check-in posts the skill update card itself, once per main Version, and never over direct account edits.
  for (const required of ['SKILL CARD: post one skill update card only when all of these hold', 'never on SKILL DRIFT: a card would overwrite direct edits',
    'the account folder is under 26 hours old', 'every account reference/*.md is absent or equal to main', 'state.md records no "card <main Version>"',
    'Otherwise call propose_skills', 'skillMd main\'s SKILL.md byte for byte', 'even when state.md already reported this Version',
    ', card posted', 'fails or is skipped for any other reason', ', card failed: <reason>', 'tap Save on the skill card',
    'A reference file missing from the account is not drift', 'straight after the call and read it back', 'SKILL BEHIND (carried forward while still seen)', 'every "card <Version>" record (this run\'s and all earlier ones, carried forward)']) {
    assert.ok(text.includes(required), required);
  }
  // Drift needs the full history (and a failed fetch never reports drift), plugin lag shows every run and is reported once per main version,
  // and a coordinator that posts skill cards itself gets "card due" instead of a second card.
  for (const required of ['`git -C TK fetch --unshallow` once and hash every revision again', 'If that fetch fails, report no SKILL DRIFT and post no card',
    '"drift unverified: unshallow failed: <error>"', 'When memory has the line "skill cards: coordinator", do not call propose_skills: write ", card due"',
    'Equal: "**Plugin:** current (<version>)"', 'take the newest commit whose plugin.json has the account version; main moved past it at the next newer commit',
    'use the oldest commit whose version is above the account\'s', 'age unverified: unshallow failed: <error>" and no prefix, and name it on the first line as stuck', 'Under 24 hours ago: name both versions and that commit under **Plugin:**',
    'unless state.md has "plugin behind <main version>"', 'its "plugin behind <version>" record', 'No agent can update the plugin',
    'remove the Toolkit plugin only and let it reinstall; if it is still behind, select Check for updates on its marketplace',
    '"plugin behind <main version>" for the version reported as PLUGIN BEHIND (carried forward while the account copy is still behind)',
    'Omit empty bullets except Skill, Block, Binding, Tasks, Nudge, Plugin and Run.']) {
    assert.ok(text.includes(required), required);
  }
  assert.doesNotMatch(text, /skip the resolve in DELIVERY/, 'bound runs never resolve, so no fresh-only card line');
  const freshCheckIn = tasks().render('daily-check-in', validateParams('daily-check-in', { ...PARAMS['daily-check-in'], session: 'fresh' }));
  assert.match(freshCheckIn, /When this run posted a card, skip the resolve in DELIVERY: a resolved thread hides the card\./);
  // Both Toolkit tasks are bound now, so a bound check-in is never its own gap.
  assert.doesNotMatch(text, /the check-in runs a fresh session per run/);
  assert.match(text, /bound-session or fresh-session when that differs from the entry/);
  const nudge = rendered('hourly-nudge');
  // The cheap check reads the last run's state first and skips the full sweep when nothing moved;
  // the binding check is daily only, so the nudge clones nothing.
  assert.ok(nudge.indexOf('nudge-state.md') > -1 && nudge.indexOf('nudge-state.md') < nudge.indexOf('list_threads'), 'cheap compare before the sweep');
  assert.match(nudge, /no change since <time>/);
  assert.doesNotMatch(nudge, /git ls-remote|git clone|BINDING/);
  assert.match(nudge, /CONTEXT RESET DUE \(weekly\)/);
  // Each task reports the other missing, so the coordinator recreates a deleted one.
  assert.ok(nudge.includes('is missing (no such trigger in list_triggers'), 'nudge sees a deleted check-in');
  assert.ok(rendered('daily-check-in').includes('is missing (no such trigger in list_triggers'), 'check-in sees a deleted nudge');
  assert.match(nudge, /It runs silently: it never posts in its home thread except to report a failed delivery/);
  for (const required of ['all three hold', 'Idleness is never a reason', 'Never list a task home thread', 'Unrelayed', 'Hidden reply',
    'state done', '"EXAMPLE: Daily check-in"', 'CHECK-IN NOT ARMED', 'limit 10', 'list all of them every run']) {
    assert.ok(nudge.includes(required), required);
  }
  assert.match(nudge, /not SUCCEEDED, or its home thread is resolved, start the first line with "CHECK-IN NOT ARMED/);
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
    ['', ['MEMORY FORMAT: BINDING missing', 'MEMORY FORMAT: SCHEDULED TASKS missing'], 1]
  ];
  for (const [text, lines, exitCode] of rows) assert.deepEqual(checkMemory(text), { lines, exitCode }, text);
});

test('every setup step that creates something has an inventory row, and every row is checked by the daily check-in', () => {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const setup = fs.readFileSync(SETUP, 'utf8').replace(/\r\n/g, '\n');
  assert.match(fs.readFileSync(SKILL, 'utf8'), /reference\/setup\.md/, 'the skill routes setup to its reference file');
  const steps = [...setup.matchAll(/^(\d+)\. \*\*/gm)].map(match => Number(match[1]));
  assert.deepEqual(steps, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const covered = new Set(inventory.rows.flatMap(row => row.setup_steps));
  for (const step of steps) {
    assert.ok(covered.has(step) || Object.prototype.hasOwnProperty.call(inventory.steps_without_artefacts, String(step)), `setup step ${step}`);
  }
  for (const step of Object.keys(inventory.steps_without_artefacts)) assert.ok(!covered.has(Number(step)), `step ${step} listed twice`);
  const template = fs.readFileSync(path.join(TASKS, 'daily-check-in.md'), 'utf8');
  for (const row of inventory.rows) {
    assert.match(row.resync, /^(auto|owner|report)\b/, row.id);
    if (row.check !== 'never changed') assert.ok(template.includes(row.check), `${row.id}: ${row.check}`);
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
  const acts = /\b(?:re-?arm|rebuil[dt]|re-?creat|swap|set up the|re-?enabl|restor|refresh|replac|switch|re-?add|resum|fire (?:it |them )?again|update (?:the|those|its)\b[^.]*prompt|creat(?:e|es) (?:it|them|the|a)\b|starts? (?:a )?new home thread)/i;
  for (const line of ['Re-arm any recurring job that missed its run.', 'Rebuild the home thread when it is a week old.', 'Re-create the schedule when its cron drifts.',
    'Swap both from the template on main.', 'Start a new home thread for it.', 'The coordinator creates it again from main.']) assert.match(line, acts, line);
  const notPaths = [
    'Whenever the user asks for anything recurring', "**The project's own tasks**", 'Reference for the `web-controller-projects` skill',
    'A cloud thread creates, recreates and deletes tasks', '3. Create the replacement', '4. Rewrite the `SCHEDULED TASKS:` line', '7. Weekly rebuild:', '**It is bound to its own home thread,**',
    'Every Toolkit scheduled task is bound to its own home thread (`<PROJECT>: <task name>`): start', '**Toolkit-made tasks** (the daily check-in and the hourly nudge) are rendered', 'Resolve candidates:',
    'When a recurring task replaces an older one, delete the older one',
    'Toolkit-made task swaps under their safeguards', 'so the coordinator rebuilds this home thread', '2. Render the new prompt',
    // Lines about other things that happen to use one of the verbs: repos, setup, GitHub reads,
    // shared checkouts, Remote Control, the instructions sync and the repo map.
    '- A project with no repo attached gets this coordinator contract', 'Before any other work as a newly appointed controller', '**Threads do GitHub reads.**',
    '- Local sessions sharing one checkout must not clash', '**Remote Control wake.**', '4. Check the result: `--check` reads `current`', '5. Post one short note in project chat: block version',
    '- On undo, restore the saved copy and record `declined project-instructions', '**Dedupe in the same change.**', '**Evidence before "done":**',
    'start a bounded G0 to create or refresh it before you plan anything',
    // The reconciler's `refresh` command brings programme pages up to date; it touches no task.
    '**Programme pages refresh themselves, without tokens.**', '5b. Programme sweep',
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
  assert.match(fs.readFileSync(path.join(dir, 'reference', 'recurring-tasks.md'), 'utf8'), /--refresh <kind> <old prompt file> --session <bound\|fresh>` keeps the params and project text and always names the session the replacement runs in/);
});
