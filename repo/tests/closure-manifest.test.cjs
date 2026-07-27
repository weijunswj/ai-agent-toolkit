'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const trusted = path.join(repoRoot, 'repo', 'scripts', 'trusted-workflows');
const builder = require(path.join(trusted, 'build-closure-manifest.cjs'));

function run(script, args) {
  return spawnSync(process.execPath, [path.join(trusted, script), ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 30000 });
}

test('Acorn closure parser manifest is current after npm ci --ignore-scripts', function() {
  const result = run('build-closure-manifest.cjs', ['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('closure manifest has exact set and SHA-256 equality', function() {
  const manifest = JSON.parse(fs.readFileSync(path.join(trusted, 'closure-manifest.json'), 'utf8'));
  assert.equal(new Set(manifest.files.map(function(entry) { return entry.path; })).size, manifest.files.length);
  for (const entry of manifest.files) {
    const file = path.join(repoRoot, ...entry.path.split('/'));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), entry.sha256, entry.path);
    assert.ok(['commonjs', 'json'].includes(entry.module_type));
    assert.ok(Array.isArray(entry.direct_literal_dependencies));
    assert.ok(Array.isArray(entry.root_ownership));
  }
});

test('built-in runtime verifier bootstrap and strict one-object protocol', function() {
  const result = run('verify-closure-manifest.cjs', ['repo/scripts/trusted-workflows/verify-closure-manifest.cjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/);
  assert.equal(JSON.parse(result.stdout).verified, true);
});

test('bootstrap helper digests are workflow-pinned and current', function() {
  const result = run('update-bootstrap-digests.cjs', ['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('closure parser ignores import-like text in comments, strings, templates and escapes', function() {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'closure-parser-'));
  const file = path.join(root, 'literal-text.cjs');
  fs.writeFileSync(file, [
    "'use strict';",
    "// require('./comment.cjs')",
    "const a = \"require('./string.cjs')\";",
    "const b = `require('./template.cjs')`;",
    "const c = 'escaped \\' require(\\'./escape.cjs\\')';",
    "require('node:fs');"
  ].join('\n'));
  try {
    assert.deepEqual(builder.parseDependencies(file), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser rejects every dynamic or computed execution/import form', function() {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'closure-parser-'));
  const cases = new Map([
    ['dynamic-import.cjs', ["import('./child.cjs')", /TW_CLOSURE_DYNAMIC_IMPORT/]],
    ['computed-require.cjs', ["require('./' + name)", /TW_CLOSURE_COMPUTED_REQUIRE/]],
    ['module-require.cjs', ["module.require('./child.cjs')", /TW_CLOSURE_MODULE_REQUIRE/]],
    ['eval.cjs', ["eval('1')", /TW_CLOSURE_DYNAMIC_CODE/]],
    ['function.cjs', ["new Function('return 1')", /TW_CLOSURE_DYNAMIC_CODE/]],
    ['package.cjs', ["require('acorn')", /TW_CLOSURE_PACKAGE_IMPORT/]],
    ['loader.cjs', ["require.extensions = {}", /TW_CLOSURE_LOADER_HOOK/]]
  ]);
  try {
    for (const [name, definition] of cases) {
      const file = path.join(root, name);
      fs.writeFileSync(file, definition[0]);
      assert.throws(function() { builder.parseDependencies(file); }, definition[1], name);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bootstrap helper ownership and file mode are trusted-base safe', function() {
  for (const name of ['capture-node-toolchain.cjs', 'verify-closure-manifest.cjs']) {
    const file = path.join(trusted, name);
    const stat = fs.lstatSync(file);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    if (process.platform !== 'win32') assert.equal((stat.mode & 0o022), 0, name + ' is group/world writable');
  }
});
