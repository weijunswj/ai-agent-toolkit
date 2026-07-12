'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-windows-alias-route-'));
}

test('real Codex plugin verification route explains WindowsApps alias access denial and explicit CLI remediation', () => {
  const root = tmpRoot();
  const preload = path.join(root, 'windows-alias-preload.cjs');
  fs.writeFileSync(preload, [
    "'use strict';",
    "Object.defineProperty(process, 'platform', { value: 'win32' });",
    "const childProcess = require('node:child_process');",
    "childProcess.spawnSync = function fakeWindowsAliasFailure() {",
    "  return { status: 1, stdout: '', stderr: 'Access is denied', error: null };",
    "};",
    ''
  ].join('\n'), 'utf8');

  const codexHome = path.join(root, '.codex');
  const result = spawnSync(process.execPath, ['--require', preload, script, '--verify', '--repo-root', repoRoot, '--codex-home', codexHome], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CODEX_HOME: codexHome,
      CODEX_TOOLKIT_CODEX_CLI: '',
      CODEX_CLI_PATH: ''
    },
    timeout: 30000,
    windowsHide: true
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 2, output);
  assert.match(output, /WindowsApps alias/i);
  assert.match(output, /--codex-cli/i);
  assert.match(output, /codex\.exe/i);
  assert.match(output, /Access is denied/i);
  assert.equal(fs.existsSync(path.join(codexHome, 'config.toml')), false);
});
