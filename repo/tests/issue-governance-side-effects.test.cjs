'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'issue-governance');
const interceptor = path.join(fixtureRoot, 'intercept-side-effects.cjs');
const child = path.join(fixtureRoot, 'side-effect-child.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'side-effect-manifest.json'), 'utf8'));

function isolatedChildEnvironment() {
  const env = { ...process.env, NODE_NO_WARNINGS: '1' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runEval(source) {
  return spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    timeout: 10000,
    env: isolatedChildEnvironment()
  });
}

test('side-effect manifest has exactly 188 unique complete variants', function() {
  assert.equal(manifest.entry_count, 188);
  assert.equal(manifest.entries.length, 188);
  assert.equal(new Set(manifest.entries.map(function(entry) { return entry.variant_id; })).size, 188);
  for (const entry of manifest.entries) {
    for (const key of [
      'variant_id', 'module', 'export_path', 'form', 'argument_constructor',
      'positive_control_procedure', 'guarded_call_procedure', 'expected_guarded_error',
      'observable_sentinel', 'cleanup_procedure', 'timeout_ms', 'platform_constraints'
    ]) assert.ok(Object.hasOwn(entry, key), entry.variant_id + ' missing ' + key);
    assert.ok(entry.platform_constraints.execution_jobs.length > 0);
  }
});

test('side-effect manifest generator is exact and current', function() {
  const result = spawnSync(process.execPath, [path.join(fixtureRoot, 'side-effect-constructors.cjs'), '--check'], {
    cwd: repoRoot, encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('parent observes strict guarded sentinel protocol', function() {
  const entry = manifest.entries.find(function(value) {
    return value.export_path === 'writeFileSync' && value.reference_acquisition === 'node-module-object-after';
  });
  const result = spawnSync(process.execPath, [child, Buffer.from(JSON.stringify(entry)).toString('base64url')], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: entry.timeout_ms,
    env: isolatedChildEnvironment()
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed, {
    variant_id: entry.variant_id,
    guard_blocked: true,
    sentinel_calls: 0,
    cleanup_complete: true
  });
});

test('Node fs.open exact string and numeric flag table', function() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-governance-open-flags-'));
  const file = path.join(root, 'readable');
  fs.writeFileSync(file, 'x');
  const source = [
    'const fs=require("node:fs");',
    'const file=' + JSON.stringify(file) + ';',
    'require(' + JSON.stringify(interceptor) + ');',
    'for(const flag of ["r","rs","sr"]){const fd=fs.openSync(file,flag);fs.closeSync(fd);}',
    'for(const flag of ["r+","rs+","sr+","w","wx","w+","wx+","a","ax","a+","ax+"]){try{fs.openSync(file+"-"+flag,flag);process.exit(10)}catch(e){if(e.code!=="SIDE_EFFECT_GUARD_BLOCKED")process.exit(11)}}',
    'for(const flag of ["x","x+","invalid"]){try{fs.openSync(file,flag);process.exit(12)}catch(e){if(!(e instanceof TypeError))process.exit(13)}}',
    'const fd=fs.openSync(file,fs.constants.O_RDONLY);fs.closeSync(fd);',
    'for(const flag of [fs.constants.O_WRONLY,fs.constants.O_RDWR,fs.constants.O_CREAT,fs.constants.O_TRUNC,fs.constants.O_APPEND]){try{fs.openSync(file,flag);process.exit(14)}catch(e){if(e.code!=="SIDE_EFFECT_GUARD_BLOCKED")process.exit(15)}}'
  ].join('');
  const result = runEval(source);
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
});

test('dns CommonJS, node specifier, promises and post-install destructuring are intercepted', function() {
  const source = [
    'require(' + JSON.stringify(interceptor) + ');',
    'const a=require("dns"),b=require("node:dns"),c=require("node:dns").promises,{lookup}=require("node:dns");',
    'for(const fn of [a.lookup,b.lookup,c.lookup,lookup]){try{fn("localhost",()=>{});process.exit(1)}catch(e){if(e.code!=="SIDE_EFFECT_GUARD_BLOCKED")process.exit(2)}}'
  ].join('');
  assert.equal(runEval(source).status, 0);
});

test('all four post-install module-object and destructured acquisition modes execute the real export', function() {
  const entries = manifest.entries.filter(function(entry) {
    return entry.module === 'node:fs' && entry.export_path === 'writeFileSync';
  });
  assert.deepEqual(entries.map(function(entry) { return entry.reference_acquisition; }), [
    'cjs-module-object-after',
    'node-module-object-after',
    'cjs-destructured-after',
    'node-destructured-after'
  ]);
  for (const entry of entries) {
    const encoded = Buffer.from(JSON.stringify(entry)).toString('base64url');
    const result = spawnSync(process.execPath, [child, encoded], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: entry.timeout_ms,
      env: isolatedChildEnvironment()
    });
    assert.equal(result.status, 0, entry.variant_id + ':' + result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      variant_id: entry.variant_id,
      guard_blocked: true,
      sentinel_calls: 0,
      cleanup_complete: true
    });
  }
});

test('pre-install destructured references are not claimed as interceptable', function() {
  const source = [
    'const {lookup}=require("node:dns");',
    'require(' + JSON.stringify(interceptor) + ');',
    'let sync=true;lookup("localhost",(error)=>{if(error)process.exit(2);process.exit(0)});sync=false;',
    'setTimeout(()=>process.exit(3),2000);'
  ].join('');
  assert.equal(runEval(source).status, 0);
});
