'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const owned = require('../scripts/toolkit-owned-temp.cjs');
const { LIMITS, SPEC_SCHEMA, inspectOwnedTemps, recoverStaleOwnedTemps, shutdownOwnedTemps, withOwnedTemp } = owned;
const repoRoot = path.resolve(__dirname, '..', '..');
const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'repo/contracts/owned-temp/owned-temp-v1.schema.json'), 'utf8'));
const runtimePath = path.join(repoRoot, 'repo/scripts/toolkit-owned-temp.cjs');

function spec(episode, options = {}) {
  return {
    schema: SPEC_SCHEMA,
    purpose: options.purpose || 'foundation-test',
    repoRoot,
    episode,
    budgetBytes: options.budgetBytes === undefined ? 1024 : options.budgetBytes,
    ...(options.retention === undefined ? {} : { retention: options.retention }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  };
}

async function runOwned(specification, callback) {
  const original = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 16n * 1024n * 1024n * 1024n, bsize: 1n });
  try { return await withOwnedTemp(specification, callback); } finally { fs.statfsSync = original; }
}

function removeDirectoryLink(linkPath) {
  if (process.platform === 'win32') fs.rmdirSync(linkPath);
  else fs.unlinkSync(linkPath);
}

function usage() {
  const state = inspectOwnedTemps();
  return {
    records: state.records.length,
    outstandingReservationsBytes: state.outstandingReservationsBytes,
    retainedRoots: state.retainedRoots
  };
}

async function assertClean(promise) {
  await promise;
  assert.deepEqual(usage(), { records: 0, outstandingReservationsBytes: 0, retainedRoots: 0 });
}

function errorCode(code) {
  return (error) => error && error.code === code;
}

async function helper(_lease, code, options = {}) {
  const result = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs || 30000,
    ...(options.env ? { env: options.env } : {})
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
async function observeHelperStage(code, expectedStage, options = {}) {
  const child = spawn(process.execPath, ['-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...(options.env ? { env: options.env } : {})
  });
  const output = { stdout: '', stderr: '' };
  let lastProtocolStage = 'SPAWNED';
  let expectedSeen = false;
  let resolveExpected;
  let rejectTerminal;
  const expected = new Promise((resolve) => { resolveExpected = resolve; });
  const terminalFailure = new Promise((_, reject) => { rejectTerminal = reject; });
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output.stdout += chunk;
    for (const line of output.stdout.split('\n')) {
      const match = /^W2A_STAGE ([A-Z0-9_]+)/.exec(line);
      if (!match) continue;
      lastProtocolStage = match[1];
      if (!expectedSeen && lastProtocolStage === expectedStage) {
        expectedSeen = true;
        resolveExpected(lastProtocolStage);
      }
    }
  });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  child.once('error', (caught) => {
    rejectTerminal(new Error('Helper PID ' + child.pid + ' failed at protocol stage '
      + lastProtocolStage + ': ' + String(caught)));
  });
  closed.then((result) => {
    if (!expectedSeen || result.code !== 0 || result.signal) {
      rejectTerminal(new Error('Helper PID ' + child.pid + ' terminated before a successful '
        + expectedStage + ' result; last protocol stage=' + lastProtocolStage
        + ', exitCode=' + result.code + ', signal=' + result.signal
        + ', stderr=' + output.stderr));
    }
  });

  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Helper PID ' + child.pid
      + ' timed out after ' + (options.timeoutMs || 60000) + 'ms; last protocol stage='
      + lastProtocolStage + '; stderr=' + output.stderr)), options.timeoutMs || 60000);
  });
  try {
    await Promise.race([expected, terminalFailure, timeout]);
    const result = await Promise.race([closed, terminalFailure, timeout]);
    assert.equal(result.code, 0, 'helper PID ' + child.pid + ' failed at protocol stage '
      + lastProtocolStage + ': ' + output.stderr);
    assert.equal(result.signal, null);
    return { pid: child.pid, lastProtocolStage, output, exitCode: result.code, signal: result.signal };
  } finally {
    clearTimeout(timeoutHandle);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  }
}
function modulePrelude() {
  return [
    "const fs=require('node:fs');",
    "const os=require('node:os');",
    "const path=require('node:path');",
    'const runtime=require(' + JSON.stringify(runtimePath) + ');',
    'fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});',
    'const repoRoot=' + JSON.stringify(repoRoot) + ';'
  ].join('\n');
}

function recoveryCode() {
  return modulePrelude() + "\nruntime.recoverStaleOwnedTemps().then(rows=>process.stdout.write(JSON.stringify(rows))).catch(e=>{process.stderr.write(String(e));process.exitCode=1;});";
}

function staleChildCode(holdOpen) {
  return modulePrelude() + [
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'stale-recovery-child'};",
    'runtime.withOwnedTemp(spec,async lease=>{',
    "const record=runtime.inspectOwnedTemps().records.find(x=>x.rootPath===lease.root);",
    "const base=path.dirname(path.dirname(lease.root));",
    "const file=path.join(base,'claims',record.claimId+'.lease.json');",
    "const leaseRecord=JSON.parse(fs.readFileSync(file,'utf8'));",
    "leaseRecord.status='TERMINAL';",
    'leaseRecord.lease_expires_at_ms=Date.now();',
    "fs.writeFileSync(file,JSON.stringify(leaseRecord));",
    holdOpen ? "process.stdout.write('READY '+JSON.stringify({root:lease.root})+'\\n');setInterval(()=>{},1000);await new Promise(()=>{});" : "fs.writeSync(1,JSON.stringify({root:lease.root})+'\\n');process.exit(0);",
    '}).catch(e=>{process.stderr.write(String(e));process.exitCode=1;});'
  ].join('\n');
}


function identitySwapCode() {
  return modulePrelude() + [
    "let root,moved,replacement;",
    "runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'identity-swap-child'},async lease=>{",
    'root=lease.root;moved=root+".moved";replacement=root+".replacement";',
    'fs.renameSync(root,moved);fs.mkdirSync(root);fs.writeFileSync(path.join(root,"sentinel"),"replacement");',
    '}).catch(e=>{if(e.code!=="TEMP_CLEANUP_INCOMPLETE")throw e;}).then(()=>{',
    'fs.renameSync(root,replacement);fs.renameSync(moved,root);',
    'fs.writeSync(1,JSON.stringify({root,replacement})+"\\n");',
    '}).catch(e=>{process.stderr.write(String(e));process.exitCode=1;});'
  ].join('\n');
}

function junctionCleanupSwapCode() {
  return modulePrelude() + [
    "const originalReaddir=fs.readdirSync;let root,moved,foreign,claimId,swapped=false;",
    "(async()=>{try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'junction-cleanup-child'},async lease=>{",
    "root=lease.root;moved=root+'.original';foreign=path.join(os.tmpdir(),'owned-temp-foreign-'+require('node:crypto').randomBytes(8).toString('hex'));",
    "claimId=runtime.inspectOwnedTemps().records.find(row=>row.rootPath===root).claimId;",
    "fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel.txt'),'foreign');await lease.writeFile('owned.txt','owned');",
    "fs.readdirSync=function(dir,...args){const rows=originalReaddir.call(this,dir,...args);if(!swapped&&path.resolve(String(dir))===path.resolve(root)){swapped=true;fs.renameSync(root,moved);fs.symlinkSync(foreign,root,'junction');}return rows;};",
    "});throw new Error('cleanup unexpectedly accepted a junction substitution');",
    "}catch(error){fs.readdirSync=originalReaddir;if(error.code!=='TEMP_CLEANUP_INCOMPLETE')throw error;process.stdout.write(JSON.stringify({root,moved,foreign,claimId,swapped,code:error.code})+'\\n');}})().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

function partialNamespaceCode(preserveResidue) {
  return modulePrelude() + [
    "const namespace=path.join(os.tmpdir(),'.ai-agent-toolkit-owned-temp-v1');const originalMkdir=fs.mkdirSync;let residuePath=null;",
    "fs.mkdirSync=function(dir,...args){if(path.basename(String(dir))==='roots')throw Object.assign(new Error('injected namespace initialization failure'),{code:'EIO'});const result=originalMkdir.call(this,dir,...args);if(path.basename(String(dir))==='claims'&&" + (preserveResidue ? 'true' : 'false') + "){residuePath=path.join(String(dir),'foreign.txt');fs.writeFileSync(residuePath,'preserve');}return result;};",
    "runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'namespace-partial'},async()=>{}).then(()=>{throw new Error('namespace initialization unexpectedly succeeded');},error=>{fs.mkdirSync=originalMkdir;process.stdout.write(JSON.stringify({code:error.code||null,cleanupStatus:error.cleanupStatus||null,namespaceExists:fs.existsSync(namespace),residuePath,residueExists:residuePath?fs.existsSync(residuePath):false})+'\\n');}).catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

function emptyNamespaceCode() {
  return modulePrelude() + [
    "runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'namespace-bootstrap'},async()=>{}).then(()=>process.stdout.write('READY')).catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

function inspectPartialNamespaceCode() {
  return modulePrelude() + [
    '(async()=>{',
    "let inspectionCode=null;try{runtime.inspectOwnedTemps();}catch(error){inspectionCode=error.code;}",
    "let admissionCode=null,callbackReached=false;try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'namespace-partial-inspection'},async()=>{callbackReached=true;});}catch(error){admissionCode=error.code;}",
    "process.stdout.write(JSON.stringify({inspectionCode,admissionCode,callbackReached,claimsExists:fs.existsSync(path.join(os.tmpdir(),'.ai-agent-toolkit-owned-temp-v1','claims')),roots:fs.readdirSync(path.join(os.tmpdir(),'.ai-agent-toolkit-owned-temp-v1','roots')),orphan:fs.readFileSync(path.join(os.tmpdir(),'.ai-agent-toolkit-owned-temp-v1','roots','orphan-root','sentinel.txt'),'utf8')}));",
    "})().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}
function groupSignalFailureCode() {
  return [
    "(async()=>{",
    "const fs=require('node:fs');",
    "const childProcess=require('node:child_process');",
    "const originalSpawn=childProcess.spawn;childProcess.spawn=function(_file,_args,options){return originalSpawn.call(childProcess,process.execPath,['-e','setInterval(()=>{},1000)'],options);};",
    "const {ChildProcess}=childProcess;const originalEmit=ChildProcess.prototype.emit;const originalKill=process.kill.bind(process);",
    "let groupAttempts=0,directAttempts=0,child=null,childClosed=false,settleClosed;const closed=new Promise(resolve=>{settleClosed=resolve;});",
    "const controller=new AbortController();",
    "ChildProcess.prototype.emit=function(event,...args){const result=originalEmit.call(this,event,...args);if(event==='spawn'&&!child){child=this;this.once('close',()=>{childClosed=true;settleClosed();});this.kill=function(){directAttempts+=1;return true;};controller.abort('injected group signal failure');}return result;};",
    "process.kill=function(pid,signal){if(pid<0&&signal!==0){groupAttempts+=1;throw Object.assign(new Error('injected group signal failure'),{code:'EPERM'});}return originalKill(pid,signal);};",
    'const runtime=require(' + JSON.stringify(runtimePath) + ');',
    'const repoRoot=' + JSON.stringify(repoRoot) + ';',
    "fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});",
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot,episode:'group-signal-failure',signal:controller.signal};",
    "const execution=runtime.withOwnedTemp(spec,async lease=>lease.runProfile('skill-portability')).then(()=>({code:'SUCCESS'}),error=>({code:error.code||'UNKNOWN',cleanupCode:error.cleanupCode||null}));",
    "const timeout=new Promise(resolve=>setTimeout(()=>resolve({code:'TIMEOUT'}),6000));const outcome=await Promise.race([execution,timeout]);const stoppedEarly=!childClosed;",
    "if(child&&!childClosed){ChildProcess.prototype.kill.call(child,'SIGKILL');await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,3000))]);}",
    "const finalOutcome=outcome.code==='TIMEOUT'?await execution:outcome;ChildProcess.prototype.emit=originalEmit;process.kill=originalKill;childProcess.spawn=originalSpawn;",
    "process.stdout.write(JSON.stringify({outcome,finalOutcome,stoppedEarly,childClosed,groupAttempts,directAttempts}));",
    "})().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1;});"
  ].join('\n');
}

function metadataInterruptedCleanupCode() {
  return modulePrelude() + [
    "let root,claimId,markerPath,attempts=0,originalUnlink;const stage=name=>process.stdout.write('W2A_STAGE '+name+' pid='+process.pid+'\\n');stage('HELPER_STARTED');",
    "(async()=>{try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'metadata-interrupted-child'},async lease=>{",
    "root=lease.root;claimId=runtime.inspectOwnedTemps().records.find(row=>row.rootPath===root).claimId;markerPath=path.join(path.dirname(path.dirname(root)),'claims',claimId+'.marker.json');stage('CLAIM_ACTIVE');",
    "originalUnlink=fs.promises.unlink;fs.promises.unlink=async function(filePath,...args){if(path.resolve(String(filePath))===path.resolve(markerPath)){attempts+=1;stage('MARKER_UNLINK_ATTEMPT_'+attempts);throw Object.assign(new Error('injected persistent metadata lock'),{code:'EPERM'});}return originalUnlink.call(this,filePath,...args);};",
    "});throw new Error('cleanup unexpectedly removed locked metadata');",
    "}catch(error){if(originalUnlink)fs.promises.unlink=originalUnlink;if(error.code!=='TEMP_CLEANUP_INCOMPLETE')throw error;const base=path.dirname(path.dirname(root));const leasePath=path.join(base,'claims',claimId+'.lease.json');const lease=JSON.parse(fs.readFileSync(leasePath,'utf8'));stage(lease.metadata_cleanup_phase);process.stdout.write('W2A_RESULT '+JSON.stringify({root,claimId,phase:lease.metadata_cleanup_phase,attempts,rootExists:fs.existsSync(root),markerExists:fs.existsSync(markerPath),leaseExists:fs.existsSync(leasePath)})+'\\n');}})().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

function retentionChildCode(){
 return modulePrelude()+[
  "const expiresAt=new Date(Date.now()+60000).toISOString();",
  "runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'retention-expiry-child',retention:{reason:'expiry regression evidence',owner:'toolkit-owned-temp-test',maxBytes:1024,expiresAt}},async lease=>{",
  "await lease.writeFile('evidence.txt','retained evidence');lease.retain();",
  "}).then(()=>{const row=runtime.inspectOwnedTemps().records.find(x=>x.episode==='retention-expiry-child');process.stdout.write(JSON.stringify(row)+'\\n');setInterval(()=>{},1000);}).catch(e=>{process.stderr.write(String(e));process.exitCode=1;});"
 ].join('\n');
}
test('owned-temp schema defines strict public and private record contracts', () => {
  assert.equal(schema.properties.schema.const, SPEC_SCHEMA);
  assert.ok(schema.properties.budgetBytes.description.includes('Reserved maximum'));
  assert.match(schema.properties.budgetBytes.description, /does not enforce an operating-system or filesystem quota/);
  assert.ok(schema.$defs.lease.required.includes('bytes_reserved'));
  assert.ok(schema.$defs.lease.required.includes('metadata_cleanup_phase'));
  assert.equal(schema.$defs.lease.properties.bytes_written, undefined);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.retention.$ref, '#/$defs/retentionSpec');
  assert.equal(schema.$defs.claim.properties.retention.anyOf[0].$ref, '#/$defs/retentionClaim');
  assert.equal(schema.$defs.lease.properties.retention.anyOf[0].$ref, '#/$defs/retentionRecord');
  assert.equal(schema.$defs.lease.properties.owned_children.items.$ref, '#/$defs/ownedChild');
  assert.ok(schema.$defs.lease.required.includes('owned_children'));
  const rootSourceUpdateCap = schema.allOf.find((rule) => rule.if?.properties?.purpose?.const === 'source-update')?.then?.properties?.budgetBytes?.maximum;
  const claimSourceUpdateCap = schema.$defs.claim.allOf.find((rule) => rule.if?.properties?.purpose?.const === 'source-update')?.then?.properties?.budget_bytes?.maximum;
  assert.equal(rootSourceUpdateCap, 16 * 1024 * 1024);
  assert.equal(claimSourceUpdateCap, 16 * 1024 * 1024);
  for (const name of ['resourceIdentity', 'process', 'repository', 'namespaceMarker', 'rootMarker', 'claim', 'marker', 'lease', 'admissionLock', 'retentionSpec', 'retentionClaim', 'retentionRecord', 'ownedChild']) {
    assert.ok(schema.$defs[name], 'missing schema definition ' + name);
    assert.equal(schema.$defs[name].additionalProperties, false);
  }
  assert.deepEqual(LIMITS, {
    portability: 256 * 1024 * 1024,
    sourceUpdate: 16 * 1024 * 1024,
    foundationTest: 256 * 1024 * 1024,
    headroom: 1024 * 1024 * 1024,
    aggregate: 2 * 1024 * 1024 * 1024,
    roots: 8,
    entries: 8192,
    depth: 64,
    file: 64 * 1024 * 1024,
    chunk: 64 * 1024,
    metadata: 1024 * 1024,
    lease: 120000,
    renew: 30000,
    recoveryRecords: 128,
    recoveryCount: 8,
    retained: 2,
    retainedBytes: 64 * 1024 * 1024,
    retainedMs: 24 * 60 * 60 * 1000
  });
});

test('successful and failed callback episodes clean their exact roots and preserve primary errors', async () => {
  const before = usage();
  const result = await runOwned(spec('cleanup-success'), async (lease) => {
    await lease.mkdir('nested/fixture');
    const written = await lease.writeFile('nested/fixture/data.txt', 'first');
    assert.equal(written.identity.ino, String(fs.lstatSync(lease.path('nested/fixture/data.txt'), { bigint: true }).ino));
    await lease.appendFile('nested/fixture/data.txt', '-second');
    assert.equal(fs.readFileSync(lease.path('nested/fixture/data.txt'), 'utf8'), 'first-second');
    const active = inspectOwnedTemps().records.find((row) => row.episode === 'cleanup-success');
    assert.equal(active.state, 'ACTIVE');
    assert.equal(active.bytesReserved, 12);
    return 'value';
  });
  assert.equal(result, 'value');
  assert.deepEqual(usage(), before);

  const failure = new Error('assertion failure stays primary');
  await assert.rejects(runOwned(spec('cleanup-failure'), async (lease) => {
    await lease.writeFile('partial.txt', 'partial');
    throw failure;
  }), (error) => error === failure);
  assert.deepEqual(usage(), before);
});

test('three repeated episodes return reservations to baseline and leave unrelated OS-temp sentinels untouched', async () => {
  const baseline = usage();
  const sentinel = path.join(os.tmpdir(), 'owned-temp-unrelated-' + process.pid + '-' + crypto.randomBytes(8).toString('hex') + '.txt');
  fs.writeFileSync(sentinel, 'unrelated');
  try {
    for (let index = 0; index < 3; index += 1) {
      await runOwned(spec('repeat-episode-' + index), async (lease) => {
        await lease.writeFile('episode-' + index + '.txt', String(index));
      });
      assert.deepEqual(usage(), baseline);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unrelated');
    }
  } finally {
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
  }
});

test('spec validation and path traversal reject unsafe requests', async () => {
  await assert.rejects(withOwnedTemp({ schema: 'wrong', purpose: 'foundation-test', repoRoot, episode: 'bad-spec' }, async () => {}), errorCode('TEMP_SPEC_INVALID'));
  await assert.rejects(runOwned(spec('bad-purpose', { purpose: 'unknown' }), async () => {}), errorCode('TEMP_SPEC_INVALID'));
  const baseline = usage();
  await runOwned(spec('path-traversal'), async (lease) => {
    for (const target of ['../outside.txt', 'nested/../../outside.txt', 'C:\\outside.txt', '/outside.txt']) {
      await assert.rejects(lease.writeFile(target, 'blocked'), errorCode('TEMP_PATH_ESCAPE'));
    }
    await assert.rejects(lease.writeFile('nested/../outside.txt', 'blocked'), errorCode('TEMP_PATH_ESCAPE'));
  });
  assert.deepEqual(usage(), baseline);
});

test('only the exact owned root is removed, not a longer prefix sibling', async () => {
  let sibling;
  try {
    await runOwned(spec('exact-root-prefix'), async (lease) => {
      sibling = lease.root + '-extra';
      fs.mkdirSync(sibling);
      fs.writeFileSync(path.join(sibling, 'sentinel'), 'keep');
    });
    assert.equal(fs.readFileSync(path.join(sibling, 'sentinel'), 'utf8'), 'keep');
  } finally {
    if (sibling && fs.existsSync(sibling)) fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('path aliases and directory symlinks or junctions are rejected without writing through them', async (t) => {
  const baseline = usage();
  const victim = path.join(os.tmpdir(), 'owned-temp-alias-victim-' + crypto.randomBytes(8).toString('hex'));
  let fencedRoot = null;
  const result = await runOwned(spec('path-alias', { retention: {
    reason: 'ownership fence must suppress retention', owner: 'toolkit-owned-temp-test', maxBytes: 1024,
    expiresAt: new Date(Date.now() + 60000).toISOString()
  } }), async (lease) => {
    const alias = lease.path('alias');
    try {
      fs.symlinkSync(os.tmpdir(), alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        t.skip('directory junction creation is unavailable on this Windows host');
        return 'skipped';
      }
      throw error;
    }
    fencedRoot = lease.root;
    lease.retain();
    assert.equal(lease.signal.aborted, false);
    await assert.rejects(lease.writeFile('alias/' + path.basename(victim), 'must not escape'), errorCode('TEMP_OWNERSHIP_UNCERTAIN'));
    assert.equal(fs.existsSync(victim), false);
    await assert.rejects(lease.writeFile('blocked.txt', 'blocked'), errorCode('TEMP_LEASE_CLOSED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'blocked.txt')), false);
    return 'caught-ownership-rejection';
  });
  if (result !== 'skipped') {
    assert.equal(result, 'caught-ownership-rejection');
    assert.equal(fs.existsSync(fencedRoot), false, 'an ownership-fenced root must be cleaned instead of retained');
  }
  assert.equal(fs.existsSync(victim), false);
  assert.deepEqual(usage(), baseline);
});
test('unlink refuses a regular file reached through a symlinked parent without aborting the task', async (t) => {
  const baseline = usage();
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-unlink-foreign-'));
  const victim = path.join(foreign, 'victim.txt');
  fs.writeFileSync(victim, 'keep');
  let skipped = false;
  try {
    const result = await runOwned(spec('unlink-parent-escape'), async (lease) => {
      const alias = lease.path('link');
      try {
        fs.symlinkSync(foreign, alias, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
          skipped = true;
          t.skip('directory junction creation is unavailable on this Windows host');
          return 'skipped';
        }
        throw error;
      }
      await assert.rejects(lease.unlink('link/victim.txt'), errorCode('TEMP_OWNERSHIP_UNCERTAIN'));
      assert.equal(lease.signal.aborted, false);
      assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
      await assert.rejects(lease.writeFile('blocked.txt', 'blocked'), errorCode('TEMP_LEASE_CLOSED'));
      assert.equal(fs.existsSync(path.join(lease.root, 'blocked.txt')), false);
      return 'caught-ownership-rejection';
    });
    if (!skipped) assert.equal(result, 'caught-ownership-rejection');
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
  assert.deepEqual(usage(), baseline);
});

test('uncaught ownership rejection remains TEMP_OWNERSHIP_UNCERTAIN after cleanup', async (t) => {
  const baseline = usage();
  let unsupported = false;
  let ownershipAttempted = false;
  let outerError = null;
  try {
    await runOwned(spec('uncaught-owner-fence'), async (lease) => {
      const alias = lease.path('alias');
      try {
        fs.symlinkSync(os.tmpdir(), alias, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (caught) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(caught.code)) {
          unsupported = true;
          t.skip('directory junction creation is unavailable on this Windows host');
          return 'skipped';
        }
        throw caught;
      }
      ownershipAttempted = true;
      await lease.writeFile('alias/escaped.txt', 'must not escape');
    });
  } catch (caught) {
    outerError = caught;
  }
  if (unsupported) return;
  assert.equal(ownershipAttempted, true, 'the callback must reach the unsafe operation');
  assert.equal(outerError && outerError.code, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.deepEqual(usage(), baseline);
});

test('external AbortController cancellation still produces TEMP_ABORTED', async () => {
  const baseline = usage();
  const controller = new AbortController();
  let callbackReached = false;
  await assert.rejects(runOwned(spec('external-task-abort', { signal: controller.signal }), async (lease) => {
    callbackReached = true;
    assert.equal(lease.signal.aborted, false);
    controller.abort('external task cancellation');
    assert.equal(lease.signal.aborted, true);
  }), errorCode('TEMP_ABORTED'));
  assert.equal(callbackReached, true);
  assert.deepEqual(usage(), baseline);
});

test('directory-link cleanup surfaces unexpected removal errors', () => {
  const method = process.platform === 'win32' ? 'rmdirSync' : 'unlinkSync';
  const original = fs[method];
  const injected = Object.assign(new Error('injected directory-link cleanup failure'), { code: 'EIO' });
  fs[method] = function () { throw injected; };
  try {
    assert.throws(() => removeDirectoryLink('injected-link'), (caught) => caught === injected);
  } finally {
    fs[method] = original;
  }
});
test('partial admission failure removes its claim, marker, and root', async () => {
  const baseline = usage();
  const original = fs.statfsSync;
  let callbackReached = false;
  fs.statfsSync = () => { const error = new Error('synthetic statfs unavailable'); error.code = 'EIO'; throw error; };
  try {
    await assert.rejects(withOwnedTemp(spec('partial-admission'), async () => { callbackReached = true; }), errorCode('TEMP_CAPACITY_UNKNOWN'));
  } finally {
    fs.statfsSync = original;
  }
  assert.equal(callbackReached, false);
  assert.deepEqual(usage(), baseline);
});

test('capacity requires the exact headroom plus reservation and fails before callback work', async () => {
  const original = fs.statfsSync;
  const baseline = usage();
  const budget = 4096;
  const expected = BigInt(LIMITS.headroom + LIMITS.metadata + budget);
  let heavyConstruction = false;
  try {
    fs.statfsSync = () => ({ bavail: expected - 1n, bsize: 1n });
    await assert.rejects(withOwnedTemp(spec('capacity-low', { budgetBytes: budget }), async () => { heavyConstruction = true; }), errorCode('TEMP_CAPACITY_LOW'));
    assert.equal(heavyConstruction, false);
    assert.deepEqual(usage(), baseline);

    fs.statfsSync = () => ({ bavail: expected, bsize: 1n });
    const value = await withOwnedTemp(spec('capacity-boundary', { budgetBytes: budget }), async () => 'admitted');
    assert.equal(value, 'admitted');
    assert.deepEqual(usage(), baseline);
  } finally {
    fs.statfsSync = original;
  }
});

test('capacity contention includes another live reservation', async () => {
  const original = fs.statfsSync;
  const baseline = usage();
  const budget = 2048;
  const free = BigInt(LIMITS.headroom + LIMITS.metadata + budget);
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  let releaseResolve;
  const held = new Promise((resolve) => { releaseResolve = resolve; });
  fs.statfsSync = () => ({ bavail: free, bsize: 1n });
  try {
    const first = withOwnedTemp(spec('capacity-contention-first', { budgetBytes: budget }), async () => {
      enteredResolve();
      await held;
    });
    await entered;
    await assert.rejects(withOwnedTemp(spec('capacity-contention-second', { budgetBytes: budget }), async () => {
      assert.fail('second callback must not pass admission');
    }), errorCode('TEMP_CAPACITY_LOW'));
    releaseResolve();
    await first;
  } finally {
    releaseResolve();
    fs.statfsSync = original;
  }
  assert.deepEqual(usage(), baseline);
});

test('reserved byte ceiling is exact, seals after failure, and checks before path growth', async () => {
  const baseline = usage();
  await runOwned(spec('byte-budget-exact', { budgetBytes: 5 }), async (lease) => {
    await lease.writeFile('exact.txt', '12345');
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    assert.equal(row.bytesReserved, 5);
    assert.equal(fs.readFileSync(lease.path('exact.txt'), 'utf8'), '12345');
  });
  await runOwned(spec('byte-budget-over', { budgetBytes: 5 }), async (lease) => {
    await assert.rejects(lease.writeFile('nested/over.txt', '123456'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'nested')), false);
    await assert.rejects(lease.writeFile('later.txt', '1'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'later.txt')), false);
    assert.equal(inspectOwnedTemps().records.find((record) => record.rootPath === lease.root).bytesReserved, 0);
  });
  await runOwned(spec('byte-budget-caught-over', { budgetBytes: 5 }), async (lease) => {
    await lease.writeFile('small.txt', '12345');
    await assert.rejects(lease.appendFile('small.txt', '6'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.readFileSync(lease.path('small.txt'), 'utf8'), '12345');
    await assert.rejects(lease.writeFile('later.txt', '1'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'later.txt')), false);
  });

  const tooLarge = Buffer.alloc(LIMITS.file + 1);
  await assert.rejects(runOwned(spec('file-limit'), async (lease) => {
    await lease.writeFile('too-large.bin', tooLarge);
  }), errorCode('TEMP_BUDGET_EXCEEDED'));
  const deepPath = Array(LIMITS.depth + 1).fill('d').join('/');
  await assert.rejects(runOwned(spec('depth-limit'), async (lease) => {
    await lease.mkdir(deepPath);
  }), errorCode('TEMP_BUDGET_EXCEEDED'));

  await runOwned(spec('entry-limit-source'), async (sourceLease) => {
    await sourceLease.mkdir('fixture');
    const fixture = sourceLease.path('fixture');
    const originalReadDir = fs.readdirSync;
    const originalLstat = fs.lstatSync;
    try {
      fs.readdirSync = function (directory, ...args) {
        if (path.resolve(String(directory)) === path.resolve(fixture)) return Array.from({ length: LIMITS.entries + 1 }, (_, index) => 'f' + index);
        return originalReadDir.call(this, directory, ...args);
      };
      fs.lstatSync = function (filePath, ...args) {
        const absolute = path.resolve(String(filePath));
        if (path.dirname(absolute) === path.resolve(fixture)) {
          const index = Number(path.basename(absolute).slice(1));
          return { dev: 1n, ino: BigInt(index + 1), size: 0n,
            isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
        }
        return originalLstat.call(this, filePath, ...args);
      };
      await assert.rejects(runOwned(spec('entry-limit-copy'), async (targetLease) => {
        await targetLease.copyTree(fixture);
      }), errorCode('TEMP_BUDGET_EXCEEDED'));
    } finally {
      fs.readdirSync = originalReadDir;
      fs.lstatSync = originalLstat;
    }
  });
  assert.deepEqual(usage(), baseline);
});

test('write, append, copy, and create helpers share one ledger; raw same-user writes stay outside it', async () => {
  const baseline = usage();
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-copy-ledger-'));
  try {
    fs.writeFileSync(path.join(source, 'copy.txt'), 'fgh');
    await runOwned(spec('shared-writer-ledger', { budgetBytes: 9 }), async (lease) => {
      await lease.writeFile('append.txt', 'abc');
      await lease.appendFile('append.txt', 'd');
      await lease.copyTree(source);
      await lease.mkdir('created');
      await lease.writeFile('created/file.txt', 'xy');
      const record = inspectOwnedTemps().records.find((row) => row.rootPath === lease.root);
      assert.equal(record.bytesReserved, 9);
      const rawPath = lease.path('raw-path-probe.bin');
      fs.writeFileSync(rawPath, 'outside');
      assert.equal(fs.readFileSync(rawPath, 'utf8'), 'outside');
      assert.equal(inspectOwnedTemps().records.find((row) => row.rootPath === lease.root).bytesReserved, 9);
      await assert.rejects(lease.writeFile('after-exhaustion.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
      assert.equal(fs.existsSync(path.join(lease.root, 'after-exhaustion.txt')), false);
    });
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
  assert.deepEqual(usage(), baseline);
});

test('partial writes and accounting failures never refund or reopen reserved growth', async () => {
  const baseline = usage();
  await assert.rejects(runOwned(spec('partial-write-ledger', { budgetBytes: 8 }), async (lease) => {
    const partialPath = lease.path('partial.txt');
    const originalOpen = fs.openSync;
    const originalWrite = fs.writeSync;
    let targetFd = null;
    let writes = 0;
    fs.openSync = function (filePath, ...args) {
      const fd = originalOpen.call(this, filePath, ...args);
      if (path.resolve(String(filePath)) === path.resolve(partialPath)) targetFd = fd;
      return fd;
    };
    fs.writeSync = function (fd, buffer, offset, length, position) {
      if (fd !== targetFd) return originalWrite.call(this, fd, buffer, offset, length, position);
      writes += 1;
      if (writes === 1) return originalWrite.call(this, fd, buffer, offset, Math.min(2, length), position);
      throw Object.assign(new Error('injected partial disk failure'), { code: 'EIO' });
    };
    try {
      await assert.rejects(lease.writeFile('partial.txt', '12345'), errorCode('EIO'));
    } finally {
      fs.openSync = originalOpen;
      fs.writeSync = originalWrite;
    }
    assert.equal(fs.statSync(partialPath).size, 2);
    assert.equal(inspectOwnedTemps().records.find((row) => row.rootPath === lease.root).bytesReserved, 5);
    await assert.rejects(lease.writeFile('over.txt', '1234'), errorCode('TEMP_LEASE_CLOSED'));
    await assert.rejects(lease.writeFile('later.txt', '123'), errorCode('TEMP_LEASE_CLOSED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'later.txt')), false);
    assert.equal(inspectOwnedTemps().records.find((row) => row.rootPath === lease.root).bytesReserved, 5);
  }), errorCode('TEMP_ABORTED'));

  await runOwned(spec('accounting-failure-seal', { budgetBytes: 8 }), async (lease) => {
    const originalRename = fs.renameSync;
    let injected = false;
    fs.renameSync = function (from, to) {
      if (!injected && String(to).endsWith('.lease.json')) {
        injected = true;
        throw Object.assign(new Error('injected ledger persistence failure'), { code: 'EIO' });
      }
      return originalRename.call(this, from, to);
    };
    try {
      await assert.rejects(lease.writeFile('blocked.txt', 'bytes'), errorCode('TEMP_OWNERSHIP_UNCERTAIN'));
    } finally {
      fs.renameSync = originalRename;
    }
    assert.equal(injected, true);
    await assert.rejects(lease.writeFile('reopened.txt', 'x'), errorCode('TEMP_LEASE_CLOSED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'blocked.txt')), false);
    assert.equal(fs.existsSync(path.join(lease.root, 'reopened.txt')), false);
    assert.equal(inspectOwnedTemps().records.find((row) => row.rootPath === lease.root).bytesReserved, 0);
  });
  assert.deepEqual(usage(), baseline);
});
test('copy uses bounded chunks and a mid-copy failure cleans the partial destination', async () => {
  const baseline = usage();
  await runOwned(spec('copy-source', { budgetBytes: 1024 * 1024 }), async (sourceLease) => {
    const payload = Buffer.alloc(LIMITS.chunk * 3 + 17, 0x41);
    await sourceLease.writeFile('fixture/a-first.bin', payload);
    await sourceLease.writeFile('fixture/b-second.bin', payload);
    await runOwned(spec('copy-target', { budgetBytes: 1024 * 1024 }), async (targetLease) => {
      const result = await targetLease.copyTree(sourceLease.path('fixture'));
      assert.equal(result.entries, 2);
      assert.equal(result.bytes, payload.length * 2);
      assert.deepEqual(fs.readFileSync(targetLease.path('a-first.bin')), payload);
      assert.deepEqual(fs.readFileSync(targetLease.path('b-second.bin')), payload);
    });
  });
  assert.deepEqual(usage(), baseline);

  let observedPartial = false;
  let targetRoot;
  await runOwned(spec('mid-copy-source'), async (sourceLease) => {
    await sourceLease.writeFile('fixture/a-first.txt', 'copied first');
    await sourceLease.writeFile('fixture/b-second.txt', 'fail second');
    const first = sourceLease.path('fixture/a-first.txt');
    const second = sourceLease.path('fixture/b-second.txt');
    const originalOpen = fs.promises.open;
    try {
      await assert.rejects(runOwned(spec('mid-copy-target'), async (targetLease) => {
        targetRoot = targetLease.root;
        fs.promises.open = async function (filePath, ...args) {
          if (path.resolve(String(filePath)) === path.resolve(second)) {
            const error = new Error('injected mid-copy read failure');
            error.code = 'EIO';
            throw error;
          }
          return originalOpen.call(this, filePath, ...args);
        };
        try {
          await targetLease.copyTree(sourceLease.path('fixture'));
        } catch (error) {
          observedPartial = fs.existsSync(path.join(targetLease.root, path.basename(first)));
          throw error;
        } finally {
          fs.promises.open = originalOpen;
        }
      }), (error) => error && error.code === 'EIO');
    } finally {
      fs.promises.open = originalOpen;
    }
  });
  assert.equal(observedPartial, true);
  assert.equal(fs.existsSync(targetRoot), false);
  assert.deepEqual(usage(), baseline);
});

test('writeFile and copyTree reject parent substitution at deterministic I/O barriers', async () => {
  const baseline = usage();
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-identity-foreign-'));
  const sourceContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-identity-source-'));
  const source = path.join(sourceContainer, 'input');
  const movedSource = source + '.original';
  const payload = path.join(source, 'asset.txt');
  fs.writeFileSync(path.join(foreign, 'sentinel.txt'), 'foreign');
  fs.mkdirSync(source);
  fs.writeFileSync(payload, 'source');
  try {
    await runOwned(spec('write-parent-identity-race'), async (lease) => {
      await lease.mkdir('parent');
      const parent = lease.path('parent');
      const moved = parent + '.original';
      const target = lease.path('parent/new.txt');
      const originalOpen = fs.openSync;
      const originalClose = fs.closeSync;
      let targetFd = null;
      let swapped = false;
      fs.openSync = function (filePath, ...args) {
        const fd = originalOpen.call(this, filePath, ...args);
        if (path.resolve(String(filePath)) === path.resolve(target)) targetFd = fd;
        return fd;
      };
      fs.closeSync = function (fd) {
        const closed = originalClose.call(this, fd);
        if (fd === targetFd && !swapped) {
          fs.renameSync(parent, moved);
          fs.symlinkSync(foreign, parent, process.platform === 'win32' ? 'junction' : 'dir');
          swapped = true;
        }
        return closed;
      };
      try {
        await assert.rejects(lease.writeFile('parent/new.txt', 'owned'), errorCode('TEMP_OWNERSHIP_UNCERTAIN'));
      } finally {
        fs.openSync = originalOpen;
        fs.closeSync = originalClose;
        if (swapped) {
          assert.equal(fs.lstatSync(parent).isSymbolicLink(), true);
          removeDirectoryLink(parent);
          fs.renameSync(moved, parent);
        }
      }
      assert.equal(swapped, true);
      assert.equal(fs.existsSync(path.join(foreign, 'new.txt')), false);
      assert.equal(fs.readFileSync(path.join(foreign, 'sentinel.txt'), 'utf8'), 'foreign');
      await assert.rejects(lease.writeFile('blocked.txt', 'blocked'), errorCode('TEMP_LEASE_CLOSED'));
    });

    await runOwned(spec('copy-source-ancestor-race'), async (lease) => {
      const originalOpen = fs.promises.open;
      let swapped = false;
      fs.promises.open = async function (filePath, ...args) {
        let handle = await originalOpen.call(this, filePath, ...args);
        if (!swapped && path.resolve(String(filePath)) === path.resolve(payload)) {
          await handle.close();
          fs.renameSync(source, movedSource);
          fs.symlinkSync(foreign, source, process.platform === 'win32' ? 'junction' : 'dir');
          swapped = true;
          handle = await originalOpen.call(this, path.join(movedSource, path.basename(String(filePath))), ...args);
        }
        return handle;
      };
      try {
        await assert.rejects(lease.copyTree(source), errorCode('TEMP_OWNERSHIP_UNCERTAIN'));
      } finally {
        fs.promises.open = originalOpen;
        if (swapped) {
          assert.equal(fs.lstatSync(source).isSymbolicLink(), true);
          removeDirectoryLink(source);
          fs.renameSync(movedSource, source);
        }
      }
      assert.equal(swapped, true);
      assert.equal(fs.existsSync(path.join(lease.root, 'asset.txt')), false);
      assert.equal(fs.readFileSync(path.join(foreign, 'sentinel.txt'), 'utf8'), 'foreign');
      await assert.rejects(lease.writeFile('blocked.txt', 'blocked'), errorCode('TEMP_LEASE_CLOSED'));
    });
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
    fs.rmSync(sourceContainer, { recursive: true, force: true });
  }
  assert.deepEqual(usage(), baseline);
});
test('generic run is bounded and only the two purpose-bound child profiles are admitted', async () => {
  await runOwned(spec('child-profile-rejection'), async (lease) => {
    assert.equal(lease.spawn, undefined);
    assert.equal(typeof lease.run, 'function');
    assert.equal(lease.childEnv, undefined);
    assert.equal(lease.childTemp, undefined);
    let getterEvaluated = false;
    await assert.rejects(lease.run(process.execPath, ['-e', ''], {
      get timeoutMs() { getterEvaluated = true; return 1; }
    }), errorCode('TEMP_SPEC_INVALID'));
    assert.equal(getterEvaluated, false);
    await assert.rejects(lease.run(process.execPath, ['-e', ''], {
      maxOutputBytes: 16 * 1024 * 1024 + 1
    }), errorCode('TEMP_SPEC_INVALID'));
    await assert.rejects(lease.runProfile('node', { command: 'anything' }), errorCode('TEMP_SPEC_INVALID'));
    await assert.rejects(lease.runProfile('skill-portability'), errorCode('TEMP_SPEC_INVALID'));
    await assert.rejects(lease.runProfile('unknown-profile'), errorCode('TEMP_SPEC_INVALID'));
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children, []);
  });
});

test('caught generic child failure preserves exact bounded output without a profile terminal failure', async () => {
  const baseline = usage();
  let root;
  const value = await runOwned(spec('generic-negative-output', { purpose: 'source-update', budgetBytes: 65536 + 128 }), async (lease) => {
    root = lease.root;
    let caught;
    try {
      await lease.run(process.execPath, ['-e',
        "process.stdout.write('GENERIC_NEGATIVE_STDOUT');process.stderr.write('GENERIC_NEGATIVE_STDERR');process.exitCode=23;"]);
    } catch (error) { caught = error; }
    assert.ok(caught, 'the non-zero child must reject');
    assert.equal(caught.code, 'TEMP_CHILD_FAILED');
    assert.equal(caught.exitCode, 23);
    assert.equal(caught.stdout, 'GENERIC_NEGATIVE_STDOUT');
    assert.equal(caught.stderr, 'GENERIC_NEGATIVE_STDERR');
    assert.equal(lease.signal.aborted, false);
    await lease.writeFile('after-caught-child.txt', 'still usable');
    const profile = await lease.runProfile('source-update');
    assert.equal(profile.code, 0, profile.stderr);
    return 'caught-without-profile-failure';
  });
  assert.equal(value, 'caught-without-profile-failure');
  assert.equal(fs.existsSync(root), false);
  assert.deepEqual(usage(), baseline);
});

test('zero-exit generic child returns exact stdout and stderr and cleans its owned state', async () => {
  const baseline = usage();
  let root;
  const result = await runOwned(spec('generic-positive-output'), async (lease) => {
    root = lease.root;
    return lease.run(process.execPath, ['-e',
      "process.stdout.write('GENERIC_POSITIVE_STDOUT');process.stderr.write('GENERIC_POSITIVE_STDERR');"]);
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'GENERIC_POSITIVE_STDOUT');
  assert.equal(result.stderr, 'GENERIC_POSITIVE_STDERR');
  assert.equal(fs.existsSync(root), false);
  assert.deepEqual(usage(), baseline);
});

test('generic timeout and cancellation wait for child termination and clean the root', async () => {
  const baseline = usage();
  await assert.rejects(runOwned(spec('generic-timeout'), async (lease) => {
    await lease.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 });
  }), errorCode('TEMP_CHILD_TIMEOUT'));
  assert.deepEqual(usage(), baseline);
  const controller = new AbortController();
  await assert.rejects(runOwned(spec('generic-cancel'), async (lease) => {
    const pending = lease.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
    setTimeout(() => controller.abort('controlled generic cancellation'), 50);
    await pending;
  }), errorCode('TEMP_CHILD_CANCELLED'));
  assert.deepEqual(usage(), baseline);
});
test('fixed child profile cancellation waits for confirmed close', async () => {
  const baseline = usage();
  const controller = new AbortController();
  const ChildProcess = require('node:child_process').ChildProcess;
  const originalEmit = ChildProcess.prototype.emit;
  let injected = false;
  ChildProcess.prototype.emit = function (event, ...args) {
    const result = originalEmit.call(this, event, ...args);
    if (event === 'spawn' && !injected) {
      injected = true;
      controller.abort('test cancellation after spawn');
    }
    return result;
  };
  try {
    await assert.rejects(
      runOwned(spec('child-cancel', { purpose: 'portability', signal: controller.signal }), async (lease) => {
        await assert.rejects(lease.runProfile('skill-portability'), errorCode('TEMP_CHILD_CANCELLED'));
      }),
      errorCode('TEMP_ABORTED')
    );
  } finally {
    ChildProcess.prototype.emit = originalEmit;
  }
  assert.equal(injected, true);
  assert.deepEqual(usage(), baseline);
});
test('source-update writer reserves exactly 65,536 bytes before one admitted child and cannot grow after exhaustion', async () => {
  await runOwned(spec('source-writer-exhaustion', { purpose: 'source-update', budgetBytes: 65536 }), async (lease) => {
    const result = await lease.runProfile('source-update');
    assert.equal(result.code, 0, result.stderr);
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    assert.equal(row.bytesReserved, 65536);
    assert.equal(fs.existsSync(path.join(lease.root, 'workspace')), false);
    const base = path.dirname(path.dirname(lease.root));
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children, []);
    await assert.rejects(lease.runProfile('source-update'), errorCode('TEMP_CHILD_PROTOCOL'));
    await assert.rejects(lease.writeFile('after-exhaustion.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'after-exhaustion.txt')), false);
    assert.equal(inspectOwnedTemps().records.find((record) => record.rootPath === lease.root).bytesReserved, 65536);
  });
});

test('cleanup preserves foreign content when the owned root becomes a junction at the deletion barrier', async () => {
  await runOwned(spec('junction-cleanup-parent'), async (lease) => {
    const result = await helper(lease, junctionCleanupSwapCode());
    assert.equal(result.code, 0, result.stderr);
    const paths = JSON.parse(result.stdout.trim());
    assert.equal(paths.swapped, true);
    assert.equal(paths.code, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(fs.readFileSync(path.join(paths.foreign, 'sentinel.txt'), 'utf8'), 'foreign');

    const held = await helper(lease, recoveryCode());
    assert.equal(held.code, 0, held.stderr);
    const heldChild = JSON.parse(held.stdout).find((row) => row.claimId === paths.claimId || String(row.claimPath || '').endsWith(paths.claimId + '.claim.json'));
    assert.equal(heldChild.status, 'HOLD');
    assert.equal(fs.readFileSync(path.join(paths.foreign, 'sentinel.txt'), 'utf8'), 'foreign');

    if (process.platform === 'win32') fs.rmdirSync(paths.root);
    else fs.unlinkSync(paths.root);
    fs.renameSync(paths.moved, paths.root);
    const recovered = await helper(lease, recoveryCode());
    assert.equal(recovered.code, 0, recovered.stderr);
    const removed = JSON.parse(recovered.stdout).find((row) => row.claimId === paths.claimId);
    assert.equal(removed.status, 'REMOVED', JSON.stringify(removed));
    assert.equal(fs.readFileSync(path.join(paths.foreign, 'sentinel.txt'), 'utf8'), 'foreign');
    fs.unlinkSync(path.join(paths.foreign, 'sentinel.txt'));
    fs.rmdirSync(paths.foreign);
  });
});

test('stale-lock inspection never moves or removes a replacement live lock', async () => {
  await runOwned(spec('stale-lock-replacement'), async (lease) => {
    const base = path.dirname(path.dirname(lease.root));
    const lockPath = path.join(base, 'admission.lock.json');
    const now = Date.now();
    const stale = {
      schema: 'ai-agent-toolkit.owned-temp.v1.lock', token: 'a'.repeat(32),
      pid: 2147483646, start: 'expired-owner', created: now - 60000, expires: now - 1
    };
    const replacement = {
      schema: stale.schema, token: 'b'.repeat(32), pid: process.pid,
      start: 'replacement-owner', created: now, expires: now + 60000
    };
    fs.writeFileSync(lockPath, JSON.stringify(stale), { mode: 0o600 });
    const originalKill = process.kill;
    let injected = false;
    process.kill = function (pid, signal) {
      if (!injected && pid === stale.pid && signal === 0) {
        injected = true;
        fs.unlinkSync(lockPath);
        fs.writeFileSync(lockPath, JSON.stringify(replacement), { mode: 0o600 });
        throw Object.assign(new Error('injected dead stale owner'), { code: 'ESRCH' });
      }
      return originalKill.call(this, pid, signal);
    };
    try {
      await assert.rejects(recoverStaleOwnedTemps(), errorCode('TEMP_CAPACITY_UNKNOWN'));
    } finally {
      process.kill = originalKill;
    }
    assert.equal(injected, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), replacement);
    assert.equal(fs.readdirSync(base).some((name) => name.includes('.stale-')), false);
    fs.unlinkSync(lockPath);
  });
});

test('malformed and contradictory recovery evidence is held without deleting the root', async () => {
  await runOwned(spec('recovery-evidence-hold'), async (lease) => {
    await lease.writeFile('keep.txt', 'preserve');
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    const claimPath = path.join(base, 'claims', row.claimId + '.claim.json');
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    const original = fs.readFileSync(leasePath, 'utf8');
    const malformed = JSON.parse(original);
    malformed.owned_children = [{ phase: 'RUNNING', pid: 'not-a-pid', process_group: false, start_identity: null, token: 'f'.repeat(32) }];
    try {
      fs.writeFileSync(leasePath, JSON.stringify(malformed));
      assert.equal(inspectOwnedTemps().records.find((record) => record.claimPath === claimPath).state, 'HOLD');
      let recovery = await recoverStaleOwnedTemps();
      assert.equal(recovery.find((record) => record.claimPath === claimPath).status, 'HOLD');
      assert.equal(fs.readFileSync(lease.path('keep.txt'), 'utf8'), 'preserve');

      const contradictory = JSON.parse(original);
      contradictory.metadata_cleanup_phase = 'CLAIM_REMOVAL_PENDING';
      fs.writeFileSync(leasePath, JSON.stringify(contradictory));
      assert.equal(inspectOwnedTemps().records.find((record) => record.claimPath === claimPath).state, 'HOLD');
      recovery = await recoverStaleOwnedTemps();
      assert.equal(recovery.find((record) => record.claimPath === claimPath).status, 'HOLD');
      assert.equal(fs.readFileSync(lease.path('keep.txt'), 'utf8'), 'preserve');
    } finally {
      fs.writeFileSync(leasePath, original);
    }
  });
});

test('metadata cleanup retries transient locks and recovers interrupted durable evidence', async () => {
  if (process.platform === 'win32') {
    let transientAttempts = 0;
    const originalUnlink = fs.promises.unlink;
    try {
      await runOwned(spec('metadata-transient-retry'), async (lease) => {
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const markerPath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.marker.json');
        fs.promises.unlink = async function (filePath, ...args) {
          if (path.resolve(String(filePath)) === path.resolve(markerPath)) {
            transientAttempts += 1;
            if (transientAttempts === 1) throw Object.assign(new Error('injected transient metadata lock'), { code: 'EPERM' });
          }
          return originalUnlink.call(this, filePath, ...args);
        };
        await lease.writeFile('file.txt', 'owned');
      });
    } finally {
      fs.promises.unlink = originalUnlink;
    }
    assert.equal(transientAttempts, 2);
  }

  const probeRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-metadata-recovery-')));
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  let safeToRemoveProbeRoot = false;
  try {
    const child = await observeHelperStage(metadataInterruptedCleanupCode(), 'MARKER_REMOVAL_PENDING', {
      env, timeoutMs: 60000
    });
    assert.equal(child.lastProtocolStage, 'MARKER_REMOVAL_PENDING');
    const resultLine = child.output.stdout.split('\n').find((line) => line.startsWith('W2A_RESULT '));
    assert.ok(resultLine, 'helper PID ' + child.pid + ' completed stage '
      + child.lastProtocolStage + ' without its durable evidence result');
    const interrupted = JSON.parse(resultLine.slice('W2A_RESULT '.length));
    assert.equal(interrupted.phase, 'MARKER_REMOVAL_PENDING');
    assert.equal(interrupted.rootExists, false);
    assert.equal(interrupted.markerExists, true);
    assert.equal(interrupted.leaseExists, true);
    assert.equal(interrupted.attempts, process.platform === 'win32' ? 7 : 1);

    const recoveredProcess = await helper(null, recoveryCode(), { env, timeoutMs: 30000 });
    assert.equal(recoveredProcess.code, 0, recoveredProcess.stderr);
    const recovery = JSON.parse(recoveredProcess.stdout);
    const recovered = recovery.find((record) => record.claimId === interrupted.claimId);
    assert.equal(recovered.status, 'REMOVED', JSON.stringify(recovered));
    const base = path.dirname(path.dirname(interrupted.root));
    assert.equal(fs.existsSync(path.join(base, 'claims', interrupted.claimId + '.claim.json')), false);
    assert.equal(fs.existsSync(path.join(base, 'claims', interrupted.claimId + '.lease.json')), false);
    assert.equal(fs.existsSync(path.join(base, 'claims', interrupted.claimId + '.marker.json')), false);
    const inspection = await helper(null, modulePrelude()
      + "\nprocess.stdout.write(JSON.stringify(runtime.inspectOwnedTemps()));", { env, timeoutMs: 30000 });
    assert.equal(inspection.code, 0, inspection.stderr);
    assert.deepEqual(JSON.parse(inspection.stdout), {
      schema: 'ai-agent-toolkit.owned-temp.v1.inspection',
      records: [],
      outstandingReservationsBytes: 0,
      retainedRoots: 0
    });
    safeToRemoveProbeRoot = true;
  } finally {
    if (safeToRemoveProbeRoot) fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('partial namespace initialization removes only proven state and reports preserved residue', async () => {
  for (const preserveResidue of [false, true]) {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-namespace-probe-'));
    const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
    const result = await helper(null, partialNamespaceCode(preserveResidue), { env });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout.trim());
    const namespace = path.join(probeRoot, '.ai-agent-toolkit-owned-temp-v1');
    if (preserveResidue) {
      assert.equal(state.code, 'TEMP_NAMESPACE_PARTIAL');
      assert.equal(state.cleanupStatus.status, 'PRESERVED_RESIDUE');
      assert.equal(state.namespaceExists, true);
      assert.equal(state.residueExists, true);
      assert.equal(fs.readFileSync(state.residuePath, 'utf8'), 'preserve');
      fs.unlinkSync(state.residuePath);
      fs.rmdirSync(path.join(namespace, 'claims'));
      if (fs.existsSync(path.join(namespace, 'namespace.json'))) fs.unlinkSync(path.join(namespace, 'namespace.json'));
      fs.rmdirSync(namespace);
    } else {
      assert.equal(state.code, 'EIO');
      assert.equal(state.namespaceExists, false);
    }
    fs.rmdirSync(probeRoot);
  }
});

test('read-only inspection and admission hold an existing partial namespace without reconstructing it', async () => {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-existing-partial-'));
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  try {
    const initialized = await helper(null, emptyNamespaceCode(), { env });
    assert.equal(initialized.code, 0, initialized.stderr);
    assert.equal(initialized.stdout, 'READY');
    const namespace = path.join(probeRoot, '.ai-agent-toolkit-owned-temp-v1');
    const claims = path.join(namespace, 'claims');
    const roots = path.join(namespace, 'roots');
    assert.deepEqual(fs.readdirSync(claims), []);
    fs.rmdirSync(claims);
    fs.mkdirSync(path.join(roots, 'orphan-root'));
    fs.writeFileSync(path.join(roots, 'orphan-root', 'sentinel.txt'), 'preserve');

    const inspected = await helper(null, inspectPartialNamespaceCode(), { env });
    assert.equal(inspected.code, 0, inspected.stderr);
    const state = JSON.parse(inspected.stdout);
    assert.equal(state.inspectionCode, 'TEMP_NAMESPACE_PARTIAL');
    assert.equal(state.admissionCode, 'TEMP_NAMESPACE_PARTIAL');
    assert.equal(state.callbackReached, false);
    assert.equal(state.claimsExists, false);
    assert.deepEqual(state.roots, ['orphan-root']);
    assert.equal(state.orphan, 'preserve');
  } finally {
    const stats = fs.lstatSync(probeRoot);
    assert.ok(stats.isDirectory() && !stats.isSymbolicLink());
    assert.equal(fs.realpathSync.native(probeRoot), probeRoot);
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

function controlledProfileChildCode(mode) {
  return [
    "const fs=require('node:fs');const path=require('node:path');const childProcess=require('node:child_process');const {ChildProcess}=childProcess;",
    "const originalSpawn=childProcess.spawn,originalEmit=ChildProcess.prototype.emit,originalKill=ChildProcess.prototype.kill,originalProcessKill=process.kill.bind(process),originalReadDir=fs.readdirSync;",
    "const mode=" + JSON.stringify(mode) + ";let allowTermination=mode==='confirmed',targetChild=null,controller=null,root=null,claimId=null,childExit=null,terminalAtRoot=null,childKillCalls=0,groupSignals=0;",
    "childProcess.spawn=function(file,args,options){if(Array.isArray(args)&&path.basename(String(args[0]))==='audit-skill-portability.cjs'){targetChild=originalSpawn.call(childProcess,process.execPath,['-e',\"process.stdout.write('CONTROLLED_CHILD_READY\\\\n');setInterval(()=>{},1000);\"],options);const instanceKill=targetChild.kill.bind(targetChild);targetChild.kill=function(signal){childKillCalls++;if(!allowTermination)return true;return instanceKill(signal);};targetChild.once('close',(code,signal)=>{childExit={code,signal};});return targetChild;}return originalSpawn.call(childProcess,file,args,options);};",
    "const runtime=require(" + JSON.stringify(runtimePath) + ");",
    "const repoRoot=" + JSON.stringify(repoRoot) + ";fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});",
    "ChildProcess.prototype.emit=function(event,...args){const result=originalEmit.call(this,event,...args);if(this===targetChild&&event==='spawn')controller.abort('controlled child termination boundary');return result;};",
    "ChildProcess.prototype.kill=function(signal){if(this===targetChild&&!allowTermination){childKillCalls++;return true;}return originalKill.call(this,signal);};",
    "process.kill=function(pid,signal){if(Number(pid)<0&&signal!==0&&targetChild&&!allowTermination){groupSignals++;return true;}return originalProcessKill(pid,signal);};",
    "fs.readdirSync=function(dir,...args){if(root&&path.resolve(String(dir))===path.resolve(root)&&terminalAtRoot===null)terminalAtRoot=Boolean(childExit&&(Number.isInteger(childExit.code)||typeof childExit.signal==='string'));return originalReadDir.call(this,dir,...args);};",
    "let killRequested=false,killStarted=false;async function killFixture(){if(killStarted||!targetChild)return;killStarted=true;allowTermination=true;if(targetChild.exitCode===null&&targetChild.signalCode===null)originalKill.call(targetChild,'SIGKILL');const exit=childExit||await new Promise(resolve=>targetChild.once('close',(code,signal)=>resolve({code,signal})));process.stdout.write('CHILD_CLOSED '+JSON.stringify(exit)+'\\n');}",
    "if(mode==='unconfirmed'){process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{if(chunk.includes('KILL_CHILD')){killRequested=true;if(root)void killFixture();}});}",
    "async function run(){controller=new AbortController();let errorCode=null;try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot,episode:'controlled-child-'+mode,signal:controller.signal},async lease=>{root=lease.root;claimId=runtime.inspectOwnedTemps().records.find(row=>row.rootPath===root).claimId;await lease.writeFile('fixture.txt','owned');await lease.runProfile('skill-portability');});}catch(error){errorCode=error.code||'UNKNOWN';}",
    "const record=runtime.inspectOwnedTemps().records.find(row=>row.claimId===claimId);const leasePath=path.join(path.dirname(path.dirname(root)),'claims',claimId+'.lease.json');const lease=fs.existsSync(leasePath)?JSON.parse(fs.readFileSync(leasePath,'utf8')):null;",
    "if(mode==='unconfirmed'){process.stdout.write('UNCONFIRMED '+JSON.stringify({errorCode,ownerPid:process.pid,childPid:targetChild&&targetChild.pid,claimId,root,state:record&&record.state,reservationBytes:record&&record.reservationBytes,bytesReserved:record&&record.bytesReserved,ownedChildren:lease&&lease.owned_children.length,rootExists:fs.existsSync(root),childClosed:Boolean(childExit),childAlive:Boolean(targetChild&&targetChild.exitCode===null&&targetChild.signalCode===null),childKillCalls,groupSignals})+'\\n');if(killRequested)void killFixture();return;}",
    "process.stdout.write('CONFIRMED '+JSON.stringify({errorCode,ownerPid:process.pid,childPid:targetChild&&targetChild.pid,childClose:childExit,claimId,root,rootExists:fs.existsSync(root),recordPresent:Boolean(record),terminalAtRoot,childKillCalls})+'\\n');",
    "}",
    "run().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}
test('terminal cleanup distinguishes unconfirmed and confirmed controlled child termination', async () => {
  const baseline = usage();
  const owner = startHelper(controlledProfileChildCode('unconfirmed'), { keepStdinOpen: true });
  try {
    const readyLine = await Promise.race([
      waitUntil(() => owner.output.stdout.split('\n').find((line) => line.startsWith('UNCONFIRMED ')),
        'unconfirmed child state', 60000),
      owner.closed.then((exit) => {
        throw new Error('controlled owner terminated before its state report: '
          + JSON.stringify(exit) + '; stderr=' + owner.output.stderr);
      })
    ]);
    const unconfirmed = JSON.parse(readyLine.slice('UNCONFIRMED '.length));
    assert.equal(unconfirmed.errorCode, 'TEMP_ABORTED', JSON.stringify(unconfirmed));
    assert.equal(unconfirmed.childClosed, false);
    assert.equal(unconfirmed.childAlive, true);
    assert.equal(unconfirmed.rootExists, true);
    assert.ok(unconfirmed.reservationBytes > 0);
    assert.ok(unconfirmed.bytesReserved > 0);
    assert.equal(unconfirmed.ownedChildren, 1);
    assert.ok(unconfirmed.childKillCalls >= 1 || unconfirmed.groupSignals >= 1);
    assert.equal(owner.child.exitCode, null);
    assert.equal(owner.child.signalCode, null);
    assert.doesNotThrow(() => process.kill(owner.child.pid, 0));
    const record = inspectOwnedTemps().records.find((row) => row.claimId === unconfirmed.claimId);
    assert.ok(record, 'unconfirmed claim disappeared before child termination');
    assert.notEqual(record.state, 'REMOVED');
    assert.equal(record.reservationBytes, unconfirmed.reservationBytes);
    assert.equal(record.rootPath, unconfirmed.root);
    assert.doesNotThrow(() => process.kill(unconfirmed.childPid, 0));
    const base = path.dirname(path.dirname(unconfirmed.root));
    const leasePath = path.join(base, 'claims', unconfirmed.claimId + '.lease.json');
    const leaseRecord = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    assert.equal(leaseRecord.owned_children.length, 1);
    leaseRecord.lease_expires_at_ms = Date.now() - 1;
    fs.writeFileSync(leasePath, JSON.stringify(leaseRecord));
    const held = (await recoverStaleOwnedTemps()).find((row) => row.claimId === unconfirmed.claimId);
    assert.equal(held.status, 'HOLD', JSON.stringify(held));
    assert.equal(held.code, 'TEMP_PROCESS_LIVE', JSON.stringify(held));
    assert.equal(fs.existsSync(unconfirmed.root), true);
    const heldRecord = inspectOwnedTemps().records.find((row) => row.claimId === unconfirmed.claimId);
    assert.ok(heldRecord);
    assert.equal(heldRecord.reservationBytes, unconfirmed.reservationBytes);

    owner.child.stdin.write('KILL_CHILD\n');
    const closedLine = await Promise.race([
      waitUntil(() => owner.output.stdout.split('\n').find((line) => line.startsWith('CHILD_CLOSED ')),
        'controlled fixture child close', 15000),
      owner.closed.then((exit) => {
        throw new Error('controlled owner terminated before child-close evidence: '
          + JSON.stringify(exit) + '; stderr=' + owner.output.stderr);
      })
    ]);
    const childExit = JSON.parse(closedLine.slice('CHILD_CLOSED '.length));
    assert.ok(Number.isInteger(childExit.code) || typeof childExit.signal === 'string',
      'controlled fixture child close event did not provide terminal evidence');
    owner.child.stdin.end();
    const ownerExit = await owner.closed;
    assert.equal(ownerExit.code, 0, owner.output.stderr);
    assert.equal(ownerExit.signal, null);

    const recovered = await recoverStaleOwnedTemps();
    const removal = recovered.find((row) => row.claimId === unconfirmed.claimId);
    assert.equal(removal.status, 'REMOVED', JSON.stringify(removal));
    assert.equal(removal.evidence, 'dead');
    assert.equal(fs.existsSync(unconfirmed.root), false);
    assert.deepEqual(usage(), baseline);
  } finally {
    if (owner.child.exitCode === null && owner.child.signalCode === null) {
      owner.child.stdin.write('KILL_CHILD\n');
      owner.child.stdin.end();
      owner.child.kill('SIGKILL');
      await Promise.race([owner.closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  }

  const confirmedProcess = await helper(null, controlledProfileChildCode('confirmed'), { timeoutMs: 30000 });
  assert.equal(confirmedProcess.code, 0, confirmedProcess.stderr);
  const confirmedLine = confirmedProcess.stdout.split('\n').find((line) => line.startsWith('CONFIRMED '));
  assert.ok(confirmedLine, confirmedProcess.stdout);
  const confirmed = JSON.parse(confirmedLine.slice('CONFIRMED '.length));
  assert.ok(confirmed.childClose
    && (Number.isInteger(confirmed.childClose.code) || typeof confirmed.childClose.signal === 'string'),
  'cleanup result lacks positive child close evidence');
  assert.equal(confirmed.errorCode, 'TEMP_ABORTED');
  assert.equal(confirmed.terminalAtRoot, true);
  assert.equal(confirmed.rootExists, false);
  assert.equal(confirmed.recordPresent, false);
  assert.ok(confirmed.childKillCalls >= 1);
  assert.deepEqual(usage(), baseline);
});

test('POSIX group-signal failure settles shutdown as incomplete instead of hanging', { skip: process.platform === 'win32' }, async () => {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-group-signal-'));
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  try {
    const result = await helper(null, groupSignalFailureCode(), { env, timeoutMs: 20000 });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.outcome.code, 'TEMP_ABORTED');
    assert.equal(state.outcome.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(state.finalOutcome.code, 'TEMP_ABORTED');
    assert.equal(state.finalOutcome.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(state.stoppedEarly, true);
    assert.equal(state.childClosed, true);
    assert.ok(state.groupAttempts >= 1);
    assert.ok(state.directAttempts >= 1);
  } finally {
    const stats = fs.lstatSync(probeRoot);
    assert.ok(stats.isDirectory() && !stats.isSymbolicLink());
    assert.equal(fs.realpathSync.native(probeRoot), probeRoot);
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('partial claim creation removes the claim when the initial lease sidecar cannot be written', async () => {
 const baseline=usage(),original=fs.openSync;let injected=false;
 fs.openSync=function(filePath,...args){if(!injected&&String(filePath).includes('.lease.json.next-')){injected=true;throw Object.assign(new Error('synthetic disk full'),{code:'ENOSPC'});}return original.call(this,filePath,...args);};
 try{await assert.rejects(withOwnedTemp(spec('claim-sidecar-failure'),async()=>{}),errorCode('TEMP_OWNERSHIP_UNCERTAIN'));}
 finally{fs.openSync=original;}
 assert.equal(injected,true);
 assert.deepEqual(usage(),baseline);
});
test('abort during capacity admission prevents the callback from starting', async () => {
 const baseline=usage(),original=fs.statfsSync,controller=new AbortController();let callbackReached=false,admissionReached=false;
 fs.statfsSync=()=>{admissionReached=true;controller.abort('abort during admission');return{bavail:16n*1024n*1024n*1024n,bsize:1n};};
 try{await assert.rejects(withOwnedTemp(spec('abort-during-admission',{signal:controller.signal}),async()=>{callbackReached=true;}),errorCode('TEMP_ABORTED'));}
 finally{fs.statfsSync=original;}
 assert.equal(admissionReached,true);
 assert.equal(callbackReached,false);
 assert.deepEqual(usage(),baseline);
});
test('capacity unknown and low space are distinct fail-closed outcomes', async () => {
  const baseline = usage();
  const original = fs.statfsSync;
  try {
    fs.statfsSync = () => { throw Object.assign(new Error('statfs failure'), { code: 'EIO' }); };
    await assert.rejects(withOwnedTemp(spec('capacity-unknown'), async () => {}), errorCode('TEMP_CAPACITY_UNKNOWN'));
  } finally {
    fs.statfsSync = original;
  }
  assert.deepEqual(usage(), baseline);
});

test('expired terminal claims recover only after positive dead-process evidence', async () => {
  const baseline = usage();
  const baselineRecords = inspectOwnedTemps().records;
  await runOwned(spec('recovery-owner'), async (lease) => {
    const stale = await helper(lease, staleChildCode(false));
    assert.equal(stale.code, 0, stale.stderr);
    const deadRecovery = await helper(lease, recoveryCode());
    assert.equal(deadRecovery.code, 0, deadRecovery.stderr);
    const staleRoot = JSON.parse(stale.stdout).root;
    const staleId = path.basename(staleRoot).slice('root-'.length);
    const removed = JSON.parse(deadRecovery.stdout).filter((row) => row.claimId === staleId);
    assert.equal(removed.length, 1);
    assert.equal(removed[0].status, 'REMOVED');
    assert.equal(fs.existsSync(staleRoot), false);

    const child = spawn(process.execPath, ['-e', staleChildCode(true)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const childClosed = new Promise((resolve) => child.once('close', resolve));
    try {
      const ready = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('stale child did not become ready')), 60000);
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('READY')) { clearTimeout(timer); resolve(output); }
        });
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
      });
      assert.match(ready, /READY/);
      const liveRoot = JSON.parse(ready.slice(ready.indexOf('{'))).root;
      const liveStaleId = path.basename(liveRoot).slice('root-'.length);
      const liveRecovery = await helper(lease, recoveryCode());
      assert.equal(liveRecovery.code, 0, liveRecovery.stderr);
      child.kill('SIGKILL');
      await childClosed;
      const afterDeath = await helper(lease, recoveryCode());
      assert.equal(afterDeath.code, 0, afterDeath.stderr);
      const held = JSON.parse(liveRecovery.stdout).filter((row) => row.claimId === liveStaleId);
      assert.equal(held.length, 1);
      assert.ok(['TEMP_PROCESS_LIVE', 'TEMP_PROCESS_UNKNOWN'].includes(held[0].code), JSON.stringify(held));
      const afterDeathRow = JSON.parse(afterDeath.stdout).find((row) => row.claimId === liveStaleId);
      assert.equal(afterDeathRow.status, 'REMOVED', JSON.stringify(afterDeathRow));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await childClosed;
    }
  });
  const after = usage();
  const afterRecords = inspectOwnedTemps().records;
  const describe = (rows) => rows.map((row) => ({
    claimId: row.claimId || null,
    episode: row.episode || null,
    reservationBytes: row.reservationBytes || 0,
    bytesReserved: row.bytesReserved || 0,
    rootPath: row.rootPath || null,
    state: row.state
  }));
  assert.deepEqual(after, baseline, JSON.stringify({
    baseline: describe(baselineRecords),
    after: describe(afterRecords)
  }, null, 2));
});

test('stale recovery holds a root while its recorded child is live', async () => {
 const baseline=usage();
 await runOwned(spec('stale-live-child-owner'),async lease=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','ignore','ignore']});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  const record=inspectOwnedTemps().records.find(row=>row.rootPath===lease.root);
  const base=path.dirname(path.dirname(lease.root));
  const claimPath=path.join(base,'claims',record.claimId+'.claim.json');
  const leasePath=path.join(base,'claims',record.claimId+'.lease.json');
  const markerPath=path.join(base,'claims',record.claimId+'.marker.json');
  const rootMarkerPath=path.join(lease.root,'.ai-agent-toolkit-owned-temp-marker.json');
  const claim=JSON.parse(fs.readFileSync(claimPath,'utf8'));
  const marker=JSON.parse(fs.readFileSync(markerPath,'utf8'));
  const rootMarker=JSON.parse(fs.readFileSync(rootMarkerPath,'utf8'));
  const processRecord={...claim.process};
  const leaseRecord=JSON.parse(fs.readFileSync(leasePath,'utf8'));
  assert.equal(leaseRecord.owned_children.length, 0);
  leaseRecord.owned_children = [{
    phase: 'RUNNING',
    pid: child.pid,
    process_group: false,
    start_identity: null,
    token: crypto.randomBytes(16).toString('hex')
  }];
  const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});
  assert.equal(dead.status,0,dead.stderr);
  const deadPid=Number(dead.stdout);
  assert.throws(()=>process.kill(deadPid,0),errorCode('ESRCH'));
  claim.process={...processRecord,pid:deadPid,start_identity:null};
  marker.process=claim.process;
  marker.root_marker.process=claim.process;
  rootMarker.process=claim.process;
  fs.writeFileSync(claimPath,JSON.stringify(claim));
  fs.writeFileSync(markerPath,JSON.stringify(marker));
  fs.writeFileSync(rootMarkerPath,JSON.stringify(rootMarker));
  leaseRecord.status='TERMINAL';
  leaseRecord.lease_expires_at_ms=Date.now();
  fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));
  const held=await recoverStaleOwnedTemps();
  const result=held.find(row=>row.claimId===record.claimId);
  assert.equal(result.status,'HOLD',JSON.stringify(held));
  assert.equal(result.code,'TEMP_CHILD_UNKNOWN',JSON.stringify(held));
  assert.equal(fs.existsSync(lease.root),true);
  claim.process=processRecord;
  marker.process=processRecord;
  marker.root_marker.process=processRecord;
  rootMarker.process=processRecord;
  fs.writeFileSync(claimPath,JSON.stringify(claim));
  fs.writeFileSync(markerPath,JSON.stringify(marker));
  fs.writeFileSync(rootMarkerPath,JSON.stringify(rootMarker));
  leaseRecord.status='ACTIVE';
  leaseRecord.lease_expires_at_ms=Date.now()+LIMITS.lease;
  fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));
  child.kill('SIGKILL');
  await new Promise(resolve=>child.once('close',resolve));
  leaseRecord.owned_children=[];
  fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));
  assert.deepEqual(JSON.parse(fs.readFileSync(leasePath,'utf8')).owned_children,[]);
 });
 assert.deepEqual(usage(),baseline);
});
test('root identity substitution is held without deleting the replacement path', async () => {
  const baseline = usage();
  await runOwned(spec('identity-swap-owner'), async (lease) => {
    const child = await helper(lease, identitySwapCode());
    assert.equal(child.code, 0, child.stderr);
    const paths = JSON.parse(child.stdout);
    const sentinel = path.join(paths.replacement, 'sentinel');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'replacement');
    const recovery = await helper(lease, recoveryCode());
    assert.equal(recovery.code, 0, recovery.stderr);
    const swappedId = path.basename(paths.root).slice('root-'.length);
    const swapped = JSON.parse(recovery.stdout).find((row) => row.claimId === swappedId);
    assert.equal(swapped.status, 'REMOVED', JSON.stringify(swapped));
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'replacement');
    fs.unlinkSync(sentinel);
    fs.rmdirSync(paths.replacement);
  });
  assert.deepEqual(usage(), baseline);
});

test('retention capacity is committed under one lock', async () => {
 const baseline=usage(),original=fs.statfsSync;
 fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});
 const retention=episode=>spec(episode,{retention:{reason:'retained-capacity race',owner:'toolkit-owned-temp-test',maxBytes:1024,expiresAt:new Date(Date.now()+60000).toISOString()}});
 try{
  await withOwnedTemp(retention('retention-cap-existing'),async lease=>{await lease.writeFile('evidence.txt','one');lease.retain();});
  const results=await Promise.allSettled([
   withOwnedTemp(retention('retention-cap-race-a'),async lease=>{await lease.writeFile('evidence.txt','a');lease.retain();}),
   withOwnedTemp(retention('retention-cap-race-b'),async lease=>{await lease.writeFile('evidence.txt','b');lease.retain();})
  ]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1,JSON.stringify(results));
  assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.code==='TEMP_CAPACITY_LOW').length,1,JSON.stringify(results));
  assert.equal(usage().retainedRoots,baseline.retainedRoots+2);
  const expires=Math.max(...inspectOwnedTemps().records.filter(row=>row.retained).map(row=>row.retentionExpiresAtMs));
  const originalNow=Date.now;let recovered;try{Date.now=()=>expires+1;recovered=await recoverStaleOwnedTemps();}finally{Date.now=originalNow;}
  assert.equal(recovered.filter(row=>row.status==='REMOVED').length,2,JSON.stringify(recovered));
 }finally{fs.statfsSync=original;}
 assert.deepEqual(usage(),baseline);
});
test('retained evidence expires on time even while its creator process remains alive', async () => {
 const baseline=usage();
 const owner=spawn(process.execPath,['-e',retentionChildCode()],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let retained;
 try{
  retained=await new Promise((resolve,reject)=>{
   let output='';
   const timer=setTimeout(()=>reject(new Error('retained owner did not publish its record')),30000);
   owner.stdout.on('data',chunk=>{output+=chunk;const end=output.indexOf('\n');if(end>=0){clearTimeout(timer);try{resolve(JSON.parse(output.slice(0,end)));}catch(error){reject(error);}}});
   owner.once('error',error=>{clearTimeout(timer);reject(error);});
    owner.once('close',(code,signal)=>{if(retained===undefined){clearTimeout(timer);reject(new Error('retained owner exited before publishing its record: '+code+' '+signal+' '+output));}});
   owner.stderr.on('data',chunk=>{output+=chunk;});
  });
  assert.equal(retained.state,'RETAINED');
  assert.equal(retained.retained,true);
  assert.equal(owner.exitCode,null);
  assert.equal(fs.existsSync(retained.rootPath),true);
  const originalNow=Date.now;let rows;try{Date.now=()=>retained.retentionExpiresAtMs+1;rows=await recoverStaleOwnedTemps();}finally{Date.now=originalNow;}
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,'REMOVED',JSON.stringify(rows));
  assert.equal(rows[0].evidence,'retention-expired');
  assert.equal(fs.existsSync(retained.rootPath),false);
  assert.equal(owner.exitCode,null);
 }finally{
  if(owner.exitCode===null){owner.kill();await new Promise(resolve=>owner.once('close',resolve));}
 }
 assert.deepEqual(usage(),baseline);
});
test('Windows file deletion retries only after an observed exclusive-lock failure', { skip: process.platform !== 'win32' }, async () => {
  const { spawn } = require('node:child_process');
  const baseline = usage();
  const originalUnlink = fs.unlinkSync;
  const retryable = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
  const attempts = [];
  let lockedFile;
  let releasePath;
  let releaseRequested = false;
  let locker;
  let lockerOutput = '';
  const lockerClosed = () => locker && locker.closed;
  function requestLockRelease() {
    if (releaseRequested) return;
    releaseRequested = true;
    fs.writeFileSync(releasePath, 'release');
  }
  let lockerCloseResolve;
  const lockerClose = new Promise((resolve) => { lockerCloseResolve = resolve; });
  try {
    fs.unlinkSync = function (filePath, ...args) {
      if (!lockedFile || path.resolve(String(filePath)).toLowerCase() !== path.resolve(lockedFile).toLowerCase()) {
        return originalUnlink.call(this, filePath, ...args);
      }
      try {
        const result = originalUnlink.call(this, filePath, ...args);
        attempts.push({ result: 'REMOVED' });
        return result;
      } catch (caught) {
        attempts.push({ result: 'ERROR', code: caught.code || 'UNKNOWN' });
        if (retryable.has(caught.code)) requestLockRelease();
        throw caught;
      }
    };
    await runOwned(spec('windows-locked-file'), async (lease) => {
      lockedFile = lease.path('locked.txt');
      await lease.writeFile('locked.txt', 'locked');
      releasePath = path.join(os.tmpdir(), 'owned-temp-lock-release-' + crypto.randomBytes(8).toString('hex'));
      const payload = Buffer.from(JSON.stringify({ target: lockedFile, release: releasePath }), 'utf8').toString('base64');
      const ps = "$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "'))|ConvertFrom-Json;"
        + "$f=[IO.File]::Open([string]$d.target,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);"
        + "[Console]::Out.WriteLine('LOCKED');while(-not [IO.File]::Exists([string]$d.release)){Start-Sleep -Milliseconds 10};"
        + "$f.Dispose();[Console]::Out.WriteLine('RELEASED')";
      locker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], {
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
      });
      locker.closed = lockerClose;
      locker.stdout.setEncoding('utf8');
      locker.stderr.setEncoding('utf8');
      locker.stdout.on('data', (chunk) => { lockerOutput += chunk; });
      locker.stderr.on('data', (chunk) => { lockerOutput += chunk; });
      locker.once('close', (code, signal) => lockerCloseResolve({ code, signal }));
      await Promise.race([
        waitUntil(() => lockerOutput.includes('LOCKED'), 'exclusive file lock acquisition', 10000),
        lockerClose.then((exit) => {
          throw new Error('locker exited before acquiring the lock: ' + JSON.stringify(exit) + '; ' + lockerOutput);
        })
      ]);
    });
  } finally {
    fs.unlinkSync = originalUnlink;
    if (locker && locker.exitCode === null && locker.signalCode === null) {
      if (!releaseRequested && releasePath) requestLockRelease();
      const exit = await Promise.race([
        lockerClose,
        new Promise((resolve) => setTimeout(() => resolve(null), 10000))
      ]);
      if (!exit && locker.exitCode === null && locker.signalCode === null) {
        locker.kill('SIGKILL');
        await Promise.race([lockerClose, new Promise((resolve) => setTimeout(resolve, 5000))]);
      }
    }
    if (releasePath && fs.existsSync(releasePath)) fs.unlinkSync(releasePath);
  }
  assert.ok(attempts.length >= 1, 'cleanup never attempted to delete the locked file');
  assert.ok(attempts.some((attempt) => attempt.result === 'REMOVED'), JSON.stringify(attempts));
  const retryableErrors = attempts.filter((attempt) => attempt.result === 'ERROR' && retryable.has(attempt.code));
  if (retryableErrors.length) {
    assert.equal(releaseRequested, true, 'the exclusive lock was not released after the observed retryable error');
    assert.ok(attempts.length >= 2, JSON.stringify(attempts));
    assert.equal(attempts[attempts.length - 1].result, 'REMOVED', JSON.stringify(attempts));
    assert.ok(attempts.length <= 7, 'bounded Windows retry limit exceeded: ' + JSON.stringify(attempts));
    assert.match(lockerOutput, /RELEASED/);
  } else {
    assert.deepEqual(attempts, [{ result: 'REMOVED' }], 'without a retryable error, cleanup should succeed on its first attempt');
  }
  assert.deepEqual(usage(), baseline);
});

test('unknown namespace files and historical OS-temp sentinels are never swept', async () => {
  const baseline = usage();
  const sentinel = path.join(os.tmpdir(), 'owned-temp-namespace-sentinel-' + crypto.randomBytes(8).toString('hex'));
  fs.writeFileSync(sentinel, 'preserve');
  try {
    await runOwned(spec('unknown-namespace-file'), async (lease) => {
      const roots = path.dirname(lease.root);
      const unrelated = path.join(roots, 'root-' + crypto.randomBytes(16).toString('hex') + '-suffix');
      fs.mkdirSync(unrelated);
      fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep');
      await lease.writeFile('owned.txt', 'owned');
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
      assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep');
      fs.rmSync(unrelated, { recursive: true, force: true });
    });
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
  } finally {
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
  }
  assert.deepEqual(usage(), baseline);
});

function startHelper(code, options = {}) {
  const child = spawn(process.execPath, ['-e', code], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(options.env ? { env: options.env } : {})
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (!options.keepStdinOpen) child.stdin.end();
  return { child, output, closed };
}

function waitUntil(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      let value;
      try { value = predicate(); } catch (caught) { reject(caught); return; }
      if (value) { resolve(value); return; }
      if (Date.now() >= deadline) { reject(new Error('Timed out waiting for ' + label)); return; }
      setTimeout(check, 10);
    };
    check();
  });
}

function recoveryLockAttemptCode() {
  return modulePrelude() + [
    "const originalOpen=fs.openSync;let announced=false;",
    "fs.openSync=function(filePath,flags,...args){if(!announced&&path.basename(String(filePath))==='admission.lock.json'&&flags==='wx'){announced=true;process.stdout.write('LOCK_ATTEMPT\\n');}return originalOpen.call(this,filePath,flags,...args);};",
    "runtime.recoverStaleOwnedTemps().then(rows=>process.stdout.write('ROWS '+JSON.stringify(rows)+'\\n')).catch(error=>{process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

function namespaceAfterPublishCode() {
  return modulePrelude() + [
    "const namespace=path.join(os.tmpdir(),'.ai-agent-toolkit-owned-temp-v1');const originalUnlink=fs.unlinkSync;let stagePath=null;",
    "fs.unlinkSync=function(filePath,...args){if(path.dirname(String(filePath))===namespace&&path.basename(String(filePath)).startsWith('namespace.json.stage-')){stagePath=String(filePath);throw Object.assign(new Error('injected post-publication staging cleanup failure'),{code:'EIO'});}return originalUnlink.call(this,filePath,...args);};",
    "runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'namespace-after-publication'} ,async()=>{}).then(()=>{throw new Error('namespace initialization unexpectedly succeeded');},error=>{fs.unlinkSync=originalUnlink;const marker=path.join(namespace,'namespace.json');process.stdout.write(JSON.stringify({code:error.code||null,namespaceExists:fs.existsSync(namespace),markerExists:fs.existsSync(marker),stagePath,stageExists:stagePath?fs.existsSync(stagePath):false,claimsExists:fs.existsSync(path.join(namespace,'claims')),rootsExists:fs.existsSync(path.join(namespace,'roots'))})+'\\n');}).catch(error=>{fs.unlinkSync=originalUnlink;process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

function pausedLiveOwnerCode() {
  return modulePrelude() + [
    "let root,claimId;const keepAlive=setInterval(()=>{},1000);",
    "runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'paused-live-owner-fixture'},async lease=>{root=lease.root;await lease.writeFile('fixture.txt','owned');const row=runtime.inspectOwnedTemps().records.find(record=>record.rootPath===root);claimId=row.claimId;process.stdout.write('PAUSED '+JSON.stringify({root,claimId,ownerPid:process.pid,reservationBytes:row.reservationBytes,bytesReserved:row.bytesReserved})+'\\n');await new Promise(resolve=>process.stdin.once('data',resolve));}).then(()=>process.stdout.write('DONE\\n')).catch(error=>{process.stderr.write(String(error));process.exitCode=1;}).finally(()=>clearInterval(keepAlive));"
  ].join('\n');
}
function cleanupRetrySwapCode() {
  return modulePrelude() + [
    "let root,moved,foreign,claimId,swapped=false;const originalRmdir=fs.rmdirSync;",
    "(async()=>{try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'cleanup-retry-substitution'},async lease=>{",
    "root=lease.root;moved=root+'.retry-original';foreign=path.join(os.tmpdir(),'owned-temp-retry-foreign-'+require('node:crypto').randomBytes(8).toString('hex'));claimId=runtime.inspectOwnedTemps().records.find(row=>row.rootPath===root).claimId;",
    "fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel.txt'),'foreign');await lease.writeFile('owned.txt','owned');",
    "fs.rmdirSync=function(target,...args){if(!swapped&&path.resolve(String(target))===path.resolve(root)){swapped=true;fs.renameSync(root,moved);fs.symlinkSync(foreign,root,process.platform==='win32'?'junction':'dir');throw Object.assign(new Error('injected retryable root removal failure'),{code:'EBUSY'});}return originalRmdir.call(this,target,...args);};",
    "});throw new Error('cleanup unexpectedly accepted a root substitution');",
    "}catch(error){fs.rmdirSync=originalRmdir;if(error.code!=='TEMP_CLEANUP_INCOMPLETE')throw error;if(fs.existsSync(root)){const stats=fs.lstatSync(root);if(stats.isSymbolicLink()){if(process.platform==='win32'&&stats.isDirectory())fs.rmdirSync(root);else fs.unlinkSync(root);}}fs.renameSync(moved,root);process.stdout.write(JSON.stringify({code:error.code,root,moved,foreign,claimId,swapped})+'\\n');}})().catch(error=>{fs.rmdirSync=originalRmdir;process.stderr.write(String(error));process.exitCode=1;});"
  ].join('\n');
}

test('same-claim write, append, unlink, and copy calls wait behind the active copy owner', async () => {
  const sourceA = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-serial-a-'));
  const sourceB = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-serial-b-'));
  const fileA = path.join(sourceA, 'asset.txt');
  const fileB = path.join(sourceB, 'second.txt');
  fs.writeFileSync(fileA, 'copy-a');
  fs.writeFileSync(fileB, 'copy-b');
  const originalOpen = fs.promises.open;
  let enteredResolve;
  let releaseResolve;
  let finalEnteredResolve;
  let releaseFinalResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { releaseResolve = resolve; });
  const finalEntered = new Promise((resolve) => { finalEnteredResolve = resolve; });
  const finalGate = new Promise((resolve) => { releaseFinalResolve = resolve; });
  let paused = false;
  let finalPaused = false;
  let finalWindowWrite;
  try {
    await runOwned(spec('same-claim-mutation-serialization'), async (lease) => {
      await lease.writeFile('append-target.txt', 'A');
      await lease.writeFile('delete-target.txt', 'D');
      fs.promises.open = async function (filePath, ...args) {
        if (!paused && path.resolve(String(filePath)) === path.resolve(fileA)) {
          paused = true;
          enteredResolve();
          await gate;
        }
        if (!finalPaused && path.resolve(String(filePath)) === path.resolve(lease.path('asset.txt'))) {
          finalPaused = true;
          finalWindowWrite = lease.writeFile('final-window.txt', 'F');
          finalEnteredResolve();
          await finalGate;
        }
        return originalOpen.call(this, filePath, ...args);
      };
      const activeCopy = lease.copyTree(sourceA);
      await entered;
      const queuedWrite = lease.writeFile('queued.txt', 'W');
      const queuedAppend = lease.appendFile('append-target.txt', 'B');
      const queuedUnlink = lease.unlink('delete-target.txt');
      const queuedCopy = lease.copyTree(sourceB);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fs.existsSync(lease.path('queued.txt')), false);
      assert.equal(fs.readFileSync(lease.path('append-target.txt'), 'utf8'), 'A');
      assert.equal(fs.existsSync(lease.path('delete-target.txt')), true);
      assert.equal(fs.existsSync(lease.path('asset.txt')), false);
      assert.equal(fs.existsSync(lease.path('final-window.txt')), false);
      releaseResolve();
      await finalEntered;
      assert.equal(fs.existsSync(lease.path('asset.txt')), false);
      assert.equal(fs.existsSync(lease.path('final-window.txt')), false);
      releaseFinalResolve();
      await Promise.all([activeCopy, queuedWrite, queuedAppend, queuedUnlink, queuedCopy, finalWindowWrite]);
      assert.equal(fs.readFileSync(lease.path('queued.txt'), 'utf8'), 'W');
      assert.equal(fs.readFileSync(lease.path('append-target.txt'), 'utf8'), 'AB');
      assert.equal(fs.existsSync(lease.path('delete-target.txt')), false);
      assert.equal(fs.readFileSync(lease.path('asset.txt'), 'utf8'), 'copy-a');
      assert.equal(fs.readFileSync(lease.path('second.txt'), 'utf8'), 'copy-b');
      assert.equal(fs.readFileSync(lease.path('final-window.txt'), 'utf8'), 'F');
    });
  } finally {
    releaseResolve();
    releaseFinalResolve();
    fs.promises.open = originalOpen;
    fs.unlinkSync(fileA);
    fs.unlinkSync(fileB);
    fs.rmdirSync(sourceA);
    fs.rmdirSync(sourceB);
  }
});
test('recovery holds a controlled expired live owner, then removes it after confirmed death', async () => {
  const probeRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-paused-owner-')));
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  let owner;
  let ready;
  let safeToRemoveProbeRoot = false;
  const inspectionCode = modulePrelude() + "\nprocess.stdout.write(JSON.stringify(runtime.inspectOwnedTemps()));";
  try {
    assert.deepEqual(fs.readdirSync(probeRoot), []);
    const before = await helper(null, inspectionCode, { env, timeoutMs: 30000 });
    assert.equal(before.code, 0, before.stderr);
    assert.deepEqual(JSON.parse(before.stdout).records, []);

    owner = startHelper(pausedLiveOwnerCode(), { env, keepStdinOpen: true });
    const readyLine = await Promise.race([
      waitUntil(() => owner.output.stdout.split('\n').find((line) => line.startsWith('PAUSED ')),
        'controlled live-owner pause', 60000),
      owner.closed.then((exit) => {
        throw new Error('live owner terminated before PAUSED: ' + JSON.stringify(exit)
          + '; stderr=' + owner.output.stderr);
      })
    ]);
    ready = JSON.parse(readyLine.slice('PAUSED '.length));
    assert.equal(ready.ownerPid, owner.child.pid);
    assert.equal(owner.child.exitCode, null);
    assert.equal(owner.child.signalCode, null);
    assert.doesNotThrow(() => process.kill(ready.ownerPid, 0));

    const base = path.dirname(path.dirname(ready.root));
    const leasePath = path.join(base, 'claims', ready.claimId + '.lease.json');
    const claimPath = path.join(base, 'claims', ready.claimId + '.claim.json');
    const markerPath = path.join(base, 'claims', ready.claimId + '.marker.json');
    const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    assert.equal(lease.status, 'ACTIVE');
    assert.ok(ready.reservationBytes > 0);
    assert.ok(ready.bytesReserved > 0);
    assert.equal(lease.reservation_bytes, ready.reservationBytes);
    lease.lease_expires_at_ms = Date.now() - 1;
    fs.writeFileSync(leasePath, JSON.stringify(lease));

    const heldProcess = await helper(null, recoveryCode(), { env, timeoutMs: 30000 });
    assert.equal(heldProcess.code, 0, heldProcess.stderr);
    const heldRows = JSON.parse(heldProcess.stdout);
    const held = heldRows.find((row) => row.claimId === ready.claimId);
    assert.equal(held.status, 'HOLD', JSON.stringify(held));
    assert.equal(held.code, 'TEMP_PROCESS_LIVE', JSON.stringify(held));
    assert.equal(owner.child.exitCode, null);
    assert.equal(owner.child.signalCode, null);
    assert.equal(fs.existsSync(ready.root), true);
    assert.equal(fs.existsSync(claimPath), true);
    assert.equal(fs.existsSync(markerPath), true);
    assert.equal(fs.existsSync(leasePath), true);
    const heldInspection = await helper(null, inspectionCode, { env, timeoutMs: 30000 });
    assert.equal(heldInspection.code, 0, heldInspection.stderr);
    const heldState = JSON.parse(heldInspection.stdout);
    const heldRecord = heldState.records.find((row) => row.claimId === ready.claimId);
    assert.ok(heldRecord);
    assert.equal(heldRecord.reservationBytes, ready.reservationBytes);
    assert.ok(heldState.outstandingReservationsBytes >= ready.reservationBytes);

    owner.child.kill('SIGKILL');
    const ownerExit = await owner.closed;
    assert.ok(Number.isInteger(ownerExit.code) || typeof ownerExit.signal === 'string',
      'owner close event did not provide positive terminal evidence');
    assert.equal(owner.child.exitCode !== null || owner.child.signalCode !== null, true);

    const recoveredProcess = await helper(null, recoveryCode(), { env, timeoutMs: 30000 });
    assert.equal(recoveredProcess.code, 0, recoveredProcess.stderr);
    const recoveredRows = JSON.parse(recoveredProcess.stdout);
    const removals = recoveredRows.filter((row) => row.claimId === ready.claimId);
    assert.equal(removals.length, 1, JSON.stringify(recoveredRows));
    assert.equal(removals[0].status, 'REMOVED', JSON.stringify(removals[0]));
    assert.equal(removals[0].evidence, 'dead', JSON.stringify(removals[0]));
    assert.equal(fs.existsSync(ready.root), false);
    assert.equal(fs.existsSync(claimPath), false);
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(fs.existsSync(leasePath), false);
    const after = await helper(null, inspectionCode, { env, timeoutMs: 30000 });
    assert.equal(after.code, 0, after.stderr);
    assert.deepEqual(JSON.parse(after.stdout), {
      schema: 'ai-agent-toolkit.owned-temp.v1.inspection',
      records: [],
      outstandingReservationsBytes: 0,
      retainedRoots: 0
    });
    safeToRemoveProbeRoot = true;
  } finally {
    if (owner && owner.child.exitCode === null && owner.child.signalCode === null) {
      owner.child.kill('SIGKILL');
      await Promise.race([owner.closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    if (safeToRemoveProbeRoot) fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});


test('competing recovery processes retire a stale claim only once', async () => {
  await runOwned(spec('competing-recovery-actors'), async (lease) => {
    const stale = await helper(lease, staleChildCode(false));
    assert.equal(stale.code, 0, stale.stderr);
    const staleRoot = JSON.parse(stale.stdout).root;
    const staleId = path.basename(staleRoot).slice('root-'.length);
    const first = startHelper(recoveryCode());
    const second = startHelper(recoveryCode());
    const [firstExit, secondExit] = await Promise.all([first.closed, second.closed]);
    assert.equal(firstExit.code, 0, first.output.stderr);
    assert.equal(secondExit.code, 0, second.output.stderr);
    const rows = [...JSON.parse(first.output.stdout), ...JSON.parse(second.output.stdout)]
      .filter((row) => row.claimId === staleId);
    assert.equal(rows.filter((row) => row.status === 'REMOVED').length, 1, JSON.stringify(rows));
    assert.equal(fs.existsSync(staleRoot), false);
  });
});

test('creator cleanup holds namespace ownership through the claim-absent lease-present interval', async () => {
  const originalUnlink = fs.promises.unlink;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { releaseResolve = resolve; });
  let claimPath;
  let leasePath;
  let paused = false;
  const episode = runOwned(spec('creator-recovery-retirement-lock'), async (lease) => {
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    claimPath = path.join(base, 'claims', row.claimId + '.claim.json');
    leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    fs.promises.unlink = async function (filePath, ...args) {
      const result = await originalUnlink.call(this, filePath, ...args);
      if (!paused && path.resolve(String(filePath)) === path.resolve(claimPath)) {
        paused = true;
        enteredResolve();
        await gate;
      }
      return result;
    };
  });
  let recovery;
  try {
    await entered;
    assert.equal(fs.existsSync(claimPath), false);
    assert.equal(fs.existsSync(leasePath), true);
    recovery = startHelper(recoveryLockAttemptCode());
    await waitUntil(() => recovery.output.stdout.includes('LOCK_ATTEMPT'), 'recovery lock attempt');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fs.existsSync(leasePath), true);
    assert.equal(recovery.output.stdout.includes('ROWS '), false);
    releaseResolve();
    await episode;
    const closed = await recovery.closed;
    assert.equal(closed.code, 0, recovery.output.stderr);
    const rows = recovery.output.stdout.split('\n').find((line) => line.startsWith('ROWS '));
    assert.ok(rows);
    const result = JSON.parse(rows.slice('ROWS '.length)).find((row) => path.resolve(String(row.claimPath || '')) === path.resolve(claimPath));
    assert.equal(result, undefined);
    assert.equal(fs.existsSync(leasePath), false);
  } finally {
    releaseResolve();
    fs.promises.unlink = originalUnlink;
    if (recovery && recovery.child.exitCode === null) {
      recovery.child.kill();
      await recovery.closed;
    }
    await episode;
  }
});

test('a profile operation stays admitted until paused broker filesystem I/O settles after child timeout', async () => {
  const originalLstat = fs.promises.lstat;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { releaseResolve = resolve; });
  let paused = false;
  let destination;
  let profileDeadline;
  let profileDeadlineHandle;
  try {
    await assert.rejects(runOwned(spec('broker-settlement-barrier', { purpose: 'source-update', budgetBytes: 1024 * 1024 }), async (lease) => {
      await lease.mkdir('workspace/repo/source-watch/reviews');
      await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
      destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
      fs.promises.lstat = async function (filePath, ...args) {
        if (!paused && path.resolve(String(filePath)) === path.resolve(destination)) {
          paused = true;
          enteredResolve();
          await gate;
        }
        return originalLstat.call(this, filePath, ...args);
      };
      global.setTimeout = function (callback, milliseconds, ...args) {
        const handle = originalSetTimeout(callback, milliseconds, ...args);
        if (!profileDeadline && milliseconds >= 10000) {
          profileDeadline = callback;
          profileDeadlineHandle = handle;
        }
        return handle;
      };
      let settled = false;
      const profile = lease.runProfile('source-update').then(
        () => { settled = true; return { code: 'OK' }; },
        (caught) => { settled = true; return { code: caught.code || 'UNKNOWN' }; }
      );
      const boundary = await Promise.race([
        entered.then(() => 'entered'),
        profile,
        new Promise((resolve) => originalSetTimeout(() => resolve('barrier-watchdog'), 30000))
      ]);
      assert.equal(boundary, 'entered', 'the child must reach the parent filesystem gate before timeout injection');
      assert.equal(typeof profileDeadline, 'function', 'the total profile deadline should be armed');
      profileDeadline();
      originalClearTimeout(profileDeadlineHandle);
      const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
      const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
      await waitUntil(() => JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children.length === 0, 'timed-out profile child close', 30000);
      await new Promise((resolve) => originalSetTimeout(resolve, 50));
      assert.equal(settled, false);
      releaseResolve();
      const result = await profile;
      assert.equal(result.code, 'TEMP_CHILD_TIMEOUT');
    }), errorCode('TEMP_CHILD_TIMEOUT'));
  } finally {
    releaseResolve();
    fs.promises.lstat = originalLstat;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('shutdown supersedes retention and waits for an admitted copy before cleanup', async () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-shutdown-copy-'));
  fs.writeFileSync(path.join(sourceRoot, 'asset.txt'), 'shutdown');
  const originalStatfs = fs.statfsSync;
  const originalOpen = fs.promises.open;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { releaseResolve = resolve; });
  let paused = false;
  const observedOpenPaths = [];
  fs.statfsSync = () => ({ bavail: 16n * 1024n * 1024n * 1024n, bsize: 1n });
  try {
    const episode = withOwnedTemp(spec('shutdown-retention-barrier', {
      retention: {
        reason: 'shutdown race evidence', owner: 'toolkit-owned-temp-test', maxBytes: 1024,
        expiresAt: new Date(Date.now() + 60000).toISOString()
      }
    }), async (lease) => {
      fs.promises.open = async function (filePath, ...args) {
        observedOpenPaths.push(String(filePath));
        if (!paused && path.resolve(String(filePath)) === path.resolve(path.join(sourceRoot, 'asset.txt'))) {
          paused = true;
          enteredResolve();
          await gate;
        }
        return originalOpen.call(this, filePath, ...args);
      };
      const copy = lease.copyTree(sourceRoot);
      try {
        let enteredTimeout;
        await Promise.race([entered, new Promise((resolve) => { enteredTimeout = setTimeout(resolve, 10000); })]);
        clearTimeout(enteredTimeout);
        assert.equal(paused, true, 'copy source open hook was not reached; observed paths: ' + JSON.stringify(observedOpenPaths));
        lease.retain();
        let shutdownSettled = false;
        const shutdown = shutdownOwnedTemps('shutdown during retained copy').then((rows) => {
          shutdownSettled = true;
          return rows;
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(shutdownSettled, false);
        releaseResolve();
        await assert.rejects(copy, errorCode('TEMP_LEASE_CLOSED'));
        const rows = await shutdown;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, 'REMOVED', JSON.stringify(rows));
      } finally {
        releaseResolve();
      }
    });
    await assert.rejects(episode, errorCode('TEMP_ABORTED'));
    assert.equal(usage().retainedRoots, 0);
  } finally {
    releaseResolve();
    fs.promises.open = originalOpen;
    fs.statfsSync = originalStatfs;
    fs.unlinkSync(path.join(sourceRoot, 'asset.txt'));
    fs.rmdirSync(sourceRoot);
  }
});

test('namespace failure after publication preserves shared directories and the published marker', async () => {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-after-publish-'));
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  try {
    const initialized = await helper(null, namespaceAfterPublishCode(), { env });
    assert.equal(initialized.code, 0, initialized.stderr);
    const state = JSON.parse(initialized.stdout.trim());
    const namespace = path.join(probeRoot, '.ai-agent-toolkit-owned-temp-v1');
    assert.equal(state.code, 'TEMP_NAMESPACE_PARTIAL');
    assert.equal(state.namespaceExists, true);
    assert.equal(state.markerExists, true);
    assert.equal(state.stageExists, true);
    assert.equal(state.claimsExists, true);
    assert.equal(state.rootsExists, true);
    const markerId = fs.statSync(path.join(namespace, 'namespace.json'));
    const stageId = fs.statSync(state.stagePath);
    assert.equal(String(markerId.dev), String(stageId.dev));
    assert.equal(String(markerId.ino), String(stageId.ino));
    const adopted = await helper(null, emptyNamespaceCode(), { env });
    assert.equal(adopted.code, 0, adopted.stderr);
    assert.equal(adopted.stdout, 'READY');
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('cleanup revalidates root identity before a retry and preserves a foreign sentinel', async () => {
  await runOwned(spec('cleanup-retry-substitution-parent'), async (lease) => {
    const result = await helper(lease, cleanupRetrySwapCode());
    assert.equal(result.code, 0, result.stderr);
    const paths = JSON.parse(result.stdout.trim());
    assert.equal(paths.code, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(paths.swapped, true);
    assert.equal(fs.readFileSync(path.join(paths.foreign, 'sentinel.txt'), 'utf8'), 'foreign');
    const recovery = await helper(lease, recoveryCode());
    assert.equal(recovery.code, 0, recovery.stderr);
    const removed = JSON.parse(recovery.stdout).find((row) => row.claimId === paths.claimId);
    assert.equal(removed.status, 'REMOVED', JSON.stringify(removed));
    assert.equal(fs.readFileSync(path.join(paths.foreign, 'sentinel.txt'), 'utf8'), 'foreign');
    fs.unlinkSync(path.join(paths.foreign, 'sentinel.txt'));
    fs.rmdirSync(paths.foreign);
  });
});

test('raw same-user paths are unaccounted and hostile-same-user atomic protection is not claimed', async () => {
  assert.match(
    schema.properties.budgetBytes.description,
    /does not claim atomic pathname protection from a hostile same-user process/
  );
  await runOwned(spec('raw-path-boundary-label'), async (lease) => {
    await lease.writeFile('accounted.txt', 'A');
    fs.writeFileSync(path.join(lease.root, 'raw-probe.txt'), 'unaccounted');
    const record = inspectOwnedTemps().records.find((row) => row.rootPath === lease.root);
    assert.equal(record.bytesReserved, 1);
    assert.equal(fs.readFileSync(path.join(lease.root, 'raw-probe.txt'), 'utf8'), 'unaccounted');
  });
});
