'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { FakeGitHub, gatedChild } = require('./toolkit-programme-fake-github.cjs');
const holder = { session: 'fixture-controller', prefix: 'TEST-' };
const SHA = 'a'.repeat(40);
const epoch = Date.parse('2026-11-08T00:00:00Z');
const temps = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-state-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(numbers = [2]) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 1, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: ['validate'] };
  const outcomes = numbers.map((issue, i) => ({ issue, label: `Task ${issue}`, class: 'COMMITTED', parent: 1, order: i + 1 }));
  github.addIssue(1);
  numbers.forEach(number => github.addIssue(number, {parent: 1}));
  let now = epoch;
  const store = new state.StateStore({transport: github, store: binding.store, now: () => new Date(now).toISOString()});
  store.write('parent', 1, state.claimDocument(state.newParent({repository: binding.repository, parentIssue: 1, outcomes}), holder, {}), {sha:null, previous:null});
  for (const outcome of outcomes) {
    const doc = state.newChild({repository: binding.repository, outcome}); doc.lifecycle = 'ACTIVE';
    store.write('child', outcome.issue, doc, {sha:null, previous:null});
  }
  const pass = (refresh = true) => new state.Reconciler({ store, binding, writer: refresh ? state.refreshWriter(store.read('parent',1).doc) : holder,
    refreshFacts: refresh, reader: new state.ProgrammeGraphReader({transport:github, repository:binding.repository}),
    mutator:new state.GitHubMutator({transport:github, repository:binding.repository}), toolkitVersion:'3.55.1', now:() => new Date(now).toISOString() });
  return {github,binding,store,pass, run:() => pass().run({apply:true}), child:n => store.read('child',n).doc,
    parent:() => store.read('parent',1).doc, time:ms => { now = ms; }, close:(n, reason='completed') => Object.assign(github.issues.get(n), {state:'closed',state_reason:reason,closed_at:new Date(epoch).toISOString()})};
}
const openCodes = f => (f.parent().attention || []).filter(e => ['new','acknowledged'].includes(e.state)).map(e => e.code).sort();
const writes = f => f.github.calls.filter(c => c.method !== 'GET' && c.path !== 'graphql').length;
const pr = (f,n,options={}) => f.github.addPr(n, {head:SHA, ...options});

test('A2-1: one refresh copies closes, adopts native children and lists merged PRs', () => {
  const f = fixture([2,3,4]); f.close(2); f.close(3,'not_planned');
  f.github.addIssue(5,{title:'New outcome',parent:1});
  f.github.addIssue(6,{title:'Closed nested outcome',parent:4,state:'closed'});
  pr(f,20,{merged:true,body:'Refs #3'});
  const report = f.run(); assert.deepEqual(report.holds,[]);
  assert.equal(f.child(2).lifecycle,'DONE'); assert.equal(f.child(2).completed_at,new Date(epoch).toISOString());
  assert.equal(f.child(2).before_close,'ACTIVE'); assert.equal(f.child(2).closed_by_sweep,true);
  assert.equal(f.child(3).lifecycle,'RETIRED'); assert.equal(f.child(6).lifecycle,'RETIRED');
  assert.equal(f.child(5).added_by_sweep,true);
  assert.deepEqual(f.parent().outcomes.slice(-2).map(o => [o.issue,o.class,o.parent]), [[5,'COMMITTED',1],[6,'COMMITTED',4]]);
  assert.ok(f.parent().outcomes.at(-2).order > 3);
  assert.deepEqual(f.child(3).prs,[{number:20,state:'MERGED',merge_sha:SHA}]);
  assert.deepEqual(openCodes(f),['CHILD_ADDED','CHILD_ADDED','CLOSED_WITHOUT_ACCEPTANCE']);
  assert.match(f.github.issues.get(1).body,/#20.*aaaaaaa/);
  assert.match(f.github.issues.get(3).body,/#20.*aaaaaaa/);
});

test('A2-3: reopen restores the previous lifecycle once and the second refresh writes nothing', () => {
  const f = fixture(); f.close(2); f.run();
  Object.assign(f.github.issues.get(2),{state:'open',closed_at:null,state_reason:null});
  assert.deepEqual(f.run().holds,[]);
  assert.equal(f.child(2).lifecycle,'ACTIVE');
  for (const key of ['before_close','closed_by_sweep','completed_at']) assert.ok(!f.child(2)[key]);
  assert.deepEqual(openCodes(f),['CHILD_REOPENED']);
  const count = writes(f); const second = f.run();
  assert.equal(writes(f),count); assert.deepEqual(second.effects,[]);
  assert.equal(f.parent().attention.filter(e => e.code === 'CHILD_REOPENED').length,1);
});

test('A2-4: PR history includes closing refs, text refs and timeline; unrelated bots are excluded', () => {
  const f = fixture();
  pr(f,20,{merged:true,mergedAt:'2026-11-06T00:00:00Z',body:'Refs #2'});
  pr(f,21,{merged:true,mergedAt:'2026-11-07T00:00:00Z'});
  pr(f,22,{state:'CLOSED'}); pr(f,23,{merged:true}); pr(f,24,{merged:true});
  pr(f,25); pr(f,26,{body:'Refs #1'}); pr(f,27); pr(f,28);
  f.github.prs.get(24).author='dependabot[bot]'; f.github.prs.get(27).author='github-actions[bot]'; f.github.prs.get(28).author='app/github-actions';
  f.github.issuePrLinks.set(2,{closing:[21],timeline:[22]});
  assert.deepEqual(f.run().holds,[]);
  assert.deepEqual(f.child(2).prs.map(p => p.number),[21,20,22]);
  assert.deepEqual(f.parent().attention.filter(e => e.code === 'PR_WITHOUT_TASK').map(e => e.issue).sort((a,b)=>a-b),[23,25]);
  const finding = f.parent().attention.find(e => e.issue===23);
  f.store.mutate('parent',1,{writer:holder,change:doc => state.answerFinding(doc,{id:finding.id,state:'disposed',reason:'Owner confirmed standalone maintenance',now:new Date(epoch).toISOString()})});
  f.run(); assert.equal(f.parent().attention.find(e=>e.id===finding.id).state,'disposed');
});

test('A2-5: 24-hour waiting threshold redraws only changed text; acknowledgement removes waiting', () => {
  const f = fixture(); f.close(2); f.run();
  f.time(epoch + 24*3600000 - 60000); f.run();
  assert.doesNotMatch(f.github.issues.get(1).body,/Waiting on you|waiting on you/);
  f.time(epoch+24*3600000); f.run();
  assert.match(state.attentionLine(f.parent().attention,new Date(epoch+24*3600000).toISOString()),/1 waiting on you/);
  assert.match(f.github.issues.get(1).body,/\*\*Waiting on you\*\*/);
  const count = writes(f); f.time(epoch+25*3600000); f.run(); assert.equal(writes(f),count);
  const id=f.parent().attention[0].id;
  f.store.mutate('parent',1,{writer:holder,change:doc=>state.answerFinding(doc,{id,state:'acknowledged',now:new Date(epoch+25*3600000).toISOString()})});
  f.run(); assert.doesNotMatch(f.github.issues.get(1).body,/\*\*Waiting on you\*\*/);
});

test('A2-6: other registered programmes keep their children and duplicate hierarchy finding', () => {
  const f=fixture(); Object.assign(f.binding,{schema:state.SCHEMA.bindingV2,governance:'enabled',parents:[{issue:1,record_prefix:'TEST-'},{issue:10,record_prefix:'OTHER-'}]});
  f.github.addIssue(10); f.github.addIssue(11,{parent:10}); f.github.link(10,2);
  const report=f.run(); assert.ok(report.findings.some(e=>e.code==='DUPLICATE_HIERARCHY'));
  assert.ok(!f.parent().outcomes.some(o=>o.issue===11)); assert.equal(f.github.issues.get(2).parent,10);
});

for (const lifecycle of ['DONE','RETIRED']) test(`A2-7 authority matrix: non-holder patch ${lifecycle} remains refused`,()=>{
  const f=fixture();
  assert.throws(()=>state.applyPatch('child',f.child(2),{lifecycle},{writer:{session:'executor',prefix:'BUILD-'},parentDoc:f.parent()}),{code:'ROLE_REFUSED'});
});
for (const read of ['failed','partial','open','closed']) test(`A2-7 observation matrix: ${read} issue read`,()=>{
  const f=fixture(); f.close(2);
  if(read==='failed') f.github.intercept(c=>c.method==='GET' && /issues\/2$/.test(c.path) ? {status:503,json:{}} : null);
  if(read==='partial') f.github.intercept(c=>c.method==='GET' && /issues\/2$/.test(c.path) ? {status:200,json:{number:2,state:'closed',state_reason:'completed'}} : null);
  if(read==='open') Object.assign(f.github.issues.get(2),{state:'open',closed_at:null});
  try { f.run(); } catch(e) { assert.ok(['failed','partial'].includes(read)); }
  assert.equal(f.child(2).lifecycle,read==='closed'?'DONE':'ACTIVE');
});

test('A2-7: ordinary reconciliation cannot copy lifecycle or adopt children',()=>{
  const f=fixture(); f.close(2); f.github.addIssue(3,{parent:1}); f.pass(false).run({apply:true});
  assert.equal(f.child(2).lifecycle,'ACTIVE'); assert.equal(f.parent().outcomes.length,1);
});

test('A2-8: unchanged refresh has zero document, page or block effects',()=>{
  const f=fixture(); f.github.addIssue(3,{parent:1}); f.close(2); f.run();
  assert.equal(f.child(2).closed_by_sweep,true); assert.ok(f.parent().outcomes.some(outcome=>outcome.issue===3));
  const count=writes(f); const result=f.run(); assert.deepEqual(result.effects,[]); assert.equal(writes(f),count);
});

test('PR discovery budget preserves existing history and reports incomplete without advancing the watermark',()=>{
  const f=fixture(Array.from({length:65},(_,i)=>i+2));
  for(let i=0;i<65;i++) { pr(f,100+i,{merged:true,body:`Refs #${i+2}`}); }
  f.run(); const saved=f.child(2).prs; assert.ok(saved?.length);
  f.github.issuePrLinks.set(2,{timelineTruncated:true}); f.time(epoch+3600000);
  const result=f.run(); assert.ok(result.findings.some(e=>e.code==='PR_DISCOVERY_INCOMPLETE'));
  assert.deepEqual(f.child(2).prs,saved);
  const scans=f.github.calls.filter(c=>c.path==='graphql' && /closedByPullRequestsReferences/.test(c.body.query)); assert.ok(scans.length);
});

test('reader compatibility: historical reader rejects additive v1 and safely holds v2; current reads v1',()=>{
  const dir=temporary();
  const archive=path.join(dir,'reader.tar');
  const archived=spawnSync('git',['archive','69f4d3bda','-o',archive,'skills/github-program-reconciler'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',windowsHide:true});
  assert.equal(archived.status,0,archived.stderr);
  const extracted=spawnSync('tar',['-xf',archive,'-C',dir],{encoding:'utf8',windowsHide:true}); assert.equal(extracted.status,0,extracted.stderr);
  const old=require(path.join(dir,'skills/github-program-reconciler/scripts/programme-state.cjs'));
  const v1=old.newChild({repository:'example.test/app',outcome:{issue:2,class:'COMMITTED'}});
  assert.deepEqual(state.validateChild(v1),[]);
  const additive={...v1,prs:[],before_close:'ACTIVE',closed_by_sweep:true,added_by_sweep:true};
  assert.ok(old.validateChild(additive).some(e=>/unknown field/.test(e)));
  const f=fixture(); f.close(2); f.run(); const v2=f.child(2);
  assert.equal(v2.schema,'toolkit.programme-state.child.v2');
  assert.ok(old.validateChild(v2).some(e=>/schema must be toolkit.programme-state.child.v1/.test(e)));
  assert.throws(()=>old.assertValid('child',v2),{code:'STATE_INVALID'});
  assert.throws(()=>old.validatePublic('child',state.publicView('child',v2)),{code:'STATE_INVALID'});
  assert.deepEqual(state.validateChild(v2),[]);
});

for (const [reason,want] of [['completed','DONE'],['COMPLETED','DONE'],['not_planned','RETIRED'],['duplicate','RETIRED'],[null,'RETIRED']]) {
  test(`close reason matrix: ${reason} becomes ${want} without inventing acceptance`,()=>{
    const f=fixture(); f.close(2,reason); f.run();
    assert.equal(f.child(2).lifecycle,want); assert.equal(f.child(2).gate.role,null);
    assert.equal(openCodes(f).includes('CLOSED_WITHOUT_ACCEPTANCE'),want==='DONE');
  });
}

for (const previous of ['PLANNED','ACTIVE','WAITING_OWNER','HOLD']) test(`reopen matrix: restore ${previous}`,()=>{
  const f=fixture(); f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:previous})});
  f.close(2); f.run(); assert.equal(f.child(2).lifecycle,'DONE'); assert.equal(f.child(2).before_close,previous);
  Object.assign(f.github.issues.get(2),{state:'open',closed_at:null}); f.run();
  assert.equal(f.child(2).lifecycle,previous);
});

test('reopen falls back to ACTIVE when its saved lifecycle is absent',()=>{
  const f=fixture(); f.close(2); f.run();
  assert.equal(f.child(2).closed_by_sweep,true);
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>{delete doc.before_close;return doc;}});
  Object.assign(f.github.issues.get(2),{state:'open',closed_at:null}); f.run(); assert.equal(f.child(2).lifecycle,'ACTIVE');
});

for (const lifecycle of ['DONE','RETIRED']) test(`controller ${lifecycle} stays controller-owned after reopen`,()=>{
  const f=fixture(); f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle})});
  const report=f.run(); assert.equal(f.child(2).lifecycle,lifecycle);
  assert.ok(report.findings.some(e=>e.code==='CHILD_STATE_CONFLICT'));
  assert.ok(!report.findings.some(e=>e.code==='CHILD_REOPENED'));
});

test('an accepted completion copies the close without a missing-acceptance finding',()=>{
  const f=fixture();
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>gatedChild(state,doc,{role:'G2',returnId:'reviewed',verdict:'ACCEPT',writer:holder,parentDoc:f.parent()})});
  f.close(2); f.run(); assert.equal(f.child(2).lifecycle,'DONE'); assert.ok(!openCodes(f).includes('CLOSED_WITHOUT_ACCEPTANCE'));
});

for(const race of ['reopen','controller','takeover','partial']) test(`fresh close matrix: ${race} between plan and apply holds lifecycle`,()=>{
  const f=fixture(); f.close(2); const pass=f.pass(); const plan=pass.plan();
  if(race==='reopen') Object.assign(f.github.issues.get(2),{state:'open',closed_at:null});
  if(race==='controller') f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:'HOLD'})});
  if(race==='takeover') f.store.mutate('parent',1,{writer:holder,change:doc=>state.claimDocument(doc,{session:'successor',prefix:'TEST-'},{takeover:true})});
  if(race==='partial') f.github.intercept(c=>c.method==='GET' && /issues\/2$/.test(c.path) ? {status:200,json:{number:2,state:'closed',state_reason:'completed',closed_at:new Date(epoch).toISOString()}} : null);
  try { const report=pass.apply(plan); assert.ok(report.holds.length); }
  catch(e) { assert.equal(race,'takeover'); assert.equal(e.code,'STALE_WRITER'); }
  assert.equal(f.child(2).lifecycle,race==='controller'?'HOLD':'ACTIVE');
});

test('a newly discovered registered parent and foreign membership are never adopted',()=>{
  const f=fixture();
  Object.assign(f.binding,{schema:state.SCHEMA.bindingV2,governance:'enabled',parents:[{issue:1,record_prefix:'TEST-'},{issue:10,record_prefix:'OTHER-'}]});
  f.github.addIssue(10,{parent:1}); f.github.addIssue(11,{parent:1});
  const pass=f.pass(); const plan=pass.plan(); f.github.link(10,11);
  const result=pass.apply(plan); assert.ok(result.holds.some(e=>e.code==='GRAPH_FACT_STALE'));
  assert.ok(!f.parent().outcomes.some(o=>[10,11].includes(o.issue))); assert.equal(f.child(11),null);
  assert.ok(plan.findings.some(e=>e.code==='NATIVE_CHILD_UNKNOWN' && e.issue===10));
});

test('history keeps the current PR and orders open, newest merged, older merged, closed',()=>{
  const f=fixture(); pr(f,20,{merged:true,mergedAt:'2026-11-07T00:00:00Z',body:'Refs #2'});
  pr(f,21,{merged:true,mergedAt:'2026-11-06T00:00:00Z',body:'Refs #2'});
  pr(f,22,{state:'CLOSED',body:'Refs #2'}); pr(f,23,{body:'Refs #2'});
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,pr:{...doc.pr,number:23}})});
  f.run(); assert.equal(f.child(2).pr.number,23); assert.deepEqual(f.child(2).prs.map(p=>p.number),[23,20,21,22]);
});

test('a complete pass advances the private close watermark; old closes and parent links stay excluded',()=>{
  const f=fixture(); f.run(); const watermark=f.parent().private.graph_pr_watermark; assert.ok(watermark);
  pr(f,20,{state:'CLOSED'}); f.github.prs.get(20).closedAt='2026-11-07T00:00:00Z';
  pr(f,21,{state:'CLOSED'}); f.github.prs.get(21).closedAt='2026-11-08T01:00:00Z';
  pr(f,22,{body:'Refs #1'}); f.time(epoch+2*3600000); f.run();
  assert.deepEqual(f.parent().attention.filter(e=>e.code==='PR_WITHOUT_TASK').map(e=>e.issue),[21]);
  assert.equal(f.parent().private.graph_pr_watermark,new Date(epoch+2*3600000).toISOString());
});

test('sixty-request ceiling is shared; truncated connections preserve the prior list and watermark',()=>{
  const f=fixture(); pr(f,20,{body:'Refs #2'}); f.run(); const before=f.child(2).prs; const watermark=f.parent().private.graph_pr_watermark;
  f.github.issuePrLinks.set(2,{closingTruncated:true}); f.time(epoch+3600000);
  const pass=f.pass(); const plan=pass.plan(); assert.equal(plan.complete,false); assert.ok(plan.observed.prGraph.requests<=60);
  pass.apply(plan); assert.deepEqual(f.child(2).prs,before); assert.equal(f.parent().private.graph_pr_watermark,watermark);
  const bounded=f.pass();
  bounded.reader.graphPullRequests=(_status,spend)=>{for(let i=0;i<61;i++)spend();return [];};
  const large=bounded.plan();
  assert.equal(large.observed.prGraph.requests,60); assert.equal(large.complete,false);
});

test('the locked CLI refresh copies facts and refuses terminal update patches from a non-holder',()=>{
  const f=fixture(); const dir=temporary(); f.close(2);
  const deps={transport:f.github,binding:f.binding,originUrl:'https://github.com/example.test/app.git',repoRoot:dir,
    toolkitVersion:'3.55.1',lockFile:path.join(dir,'pass.lock'),attentionDir:path.join(dir,'attention'),stateCheckpointDir:path.join(dir,'checkpoints'),
    environment:{},now:()=>new Date(epoch).toISOString(),stdout:{write:()=>{}}};
  assert.equal(cli.main(['refresh','--json'],deps),0); assert.equal(f.child(2).lifecycle,'DONE');
  for(const lifecycle of ['DONE','RETIRED']) {
    const file=path.join(dir,`${lifecycle}.json`); fs.writeFileSync(file,JSON.stringify({lifecycle}));
    assert.throws(()=>cli.main(['update','--issue','2','--patch',file,'--controller','--session','executor','--prefix','BUILD-','--json'],deps),{code:'ROLE_REFUSED'});
  }
  assert.equal(fs.existsSync(deps.lockFile),false);
});

test('linking an orphan PR resolves its finding while an unanswered closed orphan remains visible',()=>{
  const f=fixture(); pr(f,20); pr(f,21,{state:'CLOSED'}); f.run();
  f.github.prs.get(20).body='Refs #2'; f.time(epoch+3600000); f.run();
  assert.equal(f.parent().attention.find(e=>e.code==='PR_WITHOUT_TASK' && e.issue===20).state,'resolved');
  assert.equal(f.parent().attention.find(e=>e.code==='PR_WITHOUT_TASK' && e.issue===21).state,'new');
});

for(const [start,reason,want] of [['DONE','not_planned','RETIRED'],['RETIRED','completed','DONE']]) test(`close matrix: ${start} disagrees with GitHub ${reason}`,()=>{
  const f=fixture(); f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:start})});
  f.close(2,reason); f.run(); assert.equal(f.child(2).lifecycle,want); assert.equal(f.child(2).before_close,start);
});

test('v1 documents upgrade only on changed writes; public v2 validates and rejects malformed history',()=>{
  const f=fixture(); const old={...f.child(2),schema:'toolkit.programme-state.child.v1'};
  delete old.prs;
  const file=f.store.docPath('child',2); const text=state.canonicalText(old); const {blobSha}=require('./toolkit-programme-fake-github.cjs');
  f.github.files.set(file,{text,sha:blobSha(text)}); f.store.ownWrites.clear();
  assert.deepEqual(state.validateChild(f.child(2)),[]);
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>doc}); assert.equal(f.child(2).schema,old.schema);
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,next_action:'Controller: check the result'})});
  assert.equal(f.child(2).schema,'toolkit.programme-state.child.v2');
  const current=f.store.read('child',2);
  assert.throws(()=>f.store.write('child',2,{...current.doc,schema:'toolkit.programme-state.child.v3'},{sha:current.sha,previous:current.doc}),{code:'STATE_INVALID'});
  const ajv=new (require('ajv/dist/2020'))({strict:false});
  const validate=ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT,'repo/contracts/programme-state/child-state-v2.schema.json'),'utf8')));
  const doc={...f.child(2),prs:[{number:20,state:'MERGED',merge_sha:SHA}]}; assert.equal(validate(doc),true);
  assert.doesNotThrow(()=>state.publicView('child',doc));
  for(const prs of [null,[{number:0,state:'OPEN',merge_sha:null}],[{number:20,state:'INVALID',merge_sha:null}],[{number:20,state:'OPEN',merge_sha:'bad'}]]) {
    assert.ok(state.validateChild({...doc,prs}).length); assert.equal(validate({...doc,prs}),false);
  }
});

test('the first refresh of a v1 child keeps discovered PRs through its schema upgrade',()=>{
  const f=fixture(); const legacy={...f.child(2),schema:'toolkit.programme-state.child.v1'}; delete legacy.prs;
  const text=state.canonicalText(legacy); const {blobSha}=require('./toolkit-programme-fake-github.cjs');
  f.github.files.set(f.store.docPath('child',2),{text,sha:blobSha(text)}); f.store.ownWrites.clear();
  pr(f,20,{merged:true,body:'Refs #2'}); f.run();
  assert.deepEqual(f.child(2).prs,[{number:20,state:'MERGED',merge_sha:SHA}]);
  const before=writes(f); assert.deepEqual(f.run().effects,[]); assert.equal(writes(f),before);
});
