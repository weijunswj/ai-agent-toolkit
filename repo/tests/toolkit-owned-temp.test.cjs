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

function findDurableRecord(records, claimId, claimPath) {
  return records.find((record) => record.claimId === claimId || record.claimPath === claimPath);
}

async function copyPortabilityRepo(lease) {
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

async function assertClean(promise) {
  await promise;
  assert.deepEqual(usage(), { records: 0, outstandingReservationsBytes: 0, retainedRoots: 0 });
}

function errorCode(code) {
  return (error) => error && error.code === code;
}

function makeProbeRoot(prefix) {
  const physicalTemp = fs.realpathSync.native(os.tmpdir());
  return fs.realpathSync.native(fs.mkdtempSync(path.join(physicalTemp, prefix)));
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

test('canonical AJV 2020 options reject lossy records and validator loss fails closed', async () => {
  const missingValidator = [
    "const Module=require('node:module');",
    'const load=Module._load;',
    "Module._load=function(request,parent,isMain){if(request==='ajv/dist/2020'){const caught=new Error('validator unavailable');caught.code='MODULE_NOT_FOUND';throw caught;}return load.call(this,request,parent,isMain);};",
    'try{require(' + JSON.stringify(runtimePath) + ');process.stdout.write(\'LOADED\');}',
    "catch(caught){process.stdout.write(caught.code||'UNKNOWN');}"
  ].join('\n');
  const unavailable = await helper(null, missingValidator);
  assert.equal(unavailable.code, 0, unavailable.stderr);
  assert.equal(unavailable.stdout, 'TEMP_SCHEMA_INVALID');

  const source = fs.readFileSync(runtimePath, 'utf8');
  for (const option of [
    'strict: true',
    'strictTypes: false',
    'coerceTypes: false',
    'useDefaults: false',
    'removeAdditional: false'
  ]) assert.ok(source.includes(option), 'missing canonical AJV option ' + option);
  assert.equal(source.includes('strict: false'), false, 'global AJV strict mode must remain enabled');

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const invalidDateTime = expiresAt.replace('T', ' ');
  await assert.rejects(withOwnedTemp(spec('f1-invalid-date-time', {
    retention: { reason: 'invalid date-time control', owner: 'toolkit-owned-temp-test', maxBytes: 32, expiresAt: invalidDateTime }
  }), async () => assert.fail('invalid retention date-time reached callback')), errorCode('TEMP_SPEC_INVALID'));
});

test('cached namespace marker rereads fail closed across inspection, recovery, and admission', async () => {
  const probeRoot = makeProbeRoot('owned-temp-f1-cached-namespace-');
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  const code = [
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const runtime=require(" + JSON.stringify(runtimePath) + ");",
    "const repoRoot=" + JSON.stringify(repoRoot) + ';',
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1-cached-namespace'};",
    "async function main(){await runtime.withOwnedTemp(spec,async()=>{});const markerPath=path.join(process.env.TEMP,'.ai-agent-toolkit-owned-temp-v1','namespace.json');const original=fs.readFileSync(markerPath,'utf8');const malformed=JSON.parse(original);malformed.evidenceDisposition='hold';fs.writeFileSync(markerPath,JSON.stringify(malformed));let inspectCode=null,recoveryCode=null,admissionCode=null,callbackReached=false;try{runtime.inspectOwnedTemps();}catch(error){inspectCode=error.code;}try{await runtime.recoverStaleOwnedTemps();}catch(error){recoveryCode=error.code;}try{await runtime.withOwnedTemp({...spec,episode:'f1-cached-namespace-admission'},async()=>{callbackReached=true;});}catch(error){admissionCode=error.code;}fs.writeFileSync(markerPath,original);const recovered=await runtime.recoverStaleOwnedTemps();const inspected=runtime.inspectOwnedTemps();process.stdout.write(JSON.stringify({inspectCode,recoveryCode,admissionCode,callbackReached,recoveredCount:recovered.length,recordCount:inspected.records.length}));}",
    "main().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
  ].join('\n');
  try {
    const result = await helper(null, code, { env });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.inspectCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.recoveryCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.admissionCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.callbackReached, false);
    assert.equal(state.recoveredCount, 0);
    assert.equal(state.recordCount, 0);
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('active namespace marker tampering blocks lease writes and terminal cleanup', async () => {
  const probeRoot = makeProbeRoot('owned-temp-f1-active-namespace-');
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  const code = [
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const runtime=require(" + JSON.stringify(runtimePath) + ");",
    "const repoRoot=" + JSON.stringify(repoRoot) + ';',
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1-active-namespace'};",
    "async function main(){let root=null,claimId=null,markerPath=null,original=null,writeCode=null,outerCode=null,cleanupStatus=null;try{await runtime.withOwnedTemp(spec,async lease=>{root=lease.root;const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===root);claimId=row.claimId;markerPath=path.join(process.env.TEMP,'.ai-agent-toolkit-owned-temp-v1','namespace.json');original=fs.readFileSync(markerPath,'utf8');const malformed=JSON.parse(original);malformed.evidenceDisposition='hold';fs.writeFileSync(markerPath,JSON.stringify(malformed));try{await lease.writeFile('must-not-exist.txt','blocked');}catch(error){writeCode=error.code;}});}catch(error){outerCode=error.code;cleanupStatus=error.cleanupStatus||null;}if(original)fs.writeFileSync(markerPath,original);const leasePath=path.join(process.env.TEMP,'.ai-agent-toolkit-owned-temp-v1','claims',claimId+'.lease.json');if(fs.existsSync(leasePath)){const leaseRecord=JSON.parse(fs.readFileSync(leasePath,'utf8'));leaseRecord.lease_expires_at_ms=Date.now()-1;fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));}process.stdout.write(JSON.stringify({root,claimId,writeCode,outerCode,cleanupStatus,rootExists:fs.existsSync(root),fileExists:fs.existsSync(path.join(root,'must-not-exist.txt'))}));}",
    "main().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
  ].join('\n');
  try {
    const created = await helper(null, code, { env });
    assert.equal(created.code, 0, created.stderr);
    const state = JSON.parse(created.stdout);
    assert.equal(state.writeCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.outerCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.ok(state.cleanupStatus);
    assert.equal(state.rootExists, true);
    assert.equal(state.fileExists, false);
    const recovered = await helper(null, recoveryCode(), { env, timeoutMs: 60000 });
    assert.equal(recovered.code, 0, recovered.stderr);
    const rows = JSON.parse(recovered.stdout);
    assert.equal(rows.find((row) => row.claimId === state.claimId).status, 'REMOVED');
    assert.equal(fs.existsSync(state.root), false);
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('public durable inventory, recovery, and admission hold unknown evidenceDisposition fields', async () => {
  const baseline = usage();
  await runOwned(spec('f1-unknown-durable-field'), async (lease) => {
    await lease.writeFile('keep.txt', 'preserve');
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    const claimPath = path.join(base, 'claims', row.claimId + '.claim.json');
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    const original = fs.readFileSync(leasePath, 'utf8');
    const malformed = JSON.parse(original);
    malformed.evidenceDisposition = 'hold';
    try {
      fs.writeFileSync(leasePath, JSON.stringify(malformed));
      const inspected = findDurableRecord(inspectOwnedTemps().records, row.claimId, claimPath);
      assert.equal(inspected.state, 'HOLD');
      assert.equal(inspected.code, 'TEMP_OWNERSHIP_UNCERTAIN');
      const recovered = await recoverStaleOwnedTemps();
      const heldRecovery = findDurableRecord(recovered, row.claimId, claimPath);
      assert.equal(heldRecovery.status, 'HOLD');
      assert.equal(heldRecovery.code, 'TEMP_OWNERSHIP_UNCERTAIN');
      assert.equal(fs.readFileSync(lease.path('keep.txt'), 'utf8'), 'preserve');
      assert.equal(fs.existsSync(lease.root), true);

      let callbackReached = false;
      await assert.rejects(withOwnedTemp(spec('f1-unknown-field-admission'), async () => {
        callbackReached = true;
      }), errorCode('TEMP_CAPACITY_UNKNOWN'));
      assert.equal(callbackReached, false);
    } finally {
      fs.writeFileSync(leasePath, original);
    }
  });
  assert.deepEqual(usage(), baseline);
});

test('retention schema and cross-record bounds hold malformed snapshots and recover valid expiry', async () => {
  const baseline = usage();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  await runOwned(spec('f1-retention-record', {
    retention: { reason: 'F1 public recovery evidence', owner: 'toolkit-owned-temp-test', maxBytes: 32, expiresAt }
  }), async (lease) => {
    await lease.writeFile('evidence.txt', 'retained evidence');
    lease.retain();
  });

  const row = inspectOwnedTemps().records.find((record) => record.episode === 'f1-retention-record');
  assert.ok(row && row.retained);
  const base = path.dirname(path.dirname(row.rootPath));
  const claimPath = path.join(base, 'claims', row.claimId + '.claim.json');
  const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
  const originalClaim = fs.readFileSync(claimPath, 'utf8');
  const original = fs.readFileSync(leasePath, 'utf8');
  const originalLease = JSON.parse(original);
  const variants = [
    ['retention byte type', (lease) => { lease.retention.bytes = '1'; }],
    ['retention byte bounds', (lease) => { lease.retention.bytes = lease.retention.max_bytes + 1; }],
    ['retention maximum bounds', (lease) => { lease.retention.max_bytes = LIMITS.retainedBytes + 1; }],
    ['retention lifecycle state', (lease) => { lease.status = 'ACTIVE'; }]
  ];

  try {
    for (const [label, mutate] of variants) {
      const malformed = JSON.parse(original);
      mutate(malformed);
      fs.writeFileSync(leasePath, JSON.stringify(malformed));
      const inspected = findDurableRecord(inspectOwnedTemps().records, row.claimId, claimPath);
      assert.equal(inspected.state, 'HOLD', label);
      assert.equal(inspected.code, 'TEMP_OWNERSHIP_UNCERTAIN', label);
      const recovered = await recoverStaleOwnedTemps();
      const heldRecovery = findDurableRecord(recovered, row.claimId, claimPath);
      assert.equal(heldRecovery.status, 'HOLD', label);
      assert.equal(heldRecovery.code, 'TEMP_OWNERSHIP_UNCERTAIN', label);
      assert.equal(fs.existsSync(row.rootPath), true, label);
      assert.equal(fs.readFileSync(path.join(row.rootPath, 'evidence.txt'), 'utf8'), 'retained evidence', label);
      fs.writeFileSync(leasePath, original);
    }

    const claim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
    claim.namespace_id = '0'.repeat(32);
    fs.writeFileSync(claimPath, JSON.stringify(claim));
    assert.equal(findDurableRecord(inspectOwnedTemps().records, row.claimId, claimPath).state, 'HOLD');
    assert.equal(findDurableRecord(await recoverStaleOwnedTemps(), row.claimId, claimPath).status, 'HOLD');
    assert.equal(fs.existsSync(row.rootPath), true);
  } finally {
    fs.writeFileSync(leasePath, original);
    fs.writeFileSync(claimPath, originalClaim);
    const retainedExpiry = originalLease.retention.expires_at_ms;
    const originalNow = Date.now;
    try {
      Date.now = () => retainedExpiry + 1;
      await recoverStaleOwnedTemps();
    } finally {
      Date.now = originalNow;
    }
  }
  assert.equal(inspectOwnedTemps().records.some((record) => record.claimId === row.claimId), false);
  assert.deepEqual(usage(), baseline);
});

test('stale recovery validates a lease malformed after its valid first read', async () => {
  const probeRoot = makeProbeRoot('owned-temp-f1-reread-');
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  let root;
  let leasePath;
  let originalLease;
  try {
    const created = await helper(null, staleChildCode(false), { env });
    assert.equal(created.code, 0, created.stderr);
    root = JSON.parse(created.stdout.trim()).root;
    const claimId = path.basename(root).slice('root-'.length);
    const base = path.dirname(path.dirname(root));
    const claimPath = path.join(base, 'claims', claimId + '.claim.json');
    leasePath = path.join(base, 'claims', claimId + '.lease.json');
    originalLease = fs.readFileSync(leasePath, 'utf8');
    const malformedLease = JSON.stringify({ ...JSON.parse(originalLease), after_first_read: true });
    const recoveryWithMalformedReread = modulePrelude() + [
      'const target=path.resolve(' + JSON.stringify(leasePath) + ');',
      'const originalOpen=fs.openSync,originalRead=fs.readSync,originalWrite=fs.writeSync,originalFtruncate=fs.ftruncateSync,originalClose=fs.closeSync;',
      'const targetFds=new Set();let mutated=false;',
      'fs.openSync=function(filePath,...args){const fd=originalOpen.call(this,filePath,...args);if(path.resolve(String(filePath))===target)targetFds.add(fd);return fd;};',
      'fs.readSync=function(fd,...args){const count=originalRead.call(this,fd,...args);if(!mutated&&targetFds.has(fd)){mutated=true;const bytes=Buffer.from(' + JSON.stringify(malformedLease) + ');const writer=originalOpen.call(fs,target,fs.constants.O_WRONLY|fs.constants.O_TRUNC);try{originalWrite.call(fs,writer,bytes,0,bytes.length,0);originalFtruncate.call(fs,writer,bytes.length);}finally{originalClose.call(fs,writer);}}return count;};',
      'runtime.recoverStaleOwnedTemps().then(rows=>process.stdout.write(JSON.stringify({rows,mutated,rootExists:fs.existsSync(' + JSON.stringify(root) + '),leaseExists:fs.existsSync(target)}))).catch(caught=>{process.stderr.write(String(caught));process.exitCode=1;});'
    ].join('\n');
    const result = await helper(null, recoveryWithMalformedReread, { env, timeoutMs: 60000 });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.mutated, true, 'the first lease read must complete before bytes change');
    const held = findDurableRecord(state.rows, claimId, claimPath);
    assert.ok(held, JSON.stringify(state.rows));
    assert.equal(held.status, 'HOLD');
    assert.equal(held.code, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.rootExists, true);
    assert.equal(state.leaseExists, true);
  } finally {
    if (originalLease && leasePath && fs.existsSync(leasePath)) fs.writeFileSync(leasePath, originalLease);
    if (fs.existsSync(probeRoot)) {
      const recovered = await helper(null, recoveryCode(), { env, timeoutMs: 60000 });
      assert.equal(recovered.code, 0, recovered.stderr);
      const inspected = await helper(null, modulePrelude()
        + '\nprocess.stdout.write(JSON.stringify(runtime.inspectOwnedTemps()));', { env, timeoutMs: 30000 });
      assert.equal(inspected.code, 0, inspected.stderr);
      const remaining = JSON.parse(inspected.stdout);
      const namespace = path.join(probeRoot, '.ai-agent-toolkit-owned-temp-v1');
      const claims = path.join(namespace, 'claims');
      const roots = path.join(namespace, 'roots');
      if (remaining.records.length === 0
          && fs.existsSync(claims) && fs.readdirSync(claims).length === 0
          && fs.existsSync(roots) && fs.readdirSync(roots).length === 0
          && (!root || !fs.existsSync(root))) {
        fs.rmSync(probeRoot, { recursive: true, force: true });
      } else {
        throw new Error('F1 reread namespace did not return to an empty verified state.');
      }
    }
  }
});

test('malformed orphan leases are held before public recovery or admission', async () => {
  const baseline = usage();
  await runOwned(spec('f1-malformed-orphan'), async (lease) => {
    await lease.writeFile('keep.txt', 'preserve');
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    const originalLease = fs.readFileSync(leasePath, 'utf8');
    const orphanId = crypto.randomBytes(16).toString('hex');
    const orphanPath = path.join(base, 'claims', orphanId + '.lease.json');
    const orphan = JSON.parse(originalLease);
    Object.assign(orphan, {
      claim_id: orphanId,
      status: 'REMOVED',
      root_identity: null,
      root_marker_identity: null,
      marker_identity: null,
      root_marker_removed: true,
      root_removed: true,
      metadata_cleanup_phase: 'CLAIM_REMOVAL_PENDING',
      bytes_reserved: 0,
      retention: null,
      owned_children: []
    });
    orphan.evidenceDisposition = 'hold';
    try {
      fs.writeFileSync(orphanPath, JSON.stringify(orphan));
      assert.equal(findDurableRecord(inspectOwnedTemps().records, orphanId, orphanPath).state, 'HOLD');
      const recovered = await recoverStaleOwnedTemps();
      const recoveryHold = findDurableRecord(recovered, orphanId, orphanPath);
      assert.equal(recoveryHold.status, 'HOLD');
      assert.equal(recoveryHold.code, 'TEMP_OWNERSHIP_UNCERTAIN');
      assert.equal(fs.existsSync(orphanPath), true);
      let callbackReached = false;
      await assert.rejects(withOwnedTemp(spec('f1-orphan-admission'), async () => {
        callbackReached = true;
      }), errorCode('TEMP_CAPACITY_UNKNOWN'));
      assert.equal(callbackReached, false);
      assert.equal(fs.readFileSync(lease.path('keep.txt'), 'utf8'), 'preserve');
      assert.equal(fs.existsSync(lease.root), true);
    } finally {
      if (fs.existsSync(orphanPath)) fs.unlinkSync(orphanPath);
      fs.writeFileSync(leasePath, originalLease);
    }
  });
  assert.deepEqual(usage(), baseline);
});

test('F1B orphan lease retry revalidates same-inode bytes and preserves POSIX attempt policy', async () => {
  const probeRoot = makeProbeRoot('owned-temp-f1b-orphan-retry-');
  const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
  const code = modulePrelude() + [
    'async function main(){',
    'const state={ids:{},cleanupCodes:{},recoveryCodes:{},counts:{A:0,B:0}};let readyCount=0;let readyResolve;let releaseResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});const gate=new Promise(resolve=>{releaseResolve=resolve;});const paths={};const originalUnlink=fs.promises.unlink;',
    "const create=(label)=>runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1b-orphan-'+label,budgetBytes:4096},async lease=>{await lease.writeFile('keep.txt',label);const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===lease.root);const base=path.dirname(path.dirname(lease.root));state.ids[label]=row.claimId;paths[label]=path.join(base,'claims',row.claimId+'.lease.json');readyCount++;if(readyCount===2)readyResolve();await gate;});",
    'const episodes=[create(\'A\'),create(\'B\')];await ready;',
    "fs.promises.unlink=async function(filePath,...args){const label=Object.keys(paths).find(key=>path.resolve(String(filePath))===path.resolve(paths[key]));if(label){state.counts[label]++;throw Object.assign(new Error('injected orphan creation failure'),{code:'EIO'});}return originalUnlink.call(this,filePath,...args);};releaseResolve();const created=await Promise.allSettled(episodes);fs.promises.unlink=originalUnlink;for(let i=0;i<created.length;i++)state.cleanupCodes[i===0?'A':'B']=created[i].status==='rejected'?created[i].reason.code:'OK';",
    "state.orphanPresent={A:fs.existsSync(paths.A),B:fs.existsSync(paths.B)};state.claimAbsent={A:!fs.existsSync(paths.A.replace('.lease.json','.claim.json')),B:!fs.existsSync(paths.B.replace('.lease.json','.claim.json'))};",
    'state.counts={A:0,B:0};state.sameInode=false;state.mutationApplied=false;',
    "fs.promises.unlink=async function(filePath,...args){const label=Object.keys(paths).find(key=>path.resolve(String(filePath))===path.resolve(paths[key]));if(label){state.counts[label]++;if(state.counts[label]===1){const failure=Object.assign(new Error('injected retry lock'),{code:'EBUSY'});if(label==='A'){const before=fs.lstatSync(filePath,{bigint:true});return Promise.reject(failure).catch(caught=>{try{const record=JSON.parse(fs.readFileSync(filePath,'utf8'));record.evidenceDisposition='hold';fs.writeFileSync(filePath,JSON.stringify(record));const after=fs.lstatSync(filePath,{bigint:true});state.sameInode=String(before.dev)===String(after.dev)&&String(before.ino)===String(after.ino);state.mutationApplied=JSON.parse(fs.readFileSync(filePath,'utf8')).evidenceDisposition==='hold';}catch(_){}throw caught;});}throw failure;}return originalUnlink.call(this,filePath,...args);}return originalUnlink.call(this,filePath,...args);};",
    'state.first=await runtime.recoverStaleOwnedTemps();fs.promises.unlink=originalUnlink;state.second=await runtime.recoverStaleOwnedTemps();',
    "const find=(rows,label)=>rows.find(value=>value.claimId===state.ids[label]||value.claimPath===paths[label]);for(const label of ['A','B']){const first=find(state.first,label);const second=find(state.second,label);state.recoveryCodes[label]={firstStatus:first&&first.status,firstCode:first&&first.code,secondStatus:second&&second.status,secondCode:second&&second.code};}state.finalPresent={A:fs.existsSync(paths.A),B:fs.existsSync(paths.B)};fs.writeSync(1,JSON.stringify(state));",
    '}main().catch(caught=>{process.stderr.write(caught.stack||String(caught));process.exitCode=1;});'
  ].join('\n');
  try {
    const result = await helper(null, code, { env, timeoutMs: 90000 });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.deepEqual(state.cleanupCodes, { A: 'TEMP_CLEANUP_INCOMPLETE', B: 'TEMP_CLEANUP_INCOMPLETE' });
    assert.deepEqual(state.orphanPresent, { A: true, B: true });
    assert.deepEqual(state.claimAbsent, { A: true, B: true });
    assert.equal(state.mutationApplied, true, JSON.stringify(state));
    assert.equal(state.sameInode, true, 'the retry mutation must retain the orphan lease inode');
    assert.equal(state.counts.A, 1, 'changed orphan bytes must not reach a second target unlink');
    if (process.platform === 'win32') {
      assert.equal(state.recoveryCodes.A.firstStatus, 'HOLD');
      assert.equal(state.recoveryCodes.A.firstCode, 'TEMP_OWNERSHIP_UNCERTAIN');
      assert.equal(state.recoveryCodes.B.firstStatus, 'REMOVED');
      assert.equal(state.counts.B, 2, 'unchanged Windows control reaches its retry');
      assert.equal(state.finalPresent.A, true);
      assert.equal(state.finalPresent.B, false);
    } else {
      assert.equal(state.recoveryCodes.A.firstStatus, 'HOLD');
      assert.equal(state.recoveryCodes.B.firstStatus, 'HOLD');
      assert.equal(state.recoveryCodes.A.secondStatus, 'HOLD');
      assert.equal(state.recoveryCodes.A.secondCode, 'TEMP_OWNERSHIP_UNCERTAIN');
      assert.equal(state.recoveryCodes.B.secondStatus, 'REMOVED');
      assert.equal(state.counts.B, 1, 'POSIX keeps one unlink attempt per recovery invocation');
      assert.equal(state.finalPresent.A, true);
      assert.equal(state.finalPresent.B, false);
    }
    const changedLease = path.join(probeRoot, '.ai-agent-toolkit-owned-temp-v1', 'claims', state.ids.A + '.lease.json');
    const changed = JSON.parse(fs.readFileSync(changedLease, 'utf8'));
    assert.equal(changed.evidenceDisposition, 'hold');
  } finally {
    if (fs.existsSync(probeRoot)) fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('F1A schema-valid retention/lifecycle contradiction cannot be sanitized by terminal cleanup', async () => {
  const invalidRoot = makeProbeRoot('owned-temp-f1a-semantic-');
  const positiveRoot = makeProbeRoot('owned-temp-f1a-positive-');
  const invalidEnv = { ...process.env, TEMP: invalidRoot, TMP: invalidRoot, TMPDIR: invalidRoot };
  const positiveEnv = { ...process.env, TEMP: positiveRoot, TMP: positiveRoot, TMPDIR: positiveRoot };
  const invalidCode = modulePrelude() + [
    'async function main(){',
    "const specification={schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1a-semantic',budgetBytes:4096,retention:{reason:'F1A retention',owner:'toolkit-owned-temp-test',maxBytes:4096,expiresAt:new Date(Date.now()+60000).toISOString()}};",
    'const state={};',
    'try{await runtime.withOwnedTemp(specification,async lease=>{',
    "await lease.writeFile('keep.txt','retention evidence');",
    "const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===lease.root);",
    "const base=path.dirname(path.dirname(lease.root));",
    "state.root=lease.root;state.claimId=row.claimId;state.claimPath=path.join(base,'claims',row.claimId+'.claim.json');state.leasePath=path.join(base,'claims',row.claimId+'.lease.json');state.payloadPath=path.join(lease.root,'keep.txt');",
    'state.originalLease=fs.readFileSync(state.leasePath,\'utf8\');',
    'const claim=JSON.parse(fs.readFileSync(state.claimPath,\'utf8\'));',
    'const leaseRecord=JSON.parse(state.originalLease);',
    "leaseRecord.status='ACTIVE';leaseRecord.retention={reason:claim.retention.reason,owner:claim.retention.owner,max_bytes:claim.retention.maxBytes,expires_at_ms:claim.retention.expiresAtMs,bytes:18};",
    'state.invalidLease=JSON.stringify(leaseRecord);fs.writeFileSync(state.leasePath,state.invalidLease);',
    'state.inspectBefore=runtime.inspectOwnedTemps().records.find(value=>value.claimId===state.claimId||value.claimPath===state.claimPath);',
    '});}catch(caught){state.outerCode=caught.code;state.outerMessage=caught.message;state.cleanupStatus=caught.cleanupStatus||null;}',
    'state.rootExists=!!state.root&&fs.existsSync(state.root);state.payloadExists=!!state.payloadPath&&fs.existsSync(state.payloadPath);',
    'state.payload=state.payloadExists?fs.readFileSync(state.payloadPath,\'utf8\'):null;',
    'state.claimExists=!!state.claimPath&&fs.existsSync(state.claimPath);state.leaseExists=!!state.leasePath&&fs.existsSync(state.leasePath);',
    'state.leaseAfter=state.leaseExists?fs.readFileSync(state.leasePath,\'utf8\'):null;',
    'state.inspectAfter=runtime.inspectOwnedTemps().records.find(value=>value.claimId===state.claimId||value.claimPath===state.claimPath);',
    'process.stdout.write(JSON.stringify(state));',
    '}main().catch(caught=>{process.stderr.write(caught.stack||String(caught));process.exitCode=1;});'
  ].join('\n');
  const positiveCode = modulePrelude() + [
    'async function main(){',
    "const state={};try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1a-positive'},async lease=>{state.root=lease.root;await lease.writeFile('keep.txt','ordinary disposable state');});}catch(caught){state.outerCode=caught.code;}",
    'state.rootExists=!!state.root&&fs.existsSync(state.root);process.stdout.write(JSON.stringify(state));',
    '}main().catch(caught=>{process.stderr.write(caught.stack||String(caught));process.exitCode=1;});'
  ].join('\n');
  try {
    const negative = await helper(null, invalidCode, { env: invalidEnv, timeoutMs: 60000 });
    assert.equal(negative.code, 0, negative.stderr);
    const state = JSON.parse(negative.stdout);
    assert.ok(state.inspectBefore, 'F1A setup failed before the intended boundary: ' + state.outerCode + ' ' + state.outerMessage);
    assert.equal(state.inspectBefore && state.inspectBefore.state, 'HOLD');
    assert.equal(state.inspectBefore.code, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.outerCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(state.rootExists, true, 'contradictory retention must preserve the root');
    assert.equal(state.payloadExists, true);
    assert.equal(state.payload, 'retention evidence');
    assert.equal(state.claimExists, true);
    assert.equal(state.leaseExists, true);
    assert.equal(state.leaseAfter, state.invalidLease, 'cleanup must not patch the invalid predecessor');
    assert.equal(state.inspectAfter.state, 'HOLD');

    const positive = await helper(null, positiveCode, { env: positiveEnv, timeoutMs: 60000 });
    assert.equal(positive.code, 0, positive.stderr);
    assert.equal(JSON.parse(positive.stdout).rootExists, false, 'valid disposable cleanup remains available');
  } finally {
    // Assertions above observe the contradictory bytes before this bounded test-fixture recovery.
    if (fs.existsSync(invalidRoot)) {
      const namespace = path.join(invalidRoot, '.ai-agent-toolkit-owned-temp-v1');
      const claims = path.join(namespace, 'claims');
      if (fs.existsSync(claims)) {
        for (const name of fs.readdirSync(claims)) {
          if (!/^[a-f0-9]{32}\.claim\.json$/.test(name)) continue;
          const claimPath = path.join(claims, name);
          const id = name.slice(0, 32);
          const leasePath = path.join(claims, id + '.lease.json');
          if (!fs.existsSync(leasePath)) continue;
          const leaseRecord = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
          leaseRecord.status = 'TERMINAL';
          leaseRecord.retention = null;
          leaseRecord.lease_expires_at_ms = Date.now() - 1;
          fs.writeFileSync(leasePath, JSON.stringify(leaseRecord));
        }
      }
      await helper(null, recoveryCode(), { env: invalidEnv, timeoutMs: 60000 });
      const inspected = await helper(null, modulePrelude() + '\nprocess.stdout.write(JSON.stringify(runtime.inspectOwnedTemps()));', { env: invalidEnv });
      if (inspected.code === 0 && JSON.parse(inspected.stdout).records.length === 0) fs.rmSync(invalidRoot, { recursive: true, force: true });
    }
    if (fs.existsSync(positiveRoot)) fs.rmSync(positiveRoot, { recursive: true, force: true });
  }
});

test('F1C complete owner PID/start tuple disagreement holds before liveness and deletion', async (t) => {
  const modes = ['claim-pid', 'claim-start', 'marker-pid', 'root-start-pair', 'marker-null-start'];
  for (const mode of modes) {
    await t.test(mode, async () => {
      const probeRoot = makeProbeRoot('owned-temp-f1c-' + mode + '-');
      const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
      const code = modulePrelude() + [
        "const {spawnSync}=require('node:child_process');async function main(){",
        "const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});const deadPid=Number(dead.stdout);",
        "const specification={schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1c-'+" + JSON.stringify(mode) + ',budgetBytes:4096};',
        'const state={mode:' + JSON.stringify(mode) + '};',
        'try{await runtime.withOwnedTemp(specification,async lease=>{',
        "await lease.writeFile('keep.txt','live owner evidence');",
        "const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===lease.root);const base=path.dirname(path.dirname(lease.root));",
        "state.root=lease.root;state.claimId=row.claimId;state.claimPath=path.join(base,'claims',row.claimId+'.claim.json');state.leasePath=path.join(base,'claims',row.claimId+'.lease.json');state.markerPath=path.join(base,'claims',row.claimId+'.marker.json');state.rootMarkerPath=path.join(lease.root,'.ai-agent-toolkit-owned-temp-marker.json');state.payloadPath=path.join(lease.root,'keep.txt');",
        "state.originalClaim=fs.readFileSync(state.claimPath,'utf8');state.originalLease=fs.readFileSync(state.leasePath,'utf8');state.originalMarker=fs.readFileSync(state.markerPath,'utf8');state.originalRootMarker=fs.readFileSync(state.rootMarkerPath,'utf8');",
        "const claim=JSON.parse(state.originalClaim);const marker=JSON.parse(state.originalMarker);const rootMarker=JSON.parse(state.originalRootMarker);",
        "if(state.mode==='claim-pid')claim.process.pid=deadPid;",
        "if(state.mode==='claim-start')claim.process.start_identity='different-start-identity';",
        "if(state.mode==='marker-pid')marker.process.pid=deadPid;",
        "if(state.mode==='root-start-pair'){marker.root_marker.process.start_identity='different-start-identity';rootMarker.process.start_identity='different-start-identity';}",
        "if(state.mode==='marker-null-start')marker.process.start_identity=null;",
        "if(state.mode==='claim-pid'||state.mode==='claim-start')fs.writeFileSync(state.claimPath,JSON.stringify(claim));",
        "if(state.mode==='marker-pid'||state.mode==='root-start-pair'||state.mode==='marker-null-start')fs.writeFileSync(state.markerPath,JSON.stringify(marker));",
        "if(state.mode==='root-start-pair')fs.writeFileSync(state.rootMarkerPath,JSON.stringify(rootMarker));",
        "const leasePath=state.leasePath;const leaseRecord=JSON.parse(fs.readFileSync(leasePath,'utf8'));leaseRecord.status='TERMINAL';leaseRecord.lease_expires_at_ms=Date.now()-1;fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));",
        "state.inspectBefore=runtime.inspectOwnedTemps().records.find(value=>value.claimId===state.claimId||value.claimPath===state.claimPath);state.recovery=await runtime.recoverStaleOwnedTemps();state.recovered=state.recovery.find(value=>value.claimId===state.claimId||value.claimPath===state.claimPath);state.rootExists=!!state.root&&fs.existsSync(state.root);state.payloadExists=!!state.payloadPath&&fs.existsSync(state.payloadPath);state.claimExists=!!state.claimPath&&fs.existsSync(state.claimPath);state.leaseExists=!!state.leasePath&&fs.existsSync(state.leasePath);fs.writeSync(1,JSON.stringify(state));process.exit(0);",
        '});}catch(caught){state.outerCode=caught.code;}',
        'process.stdout.write(JSON.stringify(state));',
        "}main().catch(caught=>{process.stderr.write(caught.stack||String(caught));process.exitCode=1;});"
      ].join('\n');
      try {
        const result = await helper(null, code, { env, timeoutMs: 60000 });
        assert.equal(result.code, 0, result.stderr);
        const state = JSON.parse(result.stdout);
        assert.equal(state.inspectBefore && state.inspectBefore.state, 'HOLD', 'public inspection must reject the inconsistent tuple');
        assert.equal(state.inspectBefore.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        assert.equal(state.recovered.status, 'HOLD');
        assert.equal(state.recovered.code, 'TEMP_OWNERSHIP_UNCERTAIN', 'liveness cannot override cross-record identity');
        assert.equal(state.rootExists, true);
        assert.equal(state.payloadExists, true);
        assert.equal(state.claimExists, true);
        assert.equal(state.leaseExists, true);
      } finally {
        // The fixture is isolated and the owner process has exited before this cleanup.
        if (fs.existsSync(probeRoot)) fs.rmSync(probeRoot, { recursive: true, force: true });
      }
    });
  }
  const positiveRoot = makeProbeRoot('owned-temp-f1c-live-positive-');
  const positiveEnv = { ...process.env, TEMP: positiveRoot, TMP: positiveRoot, TMPDIR: positiveRoot };
  const positiveCode = modulePrelude() + [
    'async function main(){',
    "const state={};try{await runtime.withOwnedTemp({schema:runtime.SPEC_SCHEMA,purpose:'foundation-test',repoRoot,episode:'f1c-consistent-live'},async lease=>{",
    "const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===lease.root);const base=path.dirname(path.dirname(lease.root));const leasePath=path.join(base,'claims',row.claimId+'.lease.json');const originalLease=fs.readFileSync(leasePath,'utf8');const leaseRecord=JSON.parse(originalLease);leaseRecord.status='TERMINAL';leaseRecord.lease_expires_at_ms=Date.now()-1;fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));",
    "state.root=lease.root;state.recovery=await runtime.recoverStaleOwnedTemps();state.recovered=state.recovery.find(value=>value.claimId===row.claimId);state.rootHeldDuringRecovery=fs.existsSync(lease.root);fs.writeFileSync(leasePath,originalLease);",
    '});}catch(caught){state.outerCode=caught.code;}state.rootExists=!!state.root&&fs.existsSync(state.root);process.stdout.write(JSON.stringify(state));',
    '}main().catch(caught=>{process.stderr.write(caught.stack||String(caught));process.exitCode=1;});'
  ].join('\n');
  try {
    const positive = await helper(null, positiveCode, { env: positiveEnv, timeoutMs: 60000 });
    assert.equal(positive.code, 0, positive.stderr);
    const state = JSON.parse(positive.stdout);
    assert.equal(state.recovered.status, 'HOLD');
    assert.equal(state.recovered.code, 'TEMP_PROCESS_LIVE');
    assert.equal(state.rootHeldDuringRecovery, true, 'a consistent live owner remains protected');
  } finally {
    if (fs.existsSync(positiveRoot)) fs.rmSync(positiveRoot, { recursive: true, force: true });
  }
});

test('F1D coordinated reservation under/overstatement blocks inventory and admission before callback', async (t) => {
  for (const delta of [-1, 1]) {
    await t.test(delta < 0 ? 'understated' : 'overstated', async () => {
      const probeRoot = makeProbeRoot('owned-temp-f1d-' + (delta < 0 ? 'under-' : 'over-'));
      const env = { ...process.env, TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot };
      const code = modulePrelude() + [
        'async function main(){',
        'const budget=4*1024*1024;const specification={schema:runtime.SPEC_SCHEMA,purpose:\'foundation-test\',repoRoot,episode:\'f1d-existing\',budgetBytes:budget};const state={};',
        'try{await runtime.withOwnedTemp(specification,async lease=>{',
        "await lease.writeFile('keep.txt','reservation evidence');const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===lease.root);const base=path.dirname(path.dirname(lease.root));",
        "const claimPath=path.join(base,'claims',row.claimId+'.claim.json');const leasePath=path.join(base,'claims',row.claimId+'.lease.json');const originalClaim=fs.readFileSync(claimPath,'utf8');const originalLease=fs.readFileSync(leasePath,'utf8');state.claimPath=claimPath;state.leasePath=leasePath;state.root=lease.root;",
        'const claim=JSON.parse(originalClaim);const leaseRecord=JSON.parse(originalLease);claim.reservation_bytes+=(' + String(delta) + ');leaseRecord.reservation_bytes+=(' + String(delta) + ');fs.writeFileSync(claimPath,JSON.stringify(claim));fs.writeFileSync(leasePath,JSON.stringify(leaseRecord));',
        'state.expectedReservation=budget+1024*1024;state.inspected=runtime.inspectOwnedTemps().records.find(value=>value.claimId===row.claimId||value.claimPath===claimPath);state.recovery=(await runtime.recoverStaleOwnedTemps()).find(value=>value.claimId===row.claimId||value.claimPath===claimPath);',
        "let callbackReached=false;try{await runtime.withOwnedTemp({...specification,episode:'f1d-admission-'+" + JSON.stringify(String(delta)) + '},async()=>{callbackReached=true;});}catch(caught){state.admissionCode=caught.code;}',
        'state.callbackReached=callbackReached;state.rootExists=fs.existsSync(state.root);',
        'fs.writeFileSync(claimPath,originalClaim);fs.writeFileSync(leasePath,originalLease);',
        "await runtime.withOwnedTemp({...specification,episode:'f1d-valid-positive-'+" + JSON.stringify(String(delta)) + '},async()=>{state.validPositiveReached=true;});',
        '});}catch(caught){state.outerCode=caught.code;}',
        'process.stdout.write(JSON.stringify(state));',
        "}main().catch(caught=>{process.stderr.write(caught.stack||String(caught));process.exitCode=1;});"
      ].join('\n');
      try {
        const result = await helper(null, code, { env, timeoutMs: 90000 });
        assert.equal(result.code, 0, result.stderr);
        const state = JSON.parse(result.stdout);
        assert.equal(state.inspected && state.inspected.state, 'HOLD');
        assert.equal(state.inspected.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        assert.equal(state.recovery.status, 'HOLD');
        assert.equal(state.recovery.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        assert.equal(state.admissionCode, 'TEMP_CAPACITY_UNKNOWN');
        assert.equal(state.callbackReached, false);
        assert.equal(state.rootExists, true);
        assert.equal(state.expectedReservation, 5 * 1024 * 1024);
        assert.equal(state.validPositiveReached, true, 'exact B+M accounting retains the public admission control');
      } finally {
        if (fs.existsSync(probeRoot)) fs.rmSync(probeRoot, { recursive: true, force: true });
      }
    });
  }
});

test('F2-N1..N7 preserve child-close primary across failed ledger retirement and fence recovery', async () => {
  const baseline = usage();
  const childRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f2-child-repo-'));
  const childScript = path.join(childRepoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');
  fs.mkdirSync(path.dirname(childScript), { recursive: true });
  fs.writeFileSync(childScript, [
    "process.stdout.write('F2_STDOUT_MARKER\\n');",
    "process.stderr.write('F2_STDERR_MARKER\\n');",
    'process.exitCode = 1;'
  ].join('\n'));
  try {
    const code = [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "const runtime=require(" + JSON.stringify(runtimePath) + ");",
      "const repoRoot=" + JSON.stringify(childRepoRoot) + ';',
      "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot,episode:'f2-primary-retirement',budgetBytes:16*1024*1024};",
      "const originalStatfs=fs.statfsSync;fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});",
      "const originalRename=fs.renameSync;const ChildProcess=require('node:child_process').ChildProcess;const originalEmit=ChildProcess.prototype.emit;",
      "let root=null,claimId=null,leasePath=null,closeSeen=false,ledgerFailureInjected=false;",
      "ChildProcess.prototype.emit=function(event,...args){",
      "const profileChild=Array.isArray(this.spawnargs)&&this.spawnargs.some(value=>String(value).includes('audit-skill-portability.cjs'));",
      "const trigger=event==='close'&&profileChild&&!closeSeen;",
      "if(trigger){closeSeen=true;fs.renameSync=function(from,to,...renameArgs){if(!ledgerFailureInjected&&path.resolve(String(to))===path.resolve(leasePath)){ledgerFailureInjected=true;throw Object.assign(new Error('injected child ledger retirement failure'),{code:'EIO'});}return originalRename.call(this,from,to,...renameArgs);};}",
      "try{return originalEmit.call(this,event,...args);}finally{if(trigger)fs.renameSync=originalRename;}",
      "};",
      "async function main(){let captured=null;try{await runtime.withOwnedTemp(spec,async lease=>{root=lease.root;const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===root);claimId=row.claimId;const base=path.dirname(path.dirname(root));leasePath=path.join(base,'claims',claimId+'.lease.json');await lease.runProfile('skill-portability');});captured={code:'SUCCESS'};}catch(error){captured={code:error.code,exitCode:error.exitCode,signal:error.signal,stdout:error.stdout,stderr:error.stderr,cleanupCode:error.cleanupCode,cleanupStatus:error.cleanupStatus||null,cleanupCauseCode:error.cleanupCause&&error.cleanupCause.code,cleanupCauseOriginalCode:error.cleanupCause&&error.cleanupCause.cause&&error.cleanupCause.cause.code};}finally{ChildProcess.prototype.emit=originalEmit;fs.renameSync=originalRename;fs.statfsSync=originalStatfs;}const row=runtime.inspectOwnedTemps().records.find(value=>value.claimId===claimId);captured.root=root;captured.claimId=claimId;captured.closeSeen=closeSeen;captured.ledgerFailureInjected=ledgerFailureInjected;captured.rootExists=!!root&&fs.existsSync(root);captured.leaseExists=!!leasePath&&fs.existsSync(leasePath);captured.rowState=row&&row.state;if(leasePath&&fs.existsSync(leasePath)){const durableLease=JSON.parse(fs.readFileSync(leasePath,'utf8'));durableLease.lease_expires_at_ms=Date.now()-1;fs.writeFileSync(leasePath,JSON.stringify(durableLease));}process.stdout.write(JSON.stringify(captured)+'\\n');}",
      "main().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
    ].join('\n');
    const result = await helper(null, code);
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout.trim());
    const recovered = await recoverStaleOwnedTemps();
    assert.equal(state.closeSeen, true, 'F2-N1 fault is ordered at real child close');
    assert.equal(state.ledgerFailureInjected, true, 'F2-N1 fault hits durable lease retirement');
    assert.equal(state.code, 'TEMP_CHILD_FAILED', 'F2-N1 child failure remains primary');
    assert.equal(state.exitCode, 1, 'F2-N2 exit code remains primary');
    assert.equal(state.signal, null, 'F2-N3 signal remains primary');
    assert.match(state.stdout, /F2_STDOUT_MARKER/, 'F2-N4 stdout remains available: ' + JSON.stringify(state));
    assert.match(state.stderr, /F2_STDERR_MARKER/, 'F2-N5 stderr remains available: ' + JSON.stringify(state));
    assert.equal(state.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE', 'F2-N6 retirement failure is secondary cleanup state');
    assert.deepEqual(state.cleanupStatus, { status: 'CLEANUP_INCOMPLETE', code: 'TEMP_OWNERSHIP_UNCERTAIN' });
    assert.equal(state.cleanupCauseCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.cleanupCauseOriginalCode, 'EIO');
    assert.equal(state.rootExists, true, 'F2-N7 ownership fence preserves the root');
    assert.equal(state.leaseExists, true, 'F2-N7 durable child evidence is retained for recovery');
    assert.ok(recovered.some((record) => record.claimId === state.claimId && record.status === 'REMOVED'));
    assert.deepEqual(usage(), baseline);
  } finally {
    fs.rmSync(childRepoRoot, { recursive: true, force: true });
  }
});
test('F2 signaled portability child failure remains primary across failed ledger retirement', async () => {
  const baseline = usage();
  const childRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f2-signal-repo-'));
  const childScript = path.join(childRepoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');
  fs.mkdirSync(path.dirname(childScript), { recursive: true });
  fs.writeFileSync(childScript, [
    "process.stdout.write('F2_SIGNAL_STDOUT_MARKER\\n');",
    "process.stderr.write('F2_SIGNAL_STDERR_MARKER\\n');",
    "if(process.platform==='win32')process.exitCode=1;else process.kill(process.pid,'SIGTERM');"
  ].join('\n'));
  try {
    const code = [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "const runtime=require(" + JSON.stringify(runtimePath) + ");",
      "const repoRoot=" + JSON.stringify(childRepoRoot) + ';',
      "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot,episode:'f2-signaled-primary-retirement',budgetBytes:16*1024*1024};",
      "const originalStatfs=fs.statfsSync;fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});",
      "const originalRename=fs.renameSync;const ChildProcess=require('node:child_process').ChildProcess;const originalEmit=ChildProcess.prototype.emit;",
      "let root=null,claimId=null,leasePath=null,closeSeen=false,ledgerFailureInjected=false;",
      "ChildProcess.prototype.emit=function(event,...args){const profileChild=Array.isArray(this.spawnargs)&&this.spawnargs.some(value=>String(value).includes('audit-skill-portability.cjs'));const trigger=event==='close'&&profileChild&&!closeSeen;if(trigger){closeSeen=true;fs.renameSync=function(from,to,...renameArgs){if(!ledgerFailureInjected&&path.resolve(String(to))===path.resolve(leasePath)){ledgerFailureInjected=true;throw Object.assign(new Error('injected signaled-child ledger retirement failure'),{code:'EIO'});}return originalRename.call(this,from,to,...renameArgs);};}const deliveredArgs=trigger&&process.platform==='win32'?[null,'SIGTERM']:args;try{return originalEmit.call(this,event,...deliveredArgs);}finally{if(trigger)fs.renameSync=originalRename;}};",
      "async function main(){let captured=null;try{await runtime.withOwnedTemp(spec,async lease=>{root=lease.root;const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===root);claimId=row.claimId;const base=path.dirname(path.dirname(root));leasePath=path.join(base,'claims',claimId+'.lease.json');await lease.runProfile('skill-portability');});captured={code:'SUCCESS'};}catch(error){captured={code:error.code,exitCode:error.exitCode,signal:error.signal,stdout:error.stdout,stderr:error.stderr,cleanupCode:error.cleanupCode,cleanupStatus:error.cleanupStatus||null,cleanupCauseOriginalCode:error.cleanupCause&&error.cleanupCause.cause&&error.cleanupCause.cause.code};}finally{ChildProcess.prototype.emit=originalEmit;fs.renameSync=originalRename;fs.statfsSync=originalStatfs;}const row=runtime.inspectOwnedTemps().records.find(value=>value.claimId===claimId);captured.claimId=claimId;captured.closeSeen=closeSeen;captured.ledgerFailureInjected=ledgerFailureInjected;captured.rootExists=!!root&&fs.existsSync(root);captured.leaseExists=!!leasePath&&fs.existsSync(leasePath);if(leasePath&&fs.existsSync(leasePath)){const durableLease=JSON.parse(fs.readFileSync(leasePath,'utf8'));durableLease.lease_expires_at_ms=Date.now()-1;fs.writeFileSync(leasePath,JSON.stringify(durableLease));}captured.rowState=row&&row.state;process.stdout.write(JSON.stringify(captured)+'\\n');}main().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
    ].join('\n');
    const result = await helper(null, code, { timeoutMs: 60000 });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout.trim());
    const recovered = await recoverStaleOwnedTemps();
    assert.equal(state.closeSeen, true);
    assert.equal(state.ledgerFailureInjected, true);
    assert.equal(state.code, 'TEMP_CHILD_FAILED');
    assert.equal(state.exitCode, null);
    assert.equal(state.signal, 'SIGTERM');
    assert.match(state.stdout, /F2_SIGNAL_STDOUT_MARKER/);
    assert.match(state.stderr, /F2_SIGNAL_STDERR_MARKER/);
    assert.equal(state.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.deepEqual(state.cleanupStatus, { status: 'CLEANUP_INCOMPLETE', code: 'TEMP_OWNERSHIP_UNCERTAIN' });
    assert.equal(state.cleanupCauseOriginalCode, 'EIO');
    assert.equal(state.rootExists, true);
    assert.equal(state.leaseExists, true);
    assert.ok(recovered.some((record) => record.claimId === state.claimId && record.status === 'REMOVED'));
    assert.deepEqual(usage(), baseline);
  } finally {
    fs.rmSync(childRepoRoot, { recursive: true, force: true });
  }
});

test('F2-P1..P3 keep clean retirement successful and ownership-first failure primary', async () => {
  await runOwned(spec('f2-clean-retirement', { purpose: 'portability', budgetBytes: 16 * 1024 * 1024 }), async (lease) => {
    await copyPortabilityRepo(lease);
    const result = await lease.runProfile('skill-portability');
    assert.equal(result.code, 0, result.stderr);
  });

  const baseline = usage();
  const code = [
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const runtime=require(" + JSON.stringify(runtimePath) + ");",
    "const repoRoot=" + JSON.stringify(repoRoot) + ';',
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot,episode:'f2-persistence-first',budgetBytes:1024};",
    "const originalStatfs=fs.statfsSync;fs.statfsSync=()=>({bavail:16n*1024n*1024n*1024n,bsize:1n});",
    "const originalRename=fs.renameSync;const ChildProcess=require('node:child_process').ChildProcess;const originalEmit=ChildProcess.prototype.emit;",
    "let root=null,claimId=null,leasePath=null,spawnSeen=false,ledgerFailureInjected=false;",
    "ChildProcess.prototype.emit=function(event,...args){",
    "const profileChild=Array.isArray(this.spawnargs)&&this.spawnargs.some(value=>String(value).includes('audit-skill-portability.cjs'));",
    "const trigger=event==='spawn'&&profileChild&&!spawnSeen;",
    "if(trigger){spawnSeen=true;fs.renameSync=function(from,to,...renameArgs){if(!ledgerFailureInjected&&path.resolve(String(to))===path.resolve(leasePath)){ledgerFailureInjected=true;throw Object.assign(new Error('injected pre-primary child ledger failure'),{code:'EIO'});}return originalRename.call(this,from,to,...renameArgs);};}",
    "try{return originalEmit.call(this,event,...args);}finally{if(trigger)fs.renameSync=originalRename;}",
    "};",
    "async function main(){let captured=null;try{await runtime.withOwnedTemp(spec,async lease=>{root=lease.root;const row=runtime.inspectOwnedTemps().records.find(value=>value.rootPath===root);claimId=row.claimId;const base=path.dirname(path.dirname(root));leasePath=path.join(base,'claims',claimId+'.lease.json');await lease.runProfile('skill-portability');});captured={code:'SUCCESS'};}catch(error){captured={code:error.code,causeCode:error.cause&&error.cause.code,causeOriginalCode:error.cause&&error.cause.cause&&error.cause.cause.code,cleanupCode:error.cleanupCode};}finally{ChildProcess.prototype.emit=originalEmit;fs.renameSync=originalRename;fs.statfsSync=originalStatfs;}captured.root=root;captured.claimId=claimId;captured.spawnSeen=spawnSeen;captured.ledgerFailureInjected=ledgerFailureInjected;captured.rootExists=!!root&&fs.existsSync(root);process.stdout.write(JSON.stringify(captured)+'\\n');}",
    "main().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
  ].join('\n');
  const result = await helper(null, code);
  assert.equal(result.code, 0, result.stderr);
  const state = JSON.parse(result.stdout.trim());
  const recovered = await recoverStaleOwnedTemps();
  assert.equal(state.spawnSeen, true);
  assert.equal(state.ledgerFailureInjected, true);
  assert.equal(state.code, 'TEMP_OWNERSHIP_UNCERTAIN', 'F2-P2 persistence failure before a child primary remains primary');
  assert.equal(state.causeCode, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.equal(state.causeOriginalCode, 'EIO');
  assert.equal(state.rootExists, false, 'F2-P3 confirmed child retirement permits cleanup after the primary is preserved');
  assert.equal(recovered.some((record) => record.claimId === state.claimId), false);
  assert.deepEqual(usage(), baseline);
});

test('F3-N1..N3 poison later public growth after mkdir, file-size, and append-size limits', async () => {
  const baseline = usage();
  const deepPath = Array(LIMITS.depth + 1).fill('d').join('/');
  const tooLarge = Buffer.alloc(LIMITS.file + 1);
  await runOwned(spec('f3-depth-poison'), async (lease) => {
    await assert.rejects(lease.mkdir(deepPath), errorCode('TEMP_BUDGET_EXCEEDED'));
    await assert.rejects(lease.writeFile('after-depth.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'd')), false);
    assert.equal(fs.existsSync(path.join(lease.root, 'after-depth.txt')), false);
  });

  await runOwned(spec('f3-file-size-poison'), async (lease) => {
    await assert.rejects(lease.writeFile('nested/too-large.bin', tooLarge), errorCode('TEMP_BUDGET_EXCEEDED'));
    await assert.rejects(lease.mkdir('after-file-limit'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'nested')), false);
    assert.equal(fs.existsSync(path.join(lease.root, 'after-file-limit')), false);
  });

  await runOwned(spec('f3-append-size-poison', { budgetBytes: 2 }), async (lease) => {
    const target = lease.path('append.txt');
    await lease.writeFile('append.txt', 'x');
    const originalLstat = fs.lstatSync;
    try {
      fs.lstatSync = function (filePath, ...args) {
        if (path.resolve(String(filePath)) !== path.resolve(target)) return originalLstat.call(this, filePath, ...args);
        const stats = originalLstat.call(this, filePath, ...args);
        return {
          dev: stats.dev, ino: stats.ino, size: BigInt(LIMITS.file),
          isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false
        };
      };
      await assert.rejects(lease.appendFile('append.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
    } finally {
      fs.lstatSync = originalLstat;
    }
    await assert.rejects(lease.writeFile('after-append-limit.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'x');
    assert.equal(fs.existsSync(path.join(lease.root, 'after-append-limit.txt')), false);
  });
  assert.deepEqual(usage(), baseline);
});

test('F3-N4..N7 poison copy-plan depth, entry, file-size, and destination-reservation failures', async () => {
  const baseline = usage();
  const runCopyFailure = async (episode, source, beforeCopy = null, budgetBytes = 1024) => {
    await runOwned(spec(episode, { budgetBytes }), async (lease) => {
      if (beforeCopy) await beforeCopy(lease);
      await assert.rejects(lease.copyTree(source), errorCode('TEMP_BUDGET_EXCEEDED'));
      await assert.rejects(lease.writeFile('after-copy-limit.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
      assert.equal(fs.existsSync(path.join(lease.root, 'after-copy-limit.txt')), false);
    });
  };

  const deepSource = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f3-copy-depth-'));
  const entrySource = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f3-copy-entries-'));
  const fileSource = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f3-copy-file-'));
  const smallSource = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f3-copy-reservation-'));
  const originalReaddir = fs.readdirSync;
  const originalLstat = fs.lstatSync;
  try {
    let cursor = deepSource;
    for (let index = 0; index <= LIMITS.depth; index += 1) {
      cursor = path.join(cursor, 'd');
      fs.mkdirSync(cursor);
    }
    await runCopyFailure('f3-copy-depth', deepSource);

    fs.writeFileSync(path.join(entrySource, 'placeholder'), 'x');
    await runOwned(spec('f3-copy-entry-poison'), async (lease) => {
      try {
        fs.readdirSync = function (directory, ...args) {
          if (path.resolve(String(directory)) === path.resolve(entrySource)) {
            return Array.from({ length: LIMITS.entries + 1 }, (_, index) => 'f' + index);
          }
          return originalReaddir.call(this, directory, ...args);
        };
        fs.lstatSync = function (filePath, ...args) {
          const absolute = path.resolve(String(filePath));
          if (path.dirname(absolute) === path.resolve(entrySource)) {
            const index = Number(path.basename(absolute).slice(1));
            return { dev: 1n, ino: BigInt(index + 1), size: 0n,
              isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
          }
          return originalLstat.call(this, filePath, ...args);
        };
        await assert.rejects(lease.copyTree(entrySource), errorCode('TEMP_BUDGET_EXCEEDED'));
      } finally {
        fs.readdirSync = originalReaddir;
        fs.lstatSync = originalLstat;
      }
      await assert.rejects(lease.writeFile('after-copy-entry-limit.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
      assert.equal(fs.existsSync(path.join(lease.root, 'f0')), false);
    });

    const oversizedSourceFile = path.join(fileSource, 'oversized.bin');
    fs.writeFileSync(oversizedSourceFile, 'x');
    await runOwned(spec('f3-copy-file-size-poison'), async (lease) => {
      try {
        fs.lstatSync = function (filePath, ...args) {
          if (path.resolve(String(filePath)) === path.resolve(oversizedSourceFile)) {
            const stats = originalLstat.call(this, filePath, ...args);
            return { dev: stats.dev, ino: stats.ino, size: BigInt(LIMITS.file + 1),
              isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
          }
          return originalLstat.call(this, filePath, ...args);
        };
        await assert.rejects(lease.copyTree(fileSource), errorCode('TEMP_BUDGET_EXCEEDED'));
      } finally {
        fs.lstatSync = originalLstat;
      }
      await assert.rejects(lease.mkdir('after-copy-file-limit'), errorCode('TEMP_BUDGET_EXCEEDED'));
      assert.equal(fs.existsSync(path.join(lease.root, 'oversized.bin')), false);
    });

    fs.writeFileSync(path.join(smallSource, 'small.txt'), '123');
    await runCopyFailure('f3-copy-reservation-poison', smallSource, null, 2);
  } finally {
    fs.readdirSync = originalReaddir;
    fs.lstatSync = originalLstat;
    fs.rmSync(deepSource, { recursive: true, force: true });
    fs.rmSync(entrySource, { recursive: true, force: true });
    fs.rmSync(fileSource, { recursive: true, force: true });
    fs.rmSync(smallSource, { recursive: true, force: true });
  }
  assert.deepEqual(usage(), baseline);
});

test('F3-N8..N9 poison child-record and source-update reservation growth while F3-P exact limits remain valid', async () => {
  await runOwned(spec('f3-exact-depth', { budgetBytes: 1 }), async (lease) => {
    const exactDepthPath = Array(LIMITS.depth).fill('d').join('/');
    await lease.mkdir(exactDepthPath);
    await lease.writeFile('exact.txt', 'x');
    assert.equal(fs.existsSync(lease.path(exactDepthPath)), true);
  });

  await runOwned(spec('f3-child-record-metadata-poison', { purpose: 'portability', budgetBytes: 1024 }), async (lease) => {
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    const leaseSchema = JSON.parse(fs.readFileSync(leasePath, 'utf8')).schema;
    const originalStringify = JSON.stringify;
    try {
      JSON.stringify = function (value, ...args) {
        if (value && value.schema === leaseSchema && Array.isArray(value.owned_children) && value.owned_children.length === 1) {
          return 'x'.repeat(LIMITS.metadata + 1);
        }
        return originalStringify.call(this, value, ...args);
      };
      await assert.rejects(lease.runProfile('skill-portability'), errorCode('TEMP_BUDGET_EXCEEDED'));
    } finally {
      JSON.stringify = originalStringify;
    }
    await assert.rejects(lease.writeFile('after-child-metadata-limit.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
    await assert.rejects(lease.runProfile('skill-portability'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'after-child-metadata-limit.txt')), false);
    assert.equal(leaseSchema.length > 0, true);
  });

  await runOwned(spec('f3-source-update-reservation-poison', { purpose: 'source-update', budgetBytes: 65535 }), async (lease) => {
    await assert.rejects(lease.runProfile('source-update'), errorCode('TEMP_BUDGET_EXCEEDED'));
    await assert.rejects(lease.writeFile('after-report-reservation.txt', 'x'), errorCode('TEMP_BUDGET_EXCEEDED'));
    assert.equal(fs.existsSync(path.join(lease.root, 'workspace')), false);
    assert.equal(inspectOwnedTemps().records.find((record) => record.rootPath === lease.root).bytesReserved, 0);
  });
});

test('F3-P class-B profile output limit does not poison later filesystem growth', async () => {
  const childRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-f3-output-repo-'));
  const childScript = path.join(childRepoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');
  fs.mkdirSync(path.dirname(childScript), { recursive: true });
  fs.writeFileSync(childScript, "process.stdout.write('x'.repeat(1024*1024+1));");
  try {
    const specification = spec('f3-class-b-output', { purpose: 'portability', budgetBytes: 16 * 1024 * 1024 });
    specification.repoRoot = childRepoRoot;
    await runOwned(specification, async (lease) => {
      await assert.rejects(lease.runProfile('skill-portability'), errorCode('TEMP_CHILD_OUTPUT_LIMIT'));
      await lease.writeFile('after-class-b-output-limit.txt', 'ok');
      assert.equal(fs.readFileSync(lease.path('after-class-b-output-limit.txt'), 'utf8'), 'ok');
    });
  } finally {
    fs.rmSync(childRepoRoot, { recursive: true, force: true });
  }
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
test('only the two purpose-bound child profiles are exposed', async () => {
  await runOwned(spec('child-profile-rejection'), async (lease) => {
    assert.equal(lease.spawn, undefined);
    assert.equal(lease.run, undefined);
    assert.equal(lease.childEnv, undefined);
    assert.equal(lease.childTemp, undefined);
    await assert.rejects(lease.runProfile('node', { command: 'anything' }), errorCode('TEMP_SPEC_INVALID'));
    await assert.rejects(lease.runProfile('skill-portability'), errorCode('TEMP_SPEC_INVALID'));
    await assert.rejects(lease.runProfile('unknown-profile'), errorCode('TEMP_SPEC_INVALID'));
    const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
    const base = path.dirname(path.dirname(lease.root));
    const leasePath = path.join(base, 'claims', row.claimId + '.lease.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children, []);
  });
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
    const probeRoot = makeProbeRoot('owned-temp-namespace-probe-');
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
  const probeRoot = makeProbeRoot('owned-temp-existing-partial-');
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
  const probeRoot = makeProbeRoot('owned-temp-group-signal-');
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
  const leaseSnapshot=fs.readFileSync(leasePath,'utf8');
  const leaseRecord=JSON.parse(leaseSnapshot);
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
  fs.writeFileSync(leasePath,leaseSnapshot);
  child.kill('SIGKILL');
  await new Promise(resolve=>child.once('close',resolve));
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
    const swappedId = path.basename(paths.root).slice('root-'.length);
    const firstRecovery = await helper(lease, recoveryCode());
    assert.equal(firstRecovery.code, 0, firstRecovery.stderr);
    const held = JSON.parse(firstRecovery.stdout).find((row) => row.claimId === swappedId);
    assert.equal(held.status, 'HOLD', JSON.stringify(held));
    assert.equal(held.code, 'TEMP_LEASE_ACTIVE', JSON.stringify(held));
    assert.equal(fs.existsSync(paths.root), true);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'replacement');
    const base = path.dirname(path.dirname(paths.root));
    const leasePath = path.join(base, 'claims', swappedId + '.lease.json');
    const stale = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    stale.status = 'TERMINAL';
    stale.lease_expires_at_ms = Date.now() - 1;
    fs.writeFileSync(leasePath, JSON.stringify(stale));
    const recovery = await helper(lease, recoveryCode());
    assert.equal(recovery.code, 0, recovery.stderr);
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
  const probeRoot = makeProbeRoot('owned-temp-after-publish-');
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

function writeDcpProfile(childRepoRoot, withDescendant) {
  const scriptPath = path.join(childRepoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  if (!withDescendant) {
    fs.writeFileSync(scriptPath, "process.stdout.write('DCP ordinary child');\n");
    return;
  }
  const descendant = [
    "const fs=require('node:fs'),path=require('node:path');",
    "const temp=process.env.TMPDIR,ready=path.join(temp,'dcp-ready.json'),release=path.join(temp,'dcp-release');",
    "const fields=fs.readFileSync('/proc/self/stat','utf8').split(')')[1].trim().split(/\\s+/);",
    "fs.writeFileSync(ready,JSON.stringify({pid:process.pid,pgid:Number(fields[2]),release}));",
    "setInterval(()=>{if(fs.existsSync(release))process.exit(0);},10);"
  ].join('\n');
  fs.writeFileSync(scriptPath, [
    "const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');",
    "const temp=process.env.TMPDIR,ready=path.join(temp,'dcp-ready.json');",
    "const child=spawn(process.execPath,['-e'," + JSON.stringify(descendant) + "],{detached:false,stdio:'ignore'});child.unref();",
    "const deadline=Date.now()+30000;function poll(){if(fs.existsSync(ready)){const proof=JSON.parse(fs.readFileSync(ready,'utf8'));if(proof.pid!==child.pid)throw Error('Wrong descendant');process.stdout.write(JSON.stringify({leaderPid:process.pid,...proof})+'\\n');return;}if(Date.now()>deadline)throw Error('Descendant READY timed out');setTimeout(poll,10);}poll();"
  ].join('\n'));
}

function writeDcpRunningLedgerProfile(childRepoRoot) {
  const scriptPath = path.join(childRepoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  const descendant = [
    "const fs=require('node:fs'),path=require('node:path');",
    "const temp=process.env.TMPDIR,ready=path.join(temp,'dcp-ready.json'),release=path.join(temp,'dcp-release');",
    "const fields=fs.readFileSync('/proc/self/stat','utf8').split(')')[1].trim().split(/\\s+/);",
    "fs.writeFileSync(ready,JSON.stringify({pid:process.pid,pgid:Number(fields[2]),release}));",
    "setInterval(()=>{if(fs.existsSync(release))process.exit(0);},10);"
  ].join('\n');
  fs.writeFileSync(scriptPath, [
    "const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');",
    "const temp=process.env.TMPDIR,ready=path.join(temp,'dcp-ready.json'),leaderReady=path.join(temp,'dcp-leader-ready.json');",
    "const child=spawn(process.execPath,['-e'," + JSON.stringify(descendant) + "],{detached:false,stdio:'ignore'});child.unref();",
    "const deadline=Date.now()+30000;function poll(){if(fs.existsSync(ready)){const proof=JSON.parse(fs.readFileSync(ready,'utf8'));if(proof.pid!==child.pid)throw Error('Wrong descendant');fs.writeFileSync(leaderReady,JSON.stringify({leaderPid:process.pid,...proof}));return;}if(Date.now()>deadline)throw Error('Descendant READY timed out');setTimeout(poll,10);}poll();"
  ].join('\n'));
}

function dcpOwnerCode(childRepoRoot) {
  return modulePrelude() + [
    "const assert=require('node:assert/strict');",
    "const childRepoRoot=" + JSON.stringify(childRepoRoot) + ";",
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot:childRepoRoot,episode:'dcp-real-descendant',budgetBytes:65536};",
    "let root=null,claimId=null,proof=null;const primary=new Error('DCP primary task failure');primary.code='DCP_PRIMARY';",
    "async function run(){let caught=null;try{await runtime.withOwnedTemp(spec,async lease=>{root=lease.root;claimId=runtime.inspectOwnedTemps().records.find(row=>row.rootPath===root).claimId;const result=await lease.runProfile('skill-portability');proof=JSON.parse(result.stdout.trim());assert.equal(proof.pgid,proof.leaderPid);assert.notEqual(proof.pid,proof.leaderPid);process.kill(proof.pid,0);process.kill(-proof.pgid,0);throw primary;});}catch(error){caught=error;}const leasePath=path.join(path.dirname(path.dirname(root)),'claims',claimId+'.lease.json');const durable=JSON.parse(fs.readFileSync(leasePath,'utf8'));process.stdout.write('DCP_OWNER '+JSON.stringify({ownerPid:process.pid,root,claimId,leasePath,proof,errorCode:caught&&caught.code,primaryIdentity:caught===primary,cleanupCode:caught&&caught.cleanupCode||null,cleanupStatus:caught&&caught.cleanupStatus||null,rootExists:fs.existsSync(root),ownedChildren:durable.owned_children})+'\\n',()=>process.exit(0));}",
    "run().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
  ].join('\n');
}

function dcpRunningLedgerFailureOwnerCode(childRepoRoot) {
  return modulePrelude() + [
    "const childProcess=require('node:child_process');",
    "const ChildProcess=childProcess.ChildProcess;const originalEmit=ChildProcess.prototype.emit;const originalRename=fs.renameSync;const originalKill=process.kill;",
    "const childRepoRoot=" + JSON.stringify(childRepoRoot) + ";",
    "const spec={schema:runtime.SPEC_SCHEMA,purpose:'portability',repoRoot:childRepoRoot,episode:'dcp-running-ledger-failure',budgetBytes:65536};",
    "const injected=Object.assign(new Error('injected DCP07 RUNNING ledger persistence failure'),{code:'EIO'});",
    "let root=null,claimId=null,leasePath=null,leaderPid=null,proof=null,runningRow=null,failureInjected=false,directExitedBeforeFailure=false,groupAliveAtFailure=false,directExitedAtOwnerExit=false,groupAliveAtOwnerExit=false,suppressedGroupSignals=0;",
    "function procState(pid){try{const text=fs.readFileSync('/proc/'+pid+'/stat','utf8'),end=text.lastIndexOf(')');return text.slice(end+1).trim().split(/\\s+/)[0];}catch(error){if(error.code==='ENOENT')return null;throw error;}}",
    "function waitFor(check,label){const deadline=Date.now()+15000;while(!check()){if(Date.now()>deadline)throw new Error('DCP07 timed out waiting for '+label);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}",
    "process.kill=function(pid,signal){if(Number(pid)<0&&(signal==='SIGTERM'||signal==='SIGKILL')){suppressedGroupSignals+=1;return true;}return originalKill.call(this,pid,signal);};",
    "fs.renameSync=function(from,to,...args){let staged=null;try{staged=JSON.parse(fs.readFileSync(from,'utf8'));}catch(_){}const row=staged&&Array.isArray(staged.owned_children)&&staged.owned_children.find(value=>value.phase==='RUNNING');if(!failureInjected&&leasePath&&path.resolve(String(to))===path.resolve(leasePath)&&row){failureInjected=true;runningRow=row;const readyPath=path.join(root,'child-temp','dcp-leader-ready.json');waitFor(()=>fs.existsSync(readyPath),'real descendant readiness and leader proof');proof=JSON.parse(fs.readFileSync(readyPath,'utf8'));if(proof.leaderPid!==leaderPid||proof.pgid!==leaderPid||proof.pid===leaderPid)throw new Error('DCP07 process-group evidence did not match the owned profile child');waitFor(()=>{const state=procState(leaderPid);return state==='Z'||state===null;},'the owned profile child to exit');directExitedBeforeFailure=true;const descendantState=procState(proof.pid);if(!descendantState||descendantState==='Z')throw new Error('DCP07 descendant was not live after direct child exit');try{originalKill.call(process,-proof.pgid,0);groupAliveAtFailure=true;}catch(error){if(error.code!=='ESRCH')throw error;}if(!groupAliveAtFailure)throw new Error('DCP07 process group was not live after direct child exit');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);throw injected;}return originalRename.call(this,from,to,...args);};",
    "ChildProcess.prototype.emit=function(event,...args){const profileChild=Array.isArray(this.spawnargs)&&this.spawnargs.some(value=>String(value).includes('audit-skill-portability.cjs'));if(event==='spawn'&&profileChild)leaderPid=this.pid;return originalEmit.call(this,event,...args);};",
    "async function main(){let caught=null;try{await runtime.withOwnedTemp(spec,async lease=>{root=lease.root;claimId=runtime.inspectOwnedTemps().records.find(row=>row.rootPath===root).claimId;leasePath=path.join(path.dirname(path.dirname(root)),'claims',claimId+'.lease.json');await lease.runProfile('skill-portability');});}catch(error){caught=error;}finally{ChildProcess.prototype.emit=originalEmit;fs.renameSync=originalRename;process.kill=originalKill;}if(!proof&&root&&fs.existsSync(path.join(root,'child-temp','dcp-leader-ready.json')))proof=JSON.parse(fs.readFileSync(path.join(root,'child-temp','dcp-leader-ready.json'),'utf8'));if(proof)proof.leaderPid=leaderPid;if(leaderPid!==null){try{originalKill.call(process,leaderPid,0);const state=procState(leaderPid);directExitedAtOwnerExit=state===null||state==='Z';}catch(error){if(error.code==='ESRCH')directExitedAtOwnerExit=true;else throw error;}}if(proof){try{originalKill.call(process,-proof.pgid,0);groupAliveAtOwnerExit=true;}catch(error){if(error.code!=='ESRCH')throw error;}}const leaseExists=!!leasePath&&fs.existsSync(leasePath);const durable=leaseExists?JSON.parse(fs.readFileSync(leasePath,'utf8')):null;const row=durable&&durable.owned_children&&durable.owned_children.find(value=>value.pid===leaderPid);process.stdout.write('DCP_OWNER '+JSON.stringify({ownerPid:process.pid,root,claimId,leasePath,proof,runningRow,failureInjected,directExitedBeforeFailure,groupAliveAtFailure,directExitedAtOwnerExit,groupAliveAtOwnerExit,suppressedGroupSignals,ownedChildren:durable&&durable.owned_children,errorCode:caught&&caught.code,errorMessage:caught&&caught.message,causeCode:caught&&caught.cause&&caught.cause.code,causeMessage:caught&&caught.cause&&caught.cause.message,causeOriginalCode:caught&&caught.cause&&caught.cause.cause&&caught.cause.cause.code,causeOriginalMessage:caught&&caught.cause&&caught.cause.cause&&caught.cause.cause.message,persistenceFailurePreserved:!!caught&&caught.cause&&caught.cause.cause===injected,cleanupCode:caught&&caught.cleanupCode||null,cleanupStatus:caught&&caught.cleanupStatus||null,rootExists:!!root&&fs.existsSync(root),leaseExists,rowPhase:row&&row.phase})+'\\n',()=>process.exit(0));}",
    "main().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});"
  ].join('\n');
}

const DCP_REAPER_CODE = [
  'import ctypes,json,os,select,signal,subprocess,sys,time',
  'libc=ctypes.CDLL(None,use_errno=True)',
  "if libc.prctl(36,1,0,0,0)!=0:raise RuntimeError('Fixture subreaper prerequisite unavailable')",
  'owner=subprocess.Popen([sys.argv[1],"-e",sys.argv[2]],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)',
  'proof=None;reaped=False',
  'try:',
  ' stdout,stderr=owner.communicate(timeout=45)',
  " if owner.returncode!=0:raise RuntimeError('Owner failed: '+stderr+'; stdout='+stdout)",
  ' rows=[json.loads(line[len("DCP_OWNER "):]) for line in stdout.splitlines() if line.startswith("DCP_OWNER ")]',
  " if len(rows)!=1:raise RuntimeError('Missing owner evidence: '+stdout)",
  ' proof=rows[0]',
  ' print("DCP_READY "+json.dumps({**proof,"ownerExited":True,"ownerExitCode":owner.returncode}),flush=True)',
  ' if not select.select([sys.stdin],[],[],45)[0]:raise RuntimeError("Fixture release timed out")',
  ' if sys.stdin.readline().strip()!="RELEASE":raise RuntimeError("Invalid fixture release")',
  ' with open(proof["proof"]["release"],"w") as target:target.write("release")',
  ' deadline=time.monotonic()+15',
  ' while True:',
  '  pid,status=os.waitpid(proof["proof"]["pid"],os.WNOHANG)',
  '  if pid:reaped=True;break',
  '  if time.monotonic()>deadline:raise RuntimeError("Descendant extinction timed out")',
  '  time.sleep(.01)',
  ' if os.waitstatus_to_exitcode(status)!=0:raise RuntimeError("Descendant exit was unsuccessful")',
  ' print("DCP_REAPED "+json.dumps({"pid":pid,"pgid":proof["proof"]["pgid"]}),flush=True)',
  'finally:',
  ' if owner.poll() is None:owner.kill();owner.wait()',
  ' if proof is not None and not reaped:',
  '  try:os.killpg(proof["proof"]["pgid"],signal.SIGKILL)',
  '  except ProcessLookupError:pass',
  '  try:os.waitpid(proof["proof"]["pid"],0)',
  '  except ChildProcessError:pass'
].join('\n');

async function controlledDcp(childRepoRoot, ownerCode = dcpOwnerCode(childRepoRoot)) {
  const child = spawn('python3', ['-c', DCP_REAPER_CODE, process.execPath, ownerCode], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  });
  const state = { child, stdout: '', stderr: '', closeResult: null };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { state.stdout += chunk; });
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  state.closed = new Promise((resolve) => child.once('close', (code, signal) => {
    state.closeResult = { code, signal };
    resolve(state.closeResult);
  }));
  const waitLine = (prefix) => new Promise((resolve, reject) => {
    let timer;
    const check = () => {
      const line = state.stdout.split('\n').find((value) => value.startsWith(prefix));
      if (line) { clearTimeout(timer); child.stdout.removeListener('data', check); resolve(line); }
      else if (state.closeResult) { clearTimeout(timer); reject(new Error('DCP helper closed early: ' + state.stderr)); }
    };
    timer = setTimeout(() => reject(new Error('DCP helper timed out: ' + state.stderr)), 60000);
    child.stdout.on('data', check);
    state.closed.then(check);
    check();
  });
  const ready = await waitLine('DCP_READY ');
  const dcpState = JSON.parse(ready.slice('DCP_READY '.length));
  let released = false;
  const release = async () => {
    if (released) return null;
    released = true;
    child.stdin.end('RELEASE\n');
    const line = await waitLine('DCP_REAPED ');
    const reaped = JSON.parse(line.slice('DCP_REAPED '.length));
    const closed = await state.closed;
    assert.equal(closed.code, 0, state.stderr);
    assert.equal(closed.signal, null);
    return reaped;
  };
  return {
    state: dcpState,
    release,
    finish: async () => {
      if (!released) await release();
      if (fs.existsSync(dcpState.leasePath)) await recoverDcpStale(dcpState);
    }
  };
}

async function recoverDcpStale(state) {
  const expiry = JSON.parse(fs.readFileSync(state.leasePath, 'utf8')).lease_expires_at_ms;
  const originalNow = Date.now;
  Date.now = () => Math.max(originalNow(), expiry + 1);
  try { return await recoverStaleOwnedTemps(); } finally { Date.now = originalNow; }
}

test('DCP01_POSIX_DESCENDANT_CUSTODY preserves primary error and holds until group extinction', {
  skip: process.platform !== 'linux'
}, async () => {
  const baseline = usage();
  const childRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-dcp-child-repo-'));
  writeDcpProfile(childRepoRoot, true);
  const originalKill = process.kill;
  let fixture = null;
  try {
    fixture = await controlledDcp(childRepoRoot);
    const state = fixture.state;
    assert.equal(state.ownerExited, true);
    assert.equal(state.ownerExitCode, 0);
    assert.throws(() => process.kill(state.ownerPid, 0), (caught) => caught.code === 'ESRCH');
    assert.throws(() => process.kill(state.proof.leaderPid, 0), (caught) => caught.code === 'ESRCH');
    process.kill(state.proof.pid, 0);
    process.kill(-state.proof.pgid, 0);
    const childState = fs.readFileSync('/proc/' + state.proof.pid + '/stat', 'utf8').split(')')[1].trim().split(/\s+/)[0];
    assert.notEqual(childState, 'Z');
    assert.equal(state.proof.pgid, state.proof.leaderPid);
    assert.equal(state.ownedChildren.length, 1);
    assert.equal(state.ownedChildren[0].pid, state.proof.leaderPid);
    assert.equal(state.ownedChildren[0].process_group, true);
    assert.equal(state.ownedChildren[0].phase, 'RUNNING');
    assert.equal(state.rootExists, true);
    assert.equal(state.primaryIdentity, true);
    assert.equal(state.errorCode, 'DCP_PRIMARY');
    assert.equal(state.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(state.cleanupStatus.status, 'CLEANUP_INCOMPLETE');
    assert.equal(state.cleanupStatus.code, 'TEMP_CLEANUP_INCOMPLETE');

    const live = (await recoverDcpStale(state)).find((row) => row.claimId === state.claimId);
    assert.equal(live.status, 'HOLD', JSON.stringify(live));
    assert.equal(live.code, 'TEMP_CHILD_LIVE', JSON.stringify(live));

    const reaped = await fixture.release();
    assert.equal(reaped.pid, state.proof.pid);
    assert.throws(() => originalKill.call(process, -state.proof.pgid, 0), (caught) => caught.code === 'ESRCH');
    process.kill = function (pid, signal) {
      if (pid === -state.proof.pgid && signal === 0) {
        throw Object.assign(new Error('DCP liveness cannot be confirmed'), { code: 'EPERM' });
      }
      return originalKill.call(this, pid, signal);
    };
    const unknown = (await recoverDcpStale(state)).find((row) => row.claimId === state.claimId);
    assert.equal(unknown.status, 'HOLD', JSON.stringify(unknown));
    assert.equal(unknown.code, 'TEMP_CHILD_UNKNOWN', JSON.stringify(unknown));
    assert.equal(fs.existsSync(state.root), true);
    process.kill = originalKill;

    const removed = (await recoverDcpStale(state)).find((row) => row.claimId === state.claimId);
    assert.equal(removed.status, 'REMOVED', JSON.stringify(removed));
    assert.equal(fs.existsSync(state.root), false);
    assert.equal(fs.existsSync(state.leasePath), false);
    assert.deepEqual(usage(), baseline);
  } finally {
    process.kill = originalKill;
    if (fixture) await fixture.finish();
    fs.rmSync(childRepoRoot, { recursive: true, force: true });
  }
});

test('DCP07_RUNNING_LEDGER_WRITE_FAILURE_WITH_SURVIVING_DESCENDANT holds custody until group extinction', {
  skip: process.platform !== 'linux'
}, async () => {
  const baseline = usage();
  const childRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-dcp-running-ledger-child-repo-'));
  writeDcpRunningLedgerProfile(childRepoRoot);
  const originalKill = process.kill;
  let fixture = null;
  try {
    fixture = await controlledDcp(childRepoRoot, dcpRunningLedgerFailureOwnerCode(childRepoRoot));
    const state = fixture.state;
    assert.equal(state.ownerExited, true);
    assert.equal(state.ownerExitCode, 0);
    assert.throws(() => process.kill(state.ownerPid, 0), (caught) => caught.code === 'ESRCH');
    assert.throws(() => process.kill(state.proof.leaderPid, 0), (caught) => caught.code === 'ESRCH');
    process.kill(state.proof.pid, 0);
    process.kill(-state.proof.pgid, 0);
    const descendantState = fs.readFileSync('/proc/' + state.proof.pid + '/stat', 'utf8').split(')')[1].trim().split(/\s+/)[0];
    assert.notEqual(descendantState, 'Z', 'DCP07 descendant remains live after the direct child exits');
    assert.equal(state.proof.pgid, state.proof.leaderPid);
    assert.equal(state.failureInjected, true, 'DCP07 faults the real atomic RUNNING-ledger write');
    assert.equal(state.runningRow.phase, 'RUNNING');
    assert.equal(state.runningRow.pid, state.proof.leaderPid);
    assert.equal(state.directExitedBeforeFailure, true, JSON.stringify(state));
    assert.equal(state.groupAliveAtFailure, true);
    assert.equal(state.directExitedAtOwnerExit, true);
    assert.equal(state.groupAliveAtOwnerExit, true);
    assert.ok(state.suppressedGroupSignals > 0, 'DCP07 fixture keeps the real group alive for stale-recovery observation');
    assert.equal(state.rowPhase, 'RUNNING');
    assert.equal(state.ownedChildren.length, 1);
    assert.equal(state.ownedChildren[0].pid, state.proof.leaderPid);
    assert.equal(state.ownedChildren[0].process_group, true);
    assert.equal(state.ownedChildren[0].phase, 'RUNNING');
    assert.equal(state.errorCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.causeCode, 'TEMP_OWNERSHIP_UNCERTAIN');
    assert.equal(state.causeOriginalCode, 'EIO');
    assert.equal(state.persistenceFailurePreserved, true);
    assert.equal(state.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(state.cleanupStatus.status, 'CLEANUP_INCOMPLETE');
    assert.equal(state.cleanupStatus.code, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(state.rootExists, true);

    const live = (await recoverDcpStale(state)).find((row) => row.claimId === state.claimId);
    assert.equal(live.status, 'HOLD', JSON.stringify(live));
    assert.equal(live.code, 'TEMP_CHILD_LIVE', JSON.stringify(live));
    assert.equal(fs.existsSync(state.root), true);

    const reaped = await fixture.release();
    assert.equal(reaped.pid, state.proof.pid);
    assert.throws(() => originalKill.call(process, -state.proof.pgid, 0), (caught) => caught.code === 'ESRCH');
    const removed = (await recoverDcpStale(state)).find((row) => row.claimId === state.claimId);
    assert.equal(removed.status, 'REMOVED', JSON.stringify(removed));
    assert.equal(fs.existsSync(state.root), false);
    assert.equal(fs.existsSync(state.leasePath), false);
    assert.deepEqual(usage(), baseline);
  } finally {
    process.kill = originalKill;
    if (fixture) await fixture.finish();
    fs.rmSync(childRepoRoot, { recursive: true, force: true });
  }
});

test('DCP05_NONREGRESSION ordinary purpose-bound profile retires child metadata', async () => {
  const baseline = usage();
  const childRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-temp-dcp-clean-child-repo-'));
  writeDcpProfile(childRepoRoot, false);
  try {
    await runOwned({ ...spec('dcp-no-descendant', { purpose: 'portability', budgetBytes: 65536 }),
      repoRoot: childRepoRoot }, async (lease) => {
      const result = await lease.runProfile('skill-portability');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, 'DCP ordinary child');
      const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
      const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children, []);
    });
    assert.deepEqual(usage(), baseline);
  } finally {
    fs.rmSync(childRepoRoot, { recursive: true, force: true });
  }
});
