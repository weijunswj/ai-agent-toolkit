'use strict';

// Temp isolation for test files that run the Toolkit bridge or setup. Require it before
// anything else reads the temp folder. It points this test process, and every child that
// inherits its environment, at a private temp folder, and fails the test file if the real
// Toolkit update-report folder gains files while the file runs. Reports written there are
// real: action-required ones open on the owner's screen. The guard never deletes anything
// in the real folder.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after } = require('node:test');

const REAL_REPORT_DIR = path.join(os.tmpdir(), 'ai-agent-toolkit', 'update-reports');

function realReportNames() {
  try { return new Set(fs.readdirSync(REAL_REPORT_DIR)); }
  catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

const before = realReportNames();
const privateTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-test-temp-'));
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = privateTemp;

after(() => {
  const added = [...realReportNames()].filter(name => !before.has(name));
  fs.rmSync(privateTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (added.length) {
    throw new Error(`${added.length} Toolkit update report(s) appeared in the real report folder ${REAL_REPORT_DIR} while this test file ran `
      + `(${added.slice(0, 3).join(', ')}${added.length > 3 ? ', ...' : ''}). A test ran the bridge or setup with the real temp folder, `
      + 'or a real Toolkit session wrote a report at the same time. Nothing was deleted.');
  }
});

module.exports = Object.freeze({ REAL_REPORT_DIR, privateTemp });
