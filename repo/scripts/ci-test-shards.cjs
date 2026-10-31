'use strict';

// The test shard manifest (repo/contracts/ci/test-shards.json) and the checks that keep CI and
// local runs on one list. Each system (linux, windows) splits repo/tests/*.test.cjs into named
// shards: every shard but one lists its files, and exactly one `rest` shard takes every file no
// other shard names, so a new test file always runs. These are pure functions: run-tests.cjs owns
// the effects (temp folder, child processes, summaries).

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_REL = 'repo/contracts/ci/test-shards.json';
const MANIFEST_SCHEMA = 'toolkit-test-shards/v1';
const SUMMARY_SCHEMA = 'toolkit-test-summary/v1';
const TEST_DIR_REL = 'repo/tests';
const TEST_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.test\.cjs$/;
const SYSTEMS = Object.freeze(['linux', 'windows']);
const SHARD_ID = /^[a-z]+-[1-9][0-9]*$/;

function platformSystem(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  return null;
}

function testDirEntries(root) {
  return fs.readdirSync(path.join(root, ...TEST_DIR_REL.split('/')), { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.test.cjs'));
}

// Plain discovery: every repo/tests/*.test.cjs file, repo-relative with forward slashes, sorted.
function discoverTestFiles(root = ROOT) {
  return testDirEntries(root)
    .filter((entry) => entry.isFile())
    .map((entry) => `${TEST_DIR_REL}/${entry.name}`)
    .sort();
}

// Entries named like a test that must not pass quietly: a name outside TEST_FILE, or a symlink or
// folder that discovery skips. Every runner mode refuses to run while one exists.
function testFileErrors(root = ROOT) {
  const errors = [];
  for (const entry of testDirEntries(root)) {
    const rel = `${TEST_DIR_REL}/${entry.name}`;
    if (!entry.isFile()) errors.push(`${rel} is not a regular file, so it would never run`);
    else if (!TEST_FILE.test(entry.name)) errors.push(`${rel} needs a name of letters, digits, dots, dashes and underscores that starts with a letter or digit`);
  }
  return errors.sort();
}

function loadManifest(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, ...MANIFEST_REL.split('/')), 'utf8'));
}

// Every problem with the manifest against the discovered files; empty when it is usable.
function manifestErrors(manifest, discovered) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['the manifest is not a JSON object'];
  if (manifest.schema !== MANIFEST_SCHEMA) errors.push(`schema must be ${MANIFEST_SCHEMA}`);
  const systems = manifest.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) return [...errors, 'systems must be an object'];
  const names = Object.keys(systems).sort();
  if (names.join(',') !== [...SYSTEMS].sort().join(',')) errors.push(`systems must be exactly ${SYSTEMS.join(' and ')}`);
  const known = new Set(discovered);
  for (const system of SYSTEMS) {
    const shards = systems[system] && systems[system].shards;
    if (!Array.isArray(shards) || shards.length === 0) {
      errors.push(`${system}: shards must be a non-empty list`);
      continue;
    }
    const ids = new Set();
    const owner = new Map();
    let rest = 0;
    shards.forEach((shard, index) => {
      const label = `${system} shard ${index + 1}`;
      if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
        errors.push(`${label} is not an object`);
        return;
      }
      const keys = Object.keys(shard).sort().join(',');
      if (typeof shard.id !== 'string' || !SHARD_ID.test(shard.id) || !shard.id.startsWith(`${system}-`)) errors.push(`${label}: id must look like ${system}-<n>`);
      else if (ids.has(shard.id)) errors.push(`${system}: shard id ${shard.id} appears twice`);
      else ids.add(shard.id);
      if (shard.rest === true) {
        rest += 1;
        if (keys !== 'id,rest') errors.push(`${shard.id}: a rest shard has only id and rest`);
        return;
      }
      if (keys !== 'files,id') errors.push(`${label}: a named shard has only id and files`);
      if (!Array.isArray(shard.files) || shard.files.length === 0) {
        errors.push(`${label}: files must be a non-empty list`);
        return;
      }
      for (const file of shard.files) {
        if (!known.has(file)) errors.push(`${shard.id}: ${file} is not a discovered test file`);
        else if (owner.has(file)) errors.push(`${system}: ${file} is in both ${owner.get(file)} and ${shard.id}`);
        else owner.set(file, shard.id);
      }
    });
    if (rest !== 1) errors.push(`${system}: exactly one shard must be the rest shard (found ${rest})`);
    else if (owner.size >= known.size) errors.push(`${system}: the rest shard is empty`);
  }
  const durations = manifest.durations_seconds;
  if (durations !== undefined) {
    if (!durations || typeof durations !== 'object' || Array.isArray(durations)) errors.push('durations_seconds must be an object');
    else {
      for (const [system, table] of Object.entries(durations)) {
        if (!SYSTEMS.includes(system)) errors.push(`durations_seconds: unknown system ${system}`);
        else if (!table || typeof table !== 'object' || Array.isArray(table)) errors.push(`durations_seconds.${system} must be an object`);
        else for (const [file, value] of Object.entries(table)) {
          if (!known.has(file)) errors.push(`durations_seconds.${system}: ${file} is not a discovered test file`);
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`durations_seconds.${system}: ${file} needs a non-negative number`);
        }
      }
    }
  }
  return errors;
}

function assertManifest(manifest, discovered) {
  const errors = manifestErrors(manifest, discovered);
  if (errors.length) throw new Error(`The test shard manifest ${MANIFEST_REL} is not usable:\n- ${errors.join('\n- ')}`);
}

function shardIds(manifest, system) {
  return manifest.systems[system].shards.map((shard) => shard.id);
}

// The files one shard runs, in discovery order. Unknown shards and empty shards are errors.
function resolveShard(manifest, system, shardId, discovered) {
  assertManifest(manifest, discovered);
  if (!SYSTEMS.includes(system)) throw new Error(`Unknown system "${system}". Use ${SYSTEMS.join(' or ')}.`);
  const shards = manifest.systems[system].shards;
  const shard = shards.find((item) => item.id === shardId);
  if (!shard) throw new Error(`Unknown shard "${shardId}" for ${system}. Shards: ${shardIds(manifest, system).join(', ')}.`);
  let files;
  if (shard.rest) {
    const named = new Set(shards.filter((item) => !item.rest).flatMap((item) => item.files));
    files = discovered.filter((file) => !named.has(file));
  } else {
    const listed = new Set(shard.files);
    files = discovered.filter((file) => listed.has(file));
  }
  if (!files.length) throw new Error(`Shard "${shardId}" for ${system} has no test files.`);
  return files;
}

// Every shard's files for one system; the union is the discovered list with no file twice.
function systemShards(manifest, system, discovered) {
  return shardIds(manifest, system).map((id) => ({ id, files: resolveShard(manifest, system, id, discovered) }));
}

// The order a shard hands its files to node --test: longest measured first, so the long files start
// while the short ones fill the other slots. Files with no measurement keep discovery order last.
function runOrder(files, durations = {}) {
  return files
    .map((file, index) => ({ file, index, seconds: typeof durations[file] === 'number' ? durations[file] : -1 }))
    .sort((a, b) => (b.seconds - a.seconds) || (a.index - b.index))
    .map((item) => item.file);
}

// Estimated wall time of one shard: node --test starts files in order as its slots free up.
function estimateShardSeconds(files, durations = {}, concurrency = 3) {
  const slots = new Array(Math.max(1, concurrency)).fill(0);
  for (const file of runOrder(files, durations)) {
    const next = slots.indexOf(Math.min(...slots));
    slots[next] += typeof durations[file] === 'number' ? durations[file] : 0;
  }
  return Math.max(...slots);
}

function relativeTestFile(root, file) {
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  return relative;
}

// The one check behind the aggregate CI step: every leg succeeded, and for each system the leg
// summaries cover the discovered files exactly once, each with at least one test and no failure.
function verifyCiSummaries({ manifest, discovered, summaries, needs }) {
  const errors = [];
  const totals = {};
  try { assertManifest(manifest, discovered); }
  catch (error) { return { errors: [error.message], totals }; }
  if (!needs || typeof needs !== 'object' || Array.isArray(needs) || Object.keys(needs).length === 0) errors.push('the test leg results (needs) are missing');
  else for (const [job, value] of Object.entries(needs)) {
    const result = value && value.result;
    if (result !== 'success') errors.push(`test job ${job} finished as ${result || 'unknown'}, not success`);
  }
  const bySystem = new Map(SYSTEMS.map((system) => [system, new Map()]));
  for (const summary of summaries) {
    if (!summary || summary.schema !== SUMMARY_SCHEMA) {
      errors.push(`a summary does not use ${SUMMARY_SCHEMA}`);
      continue;
    }
    // A clock-ahead run checks only the files that pin a date, so it never stands in for a shard.
    if (summary.clock_offset_days !== undefined) {
      errors.push(`a ${summary.system} summary ran with the clock moved ${summary.clock_offset_days} days ahead, so it does not count as a shard run`);
      continue;
    }
    const legs = bySystem.get(summary.system);
    if (!legs) {
      errors.push(`a summary names unknown system ${summary.system}`);
      continue;
    }
    if (legs.has(summary.shard)) errors.push(`${summary.system} shard ${summary.shard} reported twice`);
    legs.set(summary.shard, summary);
  }
  for (const system of SYSTEMS) {
    const expected = systemShards(manifest, system, discovered);
    const legs = bySystem.get(system);
    const seen = new Map();
    const total = { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 };
    for (const id of legs.keys()) if (!expected.some((shard) => shard.id === id)) errors.push(`${system} shard ${id} is not in the manifest`);
    for (const shard of expected) {
      const summary = legs.get(shard.id);
      if (!summary) {
        errors.push(`${system} shard ${shard.id} has no summary`);
        continue;
      }
      if (summary.exit_code !== 0) errors.push(`${system} shard ${shard.id} exited with ${summary.exit_code}`);
      const reported = new Map((Array.isArray(summary.files) ? summary.files : []).map((entry) => [entry.file, entry]));
      for (const file of reported.keys()) if (!shard.files.includes(file)) errors.push(`${system} shard ${shard.id} ran ${file}, which the manifest gives to another shard`);
      for (const file of shard.files) {
        const entry = reported.get(file);
        if (!entry) {
          errors.push(`${system} shard ${shard.id} has no result for ${file} (it did not load, or it was not run)`);
          continue;
        }
        if (seen.has(file)) errors.push(`${system}: ${file} ran in both ${seen.get(file)} and ${shard.id}`);
        seen.set(file, shard.id);
        if (!(entry.tests > 0)) errors.push(`${system}: ${file} ran no tests`);
        if (entry.failed > 0 || entry.cancelled > 0) errors.push(`${system}: ${file} had ${entry.failed} failed and ${entry.cancelled} cancelled tests`);
        total.files += 1;
        for (const key of ['tests', 'passed', 'failed', 'skipped', 'todo', 'cancelled']) total[key] += Number(entry[key]) || 0;
      }
    }
    for (const file of discovered) if (!seen.has(file)) errors.push(`${system}: ${file} was not run by any shard`);
    totals[system] = total;
  }
  return { errors, totals };
}

const RUNNER = { linux: 'ubuntu-latest', windows: 'windows-latest' };
const VERIFY_COMMAND = 'node repo/scripts/run-tests.cjs --verify-ci "$RUNNER_TEMP/test-summaries"';
const GATE_STEP = 'Run validation';
const AGGREGATE_HEADER = [
  '  validate:',
  '    needs: [tests-linux, tests-windows, tests-clock-ahead, hook-pack, personal-data]',
  '    if: ${{ always() }}',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 15',
  '    steps:',
];
// A gate command other than the last: one repository script with plain arguments and no shell syntax.
const PLAIN_GATE_COMMAND = /^node repo\/scripts\/[A-Za-z0-9._-]+\.cjs( [A-Za-z0-9._=\/-]+)*$/;
// Ways to make a test step pass without running the tests; none may appear anywhere in the workflow.
const FORBIDDEN = [
  [/continue-on-error/, 'continue-on-error'],
  [/\|\|\s*(true|exit|:|echo\b)/, 'a command that hides a failure with ||'],
  [/\bset\s+\+e\b/, 'set +e'],
  [/shell["']?\s*:/, 'a shell: setting (a custom shell can drop bash -e)'],
  [/(^|[;&|]\s*|\s)exit\s+0\b/m, 'exit 0'],
  [/--test-(name|skip)-pattern|--test-only|--test-shard/, 'a node --test filter'],
  [/^\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/m, 'if: false'],
  [/^\s*(include|exclude):/m, 'a matrix include or exclude'],
  [/node --test\b/, 'node --test outside the runner'],
];

// The exact text of one system's test job. Pinning it whole means a narrowed file list, a filter,
// a condition, a masked exit code or a matrix edit is a visible change to this function too.
function testJobText(system, ids) {
  return [
    `  tests-${system}:`,
    `    runs-on: ${RUNNER[system]}`,
    '    timeout-minutes: 30',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    `        shard: [${ids.join(', ')}]`,
    '    steps:',
    '      - name: Checkout',
    '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    '        with:',
    '          fetch-depth: 0',
    '          persist-credentials: false',
    '',
    '      - name: Set up Node',
    '        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
    '        with:',
    '          node-version: 22',
    '',
    '      - name: Install dependencies',
    '        run: npm ci --ignore-scripts',
    '',
    '      - name: Set up Python',
    '        uses: actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0 # v7.1.0',
    '        with:',
    "          python-version: '3.12'",
    '',
    '      - name: Run test shard',
    `        run: node repo/scripts/run-tests.cjs --shard \${{ matrix.shard }} --os ${system} --temp-root "\${{ runner.temp }}/tests" --summary "\${{ runner.temp }}/summary/test-summary-\${{ matrix.shard }}.json"`,
    '',
    // A failed shard still uploads its summary, so the validate job names the failed tests.
    '      - name: Upload test summary',
    '        if: ${{ !cancelled() }}',
    '        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
    '        with:',
    '          name: test-summary-${{ matrix.shard }}',
    '          path: ${{ runner.temp }}/summary/test-summary-${{ matrix.shard }}.json',
    '          if-no-files-found: error',
    '          retention-days: 7',
  ].join('\n');
}

// The exact text of the clock-ahead job: the test files that pin a calendar date, run with Node's
// clock moved 400 days ahead (run-tests.cjs --clock-ahead). It uploads no summary, so it never
// counts toward shard coverage; the validate job needs it, so a failure fails the required check.
const CLOCK_AHEAD_JOB = [
  '  tests-clock-ahead:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 30',
  '    steps:',
  '      - name: Checkout',
  '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  '        with:',
  '          fetch-depth: 0',
  '          persist-credentials: false',
  '',
  '      - name: Set up Node',
  '        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  '        with:',
  '          node-version: 22',
  '',
  '      - name: Install dependencies',
  '        run: npm ci --ignore-scripts',
  '',
  '      - name: Set up Python',
  '        uses: actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0 # v7.1.0',
  '        with:',
  "          python-version: '3.12'",
  '',
  '      - name: Run the tests that pin a date with the clock 400 days ahead',
  '        run: node repo/scripts/run-tests.cjs --clock-ahead --clock-offset-days 400 --temp-root "${{ runner.temp }}/tests"',
].join('\n');

// The exact text of the hook-pack job: the hook test pack (toolkit-hook-pack.cjs) on Linux and
// Windows, every hook started the way Claude Code and Codex start it. The validate job waits for it,
// so a failed or skipped system fails the required check.
const HOOK_PACK_JOB = [
  '  hook-pack:',
  '    runs-on: ${{ matrix.os }}',
  '    timeout-minutes: 15',
  '    strategy:',
  '      fail-fast: false',
  '      matrix:',
  '        os: [ubuntu-latest, windows-latest]',
  '    steps:',
  '      - name: Checkout',
  '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  '        with:',
  '          fetch-depth: 0',
  '          persist-credentials: false',
  '',
  '      - name: Set up Node',
  '        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  '        with:',
  '          node-version: 22',
  '',
  '      - name: Install dependencies',
  '        run: npm ci --ignore-scripts',
  '',
  '      - name: Run the hook pack',
  '        run: node repo/scripts/toolkit-hook-pack.cjs run --budget-seconds 360',
].join('\n');

// The exact text of the personal-data job: every commit of the pull request or push, its messages,
// branch name and pull request text, checked by the personal-data guard. The validate job waits
// for it, so the existing required check covers it.
const PERSONAL_DATA_JOB = [
  '  personal-data:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 15',
  '    steps:',
  '      - name: Checkout',
  '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  '        with:',
  '          fetch-depth: 0',
  '          persist-credentials: false',
  '',
  '      - name: Set up Node',
  '        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  '        with:',
  '          node-version: 22',
  '',
  '      - name: Check for personal data',
  '        run: node skills/secure-ci-cd/scripts/personal-data-guard.cjs ci',
].join('\n');

// The exact text of the validate job around its gate commands. The commands stay listed only in
// validate.yml, the one gate list; each is checked on its own (PLAIN_GATE_COMMAND, VERIFY_COMMAND last).
function validateJobText(commands) {
  return [
    ...AGGREGATE_HEADER,
    '      - name: Checkout',
    '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    '        with:',
    '          fetch-depth: 0',
    '          persist-credentials: false',
    '',
    '      - name: Set up Node',
    '        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
    '        with:',
    '          node-version: 22',
    '',
    '      - name: Download test summaries',
    '        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2',
    '        with:',
    '          pattern: test-summary-*',
    '          path: ${{ runner.temp }}/test-summaries',
    '          merge-multiple: true',
    '',
    '      - name: Set up Python',
    '        uses: actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0 # v7.1.0',
    '        with:',
    "          python-version: '3.12'",
    '',
    '      # The one gate list: `npm run validate:all` runs these same commands (repo/scripts/run-validation-gate.cjs),',
    '      # except that locally the last command runs every test file instead of checking the shard summaries.',
    '      - name: Run validation',
    '        env:',
    '          DIFF_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}',
    '          TEST_LEGS: ${{ toJSON(needs) }}',
    '          PR_BODY: ${{ github.event.pull_request.body }}',
    '        run: |',
    ...commands.map((command) => `          ${command}`),
  ].join('\n');
}

// The commands of the named step's `run: |` block, one per line.
function gateCommands(source, stepName = GATE_STEP) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line === `      - name: ${stepName}`);
  if (start === -1) throw new Error(`validate.yml has no "${stepName}" step.`);
  const run = lines.findIndex((line, index) => index > start && /^ {8}run: \|\s*$/.test(line));
  const nextStep = lines.findIndex((line, index) => index > start && /^ {6}- /.test(line));
  if (run === -1 || (nextStep !== -1 && run > nextStep)) throw new Error(`The "${stepName}" step has no multi-line run block.`);
  const commands = [];
  for (let index = run + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (!/^ {10}\S/.test(line)) break;
    commands.push(line.trim());
  }
  if (!commands.length) throw new Error(`The "${stepName}" step lists no commands.`);
  return commands;
}

// Everything before the jobs: the triggers, permissions and the comment that explains the jobs.
const WORKFLOW_HEADER = [
  'name: Validate',
  '',
  'on:',
  '  pull_request:',
  '    types: [opened, edited, reopened, synchronize]',
  '  push:',
  '    branches:',
  '      - main',
  '',
  'permissions:',
  '  contents: read',
  '',
  '# A newer run for the same pull request cancels the older one; every push keeps its own run.',
  'concurrency:',
  "  group: validate-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
  '  cancel-in-progress: true',
  '',
  '# The test files run in shards on Linux and Windows (repo/contracts/ci/test-shards.json). The',
  '# validate job runs after every shard, also when one failed: its "Run validation" step runs the',
  '# repository checks, fails any test file over its time budget (check-test-durations.cjs), and then',
  '# proves from the shard summaries that each system ran every test file once with no failure. A',
  '# failed, cancelled or skipped shard fails it. The tests-clock-ahead job runs the test files that',
  '# pin a calendar date with Node\'s clock 400 days ahead, so a test that only passes near the date',
  '# it pins fails now rather than months later; validate waits for it. The hook-pack job runs the',
  '# hook test pack on Linux and Windows, and validate waits for it too. The personal-data job checks',
  '# every commit of the pull request or push, the commit messages, the branch name and the pull',
  '# request title and body for email addresses, phone numbers and WhatsApp links, and the title and',
  '# body for home-folder paths and AI attribution (values are never printed); validate waits for it',
  '# too, so a hit or a scan error fails the required check. An edit to the title or body runs the',
  '# whole workflow again, so a fixed body clears the required check without a new commit.',
  'jobs:',
].join('\n');

// The exact text of the whole of validate.yml for a manifest and a gate command list. Comparing the
// file against it leaves no room for a line the job parser or a pattern does not see: a comment that
// ends a job early, a quoted or flow-style key, a workflow-wide default or env value.
function workflowText(manifest, commands) {
  return [
    WORKFLOW_HEADER,
    testJobText('linux', shardIds(manifest, 'linux')),
    '',
    testJobText('windows', shardIds(manifest, 'windows')),
    '',
    CLOCK_AHEAD_JOB,
    '',
    HOOK_PACK_JOB,
    '',
    PERSONAL_DATA_JOB,
    '',
    validateJobText(commands),
    '',
  ].join('\n');
}

// The jobs of a workflow, keyed by id, each with its text (trailing blank lines dropped).
function workflowJobs(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf('jobs:');
  const jobs = new Map();
  if (start === -1) return jobs;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) { current = header[1]; jobs.set(current, [line]); continue; }
    if (/^\S/.test(line)) break;
    if (current) jobs.get(current).push(line);
  }
  return new Map([...jobs].map(([id, block]) => {
    while (block.length && block[block.length - 1].trim() === '') block.pop();
    return [id, block.join('\n')];
  }));
}

// One pinned action line: the action, a full commit SHA and its version comment.
const PINNED_USES = /^( {8}uses: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@)[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

// The workflow text with each action pin update put back to its pinned line, so a Dependabot update
// that changes only the commit SHA and version comment of the same action passes. A different
// action, a tag or short ref, a missing version comment or any other edit stays a difference.
function withPinUpdatesAccepted(text, expected) {
  const lines = text.split('\n');
  const pinned = expected.split('\n');
  if (lines.length !== pinned.length) return text;
  return lines.map((line, index) => {
    const found = line.match(PINNED_USES);
    const want = pinned[index].match(PINNED_USES);
    return found && want && found[1] === want[1] ? pinned[index] : line;
  }).join('\n');
}

// Drift guard for .github/workflows/validate.yml: the whole file matches its pinned text, with only
// the gate command list taken from the file and action pin updates accepted (withPinUpdatesAccepted);
// each command but the last is a plain repository script and the last is the summary check. The
// per-job checks before the whole-file comparison say what moved when they can.
function workflowErrors(source, manifest) {
  const errors = [];
  const raw = source.replace(/\r\n/g, '\n');
  for (const [pattern, label] of FORBIDDEN) if (pattern.test(raw)) errors.push(`validate.yml must not contain ${label}`);
  let commands = null;
  let commandError = null;
  try { commands = gateCommands(raw); }
  catch (error) { commandError = error.message; }
  const text = commands ? withPinUpdatesAccepted(raw, workflowText(manifest, commands)) : raw;
  const jobs = workflowJobs(text);
  const expected = ['tests-linux', 'tests-windows', 'tests-clock-ahead', 'hook-pack', 'personal-data', 'validate'];
  if ([...jobs.keys()].join(',') !== expected.join(',')) errors.push(`validate.yml jobs must be exactly ${expected.join(', ')} in that order (found ${[...jobs.keys()].join(', ') || 'none'})`);
  for (const system of SYSTEMS) {
    const job = jobs.get(`tests-${system}`);
    if (job !== undefined && job !== testJobText(system, shardIds(manifest, system))) errors.push(`the tests-${system} job differs from the pinned text for shards ${shardIds(manifest, system).join(', ')}`);
  }
  const hookPack = jobs.get('hook-pack');
  if (hookPack !== undefined && hookPack !== HOOK_PACK_JOB) errors.push('the hook-pack job differs from its pinned text');
  const clockAhead = jobs.get('tests-clock-ahead');
  if (clockAhead !== undefined && clockAhead !== CLOCK_AHEAD_JOB) errors.push('the tests-clock-ahead job differs from its pinned text');
  const personalData = jobs.get('personal-data');
  if (personalData !== undefined && personalData !== PERSONAL_DATA_JOB) errors.push('the personal-data job differs from its pinned text');
  const aggregate = jobs.get('validate');
  if (aggregate !== undefined) {
    const lines = aggregate.split('\n');
    if (lines.slice(0, AGGREGATE_HEADER.length).join('\n') !== AGGREGATE_HEADER.join('\n')) errors.push('the validate job must start with needs: [tests-linux, tests-windows, tests-clock-ahead, hook-pack, personal-data], if: ${{ always() }}, runs-on: ubuntu-latest and timeout-minutes: 15');
    const names = lines.filter((line) => /^ {6}- name: /.test(line)).map((line) => line.replace(/^ {6}- name: /, ''));
    if (names.join('|') !== 'Checkout|Set up Node|Download test summaries|Set up Python|Run validation') errors.push('the validate job steps must be Checkout, Set up Node, Download test summaries, Set up Python, Run validation (Run validation is step 6)');
    if (lines.filter((line) => /^ {8}if:/.test(line)).length) errors.push('no step in the validate job may have a condition');
    if (lines[lines.length - 1].trim() !== VERIFY_COMMAND) errors.push(`the Run validation step must end with ${VERIFY_COMMAND}`);
    if (!/^ {10}TEST_LEGS: \$\{\{ toJSON\(needs\) \}\}$/m.test(aggregate)) errors.push('the Run validation step must pass TEST_LEGS: ${{ toJSON(needs) }}');
  }
  if (commandError) errors.push(commandError);
  if (commands) {
    for (const command of commands.slice(0, -1)) {
      if (!PLAIN_GATE_COMMAND.test(command)) errors.push(`the Run validation command "${command}" must be a plain node repo/scripts/<name>.cjs line with no shell syntax`);
    }
    if (text !== workflowText(manifest, commands)) errors.push('validate.yml differs from its pinned text (repo/scripts/ci-test-shards.cjs workflowText); only the Run validation command list and the commit SHA and version comment of a pinned action may change');
  }
  return errors;
}

// A calendar date written into the source: an ISO date literal (YYYY-MM-DD) or a Date.UTC( call.
const PINNED_DATE = /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?!\d)|\bDate\.UTC\(/;
// A helper loaded by a relative ./ or ../ path ending in .cjs.
const LOCAL_REQUIRE = /require\((['"])(\.\.?\/[^'"]+\.cjs)\1\)/g;

// The test files that pin a calendar date, in the file or in a repo/tests helper it loads, directly
// or through other helpers (such as a fake clock). The clock-ahead run (run-tests.cjs --clock-ahead)
// runs these with Node's clock moved forward: a test that pins a date but lets the code under test
// read the real clock passes on the day it lands and fails once the real date moves past it. A file
// that pins no date cannot hold that mistake, so the run leaves it out. readText returns a
// repo-relative file's text, or null when it does not exist.
function dateBoundTestFiles(discovered, readText) {
  const texts = new Map();
  const text = (file) => {
    if (!texts.has(file)) texts.set(file, readText(file));
    return texts.get(file);
  };
  const helpersOf = (file) => [...(text(file) || '').matchAll(LOCAL_REQUIRE)]
    .map((match) => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])))
    .filter((helper) => helper.startsWith(`${TEST_DIR_REL}/`) && !helper.endsWith('.test.cjs'));
  return discovered.filter((file) => {
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length) {
      const next = queue.shift();
      if (PINNED_DATE.test(text(next) || '')) return true;
      for (const helper of helpersOf(next)) if (!seen.has(helper)) { seen.add(helper); queue.push(helper); }
    }
    return false;
  });
}

// Test files a local change affects: changed test files, plus test files that name a changed
// non-test file by its file name (scripts, contracts, docs and helpers they load or read).
function affectedTestFiles(changedPaths, discovered, readText) {
  const selected = new Map();
  const changed = [...new Set(changedPaths.map((item) => item.split(path.sep).join('/')))];
  for (const file of changed) if (discovered.includes(file)) selected.set(file, 'changed');
  const others = changed.filter((file) => !discovered.includes(file));
  if (others.length) {
    for (const test of discovered) {
      if (selected.has(test)) continue;
      const text = readText(test);
      const hit = others.find((file) => text.includes(path.posix.basename(file)));
      if (hit) selected.set(test, `names ${hit}`);
    }
  }
  return discovered.filter((file) => selected.has(file)).map((file) => ({ file, reason: selected.get(file) }));
}

module.exports = Object.freeze({
  MANIFEST_REL,
  MANIFEST_SCHEMA,
  ROOT,
  SUMMARY_SCHEMA,
  SYSTEMS,
  VERIFY_COMMAND,
  affectedTestFiles,
  assertManifest,
  dateBoundTestFiles,
  discoverTestFiles,
  estimateShardSeconds,
  gateCommands,
  loadManifest,
  manifestErrors,
  platformSystem,
  relativeTestFile,
  resolveShard,
  runOrder,
  shardIds,
  systemShards,
  testFileErrors,
  testJobText,
  validateJobText,
  workflowText,
  verifyCiSummaries,
  workflowErrors,
  workflowJobs,
});
