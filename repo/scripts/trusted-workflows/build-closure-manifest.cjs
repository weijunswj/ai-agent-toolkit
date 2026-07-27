#!/usr/bin/env node
'use strict';

const acorn = require('acorn');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TRUSTED_ROOT = path.join(REPO_ROOT, 'repo', 'scripts', 'trusted-workflows');
const MANIFEST_PATH = path.join(TRUSTED_ROOT, 'closure-manifest.json');
const VALIDATION_ONLY = new Set([
  'repo/scripts/trusted-workflows/build-closure-manifest.cjs',
  'repo/scripts/trusted-workflows/update-bootstrap-digests.cjs'
]);
const ROOTS = [
  'repo/scripts/trusted-workflows/auto-sync/dry-run.cjs',
  'repo/scripts/trusted-workflows/auto-sync/preflight.cjs',
  'repo/scripts/trusted-workflows/auto-sync/verify-rehearsal-pr.cjs',
  'repo/scripts/trusted-workflows/source-watch/dry-run.cjs',
  'repo/scripts/trusted-workflows/capture-node-toolchain.cjs',
  'repo/scripts/trusted-workflows/verify-closure-manifest.cjs'
];

function die(code, detail) {
  throw new Error(code + (detail ? ':' + detail : ''));
}

function relative(absolute) {
  return path.relative(REPO_ROOT, absolute).replace(/\\/g, '/');
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((item) => walk(item, visitor));
    else if (value && typeof value === 'object') walk(value, visitor);
  }
}

function resolveLiteral(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  if (!specifier.endsWith('.cjs') && !specifier.endsWith('.json')) die('TW_CLOSURE_EXTENSION', specifier);
  const absolute = path.resolve(path.dirname(fromFile), specifier);
  const rel = path.relative(TRUSTED_ROOT, absolute);
  if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) die('TW_CLOSURE_ESCAPE', specifier);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) die('TW_CLOSURE_MISSING', specifier);
  return absolute;
}

function parseDependencies(file) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', allowHashBang: true });
  const deps = [];
  walk(ast, (node) => {
    if (node.type === 'ImportExpression') die('TW_CLOSURE_DYNAMIC_IMPORT', relative(file));
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' &&
        ['eval', 'Function'].includes(node.callee.name)) die('TW_CLOSURE_DYNAMIC_CODE', relative(file));
    if (node.type === 'NewExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === 'Function') {
      die('TW_CLOSURE_DYNAMIC_CODE', relative(file));
    }
    if (node.type === 'AssignmentExpression' && node.left && node.left.type === 'MemberExpression' &&
        node.left.object && node.left.object.name === 'require' &&
        node.left.property && node.left.property.name === 'extensions') die('TW_CLOSURE_LOADER_HOOK', relative(file));
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression' &&
        node.callee.property && ['register', 'registerHooks'].includes(node.callee.property.name)) {
      die('TW_CLOSURE_LOADER_HOOK', relative(file));
    }
    if (node.type !== 'CallExpression') return;
    if (node.callee && node.callee.type === 'MemberExpression' &&
        node.callee.object && node.callee.object.name === 'module' &&
        node.callee.property && node.callee.property.name === 'require') die('TW_CLOSURE_MODULE_REQUIRE', relative(file));
    if (!node.callee || node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
    if (node.arguments.length !== 1 || node.arguments[0].type !== 'Literal' || typeof node.arguments[0].value !== 'string') {
      die('TW_CLOSURE_COMPUTED_REQUIRE', relative(file));
    }
    const specifier = node.arguments[0].value;
    if (specifier.startsWith('node:')) return;
    const resolved = resolveLiteral(file, specifier);
    if (!resolved) die('TW_CLOSURE_PACKAGE_IMPORT', specifier);
    if (resolved.endsWith('.json') && !specifier.endsWith('.json')) die('TW_CLOSURE_JSON_UNLISTED', specifier);
    deps.push(resolved);
  });
  return [...new Set(deps)].sort();
}

function collectFiles() {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) die('TW_CLOSURE_SYMLINK', relative(absolute));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name !== 'closure-manifest.json' && !VALIDATION_ONLY.has(relative(absolute))) result.push(absolute);
    }
  };
  visit(TRUSTED_ROOT);
  return result;
}

function build() {
  const files = collectFiles();
  const entries = files.map((file) => {
    const dependencies = file.endsWith('.cjs') ? parseDependencies(file).map(relative) : [];
    return {
      path: relative(file),
      sha256: hash(file),
      module_type: file.endsWith('.json') ? 'json' : 'commonjs',
      direct_literal_dependencies: dependencies,
      root_ownership: []
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const entryMap = new Map(entries.map((entry) => [entry.path, entry]));
  for (const root of ROOTS) {
    if (!entryMap.has(root)) die('TW_CLOSURE_ROOT_MISSING', root);
    const memo = new Set();
    const active = new Set();
    const visit = (current) => {
      if (active.has(current)) die('TW_CLOSURE_CYCLE', current);
      if (memo.has(current)) return;
      const entry = entryMap.get(current);
      if (!entry) die('TW_CLOSURE_DEPENDENCY_MISSING', current);
      active.add(current);
      if (!entry.root_ownership.includes(root)) entry.root_ownership.push(root);
      for (const dependency of entry.direct_literal_dependencies) visit(dependency);
      active.delete(current);
      memo.add(current);
    };
    visit(root);
  }
  const memo = new Set();
  const active = new Set();
  const validateAcyclic = (current) => {
    if (active.has(current)) die('TW_CLOSURE_CYCLE', current);
    if (memo.has(current)) return;
    active.add(current);
    for (const dependency of entryMap.get(current).direct_literal_dependencies) validateAcyclic(dependency);
    active.delete(current);
    memo.add(current);
  };
  for (const entry of entries) {
    validateAcyclic(entry.path);
    entry.root_ownership.sort();
  }
  return { schema_version: 1, generated_by: 'build-closure-manifest.cjs', roots: ROOTS, files: entries };
}

function main() {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) die('TW_CLOSURE_ARGUMENTS');
  const expected = JSON.stringify(build(), null, 2) + '\n';
  if (mode === '--write') {
    fs.writeFileSync(MANIFEST_PATH, expected, 'utf8');
    return;
  }
  const actual = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf8') : '';
  if (actual !== expected) die('TW_CLOSURE_STALE');
}

if (require.main === module) main();

module.exports = {
  build,
  parseDependencies
};
