'use strict';

// Temp, Notepad and editor isolation for test files that run the Toolkit bridge or setup. Require it
// before anything else reads the temp folder or loads the bridge. It points this test process,
// and every child that inherits its environment, at a private temp folder, which it removes when
// the test file finishes. It fails
// the test file if the real Toolkit update-report folder gains files while the file runs. Reports written
// there are real: action-required ones open on the owner's screen. The guard never deletes
// anything in the real folder.
//
// It also loads toolkit-test-editor-preload.cjs here and, through NODE_OPTIONS, in the same
// children: the bridge's Notepad open of an action-required report gets an inert stand-in, and
// the test file fails if any other Notepad launch, or an editor open of a toolkit env edit file,
// reached the process layer (none opens).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after } = require('node:test');

// repo/scripts/run-tests.cjs gives each run its own temp folder (removed when the run finishes)
// and names the temp root it started with in TOOLKIT_TEST_REAL_TEMP, so the guard still watches
// the owner's real report folder.
const REAL_REPORT_DIR = path.join(process.env.TOOLKIT_TEST_REAL_TEMP || os.tmpdir(), 'ai-agent-toolkit', 'update-reports');
const EDITOR_PRELOAD = path.join(__dirname, 'toolkit-test-editor-preload.cjs');

function realReportNames() {
  try { return new Set(fs.readdirSync(REAL_REPORT_DIR)); }
  catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

// NODE_OPTIONS splits on spaces outside double quotes and reads a backslash inside them as an escape.
function preloadOption(file) {
  const portable = process.platform === 'win32' ? file.replace(/\\/g, '/') : file;
  return `--require="${portable.replace(/["\\]/g, '\\$&')}"`;
}

// The real user-level instruction files the global rules installer owns a block in. The preload
// refuses writes to them, so a test that forgets to isolate its home cannot change them.
if (!process.env.TOOLKIT_TEST_PROTECTED_FILES) {
  const home = os.homedir();
  process.env.TOOLKIT_TEST_PROTECTED_FILES = JSON.stringify([
    path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'CLAUDE.md'),
    path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md'),
    path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
    path.join(home, '.gemini', 'GEMINI.md'),
  ]);
}

const before = realReportNames();
const privateTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-test-temp-'));
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = privateTemp;

const launchRecord = path.join(privateTemp, 'editor-launches.jsonl');
process.env.TOOLKIT_TEST_EDITOR_RECORD = launchRecord;
const option = preloadOption(EDITOR_PRELOAD);
if (!String(process.env.NODE_OPTIONS || '').includes(option)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, option].filter(Boolean).join(' ');
}
require(EDITOR_PRELOAD);

function editorLaunches() {
  try { return fs.readFileSync(launchRecord, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

after(() => {
  const added = [...realReportNames()].filter(name => !before.has(name));
  const launches = editorLaunches();
  fs.rmSync(privateTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const problems = [];
  if (added.length) {
    problems.push(`${added.length} Toolkit update report(s) appeared in the real report folder ${REAL_REPORT_DIR} while this test file ran `
      + `(${added.slice(0, 3).join(', ')}${added.length > 3 ? ', ...' : ''}). A test ran the bridge or setup with the real temp folder, `
      + 'or a real Toolkit session wrote a report at the same time. Nothing was deleted.');
  }
  if (launches.length) {
    problems.push(`${launches.length} Notepad or editor launch(es) reached the process layer while this test file ran and were refused, so no window opened `
      + `(first: ${launches[0].command.join(' ')}). Only the bridge's spawn('notepad.exe', ...) report open has a test stand-in; `
      + 'route the open through it or extend toolkit-test-editor-preload.cjs.');
  }
  if (problems.length) throw new Error(problems.join(' '));
});

module.exports = Object.freeze({ REAL_REPORT_DIR, privateTemp });
