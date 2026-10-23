'use strict';

// Synthetic personal-data shapes for the personal-data guard tests. Every value is assembled at
// runtime from pieces that are not personal-data shaped on their own, so the test sources stay
// clean under the guard without allow markers. None of these values belongs to anyone.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const AT = String.fromCharCode(64);
const PLUS = String.fromCharCode(43);
const COUNTRY = ['6', '5'].join('');

const pii = Object.freeze({
  email: (local = 'jane.tan', domain = ['mailbox', 'sg'].join('.')) => `${local}${AT}${domain}`,
  // Singapore mobile shapes: a plus, country code 65 and eight digits, with or without separators.
  sgPlus: (sep = ' ') => `${PLUS}${COUNTRY}${sep}9123${sep}4567`,
  sgBare: (sep = '') => `${COUNTRY}${sep}9123${sep}4567`,
  e164: (country, rest) => `${PLUS}${country}${rest}`,
  waMe: () => `https://wa.me/${COUNTRY}91234567`,
  waApi: () => `https://api.whatsapp.com/send?phone=${COUNTRY}91234567&text=hi`,
  at: AT,
  plus: PLUS,
});

// A unique marker value per test, to prove it never appears in any output.
function markerEmail() { return pii.email(`zq${crypto.randomBytes(5).toString('hex')}`, ['marker', 'sg'].join('.')); }

function hashesOf(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex');
  return [hex, hex.slice(0, 12)];
}

// Asserts that no part of the marker value shows in text: the whole value, its local part, its
// domain, or its hash.
function assertNoEcho(assert, text, value, context) {
  const [local, domain] = value.split(AT);
  for (const piece of [value, local, domain, ...hashesOf(value)]) {
    assert.ok(!String(text).includes(piece), `${context}: output contains part of the value`);
  }
}

// A minimal zip writer (stored or deflated entries) for OOXML fixtures.
function zip(entries, { deflate = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// A .docx whose value is split across two runs, as Word does after an edit.
function docxWithSplitRun(value) {
  const cut = Math.floor(value.length / 2);
  const run = (text) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const document = `<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p>${run('Contact ')}${run(value.slice(0, cut))}${run(value.slice(cut))}</w:p><w:p>${run('Thanks')}</w:p></w:body></w:document>`;
  return zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', document]]);
}

// A PDF whose text stream is deflated and whose value is split across TJ pieces.
function pdfWithFlateText(value) {
  const cut = Math.floor(value.length / 2);
  const escape = (text) => text.replace(/[()\\]/g, '\\$&');
  const content = `BT /F1 12 Tf 72 712 Td [(${escape(value.slice(0, cut))}) -20 (${escape(value.slice(cut))})] TJ ET`;
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
const OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0]);

const GUARD = path.resolve(__dirname, '..', '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'personal-data-guard.cjs');
const INSTALLER = path.resolve(__dirname, '..', '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'install-personal-data-guard.cjs');

const BASE_CONFIG = Object.freeze({
  schema: 'personal-data-guard/v1',
  scope: { file_content: true, paths: true, commit_messages: true, branch_names: true, pull_request_text: true },
  identity: 'excluded',
  identity_reason: 'test repositories use reserved test identities',
  allow: [],
  not_scanned: [],
  required_check: 'none',
});

// A throwaway git repository with isolated git config (no global or system settings, so a
// developer's own core.hooksPath or signing never leaks in).
class TestRepo {
  constructor(t, { config = BASE_CONFIG, bare = false } = {}) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-test-'));
    t.after(() => fs.rmSync(this.dir, { recursive: true, force: true }));
    const globalConfig = path.join(this.dir, '..', `${path.basename(this.dir)}.gitconfig`);
    fs.writeFileSync(globalConfig, '');
    t.after(() => fs.rmSync(globalConfig, { force: true }));
    this.env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: `author${AT}example.invalid`,
      GIT_COMMITTER_NAME: 'Test Committer', GIT_COMMITTER_EMAIL: `committer${AT}example.invalid`,
    };
    delete this.env.GIT_DIR;
    delete this.env.GIT_WORK_TREE;
    delete this.env.GIT_INDEX_FILE;
    this.root = path.join(this.dir, 'work');
    fs.mkdirSync(this.root);
    this.git(bare ? ['init', '-q', '--bare', '-b', 'main'] : ['init', '-q', '-b', 'main']);
    this.git(['config', 'commit.gpgsign', 'false']);
    this.git(['config', 'tag.gpgsign', 'false']);
    if (config) this.write('.github/personal-data-guard.json', `${JSON.stringify(config, null, 2)}\n`);
  }

  git(args, options = {}) {
    const result = spawnSync('git', args, { cwd: options.cwd || this.root, env: this.env, encoding: 'utf8', input: options.input, windowsHide: true });
    if (!options.allowFailure && result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return options.allowFailure ? result : result.stdout.trim();
  }

  write(relative, content) {
    const file = path.join(this.root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  }

  commit(message, files = {}) {
    for (const [relative, content] of Object.entries(files)) {
      if (content === null) this.git(['rm', '-q', relative]);
      else { this.write(relative, content); this.git(['add', relative]); }
    }
    this.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', message]);
    return this.git(['rev-parse', 'HEAD']);
  }

  // Runs the guard CLI as git hooks and CI do. Returns { status, stdout, stderr, all }.
  guard(args, { input, env = {} } = {}) {
    const result = spawnSync(process.execPath, [GUARD, ...args, '--repo', this.root], {
      cwd: this.root, env: { ...this.env, ...env }, encoding: 'utf8', input, windowsHide: true,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, all: `${result.stdout}${result.stderr}` };
  }

  installer(args) {
    const result = spawnSync(process.execPath, [INSTALLER, '--repo', this.root, ...args], { cwd: this.root, env: this.env, encoding: 'utf8', windowsHide: true });
    return { status: result.status, all: `${result.stdout}${result.stderr}` };
  }
}

module.exports = Object.freeze({
  BASE_CONFIG, GUARD, INSTALLER, OLE, PNG, TestRepo, assertNoEcho, docxWithSplitRun, hashesOf, markerEmail, pdfWithFlateText, pii, zip,
});
