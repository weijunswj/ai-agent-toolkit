'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { SPEC_SCHEMA, inspectOwnedTemps, withOwnedTemp } = require('../scripts/toolkit-owned-temp.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');

function ownedSpec(episode) {
  return { schema: SPEC_SCHEMA, purpose: 'portability', repoRoot, episode, budgetBytes: 16 * 1024 * 1024 };
}

function ownedTempUsage() {
  const snapshot = inspectOwnedTemps();
  return {
    records: snapshot.records.length,
    outstandingReservationsBytes: snapshot.outstandingReservationsBytes,
    retainedRoots: snapshot.retainedRoots
  };
}

async function withOwnedTempBaseline(specification, callback) {
  const baseline = ownedTempUsage();
  const value = await withOwnedTemp(specification, callback);
  assert.deepEqual(ownedTempUsage(), baseline);
  return value;
}

async function copyRepo(lease) {
  await lease.copyTree(repoRoot, {
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      if (!rel) return true;
      return (
        rel === 'repo' ||
        rel === 'repo/scripts' ||
        rel === 'repo/scripts/audit-skill-portability.cjs' ||
        rel === 'skills' ||
        rel === 'skills/windows-local-dev-services' ||
        rel.startsWith('skills/windows-local-dev-services/')
      );
    }
  });
}

async function runAudit(lease) {
  try { return await lease.runProfile('skill-portability'); }
  catch (error) {
    if (error.code !== 'TEMP_CHILD_FAILED' || !Number.isSafeInteger(error.exitCode) || error.exitCode === 0) throw error;
    return { code: error.exitCode, stdout: error.stdout, stderr: error.stderr };
  }
}

test('skill portability audit passes the published skill folders', () => {
  const result = spawnSync(process.execPath, [auditScript], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skill portability audit passed for \d+ skill\(s\)/);
});

test('low capacity refuses before the portability fixture is copied', async () => {
  const baseline = ownedTempUsage();
  const original = fs.statfsSync;
  let fixtureConstructed = false;
  fs.statfsSync = () => ({ bavail: 0n, bsize: 1n });
  try {
    await assert.rejects(
      withOwnedTemp(ownedSpec('portability-low-space'), async (lease) => {
        fixtureConstructed = true;
        await copyRepo(lease);
      }),
      (error) => error && error.code === 'TEMP_CAPACITY_LOW'
    );
  } finally {
    fs.statfsSync = original;
  }
  assert.equal(fixtureConstructed, false);
  assert.deepEqual(ownedTempUsage(), baseline);
});

async function posixOperationalChildClose(runtimePath, repoRoot) {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  let childObject, childPid, childClosed = false, childExit, root;
  let settled = false, runError = null, readySeen = false, termSeen = false;
  let resolveReady, resolveTerm, resolveClose;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const term = new Promise((resolve) => { resolveTerm = resolve; });
  const close = new Promise((resolve) => { resolveClose = resolve; });
  const childCode = [
    "process.on('SIGTERM',()=>process.stdout.write('TERM_SEEN\\n'));",
    "let command='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{command+=chunk;if(command.includes('EXIT\\n'))process.exit(0);});",
    "setInterval(()=>{},1000);process.stdout.write('READY\\n');"
  ].join('\n');
  childProcess.spawn = (_file, _args, options) => {
    childObject = originalSpawn(process.execPath, ['-e', childCode], {
      ...options, stdio: ['pipe', 'pipe', 'pipe']
    });
    childPid = childObject.pid;
    let output = '';
    childObject.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (!readySeen && output.includes('READY\n')) { readySeen = true; resolveReady(); }
      if (!termSeen && output.includes('TERM_SEEN\n')) { termSeen = true; resolveTerm(); }
    });
    childObject.once('close', (code, signal) => {
      childClosed = true; childExit = { code, signal }; resolveClose();
    });
    return childObject;
  };
  const runtime = require(runtimePath);
  fs.statfsSync = () => ({ bavail: 16n * 1024n * 1024n * 1024n, bsize: 1n });
  const usage = () => {
    const state = runtime.inspectOwnedTemps();
    return { records: state.records.length, reservations: state.outstandingReservationsBytes, retained: state.retainedRoots };
  };
  const alive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  const baseline = usage();
  let state;
  try {
    state = await runtime.withOwnedTemp({
      schema: runtime.SPEC_SCHEMA, purpose: 'portability', repoRoot,
      episode: 'child-operational-error', budgetBytes: 16 * 1024 * 1024
    }, async (lease) => {
      root = lease.root;
      const run = lease.runProfile('skill-portability').then(
        () => { settled = true; },
        (error) => { settled = true; runError = error; }
      );
      await ready;
      const group = childProcess.spawnSync('ps', ['-o', 'pgid=', '-p', String(childPid)], {
        encoding: 'utf8', timeout: 5000
      });
      assert.equal(group.status, 0, group.stderr);
      const childPgid = Number(group.stdout.trim());
      assert.equal(childPgid, childPid, 'the direct child must lead the production-owned POSIX group');
      childObject.emit('error', Object.assign(new Error('deterministic operational error'), { code: 'EIO' }));
      await term;
      const settledBeforeClose = settled;
      const rootExistsBeforeClose = fs.existsSync(root);
      const processAliveBeforeClose = alive(childPid);
      const groupAliveBeforeClose = alive(-childPgid);
      const childClosedBeforeTerminal = childClosed;
      const record = runtime.inspectOwnedTemps().records.find((row) => row.rootPath === root);
      assert.ok(record && record.reservationBytes > 0, 'owned state must remain reserved before confirmed close');
      const ledgerPath = path.join(path.dirname(path.dirname(root)), 'claims', record.claimId + '.lease.json');
      const ledgerBefore = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      assert.equal(ledgerBefore.owned_children.length, 1);
      assert.equal(ledgerBefore.owned_children[0].pid, childPid);
      assert.equal(ledgerBefore.owned_children[0].process_group, true);
      assert.equal(settledBeforeClose, false, 'a termination request is not confirmed child close');
      assert.equal(rootExistsBeforeClose, true);
      assert.equal(processAliveBeforeClose, true);
      assert.equal(groupAliveBeforeClose, true);
      assert.equal(childClosedBeforeTerminal, false);
      childObject.stdin.end('EXIT\n');
      await close;
      await run;
      const ledgerAfter = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      assert.deepEqual(ledgerAfter.owned_children, []);
      return {
        settledBeforeClose, rootExistsBeforeClose, processAliveBeforeClose,
        childClosed, errorCode: runError && runError.code, readySeen, termSeen,
        childPid, childPgid, groupAliveBeforeClose, childClosedBeforeTerminal,
        settledAfterClose: settled, childExit,
        processAliveAfterClose: alive(childPid), groupAliveAfterClose: alive(-childPgid)
      };
    });
  } finally {
    childProcess.spawn = originalSpawn;
  }
  assert.equal(fs.existsSync(root), false);
  assert.deepEqual(usage(), baseline);
  return state;
}

test('child operational error waits for confirmed process close', () => {
  const baseline = ownedTempUsage();
  const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-owned-temp.cjs');
  const code = process.platform !== 'win32'
    ? '(' + posixOperationalChildClose.toString() + ')(' + JSON.stringify(runtimePath) + ',' + JSON.stringify(repoRoot)
      + ').then(state=>process.stdout.write(JSON.stringify(state))).catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});'
    : [
    "const fs=require('node:fs');",
    "const childProcess=require('node:child_process');",
    "const ChildProcess=childProcess.ChildProcess;",
    "const originalSpawn=childProcess.spawn;",
    "const originalEmit=ChildProcess.prototype.emit;",
    "const repoRoot=" + JSON.stringify(repoRoot) + ';',
    "const runtimePath=" + JSON.stringify(runtimePath) + ';',
    "let childObject,childPid,originalKill,spawnInjected=false,settled=false,runError=null,childClosed=false,resolveInjected;",
    "const injected=new Promise(resolve=>{resolveInjected=resolve;});",
    "childProcess.spawn=(_file,_args,options)=>originalSpawn(process.execPath,['-e','setInterval(()=>{},1000)'],options);",
    "ChildProcess.prototype.emit=function(event,...args){const result=originalEmit.call(this,event,...args);if(event==='spawn'&&!spawnInjected){spawnInjected=true;childObject=this;childPid=this.pid;originalKill=this.kill;this.kill=()=>true;originalEmit.call(this,'error',Object.assign(new Error('deterministic operational error'),{code:'EIO'}));resolveInjected();}return result;};",
    "const runtime=require(runtimePath);",
    "fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});",
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot,episode:'child-operational-error',budgetBytes:16*1024*1024};",
    "(async()=>{const state=await runtime.withOwnedTemp(spec,async lease=>{const run=lease.runProfile('skill-portability').then(()=>{settled=true;},error=>{settled=true;runError=error;});await injected;const closePromise=new Promise(resolve=>childObject.once('close',()=>{childClosed=true;resolve();}));await new Promise(resolve=>setTimeout(resolve,30));const settledBeforeClose=settled;const rootExistsBeforeClose=fs.existsSync(lease.root);let processAliveBeforeClose=true;try{process.kill(childPid,0);}catch(_){processAliveBeforeClose=false;}ChildProcess.prototype.emit=originalEmit;childProcess.spawn=originalSpawn;childObject.kill=originalKill;childObject.kill('SIGKILL');await closePromise;await run;return{settledBeforeClose,rootExistsBeforeClose,processAliveBeforeClose,childClosed,errorCode:runError&&runError.code};});process.stdout.write(JSON.stringify(state));})().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.equal(state.settledBeforeClose, false);
  assert.equal(state.rootExistsBeforeClose, true);
  assert.equal(state.processAliveBeforeClose, true);
  assert.equal(state.childClosed, true);
  assert.equal(state.errorCode, 'TEMP_CHILD_OPERATIONAL_ERROR');
  if (process.platform !== 'win32') {
    assert.equal(state.readySeen, true);
    assert.equal(state.termSeen, true);
    assert.equal(state.childPgid, state.childPid);
    assert.equal(state.groupAliveBeforeClose, true);
    assert.equal(state.childClosedBeforeTerminal, false);
    assert.equal(state.settledAfterClose, true);
    assert.deepEqual(state.childExit, { code: 0, signal: null });
    assert.equal(state.processAliveAfterClose, false);
    assert.equal(state.groupAliveAfterClose, false);
  }
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('skill portability audit catches missing README and local references', async () => {
  await withOwnedTempBaseline(ownedSpec('portability-negative-readme'), async (lease) => {
    await copyRepo(lease);
    await lease.unlink('skills/windows-local-dev-services/README.md');
    await lease.appendFile(
      'skills/windows-local-dev-services/SKILL.md',
      '\n\nSee [the missing local reference](references/missing.md) before using this skill.\n'
    );
    const result = await runAudit(lease);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /missing README\.md or INSTALL\.md/);
    assert.match(result.stderr, /references missing local file or folder: references\/missing\.md/);
  });
});

test('skill portability audit catches thin link-only skills', async () => {
  await withOwnedTempBaseline(ownedSpec('portability-thin-link'), async (lease) => {
    await copyRepo(lease);
    await lease.mkdir('skills/thin-link-skill');
    await lease.writeFile('skills/thin-link-skill/README.md', '# Thin link skill\n\nCopy this folder.\n');
    await lease.writeFile(
      'skills/thin-link-skill/SKILL.md',
      [
        '---',
        'name: thin-link-skill',
        'description: thin link test skill.',
        '---',
        '',
        '# Thin',
        '',
        'Read https://example.com/a and https://example.com/b. This is required.'
      ].join('\n')
    );
    const result = await runAudit(lease);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /extremely thin/);
    assert.match(result.stderr, /multiple external links but no local support folders/);
  });
});
