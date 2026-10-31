'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; refuses editor opens of edit files

// The editor side of toolkit env edit, with no real app started and no real editor folder read:
// the open command per platform, the .env app lookup (with a stand-in PowerShell), the cleanup of
// VS Code-style Local History and hot-exit backups in a made-up user data folder, and the test
// guard that refuses opening an edit file in an editor.

const childProcess = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const editor = require('../scripts/toolkit-env-editor.cjs');

function tempDir(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-editor-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const isEditFile = (name) => /^env-edit-[A-Za-z0-9-]+\.(?:env|txt)$/.test(name);

test('the edit file opens by absolute path: the Windows shell, or a VS Code-style editor in a new window', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  const file = 'C:\\Users\\a\\.ai-agent-toolkit\\env\\edit\\env-edit-0123456789abcdef.env';
  assert.deepEqual(editor.editorCommand(file, { platform: 'win32', environment: env }), ['C:\\Windows\\explorer.exe', [file]]);
  const notepad = { program: 'C:\\Windows\\System32\\notepad.exe', name: 'notepad.exe' };
  assert.deepEqual(editor.editorCommand(file, { platform: 'win32', environment: env, app: notepad }), ['C:\\Windows\\explorer.exe', [file]], 'other apps go through the shell');
  for (const name of Object.keys(editor.VSCODE_STYLE)) {
    const program = `C:\\Apps\\${name}`;
    assert.deepEqual(editor.editorCommand(file, { platform: 'win32', environment: env, app: { program, name } }), [program, ['--new-window', file]], name);
  }
  // A VS Code-style name without an absolute program path never becomes a bare program name.
  assert.deepEqual(editor.editorCommand(file, { platform: 'win32', environment: env, app: { program: 'Code.exe', name: 'code.exe' } }), ['C:\\Windows\\explorer.exe', [file]]);
  assert.deepEqual(editor.editorCommand('/h/f.env', { platform: 'darwin' }), ['/usr/bin/open', ['/h/f.env']]);
  assert.deepEqual(editor.editorCommand('/h/f.env', { platform: 'linux' }), ['/usr/bin/xdg-open', ['/h/f.env']]);
  assert.throws(() => editor.editorCommand('/h/f.env', { platform: 'aix' }), /No way to open a file on aix/);
});

test('an editor never starts with the switch that runs Electron apps as plain Node.js', () => {
  const copy = editor.editorEnvironment({ ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', PATH: 'x' });
  assert.deepEqual(copy, { PATH: 'x' });
});

test('the program of an open command is its first token, absolute only, with %NAME% expanded', () => {
  assert.equal(editor.commandProgram('"C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" "%1"'), 'C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
  assert.equal(editor.commandProgram('%SystemRoot%\\System32\\notepad.exe %1', { SYSTEMROOT: 'C:\\Windows' }), 'C:\\Windows\\System32\\notepad.exe');
  assert.equal(editor.commandProgram('notepad.exe %1'), '');
  assert.equal(editor.commandProgram('%UNSET%\\x.exe %1', {}), '');
  assert.equal(editor.commandProgram(''), '');
});

test('the .env app comes from the registry script; only the program is kept, and failures give none', () => {
  const calls = [];
  const answer = (stdout, status = 0) => (command, args, options) => { calls.push({ command, args, options }); return { status, stdout }; };
  const env = { SystemRoot: 'C:\\Windows' };
  const found = editor.findEnvApp({ platform: 'win32', environment: env, spawn: answer(JSON.stringify({ command: '"C:\\Apps\\VS Code\\Code.exe" "%1"' })) });
  assert.deepEqual(found, { program: 'C:\\Apps\\VS Code\\Code.exe', name: 'code.exe' });
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(calls[0].args.includes('-EncodedCommand') && calls[0].options.windowsHide);
  const script = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /UserChoiceLatest\\ProgId/);
  assert.ok(script.indexOf('UserChoiceLatest') < script.indexOf('"$ext\\UserChoice"'), 'the newer choice is read first');
  assert.doesNotMatch(script, /Set-Item|New-Item|Remove-Item|Set-ItemProperty/, 'the registry is only read');
  assert.deepEqual(editor.findEnvApp({ platform: 'win32', environment: env, spawn: answer('{"command":""}') }), { program: '', name: '' });
  assert.deepEqual(editor.findEnvApp({ platform: 'win32', environment: env, spawn: answer('', 3) }), { program: '', name: '' });
  assert.deepEqual(editor.findEnvApp({ platform: 'win32', environment: env, spawn: answer('not json') }), { program: '', name: '' });
  assert.deepEqual(editor.findEnvApp({ platform: 'linux', spawn: () => { throw new Error('not run'); } }), { program: '', name: '' });
});

test('file URIs as VS Code writes them map to local paths', () => {
  assert.equal(editor.uriPath('file:///c%3A/Users/a%20b/.ai-agent-toolkit/env/edit/env-edit-1.env', 'win32'), 'c:\\Users\\a b\\.ai-agent-toolkit\\env\\edit\\env-edit-1.env');
  assert.equal(editor.uriPath('file:///home/a/x.env', 'linux'), '/home/a/x.env');
  assert.equal(editor.uriPath('file://server/share/x.env', 'win32'), '', 'network paths are never ours');
  assert.equal(editor.uriPath('untitled:Untitled-1', 'win32'), '');
  assert.equal(editor.uriPath('file:///c%ZZ/x', 'win32'), '');
});

test('the editor folders checked are the four VS Code-style ones that exist', (t) => {
  const appData = tempDir(t);
  fs.mkdirSync(path.join(appData, 'Code'));
  fs.mkdirSync(path.join(appData, 'Cursor'));
  fs.mkdirSync(path.join(appData, 'Other'));
  assert.deepEqual(editor.editorDataFolders({ platform: 'win32', environment: { APPDATA: appData } }).sort(), [path.join(appData, 'Code'), path.join(appData, 'Cursor')].sort());
  assert.deepEqual(editor.editorDataFolders({ platform: 'win32', environment: {} }), []);
  const home = tempDir(t);
  fs.mkdirSync(path.join(home, '.config', 'VSCodium'), { recursive: true });
  assert.deepEqual(editor.editorDataFolders({ platform: 'linux', environment: {}, homeDir: home }), [path.join(home, '.config', 'VSCodium')]);
});

// A made-up VS Code user data folder with Local History and backups for the given files.
function fakeEditorData(root, { history = [], backups = [] }) {
  const data = path.join(root, 'Code');
  for (const { file, copies } of history) {
    const dir = path.join(data, 'User', 'History', crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const entries = copies.map((text, index) => {
      const id = `c${index}.env`;
      fs.writeFileSync(path.join(dir, id), text);
      return { id, timestamp: index };
    });
    fs.writeFileSync(path.join(dir, 'entries.json'), JSON.stringify({ version: 1, resource: pathToFileURL(file).href.replace(/^file:\/\/\/([A-Za-z]):/, (whole, drive) => `file:///${drive.toLowerCase()}%3A`), entries }));
  }
  for (const { file, text, window = 'empty-window-1' } of backups) {
    const dir = path.join(data, 'Backups', window, 'file');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, crypto.randomBytes(4).toString('hex')), `${pathToFileURL(file).href} {"mtime":1}\n${text}`);
  }
  return data;
}

function everyFile(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath || entry.path, entry.name), 'utf8'));
}

test('cleanup removes only the copies of edit files in the edit folder, and counts them', (t) => {
  const root = tempDir(t);
  const editDir = path.join(root, 'home', '.ai-agent-toolkit', 'env', 'edit');
  const lookAlikeDir = path.join(root, 'home', 'other');
  const canary = `canary-${crypto.randomBytes(6).toString('hex')}`;
  const ours = path.join(editDir, 'env-edit-0123456789abcdef.env');
  const older = path.join(editDir, 'env-edit-1111111111111111.env');
  const open = path.join(editDir, 'env-edit-2222222222222222.env');
  const data = fakeEditorData(root, {
    history: [
      { file: ours, copies: [`A_B_C=${canary}`, `A_B_C=${canary}2`] },
      { file: older, copies: [`A_B_C=${canary}3`] },
      { file: open, copies: ['A_B_C=open-tab'] },
      { file: path.join(lookAlikeDir, 'env-edit-0123456789abcdef.env'), copies: ['look-alike elsewhere'] },
      { file: path.join(editDir, 'session.json'), copies: ['not an edit file'] },
    ],
    backups: [
      { file: ours, text: `A_B_C=${canary}4` },
      { file: path.join(lookAlikeDir, 'env-edit-0123456789abcdef.env'), text: 'look-alike backup', window: 'workspace-1' },
    ],
  });
  // A history folder without entries.json, and an unreadable backup line, are left alone.
  fs.mkdirSync(path.join(data, 'User', 'History', 'broken'));
  fs.writeFileSync(path.join(data, 'User', 'History', 'broken', 'x.env'), 'kept');
  const removed = editor.cleanEditorCopies({ editDir, folders: [data], isEditFile, keep: open, platform: process.platform });
  assert.equal(removed, 4, 'two history copies of ours, one of the older tab, one backup');
  const left = everyFile(data).join('\n');
  assert.ok(!left.includes(canary), 'no copy of the canary is left');
  for (const kept of ['look-alike elsewhere', 'look-alike backup', 'not an edit file', 'open-tab', 'kept']) assert.ok(left.includes(kept), kept);
  assert.equal(editor.cleanEditorCopies({ editDir, folders: [data], isEditFile, platform: process.platform }), 1, 'without keep the open tab copy goes too');
  assert.equal(editor.cleanEditorCopies({ editDir, folders: [path.join(root, 'missing')], isEditFile, platform: process.platform }), 0);
});


test('the test guard refuses opening an edit file in the shell or an editor, and records it', () => {
  const record = process.env.TOOLKIT_TEST_EDITOR_RECORD;
  const file = 'C:\\Users\\a\\.ai-agent-toolkit\\env\\edit\\env-edit-0123456789abcdef.env';
  try {
    for (const [command, args, options] of [
      ['C:\\Windows\\explorer.exe', [file]],
      ['C:\\Apps\\Microsoft VS Code\\Code.exe', ['--new-window', file]],
      ['/usr/bin/xdg-open', ['/h/.ai-agent-toolkit/env/edit/env-edit-0123456789abcdef.env']],
      ['/usr/bin/open', ['/h/.ai-agent-toolkit/env/edit/env-edit-0123456789abcdef.env']],
      ['cmd.exe', ['/c', `start "" explorer "${file}"`]],
    ]) {
      assert.throws(() => childProcess.spawn(command, args, options), /refused a Notepad or editor launch/, command);
    }
    assert.throws(() => childProcess.spawnSync('C:\\Windows\\explorer.exe', [file]), /refused a Notepad or editor launch/);
    assert.equal(fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).length, 6);
    // Node itself, given an edit file name as data, still runs.
    const plain = childProcess.spawnSync(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'env-edit-0123456789abcdef.env'], { encoding: 'utf8' });
    assert.equal(plain.stdout, 'env-edit-0123456789abcdef.env');
  } finally {
    // These refusals were this test's own; the guard fails the file for any other.
    fs.rmSync(record, { force: true });
  }
});
