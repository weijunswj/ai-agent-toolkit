'use strict';

// Memory tidy: fixtures only (a temp HOME with its own Claude Code config folder, real Git
// repositories, a worktree and a second clone), the real Toolkit checkout as the installed release.
// Each test names the command x state x role row of the G0 model it proves.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tidyModule = require('../scripts/toolkit-memory-tidy.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
const RULE_FILE = 'repo/contracts/agent-rules/global-rules.md';
const RULE_QUOTE = 'No AI attribution in commits or PRs: no Co-Authored-By or session trailers, session links or "Generated with" footers.';
const GONE_PATH = 'repo/scripts/toolkit-memory-tidy-retired-example.cjs';
const FACT_LINE = 'Worktrees need NODE_PATH pointing at the main checkout for ajv tests.';

const runGit = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const top = folder => path.resolve(runGit(folder, 'rev-parse', '--show-toplevel'));

function note(name, body, extra = '') {
  return `---\nname: ${name}\ndescription: ${name} description words\nmetadata:\n  type: feedback\n---\n\n${body}\n${extra}`;
}

// A temp HOME with one repository: its main checkout (origin with a default branch) and, with
// `extras`, a worktree, a second clone and a scratch repository under .tmp; Claude Code project folders.
function world(t, { notes = true, extras = false } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agent-toolkit-memory-tidy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const config = path.join(home, '.claude');
  fs.mkdirSync(path.join(config, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(config, 'CLAUDE.md'), `<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/global-rules.md:BEGIN GLOBAL-RULES v2 toolkit=${VERSION} sha256=000000000000 -->\n# Rules\n<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/global-rules.md:END GLOBAL-RULES -->\n\n# Owner Preferences\n- Plain words, short replies.\n`);
  const seed = path.join(base, 'seed');
  fs.mkdirSync(seed);
  runGit(seed, 'init', '-q');
  fs.writeFileSync(path.join(seed, 'AGENTS.md'), '# Rules\n\n- Run the tests one file at a time.\n');
  fs.writeFileSync(path.join(seed, '.gitignore'), '.tmp/\n');
  runGit(seed, 'add', '.');
  runGit(seed, 'commit', '-q', '-m', 'seed');
  const origin = path.join(base, 'origin.git');
  runGit(base, 'clone', '-q', '--bare', seed, origin);
  runGit(base, 'clone', '-q', origin, path.join(base, 'work', 'repo'));
  const main = top(path.join(base, 'work', 'repo'));
  let worktree; let clone; let scratch;
  if (extras) {
    runGit(main, 'worktree', 'add', '-q', path.join(base, 'work', 'repo-wt'), '-b', 'wt');
    worktree = top(path.join(base, 'work', 'repo-wt'));
    runGit(base, 'clone', '-q', origin, path.join(base, 'other', 'clone'));
    clone = top(path.join(base, 'other', 'clone'));
    fs.mkdirSync(path.join(main, '.tmp', 'scratch'), { recursive: true });
    runGit(path.join(main, '.tmp', 'scratch'), 'init', '-q');
    scratch = top(path.join(main, '.tmp', 'scratch'));
  }
  const env = { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config };
  const project = (name, cwd) => {
    const dir = path.join(config, 'projects', name);
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    if (cwd) fs.writeFileSync(path.join(dir, 'session-1.jsonl'), `{"type":"queue-operation"}\n${JSON.stringify({ type: 'user', cwd, message: 'x' })}\n`);
    return path.join(dir, 'memory');
  };
  const memory = project(tidyModule.projectName(main), main);
  if (notes) writeNotes(memory);
  return { base, home, config, env, main, worktree, clone, scratch, origin, memory, project, scratchDir: path.join(base, 'scratch') };
}

function writeNotes(memory) {
  const files = {
    'a-default.md': note('a-default', 'Never add attribution footers to commits or pull requests.'),
    'b-outdated.md': note('b-outdated', `Run ${GONE_PATH} before every merge.`),
    'c-fact.md': note('c-fact', FACT_LINE),
    'd-pref.md': note('d-pref', 'The owner likes short replies.'),
    'e-gap.md': note('e-gap', 'Heredocs with backslashes get mangled in Git Bash.'),
    'f-keep.md': note('f-keep', 'The claude CLI is missing from PATH on this computer.', 'See [[a-default]].\n'),
  };
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(memory, file), text);
  fs.writeFileSync(path.join(memory, 'MEMORY.md'), [
    '- [A default](a-default.md) - attribution',
    '- [B outdated](b-outdated.md) - old script',
    '- [C fact](c-fact.md) - node path',
    '- [D pref](d-pref.md) - short replies',
    '- [E gap](e-gap.md) - heredocs',
    '- [F keep](f-keep.md) - path gap',
    '- [A again](a-default.md) - duplicate',
    '- [Z gone](z-gone.md) - missing',
    '',
  ].join('\n'));
}

function cli(w, argv, { env = w.env, cwd = w.main, files, refused } = {}) {
  let out = '';
  let err = '';
  const code = tidyModule.main([...argv, '--repo-root', cwd], { stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } }, environment: env, now: () => new Date('2026-11-26T10:00:00.000Z'), files, refused });
  return { code, out, err };
}
// For keep-all, which takes no --repo-root.
function cliBare(w, argv) {
  let out = '';
  let err = '';
  const code = tidyModule.main(argv, { stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } }, environment: w.env, now: () => new Date('2026-11-26T10:00:00.000Z') });
  return { code, out, err };
}

const sheetFile = w => path.join(w.scratchDir, 'worksheet.json');
const readSheet = w => JSON.parse(fs.readFileSync(sheetFile(w), 'utf8'));
const writeSheet = (w, sheet) => fs.writeFileSync(sheetFile(w), JSON.stringify(sheet, null, 2));
const row = (sheet, file) => sheet.notes.find(entry => entry.file === file);

// check, then the agent's verdicts for the standard notes; `change` edits the filled sheet.
function filled(w, change = () => {}) {
  const checked = cli(w, ['check', '--out', sheetFile(w)]);
  assert.equal(checked.code, 0, checked.err);
  const sheet = readSheet(w);
  const set = (file, fields) => Object.assign(row(sheet, file), fields);
  set('a-default.md', { verdict: 'default', gist: 'No attribution footers in commits or PRs.', evidence: { file: RULE_FILE, quote: RULE_QUOTE } });
  set('b-outdated.md', { verdict: 'outdated', gist: 'Runs a script Toolkit retired.', evidence: { missing_path: GONE_PATH } });
  set('c-fact.md', { verdict: 'repo-fact', gist: 'Worktree test setup for ajv.', move: { to: 'repository', file: 'AGENTS.md', line: FACT_LINE } });
  set('d-pref.md', { verdict: 'owner-preference', gist: 'Short replies.' });
  set('e-gap.md', { verdict: 'gap', gist: 'Heredoc mangling on Windows.', gap: { failure: 'Scripts written by heredoc lose backslashes.', route: 'new' } });
  set('f-keep.md', { verdict: 'keep', gist: 'PATH gap on this computer.', why: 'A fact about one computer that belongs nowhere else.' });
  for (const entry of sheet.index) entry.verdict = entry.fixable ? 'fix' : 'keep';
  change(sheet);
  writeSheet(w, sheet);
  return sheet;
}

function verified(w, change) {
  const sheet = filled(w, change);
  const result = cli(w, ['verify', '--worksheet', sheetFile(w)]);
  assert.equal(result.code, 0, result.err);
  return { sheet, plan: /Plan code \(for the agent\): ([0-9a-f]{16})/.exec(result.out)[1], out: result.out };
}

const indexRow = (sheet, kind) => sheet.index.find(entry => entry.kind === kind);
const previewCode = out => /Preview code \(for the agent\): ([0-9a-f]{16})/.exec(out)[1];
// Every file under a folder with its bytes, for byte-for-byte comparison.
function snapshot(folder) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out[rel] = fs.readFileSync(path.join(dir, entry.name)).toString('base64');
    }
  };
  walk(folder, '');
  return out;
}
const backups = w => `${w.memory}-tidy-backups`;

// ---- find ----

test('find: lists the main, worktree and other-clone folders, leaves scratch repositories out, holds a gone folder as unresolved and counts empty ones (G0 test 1)', t => {
  const w = world(t, { extras: true });
  const worktreeMemory = w.project(tidyModule.projectName(w.worktree), w.worktree);
  fs.writeFileSync(path.join(worktreeMemory, 'old.md'), note('old', 'An old worktree note.'));
  const cloneMemory = w.project('elsewhere-clone', w.clone);
  fs.writeFileSync(path.join(cloneMemory, 'clone.md'), note('clone', 'A clone note.'));
  const scratchMemory = w.project(`${tidyModule.projectName(w.main)}--tmp-scratch`, w.scratch);
  fs.writeFileSync(path.join(scratchMemory, 'scratch.md'), note('scratch', 'A scratch note.'));
  const goneMemory = w.project(`${tidyModule.projectName(w.main)}-gone`, path.join(w.main, 'gone-subfolder'));
  fs.writeFileSync(path.join(goneMemory, 'gone.md'), note('gone', 'A note from a folder that is gone.'));
  w.project(`${tidyModule.projectName(w.main)}-empty`, w.main);
  const otherRepo = path.join(w.base, 'unrelated');
  fs.mkdirSync(otherRepo);
  runGit(otherRepo, 'init', '-q');
  fs.writeFileSync(path.join(w.project('unrelated', top(otherRepo)), 'u.md'), note('u', 'Another repository.'));

  const found = new tidyModule.MemoryTidy({ repoRoot: w.worktree, environment: w.env }).find();
  const kinds = Object.fromEntries(found.included.map(folder => [folder.path, folder.kind]));
  assert.deepEqual(kinds, { [w.memory]: 'main', [worktreeMemory]: 'worktree', [cloneMemory]: 'clone' });
  assert.deepEqual(found.unresolved.map(folder => folder.path), [goneMemory]);
  assert.equal(found.empty, 1);
  const listed = cli(w, ['find']);
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /\*\*Main folder\*\* `[^`]+`: 6 notes; MEMORY\.md 8 lines/);
  assert.match(listed.out, /index: 1 duplicate line, 1 line to a missing note\./);
  assert.match(listed.out, /\*\*Empty memory folders:\*\* 1/);
  assert.doesNotMatch(listed.out, /attribution footers|short replies/i, 'find prints no note text');
});

test('find: an autoMemoryDirectory in the user settings is the folder used (G0 test 2)', t => {
  const w = world(t, { notes: false });
  const custom = path.join(w.base, 'custom-memory');
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, 'x.md'), note('x', 'A note in the moved folder.'));
  fs.writeFileSync(path.join(w.config, 'settings.json'), JSON.stringify({ autoMemoryDirectory: custom }));
  const found = new tidyModule.MemoryTidy({ repoRoot: w.main, environment: w.env }).find();
  assert.deepEqual(found.included.map(folder => [folder.path, folder.kind]), [[custom, 'setting']]);
});

// ---- check ----

test('check: refuses when the global rules came from another release, and writes nothing (G0 test 3)', t => {
  const w = world(t);
  const rules = path.join(w.config, 'CLAUDE.md');
  fs.writeFileSync(rules, fs.readFileSync(rules, 'utf8').replace(`toolkit=${VERSION}`, 'toolkit=0.0.1'));
  const result = cli(w, ['check', '--out', sheetFile(w)]);
  assert.equal(result.code, 1);
  assert.match(result.err, /global rules came from 0\.0\.1.*Run refresh toolkit/);
  assert.equal(fs.existsSync(sheetFile(w)), false);
  fs.rmSync(rules);
  assert.match(cli(w, ['check', '--out', sheetFile(w)]).err, /no Toolkit global rules block/);
});

test('check: refuses a worksheet inside the repository unless Git ignores it (G0 test 4)', t => {
  const w = world(t);
  const tracked = cli(w, ['check', '--out', path.join(w.main, 'notes', 'worksheet.json')]);
  assert.equal(tracked.code, 1);
  assert.match(tracked.err, /Git does not ignore it, so note text could be committed/);
  assert.equal(fs.existsSync(path.join(w.main, 'notes')), false);
  assert.match(cli(w, ['check', '--out', path.join(w.memory, 'sheet.json')]).err, /may not go inside Claude Code's project folders/);
  const ignored = cli(w, ['check', '--out', path.join(w.main, '.tmp', 'worksheet.json')]);
  assert.equal(ignored.code, 0, ignored.err);
});

test('check: a duplicate line, a missing target, an unindexed note and an index past 200 lines give four index rows (G0 test 5)', t => {
  const w = world(t, { notes: false });
  fs.writeFileSync(path.join(w.memory, 'a.md'), note('a', 'A.'));
  fs.writeFileSync(path.join(w.memory, 'b.md'), note('b', 'B.'));
  const filler = Array.from({ length: 200 }, (_, at) => `filler line ${at}`);
  fs.writeFileSync(path.join(w.memory, 'MEMORY.md'), ['- [A](a.md)', '- [A again](a.md)', '- [Gone](gone.md)', ...filler].join('\n'));
  assert.equal(cli(w, ['check', '--out', sheetFile(w)]).code, 0);
  const sheet = readSheet(w);
  assert.deepEqual(sheet.index.map(entry => [entry.kind, entry.line, entry.target, entry.fixable]), [
    ['duplicate', 2, 'a.md', true], ['missing', 3, 'gone.md', true], ['unindexed', null, 'b.md', false], ['over-limit', null, null, false],
  ]);
  assert.deepEqual(sheet.notes.map(entry => [entry.n, entry.file, entry.indexed, entry.verdict]), [[1, 'a.md', true, null], [2, 'b.md', false, null]]);
  assert.equal(sheet.release.version, VERSION);
});

// ---- verify ----

test('verify: refuses invented, history, short and still-present evidence, missing or double verdicts and hostile field values (G0 test 6)', t => {
  const w = world(t);
  const changelog = fs.readFileSync(path.join(ROOT, 'repo/docs/CHANGELOG.md'), 'utf8').replace(/\s+/g, ' ').split(' ').slice(60, 72).join(' ');
  const cases = [
    ['invented quote', sheet => { row(sheet, 'a-default.md').evidence.quote = 'Toolkit always adds a friendly footer to every single pull request body.'; }, /does not hold that quote word for word/],
    ['changelog quote', sheet => { row(sheet, 'a-default.md').evidence = { file: 'repo/docs/CHANGELOG.md', quote: changelog }; }, /not a changelog, audit or third-party file/],
    ['five-word quote', sheet => { row(sheet, 'a-default.md').evidence.quote = 'No AI attribution in commits'; }, /under 8 words and is not a whole line/],
    ['path outside the release', sheet => { row(sheet, 'a-default.md').evidence.file = '../AGENTS.md'; }, /must be a current rule/],
    ['missing path still present', sheet => { row(sheet, 'b-outdated.md').evidence.missing_path = 'repo/scripts/toolkit-memory-tidy.cjs'; }, /is still in this release/],
    ['missing path the note never names', sheet => { row(sheet, 'b-outdated.md').evidence.missing_path = 'repo/scripts/toolkit-never-named.cjs'; }, /does not name repo\/scripts\/toolkit-never-named\.cjs/],
    ['no verdict', sheet => { row(sheet, 'd-pref.md').verdict = null; }, /give exactly one verdict/],
    ['two verdicts', sheet => { row(sheet, 'd-pref.md').verdict = ['owner-preference', 'keep']; }, /give exactly one verdict/],
    ['a field another verdict uses', sheet => { row(sheet, 'f-keep.md').evidence = { file: RULE_FILE, quote: RULE_QUOTE }; }, /evidence does not go with the verdict keep/],
    ['keep without why', sheet => { row(sheet, 'f-keep.md').why = null; }, /needs a one-line why/],
    ['index row the tool cannot fix', sheet => { sheet.index[0].fixable = false; }, /memory changed since this worksheet was made/],
    ['edited note facts', sheet => { row(sheet, 'c-fact.md').sha256 = '0'.repeat(64); }, /memory changed since this worksheet was made/],
    ['extra field', sheet => { row(sheet, 'c-fact.md').delete = true; }, /memory changed since this worksheet was made/],
  ];
  const base = filled(w);
  for (const [label, change, expected] of cases) {
    const sheet = JSON.parse(JSON.stringify(base));
    change(sheet);
    writeSheet(w, sheet);
    const result = cli(w, ['verify', '--worksheet', sheetFile(w)]);
    assert.equal(result.code, 1, label);
    assert.match(result.err, expected, label);
    assert.equal(fs.existsSync(path.join(w.scratchDir, 'store-summary.md')), false, `${label}: nothing written`);
  }
});

test('verify: hostile shapes in the fields a decision reads are each refused, never read as valid (default-deny reader)', t => {
  const w = world(t, { notes: false });
  const fields = [];
  for (const shape of hostile.cases(['free-text', 'quoting', 'invisible'])) {
    fields.push(['route', shape], ['move-file', shape], ['verdict', shape], ['evidence-file', shape]);
    // Look-alike letters and quote marks are ordinary display text in a gist; control, format and
    // line-break characters are not.
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(shape.text)) fields.push(['gist', shape]);
  }
  fields.forEach(([, shape], at) => fs.writeFileSync(path.join(w.memory, `h${at}.md`), note(`h${at}`, `Hostile case ${shape.id}.`)));
  fs.writeFileSync(path.join(w.memory, 'MEMORY.md'), `${fields.map((_, at) => `- [H${at}](h${at}.md)`).join('\n')}\n`);
  assert.equal(cli(w, ['check', '--out', sheetFile(w)]).code, 0);
  const sheet = readSheet(w);
  const expected = { route: /a gap needs/, 'move-file': /a move is/, verdict: /give exactly one verdict/, 'evidence-file': /must be a current rule/, gist: /gist is one line of plain text/ };
  fields.forEach(([field, shape], at) => {
    const entry = row(sheet, `h${at}.md`);
    if (field === 'route') Object.assign(entry, { verdict: 'gap', gist: 'A gap.', gap: { failure: 'Something breaks.', route: shape.text } });
    if (field === 'move-file') Object.assign(entry, { verdict: 'repo-fact', gist: 'A fact.', move: { to: 'repository', file: shape.text, line: 'A line of three words.' } });
    if (field === 'verdict') Object.assign(entry, { verdict: shape.text, gist: 'A note.' });
    if (field === 'evidence-file') Object.assign(entry, { verdict: 'default', gist: 'A default.', evidence: { file: shape.text, quote: RULE_QUOTE } });
    if (field === 'gist') Object.assign(entry, { verdict: 'keep', gist: `PATH gap ${shape.text}`, why: 'One computer.' });
  });
  writeSheet(w, sheet);
  const result = cli(w, ['verify', '--worksheet', sheetFile(w)]);
  assert.equal(result.code, 1);
  const lines = result.err.split('\n');
  fields.forEach(([field, shape], at) => {
    const said = lines.find(line => line.startsWith(`- Row ${row(sheet, `h${at}.md`).n} (h${at}.md):`));
    assert.ok(said, `${field} ${shape.id} refused`);
    assert.match(said, expected[field], `${field} ${shape.id}`);
  });
  assert.equal(fs.existsSync(path.join(w.scratchDir, 'store-summary.md')), false);
});

test('verify: prints the grouped owner list and a plan code; the store summary holds file names, verdicts and Toolkit text only; a secret-shaped gist is refused (G0 test 7)', t => {
  const w = world(t);
  const { out } = verified(w);
  for (const heading of ['Already a Toolkit default', 'Out of date or against Toolkit', "This repository's own fact", "The owner's own preference", 'Toolkit gap', 'Kept as memory, with why', 'Index fixes', 'Your answer']) assert.match(out, new RegExp(`\\*\\*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`), heading);
  assert.ok(out.includes(`- **1. a-default.md**: No attribution footers in commits or PRs.\n  - **Toolkit already says:** "${RULE_QUOTE}" (\`${RULE_FILE}\`)`));
  assert.match(out, /\*\*Can be picked:\*\* 1, 2, 3, 7, 8/);
  assert.match(out, /For GitHub \(counts only\): 6 notes in 1 folder: 1 already a toolkit default, 1 out of date or against toolkit, 1 this repository's own fact, 1 the owner's own preference, 1 toolkit gap, 1 kept as memory, with why; 2 index rows\./);
  assert.doesNotMatch(out, /```/, 'the owner list is never a code block');
  const summary = fs.readFileSync(path.join(w.scratchDir, 'store-summary.md'), 'utf8');
  assert.match(summary, /`f[0-9a-f]{8}\/a-default\.md`: already a toolkit default\. Toolkit: `repo\/contracts\/agent-rules\/global-rules\.md`, "No AI attribution/);
  assert.match(summary, /b-outdated\.md`: out of date or against toolkit\. Toolkit no longer has `repo\/scripts\/toolkit-memory-tidy-retired-example\.cjs`/);
  for (const secret of ['No attribution footers', 'Short replies', 'description words', 'Heredoc', 'NODE_PATH', 'belongs nowhere else', 'lose backslashes', 'PATH gap']) assert.ok(!summary.includes(secret), `summary holds ${secret}`);
  const token = ['gh', 'p_', 'x9K2mQ7vR4tL8nB3wZ6yC1dF5gH0jP2sA4eU'].join('');
  fs.rmSync(w.scratchDir, { recursive: true, force: true });
  filled(w, sheet => { row(sheet, 'f-keep.md').gist = `Token ${token} lives here.`; });
  const refused = cli(w, ['verify', '--worksheet', sheetFile(w)]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /shaped like a secret is in owner list line \d+ \(GitHub token\)/);
  assert.ok(!refused.err.includes(token));
  assert.equal(fs.existsSync(path.join(w.scratchDir, 'store-summary.md')), false);
});

// ---- preview ----

test('preview: shows each change in full, names the backup folder and changes nothing (G0 test 13)', t => {
  const w = world(t);
  const { plan } = verified(w, sheet => { row(sheet, 'b-outdated.md').rewrite = note('b-outdated', 'Run the current merge check before every merge.'); });
  const before = snapshot(w.memory);
  const result = cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '1,2,3,7,8']);
  assert.equal(result.code, 0, result.err);
  const out = result.out;
  assert.ok(out.includes(`**Goes: 1. a-default.md** (\`${path.join(w.memory, 'a-default.md')}\`)`));
  assert.ok(out.includes('> Never add attribution footers to commits or pull requests.'), 'full current text');
  assert.ok(out.includes('**Rewritten: 2. b-outdated.md**'));
  assert.ok(out.includes(`  - **Goes:** Run ${GONE_PATH} before every merge.`));
  assert.ok(out.includes('  - **Comes in:** Run the current merge check before every merge.'));
  assert.ok(out.includes('**Held, nothing changes: 3. c-fact.md**'));
  assert.ok(out.includes(`does not hold "${FACT_LINE}" yet`));
  assert.ok(out.includes('- **Line 1** (links a-default.md): - [A default](a-default.md) - attribution'));
  assert.ok(out.includes('- **Line 7** (links a-default.md): - [A again](a-default.md) - duplicate'));
  assert.ok(out.includes('- **Line 8** (links z-gone.md, which is not there): - [Z gone](z-gone.md) - missing'));
  assert.ok(out.includes('- **f-keep.md:** a-default.md'), 'a [[link]] that would dangle is listed');
  assert.match(out, new RegExp(`copied first to \`${path.join(backups(w), '[0-9a-f]{16}').replace(/\\/g, '\\\\')}\``));
  assert.doesNotMatch(out, /```/);
  assert.deepEqual(snapshot(w.memory), before);
  assert.equal(fs.existsSync(backups(w)), false);
  const stale = cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', '0'.repeat(16), '--pick', '1']);
  assert.match(stale.err, /not the one for this worksheet/);
  assert.match(cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '4']).err, /Not a row that can change: 4/);
});

test('the owner is always offered keep everything first, also when every note would go (G0 test 15)', t => {
  const w = world(t);
  const { out, plan } = verified(w);
  const answer = out.slice(out.indexOf('**Your answer**'));
  assert.match(answer, /^\*\*Your answer\*\*\n- \*\*Keep everything:\*\* nothing changes and no backup is made\./);
  const preview = cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '1']).out;
  assert.match(preview.slice(preview.indexOf('**Your answer**')), /^\*\*Your answer\*\*\n- \*\*Keep everything:\*\* nothing changes and no backup is made\.\n- \*\*Yes:\*\*/);
  const w2 = world(t, { notes: false });
  fs.writeFileSync(path.join(w2.memory, 'only.md'), note('only', 'Never add attribution footers.'));
  fs.writeFileSync(path.join(w2.memory, 'second.md'), note('second', 'Also no footers.'));
  fs.writeFileSync(path.join(w2.memory, 'MEMORY.md'), '- [Only](only.md)\n- [Second](second.md)\n');
  assert.equal(cli(w2, ['check', '--out', sheetFile(w2)]).code, 0);
  const sheet = readSheet(w2);
  for (const entry of sheet.notes) Object.assign(entry, { verdict: 'default', gist: 'Restates a default.', evidence: { file: RULE_FILE, quote: RULE_QUOTE } });
  writeSheet(w2, sheet);
  const all = cli(w2, ['verify', '--worksheet', sheetFile(w2)]);
  assert.equal(all.code, 0, all.err);
  assert.match(all.out, /\*\*Your answer\*\*\n- \*\*Keep everything:\*\*/);
  const keepOnly = world(t, { notes: false });
  fs.writeFileSync(path.join(keepOnly.memory, 'k.md'), note('k', 'A PATH fact.'));
  fs.writeFileSync(path.join(keepOnly.memory, 'MEMORY.md'), '- [K](k.md)\n');
  cli(keepOnly, ['check', '--out', sheetFile(keepOnly)]);
  const kept = readSheet(keepOnly);
  Object.assign(kept.notes[0], { verdict: 'keep', gist: 'PATH fact.', why: 'One computer only.' });
  writeSheet(keepOnly, kept);
  const nothing = cli(keepOnly, ['verify', '--worksheet', sheetFile(keepOnly)]);
  assert.match(nothing.out, /- \*\*Keep everything:\*\* nothing changes and no backup is made\.\n- \*\*Nothing here can change:\*\*/);
});

// ---- keep-all ----

test('keep-all: changes nothing, makes no backup and records the answer (G0 test 14)', t => {
  const w = world(t);
  verified(w);
  const before = snapshot(w.memory);
  const result = cliBare(w, ['keep-all', '--worksheet', sheetFile(w)]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Kept everything:\*\* no note changed and no backup was made/);
  assert.deepEqual(snapshot(w.memory), before);
  assert.equal(fs.existsSync(backups(w)), false);
  const kept = /## Answers\n\n- 2026-11-26T10:00:00\.000Z: the owner kept everything; no note changed and no backup was made\.\n$/;
  assert.match(fs.readFileSync(path.join(w.scratchDir, 'store-summary.md'), 'utf8'), kept);
  assert.equal(cli(w, ['verify', '--worksheet', sheetFile(w)]).code, 0);
  assert.match(fs.readFileSync(path.join(w.scratchDir, 'store-summary.md'), 'utf8'), kept, 'a later verify keeps the recorded answer');
});

// ---- apply ----

test('apply: refuses without the shown preview, after a change, for a wipe and in a gate session; memory stays byte for byte (G0 test 8)', t => {
  const w = world(t);
  const { plan } = verified(w, sheet => { row(sheet, 'b-outdated.md').rewrite = note('b-outdated', 'Run the current merge check.'); });
  const code = previewCode(cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '1,2']).out);
  const before = snapshot(w.memory);
  const apply = (picks, preview, extra = {}) => cli(w, ['apply', '--worksheet', sheetFile(w), '--pick', picks, ...(preview ? ['--preview', preview] : [])], extra);
  const noCode = apply('1,2', null);
  assert.equal(noCode.code, 2);
  assert.match(noCode.err, /apply needs --preview/);
  assert.match(apply('1', code).err, /does not match these picks/, 'a code shown for other picks');
  assert.match(apply('1,2', code, { env: { ...w.env, TOOLKIT_GATE_ROLE: 'G1' } }).err, /^A G1 session cannot change memory notes/);
  assert.match(apply('1,2', code, { env: { ...w.env, TOOLKIT_GATE_ROLE: 'G2' } }).err, /^A G2 session cannot/);
  // Other text than the owner saw: the rewrite changed after the preview.
  const sheet = readSheet(w);
  row(sheet, 'b-outdated.md').rewrite = note('b-outdated', 'Something the owner never saw.');
  writeSheet(w, sheet);
  assert.match(apply('1,2', code).err, /does not match these picks and the memory as it is now/);
  row(sheet, 'b-outdated.md').rewrite = note('b-outdated', 'Run the current merge check.');
  writeSheet(w, sheet);
  // A note changed after the preview.
  fs.appendFileSync(path.join(w.memory, 'a-default.md'), 'One more line.\n');
  assert.match(apply('1,2', code).err, /memory changed since this worksheet was made/);
  fs.writeFileSync(path.join(w.memory, 'a-default.md'), Buffer.from(before['a-default.md'], 'base64'));
  assert.deepEqual(snapshot(w.memory), before);
  assert.equal(fs.existsSync(backups(w)), false);
  // A different destination line than the one shown.
  const moving = readSheet(w);
  const movingPlan = /Plan code \(for the agent\): ([0-9a-f]{16})/.exec(cli(w, ['verify', '--worksheet', sheetFile(w)]).out)[1];
  const moveCode = previewCode(cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', movingPlan, '--pick', '3']).out);
  row(moving, 'c-fact.md').move.line = 'A different line the owner never saw here.';
  writeSheet(w, moving);
  assert.match(apply('3', moveCode).err, /does not match/);
  // A wipe: every note in the folder.
  const wipe = world(t, { notes: false });
  fs.writeFileSync(path.join(wipe.memory, 'one.md'), note('one', 'One.'));
  fs.writeFileSync(path.join(wipe.memory, 'MEMORY.md'), '- [One](one.md)\n');
  cli(wipe, ['check', '--out', sheetFile(wipe)]);
  const wiped = readSheet(wipe);
  Object.assign(wiped.notes[0], { verdict: 'default', gist: 'A default.', evidence: { file: RULE_FILE, quote: RULE_QUOTE } });
  writeSheet(wipe, wiped);
  const wipePlan = /Plan code \(for the agent\): ([0-9a-f]{16})/.exec(cli(wipe, ['verify', '--worksheet', sheetFile(wipe)]).out)[1];
  assert.match(cli(wipe, ['preview', '--worksheet', sheetFile(wipe), '--plan', wipePlan, '--pick', '1']).err, /would remove every note .* A tidy never empties a folder/);
  assert.match(cli(wipe, ['apply', '--worksheet', sheetFile(wipe), '--pick', '1', '--preview', '0123456789abcdef']).err, /A tidy never empties a folder/);
  assert.equal(fs.existsSync(path.join(wipe.memory, 'one.md')), true);
});

test('apply: backs up first, then makes exactly the previewed removal, rewrite and index fixes; restore puts it back (G0 tests 9 and 12)', t => {
  const w = world(t);
  const rewrite = note('b-outdated', 'Run the current merge check before every merge.');
  const { plan } = verified(w, sheet => { row(sheet, 'b-outdated.md').rewrite = rewrite; });
  const before = snapshot(w.memory);
  const code = previewCode(cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '1,2,7,8']).out);
  const result = cli(w, ['apply', '--worksheet', sheetFile(w), '--pick', '1,2,7,8', '--preview', code]);
  assert.equal(result.code, 0, result.err);
  const backup = path.join(backups(w), code);
  assert.ok(result.out.includes(`- **Backup (read back):** \`${backup}\``));
  assert.ok(result.out.includes(`restore --backup "${backup}"`));
  assert.match(result.out, /- \*\*Removed:\*\* a-default\.md\n- \*\*Rewritten:\*\* b-outdated\.md\n- \*\*MEMORY\.md lines removed:\*\* 3/);
  assert.match(result.out, /\[\[links\]\] now pointing at a removed note:\*\* f-keep\.md \(a-default\.md\)/);
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(before).sort());
  assert.deepEqual(snapshot(path.join(backup, 'files')), before, 'the backup is the folder as it was');
  const after = snapshot(w.memory);
  assert.equal(after['a-default.md'], undefined);
  assert.equal(Buffer.from(after['b-outdated.md'], 'base64').toString(), rewrite);
  assert.equal(Buffer.from(after['MEMORY.md'], 'base64').toString(), [
    '- [B outdated](b-outdated.md) - old script', '- [C fact](c-fact.md) - node path', '- [D pref](d-pref.md) - short replies',
    '- [E gap](e-gap.md) - heredocs', '- [F keep](f-keep.md) - path gap', ''].join('\n'));
  for (const file of ['c-fact.md', 'd-pref.md', 'e-gap.md', 'f-keep.md']) assert.equal(after[file], before[file], `${file} untouched`);
  assert.deepEqual(tidyModule.indexProblems({ text: Buffer.from(after['MEMORY.md'], 'base64').toString(), bytes: Buffer.from(after['MEMORY.md'], 'base64') }, Object.keys(after).filter(file => file !== 'MEMORY.md').map(file => ({ file }))), []);
  assert.match(fs.readFileSync(path.join(w.scratchDir, 'store-summary.md'), 'utf8'), new RegExp(`the owner said yes to preview ${code}; f[0-9a-f]{8}: removed a-default\\.md; rewrote b-outdated\\.md; removed 3 index lines; backup f[0-9a-f]{8}/${code}\\.`));
  assert.match(cli(w, ['apply', '--worksheet', sheetFile(w), '--pick', '1,2,7,8', '--preview', code]).err, /memory changed since this worksheet was made/, 'a preview applies once');

  assert.match(cli(w, ['restore', '--backup', backup], { env: { ...w.env, TOOLKIT_GATE_ROLE: 'G2' } }).err, /^A G2 session cannot restore/);
  const elsewhere = path.join(w.base, 'other-tidy-backups', code);
  fs.cpSync(backup, elsewhere, { recursive: true });
  assert.match(cli(w, ['restore', '--backup', elsewhere]).err, /is not a memory folder of this repository/);
  const restored = cli(w, ['restore', '--backup', backup]);
  assert.equal(restored.code, 0, restored.err);
  assert.match(restored.out, /\*\*Restored\*\* .* from the backup: 7 files read back\./);
  assert.deepEqual(snapshot(w.memory), before);
  // A backup whose copy no longer matches its checksum list is never used.
  fs.appendFileSync(path.join(backup, 'files', 'a-default.md'), 'tampered\n');
  fs.rmSync(path.join(w.memory, 'a-default.md'));
  assert.match(cli(w, ['restore', '--backup', backup]).err, /backup copy of a-default\.md does not match its checksum/);
  assert.equal(fs.existsSync(path.join(w.memory, 'a-default.md')), false);
});

test('apply: a move goes only once the default branch holds its line; until then the note is held (G0 test 10)', t => {
  const w = world(t);
  const { plan } = verified(w);
  const held = cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '3']);
  const before = snapshot(w.memory);
  const result = cli(w, ['apply', '--worksheet', sheetFile(w), '--pick', '3', '--preview', previewCode(held.out)]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Held \(new home lacks the line\):\*\* c-fact\.md/);
  assert.match(result.out, /Nothing changed\*\* in this folder, so no backup was made/);
  assert.deepEqual(snapshot(w.memory), before);
  // The line lands on the default branch through a normal change (never written by the tool).
  fs.appendFileSync(path.join(w.main, 'AGENTS.md'), `- ${FACT_LINE}\n`);
  runGit(w.main, 'commit', '-q', '-am', 'add the fact');
  runGit(w.main, 'push', '-q', 'origin', 'HEAD:main');
  runGit(w.main, 'fetch', '-q');
  const goes = cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '3']);
  assert.ok(goes.out.includes(`- **Its new home holds:** "${FACT_LINE}" (AGENTS.md on origin/main)`));
  const moved = cli(w, ['apply', '--worksheet', sheetFile(w), '--pick', '3', '--preview', previewCode(goes.out)]);
  assert.equal(moved.code, 0, moved.err);
  assert.equal(fs.existsSync(path.join(w.memory, 'c-fact.md')), false);
  assert.equal(fs.readFileSync(path.join(w.main, 'AGENTS.md'), 'utf8').split(FACT_LINE).length, 2, 'AGENTS.md is only what the reviewed change wrote');
});

test('apply: a failure part-way puts the folder back from the backup byte for byte and says where the backup is (G0 test 11)', t => {
  const w = world(t);
  const { plan } = verified(w, sheet => { row(sheet, 'b-outdated.md').rewrite = note('b-outdated', 'Run the current merge check.'); });
  const code = previewCode(cli(w, ['preview', '--worksheet', sheetFile(w), '--plan', plan, '--pick', '1,2']).out);
  const before = snapshot(w.memory);
  const real = require('../scripts/toolkit-controller-settings.cjs');
  const files = {
    write: (file, from, next) => real.replaceFile(file, from, next),
    remove: () => { const error = new Error('the note is held open'); error.code = 'EBUSY'; throw error; },
  };
  const result = cli(w, ['apply', '--worksheet', sheetFile(w), '--pick', '1,2', '--preview', code], { files });
  assert.equal(result.code, 1);
  assert.match(result.err, /failed \(the note is held open\)\. The folder was put back from the backup and read back\. Backup: /);
  assert.ok(result.err.includes(path.join(backups(w), code)));
  assert.deepEqual(snapshot(w.memory), before);
});

// ---- the typed command and the skill ----

test('toolkit memory tidy is a listed typed command that sends the agent to the skill section', () => {
  const commands = require('../scripts/toolkit-commands.cjs');
  assert.deepEqual(commands.typedCommand(' Toolkit Memory Tidy. '), { phrase: 'toolkit memory tidy', action: 'memory' });
  assert.match(commands.listText(), /\| `toolkit memory tidy` \|/);
  const line = commands.phraseContext('toolkit memory tidy');
  assert.match(line, /Memory tidy section of the toolkit-setup skill/);
  const skill = fs.readFileSync(path.join(ROOT, 'skills/toolkit-setup/SKILL.md'), 'utf8');
  const section = skill.slice(skill.indexOf('## Memory tidy'), skill.indexOf('\n## ', skill.indexOf('## Memory tidy') + 5));
  for (const words of ['keep everything', 'preview', 'toolkit-memory-tidy.cjs', 'never writes', 'counts only']) assert.ok(section.toLowerCase().includes(words.toLowerCase()), words);
});
