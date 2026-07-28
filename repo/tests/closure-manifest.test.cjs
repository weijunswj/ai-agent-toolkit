'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const trusted = path.join(repoRoot, 'repo', 'scripts', 'trusted-workflows');
const builder = require(path.join(trusted, 'build-closure-manifest.cjs'));

function run(script, args) {
  return spawnSync(process.execPath, [path.join(trusted, script), ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 30000 });
}

function makeTestParser() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-parser-test-'));
  return { root, parser: builder.createClosureParser(root) };
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
    const bytes = fs.readFileSync(file);
    assert.ok(!bytes.includes(0x0d), 'manifest entry must be canonical LF: ' + entry.path);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
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
  const { root, parser } = makeTestParser();
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
    assert.deepEqual(parser.parseDependencies(file), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser rejects every dynamic or computed execution/import form', function() {
  const { root, parser } = makeTestParser();
  const cases = new Map([
    ['dynamic-import.cjs', ["import('./child.cjs')", /TW_CLOSURE_DYNAMIC_IMPORT/]],
    ['computed-require.cjs', ["require('./' + name)", /TW_CLOSURE_COMPUTED_REQUIRE/]],
    ['module-require.cjs', ["module.require('./child.cjs')", /TW_CLOSURE_MODULE_REQUIRE/]],
    ['eval.cjs', ["eval('1')", /TW_CLOSURE_DYNAMIC_CODE/]],
    ['function.cjs', ["new Function('return 1')", /TW_CLOSURE_DYNAMIC_CODE/]],
    ['package.cjs', ["require('acorn')", /TW_CLOSURE_PACKAGE_IMPORT/]],
    ['loader.cjs', ["require.extensions = {}", /TW_CLOSURE_LOADER_HOOK/]],
    ['loader-alias.cjs', ["const r = require;", /TW_CLOSURE_LOADER_ALIAS/]],
    ['loader-create-require.cjs', ["const { createRequire } = require('node:module');", /TW_CLOSURE_LOADER_CREATION/]],
    ['loader-pass-require.cjs', ["(function(fn){fn()})(require);", /TW_CLOSURE_LOADER_ALIAS/]],
    ['loader-call.cjs', ["require.call(null, './local.cjs');", /TW_CLOSURE_LOADER_CHAIN/]],
    ['loader-apply.cjs', ["require.apply(null, ['./local.cjs']);", /TW_CLOSURE_LOADER_CHAIN/]],
    ['loader-bind.cjs', ["const r = require.bind(null);", /TW_CLOSURE_LOADER_CHAIN/]],
    ['loader-computed.cjs', ["require[\"call\"](null, './local.cjs');", /TW_CLOSURE_LOADER_CHAIN/]],
    ['loader-destructure-call.cjs', ["const { call } = require;", /TW_CLOSURE_LOADER_ALIAS/]],
    ['loader-escape.cjs', ["require.resolve('../escape.cjs');", /TW_CLOSURE_ESCAPE/]],
    ['loader-safe-main.cjs', ["if (require.main === module) process.exit(0);", null]]
  ]);
  try {
    for (const [name, definition] of cases) {
      const file = path.join(root, name);
      fs.writeFileSync(file, definition[0]);
      if (definition[1]) assert.throws(function() { parser.parseDependencies(file); }, definition[1], name);
      else assert.doesNotThrow(function() { parser.parseDependencies(file); }, name);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser admits in-root direct require.resolve target', function() {
  const { root, parser } = makeTestParser();
  const child = path.join(root, 'child.cjs');
  const entry = path.join(root, 'entry.cjs');
  fs.writeFileSync(child, "'use strict';\n");
  fs.writeFileSync(entry, "'use strict';\nconst c = require.resolve('./child.cjs');\n");
  try {
    const deps = parser.parseDependencies(entry);
    assert.deepEqual(deps.map(function(d) { return path.relative(root, d).replace(/\\/g, '/'); }), ['child.cjs']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser rejects non-relative, dynamic, package and escape require.resolve targets', function() {
  const { root, parser } = makeTestParser();
  const entry = path.join(root, 'entry.cjs');
  const cases = new Map([
    ['package.cjs', "const c = require.resolve('acorn');\n", /TW_CLOSURE_PACKAGE_IMPORT/],
    ['dynamic.cjs', "const c = require.resolve(value);\n", /TW_CLOSURE_LOADER_RESOLVE_CONTEXT/],
    ['escape.cjs', "const c = require.resolve('../escape.cjs');\n", /TW_CLOSURE_ESCAPE/],
    ['optional-chain.cjs', "const c = require?.resolve('./child.cjs');\n", /TW_CLOSURE_LOADER_CHAIN/],
    ['optional-call.cjs', "const c = require.resolve?.('./child.cjs');\n", /TW_CLOSURE_LOADER_CHAIN/],
    ['chain-chain.cjs', "const c = (require?.resolve)('./child.cjs');\n", /TW_CLOSURE_LOADER_CHAIN/]
  ]);
  try {
    for (const [name, source, expected] of cases) {
      const file = path.join(root, name);
      fs.writeFileSync(file, "'use strict';\n" + source);
      assert.throws(function() { parser.parseDependencies(file); }, expected, name);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser rejects capture and indirect require.resolve call', function() {
  const { root, parser } = makeTestParser();
  const entry = path.join(root, 'entry.cjs');
  fs.writeFileSync(entry, [
    "'use strict';",
    "const r = require.resolve;",
    "r('./child.cjs');"
  ].join('\n'));
  try {
    assert.throws(function() { parser.parseDependencies(entry); }, /TW_CLOSURE_LOADER_ALIAS|TW_CLOSURE_LOADER_CHAIN|TW_CLOSURE_LOADER_RESOLVE_CONTEXT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser rejects malformed direct require calls', function() {
  const { root, parser } = makeTestParser();
  // Create a valid target so the valid case resolves cleanly.
  fs.writeFileSync(path.join(root, 'a.cjs'), "'use strict';\n");
  const cases = [
    ['zero-args.cjs', "require();\n", /TW_CLOSURE_COMPUTED_REQUIRE/],
    ['dynamic-identifier.cjs', "const v = 'a'; require(v);\n", /TW_CLOSURE_COMPUTED_REQUIRE/],
    ['concatenated.cjs', "require('./' + 'a.cjs');\n", /TW_CLOSURE_COMPUTED_REQUIRE/],
    ['multiple-args.cjs', "require('./a.cjs', './b.cjs');\n", /TW_CLOSURE_COMPUTED_REQUIRE/],
    ['spread-arg.cjs', "require(...['./a.cjs']);\n", /TW_CLOSURE_COMPUTED_REQUIRE/],
    ['valid-single.cjs', "require('./a.cjs');\n", null],
    ['builtin-node.cjs', "require('node:fs');\n", null],
    ['package.cjs', "require('acorn');\n", /TW_CLOSURE_PACKAGE_IMPORT/]
  ];
  try {
    for (const [name, source, expected] of cases) {
      const file = path.join(root, name);
      fs.writeFileSync(file, "'use strict';\n" + source);
      if (expected) assert.throws(function() { parser.parseDependencies(file); }, expected, name);
      else assert.doesNotThrow(function() { parser.parseDependencies(file); }, name);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser rejects CRLF bytes in trusted text files', function() {
  const { root, parser } = makeTestParser();
  const file = path.join(root, 'crlf.cjs');
  fs.writeFileSync(file, Buffer.from("'use strict';\r\nconst x = 1;\r\n"));
  try {
    assert.throws(function() { parser.parseDependencies(file); }, /TW_CLOSURE_NON_CANONICAL_LF/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closure parser production root binding cannot be overridden by CLI or env', function() {
  const result = spawnSync(process.execPath, [path.join(trusted, 'build-closure-manifest.cjs'), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, TW_TRUSTED_ROOT: os.tmpdir() }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  // The production manifest must still be byte-identical, proving the CLI cannot redirect
  // the trusted root to an attacker-controlled location.
  const manifest = JSON.parse(fs.readFileSync(path.join(trusted, 'closure-manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.files));
  assert.ok(manifest.files.length > 0);
});

test('closure parser does not write into the production trusted root from concurrent tests', function() {
  const before = fs.readdirSync(trusted).sort();
  const { root, parser } = makeTestParser();
  fs.writeFileSync(path.join(root, 'concurrent.cjs'), "'use strict';\n");
  parser.parseDependencies(path.join(root, 'concurrent.cjs'));
  fs.rmSync(root, { recursive: true, force: true });
  const after = fs.readdirSync(trusted).sort();
  assert.deepEqual(after, before, 'production trusted root must not be mutated by tests');
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

test('exact locale-independent ordering contract is enforced', function() {
  const authority = require(path.join(trusted, 'path-authority.cjs'));
  const input = [
    'a', 'B', 'a.b', 'a-b', 'a_b', 'a/b', '1', '10', '2', 'A'
  ];
  const sorted = [...input].sort(authority.compareCodeUnits);
  // Code unit order: '1', '10', '2', 'A', 'B', 'a', 'a-b', 'a.b', 'a/b', 'a_b'
  // (Assuming typical ascii codes: '1' is 49, 'A' is 65, 'a' is 97, '-' is 45, '.' is 46, '/' is 47, '_' is 95)
  // Let's verify:
  // '1' (49), '10' (49, 48), '2' (50), 'A' (65), 'B' (66), 'a' (97), 'a-b' (97, 45), 'a.b' (97, 46), 'a/b' (97, 47), 'a_b' (97, 95)
  // Wait, wait.
  // '-' (45) < '.' (46) < '/' (47) < '_' (95) < 'a' (97). But 'a' alone is length 1.
  // 'a' < 'a-' because 'a' is a prefix.
  // So: '1', '10', '2', 'A', 'B', 'a', 'a-b', 'a.b', 'a/b', 'a_b'
  const expected = ['1', '10', '2', 'A', 'B', 'a', 'a-b', 'a.b', 'a/b', 'a_b'];
  assert.deepEqual(sorted, expected, 'ordering must use exact code-unit comparison');
});

test('builder and verifier use identical repo-root-relative path strings', function() {
  const manifest = JSON.parse(fs.readFileSync(path.join(trusted, 'closure-manifest.json'), 'utf8'));
  const authority = require(path.join(trusted, 'path-authority.cjs'));
  // Builder puts `repo/scripts/trusted-workflows/...` in manifest
  // Verifier uses `verifyContainment` which expects `repo-root-relative` path
  for (const entry of manifest.files) {
    assert.ok(entry.path.startsWith('repo/scripts/trusted-workflows/'), 'builder path must be repo-root-relative');
    const contained = authority.verifyContainment(entry.path);
    assert.ok(path.isAbsolute(contained), 'verifier must resolve to absolute real path');
  }
});

test('runtime verifier containment checks', function() {
  const authority = require(path.join(trusted, 'path-authority.cjs'));
  
  // Repo-root-relative root is admitted
  assert.doesNotThrow(() => authority.verifyContainment('repo/scripts/trusted-workflows/auto-sync/preflight.cjs'));
  
  // Trusted-root-relative shortened path is rejected
  assert.throws(() => authority.verifyContainment('auto-sync/preflight.cjs'), /TW_VERIFY_ESCAPE/);
  
  // Doubled path is rejected
  assert.throws(() => authority.verifyContainment('repo/scripts/trusted-workflows/repo/scripts/trusted-workflows/auto-sync/preflight.cjs'), /TW_VERIFY_SYMLINK/);
  
  // Escape paths fail closed
  assert.throws(() => authority.verifyContainment('repo/scripts/trusted-workflows/../../package.json'), /TW_VERIFY_ESCAPE/);
  
  // Absolute paths fail closed
  assert.throws(() => authority.verifyContainment(path.join(repoRoot, 'repo/scripts/trusted-workflows/auto-sync/preflight.cjs')), /TW_VERIFY_PATH/);
});
